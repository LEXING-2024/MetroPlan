import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const OUT = path.resolve('qa');
fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: [
    '--no-sandbox',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--use-angle=d3d11',
    '--hide-scrollbars',
  ],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.stack || e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
});
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));

await page.goto('http://127.0.0.1:4174/', { waitUntil: 'domcontentloaded' });
try {
  await page.waitForFunction(() => window.__basemap?.ready === true, { timeout: 35000 });
} catch (e) {
  console.log('READY TIMEOUT');
}
await new Promise((r) => setTimeout(r, 1000));
const info = await page.evaluate(() => {
  const bm = window.__basemap;
  if (!bm) return { missing: true, body: document.body.innerText.slice(0, 500) };
  const map = bm.map;
  let styleLayers = null;
  try {
    styleLayers = map.getStyle()?.layers?.map((l) => l.id) ?? null;
  } catch (err) {
    styleLayers = `ERR ${err.message}`;
  }
  return {
    ready: bm.ready,
    loaded: map.loaded(),
    zoom: map.getZoom(),
    center: map.getCenter(),
    bounds: map.getBounds(),
    styleLoaded: map.isStyleLoaded(),
    styleLayers,
  };
});
console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: path.join(OUT, 'first-1920.png') });
console.log('errors', JSON.stringify(errors, null, 2));
await browser.close();
