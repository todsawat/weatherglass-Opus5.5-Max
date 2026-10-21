/* Weatherglass — clouds, and the air they float in.
   Each cloud is a soft body of 8–13 lobes on springs. The same lobes are ray-marched as a volume, together with the
   haze, the ground fog, the shafts of light, the grey shafts of rain and the rainbow. */
(function () {
  'use strict';
  const WG = window.WG, THREE = WG.THREE, U = WG.util, C = WG.C, G = WG.G, S = WG.state, W = WG.world, T = WG.terrain, Q = WG.Q;
  const MAXC = 10, LPC = 13;
  const snd = (name, level, pan) => { const a = WG.audio; if (a && a.cont) { try { a.cont(name, level, pan); } catch (e) { /* ignore */ } } };
  const panOf = (c) => (WG.cam ? WG.cam.panOf(c.x, c.y, c.z) : 0);

  const CL = (WG.clouds = { list: [], MAX: MAXC, held: null, hover: null, meanY: 5.4 });
  let nextId = 1;

  /* ------------------------------------------------------------------ shape */
  const EXTRA = [[-1.55, -0.18, 0.1, 0.5], [1.6, -0.15, 0.05, 0.48], [0.05, 0.98, 0.0, 0.46], [0.1, 0.1, 0.8, 0.62], [-0.1, 0.08, -0.82, 0.6], [-1.0, 0.36, -0.3, 0.5], [1.05, 0.3, 0.3, 0.48]];
  function layout(c) {
    const rnd = U.rng(c.seed), out = [];
    const add = (ox, oy, oz, r, kind) => out.push({ ox, oy, oz, r, kind: kind || 0, k: 0, z: 0 });
    if (c.painted && c.painted.length) { for (const p of c.painted) add(p[0], p[1], p[2], p[3]); }
    else if (c.storm) {
      add(0, 0.0, 0, 1.0); add(-0.95, -0.12, 0.1, 0.78); add(0.98, -0.1, -0.1, 0.76);       // body
      add(-0.42, -0.3, 0.46, 0.7); add(0.46, -0.32, -0.42, 0.68);                            // heavy base
      add(0.05, 0.7, 0, 0.78, 1); add(-0.05, 1.35, 0.05, 0.66, 1); add(0.04, 1.95, -0.03, 0.6, 1);  // the tower
      for (let i = 0; i < 5; i++) { const a = (i / 5) * 6.283 + 0.4; add(Math.cos(a) * 1.05, 0, Math.sin(a) * 0.9, 1.0, 2); }   // the anvil ring under the lid
    } else {
      const j = () => (rnd() - 0.5) * 0.2;
      add(j() * 0.4, 0.05, j() * 0.4, 1.0);                                                  // fat core
      add(-0.92 + j(), -0.1, 0.08 + j(), 0.74); add(0.95 + j(), -0.06, -0.1 + j(), 0.7);     // two sides
      add(-0.38 + j(), 0.55, -0.08 + j(), 0.7); add(0.42 + j(), 0.6, 0.12 + j(), 0.62);      // two crowns
      add(-0.5 + j(), -0.22, 0.4 + j(), 0.62); add(0.52 + j(), -0.25, -0.36 + j(), 0.6);     // two base lobes
      const n = U.clamp(Math.round(1 + Math.cbrt(c.vol) * 1.9 + rnd() * 1.5), 1, 6), ord = EXTRA.map((e, i) => i).sort(() => rnd() - 0.5);
      for (let i = 0; i < n; i++) { const e = EXTRA[ord[i]]; add(e[0] + j(), e[1] + j() * 0.5, e[2] + j(), e[3] * (0.9 + rnd() * 0.25)); }
    }
    for (let i = 0; i < out.length; i++) { const l = out[i], d = Math.hypot(l.ox, l.oy, l.oz); l.k = U.lerp(92, 40, U.sat(d / 1.7)) * (0.85 + rnd() * 0.3); l.z = 0.3 + rnd() * 0.14; l.ph = rnd() * 6.283; }
    return out.slice(0, LPC);
  }
  const radiusOf = (vol) => 0.55 * Math.cbrt(Math.max(vol, 0.004));
  function relayout(c, kick) {
    const old = c.lobes || [], next = layout(c);
    for (let i = 0; i < next.length; i++) {
      const l = next[i], o = old[i % Math.max(1, old.length)];
      if (o) { l.x = o.x; l.y = o.y; l.z3 = o.z3; l.vx = o.vx; l.vy = o.vy; l.vz = o.vz; } else { l.x = c.x; l.y = c.y; l.z3 = c.z; l.vx = l.vy = l.vz = 0; }
      if (kick) { l.vx += (Math.random() - 0.5) * kick; l.vy += (Math.random() - 0.5) * kick * 0.7; l.vz += (Math.random() - 0.5) * kick; }
      l.wr = 0.01;
    }
    c.lobes = next;
  }

  function make(o) {
    const c = {
      id: nextId++, seed: (o.seed || (nextId * 7919 + 13)) | 0,
      x: o.x, y: o.y, z: o.z, vx: 0, vy: 0, vz: 0, y0: o.y,
      vol: o.vol || 1, water: o.water !== undefined ? o.water : 0.3, R: 0.5,
      alpha: o.instant ? 1 : 0, dying: false, age: 0, touched: -1e9, flung: 0,
      held: false, squeeze: 0, wheel: 0, stillT: 0, shakeE: 0, shakeSign: 0, charge: 0, rain: 0, auto: o.raining || 0,
      storm: !!o.storm, stormK: o.storm && o.instant ? 1 : 0, strikeT: o.storm ? 2.5 + Math.random() * 3 : 12,
      dark: 0, hoverK: 0, glow: 0, gx: 0, gy: 0, gz: 0, tx: o.x, tz: o.z, grabY: o.y, gox: 0, goz: 0, dragged: 0,
      baseY: o.y - 0.3, bx: o.x, by: o.y, bz: o.z, br: 1, lobes: null, painted: null, feeding: false,
    };
    c.R = radiusOf(c.vol); c._stormShape = c.storm; relayout(c, 0);
    for (const l of c.lobes) { l.x = c.x + l.ox * c.R; l.y = c.y + l.oy * c.R; l.z3 = c.z + l.oz * c.R; l.wr = l.r * c.R * (o.instant ? 1 : 0.3); }
    return c;
  }
  /* add a cloud; never more than ten: the oldest untouched one dissolves to make room */
  CL.spawn = (o) => {
    const live = CL.list.filter((c) => !c.dying);
    if (live.length >= MAXC) { let v = null; for (const c of live) if (!c.held && (!v || c.touched < v.touched || (c.touched === v.touched && c.age > v.age))) v = c; if (v) v.dying = true; }
    const c = make(Object.assign({ x: 0, y: 5.4, z: 0, vol: 0.15 }, o));
    c.x = U.clamp(c.x, C.X0 + 0.5, C.X1 - 0.5); c.z = U.clamp(c.z, C.Z0 + 0.5, C.Z1 - 0.5); c.y = c.y0 = U.clamp(c.y, 4.3, 6.6);
    CL.list.push(c);
    if (!o.instant) WG.bus.emit('cloud:pop', { x: c.x, y: c.y, z: c.z, pan: panOf(c) });
    return c;
  };

  /* ------------------------------------------------------------------ hands */
  /* nearest cloud along a ray: {cloud, t, x, y, z} or null */
  CL.pick = (o, d) => {
    let best = null, bt = 1e9;
    for (const c of CL.list) {
      if (c.dying || c.alpha < 0.3) continue;
      for (const l of c.lobes) {
        const r = l.wr * 0.9, ox = o.x - l.x, oy = o.y - l.y, oz = o.z - l.z3, b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r, h = b * b - cc;
        if (h < 0) continue; const t = -b - Math.sqrt(h); if (t > 0 && t < bt) { bt = t; best = c; }
      }
    }
    return best ? { cloud: best, t: bt, x: o.x + d.x * bt, y: o.y + d.y * bt, z: o.z + d.z * bt } : null;
  };
  CL.grab = (c, hit) => {
    CL.held = c; c.held = true; c.touched = WG.time; c.grabY = hit ? hit.y : c.y; c.gox = hit ? c.x - hit.x : 0; c.goz = hit ? c.z - hit.z : 0; c.tx = c.x; c.tz = c.z; c.stillT = 0; c.shakeE = 0; c.dragged = 0;
    for (const l of c.lobes) { l.vx += (Math.random() - 0.5) * 0.5; l.vy -= 0.35; l.vz += (Math.random() - 0.5) * 0.5; }   // it gives a little under the fingers
    WG.bus.emit('cloud:grab', { cloud: c, size: c.R, pan: panOf(c) });
  };
  /* move the held cloud: pass the pointer ray; it stays at its own height */
  CL.dragTo = (o, d) => {
    const c = CL.held; if (!c) return;
    if (Math.abs(d.y) < 1e-4) return; const t = (c.grabY - o.y) / d.y; if (t <= 0) return;
    c.tx = U.clamp(o.x + d.x * t + c.gox, C.X0 + 0.35, C.X1 - 0.35); c.tz = U.clamp(o.z + d.z * t + c.goz, C.Z0 + 0.35, C.Z1 - 0.35);
  };
  CL.release = () => {
    const c = CL.held; if (!c) return; CL.held = null; c.held = false; c.touched = WG.time;
    const sp = Math.hypot(c.vx, c.vz), lim = 9; if (sp > lim) { c.vx *= lim / sp; c.vz *= lim / sp; }
    c.flung = sp > 0.7 ? 2.6 : 0.6;
    WG.bus.emit('cloud:release', { cloud: c, speed: Math.min(sp, lim), pan: panOf(c) });
  };
  CL.wheelSqueeze = (c, amount) => { c.wheel = U.sat(c.wheel + amount); c.touched = WG.time; };
  /* the cloud tool held on a cloud: it grows and gathers water, faster in humid air */
  CL.feed = (c, dt) => { const k = 0.55 + 1.1 * S.humidity; c.vol = Math.min(34, c.vol + dt * k * (0.55 + 0.3 * Math.cbrt(c.vol))); c.water = U.sat(c.water + dt * 0.085 * k); c.touched = WG.time; c.feeding = true; };
  /* the cloud tool dragged: paint the shape lobe by lobe */
  CL.paint = (c, x, y, z) => {
    if (!c.painted) c.painted = c.lobes.slice(0, 4).map((l) => [l.ox, l.oy, l.oz, l.r]);
    if (c.painted.length >= LPC) return;
    const R = Math.max(c.R, 0.25), ox = U.clamp((x - c.x) / R, -3.2, 3.2), oy = U.clamp((y - c.y) / R, -0.5, 1.4), oz = U.clamp((z - c.z) / R, -3.2, 3.2);
    for (const p of c.painted) if (Math.hypot(p[0] - ox, p[1] - oy, p[2] - oz) < 0.62) return;
    c.painted.push([ox, oy, oz, 0.72]); relayout(c, 0.6);
    const n = c.lobes.length, l = c.lobes[n - 1]; l.x = x; l.y = y; l.z3 = z; l.wr = 0.02;
  };
  CL.strike = (c, power) => { c.glow = 1; c.glowBig = 1; const l = c.lobes[(Math.random() * c.lobes.length) | 0]; c.gx = l.x; c.gy = l.y; c.gz = l.z3; WG.bus.emit('cloud:strike', { cloud: c, power: power || 1 }); };

  function merge(a, b) {
    const va = a.vol, vb = b.vol, keep = b.held || (!a.held && vb > va) ? b : a, gone = keep === a ? b : a;
    const wk = keep.vol / (va + vb);
    if (!keep.held) { keep.x = keep.x * wk + gone.x * (1 - wk); keep.z = keep.z * wk + gone.z * (1 - wk); keep.vx = keep.vx * wk + gone.vx * (1 - wk); keep.vz = keep.vz * wk + gone.vz * (1 - wk); }
    keep.y0 = keep.y0 * wk + gone.y0 * (1 - wk);
    keep.water = U.sat((a.water * va + b.water * vb) / (va + vb) + 0.07);
    keep.vol = va + vb; keep.auto = Math.max(a.auto, b.auto); keep.charge = Math.max(a.charge, b.charge); keep.painted = null; keep.touched = WG.time; keep.flung = Math.max(keep.flung, 1.2);
    const olds = keep.lobes.concat(gone.lobes);
    if (keep.vol >= 3.0 && keep.water >= 0.7 && !keep.storm) { keep.storm = true; keep.strikeT = 3 + Math.random() * 2; WG.bus.emit('cloud:storm', { cloud: keep }); }
    keep.seed = (keep.seed * 31 + gone.seed) | 0; keep.lobes = olds; relayout(keep, 1.6 * radiusOf(keep.vol) + 0.6);
    for (let i = 0; i < keep.lobes.length; i++) { const o = olds[(i * 2) % olds.length]; keep.lobes[i].x = o.x; keep.lobes[i].y = o.y; keep.lobes[i].z3 = o.z3; keep.lobes[i].wr = o.wr; }
    CL.list.splice(CL.list.indexOf(gone), 1); if (CL.hover === gone) CL.hover = null;
    WG.bus.emit('cloud:merge', { cloud: keep, size: radiusOf(keep.vol), x: keep.x, y: keep.y, z: keep.z, pan: panOf(keep) });
  }

  /* ------------------------------------------------------------------ life of a cloud */
  const wv = {};
  let natT = 20, coverS = 0;
  function update(dt) {
    const list = CL.list, t = WG.time;
    let cover = 0, storm = 0, rate = 0, my = 0, mw = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i];
      c.age += dt; c.flung = Math.max(0, c.flung - dt);
      c.alpha = c.dying ? c.alpha - dt / 1.3 : Math.min(1, c.alpha + dt / 0.7);
      if (c.dying && c.alpha <= 0) { if (CL.held === c) CL.held = null; if (CL.hover === c) CL.hover = null; list.splice(i, 1); continue; }
      const Rt = radiusOf(c.vol); c.R = U.damp(c.R, Rt, 5, dt);
      const R = c.R;

      /* --- squeezing, shaking ------------------------------------------- */
      let sqT = 0;
      if (c.held) {
        const txs = c.tx - (c._ptx !== undefined ? c._ptx : c.tx), tzs = c.tz - (c._ptz !== undefined ? c._ptz : c.tz), sp = Math.hypot(txs, tzs) / Math.max(dt, 1e-3);
        c._ptx = c.tx; c._ptz = c.tz; c.dragged += Math.hypot(txs, tzs);
        if (c.dragged > 0.6 && !c._dragEvt) { c._dragEvt = true; WG.bus.emit('cloud:dragged', { cloud: c }); }
        c.stillT = sp < 0.28 ? c.stillT + dt : 0;
        if (c.stillT > 0.2) sqT = 1;                                     // held still for a fifth of a second: the squeeze begins
        const cr = WG.cam ? WG.cam.right : { x: 1, z: 0 }, vr = (txs * cr.x + tzs * cr.z) / Math.max(dt, 1e-3), sg = vr > 3.0 ? 1 : vr < -3.0 ? -1 : 0;
        if (sg !== 0 && sg !== c.shakeSign) { if (c.shakeSign !== 0) c.shakeE = Math.min(4, c.shakeE + 1); c.shakeSign = sg; }
      } else { c._ptx = c._ptz = undefined; c._dragEvt = false; c.shakeSign = 0; }
      c.shakeE = Math.max(0, c.shakeE - dt * 1.3);
      if (c.shakeE > 1.9) c.charge = Math.min(1.2, c.charge + dt * 1.05); else c.charge = Math.max(0, c.charge - dt * (c.storm ? 0.05 : 0.35));
      if (c.held && c.charge >= 1) { c.charge = 0.3; c.shakeE = 0.6; CL.strike(c, 0.85); }
      if (c.charge > 0.22 && !c.glowBig && Math.random() < dt * (3 + c.charge * 12)) { c.glow = Math.max(c.glow, 0.3 + Math.random() * 0.55 * c.charge); const l = c.lobes[(Math.random() * c.lobes.length) | 0]; c.gx = l.x; c.gy = l.y; c.gz = l.z3; }
      if (c.held && c.charge > 0.2) snd('charge', U.sat(c.charge), panOf(c));
      c.glow = Math.max(0, c.glow - dt * (c.glowBig ? 4 : 9)); if (c.glow <= 0) c.glowBig = 0;
      c.wheel = Math.max(0, c.wheel - dt * 0.55);
      sqT = Math.max(sqT, c.wheel);
      c.squeeze = sqT > c.squeeze ? Math.min(sqT, c.squeeze + dt / 2.0) : Math.max(sqT, c.squeeze - dt / 0.45);

      /* --- storm ---------------------------------------------------------- */
      c.stormK = U.sat(c.stormK + (c.storm ? dt / 4.5 : -dt / 6));
      if (c.storm) {
        c.strikeT -= dt; if (c.strikeT <= 0 && c.stormK > 0.6 && !c.dying) { c.strikeT = 10 + Math.random() * 5; CL.strike(c, 1); }
        if (c.water < 0.24) c.storm = false;
        c.charge = Math.max(c.charge, 0.35 * c.stormK);
      }
      if (c.storm !== !!c._stormShape) relayoutSoon(c);

      /* --- water --------------------------------------------------------- */
      const sqRate = Math.pow(c.squeeze, 1.5) * (0.22 + 0.78 * c.water) * (c.water > 0.015 ? 1 : 0);
      const autoRate = Math.max(c.auto, c.storm ? 0.9 * c.stormK : 0) * U.sat(c.water / 0.3);
      const want = Math.max(sqRate, autoRate) * c.alpha;
      c.rain = want > c.rain ? Math.min(want, c.rain + dt * 1.8) : Math.max(want, c.rain - dt * 2.2);
      if (c.rain > 0.02) {
        if (!c._rainEvt && c.squeeze > 0.3) { c._rainEvt = true; WG.bus.emit('cloud:rain', { cloud: c }); }
        c.water = Math.max(0, c.water - c.rain * dt * (c.storm ? 0.018 : c.auto > 0 && c.squeeze < 0.1 ? 0.007 : 0.045));
        if (c.water < 0.12) c.vol -= c.rain * dt * 0.3 * (c.vol + 0.25); else c.vol -= c.rain * dt * 0.012 * c.vol;
      } else c._rainEvt = false;
      if (c.auto > 0 && c.water < 0.2) c.auto = Math.max(0, c.auto - dt * 0.05);
      if (!c.held && !c.feeding) {
        c.water = U.clamp(c.water + dt * 0.011 * (S.humidity - 0.5), 0.03, 1);                               // humid air slowly refills clouds
        if (S.humidity < 0.38 && S.sunI > 0.5 && S.temp > 19) c.vol -= dt * 0.0045 * (0.4 + c.vol * 0.3);    // dry, warm, sunny air evaporates them
      }
      c.feeding = false;
      if (c.vol < 0.07 && !c.dying) c.dying = true;
      if (c.squeeze > 0.03) snd('squeeze', c.squeeze * (0.4 + 0.6 * U.sat(c.water * 2)), panOf(c));
      c.dark = U.sat(U.smooth(0.34, 0.95, c.water) * 0.72 + c.squeeze * 0.22 * U.smooth(0.1, 0.5, c.water) + c.stormK * 0.45);

      /* --- motion -------------------------------------------------------- */
      const lim = R * 0.55;
      if (c.held) {
        const k = 62, d = 2 * Math.sqrt(k) * 0.68;
        c.vx += ((c.tx - c.x) * k - c.vx * d) * dt; c.vz += ((c.tz - c.z) * k - c.vz * d) * dt;
      } else {
        W.windAt(c.x, c.z, wv);
        /* inside the case the breeze turns into a slow circulation, so clouds wander instead of piling against one wall */
        const sw = S.wind.speed * 0.3, cx = c.x / 6, cz = c.z / 4;
        let ux = wv.x * 0.5 * (1 - cx * cx * cx * cx) - cz * sw * 1.1, uz = wv.z * 0.5 * (1 - cz * cz * cz * cz) + cx * sw * 0.75;
        for (const o of list) {                                                   // free clouds nudge each other apart
          if (o === c || o.dying || o.held || o.flung > 0 || c.flung > 0) continue;
          const dx = c.x - o.x, dz = c.z - o.z, dd = Math.hypot(dx, dz) + 1e-3, need = (R + o.R) * 1.25; if (dd < need) { const p = ((need - dd) / need) * 0.5; ux += (dx / dd) * p; uz += (dz / dd) * p; }
        }
        const tau = 1.2 + R * 2.2, drag = c.flung > 0 ? 0.55 : 1;
        c.vx += (ux - c.vx) * (1 - Math.exp((-dt / tau) * drag)); c.vz += (uz - c.vz) * (1 - Math.exp((-dt / tau) * drag));
      }
      c.x += c.vx * dt; c.z += c.vz * dt;
      /* the glass: a soft bounce with a wobble */
      const bounce = (axis, lo, hi) => {
        const p = c[axis], v = c['v' + axis];
        if (p < lo + lim && v < 0) { c[axis] = lo + lim; hit(c, axis, -v); c['v' + axis] = -v * 0.42; }
        else if (p > hi - lim && v > 0) { c[axis] = hi - lim; hit(c, axis, v); c['v' + axis] = -v * 0.42; }
      };
      bounce('x', C.X0, C.X1); bounce('z', C.Z0, C.Z1);
      /* height: its own level with a gentle bob, lifted over the mountain tops; storms sit a little lower */
      let ground = 0; for (let a = 0; a < 5; a++) { const gx = c.x + (a === 1 ? R : a === 2 ? -R : 0) * 0.8, gz = c.z + (a === 3 ? R : a === 4 ? -R : 0) * 0.8; ground = Math.max(ground, T.height(U.clamp(gx, C.X0, C.X1), U.clamp(gz, C.Z0, C.Z1))); }
      const top = C.Y1 - 0.3 - R * 0.75;
      let yT = c.y0 + Math.sin(t * 0.45 + c.id * 1.7) * 0.07 - c.stormK * 0.3 - c.squeeze * 0.06;
      yT = Math.max(yT, ground + R * 0.62 + 0.35); yT = Math.min(yT, Math.max(top, 4.2));
      c.vy += ((yT - c.y) * 9 - c.vy * 5) * dt; c.y += c.vy * dt;
      c.baseY = c.y - R * (0.4 - 0.07 * c.squeeze) - c.stormK * R * 0.1 - c.rain * 0.05;

      /* --- lobes on springs --------------------------------------------- */
      const sqY = 1 - 0.3 * c.squeeze, sqX = 1 + 0.17 * c.squeeze, trem = c.squeeze * 0.03 * R;
      let bx = 0, by = 0, bz = 0;
      for (let li = 0; li < c.lobes.length; li++) {
        const l = c.lobes[li];
        let gx = c.x + l.ox * R * sqX, gy = c.y + l.oy * R * sqY, gz = c.z + l.oz * R * sqX, wr = l.r * R;
        if (l.kind === 1) { const g = c.stormK; gy = c.y + l.oy * R * g * 1.05; gy = Math.min(gy, C.Y1 - wr * 0.55); wr *= 0.35 + 0.65 * g; }
        else if (l.kind === 2) { const g = U.smooth(0.35, 1, c.stormK); gx = c.x + l.ox * R * (0.3 + 0.95 * g) + S.wind.dx * g * 0.55; gz = c.z + l.oz * R * (0.3 + 0.95 * g) + S.wind.dz * g * 0.4; gy = U.lerp(c.y + R * 0.6, C.Y1 - wr * 0.2, g); wr *= 0.25 + 0.75 * g; }
        if (trem > 0) { gx += (U.vnoise(t * 23 + li * 7.1, 1.5, 4) - 0.5) * trem * 2; gy += (U.vnoise(t * 27 + li * 3.3, 4.5, 5) - 0.5) * trem * 2; gz += (U.vnoise(t * 25 + li * 5.7, 8.5, 6) - 0.5) * trem * 2; }
        gy += Math.sin(t * 0.33 + l.ph) * 0.02 * R; gx += Math.cos(t * 0.21 + l.ph * 1.3) * 0.025 * R;                // the surface boils very slowly
        const k = l.k * (c.held ? 1 : 0.8), d = 2 * Math.sqrt(k) * l.z;
        l.vx += ((gx - l.x) * k - l.vx * d) * dt; l.vy += ((gy - l.y) * k - l.vy * d) * dt; l.vz += ((gz - l.z3) * k - l.vz * d) * dt;
        l.x += l.vx * dt; l.y += l.vy * dt; l.z3 += l.vz * dt;
        const mx = 1.5 * R + 0.2, ex = l.x - gx, ey = l.y - gy, ez = l.z3 - gz, el = Math.hypot(ex, ey, ez); if (el > mx) { const f = mx / el; l.x = gx + ex * f; l.y = gy + ey * f; l.z3 = gz + ez * f; }
        l.wr = U.damp(l.wr, wr * (0.25 + 0.75 * c.alpha), 6, dt);
        /* lobes squash softly against the walls and the lid, never through them */
        const pr = l.wr * 0.5;
        if (l.x < C.X0 + pr) { l.x = C.X0 + pr; if (l.vx < 0) l.vx *= -0.2; } else if (l.x > C.X1 - pr) { l.x = C.X1 - pr; if (l.vx > 0) l.vx *= -0.2; }
        if (l.z3 < C.Z0 + pr) { l.z3 = C.Z0 + pr; if (l.vz < 0) l.vz *= -0.2; } else if (l.z3 > C.Z1 - pr) { l.z3 = C.Z1 - pr; if (l.vz > 0) l.vz *= -0.2; }
        if (l.y > C.Y1 - l.wr * 0.4) { l.y = C.Y1 - l.wr * 0.4; if (l.vy > 0) l.vy *= -0.2; }
        bx += l.x; by += l.y; bz += l.z3;
      }
      const n = c.lobes.length; bx /= n; by /= n; bz /= n; let br = 0;
      for (const l of c.lobes) br = Math.max(br, Math.hypot(l.x - bx, l.y - by, l.z3 - bz) + l.wr);
      c.bx = bx; c.by = by; c.bz = bz; c.br = br;
      c.hoverK = U.damp(c.hoverK, CL.hover === c || c.held ? 1 : 0, 12, dt);

      const area = Math.PI * Math.pow(R * 1.45 + c.stormK * R * 1.2, 2) * c.alpha;
      cover += area * (0.6 + 1.6 * c.dark); storm = Math.max(storm, c.stormK * c.alpha); rate += c.rain * area;
      my += c.y * c.vol; mw += c.vol;
    }
    /* merging: push or fling one cloud into another */
    outer: for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j]; if (a.dying || b.dying || a.alpha < 0.6 || b.alpha < 0.6) continue;
      if (!(a.held || b.held || a.flung > 0 || b.flung > 0)) continue;
      if (Math.hypot(a.x - b.x, (a.y - b.y) * 0.4, a.z - b.z) < (a.R + b.R) * 0.95) { merge(a, b); break outer; }
    }
    /* now and then humid air condenses a small cloud by itself */
    natT -= dt;
    if (natT <= 0) { natT = 22 + Math.random() * 24; if (S.humidity > 0.6 && list.filter((c) => !c.dying).length < 4 && !WG.flag('paused')) CL.spawn({ x: U.lerp(-4.5, 4.5, Math.random()), z: U.lerp(-2.8, 2.8, Math.random()), y: 5.2 + Math.random() * 0.8, vol: 0.5 + Math.random() * 0.7, water: 0.3 + S.humidity * 0.3 }); }
    coverS = U.damp(coverS, U.sat(cover / 52), 1.2, dt);
    S.cover = coverS; S.storm = U.damp(S.storm, storm, 1.5, dt); S.rainRate = U.sat(rate / 14);
    if (mw > 0) CL.meanY = U.damp(CL.meanY, my / mw, 2, dt);
    /* a rainbow needs rain falling in sunlight with the sun fairly low; it fades in over a few seconds */
    const want = U.sat(S.rain * 3) * S.sunUp * U.smooth(0.82, 0.55, S.sunDir.y) * U.smooth(0.03, 0.12, S.sunDir.y) * (1 - U.smooth(0.3, 0.8, S.cover)) * (1 - S.storm);
    const was = rainbowK; rainbowK = U.damp(rainbowK, want, want > rainbowK ? 0.4 : 0.8, dt);
    if (was < 0.25 && rainbowK >= 0.25) WG.bus.emit('rainbow', {});
    S.rainbow = rainbowK;
  }
  function relayoutSoon(c) { c._stormShape = c.storm; c.painted = null; relayout(c, 0.8); }
  function hit(c, axis, speed) {
    if (speed < 0.25) return; const k = Math.min(3.5, speed) * 0.55;
    for (const l of c.lobes) { l.vx += (Math.random() - 0.5) * k * (axis === 'x' ? 0.6 : 1.4); l.vy += (Math.random() - 0.5) * k * 0.9; l.vz += (Math.random() - 0.5) * k * (axis === 'z' ? 0.6 : 1.4); }
    WG.bus.emit('cloud:bounce', { cloud: c, speed, pan: panOf(c) });
  }
  WG.bus.on('lightning', (e) => { const c = e.cloud; if (c) { c.glow = 1; c.glowBig = 1; c.gx = c.x; c.gy = c.baseY + c.R * 0.3; c.gz = c.z; } });

  /* ------------------------------------------------------------------ the cloud map: a top-down picture of the clouds for their ground shadows and lake reflections */
  let mapRT, mapScene, mapCam, mapMesh, mapAttr;
  function buildMap() {
    mapRT = new THREE.WebGLRenderTarget(128, 96, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    mapScene = new THREE.Scene(); mapCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]), 3)); g.setIndex([0, 1, 2, 2, 1, 3]);
    mapAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAXC * LPC * 4), 4); mapAttr.setUsage(THREE.DynamicDrawUsage); g.setAttribute('aL', mapAttr); g.instanceCount = 0;
    mapMesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: 'attribute vec4 aL; varying vec2 vQ; varying float vD; void main(){ vQ = position.xy; vD = aL.w; vec2 c = (aL.xy - vec2(-8.0, -6.0)) / vec2(16.0, 12.0) * 2.0 - 1.0; gl_Position = vec4(c + position.xy * abs(aL.z) / vec2(8.0, 6.0), 0.0, 1.0); }',
      fragmentShader: 'varying vec2 vQ; varying float vD; void main(){ float r2 = dot(vQ, vQ); if (r2 > 1.0) discard; float k = 1.0 - r2; k = k * k * 0.85 * fract(vD); gl_FragColor = vec4(k, k * floor(vD) / 100.0, 0.0, 1.0); }',
      depthTest: false, depthWrite: false, transparent: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    }));
    mapMesh.frustumCulled = false; mapScene.add(mapMesh);
    G.uCloudMap.value = mapRT.texture;
  }
  function renderMap(renderer) {
    let n = 0; const a = mapAttr.array;
    for (const c of CL.list) for (const l of c.lobes) { if (n >= MAXC * LPC) break; a[n * 4] = l.x; a[n * 4 + 1] = l.z3; a[n * 4 + 2] = l.wr * (l.kind === 2 ? 0.9 : 1.02); a[n * 4 + 3] = Math.floor(U.sat(c.dark) * 99) + Math.min(0.99, 0.2 + c.alpha * 0.79); n++; }
    mapAttr.needsUpdate = true; mapMesh.geometry.instanceCount = n;
    renderer.setRenderTarget(mapRT); renderer.setClearColor(0x000000, 1); renderer.clear(true, false, false); if (n > 0) renderer.render(mapScene, mapCam);
    G.uCloudP.value.set(CL.meanY - 0.5, WG.sky && WG.sky.keyIsMoon ? 0.7 : 1, 0, 0);
  }

  /* ------------------------------------------------------------------ the air: haze, fog, light shafts, rain shafts, rainbow and the clouds, in one march */
  const lobeArr = new Float32Array(MAXC * LPC * 4), cA = new Float32Array(MAXC * 4), cB = new Float32Array(MAXC * 4), cC = new Float32Array(MAXC * 4), cD = new Float32Array(MAXC * 4), cE = new Float32Array(MAXC * 4);
  const VU = {
    uScene: { value: null }, uInvVP: { value: new THREE.Matrix4() }, uCam: { value: new THREE.Vector3() },
    uCount: { value: 0 }, uCA: { value: cA }, uCB: { value: cB }, uCC: { value: cC }, uCD: { value: cD }, uCE: { value: cE }, uLobes: { value: lobeArr },
    uHazeCol: { value: new THREE.Vector3() }, uHazeP: { value: new THREE.Vector4() }, uCloudLit: { value: new THREE.Vector3() }, uAmbTop: { value: new THREE.Vector3() }, uAmbBase: { value: new THREE.Vector3() },
    uTrueSun: { value: new THREE.Vector4(0, 1, 0, 0) }, uRainP: { value: new THREE.Vector4() }, uFrame: { value: 0 },
  };
  let volMat, rainbowK = 0;
  function buildVol() {
    const frag = /* glsl */ `
#define WG_SHADOW_TAPS 4
#define MAXC ${MAXC}
#define LPC ${LPC}
#define STEPS ${Q.volSteps}
#define VLIGHT ${Q.volLight}
${WG.glsl.globals}${WG.glsl.noise}${WG.glsl.light}
varying vec2 vUv;
uniform sampler2D uScene; uniform mat4 uInvVP; uniform vec3 uCam; uniform int uCount;
uniform vec4 uCA[MAXC]; uniform vec4 uCB[MAXC]; uniform vec4 uCC[MAXC]; uniform vec4 uCD[MAXC]; uniform vec4 uCE[MAXC]; uniform vec4 uLobes[MAXC * LPC];
uniform vec3 uHazeCol; uniform vec4 uHazeP; uniform vec3 uCloudLit; uniform vec3 uAmbTop; uniform vec3 uAmbBase; uniform vec4 uTrueSun; uniform vec4 uRainP; uniform float uFrame;
float field(int c, vec3 p){
  float f = 0.0; int n = int(uCB[c].w), b = c * LPC;
  for (int j = 0; j < LPC; j++) { if (j >= n) break; vec4 L = uLobes[b + j]; vec3 d = p - L.xyz; if (L.w < 0.0) d.y *= 2.3; float q = dot(d, d) / (L.w * L.w); if (q < 1.0) { float k = 1.0 - q; f += k * k; } }
  return f;
}
float shadowTap(vec3 p){ vec4 sc = uShadowMat * vec4(p, 1.0); if (uShadowP.w < 0.5 || sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0) return 1.0; return step(sc.z - uShadowP.y * 2.0, texture2D(uShadowMap, sc.xy).r); }
vec3 spectrum(float x){ x = clamp(x, 0.0, 1.0); return clamp(vec3(1.5 - abs(4.0 * x - 3.2), 1.5 - abs(4.0 * x - 2.0), 1.5 - abs(4.0 * x - 0.9)), 0.0, 1.0); }   /* x 0 violet .. 1 red */
void main(){
  float sceneD = texture2D(uScene, vUv).a;
  vec4 fp = uInvVP * vec4(vUv * 2.0 - 1.0, 1.0, 1.0); vec3 ro = uCam, rd = normalize(fp.xyz / fp.w - uCam);
  vec3 inv = 1.0 / rd, t0 = (vec3(-6.0, -1.8, -4.0) - ro) * inv, t1 = (vec3(6.0, 7.4, 4.0) - ro) * inv, tsm = min(t0, t1), tbg = max(t0, t1);
  float tN = max(max(max(tsm.x, tsm.y), tsm.z), 0.0), tF = min(min(min(tbg.x, tbg.y), tbg.z), sceneD);
  vec3 acc = vec3(0.0); float T = 1.0, rainOD = 0.0;
  if (tF > tN) {
    float len = tF - tN, coarse = max(len / 14.0, 0.2), fine = ${Q.tier === 2 ? '0.075' : Q.tier === 1 ? '0.1' : '0.16'};
    float jit = wgIGN(gl_FragCoord.xy + uFrame * 7.31);
    float t = tN + jit * min(coarse, 0.3);
    float cosK = dot(rd, uSunDir);
    float phC = 0.62 + 0.38 * (0.3 + 2.6 * pow(max(cosK, 0.0), 6.0));                    /* forward scattering: silver linings */
    float phH = 0.75 + 0.25 * cosK * cosK + 2.2 * pow(max(cosK, 0.0), 10.0);
    bool fogOn = uHazeP.z > 0.004; bool shafts = uHazeP.y > 0.03 || fogOn;
    for (int i = 0; i < STEPS; i++) {
      if (t >= tF || T < 0.012) break;
      vec3 p = ro + rd * t;
      float ext = 0.0; vec3 sIn = vec3(0.0); float dC = 1000.0;
      /* --- clouds --- */
      for (int c = 0; c < MAXC; c++) {
        if (c >= uCount) break;
        vec4 A = uCA[c]; float d = length(p - A.xyz) - A.w; dC = min(dC, d);
        vec4 B = uCB[c], Cc = uCC[c];
        /* grey shafts of rain under a raining cloud, leaning with the wind */
        if (Cc.w > 0.02 && p.y < B.x + 0.1) {
          vec2 ax = Cc.xy + uRainP.xy * (B.x - p.y); float rr = Cc.z; float dx = length(p.xz - ax) / rr;
          if (dx < 1.0) { float rdn = Cc.w * (1.0 - dx * dx) * smoothstep(B.x + 0.1, B.x - 0.5, p.y); float sg = rdn * rdn * 0.11 * uRainP.z; ext += sg; sIn += sg * (uAmbBase * 1.3 + uCloudLit * 0.12 * phH); rainOD += rdn * 0.2; }
        }
        if (d > 0.0) continue;
        float f = field(c, p);
        if (f < 0.04) continue;
        float Rc = max(A.w, 0.25), hy = (p.y - B.x) / (Rc * 0.9);
        vec3 q = p * 2.5 + vec3(float(c) * 3.7, -uTime * 0.035, 1.3);
        float n1 = wgNoise3(q), n2 = wgNoise3(q * 2.7 + 5.1);
        float det = (1.0 - abs(2.0 * n1 - 1.0)) * 0.62 + (1.0 - abs(2.0 * n2 - 1.0)) * 0.38;
        float top = smoothstep(0.0, 0.55, hy);
        float dn = smoothstep(0.13, 0.13 + mix(0.17, 0.05, top), f - mix(0.21, 0.13, top) * (1.0 - det));
        float rag = Cc.w * 0.16 + uCD[c].w * 0.06;
        dn *= smoothstep(B.x - 0.04 - rag, B.x + 0.13, p.y + (det - 0.5) * (0.1 + rag * 1.4)) * B.z;
        if (dn < 0.003) continue;
        float l1 = field(c, p + uSunDir * (0.22 * Rc));
        float od = smoothstep(0.08, 0.55, l1) * 1.15;
#if VLIGHT > 1
        float l2 = field(c, p + uSunDir * (0.62 * Rc)); od = od * 0.6 + smoothstep(0.08, 0.55, l2) * 1.25;
#endif
        od = od * (1.0 + Rc * 0.8) + dn * 0.35;
        float tl = max(exp(-od * 1.3), 0.45 * exp(-od * 0.25));
        float dark = B.y, h01 = clamp(hy * 0.62, 0.0, 1.0);
        vec3 alb = mix(vec3(1.0), vec3(0.34, 0.37, 0.42), dark);
        vec3 amb = mix(uAmbBase, uAmbTop, h01) * mix(1.0, 0.3, dark * (1.0 - h01));
        vec3 Lc = (uCloudLit * tl * phC * 0.8 + amb * 2.0) * alb;
        vec3 gd = p - uCD[c].xyz;
        Lc += vec3(0.62, 0.8, 1.0) * uCD[c].w * mix(3.5, 9.0, uCE[c].z) / (1.0 + dot(gd, gd) * mix(70.0, 12.0, uCE[c].z) / (Rc * Rc));   /* flicker of charge inside, or the whole cloud lit by its bolt */
        Lc *= mix(1.0, 0.68 + 0.64 * det, dark);
        Lc *= 1.0 + uCE[c].x * 0.6 * (1.0 - smoothstep(0.0, 0.55, dn));                              /* a hovered cloud brightens its outer shell */
        float sig = dn * 9.0 * (1.0 + dark * 0.9);
        ext += sig; sIn += sig * Lc;
      }
      /* --- thin air: haze, fog --- */
      float hz = uHazeP.x * exp(-(p.y + 1.8) * 0.15);
      float fg = 0.0;
      if (fogOn && p.y < 3.4) {
        vec2 uv = wgUV(p.xz); float fd = texture2D(uFogTex, uv).r * 1.6;
        if (fd > 0.004) {
          float gnd = max(wgHeight(p.xz), uLake.x);
          float roll = wgNoise3(vec3(p.x * 1.15 - uWind.w * 0.12, uTime * 0.05, p.z * 1.15)) + 0.5 * wgNoise3(vec3(p.x * 3.1, p.y * 2.0 - uTime * 0.03, p.z * 3.1 + uWind.w * 0.1));
          float topY = gnd + fd * (0.6 + 0.42 * roll);
          float in01 = smoothstep(topY, topY - 0.26, p.y);
          fg = in01 * (2.4 + 2.2 * clamp(topY - p.y, 0.0, 1.0)) * smoothstep(0.0, 0.14, fd);
        }
      }
      float thin = hz + fg;
      if (thin > 0.0005) {
        float lit = 1.0;
        if (shafts) lit = shadowTap(p) * wgCloudShadow(p);
        vec3 Lt = uCloudLit * lit * phH * 0.34 * (0.4 + 0.6 * step(0.001, fg) + uHazeP.y) + uHazeCol * 0.55 + uAmbTop * 0.35;
        Lt += uFlashCol * 0.5 / (1.0 + dot(p - uFlashPos, p - uFlashPos) * 0.06);
        ext += thin; sIn += thin * Lt * mix(vec3(1.0), uHazeCol / max(max(uHazeCol.r, uHazeCol.g), max(uHazeCol.b, 0.05)), 0.35);
      }
      float dt = dC > 0.0 ? clamp(dC * 0.85 + fine * 0.5, fine, coarse) : fine * (1.0 + float(i) * ${(1.6 / Q.volSteps).toFixed(4)});
      if (fg > 0.0 || (fogOn && p.y < 2.2)) dt = min(dt, 0.2);
      dt = min(dt, tF - t + 0.002);
      if (ext > 0.0) { float a = 1.0 - exp(-ext * dt); acc += T * a * (sIn / ext); T *= 1.0 - a; }
      t += dt;
    }
    /* rainbow: opposite the true sun, only where rain is falling in sunlight */
    if (uRainP.w > 0.003 && rainOD > 0.001) {
      float ang = degrees(acos(clamp(dot(rd, -uTrueSun.xyz), -1.0, 1.0)));
      float k = clamp(rainOD * 2.2, 0.0, 1.0) * uRainP.w;
      vec3 bow = spectrum((ang - 40.4) / 2.1) * smoothstep(40.0, 40.6, ang) * smoothstep(42.9, 42.2, ang);
      bow += spectrum(1.0 - (ang - 50.2) / 3.2) * smoothstep(49.8, 50.6, ang) * smoothstep(53.8, 53.0, ang) * 0.32;
      acc += bow * k * 0.9 * (0.3 + 0.7 * T);
      acc *= 1.0 - 0.12 * k * smoothstep(42.8, 44.0, ang) * smoothstep(50.2, 49.0, ang);            /* the darker band between the bows */
    }
  }
  gl_FragColor = vec4(acc, T);
}`;
    volMat = WG.render.fsMaterial(frag, Object.assign({}, G, VU));
    WG.render.volMaterial = volMat;
  }
  let frameN = 0;
  function sync() {
    const list = CL.list; let nC = 0;
    for (let i = 0; i < list.length && nC < MAXC; i++) {
      const c = list[i], n = Math.min(LPC, c.lobes.length), b = nC * LPC * 4;
      for (let j = 0; j < n; j++) { const l = c.lobes[j]; lobeArr[b + j * 4] = l.x; lobeArr[b + j * 4 + 1] = l.y; lobeArr[b + j * 4 + 2] = l.z3; lobeArr[b + j * 4 + 3] = Math.max(0.02, l.wr) * (l.kind === 2 ? -1 : 1); }
      cA[nC * 4] = c.bx; cA[nC * 4 + 1] = c.by; cA[nC * 4 + 2] = c.bz; cA[nC * 4 + 3] = c.br;
      cB[nC * 4] = c.baseY; cB[nC * 4 + 1] = c.dark; cB[nC * 4 + 2] = c.alpha; cB[nC * 4 + 3] = n;
      cC[nC * 4] = c.x; cC[nC * 4 + 1] = c.z; cC[nC * 4 + 2] = Math.max(0.3, c.R * 1.35 + c.stormK * c.R * 0.5); cC[nC * 4 + 3] = c.rain * c.alpha;   // rain shaft: axis, radius, rate
      cE[nC * 4] = c.hoverK; cE[nC * 4 + 1] = c.R; cE[nC * 4 + 2] = c.glowBig || 0;
      cD[nC * 4] = c.gx; cD[nC * 4 + 1] = c.gy; cD[nC * 4 + 2] = c.gz; cD[nC * 4 + 3] = c.glow;
      nC++;
    }
    VU.uCount.value = nC;
    const sky = WG.sky, R = WG.render;
    VU.uScene.value = R.rtScene.texture; VU.uInvVP.value.copy(R.invVP); VU.uCam.value.copy(WG.camera.position);
    VU.uHazeCol.value.copy(sky.hazeCol); VU.uHazeP.value.set(sky.hazeDen, sky.shaft, S.fogAvg, 0);
    VU.uCloudLit.value.copy(sky.cloudLit); VU.uAmbTop.value.copy(sky.cloudAmbTop); VU.uAmbBase.value.copy(sky.cloudAmbBase);
    VU.uTrueSun.value.set(S.sunDir.x, S.sunDir.y, S.sunDir.z, 0);
    /* a rainbow needs rain falling in sunlight with the sun fairly low */
    const w = S.wind; VU.uRainP.value.set(-w.dx * w.speed * 0.16, -w.dz * w.speed * 0.16, 1, rainbowK);
    VU.uFrame.value = WG.reducedMotion ? 0 : (frameN++ % 8);
  }

  WG.register('clouds', {
    init() {
      const sc = WG.scenario || { clouds: [] };
      for (const o of sc.clouds || []) CL.spawn(Object.assign({ instant: true, water: 0.28 }, o));
      buildMap(); buildVol();
      WG.render.pre.push((renderer) => { renderMap(renderer); sync(); });
      update(1 / 60);
    },
    update(dt) { update(dt); },
  });
})();
