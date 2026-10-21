/* Weatherglass — everything that falls, and lightning.
   Rain, snow and hail are CPU particles that really fall: they are born under the lobes of a raining cloud, ride the wind,
   melt or not on the way down, and each one carries its share of the cloud's water to the ground through W.deposit,
   so the totals that wet the land, fill the puddles and raise the lake do not depend on how many particles a device can afford.
   Drops, flakes, hail, splashes, sparks, embers, scorch marks and snow dust share one instanced draw; the bolts are
   camera-facing ribbons in a second draw. Both are in pass B, in front of the air. */
(function () {
  'use strict';
  const WG = window.WG, THREE = WG.THREE, U = WG.util, C = WG.C, S = WG.state, W = WG.world, T = WG.terrain, L = WG.layout, Q = WG.Q;
  const GW = C.GW, GH = C.GH, CS = 12 / GW;
  const RM = !!WG.reducedMotion;
  const rnd = Math.random;

  /* particle kinds (the shader switches on these) */
  const K_RAIN = 0, K_SNOW = 1, K_HAIL = 2, K_CROWN = 3, K_DROP = 4, K_SPARK = 5, K_EMBER = 6, K_SCORCH = 7, K_DUST = 8, K_BURST = 9;
  const REST = 9;                                          // bnc[] marker: lying on the ground

  const NR = Math.max(200, Q.rain | 0), NS = Math.max(150, Q.snow | 0), NP = NR + NS;
  const NF = [800, 1300, 2000][Q.tier] || 1300;
  /* particles per second per unit² of footprint at full rate: a two-cloud shower fills about two thirds of the pool */
  const DR = NR / 5.2, DS = NS / 30;

  const P = (WG.precip = {
    stats: { rain: 0, snow: 0, hail: 0, fx: 0, emitted: 0, deposited: 0, bolts: 0, rings: 0 },
    bolts: [], last: null, rainK: 1,
  });

  /* ------------------------------------------------------------------ precipitation pool */
  const px = new Float32Array(NP), py = new Float32Array(NP), pz = new Float32Array(NP);
  const vx = new Float32Array(NP), vy = new Float32Array(NP), vz = new Float32Array(NP);
  const term = new Float32Array(NP), age = new Float32Array(NP), size = new Float32Array(NP), mass = new Float32Array(NP), melt = new Float32Array(NP), ph = new Float32Array(NP);
  const kind = new Uint8Array(NP), bnc = new Uint8Array(NP);
  let nP = 0, nRain = 0, nSnow = 0;
  function killP(i) {
    if (kind[i] === K_SNOW) nSnow--; else nRain--;
    const j = --nP; if (i === j) return;
    px[i] = px[j]; py[i] = py[j]; pz[i] = pz[j]; vx[i] = vx[j]; vy[i] = vy[j]; vz[i] = vz[j];
    term[i] = term[j]; age[i] = age[j]; size[i] = size[j]; mass[i] = mass[j]; melt[i] = melt[j]; ph[i] = ph[j]; kind[i] = kind[j]; bnc[i] = bnc[j];
  }

  /* ------------------------------------------------------------------ effects pool (splashes, sparks, embers, dust) */
  const fX = new Float32Array(NF), fY = new Float32Array(NF), fZ = new Float32Array(NF), fVX = new Float32Array(NF), fVY = new Float32Array(NF), fVZ = new Float32Array(NF);
  const fAge = new Float32Array(NF), fLife = new Float32Array(NF), fSize = new Float32Array(NF), fVar = new Float32Array(NF), fPh = new Float32Array(NF), fGy = new Float32Array(NF);
  const fK = new Uint8Array(NF), fB = new Uint8Array(NF);
  let nF = 0;
  function addFx(k, x, y, z, ux, uy, uz, sz, life, v, gy) {
    if (nF >= NF) return -1;
    const i = nF++;
    fK[i] = k; fX[i] = x; fY[i] = y; fZ[i] = z; fVX[i] = ux; fVY[i] = uy; fVZ[i] = uz; fSize[i] = sz; fLife[i] = life; fVar[i] = v || 0; fAge[i] = 0; fPh[i] = rnd() * 6.283; fGy[i] = gy !== undefined ? gy : -9; fB[i] = 0;
    return i;
  }
  function killF(i) {
    const j = --nF; if (i === j) return;
    fK[i] = fK[j]; fX[i] = fX[j]; fY[i] = fY[j]; fZ[i] = fZ[j]; fVX[i] = fVX[j]; fVY[i] = fVY[j]; fVZ[i] = fVZ[j];
    fAge[i] = fAge[j]; fLife[i] = fLife[j]; fSize[i] = fSize[j]; fVar[i] = fVar[j]; fPh[i] = fPh[j]; fGy[i] = fGy[j]; fB[i] = fB[j];
  }

  /* ------------------------------------------------------------------ the air the particles fall through */
  /* wind on a coarse grid, refreshed every frame (includes the wind tool's gusts) */
  const WX = 24, WZ = 16, windX = new Float32Array(WX * WZ), windZ = new Float32Array(WX * WZ), wtmp = {};
  function sampleWind() { for (let j = 0; j < WZ; j++) for (let i = 0; i < WX; i++) { W.windAt(C.X0 + (i + 0.5) * 0.5, C.Z0 + (j + 0.5) * 0.5, wtmp); const k = j * WX + i; windX[k] = wtmp.x; windZ[k] = wtmp.z; } }
  const wk = (x, z) => U.clamp(((z - C.Z0) * 2) | 0, 0, WZ - 1) * WX + U.clamp(((x - C.X0) * 2) | 0, 0, WX - 1);
  /* is precipitation frozen at this height? Above the level of the peaks it is inside the cloud layer and takes the
     temperature found there, so summer and warm-spring showers fall as rain all the way while a cold day snows on the summits */
  const frozenAt = (y) => W.tempAt(Math.min(y, 3.4)) < 0.55;

  /* what a falling thing lands on: ground, open water, a boulder or the cabin roof */
  const VG = 16, VW = 12 * VG, VH = 8 * VG;                 // static water map, 1/16 cells
  const wCode = new Uint8Array(VW * VH), wY = new Float32Array(VW * VH);
  function buildWaterMap() {
    const POOL = L.pool, FALL = L.fall;
    for (let j = 0; j < VH; j++) for (let i = 0; i < VW; i++) {
      const x = C.X0 + (i + 0.5) / VG, z = C.Z0 + (j + 0.5) / VG, k = j * VW + i;
      let code = 0, y = 0;
      if (T.lakeR(x, z) < 1.6) code = 1;
      if (Math.hypot(x - POOL.x, z - POOL.z) < POOL.r * 0.95) { code = code || 2; y = POOL.y; }
      else { const ri = T.riverInfo(x, z); if (ri.d < ri.w * 0.5 && ri.s < 0.9 && z > FALL.zLip + 0.2) { code = code || 3; y = ri.y; } }
      wCode[k] = code; wY[k] = y;
    }
  }
  let hitK = 0;                                              // 0 ground, 1 open water, 2 rock, 3 roof, 4 ice
  const cab = L.cabin, cabC = Math.cos(cab.rot), cabS = Math.sin(cab.rot);
  function surface(x, z) {
    let g = T.height(x, z); hitK = 0;
    const k = U.clamp(((z - C.Z0) * VG) | 0, 0, VH - 1) * VW + U.clamp(((x - C.X0) * VG) | 0, 0, VW - 1), code = wCode[k];
    if (code === 1 && g < S.lakeLevel - 0.004) { hitK = S.ice > 0.6 ? 4 : 1; return S.lakeLevel; }
    if (code === 2) { hitK = S.fallIce > 0.6 ? 4 : 1; return Math.max(g, wY[k]); }
    if (code === 3) { hitK = S.riverIce > 0.6 ? 4 : 1; return Math.max(g, wY[k]); }
    const B = L.boulders;
    for (let b = 0; b < B.length; b++) { const dx = x - B[b].x, dz = z - B[b].z, r = B[b].r, d2 = dx * dx + dz * dz; if (d2 < r * r) { const h = T.height(B[b].x, B[b].z) + r * 0.72 * Math.sqrt(1 - d2 / (r * r)) - 0.04; if (h > g) { g = h; hitK = 2; } } }
    const dx = x - cab.x, dz = z - cab.z, u = dx * cabC - dz * cabS, v = dx * cabS + dz * cabC, hu = cab.len * 0.5 + 0.07, hv = cab.dep * 0.5 + 0.09;
    if (Math.abs(u) < hu && Math.abs(v) < hv) { const h = cab.padY + 0.34 + (cab.ridge - 0.34) * (1 - Math.abs(v) / hv); if (h > g) { g = h; hitK = 3; } }
    return g;
  }

  /* ------------------------------------------------------------------ emission from the clouds */
  const mark = new Int32Array(GW * GH), cells = new Int32Array(GW * GH); let stamp = 1;
  const lw = new Float32Array(32), li = new Int32Array(32), FP = { n: 0, nl: 0, tot: 0 };
  const ci = (x) => U.clamp(((x - C.X0) / CS) | 0, 0, GW - 1), cj = (z) => U.clamp(((z - C.Z0) / CS) | 0, 0, GH - 1);
  /* the footprint of a cloud's rain: the union of discs under its lobes, counted in weather cells */
  function footprint(c) {
    stamp++; let n = 0, nl = 0, acc = 0;
    const lobes = c.lobes || [];
    for (let q = 0; q < lobes.length && nl < 32; q++) {
      const l = lobes[q]; if (l.kind) continue;              // the storm's tower and anvil do not rain
      const r = Math.max(0.06, l.wr * 1.05);
      acc += r * r; lw[nl] = acc; li[nl] = q; nl++;
      const i0 = ci(l.x - r), i1 = ci(l.x + r), j0 = cj(l.z3 - r), j1 = cj(l.z3 + r), r2 = r * r;
      for (let j = j0; j <= j1; j++) { const cz = C.Z0 + (j + 0.5) * CS - l.z3; for (let i = i0; i <= i1; i++) { const cx = C.X0 + (i + 0.5) * CS - l.x; if (cx * cx + cz * cz < r2) { const k = j * GW + i; if (mark[k] !== stamp) { mark[k] = stamp; cells[n++] = k; } } } }
    }
    FP.n = n; FP.nl = nl; FP.tot = acc; return n;
  }
  const cst = new WeakMap();
  function hailOf(c, st) {
    if (!c.storm || c.stormK < 0.7 || c.rain < 0.5 || S.temp < 15) return 0;
    /* hail comes in bursts */
    return (0.02 + 0.12 * U.smooth(0.5, 0.68, U.vnoise(WG.time * 0.11, st.hp, 17))) * U.smooth(0.7, 0.9, c.stormK) * U.smooth(15, 20, S.temp);
  }
  function spawnP(c, m, frozen, hail) {
    if (nP >= NP || FP.n === 0) return;
    /* uniform over the footprint, so no cell is asked to take more than the cloud's own rate */
    const k = cells[(rnd() * FP.n) | 0];
    const x = U.clamp(C.X0 + ((k % GW) + rnd()) * CS, C.X0 + 0.02, C.X1 - 0.02), z = U.clamp(C.Z0 + (((k / GW) | 0) + rnd()) * CS, C.Z0 + 0.02, C.Z1 - 0.02);
    const y = c.baseY - 0.02 - rnd() * 0.12;
    const kd = hail ? 2 : frozen ? 1 : 0;
    if (y <= surface(x, z) + 0.01) { bank(x, z, kd, m); return; }
    const i = nP++, w = wk(x, z);
    px[i] = x; py[i] = y; pz[i] = z;
    vx[i] = windX[w] + c.vx * 0.35 + (rnd() - 0.5) * 0.06; vz[i] = windZ[w] + c.vz * 0.35 + (rnd() - 0.5) * 0.06;
    if (hail) { kind[i] = K_HAIL; vy[i] = -2.5; term[i] = -(8.5 + rnd() * 2); size[i] = 0.02 + rnd() * 0.02; nRain++; }
    else if (frozen) { kind[i] = K_SNOW; vy[i] = -0.3; term[i] = -(0.58 + rnd() * 0.32); size[i] = 0.022 + rnd() * 0.026; nSnow++; }
    else { kind[i] = K_RAIN; vy[i] = -2.0 - rnd(); term[i] = -(5.4 + rnd() * 1.6); size[i] = 0.004 + rnd() * 0.003; nRain++; }
    mass[i] = m; melt[i] = 0; age[i] = 0; ph[i] = rnd() * 6.2832; bnc[i] = 0;
  }
  let rot = 0;
  function emit(dt) {
    const CL = WG.clouds; if (!CL || !CL.list) return;
    const list = CL.list, n = list.length; if (!n) return;
    rot = (rot + 1) % n;
    for (let q = 0; q < n; q++) {
      const c = list[(q + rot) % n];
      let st = cst.get(c); if (!st) { st = { carry: 0, acc: 0, hp: rnd() * 100 }; cst.set(c, st); }
      if (!(c.rain > 0.003) || !(c.alpha > 0.01) || !c.lobes) {
        if (st.carry > 0) { bank(c.x, c.z, 0, st.carry); st.carry = 0; }
        st.acc = 0; continue;
      }
      const nCells = footprint(c); if (!nCells || !FP.nl) continue;
      const frozen = frozenAt(c.baseY), add = c.rain * nCells * dt;
      P.stats.emitted += add;
      st.acc += c.rain * nCells * CS * CS * (frozen ? DS : DR) * dt;
      let k = Math.floor(st.acc); st.acc -= k;
      k = Math.min(k, Math.max(0, frozen ? NS - nSnow : NR - nRain), NP - nP);
      const M = add + st.carry;
      if (k <= 0) { st.carry = M; continue; }
      st.carry = 0;
      const m = M / k, hail = frozen ? 0 : hailOf(c, st);
      for (let j = 0; j < k; j++) spawnP(c, m, frozen, hail > 0 && rnd() < hail);
    }
  }

  /* ------------------------------------------------------------------ landing */
  /* Every landing hands its water to W.deposit. The world measures each cell's rate per frame and clips it at 1.6, so a
     few heavy particles (a phone's small pool) would lose water: landings go through a per-cell bucket that pays out at
     most 1.35 cell-rate per frame, which keeps the totals exact whatever the particle count. */
  const pendR = new Float32Array(GW * GH), pendS = new Float32Array(GW * GH);
  function bank(x, z, kd, m) { const k = cj(z) * GW + ci(x); if (kd === 1) pendS[k] += m; else pendR[k] += m; }
  function flush(dt) {
    const cap = 1.35 * dt; let d = 0;
    for (let k = 0; k < GW * GH; k++) {
      const r = pendR[k], s = pendS[k]; if (r <= 1e-7 && s <= 1e-7) continue;
      const x = C.X0 + ((k % GW) + 0.5) * CS, z = C.Z0 + (((k / GW) | 0) + 0.5) * CS;
      if (r > 1e-7) { const m = Math.min(r, cap); W.deposit(x, z, 0, m); pendR[k] = r - m; d += m; }
      if (s > 1e-7) { const m = Math.min(s, cap); W.deposit(x, z, 1, m); pendS[k] = s - m; d += m; }
    }
    P.stats.deposited += d;
  }
  let ringBudget = 0, dustBudget = 0;
  function ring(x, z, s, force) {
    if (!force) { if (ringBudget < 1) return; ringBudget -= 1; }
    const w = WG.water; if (w && w.ring) { try { w.ring(x, z, s); P.stats.rings++; } catch (e) { /* the water part failed: no rings */ } }
  }
  function splash(x, s, z, hk) {
    if (hk === 0 && W.snowAt(x, z) > 0.45) return;           // soft snow swallows the drop
    const use = nF / NF;
    if (rnd() < (use < 0.45 ? 0.6 : use < 0.75 ? 0.22 : 0.04)) addFx(K_CROWN, x, s + 0.002, z, 0, 0, 0, 0.032 + rnd() * 0.022, 0.12 + rnd() * 0.07, 0);
    if (rnd() < (use < 0.55 ? (hk === 2 || hk === 3 ? 0.55 : 0.3) : 0.04)) {
      const n = rnd() < 0.4 ? 2 : 1;
      for (let j = 0; j < n; j++) { const a = rnd() * 6.283, sp = 0.2 + rnd() * 0.45; addFx(K_DROP, x, s + 0.01, z, Math.cos(a) * sp, 0.5 + rnd() * 0.55, Math.sin(a) * sp, 0.004 + rnd() * 0.002, 0.45, 0, s); }
    }
  }
  function land(i, x, s, z) {
    const k = kind[i], hk = hitK;
    if (mass[i] > 0) { bank(x, z, k === K_SNOW && melt[i] < 0.5 ? 1 : 0, mass[i]); mass[i] = 0; }
    if (k === K_RAIN) {
      if (hk === 1) { ring(x, z, 0.035 + rnd() * 0.03); if (rnd() < 0.12 && nF < NF * 0.6) addFx(K_CROWN, x, s, z, 0, 0, 0, 0.026, 0.12, 0); }
      else splash(x, s, z, hk);
      killP(i); return;
    }
    if (k === K_SNOW) {
      if (hk === 1) { killP(i); return; }
      bnc[i] = REST; melt[i] = rnd() * 0.3; px[i] = x; py[i] = s + 0.006; pz[i] = z; vx[i] = vy[i] = vz[i] = 0; return;
    }
    /* hail: falls fast, bounces twice, then lies and melts */
    if (hk === 1) { ring(x, z, 0.08, true); const a = rnd() * 6.283; addFx(K_DROP, x, s + 0.01, z, Math.cos(a) * 0.3, 0.9, Math.sin(a) * 0.3, 0.005, 0.4, 0, s); killP(i); return; }
    if (bnc[i] < 2) {
      vy[i] = -vy[i] * (bnc[i] === 0 ? 0.24 : 0.5); vx[i] = vx[i] * 0.4 + (rnd() - 0.5) * 0.7; vz[i] = vz[i] * 0.4 + (rnd() - 0.5) * 0.7;
      if (bnc[i] === 0 && rnd() < 0.5) splash(x, s, z, 2);
      bnc[i]++; px[i] = x; py[i] = s + 0.002; pz[i] = z; return;
    }
    bnc[i] = REST; melt[i] = 0; px[i] = x; py[i] = s + size[i] * 0.4; pz[i] = z; vx[i] = vy[i] = vz[i] = 0;
  }

  /* ------------------------------------------------------------------ motion */
  function updateP(dt) {
    const x0 = C.X0 + 0.012, x1 = C.X1 - 0.012, z0 = C.Z0 + 0.012, z1 = C.Z1 - 0.012, fl = RM ? 0.5 : 1;
    const kr = Math.min(1, dt * 7), kw = Math.min(1, dt * 2.6), ks = Math.min(1, dt * 2.2), kf = Math.min(1, dt * 3.2), kh = Math.min(1, dt * 1.2);
    for (let i = nP - 1; i >= 0; i--) {
      const k = kind[i]; age[i] += dt;
      if (bnc[i] === REST) {                                    // lying snow and hail fade away
        melt[i] += dt * (k === K_HAIL ? 0.5 + 0.02 * Math.max(0, S.temp) : S.temp > 1 ? 1.4 : 0.7);
        if (melt[i] >= 1) killP(i);
        continue;
      }
      let x = px[i], y = py[i], z = pz[i];
      const w = wk(x, z), wx = windX[w], wz = windZ[w];
      if (k === K_RAIN) {
        vy[i] += (term[i] - vy[i]) * kr; vx[i] += (wx - vx[i]) * kw; vz[i] += (wz - vz[i]) * kw;
      } else if (k === K_SNOW) {
        vy[i] += (term[i] - vy[i]) * ks;
        const a = age[i] * 2.1 + ph[i];
        vx[i] += (wx * 1.05 + Math.sin(a) * 0.17 * fl - vx[i]) * kf; vz[i] += (wz * 1.05 + Math.cos(a * 0.77 + 1.3) * 0.13 * fl - vz[i]) * kf;
        if (!frozenAt(y)) {                                   // mild air below: the flake melts into a drop
          melt[i] += dt * Math.max(0.35, -vy[i]) / 0.3;
          if (melt[i] >= 1) { kind[i] = K_RAIN; term[i] = -(5.2 + rnd() * 1.6); size[i] = 0.004 + rnd() * 0.003; nSnow--; nRain++; melt[i] = 0; }
        }
      } else {
        vy[i] = Math.max(term[i], vy[i] - 14 * dt); vx[i] += (wx - vx[i]) * kh; vz[i] += (wz - vz[i]) * kh;
      }
      x += vx[i] * dt; y += vy[i] * dt; z += vz[i] * dt;
      if (x < x0) { x = x0; if (vx[i] < 0) vx[i] = 0; } else if (x > x1) { x = x1; if (vx[i] > 0) vx[i] = 0; }
      if (z < z0) { z = z0; if (vz[i] < 0) vz[i] = 0; } else if (z > z1) { z = z1; if (vz[i] > 0) vz[i] = 0; }
      if (y < 4.9 && vy[i] < 0) {
        const g = T.height(x, z);
        if (y < g + 0.75) { const s = surface(x, z); if (y <= s) { land(i, x, s, z); continue; } }
      }
      if (age[i] > 30 || y < C.Y0) { killP(i); continue; }
      px[i] = x; py[i] = y; pz[i] = z;
    }
  }
  function updateF(dt) {
    const dg = Math.exp(-dt * 1.3);
    for (let i = nF - 1; i >= 0; i--) {
      fAge[i] += dt; if (fAge[i] >= fLife[i]) { killF(i); continue; }
      const k = fK[i];
      if (k === K_DROP) {
        fVY[i] -= 9 * dt; fX[i] += fVX[i] * dt; fY[i] += fVY[i] * dt; fZ[i] += fVZ[i] * dt;
        if (fVY[i] < 0 && fY[i] < fGy[i]) killF(i);
      } else if (k === K_SPARK) {
        fVY[i] -= 5.5 * dt; fVX[i] *= dg; fVY[i] *= dg; fVZ[i] *= dg;
        fX[i] += fVX[i] * dt; fY[i] += fVY[i] * dt; fZ[i] += fVZ[i] * dt;
        const g = T.height(U.clamp(fX[i], C.X0, C.X1), U.clamp(fZ[i], C.Z0, C.Z1));
        if (fY[i] < g + 0.004 && fVY[i] < 0) { if (fB[i]) { killF(i); continue; } fB[i] = 1; fY[i] = g + 0.004; fVY[i] *= -0.28; fVX[i] *= 0.45; fVZ[i] *= 0.45; }
        fVar[i] = 1 - fAge[i] / fLife[i];
      } else if (k === K_DUST) {
        const w = wk(fX[i], fZ[i]), f = Math.min(1, dt * 1.6);
        fVX[i] += (windX[w] * 0.8 - fVX[i]) * f; fVZ[i] += (windZ[w] * 0.8 - fVZ[i]) * f;
        fVY[i] = fVY[i] * Math.exp(-dt * 0.9) - (fVar[i] > 0.5 ? 0.35 : 0.02) * dt;
        fX[i] += fVX[i] * dt; fY[i] += fVY[i] * dt; fZ[i] += fVZ[i] * dt;
        if (fVar[i] < 0.5) fSize[i] *= 1 + dt * 0.75;
        if (fX[i] < C.X0 + 0.02 || fX[i] > C.X1 - 0.02 || fZ[i] < C.Z0 + 0.02 || fZ[i] > C.Z1 - 0.02) { fX[i] = U.clamp(fX[i], C.X0 + 0.02, C.X1 - 0.02); fZ[i] = U.clamp(fZ[i], C.Z0 + 0.02, C.Z1 - 0.02); fVX[i] *= -0.3; fVZ[i] *= -0.3; }
      } else if (k === K_EMBER) {
        fY[i] += fVY[i] * dt; fVY[i] *= Math.exp(-dt * 2);
      }
    }
  }

  /* ------------------------------------------------------------------ the shared particle draw */
  let pMesh, pGeo, iA, iB, iC, pMat;
  const NI = NP + NF;
  function buildParticles() {
    pGeo = new THREE.InstancedBufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]), 3));
    pGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
    pGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2));
    pGeo.setIndex([0, 1, 2, 2, 1, 3]);
    const mk = () => { const a = new THREE.InstancedBufferAttribute(new Float32Array(NI * 4), 4); a.setUsage(THREE.DynamicDrawUsage); return a; };
    iA = mk(); iB = mk(); iC = mk();
    pGeo.setAttribute('iA', iA); pGeo.setAttribute('iB', iB); pGeo.setAttribute('iC', iC);
    pGeo.instanceCount = 0;
    pMat = WG.mat.unlit({
      name: 'precip', transparent: true, premultiplied: true, depthWrite: false, side: THREE.DoubleSide, shadow: false,
      uniforms: { uShutter: { value: 0.042 }, uRainK: { value: 1 }, uHaze: { value: 0.012 } },
      vertexDecl: /* glsl */ `attribute vec4 iA; attribute vec4 iB; attribute vec4 iC; uniform float uShutter;
        varying vec2 vQ; varying vec4 vK; varying vec2 vE;`,
      vertexEnd: /* glsl */ `{
        float kd = iA.w; vec3 P0 = iA.xyz; vec3 vel = iB.xyz; float sz = iB.w;
        vec3 cR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 cU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        float wpp = 2.0 * length(cameraPosition - P0) / (projectionMatrix[1][1] * uRes.y);   /* world units per pixel */
        vec3 wp; float fade = 1.0; float e2 = 1.0;
        bool streak = kd < 0.5 || abs(kd - 2.0) < 0.5 || abs(kd - 4.0) < 0.5 || abs(kd - 5.0) < 0.5;
        if (streak) {
          /* a camera-facing capsule from where it was a shutter-time ago to where it is */
          vec3 tail = P0 - vel * uShutter * (kd > 4.5 ? 2.2 : kd > 1.5 && kd < 2.5 ? 0.6 : 1.0);
          vec3 ax = P0 - tail; float len = length(ax);
          vec3 vd = normalize(P0 - cameraPosition);
          vec3 dir = len > 1e-6 ? ax / len : cU;
          vec3 sd = cross(dir, vd); float sl = length(sd); sd = sl > 1e-4 ? sd / sl : cR;
          float w = max(sz, wpp * 1.2); fade = sz / w;
          float hw = w * 0.5;
          e2 = len * 0.5 / hw;
          wp = (P0 + tail) * 0.5 + dir * position.y * (len * 0.5 + hw) + sd * position.x * hw;
          vQ = vec2(position.x, position.y * (e2 + 1.0));
        } else if (abs(kd - 7.0) < 0.5) {
          /* a patch lying on the ground, oriented by the land's normal */
          vec3 n = normalize(vel + vec3(0.0, 1e-4, 0.0));
          vec3 t1 = normalize(cross(n, vec3(0.0, 0.0, 1.0))); vec3 t2 = cross(t1, n);
          wp = P0 + n * 0.006 + (t1 * position.x + t2 * position.y) * sz;
          vQ = position.xy; e2 = 1.0;
        } else {
          float s = max(sz, wpp * 1.7); fade = sz / s; e2 = fade;
          wp = P0 + (cR * position.x + cU * position.y) * s * 0.5;
          if (abs(kd - 3.0) < 0.5) wp += cU * s * 0.5;           /* splashes stand on the ground */
          vQ = position.xy;
          fade *= fade;
        }
        vE = vec2(iC.w * fade, e2);
        vK = vec4(kd, iC.x, iC.y, iC.z);
        vW = wp;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
      fragDecl: /* glsl */ `varying vec2 vQ; varying vec4 vK; varying vec2 vE; uniform float uRainK; uniform float uHaze;`,
      frag: /* glsl */ `
        float kd = vK.x, t = vK.y;
        vec3 rd = normalize(P - cameraPosition);
        float fw = pow(max(dot(rd, uSunDir), 0.0), 7.0);            /* lit from behind: forward scattering */
        float csh = wgCloudShadow(P);
        vec3 fl = uFlashCol / (1.0 + dot(P - uFlashPos, P - uFlashPos) * 0.035);
        vec3 sunL = uSunCol * mix(0.3, 1.0, csh);
        vec3 waterL = uSkyCol * 1.5 + uEnvCol * 0.5 + uFillCol * 2.0 + sunL * (0.12 + 3.0 * fw) + fl * 0.6;
        vec3 iceL = sunL * (0.55 + 1.3 * fw) + uSkyCol * 1.6 + uGndCol * 0.7 + uFillCol * 2.0 + fl * 0.8;
        float cap = length(vec2(vQ.x, max(abs(vQ.y) - vE.y, 0.0)));
        alpha = 0.0; col = vec3(0.0);
        if (kd < 0.5 || abs(kd - 4.0) < 0.5) {
          /* raindrops and splash droplets: thin bright streaks */
          float a = exp(-cap * cap * 2.2) * vE.x;
          float along = clamp((vQ.y + vE.y) / max(2.0 * vE.y, 1e-3), 0.0, 1.0);
          a *= mix(0.3, 1.0, along);
          vec3 Lr = vK.w > 0.5 ? vec3(0.72, 0.86, 1.0) * 3.0 + fl : waterL;
          col = Lr * a * uRainK * (vK.w > 0.5 ? 1.0 : 0.38); alpha = a * 0.08;
        } else if (kd < 1.5) {
          /* a snowflake: six-fold, tumbling (it turns edge-on now and then) */
          vec2 q = vQ; float an = vK.z, cs = cos(an), sn = sin(an);
          q = mat2(cs, -sn, sn, cs) * q;
          q.x /= max(0.3, abs(cos(an * 0.61 + 1.0)));
          float r = length(q), a6 = atan(q.y, q.x);
          float shp = mix(1.0, 0.7 + 0.3 * cos(6.0 * a6), smoothstep(0.35, 0.8, vE.y));
          float a = smoothstep(1.0, 0.4, r / shp) * vE.x * (1.0 - 0.55 * vK.w);
          col = iceL * 0.95 * a; alpha = a * 0.9;
        } else if (kd < 2.5) {
          /* a hailstone: a small white ball, a short streak when falling fast */
          float a = smoothstep(1.0, 0.55, cap) * vE.x;
          float sh = 0.75 + 0.25 * clamp(-vQ.x * 0.7 + 0.5, 0.0, 1.0);
          col = (iceL * 0.92 + vec3(0.05)) * sh * a; alpha = a * 0.95;
        } else if (kd < 3.5) {
          /* the crown of a splash: a flaring cup that throws a ring of droplets */
          float yy = (vQ.y + 1.0) * 0.5, st = sqrt(t), r = mix(0.28, 0.95, st), h = mix(0.25, 0.8, st);
          float wx = r * (0.45 + 0.55 * clamp(yy / h, 0.0, 1.0));
          float wall = exp(-pow((abs(vQ.x) - wx) * 6.0, 2.0)) * step(yy, h) * (0.35 + 0.65 * yy / h);
          float dots = 0.0;
          for (int i = 0; i < 5; i++) { float fi = float(i); vec2 d2 = vec2(vQ.x - (fi - 2.0) * 0.5 * r * 1.1, yy - (h + 0.06 + 0.1 * t * (1.0 - abs(fi - 2.0) * 0.3))); dots += exp(-dot(d2, d2) * 150.0); }
          float a = (wall * 0.75 + dots) * (1.0 - t * t) * mix(1.0, 0.75, step(0.5, vE.y)) * vE.x;
          a = max(a, (1.0 - smoothstep(0.0, 1.0, length(vQ - vec2(0.0, -0.5)))) * (1.0 - t) * (1.0 - vE.y) * vE.x);   /* tiny on screen: a blip */
          col = waterL * a * 1.1 * uRainK; alpha = a * 0.2;
        } else if (kd < 5.5) {
          /* a spark: white-hot, cooling to orange */
          float a = exp(-cap * cap * 2.0) * vE.x, h = vK.w;
          col = mix(vec3(1.0, 0.3, 0.05) * 2.6, vec3(1.0, 0.92, 0.82) * 20.0, h * h) * a;
        } else if (kd < 6.5) {
          /* a glowing ember */
          float r = length(vQ), fk = 0.55 + 0.45 * sin(uTime * 23.0 + vK.z * 7.0) * sin(uTime * 11.0 + vK.z * 3.0);
          float a = exp(-r * r * 5.0) * vE.x * fk * (1.0 - t) * (1.0 - smoothstep(0.85, 1.0, r));
          col = vec3(1.0, 0.36, 0.07) * 6.0 * a;
        } else if (kd < 7.5) {
          /* the scorch patch: charred ground with embers glowing out */
          vec2 q = vQ; float r = length(q) * (1.0 + 0.3 * (wgNoise(q * 2.7 + vK.z * 10.0) - 0.5));
          float dark = smoothstep(1.0, 0.3, r) * 0.78 * (1.0 - smoothstep(0.6, 1.0, t));
          float e = pow(wgNoise(q * 7.5 + vK.z * 13.0), 3.0) * 2.2 * smoothstep(0.9, 0.15, r);
          float glow = e * (1.0 - smoothstep(0.0, 0.62, t)) * (0.7 + 0.3 * sin(uTime * 17.0 + q.x * 9.0 + q.y * 5.0));
          col = vec3(1.0, 0.32, 0.06) * 7.0 * glow * vE.x + vec3(0.012, 0.009, 0.007) * dark;
          alpha = dark * vE.x;
        } else if (kd < 8.5) {
          /* snow dust: a soft puff, or a glinting grain */
          float r = length(vQ);
          float a = exp(-r * r * (vK.w > 0.5 ? 4.0 : 3.0)) * (vK.w > 0.5 ? 0.95 : 0.3) * smoothstep(0.0, 0.12, t) * (1.0 - t) * vE.x * (1.0 - smoothstep(0.8, 1.0, r));
          col = iceL * a; alpha = a * 0.85;
        } else {
          /* the burst of light where a bolt strikes */
          float r = length(vQ), k = 1.0 - t; k = k * k * k;
          float g = exp(-r * r * 9.0) + 0.18 * exp(-r * 3.5);
          col = vec3(0.86, 0.9, 1.0) * 22.0 * g * k * (1.0 - smoothstep(0.85, 1.0, r));
        }
        /* drawn after the air, so fade with the haze along the part of the view ray inside the case */
        { vec3 rv = P - cameraPosition; float dd = length(rv); vec3 iv = dd / rv;
          vec3 t0 = (vec3(-6.0, -1.8, -4.0) - cameraPosition) * iv, t1 = (vec3(6.0, 7.4, 4.0) - cameraPosition) * iv;
          float tN = max(max(max(min(t0.x, t1.x), min(t0.y, t1.y)), min(t0.z, t1.z)), 0.0);
          float tr = exp(-uHaze * exp(-(P.y + 1.8) * 0.15) * max(dd - tN, 0.0) * 1.6);
          col *= tr; alpha *= tr; }`,
    });
    pMesh = new THREE.Mesh(pGeo, pMat);
    WG.add(pMesh, { pass: 'B', order: 4 });
  }
  const upd = (a, n) => { if (a.clearUpdateRanges) { a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(4, n * 4)); } a.needsUpdate = true; };
  function writeInstances() {
    const A = iA.array, B = iB.array, Cc = iC.array; let n = 0, nr = 0, ns = 0, nh = 0;
    for (let i = 0; i < nP; i++) {
      const o = n * 4, k = kind[i], rest = bnc[i] === REST;
      A[o] = px[i]; A[o + 1] = py[i]; A[o + 2] = pz[i]; A[o + 3] = k;
      B[o] = vx[i]; B[o + 1] = vy[i]; B[o + 2] = vz[i];
      if (k === K_RAIN) { B[o + 3] = size[i]; Cc[o] = 0; Cc[o + 1] = 0; Cc[o + 2] = 0; Cc[o + 3] = Math.min(1, age[i] / 0.07); nr++; }
      else if (k === K_SNOW) {
        B[o + 3] = size[i] * (rest ? 1 - melt[i] * 0.5 : 1 - melt[i] * 0.35);
        Cc[o] = 0; Cc[o + 1] = ph[i] + age[i] * (RM ? 0.6 : 1.7) * (rest ? 0 : 1); Cc[o + 2] = rest ? 0 : melt[i];
        Cc[o + 3] = Math.min(1, age[i] / 0.35) * (rest ? 1 - melt[i] : 1); ns++;
      } else { B[o + 3] = size[i] * (rest ? 1 - melt[i] * 0.8 : 1); Cc[o] = 0; Cc[o + 1] = 0; Cc[o + 2] = 0; Cc[o + 3] = rest ? Math.min(1, 2.5 - 2.5 * melt[i]) : 1; nh++; }
      n++;
    }
    for (let i = 0; i < nF; i++) {
      const o = n * 4, k = fK[i];
      A[o] = fX[i]; A[o + 1] = fY[i]; A[o + 2] = fZ[i]; A[o + 3] = k;
      B[o] = fVX[i]; B[o + 1] = fVY[i]; B[o + 2] = fVZ[i]; B[o + 3] = fSize[i];
      Cc[o] = fAge[i] / fLife[i]; Cc[o + 1] = fPh[i]; Cc[o + 2] = fVar[i]; Cc[o + 3] = k === K_DROP ? Math.min(1, 3 - 3 * fAge[i] / fLife[i]) : 1;
      n++;
    }
    pGeo.instanceCount = n; upd(iA, n); upd(iB, n); upd(iC, n);
    pMesh.visible = n > 0;
    const st = P.stats; st.rain = nr; st.snow = ns; st.hail = nh; st.fx = nF;
  }

  /* ------------------------------------------------------------------ lightning */
  const NSLOT = 2, SLOTP = 180;
  let bGeo, bMesh, bPos, bAB, bAI;
  const slots = [null, null];
  function buildBolts() {
    const nv = NSLOT * SLOTP * 2;
    bGeo = new THREE.BufferGeometry();
    bPos = new THREE.BufferAttribute(new Float32Array(nv * 3), 3); bPos.setUsage(THREE.DynamicDrawUsage);
    bAB = new THREE.BufferAttribute(new Float32Array(nv * 4), 4); bAB.setUsage(THREE.DynamicDrawUsage);
    bAI = new THREE.BufferAttribute(new Float32Array(nv * 4), 4); bAI.setUsage(THREE.DynamicDrawUsage);
    bGeo.setAttribute('position', bPos); bGeo.setAttribute('aB', bAB); bGeo.setAttribute('aI', bAI);
    bGeo.setIndex(new THREE.BufferAttribute(new Uint16Array(NSLOT * SLOTP * 6), 1)); bGeo.setDrawRange(0, 0);
    const m = WG.mat.unlit({
      name: 'lightning', additive: true, premultiplied: true, depthWrite: false, side: THREE.DoubleSide, shadow: false,
      vertexDecl: 'attribute vec4 aB; attribute vec4 aI; varying vec4 vB; varying vec4 vI;',
      vertexEnd: 'vB = aB; vI = aI;',
      fragDecl: 'varying vec4 vB; varying vec4 vI;',
      frag: /* glsl */ `
        float u = vB.x; float core = exp(-u * u * 7.0), halo = exp(-u * u * 1.6) * (1.0 - smoothstep(0.7, 1.0, abs(u)));
        /* the leader: a faint flickering thread racing down, brightest at its tip */
        float on = step(vB.y, vI.y);
        float lead = vI.z * on * (core * 0.8 + halo * 0.25) * (0.55 + 0.45 * sin(uTime * 173.0 + vB.y * 61.0)) * (0.5 + 2.5 * exp(-max(vI.y - vB.y, 0.0) * 22.0));
        vec3 white = vec3(0.8, 0.87, 1.0);
        col = white * (core + halo * 0.08) * vI.x * vB.z * 44.0
            + vec3(0.75, 0.85, 1.0) * lead * 2.6
            + vec3(0.68, 0.56, 1.0) * (core * 0.9 + halo * 0.5) * vI.w * vB.z * 0.75;
        alpha = 0.0;`,
    });
    bMesh = new THREE.Mesh(bGeo, m);
    WG.add(bMesh, { pass: 'B', order: 6 });
  }
  /* a jagged channel between two points by midpoint displacement */
  function jag(ax, ay, az, bx, by, bz, depth, rough) {
    let pts = [ax, ay, az, bx, by, bz];
    for (let d = 0; d < depth; d++) {
      const out = [], n = pts.length / 3;
      for (let j = 0; j < n - 1; j++) {
        const x0 = pts[j * 3], y0 = pts[j * 3 + 1], z0 = pts[j * 3 + 2], x1 = pts[j * 3 + 3], y1 = pts[j * 3 + 4], z1 = pts[j * 3 + 5];
        const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, l2 = dx * dx + dy * dy + dz * dz, len = Math.sqrt(l2) || 1e-4;
        let rx = rnd() - 0.5, ry = (rnd() - 0.5) * 0.6, rz = rnd() - 0.5; const dp = (rx * dx + ry * dy + rz * dz) / (l2 || 1);
        rx -= dx * dp; ry -= dy * dp; rz -= dz * dp; const rl = Math.hypot(rx, ry, rz) || 1;
        const off = len * rough * (rnd() + rnd() - 1);
        out.push(x0, y0, z0, (x0 + x1) * 0.5 + (rx / rl) * off, (y0 + y1) * 0.5 + (ry / rl) * off, (z0 + z1) * 0.5 + (rz / rl) * off);
      }
      out.push(pts[pts.length - 3], pts[pts.length - 2], pts[pts.length - 1]);
      pts = out;
    }
    return pts;
  }
  function keepAbove(pts, last) {
    const n = pts.length / 3;
    for (let j = 1; j < n - (last ? 1 : 0); j++) {
      const x = U.clamp(pts[j * 3], C.X0 + 0.04, C.X1 - 0.04), z = U.clamp(pts[j * 3 + 2], C.Z0 + 0.04, C.Z1 - 0.04);
      pts[j * 3] = x; pts[j * 3 + 2] = z; pts[j * 3 + 1] = Math.max(pts[j * 3 + 1], T.height(x, z) + 0.04);
    }
    return pts;
  }
  function addLine(b, pts, w, t0, ts, mask) {
    const n = pts.length / 3; if (b.np + n > SLOTP) return null;
    let tot = 0; for (let j = 1; j < n; j++) tot += Math.hypot(pts[j * 3] - pts[j * 3 - 3], pts[j * 3 + 1] - pts[j * 3 - 2], pts[j * 3 + 2] - pts[j * 3 - 1]);
    const s = b.np; let acc = 0;
    for (let j = 0; j < n; j++) {
      if (j > 0) acc += Math.hypot(pts[j * 3] - pts[j * 3 - 3], pts[j * 3 + 1] - pts[j * 3 - 2], pts[j * 3 + 2] - pts[j * 3 - 1]);
      b.pts[(s + j) * 3] = pts[j * 3]; b.pts[(s + j) * 3 + 1] = pts[j * 3 + 1]; b.pts[(s + j) * 3 + 2] = pts[j * 3 + 2];
      b.along[s + j] = t0 + ts * (tot > 0 ? acc / tot : 0);
    }
    const line = { s, n, w, mask, len: tot }; b.lines.push(line); b.np += n; return line;
  }
  /* where the bolt goes: the tallest tree under the cloud, else the lake under it, else the highest ground */
  function findTarget(c) {
    const R = c.R * 1.3, cx = U.clamp(c.x, C.X0 + 0.2, C.X1 - 0.2), cz = U.clamp(c.z, C.Z0 + 0.2, C.Z1 - 0.2);
    /* the trees part knows the live trees; if it is absent use the layout, if it is switched off or failed there are no trees */
    const F = WG.flora, tm = WG.mod ? WG.mod('trees') : null; let flora = false;
    if (F && F.tallestNear && (!tm || tm.ok)) {
      try { flora = true; const t = F.tallestNear(cx, cz, R); if (t && isFinite(t.x)) return { x: t.x, y: t.y, z: t.z, kind: 'tree', tree: t.tree || t, base: T.height(t.x, t.z) }; } catch (e) { flora = false; }
    }
    if (!flora && (!tm || tm.ok) && L.trees) {
      let best = null, bh = -1e9;
      for (const t of L.trees) { if (Math.hypot(t.x - cx, t.z - cz) < R) { const top = t.y + t.h; if (top > bh) { bh = top; best = t; } } }
      if (best) return { x: best.x, y: best.y + best.h, z: best.z, kind: 'tree', tree: best, base: best.y };
    }
    if (surface(cx, cz) >= 0 && hitK === 1 && T.waterAt(cx, cz) === 'lake') {
      for (let k = 0; k < 6; k++) { const a = rnd() * 6.283, r = rnd() * c.R * 0.45, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r; if (T.waterAt(x, z) === 'lake') return { x, y: S.lakeLevel, z, kind: 'lake', tree: null }; }
      return { x: cx, y: S.lakeLevel, z: cz, kind: 'lake', tree: null };
    }
    let bx = cx, bz = cz, by = -1e9;
    for (let k = 0; k < 32; k++) {
      const a = k * 2.39996 + rnd() * 0.3, r = Math.sqrt((k + 0.5) / 32) * c.R * 1.1, x = U.clamp(cx + Math.cos(a) * r, C.X0 + 0.1, C.X1 - 0.1), z = U.clamp(cz + Math.sin(a) * r, C.Z0 + 0.1, C.Z1 - 0.1);
      if (T.waterAt(x, z)) continue; const h = T.height(x, z); if (h > by) { by = h; bx = x; bz = z; }
    }
    if (by > -1e9) return { x: bx, y: by, z: bz, kind: 'ground', tree: null };
    return { x: cx, y: surface(cx, cz), z: cz, kind: 'lake', tree: null };
  }
  function strike(c, power) {
    if (!c || !bGeo) return null;
    power = U.clamp(power || 1, 0.2, 1.5);
    const tg = findTarget(c);
    let si = slots.indexOf(null);
    if (si < 0) { si = slots[0].t > slots[1].t ? 0 : 1; }
    const b = { slot: si, cloud: c, power, t: 0, pts: new Float32Array(SLOTP * 3), along: new Float32Array(SLOTP), np: 0, lines: [], tg, fired: -1 };
    /* the main channel from the cloud base to the target */
    const sx = U.clamp(c.x + (tg.x - c.x) * 0.25 + (rnd() - 0.5) * c.R * 0.4, C.X0 + 0.1, C.X1 - 0.1), sz = U.clamp(c.z + (tg.z - c.z) * 0.25 + (rnd() - 0.5) * c.R * 0.4, C.Z0 + 0.1, C.Z1 - 0.1);
    const sy = Math.max(c.baseY + 0.06, tg.y + 0.5);
    const main = keepAbove(jag(sx, sy, sz, tg.x, tg.y, tg.z, 5, 0.3), true);
    const ml = addLine(b, main, 1, 0, 1, 15);
    const mainLen = ml ? ml.len : 1, nm = main.length / 3;
    /* two to four downward forks, a few with a twig of their own */
    const nf = 2 + ((rnd() * 3) | 0);
    for (let f = 0; f < nf; f++) {
      const j = Math.round(U.lerp(0.14, 0.72, (f + rnd()) / nf) * (nm - 1)), bx0 = main[j * 3], by0 = main[j * 3 + 1], bz0 = main[j * 3 + 2];
      const a = rnd() * 6.283, drop = (by0 - tg.y) * (0.25 + rnd() * 0.35), out = drop * (0.45 + rnd() * 0.6);
      const ex = U.clamp(bx0 + Math.cos(a) * out, C.X0 + 0.08, C.X1 - 0.08), ez = U.clamp(bz0 + Math.sin(a) * out, C.Z0 + 0.08, C.Z1 - 0.08);
      const ey = Math.max(by0 - drop, T.height(ex, ez) + 0.2);
      const fp = keepAbove(jag(bx0, by0, bz0, ex, ey, ez, 4, 0.3), false);
      const mask = 1 | (rnd() < 0.55 ? 2 : 0) | (rnd() < 0.4 ? 4 : 0) | (rnd() < 0.3 ? 8 : 0);
      const t0 = b.along[(ml ? ml.s : 0) + j], fl = addLine(b, fp, 0.55, t0, Math.hypot(ex - bx0, ey - by0, ez - bz0) / mainLen * 1.3, mask);
      if (fl && rnd() < 0.6) {
        const nfp = fp.length / 3, jj = Math.round((0.3 + rnd() * 0.4) * (nfp - 1)), cx0 = fp[jj * 3], cy0 = fp[jj * 3 + 1], cz0 = fp[jj * 3 + 2];
        const a2 = a + (rnd() - 0.5) * 2.2, d2 = drop * (0.25 + rnd() * 0.3);
        const tx = U.clamp(cx0 + Math.cos(a2) * d2 * 0.8, C.X0 + 0.08, C.X1 - 0.08), tz = U.clamp(cz0 + Math.sin(a2) * d2 * 0.8, C.Z0 + 0.08, C.Z1 - 0.08);
        addLine(b, keepAbove(jag(cx0, cy0, cz0, tx, Math.max(cy0 - d2, T.height(tx, tz) + 0.2), tz, 3, 0.32), false), 0.3, b.along[fl.s + jj], d2 / mainLen * 1.3, mask);
      }
    }
    /* timing: the leader, the return stroke, two or three weaker re-strokes, then the violet afterglow */
    const lead = 0.065 + rnd() * 0.025;
    b.lead = lead; b.strokes = [{ t: lead, k: 1 }];
    if (!RM) { const ne = 2 + (rnd() < 0.5 ? 1 : 0); let tt = lead; const ks = [0.62, 0.42, 0.27]; for (let e = 0; e < ne; e++) { tt += 0.09 + rnd() * 0.06; b.strokes.push({ t: tt, k: ks[e] }); } }
    b.lastT = b.strokes[b.strokes.length - 1].t; b.end = b.lastT + 1.25;
    const fp = 0.62; b.flashPos = { x: U.lerp(sx, tg.x, fp), y: U.lerp(sy, tg.y, fp), z: U.lerp(sz, tg.z, fp) };
    slots[si] = b; rebuildIndex();
    P.bolts = slots.filter(Boolean); P.stats.bolts++;
    return b;
  }
  function rebuildIndex() {
    const idx = bGeo.index.array; let n = 0;
    for (let si = 0; si < NSLOT; si++) {
      const b = slots[si]; if (!b) continue;
      const base = si * SLOTP;
      for (const ln of b.lines) for (let j = 0; j < ln.n - 1; j++) {
        const a0 = (base + ln.s + j) * 2, a1 = a0 + 1, b0 = a0 + 2, b1 = a0 + 3;
        idx[n++] = a0; idx[n++] = b0; idx[n++] = a1; idx[n++] = a1; idx[n++] = b0; idx[n++] = b1;
      }
    }
    bGeo.index.needsUpdate = true; bGeo.setDrawRange(0, n);
  }
  const cp = new THREE.Vector3();
  function fire(b, j) {
    const st = b.strokes[j], k = st.k * b.power * (RM ? 0.6 : 1);
    S.flash = Math.min(1.2, Math.max(S.flash, k)); S.flashPos.set(b.flashPos.x, b.flashPos.y, b.flashPos.z);
    if (j !== 0) return;
    const tg = b.tg;
    impact(b, tg);
    let dist = 15, pan = 0;
    if (WG.camera) dist = WG.camera.position.distanceTo(cp.set(tg.x, tg.y, tg.z));
    if (WG.cam && WG.cam.panOf) pan = WG.cam.panOf(tg.x, tg.y, tg.z);
    const ev = { x: tg.x, y: tg.y, z: tg.z, power: b.power, cloud: b.cloud, target: tg.kind, tree: tg.tree || null, dist, pan };
    P.last = ev;
    WG.bus.emit('lightning', ev);
  }
  function impact(b, tg) {
    addFx(K_BURST, tg.x, tg.y + 0.04, tg.z, 0, 0, 0, 0.55 * b.power, 0.22, 0);
    const F = WG.flora; if (F && F.shakeAt) { try { F.shakeAt(tg.x, tg.z, 1, 0.8); } catch (e) { /* ignore */ } }
    if (tg.kind === 'lake') {
      const w = WG.water; if (w && w.splash) { try { w.splash(tg.x, tg.z, 1); } catch (e) { /* ignore */ } }
      for (let k = 0; k < 4; k++) ring(tg.x + (rnd() - 0.5) * 0.15, tg.z + (rnd() - 0.5) * 0.15, 0.4, true);
      const n = 54;
      for (let k = 0; k < n; k++) { const a = rnd() * 6.283, sp = 0.25 + rnd() * 0.9; addFx(K_DROP, tg.x, tg.y + 0.02, tg.z, Math.cos(a) * sp, 1.3 + rnd() * 1.7, Math.sin(a) * sp, 0.006 + rnd() * 0.006, 1.3, 1, tg.y); }
      return;
    }
    /* sparks from the strike point, white-hot cooling to orange */
    const ns = 46 + ((rnd() * 20) | 0);
    for (let k = 0; k < ns; k++) {
      const a = rnd() * 6.283, up = 0.3 + rnd() * 0.9, sp = 1.0 + rnd() * 2.6, h = Math.sqrt(1 - up * up * 0.5);
      addFx(K_SPARK, tg.x, tg.y + 0.02, tg.z, Math.cos(a) * sp * h, sp * up, Math.sin(a) * sp * h, 0.006 + rnd() * 0.005, 0.35 + rnd() * 0.65, 1);
    }
    /* a scorch patch of glowing embers where it hit the ground (at the foot of a struck tree) */
    const gx = tg.x, gz = tg.z, gy = tg.kind === 'tree' ? tg.base : tg.y, nrm = T.normal(gx, gz, {});
    addFx(K_SCORCH, gx, gy, gz, nrm.x, nrm.y, nrm.z, 0.17 + 0.05 * b.power, 2.6, rnd() * 10);
    const ne = 12 + ((rnd() * 8) | 0);
    for (let k = 0; k < ne; k++) { const a = rnd() * 6.283, r = Math.sqrt(rnd()) * 0.13, x = gx + Math.cos(a) * r, z = gz + Math.sin(a) * r; addFx(K_EMBER, x, T.height(x, z) + 0.012, z, 0, 0.03 * rnd(), 0, 0.022 + rnd() * 0.02, 1.0 + rnd() * 1.1, rnd() * 10); }
    if (tg.kind === 'tree') for (let k = 0; k < 9; k++) { const a = rnd() * 6.283, r = rnd() * 0.08; addFx(K_EMBER, tg.x + Math.cos(a) * r, tg.y - rnd() * 0.25, tg.z + Math.sin(a) * r, 0, 0.05, 0, 0.022 + rnd() * 0.015, 0.8 + rnd() * 0.8, rnd() * 10); }
  }
  const env = (x) => (x < 0 ? 0 : Math.exp(-x * 26));
  function updateBolts(dt) {
    if (!bMesh || !WG.camera) return;
    let any = false, rebuild = false;
    for (let si = 0; si < NSLOT; si++) {
      const b = slots[si]; if (!b) continue;
      b.t += dt;
      for (let j = b.fired + 1; j < b.strokes.length; j++) if (b.t >= b.strokes[j].t) { b.fired = j; fire(b, j); }
      if (b.t > b.end) { slots[si] = null; rebuild = true; continue; }
      any = true;
    }
    if (rebuild) { rebuildIndex(); P.bolts = slots.filter(Boolean); }
    bMesh.visible = any;
    if (!any) return;
    /* expand the channels into ribbons facing the camera */
    const cam = WG.camera, pos = bPos.array, AB = bAB.array, AI = bAI.array, cpx = cam.position.x, cpy = cam.position.y, cpz = cam.position.z;
    const e5 = cam.projectionMatrix.elements[5], H = (WG.render && WG.render.height) || 600;
    for (let si = 0; si < NSLOT; si++) {
      const b = slots[si]; if (!b) continue;
      const base = si * SLOTP, t = b.t, leadOn = t < b.lead;
      const cut = leadOn ? Math.min(1, Math.floor((t / b.lead) * 9 + rnd() * 0.6) / 8) : 1;
      const glow = t < b.lead ? 0 : U.smooth(b.lead, b.lead + 0.05, t) * (1 - U.smooth(b.lastT, b.lastT + 1.05, t)) * b.power;
      const mid = b.flashPos, dist = Math.hypot(mid.x - cpx, mid.y - cpy, mid.z - cpz), wpp = (2 * dist) / (e5 * H);
      for (const ln of b.lines) {
        let fI = 0;
        for (let j = 0; j <= b.fired; j++) { if (ln.mask & (1 << j)) fI += b.strokes[j].k * env(t - b.strokes[j].t) * (0.82 + 0.18 * Math.sin((t - b.strokes[j].t) * 260)); }
        if (b.fired >= 0 && t < b.lastT + 0.12) fI += 0.03;
        fI *= b.power;
        const hw = Math.max(0.03 * Math.sqrt(ln.w), wpp * (1.4 + 1.2 * ln.w)) * (leadOn ? 0.7 : 1);
        for (let j = 0; j < ln.n; j++) {
          const p = (ln.s + j) * 3, jp = j > 0 ? p - 3 : p, jn = j < ln.n - 1 ? p + 3 : p;
          let tx = b.pts[jn] - b.pts[jp], ty = b.pts[jn + 1] - b.pts[jp + 1], tz = b.pts[jn + 2] - b.pts[jp + 2];
          const x = b.pts[p], y = b.pts[p + 1], z = b.pts[p + 2], dx = x - cpx, dy = y - cpy, dz = z - cpz;
          let sx = ty * dz - tz * dy, sy = tz * dx - tx * dz, sz = tx * dy - ty * dx; const sl = Math.hypot(sx, sy, sz) || 1;
          sx *= hw / sl; sy *= hw / sl; sz *= hw / sl;
          const v = (base + ln.s + j) * 2, o3 = v * 3, o4 = v * 4;
          pos[o3] = x - sx; pos[o3 + 1] = y - sy; pos[o3 + 2] = z - sz; pos[o3 + 3] = x + sx; pos[o3 + 4] = y + sy; pos[o3 + 5] = z + sz;
          const al = b.along[ln.s + j];
          AB[o4] = -1; AB[o4 + 1] = al; AB[o4 + 2] = ln.w; AB[o4 + 3] = 0; AB[o4 + 4] = 1; AB[o4 + 5] = al; AB[o4 + 6] = ln.w; AB[o4 + 7] = 0;
          AI[o4] = AI[o4 + 4] = fI; AI[o4 + 1] = AI[o4 + 5] = cut; AI[o4 + 2] = AI[o4 + 6] = leadOn ? 1 : 0; AI[o4 + 3] = AI[o4 + 7] = glow;
        }
      }
    }
    bPos.needsUpdate = true; bAB.needsUpdate = true; bAI.needsUpdate = true;
  }

  /* ------------------------------------------------------------------ snow dust rising under the wind tool */
  function dust(x, z, speed) {
    const sn = W.snowAt(U.clamp(x, C.X0, C.X1), U.clamp(z, C.Z0, C.Z1)); if (sn < 0.12) return;
    const sp = U.clamp(speed || 1, 0.2, 4);
    let n = Math.min(dustBudget | 0, Math.round(1 + sn * sp * 1.6)); dustBudget -= n;
    for (let k = 0; k < n; k++) {
      const ox = U.clamp(x + (rnd() - 0.5) * 0.4, C.X0 + 0.05, C.X1 - 0.05), oz = U.clamp(z + (rnd() - 0.5) * 0.4, C.Z0 + 0.05, C.Z1 - 0.05);
      if (W.snowAt(ox, oz) < 0.1) continue;
      const g = T.height(ox, oz), w = wk(ox, oz);
      addFx(K_DUST, ox, g + 0.02, oz, windX[w] * 0.6, 0.12 + rnd() * 0.12 * sp, windZ[w] * 0.6, 0.07 + rnd() * 0.07, 1.3 + rnd() * 1.1, 0);
      for (let q = 0; q < 3; q++) addFx(K_DUST, ox + (rnd() - 0.5) * 0.08, g + 0.02, oz + (rnd() - 0.5) * 0.08, windX[w] * 0.5 + (rnd() - 0.5) * 0.3, 0.25 + rnd() * 0.35 * sp, windZ[w] * 0.5 + (rnd() - 0.5) * 0.3, 0.008 + rnd() * 0.006, 0.9 + rnd() * 0.9, 1);
    }
  }
  P.dust = (x, z, speed) => { dustBudget = Math.max(dustBudget, 12); dust(x, z, speed); };

  /* ------------------------------------------------------------------ public */
  P.strike = (c, power) => strike(c || (WG.clouds && WG.clouds.list[0]), power);
  P.count = () => nP + nF;

  WG.register('precip', {
    init() {
      buildWaterMap(); sampleWind();
      buildParticles(); buildBolts();
      WG.bus.on('cloud:strike', (e) => { if (e && e.cloud) strike(e.cloud, e.power); });
      WG.bus.on('wind:sweep', (e) => { if (e && isFinite(e.x) && isFinite(e.z)) dust(e.x, e.z, e.speed); });
      writeInstances();
    },
    update(dt) {
      ringBudget = Math.min(ringBudget + dt * 240, 30); dustBudget = Math.min(dustBudget + dt * 70, 30);
      sampleWind();
      emit(dt);
      updateP(dt);
      updateF(dt);
      updateBolts(dt);
      flush(dt);
      pMat.uniforms.uRainK.value = P.rainK;
      if (WG.sky && isFinite(WG.sky.hazeDen)) pMat.uniforms.uHaze.value = WG.sky.hazeDen;
      writeInstances();
    },
  });
})();
