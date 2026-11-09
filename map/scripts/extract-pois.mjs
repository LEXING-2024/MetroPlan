// Extract POIs from the offline z14 pack (deduped by name + rounded coords).
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import fs from 'node:fs';

const INDEX = JSON.parse(fs.readFileSync('offline/public/tile-index.json', 'utf8'));
const BIN = fs.readFileSync('offline/public/tiles.bin');
const seen = new Set();
const out = [];

const keep = new Set([
  'hospital', 'clinic', 'doctors', 'dentist',
  'school', 'college', 'university', 'kindergarten',
  'mall', 'supermarket', 'department_store', 'marketplace', 'convenience',
  'park', 'garden', 'nature_reserve',
  'railway', 'ferry_terminal', 'bus',
  'attraction', 'viewpoint', 'museum', 'gallery',
  'stadium', 'sports_centre',
  'place_of_worship',
]);

for (const [key, [offset, length]] of Object.entries(INDEX)) {
  const [z, x, y] = key.split('/').map(Number);
  if (z !== 14) continue;
  const tile = new VectorTile(new Pbf(BIN.subarray(offset, offset + length)));
  const layer = tile.layers.poi;
  if (!layer) continue;
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    const p = f.properties ?? {};
    if (!p.name) continue;
    if (!keep.has(p.class) && !keep.has(p.subclass)) continue;
    const g = f.toGeoJSON(x, y, z);
    const [lon, lat] = g.geometry.coordinates;
    const k = `${p.name}|${lon.toFixed(5)}|${lat.toFixed(5)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      type: 'Feature',
      properties: {
        name: p.name,
        class: p.class ?? '',
        subclass: p.subclass ?? '',
        rank: p.rank ?? null,
      },
      geometry: { type: 'Point', coordinates: [lon, lat] },
    });
  }
}

fs.writeFileSync('analysis/raw/pois.json', JSON.stringify({ type: 'FeatureCollection', features: out }));
console.log('POIs', out.length);
