import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--hide-scrollbars'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));
await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 90000 });
await page.waitForFunction(() => !!window.__metro, { timeout: 60000 });
await sleep(800);
console.log('title', await page.title());
console.log('menu', await page.evaluate(() => document.querySelector('.menu h1')?.textContent));
await page.evaluate(() => {
  const g = window.__metro.game;
  g.newGame('standard');
  const sim = g.sim;
  const a = sim.placeStation(700, 1125).station.id;
  const b = sim.placeStation(825, 1150).station.id;
  sim.createLine([a, b], 0);
  sim.settings.autoPause = false;
  sim.advanceMinutes(150);
});
await sleep(600);
console.log(
  'state',
  await page.evaluate(() => {
    const s = window.__metro.game.sim;
    return { time: s.time, stations: s.net.stations.length, lines: s.net.lines.length, ridership: s.stats.ridership, fund: s.fund };
  }),
);
const perf = await page.evaluate(async () => {
  let frames = 0;
  const start = performance.now();
  while (performance.now() - start < 1500) {
    await new Promise((r) => requestAnimationFrame(r));
    frames++;
  }
  return Math.round((frames / (performance.now() - start)) * 1000);
});
console.log('fps', perf);
await page.screenshot({ path: '.artifacts/preview-build.png' });

// 验证生产构建里也能打开创作模式
await page.evaluate(async () => {
  await window.__metro.game.openEditor();
});
await sleep(900);
console.log(
  'editor',
  JSON.stringify(
    await page.evaluate(() => ({
      active: window.__metro.game.editor.isActive(),
      root: !document.getElementById('editor-ui')?.classList.contains('hidden'),
      toolbar: document.querySelectorAll('#editor-ui [data-tool]').length,
    })),
  ),
);
await page.screenshot({ path: '.artifacts/preview-editor.png' });
console.log('errors', JSON.stringify(errors));
await browser.close();
