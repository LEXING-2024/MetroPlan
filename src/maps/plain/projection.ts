import { PLAIN_BOUNDS, projectPlain } from '../geo';

/** 纯色图使用与地形图一致的 Web Mercator 投影，只换地理范围。 */
export { PLAIN_BOUNDS };

export function projectToWorld(lng: number, lat: number): { x: number; y: number } {
  return projectPlain(lng, lat);
}
