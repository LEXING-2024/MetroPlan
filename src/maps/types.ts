import type { PopulationField } from '../sim/types';

export type MapRenderStyle = 'terrain' | 'plain';

export interface MapDefinition {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  style: MapRenderStyle;
  pxPerKm: number;
  createField(): PopulationField;
}

export interface MapSummary {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  style: MapRenderStyle;
  /** 由住宅点阵推算的常住人口 */
  residents: number;
  /** 地图实际生成的抽样通勤者 */
  commuters: number;
  /** 通勤者 + POI 专项出行者 */
  agents: number;
}
