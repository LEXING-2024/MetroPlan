import { POI_META, poiLevelWeight, poiZoneId } from '../sim/mapData';
import { MAP_SEED, buildPopulationDotsFor } from '../sim/zones';
import type {
  MapPoi,
  PopulationCell,
  PopulationField,
  Zone,
} from '../sim/types';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 由“组团 + POI”构建人口场。
 * 每个内置地图都调用这个函数并传入自己的数据模块，互不共享数组对象。
 */
export function buildField(
  zoneSource: Zone[],
  poiSource: MapPoi[],
  pxPerKm: number,
  seed = MAP_SEED,
): PopulationField {
  const zones: Zone[] = zoneSource.map((z) => ({ ...z }));
  const pois: MapPoi[] = poiSource.map((p) => ({ ...p }));
  const dots = buildPopulationDotsFor(zones, seed);
  const residential: PopulationCell[] = [];
  const employment: PopulationCell[] = [];
  for (const d of dots) {
    const cell: PopulationCell = { x: d.x, y: d.y, zone: d.zone };
    if (d.kind === 'residential') residential.push(cell);
    else employment.push(cell);
  }

  const mixed: PopulationCell[] = [];
  const mixedZones = zones.filter((z) => z.kind === 'mixed');
  const rng = mulberry32(seed ^ 0x51ed27);
  for (const z of mixedZones) {
    for (let i = 0; i < 48; i++) {
      const angle = rng() * Math.PI * 2;
      const rad = Math.sqrt(rng()) * z.r;
      mixed.push({ x: z.x + Math.cos(angle) * rad, y: z.y + Math.sin(angle) * rad, zone: z.id });
    }
  }

  const poiZones: Zone[] = [];
  for (const poi of pois) {
    if (POI_META[poi.type]?.group === null) continue;
    poiZones.push({
      id: poiZoneId(poi),
      name: poi.name,
      kind: 'mixed',
      x: poi.x,
      y: poi.y,
      r: Math.max(12, poi.radiusKm * pxPerKm),
      weight: Math.max(0.1, poiLevelWeight(poi)),
      dots: 0,
    });
  }

  return {
    zones: [...zones, ...poiZones],
    dots,
    residential,
    employment,
    mixed,
    poiZones,
    pois,
    pxPerKm,
  };
}
