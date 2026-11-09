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
await sleep(800);

async function view(name, center, zoom) {
  await page.evaluate(
    ({ center, zoom }) => {
      window.__basemap.map.jumpTo({ center, zoom, bearing: 0, pitch: 0 });
    },
    { center, zoom },
  );
  await page.waitForFunction(() => window.__basemap.map.loaded(), { timeout: 20000 }).catch(() => {});
  await sleep(1000);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

await view('t14-duanzhou', [112.465, 23.055], 14.6);
await view('t16-oldcity', [112.462, 23.052], 16.1);
await view('t16-xinghu', [112.471, 23.078], 16.0);
await view('t12-region', [112.57, 23.13], 12.45);

// Layer panel.
await page.evaluate(() => document.getElementById('layers-button').click());
await sleep(400);
await page.screenshot({ path: path.join(OUT, 'panel.png') });
await page.evaluate(() => document.getElementById('layer-panel').classList.remove('is-open'));

// Click the first rendered hospital POI.
const clickPoint = await page.evaluate(() => {
  const map = window.__basemap.map;
  map.jumpTo({ center: [112.462, 23.052], zoom: 15.6, bearing: 0, pitch: 0 });
  return new Promise((resolve) => {
    map.once('idle', () => {
      const fs = map.queryRenderedFeatures({ layers: ['poi-civic-icon', 'poi-school-icon'] });
      const hospital = fs.find((f) => ['hospital', 'clinic'].includes(f.properties.class)) ?? fs[0];
      if (!hospital) return resolve(null);
      const p = map.project(hospital.geometry.coordinates);
      resolve({ x: p.x, y: p.y, name: hospital.properties.name, cls: hospital.properties.class });
    });
  });
});
console.log('clickPoint', clickPoint);
if (clickPoint) {
  await page.mouse.click(clickPoint.x, clickPoint.y);
  await sleep(800);
  await page.screenshot({ path: path.join(OUT, 'poi-popup.png') });
}

// Export mode no UI.
await page.goto('http://127.0.0.1:4174/?export=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__basemap?.ready === true, { timeout: 45000 });
await sleep(1000);
await page.screenshot({ path: path.join(OUT, 'export-mode.png') });

console.log('errors', JSON.stringify(errors, null, 2));
await browser.close();
