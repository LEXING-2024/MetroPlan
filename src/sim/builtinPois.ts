import { GEO_POIS } from '../maps/geoData';
import { inTerrain, projectTerrain } from '../maps/geo';
import { makePoi, poiDailyRange } from './mapData';
import type { MapPoi } from './types';

/**
 * 内置地形图 POI：真实 OSM 经纬度，按底图 Web Mercator 范围投影。
 * 底图范围（112.32–112.82E，23.00–23.26N）以外的四会城区等不强行塞进来。
 */
export const BUILTIN_POIS: MapPoi[] = GEO_POIS.filter((p) => inTerrain(p.lng, p.lat)).map(
  (p, index) => {
    const pos = projectTerrain(p.lng, p.lat);
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
  },
);
