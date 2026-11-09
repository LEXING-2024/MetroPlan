import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const OUT = path.resolve('qa');
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
await page.goto('http://127.0.0.1:4174/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__basemap?.ready === true, { timeout: 45000 });
await sleep(700);

// Only basemap.
await page.evaluate(() => {
  document.getElementById('layers-button').click();
  document.getElementById('only-base').click();
});
await sleep(600);
await page.screenshot({ path: path.join(OUT, 'only-base.png') });
const onlyBase = await page.evaluate(() =>
  Object.fromEntries(
    Object.keys(window.__basemap.groups).map((key) => [
      key,
      window.__basemap.groups[key].some(
        (id) => window.__basemap.map.getLayoutProperty(id, 'visibility') === 'visible',
      ),
    ]),
  ),
);

// Restore and go to a dense POI area.
await page.evaluate(() => {
  document.getElementById('show-all').click();
  window.__basemap.map.jumpTo({ center: [112.462, 23.052], zoom: 16, bearing: 0, pitch: 0 });
});
await page.waitForFunction(() => window.__basemap.map.loaded(), { timeout: 20000 }).catch(() => {});
await sleep(900);

const target = await page.evaluate(() => {
  const map = window.__basemap.map;
  const all = map.queryRenderedFeatures({ layers: ['poi-civic-icon', 'poi-school-icon'] });
  const f = all.find((x) => x.properties.name?.includes('医院')) ?? all[0];
  if (!f) return null;
  return { x: map.project(f.geometry.coordinates).x, y: map.project(f.geometry.coordinates).y, name: f.properties.name };
});
if (target) {
  await page.mouse.click(target.x, target.y);
  await sleep(500);
}
await page.screenshot({ path: path.join(OUT, 'interaction-detail.png') });

const state = await page.evaluate(() => ({
  popup: document.querySelector('.poi-popup h3')?.textContent ?? null,
  layers: window.__basemap.map.getStyle().layers.length,
  zoom: window.__basemap.map.getZoom(),
}));

console.log(JSON.stringify({ onlyBase, target, state, errors }, null, 2));
await browser.close();
