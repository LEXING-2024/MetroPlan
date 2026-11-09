/**
 * 实时热力（REQ-HEAT-001 / 002）：显示**正在外出的人**，而不是静态人口。
 *
 *   当前热力 = 步行途中的人 + 站内候车的人 + 列车上的乘客 + 站点排队溢出
 *
 * 热力每 10 游戏分钟重算一次（render 层负责节流），所以早高峰会沿“家 → 站”
 * 亮起、晚高峰沿“站 → 家”亮起，平峰自然变暗——潮汐来自真实客流，不再靠
 * 静态权重伪造。颜色映射、平滑与动画在渲染层（heatLayer.ts）。
 */
import { TRAIN_CAPACITY, WORLD_H, WORLD_W } from './constants';
import { curvePoint, smoothTravel } from './lineCurve';
import { isLoopLine } from './network';
import type { Simulation } from './simulation';
import { AgentState } from './types';

export const HEAT_GW = 256;
export const HEAT_GH = 144;



export type TidePhase = 'morning' | 'evening' | 'day' | 'night';

export interface TideWeights {
  phase: TidePhase;
  label: string;
}

export interface StationThermal {
  id: number;
  name: string;
  x: number;
  y: number;
  waiting: number;
  capacity: number;
  /** 候车 / 承载力，1 = 刚好满员 */
  ratio: number;
  /** 超出承载力、在站外排队的人数 */
  overflow: number;
  /** 图标着色用的 0..1 载荷 */
  load: number;
  /** 0..100 的满意度估计 */
  satisfaction: number;
}

export interface HeatFrame {
  gw: number;
  gh: number;
  /** 0..1 的归一化热力，行优先 */
  values: Float32Array;
  /** G 通道：站点排队压力，用于渲染“爆红”核心 */
  queue: Float32Array;
  stations: StationThermal[];
  tide: TideWeights;
  peak: number;
  /** 正在外出（步行 / 候车 / 乘车 / 背景方式）的人数 */
  activePeople: number;
  /** 其中列车上的乘客 */
  ridingPeople: number;
  /** 其中非地铁背景方式（步行 / 电动车 / 公交 / 小汽车）的人数 */
  backgroundPeople: number;
  /** 超出承载力的站外排队人数 */
  queuePeople: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 单个站点的承载力状态：图标着色、气泡文案都用它。 */
export function stationThermal(
  station: { id: number; name: string; x: number; y: number; capacity: number },
  waiting: number,
): StationThermal {
  const capacity = Math.max(1, station.capacity);
  const ratio = waiting / capacity;
  const overflow = Math.max(0, waiting - capacity);
  return {
    id: station.id,
    name: station.name,
    capacity,
    x: station.x,
    y: station.y,
    waiting,
    ratio,
    overflow,
    load: clamp01(ratio),
    satisfaction: Math.round(Math.max(0, 100 - Math.max(0, ratio - 0.7) * 120)),
  };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function tideWeights(minuteOfDay: number): TideWeights {
  const m = ((minuteOfDay % 1440) + 1440) % 1440;
  const night = Math.min(1, smoothstep(1260, 1330, m) + (1 - smoothstep(300, 390, m)));
  const morning = smoothstep(390, 420, m) * (1 - smoothstep(540, 600, m));
  const evening = smoothstep(960, 1020, m) * (1 - smoothstep(1140, 1200, m));
  const phase: TidePhase =
    night > 0.6 ? 'night' : morning > 0.45 ? 'morning' : evening > 0.45 ? 'evening' : 'day';
  const label = phase === 'morning' ? '早高峰' : phase === 'evening' ? '晚高峰' : phase === 'night' ? '夜间' : '平峰';
  return { phase, label };
}

function splat(grid: Float32Array, gw: number, gh: number, gx: number, gy: number, weight: number): void {
  if (weight <= 0) return;
  if (gx < -1 || gy < -1 || gx > gw || gy > gh) return;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  if (x0 >= 0 && x0 < gw) {
    if (y0 >= 0 && y0 < gh) grid[y0 * gw + x0] += weight * w00;
    if (y1 >= 0 && y1 < gh) grid[y1 * gw + x0] += weight * w01;
  }
  if (x1 >= 0 && x1 < gw) {
    if (y0 >= 0 && y0 < gh) grid[y0 * gw + x1] += weight * w10;
    if (y1 >= 0 && y1 < gh) grid[y1 * gw + x1] += weight * w11;
  }
}

/** 3×3 高斯小核，让列车 / 站点这类点状热源有面积。 */
function splatSoft(
  grid: Float32Array,
  gw: number,
  gh: number,
  gx: number,
  gy: number,
  weight: number,
  radius: number,
): void {
  const k = [0.075, 0.124, 0.075, 0.124, 0.204, 0.124, 0.075, 0.124, 0.075];
  let i = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      splat(grid, gw, gh, gx + dx * radius, gy + dy * radius, weight * k[i]!);
      i++;
    }
  }
}

function blur(src: Float32Array, gw: number, gh: number, radius: number): Float32Array {
  const kernel = [1, 4, 6, 4, 1];
  const sum = 16;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < gh; y++) {
    const row = y * gw;
    for (let x = 0; x < gw; x++) {
      let acc = 0;
      for (let k = -2; k <= 2; k++) {
        const xx = Math.max(0, Math.min(gw - 1, x + k));
        acc += src[row + xx]! * kernel[k + 2]!;
      }
      tmp[row + x] = acc / sum;
    }
  }
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      let acc = 0;
      for (let k = -2; k <= 2; k++) {
        const yy = Math.max(0, Math.min(gh - 1, y + k));
        acc += tmp[yy * gw + x]! * kernel[k + 2]!;
      }
      out[y * gw + x] = acc / sum;
    }
  }
  if (radius > 1) return blur(out, gw, gh, radius - 1);
  return out;
}

const pathLengthCache = new WeakMap<
  Array<[number, number]>,
  { prefix: Float32Array; total: number }
>();

function pathLengths(path: Array<[number, number]>): { prefix: Float32Array; total: number } {
  const hit = pathLengthCache.get(path);
  if (hit) return hit;
  const prefix = new Float32Array(Math.max(0, path.length - 1));
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1]);
    prefix[i - 1] = total;
  }
  const result = { prefix, total };
  pathLengthCache.set(path, result);
  return result;
}

function pointAlongPath(
  path: Array<[number, number]>,
  fraction: number,
): { x: number; y: number } | null {
  if (path.length < 2) return null;
  const { prefix, total } = pathLengths(path);
  if (total <= 1e-6) return { x: path[0]![0], y: path[0]![1] };
  const target = Math.max(0, Math.min(1, fraction)) * total;
  let lo = 0;
  let hi = prefix.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (prefix[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  const end = prefix[lo]!;
  const prev = lo > 0 ? prefix[lo - 1]! : 0;
  const segment = end - prev;
  const t = segment <= 1e-6 ? 0 : Math.min(1, (target - prev) / segment);
  return {
    x: path[lo]![0] + (path[lo + 1]![0] - path[lo]![0]) * t,
    y: path[lo]![1] + (path[lo + 1]![1] - path[lo]![1]) * t,
  };
}

/** 正在外出的人所在的位置（约）：步行按进度插值，候车在站，乘车按列车位置。 */
export function buildHeatFrame(sim: Simulation, minuteOfDay = sim.timeOfDay()): HeatFrame {
  const gw = HEAT_GW;
  const gh = HEAT_GH;
  const sx = gw / WORLD_W;
  const sy = gh / WORLD_H;
  const tide = tideWeights(minuteOfDay);
  const grid = new Float32Array(gw * gh);
  const queueGrid = new Float32Array(gw * gh);
  const a = sim.agents;
  const walkSpeed = Math.max(1e-3, sim.walkSpeed);
  // 有内置步行图时，每个人的接驳 / 背景轨迹都应该查得到。
  // 查不到时宁可先不画，也不要按两点直线插值——那正是“很多人走直线”的来源。
  const graphBacked = !!sim.walkRouter && !sim.map;

  let activePeople = 0;
  let ridingPeople = 0;
  let backgroundPeople = 0;
  let queuePeople = 0;

  // —— 只有“在路上”的人才计入：步行 / 候车 / 乘车 ——
  for (let i = 0; i < a.count; i++) {
    const state = a.state[i]!;
    let x = NaN;
    let y = NaN;
    let draw = true;
    if (state === AgentState.Waiting) {
      const s = sim.net.stationById.get(a.waitStation[i]!);
      if (!s) continue;
      x = s.x;
      y = s.y;
    } else if (state === AgentState.WalkToStation) {
      const s = sim.net.stationById.get(a.targetStation[i]!);
      if (!s) continue;
      const out = a.tripIsOut[i] === 1;
      const ox = out ? a.homeX[i]! : a.workX[i]!;
      const oy = out ? a.homeY[i]! : a.workY[i]!;
      const dist = Math.hypot(s.x - ox, s.y - oy);
      const total = Math.max(0.05, a.plans[i]?.walk1 ?? dist / walkSpeed);
      const f = clamp01(1 - a.walkLeft[i]! / total);
      const path = sim.walk1Paths[i] ?? null;
      if (!path && graphBacked) {
        // 路径还没算出来 / 算不出来：先不画，避免一条家门口到车站的直线。
        draw = false;
        x = ox;
        y = oy;
      } else {
        const at = (frac: number): { x: number; y: number } =>
          (path ? pointAlongPath(path, frac) : null) ?? {
            x: ox + (s.x - ox) * frac,
            y: oy + (s.y - oy) * frac,
          };
        const here = at(f);
        x = here.x;
        y = here.y;
        // 没有步行图路径时只画当前点，不画一条假直线尾迹。
        if (path) {
          for (const [back, w] of [[0.16, 0.5], [0.32, 0.34], [0.48, 0.2]] as const) {
            const p = at(Math.max(0, f - back));
            splatSoft(grid, gw, gh, p.x * sx, p.y * sy, w, 0.62);
          }
        }
      }
    } else if (state === AgentState.WalkToDest) {
      const destX = a.tripDestX[i]!;
      const destY = a.tripDestY[i]!;
      const st = sim.net.stationById.get(a.targetStation[i]!);
      if (!st) {
        x = destX;
        y = destY;
        if (graphBacked) draw = false;
      } else {
        const dist = Math.hypot(destX - st.x, destY - st.y);
        const total = Math.max(0.05, a.plans[i]?.walk2 ?? dist / walkSpeed);
        const f = clamp01(1 - a.walkLeft[i]! / total);
        const path = sim.walk2Paths[i] ?? null;
        if (!path && graphBacked) {
          draw = false;
          x = st.x;
          y = st.y;
        } else {
          const at = (frac: number): { x: number; y: number } =>
            (path ? pointAlongPath(path, frac) : null) ?? {
              x: st.x + (destX - st.x) * frac,
              y: st.y + (destY - st.y) * frac,
            };
          const here = at(f);
          x = here.x;
          y = here.y;
          if (path) {
            for (const [back, w] of [[0.16, 0.5], [0.32, 0.34], [0.48, 0.2]] as const) {
              const p = at(Math.max(0, f - back));
              splatSoft(grid, gw, gh, p.x * sx, p.y * sy, w, 0.62);
            }
          }
        }
      }
    } else if (state === AgentState.InBackground) {
      const fx = a.bgFromX[i]!;
      const fy = a.bgFromY[i]!;
      const tx = a.tripDestX[i]!;
      const ty = a.tripDestY[i]!;
      const total = Math.max(0.05, a.bgTotal[i]! || 0.05);
      const f = clamp01(1 - a.walkLeft[i]! / total);
      const path = sim.backgroundPaths[i] ?? null;
      backgroundPeople++;
      if (path) {
        const at = (frac: number): { x: number; y: number } => {
          const p = pointAlongPath(path, frac);
          return p ?? { x: fx + (tx - fx) * frac, y: fy + (ty - fy) * frac };
        };
        const here = at(f);
        x = here.x;
        y = here.y;
        // 背景方式也画一段尾迹；步行/电动车更亮，公交/汽车稍弱。
        const mode = a.bgMode[i] ?? 0;
        const weight = mode <= 1 ? 1 : 0.8;
        for (const [back, w] of [[0.16, 0.5], [0.32, 0.34], [0.48, 0.2]] as const) {
          const p = at(Math.max(0, f - back));
          splatSoft(grid, gw, gh, p.x * sx, p.y * sy, w * weight, 0.58);
        }
      } else if (graphBacked) {
        // 机动车路径还在排队时不画直线；热力宁可少一个人，也不要多一条假路。
        draw = false;
        x = fx;
        y = fy;
      } else {
        // 没有步行图（M2 / 自定义地图）只能按时间线性插值。
        x = fx + (tx - fx) * f;
        y = fy + (ty - fy) * f;
      }
    } else {
      continue; // 在家、在岗、乘车（乘车按列车位置统计）都不在这里计
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    activePeople++;
    if (draw) splatSoft(grid, gw, gh, x * sx, y * sy, 1, 0.55);
  }

  // —— 列车上的乘客 + 沿线拥堵 ——
  for (const train of sim.net.trains) {
    const line = sim.net.lineById.get(train.lineId);
    if (!line || line.stationIds.length < 2) continue;
    let nextIdx = train.index + train.dir;
    if (nextIdx < 0 || nextIdx >= line.stationIds.length) nextIdx = train.index - train.dir;
    const pa = sim.net.stationById.get(line.stationIds[train.index]!);
    const pb = sim.net.stationById.get(line.stationIds[nextIdx]!);
    if (!pa || !pb) continue;
    const loop = isLoopLine(line);
    const forward = loop || train.dir > 0;
    const segIndex = forward ? train.index : nextIdx;
    const segFrom = forward ? pa : pb;
    const segTo = forward ? pb : pa;
    const travelT = forward ? train.prog : 1 - train.prog;
    const t = train.phase === 1 ? smoothTravel(travelT) : forward ? 0 : 1;
    const pos = curvePoint(segFrom, segTo, segIndex, t, line.id);
    const x = pos.x;
    const y = pos.y;
    const riders = train.riders.length;
    if (riders > 0) {
      ridingPeople += riders;
      splatSoft(grid, gw, gh, x * sx, y * sy, riders * 2.4, 0.5);
    }
    const load = Math.min(1.2, riders / TRAIN_CAPACITY);
    if (load > 0.45) {
      for (let i = 0; i < line.stationIds.length - 1; i++) {
        const s1 = sim.net.stationById.get(line.stationIds[i]!);
        const s2 = sim.net.stationById.get(line.stationIds[i + 1]!);
        if (!s1 || !s2) continue;
        for (const tt of [0.2, 0.5, 0.8]) {
          const p = curvePoint(s1, s2, i, tt, line.id);
          splat(grid, gw, gh, p.x * sx, p.y * sy, load * 2.4);
        }
      }
    }
  }

  // —— 站点排队溢出（额外强调，G 通道给 shader 做深红核心） ——
  const stationThermalList: StationThermal[] = [];
  for (const s of sim.net.stations) {
    if (s.lines.length === 0) continue;
    const thermal = stationThermal(s, sim.waitingAt(s.id));
    queuePeople += thermal.overflow;
    if (thermal.overflow > 0) {
      splatSoft(grid, gw, gh, s.x * sx, s.y * sy, thermal.overflow * 1.6, 0.8);
    }
    splatSoft(queueGrid, gw, gh, s.x * sx, s.y * sy, Math.min(1, thermal.ratio / 1.5), 1.1);
    stationThermalList.push(thermal);
  }

  // 纯色图每像素覆盖的实际范围更大，多模糊一遍。
  const blurPasses = sim.pxPerKm < 30 ? 2 : 1;
  const blurred = blur(grid, gw, gh, blurPasses);
  const blurredQueue = blur(queueGrid, gw, gh, 1);
  let peak = 0;
  for (let i = 0; i < blurred.length; i++) {
    if (blurred[i]! > peak) peak = blurred[i]!;
  }
  // Log compression: a 10-person cell must remain visible even when the
  // peak corridor carries 1,000+. Linear/normalized-by-peak made small
  // villages disappear; this keeps both ends readable.
  const logPeak = Math.log1p(Math.max(1, peak));
  const values = new Float32Array(blurred.length);
  for (let i = 0; i < blurred.length; i++) {
    const v = blurred[i]!;
    // 只丢掉数值尘埃。阈值不能太高：外围村落里一个步行者只占
    // 一个 256×144 格子，模糊后可能只有 0.1–0.2；按 0.18 截断会把
    // 整个鼎湖 / 高要的稀疏人流直接抹成空白。
    if (v < 0.1) {
      values[i] = 0;
      continue;
    }
    values[i] = Math.pow(Math.log1p(v) / logPeak, 0.7);
  }
  const queue = new Float32Array(blurredQueue.length);
  for (let i = 0; i < blurredQueue.length; i++) {
    queue[i] = clamp01(blurredQueue[i]!);
  }

  return {
    gw,
    gh,
    values,
    queue,
    stations: stationThermalList,
    tide,
    peak,
    activePeople,
    ridingPeople,
    backgroundPeople,
    queuePeople,
  };
}


