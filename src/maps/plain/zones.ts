import { GEO_ZONES } from '../geoData';
import { PLAIN_PX_PER_KM } from '../../sim/constants';
import type { Zone } from '../../sim/types';
import { projectToWorld } from './projection';

/**
 * 纯色图组团：所有坐标来自真实 OSM 村 / 社区 / 镇街中心，
 * 用 Web Mercator 投影到世界坐标；不再手写像素位置。
 */
export const PLAIN_ZONES: Zone[] = GEO_ZONES.map((z, index) => {
  const p = projectToWorld(z.lng, z.lat);
  return {
    id: index + 1,
    name: z.name,
    kind: z.kind,
    x: p.x,
    y: p.y,
    r: z.rKm * PLAIN_PX_PER_KM,
    weight: z.weight,
    dots: z.kind === 'mixed' ? 0 : Math.round(z.weight * 240),
  };
});
