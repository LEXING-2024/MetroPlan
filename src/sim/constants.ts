import type { FareConfig, StationSize } from './types';

/** 全局数值标定与调色板。 */

export const WORLD_W = 2560;
export const WORLD_H = 1440;
export const MAP_ID = 'duanzhou-dinghu-simple';

/** 经济 */
export const START_FUND = 50_000;
export const STATION_COST = 1_000;
export const STATION_DAILY = 30;
export const SEGMENT_COST = 500;
export const LINE_REFUND_RATE = 0.5;
export const TRAIN_COST = 2_000;
export const TRAIN_DAILY = 100;
export const TRAIN_COST_EXPRESS = 2_600;
export const TRAIN_DAILY_EXPRESS = 130;
/** 分段票价默认值：起步 ¥2 含 6 km，之后每 6 km 加 ¥1。 */
export const DEFAULT_FARE: FareConfig = { base: 2, freeKm: 6, stepKm: 6, step: 1 };

/** 车站 */
/** 站口舒适承载力：满 100% 时开始出现站外排队与满意度下滑。 */
export const STATION_CAPACITY = 100;
export const STATION_RADIUS = 13;
export const MIN_STATION_GAP = 46;

/** 三种站型：候车上限 / 建设费 / 日运营成本。 */
export const STATION_SIZES: Record<
  StationSize,
  { label: string; capacity: number; cost: number; daily: number; note: string }
> = {
  small: {
    label: '小型站',
    capacity: 60,
    cost: 600,
    daily: 20,
    note: '郊区、低密度住宅、末端站',
  },
  standard: {
    label: '标准站',
    capacity: 100,
    cost: 1_000,
    daily: 30,
    note: '一般住宅 / 就业站，默认推荐',
  },
  large: {
    label: '大型换乘站',
    capacity: 250,
    cost: 3_000,
    daily: 80,
    note: '换乘枢纽、高密度中心、多线交汇',
  },
};

/** 乘客 / 步行 */
/**
 * 极端自定义地图的防溢出保护线，不是玩法人口上限。
 * 内置地图的人口由住宅 / 就业点阵推导；当前默认约 10 万 agent。
 */
export const MAX_AGENTS = 150_000;
/** 内置地形图默认最大步行辐射：50 px/km 下的 2 km。 */
export const WALK_RADIUS = 100;
/** 4.5 km/h，换算到 50 px/km 地形图的像素速度。 */
export const WALK_SPEED = 3.75;
/** 站点步行辐射的核心圈 / 最大边界（米）。 */
export const WALK_CORE_RADIUS_M = 500;
export const WALK_MAX_RADIUS_M = 2000;
export const TRANSFER_PENALTY = 1;

/** 自定义地图的比例尺默认值 */
export const DEFAULT_PX_PER_KM = 50;
/** 地形底图生成范围 112.32–112.82E / 23.00–23.26N 的实际比例尺。 */
export const BUILTIN_PX_PER_KM = 50;
/** 纯色图 112.00–113.07E / 22.84–23.40N 的实际比例尺。 */
export const PLAIN_PX_PER_KM = 23.4;
export const DEFAULT_WALK_KM = 2.0;
export const DEFAULT_WALK_SPEED_KMH = 4.5;
export const DEFAULT_MIN_GAP_KM = 0.25;

/** 列车 */
export const TRAIN_CAPACITY = 120;
/** 慢车设计时速（km/h）。 */
export const LOCAL_TRAIN_SPEED_KMH = 80;
/** 快车设计时速（km/h）。 */
export const EXPRESS_TRAIN_SPEED_KMH = 120;
/** 兼容旧存档 / 线路字段：默认按慢车速度。 */
export const DEFAULT_TRAIN_SPEED_KMH = LOCAL_TRAIN_SPEED_KMH;
export const TRAIN_DWELL = 1.4;
/** 每多一名上车乘客增加的停站时间（分钟），上限 2.6 分。 */
export const TRAIN_DWELL_PER_BOARDING = 0.02;
export const TRAIN_DWELL_MAX_EXTRA = 2.6;

export function speedForTrainKind(kind: 'local' | 'express'): number {
  return kind === 'express' ? EXPRESS_TRAIN_SPEED_KMH : LOCAL_TRAIN_SPEED_KMH;
}
export const DEFAULT_SERVICE_START = 360;
export const DEFAULT_SERVICE_END = 1410;

/** 群体 */
export const GROUP_COMMUTER = 0;
export const GROUP_REVERSE = 1;
export const GROUP_FLEXIBLE = 2;
export const GROUP_MEDICAL = 3;
export const GROUP_LEISURE = 4;
export const GROUP_FEEDER = 5;
export const GROUP_STUDENT = 6;

export const GROUP_META = [
  { id: 0, name: '通勤族', short: '通勤', color: 0x9a8873, css: '#9A8873', share: 0.7 },
  { id: 1, name: '反向通勤族', short: '反向', color: 0x7d8f9c, css: '#7D8F9C', share: 0.1 },
  { id: 2, name: '灵活出行族', short: '灵活', color: 0xb3a894, css: '#B3A894', share: 0.2 },
  { id: 3, name: '就医出行', short: '就医', color: 0xb97777, css: '#B97777', share: 0 },
  { id: 4, name: '休闲出行', short: '休闲', color: 0x7e9c72, css: '#7E9C72', share: 0 },
  { id: 5, name: '接驳出行', short: '接驳', color: 0x7b8fa6, css: '#7B8FA6', share: 0 },
  { id: 6, name: '学生出行', short: '学生', color: 0xc2a15e, css: '#C2A15E', share: 0 },
] as const;

export interface ProfileMeta {
  id: number;
  /** 行为归并到 7 个基础群体之一。 */
  group: number;
  name: string;
  short: string;
  ageBand: string;
  occupation: string;
  studentType?: 'day' | 'boarding';
}

/**
 * 人群画像：在 7 个行为群体下继续细分年龄 / 职业 / 学生类型。
 * 行为仍按 group 走，画像用于统计、展示和局部参数（车辆、作息）。
 */
export const PROFILE_META: ProfileMeta[] = [
  { id: 0, group: GROUP_COMMUTER, name: '通勤·办公室', short: '办公室', ageBand: '25–55', occupation: '白领 / 机关' },
  { id: 1, group: GROUP_COMMUTER, name: '通勤·服务业', short: '服务业', ageBand: '18–45', occupation: '餐饮 / 零售 / 轮班' },
  { id: 2, group: GROUP_COMMUTER, name: '通勤·产业工人', short: '产业工人', ageBand: '20–55', occupation: '制造 / 物流' },
  { id: 3, group: GROUP_REVERSE, name: '反向·服务人员', short: '反向服务', ageBand: '18–50', occupation: '住在就业区的服务人员' },
  { id: 4, group: GROUP_FLEXIBLE, name: '灵活·自由职业', short: '自由职业', ageBand: '20–55', occupation: '设计 / 跑单 / 直播' },
  { id: 5, group: GROUP_FLEXIBLE, name: '灵活·个体商户', short: '个体商户', ageBand: '25–60', occupation: '小店 / 批发' },
  { id: 6, group: GROUP_FLEXIBLE, name: '灵活·全职家长', short: '全职家长', ageBand: '25–45', occupation: '接送 / 家务' },
  { id: 7, group: GROUP_MEDICAL, name: '就医·老人', short: '老人就医', ageBand: '60+', occupation: '退休 / 慢病' },
  { id: 8, group: GROUP_MEDICAL, name: '就医·陪护', short: '陪护', ageBand: '30–60', occupation: '家属陪护' },
  { id: 9, group: GROUP_LEISURE, name: '休闲·本地居民', short: '本地休闲', ageBand: '18–65', occupation: '本地休闲' },
  { id: 10, group: GROUP_LEISURE, name: '休闲·外地游客', short: '游客', ageBand: '18–60', occupation: '外地游客' },
  { id: 11, group: GROUP_FEEDER, name: '接驳·铁路', short: '铁路接驳', ageBand: '18–60', occupation: '铁路旅客' },
  { id: 12, group: GROUP_FEEDER, name: '接驳·渡口', short: '渡口接驳', ageBand: '18–60', occupation: '渡口旅客' },
  { id: 13, group: GROUP_STUDENT, name: '学生·小学走读', short: '小学走读', ageBand: '6–12', occupation: '小学生', studentType: 'day' },
  { id: 14, group: GROUP_STUDENT, name: '学生·中学走读', short: '中学走读', ageBand: '12–18', occupation: '中学生', studentType: 'day' },
  { id: 15, group: GROUP_STUDENT, name: '学生·中学住宿', short: '中学住宿', ageBand: '12–18', occupation: '中学生', studentType: 'boarding' },
  { id: 16, group: GROUP_STUDENT, name: '学生·高校住宿', short: '高校住宿', ageBand: '18–22', occupation: '大学生', studentType: 'boarding' },
  { id: 17, group: GROUP_STUDENT, name: '学生·高校走读', short: '高校走读', ageBand: '18–22', occupation: '大学生', studentType: 'day' },
];

export const LINE_COLORS = [
  { hex: 0xc84b3a, css: '#C84B3A', name: '朱红' },
  { hex: 0x2f6d9e, css: '#2F6D9E', name: '靛蓝' },
  { hex: 0x3f8757, css: '#3F8757', name: '松绿' },
  { hex: 0xc1872e, css: '#C1872E', name: '琥珀' },
  { hex: 0x7657ad, css: '#7657AD', name: '紫藤' },
  { hex: 0x2e8585, css: '#2E8585', name: '水鸭' },
] as const;

export const SAVE_VERSION = '0.9.0';
export const SAVE_DB_NAME = 'metro-plan-db';
export const SAVE_DB_VERSION = 2;
