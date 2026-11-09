/**
 * Build the runtime population field for the built-in terrain map from the
 * OSM analysis pack. This is the "full replacement" data path:
 *
 *   residential units  -> zones + building/community home cells
 *   employment areas   -> work zones + distributed work cells
 *   extended POIs      -> MapPoi + POI zones
 *
 * Output: map/game-data/terrain-field.json
 * The shape is exactly PopulationField, with world coordinates (2560x1440).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const analysis = path.resolve(root, 'analysis');

const WEST = 112.32;
const SOUTH = 23.0;
const EAST = 112.82;
const NORTH = 23.26;
const WORLD_W = 2560;
const WORLD_H = 1440;
const PX_PER_KM = 50;
const HOME_ZONE_BASE = 1;
const WORK_ZONE_BASE = 1001;
const POI_ZONE_BASE = 10000;

// 肇庆市第七次全国人口普查（2020-11-01）区县常住人口。
// Source: 肇庆市统计局公报（第二号）.
const CENSUS_2020 = {
  '端州区': 602402,
  '鼎湖区': 209116,
  '高要区': 741591,
  '四会市': 526457,
  '三水区': 803226,
  '高明区': 469038,
};

const merc = (lat) => Math.asinh(Math.tan((lat * Math.PI) / 180));
const Y0 = merc(NORTH);
const Y1 = merc(SOUTH);

function project(lon, lat) {
  const x = ((lon - WEST) / (EAST - WEST)) * WORLD_W;
  const y = ((Y0 - merc(lat)) / (Y0 - Y1)) * WORLD_H;
  return {
    x: Math.max(0, Math.min(WORLD_W, x)),
    y: Math.max(0, Math.min(WORLD_H, y)),
  };
}

function readGeo(name) {
  return JSON.parse(fs.readFileSync(path.resolve(analysis, name), 'utf8'));
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ringCentroid(ring) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const p of ring) {
    if (!Array.isArray(p) || p.length < 2) continue;
    sx += p[0];
    sy += p[1];
    n++;
  }
  return n > 0 ? [sx / n, sy / n] : null;
}

function geometryCenter(geom) {
  if (!geom) return null;
  if (geom.type === 'Polygon') return ringCentroid(geom.coordinates[0] ?? []);
  if (geom.type === 'MultiPolygon') {
    let best = null;
    let bestLen = 0;
    for (const poly of geom.coordinates) {
      const ring = poly[0] ?? [];
      if (ring.length > bestLen) {
        bestLen = ring.length;
        best = ringCentroid(ring);
      }
    }
    return best;
  }
  if (geom.type === 'Point') return geom.coordinates;
  return null;
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function projectRing(ring) {
  return ring.map(([lon, lat]) => {
    const p = project(lon, lat);
    return [p.x, p.y];
  });
}

function mainRing(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'Polygon') return geometry.coordinates[0] ?? null;
  if (geometry.type === 'MultiPolygon') {
    let best = null;
    for (const poly of geometry.coordinates) {
      const ring = poly[0];
      if (ring && (!best || ring.length > best.length)) best = ring;
    }
    return best;
  }
  return null;
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInArea(x, y, area) {
  return pointInRing(x, y, area.points);
}

function circlePolygon(cx, cy, radius, segments = 28) {
  const points = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    points.push([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius]);
  }
  return points;
}

const unitsAll = readGeo('residential-units-enriched-osm.geojson').features;
// “镇街余部”是派生范围，既不做住宅区，也不做住宅单元 zone。
const units = unitsAll.filter(
  (f) => f.properties.derived !== true && !String(f.properties.unit_type ?? '').includes('余部'),
);
const communities = readGeo('residential-communities.geojson').features;
const landuse = readGeo('residential-landuse.geojson').features;
const sites = readGeo('residential-sites.geojson').features;
const places = readGeo('places.geojson').features;
const adminDistricts = readGeo('admin-areas.geojson').features.filter(
  (f) => f.properties.admin_level === 6,
);
const poiFeatures = readGeo('game-pois-extended.geojson').features;
const employment = readGeo('employment-areas.geojson').features;
const buildings = readGeo('buildings-osm.geojson').features;
const rawPlaces = JSON.parse(fs.readFileSync(path.resolve(analysis, 'raw/places.json'), 'utf8')).elements ?? [];

const resZones = units.map((feature, index) => {
  const p = feature.properties;
  const c = project(num(p.center_lon), num(p.center_lat));
  const area = Math.max(0.01, num(p.residential_landuse_km2) + num(p.residential_floor_area_km2) * 0.5);
  return {
    id: HOME_ZONE_BASE + index,
    name: p.name || `住宅单元 ${index + 1}`,
    kind: 'residential',
    x: c.x,
    y: c.y,
    r: clamp(Math.sqrt(area / Math.PI) * PX_PER_KM, 28, 180),
    weight: Math.max(0.2, num(p.residential_floor_area_km2) * 24 + area * 2),
    dots: 0,
  };
});

// ——— Residential footprints —————————————————————————————
// Real landuse/community/site polygons are the primary outlines. Only gaps
// (villages without a mapped residential polygon) get a generated circle whose
// area is derived from the unit's mapped residential land / built-up area.
const residentialAreas = [];
let areaId = 0;

function nearestCommunityName(x, y) {
  let best = null;
  let bestD = Infinity;
  for (const feature of communities) {
    const p = feature.properties;
    const c = project(num(p.center_lon), num(p.center_lat));
    const d = (c.x - x) ** 2 + (c.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p.name;
    }
  }
  return bestD <= 120 * 120 ? best : null;
}

function addResidentialArea(feature, source, generated = false) {
  const p = feature.properties ?? {};
  const ring = mainRing(feature.geometry);
  if (!ring || ring.length < 3) return;
  const points = projectRing(ring);
  const areaKm2 = Math.max(0.002, num(p.area_km2, 0.01));
  const center = project(num(p.center_lon), num(p.center_lat));
  const nearestUnit = nearestZone(resZones, center.x, center.y);
  const fallbackName = nearestCommunityName(center.x, center.y);
  residentialAreas.push({
    id: ++areaId,
    name: p.name || p.unit_name || fallbackName || `${nearestUnit?.name ?? '住宅'}·住宅`,
    unitName: p.unit_name || p.parent_name || nearestUnit?.name,
    source,
    generated,
    points,
    areaKm2,
    effectiveAreaKm2: areaKm2,
    population: 0,
    density: 0,
    floorAreaM2: 0,
    populationSource: 'area-density',
    centerLon: num(p.center_lon),
    centerLat: num(p.center_lat),
    centerX: center.x,
    centerY: center.y,
  });
}

for (const feature of landuse) addResidentialArea(feature, 'landuse');
for (const feature of communities) {
  const p = feature.properties;
  const c = project(num(p.center_lon), num(p.center_lat));
  if (residentialAreas.some((a) => pointInArea(c.x, c.y, a))) continue;
  addResidentialArea(feature, 'community');
}
for (const feature of sites) {
  const p = feature.properties;
  const c = project(num(p.center_lon), num(p.center_lat));
  if (residentialAreas.some((a) => pointInArea(c.x, c.y, a))) continue;
  addResidentialArea(feature, 'site', false);
}
for (const feature of units) {
  const p = feature.properties;
  // “镇街余部”不是真实住宅范围，不能扩成住宅区；缺口只做 places 点标注。
  if (p.derived === true || String(p.unit_type ?? '').includes('余部')) continue;
  const c = project(num(p.center_lon), num(p.center_lat));
  if (residentialAreas.some((a) => pointInArea(c.x, c.y, a))) continue;
  // 没有住宅用地 / 住宅建筑时，不能用 total_building_footprint 兜底：
  // 那里面主要是工业厂房。禄村就是因此被算成一个 3.36 km² 的“住宅区”，
  // 再被区县控制放大到 6.8 万人。这里只用住宅足迹，否则按 place 点给一个小村范围。
  const resFootprint = num(p.residential_footprint_km2);
  const resFloor = num(p.residential_floor_area_km2);
  const placePoints = num(p.place_points);
  const km2 = Math.max(
    0.02,
    num(p.residential_landuse_km2) ||
      resFootprint * 2.5 ||
      resFloor * 0.5 ||
      Math.min(0.12, Math.max(0.02, placePoints * 0.03)),
  );
  const radiusPx = clamp(Math.sqrt(km2 / Math.PI) * PX_PER_KM, 8, 90);
  residentialAreas.push({
    id: ++areaId,
    name: p.name || `住宅单元 ${areaId}`,
    unitName: p.name,
    source: 'unit-generated',
    generated: true,
    points: circlePolygon(c.x, c.y, radiusPx),
    areaKm2: km2,
    effectiveAreaKm2: km2,
    population: 0,
    density: 0,
    floorAreaM2: 0,
    populationSource: 'area-density',
    centerLon: num(p.center_lon),
    centerLat: num(p.center_lat),
    centerX: c.x,
    centerY: c.y,
  });
}

const workZones = employment.map((feature, index) => {
  const p = feature.properties;
  const c = project(num(p.lon), num(p.lat));
  return {
    id: WORK_ZONE_BASE + index,
    name: p.name || `就业区 ${index + 1}`,
    kind: 'employment',
    x: c.x,
    y: c.y,
    r: Math.max(18, num(p.radius_km, 1.5) * PX_PER_KM),
    weight: Math.max(0.2, num(p.daily, 1000) / 1000),
    dots: 0,
  };
});

function nearestZone(zones, x, y) {
  let best = zones[0];
  let bestD = Infinity;
  for (const z of zones) {
    const d = (z.x - x) ** 2 + (z.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = z;
    }
  }
  return best;
}

const residential = [];
const dots = [];
const homeRng = rng(20260101);
const homeCellKeys = new Set();

function addHome(x, y, zone) {
  const key = `${x.toFixed(1)},${y.toFixed(1)}`;
  if (homeCellKeys.has(key)) return;
  homeCellKeys.add(key);
  zone.dots++;
  residential.push({ x, y, zone: zone.id });
  dots.push({ x, y, kind: 'residential', zone: zone.id });
}

for (const feature of buildings) {
  const type = feature.properties.building_type;
  if (type !== 'residential' && type !== 'unknown') continue;
  const c = geometryCenter(feature.geometry);
  if (!c) continue;
  const w = project(c[0], c[1]);
  const zone = nearestZone(resZones, w.x, w.y);
  addHome(w.x, w.y, zone);
}

// Named communities are stronger anchors than anonymous footprints; add their
// centers as cells too. This also covers estates whose buildings are tagged
// building=yes and therefore have no residential building type.
for (const feature of communities) {
  const p = feature.properties;
  const c = project(num(p.center_lon), num(p.center_lat));
  const zone = nearestZone(resZones, c.x, c.y);
  addHome(c.x, c.y, zone);
}

// Every unit should have at least one anchor, even if OSM has no building there.
for (const zone of resZones) {
  if (zone.dots > 0) continue;
  addHome(zone.x, zone.y, zone);
}

const employmentTarget = 3856;
const dailyTotal = workZones.reduce((sum, z) => sum + z.weight, 0);
const workAlloc = workZones.map((z) => Math.max(1, Math.round((z.weight / dailyTotal) * employmentTarget)));
let workCount = workAlloc.reduce((a, b) => a + b, 0);
for (let i = 0; workCount > employmentTarget; i = (i + 1) % workAlloc.length) {
  if (workAlloc[i] > 1) {
    workAlloc[i]--;
    workCount--;
  }
}
for (let i = 0; workCount < employmentTarget; i = (i + 1) % workAlloc.length) {
  workAlloc[i]++;
  workCount++;
}

const workRng = rng(20260102);
const employmentCells = [];
for (let i = 0; i < workZones.length; i++) {
  const zone = workZones[i];
  const n = workAlloc[i] ?? 0;
  for (let k = 0; k < n; k++) {
    const angle = workRng() * Math.PI * 2;
    const radius = Math.sqrt(workRng()) * zone.r * 0.82;
    const x = clamp(zone.x + Math.cos(angle) * radius, 2, WORLD_W - 2);
    const y = clamp(zone.y + Math.sin(angle) * radius, 2, WORLD_H - 2);
    zone.dots++;
    employmentCells.push({ x, y, zone: zone.id });
    dots.push({ x, y, kind: 'employment', zone: zone.id });
  }
}

// ——— Population by residential footprint —————————————————
// OSM population tags are the only authoritative source. Everything else is
// derived from explicit residential floor area at the same persons/m² rate;
// footprints with no building data fall back to a low area density.
const knownPopulation = new Map();
for (const el of rawPlaces) {
  const tags = el.tags ?? {};
  const pop = Number(tags.population);
  if (!Number.isFinite(pop) || pop <= 0 || !Number.isFinite(el.lat) || !Number.isFinite(el.lon)) {
    continue;
  }
  const p = project(el.lon, el.lat);
  let target = residentialAreas.find((a) => pointInArea(p.x, p.y, a));
  if (!target) {
    let bestD = Infinity;
    for (const area of residentialAreas) {
      const d = (area.centerX - p.x) ** 2 + (area.centerY - p.y) ** 2;
      if (d < bestD) {
        bestD = d;
        target = area;
      }
    }
  }
  if (target) knownPopulation.set(target.id, (knownPopulation.get(target.id) ?? 0) + pop);
}

for (const feature of buildings) {
  const type = feature.properties.building_type;
  if (type !== 'residential' && type !== 'unknown') continue;
  const c = geometryCenter(feature.geometry);
  if (!c) continue;
  const p = project(c[0], c[1]);
  const target = residentialAreas.find((a) => pointInArea(p.x, p.y, a));
  if (!target) continue;
  const weight = type === 'residential' ? 1 : 0.5;
  target.floorAreaM2 += num(feature.properties.floor_area_m2) * weight;
}

let knownPop = 0;
let knownFloor = 0;
for (const [id, pop] of knownPopulation) {
  const area = residentialAreas.find((a) => a.id === id);
  if (!area) continue;
  knownPop += pop;
  knownFloor += area.floorAreaM2;
}
const personsPerM2 = clamp(knownFloor > 0 ? knownPop / knownFloor : 0.02, 0.004, 0.06);

const unitByName = new Map(units.map((f) => [f.properties.name, f.properties]));
for (const area of residentialAreas) {
  const known = knownPopulation.get(area.id) ?? 0;
  if (known > 0) {
    area.population = known;
    area.populationSource = 'osm';
  } else if (area.floorAreaM2 > 0) {
    area.population = area.floorAreaM2 * personsPerM2;
    area.populationSource = 'floor-area';
  } else {
    area.population = area.areaKm2 * 1800;
    area.populationSource = 'area-density';
  }
  let effective = area.areaKm2;
  if (effective < 0.03 && area.unitName) {
    const unit = unitByName.get(area.unitName);
    if (unit) {
      effective = Math.max(effective, num(unit.area_km2));
    }
  }
  area.effectiveAreaKm2 = effective;
  area.density = area.population / Math.max(0.002, effective);
}

// ——— Residential place annotations ——————————————————————
// Do not draw residential polygons on the map. Real village/community centres
// are the annotation layer; villages with no polygon still appear here.
const populationByName = new Map();
for (const el of rawPlaces) {
  const name = el.tags?.name;
  const pop = Number(el.tags?.population);
  if (name && Number.isFinite(pop) && pop > 0) populationByName.set(name, pop);
}
const residentialPlaces = [];
const placeKeys = new Set();
function addResidentialPlace(name, p, place, unitName, level) {
  if (!name) return;
  const key = `${name}|${p.x.toFixed(0)}|${p.y.toFixed(0)}`;
  if (placeKeys.has(key)) return;
  placeKeys.add(key);
  residentialPlaces.push({
    name,
    x: p.x,
    y: p.y,
    place,
    unitName,
    level,
    population: populationByName.get(name),
  });
}
const placeLevels = { town: 4, suburb: 4, quarter: 3, village: 2, hamlet: 1 };
for (const feature of places) {
  const p = feature.properties;
  if (!p.in_bounds || !p.name) continue;
  const c = project(feature.geometry.coordinates[0], feature.geometry.coordinates[1]);
  addResidentialPlace(p.name, c, p.place || 'village', p.unit_name || undefined, placeLevels[p.place] ?? 2);
}
for (const feature of communities) {
  const p = feature.properties;
  if (!p.name) continue;
  const c = project(num(p.center_lon), num(p.center_lat));
  if (residentialPlaces.some((x) => Math.hypot(x.x - c.x, x.y - c.y) < 6)) continue;
  addResidentialPlace(p.name, c, 'community', p.unit_name || undefined, 3);
}

// ——— Census district control totals —————————————————————
// Census gives the whole-district population. The bbox clips some districts
// (高要/四会/三水/高明), so use the clipped-area share as an auxiliary target.
const districtPolys = adminDistricts
  .map((feature) => {
    const p = feature.properties;
    const census = CENSUS_2020[p.name];
    const ring = mainRing(feature.geometry);
    if (!census || !ring) return null;
    const ratio = clamp((p.area_km2 ?? 0) / Math.max(1, p.area_full_km2 ?? p.area_km2 ?? 1), 0, 1);
    return {
      name: p.name,
      points: projectRing(ring),
      census,
      clippedRatio: ratio,
      target: Math.round(census * ratio),
      center: project(num(p.center_lon), num(p.center_lat)),
      modelPopulation: 0,
      knownPopulation: 0,
    };
  })
  .filter(Boolean);

for (const area of residentialAreas) {
  let best = districtPolys[0];
  let bestD = Infinity;
  for (const district of districtPolys) {
    if (pointInRing(area.centerX, area.centerY, district.points)) {
      best = district;
      bestD = 0;
      break;
    }
    const d = (district.center.x - area.centerX) ** 2 + (district.center.y - area.centerY) ** 2;
    if (d < bestD) {
      bestD = d;
      best = district;
    }
  }
  if (!best) continue;
  area.district = best.name;
  best.modelPopulation += area.population;
  if (area.populationSource === 'osm') best.knownPopulation += area.population;
}

for (const district of districtPolys) {
  const areas = residentialAreas.filter((a) => a.district === district.name);
  const nonOsm = areas.filter((a) => a.populationSource !== 'osm');
  const known = district.knownPopulation;
  const remaining = Math.max(0, district.target - known);
  const weightSum = nonOsm.reduce(
    (sum, a) => sum + (a.population > 0 ? a.population : a.areaKm2 * 1800),
    0,
  );
  if (remaining > 0 && weightSum > 0) {
    const factor = remaining / weightSum;
    for (const area of nonOsm) {
      const weight = area.population > 0 ? area.population : area.areaKm2 * 1800;
      area.population = weight * factor;
    }
  }
  district.modelPopulation = areas.reduce((sum, a) => sum + a.population, 0);
  for (const area of areas) {
    // Tiny estate footprints otherwise produce 200k–600k/km² artifacts.
    area.effectiveAreaKm2 = Math.max(area.effectiveAreaKm2 ?? area.areaKm2, 0.02);
    area.density = Math.min(
      80000,
      area.population / Math.max(0.002, area.effectiveAreaKm2),
    );
  }
}

const districtControls = districtPolys.map((d) => ({
  name: d.name,
  census2020: d.census,
  clippedRatio: Number(d.clippedRatio.toFixed(5)),
  targetPopulation: d.target,
  modelPopulation: Math.round(d.modelPopulation),
  knownOsmPopulation: Math.round(d.knownPopulation),
}));

// Assign every home cell to a real/generated residential area and split that
// area's population across its cells. M1 will use cell.population instead of a
// fixed 100 residents per dot.
const cellsByArea = new Map();
for (const cell of residential) {
  let target = residentialAreas.find((a) => pointInArea(cell.x, cell.y, a));
  if (!target) {
    let bestD = Infinity;
    for (const area of residentialAreas) {
      const d = (area.centerX - cell.x) ** 2 + (area.centerY - cell.y) ** 2;
      if (d < bestD) {
        bestD = d;
        target = area;
      }
    }
  }
  if (!target) continue;
  const list = cellsByArea.get(target.id);
  if (list) list.push(cell);
  else cellsByArea.set(target.id, [cell]);
}
for (const area of residentialAreas) {
  let cells = cellsByArea.get(area.id) ?? [];
  if (cells.length === 0) {
    const zone = nearestZone(resZones, area.centerX, area.centerY);
    addHome(area.centerX, area.centerY, zone);
    cells = residential.filter((cell) => cell.x === area.centerX && cell.y === area.centerY);
  }
  const perCell = Math.max(1, area.population / Math.max(1, cells.length));
  for (const cell of cells) cell.population = perCell;
}

const profiles = {
  hospital: ['hard', 480, 1020],
  scenic: ['soft', 480, 1080],
  station: ['continuous', 330, 1380],
  ferry: ['pulse', 360, 1320],
  school: ['bimodal', 420, 1020],
  mall: ['soft', 600, 1320],
  park: ['continuous', 360, 1320],
  stadium: ['pulse', 1080, 1320],
  industry: ['hard', 420, 1140],
};
const typeSet = new Set(['hospital', 'scenic', 'station', 'ferry', 'school', 'mall', 'park', 'stadium', 'industry']);

const pois = [];
const poiZones = [];
let poiId = 0;
for (const feature of poiFeatures) {
  const p = feature.properties;
  if (!typeSet.has(p.poi_type)) continue;
  poiId++;
  const c = project(num(p.lon), num(p.lat));
  const level = clamp(Math.round(num(p.level, 3)), 1, 6);
  const daily = Math.max(1, num(p.daily, 1000));
  const [profile, openMin, closeMin] = profiles[p.poi_type] ?? profiles.industry;
  const poi = {
    id: poiId,
    type: p.poi_type,
    x: c.x,
    y: c.y,
    radiusKm: Math.max(0.4, num(p.radius_km, 1.2)),
    level,
    scale: 1,
    dailyMin: Math.round(daily * 0.85),
    dailyMax: Math.round(daily * 1.15),
    profile,
    openMin,
    closeMin,
    name: p.name || `POI ${poiId}`,
  };
  pois.push(poi);
  if (p.poi_type === 'industry') continue;
  poiZones.push({
    id: POI_ZONE_BASE + poiId,
    name: poi.name,
    kind: 'mixed',
    x: poi.x,
    y: poi.y,
    r: Math.max(12, poi.radiusKm * PX_PER_KM),
    weight: Math.max(0.1, level),
    dots: 0,
  });
}

const field = {
  version: 3,
  source: 'map/analysis OSM pack, © OpenStreetMap contributors (ODbL)',
  pxPerKm: PX_PER_KM,
  zones: [...resZones, ...workZones, ...poiZones],
  dots,
  residential,
  employment: employmentCells,
  mixed: [],
  poiZones,
  pois,
  residentialAreas: residentialAreas.map(({ points, ...meta }) => meta),
  residentialPlaces,
  districtControls,
};

const outDir = path.resolve(root, 'game-data');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.resolve(outDir, 'terrain-field.json');
fs.writeFileSync(outFile, JSON.stringify(field));
console.log(
  JSON.stringify(
    {
      homes: residential.length,
      jobs: employmentCells.length,
      pois: pois.length,
      zones: field.zones.length,
      poiZones: poiZones.length,
      dots: dots.length,
      residentialAreas: residentialAreas.length,
      population: Math.round(residentialAreas.reduce((sum, a) => sum + a.population, 0)),
      districtTarget: districtPolys.reduce((sum, d) => sum + d.target, 0),
      osmPopulationAreas: residentialAreas.filter((a) => a.populationSource === 'osm').length,
      generatedAreas: residentialAreas.filter((a) => a.generated).length,
      residentialPlaces: residentialPlaces.length,
      personsPerM2: Number(personsPerM2.toFixed(5)),
      bytes: fs.statSync(outFile).size,
    },
    null,
    2,
  ),
);
