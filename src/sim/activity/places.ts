import { POI_META, poiDailyMid, poiLevelWeight, poiZoneId } from '../mapData';
import { JOBS_PER_EMPLOYMENT_DOT, PEOPLE_PER_HOME_DOT } from '../population';
import type { MapPoi, PopulationField } from '../types';
import type { ActivityPlace, ActivityPlaceKind } from './types';

const HOME_BASE = 1;
const WORK_BASE = 100_000;
const POI_BASE = 200_000;
const MIXED_BASE = 300_000;

export interface PlaceLibrary {
  places: ActivityPlace[];
  homes: ActivityPlace[];
  works: ActivityPlace[];
  schools: ActivityPlace[];
  shopping: ActivityPlace[];
  leisure: ActivityPlace[];
  medical: ActivityPlace[];
  mixed: ActivityPlace[];
  byId: Map<number, ActivityPlace>;
}

function poiKind(poi: MapPoi): ActivityPlaceKind | null {
  switch (poi.type) {
    case 'school':
      return 'school';
    case 'hospital':
      return 'medical';
    case 'mall':
      return 'shopping';
    case 'park':
    case 'scenic':
    case 'stadium':
      return 'leisure';
    default:
      return null;
  }
}

function makePoiPlace(poi: MapPoi): ActivityPlace | null {
  const kind = poiKind(poi);
  if (!kind) return null;
  const meta = POI_META[poi.type];
  const daily = poiDailyMid(poi);
  return {
    id: POI_BASE + poi.id,
    kind,
    name: poi.name || meta.label,
    x: poi.x,
    y: poi.y,
    zoneId: poiZoneId(poi),
    capacity: Math.max(80, Math.round(daily * (kind === 'school' ? 0.6 : 0.35))),
    attraction: Math.max(1, daily * poiLevelWeight(poi)),
    openMin: poi.openMin,
    closeMin: poi.closeMin,
    poiId: poi.id,
  };
}

export function buildPlaceLibrary(field: PopulationField): PlaceLibrary {
  const zones = new Map(field.zones.map((zone) => [zone.id, zone]));
  const homes: ActivityPlace[] = field.residential.map((cell, index) => {
    const zone = zones.get(cell.zone);
    return {
      id: HOME_BASE + index,
      kind: 'home',
      name: `${zone?.name ?? '住宅'}·住宅`,
      x: cell.x,
      y: cell.y,
      zoneId: cell.zone,
      capacity: Math.max(1, cell.population ?? PEOPLE_PER_HOME_DOT),
      attraction: 1,
      openMin: 0,
      closeMin: 1440,
    };
  });
  const works: ActivityPlace[] = field.employment.map((cell, index) => {
    const zone = zones.get(cell.zone);
    return {
      id: WORK_BASE + index,
      kind: 'work',
      name: `${zone?.name ?? '就业'}·岗位`,
      x: cell.x,
      y: cell.y,
      zoneId: cell.zone,
      capacity: JOBS_PER_EMPLOYMENT_DOT,
      attraction: JOBS_PER_EMPLOYMENT_DOT,
      openMin: 0,
      closeMin: 1440,
    };
  });
  const pois = field.pois
    .map((poi) => makePoiPlace(poi))
    .filter((place): place is ActivityPlace => place !== null);

  const poiZoneIds = new Set(field.poiZones.map((zone) => zone.id));
  const mixed = field.zones
    .filter((zone) => zone.kind === 'mixed' && !poiZoneIds.has(zone.id))
    .map((zone, index): ActivityPlace => ({
      id: MIXED_BASE + index,
      kind: 'mixed',
      name: `${zone.name}·街区`,
      x: zone.x,
      y: zone.y,
      zoneId: zone.id,
      capacity: Math.max(30, Math.round(zone.weight * 400)),
      attraction: Math.max(10, zone.weight * 1200),
      openMin: 0,
      closeMin: 1440,
    }));

  const places = [...homes, ...works, ...pois, ...mixed];
  return {
    places,
    homes,
    works,
    schools: pois.filter((place) => place.kind === 'school'),
    shopping: pois.filter((place) => place.kind === 'shopping'),
    leisure: pois.filter((place) => place.kind === 'leisure'),
    medical: pois.filter((place) => place.kind === 'medical'),
    mixed,
    byId: new Map(places.map((place) => [place.id, place])),
  };
}
