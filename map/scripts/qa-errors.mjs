import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'],
  defaultViewport: { width: 1200, height: 800 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message, e.stack));
page.on('console', (m) => console.log('CONSOLE', m.type(), m.text()));
page.on('response', (r) => {
  if (r.status() >= 400) console.log('HTTP', r.status(), r.url());
});
await page.goto('http://127.0.0.1:4174/', { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 2000));
for (const url of ['/src/poi.js', '/src/style.js', '/src/poiLayers.js', '/src/icons.js', '/src/main.js']) {
  const res = await page.evaluate(async (u) => {
    try {
      await import(u);
      return 'OK';
    } catch (e) {
      return `${e.name}: ${e.message}\n${e.stack}`;
    }
  }, url);
  console.log('IMPORT', url, res);
}
await browser.close();
