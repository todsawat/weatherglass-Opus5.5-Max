// Usage: node tools/run.cjs path/to/script.cjs ["<query>"] [width] [height]
// Runs the page LIVE (real frame loop, not paused) and hands your script a Playwright page so you can move the mouse, press keys, wait and screenshot.
// Your script: module.exports = async (page, h) => { await h.ready(); await page.mouse.move(400, 200); ...; await page.screenshot({ path: 'shots/x.png' }); return await page.evaluate(() => WG.state.phrase); }
// Software rendering here is slow (a few frames per second) — keep viewports small (e.g. 800x500) and add &q=0 unless you need more detail.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const [script, query = 'q=0', w = '800', h = '500'] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1, hasTouch: /touch=1/.test(query) });
  const logs = [];
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || /\[WG\]/.test(t)) logs.push(m.type() + ': ' + t.slice(0, 1500)); });
  page.on('pageerror', (e) => logs.push('PAGEERROR: ' + String(e.stack || e).slice(0, 1500)));

  await page.goto('file://' + path.resolve(__dirname, '../index.html') + (query ? '?' + query : ''));
  const helpers = {
    ready: () => page.waitForFunction(() => window.WG && window.WG.ready, null, { timeout: 240000 }),
    sleep: (ms) => page.waitForTimeout(ms),
    state: (expr) => page.evaluate(expr),
  };
  let out;
  try { out = await require(path.resolve(script))(page, helpers); } catch (e) { logs.push('SCRIPT ERROR: ' + String(e.stack || e)); }
  if (out !== undefined) console.log(JSON.stringify(out));
  const errs = await page.evaluate(() => (window.WG ? window.WG.errors : ['no WG']));
  if (errs.length) console.log('WG.errors:', JSON.stringify(errs));
  if (logs.length) console.log(logs.slice(0, 30).join('\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
