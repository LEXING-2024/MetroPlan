import {
  BUILTIN_PX_PER_KM,
  TRANSFER_PENALTY,
  TRAIN_DWELL,
  WALK_RADIUS,
  WALK_SPEED,
  speedForTrainKind,
} from './constants';
import type { Network } from './network';
import { segmentTravel } from './network';
import type { Leg, Plan } from './types';

interface Edge {
  to: number;
  /** 虚拟线路号：lineId * 2 + service（0 慢车 / 1 快车） */
  lineId: number;
  time: number;
  service: 'local' | 'express';
}

function virtualLineId(lineId: number, service: 'local' | 'express'): number {
  return lineId * 2 + (service === 'express' ? 1 : 0);
}

interface HeapEntry {
  dist: number;
  key: number;
}

class MinHeap {
  private items: HeapEntry[] = [];

  get size(): number {
    return this.items.length;
  }

  push(dist: number, key: number): void {
    this.items.push({ dist, key });
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((this.items[p]?.dist ?? 0) <= (this.items[i]?.dist ?? 0)) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): HeapEntry {
    const top = this.items[0]!;
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      const n = this.items.length;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let best = i;
        if (l < n && (this.items[l]?.dist ?? 0) < (this.items[best]?.dist ?? 0)) best = l;
        if (r < n && (this.items[r]?.dist ?? 0) < (this.items[best]?.dist ?? 0)) best = r;
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

const LINE_SLOT = 4096;
const NO_LINE = LINE_SLOT - 1;

function makeKey(stationOrdinal: number, lineId: number): number {
  return stationOrdinal * LINE_SLOT + (lineId < 0 ? NO_LINE : lineId);
}

function keyStation(key: number): number {
  return Math.floor(key / LINE_SLOT);
}

function keyLine(key: number): number {
  const slot = key % LINE_SLOT;
  return slot === NO_LINE ? -1 : slot;
}

function buildAdjacency(net: Network, pxPerKm: number): { adj: Edge[][]; ord: Map<number, number> } {
  const adj: Edge[][] = net.stations.map(() => []);
  const ord = new Map<number, number>();
  net.stations.forEach((s, i) => ord.set(s.id, i));
  for (const line of net.lines) {
    const localId = virtualLineId(line.id, 'local');
    const expressId = virtualLineId(line.id, 'express');
    // 慢车：相邻站，逐站停（含停站时间）。
    for (let i = 0; i < line.stationIds.length - 1; i++) {
      const a = net.stationById.get(line.stationIds[i]!);
      const b = net.stationById.get(line.stationIds[i + 1]!);
      if (!a || !b) continue;
      const oa = ord.get(a.id);
      const ob = ord.get(b.id);
      if (oa === undefined || ob === undefined) continue;
      const time = segmentTravel(a, b, pxPerKm, speedForTrainKind('local')) + TRAIN_DWELL;
      adj[oa]?.push({ to: ob, lineId: localId, time, service: 'local' });
      adj[ob]?.push({ to: oa, lineId: localId, time, service: 'local' });
    }
    // 快车：只在快车停靠站之间直连，跳过的小站不停，所以省下停站时间。
    const hasExpress = line.trains.some((id) => net.trainById.get(id)?.kind === 'express');
    if (!hasExpress) continue;
    const stops = net.expressStopIndexes(line);
    if (stops.length < 2) continue;
    for (let k = 0; k + 1 < stops.length; k++) {
      const from = stops[k]!;
      const to = stops[k + 1]!;
      let time = 0;
      for (let i = from; i < to; i++) {
        const a = net.stationById.get(line.stationIds[i]!);
        const b = net.stationById.get(line.stationIds[i + 1]!);
        if (a && b) time += segmentTravel(a, b, pxPerKm, speedForTrainKind('express'));
      }
      const oa = ord.get(line.stationIds[from]!);
      const ob = ord.get(line.stationIds[to]!);
      if (oa === undefined || ob === undefined) continue;
      adj[oa]?.push({ to: ob, lineId: expressId, time, service: 'express' });
      adj[ob]?.push({ to: oa, lineId: expressId, time, service: 'express' });
    }
    // 环线：最后一段 C→A 也要有快车边。
    const loop = line.stationIds.length > 2 && line.stationIds[0] === line.stationIds[line.stationIds.length - 1];
    if (loop && stops.length >= 2) {
      const from = stops[stops.length - 1]!;
      const to = stops[0]!;
      if (from !== to) {
        let time = 0;
        for (let i = from; i < line.stationIds.length - 1; i++) {
          const a = net.stationById.get(line.stationIds[i]!);
          const b = net.stationById.get(line.stationIds[i + 1]!);
          if (a && b) time += segmentTravel(a, b, pxPerKm, speedForTrainKind('express'));
        }
        const oa = ord.get(line.stationIds[from]!);
        const ob = ord.get(line.stationIds[to]!);
        if (oa !== undefined && ob !== undefined) {
          adj[oa]?.push({ to: ob, lineId: expressId, time, service: 'express' });
          adj[ob]?.push({ to: oa, lineId: expressId, time, service: 'express' });
        }
      }
    }
  }
  return { adj, ord };
}

/**
 * 邻接表按「线网版本 + 比例尺」缓存：一次目的地重选会跑上万次 planTrip，
 * 每次重建邻接表是主要开销。
 */
const adjacencyCache = new WeakMap<
  Network,
  { version: number; pxPerKm: number; adj: Edge[][]; ord: Map<number, number> }
>();

function adjacencyOf(
  net: Network,
  pxPerKm: number,
): { adj: Edge[][]; ord: Map<number, number> } {
  const hit = adjacencyCache.get(net);
  if (hit && hit.version === net.version && hit.pxPerKm === pxPerKm) return hit;
  const built = buildAdjacency(net, pxPerKm);
  const entry = { version: net.version, pxPerKm, ...built };
  adjacencyCache.set(net, entry);
  return entry;
}

export interface PlanOptions {
  /** 指定起点站（换乘 / 改线后重算时使用），跳过步行半径搜索。 */
  fixedOrigin?: number;
  /** 步行覆盖半径（像素），自定义地图按比例尺换算。 */
  walkRadius?: number;
  /** 步行速度（像素 / 游戏分钟）。 */
  walkSpeed?: number;
  /** 地图比例尺（像素 / 公里），用于站距换算。 */
  pxPerKm?: number;
  /**
   * M4: actual walking time (game minutes) between two points, usually backed
   * by the local walking graph. Returning null removes an unreachable station.
   */
  accessTime?: (fromX: number, fromY: number, toX: number, toY: number) => number | null;
  /** M4: station-specific access lookup (precomputed station tree). */
  accessStation?: (fromX: number, fromY: number, stationX: number, stationY: number) => number | null;
}

/**
 * 只按时间计算：步行 + 候车 + 乘车 + 换乘 1 分钟。
 * 起点取步行半径内最近的车站；终点在所有可达站中取“下车步行后总时间最短”。
 */
export function planTrip(
  net: Network,
  sx: number,
  sy: number,
  dx: number,
  dy: number,
  options: PlanOptions = {},
): Plan | null {
  const walkRadius = options.walkRadius ?? WALK_RADIUS;
  const walkSpeed = options.walkSpeed ?? WALK_SPEED;
  const pxPerKm = options.pxPerKm ?? BUILTIN_PX_PER_KM;
  if (net.stations.length === 0 || net.lines.length === 0) return null;

  const { adj, ord } = adjacencyOf(net, pxPerKm);

  // 起点不再只取“最近的一个站”：步行范围内的所有车站都作为候选，
  // 由总时间决定走哪个站。这样不会因为最近站没接线路而把整次出行判为不可达。
  const maxWalkMinutes = walkRadius / Math.max(1e-6, walkSpeed);
  const walkTime = (fromX: number, fromY: number, toX: number, toY: number): number | null => {
    if (options.accessTime) return options.accessTime(fromX, fromY, toX, toY);
    const d = Math.hypot(toX - fromX, toY - fromY);
    return d <= walkRadius ? d / walkSpeed : null;
  };

  const originCandidates: Array<{ ordinal: number; walk: number }> = [];
  if (options.fixedOrigin !== undefined) {
    const fixed = net.stationById.get(options.fixedOrigin);
    const ordinal = fixed ? ord.get(fixed.id) : undefined;
    if (ordinal === undefined) return null;
    originCandidates.push({ ordinal, walk: 0 });
  } else {
    net.stations.forEach((s, i) => {
      const walk = walkTime(sx, sy, s.x, s.y);
      if (walk !== null && walk <= maxWalkMinutes) originCandidates.push({ ordinal: i, walk });
    });
    if (originCandidates.length === 0) return null;
  }

  const destCandidates: Array<{ ordinal: number; walk: number }> = [];
  net.stations.forEach((s, i) => {
    const walk = walkTime(s.x, s.y, dx, dy);
    if (walk !== null && walk <= maxWalkMinutes) destCandidates.push({ ordinal: i, walk });
  });
  if (destCandidates.length === 0) return null;

  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  const heap = new MinHeap();
  for (const candidate of originCandidates) {
    const key = makeKey(candidate.ordinal, -1);
    const known = dist.get(key);
    if (known !== undefined && known <= candidate.walk + 1e-9) continue;
    dist.set(key, candidate.walk);
    heap.push(candidate.walk, key);
  }

  while (heap.size > 0) {
    const { dist: cd, key } = heap.pop();
    const known = dist.get(key);
    if (known === undefined || cd > known + 1e-9) continue;
    const sOrd = keyStation(key);
    const lineId = keyLine(key);
    for (const e of adj[sOrd] ?? []) {
      let wait = 0;
      if (lineId !== e.lineId) {
        const line = net.lineById.get(Math.floor(e.lineId / 2));
        if (!line) continue;
        const serviceWait = net.expectedWait(line, pxPerKm, e.service);
        if (!Number.isFinite(serviceWait)) continue;
        wait = serviceWait + (lineId < 0 ? 0 : TRANSFER_PENALTY);
      }
      const nd = cd + wait + e.time;
      const nk = makeKey(e.to, e.lineId);
      const old = dist.get(nk);
      if (old === undefined || nd < old - 1e-9) {
        dist.set(nk, nd);
        prev.set(nk, key);
        heap.push(nd, nk);
      }
    }
  }

  let bestCost = Infinity;
  let bestKey = -1;
  for (const cand of destCandidates) {
    for (const line of net.lines) {
      for (const service of ['local', 'express'] as const) {
        const k = makeKey(cand.ordinal, virtualLineId(line.id, service));
        const d = dist.get(k);
        if (d === undefined) continue;
        const total = d + cand.walk;
        if (total < bestCost) {
          bestCost = total;
          bestKey = k;
        }
      }
    }
  }
  // 起终点距离本身就在步行范围内时，允许纯步行；不能把“都靠近同一个站”
  // 误判成步行，否则会把 10 km 的出行算成走路。
  const direct = walkTime(sx, sy, dx, dy);
  if (direct !== null && direct <= maxWalkMinutes) {
    const total = direct;
    if (total < bestCost) {
      bestCost = total;
      bestKey = makeKey(originCandidates[0]!.ordinal, -1);
    }
  }
  if (bestKey < 0) return null;

  const chain: number[] = [];
  let cur = bestKey;
  let guard = 0;
  for (;;) {
    chain.push(cur);
    const p = prev.get(cur);
    if (p === undefined || guard++ > 512) break;
    cur = p;
  }
  chain.reverse();

  const legs: Leg[] = [];
  for (let i = 1; i < chain.length; i++) {
    const from = net.stations[keyStation(chain[i - 1]!)]!;
    const to = net.stations[keyStation(chain[i]!)]!;
    const virtual = keyLine(chain[i]!);
    if (virtual < 0 || from.id === to.id) continue;
    const lineId = Math.floor(virtual / 2);
    const service = virtual % 2 === 1 ? ('express' as const) : ('local' as const);
    const last = legs[legs.length - 1];
    if (last && last.lineId === lineId && last.service === service) last.to = to.id;
    else legs.push({ lineId, from: from.id, to: to.id, service });
  }
  const originOrdinal = keyStation(chain[0]!);
  const originStation = net.stations[originOrdinal]!;
  const destOrdinal = keyStation(bestKey);
  const walk2 = destCandidates.find((c) => c.ordinal === destOrdinal)?.walk ?? 0;
  return {
    origin: originStation.id,
    dest: net.stations[destOrdinal]!.id,
    legs,
    walk1: dist.get(chain[0]!) ?? 0,
    walk2,
    total: bestCost,
  };
}
