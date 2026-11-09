import raw from '../../map/game-data/terrain-rules.json?raw';

/**
 * Built-in terrain suitability, aggregated to 20 px (~400 m) cells from the
 * game DEM + baked paper map. Used only for the built-in terrain map; custom
 * maps have their own authoring rules.
 */
interface TerrainGrid {
  width: number;
  height: number;
  cellPx: number;
  slopeMaxDeg: number[];
  waterFraction: number[];
}

const grid = JSON.parse(raw) as TerrainGrid;

export interface TerrainAt {
  slopeDeg: number;
  waterFraction: number;
  suitable: boolean;
  reason?: string;
}

export function crossesWater(
  from: { x: number; y: number },
  to: { x: number; y: number },
  stepPx = 16,
): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const n = Math.max(1, Math.ceil(distance / stepPx));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const p = terrainAt(from.x + dx * t, from.y + dy * t);
    if (p.waterFraction > 0.15) return true;
  }
  return false;
}

export function terrainAt(x: number, y: number): TerrainAt {
  const cx = Math.max(0, Math.min(grid.width - 1, Math.floor(x / grid.cellPx)));
  const cy = Math.max(0, Math.min(grid.height - 1, Math.floor(y / grid.cellPx)));
  const index = cy * grid.width + cx;
  const slopeDeg = grid.slopeMaxDeg[index] ?? 0;
  const waterFraction = grid.waterFraction[index] ?? 0;
  if (waterFraction > 0.25) {
    return { slopeDeg, waterFraction, suitable: false, reason: '水域不能建站' };
  }
  if (slopeDeg > 22) {
    return {
      slopeDeg,
      waterFraction,
      suitable: false,
      reason: `山体坡度过陡（${slopeDeg.toFixed(0)}°），不适合建站`,
    };
  }
  return { slopeDeg, waterFraction, suitable: true };
}
