// Usage: node tools/shot.cjs "<query>" out.png [width] [height] [seconds-to-simulate] ["js to run before the frame"]
// Loads index.html?paused=1&<query>, advances the weather, draws one frame and saves a screenshot.
// Prints console errors, shader errors and timings. Examples:
//   node tools/shot.cjs "scenario=calm&q=1" shots/calm.png
//   node tools/shot.cjs "scenario=storm&q=0&only=flora" shots/x.png 800 500 4 "WG.debug.cam(40, 12, 0.6)"
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const [query = '', out = 'shots/out.png', w = '960', h = '600', secs = '0', js = ''] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || m.type() === 'warning' || /\[WG\]|THREE/.test(t)) logs.push(m.type() + ': ' + t.slice(0, 1800)); });
  page.on('pageerror', (e) => logs.push('PAGEERROR: ' + String(e.stack || e).slice(0, 1500)));

  const url = 'file://' + path.resolve(__dirname, '../index.html') + '?paused=1' + (query ? '&' + query : '');
  const t0 = Date.now();
  await page.goto(url);
  try { await page.waitForFunction(() => window.WG && (window.WG.ready || window.WG.noGL), null, { timeout: 240000 }); } catch (e) { logs.push('TIMEOUT waiting for ready'); }
  const t1 = Date.now();
  const res = await page.evaluate(async ([secs, js]) => {
    const WG = window.WG, r = {};
    try {
      const a = performance.now();
      if (secs > 0) WG.debug.step(secs);
      if (js) { const v = await (0, eval)(js); if (v !== undefined) r.eval = v; }
      const b = performance.now();
      WG.debug.frame(); WG.renderer.getContext().finish();
      r.stepMs = Math.round(b - a); r.frameMs = Math.round(performance.now() - b);
      r.errors = WG.errors; r.tier = WG.Q.tier; r.phrase = WG.state.phrase; r.temp = +WG.state.temp.toFixed(1); r.modules = WG.modules.filter((m) => !m.ok).map((m) => m.name);
    } catch (e) { r.exception = String(e.stack || e); }
    return r;
  }, [+secs, js]);
  await page.screenshot({ path: out, timeout: 180000 });
  console.log(JSON.stringify(Object.assign({ loadMs: t1 - t0 }, res)));
  if (logs.length) console.log(logs.slice(0, 30).join('\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
