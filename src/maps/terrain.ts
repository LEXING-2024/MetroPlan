import { BUILTIN_PX_PER_KM, MAP_ID } from '../sim/constants';
import type { PopulationField } from '../sim/types';
import type { MapDefinition } from './types';
import { analysisField } from './analysisField';

/** 地形图人口场：map/analysis 的住宅单元、POI、就业区完整数据包。 */
export function terrainField(): PopulationField {
  return analysisField();
}

/** 地形图：端州 · 鼎湖 · 高要 · 四会，使用现有底图与气泡。 */
export const TERRAIN_MAP: MapDefinition = {
  id: MAP_ID,
  name: '鼎湖 · 端州',
  subtitle: '地形底图',
  description: '西江、北岭、鼎湖山与四会南部。住宅单元、POI 与就业区来自 OSM 分析数据包。',
  style: 'terrain',
  pxPerKm: BUILTIN_PX_PER_KM,
  createField: terrainField,
};
