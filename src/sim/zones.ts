import { BUILTIN_PX_PER_KM, WALK_RADIUS } from './constants';
import { stationAccessProbability } from './access';
import { GEO_ZONES } from '../maps/geoData';
import { inTerrain, projectTerrain } from '../maps/geo';
import type { PopulationDot, Zone, ZoneKind } from './types';

/**
 * 地形图组团：使用真实 OSM 村 / 社区 / 街道中心的经纬度，
 * 按底图生成时的 Web Mercator 范围投影，并裁掉底图范围外的点位。
 */
function zone(
  id: number,
  name: string,
  kind: ZoneKind,
  x: number,
  y: number,
  r: number,
  weight: number,
): Zone {
  const dots = kind === 'mixed' ? 0 : Math.round(weight * 240);
  return { id, name, kind, x, y, r, weight, dots };
}

export const ZONES: Zone[] = GEO_ZONES.filter((z) => inTerrain(z.lng, z.lat)).map(
  (z, index) => {
    const p = projectTerrain(z.lng, z.lat);
    return zone(index, z.name, z.kind, p.x, p.y, z.rKm * BUILTIN_PX_PER_KM, z.weight);
  },
);

export const ZONE_BY_ID = new Map<number, Zone>(ZONES.map((z) => [z.id, z]));

export const RESIDENTIAL_ZONES = ZONES.filter((z) => z.kind === 'residential');
export const EMPLOYMENT_ZONES = ZONES.filter((z) => z.kind === 'employment');
export const MIXED_ZONES = ZONES.filter((z) => z.kind === 'mixed');

export function zoneById(id: number): Zone | undefined {
  return ZONE_BY_ID.get(id);
}

/** 点击命中：包含该点、且归一化距离最近的组团。 */
export function hitZone(x: number, y: number): Zone | null {
  let best: Zone | null = null;
  let bestScore = Infinity;
  for (const z of ZONES) {
    const dx = x - z.x;
    const dy = y - z.y;
    const d = Math.hypot(dx, dy);
    if (d > z.r) continue;
    const score = d / z.r;
    if (score < bestScore) {
      bestScore = score;
      best = z;
    }
  }
  return best;
}

export function zoneKindAt(x: number, y: number): ZoneKind | null {
  return hitZone(x, y)?.kind ?? null;
}

/** 固定种子，保证点阵、agent 分布与存档一致。 */
export const MAP_SEED = 20260101;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 人口 / 岗位点阵：可传入任意组团集合（内置地形图 / 纯色图 / 自定义图共用）。 */
export function buildPopulationDotsFor(zones: Zone[], seed = MAP_SEED): PopulationDot[] {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const dots: PopulationDot[] = [];
  for (const z of zones) {
    if (z.kind === 'mixed' || z.dots <= 0) continue;
    const kind: 'residential' | 'employment' = z.kind;
    const area = Math.PI * z.r * z.r;
    const spacing = Math.sqrt(area / z.dots) * 0.92;
    const rowStep = spacing * 0.866;
    let rowIndex = 0;
    for (let row = -z.r; row <= z.r; row += rowStep, rowIndex++) {
      const offset = (rowIndex % 2) * (spacing / 2);
      for (let col = -z.r - offset; col <= z.r; col += spacing) {
        const jx = col + (rng() - 0.5) * spacing * 0.34;
        const jy = row + (rng() - 0.5) * spacing * 0.34;
        if (jx * jx + jy * jy > z.r * z.r) continue;
        dots.push({ x: z.x + jx, y: z.y + jy, kind, zone: z.id });
      }
    }
  }
  return dots;
}

export function buildPopulationDots(): PopulationDot[] {
  return buildPopulationDotsFor(ZONES);
}

/** 每个点代表的人数 / 岗位数。 */
export const PEOPLE_PER_DOT = 100;

/** 在任意组团集合上做点击命中（自定义地图使用）。 */
export function hitZoneIn(zones: Zone[], x: number, y: number): Zone | null {
  let best: Zone | null = null;
  let bestScore = Infinity;
  for (const z of zones) {
    const d = Math.hypot(x - z.x, y - z.y);
    if (d > z.r) continue;
    const score = d / Math.max(1, z.r);
    if (score < bestScore) {
      bestScore = score;
      best = z;
    }
  }
  return best;
}

export function coverageAt(
  x: number,
  y: number,
  dots: PopulationDot[],
  radius = WALK_RADIUS,
  mixedZones: Zone[] = MIXED_ZONES,
  pxPerKm = BUILTIN_PX_PER_KM,
): { residents: number; jobs: number } {
  const r2 = radius * radius;
  let residents = 0;
  let jobs = 0;
  for (const d of dots) {
    const dx = d.x - x;
    const dy = d.y - y;
    if (dx * dx + dy * dy > r2) continue;
    const meters = (Math.hypot(dx, dy) / Math.max(1, pxPerKm)) * 1000;
    const p = stationAccessProbability(meters);
    if (p <= 0) continue;
    if (d.kind === 'residential') residents += p;
    else jobs += p;
  }
  // 混合区提供一部分岗位
  for (const z of mixedZones) {
    const d = Math.hypot(z.x - x, z.y - y);
    const reach = z.r + radius;
    if (d > reach) continue;
    const p = stationAccessProbability((d / Math.max(1, pxPerKm)) * 1000);
    jobs += (p * z.weight * 60 * Math.max(0, 1 - d / reach)) / PEOPLE_PER_DOT;
  }
  return {
    residents: Math.round(residents * PEOPLE_PER_DOT),
    jobs: Math.round(jobs * PEOPLE_PER_DOT),
  };
}


