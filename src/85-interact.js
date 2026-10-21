/* Weatherglass — interaction: every pointer, touch and keyboard gesture on the scene.
   The hand tool (clouds, the sun and moon, trees, water, the gauge, tapping the glass), the wind, cloud, fog and wipe tools,
   camera gestures (orbit, pan, zoom, pinch), cursors, and two small effects of its own: the white wisps that trace a wind
   stroke (pass B) and the soft rolling puffs where fog is poured (pass A). */
(function () {
  'use strict';
  const WG = window.WG, THREE = WG.THREE, U = WG.util, C = WG.C, S = WG.state, W = WG.world, T = WG.terrain;
  const canvas = document.getElementById('wg-canvas');
  const IA = (WG.interact = { gesture: null, cursor: 'default', hoverKind: null });
  if (!canvas) return;

  /* ------------------------------------------------------------ guarded calls into other parts */
  const warned = {};
  function call(o, k, a, b, c, d, e) {
    if (!o || typeof o[k] !== 'function') return undefined;
    try { return o[k](a, b, c, d, e); } catch (err) { if (!warned[k]) { warned[k] = 1; console.warn('[WG] interact -> ' + k, err); } return undefined; }
  }
  const emit = (n, d) => WG.bus.emit(n, d);
  const wall = () => performance.now() / 1000;
  const panAt = (x, y, z) => (WG.cam ? WG.cam.panOf(x, y, z) : 0);
  const tool = () => (WG.api && WG.api.tool) || 'hand';

  /* rays (the rig hands out shared vectors: copy them) */
  const O = new THREE.Vector3(), D = new THREE.Vector3();
  function ray(x, y) { const r = WG.cam.ray(x, y); O.copy(r.o); D.copy(r.d); }
  function clampCase(p, mx, mz) { p.x = U.clamp(p.x, C.X0 + mx, C.X1 - mx); p.z = U.clamp(p.z, C.Z0 + mz, C.Z1 - mz); return p; }
  /* where the pointer meets the land (or the water); null if it misses */
  function groundAt(x, y, out) {
    ray(x, y); const t = T.rayHit(O.x, O.y, O.z, D.x, D.y, D.z, true);
    if (t <= 0) return null;
    out.x = O.x + D.x * t; out.y = O.y + D.y * t; out.z = O.z + D.z * t; out.t = t; return out;
  }
  /* the land, else a horizontal plane at height h, kept inside the case */
  function landOrPlane(x, y, h, out) {
    if (groundAt(x, y, out)) return out;
    if (Math.abs(D.y) > 1e-4) { const t = (h - O.y) / D.y; if (t > 0) { out.x = O.x + D.x * t; out.z = O.z + D.z * t; clampCase(out, 0.15, 0.15); out.y = Math.max(T.height(out.x, out.z), S.lakeLevel); return out; } }
    return null;
  }
  /* a point at height h along the pointer ray (the cloud layer), kept inside the case */
  function planeAt(x, y, h, out, mx, mz) {
    ray(x, y); let t = Math.abs(D.y) > 1e-4 ? (h - O.y) / D.y : -1;
    if (!(t > 0) || t > 80) t = WG.cam.dist || 19;
    out.x = O.x + D.x * t; out.y = h; out.z = O.z + D.z * t; return clampCase(out, mx, mz);
  }

  /* ------------------------------------------------------------ picking */
  /* nearest cloud under the pointer; with a tolerance ring of rays so a near miss still catches the edge */
  function pickCloud(x, y, tol) {
    const CL = WG.clouds; if (!CL || !CL.pick) return null;
    ray(x, y); let h = CL.pick(O, D);
    if (h) { h.off = 0; return h; }
    if (!tol) return null;
    for (let ring = 0; ring < 2 && !h; ring++) {
      const rr = tol * (ring ? 1 : 0.55);
      for (let i = 0; i < 8; i++) {
        const a = i * 0.7853982 + ring * 0.39, r = WG.cam.ray(x + Math.cos(a) * rr, y + Math.sin(a) * rr), hh = CL.pick(r.o, r.d);
        if (hh && (!h || hh.t < h.t)) { h = hh; h.off = rr; }
      }
    }
    if (h) { ray(x, y); if (Math.abs(D.y) > 1e-4) { const t = (h.y - O.y) / D.y; if (t > 0) { h.x = O.x + D.x * t; h.z = O.z + D.z * t; h.t = t; } } }
    return h;
  }
  /* the sun or the moon near the pointer (screen distance), with its distance from the camera */
  const bodyPos = new THREE.Vector3();
  function pickBody(x, y, tol) {
    const sky = WG.sky; if (!sky) return null;
    let best = null, bd = tol * tol;
    for (const body of ['sun', 'moon']) {
      const vis = body === 'sun' ? S.sunDir.y > -0.07 : S.moonDir.y > -0.07, sc = body === 'sun' ? sky.sunScreen : sky.moonScreen;
      if (!vis || !sc || !(sc.z > 0)) continue;
      const d2 = (sc.x - x) * (sc.x - x) + (sc.y - y) * (sc.y - y);
      if (d2 < bd) { bd = d2; bodyPos.copy(body === 'sun' ? S.sunPos : S.moonPos); best = { body, dpx: Math.sqrt(d2), dist: WG.cam.pos.distanceTo(bodyPos) }; }
    }
    return best;
  }
  /* everything the hand can reach at a screen point. light = hover only (skips the land march) */
  const PK = { kind: 'air' }, GP = {};
  function pickAt(x, y, touch, light) {
    PK.kind = 'air'; PK.cloud = PK.hit = PK.body = PK.tree = PK.treeHit = PK.water = null;
    if (!WG.cam) return PK;
    ray(x, y);
    if (WG.gauge && call(WG.gauge, 'hit', O, D)) { PK.kind = 'gauge'; return PK; }
    const ch = pickCloud(x, y, touch ? 16 : 6);
    ray(x, y);
    const th = WG.flora ? call(WG.flora, 'pickTree', O, D) : null;
    const bh = pickBody(x, y, touch ? 42 : 30);
    let best = null, bt = 1e9;
    if (ch && ch.off === 0 && ch.t < bt) { best = 'cloud'; bt = ch.t; }
    if (th && th.tree && th.t < bt) { best = 'tree'; bt = th.t; }
    if (bh && (bh.dist < bt || bh.dpx < 9)) { best = 'body'; bt = bh.dist; }
    if (!best && ch) best = 'cloud';
    if (best === 'cloud') { PK.kind = 'cloud'; PK.cloud = ch.cloud; PK.hit = { x: ch.x, y: ch.y, z: ch.z, t: ch.t }; return PK; }
    if (best === 'tree') { PK.kind = 'tree'; PK.tree = th.tree; PK.treeHit = th; return PK; }
    if (best === 'body') { PK.kind = 'body'; PK.body = bh.body; return PK; }
    if (light) return PK;
    if (groundAt(x, y, GP)) {
      const w = T.waterAt(GP.x, GP.z);
      PK.kind = w ? 'water' : 'land'; PK.water = w; PK.px = GP.x; PK.py = GP.y; PK.pz = GP.z;
    }
    return PK;
  }

  /* ------------------------------------------------------------ cursors */
  let ringEl = null, ringPx = 20, ringOn = false;
  function makeRing() {
    const root = document.getElementById('wg-root') || document.body, ui = document.getElementById('wg-ui');
    ringEl = document.createElement('div');
    ringEl.setAttribute('aria-hidden', 'true');
    ringEl.style.cssText = 'position:absolute;left:0;top:0;width:40px;height:40px;margin:0;border-radius:50%;pointer-events:none;display:none;box-sizing:border-box;' +
      'border:1.5px solid rgba(244,239,230,0.88);box-shadow:0 0 0 1px rgba(0,0,0,0.22),inset 0 0 0 1px rgba(0,0,0,0.14),inset 0 0 10px rgba(255,255,255,0.12);' +
      'transition:transform 0.09s ease-out, opacity 0.2s ease;will-change:transform;z-index:1;';
    const dot = document.createElement('div');
    dot.style.cssText = 'position:absolute;left:50%;top:50%;width:3px;height:3px;margin:-1.5px 0 0 -1.5px;border-radius:50%;background:rgba(244,239,230,0.75);';
    ringEl.appendChild(dot);
    if (ui && ui.parentNode === root) root.insertBefore(ringEl, ui); else root.appendChild(ringEl);
  }
  let ringPressed = false;
  function placeRing(x, y) {
    if (!ringEl) return;
    const s = ringPressed ? 0.9 : 1;
    ringEl.style.width = ringEl.style.height = (ringPx * 2) + 'px';
    ringEl.style.transform = `translate(${(x - ringPx).toFixed(1)}px, ${(y - ringPx).toFixed(1)}px) scale(${s})`;
    ringEl.style.borderColor = ringPressed ? 'rgba(255,217,138,0.95)' : 'rgba(244,239,230,0.88)';
  }
  function showRing(on) { if (!ringEl || on === ringOn) return; ringOn = on; ringEl.style.display = on ? 'block' : 'none'; }
  function setCursor(c) { if (c !== IA.cursor) { IA.cursor = c; canvas.style.cursor = c; } }

  /* ------------------------------------------------------------ state */
  const pts = new Map();            // live pointers: id -> {x, y, type}
  let g = null;                     // the gesture in progress
  const ptr = { x: 0, y: 0, inside: false, type: 'mouse', dirty: true };
  let hoverT = 0, audioStarted = false;
  const firstHover = { sun: false, moon: false };
  let hovCloud = null, hovTree = null, hovBody = null;
  function startAudio() { if (audioStarted) return; if (WG.audio && WG.audio.start) { audioStarted = true; call(WG.audio, 'start'); } }
  function touchInput() { if (WG.cam) WG.cam.idle = 0; }
  function local(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  /* sun / moon dragging */
  const SD = { body: null, h: 0, v: 0, tgt: 0, h0: 0, dragEvt: false, coast: 0 };
  const bdir = new THREE.Vector3(), bpos = new THREE.Vector3(), bscr = {};
  function bodyScreen(body, h) { (body === 'moon' ? W.moonDirAt : W.sunDirAt)(h, bdir); W.orbit(bdir, bpos); return WG.cam.project(bpos.x, bpos.y, bpos.z, bscr); }
  /* the hour, near `center`, whose projected body lies nearest the pointer: a local search keeps it on the path, never jumping across */
  function nearestHour(body, center, px, py, span, step) {
    let best = center, bd = 1e18;
    for (let h = center - span; h <= center + span + 1e-9; h += step) {
      const p = bodyScreen(body, h); if (!(p.z > 0.2)) continue;
      const dh = h - center, d = (p.x - px) * (p.x - px) + (p.y - py) * (p.y - py) + 30 * dh * dh;
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }
  function beginBody(body, x, y) {
    SD.body = body; SD.h = SD.h0 = S.time; SD.v = 0; SD.coast = 0; SD.dragEvt = false;
    SD.tgt = nearestHour(body, S.time, x, y, 0.75, 0.025); SD.tgt = nearestHour(body, SD.tgt, x, y, 0.03, 0.003);
    if (WG.sky) WG.sky.grab = body;
    emit('sun:grab', { body });
  }
  function endBody() {
    if (WG.sky) WG.sky.grab = null;
    const v = U.clamp(SD.v * 0.6, -6, 6); SD.coast = Math.abs(v) > 0.4 ? v : 0; SD.body = null;
  }
  WG.bus.on('time:scrub', () => { SD.coast = 0; });

  /* orbit inertia */
  const OI = { az: 0, el: 0, vaz: 0, vel: 0, lastT: 0 };
  function orbitBy(dxPx, dyPx, touch) {
    const k = touch ? 0.0072 : 0.0062, da = -dxPx * k, de = dyPx * k * 0.8;
    WG.cam.orbit(da, de);
    const t = wall(), dt = Math.max(0.008, t - OI.lastT); OI.lastT = t;
    OI.vaz = U.lerp(OI.vaz, da / dt, 0.5); OI.vel = U.lerp(OI.vel, de / dt, 0.5);
  }

  /* ------------------------------------------------------------ gestures */
  const DRAG_PX = (gs) => (gs.type === 'touch' ? 9 : 4);
  function newGesture(e, p, kind) {
    return { id: e.pointerId, type: e.pointerType || 'mouse', button: e.button, kind, x0: p.x, y0: p.y, x: p.x, y: p.y, ex: p.x, ey: p.y, ax: p.x, ay: p.y, t0: wall(), moved: 0, still: 0, sp: 0 };
  }
  function startGesture(e, p) {
    const touch = e.pointerType === 'touch';
    if (e.button === 2) { g = newGesture(e, p, 'orbit'); return; }
    if (e.button === 1) { g = newGesture(e, p, 'pan'); return; }
    if (e.button !== 0) return;
    const gs = (g = newGesture(e, p, 'empty'));
    OI.vaz = OI.vel = 0; SD.coast = 0;
    ray(p.x, p.y);
    if (WG.gauge && call(WG.gauge, 'hit', O, D)) { call(WG.gauge, 'tap'); gs.noTap = true; IA.gesture = gs.kind; return; }
    const tl = tool();
    if (tl === 'hand') startHand(gs, p.x, p.y, touch);
    else if (tl === 'wind') startWind(gs, p.x, p.y);
    else if (tl === 'cloud') startCloudTool(gs, p.x, p.y, touch);
    else if (tl === 'fog') startFog(gs, p.x, p.y);
    else if (tl === 'wipe') startWipe(gs, p.x, p.y);
    IA.gesture = gs.kind;
  }
  function startHand(gs, x, y, touch) {
    const pk = pickAt(x, y, touch, false);
    if (pk.kind === 'cloud' && WG.clouds && WG.clouds.grab) {
      gs.kind = 'cloud'; gs.cloud = pk.cloud; WG.clouds.grab(pk.cloud, pk.hit);
    } else if (pk.kind === 'body') {
      gs.kind = 'sun'; beginBody(pk.body, x, y);
    } else if (pk.kind === 'tree') {
      gs.kind = 'treePending'; gs.tree = pk.tree; gs.treeHit = pk.treeHit;
    } else if (pk.kind === 'water') {
      gs.kind = 'water'; gs.water = pk.water; gs.px = pk.px; gs.pz = pk.pz; gs.wx = pk.px; gs.wz = pk.pz; gs.lwx = pk.px; gs.lwz = pk.pz; gs.ringT = 0;
    } else {
      gs.kind = 'empty'; gs.noTap = pk.kind === 'land';
    }
  }
  function endGesture(normal) {
    const gs = g; if (!gs) return; g = null; IA.gesture = null;
    const dur = wall() - gs.t0, small = gs.moved < (gs.type === 'touch' ? 12 : 6), click = normal && small && dur < 0.4;
    switch (gs.kind) {
      case 'cloud': if (WG.clouds && WG.clouds.held) call(WG.clouds, 'release'); break;
      case 'sun': endBody(); break;
      case 'treePending':
        if (click && gs.tree) { const f = WG.cam.fwd, l = Math.hypot(f.x, f.z) || 1; call(WG.flora, 'flickTree', gs.tree, f.x / l, f.z / l); }
        break;
      case 'tree': call(WG.flora, 'releaseTree'); break;
      case 'water': if (click) call(WG.water, 'splash', gs.px, gs.pz, 0.8); break;
      case 'empty': if (click && !gs.noTap) { ray(gs.x, gs.y); call(WG.glass, 'tapRay', O, D); } break;
      case 'orbit': case 'pinch':
        if (wall() - OI.lastT < 0.07) { OI.az = U.clamp(OI.vaz, -6, 6) * 0.35; OI.el = U.clamp(OI.vel, -3, 3) * 0.25; } else OI.az = OI.el = 0;
        break;
      case 'wipe': ringPressed = false; if (ringOn) placeRing(ptr.x, ptr.y); break;
      default: break;
    }
    if (normal && small && dur < 0.5 && gs.button === 0 && gs.kind !== 'pinch') emit('scene:click', { x: gs.x, y: gs.y });
    ptr.dirty = true;
  }
  IA.cancel = () => { endGesture(false); pts.clear(); };

  /* -------------------------------- wind tool */
  const WP = {};
  function startWind(gs, x, y) {
    gs.kind = 'wind'; strokeId++;
    const p = landOrPlane(x, y, 1, WP); gs.has = !!p; if (p) { gs.wx = p.x; gs.wz = p.z; gs.tx = p.x; gs.tz = p.z; }
    gs.evT = 0; gs.bugT = 0;
  }
  function updWind(gs, dt) {
    const p = landOrPlane(gs.x, gs.y, 1, WP); if (!p) return;
    if (!gs.has) { gs.has = true; gs.wx = gs.tx = p.x; gs.wz = gs.tz = p.z; return; }
    const dx = p.x - gs.wx, dz = p.z - gs.wz, d = Math.hypot(dx, dz), sp = Math.min(9, d / Math.max(dt, 1e-3));
    gs.sp = U.damp(gs.sp, sp, sp > gs.sp ? 18 : 6, dt);
    if (d > 0.004 && sp > 0.2) {
      const ux = dx / d, uz = dz / d, s = Math.max(sp, gs.sp * 0.6), R = 0.95 + 0.3 * Math.min(1, s / 5);
      const n = Math.max(1, Math.ceil(d / 0.3)), A = Math.min(1.3, 0.42 * s * (d / n) / R);
      for (let i = 1; i <= n; i++) {
        const f = i / n, qx = gs.wx + dx * f, qz = gs.wz + dz * f;
        W.gust(qx, qz, ux * A, uz * A, R);
        if (Math.hypot(qx - gs.tx, qz - gs.tz) > 0.13) { gs.tx = qx; gs.tz = qz; addTrail(qx, Math.max(T.height(qx, qz), S.lakeLevel) + 0.32, qz, 0.25 + 0.75 * U.sat(s / 5)); }
      }
      const pan = panAt(p.x, p.y, p.z), lvl = U.sat(s / 6);
      if (WG.audio) call(WG.audio, 'cont', 'windsweep', lvl, pan);
      gs.evT -= dt; if (gs.evT <= 0) { gs.evT = 0.1; emit('wind:sweep', { x: p.x, z: p.z, speed: s, pan }); }
      gs.bugT -= dt; if (gs.bugT <= 0 && s > 1) { gs.bugT = 0.25; call(WG.fauna, 'scatterInsects', p.x, p.z, 1.3); }
    }
    gs.wx = p.x; gs.wz = p.z;
  }

  /* -------------------------------- cloud tool */
  const CP = {};
  function startCloudTool(gs, x, y, touch) {
    gs.kind = 'cloudtool';
    const CL = WG.clouds; if (!CL) return;
    const pc = pickCloud(x, y, touch ? 14 : 5);
    if (pc) { gs.cloud = pc.cloud; gs.fedOld = true; }
    else if (CL.spawn) { const p = planeAt(x, y, 5.3, CP, 0.8, 0.7); gs.cloud = CL.spawn({ x: p.x, y: 5.3 + (Math.random() - 0.5) * 0.16, z: p.z, vol: 0.12, water: 0.25 }); }
    gs.lpx = gs.lpz = null;
  }
  function updCloudTool(gs, dt) {
    const CL = WG.clouds, c = gs.cloud; if (!CL || !c) return;
    if (c.dying || CL.list.indexOf(c) < 0) { gs.cloud = null; return; }
    call(CL, 'feed', c, dt);
    if (gs.moved > DRAG_PX(gs) + 2 && CL.paint) {
      const p = planeAt(gs.x, gs.y, c.y, CP, 0.3, 0.3);
      if (gs.lpx === null || Math.hypot(p.x - gs.lpx, p.z - gs.lpz) > Math.max(0.22, c.R * 0.4)) { gs.lpx = p.x; gs.lpz = p.z; call(CL, 'paint', c, p.x, c.y + (Math.random() - 0.4) * 0.12 * c.R, p.z); }
    }
  }

  /* -------------------------------- fog tool */
  const FP = {};
  function fogPoint(x, y) { return landOrPlane(x, y, 0.6, FP); }
  function startFog(gs, x, y) {
    gs.kind = 'fog'; gs.evT = 0.4; gs.puffT = 0; gs.pourT = 0;
    const p = fogPoint(x, y); gs.has = !!p; if (!p) return;
    W.addFog(p.x, p.z, 0.45, 0.55); gs.fx = gs.lx = p.x; gs.fz = gs.lz = p.z;
    for (let i = 0; i < 6; i++) addPuff(p.x, p.z, 0.75, 1);
    emit('fog:pour', { x: p.x, z: p.z, pan: panAt(p.x, p.y, p.z) });
  }
  function updFog(gs, dt) {
    const p = fogPoint(gs.x, gs.y); if (!p) return;
    if (!gs.has) { gs.has = true; gs.fx = gs.lx = p.x; gs.fz = gs.lz = p.z; }
    const d = Math.hypot(p.x - gs.fx, p.z - gs.fz);
    gs.fx = p.x; gs.fz = p.z;
    let poured = false;
    if (d > 0.03) {
      gs.still = 0;
      /* paint a trail: a puff every 0.14 along the stroke */
      let ld = Math.hypot(p.x - gs.lx, p.z - gs.lz);
      while (ld > 0.14) {
        const f = 0.14 / ld; gs.lx += (p.x - gs.lx) * f; gs.lz += (p.z - gs.lz) * f; ld -= 0.14;
        W.addFog(gs.lx, gs.lz, 0.2, 0.45); if (Math.random() < 0.55) addPuff(gs.lx, gs.lz, 0.35, 0.75);
        poured = true;
      }
    } else {
      gs.still += dt;
      if (gs.still > 0.25) {
        /* hold still: pour a growing mound */
        const k = Math.min(1, (gs.still - 0.25) / 3), r = 0.45 + 0.6 * k;
        W.addFog(p.x, p.z, dt * (1.3 + 1.1 * k), r);
        gs.puffT -= dt; if (gs.puffT <= 0) { gs.puffT = 0.11; addPuff(p.x, p.z, 0.55 + 0.4 * k, 0.8 + 0.5 * k); }
        gs.lx = p.x; gs.lz = p.z; poured = true;
      }
    }
    gs.evT -= dt; if (poured && gs.evT <= 0) { gs.evT = 0.45; emit('fog:pour', { x: p.x, z: p.z, pan: panAt(p.x, p.y, p.z) }); }
  }

  /* -------------------------------- wipe tool */
  function wipeRadius(x, y) {
    ray(x, y); let t = 0;
    const h = WG.glass ? call(WG.glass, 'hitRay', O, D) : null; if (h && h.t > 0) t = h.t; else t = Math.max(3, (WG.cam.dist || 19) - 5);
    const px = (2 * Math.tan((WG.camera.fov * Math.PI) / 360)) * t / Math.max(1, WG.render.cssH || 500);
    return U.clamp(ringPx * px, 0.12, 1.1);
  }
  function wipeAt(gs, x, y) { const r = wipeRadius(x, y); ray(x, y); call(WG.glass, 'wipeRay', O, D, r); gs.wiped = (gs.wiped || 0) + 1; }
  function startWipe(gs, x, y) { gs.kind = 'wipe'; gs.lx = x; gs.ly = y; gs.px = 0; ringPressed = true; placeRing(x, y); wipeAt(gs, x, y); }
  function moveWipe(gs, x, y) {
    let d = Math.hypot(x - gs.lx, y - gs.ly); const step = Math.max(4, ringPx * 0.35);
    while (d >= step) { const f = step / d; gs.lx += (x - gs.lx) * f; gs.ly += (y - gs.ly) * f; d -= step; wipeAt(gs, gs.lx, gs.ly); gs.px += step; }
  }

  /* -------------------------------- per-frame updates of held gestures */
  const AP = {};
  function updGesture(gs, dt) {
    switch (gs.kind) {
      case 'cloud': {
        const CL = WG.clouds;
        const c = CL && CL.held;
        if (!c) { gs.kind = 'none'; break; }                 // it evaporated or merged away in our hands
        ray(gs.ax, gs.ay);
        /* depth assist: carried over another cloud, aim at that cloud's depth so the two meet where they appear to overlap */
        if (gs.grabY0 === undefined) { gs.grabY0 = c.grabY; gs.dy0 = c.grabY - c.y; }
        let aim = gs.grabY0;
        for (const o of CL.list) {
          if (o === c || o.dying || o.alpha < 0.6) continue;
          const wx = o.bx - O.x, wy = o.by - O.y, wz = o.bz - O.z, t = wx * D.x + wy * D.y + wz * D.z; if (t <= 0) continue;
          if (Math.hypot(wx - D.x * t, wy - D.y * t, wz - D.z * t) < o.br * 0.62 + c.R * 0.25) { aim = o.y + gs.dy0; break; }
        }
        c.grabY = U.damp(c.grabY, aim, 9, dt);
        CL.dragTo(O, D);                                     // every frame, even when still: stillness squeezes, shaking charges
        break;
      }
      case 'sun': {
        const b = SD.body; if (!b) break;
        SD.tgt = nearestHour(b, SD.tgt, gs.x, gs.y, 0.75, 0.025); SD.tgt = nearestHour(b, SD.tgt, gs.x, gs.y, 0.03, 0.003);
        const k = 110, c = 2 * Math.sqrt(k) * 0.72;
        SD.v += ((SD.tgt - SD.h) * k - SD.v * c) * dt; SD.h += SD.v * dt;
        if (WG.api) WG.api.setTime(U.wrap(SD.h, 24));
        if (!SD.dragEvt && Math.abs(SD.h - SD.h0) > 0.5) { SD.dragEvt = true; emit('sun:drag', { body: b }); }
        break;
      }
      case 'treePending':
        if (wall() - gs.t0 > 0.22) { gs.kind = 'tree'; call(WG.flora, 'grabTree', gs.tree, gs.treeHit); }
        break;
      case 'tree': ray(gs.x, gs.y); call(WG.flora, 'pullTree', O, D); break;
      case 'water': {
        if (!groundAt(gs.x, gs.y, AP)) break;
        const kind = T.waterAt(AP.x, AP.z); if (!kind) { gs.still = 0; break; }
        const frozen = (kind === 'lake' && S.ice > 0.5) || (kind === 'river' && S.riverIce > 0.5);
        const d = Math.hypot(AP.x - gs.wx, AP.z - gs.wz);
        if (d > 0.012) {
          gs.still = 0;
          const ld = Math.hypot(AP.x - gs.lwx, AP.z - gs.lwz);
          if (!frozen && gs.moved > DRAG_PX(gs) && ld > 0.07) {
            const v = Math.min(4, d / Math.max(dt, 1e-3)), ux = (AP.x - gs.lwx) / ld, uz = (AP.z - gs.lwz) / ld;
            call(WG.water, 'wake', AP.x, AP.z, ux * v, uz * v); gs.lwx = AP.x; gs.lwz = AP.z;
          }
        } else gs.still += dt;
        gs.wx = AP.x; gs.wz = AP.z;
        if (gs.still > 0.3 && !frozen) { gs.ringT -= dt; if (gs.ringT <= 0) { gs.ringT = 0.25; call(WG.water, 'ring', AP.x, AP.z, 0.2); } }
        break;
      }
      case 'wind': updWind(gs, dt); break;
      case 'cloudtool': updCloudTool(gs, dt); break;
      case 'fog': updFog(gs, dt); break;
      case 'wipe': {
        /* the glass calls audio.cont('wipe') itself (it knows whether there was mist to wipe); stand in only when it cannot */
        const sp = gs.px / Math.max(dt, 1e-3); gs.px = 0; gs.sp = U.damp(gs.sp, sp, 10, dt);
        if (gs.sp > 30 && WG.audio && !(WG.glass && WG.glass.wipeRay)) { const cw = (WG.render && WG.render.cssW) || 800; call(WG.audio, 'cont', 'wipe', U.sat(gs.sp / 1400), U.clamp((gs.x / cw) * 2 - 1, -1, 1)); }
        break;
      }
      default: break;
    }
  }

  /* ------------------------------------------------------------ DOM events */
  function onDown(e) {
    if (WG.ui && WG.ui.isOver && call(WG.ui, 'isOver', e.clientX, e.clientY)) return;
    startAudio(); touchInput();
    if (!WG.ready || !WG.cam) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const p = local(e); p.type = e.pointerType; pts.set(e.pointerId, p);
    ptr.x = p.x; ptr.y = p.y; ptr.type = e.pointerType; ptr.inside = true;
    if (e.pointerType === 'touch' && pts.size === 2) {
      /* a second finger: whatever the first was doing ends, the two now zoom and orbit */
      endGesture(false);
      const a = [...pts.values()];
      g = { kind: 'pinch', type: 'touch', button: 0, t0: wall(), moved: 99, d: Math.hypot(a[1].x - a[0].x, a[1].y - a[0].y), mx: (a[0].x + a[1].x) / 2, my: (a[0].y + a[1].y) / 2 };
      IA.gesture = 'pinch'; return;
    }
    if (pts.size > 1 || g) return;
    startGesture(e, p);
    ptr.dirty = true;
  }
  function onMove(e) {
    const p = local(e);
    ptr.x = p.x; ptr.y = p.y; ptr.type = e.pointerType; ptr.dirty = true;
    if (e.pointerType !== 'touch') ptr.inside = true;
    if (ringOn) placeRing(p.x, p.y);
    touchInput();
    const q = pts.get(e.pointerId);
    if (!q) return;
    const ox = q.x, oy = q.y; q.x = p.x; q.y = p.y;
    const gs = g; if (!gs) return;
    if (gs.kind === 'pinch') {
      if (pts.size < 2) return;
      const a = [...pts.values()], d = Math.max(12, Math.hypot(a[1].x - a[0].x, a[1].y - a[0].y)), mx = (a[0].x + a[1].x) / 2, my = (a[0].y + a[1].y) / 2;
      WG.cam.dolly(U.clamp(gs.d / d, 0.8, 1.25)); orbitBy(mx - gs.mx, my - gs.my, true);
      gs.d = d; gs.mx = mx; gs.my = my; return;
    }
    if (gs.id !== e.pointerId) return;
    gs.x = p.x; gs.y = p.y;
    gs.moved = Math.max(gs.moved, Math.hypot(p.x - gs.x0, p.y - gs.y0));
    /* a lazy anchor: a hand never holds perfectly still, so tiny tremors do not count as motion (keeps the squeeze going) */
    const dz = gs.type === 'touch' ? 5 : 2.5, ad = Math.hypot(p.x - gs.ax, p.y - gs.ay);
    if (ad > dz) { const f = (ad - dz) / ad; gs.ax += (p.x - gs.ax) * f; gs.ay += (p.y - gs.ay) * f; }
    const dxp = p.x - ox, dyp = p.y - oy;
    switch (gs.kind) {
      case 'empty': if (gs.moved > DRAG_PX(gs)) { gs.kind = 'orbit'; IA.gesture = 'orbit'; orbitBy(p.x - gs.x0, p.y - gs.y0, gs.type === 'touch'); } break;
      case 'orbit': orbitBy(dxp, dyp, gs.type === 'touch'); break;
      case 'pan': { const s = (2 * Math.tan((WG.camera.fov * Math.PI) / 360) * (WG.cam.dist || 19)) / Math.max(1, WG.render.cssH || 500); WG.cam.pan(dxp * s * 0.9, -dyp * s * 0.9); break; }
      case 'treePending': if (gs.moved > DRAG_PX(gs) + 1) { gs.kind = 'tree'; call(WG.flora, 'grabTree', gs.tree, gs.treeHit); } break;
      case 'wipe': moveWipe(gs, p.x, p.y); break;
      default: break;
    }
  }
  function onUp(e) {
    const had = pts.delete(e.pointerId);
    try { if (canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    if (!g) return;
    if (g.kind === 'pinch') { if (pts.size < 2) { endGesture(true); g = { kind: 'none', type: 'touch', button: -1, t0: wall(), moved: 99 }; } if (pts.size === 0) { g = null; IA.gesture = null; } return; }
    if (g.kind === 'none') { if (pts.size === 0) { g = null; IA.gesture = null; } return; }
    if (g.id === e.pointerId) {
      if (had) { const p = local(e); g.x = p.x; g.y = p.y; }
      endGesture(e.type === 'pointerup');
    }
    if (e.pointerType === 'touch') { ptr.inside = false; ptr.dirty = true; }
  }
  function onLost(e) { if (g && g.id === e.pointerId && pts.has(e.pointerId)) { pts.delete(e.pointerId); endGesture(false); } }
  function onLeave(e) { if (e.pointerType !== 'touch' && !pts.size) { ptr.inside = false; ptr.dirty = true; } }
  function onWheel(e) {
    e.preventDefault(); touchInput(); if (!WG.cam) return;
    let dy = e.deltaY, dx = e.deltaX; if (e.deltaMode === 1) { dy *= 33; dx *= 33; } else if (e.deltaMode === 2) { dy *= 400; dx *= 400; }
    const p = local(e);
    if (tool() === 'hand' && !e.ctrlKey && !g) {
      const h = pickCloud(p.x, p.y, 6);
      if (h && WG.clouds && WG.clouds.wheelSqueeze) { WG.clouds.wheelSqueeze(h.cloud, U.clamp(Math.abs(dy) / 480, 0.025, 0.32)); return; }
    }
    if (e.ctrlKey) WG.cam.dolly(Math.exp(U.clamp(dy, -60, 60) * 0.011));       // trackpad pinch
    else {
      WG.cam.dolly(Math.exp(U.clamp(dy, -320, 320) * 0.0011));
      if (Math.abs(dx) > Math.abs(dy) * 1.5) WG.cam.orbit(-U.clamp(dx, -200, 200) * 0.0035, 0);  // trackpad sideways swipe
    }
  }
  let gScale = 1;
  function onGesture(e) { e.preventDefault(); touchInput(); if (e.type === 'gesturestart') gScale = 1; else if (WG.cam && e.scale > 0) { WG.cam.dolly(U.clamp(gScale / e.scale, 0.8, 1.25)); gScale = e.scale; } }
  const KEYS = { 1: 'hand', 2: 'wind', 3: 'cloud', 4: 'fog', 5: 'wipe', h: 'hand', w: 'wind', c: 'cloud', f: 'fog', g: 'wipe' };
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))) return;
    startAudio(); touchInput();
    const k = (e.key || '').toLowerCase();
    if (KEYS[k]) { if (WG.api && WG.api.setTool) WG.api.setTool(KEYS[k]); e.preventDefault(); }
    else if (k === 'u') { if (!e.repeat && WG.api && WG.api.toggleUI) WG.api.toggleUI(); e.preventDefault(); }
    else if (k === 'escape' && g) endGesture(false);
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('lostpointercapture', onLost);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') { ptr.inside = true; ptr.dirty = true; } });
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('gesturestart', onGesture); canvas.addEventListener('gesturechange', onGesture);
  window.addEventListener('keydown', onKey);
  window.addEventListener('blur', () => IA.cancel());
  document.addEventListener('visibilitychange', () => { if (document.hidden) IA.cancel(); });

  /* ------------------------------------------------------------ hover and cursors */
  function setHover(cloud, body, tree) {
    const CL = WG.clouds;
    if (CL && CL.hover !== cloud) CL.hover = cloud;
    hovCloud = cloud;
    if (WG.sky && WG.sky.hover !== body) WG.sky.hover = body;
    if (body && !firstHover[body]) { firstHover[body] = true; emit(body + ':hover', { body }); }
    hovBody = body;
    if (tree !== hovTree) { hovTree = tree; if (WG.flora) call(WG.flora, 'hoverTree', tree); }
  }
  function hoverTick(dt) {
    const tl = tool();
    hoverT -= dt;
    let cur = tl === 'hand' ? 'default' : tl === 'wipe' ? 'none' : 'crosshair';
    showRing(tl === 'wipe' && ptr.inside && ptr.type !== 'touch');
    if (g) {
      const k = g.kind;
      if (k === 'cloud') { setHover(g.cloud, null, null); cur = 'grabbing'; }
      else if (k === 'sun') { setHover(null, SD.body, null); cur = 'grabbing'; }
      else if (k === 'tree' || k === 'treePending') { setHover(null, null, g.tree); cur = 'grabbing'; }
      else if (k === 'orbit' && tl === 'hand') { setHover(null, null, null); cur = 'grabbing'; }
      else setHover(tl === 'cloud' && k === 'cloudtool' ? g.cloud : null, null, null);
    } else if (ptr.inside && ptr.type !== 'touch' && WG.cam) {
      if (ptr.dirty || hoverT <= 0) {
        ptr.dirty = false; hoverT = 0.12;
        if (tl === 'hand') {
          const pk = pickAt(ptr.x, ptr.y, false, true);
          IA.hoverKind = pk.kind;
          setHover(pk.kind === 'cloud' ? pk.cloud : null, pk.kind === 'body' ? pk.body : null, pk.kind === 'tree' ? pk.tree : null);
        } else if (tl === 'cloud') {
          const h = pickCloud(ptr.x, ptr.y, 5); IA.hoverKind = h ? 'cloud' : null; setHover(h ? h.cloud : null, null, null);
        } else { IA.hoverKind = null; setHover(null, null, null); }
        if (tl === 'wipe') { const r0 = ringPx; ringPx = 20; if (r0 !== ringPx) placeRing(ptr.x, ptr.y); }
      }
      if (tl === 'hand') cur = IA.hoverKind === 'cloud' || IA.hoverKind === 'body' || IA.hoverKind === 'tree' ? 'grab' : IA.hoverKind === 'gauge' ? 'pointer' : 'default';
    } else if (!ptr.inside) { IA.hoverKind = null; setHover(null, null, null); }
    setCursor(cur);
  }
  WG.bus.on('tool', () => {
    if (g && g.kind !== 'orbit' && g.kind !== 'pan' && g.kind !== 'pinch' && g.kind !== 'none') endGesture(false);
    ptr.dirty = true; hoverT = 0; if (WG.cam) hoverTick(0);
    if (ringOn) placeRing(ptr.x, ptr.y);
  });

  /* ------------------------------------------------------------ wind wisps: a few faint additive ribbons along each stroke, ~1 s */
  const NP = 150, NR = 3, LIFE = 1.15;
  const tpx = new Float32Array(NP), tpy = new Float32Array(NP), tpz = new Float32Array(NP), tpt = new Float32Array(NP), tpk = new Float32Array(NP), tps = new Int32Array(NP);
  let tpHead = 0, tpCount = 0, strokeId = 0, wisp = null, wPos, wUv, wIdx;
  function addTrail(x, y, z, k) { const i = tpHead; tpx[i] = x; tpy[i] = y; tpz[i] = z; tpt[i] = WG.time; tpk[i] = k; tps[i] = strokeId; tpHead = (tpHead + 1) % NP; tpCount = Math.min(NP, tpCount + 1); }
  function buildWisps() {
    const geo = new THREE.BufferGeometry();
    wPos = new THREE.BufferAttribute(new Float32Array(NR * NP * 2 * 3), 3); wPos.setUsage(THREE.DynamicDrawUsage);
    wUv = new THREE.BufferAttribute(new Float32Array(NR * NP * 2 * 2), 2); wUv.setUsage(THREE.DynamicDrawUsage);
    wIdx = new THREE.BufferAttribute(new Uint16Array(NR * NP * 6), 1); wIdx.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', wPos); geo.setAttribute('uv', wUv); geo.setIndex(wIdx); geo.setDrawRange(0, 0);
    wisp = new THREE.Mesh(geo, WG.mat.unlit({
      name: 'windWisps', additive: true, depthWrite: false, side: THREE.DoubleSide, shadow: false, uniforms: { uK: { value: 0.5 } },
      fragDecl: 'uniform float uK;',
      frag: 'float e = 1.0 - vUv.y * vUv.y; col = vec3(0.9, 0.95, 1.0) * uK * vUv.x * e * e; alpha = 1.0;',
    }));
    wisp.visible = false;
    WG.add(wisp, { pass: 'B', order: 20 });
  }
  const RIB = [[-0.11, 0.0, 1.0, 0.0], [0.03, 0.1, 0.75, 2.1], [0.15, 0.2, 0.55, 4.3]];   // lateral, height, brightness, phase
  function wispsUpdate() {
    if (!wisp) return;
    const t = WG.time, cam = WG.cam.pos;
    while (tpCount > 0 && t - tpt[(tpHead - tpCount + NP) % NP] > LIFE) tpCount--;
    if (tpCount < 2) { wisp.visible = false; return; }
    const P = wPos.array, UV = wUv.array, I = wIdx.array; let nv = 0, ni = 0;
    const o0 = (tpHead - tpCount + NP) % NP;
    for (let r = 0; r < NR; r++) {
      const rb = RIB[r];
      for (let j = 0; j < tpCount; j++) {
        const i = (o0 + j) % NP, ip = j > 0 ? (o0 + j - 1) % NP : i, inx = j < tpCount - 1 ? (o0 + j + 1) % NP : i;
        const a = ip !== i && tps[ip] === tps[i] ? ip : i, b = inx !== i && tps[inx] === tps[i] ? inx : i;
        let tx = tpx[b] - tpx[a], tz = tpz[b] - tpz[a]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        const age = t - tpt[i], wob = Math.sin(t * 2.3 + j * 0.42 + rb[3]) * 0.06 * (age + 0.25);
        const lat = rb[0] * (1 + age * 0.8) + wob;
        const x = tpx[i] - tz * lat, y = tpy[i] + rb[1] + age * 0.2 + Math.sin(t * 1.7 + j * 0.3 + rb[3]) * 0.03, z = tpz[i] + tx * lat;
        /* across the ribbon: perpendicular to the stroke and to the view */
        const vx = cam.x - x, vy = cam.y - y, vz = cam.z - z;
        let sx = -tz * vy, sy = tz * vx - tx * vz, sz = tx * vy; const sl = Math.hypot(sx, sy, sz) || 1;
        const w = 0.028 + 0.05 * age; sx = (sx / sl) * w; sy = (sy / sl) * w; sz = (sz / sl) * w;
        const k = Math.pow(U.sat(1 - age / LIFE), 1.6) * U.smooth(0, 0.07, age) * tpk[i] * rb[2];
        const v = nv; P[v * 3] = x - sx; P[v * 3 + 1] = y - sy; P[v * 3 + 2] = z - sz; P[v * 3 + 3] = x + sx; P[v * 3 + 4] = y + sy; P[v * 3 + 5] = z + sz;
        UV[v * 2] = k; UV[v * 2 + 1] = -1; UV[v * 2 + 2] = k; UV[v * 2 + 3] = 1;
        if (j > 0 && tps[(o0 + j - 1) % NP] === tps[i]) { I[ni++] = v - 2; I[ni++] = v - 1; I[ni++] = v; I[ni++] = v; I[ni++] = v - 1; I[ni++] = v + 1; }
        nv += 2;
      }
    }
    wPos.needsUpdate = true; wUv.needsUpdate = true; wIdx.needsUpdate = true;
    wisp.geometry.setDrawRange(0, ni); wisp.visible = ni > 0;
    wisp.material.uniforms.uK.value = (0.12 + 0.42 * (1 - 0.8 * S.night)) * (WG.reducedMotion ? 0.8 : 1);
  }

  /* ------------------------------------------------------------ fog puffs: soft billows rolling out where fog is poured, ~1.5 s */
  const NF = 56;
  const fx = new Float32Array(NF), fy = new Float32Array(NF), fz = new Float32Array(NF), fvx = new Float32Array(NF), fvz = new Float32Array(NF), fage = new Float32Array(NF).fill(9), flife = new Float32Array(NF), fs0 = new Float32Array(NF), fs1 = new Float32Array(NF), fseed = new Float32Array(NF);
  let fHead = 0, puffs = null, pPos, pDat;
  const nrm = {};
  function addPuff(x, z, spread, size) {
    const i = fHead; fHead = (fHead + 1) % NF;
    const a = Math.random() * 6.283, sp = (0.25 + Math.random() * 0.55) * spread;
    fx[i] = x + Math.cos(a) * 0.08; fz[i] = z + Math.sin(a) * 0.08; fy[i] = Math.max(T.height(x, z), S.lakeLevel) + 0.08;
    fvx[i] = Math.cos(a) * sp; fvz[i] = Math.sin(a) * sp; fage[i] = 0; flife[i] = 1.2 + Math.random() * 0.6;
    fs0[i] = (0.26 + Math.random() * 0.14) * size; fs1[i] = (0.75 + Math.random() * 0.45) * size; fseed[i] = Math.random();
  }
  function buildPuffs() {
    const geo = new THREE.BufferGeometry();
    pPos = new THREE.BufferAttribute(new Float32Array(NF * 3), 3); pPos.setUsage(THREE.DynamicDrawUsage);
    pDat = new THREE.BufferAttribute(new Float32Array(NF * 4), 4); pDat.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', pPos); geo.setAttribute('aDat', pDat); geo.setDrawRange(0, 0);
    puffs = new THREE.Points(geo, WG.mat.unlit({
      name: 'fogPuffs', transparent: true, depthWrite: false, shadow: false, uniforms: { uCol: { value: new THREE.Vector3(1, 1, 1) }, uPx: { value: 800 } },
      vertexDecl: 'attribute vec4 aDat; varying vec4 vDat; uniform float uPx;',
      vertexEnd: 'vDat = aDat; gl_PointSize = clamp(aDat.x * uPx / gl_Position.w, 1.0, 512.0);',
      fragDecl: 'varying vec4 vDat; uniform vec3 uCol;',
      frag: `vec2 q = gl_PointCoord * 2.0 - 1.0; float r2 = dot(q, q); if (r2 > 1.0) discard;
        float n = wgNoise(q * 2.2 + vec2(vDat.z * 31.0, uTime * 0.25 + vDat.z * 7.0)) * 0.6 + wgNoise(q * 4.7 - vec2(uTime * 0.4, vDat.z * 13.0)) * 0.4;
        float k = (1.0 - r2); k *= k;
        float a = k * smoothstep(0.15, 0.75, n + 0.45 * (1.0 - r2)) * vDat.y;
        col = uCol * (0.84 + 0.22 * (0.5 - q.y * 0.5) + 0.1 * n); alpha = a * 0.4;`,
    }));
    puffs.visible = false;
    WG.add(puffs, { pass: 'A', order: 6 });
  }
  function puffsUpdate(dt) {
    if (!puffs) return;
    const P = pPos.array, Dt = pDat.array; let n = 0;
    for (let i = 0; i < NF; i++) {
      if (fage[i] >= flife[i]) continue;
      const a = (fage[i] += dt), f = a / flife[i];
      if (f >= 1) continue;
      /* billow outward, slow down, then slide downhill */
      const drag = Math.exp(-dt * 2.2); fvx[i] *= drag; fvz[i] *= drag;
      T.normal(fx[i], fz[i], nrm); fvx[i] += nrm.x * dt * 1.4 * U.smooth(0.2, 0.6, f); fvz[i] += nrm.z * dt * 1.4 * U.smooth(0.2, 0.6, f);
      fx[i] = U.clamp(fx[i] + fvx[i] * dt, C.X0 + 0.1, C.X1 - 0.1); fz[i] = U.clamp(fz[i] + fvz[i] * dt, C.Z0 + 0.1, C.Z1 - 0.1);
      const gy = Math.max(T.height(fx[i], fz[i]), S.lakeLevel), size = U.lerp(fs0[i], fs1[i], 1 - Math.pow(1 - f, 2));
      fy[i] = U.damp(fy[i], gy + size * 0.32 + Math.sin(a * 3 + fseed[i] * 9) * 0.02, 6, dt);
      P[n * 3] = fx[i]; P[n * 3 + 1] = fy[i]; P[n * 3 + 2] = fz[i];
      Dt[n * 4] = size; Dt[n * 4 + 1] = U.smooth(0, 0.12, a) * Math.pow(1 - f, 1.3); Dt[n * 4 + 2] = fseed[i]; Dt[n * 4 + 3] = f;
      n++;
    }
    pPos.needsUpdate = true; pDat.needsUpdate = true;
    puffs.geometry.setDrawRange(0, n); puffs.visible = n > 0;
    if (n > 0) {
      const sky = WG.sky, u = puffs.material.uniforms;
      if (sky && sky.cloudLit) u.uCol.value.copy(sky.cloudLit).multiplyScalar(0.3).addScaledVector(sky.hazeCol, 0.55).addScaledVector(sky.cloudAmbTop, 0.35);
      u.uPx.value = (WG.render.height || 500) / (2 * Math.tan((WG.camera.fov * Math.PI) / 360));
    }
  }

  /* ------------------------------------------------------------ module */
  WG.register('interact', {
    init() {
      makeRing();
      try { buildWisps(); } catch (e) { WG.fail('interact.wisps', e); }
      try { buildPuffs(); } catch (e) { WG.fail('interact.puffs', e); }
      setCursor(tool() === 'hand' ? 'default' : tool() === 'wipe' ? 'none' : 'crosshair');
    },
    update(dt) {
      if (!WG.cam) return;
      if (g) updGesture(g, dt);
      /* a flung sun or moon keeps going for a moment */
      if (SD.coast && !(g && g.kind === 'sun')) {
        SD.h += SD.coast * dt; SD.coast *= Math.exp(-dt * 3);
        if (WG.api) WG.api.setTime(U.wrap(SD.h, 24));
        if (Math.abs(SD.coast) < 0.05) SD.coast = 0;
      }
      /* orbit inertia after a flick */
      if (!g && (Math.abs(OI.az) > 1e-3 || Math.abs(OI.el) > 1e-3)) { WG.cam.orbit(OI.az * dt, OI.el * dt); const k = Math.exp(-dt * 4); OI.az *= k; OI.el *= k; }
      hoverTick(dt);
      wispsUpdate(dt);
      puffsUpdate(dt);
    },
  });

  /* public: what is going on, plus a few helpers for tests and other parts */
  IA.pick = (x, y) => pickAt(x, y, false, false).kind;
  IA.state = () => ({ gesture: g ? g.kind : null, cursor: IA.cursor, hover: IA.hoverKind, wisps: tpCount, puffs: puffs ? puffs.geometry.drawRange.count : 0, sunCoast: SD.coast });
  IA.addPuff = addPuff;
  IA.addTrail = (x, y, z, k, newStroke) => { if (newStroke) strokeId++; addTrail(x, y, z, k); };
})();
