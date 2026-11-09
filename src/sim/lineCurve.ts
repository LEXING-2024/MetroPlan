export interface CurvePoint {
  x: number;
  y: number;
}

/** 区段中点的垂线偏移；量很小，只让线路不要像尺子画出来的一样直。 */
function controlPoint(a: CurvePoint, b: CurvePoint, index: number, seed: number): CurvePoint {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const sign = ((index + seed) & 1) === 0 ? 1 : -1;
  const bend = Math.min(26, len * 0.11) * sign;
  return {
    x: (a.x + b.x) / 2 - (dy / len) * bend,
    y: (a.y + b.y) / 2 + (dx / len) * bend,
  };
}

/** 二次贝塞尔上的点；t 为 0..1。 */
export function curvePoint(
  a: CurvePoint,
  b: CurvePoint,
  index: number,
  t: number,
  seed = 0,
): CurvePoint {
  const c = controlPoint(a, b, index, seed);
  const mt = 1 - t;
  return {
    x: mt * mt * a.x + 2 * mt * t * c.x + t * t * b.x,
    y: mt * mt * a.y + 2 * mt * t * c.y + t * t * b.y,
  };
}

/** 曲线切线方向，用于列车车头角度。 */
export function curveAngle(
  a: CurvePoint,
  b: CurvePoint,
  index: number,
  t: number,
  seed = 0,
): number {
  const c = controlPoint(a, b, index, seed);
  const dx = 2 * (1 - t) * (c.x - a.x) + 2 * t * (b.x - c.x);
  const dy = 2 * (1 - t) * (c.y - a.y) + 2 * t * (b.y - c.y);
  return Math.atan2(dy, dx);
}

/** 把一条折线采样成平滑曲线；站点位置保持不动。 */
export function curvePolyline(
  pts: CurvePoint[],
  seed = 0,
  stepsPerSegment = 14,
): CurvePoint[] {
  if (pts.length < 2) return pts;
  const out: CurvePoint[] = [pts[0]!];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    for (let k = 1; k <= stepsPerSegment; k++) {
      out.push(curvePoint(a, b, i, k / stepsPerSegment, seed));
    }
  }
  return out;
}

/** 平滑起步 / 停车：两端速度为 0，中段最快。 */
export function smoothTravel(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}
