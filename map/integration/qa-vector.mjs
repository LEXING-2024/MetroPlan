import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const OUT = path.resolve('integration/qa');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--hide-scrollbars'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});
page.on('requestfailed', (r) => {
  if (!r.url().includes('favicon')) errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`);
});

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__metro, { timeout: 60000 });
await sleep(1800);
await page.screenshot({ path: path.join(OUT, 'menu.png') });

await page.evaluate(() => window.__metro.game.newGame('standard'));
await sleep(3200);
await page.screenshot({ path: path.join(OUT, 'game.png') });

const info = await page.evaluate(() => {
  const { scene, basemap, game } = window.__metro;
  const map = basemap?.getMap();
  return {
    basemapLoaded: basemap?.isLoaded() ?? false,
    vectorBase: scene.vectorBase,
    vectorVisible: scene.vectorVisible,
    sceneScale: scene.scale,
    sceneZoom: scene.zoom,
    mapZoom: map?.getZoom(),
    mapCenter: map ? [map.getCenter().lng, map.getCenter().lat] : null,
    mapCanvas: map
      ? {
          width: map.getCanvas().width,
          height: map.getCanvas().height,
          display: map.getCanvas().style.display,
        }
      : null,
    mapContainerVisibility: document.getElementById('basemap')?.style.visibility,
    stageVisibility: document.getElementById('stage')?.style.visibility,
    layers: game.ui.getLayers(),
    simMap: !!game.sim?.map,
  };
});
console.log(JSON.stringify({ info, errors }, null, 2));

// Zoom in with the game's own camera API, MapLibre must follow.
await page.evaluate(() => {
  const { scene } = window.__metro;
  for (let i = 0; i < 8; i++) scene.zoomAt(960, 540, 1.12);
});
await sleep(2200);
await page.screenshot({ path: path.join(OUT, 'zoomed.png') });

const after = await page.evaluate(() => {
  const { scene, basemap, game } = window.__metro;
  const map = basemap?.getMap();
  return {
    sceneScale: scene.scale,
    sceneZoom: scene.zoom,
    mapZoom: map?.getZoom(),
    mapCenter: map ? [map.getCenter().lng, map.getCenter().lat] : null,
    layers: game.ui.getLayers(),
  };
});
console.log('after zoom', JSON.stringify(after, null, 2));

console.log('errors', JSON.stringify(errors, null, 2));
await browser.close();
