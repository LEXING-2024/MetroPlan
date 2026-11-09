/**
 * Render the exact 16:9 game plate at three output sizes, with and without
 * labels/POIs. The CSS viewport is always 2560x1440 (the game's world grid);
 * deviceScaleFactor changes the raster size without changing the cartography,
 * exactly like the game's 1920 / 2560 / 3840 map assets.
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const OUT = path.resolve('out');
fs.mkdirSync(OUT, { recursive: true });
const BASE_URL = process.env.MAP_URL ?? 'http://127.0.0.1:4174/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CSS_W = 2560;
const CSS_H = 1440;
const variants = [
  { key: '1920-labeled', width: 1920, height: 1080, dsf: 0.75, labels: true, pois: true },
  { key: '1920-clean', width: 1920, height: 1080, dsf: 0.75, labels: false, pois: false },
  { key: '2560-labeled', width: 2560, height: 1440, dsf: 1, labels: true, pois: true },
  { key: '2560-clean', width: 2560, height: 1440, dsf: 1, labels: false, pois: false },
  { key: '3840-labeled', width: 3840, height: 2160, dsf: 1.5, labels: true, pois: true },
  { key: '3840-clean', width: 3840, height: 2160, dsf: 1.5, labels: false, pois: false },
];

const browser = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: [
    '--no-sandbox',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--use-angle=d3d11',
    '--hide-scrollbars',
    '--disable-lcd-text',
  ],
});

const results = [];
for (const v of variants) {
  const page = await browser.newPage();
  await page.setViewport({
    width: CSS_W,
    height: CSS_H,
    deviceScaleFactor: v.dsf,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  const query = new URLSearchParams({
    export: '1',
    labels: v.labels ? '1' : '0',
    pois: v.pois ? '1' : '0',
  });
  await page.goto(new URL(`?${query.toString()}`, BASE_URL).toString(), {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForFunction(() => window.__basemap?.ready === true, { timeout: 90000 });
  await page
    .evaluate(
      () =>
        new Promise((resolve) => {
          const map = window.__basemap.map;
          if (map.loaded() && map.areTilesLoaded()) resolve();
          else map.once('idle', resolve);
        }),
    )
    .catch(() => {});
  await sleep(900);

  const file = path.join(
    OUT,
    `duanzhou-dinghu-basemap-${v.width}x${v.height}${v.labels ? '' : '-nolabels'}.png`,
  );
  await page.screenshot({
    path: file,
    type: 'png',
    captureBeyondViewport: false,
  });

  const png = fs.readFileSync(file);
  const actualW = png.readUInt32BE(16);
  const actualH = png.readUInt32BE(20);
  const info = await page.evaluate(() => {
    const map = window.__basemap.map;
    const b = map.getBounds();
    return {
      zoom: Number(map.getZoom().toFixed(4)),
      center: [Number(map.getCenter().lng.toFixed(6)), Number(map.getCenter().lat.toFixed(6))],
      bbox: [
        Number(b.getWest().toFixed(6)),
        Number(b.getSouth().toFixed(6)),
        Number(b.getEast().toFixed(6)),
        Number(b.getNorth().toFixed(6)),
      ],
      layers: map.getStyle().layers.length,
      loaded: map.loaded(),
    };
  });

  const result = {
    key: v.key,
    file: path.relative(process.cwd(), file).replaceAll('\\', '/'),
    width: actualW,
    height: actualH,
    deviceScaleFactor: v.dsf,
    labels: v.labels,
    pois: v.pois,
    bytes: png.length,
    ...info,
    errors,
  };
  results.push(result);
  console.log(
    `${v.key.padEnd(14)} ${actualW}x${actualH}  ${(png.length / 1024 / 1024).toFixed(2)} MiB  z=${info.zoom}  errors=${errors.length}`,
  );
  await page.close();
}

fs.writeFileSync(
  path.join(OUT, 'export-meta.json'),
  JSON.stringify(
    {
      source: {
        basemap: 'Metro Plan · Duanzhou–Dinghu paper atlas',
        vectorTiles: 'OpenFreeMap / OpenMapTiles 3.16, data © OpenStreetMap contributors (ODbL)',
        terrain: 'Game DEM crop (AWS Terrain Tiles / Mapzen Terrarium), processed locally',
        mapLibre: '5.24.0',
      },
      gameBounds: [112.32, 23.0, 112.82, 23.26],
      exportedAt: new Date().toISOString(),
      variants: results,
    },
    null,
    2,
  ),
);

await browser.close();
