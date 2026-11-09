import type { AgentFields, MapPoi } from '../types';
import { poiDailyMid } from '../mapData';
import { mulberry32 } from '../population';
import {
  GROUP_COMMUTER,
  GROUP_FLEXIBLE,
  GROUP_LEISURE,
  GROUP_MEDICAL,
  GROUP_REVERSE,
  GROUP_STUDENT,
} from '../constants';
import { distanceKm, modeForVehicle, pickWeighted, travelMinutes } from './choice';
import type { BackgroundMode } from './types';

export type ChainPurpose =
  | 'work'
  | 'home'
  | 'school'
  | 'shopping'
  | 'leisure'
  | 'medical'
  | 'errand';

export interface AgentActivityTrip {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  purpose: ChainPurpose;
  plannedDepart: number;
  distanceKm: number;
  mode: BackgroundMode;
  /** 该 agent 的平均速度（km/h）；旧 M1 链可为空，回退固定速度。 */
  speedKmh?: number;
  toHome: boolean;
}

type TaskPurpose = 'shopping' | 'leisure' | 'medical' | 'errand' | 'school';

const TASK_TYPES: Record<TaskPurpose, MapPoi['type'][]> = {
  shopping: ['mall'],
  leisure: ['scenic', 'park', 'stadium'],
  medical: ['hospital'],
  // “办事”没有单独的 OSM 类型，落在商场 / 公园这类日常目的地。
  errand: ['mall', 'park'],
  school: ['school'],
};

/**
 * 任务密度按群体分档。不是所有通勤者每天都有午间/下班任务：
 * 大多数人仍是两点一线，少部分人才会顺路办事、购物、接孩子。
 */
const LUNCH_PROB = [0.26, 0.12, 0.2, 0, 0, 0, 0] as const;
const AFTER_WORK_PROB = [0.5, 0.25, 0.58, 0.12, 0.4, 0.22, 0.36] as const;
const SECOND_STOP_PROB = [0.15, 0.06, 0.2, 0.02, 0.1, 0.03, 0.08] as const;

/**
 * 大多数人是有固定 routine 的：同一批通勤者连续几天在同一站下车、
 * 去同一家超市、同一时间回家。只有少数“不规律者”（弹性工作、
 * 灵活出行、休闲族）每天会换任务。这里按群体给出每天重排的概率。
 */
const IRREGULAR_PROB = [0.1, 0.14, 0.35, 0.15, 0.3, 0.2, 0.18] as const;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function jitter(rng: () => number, amount: number): number {
  return Math.round((rng() - 0.5) * 2 * amount);
}

function isPoiOpen(poi: MapPoi, minute: number): boolean {
  const open = poi.openMin;
  const close = poi.closeMin;
  if (close <= open) return minute >= open || minute <= close - 10;
  return minute >= open + 10 && minute <= close - 10;
}

/**
 * 从 POI 里挑一个任务目的地。距离衰减 + 吸引力，和人口生成里的
 * “目的地自选”保持同一套直觉：越近、越大、越容易去。
 */
function pickTaskPoi(
  pois: MapPoi[],
  purpose: TaskPurpose,
  fromX: number,
  fromY: number,
  minute: number,
  pxPerKm: number,
  rng: () => number,
  maxKm: number,
): MapPoi | null {
  const types = TASK_TYPES[purpose];
  const picks: MapPoi[] = [];
  const weights: number[] = [];
  for (const poi of pois) {
    if (!types.includes(poi.type)) continue;
    if (!isPoiOpen(poi, minute)) continue;
    const km = Math.hypot(poi.x - fromX, poi.y - fromY) / Math.max(1, pxPerKm);
    if (km < 0.35 || km > maxKm) continue;
    const alpha =
      purpose === 'medical' ? 2.2 : purpose === 'school' ? 1.8 : purpose === 'shopping' ? 1.4 : 1.6;
    picks.push(poi);
    // 0.35 km 以下按 0.35 计，避免家门口的 POI 权重爆掉。
    weights.push((poiDailyMid(poi) * (0.7 + rng() * 0.6)) / Math.pow(Math.max(0.35, km), alpha));
  }
  return pickWeighted(picks, weights, rng);
}

/** 先按目标类型找；找不到就退到购物 / 办事 / 休闲，避免任务全被删掉。 */
function pickTask(
  pois: MapPoi[],
  purpose: TaskPurpose,
  fromX: number,
  fromY: number,
  minute: number,
  pxPerKm: number,
  rng: () => number,
  maxKm: number,
): { poi: MapPoi; purpose: TaskPurpose } | null {
  const first = pickTaskPoi(pois, purpose, fromX, fromY, minute, pxPerKm, rng, maxKm);
  if (first) return { poi: first, purpose };
  for (const fallback of ['shopping', 'errand', 'leisure'] as const) {
    if (fallback === purpose) continue;
    const poi = pickTaskPoi(pois, fallback, fromX, fromY, minute, pxPerKm, rng, maxKm);
    if (poi) return { poi, purpose: fallback };
  }
  return null;
}

function pickLunchPurpose(rng: () => number): TaskPurpose {
  const r = rng();
  return r < 0.55 ? 'shopping' : r < 0.8 ? 'errand' : 'medical';
}

function pickAfterWorkPurpose(group: number, minute: number, rng: () => number): TaskPurpose {
  if (group === GROUP_LEISURE) {
    const r = rng();
    return r < 0.55 ? 'leisure' : r < 0.8 ? 'shopping' : 'errand';
  }
  if (group === GROUP_STUDENT) return rng() < 0.55 ? 'shopping' : 'leisure';
  if (group === GROUP_MEDICAL) return rng() < 0.5 ? 'shopping' : 'errand';
  const r = rng();
  if (minute <= 1000 && r < 0.1) return 'school';
  if (r < 0.4) return 'shopping';
  if (r < 0.65) return 'errand';
  if (r < 0.9) return 'leisure';
  return 'medical';
}

function addTrip(
  list: AgentActivityTrip[],
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  purpose: ChainPurpose,
  depart: number,
  pxPerKm: number,
  vehicle: number,
  speedKmh: number,
  _rng: () => number,
  toHome: boolean,
): number {
  const km = distanceKm({ x: fromX, y: fromY }, { x: toX, y: toY }, pxPerKm);
  const mode = modeForVehicle(vehicle, km);
  list.push({
    fromX,
    fromY,
    toX,
    toY,
    purpose,
    plannedDepart: Math.max(0, Math.min(1438, Math.round(depart))),
    distanceKm: km,
    mode,
    speedKmh,
    toHome,
  });
  return travelMinutes(mode, km, speedKmh);
}

/**
 * Build a small activity chain for each existing agent.
 *
 *   home → work → (lunch errand) → (school pickup / shopping / leisure)
 *        → (second stop) → home
 *
 * The base O/D still comes from the population field; the chain adds
 * *probabilistic* tasks rather than forcing every agent into the same
 * two-trip commute. The result is intentionally messy: most people go
 * straight home, a minority stop once, fewer stop twice, and a few leave
 * work early to pick up children.
 */
export interface ActivityChainOptions {
  /** 纯通勤：只生成家 → 工作 → 家，不插入午间 / 下班任务。 */
  pureCommuter?: boolean;
  /**
   * 当日 seed。只影响“不规律者”的任务结构；规律者仍沿用 seed，
   * 保证同一批人连续几天走同一条回家路线。
   */
  daySeed?: number;
}

export function buildAgentActivityChains(
  agents: AgentFields,
  pois: MapPoi[],
  pxPerKm: number,
  seed = 20260101,
  options: ActivityChainOptions = {},
): AgentActivityTrip[][] {
  const pureCommuter = options.pureCommuter === true;
  const daySeed = options.daySeed ?? seed;
  const chains: AgentActivityTrip[][] = [];
  for (let i = 0; i < agents.count; i++) {
    const homeX = agents.homeX[i]!;
    const homeY = agents.homeY[i]!;
    const workX = agents.workX[i]!;
    const workY = agents.workY[i]!;
    const group = agents.group[i]!;
    const unemployedFlexible = group === GROUP_FLEXIBLE && agents.employed?.[i] === 0;
    const vehicle = agents.vehicle[i] ?? 0;
    const speedKmh =
      agents.speedKmh[i] || (vehicle === 2 ? 30 : vehicle === 1 ? 15 : 4.5);
    const hasReturn = agents.hasReturn[i] === 1;
    // 规律者用固定 seed（任务结构每天一致）；不规律者用 daySeed。
    // 用稳定的 per-agent 哈希决定属于哪一类，不随日期变化。
    const h = Math.imul(i + 1, 0x85ebca6b) >>> 0;
    const irregular = h / 4294967296 < (IRREGULAR_PROB[group] ?? 0.15);
    const rng = mulberry32((irregular ? daySeed : seed) ^ Math.imul(i + 1, 0x9e3779b1));
    // 时间抖动每天都有，但不改变路线 / 任务结构。
    const timingRng = mulberry32(daySeed ^ Math.imul(i + 1, 0x27d4eb2f));
    const out = clamp(Math.round(agents.outMin[i]! + jitter(timingRng, 3)), 0, 1438);
    const back = clamp(Math.round(agents.backMin[i]! + jitter(timingRng, 4)), out + 30, 1438);
    const list: AgentActivityTrip[] = [];

    const outTravel = addTrip(
      list,
      homeX,
      homeY,
      workX,
      workY,
      unemployedFlexible ? 'errand' : 'work',
      out,
      pxPerKm,
      vehicle,
      speedKmh,
      rng,
      false,
    );
    const workArrive = out + outTravel;

    // 家和工作地几乎重合：没有通勤可做，也没有必要硬塞任务。
    if (Math.hypot(workX - homeX, workY - homeY) < 0.5) {
      chains.push(list);
      continue;
    }

    if (pureCommuter) {
      if (hasReturn) {
        addTrip(list, workX, workY, homeX, homeY, 'home', back, pxPerKm, vehicle, speedKmh, rng, true);
      }
      chains.push(list);
      continue;
    }

    // 在工作地至少待一段时间；否则去程晚点会变成“刚到就回家”。
    const minDwell =
      group === GROUP_STUDENT
        ? 300 + rng() * 60
        : group >= GROUP_MEDICAL
          ? 45 + rng() * 90
          : 240 + rng() * 120;
    let leaveWork = clamp(Math.max(back, workArrive + minDwell) + jitter(timingRng, 5), 0, 1438);
    let lastWorkReturn = workArrive;

    // ——— 午间任务：工作 → 附近办事 / 购物 / 医院 → 工作 ———
    if (
      group <= GROUP_FLEXIBLE &&
      rng() < (LUNCH_PROB[group] ?? 0) &&
      leaveWork > 720
    ) {
      const lunchAt = clamp(Math.round(workArrive + 180 + rng() * 90), 690, 810);
      const purpose = pickLunchPurpose(rng);
      const pick = pickTask(pois, purpose, workX, workY, lunchAt, pxPerKm, rng, 3.5);
      // 晚班 / 很晚到岗的人不再插午间任务，否则会排到去程之前。
      if (pick && lunchAt > workArrive + 60 && lunchAt + 80 < leaveWork - 20) {
        const outKm = distanceKm({ x: workX, y: workY }, pick.poi, pxPerKm);
        const mode = modeForVehicle(vehicle, outKm);
        const outMin = travelMinutes(mode, outKm, speedKmh);
        const backKm = distanceKm(pick.poi, { x: workX, y: workY }, pxPerKm);
        const backMin = travelMinutes(mode, backKm, speedKmh);
        const dwell = 25 + rng() * 35;
        const returnAt = lunchAt + outMin + dwell;
        if (returnAt + backMin + 20 < leaveWork) {
          addTrip(list, workX, workY, pick.poi.x, pick.poi.y, pick.purpose, lunchAt, pxPerKm, vehicle, speedKmh, rng, false);
          addTrip(list, pick.poi.x, pick.poi.y, workX, workY, 'work', returnAt, pxPerKm, vehicle, speedKmh, rng, false);
          lastWorkReturn = returnAt + backMin;
          leaveWork = Math.max(leaveWork, lastWorkReturn + 15);
        }
      }
    }

    // ——— 接孩子：少数家长提前离开工作地，接到孩子后直接回家 ———
    if (
      hasReturn &&
      (group === GROUP_COMMUTER || group === GROUP_REVERSE) &&
      rng() < 0.07 &&
      workArrive + 180 < 1000
    ) {
      const pickup = clamp(Math.round(945 + rng() * 55), 945, 1000);
      const pick = pickup > Math.max(workArrive + 180, lastWorkReturn + 15)
        ? pickTaskPoi(pois, 'school', workX, workY, pickup, pxPerKm, rng, 4)
        : null;
      if (pick) {
        const t1 = addTrip(list, workX, workY, pick.x, pick.y, 'school', pickup, pxPerKm, vehicle, speedKmh, rng, false);
        const homeAt = pickup + t1 + 10 + rng() * 15;
        addTrip(list, pick.x, pick.y, homeX, homeY, 'home', homeAt, pxPerKm, vehicle, speedKmh, rng, true);
        chains.push(list);
        continue;
      }
    }

    // ——— 下班后：购物 / 办事 / 休闲 / 就医，少数人还会去第二个点 ———
    let currentX = workX;
    let currentY = workY;
    let t = leaveWork;
    let stopCount = 0;
    if (hasReturn && rng() < (AFTER_WORK_PROB[group] ?? 0)) {
      stopCount = rng() < (SECOND_STOP_PROB[group] ?? 0) ? 2 : 1;
    }
    for (let s = 0; s < stopCount; s++) {
      if (t > 1330) break;
      const purpose = pickAfterWorkPurpose(group, t, rng);
      const pick = pickTask(pois, purpose, currentX, currentY, t, pxPerKm, rng, group === GROUP_LEISURE ? 8 : 6);
      if (!pick) break;
      const travel = addTrip(
        list,
        currentX,
        currentY,
        pick.poi.x,
        pick.poi.y,
        pick.purpose,
        t,
        pxPerKm,
        vehicle,
        speedKmh,
        rng,
        false,
      );
      if (t + travel > 1360) {
        list.pop();
        break;
      }
      t += travel;
      t += 20 + rng() * 55;
      currentX = pick.poi.x;
      currentY = pick.poi.y;
    }

    if (hasReturn) {
      addTrip(list, currentX, currentY, homeX, homeY, 'home', t, pxPerKm, vehicle, speedKmh, rng, true);
    }
    chains.push(list);
  }
  return chains;
}
