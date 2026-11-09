// Export every building polygon from the offline z14 pack as GeoJSON.
// Tile buffers duplicate some edge buildings; the Python stats step dedupes
// by rounded centroid + area.
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import fs from 'node:fs';

const INDEX = JSON.parse(fs.readFileSync('offline/public/tile-index.json', 'utf8'));
const BIN = fs.readFileSync('offline/public/tiles.bin');
const OUT = 'analysis/raw/buildings.json';
const features = [];

for (const [key, [offset, length]] of Object.entries(INDEX)) {
  const [z, x, y] = key.split('/').map(Number);
  if (z !== 14) continue;
  const tile = new VectorTile(new Pbf(BIN.subarray(offset, offset + length)));
  const layer = tile.layers.building;
  if (!layer) continue;
  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i).toGeoJSON(x, y, z);
    const props = layer.feature(i).properties ?? {};
    const polys =
      feature.geometry.type === 'Polygon'
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;
    for (const poly of polys) {
      if (!poly?.[0] || poly[0].length < 4) continue;
      features.push({
        type: 'Feature',
        properties: {
          height_m: Number(props.render_height) || 5,
          colour: props.colour ?? '',
          source_tile: key,
        },
        geometry: { type: 'Polygon', coordinates: poly },
      });
    }
  }
}

fs.writeFileSync(OUT, JSON.stringify({ type: 'FeatureCollection', features }, null, 0));
console.log(`wrote ${features.length} building polygons to ${OUT}`);
