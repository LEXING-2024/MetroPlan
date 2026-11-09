import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const OUT = 'docs/screenshots';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--hide-scrollbars'],
  defaultViewport: { width: 1920, height: 1080 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle0', timeout: 90000 });
await page.waitForFunction(() => !!window.__metro, { timeout: 60000 });
await sleep(1000);
await page.screenshot({ path: `${OUT}/menu.png` });

await page.evaluate(() =>
  document.querySelector('[data-act="editor"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
);
await sleep(1000);
await page.screenshot({ path: `${OUT}/editor-empty.png` });

const screenOf = (x, y) =>
  page.evaluate(([wx, wy]) => window.__metro.scene.worldToScreen(wx, wy), [x, y]);
const clickEd = (sel) => page.click(`#editor-ui ${sel}`);

// 导入真实底图
const bgInput = await page.$('#ed-bg-input');
await bgInput.uploadFile(path.resolve('assets/maps/duanzhou-dinghu-simple.png'));
await sleep(2000);

// 比例尺：800 px = 10 km
await clickEd('[data-tool="scale"]');
await sleep(250);
const s1 = await screenOf(400, 1100);
const s2 = await screenOf(1200, 1100);
await page.mouse.move(s1.x, s1.y);
await page.mouse.down();
await page.mouse.move(s2.x, s2.y, { steps: 10 });
await page.mouse.up();
await sleep(500);
await page.evaluate(() => {
  const input = document.querySelector('#ed-km');
  if (input) input.value = '10';
});
await page.evaluate(() =>
  document.querySelector('[data-action="scale-apply"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
);
await sleep(600);

async function polygon(points, type) {
  await clickEd('[data-tool="polygon"]');
  await sleep(150);
  await clickEd(`[data-region-type="${type}"]`);
  await sleep(120);
  for (const [x, y] of points) {
    const p = await screenOf(x, y);
    await page.mouse.click(p.x, p.y);
    await sleep(90);
  }
  await page.keyboard.press('Enter');
  await sleep(350);
  await clickEd('[data-action="deselect"]');
  await sleep(120);
}

await polygon(
  [
    [470, 1010],
    [740, 1030],
    [760, 1170],
    [500, 1190],
  ],
  'residential',
);
await polygon(
  [
    [800, 1060],
    [1000, 1040],
    [1010, 1170],
    [810, 1185],
  ],
  'employment',
);
await polygon(
  [
    [1170, 500],
    [1390, 470],
    [1410, 660],
    [1190, 680],
  ],
  'residential',
);
await polygon(
  [
    [1300, 430],
    [1480, 420],
    [1490, 560],
    [1310, 570],
  ],
  'employment',
);

// 笔刷混合区
await clickEd('[data-tool="brush"]');
await sleep(150);
await clickEd('[data-region-type="mixed"]');
await sleep(150);
const b1 = await screenOf(760, 940);
const b2 = await screenOf(800, 990);
await page.mouse.move(b1.x, b1.y);
await page.mouse.down();
for (let i = 0; i <= 8; i++) {
  const t = i / 8;
  await page.mouse.move(b1.x + (b2.x - b1.x) * t, b1.y + (b2.y - b1.y) * t);
  await sleep(25);
}
await page.mouse.up();
await sleep(400);
await clickEd('[data-action="deselect"]');
await sleep(150);

// POI
await clickEd('[data-tool="poi"]');
await sleep(150);
for (const [type, x, y] of [
  ['hospital', 880, 1120],
  ['school', 650, 1080],
  ['station', 1350, 520],
  ['scenic', 760, 970],
]) {
  await clickEd(`[data-poi-type="${type}"]`);
  await sleep(120);
  const p = await screenOf(x, y);
  await page.mouse.click(p.x, p.y);
  await sleep(250);
  await clickEd('[data-action="deselect"]');
  await sleep(100);
}

// 选中住宅区域，展示属性面板
await clickEd('[data-tool="select"]');
await sleep(200);
const sel = await screenOf(600, 1090);
await page.mouse.click(sel.x, sel.y);
await sleep(500);
await page.screenshot({ path: `${OUT}/editor.png` });

// 选中医院 POI
const hp = await screenOf(880, 1120);
await page.mouse.click(hp.x, hp.y);
await sleep(500);
await page.screenshot({ path: `${OUT}/editor-poi.png` });

// 底图面板
await clickEd('[data-tool="background"]');
await sleep(500);
await page.screenshot({ path: `${OUT}/editor-background.png` });

// 网格
await clickEd('[data-action="toggle-grid"]');
await sleep(500);
await page.screenshot({ path: `${OUT}/editor-grid.png` });
await clickEd('[data-action="toggle-grid"]');
await sleep(200);

const state = await page.evaluate(() => {
  const e = window.__metro.game.editor;
  return {
    regions: e.map.regions.length,
    pois: e.map.pois.length,
    pxPerKm: e.map.pxPerKm,
    bg: e.map.background ? { w: e.map.background.width, h: e.map.background.height } : null,
    scale: document.getElementById('ed-scale-text')?.textContent,
  };
});
console.log('editor demo', JSON.stringify(state));

// 开始游戏
await page.evaluate(() =>
  document.querySelector('#editor-ui [data-action="play"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
);
await sleep(1600);
await page.evaluate(() => {
  const g = window.__metro.game;
  const s = g.sim;
  s.settings.autoPause = false;
  const a = s.placeStation(600, 1080).station?.id;
  const b = s.placeStation(900, 1100).station?.id;
  const c = s.placeStation(1280, 620).station?.id;
  const d = s.placeStation(1380, 500).station?.id;
  if (a && b) s.createLine([a, b], 0);
  if (c && d) s.createLine([c, d], 1);
  s.advanceMinutes(165);
});
await sleep(2600);
await page.screenshot({ path: `${OUT}/custom-map.png` });

// 点击医院 POI 附近的组团，查看 OD 摘要
const poiPoint = await page.evaluate(() => window.__metro.scene.worldToScreen(880, 1120));
await page.mouse.click(poiPoint.x, poiPoint.y);
await sleep(600);
await page.screenshot({ path: `${OUT}/custom-zone.png` });

console.log(
  'custom game',
  JSON.stringify(
    await page.evaluate(() => {
      const s = window.__metro.game.sim;
      return {
        map: s.mapName,
        agents: s.agents.count,
        groups: s.groupCounts(),
        zones: s.zones.length,
        ridership: s.stats.ridership,
        walkRadius: s.walkRadiusPx,
        pxPerKm: s.pxPerKm,
      };
    }),
  ),
);
console.log('errors', JSON.stringify(errors));
await browser.close();
