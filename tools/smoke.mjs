import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const OUT = '.artifacts';
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logs = [];

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  protocolTimeout: 240000,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
  ],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
});

const page = await browser.newPage();
page.on('console', (m) => logs.push(`[console:${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));
page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle0', timeout: 90000 });
await page.waitForFunction(() => !!window.__metro, { timeout: 90000 });
await sleep(1200);
await page.screenshot({ path: `${OUT}/01-menu.png` });
console.log('menu shot OK');

// 新游戏 → 标准局 → 开始
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('[data-act="new"]')][0];
  btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await sleep(400);
await page.screenshot({ path: `${OUT}/02-newgame.png` });
await page.evaluate(() => {
  const btn = document.querySelector('[data-do="map-start"]');
  btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await sleep(900);
await page.screenshot({ path: `${OUT}/03-game-start.png` });

const state = await page.evaluate(() => {
  const g = window.__metro.game;
  return {
    simTime: g.sim.time,
    paused: g.sim.paused,
    stations: g.sim.net.stations.length,
    fund: g.sim.fund,
    activeTool: document.querySelector('[data-tool].active')?.dataset.tool,
  };
});
console.log('after start', JSON.stringify(state));

// 放站：3 个点
const points = [
  [700, 1125],
  [825, 1150],
  [940, 1085],
];

async function screenOf(x, y) {
  return page.evaluate(
    ([wx, wy]) => {
      const scene = window.__metro.scene;
      return scene.worldToScreen(wx, wy);
    },
    [x, y],
  );
}

await page.click('[data-tool="station"]');
for (const [x, y] of points) {
  const p = await screenOf(x, y);
  await page.mouse.click(p.x, p.y);
  await sleep(250);
  const visible = await page.evaluate(() => !document.getElementById('placement')?.classList.contains('hidden'));
  console.log('placement visible', visible, x, y);
  if (!visible) continue;
  await page.screenshot({ path: `${OUT}/04-placement.png` });
  await page.click('#pv-confirm');
  await sleep(300);
}
console.log(
  'after stations',
  JSON.stringify(
    await page.evaluate(() => ({
      stations: window.__metro.game.sim.net.stations.length,
      fund: window.__metro.game.sim.fund,
    })),
  ),
);

// 画线连接 3 个车站
await page.click('[data-tool="line"]');
for (const [x, y] of points) {
  const p = await screenOf(x, y);
  await page.mouse.click(p.x, p.y);
  await sleep(200);
}
await page.screenshot({ path: `${OUT}/05-draft.png` });
await page.click('#draft-finish');
await sleep(600);
await page.screenshot({ path: `${OUT}/06-line.png` });
console.log(
  'after line',
  JSON.stringify(
    await page.evaluate(() => ({
      lines: window.__metro.game.sim.net.lines.length,
      trains: window.__metro.game.sim.net.trains.length,
      fund: window.__metro.game.sim.fund,
      cost: window.__metro.game.sim.todayCost(),
    })),
  ),
);

// 推进到早高峰
await page.evaluate(() => window.__metro.game.sim.advanceMinutes(125));
await sleep(900);
await page.screenshot({ path: `${OUT}/07-morning-peak.png` });
console.log(
  'morning',
  JSON.stringify(
    await page.evaluate(() => {
      const s = window.__metro.game.sim;
      return {
        time: s.time,
        ridership: s.stats.ridership,
        delivered: s.stats.delivered,
        unserved: s.stats.unserved,
        waiting: s.net.stations.map((st) => s.waitingAt(st.id)),
      };
    }),
  ),
);

// 点开车站卡片
const stationScreen = await screenOf(825, 1150);
await page.mouse.click(stationScreen.x, stationScreen.y);
await sleep(500);
await page.screenshot({ path: `${OUT}/08-station-card.png` });
console.log(
  'station card',
  JSON.stringify(
    await page.evaluate(() => ({
      visible: !document.getElementById('station-panel')?.classList.contains('hidden'),
      text: document.getElementById('station-panel')?.innerText.slice(0, 120),
    })),
  ),
);

// 点开线路面板（两站中点）
const p1 = await screenOf(700, 1125);
const p2 = await screenOf(825, 1150);
await page.mouse.click((p1.x + p2.x) / 2, (p1.y + p2.y) / 2 - 3);
await sleep(500);
await page.screenshot({ path: `${OUT}/09-line-panel.png` });
console.log(
  'line panel',
  JSON.stringify(
    await page.evaluate(() => ({
      visible: !document.getElementById('line-panel')?.classList.contains('hidden'),
      text: document.getElementById('line-panel')?.innerText.slice(0, 160),
    })),
  ),
);

// 加车
const addBtn = await page.$('#lp-add');
if (addBtn) {
  await addBtn.click();
  await sleep(500);
}
await page.screenshot({ path: `${OUT}/10-add-train.png` });

// 结算卡片
await page.evaluate(() => {
  window.__metro.game.sim.settings.autoPause = false;
  window.__metro.game.sim.advanceMinutes(1000);
});
await sleep(350);
await page.screenshot({ path: `${OUT}/11-daily-card.png` });
console.log(
  'settlement',
  JSON.stringify(
    await page.evaluate(() => {
      const s = window.__metro.game.sim;
      return {
        time: s.time,
        day: s.dayIndex(),
        history: s.history.length,
        fund: s.fund,
        last: s.history[s.history.length - 1],
        cardShown: !document.getElementById('daily-card')?.classList.contains('hidden'),
        card: document.getElementById('daily-card')?.innerText,
      };
    }),
  ),
);
await sleep(2800);

// 设置面板
await page.click('#btn-settings');
await sleep(400);
await page.screenshot({ path: `${OUT}/12-settings.png` });
await page.evaluate(() => document.querySelector('[data-do="close"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
await sleep(300);

// 存档面板
await page.click('#btn-save');
await sleep(700);
await page.screenshot({ path: `${OUT}/13-save.png` });
const saveInfo = await page.evaluate(() => ({
  text: document.querySelector('.modal')?.innerText.slice(0, 400),
  autoExists: [...document.querySelectorAll('.slot')].some((s) => s.innerText.includes('自动存档')),
}));
console.log('save modal', JSON.stringify(saveInfo));

// 保存到槽位 1
await page.evaluate(() => document.querySelector('[data-slot="manual-1"][data-do="save"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
await sleep(900);
await page.screenshot({ path: `${OUT}/14-saved.png` });
console.log(
  'after manual save',
  JSON.stringify(
    await page.evaluate(() => ({
      text: document.querySelector('.modal')?.innerText.slice(0, 500),
      toast: document.querySelector('.toast')?.textContent,
    })),
  ),
);

// 关闭弹窗，切到夜间看列车与热力
await page.evaluate(() => document.querySelector('[data-do="close"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
await page.evaluate(() => window.__metro.game.sim.advanceMinutes(480));
await sleep(600);
await page.screenshot({ path: `${OUT}/15-evening.png` });

// 点击组团看 OD 摘要（矢量底图下旧组团层默认关闭，测试时显式打开）
await page.evaluate(() => window.__metro.game.ui.setLayer('zones', true));
await sleep(250);
const zonePoint = await page.evaluate(() => {
  const sim = window.__metro.game.sim;
  const zone = sim.zones.find((z) => z.kind === 'residential' && z.dots > 0);
  return zone ? window.__metro.scene.worldToScreen(zone.x, zone.y) : null;
});
if (zonePoint) await page.mouse.click(zonePoint.x, zonePoint.y);
await sleep(400);
await page.screenshot({ path: `${OUT}/16-zone-od.png` });
console.log(
  'zone popup',
  JSON.stringify(
    await page.evaluate(() => ({
      visible: !document.getElementById('zone-popup')?.classList.contains('hidden'),
      text: document.getElementById('zone-popup')?.innerText.slice(0, 160),
    })),
  ),
);

// 回到存档面板，读取 manual-1
await page.click('#btn-save');
await sleep(600);
await page.evaluate(() => document.querySelector('[data-slot="manual-1"][data-do="load"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
await sleep(1000);
console.log(
  'after load',
  JSON.stringify(
    await page.evaluate(() => {
      const s = window.__metro.game.sim;
      return { time: s.time, day: s.dayIndex(), fund: s.fund, stations: s.net.stations.length, lines: s.net.lines.length, paused: s.paused };
    }),
  ),
);
await page.screenshot({ path: `${OUT}/17-loaded.png` });

// 性能采样
const perf = await page.evaluate(async () => {
  let frames = 0;
  const start = performance.now();
  await new Promise((resolve) => {
    const loop = () => {
      frames++;
      if (performance.now() - start > 2000) resolve();
      else requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  return { fps: Math.round((frames / (performance.now() - start)) * 1000) };
});
console.log('fps', JSON.stringify(perf));

console.log('--- LOGS ---');
for (const line of logs) console.log(line);

await browser.close();
