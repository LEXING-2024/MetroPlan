import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

/**
 * 《交通规划》实机演示片。
 *
 * 画面全部来自真实游戏：建站、画线、加车、快慢车、早高峰、车站面板、
 * 图层、票价、存档与日结算。没有使用旧截图，也没有把静态路网图当背景。
 * 为保护地点信息，矢量底图的 symbol 图层在录制期间持续隐藏；站名、
 * POI、片区名在进入画面前统一改成演示用的通用编号。
 */

const OUT = 'docs/video';
const FRAMES = '.artifacts/video-frames-gameplay';
const W = 1600;
const H = 900;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });

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
    '--autoplay-policy=no-user-gesture-required',
  ],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});

const page = await browser.newPage();
page.on('pageerror', (err) => console.error('[pageerror]', err.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('[console]', msg.text());
});

await page.goto('http://127.0.0.1:5173/', {
  waitUntil: 'networkidle0',
  timeout: 120000,
});
await page.waitForFunction(() => !!window.__metro, { timeout: 120000 });

// Start a real standard game and move it to the morning peak before the cameras roll.
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
  sim.setSpeed(4);
  sim.setPaused(true);
});

// Presentation layer. It is intentionally thin: the game underneath is untouched.
await page.evaluate(() => {
  const style = document.createElement('style');
  style.id = 'video-style';
  style.textContent = `
    #tutorial, #toasts, #fps-badge, #hover-label, #surge-bubble, #peak-tag { display: none !important; }
    #video-title, #video-end {
      position: fixed; inset: 0; z-index: 100010; pointer-events: none;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      background: radial-gradient(ellipse at 50% 40%, #111812 0%, #070a08 70%);
      color: #f2ecdf; opacity: 0; transition: opacity .5s ease;
    }
    #video-title.show, #video-end.show { opacity: 1; }
    #video-title .k, #video-end .k {
      font: 600 12px/1 "Microsoft YaHei", sans-serif; letter-spacing: .36em;
      color: #c58d72; text-transform: uppercase;
    }
    #video-title h1 {
      margin: 18px 0 0; font: 700 86px/1.05 "Microsoft YaHei", sans-serif;
      letter-spacing: .16em; font-weight: 700;
    }
    #video-title h1 em, #video-end h2 em { color: #d2644a; font-style: normal; }
    #video-title .sub {
      margin: 18px 0 0; font: 400 21px/1.6 "Microsoft YaHei", sans-serif;
      letter-spacing: .12em; color: #c9c2b4;
    }
    #video-title .note, #video-end .note {
      margin: 28px 0 0; font: 400 12px/1.6 "Microsoft YaHei", sans-serif;
      letter-spacing: .18em; color: #807968;
    }
    #video-title .line, #video-end .line {
      width: 46px; height: 1px; background: #6b3b30; margin-top: 26px;
    }
    #video-end { background: radial-gradient(ellipse at 50% 46%, #0e1510 0%, #060806 74%); }
    #video-end h2 {
      margin: 18px 0 0; font: 700 58px/1.15 "Microsoft YaHei", sans-serif;
      letter-spacing: .12em; text-align: center;
    }
    #video-end .sub {
      margin: 18px 0 0; font: 400 18px/1.7 "Microsoft YaHei", sans-serif;
      color: #b8b1a1; letter-spacing: .09em; text-align: center;
    }
    #video-end .stats {
      margin-top: 30px; display: flex; gap: 46px; align-items: flex-start;
    }
    #video-end .stats div { display: flex; flex-direction: column; align-items: center; gap: 6px; }
    #video-end .stats b { font: 700 27px/1 "Microsoft YaHei", sans-serif; color: #f2ecdf; }
    #video-end .stats span {
      font: 400 10px/1 "Microsoft YaHei", sans-serif; letter-spacing: .16em; color: #7f796a;
    }
    #video-end .ai {
      margin-top: 30px; font: 400 12px/1.6 "Microsoft YaHei", sans-serif;
      color: #9d9584; letter-spacing: .16em;
    }
    #video-caption {
      position: fixed; left: 40px; top: 84px;
      z-index: 100000; pointer-events: none; width: min(480px, calc(100vw - 80px));
      background: rgba(9, 13, 10, .87); color: #f2ecdf;
      border: 1px solid rgba(242, 236, 223, .12); border-left: 3px solid #c6543f;
      border-radius: 4px; padding: 12px 20px 13px;
      box-shadow: 0 10px 34px rgba(0, 0, 0, .32);
      opacity: 0; transform: translateY(-8px); transition: opacity .22s ease, transform .22s ease;
    }
    #video-caption.show { opacity: 1; transform: translateY(0); }
    #video-caption .ch {
      font: 600 10px/1.2 "Microsoft YaHei", sans-serif; letter-spacing: .22em;
      color: #c58d72; margin-bottom: 5px;
    }
    #video-caption .tx {
      font: 500 21px/1.55 "Microsoft YaHei", sans-serif; letter-spacing: .045em;
    }
    #video-cursor {
      position: fixed; left: 0; top: 0; width: 20px; height: 20px; z-index: 100002;
      pointer-events: none; transform: translate(-50%, -50%);
      border: 2px solid rgba(18, 25, 20, .92); border-radius: 50%;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, .65), 0 3px 12px rgba(0, 0, 0, .28);
      background: rgba(255, 255, 255, .12); transition: width .12s ease, height .12s ease, background .12s ease;
    }
    #video-cursor::after {
      content: ''; position: absolute; left: 50%; top: 50%; width: 3px; height: 3px;
      border-radius: 50%; background: rgba(18, 25, 20, .95); transform: translate(-50%, -50%);
    }
    #video-cursor.tap { width: 30px; height: 30px; background: rgba(198, 84, 63, .3); }
    #video-cursor.hidden { opacity: 0; }
  `;
  document.head.appendChild(style);
  document.getElementById('boot')?.remove();

  const title = document.createElement('div');
  title.id = 'video-title';
  title.innerHTML = `
    <div class="k">TRANSPORT PLAN · LIVE GAMEPLAY</div>
    <h1>交通<em>规划</em></h1>
    <p class="sub">落站成城 · 一次不可撤回的选择</p>
    <p class="note">AI 参与创作与实现 · 全片实机录制</p>
    <div class="line"></div>
  `;
  document.body.appendChild(title);

  const end = document.createElement('div');
  end.id = 'video-end';
  end.innerHTML = `
    <div class="k">TRANSPORT PLAN · SANDBOX</div>
    <h2>没有终点<br /><em>只有下一站</em></h2>
    <p class="sub">车站不能撤，城市会记住每一次落站。</p>
    <div class="stats">
      <div><b>10.3 万</b><span>出行个体</span></div>
      <div><b>7</b><span>行为群体</span></div>
      <div><b>18</b><span>人群画像</span></div>
      <div><b>4</b><span>出行方式</span></div>
    </div>
    <p class="ai">AI 参与创作与实现</p>
  `;
  document.body.appendChild(end);

  const cap = document.createElement('div');
  cap.id = 'video-caption';
  cap.innerHTML = '<div class="ch"></div><div class="tx"></div>';
  document.body.appendChild(cap);

  const cursor = document.createElement('div');
  cursor.id = 'video-cursor';
  cursor.classList.add('hidden');
  document.body.appendChild(cursor);

  window.addEventListener('mousemove', (ev) => {
    cursor.style.left = `${ev.clientX}px`;
    cursor.style.top = `${ev.clientY}px`;
  });
  window.addEventListener('pointerdown', () => cursor.classList.add('tap'));
  window.addEventListener('pointerup', () => window.setTimeout(() => cursor.classList.remove('tap'), 100));
});

// Hide every vector-basemap symbol layer (all baked place labels), and keep it hidden.
const hideMapLabels = async () => {
  await page.evaluate(() => {
    const map = window.__metro.basemap?.getMap();
    if (!map) return;
    try {
      for (const layer of map.getStyle()?.layers ?? []) {
        if (layer.type === 'symbol') {
          map.setLayoutProperty(layer.id, 'visibility', 'none');
        }
      }
    } catch {
      /* style may be mid-transition */
    }
  });
};
await hideMapLabels();
await page.evaluate(() => {
  const map = window.__metro.basemap?.getMap();
  map?.on('styledata', () => {
    for (const layer of map.getStyle()?.layers ?? []) {
      if (layer.type === 'symbol') map.setLayoutProperty(layer.id, 'visibility', 'none');
    }
  });
});
const labelGuard = setInterval(() => void hideMapLabels().catch(() => {}), 700);

async function caption(chapter, text) {
  await page.evaluate(
    ([ch, tx]) => {
      const el = document.getElementById('video-caption');
      if (!el) return;
      el.querySelector('.ch').textContent = ch;
      el.querySelector('.tx').textContent = tx;
      el.classList.add('show');
    },
    [chapter, text],
  );
}
async function hideCaption() {
  await page.evaluate(() => document.getElementById('video-caption')?.classList.remove('show'));
}
async function overlay(id, on) {
  await page.evaluate(([el, v]) => document.getElementById(el)?.classList.toggle('show', v), [id, on]);
}
async function showCursor(on) {
  await page.evaluate((v) => document.getElementById('video-cursor')?.classList.toggle('hidden', !v), on);
}
async function moveTo(x, y, steps = 14) {
  await page.mouse.move(x, y, { steps });
  await sleep(110);
}
async function clickAt(x, y) {
  await moveTo(x, y);
  await page.mouse.down();
  await sleep(80);
  await page.mouse.up();
  await sleep(160);
}
async function clickSel(sel) {
  const box = await page.$eval(sel, (el) => el.getBoundingClientRect().toJSON());
  await clickAt(box.x + box.width / 2, box.y + box.height / 2);
}
async function screenOf(x, y) {
  return page.evaluate(([wx, wy]) => window.__metro.scene.worldToScreen(wx, wy), [x, y]);
}
async function genericizeNetwork() {
  await page.evaluate(() => {
    const sim = window.__metro.game.sim;
    sim.net.stations.forEach((s, i) => {
      s.name = `节点 A${i + 1}`;
    });
    sim.pois.forEach((p, i) => {
      p.name = `目的地 ${String(i + 1).padStart(3, '0')}`;
    });
    sim.zones.forEach((z, i) => {
      z.name = `片区 ${String(i + 1).padStart(2, '0')}`;
    });
    const heading = document.querySelector('#station-panel h3');
    if (heading && sim.net.stations[0]) heading.textContent = sim.net.stations[0].name;
  });
}
async function centerCamera(wx, wy, zoom, targetX = 690, targetY = 450) {
  await page.evaluate(
    ([x, y, z, tx, ty]) => {
      const sc = window.__metro.scene;
      sc.resetCamera();
      const p = sc.worldToScreen(x, y);
      sc.zoomAt(p.x, p.y, z);
      const q = sc.worldToScreen(x, y);
      sc.panBy(tx - q.x, ty - q.y);
    },
    [wx, wy, zoom, targetX, targetY],
  );
  await sleep(420);
  await hideMapLabels();
}

const STATIONS = [
  [700, 1160],
  [760, 1120],
  [800, 1120],
  [840, 1100],
  [880, 1080],
  [920, 1080],
  [960, 1040],
  [1009, 993],
];

// Screencast starts on the title card.
await overlay('video-title', true);
await sleep(350);

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
  quality: 91,
  maxWidth: W,
  maxHeight: H,
  everyNthFrame: 1,
});

try {
  // 01 — Cover
  await sleep(2500);
  await overlay('video-title', false);
  await sleep(650);
  await showCursor(true);
  await page.mouse.move(800, 450);
  await sleep(500);

  // 02 — City overview, then push into the corridor.
  await caption('01 / 城市', '10 万+ 出行个体，每个人都有自己的家、岗位和一天的活动链。');
  await sleep(3400);
  await caption('01 / 城市', '先看人流：住宅、岗位、学校、商业，沿同一条城市走廊分布。');
  await sleep(1500);
  await centerCamera(850, 1080, 3.2);
  await sleep(2800);

  // 03 — Build the first station and read its coverage.
  await clickSel('[data-tool="station"]');
  await sleep(420);
  const first = await screenOf(...STATIONS[0]);
  await clickAt(first.x, first.y);
  await page.waitForSelector('#placement:not(.hidden)', { timeout: 5000 });
  await sleep(950);
  await caption('02 / 建站', '建站先读覆盖：核心 500 m、1 km 居民 / 岗位、POI 吸引。');
  await sleep(3000);
  await clickSel('[data-station-size="small"]');
  await sleep(650);
  await clickSel('[data-station-size="large"]');
  await sleep(850);
  await caption('02 / 建站', '站型决定容量与造价：60 / 100 / 250 人，大型站适合换乘。');
  await sleep(2700);
  await clickSel('#pv-confirm');
  await genericizeNetwork();
  // Do not hold the first station panel long enough to show its original name.
  await page.keyboard.press('Escape');
  await sleep(500);
  await caption('02 / 建站', '车站建成后永久保留，不能拆除——落站，就是不可撤回的决策。');
  await sleep(3000);

  // Remaining stations are real clicks too; the station panel closes between each.
  for (const [x, y] of STATIONS.slice(1)) {
    const p = await screenOf(x, y);
    await clickAt(p.x, p.y);
    await page.keyboard.press('Enter');
    await sleep(380);
    await page.keyboard.press('Escape');
    await sleep(180);
  }
  await sleep(350);
  await hideMapLabels();

  // Generic names only. The toast is hidden by CSS; panels are re-rendered later.
  await genericizeNetwork();
  await sleep(300);

  // 04 — Draw the line, show the draft, finish it.
  await caption('03 / 画线', '把站放在居住、就业、学校与商业的交汇处，先搭一条骨干线。');
  await sleep(2200);
  await clickSel('[data-tool="line"]');
  await sleep(420);
  for (const [x, y] of STATIONS) {
    const p = await screenOf(x, y);
    await clickAt(p.x, p.y);
    await sleep(150);
  }
  await sleep(500);
  await caption('03 / 画线', '画线：依次点击车站；线路可成环、延长，也可从中间站分支。');
  await sleep(2600);
  await page.keyboard.press('Enter');
  await page.waitForSelector('#line-panel:not(.hidden)', { timeout: 5000 });
  await sleep(850);
  await caption('03 / 画线', '线路有里程、站数、时速、单程时间与班距；先加车，把班距压下来。');
  await sleep(3200);

  // 05 — Add a local train, then an express with selected stops.
  await clickSel('#lp-add');
  await page.waitForSelector('#lp-menu:not(.hidden)', { timeout: 3000 });
  await clickSel('[data-buy="local"]');
  await sleep(750);
  await clickSel('#lp-add');
  await page.waitForSelector('#lp-menu:not(.hidden)', { timeout: 3000 });
  await clickSel('[data-buy="express"]');
  await page.waitForSelector('#express-panel:not(.hidden)', { timeout: 5000 });
  await sleep(500);
  await caption('04 / 运营', '慢车每站停，快车只停大站；同一条线可以混跑。');
  await sleep(2600);
  const expressBoxes = await page.$$eval('.express-row input[data-stop]', (els) =>
    els.map((el) => el.getBoundingClientRect().toJSON()),
  );
  // Keep both endpoints and a few major stops. Index-based so a skipped
  // placement cannot break the edit.
  for (const idx of [1, 3, 5, 6]) {
    const box = expressBoxes[idx];
    if (!box || idx >= expressBoxes.length - 1) continue;
    await moveTo(box.x + box.width / 2, box.y + box.height / 2);
    await page.evaluate((i) => {
      const input = document.querySelectorAll('.express-row input[data-stop]')[i];
      input?.click();
    }, idx);
    await sleep(300);
  }
  await sleep(600);
  await clickSel('#ep-save');
  await page.waitForSelector('#line-panel:not(.hidden)', { timeout: 5000 });
  await sleep(750);
  for (let i = 0; i < 3; i++) {
    await clickSel('#lp-add');
    await page.waitForSelector('#lp-menu:not(.hidden)', { timeout: 3000 });
    await clickSel('[data-buy="local"]');
    await sleep(650);
  }
  await caption('04 / 运营', '高峰前把运力放到走廊上，再看它怎么被真实客流验证。');
  await sleep(2100);

  // 06 — Let the real clock run through the morning peak.
  await page.evaluate(() => {
    const sim = window.__metro.game.sim;
    sim.advanceMinutes(620);
    sim.setSpeed(4);
    sim.setPaused(false);
  });
  await sleep(3400);
  await page.evaluate(() => window.__metro.game.sim.setPaused(true));
  await sleep(500);
  await caption('05 / 观察', '晚高峰：1x / 2x / 4x / 8x / 16x，车站与列车实时运行。');
  await sleep(2300);

  // 07 — Station panel at peak.
  const peakStation = await page.evaluate(() => {
    const sim = window.__metro.game.sim;
    const s = sim.net.stations[5] ?? sim.net.stations[0];
    return s ? { id: s.id, x: s.x, y: s.y } : null;
  });
  if (peakStation) {
    const p = await screenOf(peakStation.x, peakStation.y);
    await clickAt(p.x, p.y);
    await sleep(420);
    const hidden = await page.$eval('#station-panel', (el) => el.classList.contains('hidden'));
    if (hidden) {
      await page.evaluate((id) => {
        const sim = window.__metro.game.sim;
        const s = sim.net.stationById.get(id);
        if (s) window.__metro.game.selectStation(s);
      }, peakStation.id);
    }
    await page.waitForSelector('#station-panel:not(.hidden)', { timeout: 4000 });
    await moveTo(p.x, p.y);
    await caption('05 / 观察', '点车站：候车 / 容量、今日进出站、接驳线路、候车目的地。');
    await sleep(3200);
    await page.keyboard.press('Escape');
    await sleep(450);
  }

  // 08 — Layers.
  await clickSel('#btn-layers');
  await page.waitForSelector('#layer-popover:not(.hidden)', { timeout: 4000 });
  await caption('05 / 观察', '图层：实时热力、功能区、OD 流带、线路、站点。');
  await sleep(650);
  await clickSel('[data-layer-key="od"]');
  await sleep(250);
  await clickSel('[data-layer-key="zones"]');
  await sleep(2100);
  await clickSel('[data-layer-key="od"]');
  await sleep(220);
  await clickSel('[data-layer-key="zones"]');
  await sleep(350);
  await clickSel('#layer-close');
  await sleep(900);

  // 09 — Fare panel.
  await clickSel('[data-metric="fare"]');
  await page.waitForSelector('#fare-popover:not(.hidden)', { timeout: 4000 });
  await caption('06 / 经营', '票价：起步价、含公里、每段加价；票价也会反过来影响客流。');
  await sleep(800);
  await clickSel('[data-fare="base"][data-dir="1"]');
  await sleep(2400);
  await clickSel('#fare-close');
  await sleep(600);

  // 10 — Save modal.
  await clickSel('#btn-save');
  await page.waitForSelector('#overlay:not(.hidden)', { timeout: 5000 });
  await sleep(850);
  await caption('06 / 经营', '自动存档 + 三个手动槽位，也能导出 JSON 备份。');
  await sleep(2200);
  await clickSel('[data-slot="manual-1"][data-do="save"]');
  await sleep(850);
  await page.keyboard.press('Escape');
  await page.waitForSelector('#overlay.hidden', { timeout: 4000 });
  await sleep(600);

  // 11 — Daily settlement. Advance to 23:56, then cross midnight so the
  // settlement card is the completed day's record, not a partial new day.
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
  });
  await sleep(550);
  await hideMapLabels();
  // The settle event can fire while the screencast is catching up. Re-open the
  // actual last DayRecord so the card is guaranteed to be on screen for its beat.
  await page.evaluate(() => {
    const sim = window.__metro.game.sim;
    const record = sim.history[sim.history.length - 1];
    if (record) window.__metro.game.ui.dailyCard(record);
  });
  await sleep(250);
  await caption('06 / 经营', '每天 00:00 结算客流、票款、运营、净利与可靠性。');
  await sleep(2600);

  // 12 — End card.
  await hideCaption();
  await showCursor(false);
  await overlay('video-end', true);
  await sleep(3600);
} finally {
  clearInterval(labelGuard);
  await client.send('Page.stopScreencast').catch(() => {});
  await sleep(350);
  await browser.close();
}

if (frames === 0) {
  console.error('No frames captured');
  process.exit(1);
}

// Build a timestamp-accurate concat list. This keeps real pauses from becoming
// split-second cuts and avoids the variable-fps drift of a plain image sequence.
const t0 = times[0] ?? 0;
const MAX_FRAME_SECONDS = 0.14;
let prev = 0;
const concatFile = path.join(FRAMES, 'concat.txt');
const lines = [];
for (let i = 0; i < times.length; i++) {
  const raw = Math.max(0, (times[i] ?? 0) - t0);
  const at = Math.max(prev + 0.001, raw);
  const nextRaw = i + 1 < times.length ? Math.max(0, (times[i + 1] ?? 0) - t0) : at + 0.1;
  // If the page blocks (e.g. a long fast-forward), the screencast timestamp can
  // jump by minutes. Cap the gap so the edit becomes a quick time jump instead
  // of a multi-minute frozen frame.
  const next = Math.max(at + 0.005, Math.min(nextRaw, at + MAX_FRAME_SECONDS));
  lines.push(`file '${path.resolve(FRAMES, `${String(i).padStart(5, '0')}.jpg`).replace(/\\/g, '/')}'`);
  lines.push(`duration ${(next - at).toFixed(5)}`);
  prev = at;
}
lines.push(
  `file '${path.resolve(FRAMES, `${String(times.length - 1).padStart(5, '0')}.jpg`).replace(/\\/g, '/')}'`,
);
lines.push('duration 0.1');
fs.writeFileSync(concatFile, lines.join('\n'), 'utf8');

const outFile = path.resolve(OUT, '交通规划-实机演示.mp4');
const ffmpeg = process.env.FFMPEG ?? 'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe';
const result = spawnSync(
  ffmpeg,
  [
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concatFile,
    '-r',
    '30',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '19',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-an',
    outFile,
  ],
  { stdio: 'inherit' },
);
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(JSON.stringify({ frames, outFile, seconds: times.at(-1) - t0 }, null, 2));




