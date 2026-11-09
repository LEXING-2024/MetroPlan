import {
  DEFAULT_MIN_GAP_KM,
  DEFAULT_PX_PER_KM,
  DEFAULT_WALK_KM,
  DEFAULT_WALK_SPEED_KMH,
  GROUP_FEEDER,
  GROUP_LEISURE,
  GROUP_MEDICAL,
  GROUP_STUDENT,
} from './constants';
import { weekdayOf } from './calendar';
import type {
  BrushStamp,
  CustomMapData,
  LayerId,
  MapPoint,
  MapPoi,
  MapRegion,
  PopulationCell,
  PopulationDot,
  PopulationField,
  PoiLevel,
  PoiTimeProfile,
  PoiType,
  RegionType,
  Zone,
  ZoneKind,
} from './types';

export const POI_ZONE_BASE = 10_000;

export interface RegionMeta {
  label: string;
  css: string;
  layer: LayerId;
  kind: ZoneKind | null;
  density: number;
}

export const REGION_META: Record<RegionType, RegionMeta> = {
  residential: { label: '住宅区', css: '#C9A98A', layer: 'residential', kind: 'residential', density: 1 },
  employment: { label: '就业区', css: '#8FA6B8', layer: 'employment', kind: 'employment', density: 1.2 },
  commercial: { label: '商业区', css: '#C9B27E', layer: 'employment', kind: 'employment', density: 1 },
  industrial: { label: '工业区', css: '#A79E8C', layer: 'employment', kind: 'employment', density: 0.7 },
  agriculture: { label: '农业区', css: '#AEBF92', layer: 'residential', kind: 'residential', density: 0.25 },
  mixed: { label: '混合区', css: '#B7A9A2', layer: 'employment', kind: 'mixed', density: 0.8 },
  water: { label: '水域', css: '#93B7C4', layer: 'water', kind: null, density: 0 },
  green: { label: '绿地', css: '#A3BF9A', layer: 'water', kind: null, density: 0 },
  sensitive: { label: '敏感区', css: '#C7A6AE', layer: 'water', kind: null, density: 0 },
  pending: { label: '待定', css: '#B9B5A8', layer: 'employment', kind: null, density: 0 },
};

export const REGION_ORDER: RegionType[] = [
  'residential',
  'employment',
  'commercial',
  'industrial',
  'agriculture',
  'mixed',
  'water',
  'green',
  'sensitive',
  'pending',
];

export interface PoiMeta {
  label: string;
  css: string;
  group: number | null;
  radiusKm: number;
  level: PoiLevel;
  profile: PoiTimeProfile;
  openMin: number;
  closeMin: number;
  factor: number;
  icon: string;
}

export const POI_META: Record<PoiType, PoiMeta> = {
  hospital: {
    label: '医院',
    css: '#B97777',
    group: GROUP_MEDICAL,
    radiusKm: 2,
    level: 3,
    profile: 'hard',
    openMin: 480,
    closeMin: 1020,
    factor: 1.2,
    icon: 'hospital',
  },
  scenic: {
    label: '景区',
    css: '#7E9C72',
    group: GROUP_LEISURE,
    radiusKm: 3,
    level: 4,
    profile: 'soft',
    openMin: 480,
    closeMin: 1080,
    factor: 1.3,
    icon: 'mountain',
  },
  station: {
    label: '火车站',
    css: '#7B8FA6',
    group: GROUP_FEEDER,
    radiusKm: 1.5,
    level: 4,
    profile: 'continuous',
    openMin: 330,
    closeMin: 1380,
    factor: 1,
    icon: 'train',
  },
  ferry: {
    label: '渡口',
    css: '#5E8B96',
    group: GROUP_FEEDER,
    radiusKm: 1,
    level: 3,
    profile: 'pulse',
    openMin: 360,
    closeMin: 1320,
    factor: 0.7,
    icon: 'boat',
  },
  school: {
    label: '学校',
    css: '#C2A15E',
    group: GROUP_STUDENT,
    radiusKm: 1,
    level: 3,
    profile: 'bimodal',
    openMin: 420,
    closeMin: 1020,
    factor: 1.1,
    icon: 'book',
  },
  mall: {
    label: '商场',
    css: '#C08A6A',
    group: GROUP_LEISURE,
    radiusKm: 1.2,
    level: 3,
    profile: 'soft',
    openMin: 600,
    closeMin: 1320,
    factor: 0.8,
    icon: 'bag',
  },
  park: {
    label: '公园',
    css: '#8AA76F',
    group: GROUP_LEISURE,
    radiusKm: 2,
    level: 2,
    profile: 'continuous',
    openMin: 360,
    closeMin: 1320,
    factor: 0.6,
    icon: 'tree',
  },
  stadium: {
    label: '体育馆',
    css: '#9B8AA8',
    group: GROUP_LEISURE,
    radiusKm: 1.5,
    level: 4,
    profile: 'pulse',
    openMin: 1080,
    closeMin: 1320,
    factor: 0.6,
    icon: 'stadium',
  },
  airport: {
    label: '机场',
    css: '#8C97A8',
    group: GROUP_LEISURE,
    radiusKm: 5,
    level: 6,
    profile: 'continuous',
    openMin: 300,
    closeMin: 1380,
    factor: 0.8,
    icon: 'plane',
  },
  industry: {
    label: '工业园门口',
    css: '#8F8B7E',
    group: null,
    radiusKm: 1.5,
    level: 3,
    profile: 'hard',
    openMin: 420,
    closeMin: 1140,
    factor: 0,
    icon: 'factory',
  },
};

export interface PoiLevelMeta {
  /** 完整定位 */
  label: string;
  /** 短标签 */
  short: string;
  /** 默认服务半径（km） */
  radiusKm: number;
  /** 覆盖 / 吸引权重 */
  weight: number;
  /** 等级基准日吸引量 */
  daily: number;
}

export const POI_LEVEL_META: Record<PoiLevel, PoiLevelMeta> = {
  6: { label: '国家级 / 跨区域枢纽', short: '6 级', radiusKm: 8, weight: 6, daily: 80_000 },
  5: { label: '区域级枢纽 / 全城核心', short: '5 级', radiusKm: 5, weight: 4, daily: 30_000 },
  4: { label: '城市级重要', short: '4 级', radiusKm: 3, weight: 2.6, daily: 12_000 },
  3: { label: '片区级', short: '3 级', radiusKm: 2, weight: 1.6, daily: 5_000 },
  2: { label: '社区级', short: '2 级', radiusKm: 1.2, weight: 1, daily: 1_800 },
  1: { label: '邻里 / 点缀级', short: '1 级', radiusKm: 0.6, weight: 0.6, daily: 600 },
};

export const POI_LEVEL_ORDER: PoiLevel[] = [6, 5, 4, 3, 2, 1];

export const POI_PROFILE_LABELS: Record<PoiTimeProfile, string> = {
  hard: '硬截止',
  soft: '软截止',
  pulse: '脉冲 / 班次',
  bimodal: '双峰',
  continuous: '持续',
};

export const POI_PROFILE_ORDER: PoiTimeProfile[] = ['hard', 'soft', 'pulse', 'bimodal', 'continuous'];

export const POI_ORDER: PoiType[] = [
  'hospital',
  'scenic',
  'station',
  'ferry',
  'school',
  'mall',
  'park',
  'stadium',
  'airport',
  'industry',
];

export const LAYER_LABELS: Record<LayerId, string> = {
  residential: '住宅层',
  employment: '就业层',
  water: '水域层',
  poi: 'POI 层',
};

export const LAYER_IDS: LayerId[] = ['residential', 'employment', 'water', 'poi'];

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function hexOf(css: string): number {
  return parseInt(css.replace('#', ''), 16) || 0;
}

export function polygonArea(points: MapPoint[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function polygonCentroid(points: MapPoint[]): MapPoint {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length < 3) {
    let x = 0;
    let y = 0;
    for (const p of points) {
      x += p.x;
      y += p.y;
    }
    return { x: x / points.length, y: y / points.length };
  }
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a) < 1e-6) {
    let x = 0;
    let y = 0;
    for (const p of points) {
      x += p.x;
      y += p.y;
    }
    return { x: x / points.length, y: y / points.length };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export function pointInPolygon(x: number, y: number, points: MapPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!;
    const b = points[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** 笔刷区域面积：按图章圆面积估算并扣除重叠。 */
export function brushArea(stamps: BrushStamp[], overlap = 0.52): number {
  let sum = 0;
  for (const s of stamps) sum += Math.PI * s.r * s.r * clamp(s.strength, 0.05, 1);
  return sum * overlap;
}

export function regionAreaPx(region: MapRegion): number {
  if (region.shape.kind === 'polygon') return polygonArea(region.shape.points);
  return brushArea(region.shape.stamps);
}

export function regionAreaKm2(region: MapRegion, pxPerKm: number | null): number {
  const scale = pxPerKm && pxPerKm > 1 ? pxPerKm : DEFAULT_PX_PER_KM;
  return regionAreaPx(region) / (scale * scale);
}

export function regionCentroid(region: MapRegion): MapPoint {
  if (region.shape.kind === 'polygon') return polygonCentroid(region.shape.points);
  let x = 0;
  let y = 0;
  let w = 0;
  for (const s of region.shape.stamps) {
    const weight = s.r * s.r * clamp(s.strength, 0.05, 1);
    x += s.x * weight;
    y += s.y * weight;
    w += weight;
  }
  return w > 0 ? { x: x / w, y: y / w } : { x: 0, y: 0 };
}

export function regionBounds(region: MapRegion): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number, r = 0) => {
    minX = Math.min(minX, x - r);
    minY = Math.min(minY, y - r);
    maxX = Math.max(maxX, x + r);
    maxY = Math.max(maxY, y + r);
  };
  if (region.shape.kind === 'polygon') {
    for (const p of region.shape.points) add(p.x, p.y);
  } else {
    for (const s of region.shape.stamps) add(s.x, s.y, s.r);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

export function hitRegion(region: MapRegion, x: number, y: number, tolerance = 4): boolean {
  if (region.shape.kind === 'polygon') {
    if (region.shape.points.length >= 3 && pointInPolygon(x, y, region.shape.points)) return true;
    const pts = region.shape.points;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      if (distanceToSegment(x, y, a.x, a.y, b.x, b.y) <= tolerance) return true;
    }
    return false;
  }
  for (const s of region.shape.stamps) {
    if (Math.hypot(x - s.x, y - s.y) <= s.r) return true;
  }
  return false;
}

export function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

export function regionLayer(type: RegionType): LayerId {
  return REGION_META[type].layer;
}

export function layerOfPoi(): LayerId {
  return 'poi';
}

export function poiZoneId(poi: MapPoi): number {
  return POI_ZONE_BASE + poi.id;
}

/** 每个区域按权重与类型生成人口/岗位点。 */
function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleRegionDots(
  region: MapRegion,
  pxPerKm: number,
  zoneId: number,
  seed = 1,
): PopulationDot[] {
  const rng = seededRng(seed ^ Math.imul(zoneId, 0x9e3779b1));
  const meta = REGION_META[region.type];
  if (!meta.kind || meta.density <= 0) return [];
  const area = regionAreaPx(region);
  if (area < 40) return [];
  const areaKm2 = area / (pxPerKm * pxPerKm);
  const count = Math.round(clamp(areaKm2 * 58 * Math.max(0.1, region.weight) * meta.density, 6, 1800));
  const kind: 'residential' | 'employment' = meta.kind === 'employment' ? 'employment' : 'residential';
  const dots: PopulationDot[] = [];

  if (region.shape.kind === 'polygon') {
    const pts = region.shape.points;
    if (pts.length < 3) return [];
    const box = regionBounds(region);
    const step = Math.sqrt(area / Math.max(1, count));
    let row = 0;
    for (let y = box.minY; y <= box.maxY; y += step * 0.866, row++) {
      const offset = (row % 2) * (step / 2);
      for (let x = box.minX - offset; x <= box.maxX; x += step) {
        const jx = x + (rng() - 0.5) * step * 0.3;
        const jy = y + (rng() - 0.5) * step * 0.3;
        if (pointInPolygon(jx, jy, pts)) dots.push({ x: jx, y: jy, kind, zone: zoneId });
      }
    }
    return dots;
  }

  const stamps = region.shape.stamps;
  if (stamps.length === 0) return [];
  const weights = stamps.map((s) => s.r * s.r * clamp(s.strength, 0.05, 1));
  let total = 0;
  for (const w of weights) total += w;
  if (total <= 0) return [];
  for (let i = 0; i < count; i++) {
    let r = rng() * total;
    let idx = 0;
    for (; idx < stamps.length; idx++) {
      r -= weights[idx]!;
      if (r <= 0) break;
    }
    const s = stamps[Math.min(idx, stamps.length - 1)]!;
    const angle = rng() * Math.PI * 2;
    const rad = s.r * Math.pow(rng(), 0.62);
    dots.push({ x: s.x + Math.cos(angle) * rad, y: s.y + Math.sin(angle) * rad, kind, zone: zoneId });
  }
  return dots;
}

export function customWalkRadius(pxPerKm: number): number {
  return clamp(pxPerKm * DEFAULT_WALK_KM, 8, 900);
}

export function customWalkSpeed(pxPerKm: number): number {
  return clamp(pxPerKm * (DEFAULT_WALK_SPEED_KMH / 60), 0.8, 30);
}

export function customMinGap(pxPerKm: number): number {
  return clamp(pxPerKm * DEFAULT_MIN_GAP_KM, 12, 120);
}

export function makePoi(type: PoiType, x: number, y: number, id: number): MapPoi {
  const meta = POI_META[type];
  const scale = 1;
  const range = poiDailyRange(meta.level, scale);
  return {
    id,
    type,
    x,
    y,
    radiusKm: meta.radiusKm,
    level: meta.level,
    scale,
    dailyMin: range.dailyMin,
    dailyMax: range.dailyMax,
    profile: meta.profile,
    openMin: meta.openMin,
    closeMin: meta.closeMin,
    name: meta.label,
  };
}

export function clampPoiLevel(value: unknown): PoiLevel {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(6, n)) as PoiLevel;
}

export function clampPoiProfile(value: unknown): PoiTimeProfile {
  return POI_PROFILE_ORDER.includes(value as PoiTimeProfile)
    ? (value as PoiTimeProfile)
    : 'continuous';
}

/** 同级规模系数 0.5–1.2；同级最大 / 最小客流差不超过 2.4 倍。 */
export function clampPoiScale(value: unknown): number {
  return clamp(Number(value) || 1, 0.5, 1.2);
}

/** 由等级与 scale 推导日吸引量区间。 */
export function poiDailyRange(level: PoiLevel, scale: number): { dailyMin: number; dailyMax: number } {
  const daily = POI_LEVEL_META[level].daily * clampPoiScale(scale);
  return { dailyMin: Math.round(daily * 0.85), dailyMax: Math.round(daily * 1.15) };
}

export function poiDailyMid(poi: MapPoi): number {
  return Math.max(1, (poi.dailyMin + poi.dailyMax) / 2);
}

/** 覆盖 / 吸引权重 = 等级基准权重 × 同级规模系数。 */
export function poiLevelWeight(poi: MapPoi): number {
  return POI_LEVEL_META[poi.level].weight * clampPoiScale(poi.scale);
}

/** 修改等级时同步默认半径与日吸引量。 */
export function applyPoiLevel(poi: MapPoi, level: PoiLevel): void {
  poi.level = level;
  poi.radiusKm = POI_LEVEL_META[level].radiusKm;
  const range = poiDailyRange(level, poi.scale);
  poi.dailyMin = range.dailyMin;
  poi.dailyMax = range.dailyMax;
}

export function applyPoiScale(poi: MapPoi, scale: number): void {
  poi.scale = clampPoiScale(scale);
  const range = poiDailyRange(poi.level, poi.scale);
  poi.dailyMin = range.dailyMin;
  poi.dailyMax = range.dailyMax;
}

function legacyProfile(window: string | undefined): PoiTimeProfile {
  switch (window) {
    case 'always':
      return 'continuous';
    case 'daytime':
      return 'soft';
    case 'school':
      return 'bimodal';
    case 'schedule':
      return 'continuous';
    case 'evening':
      return 'pulse';
    default:
      return 'continuous';
  }
}

function legacyHours(window: string | undefined): { openMin: number; closeMin: number } {
  switch (window) {
    case 'always':
      return { openMin: 0, closeMin: 1440 };
    case 'daytime':
      return { openMin: 540, closeMin: 1080 };
    case 'school':
      return { openMin: 420, closeMin: 1020 };
    case 'schedule':
      return { openMin: 330, closeMin: 1380 };
    case 'evening':
      return { openMin: 1080, closeMin: 1320 };
    default:
      return { openMin: 360, closeMin: 1320 };
  }
}

/** 兼容旧自定义地图：补齐 6 级分级与时间画像字段。 */
export function normalizePoi(raw: MapPoi): MapPoi {
  const meta = POI_META[raw.type] ?? POI_META.industry;
  const level = clampPoiLevel(raw.level ?? meta.level);
  const scale = clampPoiScale(raw.scale ?? (raw as unknown as { weight?: number }).weight ?? 1);
  const profile = clampPoiProfile(raw.profile ?? legacyProfile((raw as unknown as { window?: string }).window));
  const hours = legacyHours((raw as unknown as { window?: string }).window);
  const openMin = Number.isFinite(raw.openMin) ? clamp(raw.openMin, 0, 1439) : hours.openMin;
  const closeMin = Number.isFinite(raw.closeMin) ? clamp(raw.closeMin, 1, 1440) : hours.closeMin;
  const range = poiDailyRange(level, scale);
  const dailyMin =
    Number.isFinite(raw.dailyMin) && raw.dailyMin > 0 ? Math.round(raw.dailyMin) : range.dailyMin;
  const dailyMax =
    Number.isFinite(raw.dailyMax) && raw.dailyMax > 0 ? Math.round(raw.dailyMax) : range.dailyMax;
  return {
    ...raw,
    level,
    scale,
    profile,
    openMin: Math.min(openMin, closeMin - 1),
    closeMin: Math.max(closeMin, openMin + 1),
    dailyMin: Math.min(dailyMin, dailyMax),
    dailyMax: Math.max(dailyMin, dailyMax),
  };
}

/** 兼容旧自定义地图：补齐全部 POI 字段。 */
export function normalizeMap(map: CustomMapData): CustomMapData {
  return { ...map, pois: map.pois.map(normalizePoi) };
}

function isWeekend(dayIndex: number): boolean {
  const w = weekdayOf(dayIndex);
  return w === 0 || w === 6;
}

/** 周末 / 工作日客流切换。 */
export function poiDayFactor(poi: MapPoi, dayIndex: number): number {
  const weekend = isWeekend(dayIndex);
  if (poi.type === 'school') return weekend ? 0 : 1;
  if (poi.type === 'scenic' || poi.type === 'park' || poi.type === 'mall' || poi.type === 'stadium') {
    return weekend ? 1.3 : 0.92;
  }
  if (poi.type === 'ferry') return weekend ? 1.1 : 1;
  return 1;
}

function gaussian(x: number, center: number, sigma: number): number {
  const d = (x - center) / sigma;
  return Math.exp(-0.5 * d * d);
}

/** 画像本身在一天内的相对到达强度（0–1），不含周末系数。 */
export function poiProfileWeight(poi: MapPoi, tod: number): number {
  const open = poi.openMin;
  const close = poi.closeMin;
  if (tod < open || tod >= close) return 0;
  const span = Math.max(1, close - open);
  const u = (tod - open) / span;
  switch (poi.profile) {
    case 'hard': {
      // 开门后 12 分钟爬升，截止即归零。
      return Math.min(1, (tod - open) / 12);
    }
    case 'soft': {
      // 最后两小时逐渐变细，到截止归零。
      const fadeFrom = Math.max(open, close - 120);
      if (tod <= fadeFrom) return 1;
      const t = (tod - fadeFrom) / Math.max(1, close - fadeFrom);
      return Math.max(0.2, 1 - 0.8 * t);
    }
    case 'pulse': {
      // 每 30 分钟一班，班次时刻最密，班次之间仍有少量到达。
      const period = 30;
      const phase = (tod - open) % period;
      const edge = Math.min(phase, period - phase);
      return Math.max(0.25, Math.min(1, 0.25 + 0.75 * Math.exp(-Math.pow(edge / 4, 2)) + 0.2 * Math.exp(-Math.pow((period - edge) / 6, 2))));
    }
    case 'bimodal': {
      const p1 = open + span * 0.28;
      const p2 = open + span * 0.72;
      const sigma = Math.max(18, span * 0.09);
      const peak = Math.max(gaussian(tod, p1, sigma), gaussian(tod, p2, sigma));
      return Math.min(1, 0.22 + 0.78 * peak);
    }
    case 'continuous':
    default:
      return 0.6 + 0.4 * Math.sin(Math.PI * u);
  }
}

/** 当前时刻该 POI 的 OD 客流乘数（画像 × 周末系数）。 */
export function poiTimeWeight(poi: MapPoi, tod: number, dayIndex: number): number {
  return poiProfileWeight(poi, tod) * poiDayFactor(poi, dayIndex);
}

/** 按画像抽样 agent 的出发时刻（当日分钟）。 */
export function samplePoiOutMin(poi: MapPoi, rng: () => number): number {
  const open = poi.openMin;
  const span = Math.max(1, poi.closeMin - open - 1);
  for (let i = 0; i < 32; i++) {
    const t = open + rng() * span;
    if (rng() <= poiProfileWeight(poi, t)) return t;
  }
  return open + span * 0.5;
}

export function poiAgentWindow(
  poi: MapPoi,
  rng: () => number,
): { outMin: number; backMin: number; dayRule: 0 | 1 | 2 } {
  const outMin = samplePoiOutMin(poi, rng);
  let backMin: number;
  if (poi.type === 'school') {
    backMin = clamp(960 + rng() * 150, outMin + 120, 1435);
  } else if (poi.type === 'hospital') {
    backMin = clamp(outMin + 120 + rng() * 180, outMin + 30, 1435);
  } else if (poi.type === 'scenic') {
    backMin = clamp(outMin + 180 + rng() * 240, outMin + 30, 1435);
  } else {
    backMin = clamp(outMin + 60 + rng() * 180, outMin + 30, 1435);
  }
  const leisure =
    poi.type === 'scenic' || poi.type === 'mall' || poi.type === 'park' || poi.type === 'stadium';
  const dayRule: 0 | 1 | 2 =
    poi.type === 'school' ? 1 : leisure && rng() < 0.45 ? 2 : 0;
  return { outMin, backMin, dayRule };
}

export function buildPopulationField(map: CustomMapData): PopulationField {
  const pxPerKm = map.pxPerKm && map.pxPerKm > 1 ? map.pxPerKm : DEFAULT_PX_PER_KM;
  const zones: Zone[] = [];
  const dots: PopulationDot[] = [];
  const residential: PopulationCell[] = [];
  const employment: PopulationCell[] = [];
  const mixed: PopulationCell[] = [];
  const poiZones: Zone[] = [];
  const nameCounts = new Map<string, number>();

  for (const region of map.regions) {
    const meta = REGION_META[region.type];
    if (!meta.kind) continue;
    const centroid = regionCentroid(region);
    const area = regionAreaPx(region);
    if (area < 40) continue;
    const n = (nameCounts.get(meta.label) ?? 0) + 1;
    nameCounts.set(meta.label, n);
    const name = region.name.trim() || `${meta.label} ${n}`;
    const zone: Zone = {
      id: region.id,
      name,
      kind: meta.kind,
      x: centroid.x,
      y: centroid.y,
      r: Math.max(14, Math.sqrt(area / Math.PI)),
      weight: Math.max(0.1, region.weight),
      dots: 0,
    };
    const regionDots = sampleRegionDots(region, pxPerKm, zone.id, map.seed);
    zone.dots = regionDots.length;
    zones.push(zone);
    for (const d of regionDots) {
      dots.push(d);
      const cell: PopulationCell = { x: d.x, y: d.y, zone: zone.id };
      if (meta.kind === 'residential') residential.push(cell);
      else if (meta.kind === 'employment') employment.push(cell);
      else {
        residential.push(cell);
        mixed.push(cell);
      }
    }
  }

  const pois = map.pois.map(normalizePoi);
  for (const poi of pois) {
    const meta = POI_META[poi.type];
    if (meta.group === null) continue;
    const zone: Zone = {
      id: poiZoneId(poi),
      name: poi.name || meta.label,
      kind: 'mixed',
      x: poi.x,
      y: poi.y,
      r: Math.max(12, poi.radiusKm * pxPerKm),
      weight: Math.max(0.1, poiLevelWeight(poi)),
      dots: 0,
    };
    zones.push(zone);
    poiZones.push(zone);
  }

  return { zones, dots, residential, employment, mixed, poiZones, pois, pxPerKm };
}

export function createBlankMap(name = '未命名地图'): CustomMapData {
  const now = Date.now();
  return {
    version: 1,
    id: `map-${now.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    name,
    createdAt: now,
    updatedAt: now,
    background: null,
    pxPerKm: null,
    regions: [],
    pois: [],
    layers: LAYER_IDS.map((id) => ({ id, visible: true, locked: false })),
    grid: { enabled: false, stepKm: 0.5 },
    seed: Math.floor(Math.random() * 1e9),
  };
}

export function mapStats(map: CustomMapData): {
  regions: number;
  pois: number;
  areaKm2: number;
  residentialDots: number;
  employmentDots: number;
} {
  const pxPerKm = map.pxPerKm ?? DEFAULT_PX_PER_KM;
  let areaKm2 = 0;
  let residentialDots = 0;
  let employmentDots = 0;
  for (const r of map.regions) {
    areaKm2 += regionAreaKm2(r, pxPerKm);
    const meta = REGION_META[r.type];
    if (!meta.kind) continue;
    const count = sampleRegionDots(r, pxPerKm, r.id, map.seed).length;
    if (meta.kind === 'employment') employmentDots += count;
    else residentialDots += count;
  }
  return { regions: map.regions.length, pois: map.pois.length, areaKm2, residentialDots, employmentDots };
}

/** 导出或存档时去掉底图像素，只保留引用信息。 */
export function stripBackgroundPixels(map: CustomMapData): CustomMapData {
  if (!map.background) return { ...map };
  return {
    ...map,
    background: { ...map.background, dataUrl: null },
    regions: map.regions.map((r) => ({ ...r, shape: cloneShape(r.shape) })),
    pois: map.pois.map((p) => ({ ...p })),
    layers: map.layers.map((l) => ({ ...l })),
  };
}

function cloneShape(shape: MapRegion['shape']): MapRegion['shape'] {
  if (shape.kind === 'polygon') return { kind: 'polygon', points: shape.points.map((p) => ({ ...p })) };
  return { kind: 'brush', stamps: shape.stamps.map((s) => ({ ...s })) };
}

export function cloneMap(map: CustomMapData, includeBackground = true): CustomMapData {
  return {
    ...map,
    background: map.background
      ? { ...map.background, dataUrl: includeBackground ? map.background.dataUrl : null }
      : null,
    regions: map.regions.map((r) => ({
      ...r,
      shape: cloneShape(r.shape),
    })),
    pois: map.pois.map((p) => ({ ...p })),
    layers: map.layers.map((l) => ({ ...l })),
    grid: { ...map.grid },
  };
}
