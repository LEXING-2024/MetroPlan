import {
  GROUP_COMMUTER,
  GROUP_FEEDER,
  GROUP_FLEXIBLE,
  GROUP_LEISURE,
  GROUP_MEDICAL,
  GROUP_REVERSE,
  GROUP_STUDENT,
  MAX_AGENTS,
} from './constants';
import { POI_META, poiAgentWindow, poiDailyMid, poiZoneId } from './mapData';
import { MAP_SEED } from './zones';
import { terrainField } from '../maps/terrain';
import type {
  AgentFields,
  MapPoi,
  PopulationCell,
  PopulationDot,
  PopulationField,
  Zone,
  ZoneOdPair,
} from './types';

/** 每个住宅点阵代表的常住人口；agent 是抽样后的通勤者。 */
export const PEOPLE_PER_HOME_DOT = 100;
/** 需求口径：mixed = 通勤 + POI 专项；commuter = 纯通勤。 */
export type DemandMode = 'commuter' | 'mixed';
/** 每个就业点阵代表的岗位数。 */
export const JOBS_PER_EMPLOYMENT_DOT = 100;
/** POI 日吸引量中真正转化为“以该 POI 为目的地的轨道出行”的比例。 */
export const POI_AGENT_RATE = 0.04;
/**
 * 学校 POI 的日吸引量里，真正每天走读的比例。
 * 住校生工作日不出校门，只有周末 / 假期才回家，不能按“全校学生每天通勤”算。
 */
export const STUDENT_DAY_DEMAND_SCALE = 0.45;
/**
 * 减少学生专项后，把释放出的 agent 名额转成社会人士（通勤 / 反向 / 灵活）。
 * 内置图 5,692 个住宅 cell × 6.5 ≈ 37,000 个基础成年人。
 */
export const MIXED_BASE_MULTIPLIER = 6.5;

export interface PopulationEstimate {
  residents: number;
  jobs: number;
  /** 住宅 cell 数；不等同于实际抽样到的成年 agent 数。 */
  commuters: number;
  /** 实际基础成年人抽样数（混合模式会把学生名额转给社会人士）。 */
  baseAgents: number;
  poiVisitors: number;
  agents: number;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickByScore<T>(items: T[], scores: number[], rng: () => number): T {
  let total = 0;
  for (const s of scores) total += s;
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= scores[i] ?? 0;
    if (r <= 0) return items[i] as T;
  }
  return items[items.length - 1] as T;
}

/**
 * 引力模型：岗位越多、距离越近的目的地越容易被选中。
 * decay 以世界像素表示，内置图约 11–14 km，避免所有人随机跨半座城。
 */
function gravity(from: Zone, candidates: Zone[], rng: () => number, decay: number): Zone {
  const pool = candidates.length > 1 ? candidates.filter((c) => c.id !== from.id) : candidates;
  const list = pool.length > 0 ? pool : candidates;
  const scores = list.map((c) => {
    const d = Math.hypot(c.x - from.x, c.y - from.y);
    return c.weight * Math.exp(-d / Math.max(80, decay)) * (0.75 + rng() * 0.5);
  });
  return pickByScore(list, scores, rng);
}

function pickCell(cells: PopulationCell[], rng: () => number): PopulationCell {
  return cells[Math.min(cells.length - 1, Math.floor(rng() * cells.length))] as PopulationCell;
}

/**
 * 住宅抽样必须按单元人口加权，而不是按点阵个数平均抽。
 *
 * OSM 分析得到的住宅单元疏密差异很大：端州老城一个单元平均一百多人，
 * 高要 / 鼎湖的村落单元可能一个代表上千人。若每个单元只抽 1 人，端州会
 * 占掉八成以上的 agent，外围区在热力图上就几乎消失。
 */
function makeHomeSampler(cells: PopulationCell[]): (rng: () => number) => PopulationCell {
  const cumulative = new Float64Array(cells.length);
  let total = 0;
  for (let i = 0; i < cells.length; i++) {
    const p = cells[i]!.population ?? PEOPLE_PER_HOME_DOT;
    total += Math.max(1, p);
    cumulative[i] = total;
  }
  return (rng: () => number): PopulationCell => {
    if (cells.length === 0) throw new Error('empty residential cells');
    const r = rng() * total;
    let lo = 0;
    let hi = cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (cumulative[mid]! <= r) lo = mid + 1;
      else hi = mid;
    }
    return cells[lo] as PopulationCell;
  };
}

function zoneById(zones: Zone[], id: number): Zone | undefined {
  return zones.find((z) => z.id === id);
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Box–Muller 正态抽样：用于形成有早晚尾巴的出发 / 下班时间，而不是整齐的矩形窗口。 */
function normal(rng: () => number, mean: number, sigma: number): number {
  let u = 0;
  let v = 0;
  while (u <= 1e-9) u = rng();
  while (v <= 1e-9) v = rng();
  return mean + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * 上班开始时间：以 8:00 为主峰，同时保留 7:20 前的早班、8:40 后的弹性上班和少量 6:30 早班。
 * 不是所有人都在 7:00–9:00 之间“整点出门”。
 */
function sampleWorkStart(rng: () => number): number {
  const r = rng();
  if (r < 0.6) return normal(rng, 482, 20);
  if (r < 0.8) return normal(rng, 445, 24);
  if (r < 0.91) return normal(rng, 520, 26);
  if (r < 0.96) return normal(rng, 405, 20);
  // 早班：环卫、市场、医护、跨城通勤等，5 点多就要出门赶车。
  return normal(rng, 350, 18);
}

/** 下班时间：17:30 主峰 + 18:40 加班峰 + 16:00 早班 + 20:30 晚班。 */
function sampleWorkEnd(rng: () => number): number {
  const r = rng();
  if (r < 0.68) return normal(rng, 1055, 32);
  if (r < 0.86) return normal(rng, 1120, 38);
  if (r < 0.95) return normal(rng, 965, 24);
  return normal(rng, 1230, 45);
}

/** 用直线距离和城区平均速度估算门到门时间；真实线网可能更慢，但足够决定出发时刻。 */
function commuteMinutes(
  home: PopulationCell,
  work: PopulationCell,
  pxPerKm: number,
  rng: () => number,
): number {
  const km = Math.hypot(work.x - home.x, work.y - home.y) / Math.max(1, pxPerKm);
  const speedKmh = 17 + rng() * 9;
  const ride = (km / speedKmh) * 60;
  const access = 7 + rng() * 9;
  return Math.max(8, ride + access);
}

/** 内置地形图的人口场。地图数据在 src/maps/ 下分离维护。 */
export function builtinPopulationField(): PopulationField {
  return terrainField();
}

/**
 * 地图人口估算：由住宅 / 就业点阵推导，而不是写死 4000。
 * 地图越大、住宅点阵越多，抽样通勤者越多，人流自然随城市规模变化。
 */
export function estimatePopulation(
  field: PopulationField,
  demandMode: DemandMode = 'mixed',
): PopulationEstimate {
  const residents = field.residential.reduce(
    (sum, cell) => sum + (cell.population ?? PEOPLE_PER_HOME_DOT),
    0,
  );
  const jobs = field.employment.length * JOBS_PER_EMPLOYMENT_DOT;
  let poiDemand = 0;
  for (const poi of field.pois) {
    const group = POI_META[poi.type]?.group;
    if (group === null || group === undefined) continue;
    // 只有走读生每天产生学校出行；住校生放到周末 / 假期。
    poiDemand += poiDailyMid(poi) * (group === GROUP_STUDENT ? STUDENT_DAY_DEMAND_SCALE : 1);
  }
  const commuters = field.residential.length;
  const baseAgents =
    demandMode === 'mixed'
      ? Math.round(commuters * MIXED_BASE_MULTIPLIER)
      : commuters;
  const poiVisitors = demandMode === 'mixed' ? Math.round(poiDemand * POI_AGENT_RATE) : 0;
  return {
    residents,
    jobs,
    commuters,
    baseAgents,
    poiVisitors,
    agents: Math.min(MAX_AGENTS, baseAgents + poiVisitors),
  };
}

export interface AgentInit {
  agents: AgentFields;
  odPairs: ZoneOdPair[];
}

interface ExtraSpec {
  poi: MapPoi;
  group: number;
  /** 抽样得到的日吸引量 */
  daily: number;
}

/**
 * 目的地选择的距离衰减指数，按 POI 等级取规格区间中值：
 * 6 级 1.0–1.2、5 级 1.3–1.5、4 级 1.5–1.8、3 级 1.8–2.0、2 级 2.0、1 级 2.2。
 * 等级越高越值得跨城，邻里级几乎只在附近选。
 */
const POI_DISTANCE_ALPHA = [2.2, 2.2, 2.0, 1.9, 1.5, 1.1] as const;

export function poiDistanceAlpha(level: number): number {
  const idx = Math.min(6, Math.max(1, Math.round(level))) - 1;
  return POI_DISTANCE_ALPHA[idx]!;
}

/**
 * 目的地不是被指定的，而是自己选的：
 * 在自己这一组的 POI 里，按「日吸引量 / 距离^α × 个体随机扰动」抽样。
 * 距离用家到 POI 的直线公里数，0.35 km 以下按 0.35 km 计，避免家门口的 POI 权重爆掉。
 */
function choosePoiDestination(
  specs: ExtraSpec[],
  home: PopulationCell,
  pxPerKm: number,
  rng: () => number,
): ExtraSpec {
  const weights = specs.map((spec) => {
    const km = Math.hypot(spec.poi.x - home.x, spec.poi.y - home.y) / Math.max(1, pxPerKm);
    const d = Math.max(0.35, km);
    const attraction = spec.daily * (0.75 + rng() * 0.5);
    return attraction / Math.pow(d, poiDistanceAlpha(spec.poi.level));
  });
  return pickByScore(specs, weights, rng);
}

/**
 * 学生走读比例：城区学校周边住宅密、走读多；鼎湖 / 高要 / 四会等外围
 * 学校住宿比例高。这里用粗略区位分档，后续可以接学校自身的宿舍数据。
 */
function studentDayShare(x: number, y: number): number {
  if (x >= 600 && x <= 1050 && y >= 940 && y <= 1250) return 0.78; // 端州
  if (x >= 1080 && x <= 1650 && y >= 220 && y <= 760) return 0.32; // 鼎湖
  if (x >= 480 && x <= 1060 && y >= 1220) return 0.42; // 高要
  if (x >= 1750 && x <= 2450 && y <= 620) return 0.34; // 四会
  return 0.5;
}

/** 多少比例的正向通勤者在 POI（商场 / 医院 / 学校 / 景区 / 车站）上班。 */
const POI_WORKER_SHARE = 0.18;

/** 不同 POI 类型的岗位权重；不是每个 POI 都只是“目的地”。 */
const POI_JOB_BASE: Partial<Record<MapPoi['type'], number>> = {
  hospital: 28,
  school: 18,
  mall: 22,
  scenic: 14,
  park: 6,
  stadium: 8,
  station: 18,
  ferry: 6,
  airport: 18,
  industry: 24,
};

/** POI 上班族的班次相对普通通勤的偏移（分钟）。 */
function poiWorkShift(type: MapPoi['type']): { start: number; end: number } {
  switch (type) {
    case 'mall':
      return { start: 90, end: 150 };
    case 'hospital':
      return { start: 10, end: 15 };
    case 'school':
      return { start: -20, end: -10 };
    case 'scenic':
    case 'park':
      return { start: 30, end: 30 };
    case 'stadium':
      return { start: 45, end: 60 };
    case 'station':
    case 'ferry':
      return { start: -60, end: 45 };
    case 'airport':
      return { start: -30, end: 60 };
    default:
      return { start: 0, end: 0 };
  }
}

function poiJobWeight(poi: MapPoi): number {
  const base = POI_JOB_BASE[poi.type] ?? 0;
  return base * (0.6 + poi.level * 0.15) * poi.scale;
}

function pickPoiJob(
  pois: MapPoi[],
  home: PopulationCell,
  pxPerKm: number,
  rng: () => number,
): MapPoi | null {
  const picks: MapPoi[] = [];
  const weights: number[] = [];
  for (const poi of pois) {
    const base = POI_JOB_BASE[poi.type];
    if (!base) continue;
    const km = Math.hypot(poi.x - home.x, poi.y - home.y) / Math.max(1, pxPerKm);
    if (km > 30) continue;
    const w = poiJobWeight(poi) * (0.75 + rng() * 0.5) / Math.pow(Math.max(0.5, km), 1.3);
    picks.push(poi);
    weights.push(w);
  }
  return pickByScore(picks, weights, rng);
}

/** 在行为群体下抽一个画像；画像只细分年龄 / 职业，不改变基础行为。 */
function pickProfile(group: number, rng: () => number): number {
  switch (group) {
    case GROUP_COMMUTER: {
      const r = rng();
      return r < 0.55 ? 0 : r < 0.85 ? 1 : 2;
    }
    case GROUP_REVERSE:
      return 3;
    case GROUP_FLEXIBLE: {
      const r = rng();
      return r < 0.4 ? 4 : r < 0.7 ? 5 : 6;
    }
    case GROUP_MEDICAL:
      return rng() < 0.6 ? 7 : 8;
    case GROUP_LEISURE:
      return rng() < 0.78 ? 9 : 10;
    case GROUP_FEEDER:
      return 11;
    case GROUP_STUDENT:
      return rng() < 0.45 ? 13 : 14;
    default:
      return 0;
  }
}

/**
 * 三类基础群体 + 由 POI 产生的四类专项出行；commuter 模式只保留前两类通勤。
 * 住宅起点按 cell.population 加权：OSM 住宅单元疏密差异很大，按 cell 个数
 * 平均抽会让端州独占八成 agent，鼎湖 / 高要 / 四会几乎没人。
 */
export function createAgents(
  field: PopulationField,
  baseCount?: number,
  seed = MAP_SEED,
  demandMode: DemandMode = 'mixed',
  maxAgents = MAX_AGENTS,
): AgentInit {
  const rng = mulberry32(seed);
  const zones = field.zones;
  const residential = field.residential.length > 0 ? field.residential : field.employment;
  const employment = field.employment.length > 0 ? field.employment : field.residential;
  if (residential.length === 0 || employment.length === 0) {
    const empty = createEmptyAgents(0);
    return { agents: empty, odPairs: [] };
  }

  const commuterOnly = demandMode === 'commuter';
  const estimate = estimatePopulation(field, demandMode);
  const limit = clamp(Math.round(maxAgents), 0, MAX_AGENTS);
  const requestedBase = baseCount ?? estimate.baseAgents;
  let base = clamp(Math.round(requestedBase), 0, limit);
  const poiZoneIds = new Set(field.poiZones.map((z) => z.id));
  const residentialZones = zones.filter((z) => z.kind === 'residential');
  const employmentZones = zones.filter((z) => z.kind === 'employment');
  const mixedZones = zones.filter((z) => z.kind === 'mixed' && !poiZoneIds.has(z.id));
  const workCandidates = employmentZones.length > 0 ? employmentZones : mixedZones;
  const homeCandidates = residentialZones.length > 0 ? residentialZones : mixedZones;

  const employmentByZone = new Map<number, PopulationCell[]>();
  for (const c of employment) {
    const list = employmentByZone.get(c.zone);
    if (list) list.push(c);
    else employmentByZone.set(c.zone, [c]);
  }
  const mixedByZone = new Map<number, PopulationCell[]>();
  for (const c of field.mixed) {
    const list = mixedByZone.get(c.zone);
    if (list) list.push(c);
    else mixedByZone.set(c.zone, [c]);
  }
  // 住宅按单元人口加权抽样；就业点阵仍按“每格 100 岗位”均匀抽样。
  const zoneMap = new Map(zones.map((z) => [z.id, z]));
  const pickHomeRaw = makeHomeSampler(residential);
  // 一个人口 6.8 万的住宅 cell 被压成一个点，会让几百个 agent 共用同一坐标，
  // 热力图上出现与周围不成比例的红点。按单元人口给住宅点加合理散布。
  const jitterHome = (cell: PopulationCell, draw: () => number): PopulationCell => {
    const pop = cell.population ?? PEOPLE_PER_HOME_DOT;
    const zone = zoneMap.get(cell.zone);
    const radius = Math.min(
      120,
      Math.max(6, Math.sqrt(Math.max(1, pop) / PEOPLE_PER_HOME_DOT) * 12, (zone?.r ?? 0) * 0.6),
    );
    if (radius <= 6) return cell;
    const a = draw() * Math.PI * 2;
    const r = Math.sqrt(draw()) * radius;
    return {
      x: cell.x + Math.cos(a) * r,
      y: cell.y + Math.sin(a) * r,
      zone: cell.zone,
      population: cell.population,
    };
  };
  const pickHome = (draw: () => number): PopulationCell => jitterHome(pickHomeRaw(draw), draw);
  const residentialByZone = new Map<number, PopulationCell[]>();
  for (const c of residential) {
    const list = residentialByZone.get(c.zone);
    if (list) list.push(c);
    else residentialByZone.set(c.zone, [c]);
  }
  const homeSamplerByZone = new Map<number, (rng: () => number) => PopulationCell>();
  const pickHomeInZone = (zone: number): PopulationCell => {
    let sampler = homeSamplerByZone.get(zone);
    if (!sampler) {
      sampler = makeHomeSampler(residentialByZone.get(zone) ?? []);
      homeSamplerByZone.set(zone, sampler);
    }
    return jitterHome(sampler(rng), rng);
  };

  // ——— POI 专项出行：总量仍由日吸引量决定，但“谁去哪”不再是 POI 指定 ———
  const specsByGroup = new Map<number, ExtraSpec[]>();
  let demandTotal = 0;
  for (const poi of field.pois) {
    const meta = POI_META[poi.type];
    if (meta.group === null) continue;
    // dailyRange：在该 POI 的日吸引量区间内抽样。
    // 学校只把“走读生”计入日常吸引量；住校生的周末 / 假期回家另算。
    const rawDaily = poi.dailyMin + rng() * Math.max(0, poi.dailyMax - poi.dailyMin);
    const daily =
      rawDaily * (meta.group === GROUP_STUDENT ? STUDENT_DAY_DEMAND_SCALE : 1);
    if (daily <= 0) continue;
    const spec: ExtraSpec = { poi, group: meta.group, daily };
    const list = specsByGroup.get(meta.group);
    if (list) list.push(spec);
    else specsByGroup.set(meta.group, [spec]);
    demandTotal += daily;
  }

  // 不再固定封顶 2000：POI 越多，专项出行按日吸引量占比自然增长；
  // 只保留 MAX_AGENTS 作为极端自定义地图的性能保护。纯通勤模式不生成 POI 专项。
  const idealExtra = commuterOnly ? 0 : Math.round(demandTotal * POI_AGENT_RATE);
  // 测试 / 小地图给总人数上限时，按比例压缩基础成年样本，而不是让 POI
  // 专项被基础样本挤成 0。显式传 baseCount 时尊重调用方。
  if (baseCount === undefined && base + idealExtra > limit && idealExtra > 0) {
    base = Math.max(1, Math.min(limit, Math.round((limit * base) / (base + idealExtra))));
  }
  const extraTotal = Math.min(Math.max(0, limit - base), idealExtra);

  // 各组只拿“总预算”，具体去哪个 POI 由每个 agent 自己选。
  const groupBudgets = new Map<number, number>();
  if (extraTotal > 0 && demandTotal > 0 && specsByGroup.size > 0) {
    const remainders: Array<{ group: number; frac: number }> = [];
    let used = 0;
    for (const [group, specs] of specsByGroup) {
      const demand = specs.reduce((sum, s) => sum + s.daily, 0);
      const exact = (extraTotal * demand) / demandTotal;
      const count = Math.floor(exact);
      groupBudgets.set(group, count);
      used += count;
      remainders.push({ group, frac: exact - count });
    }
    remainders.sort((a, b) => b.frac - a.frac);
    for (let i = 0; i < extraTotal - used && remainders.length > 0; i++) {
      const group = remainders[i % remainders.length]!.group;
      groupBudgets.set(group, (groupBudgets.get(group) ?? 0) + 1);
    }
  }

  const n = base + extraTotal;
  const agents = createEmptyAgents(n);
  const odCount = new Map<string, ZoneOdPair>();
  const bumpOd = (from: number, to: number, group: number) => {
    const key = `${from}-${to}-${group}`;
    const hit = odCount.get(key);
    if (hit) hit.count++;
    else odCount.set(key, { from, to, group, count: 1 });
  };

  // 纯通勤：80% 正向 + 20% 反向；混合模式反向通勤只保留 10%，
  // 剩下约 20% 给灵活出行。反向通勤是真实存在的，但不该和正向一样多。
  const commuters = Math.round(base * (commuterOnly ? 0.8 : 0.7));
  const reverse = Math.round(base * (commuterOnly ? 0.2 : 0.1));
  // 距离衰减按公里换算：14 km 左右，符合“多数人不会跨整座城上班”的直觉。
  const commuteDecay = Math.max(150, field.pxPerKm * 9);
  const flexibleDecay = Math.max(140, field.pxPerKm * 8);

  for (let i = 0; i < base; i++) {
    const group = commuterOnly
      ? i < commuters
        ? GROUP_COMMUTER
        : GROUP_REVERSE
      : i < commuters
        ? GROUP_COMMUTER
        : i < commuters + reverse
          ? GROUP_REVERSE
          : GROUP_FLEXIBLE;
    agents.group[i] = group;
    agents.jobGroup[i] = group;
    // 基础成年人默认都在劳动力市场里；灵活就业也算有工作。
    // 具体岗位是否在可接受通勤范围内，由 Simulation 在建局时校核。
    agents.employed[i] = 1;
    let profile = pickProfile(group, rng);
    agents.profile[i] = profile;

    let homeZone: Zone;
    let workZone: Zone;
    let home: PopulationCell;
    let work: PopulationCell;
    let poiWorkplace: MapPoi | null = null;

    if (group === GROUP_COMMUTER || group === GROUP_FLEXIBLE) {
      home = pickHome(rng);
      homeZone = zoneById(zones, home.zone) ?? homeCandidates[0] ?? zones[0]!;
      if (group === GROUP_COMMUTER) {
        // 一部分通勤者不在就业区上班，而是在商场 / 医院 / 学校 / 景区 /
        // 车站等 POI 上班；他们的工作是 POI，不是“去 POI 办事”。
        if (rng() < POI_WORKER_SHARE) {
          poiWorkplace = pickPoiJob(field.pois, home, field.pxPerKm, rng);
        }
        if (poiWorkplace) {
          profile = poiWorkplace.type === 'school' ? 0 : 1;
          agents.profile[i] = profile;
          agents.workAtPoi[i] = 1;
          const zone = poiZoneId(poiWorkplace);
          workZone = zoneById(zones, zone) ?? homeZone;
          // 同一栋楼里的员工不能全部落在同一个像素上，否则热力会出现
          // 一个与周围完全不成比例的“红点”。按 POI 半径给工作点加抖动。
          const workJitter = Math.min(120, poiWorkplace.radiusKm * field.pxPerKm * 0.9);
          const wa = rng() * Math.PI * 2;
          const wr = Math.sqrt(rng()) * workJitter;
          work = {
            x: poiWorkplace.x + Math.cos(wa) * wr,
            y: poiWorkplace.y + Math.sin(wa) * wr,
            zone,
          };
        } else {
          workZone = gravity(homeZone, workCandidates, rng, commuteDecay);
          const cells = employmentByZone.get(workZone.id) ?? employment;
          work = pickCell(cells, rng);
        }
      } else if (mixedZones.length > 0) {
        workZone = gravity(homeZone, mixedZones, rng, flexibleDecay);
        const cells = mixedByZone.get(workZone.id) ?? field.mixed;
        work = cells.length > 0 ? pickCell(cells, rng) : pickHome(rng);
      } else {
        workZone = gravity(homeZone, workCandidates, rng, commuteDecay);
        work = pickCell(employmentByZone.get(workZone.id) ?? employment, rng);
      }
    } else {
      home = pickCell(employment, rng);
      homeZone = zoneById(zones, home.zone) ?? employmentZones[0] ?? homeCandidates[0]!;
      workZone = gravity(homeZone, homeCandidates.length > 0 ? homeCandidates : mixedZones, rng, commuteDecay);
      work = residentialByZone.has(workZone.id) ? pickHomeInZone(workZone.id) : pickHome(rng);
    }

    agents.homeX[i] = home.x;
    agents.homeY[i] = home.y;
    agents.workX[i] = work.x;
    agents.workY[i] = work.y;
    agents.homeZone[i] = home.zone;
    agents.workZone[i] = work.zone;

    if (group === GROUP_FLEXIBLE) {
      // 灵活出行：上午办事 / 午后休闲 / 傍晚消费，返回时间取决于停留时长。
      const rr = rng();
      const out =
        rr < 0.45 ? normal(rng, 630, 55) : rr < 0.82 ? normal(rng, 840, 65) : normal(rng, 1110, 55);
      const stay = 80 + rng() * 250;
      agents.outMin[i] = clamp(out, 420, 1290);
      agents.backMin[i] = clamp(out + stay, agents.outMin[i]! + 30, 1435);
      agents.hasReturn[i] = rng() < 0.8 ? 1 : 0;
      agents.dayRule[i] = 0;
    } else {
      const commute = commuteMinutes(home, work, field.pxPerKm, rng);
      // 服务业 / 产业工人的作息比办公室更晚 / 更早；POI 上班族再叠加
      // 商场晚班、学校早班、车站轮班等偏移。
      const poiShift = poiWorkplace ? poiWorkShift(poiWorkplace.type) : { start: 0, end: 0 };
      const shift = (profile === 1 ? 45 : profile === 2 ? -25 : 0) + poiShift.start;
      const start = sampleWorkStart(rng) + shift;
      const end =
        sampleWorkEnd(rng) +
        (profile === 1 ? 30 : profile === 2 ? -15 : 0) +
        poiShift.end;
      const access = 5 + rng() * 8;
      agents.outMin[i] = clamp(start - commute - access, 285, 690);
      agents.backMin[i] = clamp(end + commute + 3 + rng() * 9, agents.outMin[i]! + 45, 1435);
      // 少数人当天不返回（出差、加班后住别处、拼车等），使晚高峰不是机械的 100%。
      agents.hasReturn[i] = rng() < (group === GROUP_COMMUTER ? 0.94 : 0.9) ? 1 : 0;
      // 通勤族绝大多数只在工作日出现；周末保留一部分服务业 / 轮班人群。
      agents.dayRule[i] = rng() < (group === GROUP_COMMUTER ? 0.9 : 0.86) ? 1 : 0;
    }

    bumpOd(home.zone, work.zone, group);
  }

  let cursor = base;
  for (const [group, specs] of specsByGroup) {
    const budget = groupBudgets.get(group) ?? 0;
    for (let k = 0; k < budget && cursor < n; k++, cursor++) {
      const home = pickHome(rng);
      const spec = choosePoiDestination(specs, home, field.pxPerKm, rng);
      const poiZone = poiZoneId(spec.poi);
      const jitter = Math.min(90, spec.poi.radiusKm * field.pxPerKm * 0.35);
      const angle = rng() * Math.PI * 2;
      const rad = Math.sqrt(rng()) * jitter;
      const schoolX = spec.poi.x + Math.cos(angle) * rad;
      const schoolY = spec.poi.y + Math.sin(angle) * rad;
      agents.group[cursor] = group;
      agents.jobGroup[cursor] = group;
      agents.employed[cursor] = group === GROUP_FLEXIBLE ? 1 : 0;

      const boarding =
        group === GROUP_STUDENT && rng() >= studentDayShare(spec.poi.x, spec.poi.y);
      let profile = pickProfile(group, rng);
      if (group === GROUP_FEEDER) profile = spec.poi.type === 'ferry' ? 12 : 11;
      if (group === GROUP_STUDENT) {
        profile = boarding
          ? rng() < 0.25
            ? 16
            : 15
          : rng() < 0.35
            ? 13
            : rng() < 0.8
              ? 14
              : 17;
      }
      agents.profile[cursor] = profile;

      // 住校生：工作日住校，周末 / 假期才从学校回所在区的家，再返校。
      // 把 home 放在学校、work 放在家庭住址，活动链会自然生成
      // “学校 → 家 → 学校”的周末行程；工作日 dayRule=2 不激活。
      if (boarding) {
        agents.homeX[cursor] = schoolX;
        agents.homeY[cursor] = schoolY;
        agents.workX[cursor] = home.x;
        agents.workY[cursor] = home.y;
        agents.homeZone[cursor] = poiZone;
        agents.workZone[cursor] = home.zone;
        const weekendOut = 9 * 60 + rng() * 60;
        agents.outMin[cursor] = weekendOut;
        agents.backMin[cursor] = weekendOut + 7 * 60 + rng() * 60;
        agents.dayRule[cursor] = 2;
        agents.hasReturn[cursor] = 1;
        bumpOd(poiZone, home.zone, group);
        continue;
      }

      agents.homeX[cursor] = home.x;
      agents.homeY[cursor] = home.y;
      agents.workX[cursor] = schoolX;
      agents.workY[cursor] = schoolY;
      agents.homeZone[cursor] = home.zone;
      agents.workZone[cursor] = poiZone;
      const window = poiAgentWindow(spec.poi, rng);
      agents.outMin[cursor] = Math.max(285, window.outMin);
      agents.backMin[cursor] = window.backMin;
      agents.dayRule[cursor] = window.dayRule;
      agents.hasReturn[cursor] = 1;
      bumpOd(home.zone, poiZone, group);
    }
  }

  assignVehicles(agents, rng);
  return { agents, odPairs: [...odCount.values()] };
}

/**
 * 车辆拥有率：步行最多、电动车其次、汽车最少。
 * 每个 agent 的速度不同；这里存的是“平均驾驶速度”，不是路段瞬时速度。
 */
function assignVehicles(agents: AgentFields, rng: () => number): void {
  for (let i = 0; i < agents.count; i++) {
    const r = rng();
    if (r < 0.58) {
      agents.vehicle[i] = 0;
      agents.speedKmh[i] = 4.0 + rng() * 1.4;
    } else if (r < 0.9) {
      agents.vehicle[i] = 1;
      agents.speedKmh[i] = 13 + rng() * 8;
    } else {
      agents.vehicle[i] = 2;
      agents.speedKmh[i] = 24 + rng() * 20;
    }
  }
}

export function createEmptyAgents(n: number): AgentFields {
  return {
    count: n,
    homeX: new Float32Array(n),
    homeY: new Float32Array(n),
    workX: new Float32Array(n),
    workY: new Float32Array(n),
    group: new Uint8Array(n),
    jobGroup: new Uint8Array(n),
    employed: new Uint8Array(n),
    profile: new Uint8Array(n),
    workAtPoi: new Uint8Array(n),
    vehicle: new Uint8Array(n),
    speedKmh: new Float32Array(n),
    dayRule: new Uint8Array(n),
    homeZone: new Int16Array(n),
    workZone: new Int16Array(n),
    outMin: new Float32Array(n),
    backMin: new Float32Array(n),
    hasReturn: new Uint8Array(n),
    stopDone: new Uint8Array(n),
    returnQueued: new Uint8Array(n),
    state: new Uint8Array(n),
    legIndex: new Uint8Array(n),
    walkLeft: new Float32Array(n),
    bgFromX: new Float32Array(n),
    bgFromY: new Float32Array(n),
    bgTotal: new Float32Array(n),
    bgMode: new Uint8Array(n),
    tripStart: new Float32Array(n),
    tripDestX: new Float32Array(n),
    tripDestY: new Float32Array(n),
    tripIsOut: new Uint8Array(n),
    targetStation: new Int32Array(n).fill(-1),
    waitStation: new Int32Array(n).fill(-1),
    planDirty: new Uint8Array(n),
    plans: new Array(n).fill(null),
  };
}

export type { PopulationDot };

/**
 * 城市增长用：把 agents 扩容到至少 need，保留前 count 个人的所有字段。
 * 按 1.5 倍预分配，避免每天新增时都重建整张表。
 */
export function ensureAgentCapacity(a: AgentFields, need: number): AgentFields {
  if (a.homeX.length >= need) return a;
  const next = createEmptyAgents(Math.max(need, Math.ceil(a.count * 1.5) + 32));
  const c = a.count;
  next.count = c;
  next.homeX.set(a.homeX.subarray(0, c));
  next.homeY.set(a.homeY.subarray(0, c));
  next.workX.set(a.workX.subarray(0, c));
  next.workY.set(a.workY.subarray(0, c));
  next.group.set(a.group.subarray(0, c));
  next.jobGroup.set(a.jobGroup.subarray(0, c));
  next.employed.set(a.employed.subarray(0, c));
  next.profile.set(a.profile.subarray(0, c));
  next.workAtPoi.set(a.workAtPoi.subarray(0, c));
  next.vehicle.set(a.vehicle.subarray(0, c));
  next.speedKmh.set(a.speedKmh.subarray(0, c));
  next.dayRule.set(a.dayRule.subarray(0, c));
  next.homeZone.set(a.homeZone.subarray(0, c));
  next.workZone.set(a.workZone.subarray(0, c));
  next.outMin.set(a.outMin.subarray(0, c));
  next.backMin.set(a.backMin.subarray(0, c));
  next.hasReturn.set(a.hasReturn.subarray(0, c));
  next.stopDone.set(a.stopDone.subarray(0, c));
  next.returnQueued.set(a.returnQueued.subarray(0, c));
  next.state.set(a.state.subarray(0, c));
  next.legIndex.set(a.legIndex.subarray(0, c));
  next.walkLeft.set(a.walkLeft.subarray(0, c));
  next.bgFromX.set(a.bgFromX.subarray(0, c));
  next.bgFromY.set(a.bgFromY.subarray(0, c));
  next.bgTotal.set(a.bgTotal.subarray(0, c));
  next.bgMode.set(a.bgMode.subarray(0, c));
  next.tripStart.set(a.tripStart.subarray(0, c));
  next.tripDestX.set(a.tripDestX.subarray(0, c));
  next.tripDestY.set(a.tripDestY.subarray(0, c));
  next.tripIsOut.set(a.tripIsOut.subarray(0, c));
  next.targetStation.set(a.targetStation.subarray(0, c));
  next.waitStation.set(a.waitStation.subarray(0, c));
  next.planDirty.set(a.planDirty.subarray(0, c));
  for (let i = 0; i < c; i++) next.plans[i] = a.plans[i] ?? null;
  return next;
}


