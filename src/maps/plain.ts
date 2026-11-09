import { PLAIN_PX_PER_KM } from '../sim/constants';
import { MAP_SEED } from '../sim/zones';
import type { MapDefinition } from './types';
import { buildField } from './field';
import { PLAIN_POIS } from './plain/pois';
import { PLAIN_ZONES } from './plain/zones';

/**
 * 纯色图使用自己的组团 / POI 数据模块（src/maps/plain/）。
 * 修改这里不会影响地形图，反之亦然。
 */
export const PLAIN_MAP: MapDefinition = {
  id: 'plain-duanzhou-dinghu',
  name: '纯色地图',
  subtitle: '米黄底 · 完整组团',
  description: '米黄底图，只保留住宅 / 就业气泡、线路、站点与 POI，便于规划和检查覆盖。',
  style: 'plain',
  pxPerKm: PLAIN_PX_PER_KM,
  createField: () => buildField(PLAIN_ZONES, PLAIN_POIS, PLAIN_PX_PER_KM, MAP_SEED ^ 0x51ed27),
};
