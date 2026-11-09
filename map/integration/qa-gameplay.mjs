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
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__metro, { timeout: 60000 });
await page.evaluate(() => window.__metro.game.newGame('standard'));
await sleep(2800);

// Place a station at map centre and a line so the Pixi overlay is visible.
const placed = await page.evaluate(() => {
  const { game, scene } = window.__metro;
  const sim = game.sim;
  sim.fund = 100000;
  const a = sim.placeStation(1240, 720).station;
  const b = sim.placeStation(1380, 720).station;
  const line = sim.createLine([a.id, b.id], 0).lineId;
  scene.zoomAt(960, 540, 1.6);
  return { a: scene.worldToScreen(a.x, a.y), b: scene.worldToScreen(b.x, b.y), line };
});
await sleep(1200);
await page.screenshot({ path: path.join(OUT, 'stations.png') });

// Toggle the base layer from the actual UI.
await page.evaluate(() => {
  document.getElementById('btn-layers').click();
  const input = document.querySelector('[data-layer-key="base"]');
  if (input) {
    input.checked = false;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
});
await sleep(500);
await page.screenshot({ path: path.join(OUT, 'base-off-ui.png') });
const baseOff = await page.evaluate(() => ({
  base: window.__metro.game.ui.getLayers().base,
  container: getComputedStyle(document.getElementById('basemap')).visibility,
  sprite: window.__metro.scene.mapSprite.visible,
}));

await page.evaluate(() => {
  const input = document.querySelector('[data-layer-key="base"]');
  if (input) {
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
});
await sleep(600);

// Plain map fallback.
await page.evaluate(() => window.__metro.game.newGameOnMap('plain-duanzhou-dinghu'));
await sleep(2400);
await page.screenshot({ path: path.join(OUT, 'plain-fallback.png') });
const plain = await page.evaluate(() => ({
  base: window.__metro.scene.vectorBase,
  plain: window.__metro.scene.plainMap,
  container: getComputedStyle(document.getElementById('basemap')).visibility,
  mapSprite: window.__metro.scene.mapSprite.visible,
}));

console.log(JSON.stringify({ placed, baseOff, plain, errors }, null, 2));
await browser.close();
