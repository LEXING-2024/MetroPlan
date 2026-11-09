import type { Graphics } from 'pixi.js';
import type { MapPoi, PoiType } from '../sim/types';

/**
 * POI marker language, aligned with map/analysis/render-game-pois-extended.py:
 *
 * - 9 fixed type colours;
 * - city-level POIs are larger, local-level POIs are smaller;
 * - employment/industry is a square, everything else is a circle.
 *
 * Sizes are screen-space pixels. The analysis PNG uses 3px local / 9px city
 * markers at 2560×1440; the game keeps the same visual hierarchy.
 */
export const POI_MARKER_COLORS: Record<PoiType, number> = {
  scenic: 0xb44830,
  hospital: 0xb95f6e,
  station: 0x50698c,
  ferry: 0x467d87,
  school: 0xbc913c,
  mall: 0x96649b,
  park: 0x5a7d4e,
  stadium: 0x8264a0,
  industry: 0x6e5f48,
  airport: 0x8c97a8,
};

/** 3.2px at level 1 → 9.95px at level 6. */
export function poiMarkerRadius(level: number): number {
  return 3.2 + (Math.max(1, Math.min(6, level)) - 1) * 1.35;
}

/** Local C-level points are translucent; city-level points are solid. */
export function poiMarkerAlpha(level: number): number {
  return level <= 2 ? 0.58 : 0.92;
}

/** Draw the marker at local (0,0); caller positions the container. */
export function drawPoiMarker(g: Graphics, poi: MapPoi): void {
  const color = POI_MARKER_COLORS[poi.type] ?? 0x8c97a8;
  const level = poi.level ?? 3;
  const radius = poiMarkerRadius(level);
  const alpha = poiMarkerAlpha(level);
  if (poi.type === 'industry') {
    g.rect(-radius, -radius, radius * 2, radius * 2).fill({ color, alpha });
  } else {
    g.circle(0, 0, radius).fill({ color, alpha });
  }
}

export function poiMarkerBounds(level: number): number {
  return poiMarkerRadius(level);
}
