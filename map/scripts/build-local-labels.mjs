// Build the small curated label layer that gives the basemap the same
// geographic landmarks as the game (West River, the two islands, the main
// mountain masses and the two districts). All positions come from OSM data
// shipped with the game or from OSM vector-tile centroids inspected in
// research/inspect-tiles.mjs. Nothing in ../assets or ../src is modified.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..'); // map/
const source = resolve(root, '..', 'assets', 'maps', 'source');

const places = JSON.parse(readFileSync(resolve(source, 'osm_places.json'), 'utf8')).elements;
const islands = JSON.parse(readFileSync(resolve(source, 'osm_islands.json'), 'utf8')).elements;
const peaks = JSON.parse(readFileSync(resolve(source, 'osm_peaks.json'), 'utf8')).elements;

function place(name, fallback) {
  const el = places.find((e) => e.tags?.name === name);
  if (!el) {
    if (fallback) return fallback;
    throw new Error(`place not found: ${name}`);
  }
  return { lon: el.lon, lat: el.lat };
}
function peak(name) {
  const el = peaks.find((e) => e.tags?.name === name);
  if (!el) throw new Error(`peak not found: ${name}`);
  return { lon: el.lon, lat: el.lat };
}
function island(name) {
  const el = islands.find((e) => e.tags?.name === name);
  if (!el?.center) throw new Error(`island center not found: ${name}`);
  return { lon: el.center.lon, lat: el.center.lat };
}

const labels = [];
function add(name, kind, lon, lat, rank, extra = {}) {
  labels.push({
    type: 'Feature',
    properties: { name, kind, rank, ...extra },
    geometry: { type: 'Point', coordinates: [lon, lat] },
  });
}

const duanzhou = place('端州区');
const dinghu = place('鼎湖区');
const gaoyao = place('高要区');
// 四会市 is represented by its 街道 nodes rather than a `place=city` node in
// the game's Overpass extract; this is the OSM label point from the z11 tile.
const sihui = place('四会市', { lon: 112.72848, lat: 23.32913 });
const yanzhou = island('砚洲岛');
const qinsha = island('琴沙岛');
const beiling = peak('北岭山');
const lankeshan = peak('烂柯山');

// Larger administrative anchors. `rank` is only used for symbol sorting.
add('端州区', 'district', duanzhou.lon, duanzhou.lat, 1, { short: '端州' });
add('鼎湖区', 'district', dinghu.lon, dinghu.lat, 1, { short: '鼎湖' });
add('高要区', 'district', gaoyao.lon, gaoyao.lat, 3, { short: '高要' });
add('四会市', 'district', sihui.lon, sihui.lat, 3, { short: '四会' });

// The river label is set as a point (like the game's horizontal 西江 label),
// not rotated along the waterway.
add('西江', 'river', 112.6803, 23.1762, 0);
add('砚洲岛', 'island', yanzhou.lon, yanzhou.lat, 1);
// 黄布沙岛 is the local name for the elongated island; OSM's place layer
// carries only the nearby village names, so the game's coordinate is used.
add('黄布沙岛', 'island', 112.6538, 23.1625, 2);
add('琴沙岛', 'island', qinsha.lon, qinsha.lat, 4);

add('北岭山', 'mountain', beiling.lon, beiling.lat, 1, { ele: 690 });
add('鼎湖山', 'mountain', 112.5373, 23.1716, 1, { ele: 1000 });
add('烂柯山', 'mountain', lankeshan.lon, lankeshan.lat, 2, { ele: 880 });
add('羚羊峡', 'mountain', 112.5528, 23.1118, 3);
add('星湖', 'lake', 112.4655, 23.0748, 1);

const geojson = {
  type: 'FeatureCollection',
  name: 'metro-plan-curated-labels',
  attribution: 'Positions derived from OpenStreetMap data © OpenStreetMap contributors (ODbL)',
  features: labels,
};

mkdirSync(resolve(root, 'data'), { recursive: true });
writeFileSync(resolve(root, 'data', 'local-labels.geojson'), JSON.stringify(geojson, null, 2));
console.log(`wrote ${labels.length} labels to data/local-labels.geojson`);
