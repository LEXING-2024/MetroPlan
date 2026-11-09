import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const OUT = '.artifacts';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const logs = [];

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--hide-scrollbars'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  else if (m.type() === 'warning') logs.push(m.text());
});
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle0', timeout: 90000 });
await page.waitForFunction(() => !!window.__metro, { timeout: 60000 });
await sleep(900);

await page.evaluate(() =>
  document.querySelector('[data-act="editor"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
);
await sleep(900);
console.log(
  'editor open',
  JSON.stringify(
    await page.evaluate(() => ({
      active: window.__metro.game.editor.isActive(),
      root: !document.getElementById('editor-ui')?.classList.contains('hidden'),
      tool: document.querySelector('#editor-ui [data-tool].active')?.dataset.tool,
    })),
  ),
);

const screenOf = (x, y) =>
  page.evaluate(([wx, wy]) => window.__metro.scene.worldToScreen(wx, wy), [x, y]);

const clickEd = (sel) => page.click(`#editor-ui ${sel}`);

async function polygon(points, type) {
  await clickEd('[data-region-type="' + type + '"]');
  await sleep(120);
  await clickEd('[data-tool="polygon"]');
  await sleep(150);
  for (const [x, y] of points) {
    const p = await screenOf(x, y);
    await page.mouse.click(p.x, p.y);
    await sleep(110);
  }
  await page.keyboard.press('Enter');
  await sleep(350);
  await clickEd('[data-action="deselect"]');
  await sleep(150);
}

// 直接绘制
await page.evaluate(() =>
  document.querySelector('#editor-ui [data-action="quick-start"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
);
await sleep(300);

// 住宅
await polygon(
  [
    [420, 700],
    [900, 700],
    [900, 1080],
    [420, 1080],
  ],
  'residential',
);
// 就业
await polygon(
  [
    [1180, 380],
    [1600, 380],
    [1600, 720],
    [1180, 720],
  ],
  'employment',
);
// 商业（多边形）
await polygon(
  [
    [300, 400],
    [560, 400],
    [560, 600],
    [300, 600],
  ],
  'commercial',
);

// 笔刷：混合区
await clickEd('[data-region-type="mixed"]');
await sleep(150);
await clickEd('[data-tool="brush"]');
await sleep(200);
const b1 = await screenOf(1040, 950);
const b2 = await screenOf(1240, 1010);
await page.mouse.move(b1.x, b1.y);
await page.mouse.down();
for (let i = 0; i <= 12; i++) {
  const t = i / 12;
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
  ['hospital', 820, 520],
  ['school', 1120, 520],
  ['station', 1420, 520],
]) {
  await clickEd(`[data-poi-type="${type}"]`);
  await sleep(150);
  const p = await screenOf(x, y);
  await page.mouse.click(p.x, p.y);
  await sleep(250);
  await clickEd('[data-action="deselect"]');
  await sleep(120);
}

// 比例尺
await clickEd('[data-tool="scale"]');
await sleep(200);
const s1 = await screenOf(300, 300);
const s2 = await screenOf(700, 300);
await page.mouse.move(s1.x, s1.y);
await page.mouse.down();
await page.mouse.move(s2.x, s2.y, { steps: 8 });
await page.mouse.up();
await sleep(500);
console.log(
  'scale modal',
  JSON.stringify(
    await page.evaluate(() => ({
      open: !document.getElementById('ed-modal')?.classList.contains('hidden'),
      text: document.getElementById('ed-modal')?.innerText.slice(0, 60),
    })),
  ),
);
await page.evaluate(() => {
  const input = document.querySelector('#ed-km');
  if (input) input.value = '2';
});
await page.evaluate(() =>
  document.querySelector('[data-action="scale-apply"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
);
await sleep(500);

// 底图
await page.$eval('#ed-bg-input', () => {});
const bgInput = await page.$('#ed-bg-input');
await bgInput.uploadFile(path.resolve(OUT, 'bg-test.png'));
await sleep(1300);
await clickEd('[data-tool="background"]');
await sleep(500);
await page.screenshot({ path: `${OUT}/ed-02-background.png` });

const state = await page.evaluate(() => {
  const e = window.__metro.game.editor;
  const map = e.map;
  return {
    regions: map.regions.map((r) => ({ type: r.type, kind: r.shape.kind })),
    pois: map.pois.map((p) => ({ type: p.type, radius: p.radiusKm })),
    pxPerKm: map.pxPerKm,
    background: map.background ? { w: map.background.width, h: map.background.height, opacity: map.background.opacity } : null,
    stats: document.querySelector('.ed-mapinfo')?.textContent,
    scaleText: document.getElementById('ed-scale-text')?.textContent,
  };
});
console.log('map state', JSON.stringify(state));

// 选中区域查看属性
await clickEd('[data-tool="select"]');
await sleep(200);
const selPoint = await screenOf(650, 880);
await page.mouse.click(selPoint.x, selPoint.y);
await sleep(500);
await page.screenshot({ path: `${OUT}/ed-03-region.png` });

// 播放
await page.evaluate(() =>
  document.querySelector('#editor-ui [data-action="play"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
);
await sleep(1500);
const playState = await page.evaluate(() => {
  const s = window.__metro.game.sim;
  return s
    ? {
        mapId: s.mapId,
        mapName: s.mapName,
        zones: s.zones.length,
        pois: s.pois.length,
        agents: s.agents.count,
        groups: s.groupCounts(),
        pxPerKm: s.pxPerKm,
        walkRadius: s.walkRadiusPx,
        editorActive: window.__metro.game.editor.isActive(),
        hud: !document.querySelector('.hud')?.classList.contains('hidden'),
      }
    : null;
});
console.log('play state', JSON.stringify(playState));
await page.screenshot({ path: `${OUT}/ed-04-custom-game.png` });

// 建站并推进
await page.evaluate(() => {
  const g = window.__metro.game;
  const s = g.sim;
  s.settings.autoPause = false;
  const a = s.placeStation(620, 820).station?.id;
  const b = s.placeStation(800, 560).station?.id;
  const c = s.placeStation(1330, 520).station?.id;
  if (a && b) s.createLine([a, b], 0);
  if (b && c) s.createLine([b, c], 1);
  s.advanceMinutes(150);
});
await sleep(900);
await page.screenshot({ path: `${OUT}/ed-05-custom-peak.png` });
console.log(
  'custom sim',
  JSON.stringify(
    await page.evaluate(() => {
      const s = window.__metro.game.sim;
      return {
        stations: s.net.stations.length,
        lines: s.net.lines.length,
        ridership: s.stats.ridership,
        delivered: s.stats.delivered,
        groups: s.groupCounts(),
      };
    }),
  ),
);

// 自定义地图存档 / 读档（底图应通过 mapId 从地图库恢复）
await page.evaluate(async () => {
  await window.__metro.game.saveSlot('manual-2');
});
await sleep(700);
await page.evaluate(async () => {
  await window.__metro.game.loadSlot('manual-2');
});
await sleep(1500);
console.log(
  'custom save/load',
  JSON.stringify(
    await page.evaluate(() => {
      const g = window.__metro.game;
      const s = g.sim;
      const layer = window.__metro.scene.customLayer;
      return {
        mapId: s.mapId,
        mapName: s.mapName,
        mapRegions: s.map?.regions.length,
        stations: s.net.stations.length,
        groups: s.groupCounts(),
        bgFirstChild: layer?.children?.[0]?.constructor?.name,
        bgAlpha: layer?.children?.[0]?.alpha,
        paused: s.paused,
      };
    }),
  ),
);
await page.screenshot({ path: `${OUT}/ed-06-custom-loaded.png` });

console.log('errors', JSON.stringify(errors));
if (logs.length) console.log('warnings', JSON.stringify(logs.slice(0, 5)));
await browser.close();
