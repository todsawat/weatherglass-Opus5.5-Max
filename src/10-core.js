/* Weatherglass — core: namespace, parameters, maths, noise, event bus, quality tiers, module registry */
(function () {
  'use strict';
  const THREE = window.THREE;
  const WG = (window.WG = { THREE, modules: [], ready: false, errors: [] });

  /* ---- parameters: ?key=value when opened as a file or from a server, bare #token when hosted in a frame ---- */
  let qs;
  try { qs = new URLSearchParams(location.search); } catch (e) { qs = new URLSearchParams(''); }
  WG.hash = (location.hash || '').replace(/^#/, '');
  WG.param = (k, d) => (qs.has(k) ? qs.get(k) : d);
  WG.paramNum = (k, d) => { const v = parseFloat(qs.get(k)); return isFinite(v) ? v : d; };
  WG.flag = (k) => qs.has(k) && qs.get(k) !== '0';

  /* ---- world constants (units = the brief's units) ---- */
  WG.C = {
    X0: -6, X1: 6, Z0: -4, Z1: 4,      // interior floor plan
    Y0: -1.8, Y1: 7.4,                 // underside of the soil block, underside of the lid
    LAKE: 0.1,                         // resting lake surface
    PLINTH_H: 1.2, TABLE_Y: -3.0,      // plinth top is Y0, table is Y0 - PLINTH_H
    GLASS_T: 0.07,                     // pane thickness
    GW: 96, GH: 64,                    // weather grids (cells of 0.125)
    WW: 48, WH: 32,                    // local wind grid
  };
  /* render layers */
  WG.L = { A: 0, SHADOW: 1, B: 2, REFL: 3 };

  /* ---- maths ---- */
  const U = (WG.util = {});
  U.clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  U.sat = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.smooth = (a, b, x) => { x = U.sat((x - a) / (b - a)); return x * x * (3 - 2 * x); };
  U.remap = (x, a, b, c, d) => c + (d - c) * U.sat((x - a) / (b - a));
  U.damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
  U.wrap = (x, m) => ((x % m) + m) % m;
  U.cyc = (a, b, m) => { let d = U.wrap(b - a, m); if (d > m / 2) d -= m; return d; }; // shortest signed step a->b on a circle of length m
  U.ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  U.rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  U.hash = (x, y, s) => { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul((s | 0) + 1013, 1274126177); h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  const q5 = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  /* value noise, 0..1 */
  U.vnoise = (x, y, s = 0) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = q5(x - ix), fy = q5(y - iy);
    const a = U.hash(ix, iy, s), b = U.hash(ix + 1, iy, s), c = U.hash(ix, iy + 1, s), d = U.hash(ix + 1, iy + 1, s);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  /* gradient noise, about -1..1 */
  U.gnoise = (x, y, s = 0) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, u = q5(fx), v = q5(fy);
    const g = (i, j, dx, dy) => { const a = U.hash(i, j, s) * 6.2831853; return Math.cos(a) * dx + Math.sin(a) * dy; };
    const a = g(ix, iy, fx, fy), b = g(ix + 1, iy, fx - 1, fy), c = g(ix, iy + 1, fx, fy - 1), d = g(ix + 1, iy + 1, fx - 1, fy - 1);
    return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 1.5;
  };
  U.fbm = (x, y, oct = 4, s = 0, lac = 2.03, gain = 0.5) => { let a = 0.5, f = 1, v = 0, n = 0; for (let i = 0; i < oct; i++) { v += a * U.gnoise(x * f, y * f, s + i * 17); n += a; a *= gain; f *= lac; } return v / n; };
  U.ridge = (x, y, oct = 4, s = 0) => { let a = 0.5, f = 1, v = 0, n = 0; for (let i = 0; i < oct; i++) { const r = 1 - Math.abs(U.gnoise(x * f, y * f, s + i * 31)); v += a * r * r; n += a; a *= 0.5; f *= 2.07; } return v / n; };
  U.vnoise3 = (x, y, z, s = 0) => {
    const iz = Math.floor(z), fz = q5(z - iz);
    return U.lerp(U.vnoise(x, y, s + iz * 57), U.vnoise(x, y, s + (iz + 1) * 57), fz);
  };
  /* a damped spring on a scalar */
  U.Spring = class { constructor(x = 0, k = 60, c = 10) { this.x = x; this.v = 0; this.t = x; this.k = k; this.c = c; } step(dt) { const a = (this.t - this.x) * this.k - this.v * this.c; this.v += a * dt; this.x += this.v * dt; return this.x; } };
  U.hex = (h) => new THREE.Color(h);            // sRGB hex -> linear working colour
  U.css = (c) => '#' + c.getHexString();        // linear colour -> css hex (sRGB)
  /* cyclic blend of four seasonal values, s in 0..4 (0 spring, 1 summer, 2 autumn, 3 winter) */
  U.bySeason = (s, a, b, c, d) => { s = U.wrap(s, 4); const i = Math.floor(s), f = s - i, v = [a, b, c, d]; const t = f * f * (3 - 2 * f); return v[i] + (v[(i + 1) & 3] - v[i]) * t; };

  /* ---- event bus ---- */
  const subs = {};
  WG.bus = {
    on(evt, fn) { (subs[evt] || (subs[evt] = [])).push(fn); return fn; },
    off(evt, fn) { const a = subs[evt]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } },
    emit(evt, data) { const a = subs[evt]; if (!a) return; for (let i = 0; i < a.length; i++) { try { a[i](data || {}); } catch (e) { console.error('[WG] bus', evt, e); } } },
  };

  /* ---- quality tiers ---- */
  function detectTier() {
    const forced = WG.param('q', null);
    if (forced !== null) return U.clamp(parseInt(forced, 10) || 0, 0, 2);
    let renderer = '';
    try {
      const c = document.createElement('canvas'), gl = c.getContext('webgl2') || c.getContext('webgl');
      const e = gl && gl.getExtension('WEBGL_debug_renderer_info');
      renderer = e ? String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL)) : '';
      const lose = gl && gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
    } catch (e) { /* ignore */ }
    WG.gpu = renderer;
    if (/swiftshader|llvmpipe|software|basic render/i.test(renderer)) return 0;
    const ua = navigator.userAgent || '';
    const mobile = /Mobi|Android|iPhone|iPod/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh|iPad/.test(ua));
    const mem = navigator.deviceMemory || 4, cores = navigator.hardwareConcurrency || 4;
    if (mobile) return (cores >= 6 && (/Apple/.test(renderer) || /Adreno \(TM\) [78]|Mali-G7[1-9]|Mali-G[89]|Immortalis/.test(renderer))) ? 1 : 0;
    if (/Apple M|RTX|GTX 1[06-9]|GTX 9[78]|Radeon RX|Radeon Pro|Arc\(TM\)|Arc A/i.test(renderer)) return 2;
    if (/Intel/i.test(renderer)) return /Iris\(R\) Xe|Iris Xe/i.test(renderer) && cores >= 8 ? 1 : (mem >= 8 ? 1 : 0);
    return cores >= 8 ? 2 : 1;
  }
  const TIERS = [
    { name: 'low', grass: 20000, pines: 16, broad: 11, bushes: 14, flowers: 1800, reeds: 160, lily: 18, stars: 300, fireflies: 80, birds: 5, butterflies: 5, dragonflies: 2, fish: 6, rain: 2600, snow: 1600, leaves: 180, rocks: 100, shadow: 1024, shadowTaps: 4, volScale: 0.4, volSteps: 26, volLight: 1, reflect: false, tilt: false, fxaa: false, dpr: 1.25, bloom: 4 },
    { name: 'mid', grass: 60000, pines: 23, broad: 16, bushes: 23, flowers: 4200, reeds: 280, lily: 30, stars: 450, fireflies: 150, birds: 7, butterflies: 8, dragonflies: 3, fish: 8, rain: 6000, snow: 3600, leaves: 380, rocks: 150, shadow: 2048, shadowTaps: 8, volScale: 0.5, volSteps: 44, volLight: 1, reflect: false, tilt: true, fxaa: true, dpr: 1.5, bloom: 5 },
    { name: 'high', grass: 120000, pines: 30, broad: 20, bushes: 32, flowers: 8000, reeds: 420, lily: 40, stars: 600, fireflies: 220, birds: 9, butterflies: 11, dragonflies: 4, fish: 10, rain: 12000, snow: 7000, leaves: 700, rocks: 200, shadow: 4096, shadowTaps: 12, volScale: 0.5, volSteps: 64, volLight: 2, reflect: true, tilt: true, fxaa: true, dpr: 2, bloom: 5 },
  ];
  const tier = detectTier();
  WG.Q = Object.assign({ tier, scale: 1 }, TIERS[tier]);
  WG.reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---- module registry: every part initialises and updates inside its own try/catch so one failure never stops the rest ---- */
  const only = WG.param('only', null), skip = WG.param('skip', null);
  const onlySet = only ? new Set(only.split(',')) : null, skipSet = skip ? new Set(skip.split(',')) : null;
  const ALWAYS = new Set(['world', 'render', 'sky', 'terrain', 'camera', 'main']);
  WG.register = (name, mod) => {
    const enabled = (!onlySet || onlySet.has(name) || ALWAYS.has(name)) && !(skipSet && skipSet.has(name));
    WG.modules.push(Object.assign({ name, ok: enabled, fails: 0 }, mod));
  };
  WG.fail = (name, e) => { WG.errors.push(name + ': ' + (e && e.message)); console.error('[WG] ' + name + ' failed:', e); };
  WG.initTimes = {};
  WG.initModules = () => { for (const m of WG.modules) { if (!m.ok || !m.init) continue; const t0 = performance.now(); try { m.init(); } catch (e) { m.ok = false; WG.fail(m.name + '.init', e); } WG.initTimes[m.name] = Math.round(performance.now() - t0); } };
  WG.updateModules = (dt, t) => {
    for (const m of WG.modules) {
      if (!m.ok || !m.update) continue;
      try { m.update(dt, t); m.fails = 0; } catch (e) { if (++m.fails > 4) { m.ok = false; WG.fail(m.name + '.update (disabled)', e); } else if (m.fails === 1) WG.fail(m.name + '.update', e); }
    }
  };
  WG.mod = (name) => WG.modules.find((m) => m.name === name);
})();
