import { WALK_CORE_RADIUS_M, WALK_MAX_RADIUS_M } from './constants';

/**
 * 站点步行辐射的地铁选择概率。
 * 0–300 m 步行核心区（85%）；300–500 m 步行为主（85%→70%）；
 * 500–1200 m 骑行主力区（70%→45%）；1200–2000 m 电动车长尾（45%→5%）；
 * 2000 m 外视为不覆盖。
 */
const STOPS: Array<{ d: number; p: number }> = [
  { d: 0, p: 0.85 },
  { d: 300, p: 0.85 },
  { d: WALK_CORE_RADIUS_M, p: 0.7 },
  { d: 1200, p: 0.45 },
  { d: WALK_MAX_RADIUS_M, p: 0.05 },
];

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 距离（米）→ 选择地铁的概率（0–1），在关键节点之间平滑插值。 */
export function stationAccessProbability(distanceMeters: number): number {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return STOPS[0]!.p;
  if (distanceMeters > WALK_MAX_RADIUS_M) return 0;
  for (let i = 1; i < STOPS.length; i++) {
    const b = STOPS[i]!;
    if (distanceMeters > b.d) continue;
    const a = STOPS[i - 1]!;
    const t = smoothstep((distanceMeters - a.d) / Math.max(1, b.d - a.d));
    return a.p + (b.p - a.p) * t;
  }
  return 0;
}

/** 由步行分钟数换算距离并取概率。 */
export function walkAccessProbability(
  walkMinutes: number,
  walkSpeedPxPerMin: number,
  pxPerKm: number,
): number {
  const px = Math.max(0, walkMinutes) * Math.max(0, walkSpeedPxPerMin);
  const meters = (px / Math.max(1, pxPerKm)) * 1000;
  return stationAccessProbability(meters);
}
