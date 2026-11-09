// Export OSM landuse=industrial polygons from the offline z14 pack.
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import fs from 'node:fs';

const INDEX = JSON.parse(fs.readFileSync('offline/public/tile-index.json', 'utf8'));
const BIN = fs.readFileSync('offline/public/tiles.bin');
const out = [];
const seen = new Set();

for (const [key, [offset, length]] of Object.entries(INDEX)) {
  const [z, x, y] = key.split('/').map(Number);
  if (z !== 14) continue;
  const tile = new VectorTile(new Pbf(BIN.subarray(offset, offset + length)));
  const layer = tile.layers.landuse;
  if (!layer) continue;
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    if ((f.properties?.class ?? '') !== 'industrial') continue;
    const g = f.toGeoJSON(x, y, z);
    const polys = g.geometry.type === 'Polygon' ? [g.geometry.coordinates] : g.geometry.coordinates;
    for (const poly of polys) {
      const k = poly[0]?.[0]?.map((n) => n.toFixed(5)).join(',') ?? '';
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push({
        type: 'Feature',
        properties: { class: 'industrial' },
        geometry: { type: 'Polygon', coordinates: poly },
      });
    }
  }
}
fs.writeFileSync('analysis/raw/industrial-landuse.json', JSON.stringify({ type: 'FeatureCollection', features: out }));
console.log('industrial polygons', out.length);
