/* Weatherglass — the land as pure functions: height field, lake, river, masks and the fixed layout of everything that stands on it.
   Everything here is deterministic, so the landscape is identical on every load. */
(function () {
  'use strict';
  const WG = window.WG, THREE = WG.THREE, U = WG.util, C = WG.C;
  const T = (WG.terrain = {});
  const L = (WG.layout = {});
  WG.perches = []; // {x,y,z, sheltered:boolean, kind:string} — filled by flora and props, read by the birds

  /* ---------------- lake ---------------- */
  const LAKE = (L.lake = { cx: 2.75, cz: 2.65, rx: 2.35, rzBack: 1.75, rzFront: 2.6, depth: 1.0 });
  /* normalised radius: 1 on the resting shoreline, <1 in the water */
  T.lakeR = (x, z) => {
    const dx = (x - LAKE.cx) / LAKE.rx, dzr = z - LAKE.cz, dz = dzr / (dzr > 0 ? LAKE.rzFront : LAKE.rzBack);
    const r = Math.hypot(dx, dz), a = Math.atan2(dz, dx), west = Math.max(0, -Math.cos(a));
    const wob = 1 + 0.05 * Math.sin(a * 3 - 0.9) + 0.035 * Math.sin(a * 5 - 2.3) + 0.02 * Math.sin(a * 8 + 4.1) + 0.07 * west * west;
    return r / wob;
  };

  /* ---------------- waterfall, pool, river ---------------- */
  const FALL = (L.fall = { x: -1.5, zLip: -2.2, yTop: 2.2, yPool: 1.16, width: 0.25, springX: -1.5, springZ: -2.95 });
  const POOL = (L.pool = { x: -1.5, z: -1.8, r: 0.36, y: FALL.yPool });
  const RP = [[-1.5, -1.62], [-1.24, -1.02], [-0.42, -0.66], [0.02, 0.1], [0.92, 0.72], [1.4, 1.5], [2.0, 2.0]];
  const river = (L.river = { pts: [], n: 0, len: 0, sShore: 0.86 });
  (function buildRiver() {
    const cr = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
    const raw = [], N = 26;
    for (let i = 0; i < RP.length - 1; i++) {
      const a = RP[Math.max(0, i - 1)], b = RP[i], c = RP[i + 1], d = RP[Math.min(RP.length - 1, i + 2)];
      for (let k = 0; k < N; k++) { const t = k / N; raw.push([cr(a[0], b[0], c[0], d[0], t), cr(a[1], b[1], c[1], d[1], t)]); }
    }
    raw.push(RP[RP.length - 1]);
    let len = 0; const cum = [0];
    for (let i = 1; i < raw.length; i++) { len += Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]); cum.push(len); }
    const STEPS = 6;
    for (let i = 0; i < raw.length; i++) {
      const s = cum[i] / len, sr = U.sat(s / river.sShore);
      const st = sr * STEPS, fl = Math.floor(st), fr = st - fl;
      const prof = Math.min(STEPS, fl + U.smooth(0.62, 0.98, fr) * 0.82 + fr * 0.18) / STEPS; // flat reach, then a short steeper step
      const y = U.lerp(POOL.y, C.LAKE, prof);
      const w = 0.2 + 0.3 * Math.pow(s, 1.15);
      const j = Math.min(raw.length - 1, i + 1), k = Math.max(0, i - 1);
      let tx = raw[j][0] - raw[k][0], tz = raw[j][1] - raw[k][1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      river.pts.push({ x: raw[i][0], z: raw[i][1], y, w, s, tx, tz, steep: 0 });
    }
    for (let i = 1; i < river.pts.length - 1; i++) river.pts[i].steep = U.sat((river.pts[i - 1].y - river.pts[i + 1].y) / (2 * len / river.pts.length) * 1.6);
    river.n = river.pts.length; river.len = len;
  })();
  /* nearest point on the river centre line: {d, s, y, w, i, side} */
  const _ri = { d: 99, s: 0, y: 0, w: 0, i: 0, side: 0, steep: 0 };
  T.riverInfo = (x, z, out) => {
    out = out || _ri; let best = 1e9, bi = 0; const p = river.pts;
    for (let i = 0; i < p.length; i += 2) { const dx = x - p[i].x, dz = z - p[i].z, d = dx * dx + dz * dz; if (d < best) { best = d; bi = i; } }
    for (let i = Math.max(0, bi - 2); i <= Math.min(p.length - 1, bi + 2); i++) { const dx = x - p[i].x, dz = z - p[i].z, d = dx * dx + dz * dz; if (d < best) { best = d; bi = i; } }
    const q = p[bi];
    out.d = Math.sqrt(best); out.s = q.s; out.y = q.y; out.w = q.w; out.i = bi; out.steep = q.steep;
    out.side = (x - q.x) * -q.tz + (z - q.z) * q.tx; // signed distance, + on the left bank looking downstream
    return out;
  };
  T.riverAt = (s) => { const p = river.pts, f = U.sat(s) * (p.length - 1), i = Math.min(p.length - 2, Math.floor(f)), t = f - i, a = p[i], b = p[i + 1]; return { x: U.lerp(a.x, b.x, t), z: U.lerp(a.z, b.z, t), y: U.lerp(a.y, b.y, t), w: U.lerp(a.w, b.w, t), tx: a.tx, tz: a.tz, s }; };

  /* ---------------- fixed things ---------------- */
  L.cabin = { x: -2.95, z: 1.35, rot: Math.PI / 6, len: 0.7, dep: 0.5, ridge: 0.6, padY: 0.71 };
  L.jetty = (function () { const x0 = -0.05, z0 = 2.4, dx = LAKE.cx - 0, dz = LAKE.cz - 2.4, l = Math.hypot(dx, dz), len = 0.85; return { x0, z0, x1: x0 + (dx / l) * len, z1: z0 + (dz / l) * len, dx: dx / l, dz: dz / l, len, width: 0.17 }; })();
  L.boat = { x: L.jetty.x1 + 0.2, z: L.jetty.z1 - 0.24, len: 0.34 };
  L.boulders = [[-4.7, 2.75, 0.3], [-1.35, 3.05, 0.27], [4.95, 0.35, 0.33], [0.95, -0.6, 0.26], [-4.3, -0.15, 0.31], [3.6, -0.1, 0.28]].map((b, i) => ({ x: b[0], z: b[1], r: b[2], seed: 100 + i }));
  const stoneS = 0.4;
  const ford = (function () { const p = T.riverAt(stoneS), o = p.w * 0.5 + 0.2; return { near: [p.x - p.tz * o, p.z + p.tx * o], far: [p.x + p.tz * o, p.z - p.tx * o] }; })();
  L.paths = [
    { w: 0.2, pts: [[-2.72, 1.74], [-2.35, 2.0], [-1.7, 2.24], [-0.9, 2.4], [-0.25, 2.42], [0.0, 2.4]] },   // door -> jetty
    { w: 0.13, pts: [[-2.5, 1.35], [-2.1, 0.98], [-1.55, 0.6], [(ford.near[0] - 1.55) * 0.5 - 0.1, (ford.near[1] + 0.6) * 0.5 + 0.05], ford.near] },   // cabin -> stepping stones
    { w: 0.12, pts: [ford.far, [ford.far[0] + 0.3, ford.far[1] - 0.26], [ford.far[0] + 0.62, ford.far[1] - 0.5], [ford.far[0] + 0.85, ford.far[1] - 0.84]] },   // stub on the far bank
  ];
  const distSeg = (x, z, ax, az, bx, bz) => { const vx = bx - ax, vz = bz - az, wx = x - ax, wz = z - az; const t = U.sat((wx * vx + wz * vz) / (vx * vx + vz * vz || 1)); return Math.hypot(wx - vx * t, wz - vz * t); };
  T.pathDist = (x, z) => { let best = 9, bw = 0.15; for (const p of L.paths) for (let i = 0; i < p.pts.length - 1; i++) { const d = distSeg(x, z, p.pts[i][0], p.pts[i][1], p.pts[i + 1][0], p.pts[i + 1][1]) / p.w; if (d < best) { best = d; bw = p.w; } } return best; }; // in path-widths: <0.5 is on the path

  /* ---------------- height ---------------- */
  const PEAKS = [[-3.4, -2.9, 4.0, 2.35], [-0.5, -3.25, 3.0, 1.95], [2.0, -2.35, 3.3, 2.15], [4.5, -3.0, 2.5, 1.95], [-5.4, -1.7, 1.5, 1.35]];
  const _r2 = { d: 0, s: 0, y: 0, w: 0, i: 0, side: 0, steep: 0 };
  function rawHeight(x, z, info) {
    let h = 0.6 + 0.055 * U.fbm(x * 0.45 + 3.1, z * 0.45 - 1.7, 3, 11) + 0.018 * U.fbm(x * 1.7, z * 1.7, 2, 23);
    h += 0.16 * U.smooth(-3.8, -6, x);
    h += 0.62 * Math.pow(U.smooth(0.6, -3.2, z), 1.3);
    h += 0.13 * Math.exp(-((x - L.cabin.x) ** 2 + (z - L.cabin.z) ** 2) / 1.5);
    /* mountains */
    const wx = x + 0.42 * U.fbm(x * 0.62, z * 0.62, 3, 41) + 0.12 * U.fbm(x * 2.1, z * 2.1, 2, 45), wz = z + 0.42 * U.fbm(x * 0.62 + 9, z * 0.62 + 4, 3, 43) + 0.12 * U.fbm(x * 2.1 + 3, z * 2.1 + 8, 2, 47);
    let acc = 0;
    for (const p of PEAKS) { const t = Math.hypot(wx - p[0], (wz - p[1]) * 1.08) / p[3]; if (t < 1) { const q = 1 - t; acc += Math.exp(5 * (p[2] - 1.25) * (0.55 * Math.pow(q, 1.15) + 0.45 * q * q * q)); } else acc += 1; }
    let m = Math.log(acc / PEAKS.length) / 5 + Math.log(PEAKS.length) / 5; m = Math.max(0, m - 0.02);
    const mk = U.smooth(0.05, 0.9, m);
    /* crags: sharp ridges and gullies that grow with height, finer crumble on top */
    const rg = U.ridge(x * 0.8 + 5, z * 0.8 + 9, 4, 5), rg2 = U.ridge(x * 2.3 + 1, z * 2.3 + 7, 3, 15);
    m = m * (0.76 + 0.5 * rg) + (rg - 0.45) * 0.72 * mk + (rg2 - 0.5) * 0.36 * mk + 0.07 * U.fbm(x * 5.3, z * 5.3, 3, 61) * mk;
    h += Math.max(0, m);
    /* faint strata ledges on the rock */
    const st = h * 8.5 + 1.2 * U.fbm(x * 0.9, z * 0.9, 2, 81), fl = Math.floor(st); h += ((fl + U.smooth(0.2, 0.8, st - fl)) - st) / 8.5 * 0.3 * mk;
    /* the shelf and its cliff */
    const side = U.smooth(0.72, 0.42, Math.abs(x - FALL.x)), behind = U.smooth(FALL.zLip + 0.09, FALL.zLip - 0.03, z);
    const shelfY = FALL.yTop + 0.16 * U.smooth(FALL.zLip, -4, z) + 0.035 * U.fbm(x * 4, z * 4, 2, 71) - 0.035 * U.smooth(0.1, 0.0, Math.abs(x - FALL.x)) * U.smooth(FALL.springZ - 0.1, FALL.springZ + 0.1, z);
    h = U.lerp(h, Math.max(shelfY, h * 0.35 + shelfY * 0.65), side * behind);
    /* amphitheatre at the cliff foot */
    const foot = U.smooth(0.95, 0.35, Math.hypot(x - POOL.x, (z - POOL.z) * 1.15));
    h = U.lerp(h, POOL.y + 0.05 + 0.03 * U.fbm(x * 5, z * 5, 2, 73), foot * (1 - behind));
    /* river valley */
    const ri = T.riverInfo(x, z, _r2), hw = ri.w * 0.5;
    if (ri.d < 1.7 && ri.s < 0.985) {
      const fade = U.smooth(FALL.zLip + 0.12, FALL.zLip + 0.42, z) * U.smooth(1.0, 0.9, ri.s);
      const bank = ri.y + 0.03 + Math.max(0, ri.d - hw) * 0.1;
      h = U.lerp(h, bank, (1 - U.smooth(hw + 0.02, hw + 1.25, ri.d)) * fade);
      if (ri.d < hw + 0.03) { const q = ri.d / (hw + 0.03); h = Math.min(h, U.lerp(h, ri.y - 0.065 * (1 - q * q) - 0.012, fade)); }
    }
    /* plunge pool */
    const pd = Math.hypot(x - POOL.x, z - POOL.z) / POOL.r;
    if (pd < 1.15) h = Math.min(h, U.lerp(POOL.y - 0.13 * (1 - Math.min(1, pd) ** 2), h, U.smooth(0.95, 1.15, pd)));
    /* lake basin and beach */
    const r = T.lakeR(x, z);
    if (r < 1.5) {
      if (r >= 1) h = U.lerp(C.LAKE + (r - 1) * 0.72, h, U.smooth(1.0, 1.5, r));
      else h = C.LAKE - LAKE.depth * Math.pow(1 - r * r, 0.9) - 0.004;
    }
    /* puddle hollows in the meadow */
    let hol = 0;
    if (r > 1.4 && ri.d > 0.7 && mk < 0.05 && h < 1.0) { hol = U.smooth(0.3, 0.62, U.gnoise(x * 1.25 + 7, z * 1.25 + 3, 77)) * U.smooth(1.4, 1.7, r) * U.smooth(0.7, 1.0, ri.d); h -= 0.028 * hol; }
    /* a level pad for the cabin */
    const cd = Math.hypot(x - L.cabin.x, z - L.cabin.z);
    if (cd < 0.9) h = U.lerp(L.cabin.padY, h, U.smooth(0.42, 0.9, cd));
    if (info) { info.rock = mk; info.hollow = hol; info.lakeR = r; info.rd = ri.d; info.rhw = hw; info.rs = ri.s; info.ry = ri.y; }
    return h;
  }

  /* ---------------- bake ---------------- */
  const HW = (T.HW = 385), HH = (T.HH = 257), DX = 12 / (HW - 1);
  const H = (T.grid = new Float32Array(HW * HH));
  const m1 = new Uint8Array((HW - 1) * (HH - 1) * 4), m2 = new Uint8Array((HW - 1) * (HH - 1) * 4);
  const rockG = new Float32Array(HW * HH), holG = new Float32Array(HW * HH);
  (function bake() {
    const info = {};
    for (let j = 0; j < HH; j++) for (let i = 0; i < HW; i++) {
      const x = C.X0 + i * DX, z = C.Z0 + j * DX, k = j * HW + i;
      H[k] = rawHeight(x, z, info); rockG[k] = info.rock; holG[k] = info.hollow;
    }
  })();
  T.height = (x, z) => {
    const fx = U.clamp((x - C.X0) / DX, 0, HW - 1.001), fz = U.clamp((z - C.Z0) / DX, 0, HH - 1.001), i = fx | 0, j = fz | 0, u = fx - i, v = fz - j, k = j * HW + i;
    return H[k] * (1 - u) * (1 - v) + H[k + 1] * u * (1 - v) + H[k + HW] * (1 - u) * v + H[k + HW + 1] * u * v;
  };
  T.normal = (x, z, out) => { const e = 0.045, hx = T.height(x + e, z) - T.height(x - e, z), hz = T.height(x, z + e) - T.height(x, z - e), l = Math.hypot(hx, 2 * e, hz); out = out || {}; out.x = -hx / l; out.y = (2 * e) / l; out.z = -hz / l; return out; };
  T.up = (x, z) => { const e = 0.045, hx = T.height(x + e, z) - T.height(x - e, z), hz = T.height(x, z + e) - T.height(x, z - e); return (2 * e) / Math.hypot(hx, 2 * e, hz); };
  const gridAt = (G, x, z) => { const i = U.clamp(Math.round((x - C.X0) / DX), 0, HW - 1), j = U.clamp(Math.round((z - C.Z0) / DX), 0, HH - 1); return G[j * HW + i]; };
  T.rock = (x, z) => gridAt(rockG, x, z);
  T.hollow = (x, z) => gridAt(holG, x, z);
  T.inside = (x, z, m = 0) => x > C.X0 + m && x < C.X1 - m && z > C.Z0 + m && z < C.Z1 - m;
  /* what open water lies at (x,z): 'lake' | 'river' | 'pool' | null */
  T.waterAt = (x, z) => {
    const level = (WG.state && WG.state.lakeLevel) || C.LAKE;
    if (T.height(x, z) < level - 0.004 && T.lakeR(x, z) < 1.6) return 'lake';
    if (Math.hypot(x - POOL.x, z - POOL.z) < POOL.r * 0.95) return 'pool';
    const ri = T.riverInfo(x, z); if (ri.d < ri.w * 0.5 && ri.s < 0.9 && z > FALL.zLip + 0.2) return 'river';
    return null;
  };
  T.waterY = (x, z) => { const k = T.waterAt(x, z); if (k === 'lake') return (WG.state && WG.state.lakeLevel) || C.LAKE; if (k === 'pool') return POOL.y; if (k === 'river') return T.riverInfo(x, z).y; return null; };
  /* march a ray down onto the land (or the water if stopAtWater); returns distance or -1 */
  T.rayHit = (ox, oy, oz, dx, dy, dz, stopAtWater) => {
    let t = 0; const level = (WG.state && WG.state.lakeLevel) || C.LAKE;
    if (ox < C.X0 || ox > C.X1 || oz < C.Z0 || oz > C.Z1 || oy > 8) { // step to the case first
      let t0 = 0, t1 = 1e9; const lo = [C.X0, C.Y0, C.Z0], hi = [C.X1, 8, C.Z1], o = [ox, oy, oz], d = [dx, dy, dz];
      for (let a = 0; a < 3; a++) { if (Math.abs(d[a]) < 1e-6) { if (o[a] < lo[a] || o[a] > hi[a]) return -1; continue; } let ta = (lo[a] - o[a]) / d[a], tb = (hi[a] - o[a]) / d[a]; if (ta > tb) { const s = ta; ta = tb; tb = s; } t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); }
      if (t0 > t1) return -1; t = t0 + 1e-3;
    }
    let prevT = t, prevD = 1;
    for (let i = 0; i < 220; i++) {
      const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
      if (x < C.X0 - 0.01 || x > C.X1 + 0.01 || z < C.Z0 - 0.01 || z > C.Z1 + 0.01 || y < C.Y0) return -1;
      let g = T.height(x, z); if (stopAtWater && g < level && T.lakeR(x, z) < 1.6) g = level;
      const d = y - g;
      if (d < 0.002) { if (i === 0) return t; const f = prevD / (prevD - d); return prevT + (t - prevT) * f; }
      prevT = t; prevD = d; t += Math.max(0.02, d * 0.45);
    }
    return -1;
  };

  /* ---------------- trees (the full set; lower detail levels take the first N of each kind) ---------------- */
  (function trees() {
    const rnd = U.rng(20240613), out = [], pines = [], broad = [];
    const far = (x, z, d, list) => { for (const t of list) if ((t.x - x) ** 2 + (t.z - z) ** 2 < d * d) return false; return true; };
    const clear = (x, z) => {
      if (!T.inside(x, z, 0.28)) return false;
      if (x > 0.0 && z > 0.8) return false;                                   // keep the view across the lake open
      if (T.lakeR(x, z) < 1.42) return false;
      if (Math.hypot(x - L.cabin.x, z - L.cabin.z) < 1.05) return false;      // the yard
      if (T.pathDist(x, z) < 1.5) return false;
      const ri = T.riverInfo(x, z); if (ri.d < ri.w * 0.5 + 0.3) return false;
      if (Math.abs(x - FALL.x) < 0.75 && z < -1.3) return false;              // the shelf, cliff and pool
      for (const b of L.boulders) if (Math.hypot(b.x - x, b.z - z) < b.r + 0.18) return false;
      return true;
    };
    const all = () => pines.concat(broad);
    /* named trees */
    broad.push({ kind: 'oak', x: -4.0, z: 0.25, h: 1.3 }, { kind: 'birch', x: -4.95, z: 1.5, h: 1.15 });
    const cherries = [{ kind: 'cherry', x: -3.75, z: 2.4, h: 0.72 }, { kind: 'cherry', x: 3.3, z: 0.35, h: 0.7 }];
    /* groves of oak and birch */
    const groves = [[-5.15, 3.0, 0.75], [-1.25, -0.8, 0.7], [5.3, -0.75, 0.6], [-0.95, 3.35, 0.6], [1.75, -0.6, 0.7]];
    for (let n = 0, guard = 0; broad.length < 20 && guard < 4000; guard++) {
      const g = groves[n % groves.length], a = rnd() * 6.283, rr = Math.sqrt(rnd()) * g[2];
      const x = g[0] + Math.cos(a) * rr, z = g[1] + Math.sin(a) * rr * 0.85;
      if (!clear(x, z) || T.height(x, z) > 1.45 || T.up(x, z) < 0.86 || !far(x, z, 0.5, all().concat(cherries))) continue;
      const kind = (n + (rnd() < 0.3 ? 1 : 0)) % 2 === 0 ? 'oak' : 'birch';
      broad.push({ kind, x, z, h: kind === 'oak' ? 0.8 + rnd() * 0.3 : 0.85 + rnd() * 0.35 }); n++;
    }
    /* pines on the back slopes and shoulders, in clumps, shorter higher up */
    for (let guard = 0; pines.length < 30 && guard < 9000; guard++) {
      const x = -5.75 + rnd() * 11.5, z = -3.8 + rnd() * 4.0, y = T.height(x, z);
      if (y < 0.98 || y > 2.95 || T.up(x, z) < 0.6 || !clear(x, z)) continue;
      if (U.vnoise(x * 0.95 + 2, z * 0.95 + 8, 5) < 0.42 && rnd() < 0.85) continue;
      if (!far(x, z, 0.34, pines) || !far(x, z, 0.5, broad)) continue;
      const hgt = U.lerp(1.3, 0.5, U.sat((y - 1.0) / 1.9)) * (0.78 + rnd() * 0.36);
      pines.push({ kind: pines.length % 2 ? 'spruce' : 'pine', x, z, h: U.clamp(hgt, 0.5, 1.3), blue: rnd() < 0.14 });
    }
    const np = WG.Q.pines, nb = WG.Q.broad;
    let id = 0;
    for (const t of pines.slice(0, np).concat(broad.slice(0, nb), cherries)) {
      t.y = T.height(t.x, t.z); t.seed = 500 + id; t.id = id++;
      t.r = t.kind === 'oak' ? t.h * 0.46 : t.kind === 'birch' ? t.h * 0.27 : t.kind === 'cherry' ? t.h * 0.55 : t.h * (t.kind === 'spruce' ? 0.2 : 0.27);
      out.push(t);
    }
    L.trees = out;
  })();

  /* stepping stones across the river */
  L.stones = (function () { const p = T.riverAt(stoneS), out = [], n = 5; for (let i = 0; i < n; i++) { const f = (i - (n - 1) / 2) / (n - 1) * 2, off = f * (p.w * 0.5 + 0.1); out.push({ x: p.x - p.tz * off + (U.hash(i, 3, 9) - 0.5) * 0.035, z: p.z + p.tx * off + (U.hash(i, 7, 9) - 0.5) * 0.035, y: p.y + 0.012, r: 0.05 + U.hash(i, 1, 9) * 0.018, seed: 300 + i }); } return out; })();

  /* ---------------- masks: m1 = path, bare earth, hollow, sand · m2 = river bed, mud bank, stream/pool, shade under trees ---------------- */
  (function masks() {
    const MW = HW - 1, MH = HH - 1, info = {};
    for (let j = 0; j < MH; j++) for (let i = 0; i < MW; i++) {
      const x = C.X0 + (i + 0.5) * DX, z = C.Z0 + (j + 0.5) * DX, k = (j * MW + i) * 4;
      const pd = T.pathDist(x, z), path = 1 - U.smooth(0.3, 0.62, pd);
      const cd = Math.hypot(x - L.cabin.x, z - L.cabin.z);
      let bare = (1 - U.smooth(0.5, 0.82, cd + 0.12 * U.gnoise(x * 5, z * 5, 3))) * 0.9, shade = 0;
      for (const t of L.trees) { const d = Math.hypot(x - t.x, z - t.z); if (d < t.r * 1.6) { const leafy = t.kind === 'pine' || t.kind === 'spruce' ? 0.9 : 0.7; bare = Math.max(bare, (1 - U.smooth(t.r * 0.3, t.r * 0.95, d + 0.05 * U.gnoise(x * 7, z * 7, 9))) * leafy); shade = Math.max(shade, 1 - U.smooth(t.r * 0.4, t.r * 1.5, d)); } }
      const r = T.lakeR(x, z), sand = (1 - U.smooth(1.1, 1.28, r + 0.04 * U.gnoise(x * 3, z * 3, 13)));
      const ri = T.riverInfo(x, z), hw = ri.w * 0.5, live = z > FALL.zLip + 0.25 && ri.s < 0.93 ? 1 : 0;
      const bed = live * (1 - U.smooth(hw - 0.02, hw + 0.035, ri.d));
      const mud = live * (1 - U.smooth(hw + 0.03, hw + 0.2, ri.d + 0.04 * U.gnoise(x * 6, z * 6, 21))) * (1 - bed);
      const pdist = Math.hypot(x - POOL.x, z - POOL.z) / POOL.r;
      const stream = Math.max(1 - U.smooth(0.9, 1.2, pdist), (Math.abs(x - FALL.x) < 0.09 && z < FALL.zLip + 0.02 && z > FALL.springZ - 0.06) ? 1 : 0);
      m1[k] = path * 255; m1[k + 1] = U.sat(bare) * 255; m1[k + 2] = holG[j * HW + i] * 255; m1[k + 3] = sand * 255;
      m2[k] = bed * 255; m2[k + 1] = mud * 255; m2[k + 2] = stream * 255; m2[k + 3] = shade * 255;
    }
    T.MW = MW; T.MH = MH;
  })();
  const maskAt = (M, c, x, z) => { const i = U.clamp(((x - C.X0) / DX) | 0, 0, T.MW - 1), j = U.clamp(((z - C.Z0) / DX) | 0, 0, T.MH - 1); return M[(j * T.MW + i) * 4 + c] / 255; };
  T.path = (x, z) => maskAt(m1, 0, x, z);
  T.bare = (x, z) => maskAt(m1, 1, x, z);
  T.sand = (x, z) => maskAt(m1, 3, x, z);
  T.riverBed = (x, z) => maskAt(m2, 0, x, z);
  T.mud = (x, z) => maskAt(m2, 1, x, z);
  T.shade = (x, z) => maskAt(m2, 3, x, z);
  /* how thickly grass grows here, 0..1 (thin under trees and on paths, none on rock, sand, mud or water) */
  T.grassDensity = (x, z) => {
    const y = T.height(x, z); if (y < C.LAKE + 0.03 && T.lakeR(x, z) < 1.2) return 0;
    const up = T.up(x, z); if (up < 0.72) return 0;
    let d = U.smooth(0.72, 0.9, up) * (1 - T.path(x, z)) * (1 - T.bare(x, z) * 0.92) * (1 - T.sand(x, z)) * (1 - T.riverBed(x, z)) * (1 - T.mud(x, z) * 0.8);
    d *= 1 - U.smooth(1.6, 2.6, y) * 0.75; if (y > 2.75) d = 0;
    if (Math.hypot(x - POOL.x, z - POOL.z) < POOL.r * 1.25) d = 0;
    if (Math.abs(x - FALL.x) < 0.5 && z < FALL.zLip + 0.15) d *= 0.15;
    return d;
  };
  /* distance to the nearest open water, for lushness near water (capped at 2) */
  T.waterDist = (x, z) => { const r = T.lakeR(x, z), ld = Math.max(0, (r - 1) * 2.0), ri = T.riverInfo(x, z), rd = ri.s < 0.93 ? Math.max(0, ri.d - ri.w * 0.5) : 9; return Math.min(2, ld, rd); };

  /* ---------------- textures ---------------- */
  (function textures() {
    const half = new Uint16Array(HW * HH);
    for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(H[i]);
    const ht = new THREE.DataTexture(half, HW, HH, THREE.RedFormat, THREE.HalfFloatType);
    ht.minFilter = ht.magFilter = THREE.LinearFilter; ht.wrapS = ht.wrapT = THREE.ClampToEdgeWrapping; ht.needsUpdate = true;
    const mk = (data) => { const t = new THREE.DataTexture(data, T.MW, T.MH, THREE.RGBAFormat, THREE.UnsignedByteType); t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; return t; };
    T.heightTex = ht; T.mask1Tex = mk(m1); T.mask2Tex = mk(m2);
  })();
})();
