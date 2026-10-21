// node tools/perf.cjs "<query>" [w] [h]  -> average ms per forced-sync frame (software GL; relative numbers only)
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const [query = '', w = '960', h = '600'] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: +w, height: +h } });
  await page.goto('file://' + path.resolve(__dirname, '../index.html') + '?paused=1&tour=0&scale=1&' + query);
  await page.waitForFunction(() => window.WG && window.WG.ready, null, { timeout: 240000 });
  const r = await page.evaluate(() => {
    const gl = WG.renderer.getContext(), px = new Uint8Array(4);
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    WG.debug.step(1); WG.debug.frame(); sync(); WG.debug.frame(); sync();
    const t0 = performance.now(); for (let i = 0; i < 3; i++) { WG.updateModules(1 / 60, WG.time += 1 / 60); WG.debug.frame(); sync(); }
    return +((performance.now() - t0) / 3).toFixed(0);
  });
  console.log(query.padEnd(46), r, 'ms');
  await browser.close();
})();
