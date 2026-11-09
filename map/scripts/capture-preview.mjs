import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const OUT = path.resolve('preview');
const BASE_URL = process.env.MAP_URL ?? 'http://127.0.0.1:4174/';
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
await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__basemap?.ready === true, { timeout: 45000 });
await sleep(900);
await page.screenshot({ path: path.join(OUT, 'ui.png') });

// Layer panel.
await page.evaluate(() => document.getElementById('layers-button').click());
await sleep(400);
await page.screenshot({ path: path.join(OUT, 'layers.png') });
await page.evaluate(() => document.getElementById('layer-panel').classList.remove('is-open'));

// Dense street / POI detail.
await page.evaluate(() => {
  window.__basemap.map.jumpTo({ center: [112.462, 23.052], zoom: 15.9, bearing: 0, pitch: 0 });
});
await page.waitForFunction(() => window.__basemap.map.loaded(), { timeout: 20000 }).catch(() => {});
await sleep(1000);
const target = await page.evaluate(() => {
  const map = window.__basemap.map;
  const all = map.queryRenderedFeatures({ layers: ['poi-civic-icon', 'poi-school-icon'] });
  const f = all.find((x) => x.properties.name?.includes('医院')) ?? all[0];
  if (!f) return null;
  const p = map.project(f.geometry.coordinates);
  return { x: p.x, y: p.y };
});
if (target) {
  await page.mouse.click(target.x, target.y);
  await sleep(500);
}
await page.screenshot({ path: path.join(OUT, 'detail.png') });

// Mobile portrait: use a fresh page so the boot overlay has fully resolved.
const mobile = await browser.newPage();
await mobile.setViewport({
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const mobileErrors = [];
mobile.on('pageerror', (e) => mobileErrors.push(e.message));
mobile.on('console', (m) => {
  if (m.type() === 'error') mobileErrors.push(m.text());
});
await mobile.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
await mobile.waitForFunction(() => window.__basemap?.ready === true, { timeout: 45000 });
await sleep(800);
await mobile.screenshot({ path: path.join(OUT, 'mobile.png') });
errors.push(...mobileErrors);

console.log(JSON.stringify({ errors, target, ready: await page.evaluate(() => window.__basemap.ready) }, null, 2));
await browser.close();
