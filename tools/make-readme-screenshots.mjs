import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

/** Four current-build screenshots for the GitHub README. */
const OUT = 'docs/screenshots';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  protocolTimeout: 300000,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--no-sandbox',
    '--hide-scrollbars',
  ],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
});

const page = await browser.newPage();
page.on('pageerror', (err) => console.error('[pageerror]', err.message));
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle0', timeout: 120000 });
await page.waitForFunction(() => !!window.__metro, { timeout: 120000 });

await page.evaluate(() => window.__metro.game.newGame('standard'));
await page.waitForFunction(() => !!window.__metro.game.sim, { timeout: 30000 });
await page.evaluate(() => {
  const sim = window.__metro.game.sim;
  sim.setPaused(true);
  sim.settings.autoPause = false;
  sim.settings.skipNight = false;
  sim.fund = 84000;
  sim.mapName = '演示城市';
  sim.advanceMinutes(76);
  sim.setPaused(true);

  const style = document.createElement('style');
  style.textContent = `
    #tutorial, #toasts, #fps-badge, #hover-label, #surge-bubble, #peak-tag { display:none !important; }
  `;
  document.head.appendChild(style);

  const map = window.__metro.basemap?.getMap();
  const hideLabels = () => {
    try {
      for (const layer of map.getStyle()?.layers ?? []) {
        if (layer.type === 'symbol') map.setLayoutProperty(layer.id, 'visibility', 'none');
      }
    } catch {
      /* style may be loading */
    }
  };
  if (map?.isStyleLoaded()) hideLabels();
  map?.on('styledata', hideLabels);
  window.__hideLabels = hideLabels;
  window.__labelTimer = setInterval(hideLabels, 500);
});

const pts = [
  [700, 1160],
  [760, 1120],
  [800, 1120],
  [840, 1100],
  [880, 1080],
  [920, 1080],
  [960, 1040],
  [1009, 993],
];

await page.evaluate((points) => {
  const sim = window.__metro.game.sim;
  const ids = [];
  for (const [x, y] of points) {
    const r = sim.placeStation(x, y, 'large');
    if (r.station) ids.push(r.station.id);
  }
  const line = sim.createLine(ids, 0);
  if (!line.ok) throw new Error(line.reason ?? 'line failed');
  sim.setExpressStops(line.lineId, [ids[0], ids[2], ids[4], ids[7]]);
  for (let i = 0; i < 4; i++) sim.addTrain(line.lineId, 'local');
  sim.addTrain(line.lineId, 'express');
  sim.net.stations.forEach((s, i) => {
    s.name = `节点 A${i + 1}`;
  });
  sim.pois.forEach((p, i) => {
    p.name = `目的地 ${String(i + 1).padStart(3, '0')}`;
  });
  sim.zones.forEach((z, i) => {
    z.name = `片区 ${String(i + 1).padStart(2, '0')}`;
  });
  sim.advanceMinutes(620);
}, pts);

await sleep(600);
await page.evaluate(() => {
  const sc = window.__metro.scene;
  sc.resetCamera();
  const p = sc.worldToScreen(850, 1080);
  sc.zoomAt(p.x, p.y, 3.2);
  const q = sc.worldToScreen(850, 1080);
  sc.panBy(690 - q.x, 450 - q.y);
  window.__hideLabels?.();
});
await sleep(900);

// 1) Line / operations.
await page.evaluate(() => window.__metro.game.selectLine(1));
await page.waitForSelector('#line-panel:not(.hidden)', { timeout: 5000 });
await sleep(700);
await page.screenshot({ path: `${OUT}/gameplay-line.png` });

// 2) Station panel at the evening peak.
await page.keyboard.press('Escape');
await sleep(300);
await page.evaluate(() => {
  const sim = window.__metro.game.sim;
  window.__metro.game.selectStation(sim.net.stations[5]);
});
await page.waitForSelector('#station-panel:not(.hidden)', { timeout: 5000 });
await sleep(700);
await page.screenshot({ path: `${OUT}/gameplay-station.png` });

// 3) Layers + OD at the peak.
await page.keyboard.press('Escape');
await sleep(300);
await page.click('#btn-layers');
await page.waitForSelector('#layer-popover:not(.hidden)', { timeout: 4000 });
await page.click('[data-layer-key="od"]');
await page.click('[data-layer-key="zones"]');
await sleep(1000);
await page.evaluate(() => window.__hideLabels?.());
await page.screenshot({ path: `${OUT}/gameplay-layers.png` });
await page.click('[data-layer-key="od"]');
await page.click('[data-layer-key="zones"]');
await page.click('#layer-close');
await sleep(400);

// 4) Daily settlement card.
await page.evaluate(() => {
  const sim = window.__metro.game.sim;
  sim.settings.skipNight = false;
  sim.advanceMinutes(380);
});
await sleep(250);
await page.evaluate(() => {
  const sim = window.__metro.game.sim;
  sim.advanceMinutes(10);
  sim.setPaused(true);
  const record = sim.history[sim.history.length - 1];
  if (record) window.__metro.game.ui.dailyCard(record);
  window.__hideLabels?.();
});
await sleep(500);
await page.screenshot({ path: `${OUT}/gameplay-settle.png` });

await page.evaluate(() => clearInterval(window.__labelTimer));
await browser.close();
console.log('screenshots written:', fs.readdirSync(OUT).filter((f) => f.startsWith('gameplay-')).join(', '));
