import { makePoi, poiDailyRange } from '../../sim/mapData';
import type { MapPoi } from '../../sim/types';
import { GEO_POIS } from '../geoData';
import { projectToWorld } from './projection';

/** 纯色图 POI：真实 OSM 坐标 + Web Mercator 投影。 */
export const PLAIN_POIS: MapPoi[] = GEO_POIS.map((p, index) => {
  const pos = projectToWorld(p.lng, p.lat);
  const poi = makePoi(p.type, pos.x, pos.y, index + 1);
  poi.name = p.name;
  poi.radiusKm = p.radiusKm;
  poi.level = p.level;
  poi.scale = p.scale;
  poi.profile = p.profile;
  poi.openMin = p.openMin;
  poi.closeMin = p.closeMin;
  const range = poiDailyRange(p.level, p.scale);
  poi.dailyMin = range.dailyMin;
  poi.dailyMax = range.dailyMax;
  return poi;
});
