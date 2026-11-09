import graphRaw from '../../map/data/walk-graph.json?raw';
import { WORLD_H, WORLD_W } from './constants';

/** 10 万 agent 下不能无限缓存精确 OD；只保留最近的两万条。 */
const MAX_ROUTE_CACHE = 20_000;
const MAX_NEAREST_CACHE = 20_000;

/**
 * M3 walking router.
 *
 * The graph is generated from the offline z14 OSM transportation tiles by
 * `map/scripts/build-walk-graph.mjs`. It intentionally uses world coordinates,
 * so the simulation and the game camera share the same 2560 × 1440 space.
 */

interface RawGraph {
  nodes: Array<[number, number]>;
  edges: Array<[number, number, number, number, number?]>;
}

interface Edge {
  to: number;
  meters: number;
  speed: number;
  vehicleSpeed: number;
}

interface HeapEntry {
  f: number;
  node: number;
}

const WALK_METERS_PER_MIN = 75;

class MinHeap {
  private items: HeapEntry[] = [];

  get size(): number {
    return this.items.length;
  }

  push(f: number, node: number): void {
    this.items.push({ f, node });
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((this.items[p]?.f ?? 0) <= (this.items[i]?.f ?? 0)) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): HeapEntry | null {
    const top = this.items[0];
    if (!top) return null;
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let best = i;
        if (l < this.items.length && (this.items[l]?.f ?? 0) < (this.items[best]?.f ?? 0)) best = l;
        if (r < this.items.length && (this.items[r]?.f ?? 0) < (this.items[best]?.f ?? 0)) best = r;
        if (best === i) break;
        this.swap(i, best);
        i = best;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const tmp = this.items[a]!;
    this.items[a] = this.items[b]!;
    this.items[b] = tmp;
  }
}

interface WalkResult {
  minutes: number;
  meters: number;
  /** World-space polyline, including the start/end connectors. */
  path: Array<[number, number]>;
}

interface CarResult extends WalkResult {
  accessMinutes: number;
  driveMinutes: number;
  egressMinutes: number;
}

export class WalkRouter {
  private nodes: Array<[number, number]>;
  private adj: Edge[][];
  private vehicleAdj: Edge[][];
  private walkComponent: Int32Array;
  private vehicleComponent: Int32Array;
  private walkMain = -1;
  private vehicleMain = -1;
  private cell = 5;
  private buckets = new Map<string, number[]>();
  private nearestCache = new Map<string, number>();
  private nearestMainCache = new Map<string, number>();
  private routeCache = new Map<string, WalkResult | null>();
  private stationFields = new Map<string, Float32Array | null>();
  /** 16px 网格上的最近主成分节点，背景路径 O(1) 查找。 */
  private mainGrid = new Int32Array(0);
  private mainGridW = 0;
  private mainGridH = 0;
  /** 精确 A* 用的 CSR 邻接与定长数组：避免每条路径分配 Map / Set。 */
  private walkStart = new Int32Array(0);
  private walkTo = new Int32Array(0);
  private walkCost = new Float32Array(0);
  private walkMeters = new Float32Array(0);
  private vehicleStart = new Int32Array(0);
  private vehicleTo = new Int32Array(0);
  private vehicleCost = new Float32Array(0);
  private vehicleMeters = new Float32Array(0);
  private heapNode = new Int32Array(4096);
  private heapKey = new Float32Array(4096);
  private heapSize = 0;
  private gen = 0;
  private gScore = new Float32Array(0);
  private metersTo = new Float32Array(0);
  private prevNode = new Int32Array(0);
  private seenGen = new Int32Array(0);
  private closedGen = new Int32Array(0);
  private maxWalkMpm = 75;
  private maxVehicleMpm = 400;
  /** ALT 地标：8 个地标到所有节点的步行时间，用 |d(L,t)-d(L,n)| 收紧 A*。 */
  private landmarkNodes: number[] = [];
  private landmarkDist: Float32Array[] = [];
  /** 诊断用：上一次 A* 展开了多少节点。 */
  lastExpanded = 0;
  readonly nodeCount: number;

  constructor() {
    const graph = JSON.parse(graphRaw) as RawGraph;
    this.nodes = graph.nodes;
    this.nodeCount = this.nodes.length;
    this.adj = Array.from({ length: this.nodes.length }, () => []);
    this.vehicleAdj = Array.from({ length: this.nodes.length }, () => []);
    for (const [a, b, meters, speed, vehicleSpeed = 0] of graph.edges) {
      // 高速公路 / 匝道只有 vehicleSpeed，speed=0：只进机动车网，不进步行网。
      if (speed > 0) {
        this.adj[a]?.push({ to: b, meters, speed, vehicleSpeed });
        this.adj[b]?.push({ to: a, meters, speed, vehicleSpeed });
      }
      if (vehicleSpeed > 0) {
        this.vehicleAdj[a]?.push({ to: b, meters, speed, vehicleSpeed });
        this.vehicleAdj[b]?.push({ to: a, meters, speed, vehicleSpeed });
      }
    }
    this.buildEdgeIndex(graph.edges);
    this.gScore = new Float32Array(this.nodes.length);
    this.metersTo = new Float32Array(this.nodes.length);
    this.prevNode = new Int32Array(this.nodes.length);
    this.seenGen = new Int32Array(this.nodes.length);
    this.closedGen = new Int32Array(this.nodes.length);
    const walkComp = this.components(this.adj);
    const vehicleComp = this.components(this.vehicleAdj);
    this.walkComponent = walkComp.component;
    this.walkMain = walkComp.main;
    this.vehicleComponent = vehicleComp.component;
    this.vehicleMain = vehicleComp.main;
    this.buildMainGrid();
    this.buildLandmarks();
    for (let i = 0; i < this.nodes.length; i++) {
      const [x, y] = this.nodes[i]!;
      const key = this.bucketKey(x, y);
      const list = this.buckets.get(key);
      if (list) list.push(i);
      else this.buckets.set(key, [i]);
    }
  }

  /** 把边表压成 CSR：A* 内层只做数组下标访问，不再遍历对象数组。 */
  private buildEdgeIndex(edges: RawGraph['edges']): void {
    const n = this.nodes.length;
    const wStart = new Int32Array(n + 1);
    const vStart = new Int32Array(n + 1);
    let wCount = 0;
    let vCount = 0;
    for (const [a, b, , speed, vehicleSpeed = 0] of edges) {
      if (speed > 0) {
        wStart[a + 1] += 1;
        wStart[b + 1] += 1;
        wCount += 2;
        const mpm = speed * 16.6667;
        if (mpm > this.maxWalkMpm) this.maxWalkMpm = mpm;
      }
      if (vehicleSpeed > 0) {
        vStart[a + 1] += 1;
        vStart[b + 1] += 1;
        vCount += 2;
        const mpm = vehicleSpeed * 16.6667;
        if (mpm > this.maxVehicleMpm) this.maxVehicleMpm = mpm;
      }
    }
    for (let i = 0; i < n; i++) {
      wStart[i + 1] += wStart[i];
      vStart[i + 1] += vStart[i];
    }
    const wCursor = wStart.slice();
    const vCursor = vStart.slice();
    this.walkTo = new Int32Array(wCount);
    this.walkCost = new Float32Array(wCount);
    this.walkMeters = new Float32Array(wCount);
    this.vehicleTo = new Int32Array(vCount);
    this.vehicleCost = new Float32Array(vCount);
    this.vehicleMeters = new Float32Array(vCount);
    for (const [a, b, meters, speed, vehicleSpeed = 0] of edges) {
      if (speed > 0) {
        const cost = meters / (speed * 16.6667);
        let i = wCursor[a]!;
        this.walkTo[i] = b;
        this.walkCost[i] = cost;
        this.walkMeters[i] = meters;
        wCursor[a] = i + 1;
        i = wCursor[b]!;
        this.walkTo[i] = a;
        this.walkCost[i] = cost;
        this.walkMeters[i] = meters;
        wCursor[b] = i + 1;
      }
      if (vehicleSpeed > 0) {
        const cost = meters / (vehicleSpeed * 16.6667);
        let i = vCursor[a]!;
        this.vehicleTo[i] = b;
        this.vehicleCost[i] = cost;
        this.vehicleMeters[i] = meters;
        vCursor[a] = i + 1;
        i = vCursor[b]!;
        this.vehicleTo[i] = a;
        this.vehicleCost[i] = cost;
        this.vehicleMeters[i] = meters;
        vCursor[b] = i + 1;
      }
    }
    this.walkStart = wStart;
    this.vehicleStart = vStart;
  }

  /**
   * A* 从任意两点走向全城时最坏要展开两万多个节点（单条约 5–20ms），
   * 十几万人同时出行根本算不过来。用 8 个地标预计算「地标 → 所有节点」
   * 的步行时间，再把 |d(L,t)-d(L,n)| 当作下界，长距离路径通常只展开几百个点。
   */
  private buildLandmarks(): void {
    const points: Array<[number, number]> = [
      [120, 120],
      [2440, 120],
      [120, 1320],
      [2440, 1320],
      [1280, 700],
      [700, 1125],
      [1205, 578],
      [1900, 1000],
    ];
    const seen = new Set<number>();
    for (const [x, y] of points) {
      const node = this.nearestMainFast(x, y, this.walkComponent, this.walkMain, 260);
      if (node >= 0 && !seen.has(node)) seen.add(node);
    }
    this.landmarkNodes = [...seen];
    this.landmarkDist = this.landmarkNodes.map((node) => this.dijkstraWalk(node));
  }

  /** 单源地标 Dijkstra（只走步行边）。 */
  private dijkstraWalk(source: number): Float32Array {
    const n = this.nodes.length;
    const dist = new Float32Array(n).fill(Infinity);
    const done = new Uint8Array(n);
    this.heapSize = 0;
    dist[source] = 0;
    this.pushHeap(source, 0);
    const to = this.walkTo;
    const cost = this.walkCost;
    const start = this.walkStart;
    while (this.heapSize > 0) {
      const cur = this.popHeap();
      if (cur < 0 || done[cur] === 1) continue;
      done[cur] = 1;
      const base = dist[cur]!;
      const end = start[cur + 1]!;
      for (let e = start[cur]!; e < end; e++) {
        const next = to[e]!;
        if (done[next] === 1) continue;
        const nd = base + cost[e]!;
        if (nd < dist[next]!) {
          dist[next] = nd;
          this.pushHeap(next, nd);
        }
      }
    }
    return dist;
  }

  /** 多源 Dijkstra：把每个 16px 格子映射到最近的主成分步行节点。 */
  private buildMainGrid(): void {
    const cell = 16;
    const w = Math.ceil(WORLD_W / cell);
    const h = Math.ceil(WORLD_H / cell);
    this.mainGridW = w;
    this.mainGridH = h;
    const grid = new Int32Array(w * h).fill(-1);
    const dist = new Float32Array(w * h).fill(Infinity);
    const heap = new MinHeap();
    for (let i = 0; i < this.nodes.length; i++) {
      if (this.walkComponent[i] !== this.walkMain) continue;
      const [x, y] = this.nodes[i]!;
      const gx = Math.min(w - 1, Math.max(0, Math.floor(x / cell)));
      const gy = Math.min(h - 1, Math.max(0, Math.floor(y / cell)));
      const index = gy * w + gx;
      if (dist[index] === 0) continue;
      dist[index] = 0;
      grid[index] = i;
      heap.push(0, index);
    }
    const steps: Array<[number, number, number]> = [
      [1, 0, 1],
      [-1, 0, 1],
      [0, 1, 1],
      [0, -1, 1],
      [1, 1, 1.4142],
      [1, -1, 1.4142],
      [-1, 1, 1.4142],
      [-1, -1, 1.4142],
    ];
    while (heap.size > 0) {
      const cur = heap.pop();
      if (!cur) break;
      const index = cur.node;
      const cd = dist[index]!;
      if (cur.f > cd + 1e-6) continue;
      const source = grid[index]!;
      if (source < 0) continue;
      const gx = index % w;
      const gy = Math.floor(index / w);
      for (const [dx, dy, step] of steps) {
        const nx = gx + dx;
        const ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const next = ny * w + nx;
        const nd = cd + step;
        if (nd < (dist[next] ?? Infinity) - 1e-6) {
          dist[next] = nd;
          grid[next] = source;
          heap.push(nd, next);
        }
      }
    }
    this.mainGrid = grid;
  }

  private nearestMainFast(
    x: number,
    y: number,
    comp: Int32Array,
    main: number,
    maxConnector: number,
  ): number {
    if (comp === this.walkComponent && this.mainGrid.length > 0) {
      const gx = Math.floor(x / 16);
      const gy = Math.floor(y / 16);
      if (gx >= 0 && gy >= 0 && gx < this.mainGridW && gy < this.mainGridH) {
        const node = this.mainGrid[gy * this.mainGridW + gx]!;
        if (node >= 0) {
          const [nx, ny] = this.nodes[node]!;
          // 网格已经是最近主节点；超出连接上限时直接失败，避免再扫一大圈。
          return Math.hypot(nx - x, ny - y) <= maxConnector ? node : -1;
        }
        return -1;
      }
    }
    return this.nearestMainNode(x, y, comp, main, maxConnector);
  }

  /**
   * M4: shortest walking minutes from every graph node to a station. One
   * Dijkstra tree per station makes all home/work access lookups cheap; this is
   * what lets planTrip choose stations by real road time without running an A*
   * for every candidate.
   */
  stationAccess(from: { x: number; y: number }, station: { x: number; y: number }): number | null {
    const field = this.stationField(station);
    if (!field) return null;
    const node = this.nearestNode(from.x, from.y);
    if (node < 0) return null;
    const minutes = field[node];
    if (minutes === undefined || !Number.isFinite(minutes)) return null;
    const [nx, ny] = this.nodes[node]!;
    return minutes + Math.hypot(nx - from.x, ny - from.y) / WALK_METERS_PER_MIN;
  }

  private stationField(station: { x: number; y: number }): Float32Array | null {
    const key = `${station.x.toFixed(1)},${station.y.toFixed(1)}`;
    if (this.stationFields.has(key)) return this.stationFields.get(key) ?? null;
    const start = this.nearestNode(station.x, station.y);
    if (start < 0) {
      this.stationFields.set(key, null);
      return null;
    }
    const [sx, sy] = this.nodes[start]!;
    if (Math.hypot(sx - station.x, sy - station.y) > 80) {
      this.stationFields.set(key, null);
      return null;
    }
    const n = this.nodes.length;
    const dist = new Float32Array(n);
    dist.fill(Infinity);
    dist[start] = 0;
    const open = new MinHeap();
    open.push(0, start);
    let guard = 0;
    while (open.size > 0 && guard++ < n * 8) {
      const cur = open.pop();
      if (!cur) break;
      const cd = dist[cur.node] ?? Infinity;
      if (cur.f > cd + 1e-6) continue;
      for (const edge of this.adj[cur.node] ?? []) {
        const nd = cd + edge.meters / (edge.speed * 16.6667);
        if (nd < (dist[edge.to] ?? Infinity) - 1e-6) {
          dist[edge.to] = nd;
          open.push(nd, edge.to);
        }
      }
    }
    this.stationFields.set(key, dist);
    return dist;
  }

  /** Walking minutes between two arbitrary world points, or null if disconnected. */
  route(
    from: { x: number; y: number },
    to: { x: number; y: number },
    mode: 'walk' | 'vehicle' = 'walk',
    maxConnector = 80,
  ): WalkResult | null {
    const key = `${mode}:${maxConnector}:${from.x.toFixed(1)},${from.y.toFixed(1)}>${to.x.toFixed(1)},${to.y.toFixed(1)}`;
    if (this.routeCache.has(key)) return this.routeCache.get(key) ?? null;

    const comp = mode === 'vehicle' ? this.vehicleComponent : this.walkComponent;
    const main = mode === 'vehicle' ? this.vehicleMain : this.walkMain;
    const a = this.nearestMainNode(from.x, from.y, comp, main, maxConnector);
    const b = this.nearestMainNode(to.x, to.y, comp, main, maxConnector);
    if (a < 0 || b < 0) {
      this.rememberRoute(key, null);
      return null;
    }
    const [ax, ay] = this.nodes[a]!;
    const [bx, by] = this.nodes[b]!;
    const startConnector = Math.hypot(ax - from.x, ay - from.y);
    const endConnector = Math.hypot(bx - to.x, by - to.y);
    if (startConnector > maxConnector || endConnector > maxConnector) {
      this.rememberRoute(key, null);
      return null;
    }
    const path =
      a === b
        ? { minutes: 0, meters: 0, path: [] as Array<[number, number]> }
        : this.aStar(a, b, mode === 'vehicle');
    if (path === null) {
      this.rememberRoute(key, null);
      return null;
    }
    const meters = path.meters + startConnector + endConnector;
    // 门口到路网节点的连接段只在很短时画出来。160px（约 3km）的连接段
    // 本质上是一条不存在的直线，热力里最显眼的就是它。
    const points: Array<[number, number]> = [];
    if (startConnector <= 32) points.push([from.x, from.y]);
    points.push([ax, ay], ...path.path, [bx, by]);
    if (endConnector <= 32) points.push([to.x, to.y]);
    const result = {
      minutes:
        path.minutes +
        (startConnector + endConnector) /
          (mode === 'vehicle' ? 20 * 16.6667 : WALK_METERS_PER_MIN),
      meters,
      path: points,
    };
    this.rememberRoute(key, result);
    return result;
  }

  private rememberRoute(key: string, result: WalkResult | null): void {
    if (!this.routeCache.has(key) && this.routeCache.size >= MAX_ROUTE_CACHE) {
      const oldest = this.routeCache.keys().next().value;
      if (oldest !== undefined) this.routeCache.delete(oldest);
    }
    this.routeCache.set(key, result);
  }

  /**
   * Car as three legs: walk access → main-road drive → walk egress.
   * Access/egress use the walking graph when possible; the middle leg uses the
   * vehicle graph only. This avoids treating a car as door-to-door.
   */
  carRoute(
    from: { x: number; y: number },
    to: { x: number; y: number },
    maxAccessPx = 160,
  ): CarResult | null {
    const comp = this.vehicleComponent;
    const main = this.vehicleMain;
    const a = this.nearestMainNode(from.x, from.y, comp, main, maxAccessPx);
    const b = this.nearestMainNode(to.x, to.y, comp, main, maxAccessPx);
    if (a < 0 || b < 0) return null;
    const [ax, ay] = this.nodes[a]!;
    const [bx, by] = this.nodes[b]!;
    const accessMeters = Math.hypot(ax - from.x, ay - from.y);
    const egressMeters = Math.hypot(bx - to.x, by - to.y);
    if (accessMeters > maxAccessPx || egressMeters > maxAccessPx) return null;
    const drive =
      a === b
        ? { minutes: 0, meters: 0, path: [] as Array<[number, number]> }
        : this.aStar(a, b, true);
    if (!drive) return null;

    const access = this.route(from, { x: ax, y: ay }, 'walk', maxAccessPx);
    const egress = this.route({ x: bx, y: by }, to, 'walk', maxAccessPx);
    const points: Array<[number, number]> = [];
    const push = (x: number, y: number): void => {
      const last = points[points.length - 1];
      if (!last || Math.hypot(last[0] - x, last[1] - y) > 0.01) points.push([x, y]);
    };
    if (access) {
      for (const [x, y] of access.path) push(x, y);
    } else {
      push(from.x, from.y);
      push(ax, ay);
    }
    for (const [x, y] of drive.path) push(x, y);
    push(bx, by);
    if (egress) {
      for (const [x, y] of egress.path) push(x, y);
    } else {
      push(to.x, to.y);
    }
    const accessMinutes = access ? access.minutes : accessMeters / WALK_METERS_PER_MIN;
    const egressMinutes = egress ? egress.minutes : egressMeters / WALK_METERS_PER_MIN;
    return {
      minutes: accessMinutes + drive.minutes + egressMinutes,
      meters: accessMeters + drive.meters + egressMeters,
      path: points,
      accessMinutes,
      driveMinutes: drive.minutes,
      egressMinutes,
    };
  }

  /** Connected components; only the largest one is worth an A* search. */
  private components(adj: Edge[][]): { component: Int32Array; main: number } {
    const n = adj.length;
    const component = new Int32Array(n).fill(-1);
    let id = 0;
    let main = -1;
    let best = 0;
    for (let start = 0; start < n; start++) {
      if (component[start] !== -1) continue;
      let size = 0;
      const stack = [start];
      component[start] = id;
      while (stack.length > 0) {
        const cur = stack.pop()!;
        size++;
        for (const edge of adj[cur] ?? []) {
          if (component[edge.to] === -1) {
            component[edge.to] = id;
            stack.push(edge.to);
          }
        }
      }
      if (size > best) {
        best = size;
        main = id;
      }
      id++;
    }
    return { component, main };
  }

  private nearestMainNode(
    x: number,
    y: number,
    comp: Int32Array,
    main: number,
    maxConnector: number,
  ): number {
    const kind = comp === this.walkComponent ? 'w' : 'v';
    const cacheKey = `${kind}:${Math.round(x)}:${Math.round(y)}:${maxConnector}`;
    const cached = this.nearestMainCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    let best = -1;
    let bestD = Infinity;
    const maxRadius = Math.ceil(maxConnector / this.cell);
    for (let radius = 0; radius <= maxRadius; radius++) {
      for (let gx = -radius; gx <= radius; gx++) {
        for (let gy = -radius; gy <= radius; gy++) {
          if (radius > 0 && Math.abs(gx) !== radius && Math.abs(gy) !== radius) continue;
          const list = this.buckets.get(`${cx + gx},${cy + gy}`);
          if (!list) continue;
          for (const id of list) {
            if (comp[id] !== main) continue;
            const [nx, ny] = this.nodes[id]!;
            const d = Math.hypot(nx - x, ny - y);
            if (d < bestD) {
              bestD = d;
              best = id;
            }
          }
        }
      }
      if (best >= 0 && bestD <= radius * this.cell + this.cell) break;
    }
    if (!this.nearestMainCache.has(cacheKey) && this.nearestMainCache.size >= MAX_NEAREST_CACHE) {
      const oldest = this.nearestMainCache.keys().next().value;
      if (oldest !== undefined) this.nearestMainCache.delete(oldest);
    }
    this.nearestMainCache.set(cacheKey, best);
    return best;
  }

  private nearestNode(x: number, y: number): number {
    const key = `${Math.round(x * 2)},${Math.round(y * 2)}`;
    const cached = this.nearestCache.get(key);
    if (cached !== undefined) return cached;
    let best = -1;
    let bestD = Infinity;
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    for (let radius = 0; radius <= 2 && best < 0; radius++) {
      for (let gx = -radius; gx <= radius; gx++) {
        for (let gy = -radius; gy <= radius; gy++) {
          const list = this.buckets.get(`${cx + gx},${cy + gy}`);
          if (!list) continue;
          for (const id of list) {
            const [nx, ny] = this.nodes[id]!;
            const d = Math.hypot(nx - x, ny - y);
            if (d < bestD) {
              bestD = d;
              best = id;
            }
          }
        }
      }
    }
    if (!this.nearestCache.has(key) && this.nearestCache.size >= MAX_NEAREST_CACHE) {
      const oldest = this.nearestCache.keys().next().value;
      if (oldest !== undefined) this.nearestCache.delete(oldest);
    }
    this.nearestCache.set(key, best);
    return best;
  }

  private aStar(start: number, goal: number, vehicle = false): WalkResult | null {
    if (start === goal) return { minutes: 0, meters: 0, path: [] };
    if (this.gen >= 0x7ffffffe) {
      this.gScore.fill(0);
      this.seenGen.fill(0);
      this.closedGen.fill(0);
      this.gen = 0;
    }
    const gen = ++this.gen;
    const nodes = this.nodes;
    const [gx, gy] = nodes[goal]!;
    const mpm = vehicle ? this.maxVehicleMpm : this.maxWalkMpm;
    const startIndex = vehicle ? this.vehicleStart : this.walkStart;
    const to = vehicle ? this.vehicleTo : this.walkTo;
    const cost = vehicle ? this.vehicleCost : this.walkCost;
    const meters = vehicle ? this.vehicleMeters : this.walkMeters;
    const g = this.gScore;
    const seen = this.seenGen;
    const closed = this.closedGen;
    const prev = this.prevNode;
    const metersTo = this.metersTo;
    this.heapSize = 0;
    this.lastExpanded = 0;
    const useLandmark = !vehicle && this.landmarkDist.length > 0;
    const hd = (node: number): number => {
      const euclid = this.heuristic(node, gx, gy, mpm);
      if (!useLandmark) return euclid;
      const lm = this.landmarkHeuristic(node, goal);
      return lm > euclid ? lm : euclid;
    };
    g[start] = 0;
    seen[start] = gen;
    metersTo[start] = 0;
    this.pushHeap(start, hd(start));
    while (this.heapSize > 0) {
      const current = this.popHeap();
      if (current < 0) break;
      if (closed[current] === gen) continue;
      if (current === goal) {
        const path: Array<[number, number]> = [];
        let cur = goal;
        while (cur !== start) {
          path.push(nodes[cur]!);
          const p = prev[cur]!;
          if (p === cur) break;
          cur = p;
        }
        path.reverse();
        return { minutes: g[goal]!, meters: metersTo[goal]!, path };
      }
      closed[current] = gen;
      this.lastExpanded++;
      const base = g[current]!;
      const end = startIndex[current + 1]!;
      for (let e = startIndex[current]!; e < end; e++) {
        const next = to[e]!;
        if (closed[next] === gen) continue;
        const nd = base + cost[e]!;
        if (seen[next] !== gen || nd < g[next]!) {
          seen[next] = gen;
          g[next] = nd;
          metersTo[next] = metersTo[current]! + meters[e]!;
          prev[next] = current;
          this.pushHeap(next, nd + hd(next));
        }
      }
    }
    return null;
  }

  private heuristic(node: number, gx: number, gy: number, mpm: number): number {
    const [x, y] = this.nodes[node]!;
    return Math.hypot(x - gx, y - gy) / mpm;
  }

  private landmarkHeuristic(node: number, goal: number): number {
    let h = 0;
    for (let i = 0; i < this.landmarkDist.length; i++) {
      const d = this.landmarkDist[i]!;
      const a = d[node]!;
      const b = d[goal]!;
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      const v = a > b ? a - b : b - a;
      if (v > h) h = v;
    }
    return h;
  }

  private pushHeap(node: number, key: number): void {
    if (this.heapSize >= this.heapNode.length) {
      const nodes = new Int32Array(this.heapNode.length * 2);
      const keys = new Float32Array(this.heapKey.length * 2);
      nodes.set(this.heapNode);
      keys.set(this.heapKey);
      this.heapNode = nodes;
      this.heapKey = keys;
    }
    let i = this.heapSize++;
    const hN = this.heapNode;
    const hK = this.heapKey;
    hN[i] = node;
    hK[i] = key;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hK[p]! <= hK[i]!) break;
      const tn = hN[p]!;
      const tk = hK[p]!;
      hN[p] = hN[i]!;
      hK[p] = hK[i]!;
      hN[i] = tn;
      hK[i] = tk;
      i = p;
    }
  }

  private popHeap(): number {
    const hN = this.heapNode;
    const hK = this.heapKey;
    const top = hN[0]!;
    const last = --this.heapSize;
    if (last > 0) {
      hN[0] = hN[last]!;
      hK[0] = hK[last]!;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let best = i;
        if (l < last && hK[l]! < hK[best]!) best = l;
        if (r < last && hK[r]! < hK[best]!) best = r;
        if (best === i) break;
        const tn = hN[best]!;
        const tk = hK[best]!;
        hN[best] = hN[i]!;
        hK[best] = hK[i]!;
        hN[i] = tn;
        hK[i] = tk;
        i = best;
      }
    }
    return top;
  }

  private bucketKey(x: number, y: number): string {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`;
  }
}
