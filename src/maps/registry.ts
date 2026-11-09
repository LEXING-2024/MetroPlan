import { MAP_ID } from '../sim/constants';
import { estimatePopulation } from '../sim/population';
import { PLAIN_MAP } from './plain';
import { TERRAIN_MAP } from './terrain';
import type { MapDefinition, MapSummary } from './types';

export const BUILTIN_MAPS: MapDefinition[] = [TERRAIN_MAP, PLAIN_MAP];
export const DEFAULT_MAP_ID = MAP_ID;

export function getBuiltinMap(id: string | null | undefined): MapDefinition | undefined {
  if (!id) return undefined;
  return BUILTIN_MAPS.find((m) => m.id === id);
}

const summaryCache = new Map<string, MapSummary>();

/** 地图摘要只构建一次人口场；首页 / 选图弹窗反复打开不会重复采样。 */
export function mapSummaries(): MapSummary[] {
  return BUILTIN_MAPS.map((def) => {
    const cached = summaryCache.get(def.id);
    if (cached) return cached;
    const pop = estimatePopulation(def.createField());
    const summary: MapSummary = {
      id: def.id,
      name: def.name,
      subtitle: def.subtitle,
      description: def.description,
      style: def.style,
      residents: pop.residents,
      commuters: pop.commuters,
      agents: pop.agents,
    };
    summaryCache.set(def.id, summary);
    return summary;
  });
}
