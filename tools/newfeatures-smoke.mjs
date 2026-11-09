import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const OUT = '.artifacts';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
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
});
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle0', timeout: 90000 });
await page.waitForFunction(() => !!window.__metro, { timeout: 60000 });
await sleep(900);
await page.evaluate(() => window.__metro.game.newGame('standard'));
await sleep(1200);

const initial = await page.evaluate(() => {
  const g = window.__metro.game;
  const s = g.sim;
  const scene = window.__metro.scene;
  return {
    pois: s.pois.length,
    poiBadges: scene.poiGfx.children.length,
    groups: s.groupCounts(),
    activeGroupButtons: document.querySelectorAll('[data-group]:not(.hidden)').length,
    hasDelivered: !!document.querySelector('[data-metric="delivered"]'),
    hasUnserved: !!document.querySelector('[data-metric="unserved"]'),
    fps: document.querySelector('#fps-badge b')?.textContent,
    pxPerKm: s.pxPerKm,
    scaleVisible: !document.getElementById('scale-bar')?.classList.contains('hidden'),
    scaleLabel: document.getElementById('scale-label')?.textContent,
    scaleWidth: document.getElementById('scale-line')?.style.width,
    lineLegend: document.getElementById('line-legend')?.textContent,
    agents: s.agents.count,
  };
});
console.log('initial', JSON.stringify(initial));
await sleep(600);
await page.screenshot({ path: `${OUT}/new-01-hud.png` });

// 放站：点击后预览应固定，移动鼠标不跟随
await page.click('[data-tool="station"]');
const p1 = await page.evaluate(() => window.__metro.scene.worldToScreen(825, 1150));
await page.mouse.click(p1.x, p1.y);
await sleep(300);
const preview1 = await page.evaluate(() => window.__metro.game.previewPos);
await page.mouse.move(p1.x + 120, p1.y - 80);
await sleep(300);
const preview2 = await page.evaluate(() => window.__metro.game.previewPos);
console.log('preview freeze', JSON.stringify({ preview1, preview2, same: JSON.stringify(preview1) === JSON.stringify(preview2) }));
await page.screenshot({ path: `${OUT}/new-00-placement.png` });
await page.click('#pv-confirm');
await sleep(400);
const stationCount = await page.evaluate(() => window.__metro.game.sim.net.stations.length);
console.log('station placed', stationCount);

// 第二站 + 画线，测试颜色与运营时段
const p2 = await page.evaluate(() => window.__metro.scene.worldToScreen(940, 1085));
await page.mouse.click(p2.x, p2.y);
await sleep(250);
await page.click('#pv-confirm');
await sleep(300);
await page.click('[data-tool="line"]');
await sleep(200);
for (const p of [p1, p2]) {
  await page.mouse.click(p.x, p.y);
  await sleep(200);
}
await sleep(300);
const draft = await page.evaluate(() => ({
  visible: !document.getElementById('draft-panel')?.classList.contains('hidden'),
  swatches: document.querySelectorAll('[data-draft-swatch]').length,
  start: document.getElementById('draft-start')?.value,
  end: document.getElementById('draft-end')?.value,
}));
console.log('draft', JSON.stringify(draft));
await page.screenshot({ path: `${OUT}/new-00-draft.png` });
// 选蓝色，07:00–19:00
await page.click('[data-draft-swatch="1"]');
await page.evaluate(() => {
  const start = document.getElementById('draft-start');
  const end = document.getElementById('draft-end');
  if (start) {
    start.value = '07:00';
    start.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (end) {
    end.value = '19:00';
    end.dispatchEvent(new Event('change', { bubbles: true }));
  }
});
await sleep(200);
await page.click('#draft-finish');
await sleep(500);
const lineState = await page.evaluate(() => {
  const s = window.__metro.game.sim;
  const line = s.net.lines[0];
  return line
    ? { hex: line.hex, start: line.startMin, end: line.endMin, color: line.color, trains: line.trains.length }
    : null;
});
console.log('line', JSON.stringify(lineState));
await page.screenshot({ path: `${OUT}/new-02-line.png` });

// 线路面板：颜色与时段
await page.evaluate(() => {
  const g = window.__metro.game;
  g.selectLine(g.sim.net.lines[0].id);
});
await sleep(400);
const panel = await page.evaluate(() => ({
  swatches: document.querySelectorAll('#lp-colors [data-line-swatch]').length,
  start: document.getElementById('lp-start')?.value,
  end: document.getElementById('lp-end')?.value,
  text: document.getElementById('line-panel')?.innerText.slice(0, 200),
}));
console.log('line panel', JSON.stringify(panel));
await page.screenshot({ path: `${OUT}/new-03-line-panel.png` });

// 线路图例高亮
await page.evaluate(() => document.querySelector('#line-panel #lp-close')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
await sleep(200);
const chip = await page.$('[data-legend-line]');
if (chip) await chip.click();
await sleep(400);
console.log('highlight', JSON.stringify(await page.evaluate(() => ({ id: window.__metro.game.highlightLineId, active: document.querySelector('[data-legend-line]')?.className }))));
await page.screenshot({ path: `${OUT}/new-04-highlight.png` });

// 图层开关
await page.click('#btn-layers');
await sleep(200);
await page.screenshot({ path: `${OUT}/new-06-layers.png` });
const layersBefore = await page.evaluate(() => ({ ...window.__metro.game.ui.getLayers(), dot: window.__metro.scene.dotSprite.visible }));
await page.evaluate(() => {
  const cb = document.querySelector('[data-layer-key="zones"]');
  cb.checked = false;
  cb.dispatchEvent(new Event('change', { bubbles: true }));
});
await sleep(300);
const layersAfter = await page.evaluate(() => ({ ...window.__metro.game.ui.getLayers(), dot: window.__metro.scene.dotSprite.visible }));
console.log('layers', JSON.stringify({ before: layersBefore, after: layersAfter }));
await page.evaluate(() => {
  const cb = document.querySelector('[data-layer-key="zones"]');
  cb.checked = true;
  cb.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.click('#btn-layers');
await sleep(200);

// Ctrl + 滚轮缩放
const beforeZoom = await page.evaluate(() => {
  const scene = window.__metro.scene;
  return { zoom: scene.zoom, label: document.getElementById('scale-label')?.textContent, zoomText: document.getElementById('scale-zoom')?.textContent };
});
await page.mouse.move(800, 500);
await page.keyboard.down('Control');
await page.mouse.wheel({ deltaY: -600 });
await page.keyboard.up('Control');
await sleep(500);
const afterZoom = await page.evaluate(() => {
  const scene = window.__metro.scene;
  return { zoom: scene.zoom, label: document.getElementById('scale-label')?.textContent, zoomText: document.getElementById('scale-zoom')?.textContent, width: document.getElementById('scale-line')?.style.width };
});
console.log('zoom', JSON.stringify({ beforeZoom, afterZoom }));
await page.screenshot({ path: `${OUT}/new-05-zoom.png` });

// 最小缩放不能小于全图；查看模式左键拖动平移
await page.keyboard.down('Control');
await page.mouse.wheel({ deltaY: 1400 });
await page.keyboard.up('Control');
await sleep(300);
const minZoom = await page.evaluate(() => window.__metro.scene.zoom);
await page.click('[data-tool="select"]');
await page.mouse.move(800, 500);
await page.keyboard.down('Control');
await page.mouse.wheel({ deltaY: -600 });
await page.keyboard.up('Control');
await sleep(300);
const panBefore = await page.evaluate(() => window.__metro.scene.panX);
await page.mouse.move(800, 500);
await page.mouse.down();
await page.mouse.move(930, 500, { steps: 8 });
await page.mouse.up();
await sleep(300);
const panAfter = await page.evaluate(() => window.__metro.scene.panX);
console.log('min zoom / pan', JSON.stringify({ minZoom, panBefore, panAfter }));

// 高峰提示不暂停
const peak = await page.evaluate(() => {
  const s = window.__metro.game.sim;
  s.settings.autoPause = true;
  s.autoPauseDone = { am: false, pm: false };
  s.time = 409;
  s.advanceMinutes(2);
  return { time: s.time, paused: s.paused, toast: document.querySelector('.toast')?.textContent };
});
console.log('peak', JSON.stringify(peak));
await sleep(500);
await page.screenshot({ path: `${OUT}/new-06-peak.png` });

console.log('errors', JSON.stringify(errors));
await browser.close();
