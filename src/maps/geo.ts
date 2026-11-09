import { WORLD_H, WORLD_W } from '../sim/constants';

export interface GeoBounds {
  west: number;
  east: number;
  north: number;
  south: number;
}

/**
 * 地形底图生成脚本 tools/map_common.py 的实际地理范围。
 * 使用 Web Mercator，而不是把经纬度直接按矩形拉伸。
 */
export const TERRAIN_BOUNDS: GeoBounds = {
  west: 112.32,
  east: 112.82,
  north: 23.26,
  south: 23.0,
};

/**
 * 纯色图覆盖端州、鼎湖、高要大部与四会西南。
 * 宽高比接近 16:9，避免东西 / 南北比例失真。
 */
export const PLAIN_BOUNDS: GeoBounds = {
  west: 112.0,
  east: 113.07,
  north: 23.4,
  south: 22.84,
};

function mercatorY(lat: number): number {
  return Math.asinh(Math.tan((lat * Math.PI) / 180));
}

export function projectToBounds(
  lng: number,
  lat: number,
  bounds: GeoBounds,
  width = WORLD_W,
  height = WORLD_H,
): { x: number; y: number } {
  const x = ((lng - bounds.west) / (bounds.east - bounds.west)) * width;
  const y0 = mercatorY(bounds.north);
  const y1 = mercatorY(bounds.south);
  const y = ((y0 - mercatorY(lat)) / (y0 - y1)) * height;
  return {
    x: Math.max(0, Math.min(width, x)),
    y: Math.max(0, Math.min(height, y)),
  };
}

export function projectTerrain(lng: number, lat: number): { x: number; y: number } {
  return projectToBounds(lng, lat, TERRAIN_BOUNDS);
}

export function projectPlain(lng: number, lat: number): { x: number; y: number } {
  return projectToBounds(lng, lat, PLAIN_BOUNDS);
}

export function inTerrain(lng: number, lat: number): boolean {
  return (
    lng >= TERRAIN_BOUNDS.west &&
    lng <= TERRAIN_BOUNDS.east &&
    lat >= TERRAIN_BOUNDS.south &&
    lat <= TERRAIN_BOUNDS.north
  );
}
