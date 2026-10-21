// Usage: node tools/multi.cjs "<query>" WxH out-prefix "name::js" ["name::js" ...]
// Loads once (paused), then for each view runs js, draws a frame and saves out-prefix-name.png
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const [query, size, prefix, ...views] = process.argv.slice(2);
  const [w, h] = size.split('x').map(Number);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text().slice(0, 600)); });
  page.on('pageerror', (e) => logs.push('PAGEERROR ' + String(e).slice(0, 600)));

  await page.goto('file://' + path.resolve(__dirname, '../index.html') + '?paused=1&tour=0&' + query);
  await page.waitForFunction(() => window.WG && window.WG.ready, null, { timeout: 240000 });
  for (const v of views) {
    const i = v.indexOf('::'), name = v.slice(0, i), js = v.slice(i + 2);
    const r = await page.evaluate(async (js) => { let out; try { out = await (0, eval)(js); WG.debug.frame(); } catch (e) { out = 'ERR ' + e; } return out; }, js);
    await page.screenshot({ path: `${prefix}-${name}.png`, timeout: 180000 });
    console.log(name, r === undefined ? '' : JSON.stringify(r));
  }
  const errs = await page.evaluate(() => WG.errors);
  if (errs.length) console.log('WG.errors', JSON.stringify(errs));
  if (logs.length) console.log(logs.slice(0, 10).join('\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
