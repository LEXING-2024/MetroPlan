import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const OUT = 'docs/video';
const FRAMES = '.artifacts/video-frames-game';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const darkMap = `data:image/png;base64,${fs
  .readFileSync('map/preview/latest-network-dark.png')
  .toString('base64')}`;

fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  protocolTimeout: 300000,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox', '--hide-scrollbars'],
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle0', timeout: 120000 });
await page.waitForFunction(() => !!window.__metro, { timeout: 120000 });
await sleep(1000);

// Skip the menu entirely: no product menu and no real place names in the video.
await page.evaluate(() => {
  window.__metro.game.newGame('standard');
  const sim = window.__metro.game.sim;
  sim.settings.autoPause = false;
  sim.settings.skipNight = false;
  sim.setPaused(true);
});
await sleep(800);

// Video-only presentation layer: original game background (labels hidden),
// plus a dedicated full-screen network shot, captions and title cards.
await page.evaluate((bg) => {
  const map = window.__metro.basemap?.getMap();
  const hideLabels = () => {
    try {
      for (const layer of map.getStyle()?.layers ?? []) {
        if (layer.type === 'symbol') map.setLayoutProperty(layer.id, 'visibility', 'none');
      }
    } catch {
      /* style may not be ready */
    }
  };
  if (map?.isStyleLoaded()) hideLabels();
  else map?.on('load', hideLabels);

  const style = document.createElement('style');
  style.id = 'video-style';
  style.textContent = `
    #tutorial, .tutorial { display: none !important; }
    #network-shot {
      position: fixed; inset: 0; z-index: 100000; background: #050806;
      opacity: 0; transition: opacity .3s ease; pointer-events: none;
    }
    #network-shot.show { opacity: 1; }
    #network-shot img { width: 100%; height: 100%; object-fit: cover; display: block; }
    #network-shot .cap {
      position: absolute; left: 50%; bottom: 38px; transform: translateX(-50%);
      background: rgba(7,10,8,.82); color: #f2ecdf; border: 1px solid rgba(242,236,223,.14);
      border-radius: 8px; padding: 12px 22px; font: 500 20px/1.5 "Microsoft YaHei", sans-serif;
      letter-spacing: .05em; text-align: center;
    }
    #network-shot .cap small { display:block; margin-top:4px; font-size:12px; color:#bab4a4; letter-spacing:.1em; }
    #video-caption { position: fixed; left: 50%; bottom: 38px; transform: translateX(-50%); z-index: 100000; pointer-events: none; max-width: 920px; background: rgba(7,10,8,.82); color: #f2ecdf; border: 1px solid rgba(242,236,223,.14); border-radius: 8px; padding: 12px 22px; font: 500 21px/1.45 "Microsoft YaHei", sans-serif; letter-spacing: .05em; text-align: center; box-shadow: 0 8px 28px rgba(0,0,0,.3); opacity: 0; transition: opacity .3s ease; }
    #video-caption small { display: block; margin-top: 4px; font-size: 12px; font-weight: 400; color: #bab4a4; letter-spacing: .1em; }
    #video-caption.show { opacity: 1; }
    #video-title, #video-end { position: fixed; inset: 0; z-index: 100001; pointer-events: none; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #080b09; color: #f2ecdf; opacity: 0; transition: opacity .35s ease; }
    #video-title.show, #video-end.show { opacity: 1; }
    #video-title .k, #video-end .k { font: 500 12px/1 "Microsoft YaHei", sans-serif; letter-spacing: .3em; color: #c58d72; }
    #video-title h2, #video-end h2 { margin: 18px 0 0; font: 700 82px/1.1 "Microsoft YaHei", sans-serif; letter-spacing: .12em; }
    #video-title h2 em { color: #d2644a; font-style: normal; }
    #video-title p, #video-end p { margin: 22px 0 0; font: 400 20px/1.7 "Microsoft YaHei", sans-serif; color: #aaa493; letter-spacing: .1em; }
    #video-end .stats { margin-top: 34px; display: flex; gap: 46px; }
    #video-end .stats div { display: flex; flex-direction: column; align-items: center; gap: 5px; }
    #video-end .stats b { font: 700 30px/1 "Microsoft YaHei", sans-serif; color: #f2ecdf; }
    #video-end .stats span { font: 400 11px/1 "Microsoft YaHei", sans-serif; letter-spacing: .14em; color: #8d8778; }
  `;
  document.head.appendChild(style);
  document.getElementById('boot')?.remove();
  const shot = document.createElement('div');
  shot.id = 'network-shot';
  shot.innerHTML = `<img src="${bg}" alt="" /><div class="cap">当前路网 <small>55,706 节点 · 65,796 边 · 步行 / 骑行 / 机动车分层</small></div>`;
  document.body.appendChild(shot);
  const title = document.createElement('div');
  title.id = 'video-title';
  title.innerHTML = `<div class="k">TRANSPORT PLAN · 0.9.2</div><h2>交通<em>规划</em></h2><p>一张网，一座城：10 万+ agent 的出行实验</p>`;
  document.body.appendChild(title);
  const end = document.createElement('div');
  end.id = 'video-end';
  end.innerHTML = `<div class="k">TRANSPORT PLAN · SANDBOX</div><h2>没有终点</h2><p>修一张覆盖真实出行、长期盈利的网</p><div class="stats"><div><b>10.2 万</b><span>AGENTS</span></div><div><b>7</b><span>行为群体</span></div><div><b>18</b><span>人群画像</span></div><div><b>4</b><span>出行方式</span></div></div>`;
  document.body.appendChild(end);
  const cap = document.createElement('div');
  cap.id = 'video-caption';
  document.body.appendChild(cap);
}, darkMap);

async function caption(text, small = '') {
  await page.evaluate(([t, s]) => {
    const el = document.getElementById('video-caption');
    if (!el) return;
    el.innerHTML = `${t}${s ? `<small>${s}</small>` : ''}`;
    el.classList.add('show');
  }, [text, small]);
}
async function hideCaption() {
  await page.evaluate(() => document.getElementById('video-caption')?.classList.remove('show'));
}
async function overlay(id, on) {
  await page.evaluate(([el, v]) => document.getElementById(el)?.classList.toggle('show', v), [id, on]);
}
async function screenOf(x, y) {
  return page.evaluate(([wx, wy]) => window.__metro.scene.worldToScreen(wx, wy), [x, y]);
}

const client = await page.createCDPSession();
let frames = 0;
const times = [];
client.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
  fs.writeFileSync(`${FRAMES}/${String(frames).padStart(5, '0')}.jpg`, Buffer.from(data, 'base64'));
  times.push(Number(metadata?.timestamp ?? Date.now() / 1000));
  frames++;
  client.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});
await client.send('Page.startScreencast', {
  format: 'jpeg',
  quality: 90,
  maxWidth: 1600,
  maxHeight: 900,
  everyNthFrame: 1,
});

// 1. Cover
await overlay('video-title', true);
await sleep(2200);`nawait overlay('video-title', false);
await sleep(300);
await overlay('network-shot', true);
await sleep(2800);
await overlay('network-shot', false);
await sleep(350);

// 2. Actual game, original map background with labels hidden.
await page.evaluate(() => {
  const sim = window.__metro.game.sim;
  sim.fund = 200000;
  sim.setPaused(true);
});
await sleep(700);
await caption('先选位置，再放站', '车站建成永久保留 · 选站型：小型 / 标准 / 大型');
await sleep(1800);

const pts = [
  [700, 1125],
  [825, 1150],
  [940, 1085],
  [978, 948],
  [991, 812],
];
for (const [x, y] of pts) {
  await page.evaluate(([wx, wy]) => window.__metro.game.sim.placeStation(wx, wy), [x, y]);
  await sleep(320);
}
await page.evaluate(() => {
  const g = window.__metro.game;
  const sim = g.sim;
  const ids = sim.net.stations.map((s) => s.id);
  const line = sim.createLine(ids, 0);
  if (line.ok) sim.addTrain(line.lineId);
  // All names used by the real UI are made generic for the video.
  sim.net.stations.forEach((s, i) => { s.name = `节点 A${i + 1}`; });
  sim.pois.forEach((p, i) => { p.name = `目的地 ${String(i + 1).padStart(3, '0')}`; });
  sim.zones.forEach((z, i) => { z.name = `片区 ${String(i + 1).padStart(2, '0')}`; });
  window.__metro.scene.resetCamera();
  sim.setPaused(false);
});
await sleep(1200);
await caption('画线 → 加车', '线路可延长、分支、成环；列车有容量与班距');
await sleep(1900);

// 3. Morning peak, actual simulation.
await page.evaluate(() => {
  const sim = window.__metro.game.sim;
  sim.advanceMinutes(90);
  sim.setSpeed(2);
});
await sleep(3200);
await caption('07:30 早高峰', '热力沿走廊亮起；实际列车与乘客在跑');
await sleep(2200);

// 4. Real station panel.
const busy = await page.evaluate(() => {
  const sim = window.__metro.game.sim;
  const s = [...sim.net.stations].sort((a, b) => sim.waitingAt(b.id) - sim.waitingAt(a.id))[0];
  return s ? window.__metro.scene.worldToScreen(s.x, s.y) : null;
});
if (busy) {
  await page.mouse.click(busy.x, busy.y);
  await sleep(750);
  await caption('点车站：候车 / 容量 / 目的地', '等车人数、今日进出站与线路接入，一屏看清');
  await sleep(2300);
  await page.keyboard.press('Escape');
  await sleep(450);
}

// 5. Real line panel.
const linePoint = await page.evaluate(() => {
  const sim = window.__metro.game.sim;
  const line = sim.net.lines[0];
  const a = sim.net.stationById.get(line.stationIds[1]);
  const b = sim.net.stationById.get(line.stationIds[2]);
  return window.__metro.scene.worldToScreen((a.x + b.x) / 2, (a.y + b.y) / 2);
});
await page.mouse.click(linePoint.x, linePoint.y);
await sleep(700);
await caption('点线路：加车 / 延长 / 分支', '运营时段、班距、列车数都能调；票价按里程分段');
await sleep(2400);
await page.keyboard.press('Escape');
await sleep(450);

// 6. Economy + end
await caption('每天 00:00 结算票款与运营', '客流 · 票款 · 成本 · 净利 · 可靠性');
await sleep(2300);
await hideCaption();
await page.evaluate(() => window.__metro.game.sim.setPaused(true));
await overlay('video-end', true);
await sleep(2600);

await client.send('Page.stopScreencast').catch(() => {});
await sleep(300);
await browser.close();

if (frames === 0) {
  console.error('No frames captured');
  process.exit(1);
}
const t0 = times[0] ?? 0;
const norm = times.map((t) => Math.max(0, t - t0));
const concatFile = path.join(FRAMES, 'concat.txt');
const lines = [];
for (let i = 0; i < norm.length; i++) {
  const next = norm[i + 1] ?? norm[i] + 0.1;
  lines.push(`file '${path.resolve(FRAMES, `${String(i).padStart(5, '0')}.jpg`).replace(/\\/g, '/')}'`);
  lines.push(`duration ${Math.max(0.005, next - norm[i]).toFixed(5)}`);
}
lines.push(`file '${path.resolve(FRAMES, `${String(norm.length - 1).padStart(5, '0')}.jpg`).replace(/\\/g, '/')}'`);
lines.push('duration 0.1');
fs.writeFileSync(concatFile, lines.join('\n'), 'utf8');

const outFile = path.resolve(OUT, '交通规划-一张网一座城.mp4');
const ffmpeg = process.env.FFMPEG ?? 'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe';
const result = spawnSync(
  ffmpeg,
  ['-y', '-f', 'concat', '-safe', '0', '-i', concatFile, '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outFile],
  { stdio: 'inherit' },
);
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(JSON.stringify({ frames, outFile }, null, 2));

