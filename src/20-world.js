/* Weatherglass — the weather itself. One shared state object (WG.state) and the simulation that links
   temperature, humidity, wind, wet ground, snow, frost, the lake, ice, fog and the misting of the glass.
   Nothing here draws; every other part reads this state and feeds it. */
(function () {
  'use strict';
  const WG = window.WG, THREE = WG.THREE, U = WG.util, C = WG.C, T = WG.terrain, L = WG.layout;
  const GW = C.GW, GH = C.GH, N = GW * GH, CS = 12 / GW, WW = C.WW, WH = C.WH;

  /* ------------------------------------------------------------------ state */
  const S = (WG.state = {
    /* clock and calendar */
    time: 15 + 14 / 60,        // hours, 0..24
    playing: false,            // when true a whole day passes in five minutes
    timeGoal: null,            // set by glides
    season: 0,                 // continuous 0..4 : 0 spring, 1 summer, 2 autumn, 3 winter
    seasonGoal: null,
    seasonName: 'Spring',
    /* sky (directions point from the scene toward the body) */
    sunDir: new THREE.Vector3(0, 1, 0), moonDir: new THREE.Vector3(0, -1, 0),
    sunPos: new THREE.Vector3(), moonPos: new THREE.Vector3(),   // where the glowing discs hang, just outside the glass
    sunUp: 1,                  // 0 below the horizon .. 1 well up
    sunI: 1,                   // sunlight actually reaching the land after cloud (0..1)
    moonUp: 0, night: 0,       // night: 0 day .. 1 full night
    golden: 0, dusk: 0,        // 0..1 weights of golden hour and of blue hour
    /* air */
    temp: 18,                  // °C at lake level
    humidity: 0.45,            // 0..1
    cover: 0,                  // cloud cover 0..1                (written by clouds)
    storm: 0,                  // thunderstorm strength 0..1      (written by clouds)
    rainRate: 0,               // what the clouds are letting go  (written by clouds)
    rain: 0, snowing: 0,       // what is actually landing, 0..1  (measured from deposits)
    wind: { dx: 1, dz: 0, speed: 0.28, phase: 0, angle: 0.3, pushX: 0, pushZ: 0 },
    /* ground and water */
    wetAvg: 0, snowAvg: 0, frostAvg: 0, fogAvg: 0,
    lakeRise: 0, lakeLevel: C.LAKE,
    ice: 0, riverIce: 0, fallIce: 0,   // 0 open .. 1 frozen
    flow: 1,                   // river and waterfall discharge, 1 normal .. ~2.3 in spate
    turbid: 0,                 // murkiness of the water 0..1
    /* glass: front(+z), back(-z), left(-x), right(+x), lid */
    mist: [0, 0, 0, 0, 0], paneRain: [0, 0, 0, 0, 0], glassFrost: 0,
    /* lightning */
    flash: 0, flashPos: new THREE.Vector3(0, 5, 0),
    /* words */
    phrase: 'sunny',
    foliage: '#a8c66c',
    scenario: 'calm',
  });
  const W = (WG.world = { GW, GH, N, CS });

  /* ------------------------------------------------------------------ grids */
  W.wet = new Float32Array(N); W.snow = new Float32Array(N); W.frost = new Float32Array(N);
  W.rain = new Float32Array(N); W.snowfall = new Float32Array(N);       // smoothed local intensity 0..1
  const rainIn = new Float32Array(N), snowIn = new Float32Array(N);
  W.fog = new Float32Array(N); const fogB = new Float32Array(N);
  const cellH = (W.cellH = new Float32Array(N)), cellNx = new Float32Array(N), cellNy = new Float32Array(N), cellNz = new Float32Array(N);
  const cellHol = new Float32Array(N), cellLake = new Uint8Array(N), cellLow = new Float32Array(N);
  const nrm = {};
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const x = C.X0 + (i + 0.5) * CS, z = C.Z0 + (j + 0.5) * CS, k = j * GW + i;
    cellH[k] = T.height(x, z); T.normal(x, z, nrm); cellNx[k] = nrm.x; cellNy[k] = nrm.y; cellNz[k] = nrm.z;
    cellHol[k] = T.hollow(x, z); cellLake[k] = T.lakeR(x, z) < 1.0 ? 1 : 0;
    cellLow[k] = U.smooth(1.5, 0.55, cellH[k]);
  }
  const gData = new Uint8Array(N * 4), fData = new Uint8Array(N * 4), wData = new Uint8Array(WW * WH * 4);
  const mkTex = (d, w, h) => { const t = new THREE.DataTexture(d, w, h, THREE.RGBAFormat, THREE.UnsignedByteType); t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; return t; };
  W.groundTex = mkTex(gData, GW, GH);   // r wet, g snow, b frost, a rain falling here now
  W.fogTex = mkTex(fData, GW, GH);      // r fog depth / 1.6
  for (let i = 0; i < WW * WH; i++) { wData[i * 4] = 128; wData[i * 4 + 1] = 128; wData[i * 4 + 3] = 255; }
  W.windTex = mkTex(wData, WW, WH);     // rg local gusts, 0.5 = still, ±3 units/s full scale
  const wvx = new Float32Array(WW * WH), wvz = new Float32Array(WW * WH), wtmp = new Float32Array(WW * WH);

  const ci = (x) => U.clamp(((x - C.X0) / CS) | 0, 0, GW - 1), cj = (z) => U.clamp(((z - C.Z0) / CS) | 0, 0, GH - 1);
  W.cell = (x, z) => cj(z) * GW + ci(x);
  const sample = (G, x, z) => {
    const fx = U.clamp((x - C.X0) / CS - 0.5, 0, GW - 1.001), fz = U.clamp((z - C.Z0) / CS - 0.5, 0, GH - 1.001), i = fx | 0, j = fz | 0, u = fx - i, v = fz - j, k = j * GW + i;
    return G[k] * (1 - u) * (1 - v) + G[k + 1] * u * (1 - v) + G[k + GW] * (1 - u) * v + G[k + GW + 1] * u * v;
  };
  W.wetAt = (x, z) => sample(W.wet, x, z);
  W.snowAt = (x, z) => sample(W.snow, x, z);
  W.frostAt = (x, z) => sample(W.frost, x, z);
  W.rainAt = (x, z) => sample(W.rain, x, z);
  W.fogAt = (x, z) => sample(W.fog, x, z);
  W.tempAt = (y) => S.temp - 5 * Math.max(0, y - C.LAKE);
  /* height above which precipitation falls as snow */
  W.snowLine = () => C.LAKE + (S.temp - 0.6) / 5;

  /* precipitation landing at (x,z). kind 0 rain, 1 snow, 2 hail. mass is in cell·seconds of full-rate fall:
     a cloud letting go at rate R (0..1) over a footprint of n cells must deliver R·n mass per second in total. */
  W.deposit = (x, z, kind, mass) => {
    if (x < C.X0 || x > C.X1 || z < C.Z0 || z > C.Z1) return;
    const i = ci(x), j = cj(z), A = kind === 1 ? snowIn : rainIn, m = mass * 0.2;
    A[j * GW + i] += m * 1.8;
    if (i > 0) A[j * GW + i - 1] += m * 0.8; if (i < GW - 1) A[j * GW + i + 1] += m * 0.8;
    if (j > 0) A[(j - 1) * GW + i] += m * 0.8; if (j < GH - 1) A[(j + 1) * GW + i] += m * 0.8;
  };
  /* pour fog at a point: amount is depth in units added at the centre */
  W.addFog = (x, z, amount, radius = 0.6) => {
    const r = Math.ceil(radius / CS), i0 = ci(x), j0 = cj(z);
    for (let j = Math.max(0, j0 - r); j <= Math.min(GH - 1, j0 + r); j++) for (let i = Math.max(0, i0 - r); i <= Math.min(GW - 1, i0 + r); i++) {
      const d = Math.hypot(C.X0 + (i + 0.5) * CS - x, C.Z0 + (j + 0.5) * CS - z) / radius; if (d < 1) { const k = j * GW + i; W.fog[k] = Math.min(1.6, W.fog[k] + amount * (1 - d * d) * (1 - d * d)); }
    }
  };
  /* a local gust (the wind tool): velocity in units/s around a point */
  W.gust = (x, z, vx, vz, radius = 1.2) => {
    const sx = 12 / WW, r = Math.ceil(radius / sx), i0 = U.clamp(((x - C.X0) / sx) | 0, 0, WW - 1), j0 = U.clamp(((z - C.Z0) / sx) | 0, 0, WH - 1);
    for (let j = Math.max(0, j0 - r); j <= Math.min(WH - 1, j0 + r); j++) for (let i = Math.max(0, i0 - r); i <= Math.min(WW - 1, i0 + r); i++) {
      const d = Math.hypot(C.X0 + (i + 0.5) * sx - x, C.Z0 + (j + 0.5) * sx - z) / radius; if (d < 1) { const f = (1 - d * d), k = j * WW + i; wvx[k] = U.clamp(wvx[k] + vx * f, -3, 3); wvz[k] = U.clamp(wvz[k] + vz * f, -3, 3); }
    }
    S.wind.pushX = U.clamp(S.wind.pushX + vx * 0.05, -1.6, 1.6); S.wind.pushZ = U.clamp(S.wind.pushZ + vz * 0.05, -1.6, 1.6);
  };
  /* wind velocity (units/s, horizontal) felt at a point, global breeze plus local gusts */
  W.windAt = (x, z, out) => {
    out = out || {}; const w = S.wind, sx = 12 / WW;
    const g = 0.45 + 1.1 * U.vnoise((x * w.dx + z * w.dz) * 0.19 - w.phase * 0.19, (-x * w.dz + z * w.dx) * 0.25 + WG.time * 0.05, 3);
    const i = U.clamp(((x - C.X0) / sx) | 0, 0, WW - 1), j = U.clamp(((z - C.Z0) / sx) | 0, 0, WH - 1), k = j * WW + i;
    out.x = w.dx * w.speed * g + wvx[k]; out.z = w.dz * w.speed * g + wvz[k]; return out;
  };

  /* ------------------------------------------------------------------ clock, calendar */
  const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
  W.bySeason = (a, b, c, d) => U.bySeason(S.season, a, b, c, d);
  const api = (WG.api = WG.api || {});
  api.setTime = (h, glide) => { h = U.wrap(h, 24); if (glide) S.timeGoal = h; else { S.time = h; S.timeGoal = null; } };
  api.nudgeTime = (dh) => { S.time = U.wrap(S.time + dh, 24); S.timeGoal = null; };
  api.togglePlay = (on) => { S.playing = on === undefined ? !S.playing : !!on; WG.bus.emit('play', { playing: S.playing }); return S.playing; };
  api.setSeason = (s, glide) => { s = U.wrap(s, 4); if (glide) S.seasonGoal = s; else { S.season = s; S.seasonGoal = null; } };
  api.nudgeSeason = (d) => { S.season = U.wrap(S.season + d, 4); S.seasonGoal = null; };
  api.nextSeason = () => { const cur = S.seasonGoal !== null ? S.seasonGoal : S.season; S.seasonGoal = U.wrap(Math.round(cur) + 1, 4); return S.seasonGoal; };
  /* shared interface state: the current tool, sound, whether the controls are hidden */
  api.tool = 'hand'; api.TOOLS = ['hand', 'wind', 'cloud', 'fog', 'wipe'];
  api.setTool = (name) => { if (api.TOOLS.indexOf(name) < 0 || name === api.tool) return; api.tool = name; WG.bus.emit('tool', { tool: name }); };
  api.soundOn = true;
  api.toggleSound = (on) => { api.soundOn = on === undefined ? !api.soundOn : !!on; WG.bus.emit('sound', { on: api.soundOn }); return api.soundOn; };
  api.uiHidden = false;
  api.toggleUI = (hidden) => { api.uiHidden = hidden === undefined ? !api.uiHidden : !!hidden; WG.bus.emit('ui:hidden', { hidden: api.uiHidden }); return api.uiHidden; };
  api.fullscreen = () => { const el = document.getElementById('wg-root'); try { if (document.fullscreenElement) document.exitFullscreen(); else if (el.requestFullscreen) { const p = el.requestFullscreen(); if (p && p.catch) p.catch(() => {}); } } catch (e) { /* not available here */ } };
  let seasonVel = 0;
  function clock(dt) {
    if (S.timeGoal !== null) { const d = U.cyc(S.time, S.timeGoal, 24); if (Math.abs(d) < 0.004) { S.time = S.timeGoal; S.timeGoal = null; } else S.time = U.wrap(S.time + d * (1 - Math.exp(-dt * 4.2)), 24); }
    else if (S.playing) S.time = U.wrap(S.time + (dt * 24) / 300, 24);
    if (S.seasonGoal !== null) {
      const d = U.cyc(S.season, S.seasonGoal, 4), want = U.clamp(d * 3.2, -0.72, 0.72);   // a second or two per season
      seasonVel = U.damp(seasonVel, want, 6, dt);
      if (Math.abs(d) < 0.003) { S.season = S.seasonGoal; S.seasonGoal = null; seasonVel = 0; WG.bus.emit('season:arrived', { season: S.season }); } else S.season = U.wrap(S.season + seasonVel * dt, 4);
    }
    const idx = Math.round(S.season) & 3; if (SEASONS[idx] !== S.seasonName) { S.seasonName = SEASONS[idx]; WG.bus.emit('season:name', { name: S.seasonName, index: idx }); }
  }

  /* the sun and moon ride a rounded box just outside the glass */
  const ORB = { ox: 0, oy: -0.8, oz: 0, a: 7.5, b: 8.9, c: 5.5 };
  W.orbit = (dir, out) => { const t = Math.pow(Math.pow(Math.abs(dir.x) / ORB.a, 4) + Math.pow(Math.abs(dir.y) / ORB.b, 4) + Math.pow(Math.abs(dir.z) / ORB.c, 4), -0.25); return out.set(ORB.ox + dir.x * t, ORB.oy + dir.y * t, ORB.oz + dir.z * t); };
  W.maxElev = () => (47.5 + 15.5 * Math.cos(((S.season - 1) * Math.PI) / 2)) * Math.PI / 180;
  W.sunDirAt = (time, out) => { const th = ((time - 6) / 12) * Math.PI, E = W.maxElev(); return out.set(Math.cos(th), Math.sin(th) * Math.sin(E), -Math.sin(th) * Math.cos(E)).normalize(); };
  W.moonDirAt = (time, out) => { const th = ((time - 18.6) / 12) * Math.PI, E = (95 * Math.PI) / 180 - W.maxElev(); return out.set(Math.cos(th) * 0.96, Math.sin(th) * Math.sin(E), -Math.sin(th) * Math.cos(E) + 0.12).normalize(); };
  function astronomy() {
    W.sunDirAt(S.time, S.sunDir); W.moonDirAt(S.time, S.moonDir);
    W.orbit(S.sunDir, S.sunPos); W.orbit(S.moonDir, S.moonPos);
    const sy = S.sunDir.y;
    S.sunUp = U.smooth(-0.03, 0.16, sy);
    S.moonUp = U.smooth(-0.02, 0.14, S.moonDir.y);
    S.night = 1 - U.smooth(-0.34, -0.02, sy);            // full night about an hour and a half after sunset
    S.golden = U.smooth(0.52, 0.2, sy) * U.smooth(-0.04, 0.06, sy);
    S.dusk = U.smooth(0.1, -0.03, sy) * (1 - S.night);
    S.sunI = S.sunUp * (1 - 0.8 * U.smooth(0.15, 0.95, S.cover)) * (1 - 0.6 * S.storm);
  }

  /* ------------------------------------------------------------------ air */
  let stormPrev = 0, afterStorm = 0;
  function air(dt) {
    const tMid = W.bySeason(16, 28, 14, -3);
    const d = Math.pow(0.5 - 0.5 * Math.cos(((S.time - 15) / 24) * Math.PI * 2), 0.75);
    const day = S.sunUp;
    const target = tMid + 2.15 - 9 * d * (1 - 0.5 * S.cover) - 2.2 * S.cover * day - 4 * S.storm - 1.2 * U.sat(S.rain * 2);
    S.temp = U.damp(S.temp, target, 0.9, dt);
    const hT = U.clamp(W.bySeason(0.5, 0.46, 0.58, 0.5) + 0.12 * S.night + 0.3 * S.wetAvg + 0.28 * S.fogAvg + 0.2 * S.storm + 0.35 * U.sat(S.rain * 2) + 0.15 * U.sat(S.snowing * 2) - 0.1 * S.sunI, 0.05, 1);
    S.humidity = U.damp(S.humidity, hT, 0.22, dt);
    /* wind */
    const w = S.wind, t = WG.time;
    const base = W.bySeason(0.28, 0.16, 0.6, 0.46) * (0.7 + 0.6 * U.vnoise(t * 0.07, 3.3, 7)) + 1.35 * S.storm * (0.75 + 0.5 * U.vnoise(t * 0.5, 9.1, 8));
    const ang = 0.3 + (U.vnoise(t * 0.021, 1.7, 9) - 0.5) * 1.5 + S.storm * Math.sin(t * 0.3) * 0.5;
    let vx = Math.cos(ang) * base + w.pushX, vz = Math.sin(ang) * base * 0.6 + w.pushZ;
    const sp = Math.hypot(vx, vz);
    w.speed = U.damp(w.speed, sp, 2.5, dt);
    if (sp > 1e-3) { const a2 = Math.atan2(vz, vx); w.angle += U.cyc(w.angle, a2, Math.PI * 2) * (1 - Math.exp(-dt * 2)); }
    w.dx = Math.cos(w.angle); w.dz = Math.sin(w.angle);
    w.phase += w.speed * dt * 1.7;
    const dec = Math.exp(-dt * 0.9); w.pushX *= dec; w.pushZ *= dec;
    /* local gusts decay and spread */
    const gd = Math.exp(-dt * 1.5);
    for (let j = 0; j < WH; j++) for (let i = 0; i < WW; i++) { const k = j * WW + i, l = i > 0 ? k - 1 : k, r = i < WW - 1 ? k + 1 : k, u = j > 0 ? k - WW : k, dn = j < WH - 1 ? k + WW : k; wtmp[k] = (wvx[k] * 0.6 + (wvx[l] + wvx[r] + wvx[u] + wvx[dn]) * 0.1) * gd; }
    wvx.set(wtmp);
    for (let j = 0; j < WH; j++) for (let i = 0; i < WW; i++) { const k = j * WW + i, l = i > 0 ? k - 1 : k, r = i < WW - 1 ? k + 1 : k, u = j > 0 ? k - WW : k, dn = j < WH - 1 ? k + WW : k; wtmp[k] = (wvz[k] * 0.6 + (wvz[l] + wvz[r] + wvz[u] + wvz[dn]) * 0.1) * gd; }
    wvz.set(wtmp);
    for (let k = 0; k < WW * WH; k++) { wData[k * 4] = 128 + U.clamp(wvx[k] / 3, -1, 1) * 127; wData[k * 4 + 1] = 128 + U.clamp(wvz[k] / 3, -1, 1) * 127; }
    W.windTex.needsUpdate = true;
    if (stormPrev > 0.5 && S.storm < 0.5) afterStorm = 22;
    stormPrev = S.storm; afterStorm = Math.max(0, afterStorm - dt);
  }

  /* ------------------------------------------------------------------ ground */
  let meltRate = 0, rainLong = 0;
  function ground(dt) {
    const sd = S.sunDir, sunI = S.sunI, wind = S.wind.speed, inv = 1 / Math.max(dt, 1e-3), k1 = 1 - Math.exp(-dt * 2.2);
    let wetS = 0, snowS = 0, frostS = 0, rainS = 0, snowFS = 0, melt = 0;
    const coldNight = S.night > 0.5 && S.cover < 0.45 ? 1 : 0;
    for (let k = 0; k < N; k++) {
      const Tc = S.temp - 5 * Math.max(0, cellH[k] - C.LAKE);
      const sun = sunI * Math.max(0.12, cellNx[k] * sd.x + cellNy[k] * sd.y + cellNz[k] * sd.z);
      const r = (W.rain[k] += (Math.min(1.6, rainIn[k] * inv) - W.rain[k]) * k1);
      const sf = (W.snowfall[k] += (Math.min(1.6, snowIn[k] * inv) - W.snowfall[k]) * k1);
      rainIn[k] = 0; snowIn[k] = 0;
      let wet = W.wet[k], snow = W.snow[k], fr = W.frost[k];
      wet += (r * dt) / 5.5;
      if (r < 0.03) wet -= dt * (0.011 + 0.05 * sun + 0.022 * wind + 0.0007 * Math.max(0, Tc)) * (1.15 - 0.6 * S.humidity);
      if (Tc < 0.6) snow += (sf * dt) / 12; else if (sf > 0) wet += (sf * dt) / 8;
      if (snow > 0) {
        if (Tc > 0.3) { const m = Math.min(snow, dt * (0.012 + 0.011 * Tc + 0.07 * sun + 0.1 * r)); snow -= m; wet += m * 1.6; melt += m; }
        else if (sun > 0.5 && Tc > -1.5) { const m = Math.min(snow, dt * 0.004 * sun); snow -= m; }
      }
      if (coldNight && Tc < 0.8 && r < 0.02) fr += dt * 0.035; else fr -= dt * (0.02 + 0.3 * sun * S.sunUp + (Tc > 2 ? 0.06 : 0) + r);
      wet = wet < 0 ? 0 : wet > 1 ? 1 : wet; snow = snow < 0 ? 0 : snow > 1 ? 1 : snow; fr = fr < 0 ? 0 : fr > 1 ? 1 : fr;
      W.wet[k] = wet; W.snow[k] = snow; W.frost[k] = fr;
      wetS += wet; snowS += snow; frostS += fr; rainS += r; snowFS += sf;
      const o = k * 4; gData[o] = wet * 255; gData[o + 1] = snow * 255; gData[o + 2] = fr * 255; gData[o + 3] = Math.min(1, r + sf * 0.4) * 255;
    }
    W.groundTex.needsUpdate = true;
    S.wetAvg = wetS / N; S.snowAvg = snowS / N; S.frostAvg = frostS / N;
    /* a footprint of ~12% of the floor raining flat out reads as "rain" */
    S.rain = U.damp(S.rain, U.sat((rainS / N) * 5.5), 3, dt);
    S.snowing = U.damp(S.snowing, U.sat((snowFS / N) * 5.5), 3, dt);
    meltRate = U.damp(meltRate, (melt / N) * inv, 1.5, dt);
    rainLong = U.damp(rainLong, S.rain, 0.25, dt);
    /* the lake fills and drains; the river runs fuller and murkier */
    S.lakeRise = U.clamp(S.lakeRise + dt * (S.rain * 0.022 + meltRate * 0.5 - 0.0042 * (S.lakeRise / 0.25) * (S.rain < 0.05 ? 1 : 0.2)), 0, 0.25);
    S.lakeLevel = C.LAKE + S.lakeRise;
    S.flow = U.damp(S.flow, 1 + 1.3 * U.sat(rainLong * 1.6 + meltRate * 40 + S.lakeRise * 1.2), 0.5, dt);
    S.turbid = U.damp(S.turbid, U.sat((S.flow - 1) * 0.9), 0.3, dt);
    /* freezing and thawing */
    const tl = S.temp, tf = W.tempAt(L.fall.yTop);
    S.ice = U.sat(S.ice + dt * (tl < 0 ? -tl / 42 : -tl / 26));
    S.riverIce = U.sat(S.riverIce + dt * (tl < -1 ? (-tl - 1) / 55 : -(tl + 1) / 30));
    S.fallIce = U.sat(S.fallIce + dt * (tf < -8 ? (-8 - tf) / 90 : -(tf + 8) / 60));
  }

  /* ------------------------------------------------------------------ fog: a shallow fluid that drains downhill and levels out */
  let fogAcc = 0;
  function fogStep(dt) {
    const F = W.fog, lvl = S.lakeLevel, w = S.wind;
    /* natural sources */
    const hour = S.time, dawn = U.smooth(3.5, 5.5, hour) * U.smooth(8.6, 7.2, hour);
    const dawnFog = dawn * U.smooth(0.56, 0.72, S.humidity) * U.smooth(14, 8, S.temp) * U.smooth(0.55, 0.3, w.speed) * W.bySeason(1, 0.35, 1, 0.6);
    const steam = Math.max(U.smooth(0.25, 0.5, S.wetAvg) * U.smooth(17, 22, S.temp) * U.smooth(0.3, 0.6, S.sunI) * (S.rain < 0.1 ? 1 : 0), U.smooth(-1, -4, S.temp) * (1 - S.ice) * U.smooth(4, 6, hour) * U.smooth(10, 8, hour));
    const banks = U.smooth(0.82, 0.95, S.humidity) * (1 - S.storm);
    const low = afterStorm > 0 ? U.smooth(0, 4, afterStorm) * U.smooth(0.3, 0.6, S.wetAvg) : 0;
    const evap = dt * (0.004 + 0.028 * S.sunI + 0.035 * U.smooth(10, 24, S.temp) + 0.05 * U.smooth(0.4, 1.4, w.speed) + 0.04 * U.smooth(0.6, 0.3, S.humidity)) * (dawnFog > 0.2 ? 0.25 : 1);
    const fr = Math.min(0.235, 5.5 * dt);
    const ax = (w.dx * w.speed * 0.42 * dt) / CS, az = (w.dz * w.speed * 0.42 * dt) / CS;
    let sum = 0;
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const k = j * GW + i;
      /* advect with the wind (walls hold it in, so it piles against the glass) */
      const fx = U.clamp(i - ax, 0, GW - 1.001), fz = U.clamp(j - az, 0, GH - 1.001), i0 = fx | 0, j0 = fz | 0, u = fx - i0, v = fz - j0, q = j0 * GW + i0;
      fogB[k] = F[q] * (1 - u) * (1 - v) + F[q + 1] * u * (1 - v) + F[q + GW] * (1 - u) * v + F[q + GW + 1] * u * v;
    }
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const k = j * GW + i; let f = fogB[k];
      const g = cellLake[k] ? Math.max(cellH[k], lvl) : cellH[k], s = g + f;
      let out = 0, inn = 0;
      /* exchange with the four neighbours according to the difference in surface height */
      for (let n = 0; n < 4; n++) {
        const ii = i + (n === 0 ? -1 : n === 1 ? 1 : 0), jj = j + (n === 2 ? -1 : n === 3 ? 1 : 0); if (ii < 0 || jj < 0 || ii >= GW || jj >= GH) continue;
        const kk = jj * GW + ii, fn = fogB[kk], gn = cellLake[kk] ? Math.max(cellH[kk], lvl) : cellH[kk], d = s - (gn + fn);
        if (d > 0) out += Math.min(f * 0.25, d * 0.5) * fr * 4; else inn += Math.min(fn * 0.25, -d * 0.5) * fr * 4;
      }
      f += inn - out;
      if (dawnFog > 0) f += dt * 0.05 * dawnFog * cellLow[k] * (cellLake[k] ? 1.5 : 1);
      if (steam > 0 && cellLake[k] && f < 0.22) f += dt * 0.03 * steam;
      if (banks > 0 && cellH[k] > 1.25 && cellH[k] < 2.5 && f < 0.5) f += dt * 0.03 * banks * U.smooth(0.55, 0.75, U.vnoise(i * 0.09 + WG.time * 0.02, j * 0.09, 31));
      if (low > 0 && f < 0.18) f += dt * 0.02 * low * cellLow[k];
      f -= evap / (0.35 + f);
      f = f < 0 ? 0 : f > 1.6 ? 1.6 : f;
      F[k] = f; sum += f; fData[k * 4] = (f / 1.6) * 255;
    }
    W.fogTex.needsUpdate = true;
    S.fogAvg = U.sat(sum / N / 0.55);
  }

  /* ------------------------------------------------------------------ glass */
  const PN = [[0, 0, 1], [0, 0, -1], [-1, 0, 0], [1, 0, 0], [0, 1, 0]];
  function glass(dt) {
    /* rain running near each wall */
    const band = 9; let pr = [0, 0, 0, 0, 0], cnt = [0, 0, 0, 0, 0];
    for (let j = 0; j < GH; j += 2) for (let i = 0; i < GW; i += 2) {
      const r = W.rain[j * GW + i]; if (j >= GH - band) { pr[0] += r; cnt[0]++; } if (j < band) { pr[1] += r; cnt[1]++; } if (i < band) { pr[2] += r; cnt[2]++; } if (i >= GW - band) { pr[3] += r; cnt[3]++; }
    }
    const cold = U.smooth(6, -4, S.temp);
    for (let p = 0; p < 5; p++) {
      const rainNear = p < 4 ? U.sat((pr[p] / cnt[p]) * 4) : U.sat(S.rain * 1.5);
      S.paneRain[p] = U.damp(S.paneRain[p], rainNear, 1.5, dt);
      const sunlit = Math.max(0, PN[p][0] * S.sunDir.x + PN[p][1] * S.sunDir.y + PN[p][2] * S.sunDir.z) * S.sunI;
      const target = U.sat((S.humidity - 0.6) * 2.4 + S.fogAvg * 0.9 + rainNear * 0.45 + cold * 0.2 * U.smooth(0.45, 0.65, S.humidity) - sunlit * 0.75);
      S.mist[p] = S.mist[p] < target ? Math.min(target, S.mist[p] + dt / 22) : Math.max(target, S.mist[p] - dt * (1 / 30 + sunlit / 9));
    }
    S.glassFrost = U.sat(S.glassFrost + dt * (S.temp < -0.5 ? 1 / 18 : -1 / 10));
  }

  /* ------------------------------------------------------------------ words */
  function words() {
    const w = S.wind.speed, t = S.temp; let p;
    if (S.storm > 0.5) p = 'thunderstorm';
    else if (S.snowing > 0.05 && S.snowing >= S.rain) p = S.snowing > 0.6 ? 'heavy snow' : S.snowing > 0.22 ? 'snowing' : 'flurries';
    else if (S.rain > 0.05) { p = S.rain > 0.7 ? 'downpour' : S.rain > 0.25 ? 'rain' : 'drizzle'; if (W.snowLine() < 3.4 && S.rain > 0.12 && S.rain <= 0.7) p = 'rain, snow on the peaks'; }
    else if (S.fogAvg > 0.42) p = 'foggy';
    else if (S.fogAvg > 0.16) p = 'misty';
    else if (w > 1.7) p = 'gale';
    else if (w > 1.15) p = 'gusty';
    else if (w > 0.82) p = 'windy';
    else if (S.cover > 0.72) p = 'overcast';
    else if (S.night > 0.6) p = S.cover > 0.3 ? 'some cloud' : (t < 0.5 || S.frostAvg > 0.25) ? 'frosty night' : 'clear night';
    else if (S.cover > 0.3) p = 'some cloud';
    else if (w > 0.56) p = 'breezy';
    else if (S.sunUp < 0.75) p = 'clear';
    else p = t >= 26.5 ? 'hot & sunny' : t < 2 ? 'crisp & clear' : 'sunny';
    if (p !== S.phrase) { S.phrase = p; WG.bus.emit('phrase', { phrase: p }); }
    const mix = (a, b, c, d) => { const cs = [a, b, c, d].map((h) => new THREE.Color(h)), s = U.wrap(S.season, 4), i = Math.floor(s), f = s - i; return '#' + cs[i].clone().lerp(cs[(i + 1) & 3], f * f * (3 - 2 * f)).getHexString(); };
    S.foliage = mix('#b5cf6e', '#4f8f42', '#de8430', '#c4d3e0');
  }

  /* ------------------------------------------------------------------ presets */
  const SCEN = {
    calm: { season: 0, time: 15 + 14 / 60, clouds: [{ x: -2.6, z: 0.6, y: 5.35, vol: 1.0 }, { x: 1.2, z: 1.5, y: 5.75, vol: 1.45 }, { x: 3.9, z: -0.9, y: 5.2, vol: 0.75 }] },
    rain: { season: 0.5, time: 13 + 12 / 60, wet: 0.82, rise: 0.15, clouds: [{ x: -2.2, z: 1.0, y: 5.3, vol: 2.6, water: 0.8, raining: 0.6 }, { x: 2.6, z: 1.9, y: 5.5, vol: 2.9, water: 0.85, raining: 0.7 }] },
    storm: { season: 1, time: 15 + 50 / 60, wet: 1, rise: 0.22, clouds: [{ x: -0.8, z: -0.2, y: 5.1, vol: 9.5, water: 1, storm: true }, { x: 3.9, z: 1.6, y: 5.3, vol: 4.2, water: 1, storm: true }] },
    snow: { season: 3, time: 10 + 48 / 60, snow: 1, ice: 1, clouds: [{ x: -2.4, z: 0.4, y: 5.4, vol: 2.8, water: 0.7, raining: 0.5 }, { x: 2.8, z: 1.2, y: 5.6, vol: 2.4, water: 0.65, raining: 0.45 }] },
    mountainsnow: { season: 2.2, time: 10 + 4 / 60, snowAbove: 2.15, wetAbove: 1.0, clouds: [{ x: -3.2, z: -2.3, y: 5.2, vol: 2.6, water: 0.8, raining: 0.55 }, { x: 1.6, z: -2.2, y: 5.4, vol: 2.9, water: 0.8, raining: 0.6 }, { x: 4.4, z: 1.6, y: 5.9, vol: 0.8 }] },
    fog: { season: 2, time: 6 + 57 / 60, fog: 1, mist: 0.75, clouds: [{ x: 2.5, z: -1.5, y: 6.1, vol: 0.9 }] },
    autumn: { season: 2, time: 13 + 55 / 60, wind: 1.05, clouds: [{ x: -3.4, z: 0.2, y: 5.5, vol: 1.2 }, { x: 0.6, z: -1.4, y: 5.9, vol: 0.9 }, { x: 3.6, z: 1.3, y: 5.4, vol: 1.5 }] },
    night: { season: 1, time: 23 + 2 / 60, clouds: [{ x: 3.6, z: -1.6, y: 5.9, vol: 0.8 }] },
    dusk: { season: 1, time: 17 + 38 / 60, clouds: [{ x: -2.9, z: 0.2, y: 5.4, vol: 1.3 }, { x: 0.9, z: 1.4, y: 5.8, vol: 1.7 }, { x: 3.8, z: -1.2, y: 5.3, vol: 0.9 }] },
  };
  W.scenarios = SCEN;
  W.applyScenario = (name) => {
    const sc = SCEN[name] || SCEN.calm; S.scenario = SCEN[name] ? name : 'calm';
    S.time = sc.time; S.season = sc.season; S.timeGoal = S.seasonGoal = null;
    for (let k = 0; k < N; k++) {
      W.wet[k] = sc.wet || 0; W.frost[k] = 0; W.fog[k] = 0; W.rain[k] = 0; W.snowfall[k] = 0;
      W.snow[k] = sc.snow ? U.smooth(0.25, 0.62, cellNy[k]) : sc.snowAbove ? U.smooth(sc.snowAbove - 0.1, sc.snowAbove + 0.5, cellH[k]) * 0.95 : 0;
      if (sc.wetAbove && cellH[k] > sc.wetAbove) W.wet[k] = 0.7;
      if (sc.fog) W.fog[k] = U.clamp(1.42 - Math.max(cellH[k], C.LAKE) + 0.12 * U.gnoise((k % GW) * 0.11, ((k / GW) | 0) * 0.11, 51), 0, 1.5) * U.smooth(2.2, 1.2, cellH[k]);
    }
    S.lakeRise = sc.rise || 0; S.lakeLevel = C.LAKE + S.lakeRise;
    S.ice = S.riverIce = sc.ice || 0; S.fallIce = sc.ice || 0; S.glassFrost = sc.ice ? 0.5 : 0;
    for (let p = 0; p < 5; p++) S.mist[p] = sc.mist || (sc.wet ? 0.2 : 0);
    S.wind.speed = sc.wind || 0.25; if (sc.wind) S.wind.pushX = sc.wind * 0.8;
    astronomy();
    /* settle the air at once */
    const tMid = W.bySeason(16, 28, 14, -3), d = Math.pow(0.5 - 0.5 * Math.cos(((S.time - 15) / 24) * Math.PI * 2), 0.75);
    S.temp = tMid + 2.15 - 9 * d - (sc.wet ? 3 : 0) - (name === 'storm' ? 4 : 0);
    S.humidity = sc.fog ? 0.92 : sc.wet ? 0.8 : sc.snow ? 0.62 : W.bySeason(0.42, 0.4, 0.55, 0.5) + 0.12 * S.night;
    S.flow = 1 + (sc.wet ? 1 : 0); S.turbid = sc.wet ? 0.6 : 0;
    WG.scenario = sc; words();
  };

  /* ------------------------------------------------------------------ module */
  WG.time = 0;
  WG.register('world', {
    init() {
      const want = WG.param('scenario', null) || (SCEN[WG.hash] ? WG.hash : 'calm');
      W.applyScenario(want);
      if (WG.param('t', null) !== null) S.time = WG.paramNum('t', S.time);
      if (WG.param('season', null) !== null) S.season = WG.paramNum('season', S.season);
      astronomy();
    },
    update(dt) {
      clock(dt); astronomy(); air(dt); ground(dt);
      fogAcc += dt; if (fogAcc > 1 / 45) { fogStep(Math.min(fogAcc, 0.05)); fogAcc = 0; }
      glass(dt); words();
      if (S.flash > 0) S.flash = Math.max(0, S.flash - dt * 5.5 * (0.4 + S.flash));
    },
  });
})();
