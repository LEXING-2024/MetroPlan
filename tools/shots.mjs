import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const OUT = 'docs/screenshots';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--hide-scrollbars'],
  defaultViewport: { width: 1920, height: 1080 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__metro);
await sleep(1000);
await page.screenshot({ path: `${OUT}/menu.png` });

await page.evaluate(() => {
  const g = window.__metro.game;
  g.newGame('standard');
  const sim = g.sim;
  sim.settings.autoPause = false;
  sim.settings.skipNight = false;

  const dense = (points, step = 26) => {
    const out = [];
    for (let i = 0; i < points.length - 1; i++) {
      const [ax, ay] = points[i];
      const [bx, by] = points[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
      for (let k = 0; k < n; k++) {
        out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
      }
    }
    out.push(points[points.length - 1]);
    return out;
  };

  const line1 = dense([
    [480, 1060],
    [700, 1125],
    [825, 1150],
    [940, 1085],
    [978, 948],
    [991, 812],
    [1205, 578],
    [1310, 432],
  ]);
  // 1 km 辐射下需要更密的站距，演示线网才会产生可见客流。
  sim.fund = 200000;
  const ids1 = line1.map(([x, y]) => sim.placeStation(x, y).station.id);
  const transfer = sim.net.stations.reduce((best, s) =>
    Math.hypot(s.x - 825, s.y - 1150) < Math.hypot(best.x - 825, best.y - 1150) ? s : best,
  );
  const line2 = dense([
    [690, 1270],
    [825, 1150],
    [765, 1040],
    [735, 982],
  ]);
  const ids2 = [];
  for (const [x, y] of line2) {
    if (Math.hypot(x - transfer.x, y - transfer.y) < 2) {
      if (!ids2.includes(transfer.id)) ids2.push(transfer.id);
      continue;
    }
    ids2.push(sim.placeStation(x, y).station.id);
  }
  const l1 = sim.createLine(ids1, 0).lineId;
  const l2 = sim.createLine(ids2, 1).lineId;
  sim.addTrain(l1);
  sim.addTrain(l1);
  sim.addTrain(l2);
  sim.addTrain(l2);
  sim.advanceMinutes(160);
});

// 等待开场提示淡出
await sleep(2600);
await page.screenshot({ path: `${OUT}/peak.png` });

const busy = await page.evaluate(() => {
  const sim = window.__metro.game.sim;
  return sim.net.stations
    .map((s) => ({ id: s.id, x: s.x, y: s.y, name: s.name, waiting: sim.waitingAt(s.id) }))
    .sort((a, b) => b.waiting - a.waiting)[0];
});
const point = await page.evaluate(({ x, y }) => window.__metro.scene.worldToScreen(x, y), busy);
await page.mouse.click(point.x, point.y);
await sleep(700);
await page.screenshot({ path: `${OUT}/station.png` });

// 线路面板：点击 1 号线两站中点
const linePoint = await page.evaluate(() => {
  const sim = window.__metro.game.sim;
  const line = sim.net.lines[0];
  const a = sim.net.stationById.get(line.stationIds[2]);
  const b = sim.net.stationById.get(line.stationIds[3]);
  return window.__metro.scene.worldToScreen((a.x + b.x) / 2, (a.y + b.y) / 2);
});
await page.mouse.click(linePoint.x, linePoint.y - 2);
await sleep(700);
await page.screenshot({ path: `${OUT}/line.png` });

// 结算
await page.evaluate(() => window.__metro.game.sim.advanceMinutes(960));
await sleep(500);
await page.screenshot({ path: `${OUT}/settle.png` });
const settle = await page.evaluate(() => {
  const s = window.__metro.game.sim;
  return {
    day: s.dayIndex(),
    last: s.history[s.history.length - 1],
    card: document.getElementById('daily-card')?.innerText,
  };
});
console.log('settle', JSON.stringify(settle));

// 新手教程
await page.evaluate(() => {
  const g = window.__metro.game;
  g.newGame('tutorial');
  const sim = g.sim;
  const a = sim.placeStation(700, 1125).station;
  const b = sim.placeStation(825, 1150).station;
  sim.createLine([a.id, b.id], 0);
  sim.setPaused(true);
});
await sleep(900);
await page.screenshot({ path: `${OUT}/tutorial.png` });

console.log('errors', JSON.stringify(errors));
await browser.close();
