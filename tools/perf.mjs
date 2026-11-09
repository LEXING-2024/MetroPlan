import puppeteer from 'puppeteer-core';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mode = process.argv[2] ?? 'gpu';
const args =
  mode === 'gpu'
    ? ['--no-sandbox', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--hide-scrollbars']
    : ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--hide-scrollbars'];

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args,
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle0', timeout: 90000 });
await page.waitForFunction(() => !!window.__metro, { timeout: 90000 });

const gl = await page.evaluate(() => {
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!ctx) return { webgl: false };
  const dbg = ctx.getExtension('WEBGL_debug_renderer_info');
  return {
    webgl: true,
    version: ctx.getParameter(ctx.VERSION),
    vendor: dbg ? ctx.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : 'n/a',
    renderer: dbg ? ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'n/a',
  };
});
console.log('GL', JSON.stringify(gl));

// 建一个稍大的网络
await page.evaluate(() => {
  const g = window.__metro.game;
  g.newGame('standard');
  const sim = g.sim;
  const pts = [
    [480, 1060],
    [700, 1125],
    [825, 1150],
    [940, 1085],
    [991, 812],
    [1205, 578],
    [1310, 432],
  ];
  const ids = [];
  for (const [x, y] of pts) ids.push(sim.placeStation(x, y).station.id);
  const lineId = sim.createLine(ids, 1).lineId;
  sim.addTrain(lineId);
  sim.addTrain(lineId);
  sim.settings.autoPause = false;
  sim.advanceMinutes(125);
});
await sleep(1200);

const perf = await page.evaluate(async () => {
  let frames = 0;
  const start = performance.now();
  while (performance.now() - start < 2500) {
    await new Promise((r) => requestAnimationFrame(r));
    frames++;
  }
  const elapsed = performance.now() - start;
  return { fps: Math.round((frames / elapsed) * 1000), frames, elapsed: Math.round(elapsed) };
});
console.log('PERF', JSON.stringify(perf));
await page.screenshot({ path: `.artifacts/perf-${mode}.png` });

const stats = await page.evaluate(() => {
  const s = window.__metro.game.sim;
  return {
    stations: s.net.stations.length,
    waiting: s.net.stations.map((st) => s.waitingAt(st.id)),
    ridership: s.stats.ridership,
    fps: 0,
  };
});
console.log('STATE', JSON.stringify(stats));
await browser.close();
