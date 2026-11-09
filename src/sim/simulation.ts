import {
  DEFAULT_PX_PER_KM,
  DEFAULT_TRAIN_SPEED_KMH,
  DEFAULT_WALK_KM,
  DEFAULT_WALK_SPEED_KMH,
  DEFAULT_FARE,
  GROUP_COMMUTER,
  GROUP_FLEXIBLE,
  GROUP_REVERSE,
  LINE_COLORS,
  LINE_REFUND_RATE,
  MAP_ID,
  MIN_STATION_GAP,
  PROFILE_META,
  SEGMENT_COST,
  START_FUND,
  STATION_SIZES,
  TRAIN_CAPACITY,
  TRAIN_COST,
  TRAIN_DAILY,
  TRAIN_DAILY_EXPRESS,
  TRAIN_COST_EXPRESS,
  TRAIN_DWELL,
  TRAIN_DWELL_MAX_EXTRA,
  TRAIN_DWELL_PER_BOARDING,
  speedForTrainKind,
  WALK_CORE_RADIUS_M,
  WALK_RADIUS,
  WALK_SPEED,
  WORLD_H,
  WORLD_W,
} from './constants';
import {
  DAY_MINUTES,
  START_TOTAL_MINUTES,
  autoSpeedOf,
  nextBoundaryAfter,
  periodOf,
  startOfDay,
  weekdayOf,
} from './calendar';
import { Network, isLoopLine, segmentTravel } from './network';
import { planTrip } from './pathfinding';
import { modeForVehicle, travelMinutes } from './activity/choice';
import { buildAgentActivityChains } from './activity/agentChains';
import type { ActivityModel } from './activity/types';
import { createM1ActivityChains, createM1AgentFields } from './activity/m1Adapter';
import type { AgentActivityTrip } from './activity/agentChains';
import { stationAccessProbability, walkAccessProbability } from './access';
import { WalkRouter } from './walkRouter';
import { terrainAt } from './terrainRules';
import {
  builtinPopulationField,
  createAgents,
  ensureAgentCapacity,
  poiDistanceAlpha,
} from './population';
import type { DemandMode } from './population';
import { POI_META, poiAgentWindow, poiDailyMid, poiTimeWeight, poiZoneId } from './mapData';
import { coverageAt } from './zones';
import type {
  AgentFields,
  CoveragePreview,
  CustomMapData,
  DailyStats,
  DayRecord,
  FareConfig,
  Line,
  StationSize,
  TrainKind,
  MapPoi,
  PopulationDot,
  PopulationField,
  Settings,
  SimEvent,
  Station,
  Train,
  TutorialState,
  Zone,
  ZoneOdPair,
} from './types';
import { AgentState } from './types';

/** 10 万 agent 下限制后台路由队列 / 缓存，避免无限增长。 */
const MAX_BACKGROUND_QUEUE = 20_000;
const MAX_BACKGROUND_CACHE = 20_000;

/** 找工作的通勤接受范围（单程分钟）：18–38 分钟，因人而异；硬上限 2 小时。 */
const JOB_ACCEPT_MIN = 18;
const JOB_ACCEPT_SPAN = 20;
/** 任何岗位单程通勤都不能超过 2 小时（上班 / 下班各自计时）。 */
const MAX_COMMUTE_MINUTES = 120;
/** 超过这个时间就不必再纳入候选，避免为全城组团跑路径规划。 */
const JOB_SEARCH_LIMIT = 90;
/** 每个家组团最多评估的岗位组团数（按直线距离取近的），控制修线后的一次性开销。 */
const JOB_ZONE_LIMIT = 32;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

interface DayEvent {
  t: number;
  agent: number;
  kind: 0 | 1;
}

export interface ActionResult {
  ok: boolean;
  reason?: string;
}

export interface NewGameOptions {
  mode?: 'standard' | 'tutorial';
  seed?: number;
  count?: number;
  /** 自定义地图的人口场；为空时使用内置端州·鼎湖地图 */
  field?: PopulationField;
  pxPerKm?: number;
  walkRadiusPx?: number;
  walkSpeed?: number;
  minStationGap?: number;
  pois?: MapPoi[];
  mapId?: string;
  mapName?: string;
  map?: CustomMapData | null;
  /** 需求口径：commuter = 纯通勤；mixed = 通勤 + POI 专项。 */
  demand?: DemandMode;
  /** M2：用多段活动链替代单次 out/back；默认关闭以保留旧模型回退。 */
  activity?: boolean;
  /** M3：用本地步行图校核站点接驳，并比较地铁/背景方式。 */
  walkNetwork?: boolean;
  /** M4：直接按步行路网时间选择起点/终点站（需要 walkNetwork）。 */
  walkChoice?: boolean;
  /** 内置地形图是否启用 DEM 水域/坡度建站限制；测试/程序化场景可关闭。 */
  enforceTerrain?: boolean;
  /** M1 合成人口 + 活动计划；传入后它成为 agent/活动链的来源。 */
  activityModel?: ActivityModel;
  /** 测试 / 小地图用的 agent 总数上限；默认使用 MAX_AGENTS。 */
  maxAgents?: number;
}

export class Simulation {
  time = START_TOTAL_MINUTES;
  paused = false;
  manualSpeed: number | null = null;

  fund = START_FUND;
  net = new Network();
  /** 分段票价：起步价 + 按公里加档，玩家可改。 */
  fare: FareConfig = { ...DEFAULT_FARE };
  agents: AgentFields;
  zones: Zone[] = [];
  zoneMap = new Map<number, Zone>();
  dots: PopulationDot[] = [];
  pois: MapPoi[] = [];
  residentialAreas: NonNullable<PopulationField['residentialAreas']> = [];
  residentialPlaces: NonNullable<PopulationField['residentialPlaces']> = [];
  poiByZone = new Map<number, MapPoi>();
  odPairs: ZoneOdPair[] = [];
  pxPerKm = DEFAULT_PX_PER_KM;
  walkRadiusPx = WALK_RADIUS;
  walkSpeed = WALK_SPEED;
  minStationGap = MIN_STATION_GAP;
  mapId = MAP_ID;
  mapName = '端州 · 鼎湖';
  map: CustomMapData | null = null;

  settings: Settings = { autoPause: true, skipNight: true, lockSpeed: false };
  tutorial: TutorialState = { active: false, undoUsed: false };
  mode: 'standard' | 'tutorial' = 'standard';

  stats: DailyStats;
  history: DayRecord[] = [];

  queues = new Map<number, number[]>();
  entriesToday = new Map<number, number>();
  exitsToday = new Map<number, number>();

  lastStationId: number | null = null;
  autoPauseDone = { am: false, pm: false };

  private dayEvents: DayEvent[] = [];
  private dayCursor = 0;
  private firstDepartureCache: { day: number; minute: number } = { day: -1, minute: 360 };
  private listeners = new Set<(event: SimEvent) => void>();
  private initialised = false;
  /** 上一次重选目的地时的线网版本；线网不变就沿用，避免每天全量重算。 */
  private poiChoiceVersion = -1;
  /** 城市增长基数：各组团开局时的点阵数，用来算 +50% 的上限。 */
  private growthBase = new Map<number, number>();
  /** 最近一次线网变化发生在哪一天（通勤族换工作地要过一段适应期）。 */
  private netAdaptDay = -999;
  /** 岗位搜索缓存：按线网版本缓存“家 → 就业组团”的通勤时间。 */
  private jobCacheVersion = -1;
  private jobZoneCache: Array<{ zone: Zone; cells: PopulationDot[] }> = [];
  private jobMinutesCache = new Map<number, Array<{ zone: Zone; minutes: number; cells: PopulationDot[] }>>();
  /** 顺路停留结束后延迟出发的排队（绝对分钟）：去下一个停留点或回家。 */
  private stopHome: Array<{ t: number; agent: number; dx: number; dy: number }> = [];
  /** 按“实际到达 + 停留”排定的返程（绝对分钟）。 */
  private pendingReturns: Array<{ t: number; agent: number }> = [];
  /** 当前需求口径；纯通勤模式只生成通勤 / 反向通勤。 */
  readonly demandMode: DemandMode;
  readonly pureCommuter: boolean;
  /** M2：每个 agent 的活动链。 */
  readonly activityMode: boolean;
  private activityChains: AgentActivityTrip[][] = [];
  private activityIndex: Uint16Array;
  private activityPending: Array<{ t: number; agent: number; index: number }> = [];
  private activityBackgroundTrips = 0;
  private activityMetroTrips = 0;
  /** Optional road polyline per background trip when the walk graph is active. */
  backgroundPaths: Array<Array<[number, number]> | null> = [];
  /** 1 = 还在等精确步行路径，先停在出发地，不按直线走。 */
  private bgQueued: Uint8Array = new Uint8Array(0);
  /** 当前活动行程的步行接入 / 接出路径，供热力沿步行图绘制。 */
  walk1Paths: Array<Array<[number, number]> | null> = [];
  walk2Paths: Array<Array<[number, number]> | null> = [];
  /** Incremental background routing: never run thousands of A* in one frame. */
  private backgroundQueue: Array<{
    agent: number;
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    mode: 0 | 1 | 2 | 3;
  }> = [];
  private backgroundPathCache = new Map<string, Array<[number, number]> | null>();
  private backgroundMinutesCache = new Map<string, number>();
  private backgroundWaiters = new Map<string, number[]>();
  private activitySeed = 20260101;
  /** M3: optional local walking graph for station access. */
  walkRouter: WalkRouter | null = null;
  readonly walkChoice: boolean;
  readonly enforceTerrain: boolean;
  /** M1 驱动时为 'm1'，旧合成 agent 为 'legacy'。 */
  readonly activitySource: 'm1' | 'legacy';
  private m1Model: ActivityModel | null = null;
  private walkRoutedTrips = 0;
  private walkFallbackTrips = 0;

  constructor(options: NewGameOptions = {}) {
    const field = options.field ?? builtinPopulationField();
    this.zones = field.zones;
    this.zoneMap = new Map(field.zones.map((z) => [z.id, z]));
    this.dots = field.dots;
    this.pois = options.pois ?? field.pois;
    this.residentialAreas = field.residentialAreas ?? [];
    this.residentialPlaces = field.residentialPlaces ?? [];
    this.poiByZone = new Map(this.pois.map((p) => [poiZoneId(p), p]));
    this.pxPerKm = options.pxPerKm ?? field.pxPerKm ?? DEFAULT_PX_PER_KM;
    this.walkRadiusPx = options.walkRadiusPx ?? this.pxPerKm * DEFAULT_WALK_KM;
    this.walkSpeed =
      options.walkSpeed ?? this.pxPerKm * (DEFAULT_WALK_SPEED_KMH / 60);
    this.minStationGap = options.minStationGap ?? MIN_STATION_GAP;
    this.mapId = options.mapId ?? MAP_ID;
    this.mapName = options.mapName ?? '端州 · 鼎湖';
    this.map = options.map ?? null;
    this.demandMode = options.demand ?? 'mixed';
    this.pureCommuter = this.demandMode === 'commuter';
    // 纯通勤必须走 createAgents 的 80/20 通勤抽样；M1 合成人口留给 ?m1=1 的混合局。
    this.m1Model =
      options.activityModel && this.demandMode === 'mixed' ? options.activityModel : null;
    this.activitySource = this.m1Model ? 'm1' : 'legacy';
    const created = this.m1Model
      ? { agents: createM1AgentFields(this.m1Model, this.pxPerKm), odPairs: [] }
      : createAgents(field, options.count, options.seed, this.demandMode, options.maxAgents);
    this.agents = created.agents;
    this.odPairs = created.odPairs;
    this.activityMode = options.activity ?? false;
    this.walkChoice = options.walkChoice ?? false;
    this.enforceTerrain = options.enforceTerrain ?? false;
    this.activitySeed = options.seed ?? 20260101;
    this.activityIndex = new Uint16Array(this.agents.count);
    this.backgroundPaths = new Array(this.agents.count).fill(null);
    this.bgQueued = new Uint8Array(this.agents.count);
    this.walk1Paths = new Array(this.agents.count).fill(null);
    this.walk2Paths = new Array(this.agents.count).fill(null);
    if (options.walkNetwork) {
      try {
        this.walkRouter = new WalkRouter();
      } catch (err) {
        console.warn('[metro-plan] walking graph unavailable', err);
      }
    }
    // 建局先按“可接受通勤时间”校核岗位：太远的工作不接，先按灵活人群活动。
    this.assignInitialEmployment();
    if (this.activityMode) {
      this.rebuildActivityChains(this.activitySeed);
    }
    this.mode = options.mode ?? 'standard';
    this.tutorial = { active: this.mode === 'tutorial', undoUsed: false };
    this.stats = this.makeStats(this.dayIndex());
    this.stats.trips = this.countDailyTrips();
    this.buildDayEvents();
    this.initialised = true;
  }

  // ————————————————————————— 时间 —————————————————————————

  dayIndex(): number {
    return Math.floor(this.time / DAY_MINUTES);
  }

  timeOfDay(): number {
    const d = this.dayIndex();
    return this.time - d * DAY_MINUTES;
  }

  currentSpeed(): number {
    if (this.paused) return 0;
    if (this.manualSpeed !== null) return this.manualSpeed;
    return autoSpeedOf(this.timeOfDay());
  }

  speedLabel(): string {
    if (this.paused) return '暂停';
    const s = this.currentSpeed();
    return `${s}x`;
  }

  isManualSpeed(): boolean {
    return this.manualSpeed !== null;
  }

  setSpeed(speed: number): void {
    this.manualSpeed = speed;
    this.paused = false;
  }

  togglePause(): void {
    this.paused = !this.paused;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  tick(dtRealSeconds: number): void {
    if (!this.initialised || this.paused) return;
    const speed = this.currentSpeed();
    if (speed <= 0) return;
    const dt = Math.min(0.25, Math.max(0, dtRealSeconds));
    const gameMinutes = Math.min(40, dt * speed);
    if (gameMinutes <= 0) return;
    this.advance(gameMinutes);
  }

  private advance(minutes: number): void {
    let left = minutes;
    let guard = 0;
    while (left > 1e-6 && guard++ < 5000) {
      if (this.paused) return;
      const boundary = nextBoundaryAfter(this.time);
      const gap = boundary - this.time;
      const sub = Math.min(left, gap, 2);
      if (sub > 1e-6) {
        this.integrate(sub);
        left -= sub;
      }
      if (this.time >= boundary - 1e-6) {
        this.time = boundary;
        this.handleBoundary(boundary);
        if (this.paused) return;
        // 先结算再决定是否跳夜：否则 00:00 会被夜间跳过直接跨过去。
        continue;
      }
      // 末班车全部回库后才允许跳过深夜，跳到第一班出发前。
      if (this.maybeSkipNight()) continue;
    }
    this.maybeSkipNight();
  }

  /** 所有列车都停在自己的终点站、车上没有乘客。 */
  private allTrainsParked(): boolean {
    for (const train of this.net.trains) {
      const line = this.net.lineById.get(train.lineId);
      if (!line || line.stationIds.length < 2) continue;
      const span = this.trainSpan(train, line);
      const atEnd = train.index <= span.start || train.index >= span.end;
      if (train.phase === 1 || !atEnd || train.riders.length > 0) return false;
    }
    return true;
  }

  /** 当天最后一条线路的收班分钟；没有线路时按默认 23:30。 */
  private lastServiceEnd(): number {
    let end = 0;
    for (const line of this.net.lines) {
      if (line.trains.length === 0) continue;
      end = Math.max(end, line.endMin);
    }
    return end || 1410;
  }

  /**
   * 末班车回库后清空站台。保留队列会让第二天车站卡片继续显示“候车”，
   * 而这些乘客今天已经不可能再上车。
   */
  private clearWaitingQueuesAtEndOfService(): void {
    if (this.queues.size === 0) return;
    const a = this.agents;
    for (const queue of this.queues.values()) {
      for (const agent of queue) {
        if (a.state[agent] !== AgentState.Waiting) continue;
        this.stats.cancelled++;
        a.state[agent] = a.tripIsOut[agent] === 1 ? AgentState.IdleHome : AgentState.IdleWork;
        a.waitStation[agent] = -1;
        a.targetStation[agent] = -1;
        a.plans[agent] = null;
        a.planDirty[agent] = 0;
      }
    }
    this.queues.clear();
  }

  /** 跳过深夜：只有末班车跑完并回库后才跳，跳到当天第一班出发前。 */
  private maybeSkipNight(): boolean {
    if (!this.settings.skipNight) return false;
    const target = this.nightSkipTarget();
    if (this.time >= target - 1e-6) return false;
    if (!this.allTrainsParked()) return false;
    // 末班车已全部回库：还留在站台的乘客今天等不到车了，不能让队列跨日。
    if (this.timeOfDay() >= this.lastServiceEnd()) this.clearWaitingQueuesAtEndOfService();
    this.time = target;
    this.buildDayEvents();
    return true;
  }

  private integrate(dt: number): void {
    this.time += dt;
    this.updateTrains(dt);
    this.updateWalkers(dt);
    this.processDepartures(this.time);
    this.updateLinePeaks();
    this.replanDirtyWaiters();
    // 精确 A* 单条约 0.2–0.6ms；每 tick 只算几条，避免掉帧。
    // 没算完的人先在原地等（bgQueued），不会出现直线位移。
    this.processBackgroundRoutes(6, 2);
  }

  /** 快车坐满 / 停靠站调整后，候车乘客按最新线网重排（会自然改坐慢车）。 */
  private replanDirtyWaiters(): void {
    const a = this.agents;
    for (const [sid, queue] of this.queues) {
      let any = false;
      for (const agent of queue) {
        if (a.planDirty[agent] === 1 && a.state[agent] === AgentState.Waiting) {
          any = true;
          break;
        }
      }
      if (!any) continue;
      for (const agent of [...queue]) {
        if (a.planDirty[agent] !== 1 || a.state[agent] !== AgentState.Waiting) continue;
        a.planDirty[agent] = 0;
        this.replanAtStation(agent, sid);
      }
    }
  }

  /** 线路最高实时客流：每 tick 取各线车上人数，记录峰值。 */
  private updateLinePeaks(): void {
    for (const line of this.net.lines) {
      let onboard = 0;
      for (const id of line.trains) {
        const train = this.net.trainById.get(id);
        if (train) onboard += train.riders.length;
      }
      if (onboard > line.peakOnboard) line.peakOnboard = onboard;
    }
  }

  private handleBoundary(absMinute: number): void {
    const tod = absMinute % DAY_MINUTES;
    if (Math.abs(tod) < 1e-6) {
      this.settleDay();
      return;
    }
    if (Math.abs(tod - 410) < 1e-6) {
      if (this.settings.autoPause && !this.autoPauseDone.am) {
        this.autoPauseDone.am = true;
        this.emit({ type: 'peakSoon', kind: 'am' });
      }
      return;
    }
    if (Math.abs(tod - 1010) < 1e-6) {
      if (this.settings.autoPause && !this.autoPauseDone.pm) {
        this.autoPauseDone.pm = true;
        this.emit({ type: 'peakSoon', kind: 'pm' });
      }
      return;
    }
    if (
      Math.abs(tod - 420) < 1e-6 ||
      Math.abs(tod - 540) < 1e-6 ||
      Math.abs(tod - 1020) < 1e-6 ||
      Math.abs(tod - 1140) < 1e-6
    ) {
      const p = periodOf(tod + 1);
      this.emit({ type: 'period', peak: p.peak, label: p.label });
    }
  }

  // ————————————————————————— 事件 / 消息 —————————————————————————

  on(listener: (event: SimEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: SimEvent): void {
    for (const fn of this.listeners) fn(event);
  }

  // ————————————————————————— 每日结算 —————————————————————————

  private makeStats(day: number): DailyStats {
    return {
      day,
      trips: 0,
      ridership: 0,
      delivered: 0,
      revenue: 0,
      unserved: 0,
      cancelled: 0,
      unservedResidential: 0,
      unservedEmployment: 0,
      commuteSum: 0,
      commuteCount: 0,
    };
  }

  private isWeekend(day: number): boolean {
    const w = weekdayOf(day);
    return w === 0 || w === 6;
  }

  private isAgentActiveToday(agent: number, day = this.dayIndex()): boolean {
    const rule = this.agents.dayRule[agent] ?? 0;
    if (rule === 1) return !this.isWeekend(day);
    if (rule === 2) return this.isWeekend(day);
    return true;
  }

  private rebuildActivityChains(seed: number): void {
    // 规律者沿用固定 seed，连续几天走同一条回家路线；只有不规律者
    // 用当日 seed 重排任务。时间抖动每天都变，但不改变路线。
    // 同一天读档仍完全可复现。
    const daySeed = (seed ^ Math.imul(this.dayIndex() + 1, 0x9e3779b1)) >>> 0;
    const previous = this.activityChains;
    const nextChains = this.m1Model
      ? createM1ActivityChains(this.m1Model)
      : buildAgentActivityChains(this.agents, this.pois, this.pxPerKm, seed, {
          pureCommuter: this.pureCommuter,
          daySeed,
        });
    // 午夜仍在路上的人保留旧链，否则新链的 activityIndex 会对不上。
    for (let i = 0; i < this.agents.count; i++) {
      const st = this.agents.state[i];
      if (
        st !== AgentState.WalkToStation &&
        st !== AgentState.Waiting &&
        st !== AgentState.Riding &&
        st !== AgentState.WalkToDest &&
        st !== AgentState.InBackground
      ) {
        continue;
      }
      const old = previous[i];
      if (old && (this.activityIndex[i] ?? 0) < old.length) nextChains[i] = old;
    }
    this.activityChains = nextChains;
    // 城市增长会扩容 agents；活动链索引和背景路径必须跟着长。
    if (this.activityIndex.length !== this.agents.count) {
      const next = new Uint16Array(this.agents.count);
      next.set(this.activityIndex.subarray(0, Math.min(this.activityIndex.length, next.length)));
      this.activityIndex = next;
    }
    if (this.backgroundPaths.length !== this.agents.count) {
      const next = new Array<Array<[number, number]> | null>(this.agents.count).fill(null);
      const keep = Math.min(this.backgroundPaths.length, next.length);
      for (let i = 0; i < keep; i++) next[i] = this.backgroundPaths[i] ?? null;
      this.backgroundPaths = next;
      const q = new Uint8Array(this.agents.count);
      q.set(this.bgQueued.subarray(0, Math.min(this.bgQueued.length, q.length)));
      this.bgQueued = q;
    }
    if (this.walk1Paths.length !== this.agents.count) {
      this.walk1Paths = new Array<Array<[number, number]> | null>(this.agents.count).fill(null);
      this.walk2Paths = new Array<Array<[number, number]> | null>(this.agents.count).fill(null);
    }
  }

  activityStats(): {
    mode: boolean;
    demand: DemandMode;
    pureCommuter: boolean;
    agents: number;
    chains: number;
    trips: number;
    multiTripAgents: number;
    poiWorkers: number;
    backgroundTrips: number;
    metroTrips: number;
    walkNodes: number;
    walkRoutedTrips: number;
    walkFallbackTrips: number;
    walkChoice: boolean;
  } {
    let trips = 0;
    let multi = 0;
    let poiWorkers = 0;
    for (const chain of this.activityChains) {
      trips += chain.length;
      if (chain.length > 2) multi++;
    }
    for (let i = 0; i < this.agents.count; i++) {
      if (this.agents.workAtPoi[i] === 1) poiWorkers++;
    }
    return {
      mode: this.activityMode,
      demand: this.demandMode,
      pureCommuter: this.pureCommuter,
      agents: this.agents.count,
      chains: this.activityChains.length,
      trips,
      multiTripAgents: multi,
      poiWorkers,
      backgroundTrips: this.activityBackgroundTrips,
      metroTrips: this.activityMetroTrips,
      walkNodes: this.walkRouter?.nodeCount ?? 0,
      walkRoutedTrips: this.walkRoutedTrips,
      walkFallbackTrips: this.walkFallbackTrips,
      walkChoice: this.walkChoice,
    };
  }

  private countDailyTrips(): number {
    let total = 0;
    for (let i = 0; i < this.agents.count; i++) {
      if (!this.isAgentActiveToday(i)) continue;
      total += this.activityMode
        ? (this.activityChains[i]?.length ?? 0)
        : 1 + (this.agents.hasReturn[i] ? 1 : 0);
    }
    return total;
  }

  private buildDayEvents(): void {
    const day = this.dayIndex();
    const base = startOfDay(day);
    const events: DayEvent[] = [];
    for (let i = 0; i < this.agents.count; i++) {
      if (!this.isAgentActiveToday(i, day)) continue;
      if (this.activityMode) {
        const first = this.activityChains[i]?.[0];
        if (!first) continue;
        const outT = base + first.plannedDepart;
        if (outT > this.time + 1e-6) events.push({ t: outT, agent: i, kind: 0 });
        continue;
      }
      const outT = base + this.agents.outMin[i]!;
      if (outT > this.time + 1e-6) events.push({ t: outT, agent: i, kind: 0 });
      if (this.agents.hasReturn[i]) {
        const backT = base + this.agents.backMin[i]!;
        if (backT > this.time + 1e-6) events.push({ t: backT, agent: i, kind: 1 });
      }
    }
    events.sort((a, b) => a.t - b.t);
    this.dayEvents = events;
    this.dayCursor = 0;
  }

  private settleDay(): void {
    const settledDay = this.dayIndex() - 1;
    const revenue = this.stats.revenue;
    const cost = this.trainCost() + this.stationCost();
    this.fund += revenue - cost;
    const record: DayRecord = {
      day: settledDay,
      labelDay: settledDay + 1,
      ridership: this.stats.ridership,
      revenue,
      cost,
      fund: this.fund,
      delivered: this.stats.delivered,
      trips: this.stats.trips,
      unserved: this.stats.unserved,
      cancelled: this.stats.cancelled,
      reliability:
        this.stats.cancelled + this.stats.delivered > 0
          ? 1 - this.stats.cancelled / (this.stats.cancelled + this.stats.delivered)
          : 1,
      avgCommute:
        this.stats.commuteCount > 0 ? this.stats.commuteSum / this.stats.commuteCount : 0,
      trains: this.net.trains.length,
      stations: this.net.stations.length,
    };
    this.history.push(record);
    if (this.history.length > 120) this.history.shift();

    this.resetDaily();
    // 站点 800 m 内先长出新居民，再重选目的地 / 统计当日出行。
    this.growCity();
    // 线网变了就全量重选；没修线时每天只让约 15% 的 POI 出行换目的地，制造逐日波动。
    const networkChanged = this.poiChoiceVersion !== this.net.version;
    if (networkChanged) this.netAdaptDay = this.dayIndex();
    this.rechoosePoiDestinations(networkChanged ? 1 : 0.15);
    // 通勤族换工作地很慢：修线后要先过 3 天“适应期”，之后每天约 0.6%（约每周 4%）。
    // 不会出现“今天修完线、明天全城换工作”的情况。
    this.rechooseCommuters(this.dayIndex() - this.netAdaptDay >= 3 ? 0.006 : 0);
    // 线网完善后，原本通勤太远的失业者可以逐步找到工作；修线适应期后集中重试。
    // 没有修过线时不集中重试，只保留很慢的自然求职，避免开局第二天就全员就业。
    const adapted = this.netAdaptDay > -900 && this.dayIndex() - this.netAdaptDay >= 3;
    this.syncEmployment(adapted ? 1 : 0.02);
    if (this.activityMode) this.rebuildActivityChains(this.activitySeed);
    this.stats = this.makeStats(this.dayIndex());
    this.stats.trips = this.countDailyTrips();
    // 线路日客流归档：昨日 = 今天，最高 = 历史单日最大，然后清零。
    for (const line of this.net.lines) {
      line.ridersLastDay = line.ridersToday;
      if (line.ridersToday > line.ridersBestDay) line.ridersBestDay = line.ridersToday;
      line.ridersToday = 0;
    }
    this.autoPauseDone = { am: false, pm: false };
    // 不在 00:00 立刻跳夜间：先让末班车跑完，再由 maybeSkipNight 跳到第一班前。
    this.buildDayEvents();
    this.emit({ type: 'settle', record });
  }

  /** 当天最早的出发时刻（当日分钟）；没有出行时回退到 06:00。 */
  private firstDepartureMinute(day = this.dayIndex()): number {
    if (this.firstDepartureCache.day === day) return this.firstDepartureCache.minute;
    let min = Infinity;
    for (let i = 0; i < this.agents.count; i++) {
      if (!this.isAgentActiveToday(i, day)) continue;
      const t = this.agents.outMin[i]!;
      if (t < min) min = t;
    }
    const minute = Number.isFinite(min) ? min : 360;
    this.firstDepartureCache = { day, minute };
    return minute;
  }

  /** 夜间跳过的落点：第一班出发前 2 分钟，保证 5 点多的早班不被跳过。 */
  private nightSkipTarget(day = this.dayIndex()): number {
    const base = startOfDay(day);
    const first = this.firstDepartureMinute(day);
    return base + Math.max(0, first - 2);
  }

  private resetDaily(): void {
    const a = this.agents;
    for (let i = 0; i < a.count; i++) {
      const st = a.state[i]!;
      // 午夜不打断正在路上的人：步行 / 候车 / 乘车继续。
      if (
        st === AgentState.WalkToStation ||
        st === AgentState.Waiting ||
        st === AgentState.Riding ||
        st === AgentState.WalkToDest ||
        st === AgentState.InBackground
      ) {
        continue;
      }
      a.state[i] = AgentState.IdleHome;
      a.legIndex[i] = 0;
      a.walkLeft[i] = 0;
      a.planDirty[i] = 0;
      a.waitStation[i] = -1;
      a.targetStation[i] = -1;
      a.tripStart[i] = 0;
      a.plans[i] = null;
      this.activityIndex[i] = 0;
    }
    for (const station of this.net.stations) {
      const entries = this.entriesToday.get(station.id) ?? 0;
      const exits = this.exitsToday.get(station.id) ?? 0;
      if (entries > (station.entriesBest ?? 0)) station.entriesBest = entries;
      if (exits > (station.exitsBest ?? 0)) station.exitsBest = exits;
    }
    // 末班服务已结束：清空站台，并让仍在 Waiting 的人回到静止状态。
    for (const queue of this.queues.values()) {
      for (const agent of queue) {
        if (a.state[agent] !== AgentState.Waiting) continue;
        a.state[agent] = AgentState.IdleHome;
        a.waitStation[agent] = -1;
        a.targetStation[agent] = -1;
        a.plans[agent] = null;
      }
    }
    this.entriesToday.clear();
    this.exitsToday.clear();
    this.queues.clear();
    a.stopDone.fill(0);
    a.returnQueued.fill(0);
    this.stopHome.length = 0;
    this.pendingReturns.length = 0;
    this.activityPending.length = 0;
    this.activityBackgroundTrips = 0;
    this.activityMetroTrips = 0;
    this.walkRoutedTrips = 0;
    this.walkFallbackTrips = 0;
    // 车上乘客、步行者、背景出行继续走完；站台队列在收班后已清空。
  }

  // ————————————————————————— 目的地重选 —————————————————————————

  /**
   * 稳定伪随机：同一 agent、同一 salt 永远得到同一个数。
   * 刻意不带日期——重选时只有“时间变了”才会换目的地，不会因为跑了一天就全员抖动。
   */
  private destinationRng(agent: number, salt: number): number {
    let h =
      Math.imul(agent + 1, 0x85ebca6b) ^
      Math.imul(salt + 1, 0xc2b2ae35) ^
      0x9e3779b1;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h ^= h >>> 12;
    h = Math.imul(h, 0x297a2d39);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }

  /** 带日期的稳定随机：决定“今天谁换目的地”。
   *  同一天读档结果一致，跨天才会变——逐日波动与存档可复现两者都要。 */
  private choiceRng(agent: number, salt: number): number {
    let h =
      Math.imul(this.dayIndex() + 1, 0x9e3779b1) ^
      Math.imul(agent + 1, 0x85ebca6b) ^
      Math.imul(salt + 1, 0xc2b2ae35);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h ^= h >>> 12;
    h = Math.imul(h, 0x297a2d39);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }

  /** 没有地铁时的地面交通时间：6 分钟候车 + 18 km/h（公交 / 电动车混合）。 */
  private surfaceMinutes(zone: Zone, poi: MapPoi): number {
    const km = Math.hypot(poi.x - zone.x, poi.y - zone.y) / Math.max(1, this.pxPerKm);
    return 6 + (km / 18) * 60;
  }

  /**
   * 线网修好后可去的地方变多：按「吸引力 / 时间^α」重选 POI 目的地。
   * 时间取地面与地铁的较小值，所以新站 / 新线会让原本太远的 POI 进入选择集。
   * 线网版本变化后全量重选；没有修线时每天只让一小部分人换目的地。
   */
  private rechoosePoiDestinations(fraction = 1): void {
    // 纯通勤没有 POI 专项 agent，不必跑全量 POI 目的地重选。
    if (this.pureCommuter) return;
    if (fraction >= 1) {
      if (this.poiChoiceVersion === this.net.version) return;
      this.poiChoiceVersion = this.net.version;
    }

    const byGroup = new Map<number, MapPoi[]>();
    for (const poi of this.pois) {
      const group = POI_META[poi.type]?.group;
      if (group === null || group === undefined) continue;
      const list = byGroup.get(group);
      if (list) list.push(poi);
      else byGroup.set(group, [poi]);
    }
    if (byGroup.size === 0) return;

    // 只有“两端都在车站步行辐射内”的 OD 才可能坐地铁；先把这类点筛出来，
    // 避免为每个 组团 × POI 组合都跑一次 A*。
    const coveredZones = new Set<number>();
    const coveredPois = new Set<number>();
    if (this.net.stations.length > 0 && this.net.lines.length > 0) {
      const r = this.walkRadiusPx;
      for (const z of this.zones) {
        for (const s of this.net.stations) {
          if (Math.hypot(s.x - z.x, s.y - z.y) <= r) {
            coveredZones.add(z.id);
            break;
          }
        }
      }
      for (const p of this.pois) {
        for (const s of this.net.stations) {
          if (Math.hypot(s.x - p.x, s.y - p.y) <= r) {
            coveredPois.add(p.id);
            break;
          }
        }
      }
    }

    const a = this.agents;
    let touched = false;
    for (let i = 0; i < a.count; i++) {
      if (a.workAtPoi[i] === 1) continue;
      const candidates = byGroup.get(a.group[i]!);
      if (!candidates || candidates.length === 0) continue;
      // 日常小额重选：每天只让一部分人换目的地，制造逐日波动。
      if (fraction < 1 && this.choiceRng(i, 7001) >= fraction) continue;
      const zone = this.zoneMap.get(a.homeZone[i]!);
      if (!zone) continue;
      const zoneCovered = coveredZones.has(zone.id);
      let total = 0;
      const weights: number[] = [];
      for (const poi of candidates) {
        const surface = this.surfaceMinutes(zone, poi);
        const minutes = Math.max(
          8,
          zoneCovered && coveredPois.has(poi.id)
            ? Math.min(surface, this.odTravelMinutes(zone.id, poi))
            : surface,
        );
        const attraction = poiDailyMid(poi) * (0.75 + this.choiceRng(i, poi.id) * 0.5);
        const w = attraction / Math.pow(minutes / 10, poiDistanceAlpha(poi.level));
        weights.push(w);
        total += w;
      }
      if (!(total > 0)) continue;
      let r = this.choiceRng(i, 7919) * total;
      let pick = candidates[candidates.length - 1]!;
      for (let k = 0; k < candidates.length; k++) {
        r -= weights[k]!;
        if (r <= 0) {
          pick = candidates[k]!;
          break;
        }
      }
      const jitter = Math.min(90, pick.radiusKm * this.pxPerKm * 0.35);
      const angle = this.destinationRng(i, 104729) * Math.PI * 2;
      const rad = Math.sqrt(this.destinationRng(i, 1299709)) * jitter;
      a.workX[i] = pick.x + Math.cos(angle) * rad;
      a.workY[i] = pick.y + Math.sin(angle) * rad;
      a.workZone[i] = poiZoneId(pick);
      let salt = 0;
      const window = poiAgentWindow(pick, () => this.destinationRng(i, 15485863 + salt++));
      a.outMin[i] = Math.max(285, window.outMin);
      a.backMin[i] = window.backMin;
      a.dayRule[i] = window.dayRule;
      a.hasReturn[i] = 1;
      touched = true;
    }
    if (touched) this.rebuildOdPairs();
  }

  /** 组团 → 组团的机会时间：地面与地铁取小，按线网版本缓存。 */
  private zoneTravelCache = new Map<string, number>();
  private zoneTravelVersion = -1;

  private zoneTravelMinutes(from: Zone, to: Zone, covered: Set<number>): number {
    const km = Math.hypot(to.x - from.x, to.y - from.y) / Math.max(1, this.pxPerKm);
    const surface = 6 + (km / 18) * 60;
    if (!covered.has(from.id) || !covered.has(to.id)) return surface;
    if (this.zoneTravelVersion !== this.net.version) {
      this.zoneTravelCache.clear();
      this.zoneTravelVersion = this.net.version;
    }
    const key = `${from.id}:${to.id}`;
    const hit = this.zoneTravelCache.get(key);
    if (hit !== undefined) return Math.min(surface, hit);
    const plan = planTrip(this.net, from.x, from.y, to.x, to.y, {
      walkRadius: this.walkRadiusPx,
      walkSpeed: this.walkSpeed,
      pxPerKm: this.pxPerKm,
    });
    const value = plan ? plan.total : 999;
    this.zoneTravelCache.set(key, value);
    return Math.min(surface, value);
  }

  /** 两端都在车站步行辐射内的组团；没有线网时为空。 */
  private coveredZoneSet(): Set<number> {
    const covered = new Set<number>();
    if (this.net.stations.length === 0 || this.net.lines.length === 0) return covered;
    const r = this.walkRadiusPx;
    for (const z of this.zones) {
      for (const s of this.net.stations) {
        if (Math.hypot(s.x - z.x, s.y - z.y) <= r) {
          covered.add(z.id);
          break;
        }
      }
    }
    return covered;
  }

  // ————————————————————————— 就业 —————————————————————————

  /** 单程通勤接受上限（分钟）：同一 agent 稳定不变。 */
  private jobAcceptMinutes(agent: number): number {
    return Math.min(
      MAX_COMMUTE_MINUTES,
      JOB_ACCEPT_MIN + this.destinationRng(agent, 9001) * JOB_ACCEPT_SPAN,
    );
  }

  /** 建局校核：岗位通勤时间超过个人接受范围的人，先按灵活人群活动。 */
  private assignInitialEmployment(): void {
    // M1 合成人口的角色 / 岗位由模型自己决定，不在这里改。
    if (this.m1Model) return;
    const a = this.agents;
    const covered = this.coveredZoneSet();
    const allowFlexible = !this.pureCommuter;
    let touched = false;
    for (let i = 0; i < a.count; i++) {
      const group = a.group[i]!;
      if (group !== GROUP_COMMUTER && group !== GROUP_REVERSE && group !== GROUP_FLEXIBLE) {
        a.employed[i] = 0;
        continue;
      }
      // 本来就在灵活群体里的人算灵活就业，不需要固定岗位。
      if (a.jobGroup[i] === GROUP_FLEXIBLE) {
        a.employed[i] = 1;
        continue;
      }
      const from = this.zoneMap.get(a.homeZone[i]!);
      const to = this.zoneMap.get(a.workZone[i]!);
      let ok = false;
      if (from && to) {
        const km = Math.hypot(to.x - from.x, to.y - from.y) / Math.max(1, this.pxPerKm);
        const mode = modeForVehicle(a.vehicle[i]!, km);
        const actual = travelMinutes(mode, km, a.speedKmh[i]!);
        const accept = this.jobAcceptMinutes(i);
        // 岗位必须同时满足：组团时间在个人接受范围内，且实际方式不超过 2 小时。
        ok =
          this.zoneTravelMinutes(from, to, covered) <= accept &&
          actual <= MAX_COMMUTE_MINUTES;
      }
      a.employed[i] = ok ? 1 : 0;
      if (!ok && allowFlexible) {
        a.group[i] = GROUP_FLEXIBLE;
        a.workAtPoi[i] = 0;
        this.makeFlexible(i);
        touched = true;
      }
    }
    if (touched) this.rebuildOdPairs();
    // 一开始也只找“通勤接受范围内”的岗位：找不到才保持灵活 / 失业。
    this.syncEmployment(1);
  }

  /** 找不到工作时，把日常活动锚点换到家附近的商场 / 公园，而不是保留远处岗位。 */
  private makeFlexible(agent: number): void {
    const a = this.agents;
    const homeX = a.homeX[agent]!;
    const homeY = a.homeY[agent]!;
    const px = Math.max(1, this.pxPerKm);
    const pois = this.pois;
    const weights: number[] = [];
    let total = 0;
    for (const poi of pois) {
      if (poi.type !== 'mall' && poi.type !== 'park' && poi.type !== 'scenic') {
        weights.push(0);
        continue;
      }
      const km = Math.hypot(poi.x - homeX, poi.y - homeY) / px;
      if (km < 0.4 || km > 6) {
        weights.push(0);
        continue;
      }
      const w =
        (poiDailyMid(poi) * (0.75 + this.destinationRng(agent, 9100 + poi.id) * 0.5)) /
        Math.pow(km, 1.4);
      weights.push(w);
      total += w;
    }
    let anchor: MapPoi | null = null;
    if (total > 0) {
      let r = this.destinationRng(agent, 9199) * total;
      for (let k = 0; k < pois.length; k++) {
        r -= weights[k]!;
        if (r <= 0) {
          anchor = pois[k]!;
          break;
        }
      }
    }
    if (anchor) {
      const jitter = Math.min(90, anchor.radiusKm * px * 0.35);
      const angle = this.destinationRng(agent, 9201) * Math.PI * 2;
      const rad = Math.sqrt(this.destinationRng(agent, 9202)) * jitter;
      a.workX[agent] = anchor.x + Math.cos(angle) * rad;
      a.workY[agent] = anchor.y + Math.sin(angle) * rad;
      a.workZone[agent] = poiZoneId(anchor);
    } else {
      const angle = this.destinationRng(agent, 9203) * Math.PI * 2;
      const rad = (1 + this.destinationRng(agent, 9204) * 3) * px;
      a.workX[agent] = Math.max(24, Math.min(WORLD_W - 24, homeX + Math.cos(angle) * rad));
      a.workY[agent] = Math.max(24, Math.min(WORLD_H - 24, homeY + Math.sin(angle) * rad));
      a.workZone[agent] = a.homeZone[agent]!;
    }
    const rr = this.destinationRng(agent, 9205);
    const out =
      rr < 0.45 ? 600 + this.destinationRng(agent, 9206) * 90
        : rr < 0.82 ? 780 + this.destinationRng(agent, 9207) * 120
          : 1020 + this.destinationRng(agent, 9208) * 110;
    a.outMin[agent] = clamp(out, 420, 1290);
    a.backMin[agent] = clamp(
      out + 90 + this.destinationRng(agent, 9209) * 220,
      a.outMin[agent]! + 45,
      1435,
    );
    a.hasReturn[agent] = this.destinationRng(agent, 9210) < 0.8 ? 1 : 0;
    a.dayRule[agent] = 0;
  }

  /** 就业组团及其岗位点；按线网版本缓存。 */
  private employmentZoneCells(): Array<{ zone: Zone; cells: PopulationDot[] }> {
    if (this.jobCacheVersion !== this.net.version) {
      this.jobCacheVersion = this.net.version;
      this.jobMinutesCache.clear();
      this.jobZoneCache = [];
      const byZone = new Map<number, PopulationDot[]>();
      for (const d of this.dots) {
        if (d.kind !== 'employment') continue;
        const list = byZone.get(d.zone);
        if (list) list.push(d);
        else byZone.set(d.zone, [d]);
      }
      for (const zone of this.zones) {
        const cells = byZone.get(zone.id);
        if (zone.kind === 'employment' && cells && cells.length > 0) {
          this.jobZoneCache.push({ zone, cells });
        }
      }
    }
    return this.jobZoneCache;
  }

  /** 从某个家组团出发，在可接受时间内能到的岗位组团（按时间排序）。 */
  private jobCandidates(
    from: Zone,
    covered: Set<number>,
  ): Array<{ zone: Zone; minutes: number; cells: PopulationDot[] }> {
    if (this.jobCacheVersion !== this.net.version) this.employmentZoneCells();
    const hit = this.jobMinutesCache.get(from.id);
    if (hit) return hit;
    const nearby = this.employmentZoneCells()
      .map((item) => ({
        item,
        km: Math.hypot(item.zone.x - from.x, item.zone.y - from.y) / Math.max(1, this.pxPerKm),
      }))
      .sort((a, b) => a.km - b.km)
      .slice(0, JOB_ZONE_LIMIT);
    const list: Array<{ zone: Zone; minutes: number; cells: PopulationDot[] }> = [];
    for (const { item } of nearby) {
      const minutes = Math.max(1, this.zoneTravelMinutes(from, item.zone, covered));
      if (minutes <= JOB_SEARCH_LIMIT) {
        list.push({ zone: item.zone, minutes, cells: item.cells });
      }
    }
    list.sort((a, b) => a.minutes - b.minutes);
    this.jobMinutesCache.set(from.id, list);
    return list;
  }

  /** 失业者按“岗位数 / 通勤时间²”找工作，且只接受个人通勤范围内的岗位。 */
  private syncEmployment(fraction = 1): void {
    if (fraction <= 0) return;
    const a = this.agents;
    const covered = this.coveredZoneSet();
    if (this.employmentZoneCells().length === 0) return;
    let touched = false;
    for (let i = 0; i < a.count; i++) {
      if (a.employed[i] === 1) continue;
      const jobGroup = a.jobGroup[i]!;
      if (jobGroup > GROUP_FLEXIBLE) continue;
      const from = this.zoneMap.get(a.homeZone[i]!);
      if (!from) continue;
      if (fraction < 1 && this.choiceRng(i, 9301) >= fraction) continue;
      const accept = this.jobAcceptMinutes(i);
      let total = 0;
      const weights: number[] = [];
      const picks: Array<{ cand: (typeof candidates)[number]; actual: number }> = [];
      const candidates = this.jobCandidates(from, covered);
      for (const c of candidates) {
        const km =
          Math.hypot(c.zone.x - from.x, c.zone.y - from.y) / Math.max(1, this.pxPerKm);
        const mode = modeForVehicle(a.vehicle[i]!, km);
        const actual = travelMinutes(mode, km, a.speedKmh[i]!);
        // 组团时间与真实方式时间都要在个人接受范围内，且不能超过 2 小时。
        if (actual > accept || actual > MAX_COMMUTE_MINUTES) continue;
        const jobs = c.cells.length;
        const w =
          (jobs * (0.75 + this.destinationRng(i, 9300 + c.zone.id) * 0.5)) /
          Math.pow(Math.max(1, actual) / 10, 2.0);
        picks.push({ cand: c, actual });
        weights.push(w);
        total += w;
      }
      if (!(total > 0)) continue;
      let r = this.destinationRng(i, 9399) * total;
      let pick = picks[weights.length - 1]!;
      for (let k = 0; k < weights.length; k++) {
        r -= weights[k]!;
        if (r <= 0) {
          pick = picks[k]!;
          break;
        }
      }
      const cell =
        pick.cand.cells[Math.floor(this.destinationRng(i, 9400) * pick.cand.cells.length)] ??
        pick.cand.cells[0]!;
      this.assignJob(i, pick.cand.zone, cell, pick.actual);
      touched = true;
    }
    if (touched) this.rebuildOdPairs();
  }

  /** 给失业者安排一个可接受的岗位，并重排当天的上下班时间。 */
  private assignJob(agent: number, zone: Zone, cell: PopulationDot, minutes: number): void {
    const a = this.agents;
    const angle = this.destinationRng(agent, 9501) * Math.PI * 2;
    const rad = Math.sqrt(this.destinationRng(agent, 9502)) * 45;
    a.workX[agent] = cell.x + Math.cos(angle) * rad;
    a.workY[agent] = cell.y + Math.sin(angle) * rad;
    a.workZone[agent] = zone.id;
    a.workAtPoi[agent] = 0;
    a.group[agent] = GROUP_COMMUTER;
    a.jobGroup[agent] = GROUP_COMMUTER;
    a.employed[agent] = 1;
    const start = 482 + (this.destinationRng(agent, 9503) - 0.5) * 50;
    const end = 1055 + (this.destinationRng(agent, 9504) - 0.5) * 70;
    a.outMin[agent] = clamp(start - minutes - 5, 285, 690);
    a.backMin[agent] = clamp(
      end + minutes + 3 + this.destinationRng(agent, 9505) * 9,
      a.outMin[agent]! + 45,
      1435,
    );
    a.hasReturn[agent] = this.destinationRng(agent, 9506) < 0.94 ? 1 : 0;
    a.dayRule[agent] = this.destinationRng(agent, 9507) < 0.9 ? 1 : 0;
  }

  /** 劳动力 = 通勤 / 反向 / 灵活；学生、就医、休闲、接驳不计入。 */
  employmentStats(): { employed: number; laborForce: number; rate: number } {
    const a = this.agents;
    let employed = 0;
    let laborForce = 0;
    for (let i = 0; i < a.count; i++) {
      const group = a.group[i]!;
      // M1 的 group 2 同时包含退休者；只有 worker（group 0）算劳动力。
      if (this.m1Model) {
        if (group !== GROUP_COMMUTER) continue;
      } else if (group > GROUP_FLEXIBLE) {
        continue;
      }
      laborForce++;
      if (a.employed[i] === 1) employed++;
    }
    return {
      employed,
      laborForce,
      rate: laborForce > 0 ? employed / laborForce : 0,
    };
  }

  /** 读旧存档后重新校核就业（新存档已带 employed 字段）。 */
  refreshEmployment(): void {
    this.assignInitialEmployment();
  }

  /**
   * 读档后恢复在途路径。
   * 路径折线没有进存档；如果直接继续，热力会因为没有 path 而退回两点直线。
   * 这里按当前路网重算接驳步行，背景出行重新排队（等路径就绪再走）。
   */
  restoreTransitPaths(): void {
    if (!this.walkRouter) return;
    const a = this.agents;
    for (let i = 0; i < a.count; i++) {
      const st = a.state[i];
      if (st === AgentState.WalkToStation) {
        const s = this.net.stationById.get(a.targetStation[i]!);
        if (!s) continue;
        const out = a.tripIsOut[i] === 1;
        const ox = out ? a.homeX[i]! : a.workX[i]!;
        const oy = out ? a.homeY[i]! : a.workY[i]!;
        const route = this.walkRouter.route({ x: ox, y: oy }, s, 'walk', 160);
        this.walk1Paths[i] = route?.path ?? null;
      } else if (st === AgentState.WalkToDest) {
        const s = this.net.stationById.get(a.targetStation[i]!);
        if (!s) continue;
        const route = this.walkRouter.route(
          s,
          { x: a.tripDestX[i]!, y: a.tripDestY[i]! },
          'walk',
          160,
        );
        this.walk2Paths[i] = route?.path ?? null;
      } else if (st === AgentState.InBackground && !this.backgroundPaths[i]) {
        const fromX = a.bgFromX[i]!;
        const fromY = a.bgFromY[i]!;
        const toX = a.tripDestX[i]!;
        const toY = a.tripDestY[i]!;
        const mode = (a.bgMode[i]! & 3) as 0 | 1 | 2 | 3;
        const key = this.backgroundPathKey(fromX, fromY, toX, toY, mode);
        if (this.backgroundPathCache.has(key)) {
          this.backgroundPaths[i] = this.backgroundPathCache.get(key) ?? null;
          continue;
        }
        const waiters = this.backgroundWaiters.get(key);
        if (waiters) {
          if (!waiters.includes(i)) waiters.push(i);
          this.bgQueued[i] = 1;
        } else if (this.backgroundQueue.length < MAX_BACKGROUND_QUEUE) {
          this.backgroundWaiters.set(key, [i]);
          this.backgroundQueue.push({ agent: i, fromX, fromY, toX, toY, mode });
          this.bgQueued[i] = 1;
        }
      }
    }
  }

  /**
   * 通勤族换工作地：线网修好后，原本太远的就业组团进入可选范围。
   * 概率很小（修线约 8%、平时每天约 2%），避免整张 OD 表被一次建设打乱。
   */
  private rechooseCommuters(fraction: number): void {
    if (fraction <= 0) return;
    const a = this.agents;
    const employmentZones = this.zones.filter((z) => z.kind === 'employment');
    if (employmentZones.length === 0) return;

    const cellsByZone = new Map<number, PopulationDot[]>();
    for (const d of this.dots) {
      if (d.kind !== 'employment') continue;
      const list = cellsByZone.get(d.zone);
      if (list) list.push(d);
      else cellsByZone.set(d.zone, [d]);
    }
    const candidates = employmentZones.filter((z) => (cellsByZone.get(z.id)?.length ?? 0) > 0);
    if (candidates.length === 0) return;

    const covered = this.coveredZoneSet();
    let touched = false;
    for (let i = 0; i < a.count; i++) {
      if (a.group[i] !== GROUP_COMMUTER) continue;
      // 在 POI 上班的人不能被“换工作地”重选到就业区。
      if (a.workAtPoi[i] === 1) continue;
      if (this.choiceRng(i, 8101) >= fraction) continue;
      const from = this.zoneMap.get(a.homeZone[i]!);
      if (!from) continue;
      const accept = this.jobAcceptMinutes(i);
      let total = 0;
      const weights: number[] = [];
      for (const zone of candidates) {
        const jobs = cellsByZone.get(zone.id)?.length ?? 1;
        const minutes = Math.max(8, this.zoneTravelMinutes(from, zone, covered));
        if (minutes > accept) {
          weights.push(0);
          continue;
        }
        const noise = 0.75 + this.choiceRng(i, 8200 + zone.id) * 0.5;
        const w = (jobs * noise) / Math.pow(minutes / 10, 2.0);
        weights.push(w);
        total += w;
      }
      if (!(total > 0)) continue;
      let r = this.choiceRng(i, 8300) * total;
      let pick = candidates[candidates.length - 1]!;
      for (let k = 0; k < candidates.length; k++) {
        r -= weights[k]!;
        if (r <= 0) {
          pick = candidates[k]!;
          break;
        }
      }
      if (pick.id === a.workZone[i]) continue;
      const cells = cellsByZone.get(pick.id)!;
      const cell = cells[Math.floor(this.choiceRng(i, 8400) * cells.length)] ?? cells[0]!;
      a.workX[i] = cell.x;
      a.workY[i] = cell.y;
      a.workZone[i] = pick.id;
      touched = true;
    }
    if (touched) this.rebuildOdPairs();
  }

  /**
   * 城市影响：站点 800 m 内的住宅组团每天长出少量新居民（新 agent）。
   * 每组团最多长到初始点阵的 1.4 倍；没人服务的组团不增长。
   */
  private growCity(): void {
    if (this.net.stations.length === 0) return;
    const px = Math.max(1, this.pxPerKm);
    const radius = px * 0.8;
    const dotsByZone = new Map<number, PopulationDot[]>();
    const countByZone = new Map<number, number>();
    for (const d of this.dots) {
      const list = dotsByZone.get(d.zone);
      if (list) list.push(d);
      else dotsByZone.set(d.zone, [d]);
      countByZone.set(d.zone, (countByZone.get(d.zone) ?? 0) + 1);
    }
    const employmentZones = this.zones.filter(
      (z) => z.kind === 'employment' && (countByZone.get(z.id) ?? 0) > 0,
    );
    if (employmentZones.length === 0) return;

    const additions: Array<{ zone: Zone; n: number }> = [];
    for (const z of this.zones) {
      if (z.kind !== 'residential' || z.dots <= 0) continue;
      let near = false;
      for (const s of this.net.stations) {
        if (Math.hypot(s.x - z.x, s.y - z.y) <= radius) {
          near = true;
          break;
        }
      }
      if (!near) continue;
      const cur = countByZone.get(z.id) ?? 0;
      // 以“开局时的点阵数”为基数，最多长 50%；不能直接用 z.dots（实际采样点数比它多）。
      let base = this.growthBase.get(z.id);
      if (base === undefined) {
        base = cur;
        this.growthBase.set(z.id, base);
      }
      const cap = Math.round(base * 1.5);
      if (cur >= cap) continue;
      const rate = 0.03 * (0.6 + this.destinationRng(z.id, 9901) * 0.8);
      const n = Math.min(cap - cur, Math.floor(cur * rate));
      if (n > 0) additions.push({ zone: z, n });
    }
    if (additions.length === 0) return;

    let total = 0;
    for (const add of additions) total += add.n;
    const before = this.agents;
    const grown = ensureAgentCapacity(before, before.count + total);
    if (grown !== before) this.agents = grown;
    const ag = this.agents;
    let i = ag.count;

    for (const add of additions) {
      const homeDots = dotsByZone.get(add.zone.id) ?? [];
      if (homeDots.length === 0) continue;
      for (let k = 0; k < add.n; k++, i++) {
        const home = homeDots[Math.floor(this.destinationRng(i, 9910) * homeDots.length)]!;
        // 选就业组团：岗位越多、离新家越近越可能。
        let wTotal = 0;
        const ws: number[] = [];
        for (const z of employmentZones) {
          const d = Math.hypot(z.x - home.x, z.y - home.y) / px;
          const jobs = countByZone.get(z.id) ?? 1;
          const w = jobs / Math.pow(Math.max(0.5, d), 1.5);
          ws.push(w);
          wTotal += w;
        }
        let r = this.destinationRng(i, 9911) * wTotal;
        let work = employmentZones[0]!;
        for (let m = 0; m < employmentZones.length; m++) {
          r -= ws[m]!;
          if (r <= 0) {
            work = employmentZones[m]!;
            break;
          }
        }
        const workDots = dotsByZone.get(work.id) ?? [];
        const dest = workDots[Math.floor(this.destinationRng(i, 9912) * workDots.length)] ?? work;

        const km = Math.hypot(dest.x - home.x, dest.y - home.y) / px;
        const commute = (km / 20) * 60 + 9;
        ag.group[i] = GROUP_COMMUTER;
        ag.jobGroup[i] = GROUP_COMMUTER;
        ag.employed[i] = 1;
        ag.dayRule[i] = this.destinationRng(i, 9913) < 0.9 ? 1 : 0;
        ag.hasReturn[i] = this.destinationRng(i, 9914) < 0.94 ? 1 : 0;
        ag.homeX[i] = home.x;
        ag.homeY[i] = home.y;
        ag.homeZone[i] = add.zone.id;
        ag.workX[i] = dest.x;
        ag.workY[i] = dest.y;
        ag.workZone[i] = work.id;
        ag.outMin[i] = Math.min(
          690,
          Math.max(285, 482 + (this.destinationRng(i, 9915) - 0.5) * 50 - commute),
        );
        ag.backMin[i] = Math.min(1435, ag.outMin[i]! + 560 + this.destinationRng(i, 9916) * 40);
        ag.state[i] = 0;
        this.dots.push({ x: home.x, y: home.y, kind: 'residential', zone: add.zone.id });
      }
    }
    ag.count = i;
    if (this.activityMode && this.activityIndex.length < ag.count) {
      const next = new Uint16Array(ag.count);
      next.set(this.activityIndex);
      this.activityIndex = next;
    }
    if (i > 0) this.rebuildOdPairs();
  }

  /** 目的地重选后同步 OD 聚合（流带与组团摘要都读它）。 */
  private rebuildOdPairs(): void {
    const a = this.agents;
    const map = new Map<string, ZoneOdPair>();
    for (let i = 0; i < a.count; i++) {
      const key = `${a.homeZone[i]}-${a.workZone[i]}-${a.group[i]}`;
      const hit = map.get(key);
      if (hit) hit.count++;
      else
        map.set(key, {
          from: a.homeZone[i]!,
          to: a.workZone[i]!,
          group: a.group[i]!,
          count: 1,
        });
    }
    this.odPairs = [...map.values()];
  }

  // ————————————————————————— 乘客 —————————————————————————

  private markUnserved(agent: number, goingOut: boolean): void {
    const a = this.agents;
    const zoneId = goingOut ? a.homeZone[agent]! : a.workZone[agent]!;
    const kind = this.zoneMap.get(zoneId)?.kind ?? 'employment';
    this.stats.unserved++;
    if (kind === 'residential') this.stats.unservedResidential++;
    else this.stats.unservedEmployment++;
  }

  private handleDeparture(event: DayEvent): void {
    const a = this.agents;
    const i = event.agent;
    if (this.activityMode) {
      if (event.kind === 0 && a.state[i] === AgentState.IdleHome) {
        this.startActivityTrip(i, 0);
      }
      return;
    }
    if (event.kind === 0) {
      if (a.state[i] !== AgentState.IdleHome) return;
      this.startTrip(i, a.homeX[i]!, a.homeY[i]!, a.workX[i]!, a.workY[i]!, true);
      return;
    }
    // 已经按“实际到达 + 停留”排过返程的人，忽略预排的 backMin 事件。
    if (a.returnQueued[i]) return;
    this.beginReturn(i);
  }

  /** 返程：可能先顺路去一两个地方，再回家。 */
  private beginReturn(i: number): void {
    const a = this.agents;
    if (!a.hasReturn[i] || a.state[i] !== AgentState.IdleWork) return;
    if (a.stopDone[i] === 0) {
      const chain = this.stopChain(i);
      const stop = chain[0];
      if (stop) {
        a.stopDone[i] = 1;
        // 顺路点多出来的段也算当日出行。
        this.stats.trips += chain.length;
        this.startTrip(i, a.workX[i]!, a.workY[i]!, stop.x, stop.y, false);
        // 顺路点去不了（没有线路可达）：startTrip 已按未服务把人放回家，不再补一趟。
        if (Number(a.state[i]) === AgentState.IdleHome) a.stopDone[i] = 0;
        return;
      }
    }
    this.startTrip(i, a.workX[i]!, a.workY[i]!, a.homeX[i]!, a.homeY[i]!, false);
  }

  private startActivityTrip(i: number, index: number): void {
    const chain = this.activityChains[i];
    const trip = chain?.[index];
    if (!trip) return;
    const a = this.agents;
    if (a.state[i] !== AgentState.IdleHome && a.state[i] !== AgentState.IdleWork) return;

    this.activityIndex[i] = index;
    a.tripStart[i] = this.time;
    a.tripIsOut[i] = trip.toHome ? 0 : 1;
    a.tripDestX[i] = trip.toX;
    a.tripDestY[i] = trip.toY;
    a.planDirty[i] = 0;
    a.stopDone[i] = 0;
    a.returnQueued[i] = 0;
    this.walk1Paths[i] = null;
    this.walk2Paths[i] = null;
    let walk1Path: Array<[number, number]> | null = null;
    let walk2Path: Array<[number, number]> | null = null;

    const accessStation =
      this.walkChoice && this.walkRouter
        ? (fromX: number, fromY: number, stationX: number, stationY: number) =>
            this.walkRouter?.stationAccess(
              { x: fromX, y: fromY },
              { x: stationX, y: stationY },
            ) ?? null
        : undefined;
    const plan = planTrip(this.net, trip.fromX, trip.fromY, trip.toX, trip.toY, {
      walkRadius: this.walkRadiusPx,
      walkSpeed: this.walkSpeed,
      pxPerKm: this.pxPerKm,
      accessStation,
    });
    if (!plan || plan.legs.length === 0) {
      if (this.walkRouter) this.walkFallbackTrips++;
      this.startBackgroundActivityTrip(i, trip);
      return;
    }

    if (this.walkRouter && !this.walkChoice) {
      const originStation = this.net.stationById.get(plan.origin);
      const destStation = this.net.stationById.get(plan.dest);
      const walk1 = originStation
        ? this.walkRouter.route({ x: trip.fromX, y: trip.fromY }, originStation)
        : null;
      const walk2 = destStation
        ? this.walkRouter.route(destStation, { x: trip.toX, y: trip.toY })
        : null;
      if (!walk1 || !walk2) {
        this.walkFallbackTrips++;
        this.startBackgroundActivityTrip(i, trip);
        return;
      }
      const before = plan.walk1 + plan.walk2;
      plan.walk1 = walk1.minutes;
      plan.walk2 = walk2.minutes;
      plan.total += walk1.minutes + walk2.minutes - before;
      walk1Path = walk1.path;
      walk2Path = walk2.path;
      this.walkRoutedTrips++;
    } else if (this.walkRouter) {
      // M4: planTrip already used the graph to choose both stations.
      // 接驳也走真实步行图，不再用 48px 粗网格。
      const originStation = this.net.stationById.get(plan.origin);
      const destStation = this.net.stationById.get(plan.dest);
      const walk1 =
        originStation && plan.walk1 > 0.001
          ? this.walkRouter.route({ x: trip.fromX, y: trip.fromY }, originStation, 'walk', 160)
          : null;
      const walk2 =
        destStation && plan.walk2 > 0.001
          ? this.walkRouter.route(destStation, { x: trip.toX, y: trip.toY }, 'walk', 160)
          : null;
      if ((plan.walk1 > 0.001 && !walk1) || (plan.walk2 > 0.001 && !walk2)) {
        this.walkFallbackTrips++;
        this.startBackgroundActivityTrip(i, trip);
        return;
      }
      const before = plan.walk1 + plan.walk2;
      if (walk1) plan.walk1 = walk1.minutes;
      if (walk2) plan.walk2 = walk2.minutes;
      plan.total += plan.walk1 + plan.walk2 - before;
      walk1Path = walk1?.path ?? null;
      walk2Path = walk2?.path ?? null;
      this.walkRoutedTrips++;
    }

    if (this.walkRouter) {
      // M3/M4 才做真实方式比较：地铁必须比步行 / 电动车 / 公交 / 汽车快 15%。
      // 默认纯通勤（M2）没有步行图，先按“有地铁方案就坐地铁”保证线网有客流。
      const background = travelMinutes(trip.mode, trip.distanceKm, trip.speedKmh);
      if (plan.total > background * 1.15) {
        this.startBackgroundActivityTrip(i, trip);
        return;
      }
    }

    if (!this.acceptsStationAccess(i, plan, !trip.toHome, index)) {
      this.startBackgroundActivityTrip(i, trip);
      return;
    }

    a.plans[i] = plan;
    a.legIndex[i] = 0;
    this.walk1Paths[i] = walk1Path;
    this.walk2Paths[i] = walk2Path;
    this.activityMetroTrips++;
    if (plan.legs.length > 0) this.stats.revenue += this.fareForKm(this.planDistanceKm(plan));
    if (plan.walk1 <= 0.001) {
      this.addToWait(i, plan.origin);
      return;
    }
    a.state[i] = AgentState.WalkToStation;
    a.walkLeft[i] = plan.walk1;
    a.targetStation[i] = plan.origin;
  }

  /** No suitable metro path: still make the activity via a background mode. */
  private startBackgroundActivityTrip(i: number, trip: AgentActivityTrip): void {
    const a = this.agents;
    const minutes = Math.max(0.2, travelMinutes(trip.mode, trip.distanceKm, trip.speedKmh));
    const mode = trip.mode === 'walk' ? 0 : trip.mode === 'ebike' ? 1 : trip.mode === 'bus' ? 2 : 3;
    let path: Array<[number, number]> | null = null;
    let queued = false;
    if (this.walkRouter && !this.map) {
      const key = this.backgroundPathKey(trip.fromX, trip.fromY, trip.toX, trip.toY, mode);
      if (this.backgroundPathCache.has(key)) {
        path = this.backgroundPathCache.get(key) ?? null;
      } else {
        // 所有方式都走真实路网（步行图 / 机动车图），单条约 0.2–0.6ms。
        // 算不出来之前先原地等，绝不按两点直线先走。
        const waiters = this.backgroundWaiters.get(key);
        if (waiters) {
          if (!waiters.includes(i)) waiters.push(i);
          queued = true;
        } else if (this.backgroundQueue.length < MAX_BACKGROUND_QUEUE) {
          this.backgroundWaiters.set(key, [i]);
          this.backgroundQueue.push({
            agent: i,
            fromX: trip.fromX,
            fromY: trip.fromY,
            toX: trip.toX,
            toY: trip.toY,
            mode,
          });
          queued = true;
        }
      }
    }
    a.plans[i] = null;
    a.targetStation[i] = -1;
    a.state[i] = AgentState.InBackground;
    a.walkLeft[i] = minutes;
    a.bgFromX[i] = trip.fromX;
    a.bgFromY[i] = trip.fromY;
    a.bgTotal[i] = minutes;
    a.bgMode[i] = mode;
    this.backgroundPaths[i] = path;
    this.bgQueued[i] = queued ? 1 : 0;
    this.activityBackgroundTrips++;
  }

  private backgroundPathKey(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    mode: number,
  ): string {
    return `${mode}:${Math.round(fromX / 12)},${Math.round(fromY / 12)}>${Math.round(toX / 12)},${Math.round(toY / 12)}`;
  }

  private rememberBackgroundPath(key: string, path: Array<[number, number]> | null): void {
    if (!this.backgroundPathCache.has(key) && this.backgroundPathCache.size >= MAX_BACKGROUND_CACHE) {
      const oldest = this.backgroundPathCache.keys().next().value;
      if (oldest !== undefined) this.backgroundPathCache.delete(oldest);
    }
    this.backgroundPathCache.set(key, path);
  }

  /** Process a few OD routes per simulation tick; a full day has thousands. */
  private processBackgroundRoutes(limit = 16, budgetMs = 3): void {
    if (!this.walkRouter || this.backgroundQueue.length === 0) return;
    const a = this.agents;
    const now = (): number =>
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    const started = now();
    let done = 0;
    while (this.backgroundQueue.length > 0 && done < limit) {
      if (done > 0 && now() - started > budgetMs) break;
      const req = this.backgroundQueue.shift()!;
      const key = this.backgroundPathKey(req.fromX, req.fromY, req.toX, req.toY, req.mode);
      const waiters = this.backgroundWaiters.get(key) ?? [req.agent];
      this.backgroundWaiters.delete(key);
      // 排队期间很多人已经步行/骑车到达。先剔除不再处于该次后台行程的等待者，
      // 避免为已经结束的行程白跑一次 A*。
      const live: number[] = [];
      for (const agent of waiters) {
        if (
          a.state[agent] === AgentState.InBackground &&
          Math.abs(a.bgFromX[agent]! - req.fromX) < 0.01 &&
          Math.abs(a.bgFromY[agent]! - req.fromY) < 0.01
        ) {
          live.push(agent);
        }
      }
      if (live.length === 0) {
        done++;
        continue;
      }
      let path = this.backgroundPathCache.get(key);
      let routeMinutes = this.backgroundMinutesCache.get(key);
      if (path === undefined) {
        const from = { x: req.fromX, y: req.fromY };
        const to = { x: req.toX, y: req.toY };
        if (req.mode === 3) {
          // 汽车：步行接入 → 机动车主路 → 步行接出。
          const car = this.walkRouter.carRoute(from, to, 160);
          if (car) {
            path = car.path;
            routeMinutes = car.minutes;
          } else {
            const walk = this.walkRouter.route(from, to, 'walk', 160);
            path = walk?.path ?? null;
            routeMinutes = walk?.minutes;
          }
        } else if (req.mode === 2) {
          // 公交：当前没有线路/班次，仍按机动车图近似；失败回退步行。
          const vehicle = this.walkRouter.route(from, to, 'vehicle', 160);
          const walk = vehicle ?? this.walkRouter.route(from, to, 'walk', 160);
          path = walk?.path ?? null;
          routeMinutes = walk?.minutes;
        } else {
          // 步行 / 电动车：和地铁接驳一样走真实步行图。
          const walk = this.walkRouter.route(from, to, 'walk', 160);
          path = walk?.path ?? null;
          routeMinutes = walk?.minutes;
        }
        this.rememberBackgroundPath(key, path);
        if (routeMinutes !== undefined) {
          if (!this.backgroundMinutesCache.has(key) && this.backgroundMinutesCache.size >= MAX_BACKGROUND_CACHE) {
            const oldest = this.backgroundMinutesCache.keys().next().value;
            if (oldest !== undefined) this.backgroundMinutesCache.delete(oldest);
          }
          this.backgroundMinutesCache.set(key, routeMinutes);
        }
      }
      for (const agent of live) {
        if (
          a.state[agent] === AgentState.InBackground &&
          Math.abs(a.bgFromX[agent]! - req.fromX) < 0.01 &&
          Math.abs(a.bgFromY[agent]! - req.fromY) < 0.01
        ) {
          this.bgQueued[agent] = 0;
          this.backgroundPaths[agent] = path ?? null;
          if (path && routeMinutes !== undefined) {
            // 等待期间原地不动，路径就绪后按真实路线重新计时。
            // 读档时若人已经走了一半，按原进度落到新路径上，避免瞬移回起点。
            const oldTotal = a.bgTotal[agent]!;
            const oldLeft = a.walkLeft[agent]!;
            const frac =
              oldTotal > 0.05 ? Math.max(0, Math.min(1, 1 - oldLeft / oldTotal)) : 0;
            a.bgTotal[agent] = Math.max(0.2, routeMinutes);
            a.walkLeft[agent] = Math.max(0.2, routeMinutes * (1 - frac));
          }
        }
      }
      done++;
    }
  }

  private startTrip(
    i: number,
    sx: number,
    sy: number,
    dx: number,
    dy: number,
    goingOut: boolean,
  ): void {
    const a = this.agents;
    a.tripStart[i] = this.time;
    a.tripIsOut[i] = goingOut ? 1 : 0;
    a.tripDestX[i] = dx;
    a.tripDestY[i] = dy;
    a.planDirty[i] = 0;
    this.walk1Paths[i] = null;
    this.walk2Paths[i] = null;
    const plan = planTrip(this.net, sx, sy, dx, dy, {
      walkRadius: this.walkRadiusPx,
      walkSpeed: this.walkSpeed,
      pxPerKm: this.pxPerKm,
    });
    if (!plan) {
      this.markUnserved(i, goingOut);
      a.state[i] = goingOut ? AgentState.IdleWork : AgentState.IdleHome;
      a.plans[i] = null;
      return;
    }
    // 站点辐射不是硬边界：按步行距离的概率决定这次是否真的坐地铁。
    if (plan.legs.length > 0 && !this.acceptsStationAccess(i, plan, goingOut)) {
      this.markUnserved(i, goingOut);
      a.state[i] = goingOut ? AgentState.IdleWork : AgentState.IdleHome;
      a.plans[i] = null;
      return;
    }
    // 硬截止 POI：按当前线网时间估算，赶不上截止就取消当天这次出行。
    if (goingOut && a.workAtPoi[i] !== 1) {
      const poi = this.poiByZone.get(a.workZone[i]!);
      if (poi && poi.profile === 'hard' && this.timeOfDay() + plan.total > poi.closeMin) {
        this.stats.cancelled++;
        a.state[i] = AgentState.IdleHome;
        a.plans[i] = null;
        return;
      }
    }
    a.plans[i] = plan;
    a.legIndex[i] = 0;
    // 上车前按这趟的线网里程计价；一次出行只收一次，换乘不重复收。
    if (plan.legs.length > 0) this.stats.revenue += this.fareForKm(this.planDistanceKm(plan));
    if (plan.legs.length === 0) {
      a.state[i] = AgentState.WalkToDest;
      a.walkLeft[i] = Math.max(0.2, Math.hypot(dx - sx, dy - sy) / this.walkSpeed);
      a.plans[i] = null;
      a.targetStation[i] = -1;
      return;
    }
    if (plan.walk1 <= 0.001) {
      this.addToWait(i, plan.origin);
      return;
    }
    a.state[i] = AgentState.WalkToStation;
    a.walkLeft[i] = plan.walk1;
    a.targetStation[i] = plan.origin;
  }

  /** 起终点都按步行距离抽一次概率；两端都愿意走到站，才会坐地铁。 */
  private acceptsStationAccess(
    agent: number,
    plan: NonNullable<ReturnType<typeof planTrip>>,
    goingOut: boolean,
    tripIndex = 0,
  ): boolean {
    const p1 = walkAccessProbability(plan.walk1, this.walkSpeed, this.pxPerKm);
    const p2 = walkAccessProbability(plan.walk2, this.walkSpeed, this.pxPerKm);
    const p = p1 * p2;
    if (p <= 0) return false;
    return this.accessRoll(agent, goingOut, tripIndex) < p;
  }

  /** 稳定的伪随机数：同一 agent / 同一天 / 同一方向，读档后结果一致。 */
  private accessRoll(agent: number, goingOut: boolean, tripIndex = 0): number {
    let h =
      Math.imul(this.dayIndex() + 1, 0x9e3779b1) ^
      Math.imul(agent + 1, 0x85ebca6b) ^
      Math.imul(tripIndex + 1, 0x165667b1) ^
      (goingOut ? 0x27d4eb2f : 0);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h ^= h >>> 12;
    h = Math.imul(h, 0x297a2d39);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }

  private updateWalkers(dt: number): void {
    const a = this.agents;
    for (let i = 0; i < a.count; i++) {
      const st = a.state[i];
      if (
        st !== AgentState.WalkToStation &&
        st !== AgentState.WalkToDest &&
        st !== AgentState.InBackground
      ) {
        continue;
      }
      // 精确路径还没算好：先停在出发地，不按两点直线先走。
      if (st === AgentState.InBackground && this.bgQueued[i] === 1) continue;
      a.walkLeft[i] -= dt;
      if (a.walkLeft[i] > 0) continue;
      a.walkLeft[i] = 0;
      if (st === AgentState.WalkToStation) {
        const sid = a.targetStation[i];
        if (sid < 0) continue;
        this.addToWait(i, sid);
      } else {
        const goingOut = a.tripIsOut[i] === 1;
        a.plans[i] = null;
        this.stats.delivered++;
        this.stats.commuteSum += Math.max(0, this.time - a.tripStart[i]);
        this.stats.commuteCount++;
        if (this.activityMode) {
          const chain = this.activityChains[i] ?? [];
          const trip = chain[this.activityIndex[i]!];
          a.state[i] = trip?.toHome ? AgentState.IdleHome : AgentState.IdleWork;
          this.scheduleNextActivity(i);
          continue;
        }
        const stage = a.stopDone[i]!;
        if (goingOut) {
          // 返程按“实际到达 + 停留”排，晚点会一路顺延到晚高峰。
          a.state[i] = AgentState.IdleWork;
          const stay = Math.max(20, a.backMin[i]! - a.outMin[i]!);
          const latest = startOfDay(this.dayIndex()) + 1439;
          this.pendingReturns.push({ t: Math.min(latest, this.time + stay), agent: i });
          a.returnQueued[i] = 1;
        } else if (stage > 0 && stage !== 255) {
          // 到了顺路停留点：停一会儿再去下一个点，或从这里回家。
          const chain = this.stopChain(i);
          a.state[i] = AgentState.IdleWork;
          const dwell = 20 + this.destinationRng(i, 4242 + stage) * 50;
          if (stage < chain.length) {
            const next = chain[stage]!;
            a.stopDone[i] = stage + 1;
            this.stopHome.push({ t: this.time + dwell, agent: i, dx: next.x, dy: next.y });
          } else {
            a.stopDone[i] = 255;
            this.stopHome.push({ t: this.time + dwell, agent: i, dx: a.homeX[i]!, dy: a.homeY[i]! });
          }
        } else {
          a.state[i] = AgentState.IdleHome;
        }
      }
    }
  }

  private scheduleNextActivity(agent: number): void {
    const chain = this.activityChains[agent];
    const nextIndex = this.activityIndex[agent]! + 1;
    if (!chain || nextIndex >= chain.length) return;
    const next = chain[nextIndex]!;
    const base = startOfDay(this.dayIndex());
    const latest = base + 1439;
    let t = base + next.plannedDepart;
    if (t <= this.time + 1e-6) t = this.time + 5;
    if (t > latest) return;
    this.activityPending.push({ t, agent, index: nextIndex });
  }

  private addToWait(agent: number, stationId: number): void {
    const a = this.agents;
    if (!this.net.stationById.has(stationId)) return;
    a.state[agent] = AgentState.Waiting;
    a.waitStation[agent] = stationId;
    a.targetStation[agent] = stationId;
    let q = this.queues.get(stationId);
    if (!q) {
      q = [];
      this.queues.set(stationId, q);
    }
    if (!q.includes(agent)) q.push(agent);
    this.entriesToday.set(stationId, (this.entriesToday.get(stationId) ?? 0) + 1);
  }

  private removeFromQueue(agent: number, stationId: number): void {
    const q = this.queues.get(stationId);
    if (!q) return;
    const idx = q.indexOf(agent);
    if (idx >= 0) q.splice(idx, 1);
  }

  private replanAtStation(agent: number, stationId: number): void {
    const a = this.agents;
    const station = this.net.stationById.get(stationId);
    if (!station) return;
    const goingOut = a.tripIsOut[agent] === 1;
    const plan = planTrip(
      this.net,
      station.x,
      station.y,
      a.tripDestX[agent]!,
      a.tripDestY[agent]!,
      {
        fixedOrigin: stationId,
        walkRadius: this.walkRadiusPx,
        walkSpeed: this.walkSpeed,
        pxPerKm: this.pxPerKm,
        accessStation:
          this.walkChoice && this.walkRouter
            ? (fromX: number, fromY: number, stationX: number, stationY: number) =>
                this.walkRouter?.stationAccess(
                  { x: fromX, y: fromY },
                  { x: stationX, y: stationY },
                ) ?? null
            : undefined,
      },
    );
    if (!plan) {
      this.removeFromQueue(agent, stationId);
      a.waitStation[agent] = -1;
      a.plans[agent] = null;
      if (this.activityMode) {
        const trip = this.activityChains[agent]?.[this.activityIndex[agent]!];
        if (trip) {
          this.startBackgroundActivityTrip(agent, trip);
          return;
        }
      }
      a.state[agent] = goingOut ? AgentState.IdleWork : AgentState.IdleHome;
      this.markUnserved(agent, goingOut);
      return;
    }
    if (plan.legs.length === 0) {
      this.removeFromQueue(agent, stationId);
      this.startWalkToDest(agent, stationId);
      a.plans[agent] = null;
      return;
    }
    a.plans[agent] = plan;
    a.legIndex[agent] = 0;
    a.planDirty[agent] = 0;
    a.state[agent] = AgentState.Waiting;
    a.waitStation[agent] = stationId;
  }

  private startWalkToDest(agent: number, stationId: number): void {
    const a = this.agents;
    const station = this.net.stationById.get(stationId);
    if (!station) return;
    const d = Math.hypot(station.x - a.tripDestX[agent]!, station.y - a.tripDestY[agent]!);
    a.state[agent] = AgentState.WalkToDest;
    a.walkLeft[agent] = Math.max(0.2, d / this.walkSpeed);
    a.waitStation[agent] = -1;
    // 记住下车车站，热力层用它画“最后一公里”的步行轨迹。
    a.targetStation[agent] = stationId;
  }

  private processDepartures(now: number): void {
    while (this.dayCursor < this.dayEvents.length) {
      const ev = this.dayEvents[this.dayCursor]!;
      if (ev.t > now + 1e-9) break;
      this.dayCursor++;
      this.handleDeparture(ev);
    }
    if (this.activityMode) {
      for (let k = this.activityPending.length - 1; k >= 0; k--) {
        const item = this.activityPending[k]!;
        if (item.t > now + 1e-9) continue;
        this.activityPending.splice(k, 1);
        const a = this.agents;
        if (a.state[item.agent] !== AgentState.IdleHome && a.state[item.agent] !== AgentState.IdleWork) {
          continue;
        }
        if (this.activityIndex[item.agent]! + 1 !== item.index) continue;
        this.startActivityTrip(item.agent, item.index);
      }
      return;
    }
    // 到点返程（实际到达 + 停留），晚点会顺延。
    for (let k = this.pendingReturns.length - 1; k >= 0; k--) {
      const item = this.pendingReturns[k]!;
      if (item.t > now + 1e-9) continue;
      this.pendingReturns.splice(k, 1);
      this.beginReturn(item.agent);
    }
    // 顺路停留结束 → 去下一个点或回家（动态出发，不在预排事件表里）。
    for (let k = this.stopHome.length - 1; k >= 0; k--) {
      const item = this.stopHome[k]!;
      if (item.t > now + 1e-9) continue;
      this.stopHome.splice(k, 1);
      const a = this.agents;
      const i = item.agent;
      const ox = a.tripDestX[i]!;
      const oy = a.tripDestY[i]!;
      this.startTrip(i, ox, oy, item.dx, item.dy, false);
    }
  }

  /**
   * 回程顺路停留链：先去一个（约三分之一的人去两个）休闲类 POI 再回家。
   * 用分组概率 + 稳定哈希决定，同一 agent 每天结果一致，不会随机跳。
   */
  private stopChain(agent: number): MapPoi[] {
    const a = this.agents;
    const group = a.group[agent]!;
    const chance =
      group === 0 ? 0.12 : group === 2 ? 0.22 : group === 3 ? 0.25 : group === 4 ? 0.32 : group === 6 ? 0.2 : 0;
    if (chance <= 0) return [];
    const roll = this.destinationRng(agent, 9001);
    if (roll >= chance) return [];
    const workZone = a.workZone[agent]!;
    const exclude = new Set<number>();
    if (workZone >= 10000) exclude.add(workZone - 10000);
    const first = this.pickStop(agent, a.workX[agent]!, a.workY[agent]!, 6, 9001, exclude);
    if (!first) return [];
    const chain = [first];
    // 约 35% 的顺路者再拐一个地方：下班 → 超市 → 接孩子 → 回家。
    if (roll < chance * 0.35) {
      const second = this.pickStop(agent, first.x, first.y, 4, 9300, new Set([first.id]));
      if (second) chain.push(second);
    }
    return chain;
  }

  /** 顺路点在休闲类 POI 里按「吸引量 / 距离^1.6」挑，范围默认 4–6 km。 */
  private pickStop(
    agent: number,
    ax: number,
    ay: number,
    maxKm: number,
    salt: number,
    exclude: Set<number>,
  ): MapPoi | null {
    const px = Math.max(1, this.pxPerKm);
    let total = 0;
    const picks: MapPoi[] = [];
    const weights: number[] = [];
    for (const poi of this.pois) {
      if (POI_META[poi.type]?.group !== 4) continue;
      if (exclude.has(poi.id)) continue;
      const km = Math.hypot(poi.x - ax, poi.y - ay) / px;
      if (km < 0.4 || km > maxKm) continue;
      const w =
        (poiDailyMid(poi) * (0.75 + this.destinationRng(agent, salt + poi.id) * 0.5)) /
        Math.pow(km, 1.6);
      picks.push(poi);
      weights.push(w);
      total += w;
    }
    if (total <= 0) return null;
    let r = this.destinationRng(agent, salt * 7 + 13) * total;
    for (let k = 0; k < picks.length; k++) {
      r -= weights[k]!;
      if (r <= 0) return picks[k]!;
    }
    return picks[picks.length - 1]!;
  }

  // ————————————————————————— 列车 —————————————————————————

  isLineInService(line: Line, minuteOfDay = this.timeOfDay()): boolean {
    const start = line.startMin;
    const end = line.endMin;
    if (start === end) return true;
    if (start < end) return minuteOfDay >= start && minuteOfDay < end;
    return minuteOfDay >= start || minuteOfDay < end;
  }

  setLineService(lineId: number, startMin: number, endMin: number): ActionResult {
    const line = this.net.lineById.get(lineId);
    if (!line) return { ok: false, reason: '线路不存在' };
    line.startMin = Math.max(0, Math.min(1439, Math.round(startMin)));
    line.endMin = Math.max(0, Math.min(1439, Math.round(endMin)));
    return { ok: true };
  }

  setLineColor(lineId: number, color: number, hex: string): ActionResult {
    const line = this.net.lineById.get(lineId);
    if (!line) return { ok: false, reason: '线路不存在' };
    line.color = Math.max(0, Math.min(LINE_COLORS.length - 1, Math.round(color)));
    line.hex = hex;
    this.net.version++;
    return { ok: true };
  }

  /** 列车的运行区间（含端点）：默认整条线，玩家可单独设置起终点。 */
  trainSpan(train: Train, line: Line): { start: number; end: number } {
    const n = line.stationIds.length;
    let start = line.stationIds.indexOf(train.startId);
    let end = line.stationIds.indexOf(train.endId);
    if (start < 0) start = 0;
    if (end < 0) end = n - 1;
    if (start > end) {
      const tmp = start;
      start = end;
      end = tmp;
    }
    if (end <= start) {
      start = 0;
      end = Math.max(1, n - 1);
    }
    return { start, end };
  }

  setTrainSpan(lineId: number, trainId: number, startId: number, endId: number): ActionResult {
    const line = this.net.lineById.get(lineId);
    const train = this.net.trainById.get(trainId);
    if (!line || !train || train.lineId !== lineId) return { ok: false, reason: '列车不存在' };
    if (isLoopLine(line)) return { ok: false, reason: '环线列车整圈运行，不需要设置区间' };
    const start = line.stationIds.indexOf(startId);
    const end = line.stationIds.indexOf(endId);
    if (start < 0 || end < 0) return { ok: false, reason: '车站不在该线路上' };
    if (start >= end) return { ok: false, reason: '终点必须在起点之后' };
    train.startId = startId;
    train.endId = endId;
    if (train.index < start || train.index > end) {
      train.index = start;
      train.prog = 0;
      train.phase = 0;
      train.dwellLeft = TRAIN_DWELL;
      train.dir = 1;
    }
    // 车上乘客可能原本要坐过新的终点站，进站后重新规划。
    for (const agent of train.riders) this.agents.planDirty[agent] = 1;
    this.net.version++;
    return { ok: true };
  }

  /** UI 用：允许按任意方向选择两站，实际运行区间按 min/max 计算。 */
  setTrainSpanFlexible(lineId: number, trainId: number, startId: number, endId: number): ActionResult {
    const line = this.net.lineById.get(lineId);
    const train = this.net.trainById.get(trainId);
    if (!line || !train || train.lineId !== lineId) return { ok: false, reason: '列车不存在' };
    if (isLoopLine(line)) return { ok: false, reason: '环线列车整圈运行，不需要设置区间' };
    const a = line.stationIds.indexOf(startId);
    const b = line.stationIds.indexOf(endId);
    if (a < 0 || b < 0) return { ok: false, reason: '车站不在该线路上' };
    if (a === b) return { ok: false, reason: '始发站与终点站不能相同' };
    train.startId = startId;
    train.endId = endId;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (train.index < lo || train.index > hi) {
      train.index = lo;
      train.prog = 0;
      train.phase = 0;
      train.dwellLeft = TRAIN_DWELL;
      train.dir = 1;
    }
    for (const agent of train.riders) this.agents.planDirty[agent] = 1;
    this.net.version++;
    return { ok: true };
  }

  /** 只调换显示与记录方向，实际运行区间仍按两站之间的 min/max 计算。 */
  swapTrainSpan(lineId: number, trainId: number): ActionResult {
    const line = this.net.lineById.get(lineId);
    const train = this.net.trainById.get(trainId);
    if (!line || !train || train.lineId !== lineId) return { ok: false, reason: '列车不存在' };
    if (isLoopLine(line)) return { ok: false, reason: '环线列车整圈运行，不需要调换端点' };
    const a = line.stationIds.indexOf(train.startId);
    const b = line.stationIds.indexOf(train.endId);
    if (a < 0 || b < 0) return { ok: false, reason: '车站不在该线路上' };
    if (a === b) return { ok: false, reason: '始发站与终点站相同' };
    train.startId = line.stationIds[b]!;
    train.endId = line.stationIds[a]!;
    for (const agent of train.riders) this.agents.planDirty[agent] = 1;
    this.net.version++;
    return { ok: true };
  }

  private updateTrains(dt: number): void {
    for (const train of this.net.trains) {
      const line = this.net.lineById.get(train.lineId);
      if (!line || line.stationIds.length < 2) continue;
      const loop = isLoopLine(line);
      const span = loop
        ? { start: 0, end: line.stationIds.length - 1 }
        : this.trainSpan(train, line);
      if (loop) {
        // 环线永远单向循环，不会折返。
        train.dir = 1;
        if (train.index >= line.stationIds.length - 1) {
          train.index = 0;
          train.prog = 0;
        }
      } else {
        if (train.index < span.start) {
          train.index = span.start;
          train.prog = 0;
        }
        if (train.index > span.end) {
          train.index = span.end;
          train.prog = 0;
        }
      }
      const inService = this.isLineInService(line, this.timeOfDay());
      let rem = dt;
      let guard = 0;
      while (rem > 1e-6 && guard++ < 24) {
        if (train.phase === 0) {
          // 终点站（区间两端）就停；收车后不再发车。环线收车停回起点站。
          const atTerminus = loop
            ? train.index === 0
            : train.index <= span.start || train.index >= span.end;
          if (!inService && atTerminus) {
            // 收车后把下一班的发车时刻排好：同站同类列车按顺序、间隔一个班距。
            const slot = this.terminalDepartureSlot(train, line);
            if (slot > 0) train.departAt = Math.max(train.departAt ?? 0, slot);
            break;
          }
          if (train.departAt !== undefined && this.time < train.departAt - 1e-6) break;
          const use = Math.min(rem, train.dwellLeft);
          train.dwellLeft -= use;
          rem -= use;
          if (train.dwellLeft > 1e-6) break;
          train.phase = 1;
          train.prog = 0;
          train.departAt = undefined;
          continue;
        }
        const nextIdx = loop
          ? (train.index + 1) % (line.stationIds.length - 1)
          : train.index + train.dir;
        if (!loop && (nextIdx < span.start || nextIdx > span.end)) {
          train.dir = train.dir === 1 ? -1 : 1;
          continue;
        }
        const a = this.net.stationById.get(line.stationIds[train.index]!);
        const b = this.net.stationById.get(line.stationIds[nextIdx]!);
        if (!a || !b) {
          train.phase = 0;
          train.dwellLeft = TRAIN_DWELL;
          break;
        }
        const segTime = segmentTravel(a, b, this.pxPerKm, speedForTrainKind(train.kind));
        const use = Math.min(rem, (1 - train.prog) * segTime);
        train.prog += use / segTime;
        rem -= use;
        if (train.prog >= 1 - 1e-9) {
          const arrivedId = line.stationIds[nextIdx]!;
          train.index = nextIdx;
          train.prog = 0;
          train.phase = 0;
          train.dwellLeft = TRAIN_DWELL;
          // 到终点站 / 起点站就折返；环线不折返。
          const terminus = !loop && (nextIdx === span.start || nextIdx === span.end);
          if (terminus) {
            train.dir = train.dir === 1 ? -1 : 1;
          }
          // 快车：只停靠快车停靠站（终点站照停，折返不受影响）。
          const stopHere =
            train.kind !== 'express' ||
            line.expressStops.length < 2 ||
            terminus ||
            line.expressStops.includes(arrivedId);
          if (stopHere) {
            this.onTrainArrive(train);
          } else {
            // 直接越站继续跑，不停站、不开门。
            train.phase = 1;
            train.dwellLeft = 0;
          }
        } else {
          break;
        }
      }
    }
  }


  /**
   * 夜间停在终点站的列车，第二天的发车时刻：
   * 同站同类型的车按 id 顺序、每列错开一个班距，避免同时发车。
   */
  private terminalDepartureSlot(train: Train, line: Line): number {
    const day = startOfDay(this.dayIndex());
    let start = day + line.startMin;
    if (start < this.time - 1e-6) start += DAY_MINUTES;
    const headway = this.net.serviceHeadway(line, train.kind, this.pxPerKm);
    if (!Number.isFinite(headway)) return 0;
    const same = line.trains
      .map((id) => this.net.trainById.get(id))
      .filter(
        (t): t is Train =>
          !!t && t.kind === train.kind && t.index === train.index && t.phase === 0,
      )
      .sort((a, b) => a.id - b.id);
    const order = Math.max(0, same.indexOf(train));
    return start + order * headway;
  }

  private onTrainArrive(train: Train): void {
    const line = this.net.lineById.get(train.lineId);
    if (!line) return;
    const stationId = line.stationIds[train.index];
    if (stationId === undefined) return;
    const a = this.agents;

    const stay: number[] = [];
    for (const agent of train.riders) {
      const plan = a.plans[agent];
      if (!plan) continue;
      const li = a.legIndex[agent]!;
      const leg = plan.legs[li];
      if (!leg) continue;
      const dirty = a.planDirty[agent] === 1;
      // 今日出站只统计真正离开付费区的乘客；换乘不算出站。
      if (!dirty && li + 1 >= plan.legs.length) {
        this.exitsToday.set(stationId, (this.exitsToday.get(stationId) ?? 0) + 1);
      }
      if (!dirty && leg.to !== stationId) {
        stay.push(agent);
        continue;
      }
      if (dirty) {
        this.addToWait(agent, stationId);
        this.replanAtStation(agent, stationId);
      } else if (li + 1 < plan.legs.length) {
        a.legIndex[agent] = li + 1;
        this.addToWait(agent, stationId);
      } else {
        this.startWalkToDest(agent, stationId);
      }
    }
    train.riders = stay;
    const boarded = this.boardTrain(train, stationId);
    // 上下客越多停得越久；快车和慢车都按本次上车人数伸缩。
    this.applyBoardingDwell(train, boarded);
  }

  private applyBoardingDwell(train: Train, boarded: number): void {
    if (boarded <= 0) return;
    train.dwellLeft =
      TRAIN_DWELL + Math.min(TRAIN_DWELL_MAX_EXTRA, boarded * TRAIN_DWELL_PER_BOARDING);
  }

  /** 按序上车；返回本次上车人数（停站时间按上下客量伸缩）。 */
  private boardTrain(train: Train, stationId: number): number {
    const queue = this.queues.get(stationId);
    if (!queue || queue.length === 0) return 0;
    const line = this.net.lineById.get(train.lineId);
    if (!line) return 0;
    const a = this.agents;
    const remaining: number[] = [];
    let boarded = 0;
    for (const agent of queue) {
      if (train.riders.length >= TRAIN_CAPACITY) {
        // 快车坐满：让没上车的快车乘客下一拍重新规划，长途客会自动退回慢车。
        const pendingPlan = a.plans[agent];
        const pendingLeg = pendingPlan?.legs[a.legIndex[agent]!];
        if (train.kind === 'express' && pendingLeg?.service === 'express') {
          a.planDirty[agent] = 1;
        }
        remaining.push(agent);
        continue;
      }
      const plan = a.plans[agent];
      if (!plan) continue;
      const li = a.legIndex[agent]!;
      const leg = plan.legs[li];
      if (!leg || leg.lineId !== train.lineId || leg.from !== stationId) {
        remaining.push(agent);
        continue;
      }
      const fromIdx = line.stationIds.indexOf(leg.from);
      const toIdx = line.stationIds.indexOf(leg.to);
      if (fromIdx < 0 || toIdx < 0) {
        remaining.push(agent);
        continue;
      }
      // 快车只接“快车方案”，并且起终点都必须是快车停靠站；慢车只接慢车方案。
      if (train.kind === 'express') {
        if (leg.service !== 'express') {
          remaining.push(agent);
          continue;
        }
        if (!line.expressStops.includes(leg.from) || !line.expressStops.includes(leg.to)) {
          remaining.push(agent);
          continue;
        }
      } else if (leg.service === 'express') {
        remaining.push(agent);
        continue;
      }
      if (isLoopLine(line)) {
        // 环线单向绕圈：任何方向都能到，只要列车在正方向运行。
        if (train.dir !== 1) {
          remaining.push(agent);
          continue;
        }
      } else {
        const span = this.trainSpan(train, line);
        if (fromIdx < span.start || fromIdx > span.end || toIdx < span.start || toIdx > span.end) {
          remaining.push(agent);
          continue;
        }
        const need = Math.sign(toIdx - fromIdx);
        if (need !== train.dir) {
          remaining.push(agent);
          continue;
        }
      }
      train.riders.push(agent);
      a.state[agent] = AgentState.Riding;
      a.waitStation[agent] = -1;
      a.planDirty[agent] = 0;
      this.stats.ridership++;
      line.ridersToday++;
      boarded++;
    }
    this.queues.set(stationId, remaining);
    return boarded;
  }

  // ————————————————————————— 建设 —————————————————————————

  canPlaceStation(
    x: number,
    y: number,
    size: StationSize = 'standard',
  ): { ok: boolean; reason?: string } {
    if (this.fund < STATION_SIZES[size].cost) return { ok: false, reason: '基金不足，无法建站' };
    if (x < 24 || y < 24 || x > WORLD_W - 24 || y > WORLD_H - 24) {
      return { ok: false, reason: '超出地图范围' };
    }
    // 内置地形图：水域 / 陡坡不适合建站；纯色图和自定义地图保持原来的自由放置。
    if (this.enforceTerrain && !this.map && this.mapId === MAP_ID) {
      const terrain = terrainAt(x, y);
      if (!terrain.suitable) return { ok: false, reason: terrain.reason ?? '地形不适合建站' };
    }
    // 0.9.1：不再限制站间距。相邻车站可以建得很近，由玩家自行取舍。
    return { ok: true };
  }

  placeStation(
    x: number,
    y: number,
    size: StationSize = 'standard',
  ): { ok: boolean; reason?: string; station?: Station } {
    const check = this.canPlaceStation(x, y, size);
    if (!check.ok) return check;
    this.fund -= STATION_SIZES[size].cost;
    const name = this.stationNameFor(x, y);
    const station = this.net.addStation(x, y, name, this.time, size);
    this.lastStationId = station.id;
    return { ok: true, station };
  }

  private stationNameFor(x: number, y: number): string {
    const found = this.nearestZone(x, y);
    if (!found) return `新站 ${this.net.stations.length + 1}`;
    const zone = found;
    const same: Station[] = [];
    for (const s of this.net.stations) {
      const z = this.nearestZone(s.x, s.y);
      if (z && z.id === zone.id) same.push(s);
    }
    if (same.length === 0) return zone.name;

    const dirs = ['东', '南', '西', '北', '东北', '东南', '西南', '西北'];
    const used = new Set<string>();
    for (const s of same) {
      if (!s.name.startsWith(zone.name)) continue;
      const suffix = s.name.slice(zone.name.length);
      if (dirs.includes(suffix)) used.add(suffix);
    }

    const dx = x - zone.x;
    const dy = y - zone.y;
    const angle = Math.atan2(dy, dx);
    const angleOf: Record<string, number> = {
      东: 0,
      东南: Math.PI / 4,
      南: Math.PI / 2,
      西南: (3 * Math.PI) / 4,
      西: Math.PI,
      西北: (-3 * Math.PI) / 4,
      北: -Math.PI / 2,
      东北: -Math.PI / 4,
    };
    const close = (a: string) => {
      let d = Math.abs(angle - angleOf[a]!);
      if (d > Math.PI) d = Math.PI * 2 - d;
      return d;
    };
    // 先用东 / 南 / 西 / 北，四个都用过之后再考虑东北 / 东南 / 西南 / 西北。
    const cardinals = ['东', '南', '西', '北'].sort((a, b) => close(a) - close(b));
    for (const d of cardinals) {
      if (!used.has(d)) return zone.name + d;
    }
    const diagonals = ['东北', '东南', '西南', '西北'].sort((a, b) => close(a) - close(b));
    for (const d of diagonals) {
      if (!used.has(d)) return zone.name + d;
    }
    return `${zone.name}·${same.length + 1}`;
  }

  /** 点所在组团：按“到圆心距离 − 半径 × 0.35”取最近，超过 320 px 视为不在组团内。 */
  private nearestZone(x: number, y: number): Zone | null {
    let best: Zone | null = null;
    let bestD = Infinity;
    for (const zone of this.zones) {
      const d = Math.hypot(zone.x - x, zone.y - y) - zone.r * 0.35;
      if (d < bestD) {
        bestD = d;
        best = zone;
      }
    }
    return best && bestD < 320 ? best : null;
  }

  canUndoStation(): boolean {
    if (!this.tutorial.active || this.tutorial.undoUsed) return false;
    if (this.lastStationId === null) return false;
    const station = this.net.stationById.get(this.lastStationId);
    return !!station && station.lines.length === 0 && this.net.stations[this.net.stations.length - 1] === station;
  }

  undoLastStation(): ActionResult {
    if (!this.tutorial.active) return { ok: false, reason: '正式局不支持撤站' };
    if (this.tutorial.undoUsed) return { ok: false, reason: '撤回机会已用完' };
    if (!this.canUndoStation()) return { ok: false, reason: '最近的车站已接入线路，无法撤回' };
    const station = this.net.stationById.get(this.lastStationId!);
    if (!station) return { ok: false, reason: '没有可撤回的车站' };
    if (!this.net.undoLastStation(station)) return { ok: false, reason: '无法撤回该车站' };
    this.fund += STATION_SIZES[station.size ?? 'standard'].cost;
    this.tutorial.undoUsed = true;
    this.lastStationId = null;
    return { ok: true };
  }

  lineQuote(stationIds: number[]): number {
    const segments = Math.max(0, stationIds.length - 1);
    return segments * SEGMENT_COST + TRAIN_COST;
  }

  createLine(
    stationIds: number[],
    color: number,
    hex?: string,
    startMin = 360,
    endMin = 1410,
    speedKmh = DEFAULT_TRAIN_SPEED_KMH,
  ): { ok: boolean; reason?: string; lineId?: number } {
    if (stationIds.length < 2) return { ok: false, reason: '线路至少需要 2 个车站' };
    const loop = stationIds.length >= 4 && stationIds[0] === stationIds[stationIds.length - 1];
    const unique = new Set(stationIds);
    if (unique.size !== stationIds.length - (loop ? 1 : 0)) {
      return { ok: false, reason: '车站不能重复' };
    }
    for (const id of stationIds) {
      if (!this.net.stationById.has(id)) return { ok: false, reason: '车站不存在' };
    }
    const cost = this.lineQuote(stationIds);
    if (this.fund < cost) return { ok: false, reason: '基金不足' };
    this.fund -= cost;
    const line = this.net.addLine(stationIds, color, hex, startMin, endMin, speedKmh);
    const train = this.net.addTrain(line, 0, 1);
    this.applyBoardingDwell(train, this.boardTrain(train, line.stationIds[0]!));
    return { ok: true, lineId: line.id };
  }

  /** 延长既有线路的报价：只按新增区段计费，不重复收列车费。 */
  extendLineCost(lineId: number, stationIds: number[]): number {
    const line = this.net.lineById.get(lineId);
    if (!line) return 0;
    return Math.max(0, stationIds.length - line.stationIds.length) * SEGMENT_COST;
  }

  extendLine(
    lineId: number,
    stationIds: number[],
  ): { ok: boolean; reason?: string; cost?: number; lineId?: number } {
    const line = this.net.lineById.get(lineId);
    if (!line) return { ok: false, reason: '线路不存在' };
    if (isLoopLine(line)) return { ok: false, reason: '环线暂不支持延长' };
    if (stationIds.length <= line.stationIds.length) {
      return { ok: false, reason: '请在线路两端接入至少一个新车站' };
    }
    const unique = new Set(stationIds);
    const closingLoop =
      stationIds.length >= 4 && stationIds[0] === stationIds[stationIds.length - 1];
    if (unique.size !== stationIds.length - (closingLoop ? 1 : 0)) {
      return { ok: false, reason: '车站不能重复' };
    }
    for (const id of stationIds) {
      if (!this.net.stationById.has(id)) return { ok: false, reason: '车站不存在' };
    }
    const cost = this.extendLineCost(lineId, stationIds);
    if (this.fund < cost) return { ok: false, reason: '基金不足' };
    if (!this.net.updateLineStations(lineId, stationIds)) {
      return { ok: false, reason: '只能在既有线路的两端延长' };
    }
    this.fund -= cost;
    line.buildCost += cost;
    return { ok: true, cost, lineId };
  }

  /** 从既有线路的中间站分出一条支线；支线共用干线的颜色与运营时段。 */
  createBranch(
    parentLineId: number,
    stationIds: number[],
  ): { ok: boolean; reason?: string; lineId?: number; cost?: number } {
    const parent = this.net.lineById.get(parentLineId);
    if (!parent) return { ok: false, reason: '所属线路不存在' };
    if (stationIds.length < 2) return { ok: false, reason: '支线至少需要 2 个车站' };
    const startIndex = parent.stationIds.indexOf(stationIds[0]!);
    if (startIndex <= 0 || startIndex >= parent.stationIds.length - 1) {
      return { ok: false, reason: '只能从线路中间的站点分支' };
    }
    const cost = this.lineQuote(stationIds);
    const res = this.createLine(
      stationIds,
      parent.color,
      parent.hex,
      parent.startMin,
      parent.endMin,
      parent.speedKmh,
    );
    if (!res.ok) return res;
    const line = this.net.lineById.get(res.lineId!);
    if (line) line.branchOf = parent.id;
    return { ...res, cost };
  }

  removeLine(lineId: number): ActionResult {    const line = this.net.lineById.get(lineId);
    if (!line) return { ok: false, reason: '线路不存在' };
    if (this.fund < 0) return { ok: false, reason: '基金为负，无法拆线' };

    const evictions: Array<{ agent: number; stationId: number }> = [];
    for (const trainId of line.trains) {
      const train = this.net.trainById.get(trainId);
      if (!train) continue;
      const sid = line.stationIds[train.index];
      if (sid === undefined) continue;
      for (const agent of train.riders) evictions.push({ agent, stationId: sid });
    }
    const waitingAffected: Array<{ agent: number; stationId: number }> = [];
    for (const [stationId, queue] of this.queues) {
      for (const agent of queue) {
        const plan = this.agents.plans[agent];
        if (!plan) continue;
        if (plan.legs.some((l) => l.lineId === lineId)) {
          waitingAffected.push({ agent, stationId });
        }
      }
    }
    const evicted = new Set(evictions.map((e) => e.agent));
    const ridingAffected: number[] = [];
    for (const train of this.net.trains) {
      if (train.lineId === lineId) continue;
      for (const agent of train.riders) {
        if (evicted.has(agent)) continue;
        const plan = this.agents.plans[agent];
        if (plan && plan.legs.some((l) => l.lineId === lineId)) ridingAffected.push(agent);
      }
    }

    const refund = line.buildCost * LINE_REFUND_RATE;
    this.fund += refund;
    this.net.removeLine(lineId);

    for (const { agent, stationId } of evictions) {
      this.addToWait(agent, stationId);
      this.replanAtStation(agent, stationId);
    }
    for (const { agent, stationId } of waitingAffected) {
      this.replanAtStation(agent, stationId);
    }
    for (const agent of ridingAffected) {
      this.agents.planDirty[agent] = 1;
    }
    return { ok: true };
  }

  addTrain(lineId: number, kind: TrainKind = 'local'): ActionResult {
    const line = this.net.lineById.get(lineId);
    if (!line) return { ok: false, reason: '线路不存在' };
    const cost = kind === 'express' ? TRAIN_COST_EXPRESS : TRAIN_COST;
    if (this.fund < cost) return { ok: false, reason: '基金不足，无法加车' };
    if (kind === 'express') {
      if (line.stationIds.length < 3) return { ok: false, reason: '快车至少需要 3 个车站' };
      if (line.expressStops.length < 2) line.expressStops = this.defaultExpressStops(line);
      if (line.expressStops.length < 2) return { ok: false, reason: '请至少勾选 2 个快车停靠站' };
    }
    this.fund -= cost;
    const index = (line.trains.length * 2) % line.stationIds.length;
    const train = this.net.addTrain(line, index, 1, kind);
    this.net.version++;
    this.applyBoardingDwell(train, this.boardTrain(train, line.stationIds[index]!));
    return { ok: true };
  }

  /** 快车默认停靠：大型换乘站、5/6 级 POI 附近站、线路两端终点站。 */
  defaultExpressStops(line: Line): number[] {
    const stops = new Set<number>();
    const ids = [...new Set(line.stationIds)];
    for (const id of ids) {
      const station = this.net.stationById.get(id);
      if (!station) continue;
      if (station.size === 'large') stops.add(id);
    }
    const r = this.walkRadiusPx;
    for (const poi of this.pois) {
      if (poi.level < 5) continue;
      for (const id of ids) {
        const station = this.net.stationById.get(id);
        if (station && Math.hypot(station.x - poi.x, station.y - poi.y) <= r) stops.add(id);
      }
    }
    stops.add(ids[0]!);
    stops.add(ids[ids.length - 1]!);
    return ids.filter((id) => stops.has(id));
  }

  /** 手动修改快车停靠站；修改后立刻生效（在途列车下一站起按新停靠表）。 */
  setExpressStops(lineId: number, stationIds: number[]): ActionResult {
    const line = this.net.lineById.get(lineId);
    if (!line) return { ok: false, reason: '线路不存在' };
    const valid = new Set(line.stationIds);
    const stops: number[] = [];
    for (const id of stationIds) {
      if (valid.has(id) && !stops.includes(id)) stops.push(id);
    }
    if (stops.length < 2) return { ok: false, reason: '快车至少需要 2 个停靠站' };
    line.expressStops = stops;
    this.net.version++;
    // 已排好快车方案的乘客重新规划，避免继续等不存在的停站。
    for (const queue of this.queues.values()) {
      for (const agent of queue) this.agents.planDirty[agent] = 1;
    }
    return { ok: true };
  }

  removeTrain(lineId: number): ActionResult {
    const line = this.net.lineById.get(lineId);
    if (!line) return { ok: false, reason: '线路不存在' };
    if (line.trains.length === 0) return { ok: false, reason: '该线路没有列车' };
    const trainId = line.trains[line.trains.length - 1]!;
    const train = this.net.trainById.get(trainId);
    if (!train) return { ok: false, reason: '列车不存在' };
    const sid = line.stationIds[train.index];
    const riders = [...train.riders];
    this.net.removeTrain(trainId);
    if (sid !== undefined) {
      for (const agent of riders) {
        this.addToWait(agent, sid);
        this.replanAtStation(agent, sid);
      }
    }
    return { ok: true };
  }

  // ————————————————————————— 查询 —————————————————————————

  waitingAt(stationId: number): number {
    return this.queues.get(stationId)?.length ?? 0;
  }

  /** 当前正在出行（步行 / 候车 / 乘车）的人数，顶栏“出行中”用。 */
  activeTravelers(): number {
    const a = this.agents;
    let n = 0;
    for (let i = 0; i < a.count; i++) {
      const s = a.state[i]!;
      if (
        s === AgentState.WalkToStation ||
        s === AgentState.Waiting ||
        s === AgentState.Riding ||
        s === AgentState.WalkToDest ||
        s === AgentState.InBackground
      ) {
        n++;
      }
    }
    return n;
  }

  entriesAt(stationId: number): number {
    return this.entriesToday.get(stationId) ?? 0;
  }

  exitsAt(stationId: number): number {
    return this.exitsToday.get(stationId) ?? 0;
  }

  entriesBestAt(stationId: number): number {
    return Math.max(this.net.stationById.get(stationId)?.entriesBest ?? 0, this.entriesAt(stationId));
  }

  exitsBestAt(stationId: number): number {
    return Math.max(this.net.stationById.get(stationId)?.exitsBest ?? 0, this.exitsAt(stationId));
  }

  /** UI: current waiting passengers grouped by their final destination. */
  waitingDestinationsAt(stationId: number, limit = 6): Array<{ name: string; count: number }> {
    const queue = this.queues.get(stationId) ?? [];
    const counts = new Map<string, number>();
    for (const agent of queue) {
      const zone = this.nearestZone(this.agents.tripDestX[agent]!, this.agents.tripDestY[agent]!);
      const name = zone?.name ?? '其他目的地';
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'))
      .slice(0, limit);
  }

  heatAt(stationId: number): number {
    const station = this.net.stationById.get(stationId);
    if (!station) return 0;
    return Math.min(1, this.waitingAt(stationId) / station.capacity);
  }

  isIdleStation(stationId: number): boolean {
    return (this.net.stationById.get(stationId)?.lines.length ?? 0) === 0;
  }

  todayCost(): number {
    return this.trainCost() + this.stationCost();
  }

  /** 今日票款（按上车人次计费）。 */
  todayRevenue(): number {
    return this.stats.revenue;
  }

  /** 分段票价：起步价含 freeKm，之后每 stepKm 加 step 元。 */
  fareForKm(km: number): number {
    const f = this.fare;
    const free = Math.max(0, f.freeKm);
    const stepKm = Math.max(0.1, f.stepKm);
    const extra = km > free ? Math.ceil((km - free) / stepKm) : 0;
    return Math.max(0, Math.round(f.base + extra * f.step));
  }

  /** 一次乘车的线网里程（km）：把 plan 的各段站间距加起来。 */
  private planDistanceKm(plan: { legs: Array<{ from: number; to: number }> }): number {
    let px = 0;
    for (const leg of plan.legs) {
      const a = this.net.stationById.get(leg.from);
      const b = this.net.stationById.get(leg.to);
      if (a && b) px += Math.hypot(a.x - b.x, a.y - b.y);
    }
    return px / Math.max(1, this.pxPerKm);
  }

  stationCost(): number {
    let total = 0;
    for (const s of this.net.stations) total += STATION_SIZES[s.size ?? 'standard'].daily;
    return total;
  }

  trainCost(): number {
    let total = 0;
    for (const train of this.net.trains) {
      total += train.kind === 'express' ? TRAIN_DAILY_EXPRESS : TRAIN_DAILY;
    }
    return total;
  }

  /** 一条线的列车日运营（慢车 ¥100 / 快车 ¥130）。 */
  lineTrainCost(lineId: number): number {
    const line = this.net.lineById.get(lineId);
    if (!line) return 0;
    let total = 0;
    for (const id of line.trains) {
      const train = this.net.trainById.get(id);
      if (train) total += train.kind === 'express' ? TRAIN_DAILY_EXPRESS : TRAIN_DAILY;
    }
    return total;
  }

  avgCommute(): number {
    return this.stats.commuteCount > 0 ? this.stats.commuteSum / this.stats.commuteCount : 0;
  }

  /** 500 m 核心圈对应的像素半径；最大辐射不足 500 m 时取最大半径。 */
  coreWalkRadiusPx(): number {
    return Math.min(this.walkRadiusPx, this.pxPerKm * (WALK_CORE_RADIUS_M / 1000));
  }

  previewCoverage(x: number, y: number): CoveragePreview {
    const mixedZones = this.zones.filter((z) => z.kind === 'mixed' && z.id < 10000);
    const base = coverageAt(x, y, this.dots, this.walkRadiusPx, mixedZones, this.pxPerKm);
    const core = coverageAt(x, y, this.dots, this.coreWalkRadiusPx(), mixedZones, this.pxPerKm);
    let existingStations = 0;
    for (const s of this.net.stations) {
      if (Math.hypot(s.x - x, s.y - y) <= this.walkRadiusPx) existingStations++;
    }
    let poiAttraction = 0;
    for (const poi of this.pois) {
      const d = Math.hypot(poi.x - x, poi.y - y);
      if (d > this.walkRadiusPx) continue;
      const meters = (d / Math.max(1, this.pxPerKm)) * 1000;
      poiAttraction += poiDailyMid(poi) * stationAccessProbability(meters);
    }
    return {
      residents: base.residents,
      jobs: base.jobs,
      coreResidents: core.residents,
      coreJobs: core.jobs,
      poiAttraction,
      existingStations,
    };
  }

  zoneOdSummary(zoneId: number): {
    total: number;
    incoming: number;
    top: Array<{ name: string; count: number }>;
    topIn: Array<{ name: string; count: number }>;
  } {
    const counts = new Map<number, number>();
    const inCounts = new Map<number, number>();
    const a = this.agents;
    let total = 0;
    let incoming = 0;
    for (let i = 0; i < a.count; i++) {
      if (a.homeZone[i] === zoneId) {
        total++;
        const w = a.workZone[i]!;
        counts.set(w, (counts.get(w) ?? 0) + 1);
      }
      if (a.workZone[i] === zoneId) {
        incoming++;
        const h = a.homeZone[i]!;
        inCounts.set(h, (inCounts.get(h) ?? 0) + 1);
      }
    }
    const toTop = (map: Map<number, number>) =>
      [...map.entries()]
        .map(([id, count]) => ({ name: this.zoneMap.get(id)?.name ?? '未知', count }))
        .sort((x, y) => y.count - x.count)
        .slice(0, 3);
    return { total, incoming, top: toTop(counts), topIn: toTop(inCounts) };
  }

  /** 用于渲染层：某条 OD 对的当前人数。 */
  odPairCounts(): ZoneOdPair[] {
    return this.odPairs;
  }

  /** 当前时刻该 OD 对的有效客流乘数：画像 × 周末 × 硬截止可达性。 */
  odFlowWeight(pair: ZoneOdPair): number {
    const poi = this.poiByZone.get(pair.to);
    if (!poi) return 1;
    const tod = this.timeOfDay();
    const weight = poiTimeWeight(poi, tod, this.dayIndex());
    if (weight <= 0) return 0;
    if (poi.profile !== 'hard') return weight;
    const travel = this.odTravelMinutes(pair.from, poi);
    return tod + travel > poi.closeMin ? weight * 0.15 : weight;
  }

  private odTravelCache = new Map<string, number>();
  private odTravelVersion = -1;

  /** 从某组团到 POI 的线网估算时间；线网变化后自动失效。 */
  private odTravelMinutes(fromZoneId: number, poi: MapPoi): number {
    if (this.odTravelVersion !== this.net.version) {
      this.odTravelCache.clear();
      this.odTravelVersion = this.net.version;
    }
    const key = `${fromZoneId}:${poi.id}`;
    const cached = this.odTravelCache.get(key);
    if (cached !== undefined) return cached;
    const from = this.zoneMap.get(fromZoneId);
    const plan = from
      ? planTrip(this.net, from.x, from.y, poi.x, poi.y, {
          walkRadius: this.walkRadiusPx,
          walkSpeed: this.walkSpeed,
          pxPerKm: this.pxPerKm,
        })
      : null;
    const value = plan ? plan.total : 999;
    this.odTravelCache.set(key, value);
    return value;
  }

  lineDailyCost(lineId: number): number {
    const line = this.net.lineById.get(lineId);
    if (!line) return 0;
    let stations = 0;
    for (const sid of line.stationIds) stations += STATION_SIZES[this.net.stationById.get(sid)?.size ?? 'standard'].daily;
    return this.lineTrainCost(lineId) + stations;
  }

  /** 线路总里程（km）。 */
  lineLengthKm(lineId: number): number {
    const line = this.net.lineById.get(lineId);
    return line ? this.net.lineLengthKm(line, this.pxPerKm) : 0;
  }

  /** 线路单程运行时间（分钟，不含终点折返）。 */
  lineOneWayMinutes(lineId: number): number {
    const line = this.net.lineById.get(lineId);
    return line ? this.net.lineOneWayMinutes(line, this.pxPerKm) : 0;
  }

  /** 当前发车间隔（分钟）。 */
  lineHeadwayMinutes(lineId: number): number {
    const line = this.net.lineById.get(lineId);
    return line ? this.net.headwayMinutes(line, this.pxPerKm) : 0;
  }

  refundOf(lineId: number): number {
    return (this.net.lineById.get(lineId)?.buildCost ?? 0) * LINE_REFUND_RATE;
  }

  /** 当前地图上实际存在的群体人数（POI 群体为 0 时隐藏在筛选栏）。 */
  groupCounts(): number[] {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < this.agents.count; i++) {
      const g = this.agents.group[i] ?? 0;
      counts[g] = (counts[g] ?? 0) + 1;
    }
    return counts;
  }

  /** 步行 / 电动车 / 汽车拥有者人数。 */
  vehicleCounts(): [number, number, number] {
    const counts: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < this.agents.count; i++) {
      const v = this.agents.vehicle[i] ?? 0;
      if (v >= 0 && v <= 2) counts[v]!++;
    }
    return counts;
  }

  /** 7 个行为群体之下的 18 类人群画像人数。 */
  profileCounts(): number[] {
    const counts = new Array<number>(PROFILE_META.length).fill(0);
    for (let i = 0; i < this.agents.count; i++) {
      const p = this.agents.profile[i] ?? 0;
      counts[p] = (counts[p] ?? 0) + 1;
    }
    return counts;
  }

  /** 教程提示状态：是否已经放过车站。 */
  hasStations(): boolean {
    return this.net.stations.length > 0;
  }

  /** 读档后重建当日出发事件队列（不会重复触发已经过去的班次）。 */
  rebuildSchedule(): void {
    this.buildDayEvents();
  }

  /** 读档后按已加载的 agent 重建活动链与当日事件。 */
  rebuildActivity(): void {
    if (!this.activityMode) {
      this.rebuildSchedule();
      return;
    }
    this.rebuildActivityChains(this.activitySeed);
    this.activityIndex = new Uint16Array(this.agents.count);
    this.backgroundPaths = new Array(this.agents.count).fill(null);
    this.bgQueued = new Uint8Array(this.agents.count);
    this.walk1Paths = new Array(this.agents.count).fill(null);
    this.walk2Paths = new Array(this.agents.count).fill(null);
    this.activityPending.length = 0;
    this.activityBackgroundTrips = 0;
    this.activityMetroTrips = 0;
    this.walkRoutedTrips = 0;
    this.walkFallbackTrips = 0;
    this.buildDayEvents();
  }

  /** 调试 / 测试用：直接推进游戏分钟（忽略暂停）。 */
  advanceMinutes(minutes: number): void {
    if (minutes <= 0) return;
    this.paused = false;
    this.advance(minutes);
  }
}
