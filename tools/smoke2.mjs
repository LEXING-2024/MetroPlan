import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const OUT = '.artifacts';
const DL = path.resolve(OUT, 'downloads');
fs.mkdirSync(DL, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logs = [];

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox', '--hide-scrollbars'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') logs.push(`[console:error] ${m.text()}`);
});
const client = await page.createCDPSession();
await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__metro);
await sleep(800);

const screenOf = (x, y) =>
  page.evaluate(([wx, wy]) => window.__metro.scene.worldToScreen(wx, wy), [x, y]);

// 新手局
await page.evaluate(() => document.querySelector('[data-act="new"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
await sleep(300);
await page.evaluate(() => document.querySelector('[data-mode="tutorial"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
await sleep(200);
await page.screenshot({ path: `${OUT}/20-newgame-tutorial.png` });
await page.evaluate(() => document.querySelector('[data-do="start"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
await sleep(800);
const tut1 = await page.evaluate(() => ({
  paused: window.__metro.game.sim.paused,
  tutorial: document.getElementById('tutorial')?.innerText,
}));
console.log('tutorial start', JSON.stringify(tut1));
await page.screenshot({ path: `${OUT}/21-tutorial-hint.png` });

// 放第一个站
await page.click('[data-tool="station"]');
let p = await screenOf(700, 1125);
await page.mouse.click(p.x, p.y);
await sleep(300);
await page.click('#pv-confirm');
await sleep(400);
const afterOne = await page.evaluate(() => ({
  stations: window.__metro.game.sim.net.stations.length,
  fund: window.__metro.game.sim.fund,
  undoVisible: (() => {
    const b = document.getElementById('btn-undo');
    return b ? !b.classList.contains('hidden') : false;
  })(),
  tutorial: document.getElementById('tutorial')?.innerText,
}));
console.log('after one station', JSON.stringify(afterOne));
await page.screenshot({ path: `${OUT}/22-tutorial-one.png` });

// 撤回
await page.click('#btn-undo');
await sleep(500);
const afterUndo = await page.evaluate(() => ({
  stations: window.__metro.game.sim.net.stations.length,
  fund: window.__metro.game.sim.fund,
  used: window.__metro.game.sim.tutorial.undoUsed,
}));
console.log('after undo', JSON.stringify(afterUndo));

// 重新放两个站
for (const [x, y] of [
  [700, 1125],
  [825, 1150],
]) {
  p = await screenOf(x, y);
  await page.mouse.click(p.x, p.y);
  await sleep(250);
  await page.click('#pv-confirm');
  await sleep(300);
}
// 画线
await page.click('[data-tool="line"]');
for (const [x, y] of [
  [700, 1125],
  [825, 1150],
]) {
  p = await screenOf(x, y);
  await page.mouse.click(p.x, p.y);
  await sleep(200);
}
await page.click('#draft-finish');
await sleep(500);
const tut4 = await page.evaluate(() => ({
  lines: window.__metro.game.sim.net.lines.length,
  tutorial: document.getElementById('tutorial')?.innerText,
  paused: window.__metro.game.sim.paused,
}));
console.log('tutorial step4', JSON.stringify(tut4));
await page.screenshot({ path: `${OUT}/23-tutorial-step4.png` });

// 空格开始
await page.keyboard.press('Space');
await sleep(300);
console.log(
  'after space',
  JSON.stringify(await page.evaluate(() => ({ paused: window.__metro.game.sim.paused, speed: window.__metro.game.sim.currentSpeed() }))),
);

// 进入早高峰
await page.evaluate(() => window.__metro.game.sim.advanceMinutes(130));
await sleep(600);
await page.screenshot({ path: `${OUT}/24-tutorial-peak.png` });

// 群体筛选：关闭通勤
await page.evaluate(() => document.querySelector('[data-group="0"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
await sleep(500);
const filterState = await page.evaluate(() => ({
  filter: window.__metro.game.ui.getGroupFilter(),
  cls: document.querySelector('[data-group="0"]')?.className,
}));
console.log('filter', JSON.stringify(filterState));
await page.screenshot({ path: `${OUT}/25-filter-commuter-off.png` });
await page.evaluate(() => document.querySelector('[data-group="0"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
await sleep(300);

// 设置：切换夜间跳过
await page.click('#btn-settings');
await sleep(400);
await page.screenshot({ path: `${OUT}/26-settings.png` });
const before = await page.evaluate(() => window.__metro.game.sim.settings.skipNight);
await page.evaluate(() => document.querySelector('[data-key="skipNight"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
await sleep(300);
const after = await page.evaluate(() => window.__metro.game.sim.settings.skipNight);
console.log('skipNight toggle', before, '->', after);
// 返回主菜单（确认）
await page.evaluate(() => document.querySelector('[data-do="menu"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
await sleep(400);
await page.screenshot({ path: `${OUT}/27-confirm-menu.png` });
await page.evaluate(() => document.querySelector('[data-do="confirm"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
await sleep(800);
const menuState = await page.evaluate(() => ({
  menu: !document.getElementById('overlay')?.classList.contains('hidden'),
  continueText: document.querySelector('[data-act="continue"]')?.innerText,
}));
console.log('back to menu', JSON.stringify(menuState));
await page.screenshot({ path: `${OUT}/28-menu-return.png` });

// 继续当前进度
await page.evaluate(() => document.querySelector('[data-act="continue"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
await sleep(700);
console.log(
  'resumed',
  JSON.stringify(
    await page.evaluate(() => ({
      menu: !document.getElementById('overlay')?.classList.contains('hidden'),
      stations: window.__metro.game.sim.net.stations.length,
      paused: window.__metro.game.sim.paused,
    })),
  ),
);

// 导出
await page.click('#btn-save');
await sleep(500);
await page.evaluate(() => document.querySelector('[data-do="export"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
await sleep(1200);
const files = fs.readdirSync(DL).filter((f) => f.endsWith('.json'));
console.log('exported files', JSON.stringify(files));
const exported = files.length ? path.join(DL, files[files.length - 1]) : null;
if (exported) {
  const raw = JSON.parse(fs.readFileSync(exported, 'utf8'));
  console.log('export meta', JSON.stringify(raw.meta), 'agents', raw.data?.agents?.c, 'version', raw.saveVersion);
  const input = await page.$('#file-import');
  await input.uploadFile(exported);
  await sleep(600);
  await page.evaluate(() => document.querySelector('[data-do="confirm"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await sleep(1200);
  console.log(
    'imported',
    JSON.stringify(
      await page.evaluate(() => ({
        toast: document.querySelector('.toast')?.textContent,
        stations: window.__metro.game.sim.net.stations.length,
        menu: !document.getElementById('overlay')?.classList.contains('hidden'),
      })),
    ),
  );
  await page.screenshot({ path: `${OUT}/29-imported.png` });
}

console.log('--- LOGS ---');
for (const line of logs) console.log(line);
await browser.close();
