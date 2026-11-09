/** 模拟核心中的共享类型。 */

export type ZoneKind = 'residential' | 'employment' | 'mixed';

export interface Zone {
  id: number;
  name: string;
  kind: ZoneKind;
  x: number;
  y: number;
  r: number;
  /** 相对权重：影响 agent 分布与点阵密度 */
  weight: number;
  /** 点阵数量 */
  dots: number;
}

export interface PopulationDot {
  x: number;
  y: number;
  kind: Exclude<ZoneKind, 'mixed'>;
  zone: number;
}

export interface PopulationCell {
  x: number;
  y: number;
  zone: number;
  /** Estimated/real residents represented by this cell (M1 + density display). */
  population?: number;
}

/**
 * A real or derived residential footprint.
 * `generated` means no OSM residential polygon existed and the polygon was
 * calculated from the village/unit area and built-up area.
 */
export interface ResidentialArea {
  id: number;
  name: string;
  unitName?: string;
  source: 'landuse' | 'community' | 'site' | 'unit-generated';
  generated: boolean;
  /** Build-time only; runtime deliberately does not draw residential outlines. */
  points?: Array<[number, number]>;
  areaKm2: number;
  /** Area used as the density denominator when the mapped polygon is only a small estate. */
  effectiveAreaKm2: number;
  population: number;
  density: number;
  floorAreaM2: number;
  populationSource: 'osm' | 'floor-area' | 'area-density';
}

/** A real OSM place/community centre used as a residential annotation. */
export interface ResidentialPlace {
  name: string;
  x: number;
  y: number;
  place: string;
  unitName?: string;
  level: number;
  population?: number;
}

export interface PopulationField {
  zones: Zone[];
  dots: PopulationDot[];
  residential: PopulationCell[];
  employment: PopulationCell[];
  mixed: PopulationCell[];
  poiZones: Zone[];
  pois: MapPoi[];
  pxPerKm: number;
  residentialAreas?: ResidentialArea[];
  residentialPlaces?: ResidentialPlace[];
}

/** ————————————————— 创作模式地图数据 ————————————————— */

export type RegionType =
  | 'residential'
  | 'employment'
  | 'commercial'
  | 'industrial'
  | 'agriculture'
  | 'mixed'
  | 'water'
  | 'green'
  | 'sensitive'
  | 'pending';

export type PoiType =
  | 'hospital'
  | 'scenic'
  | 'station'
  | 'ferry'
  | 'school'
  | 'mall'
  | 'park'
  | 'stadium'
  | 'airport'
  | 'industry';

/** POI 六级分级：1 邻里 / 2 社区 / 3 片区 / 4 城市 / 5 区域 / 6 国家级。 */
export type PoiLevel = 1 | 2 | 3 | 4 | 5 | 6;

/** 到达时间画像：硬截止 / 软截止 / 脉冲 / 双峰 / 持续。 */
export type PoiTimeProfile = 'hard' | 'soft' | 'pulse' | 'bimodal' | 'continuous';

export type LayerId = 'residential' | 'employment' | 'water' | 'poi';

export interface MapPoint {
  x: number;
  y: number;
}

export interface BrushStamp {
  x: number;
  y: number;
  r: number;
  strength: number;
  hardness: number;
}

export type RegionShape =
  | { kind: 'polygon'; points: MapPoint[] }
  | { kind: 'brush'; stamps: BrushStamp[] };

export interface MapRegion {
  id: number;
  type: RegionType;
  name: string;
  weight: number;
  color: string;
  shape: RegionShape;
}

export interface MapPoi {
  id: number;
  type: PoiType;
  x: number;
  y: number;
  radiusKm: number;
  /** 1–6 级：决定图标、外环、覆盖权重与基准客流 */
  level: PoiLevel;
  /** 同级规模系数 0.5–1.2，与等级基准权重相乘 */
  scale: number;
  /** 日吸引量区间：agent 生成时按区间抽样 */
  dailyMin: number;
  dailyMax: number;
  /** 到达时间画像 */
  profile: PoiTimeProfile;
  /** 开放 / 最后到达时刻（当日分钟） */
  openMin: number;
  closeMin: number;
  name: string;
}

export interface BackgroundData {
  /** 图片中心的世界坐标 */
  x: number;
  y: number;
  scale: number;
  /** 角度制 */
  rotation: number;
  opacity: number;
  visible: boolean;
  width: number;
  height: number;
  filename: string;
  dataUrl: string | null;
}

export interface LayerState {
  id: LayerId;
  visible: boolean;
  locked: boolean;
}

export interface GridState {
  enabled: boolean;
  stepKm: number;
}

export interface CustomMapData {
  version: 1;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  background: BackgroundData | null;
  /** 像素 / 公里；null 表示尚未校准 */
  pxPerKm: number | null;
  regions: MapRegion[];
  pois: MapPoi[];
  layers: LayerState[];
  grid: GridState;
  seed: number;
}

export type StationSize = 'small' | 'standard' | 'large';

/** 慢车（各站停）/ 快车（只停大站） */
export type TrainKind = 'local' | 'express';

export interface Station {
  id: number;
  x: number;
  y: number;
  name: string;
  capacity: number;
  builtAt: number;
  /** 站型：小型 / 标准 / 大型换乘站 */
  size: StationSize;
  lines: number[];
  /** 历史单日最高进站 / 出站 */
  entriesBest?: number;
  exitsBest?: number;
}

export interface Line {
  id: number;
  /** 调色板序号，用于线路编号与默认色 */
  color: number;
  /** 实际显示颜色（#RRGGBB） */
  hex: string;
  /** 运营时段（当日分钟，支持跨午夜） */
  startMin: number;
  endMin: number;
  /** 设计时速（km/h），区段运行时间由站距 / 时速计算 */
  speedKmh: number;
  stationIds: number[];
  trains: number[];
  buildCost: number;
  /** 今日上车人次（本线） */
  ridersToday: number;
  /** 上一个结算日的总客流 */
  ridersLastDay: number;
  /** 历史单日最高客流 */
  ridersBestDay: number;
  /** 历史最高实时在车人数 */
  peakOnboard: number;
  /** 快车停靠站（station id）；慢车不受影响 */
  expressStops: number[];
  /** 支线所属的干线 id；干线不填 */
  branchOf?: number;
}

/** phase: 0 = 停站, 1 = 区间行驶 */
export interface Train {
  id: number;
  lineId: number;
  /** local = 各站停慢车，express = 只停快车停靠站 */
  kind: TrainKind;
  /** 最近一次到达的车站序号（line.stationIds 的下标） */
  index: number;
  /** 区间进度 0..1 */
  prog: number;
  /** 下一次发车方向 +1 / -1 */
  dir: 1 | -1;
  /** 停站结束后的最早发车时刻（绝对分钟），用于同站列车错开发车 */
  departAt?: number;
  phase: 0 | 1;
  dwellLeft: number;
  riders: number[];
  /** 运行区间：起点 / 终点站 id（含），默认整条线；到终点自动折返 */
  startId: number;
  endId: number;
}

export interface Leg {
  lineId: number;
  from: number;
  to: number;
  /** 这条腿坐慢车还是快车 */
  service?: TrainKind;
}

export interface Plan {
  origin: number;
  dest: number;
  legs: Leg[];
  walk1: number;
  walk2: number;
  total: number;
}

export const AgentState = {
  IdleHome: 0,
  WalkToStation: 1,
  Waiting: 2,
  Riding: 3,
  WalkToDest: 4,
  IdleWork: 5,
  /** M2: traveling by a non-metro background mode. */
  InBackground: 6,
} as const;
export type AgentStateValue = (typeof AgentState)[keyof typeof AgentState];

export interface AgentFields {
  count: number;
  homeX: Float32Array;
  homeY: Float32Array;
  workX: Float32Array;
  workY: Float32Array;
  /** 0 通勤 / 1 反向通勤 / 2 灵活 / 3 就医 / 4 休闲 / 5 接驳 / 6 学生 */
  group: Uint8Array;
  /** 找工作时原本所属的群体；失业后 group 会变成灵活，再就业时恢复。 */
  jobGroup: Uint8Array;
  /** 1 = 有工作（含灵活就业）；0 = 失业 / 非劳动力 */
  employed: Uint8Array;
  /** PROFILE_META 下标：7 组之下的年龄 / 职业 / 走读住宿细分 */
  profile: Uint8Array;
  /** 1 = 工作地是 POI（商场 / 医院 / 学校 / 景区 / 车站等），不是就业区 */
  workAtPoi: Uint8Array;
  /** 0 步行 / 1 电动车 / 2 汽车 */
  vehicle: Uint8Array;
  /** 该 agent 对应方式的平均速度（km/h）；步行也有个体差异 */
  speedKmh: Float32Array;
  /** 0 每天 / 1 仅工作日 / 2 仅周末 */
  dayRule: Uint8Array;
  homeZone: Int16Array;
  workZone: Int16Array;
  /** 出发时刻（当日分钟） */
  outMin: Float32Array;
  backMin: Float32Array;
  hasReturn: Uint8Array;
  /** 回程顺路停留：0 没有 / 1 正在去停留点 / 2 已到停留点（等回家） */
  stopDone: Uint8Array;
  /** 1 = 返程已按“实际到达 + 停留”排好，忽略预排的 backMin 事件 */
  returnQueued: Uint8Array;
  state: Uint8Array;
  legIndex: Uint8Array;
  walkLeft: Float32Array;
  /** M2 背景方式的起点 / 总时长 / 方式（0 步行 1 电动车 2 公交 3 汽车） */
  bgFromX: Float32Array;
  bgFromY: Float32Array;
  bgTotal: Float32Array;
  bgMode: Uint8Array;
  /** 本次行程的出发绝对分钟 */
  tripStart: Float32Array;
  tripDestX: Float32Array;
  tripDestY: Float32Array;
  /** 本次行程是否“去程” */
  tripIsOut: Uint8Array;
  targetStation: Int32Array;
  waitStation: Int32Array;
  planDirty: Uint8Array;
  plans: Array<Plan | null>;
}

/** 分段票价：起步价含 freeKm，之后每 stepKm 加 step 元。 */
export interface FareConfig {
  base: number;
  freeKm: number;
  stepKm: number;
  step: number;
}

export interface DailyStats {
  day: number;
  trips: number;
  ridership: number;
  delivered: number;
  unserved: number;
  /** 当日票款（按每次上车时该趟的里程计价累加） */
  revenue: number;
  /** 网络太慢、赶不上硬截止而取消的出行次数 */
  cancelled: number;
  unservedResidential: number;
  unservedEmployment: number;
  commuteSum: number;
  commuteCount: number;
}

export interface DayRecord {
  /** 被结算的那一天 */
  day: number;
  /** 结算后新一天的日期标签（结算卡片用） */
  labelDay: number;
  ridership: number;
  revenue: number;
  cost: number;
  fund: number;
  delivered: number;
  trips: number;
  unserved: number;
  cancelled: number;
  /** 服务可靠性 = 1 − 取消 /（取消 + 送达），0–1 */
  reliability: number;
  avgCommute: number;
  trains: number;
  stations: number;
}

export interface Settings {
  autoPause: boolean;
  skipNight: boolean;
  lockSpeed: boolean;
}

export interface TutorialState {
  active: boolean;
  undoUsed: boolean;
}

export interface ZoneOdPair {
  from: number;
  to: number;
  group: number;
  count: number;
}

export type SimEvent =
  | { type: 'settle'; record: DayRecord }
  | { type: 'peakSoon'; kind: 'am' | 'pm' }
  | { type: 'period'; peak: boolean; label: string }
  | { type: 'saved'; slot: string };

export interface CoveragePreview {
  residents: number;
  jobs: number;
  /** 500 m 核心圈内的概率加权居民 / 岗位 */
  coreResidents: number;
  coreJobs: number;
  /** 覆盖范围内 POI 的加权日吸引量（按等级 × scale 计算） */
  poiAttraction: number;
  existingStations: number;
}
