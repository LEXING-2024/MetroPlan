/**
 * Build a compact walking graph from the already-packaged z14 OpenFreeMap
 * vector tiles. The game uses this only for M3 station-access checks; it is not
 * a full routing engine.
 *
 * Output: map/data/walk-graph.json
 *   nodes: [[worldX, worldY], ...]
 *   edges: [[a, b, lengthM, speedKmh], ...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const index = JSON.parse(
  fs.readFileSync(path.resolve(root, 'offline/public/tile-index.json'), 'utf8'),
);
const bin = fs.readFileSync(path.resolve(root, 'offline/public/tiles.bin'));

const WEST = 112.32;
const SOUTH = 23.0;
const EAST = 112.82;
const NORTH = 23.26;
const WORLD_W = 2560;
const WORLD_H = 1440;
const PX_PER_KM = 50;

const merc = (lat) => Math.asinh(Math.tan((lat * Math.PI) / 180));
const Y0 = merc(NORTH);
const Y1 = merc(SOUTH);

function project(lon, lat) {
  return [
    ((lon - WEST) / (EAST - WEST)) * WORLD_W,
    ((Y0 - merc(lat)) / (Y0 - Y1)) * WORLD_H,
  ];
}

const WALK_CLASSES = new Set([
  'footway',
  'path',
  'pedestrian',
  'steps',
  'living_street',
  'residential',
  'service',
  'unclassified',
  'tertiary',
  'secondary',
  'primary',
  'track',
  'ferry',
]);

const VEHICLE_SPEED = {
  primary: 45,
  secondary: 35,
  tertiary: 30,
  residential: 20,
  unclassified: 25,
  living_street: 10,
  service: 15,
  ferry: 6,
};

function vehicleSpeedOf(cls, subclass) {
  if (subclass === 'sidewalk') return 0;
  if (cls === 'footway' || cls === 'path' || cls === 'pedestrian' || cls === 'steps' || cls === 'track') return 0;
  return VEHICLE_SPEED[cls] ?? 0;
}

function speedOf(cls, subclass) {
  if (cls === 'steps') return 3.2;
  if (cls === 'ferry') return 6.0;
  if (cls === 'path' || cls === 'footway' || cls === 'pedestrian') return 4.2;
  if (cls === 'track') return 3.8;
  if (cls === 'primary' || cls === 'secondary' || cls === 'tertiary') return 4.4;
  if (subclass === 'sidewalk') return 4.5;
  return 4.6;
}

const nodes = [];
const nodeByKey = new Map();
const edges = new Map();

function nodeId([x, y]) {
  // Snap nearby endpoints from adjacent tile buffers. SNAP=2 means 40m.
  const snap = Number(process.env.SNAP ?? 2);
  const qx = Math.round(x / snap) * snap;
  const qy = Math.round(y / snap) * snap;
  const key = `${qx.toFixed(1)},${qy.toFixed(1)}`;
  let id = nodeByKey.get(key);
  if (id === undefined) {
    id = nodes.length;
    nodes.push([qx, qy]);
    nodeByKey.set(key, id);
  }
  return id;
}

function addLine(coords, cls, subclass) {
  if (coords.length < 2) return;
  const speed = speedOf(cls, subclass);
  const vehicleSpeed = vehicleSpeedOf(cls, subclass);
  const ids = coords.map(([lon, lat]) => nodeId(project(lon, lat)));
  for (let i = 0; i < ids.length - 1; i++) {
    const a = ids[i];
    const b = ids[i + 1];
    if (a === b) continue;
    const [ax, ay] = nodes[a];
    const [bx, by] = nodes[b];
    const px = Math.hypot(bx - ax, by - ay);
    if (px < 0.3) continue;
    const meters = (px / PX_PER_KM) * 1000;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const prev = edges.get(key);
    if (!prev || prev[2] > meters) {
      edges.set(key, [Math.min(a, b), Math.max(a, b), meters, speed, vehicleSpeed]);
    } else if (vehicleSpeed > (prev[4] ?? 0)) {
      prev[4] = vehicleSpeed;
    }
  }
}

let tileCount = 0;
let featureCount = 0;
for (const [key, [offset, length]] of Object.entries(index)) {
  const [z, x, y] = key.split('/').map(Number);
  if (z !== 14) continue;
  tileCount++;
  const tile = new VectorTile(new Pbf(bin.subarray(offset, offset + length)));
  const layer = tile.layers.transportation;
  if (!layer) continue;
  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i);
    const cls = feature.properties.class;
    if (!WALK_CLASSES.has(cls)) continue;
    const geom = feature.toGeoJSON(x, y, z).geometry;
    const lines = geom.type === 'LineString' ? [geom.coordinates] : geom.coordinates;
    for (const line of lines) {
      if (line.length < 2) continue;
      featureCount++;
      addLine(line, cls, feature.properties.subclass);
    }
  }
}

// z14 tiles are clipped at tile boundaries; attach isolated fragments to the
// largest walking component with short connectors. This is a pragmatic
// approximation for station access, not a replacement for raw OSM routing.
function connectFragments() {
  const n = nodes.length;
  const adj = Array.from({ length: n }, () => []);
  for (const [a, b] of edges.values()) {
    adj[a].push(b);
    adj[b].push(a);
  }
  const comp = new Int32Array(n).fill(-1);
  const sizes = [];
  for (let i = 0; i < n; i++) {
    if (comp[i] >= 0) continue;
    const cid = sizes.length;
    const q = [i];
    comp[i] = cid;
    for (let k = 0; k < q.length; k++) {
      for (const v of adj[q[k]]) if (comp[v] < 0) { comp[v] = cid; q.push(v); }
    }
    sizes.push(q.length);
  }
  let main = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[main]) main = i;
  const cell = 10;
  const buckets = new Map();
  for (let i = 0; i < n; i++) {
    if (comp[i] !== main) continue;
    const [x, y] = nodes[i];
    const key = Math.floor(x / cell) + ',' + Math.floor(y / cell);
    const list = buckets.get(key);
    if (list) list.push(i); else buckets.set(key, [i]);
  }
  let added = 0;
  for (let i = 0; i < n; i++) {
    if (comp[i] === main) continue;
    const [x, y] = nodes[i];
    let best = -1;
    let bestD = Infinity;
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    for (let gx = -1; gx <= 1; gx++) {
      for (let gy = -1; gy <= 1; gy++) {
        const list = buckets.get((cx + gx) + ',' + (cy + gy));
        if (!list) continue;
        for (const j of list) {
          const d = Math.hypot(nodes[j][0] - x, nodes[j][1] - y);
          if (d < bestD) { bestD = d; best = j; }
        }
      }
    }
    if (best >= 0 && bestD <= cell) {
      const key = i < best ? i + ':' + best : best + ':' + i;
      if (!edges.has(key)) {
        edges.set(key, [Math.min(i, best), Math.max(i, best), (bestD / PX_PER_KM) * 1000, 4.5]);
        added++;
      }
    }
  }
  return { components: sizes.length, main: sizes[main], connectors: added };
}

const fragments = connectFragments();
const outEdges = [...edges.values()];
const out = {
  version: 1,
  source: 'OpenFreeMap z14 / OpenMapTiles transportation',
  bounds: [WEST, SOUTH, EAST, NORTH],
  pxPerKm: PX_PER_KM,
  nodes,
  edges: outEdges,
  stats: { tileCount, features: featureCount, nodes: nodes.length, edges: outEdges.length, ...fragments },
};
const outFile = path.resolve(root, 'data/walk-graph.json');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(out));
console.log(JSON.stringify({ ...out.stats, bytes: fs.statSync(outFile).size }, null, 2));
