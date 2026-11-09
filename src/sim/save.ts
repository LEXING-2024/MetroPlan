import { SAVE_VERSION, DEFAULT_FARE, GROUP_COMMUTER, GROUP_FLEXIBLE } from './constants';
import { formatClock, formatDate } from './calendar';
import { Simulation } from './simulation';
import { buildActivityModel } from './activity';
import type {
  CustomMapData,
  DailyStats,
  DayRecord,
  FareConfig,
  Plan,
  Settings,
  Station,
  StationSize,
  Train,
  TrainKind,
  TutorialState,
  ZoneOdPair,
} from './types';
import { buildPopulationField, cloneMap, customWalkRadius, normalizeMap } from './mapData';
import { getBuiltinMap } from '../maps/registry';
import { createEmptyAgents } from './population';
import type { DemandMode } from './population';
import { BUILTIN_PX_PER_KM, DEFAULT_TRAIN_SPEED_KMH, MAP_ID, MIN_STATION_GAP } from './constants';
import type { Line } from './types';

export interface SavedPlan {
  o: number;
  d: number;
  w1: number;
  w2: number;
  l: Array<[number, number, number]>;
}

export interface SerializedAgent {
  c: number;
  hx: number[];
  hy: number[];
  wx: number[];
  wy: number[];
  g: number[];
  /** 就业状态，按 agent 顺序压成 '0'/'1' 字符串；缺省时按旧存档校核。 */
  emp?: string;
  pr?: number[];
  wp?: number[];
  veh?: number[];
  spd?: number[];
  hz: number[];
  wz: number[];
  out: number[];
  back: number[];
  ret: number[];
  st: number[];
  dr: number[];
  li: number[];
  wl: number[];
  bfx?: number[];
  bfy?: number[];
  btl?: number[];
  bm?: number[];
  ts: number[];
  dx: number[];
  dy: number[];
  io: number[];
  target: number[];
  wait: number[];
  dirty: number[];
  plans: Array<SavedPlan | null>;
}

export interface SerializedSim {
  time: number;
  paused: boolean;
  manualSpeed: number | null;
  fund: number;
  mode: 'standard' | 'tutorial';
  mapId: string;
  mapName: string;
  map: CustomMapData | null;
  pxPerKm: number;
  walkRadiusPx: number;
  walkSpeed: number;
  minStationGap: number;
  /** 新存档记录需求口径与活动链开关；旧存档缺省为 mixed / false。 */
  demand?: DemandMode;
  activity?: boolean;
  /** 内置图是否启用了真实步行图 / M4 接驳选择；旧存档按内置图默认开启。 */
  walkNetwork?: boolean;
  walkChoice?: boolean;
  /** true = 存档由 M1 合成人口驱动。 */
  m1?: boolean;
  settings: Settings;
  fare?: FareConfig;
  tutorial: TutorialState;
  stats: DailyStats;
  history: DayRecord[];
  stations: Array<[number, number, number, string, number, number, StationSize?, number?, number?]>;
  lines: Array<[number, number, number[], number, string, number, number, number?, number?, number?, number?, number?, number?, number[]?]>;
  trains: Array<[number, number, number, number, number, number, number, number[], number?, number?, TrainKind?]>;
  agents: SerializedAgent;
  queues: Array<[number, number[]]>;
  entries: Array<[number, number]>;
  ids: [number, number, number];
  lastStationId: number | null;
  autoPauseDone: { am: boolean; pm: boolean };
  od: ZoneOdPair[];
}

export interface SaveMeta {
  slot: string;
  savedAt: number;
  saveVersion: string;
  /** 地图 id：不同地图的存档互不干扰 */
  mapId: string;
  mapName: string;
  dateLabel: string;
  fund: number;
  day: number;
  time: number;
  mode: 'standard' | 'tutorial';
  stations: number;
  lines: number;
  trains: number;
}

export interface SaveFile {
  format: 'metro-plan-save';
  saveVersion: string;
  savedAt: number;
  meta: SaveMeta;
  data: SerializedSim;
}

const r2 = (v: number): number => Math.round(v * 100) / 100;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

export function snapshotSim(sim: Simulation): SerializedSim {
  const a = sim.agents;
  const stations: SerializedSim['stations'] = sim.net.stations.map((s) => [
    s.id,
    r2(s.x),
    r2(s.y),
    s.name,
    s.capacity,
    r3(s.builtAt),
    s.size ?? 'standard',
    s.entriesBest ?? 0,
    s.exitsBest ?? 0,
  ]);
  const lines: SerializedSim['lines'] = sim.net.lines.map((l) => [
    l.id,
    l.color,
    [...l.stationIds],
    l.buildCost,
    l.hex,
    l.startMin,
    l.endMin,
    l.branchOf ?? 0,
    l.speedKmh,
    l.ridersToday,
    l.ridersLastDay,
    l.ridersBestDay,
    l.peakOnboard,
    [...l.expressStops],
  ]);
  const trains: SerializedSim['trains'] = sim.net.trains.map((t) => [
    t.id,
    t.lineId,
    t.index,
    r3(t.prog),
    t.dir,
    t.phase,
    r3(t.dwellLeft),
    [...t.riders],
    t.startId,
    t.endId,
    t.kind,
  ]);
  const agents: SerializedAgent = {
    c: a.count,
    hx: Array.from(a.homeX, r2),
    hy: Array.from(a.homeY, r2),
    wx: Array.from(a.workX, r2),
    wy: Array.from(a.workY, r2),
    g: Array.from(a.group),
    emp: Array.from(a.employed).join(''),
    pr: Array.from(a.profile),
    wp: Array.from(a.workAtPoi),
    veh: Array.from(a.vehicle),
    spd: Array.from(a.speedKmh, r2),
    hz: Array.from(a.homeZone),
    wz: Array.from(a.workZone),
    out: Array.from(a.outMin, r3),
    back: Array.from(a.backMin, r3),
    ret: Array.from(a.hasReturn),
    st: Array.from(a.state),
    dr: Array.from(a.dayRule),
    li: Array.from(a.legIndex),
    wl: Array.from(a.walkLeft, r3),
    bfx: Array.from(a.bgFromX, r3),
    bfy: Array.from(a.bgFromY, r3),
    btl: Array.from(a.bgTotal, r3),
    bm: Array.from(a.bgMode),
    ts: Array.from(a.tripStart, r3),
    dx: Array.from(a.tripDestX, r2),
    dy: Array.from(a.tripDestY, r2),
    io: Array.from(a.tripIsOut),
    target: Array.from(a.targetStation),
    wait: Array.from(a.waitStation),
    dirty: Array.from(a.planDirty),
    plans: a.plans.map((p) =>
      p
        ? {
            o: p.origin,
            d: p.dest,
            w1: r3(p.walk1),
            w2: r3(p.walk2),
            l: p.legs.map((l) => [l.lineId, l.from, l.to] as [number, number, number]),
          }
        : null,
    ),
  };

  return {
    time: r3(sim.time),
    paused: sim.paused,
    manualSpeed: sim.manualSpeed,
    fund: sim.fund,
    mode: sim.mode,
    mapId: sim.mapId,
    mapName: sim.mapName,
    map: sim.map ? cloneMap(sim.map, false) : null,
    pxPerKm: sim.pxPerKm,
    walkRadiusPx: sim.walkRadiusPx,
    walkSpeed: sim.walkSpeed,
    minStationGap: sim.minStationGap,
    demand: sim.demandMode,
    activity: sim.activityMode,
    walkNetwork: !!sim.walkRouter,
    walkChoice: sim.walkChoice,
    m1: sim.activitySource === 'm1',
    settings: { ...sim.settings },
    fare: { ...sim.fare },
    tutorial: { ...sim.tutorial },
    stats: { ...sim.stats },
    history: sim.history.map((r) => ({ ...r })),
    stations,
    lines,
    trains,
    agents,
    queues: [...sim.queues.entries()].map(([id, q]) => [id, [...q]] as [number, number[]]),
    entries: [...sim.entriesToday.entries()],
    ids: sim.net.getIds(),
    lastStationId: sim.lastStationId,
    autoPauseDone: { ...sim.autoPauseDone },
    od: sim.odPairs.map((p) => ({ ...p })),
  };
}

export function makeSaveFile(sim: Simulation, slot: string): SaveFile {
  const savedAt = Date.now();
  const data = snapshotSim(sim);
  return {
    format: 'metro-plan-save',
    saveVersion: SAVE_VERSION,
    savedAt,
    meta: {
      slot,
      savedAt,
      saveVersion: SAVE_VERSION,
      mapId: sim.mapId,
      mapName: sim.mapName,
      dateLabel: `${formatDate(sim.dayIndex())} ${formatClock(sim.timeOfDay())}`,
      fund: sim.fund,
      day: sim.dayIndex(),
      time: sim.time,
      mode: sim.mode,
      stations: sim.net.stations.length,
      lines: sim.net.lines.length,
      trains: sim.net.trains.length,
    },
    data,
  };
}

export function restoreSim(data: SerializedSim): Simulation {
  const rawMap = data.map ?? null;
  const map = rawMap ? normalizeMap(rawMap) : null;
  const builtin = map ? null : getBuiltinMap(data.mapId);
  const field = map ? buildPopulationField(map) : builtin?.createField();
  const pxPerKm = map ? (data.pxPerKm ?? field!.pxPerKm) : builtin?.pxPerKm ?? BUILTIN_PX_PER_KM;
  const m1 = data.m1 && field ? buildActivityModel(field, { seed: 20260101 }) : undefined;
  const sim = new Simulation({
    mode: data.mode,
    field,
    pxPerKm,
    // 旧版存档的步行半径按旧比例尺保存；内置图统一迁移到当前 2 km 模型。
    walkRadiusPx: map
      ? (data.walkRadiusPx && data.walkRadiusPx <= customWalkRadius(pxPerKm) * 1.02
          ? data.walkRadiusPx
          : customWalkRadius(pxPerKm))
      : pxPerKm * 2.0,
    walkSpeed: map ? (data.walkSpeed ?? pxPerKm * (4.5 / 60)) : pxPerKm * (4.5 / 60),
    minStationGap: data.minStationGap ?? MIN_STATION_GAP,
    mapId: data.mapId ?? builtin?.id ?? MAP_ID,
    mapName: data.mapName ?? builtin?.name ?? '端州 · 鼎湖',
    map,
    demand: data.demand ?? 'mixed',
    activity: data.activity ?? false,
    // 旧档未记录步行图开关：内置图默认启用，自定义地图默认不启用。
    walkNetwork: data.walkNetwork ?? !map,
    walkChoice: data.walkChoice ?? false,
    activityModel: m1,
  });
  sim.time = data.time;
  sim.paused = data.paused;
  sim.manualSpeed = data.manualSpeed;
  sim.fund = data.fund;
  sim.settings = { ...data.settings };
  sim.fare = { ...DEFAULT_FARE, ...(data.fare ?? {}) };
  sim.tutorial = { ...data.tutorial };
  sim.stats = { ...data.stats, cancelled: data.stats.cancelled ?? 0 };
  sim.history = data.history.map((r) => ({
    ...r,
    cancelled: r.cancelled ?? 0,
    reliability: r.reliability ?? 1,
  }));
  sim.mode = data.mode;
  sim.lastStationId = data.lastStationId;
  sim.autoPauseDone = { ...data.autoPauseDone };
  sim.odPairs = data.od.map((p) => ({ ...p }));

  const stations: Station[] = data.stations.map(
    ([id, x, y, name, capacity, builtAt, size, entriesBest, exitsBest]) => ({
      id,
      x,
      y,
      name,
      capacity,
      builtAt,
      size: size ?? 'standard',
      lines: [],
      entriesBest: entriesBest ?? 0,
      exitsBest: exitsBest ?? 0,
    }),
  );
  const lines: Line[] = data.lines.map(([
    id,
    color,
    stationIds,
    buildCost,
    hex,
    startMin,
    endMin,
    branchOf,
    speedKmh,
    ridersToday,
    ridersLastDay,
    ridersBestDay,
    peakOnboard,
    expressStops,
  ]) => ({
    id,
    color,
    hex: hex ?? '#C25B4A',
    startMin: startMin ?? 360,
    endMin: endMin ?? 1410,
    speedKmh: speedKmh ?? DEFAULT_TRAIN_SPEED_KMH,
    stationIds: [...stationIds],
    buildCost,
    trains: [],
    ridersToday: ridersToday ?? 0,
    ridersLastDay: ridersLastDay ?? 0,
    ridersBestDay: ridersBestDay ?? 0,
    peakOnboard: peakOnboard ?? 0,
    expressStops: [...(expressStops ?? [])],
    branchOf: branchOf && branchOf > 0 ? branchOf : undefined,
  }));
  const trains: Train[] = data.trains.map(
    ([id, lineId, index, prog, dir, phase, dwellLeft, riders, startId, endId, kind]) => ({
      id,
      lineId,
      kind: kind ?? 'local',
      index,
      prog,
      dir: dir === -1 ? -1 : 1,
      phase: phase === 1 ? 1 : 0,
      dwellLeft,
      riders: [...riders],
      startId: startId ?? 0,
      endId: endId ?? 0,
    }),
  );
  // 旧存档没有运行区间：补成整条线。
  for (const train of trains) {
    const line = lines.find((l) => l.id === train.lineId);
    if (!line) continue;
    if (!line.stationIds.includes(train.startId)) train.startId = line.stationIds[0] ?? 0;
    if (!line.stationIds.includes(train.endId)) train.endId = line.stationIds[line.stationIds.length - 1] ?? 0;
  }
  for (const line of lines) {
    for (const station of stations) {
      if (line.stationIds.includes(station.id) && !station.lines.includes(line.id)) {
        station.lines.push(line.id);
      }
    }
    for (const train of trains) {
      if (train.lineId === line.id) line.trains.push(train.id);
    }
  }
  sim.net.restore(stations, lines, trains, data.ids);

  const a = data.agents;
  // 旧存档的 agent 数量可能小于当前地图默认人口；按存档数量重建，避免空 agent。
  if (sim.agents.count !== a.c) sim.agents = createEmptyAgents(a.c);
  const ag = sim.agents;
  for (let i = 0; i < ag.count; i++) {
    ag.homeX[i] = a.hx[i] ?? 0;
    ag.homeY[i] = a.hy[i] ?? 0;
    ag.workX[i] = a.wx[i] ?? 0;
    ag.workY[i] = a.wy[i] ?? 0;
    ag.group[i] = a.g[i] ?? 0;
    ag.employed[i] = a.emp ? (a.emp.charCodeAt(i) === 49 ? 1 : 0) : ag.group[i]! <= 2 ? 1 : 0;
    // 失业后 group 会变成灵活；找工作时原本是通勤族，按通勤族恢复。
    ag.jobGroup[i] =
      ag.group[i] === GROUP_FLEXIBLE && ag.employed[i] === 0 ? GROUP_COMMUTER : ag.group[i]!;
    ag.profile[i] = a.pr?.[i] ?? 0;
    ag.workAtPoi[i] = a.wp?.[i] ?? 0;
    ag.vehicle[i] = a.veh?.[i] ?? 0;
    ag.speedKmh[i] = a.spd?.[i] ?? 4.5;
    ag.homeZone[i] = a.hz[i] ?? 0;
    ag.workZone[i] = a.wz[i] ?? 0;
    ag.outMin[i] = a.out[i] ?? 0;
    ag.backMin[i] = a.back[i] ?? 0;
    ag.hasReturn[i] = a.ret[i] ?? 0;
    ag.state[i] = a.st[i] ?? 0;
    ag.dayRule[i] = a.dr?.[i] ?? 0;
    ag.legIndex[i] = a.li[i] ?? 0;
    ag.walkLeft[i] = a.wl[i] ?? 0;
    ag.bgFromX[i] = a.bfx?.[i] ?? 0;
    ag.bgFromY[i] = a.bfy?.[i] ?? 0;
    ag.bgTotal[i] = a.btl?.[i] ?? 0;
    ag.bgMode[i] = a.bm?.[i] ?? 0;
    ag.tripStart[i] = a.ts[i] ?? 0;
    ag.tripDestX[i] = a.dx[i] ?? 0;
    ag.tripDestY[i] = a.dy[i] ?? 0;
    ag.tripIsOut[i] = a.io[i] ?? 0;
    ag.targetStation[i] = a.target[i] ?? -1;
    ag.waitStation[i] = a.wait[i] ?? -1;
    ag.planDirty[i] = a.dirty[i] ?? 0;
    const sp = a.plans[i];
    if (sp) {
      const plan: Plan = {
        origin: sp.o,
        dest: sp.d,
        walk1: sp.w1,
        walk2: sp.w2,
        total: sp.w1 + sp.w2,
        legs: sp.l.map(([lineId, from, to]) => ({ lineId, from, to })),
      };
      ag.plans[i] = plan;
    } else {
      ag.plans[i] = null;
    }
  }

  sim.queues.clear();
  for (const [sid, q] of data.queues) {
    if (!sim.net.stationById.has(sid)) continue;
    sim.queues.set(sid, q.filter((id) => id >= 0 && id < ag.count));
  }
  sim.entriesToday.clear();
  for (const [sid, n] of data.entries) {
    if (sim.net.stationById.has(sid)) sim.entriesToday.set(sid, n);
  }
  // 重新校核岗位通勤上限，旧存档里“步行去很远上班”的 agent 会转成灵活 / 换近岗。
  sim.refreshEmployment();
  if (sim.activityMode) sim.rebuildActivity();
  else sim.rebuildSchedule();
  // 存档不保存路径折线；恢复后按当前路网重建在途轨迹，避免直线插值。
  sim.restoreTransitPaths();
  return sim;
}
