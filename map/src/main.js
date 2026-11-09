import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './ui.css';

import hillshadeUrl from '../assets/hillshade.png?url';
import localLabelsRaw from '../data/local-labels.geojson?raw';
import { buildPoiIcons } from './icons.js';
import { POI_LAYER_IDS, buildPoiLayers } from './poiLayers.js';
import { POI_KINDS, poiKind } from './poi.js';
import { LAYER_GROUPS, buildStyle } from './style.js';

const localLabels = JSON.parse(localLabelsRaw);
const GAME_BOUNDS = [
  [112.32, 23.0],
  [112.82, 23.26],
];
const REGION_BOUNDS = [
  [111.98, 22.78],
  [113.32, 23.72],
];
const INITIAL_CENTER = [112.575, 23.13];

const VIEWS = {
  all: { bounds: GAME_BOUNDS, zoom: null },
  duanzhou: { center: [112.462, 23.052], zoom: 14.55 },
  dinghu: { center: [112.558, 23.166], zoom: 14.3 },
  xinghu: { center: [112.4705, 23.075], zoom: 15.05 },
};

const params = new URLSearchParams(window.location.search);
const IS_EXPORT = params.get('export') === '1';
if (IS_EXPORT) document.body.classList.add('export-mode');

const map = new maplibregl.Map({
  container: 'map',
  style: buildStyle(localLabels, hillshadeUrl),
  center: INITIAL_CENTER,
  zoom: 12.15,
  minZoom: 9.6,
  maxZoom: 18,
  maxBounds: REGION_BOUNDS,
  dragRotate: false,
  pitchWithRotate: false,
  touchPitch: false,
  renderWorldCopies: false,
  attributionControl: false,
  logoPosition: 'bottom-left',
  preserveDrawingBuffer: true,
  antialias: true,
  fadeDuration: 120,
  canvasContextAttributes: {
    antialias: true,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  },
});

map.getCanvas().setAttribute('aria-label', '端州鼎湖 OpenStreetMap 可交互矢量底图');
map.touchZoomRotate.disableRotation();
map.keyboard.enable();

const groups = {
  ...LAYER_GROUPS,
  pois: [...POI_LAYER_IDS],
};
const groupState = Object.fromEntries(Object.keys(groups).map((key) => [key, true]));

const toggleRows = [
  { key: 'labels', name: '地名与注记', note: '行政区 · 街道 · 水系', swatch: 'labels' },
  { key: 'pois', name: '设施 POI', note: '医院 · 学校 · 餐饮 · 景点', swatch: 'pois' },
  { key: 'buildings', name: '建筑轮廓', note: 'OSM building footprints', swatch: 'buildings' },
  { key: 'roads', name: '道路网络', note: '高速 — 巷弄 — 步道', swatch: 'roads' },
  { key: 'transit', name: '轨道 · 轮渡', note: '铁路 · 地铁 · 渡线', swatch: 'transit' },
  { key: 'landuse', name: '土地利用', note: '居住 · 工业 · 农林 · 公园', swatch: 'landuse' },
  { key: 'water', name: '水系', note: '西江 · 湖泊 · 河涌', swatch: 'water' },
  { key: 'boundaries', name: '行政边界', note: '区界 · 镇街界', swatch: 'boundaries' },
  { key: 'terrain', name: '地形阴影', note: '北岭 · 鼎湖 · 烂柯', swatch: 'terrain' },
];

const panel = document.getElementById('layer-panel');
const rowsEl = document.getElementById('layer-rows');
for (const row of toggleRows) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'layer-row';
  button.dataset.key = row.key;
  button.setAttribute('aria-pressed', 'true');
  button.innerHTML = `
    <span class="layer-swatch layer-swatch--${row.swatch}"></span>
    <span class="layer-copy">
      <span class="layer-name">${row.name}</span>
      <span class="layer-note">${row.note}</span>
    </span>
    <span class="layer-toggle"><i></i></span>
  `;
  button.addEventListener('click', () => setGroup(row.key, !groupState[row.key]));
  rowsEl.appendChild(button);
}

function syncPanel() {
  for (const row of toggleRows) {
    const button = rowsEl.querySelector(`[data-key="${row.key}"]`);
    if (!button) continue;
    button.classList.toggle('is-on', groupState[row.key]);
    button.setAttribute('aria-pressed', String(groupState[row.key]));
  }
}

function setGroup(key, visible) {
  groupState[key] = Boolean(visible);
  for (const id of groups[key] ?? []) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    }
  }
  syncPanel();
}

function onlyBase() {
  for (const key of Object.keys(groupState)) {
    if (key === 'landuse' || key === 'water' || key === 'terrain') continue;
    setGroup(key, false);
  }
}

function showAll() {
  for (const key of Object.keys(groupState)) setGroup(key, true);
}

function fitGameView(animate = true) {
  map.fitBounds(GAME_BOUNDS, {
    padding: 0,
    animate,
    duration: animate ? 900 : 0,
    essential: true,
  });
}

function updateReadout() {
  const c = map.getCenter();
  const zoom = map.getZoom();
  document.getElementById('coord').textContent =
    `${c.lng.toFixed(4)}° E  /  ${c.lat.toFixed(4)}° N`;
  document.getElementById('zoom-value').textContent = `Z ${zoom.toFixed(1)}`;
}

map.addControl(
  new maplibregl.ScaleControl({
    maxWidth: 118,
    unit: 'metric',
  }),
  'bottom-left',
);

map.on('load', () => {
  fitGameView(false);
  updateReadout();

  // The icons are baked canvases, so they can be added synchronously here.
  for (const icon of buildPoiIcons()) {
    map.addImage(icon.id, icon.imageData, { pixelRatio: icon.pixelRatio });
  }
  for (const layer of buildPoiLayers()) map.addLayer(layer);

  // Re-apply any group that may have been changed before the POI layers existed.
  for (const key of Object.keys(groupState)) {
    if (!groupState[key]) setGroup(key, false);
  }

  if (IS_EXPORT) {
    if (params.get('labels') === '0') setGroup('labels', false);
    if (params.get('pois') === '0') setGroup('pois', false);
    if (params.get('buildings') === '0') setGroup('buildings', false);
    if (params.get('terrain') === '0') setGroup('terrain', false);
    if (params.get('roads') === '0') setGroup('roads', false);
    if (params.get('credit') === '0') document.getElementById('credit')?.remove();
  }

  bindPoiInteraction();
  window.__basemap?.onLoad?.();
});

map.on('move', () => {
  updateReadout();
  const active = document.querySelector('.view-chip.is-active');
  if (active && map.getZoom() < 12.8 && active.dataset.view !== 'all') {
    active.classList.remove('is-active');
  }
});

let readyTimer = 0;
map.on('idle', () => {
  if (!map.loaded()) return;
  window.clearTimeout(readyTimer);
  readyTimer = window.setTimeout(() => {
    if (window.__basemap) window.__basemap.ready = true;
    document.getElementById('boot')?.classList.add('is-done');
  }, 260);
});

window.__basemap = {
  map,
  ready: false,
  fitGameView,
  setGroup,
  groups,
  onLoad: null,
  style: 'Metro Plan · Duanzhou–Dinghu paper atlas',
  bounds: GAME_BOUNDS,
};

// --- POI card -------------------------------------------------------------
const popup = new maplibregl.Popup({
  closeButton: true,
  closeOnClick: true,
  offset: 15,
  maxWidth: '310px',
  className: 'poi-popup',
});

const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const classNames = {
  hospital: '医疗',
  clinic: '诊所',
  doctors: '诊所',
  school: '学校',
  kindergarten: '幼儿园',
  college: '学院',
  university: '大学',
  park: '公园',
  garden: '花园',
  nature_reserve: '自然保护区',
  attraction: '景点',
  viewpoint: '观景点',
  museum: '博物馆',
  gallery: '美术馆',
  library: '图书馆',
  theatre: '剧场',
  cinema: '影院',
  place_of_worship: '祠庙',
  restaurant: '餐厅',
  fast_food: '快餐',
  cafe: '咖啡馆',
  shop: '商店',
  hotel: '酒店',
  hostel: '旅舍',
  guest_house: '客栈',
  ferry_terminal: '渡口',
  railway: '铁路站',
  aerodrome: '机场',
  building: '建筑',
};

function showPoi(feature, lngLat) {
  const p = feature.properties ?? {};
  const kind = poiKind(p);
  const meta = POI_KINDS[kind] ?? POI_KINDS.default;
  const category = classNames[p.class] ?? classNames[p.subclass] ?? meta.label;
  const subCategory =
    p.subclass && p.subclass !== p.class && classNames[p.subclass] !== category
      ? classNames[p.subclass]
      : '';

  popup
    .setLngLat(lngLat)
    .setHTML(
      `
      <div class="popup-head">
        <span class="popup-kind"><i class="popup-glyph">${escapeHtml(meta.glyph)}</i>${escapeHtml(meta.label)}</span>
        <span class="popup-source">OSM</span>
      </div>
      <h3>${escapeHtml(p.name || '未命名设施')}</h3>
      <div class="popup-meta">${escapeHtml(category)}${
        subCategory ? ` · ${escapeHtml(subCategory)}` : ''
      }</div>
      <div class="popup-coord">${lngLat.lat.toFixed(4)}° N &nbsp; ${lngLat.lng.toFixed(4)}° E</div>
    `,
    )
    .addTo(map);
}

function showBuilding(feature, lngLat) {
  const p = feature.properties ?? {};
  const height = Number(p.render_height);
  const heightText = Number.isFinite(height) && height > 0 ? ` · 约 ${height} m` : '';
  popup
    .setLngLat(lngLat)
    .setHTML(
      `
      <div class="popup-head">
        <span class="popup-kind"><i class="popup-glyph">筑</i>建筑</span>
        <span class="popup-source">OSM</span>
      </div>
      <h3>建筑轮廓</h3>
      <div class="popup-meta">OpenStreetMap footprint${heightText}</div>
      <div class="popup-coord">${lngLat.lat.toFixed(4)}° N &nbsp; ${lngLat.lng.toFixed(4)}° E</div>
    `,
    )
    .addTo(map);
}

function bindPoiInteraction() {
  const clickableLayers = POI_LAYER_IDS.filter((id) => map.getLayer(id));
  let lastHoverQuery = 0;

  map.on('mousemove', (event) => {
    const now = performance.now();
    if (now - lastHoverQuery < 90) return;
    lastHoverQuery = now;
    const poi = map.queryRenderedFeatures(event.point, { layers: clickableLayers })[0];
    map.getCanvas().style.cursor = poi ? 'pointer' : '';
  });

  map.on('click', (event) => {
    const poi = map.queryRenderedFeatures(event.point, { layers: clickableLayers })[0];
    if (poi) {
      showPoi(poi, event.lngLat);
      return;
    }
    if (map.getZoom() >= 14 && map.getLayer('buildings')) {
      const building = map.queryRenderedFeatures(event.point, { layers: ['buildings'] })[0];
      if (building) {
        showBuilding(building, event.lngLat);
        return;
      }
    }
    popup.remove();
  });
}

// --- UI wiring ------------------------------------------------------------
document.getElementById('fit-button').addEventListener('click', () => {
  document.querySelectorAll('.view-chip').forEach((b) => b.classList.remove('is-active'));
  document.querySelector('.view-chip[data-view="all"]')?.classList.add('is-active');
  fitGameView(true);
});

document.getElementById('zoom-in').addEventListener('click', () => map.zoomIn({ duration: 260 }));
document.getElementById('zoom-out').addEventListener('click', () => map.zoomOut({ duration: 260 }));

document.getElementById('layers-button').addEventListener('click', () => {
  const open = panel.classList.toggle('is-open');
  document.getElementById('layers-button').setAttribute('aria-expanded', String(open));
});
document.getElementById('panel-close').addEventListener('click', () => {
  panel.classList.remove('is-open');
  document.getElementById('layers-button').setAttribute('aria-expanded', 'false');
});
document.getElementById('show-all').addEventListener('click', showAll);
document.getElementById('only-base').addEventListener('click', onlyBase);

document.querySelectorAll('.view-chip').forEach((button) => {
  button.addEventListener('click', () => {
    const view = button.dataset.view;
    document.querySelectorAll('.view-chip').forEach((b) => b.classList.remove('is-active'));
    button.classList.add('is-active');
    if (view === 'all') {
      fitGameView(true);
      return;
    }
    const target = VIEWS[view];
    if (!target) return;
    map.flyTo({
      center: target.center,
      zoom: target.zoom,
      duration: 1350,
      curve: 1.32,
      essential: true,
    });
  });
});

// Close the panel when clicking on the map itself, but not on the panel.
map.getCanvas().addEventListener('pointerdown', () => {
  panel.classList.remove('is-open');
  document.getElementById('layers-button').setAttribute('aria-expanded', 'false');
});

document.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (event.key === 'Escape') {
    panel.classList.remove('is-open');
    document.getElementById('layers-button').setAttribute('aria-expanded', 'false');
    popup.remove();
  }
  if (event.key.toLowerCase() === 'f') {
    document.querySelectorAll('.view-chip').forEach((b) => b.classList.remove('is-active'));
    document.querySelector('.view-chip[data-view="all"]')?.classList.add('is-active');
    fitGameView(true);
  }
});

// Initial state and gentle onboarding hint.
syncPanel();
document.querySelector('.view-chip[data-view="all"]')?.classList.add('is-active');
window.setTimeout(() => document.getElementById('hint')?.classList.add('is-gone'), 7200);

window.addEventListener('resize', () => map.resize());

// A small, stable API for the export/screenshot script.
window.__basemap.whenReady = () =>
  new Promise((resolve) => {
    if (window.__basemap.ready) return resolve();
    const timer = window.setInterval(() => {
      if (window.__basemap.ready) {
        window.clearInterval(timer);
        resolve();
      }
    }, 120);
  });
