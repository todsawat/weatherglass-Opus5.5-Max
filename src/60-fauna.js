/* Weatherglass — the animals: a loose flock of songbirds, butterflies, dragonflies, fireflies, a school of fish
   in the lake's cross-section and sunlit dust motes. Every one of them reads the shared weather and follows it. */
(function () {
  'use strict';
  const WG = window.WG, THREE = WG.THREE, U = WG.util, C = WG.C, S = WG.state, W = WG.world, T = WG.terrain, L = WG.layout, Q = WG.Q;
  const V3 = THREE.Vector3, RM = !!WG.reducedMotion;
  const rr = (a, b) => a + (b - a) * Math.random();
  const TAU = Math.PI * 2;
  const fauna = (WG.fauna = { ready: false, birds: [], butterflies: [], dragonflies: [], fish: [], flush() {}, scatterFish() {}, scatterInsects() {} });

  /* ================================================================ geometry helpers */
  function flat(verts, idx, uvs) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    if (uvs) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    g.setIndex(idx); g.computeVertexNormals(); return g;
  }
  const MX = (x, y, z, sx, sy, sz, rx) => new THREE.Matrix4().compose(new V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, 0, 0)), new V3(sx, sy, sz));
  /* merge parts into one non-indexed geometry with a per-vertex tag aP = (part, code, 0, 0); flip: reverse the winding (mirrored parts) */
  function merge(parts) {
    let n = 0; const gs = [];
    for (const p of parts) { let g = p.g.index ? p.g.toNonIndexed() : p.g.clone(); if (p.m) g.applyMatrix4(p.m); if (!g.attributes.normal) g.computeVertexNormals(); gs.push(g); n += g.attributes.position.count; }
    const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2), ap = new Float32Array(n * 4);
    let o = 0;
    gs.forEach((g, k) => {
      const c = g.attributes.position.count, a = parts[k].a, P = g.attributes.position.array, N = g.attributes.normal.array, UV = g.attributes.uv ? g.attributes.uv.array : null;
      for (let i = 0; i < c; i++) {
        const j = parts[k].flip ? (i % 3 === 1 ? i + 1 : i % 3 === 2 ? i - 1 : i) : i, d = o + i;
        pos[d * 3] = P[j * 3]; pos[d * 3 + 1] = P[j * 3 + 1]; pos[d * 3 + 2] = P[j * 3 + 2];
        nrm[d * 3] = N[j * 3]; nrm[d * 3 + 1] = N[j * 3 + 1]; nrm[d * 3 + 2] = N[j * 3 + 2];
        if (UV) { uv[d * 2] = UV[j * 2]; uv[d * 2 + 1] = UV[j * 2 + 1]; }
        ap[d * 4] = a[0]; ap[d * 4 + 1] = a[1] || 0; ap[d * 4 + 2] = a[2] || 0; ap[d * 4 + 3] = a[3] || 0;
      }
      o += c;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('aP', new THREE.BufferAttribute(ap, 4));
    return g;
  }
  function instAttr(geo, name, n, size) { const a = new THREE.InstancedBufferAttribute(new Float32Array(n * size), size); a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(name, a); return a; }
  function instMesh(geo, mat, n) { const m = new THREE.InstancedMesh(geo, mat, n); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); for (let i = 0; i < n; i++) m.setMatrixAt(i, ZERO); return m; }
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

  /* write an instance transform: local +z = forward, +y = up, roll about forward, uniform scale */
  const _x = new V3(), _y = new V3(), _z = new V3(), UP = new V3(0, 1, 0);
  function orient(mesh, i, px, py, pz, fx, fy, fz, roll, s) {
    _z.set(fx, fy, fz); if (_z.lengthSq() < 1e-12) _z.set(0, 0, 1); _z.normalize();
    _x.crossVectors(UP, _z); if (_x.lengthSq() < 1e-8) _x.set(1, 0, 0); _x.normalize();
    _y.crossVectors(_z, _x);
    if (roll) {
      const c = Math.cos(roll), sn = Math.sin(roll);
      const ax = _x.x * c + _y.x * sn, ay = _x.y * c + _y.y * sn, az = _x.z * c + _y.z * sn;
      _y.set(_y.x * c - _x.x * sn, _y.y * c - _x.y * sn, _y.z * c - _x.z * sn); _x.set(ax, ay, az);
    }
    const e = mesh.instanceMatrix.array, o = i * 16;
    e[o] = _x.x * s; e[o + 1] = _x.y * s; e[o + 2] = _x.z * s; e[o + 3] = 0;
    e[o + 4] = _y.x * s; e[o + 5] = _y.y * s; e[o + 6] = _y.z * s; e[o + 7] = 0;
    e[o + 8] = _z.x * s; e[o + 9] = _z.y * s; e[o + 10] = _z.z * s; e[o + 11] = 0;
    e[o + 12] = px; e[o + 13] = py; e[o + 14] = pz; e[o + 15] = 1;
  }
  function hide(mesh, i) { const e = mesh.instanceMatrix.array, o = i * 16; for (let k = 0; k < 16; k++) e[o + k] = 0; }

  /* ================================================================ shared weather readings */
  const env = { day: 1, warm: 1, calm: 1, dry: 1, night: 0 };
  function readEnv() {
    env.night = S.night;
    env.day = U.smooth(0.05, 0.3, S.sunUp);
    env.calm = U.smooth(1.05, 0.55, S.wind.speed);
    env.dry = U.sat(1 - U.smooth(0.03, 0.16, S.rain) - U.smooth(0.03, 0.2, S.snowing)) * (1 - U.smooth(0.15, 0.45, S.storm));
  }
  const groundOK = (x, z) => T.inside(x, z, 0.35) && !T.waterAt(x, z) && T.lakeR(x, z) > 1.06 && T.up(x, z) > 0.82 && T.height(x, z) < 2.4;

  /* ================================================================ BIRDS */
  const NB = Q.birds;
  const B = fauna.birds;
  let birdMesh = null, bAnim = null, bAnim2 = null;
  const occupied = new Set();
  const flock = { ft: new V3(0.5, 3.7, 0.3), goal: new V3(0.5, 3.7, 0.3), vel: new V3(), landT: rr(9, 14), phase: 'air', downEnd: 0, flushT: 0, roost: false, bad: false, yHi: 5, anchor: null };
  fauna.flock = flock;

  let fallback = null;
  function makeFallback() {
    const out = [];
    for (const t of L.trees || []) {
      out.push({ x: t.x, y: t.y + t.h, z: t.z, sheltered: false, kind: 'treetop' });
      const broad = t.kind !== 'pine' && t.kind !== 'spruce';
      for (let k = 0; k < (broad ? 2 : 1); k++) { const a = U.hash(t.id, k, 71) * TAU; out.push({ x: t.x + Math.cos(a) * t.r * 0.35, y: t.y + t.h * (broad ? 0.62 : 0.45), z: t.z + Math.sin(a) * t.r * 0.35, sheltered: true, kind: 'crown' }); }
    }
    const cb = L.cabin;
    if (cb) {
      const ax = Math.cos(cb.rot), az = -Math.sin(cb.rot), fx = Math.sin(cb.rot), fz = Math.cos(cb.rot);
      for (const o of [-0.22, 0, 0.22]) out.push({ x: cb.x + ax * o, y: cb.padY + cb.ridge, z: cb.z + az * o, sheltered: false, kind: 'ridge' });
      out.push({ x: cb.x - ax * (cb.len * 0.5 + 0.07), y: cb.padY + cb.ridge + 0.14, z: cb.z - az * (cb.len * 0.5 + 0.07), sheltered: false, kind: 'chimney' });
      for (const o of [-0.18, 0.12]) out.push({ x: cb.x + ax * o + fx * (cb.dep * 0.5 + 0.05), y: cb.padY + 0.4, z: cb.z + az * o + fz * (cb.dep * 0.5 + 0.05), sheltered: true, kind: 'eave' });
    }
    const j = L.jetty;
    if (j) { const px = -j.dz, pz = j.dx; for (const s of [-1, 1]) out.push({ x: j.x1 + px * s * j.width * 0.5, y: C.LAKE + 0.22, z: j.z1 + pz * s * j.width * 0.5, sheltered: false, kind: 'jetty' }); }
    return out;
  }
  function perches() {
    const P = WG.perches;
    if (P && P.length) { if (!P._fChecked) { for (const p of P) p._ok = isFinite(p.x) && isFinite(p.y) && isFinite(p.z) && T.inside(p.x, p.z, 0.2) && p.y < 6.5; P._fChecked = true; } return P; }
    return fallback || (fallback = makeFallback());
  }
  const swayKind = /tree|top|crown|pine|spruce|oak|birch|cherry|branch/i;
  function perchPos(pc, out) {
    out.set(pc.x, pc.y, pc.z);
    const t = pc.tree;
    if (t && isFinite(t.bx) && t.h > 0) {
      const hf = U.clamp((pc.y - t.y) / t.h, 0, 1.5); out.x += t.bx * t.h * hf * hf; out.z += t.bz * t.h * hf * hf;
      if (!pc.sheltered && t.kind !== 'pine' && t.kind !== 'spruce') out.y += 0.012 + 0.03 * t.h;   /* sit on the crown, not in it */
      return out;
    }
    if (pc.sway === undefined) pc.sway = swayKind.test(pc.kind || '') ? 1 : 0;
    if (pc.sway && !RM) { const s = Math.min(1.5, S.wind.speed) * 0.014 * (0.55 + 0.45 * Math.sin(WG.time * 1.9 + pc.x * 3.1)); out.x += S.wind.dx * s; out.z += S.wind.dz * s; }
    return out;
  }
  /* a tree that is grabbed, flicked or struck shakes its birds loose */
  function shakeTree(tree) { if (!tree || !birdMesh) return; for (const b of B) if (b.perch && b.perch.tree === tree && (b.st === 'perch' || b.st === 'path')) { fauna.flush(tree.x, tree.y + tree.h, tree.z); return; } }
  function freePerches(sheltered) { const out = []; for (const p of perches()) if (p._ok !== false && !occupied.has(p) && (sheltered === null || !!p.sheltered === sheltered)) out.push(p); return out; }
  function groundSpot(x, z, r0, r1) {
    for (let k = 0; k < 14; k++) { const a = Math.random() * TAU, r = rr(r0, r1), gx = x + Math.cos(a) * r, gz = z + Math.sin(a) * r; if (groundOK(gx, gz)) return { x: gx, y: T.height(gx, gz) + 0.004, z: gz, ground: true, kind: 'ground' }; }
    return null;
  }

  function newBird(i) {
    const slate = i % 2 === 0;
    return {
      i, p: new V3(flock.ft.x + rr(-0.8, 0.8), flock.ft.y + rr(-0.3, 0.3), flock.ft.z + rr(-0.8, 0.8)), v: new V3(rr(-1, 1), 0, rr(-1, 1)).setLength(0.8),
      off: new V3(rr(-0.7, 0.7), rr(-0.25, 0.25), rr(-0.7, 0.7)), fwd: new V3(0, 0, 1), roll: 0, sc: rr(0.92, 1.08),
      st: 'fly', sit: '', perch: null, pending: null, pendDelay: 0, toDelay: -1, seekT: rr(0.5, 3), wake: -1, leaveAt: 0,
      ph: Math.random() * TAU, flapping: true, bt: rr(0.2, 0.8), flap: 0.1, bend: 0, fold: 0, tail: 0,
      yaw: Math.random() * TAU, yawT: 0, hYaw: 0, hYawT: 0, hPitch: 0, hPitchT: 0, bodyPitch: 0.22, act: rr(0.3, 1.5), pk: 0, pkN: 0, flick: 0,
      hop: { t: 1, T: 0.22, x0: 0, z0: 0, x1: 0, z1: 0, h: 0.02 }, path: { p0: new V3(), m0: new V3(), p1: new V3(), m1: new V3(), T: 1, t: 0, kind: 'land' }, fluff: 1, flee: 0,
      col: slate ? new THREE.Color().setRGB(0.075 + 0.02 * Math.random(), 0.085, 0.1) : new THREE.Color().setRGB(0.19 + 0.05 * Math.random(), 0.105, 0.045),
    };
  }

  function buildBirds() {
    const body = new THREE.SphereGeometry(1, 8, 6), head = new THREE.SphereGeometry(1, 7, 5), beak = new THREE.ConeGeometry(1, 1, 4);
    const WV = [0.004, 0.004, 0.012, 0.004, 0.004, -0.01, 0.022, 0.004, -0.012, 0.022, 0.004, 0.011, 0.046, 0.004, -0.006, 0.043, 0.004, 0.001], WI = [0, 2, 1, 0, 3, 2, 3, 4, 2, 3, 5, 4];
    const wing = flat(WV, WI), tail = flat([-0.004, 0.002, -0.016, 0.004, 0.002, -0.016, 0.0105, 0.004, -0.047, -0.0105, 0.004, -0.047], [0, 1, 2, 0, 2, 3]);
    const leg = new THREE.BoxGeometry(0.0016, 0.013, 0.0016);
    const geo = merge([
      { g: body, m: MX(0, 0, -0.002, 0.0115, 0.011, 0.025), a: [0, 0] },
      { g: head, m: MX(0, 0.0085, 0.0215, 0.0088, 0.0086, 0.0088), a: [3, 0] },
      { g: beak, m: MX(0, 0.0068, 0.0335, 0.0026, 0.009, 0.0024, Math.PI / 2), a: [3, 1] },
      { g: wing, a: [2, 0] }, { g: wing, m: MX(0, 0, 0, -1, 1, 1), a: [1, 0], flip: true },
      { g: tail, a: [5, 0] },
      { g: leg, m: MX(0.0042, -0.0135, 0.002, 1, 1, 1), a: [4, 1] }, { g: leg, m: MX(-0.0042, -0.0135, 0.002, 1, 1, 1), a: [4, 1] },
    ]);
    bAnim = instAttr(geo, 'aAnim', NB, 4); bAnim2 = instAttr(geo, 'aAnim2', NB, 2);
    const mat = WG.mat.lit({
      name: 'birds', side: THREE.DoubleSide,
      vertexDecl: 'attribute vec4 aP; attribute vec4 aAnim; attribute vec2 aAnim2; varying vec3 vB; varying vec2 vPC;',
      vertexLocal: /* glsl */ `
        vB = pos; vPC = aP.xy; float part = aP.x;
        if (part > 0.5 && part < 2.5) {
          float side = part < 1.5 ? -1.0 : 1.0, s = abs(pos.x);
          float r = max(s - 0.004, 0.0), r1 = min(r, 0.018), r2 = max(r - 0.018, 0.0), a1 = aAnim.x, a2 = aAnim.x + aAnim2.x;
          vec3 fl = vec3(side * (0.004 + r1 * cos(a1) + r2 * cos(a2)), pos.y + r1 * sin(a1) + r2 * sin(a2), pos.z);
          float an = r2 > 0.0 ? a2 : a1; vec3 fln = vec3(-side * sin(an), cos(an), 0.0);
          float u = clamp((s - 0.004) / 0.042, 0.0, 1.0);
          vec3 fo = vec3(side * (0.0128 - 0.0092 * u), 0.0015 + pos.z * 0.4 + 0.006 * u, 0.008 - 0.04 * u);
          vec3 fon = normalize(vec3(side, 0.35, 0.0));
          pos = mix(fl, fo, aAnim.y); nrm = normalize(mix(fln, fon, aAnim.y));
        } else if (part > 2.5 && part < 3.5) {
          vec3 pv = vec3(0.0, 0.004, 0.015), q = pos - pv, qn = nrm;
          float cp = cos(aAnim.z), sp = sin(aAnim.z), cy = cos(aAnim.w), sy = sin(aAnim.w);
          q = vec3(q.x, q.y * cp - q.z * sp, q.y * sp + q.z * cp); qn = vec3(qn.x, qn.y * cp - qn.z * sp, qn.y * sp + qn.z * cp);
          q = vec3(q.x * cy + q.z * sy, q.y, -q.x * sy + q.z * cy); qn = vec3(qn.x * cy + qn.z * sy, qn.y, -qn.x * sy + qn.z * cy);
          pos = q + pv; nrm = qn;
        } else if (part > 3.5 && part < 4.5) {
          pos.y = mix(-0.006, pos.y, aAnim.y); pos.z -= (1.0 - aAnim.y) * 0.006;
        } else if (part > 4.5) {
          vec3 pv = vec3(0.0, 0.002, -0.016), q = pos - pv; float ta = aAnim2.y;
          q.x *= 1.0 + 0.5 * (1.0 - aAnim.y);
          q = vec3(q.x, q.y * cos(ta) - q.z * sin(ta), q.y * sin(ta) + q.z * cos(ta)); pos = q + pv;
        }`,
      fragDecl: 'varying vec3 vB; varying vec2 vPC;',
      frag: /* glsl */ `
        vec3 base = vCol; vec3 pale = mix(vec3(0.6, 0.56, 0.48), base + vec3(0.32), 0.3); float part = vPC.x;
        rough = 0.82; spec = 0.035;
        if (vPC.y > 0.5) { albedo = vec3(0.022, 0.019, 0.016); rough = 0.45; spec = 0.05; }
        else if (part < 0.5) {
          albedo = mix(base, pale, smoothstep(0.001, -0.008, vB.y));
          albedo = mix(albedo, base * 0.72, smoothstep(0.004, 0.011, vB.y) * 0.6);
        } else if (part < 2.5) {
          float u = clamp((abs(vB.x) - 0.004) / 0.042, 0.0, 1.0);
          albedo = base * mix(0.85, 0.4, smoothstep(0.5, 0.95, u));
          albedo = mix(albedo, pale, 0.55 * smoothstep(0.07, 0.0, abs(u - 0.36)) * smoothstep(-0.006, 0.004, vB.z));
          trans = 0.3;
        } else if (part < 3.5) {
          albedo = mix(base * 0.82, pale, smoothstep(0.0075, 0.0012, vB.y) * smoothstep(0.012, 0.022, vB.z));
          float eye = smoothstep(0.0028, 0.0019, length(vec3(abs(vB.x) - 0.0068, vB.y - 0.0109, vB.z - 0.0265)));
          albedo = mix(albedo, vec3(0.01), eye); rough = mix(rough, 0.12, eye); spec = mix(spec, 0.09, eye);
        } else albedo = base * 0.6;`,
    });
    birdMesh = instMesh(geo, mat, NB);
    for (let i = 0; i < NB; i++) { const b = newBird(i); B.push(b); birdMesh.setColorAt(i, b.col); }
    birdMesh.instanceColor.needsUpdate = true;
    WG.add(birdMesh, { pass: 'A', shadow: true });
  }

  /* ---- paths: cubic Hermite curves for landing, take-off and short flights between perches */
  function hermite(P, s, out, dout) {
    const s2 = s * s, s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
    const d00 = 6 * s2 - 6 * s, d10 = 3 * s2 - 4 * s + 1, d01 = -6 * s2 + 6 * s, d11 = 3 * s2 - 2 * s;
    out.set(h00 * P.p0.x + h10 * P.m0.x + h01 * P.p1.x + h11 * P.m1.x, h00 * P.p0.y + h10 * P.m0.y + h01 * P.p1.y + h11 * P.m1.y, h00 * P.p0.z + h10 * P.m0.z + h01 * P.p1.z + h11 * P.m1.z);
    dout.set(d00 * P.p0.x + d10 * P.m0.x + d01 * P.p1.x + d11 * P.m1.x, d00 * P.p0.y + d10 * P.m0.y + d01 * P.p1.y + d11 * P.m1.y, d00 * P.p0.z + d10 * P.m0.z + d01 * P.p1.z + d11 * P.m1.z);
  }
  const tA = new V3(), tB = new V3(), tC = new V3();
  const BODY_H = 0.02;
  /* fly to a perch (from the air, or a hop-flight from another perch) */
  function goTo(b, pc, sit) {
    if (b.perch) occupied.delete(b.perch);
    b.perch = pc; occupied.add(pc); b.sit = sit; b.pending = null;
    const P = b.path; P.kind = 'land'; P.t = 0; P.p0.copy(b.p);
    perchPos(pc, P.p1); P.p1.y += BODY_H * b.sc;
    const d = P.p0.distanceTo(P.p1); P.T = U.clamp(d / 0.95, 0.9, 5);
    tA.set(P.p1.x - P.p0.x, 0, P.p1.z - P.p0.z); if (tA.lengthSq() < 1e-6) tA.set(b.fwd.x, 0, b.fwd.z); tA.normalize();
    if (b.st === 'perch') P.m0.set(tA.x * 0.3, 0.9 + d * 0.3, tA.z * 0.3).multiplyScalar(P.T);
    else P.m0.copy(b.v).multiplyScalar(P.T);
    P.m1.set(tA.x * 0.32, -0.16, tA.z * 0.32).multiplyScalar(P.T);
    b.st = 'path';
  }
  /* leave a perch for the open air; away: optional point to flee from */
  const BOX = { x: 5.25, z0: -3.25, z1: 3.35 };
  function takeOff(b, away, vigour) {
    if (b.perch) { occupied.delete(b.perch); b.perch = null; }
    b.sit = ''; b.pending = null;
    const P = b.path; P.kind = 'takeoff'; P.t = 0; P.p0.copy(b.p);
    if (away) { tA.set(b.p.x - away.x, 0, b.p.z - away.z); if (tA.lengthSq() < 1e-4) tA.set(rr(-1, 1), 0, rr(-1, 1)); tA.normalize(); }
    else { tA.set(flock.ft.x - b.p.x, 0, flock.ft.z - b.p.z); if (tA.lengthSq() < 0.04) tA.set(Math.sin(b.yaw), 0, Math.cos(b.yaw)); tA.normalize(); }
    const dist = away ? rr(1.4, 2.2) : rr(0.9, 1.5);
    P.p1.set(U.clamp(b.p.x + tA.x * dist, -BOX.x, BOX.x), 0, U.clamp(b.p.z + tA.z * dist, BOX.z0, BOX.z1));
    P.p1.y = U.clamp(Math.max(b.p.y + rr(0.9, 1.6), T.height(P.p1.x, P.p1.z) + 0.8), 1.2, flock.yHi);
    P.T = (away ? 1.1 : 1.6) / (vigour || 1);
    P.m0.set(tA.x * 0.35, 1.25, tA.z * 0.35).multiplyScalar(P.T);
    P.m1.set(tA.x, 0.1, tA.z).multiplyScalar((away ? 1.25 : 0.9) * P.T);
    b.st = 'takeoff'; b.flapping = true; b.bt = 0.6;
  }
  function wantOf(b, nActive) {
    if (flock.roost || flock.bad) return 'shelter';
    return b.i < nActive ? 'flock' : 'sit';
  }
  function pickPerchFor(b, kind) {
    let list = freePerches(kind === 'shelter' ? true : false);
    if (!list.length) list = freePerches(null);
    if (list.length) {
      list.sort((a, c) => ((a.x - b.p.x) ** 2 + (a.z - b.p.z) ** 2) - ((c.x - b.p.x) ** 2 + (c.z - b.p.z) ** 2));
      return list[Math.floor(Math.random() * Math.min(list.length, kind === 'shelter' ? 2 : 6))];
    }
    return groundSpot(b.p.x, b.p.z, 0.2, 1.5) || groundSpot(-2.2, 1.0, 0, 1.5);
  }
  /* the flock comes down together onto perches near one spot */
  function flockLand(nActive) {
    const fliers = B.filter((b) => b.st === 'fly' && !b.pending && wantOf(b, nActive) === 'flock');
    if (!fliers.length) { flock.landT = rr(4, 8); return; }
    const open = freePerches(false).filter((p) => p.y < flock.yHi - 0.4);
    let anchor = open.length ? open[Math.floor(Math.random() * open.length)] : groundSpot(rr(-4, 2), rr(-0.5, 2.5), 0, 0.8);
    if (!anchor) { flock.landT = rr(4, 8); return; }
    flock.anchor = anchor;
    const near = open.filter((p) => p !== anchor && Math.hypot(p.x - anchor.x, p.z - anchor.z) < 1.5).sort((a, c) => Math.hypot(a.x - anchor.x, a.z - anchor.z) - Math.hypot(c.x - anchor.x, c.z - anchor.z));
    const spots = open.indexOf(anchor) >= 0 ? [anchor] : [];
    for (const p of near) spots.push(p);
    let maxT = 0;
    fliers.forEach((b, k) => {
      let pc = k < spots.length && (k < 4 || Math.random() < 0.6) ? spots[k] : null;
      if (pc && occupied.has(pc)) pc = null;
      if (!pc) pc = groundSpot(anchor.x, anchor.z, 0.12, 0.75) || spots.find((s) => !occupied.has(s) && !fliers.some((f) => f.pending === s));
      if (!pc) return;
      b.pending = pc; b.pendDelay = rr(0, 1.4); occupied.add(pc);
      maxT = Math.max(maxT, b.pendDelay + U.clamp(b.p.distanceTo(tA.set(pc.x, pc.y, pc.z)) / 0.95, 0.9, 5));
    });
    flock.phase = 'down'; flock.downEnd = WG.time + maxT + rr(10, 20);
  }

  function birdsUpdate(dt) {
    const now = WG.time;
    /* weather decides the mood of the flock */
    flock.roost = flock.roost ? S.night > 0.4 : S.night > 0.62;
    flock.bad = flock.bad ? (S.rain > 0.06 || S.storm > 0.15 || S.snowing > 0.3) : (S.rain > 0.15 || S.storm > 0.3 || S.snowing > 0.5);
    const nActive = Math.round(NB * W.bySeason(1, 1, 0.55, 0.22));
    /* the space under the clouds */
    let base = 6.1; const cl = WG.clouds && WG.clouds.list;
    if (cl) for (const c of cl) if (c.alpha > 0.3 && isFinite(c.baseY)) base = Math.min(base, c.baseY);
    flock.yHi = U.damp(flock.yHi, U.clamp(base - 0.35, 3.3, 6.1), 0.5, dt);
    const yLo = Math.min(2.5, flock.yHi - 0.6);
    /* the flock's wandering centre */
    const ft = flock.ft, g = flock.goal;
    if (ft.distanceTo(g) < 0.35 || g.y > flock.yHi + 0.2) {
      for (let k = 0; k < 12; k++) { const x = rr(-4.4, 4.4), z = rr(-2.4, 2.8), y = Math.max(rr(yLo, flock.yHi), T.height(x, z) + 1.0); if (y <= flock.yHi) { g.set(x, y, z); break; } }
    }
    tA.subVectors(g, ft); const gl = tA.length(); if (gl > 1e-4) ft.addScaledVector(tA, Math.min(1, (0.55 * dt) / gl));
    /* landing rhythm */
    if (flock.phase === 'air') { if (now > flock.flushT) flock.landT -= dt; if (flock.landT <= 0) flockLand(nActive); }
    else if (flock.phase === 'down' && now > flock.downEnd) {
      flock.phase = 'leave'; let t0 = now;
      for (const b of B) if (b.sit === 'flock' && (b.st === 'perch' || b.st === 'path')) { t0 += rr(0.35, 1.1); b.leaveAt = t0; }
    } else if (flock.phase === 'leave' && !B.some((b) => b.sit === 'flock' || b.pending)) { flock.phase = 'air'; flock.landT = rr(16, 24); }
    /* mean velocity of the fliers */
    flock.vel.set(0, 0, 0); let nf = 0;
    for (const b of B) if (b.st === 'fly') { flock.vel.add(b.v); nf++; }
    if (nf) flock.vel.multiplyScalar(1 / nf);

    for (const b of B) {
      const want = wantOf(b, nActive);
      if (b.st === 'fly') flyStep(b, dt, yLo, want);
      else if (b.st === 'path' || b.st === 'takeoff') pathStep(b, dt);
      else perchStep(b, dt, want, now);
      drawBird(b);
    }
    birdMesh.instanceMatrix.needsUpdate = true; bAnim.needsUpdate = true; bAnim2.needsUpdate = true;
  }

  function flapAnim(b, dt, k, hz) {
    b.ph += dt * TAU * (RM ? hz * 0.55 : hz);
    const s = Math.sin(b.ph);
    b.flap = U.damp(b.flap, 0.12 + 0.85 * k * s, 30, dt); b.bend = 0.55 * k * Math.sin(b.ph - 1.1);
  }
  function flyStep(b, dt, yLo, want) {
    const p = b.p, v = b.v, now = WG.time;
    /* go and sit if the weather, the hour or the season says so */
    if (now > flock.flushT && want !== 'flock') { b.seekT -= dt; if (b.seekT <= 0) { const pc = pickPerchFor(b, want); if (pc) { goTo(b, pc, want); return; } b.seekT = rr(2, 4); } }
    if (b.pending) { b.pendDelay -= dt; if (b.pendDelay <= 0) { const pc = b.pending; occupied.delete(pc); goTo(b, pc, 'flock'); return; } }
    /* steering: own slot in the loose flock, separation, alignment, the glass, the ground and the clouds */
    tA.set(flock.ft.x + b.off.x - p.x, flock.ft.y + b.off.y - p.y, flock.ft.z + b.off.z - p.z);
    const dl = tA.length(); tA.multiplyScalar(Math.min(dl, 1.6) * 0.9 / Math.max(dl, 1e-4));
    for (const o of B) { if (o === b || o.st !== 'fly') continue; tB.subVectors(p, o.p); const d2 = tB.lengthSq(); if (d2 < 0.06 && d2 > 1e-8) tA.addScaledVector(tB, 0.02 / d2); }
    tA.x += (flock.vel.x - v.x) * 0.4; tA.y += (flock.vel.y - v.y) * 0.4; tA.z += (flock.vel.z - v.z) * 0.4;
    if (b.flee > 0) { b.flee -= dt; }
    const m = 1.0;
    if (p.x > 6 - m - 0.3) tA.x -= (p.x - (6 - m - 0.3)) * 7; if (p.x < -6 + m + 0.3) tA.x += (-6 + m + 0.3 - p.x) * 7;
    if (p.z > 4 - m) tA.z -= (p.z - (4 - m)) * 7; if (p.z < -4 + m) tA.z += (-4 + m - p.z) * 7;
    const gy = T.height(p.x, p.z) + 0.6; if (p.y < gy) tA.y += (gy - p.y) * 6;
    if (p.y > flock.yHi) tA.y -= (p.y - flock.yHi) * 4; if (p.y < yLo - 0.4) tA.y += 0.6;
    v.addScaledVector(tA, dt);
    v.y = U.clamp(v.y, -0.55, 0.55);
    const sp = Math.hypot(v.x, v.z), lo = b.flee > 0 ? 1.1 : 0.62, hi = b.flee > 0 ? 1.8 : 1.15;
    if (sp < lo) { const k = lo / Math.max(sp, 1e-4); v.x *= k; v.z *= k; if (sp < 1e-4) v.x = lo; } else if (sp > hi) { const k = hi / sp; v.x *= k; v.z *= k; }
    p.addScaledVector(v, dt);
    p.x = U.clamp(p.x, -5.7, 5.7); p.z = U.clamp(p.z, -3.72, 3.72); p.y = U.clamp(p.y, T.height(p.x, p.z) + 0.15, 6.9);
    /* bank into turns: the lateral acceleration tilts the lift */
    tB.copy(b.fwd); const lat = (tA.x * tB.z - tA.z * tB.x);
    b.roll = U.damp(b.roll, U.clamp(-lat * 0.35, -0.95, 0.95), 4, dt);
    tC.copy(v).normalize(); b.fwd.lerp(tC, 1 - Math.exp(-dt * 8)).normalize();
    /* bounding flight: bursts of flapping and short glides with the wings tucked or spread */
    b.bt -= dt;
    if (b.bt <= 0) { b.flapping = !b.flapping || v.y > 0.15 || b.flee > 0; b.bt = b.flapping ? rr(0.35, 0.9) : rr(0.25, 0.9); b.tuck = Math.random() < 0.55; }
    if (b.flapping) { flapAnim(b, dt, b.flee > 0 ? 1 : 0.85, b.flee > 0 ? 10 : 8); b.fold = U.damp(b.fold, 0, 14, dt); }
    else { b.flap = U.damp(b.flap, b.tuck ? 0.0 : 0.14, 10, dt); b.bend = U.damp(b.bend, 0, 10, dt); b.fold = U.damp(b.fold, b.tuck ? 0.62 : 0, 9, dt); }
    b.tail = U.damp(b.tail, -0.05, 6, dt); b.hYaw = U.damp(b.hYaw, 0, 6, dt); b.hPitch = U.damp(b.hPitch, -0.1, 6, dt); b.fluff = U.damp(b.fluff, 1, 3, dt);
  }
  function pathStep(b, dt) {
    const P = b.path;
    P.t += dt; const s = Math.min(1, P.t / P.T);
    hermite(P, s, b.p, tA); tA.multiplyScalar(1 / P.T); b.v.copy(tA);
    b.p.x = U.clamp(b.p.x, -5.8, 5.8); b.p.z = U.clamp(b.p.z, -3.8, 3.8);
    if (P.kind === 'land') {
      const brake = U.smooth(0.62, 0.95, s);
      tC.copy(tA); if (tC.lengthSq() > 1e-6) { tC.normalize(); tC.y += brake * 0.9; b.fwd.lerp(tC.normalize(), 1 - Math.exp(-dt * 9)).normalize(); }
      if (s < 0.45 || brake > 0) { flapAnim(b, dt, 0.7 + 0.3 * brake, 8 + 3 * brake); b.fold = U.damp(b.fold, 0, 12, dt); }
      else { b.flap = U.damp(b.flap, 0.16, 8, dt); b.bend = U.damp(b.bend, 0, 8, dt); b.fold = U.damp(b.fold, 0, 8, dt); }
      b.tail = U.damp(b.tail, 0.35 * brake, 8, dt); b.roll = U.damp(b.roll, 0, 3, dt);
      if (s >= 1) {
        b.st = 'perch'; b.yaw = Math.atan2(b.fwd.x, b.fwd.z); b.yawT = b.yaw; b.v.set(0, 0, 0); b.act = rr(0.3, 1.2); b.hop.t = 1;
        if (flock.phase === 'leave' && b.sit === 'flock') b.leaveAt = WG.time + rr(0.6, 2.5);
      }
    } else {
      tC.copy(tA); if (tC.lengthSq() > 1e-6) b.fwd.lerp(tC.normalize(), 1 - Math.exp(-dt * 7)).normalize();
      flapAnim(b, dt, 1, 10); b.fold = U.damp(b.fold, 0, 16, dt); b.tail = U.damp(b.tail, 0, 6, dt);
      if (s >= 1) { b.st = 'fly'; b.bt = rr(0.2, 0.6); b.flapping = true; }
    }
  }
  function perchStep(b, dt, want, now) {
    const pc = b.perch;
    if (!pc) { b.st = 'fly'; return; }
    /* decide whether to stay */
    if (b.toDelay >= 0) { b.toDelay -= dt; if (b.toDelay < 0) { takeOff(b, b.fleeFrom, 1.5); return; } }
    else if (b.sit === 'flock' && flock.phase === 'leave' && now >= b.leaveAt) { takeOff(b, null, 1); return; }
    else if (want === 'shelter' && b.sit !== 'shelter' && now > flock.flushT) { b.wake = b.wake < 0 ? rr(0.2, 2.5) : b.wake - dt; if (b.wake <= 0) { b.wake = -1; const n = pickPerchFor(b, 'shelter'); if (n && n !== pc) { goTo(b, n, 'shelter'); return; } b.sit = 'shelter'; } }
    else if (want === 'flock' && b.sit !== 'flock') { b.wake = b.wake < 0 ? rr(0.5, 6) : b.wake - dt; if (b.wake <= 0) { b.wake = -1; takeOff(b, null, 1); return; } }
    else if (want === 'sit' && b.sit === 'shelter') { b.wake = b.wake < 0 ? rr(3, 12) : b.wake - dt; if (b.wake <= 0) { b.wake = -1; const n = pickPerchFor(b, 'sit'); if (n) { goTo(b, n, 'sit'); return; } b.sit = 'sit'; } }
    /* little habits: look about, peck, turn, hop, flick the tail; sleeping birds tuck in */
    const roosting = b.sit === 'shelter' && flock.roost;
    const calm = roosting ? 0.08 : b.sit === 'shelter' ? 0.35 : b.sit === 'sit' ? 0.3 : 1;
    b.act -= dt;
    if (b.act <= 0) {
      b.act = rr(0.45, 1.9) / calm;
      const r = Math.random();
      if (roosting) { b.hYawT = Math.random() < 0.7 ? (Math.random() < 0.5 ? 2.7 : -2.7) : rr(-0.6, 0.6); b.hPitchT = 0.35; }
      else if (r < 0.38) { b.hYawT = rr(-1.3, 1.3); b.hPitchT = rr(-0.3, 0.12); }
      else if (r < 0.62 && calm > 0.5) { b.pkN = pc.ground ? 1 + ((Math.random() * 3) | 0) : (Math.random() < 0.4 ? 1 : 0); b.pk = 0; b.hYawT = rr(-0.3, 0.3); }
      else if (r < 0.84 && calm > 0.5) {
        b.yawT = b.yaw + (Math.random() < 0.5 ? -1 : 1) * rr(0.6, 2.9);
        const H = b.hop; H.t = 0; H.T = 0.2; H.h = pc.ground ? 0.022 : 0.012; H.x0 = H.x1 = pc.x; H.z0 = H.z1 = pc.z;
        if (pc.ground) { const a = b.yawT + rr(-0.5, 0.5), d = rr(0.03, 0.09), nx = pc.x + Math.sin(a) * d, nz = pc.z + Math.cos(a) * d; if (groundOK(nx, nz)) { H.x1 = nx; H.z1 = nz; } }
      } else b.flick = 1;
    }
    /* pecking */
    let peck = 0;
    if (b.pkN > 0) { b.pk += dt / 0.24; peck = Math.sin(Math.PI * Math.min(1, b.pk)); if (b.pk >= 1) { b.pk = 0; b.pkN--; } }
    const H = b.hop; let hy = 0;
    if (H.t < 1) { H.t = Math.min(1, H.t + dt / H.T); pc.x = U.lerp(H.x0, H.x1, H.t); pc.z = U.lerp(H.z0, H.z1, H.t); if (pc.ground) pc.y = T.height(pc.x, pc.z) + 0.004; hy = Math.sin(Math.PI * H.t) * H.h; }
    b.yaw += U.cyc(b.yaw, b.yawT, TAU) * (1 - Math.exp(-dt * (H.t < 1 ? 14 : 5)));
    b.hYaw = U.damp(b.hYaw, b.hYawT, roosting ? 3 : 22, dt);
    b.hPitch = U.damp(b.hPitch, b.hPitchT, 18, dt) ;
    b.flick = Math.max(0, b.flick - dt * 4);
    b.tail = U.damp(b.tail, 0.08 + 0.5 * Math.sin(Math.PI * b.flick) * (b.flick > 0 ? 1 : 0), 20, dt);
    b.fold = U.damp(b.fold, 1, 9, dt); b.flap = U.damp(b.flap, 0.3, 9, dt); b.bend = U.damp(b.bend, 0, 9, dt); b.roll = U.damp(b.roll, 0, 8, dt);
    b.fluff = U.damp(b.fluff, roosting ? 1.14 : b.sit === 'shelter' ? 1.06 : 1, 1, dt);
    b.bodyPitch = U.damp(b.bodyPitch, pc.ground && b.pkN > 0 ? -0.35 : 0.24, 10, dt);
    perchPos(pc, b.p); b.p.y += BODY_H * b.sc + hy;
    const cp = Math.cos(b.bodyPitch);
    b.fwd.set(Math.sin(b.yaw) * cp, Math.sin(b.bodyPitch), Math.cos(b.yaw) * cp);
    b.peck = peck * (pc.ground ? 1.15 : 0.7);
  }
  function drawBird(b) {
    const i = b.i, s = b.sc * b.fluff;
    orient(birdMesh, i, b.p.x, b.p.y, b.p.z, b.fwd.x, b.fwd.y, b.fwd.z, b.roll, s);
    const a = bAnim.array, a2 = bAnim2.array, perched = b.st === 'perch';
    a[i * 4] = b.flap; a[i * 4 + 1] = b.fold; a[i * 4 + 2] = (perched ? b.hPitch + (b.peck || 0) : b.hPitch); a[i * 4 + 3] = perched ? b.hYaw : 0;
    a2[i * 2] = b.bend; a2[i * 2 + 1] = b.tail;
  }

  function flush(x, y, z, radius) {
    if (!birdMesh) return;
    const now = WG.time, from = new V3(isFinite(x) ? x : 0, isFinite(y) ? y : 1, isFinite(z) ? z : 0);
    if (radius && !B.some((b) => b.p.distanceTo(from) < radius)) return;
    flock.flushT = now + (flock.bad || flock.roost ? rr(2.5, 4.5) : rr(9, 13));
    if (flock.phase !== 'air') { flock.phase = 'air'; }
    flock.landT = Math.max(flock.landT, 14);
    for (const b of B) {
      if (radius && b.p.distanceTo(from) > radius && b.st !== 'fly') continue;
      if (b.pending) { occupied.delete(b.pending); b.pending = null; }
      if (b.st === 'perch') { b.toDelay = rr(0, 0.35); b.fleeFrom = from; b.wake = -1; }
      else if (b.st === 'path' && b.path.kind === 'land') { if (b.perch) { occupied.delete(b.perch); b.perch = null; } b.sit = ''; b.st = 'fly'; b.flee = 2.5; }
      else if (b.st === 'fly') { b.flee = 2.5; tA.set(b.p.x - from.x, 0, b.p.z - from.z); if (tA.lengthSq() > 1e-4) b.v.addScaledVector(tA.normalize(), 0.8); b.v.y += 0.3; }
      b.flapping = true; b.bt = 0.8;
    }
    flock.goal.set(U.clamp(-from.x * 0.5, -4, 4), flock.yHi - 0.2, U.clamp(-from.z * 0.4, -2.4, 2.6));
  }
  fauna.flush = (x, y, z, radius) => { try { flush(x, y, z, radius); } catch (e) { WG.fail('fauna.flush', e); } };

  /* ================================================================ BUTTERFLIES */
  const NF = Q.butterflies, BF = fauna.butterflies;
  let bfMesh = null, bfAttr = null, spots = [];
  function flowerSpots() {
    const out = [];
    const ms = WG.meadow && WG.meadow.flowerSpots;
    if (ms && ms.length) for (const s of ms) { const x = s.x !== undefined ? s.x : s[0], z = s.z !== undefined ? s.z : s[s.length - 1]; if (isFinite(x) && isFinite(z) && T.inside(x, z, 0.3)) out.push({ x, z, src: s }); }
    if (out.length >= 6) return out;
    const rnd = U.rng(8812);
    for (let k = 0; k < 900 && out.length < 34; k++) {
      const x = -5.5 + rnd() * 11, z = -3.2 + rnd() * 6.9;
      if (T.grassDensity(x, z) < 0.55 || T.height(x, z) > 1.5 || T.waterAt(x, z) || T.lakeR(x, z) < 1.2) continue;
      if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 0.45)) continue;
      out.push({ x, z });
    }
    return out;
  }
  function buildButterflies() {
    spots = flowerSpots(); if (!spots.length) spots = [{ x: -1, z: 1.5 }];
    const wv = [0.0008, 0, -0.012, 0.021, 0, -0.012, 0.021, 0, 0.012, 0.0008, 0, 0.012], wi = [0, 2, 1, 0, 3, 2], wu = [0, 0, 1, 0, 1, 1, 0, 1];
    const wingG = flat(wv, wi, wu), body = new THREE.BoxGeometry(0.0022, 0.0022, 0.016);
    const geo = merge([{ g: body, a: [0, 0] }, { g: wingG, a: [2, 0] }, { g: wingG, m: MX(0, 0, 0, -1, 1, 1), a: [1, 0], flip: true }]);
    bfAttr = instAttr(geo, 'aBf', NF, 4);
    const mat = WG.mat.lit({
      name: 'butterflies', side: THREE.DoubleSide, shadow: false,
      vertexDecl: 'attribute vec4 aP; attribute vec4 aBf; varying vec2 vPC; varying vec2 vK;',
      vertexLocal: `vPC = aP.xy; vK = aBf.yz;
        if (aP.x > 0.5) { float side = aP.x < 1.5 ? -1.0 : 1.0, s = abs(pos.x), a = aBf.x + (1.0 - vUv.y) * 0.18 * sin(aBf.x * 2.0);
          pos = vec3(side * s * cos(a), s * sin(a) + pos.y, pos.z); nrm = vec3(-side * sin(a), cos(a), 0.0); }`,
      fragDecl: 'varying vec2 vPC; varying vec2 vK;',
      frag: /* glsl */ `
        float kind = vK.x;
        if (vPC.x < 0.5) { albedo = vec3(0.03, 0.028, 0.025); rough = 0.7; }
        else {
          vec2 q = vUv, df = q - vec2(0.45, 0.68), dh = q - vec2(0.3, 0.3);
          vec2 fa = vec2(dot(df, vec2(0.906, 0.423)), dot(df, vec2(-0.423, 0.906))) / vec2(0.55, 0.25);
          vec2 ha = vec2(dot(dh, vec2(0.766, -0.643)), dot(dh, vec2(0.643, 0.766))) / vec2(0.36, 0.26);
          float ef = dot(fa, fa), eh = dot(ha, ha), r = length(q - vec2(0.0, 0.5));
          float inF = step(ef, 1.0), inH = step(eh, 1.0) * (1.0 - inF);
          if (inF + inH < 0.5) discard;
          float edge = inF > 0.5 ? 1.0 - sqrt(ef) : 1.0 - sqrt(eh);
          vec3 c;
          if (kind < 0.5) { c = vec3(0.72, 0.72, 0.66);
            c = mix(c, vec3(0.04), inF * smoothstep(0.45, 0.6, fa.x) * smoothstep(-0.6, 0.0, fa.y));
            c = mix(c, vec3(0.05), inF * smoothstep(0.2, 0.12, length(fa - vec2(0.15, -0.2)))); }
          else if (kind < 1.5) { c = vec3(0.78, 0.6, 0.07); c = mix(c, vec3(0.7, 0.28, 0.03), smoothstep(0.2, 0.1, length((inF > 0.5 ? fa : ha) - vec2(0.1, 0.0)))); }
          else if (kind < 2.5) { c = vec3(0.62, 0.17, 0.02);
            c = mix(c, vec3(0.06, 0.03, 0.015), smoothstep(0.22, 0.06, edge));
            float er = length(fa - vec2(0.5, 0.05)); c = mix(c, vec3(0.03), inF * smoothstep(0.42, 0.36, er)); c = mix(c, vec3(0.12, 0.22, 0.6), inF * smoothstep(0.3, 0.24, er)); c = mix(c, vec3(0.75), inF * smoothstep(0.12, 0.07, er));
            float eh2 = length(ha - vec2(0.25, 0.1)); c = mix(c, vec3(0.03), inH * smoothstep(0.42, 0.36, eh2)); c = mix(c, vec3(0.15, 0.25, 0.6), inH * smoothstep(0.28, 0.22, eh2)); }
          else { c = vec3(0.1, 0.2, 0.62); c = mix(c, vec3(0.03, 0.035, 0.08), smoothstep(0.16, 0.05, edge)); c = mix(c, vec3(0.75), smoothstep(0.04, 0.0, edge)); }
          c *= 0.82 + 0.18 * smoothstep(0.0, 0.3, r);
          if (!gl_FrontFacing) c = mix(c, vec3(0.78, 0.74, 0.62), 0.35);
          albedo = c; rough = 0.75; trans = 0.5;
        }`,
    });
    bfMesh = instMesh(geo, mat, NF);
    for (let i = 0; i < NF; i++) {
      const sp = spots[(i * 7) % spots.length];
      BF.push({ i, kind: i % 4, p: new V3(sp.x + rr(-0.3, 0.3), T.height(sp.x, sp.z) + rr(0.15, 0.4), sp.z + rr(-0.3, 0.3)), v: new V3(), tgt: null, st: 'fly', t: rr(0, 3), ph: Math.random() * TAU, wing: 0.5, yaw: Math.random() * TAU, alive: 0, sc: rr(1.3, 1.65), seed: Math.random(), hz: rr(7, 10), fwd: new V3(0, 0, 1) });
    }
    WG.add(bfMesh, { pass: 'A' });
  }
  function bfTarget(f, far) {
    let best = null;
    for (let k = 0; k < 8; k++) { const s = spots[(Math.random() * spots.length) | 0], d = Math.hypot(s.x - f.p.x, s.z - f.p.z); if (s.src && s.src.bloom !== undefined && s.src.bloom < 0.15 && k < 6) continue; if (!best || (far ? d > best.d : Math.abs(d - 1.2) < Math.abs(best.d - 1.2))) best = { s, d }; }
    if (!best) best = { s: spots[(Math.random() * spots.length) | 0] };
    const s = best.s, rad = s.src && s.src.r ? s.src.r * 0.8 : 0.15, x = s.x + rr(-rad, rad), z = s.z + rr(-rad, rad);
    f.tgt = { x, z, y: T.height(x, z) + 0.065 };
  }
  let bfK = 0;
  const wv2 = {};
  function butterfliesUpdate(dt) {
    const k = W.bySeason(0.8, 1, 0.1, 0) * U.smooth(12, 17, S.temp) * env.calm * U.smooth(0.3, 0.65, S.sunI) * env.dry * env.day;
    bfK = k;
    const nOn = Math.round(NF * k + 0.15), t = WG.time, a = bfAttr.array;
    for (const f of BF) {
      const on = f.i < nOn;
      if (on && f.alive <= 0.001) { const s = spots[(Math.random() * spots.length) | 0]; f.p.set(s.x + rr(-0.4, 0.4), 0, s.z + rr(-0.4, 0.4)); f.p.y = T.height(f.p.x, f.p.z) + rr(0.15, 0.4); f.st = 'fly'; f.tgt = null; f.v.set(0, 0, 0); }
      f.alive = on ? Math.min(1, f.alive + dt * 0.6) : Math.max(0, f.alive - dt * 0.5);
      if (f.alive <= 0) { hide(bfMesh, f.i); continue; }
      const p = f.p, v = f.v;
      if (!f.tgt) bfTarget(f, false);
      if (f.st === 'fly') {
        const tg = f.tgt, dx = tg.x - p.x, dz = tg.z - p.z, dh = Math.hypot(dx, dz);
        const hov = dh > 0.35 ? 0.16 + 0.1 * Math.sin(t * 1.3 + f.seed * 9) : U.lerp(0, 0.16, dh / 0.35);
        tA.set(dx, tg.y + hov - p.y, dz); const dl = tA.length(); tA.multiplyScalar((dh < 0.3 ? 0.2 : 0.3) / Math.max(dl, 1e-4));
        const jit = RM ? 0.6 : 1.7;
        v.x += ((tA.x - v.x) * 2.2 + rr(-jit, jit)) * dt; v.y += ((tA.y - v.y) * 2.6 + rr(-jit, jit) * 1.2) * dt; v.z += ((tA.z - v.z) * 2.2 + rr(-jit, jit)) * dt;
        W.windAt(p.x, p.z, wv2); v.x += wv2.x * dt * 0.7; v.z += wv2.z * dt * 0.7;
        const sp = v.length(); if (sp > 0.6) v.multiplyScalar(0.6 / sp);
        p.addScaledVector(v, dt);
        p.x = U.clamp(p.x, -5.6, 5.6); p.z = U.clamp(p.z, -3.6, 3.7);
        const gy = T.height(p.x, p.z); if (p.y < gy + 0.04) { p.y = gy + 0.04; v.y = Math.abs(v.y); } if (p.y > gy + 0.9) v.y -= dt * 1.5;
        if (dh < 0.045 && Math.abs(p.y - tg.y) < 0.05) { f.st = 'rest'; f.t = rr(2, 8); p.set(tg.x, tg.y, tg.z); v.set(0, 0, 0); }
        f.ph += dt * TAU * (RM ? 4 : f.hz) * (0.8 + 0.4 * Math.random());
        f.wing = 0.1 + 1.25 * (0.5 + 0.5 * Math.sin(f.ph));
        if (Math.hypot(v.x, v.z) > 0.04) f.yaw += U.cyc(f.yaw, Math.atan2(v.x, v.z), TAU) * (1 - Math.exp(-dt * 6));
        f.fwd.set(Math.sin(f.yaw), U.clamp(v.y * 0.6, -0.4, 0.4), Math.cos(f.yaw));
      } else {
        f.t -= dt;
        f.wing = 0.35 + 0.95 * Math.pow(0.5 + 0.5 * Math.sin(t * (RM ? 0.8 : 1.5) + f.seed * 20), 1.5);
        f.fwd.set(Math.sin(f.yaw), 0.12, Math.cos(f.yaw));
        p.y = f.tgt.y + (RM ? 0 : 0.002 * Math.sin(t * 2.3 + f.seed * 7));
        if (f.t <= 0) { f.st = 'fly'; bfTarget(f, false); v.set(0, 0.25, 0); }
      }
      orient(bfMesh, f.i, p.x, p.y, p.z, f.fwd.x, f.fwd.y, f.fwd.z, 0, f.sc * U.smooth(0, 1, f.alive));
      a[f.i * 4] = f.wing; a[f.i * 4 + 1] = f.kind; a[f.i * 4 + 2] = f.seed; a[f.i * 4 + 3] = 0;
    }
    bfMesh.instanceMatrix.needsUpdate = true; bfAttr.needsUpdate = true;
  }
  function scatterInsects(x, z, r) {
    r = r || 1.2;
    for (const f of BF) {
      if (f.alive <= 0) continue; const dx = f.p.x - x, dz = f.p.z - z, d = Math.hypot(dx, dz); if (d > r) continue;
      const k = 1 - d / r, n = Math.max(d, 0.05);
      f.st = 'fly'; f.v.set((dx / n) * 0.9 * k + rr(-0.2, 0.2), 0.4 + 0.5 * k, (dz / n) * 0.9 * k + rr(-0.2, 0.2)); bfTarget(f, true);
    }
    for (const d of DF) { if (d.alive <= 0) continue; if (Math.hypot(d.p.x - x, d.p.z - z) < r) d.t = 0; }
  }
  fauna.scatterInsects = (x, z, r) => { try { scatterInsects(x, z, r); } catch (e) { WG.fail('fauna.scatterInsects', e); } };

  /* ================================================================ DRAGONFLIES */
  const ND = Q.dragonflies, DF = fauna.dragonflies;
  let dfMesh = null, dwMesh = null, shallows = [];
  function buildDragonflies() {
    const rnd = U.rng(5150);
    for (let k = 0; k < 3000 && shallows.length < 60; k++) { const x = 0.2 + rnd() * 5.3, z = 0.6 + rnd() * 3.35, r = T.lakeR(x, z); if (r > 0.72 && r < 0.93 && z < 3.8) shallows.push({ x, z }); }
    if (!shallows.length) shallows.push({ x: 2.7, z: 1.1 });
    const abd = new THREE.CylinderGeometry(0.0021, 0.0013, 0.036, 6, 1), sph = new THREE.SphereGeometry(1, 7, 5);
    const geo = merge([
      { g: abd, m: MX(0, 0, -0.021, 1, 1, 1, Math.PI / 2), a: [0, 0] },
      { g: sph, m: MX(0, 0, 0.001, 0.0033, 0.0036, 0.0055), a: [0, 1] },
      { g: sph, m: MX(0, 0.0004, 0.0078, 0.0042, 0.0033, 0.003), a: [0, 2] },
    ]);
    const mat = WG.mat.lit({
      name: 'dragonflies', shadow: false,
      vertexDecl: 'attribute vec4 aP; varying vec3 vB; varying vec2 vPC;', vertexLocal: 'vB = pos; vPC = aP.xy;',
      fragDecl: 'varying vec3 vB; varying vec2 vPC;',
      frag: `vec3 c = vCol; rough = 0.3; spec = 0.12; metal = 0.35;
        if (vPC.y < 0.5) { float seg = fract(-vB.z * 260.0); c = mix(c, vec3(0.015), smoothstep(0.2, 0.0, seg) * 0.85 + smoothstep(0.0012, 0.0021, vB.y) * 0.4); c *= 1.0 - 0.6 * smoothstep(-0.03, -0.042, vB.z); }
        else if (vPC.y < 1.5) c = mix(c * 0.6, vec3(0.03), 0.4);
        else { c = c * 1.3 + 0.05; rough = 0.15; spec = 0.2; metal = 0.1; }
        albedo = c;`,
    });
    dfMesh = instMesh(geo, mat, ND);
    const fw = flat([0.0015, 0, -0.0026, 0.026, 0, -0.0026, 0.026, 0, 0.0029, 0.0015, 0, 0.0029], [0, 2, 1, 0, 3, 2], [0, 0, 1, 0, 1, 1, 0, 1]);
    const hw = flat([0.0015, 0, -0.0034, 0.024, 0, -0.0034, 0.024, 0, 0.0031, 0.0015, 0, 0.0031], [0, 2, 1, 0, 3, 2], [0, 0, 1, 0, 1, 1, 0, 1]);
    const wgeo = merge([
      { g: fw, m: MX(0, 0.0025, 0.0035, 1, 1, 1), a: [2, 0] }, { g: fw, m: MX(0, 0.0025, 0.0035, -1, 1, 1), a: [1, 0], flip: true },
      { g: hw, m: MX(0, 0.0025, -0.0028, 1, 1, 1), a: [2, 1] }, { g: hw, m: MX(0, 0.0025, -0.0028, -1, 1, 1), a: [1, 1], flip: true },
    ]);
    const wmat = WG.mat.lit({
      name: 'dragonflyWings', side: THREE.DoubleSide, transparent: true, premultiplied: true, depthWrite: false, shadow: false, env: 'sky',
      vertexDecl: 'attribute vec4 aP;',
      vertexLocal: `float side = aP.x < 1.5 ? -1.0 : 1.0, s = abs(pos.x); float ph = M[3].x * 37.0 + M[3].z * 23.0 + aP.y * 1.7;
        float a = 0.06 + 0.22 * sin(uTime * 55.0 + ph) ; pos = vec3(side * s * cos(a), pos.y + s * sin(a), pos.z); nrm = vec3(-side * sin(a), cos(a), 0.0);`,
      frag: `vec2 q = vUv * 2.0 - 1.0; float e = q.x * q.x + q.y * q.y * (1.0 + 0.6 * vUv.x); if (e > 1.0 || vUv.x < 0.02) discard;
        albedo = vec3(0.85, 0.9, 0.95); rough = 0.12; spec = 0.12;
        float vein = smoothstep(0.1, 0.0, abs(fract(vUv.x * 9.0 + q.y * 0.6) - 0.5) - 0.38) * 0.5 + smoothstep(0.06, 0.0, abs(q.y + 0.55));
        float stig = smoothstep(0.08, 0.04, length(vec2((vUv.x - 0.86) * 0.6, q.y - 0.55)));
        float fres = pow(1.0 - abs(dot(N, V)), 3.0);
        alpha = 0.14 + 0.32 * fres + 0.12 * vein + 0.6 * stig;
        albedo = mix(albedo, vec3(0.05), stig);`,
      fragPost: `vec3 R = reflect(-V, N); float gl = pow(max(dot(R, uSunDir), 0.0), 40.0);
        vec3 iri = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + dot(N, V) * 1.5));
        col = col * alpha + uSunCol * gl * iri * 0.6;`,
    });
    dwMesh = instMesh(wgeo, wmat, ND);
    for (let i = 0; i < ND; i++) {
      const s = shallows[(i * 13) % shallows.length], blue = i % 2 === 0;
      DF.push({ i, p: new V3(s.x, C.LAKE + 0.15, s.z), from: new V3(), to: new V3(s.x, C.LAKE + 0.15, s.z), t: rr(0.5, 3), dart: 1, yaw: Math.random() * TAU, yawT: 0, alive: 0, seed: Math.random() * 10, sc: rr(0.9, 1.1) });
      dfMesh.setColorAt(i, blue ? new THREE.Color(0.03, 0.2, 0.75) : new THREE.Color(0.1, 0.48, 0.1));
    }
    dfMesh.instanceColor.needsUpdate = true;
    WG.add(dfMesh, { pass: 'A' }); WG.add(dwMesh, { pass: 'A' });
  }
  function dragonfliesUpdate(dt) {
    const k = W.bySeason(0.3, 1, 0.12, 0) * U.smooth(17, 22, S.temp) * (S.ice < 0.1 ? 1 : 0) * U.smooth(1.25, 0.7, S.wind.speed) * env.dry * env.day;
    const nOn = Math.round(ND * k + 0.1), t = WG.time, lvl = S.lakeLevel;
    for (const d of DF) {
      const on = d.i < nOn;
      if (on && d.alive <= 0.001) { const s = shallows[(Math.random() * shallows.length) | 0]; d.p.set(s.x, lvl + 0.14, s.z); d.to.copy(d.p); d.dart = 1; }
      d.alive = on ? Math.min(1, d.alive + dt * 0.8) : Math.max(0, d.alive - dt * 0.8);
      if (d.alive <= 0) { hide(dfMesh, d.i); hide(dwMesh, d.i); continue; }
      d.t -= dt;
      if (d.dart < 1) {
        d.dart = Math.min(1, d.dart + dt / 0.32); const e = U.ease(d.dart);
        d.p.lerpVectors(d.from, d.to, e); d.p.y += Math.sin(Math.PI * d.dart) * 0.03;
      } else {
        if (d.t <= 0) {
          let s = null;
          for (let k2 = 0; k2 < 8; k2++) { const c = shallows[(Math.random() * shallows.length) | 0], dd = Math.hypot(c.x - d.p.x, c.z - d.p.z); if (dd > 0.25 && dd < 1.1) { s = c; break; } }
          if (s) { d.from.copy(d.p); d.to.set(s.x + rr(-0.05, 0.05), lvl + rr(0.08, 0.2), s.z + rr(-0.05, 0.05)); d.dart = 0; d.yawT = Math.atan2(d.to.x - d.p.x, d.to.z - d.p.z); }
          d.t = rr(1.5, 4.5);
        } else if (Math.random() < dt * 0.6) d.yawT = d.yaw + rr(-1.2, 1.2);
        const j = RM ? 0.3 : 1;
        d.p.set(d.to.x + Math.sin(t * 2.3 + d.seed) * 0.006 * j, d.to.y + Math.sin(t * 3.1 + d.seed * 2) * 0.008 * j, d.to.z + Math.cos(t * 2.7 + d.seed) * 0.006 * j);
      }
      d.yaw += U.cyc(d.yaw, d.yawT, TAU) * (1 - Math.exp(-dt * (d.dart < 1 ? 20 : 6)));
      const s = d.sc * U.smooth(0, 1, d.alive);
      orient(dfMesh, d.i, d.p.x, d.p.y, d.p.z, Math.sin(d.yaw), d.dart < 1 ? -0.1 : 0.05, Math.cos(d.yaw), 0, s);
      orient(dwMesh, d.i, d.p.x, d.p.y, d.p.z, Math.sin(d.yaw), d.dart < 1 ? -0.1 : 0.05, Math.cos(d.yaw), 0, s);
    }
    dfMesh.instanceMatrix.needsUpdate = true; dwMesh.instanceMatrix.needsUpdate = true;
  }

  /* ================================================================ FIREFLIES */
  const NFF = Q.fireflies;
  let ffPts = null, ffDark = 0, ffK = 0;
  function buildFireflies() {
    const rnd = U.rng(31337), pos = new Float32Array(NFF * 3), dat = new Float32Array(NFF * 4), dr = new Float32Array(NFF * 3);
    let n = 0;
    for (let k = 0; k < 40000 && n < NFF; k++) {
      const lakeSide = rnd() < 0.3;
      const x = lakeSide ? 2.75 + (rnd() * 2 - 1) * 3.0 : -5.6 + rnd() * 11.2, z = lakeSide ? 2.65 + (rnd() * 2 - 1) * 2.4 : -2.4 + rnd() * 6.1;
      if (!T.inside(x, z, 0.25)) continue;
      const r = T.lakeR(x, z), h = T.height(x, z);
      if (lakeSide) { if (r < 0.9 || r > 1.3) continue; }
      else if (T.grassDensity(x, z) < 0.35 || h > 1.5 || r < 1.15) continue;
      pos[n * 3] = x; pos[n * 3 + 1] = Math.max(h, C.LAKE + 0.28) + 0.05 + rnd() * rnd() * 0.5; pos[n * 3 + 2] = z;
      dat[n * 4] = rnd(); dat[n * 4 + 1] = 2.4 + rnd() * 4.2; dat[n * 4 + 2] = 2.8 + rnd() * 1.8; dat[n * 4 + 3] = rnd();
      dr[n * 3] = rnd(); dr[n * 3 + 1] = rnd(); dr[n * 3 + 2] = rnd();
      n++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, n * 3), 3)); g.setAttribute('aDat', new THREE.BufferAttribute(dat.subarray(0, n * 4), 4)); g.setAttribute('aDr', new THREE.BufferAttribute(dr.subarray(0, n * 3), 3));
    ffPts = new THREE.Points(g, WG.mat.unlit({
      name: 'fireflies', additive: true, depthWrite: false,
      uniforms: { uK: { value: 0 }, uDark: { value: 0 }, uPx: { value: 1 }, uMot: { value: RM ? 0.4 : 1 } },
      vertexDecl: 'attribute vec4 aDat; attribute vec3 aDr; uniform float uK; uniform float uDark; uniform float uPx; uniform float uMot; varying float vGlow;',
      vertexLocal: `float tt = uTime * uMot;
        pos += vec3(sin(tt * 0.21 * (0.6 + aDr.x) + aDr.y * 6.28) * 0.24 + sin(tt * 0.63 + aDr.z * 9.0) * 0.04,
                    sin(tt * 0.29 * (0.5 + aDr.z) + aDr.x * 6.28) * 0.07,
                    cos(tt * 0.17 * (0.6 + aDr.y) + aDr.z * 6.28) * 0.24 + cos(tt * 0.57 + aDr.x * 7.0) * 0.04);`,
      vertexEnd: `float c = fract(uTime / aDat.y + aDat.x);
        float g = smoothstep(0.0, 0.07, c) * (1.0 - smoothstep(0.12, 0.38, c));
        g = (g + 0.03) * step(aDat.w, uK) * (1.0 - uDark);
        vGlow = g; gl_PointSize = g > 0.002 ? max(2.0, aDat.z * uPx * 34.0 / gl_Position.w) : 0.0;`,
      fragDecl: 'varying float vGlow;',
      frag: `vec2 q = gl_PointCoord * 2.0 - 1.0; float r2 = dot(q, q); if (r2 > 1.0) discard;
        col = vec3(0.68, 1.0, 0.2) * (exp(-r2 * 16.0) * 9.0 + exp(-r2 * 3.5) * 0.6) * vGlow * (1.0 - r2);`,
    }));
    ffPts.visible = false;
    WG.add(ffPts, { pass: 'A' });
  }
  function firefliesUpdate(dt) {
    const s = U.wrap(S.season, 4);
    const seasonK = (U.smooth(0.4, 0.8, s) * 0.22 + U.smooth(0.8, 1.05, s) * 0.78) * U.smooth(2.05, 1.6, s);
    const want = seasonK * U.smooth(0.45, 0.85, S.night) * U.smooth(9, 15, S.temp) * U.smooth(1.0, 0.5, S.wind.speed) * env.dry;
    ffK = U.damp(ffK, want, 0.6, dt);
    if (S.flash > 0.45 && ffDark < 0.5) ffDark = rr(3, 5);
    ffDark = Math.max(0, ffDark - dt);
    const u = ffPts.material.uniforms;
    u.uK.value = ffK; u.uDark.value = U.smooth(0, 1.5, ffDark) * (ffDark > 0 ? 1 : 0); u.uPx.value = (WG.render && WG.render.height ? WG.render.height : 600) / 900;
    ffPts.visible = ffK > 0.004;
  }

  /* ================================================================ FISH */
  const NFI = Q.fish, FI = fauna.fish;
  let fishMesh = null, fSwim = null;
  const school = { c: new V3(2.6, -0.25, 3.45), goal: new V3(2.6, -0.25, 3.45), t: 0, rise: rr(6, 12) };
  function buildFish() {
    const NZ = 14, NA = 10, P = [], I = [], z0 = -0.36, z1 = 0.5;
    for (let i = 0; i <= NZ; i++) {
      const t = i / NZ, z = z0 + (z1 - z0) * t, hh = 0.11 * Math.pow(Math.sin(Math.PI * (0.05 + 0.9 * Math.pow(t, 0.8))), 0.75), hw = hh * 0.46, yc = 0.012 * Math.sin(Math.PI * t);
      for (let a = 0; a < NA; a++) { const an = (a / NA) * TAU; P.push(Math.cos(an) * hw, Math.sin(an) * hh + yc, z); }
    }
    const tip = P.length / 3; P.push(0, 0.004, z1 + 0.03); const tail = tip + 1; P.push(0, 0, z0 - 0.012);
    for (let i = 0; i < NZ; i++) for (let a = 0; a < NA; a++) { const a1 = (a + 1) % NA, p00 = i * NA + a, p01 = i * NA + a1, p10 = (i + 1) * NA + a, p11 = (i + 1) * NA + a1; I.push(p00, p01, p10, p01, p11, p10); }
    for (let a = 0; a < NA; a++) { const a1 = (a + 1) % NA; I.push(NZ * NA + a, NZ * NA + a1, tip); I.push(a1, a, tail); }
    const body = flat(P, I);
    const fins = flat([0, 0, -0.32, 0, 0.125, -0.57, 0, 0.03, -0.49, 0, -0.03, -0.49, 0, -0.125, -0.57, 0, 0.1, 0.14, 0, 0.18, 0.0, 0, 0.09, -0.14], [0, 1, 2, 0, 2, 3, 0, 3, 4, 5, 6, 7]);
    const geo = merge([{ g: body, a: [0, 0] }, { g: fins, a: [1, 0] }]);
    fSwim = instAttr(geo, 'aSwim', NFI, 4);
    const mat = WG.mat.lit({
      name: 'fish', side: THREE.DoubleSide, shadow: false,
      vertexDecl: 'attribute vec4 aP; attribute vec4 aSwim; varying vec3 vB; varying vec2 vPC;',
      vertexLocal: `vB = pos; vPC = vec2(aP.x, aSwim.w);
        float tw = smoothstep(0.3, -0.58, pos.z), env = 0.12 + 0.88 * tw * tw;
        pos.x += sin(aSwim.x - pos.z * 6.5) * aSwim.y * env + aSwim.z * (pos.z - 0.15) * (pos.z - 0.15);
        nrm.x -= cos(aSwim.x - pos.z * 6.5) * aSwim.y * 6.5 * env * nrm.z;`,
      fragDecl: 'varying vec3 vB; varying vec2 vPC;',
      frag: /* glsl */ `
        float kind = floor(vPC.y + 0.001), seed = fract(vPC.y) * 40.0, yb = vB.y;
        float back = smoothstep(0.0, 0.085, yb), belly = smoothstep(-0.02, -0.085, yb);
        if (kind < 0.5) {
          albedo = mix(vec3(0.5, 0.55, 0.55), vec3(0.03, 0.05, 0.055), back);
          albedo = mix(albedo, vec3(0.74, 0.74, 0.7), belly);
          albedo *= 1.0 - 0.18 * smoothstep(0.012, 0.0, abs(yb - 0.012));
          metal = 0.5 * (1.0 - back); rough = 0.28; spec = 0.12;
        } else {
          float n = wgNoise(vB.zy * vec2(9.0, 14.0) + seed) * 0.7 + wgNoise(vB.zx * 21.0 + seed) * 0.3;
          vec3 org = vec3(0.86, 0.25, 0.02);
          albedo = mix(org, vec3(0.88, 0.82, 0.7), smoothstep(0.52, 0.6, n));
          albedo = mix(albedo, org * 0.5, back * 0.55);
          rough = 0.35; spec = 0.08; metal = 0.12;
        }
        if (vPC.x > 0.5) { albedo *= 0.75; trans = 0.5; rough = 0.55; metal = 0.0; }
        else { float eye = smoothstep(0.032, 0.024, length(vec2(yb - 0.026, vB.z - 0.37)));
          albedo = mix(albedo, vec3(0.008), eye); rough = mix(rough, 0.08, eye); metal = mix(metal, 0.0, eye); spec = mix(spec, 0.1, eye); }`,
    });
    fishMesh = instMesh(geo, mat, NFI);
    for (let i = 0; i < NFI; i++) {
      const x = rr(1.6, 3.9), z = rr(3.3, 3.8), bed = T.height(x, z), y = U.lerp(bed + 0.12, S.lakeLevel - 0.12, Math.random());
      FI.push({ i, kind: i % 3 === 2 ? 1 : 0, p: new V3(x, y, z), v: new V3(rr(-1, 1), 0, rr(-1, 1)).setLength(0.12), off: new V3(rr(-0.6, 0.6), rr(-0.16, 0.16), rr(-0.22, 0.22)), yaw: 0, pitch: 0, curve: 0, ph: Math.random() * TAU, amp: 0.05, bolt: 0, rise: 0, sc: rr(0.11, 0.14), seed: Math.random() * 0.98 });
    }
    WG.add(fishMesh, { pass: 'A' });
  }
  const sz = { lastX: 0, lastZ: 0, lastT: -9 };
  function scatterFish(x, z) {
    const now = WG.time;
    if (Math.hypot(x - sz.lastX, z - sz.lastZ) < 0.3 && now - sz.lastT < 0.15) return;
    sz.lastX = x; sz.lastZ = z; sz.lastT = now;
    for (const f of FI) {
      const dx = f.p.x - x, dz = f.p.z - z, d = Math.hypot(dx, dz); if (d > 2.8) continue;
      const k = U.smooth(2.8, 0.4, d), n = Math.max(d, 0.05);
      f.v.set((dx / n) * (0.6 + 0.8 * k), rr(-0.25, 0.05), (dz / n) * (0.6 + 0.8 * k)); f.bolt = 0.6 + 0.8 * k; f.rise = 0;
    }
    school.goal.set(U.clamp(2.75 + (2.75 - x) * 0.4, 1.2, 4.3), school.goal.y, U.clamp(3.2 + (3.2 - z) * 0.3, 2.6, 3.7));
  }
  fauna.scatterFish = (x, z) => { try { if (fishMesh) scatterFish(x, z); } catch (e) { WG.fail('fauna.scatterFish', e); } };
  function fishUpdate(dt) {
    const lvl = S.lakeLevel, ice = S.ice, slow = (1 - 0.5 * U.smooth(0.3, 0.9, S.night)) * (1 - 0.5 * U.smooth(0.2, 0.8, ice)), top = lvl - (ice > 0.3 ? 0.1 : 0.05);
    /* the school drifts between the front glass and the middle of the lake */
    school.t -= dt;
    if (school.t <= 0 || school.c.distanceTo(school.goal) < 0.08) {
      school.t = rr(8, 16);
      const mid = Math.random() < 0.22;
      for (let k = 0; k < 10; k++) {
        const x = rr(1.3, 4.3), z = mid ? rr(2.1, 2.8) : rr(3.35, 3.75), bed = T.height(x, z);
        if (top - bed > 0.32 && T.lakeR(x, z) < 0.85) { school.goal.set(x, U.lerp(bed + 0.12, top - 0.1, rr(0.2, 0.85)), z); break; }
      }
    }
    tA.subVectors(school.goal, school.c); const gl = tA.length(); if (gl > 1e-4) school.c.addScaledVector(tA, Math.min(1, (0.09 * slow * dt) / gl));
    school.rise -= dt;
    if (school.rise <= 0) { school.rise = rr(5, 13) / (1 + S.humidity * 0.3); if (ice < 0.2 && S.night < 0.7) { const f = FI[(Math.random() * FI.length) | 0]; if (f && f.bolt <= 0) f.rise = 1; } }
    const a = fSwim.array;
    for (const f of FI) {
      const p = f.p, v = f.v;
      const bed = T.height(p.x, p.z);
      if (f.rise > 0) {
        tA.set((school.c.x - p.x) * 0.1, top + 0.03 - p.y, (school.c.z - p.z) * 0.1).multiplyScalar(1.6);
        if (p.y > top - 0.025 && f.rise === 1) { f.rise = 0.5; if (WG.water && WG.water.ring) { try { WG.water.ring(p.x, p.z, 0.07); } catch (e) { /* the water may be missing */ } } }
        if (f.rise < 1) { f.rise -= dt; tA.y = -0.4; }
      } else {
        tA.set(school.c.x + f.off.x - p.x, school.c.y + f.off.y - p.y, school.c.z + f.off.z - p.z).multiplyScalar(0.35);
        for (const o of FI) { if (o === f) continue; tB.subVectors(p, o.p); const d2 = tB.lengthSq(); if (d2 < 0.012 && d2 > 1e-8) tA.addScaledVector(tB, 0.0018 / d2); }
      }
      /* stay in the water: above the bed, below the surface or ice, inside the lake, behind the glass */
      if (p.y < bed + 0.06) tA.y += (bed + 0.06 - p.y) * 8;
      if (p.y > top) tA.y -= (p.y - top) * 8;
      const r = T.lakeR(p.x, p.z); if (r > 0.86 || top - bed < 0.14) { tA.x += (2.75 - p.x) * 0.8; tA.z += (2.65 - p.z) * 0.8; }
      if (p.z > 3.8) tA.z -= (p.z - 3.8) * 10;
      v.addScaledVector(tA, dt);
      const cruise = (0.1 + 0.05 * Math.sin(WG.time * 0.3 + f.seed * 30)) * slow, maxV = f.bolt > 0 ? 1.4 : cruise * 1.8;
      const sp = v.length(); if (sp > maxV) v.multiplyScalar(maxV / sp); else if (sp < cruise * 0.5) v.multiplyScalar(cruise * 0.5 / Math.max(sp, 1e-4));
      v.y = U.clamp(v.y, -0.35, 0.35);
      if (f.bolt > 0) { f.bolt -= dt; v.multiplyScalar(1 - dt * 0.8); }
      p.addScaledVector(v, dt);
      p.z = Math.min(p.z, 3.88); p.y = U.clamp(p.y, bed + 0.03, top + 0.02);
      /* heading, bend and tail beat */
      const hs = Math.hypot(v.x, v.z);
      if (hs > 0.01) { const ny = Math.atan2(v.x, v.z), dy = U.cyc(f.yaw, ny, TAU) * (1 - Math.exp(-dt * (f.bolt > 0 ? 12 : 3))); f.yaw += dy; f.curve = U.damp(f.curve, U.clamp(dy / Math.max(dt, 1e-3) * 0.05, -0.25, 0.25), 6, dt); }
      f.pitch = U.damp(f.pitch, U.clamp(Math.atan2(v.y, hs + 1e-3) * 0.7, -0.45, 0.45), 4, dt);
      const spd = v.length();
      f.ph += dt * (RM ? 0.6 : 1) * (5 + spd * 55);
      f.amp = U.damp(f.amp, 0.035 + Math.min(0.08, spd * 0.12), 4, dt);
      const cp = Math.cos(f.pitch);
      orient(fishMesh, f.i, p.x, p.y, p.z, Math.sin(f.yaw) * cp, Math.sin(f.pitch), Math.cos(f.yaw) * cp, 0, f.sc);
      a[f.i * 4] = f.ph; a[f.i * 4 + 1] = f.amp; a[f.i * 4 + 2] = -f.curve; a[f.i * 4 + 3] = f.kind + f.seed;
    }
    fishMesh.instanceMatrix.needsUpdate = true; fSwim.needsUpdate = true;
  }

  /* ================================================================ DUST MOTES */
  let dust = null; const drift = new V3();
  function buildDust() {
    const n = Math.round(Q.fireflies * 2.4), rnd = U.rng(2718), pos = new Float32Array(n * 3), dat = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { pos[i * 3] = -5.8 + rnd() * 11.6; pos[i * 3 + 1] = 0.4 + rnd() * 5.6; pos[i * 3 + 2] = -3.8 + rnd() * 7.6; dat[i * 4] = rnd(); dat[i * 4 + 1] = 0.5 + rnd(); dat[i * 4 + 2] = 0.9 + rnd() * 1.1; dat[i * 4 + 3] = rnd(); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aDat', new THREE.BufferAttribute(dat, 4));
    dust = new THREE.Points(g, WG.mat.unlit({
      name: 'dustMotes', additive: true, depthWrite: false,
      uniforms: { uK: { value: 0 }, uPx: { value: 1 }, uDrift: { value: drift }, uSunP: { value: new V3() }, uSunC: { value: new V3() } },
      vertexDecl: 'attribute vec4 aDat; uniform float uK; uniform float uPx; uniform vec3 uDrift; uniform vec3 uSunP; varying float vI;',
      vertexLocal: `pos += uDrift * (0.6 + 0.8 * aDat.w) + vec3(sin(uTime * 0.07 * aDat.y + aDat.x * 6.3), sin(uTime * 0.05 + aDat.x * 11.0) * 0.6, cos(uTime * 0.06 * aDat.y + aDat.x * 4.1)) * 0.3;
        pos.x = mod(pos.x + 5.85, 11.7) - 5.85; pos.z = mod(pos.z + 3.85, 7.7) - 3.85; pos.y = 0.35 + mod(pos.y - 0.35, 5.8);`,
      vertexEnd: `vec3 vd = normalize(w.xyz - cameraPosition), ld = normalize(uSunP - w.xyz);
        float c = dot(vd, ld), g = 0.7, hg = pow(1.0 - g, 3.0) / pow(1.0 + g * g - 2.0 * g * c, 1.5);
        float tw = pow(0.5 + 0.5 * sin(uTime * (1.5 + aDat.y * 3.0) + aDat.x * 40.0), 5.0);
        vI = uK * (hg + 0.012) * (0.2 + 0.8 * tw) * step(texture2D(uHeightTex, (wgUV(w.xz) * vec2(384.0, 256.0) + 0.5) / vec2(385.0, 257.0)).r + 0.05, w.y);
        gl_PointSize = vI > 0.004 ? max(1.0, aDat.z * uPx * 34.0 / gl_Position.w) : 0.0;`,
      fragDecl: 'varying float vI; uniform vec3 uSunC;',
      frag: `vec2 q = gl_PointCoord * 2.0 - 1.0; float r2 = dot(q, q); if (r2 > 1.0) discard;
        float sh = wgShadow(P, vec3(0.0, 1.0, 0.0)) * wgCloudShadow(P);
        col = uSunC * vI * sh * exp(-r2 * 5.0) * 2.2;`,
    }));
    dust.visible = false;
    WG.add(dust, { pass: 'B' });
  }
  const dw = {};
  function dustUpdate(dt) {
    const k = U.smooth(0.08, 0.3, S.sunUp) * U.smooth(0.25, 0.6, S.sunI) * env.dry * (1 - U.smooth(0.35, 0.7, S.wetAvg)) * (1 - U.smooth(0.15, 0.5, S.fogAvg)) * (1 - U.smooth(0.7, 0.92, S.humidity));
    const u = dust.material.uniforms;
    u.uK.value = U.damp(u.uK.value, k, 0.8, dt); dust.visible = u.uK.value > 0.01;
    u.uPx.value = (WG.render && WG.render.height ? WG.render.height : 600) / 900;
    u.uSunP.value.copy(S.sunPos); const sc = WG.sky && WG.sky.sunCol; if (sc) u.uSunC.value.copy(sc); else u.uSunC.value.set(2.8, 2.65, 2.4);
    W.windAt(0, 0, dw); drift.x += dw.x * dt * 0.25; drift.z += dw.z * dt * 0.25; drift.y += Math.sin(WG.time * 0.05) * dt * 0.01;
    drift.x = U.wrap(drift.x, 11.7); drift.z = U.wrap(drift.z, 7.7);
  }

  /* ================================================================ events */
  function onClick(e) {
    let x = 0, y = 1, z = 0;
    try {
      if (e && isFinite(e.x) && isFinite(e.y) && WG.cam && WG.cam.ray) {
        const r = WG.cam.ray(e.x, e.y), t = T.rayHit(r.o.x, r.o.y, r.o.z, r.d.x, r.d.y, r.d.z, true);
        if (t > 0) { x = r.o.x + r.d.x * t; y = r.o.y + r.d.y * t; z = r.o.z + r.d.z * t; if (T.waterAt(x, z) === 'lake') fauna.scatterFish(x, z); }
      }
    } catch (err) { /* ignore */ }
    fauna.flush(x, y, z);
  }

  WG.register('fauna', {
    init() {
      const steps = [['birds', buildBirds], ['butterflies', buildButterflies], ['dragonflies', buildDragonflies], ['fireflies', buildFireflies], ['fish', buildFish], ['dust', buildDust]];
      for (const [n, f] of steps) { try { f(); } catch (e) { WG.fail('fauna.' + n, e); } }
      const on = (n, f) => WG.bus.on(n, (e) => { try { f(e || {}); } catch (err) { WG.fail('fauna.' + n, err); } });
      on('glass:tap', (e) => { fauna.flush(e.x, e.y, e.z); if (e.pane === 0 && isFinite(e.x)) fauna.scatterFish(e.x, 3.9); });
      on('scene:click', onClick);
      on('lightning', (e) => { fauna.flush(e.x, e.y, e.z, 4.5 + 2 * (e.power || 1)); ffDark = rr(3, 5); if (e.target === 'lake' && isFinite(e.x)) fauna.scatterFish(e.x, e.z); });
      on('tree:grab', (e) => shakeTree(e.tree)); on('tree:flick', (e) => shakeTree(e.tree));
      on('splash', (e) => { if (isFinite(e.x) && isFinite(e.z)) fauna.scatterFish(e.x, e.z); });
      on('ice:crack', (e) => { if (isFinite(e.x) && isFinite(e.z)) fauna.scatterFish(e.x, e.z); });
      on('wind:sweep', (e) => { if (isFinite(e.x) && isFinite(e.z)) fauna.scatterInsects(e.x, e.z, 1.1 + Math.min(1.5, (e.speed || 0) * 0.15)); });
      fauna.ready = true;
    },
    update(dt) {
      readEnv();
      if (birdMesh) birdsUpdate(dt);
      if (bfMesh) butterfliesUpdate(dt);
      if (dfMesh) dragonfliesUpdate(dt);
      if (ffPts) firefliesUpdate(dt);
      if (fishMesh) fishUpdate(dt);
      if (dust) dustUpdate(dt);
    },
  });

  /* for checking the look: put the flock down now, or perch every bird near a point */
  fauna.debug = {
    land() { flock.landT = 0; },
    perchNear(x, z) {
      const list = perches().filter((p) => p._ok !== false && !p.sheltered).sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
      B.forEach((b, k) => {
        const pc = (k < 3 ? list[k] : null) || groundSpot(x, z, 0.05, 0.5); if (!pc) return;
        if (b.perch) occupied.delete(b.perch); b.perch = pc; occupied.add(pc); b.sit = 'flock'; b.st = 'perch'; b.pending = null; b.fold = 1; b.flap = 0.3; b.yaw = Math.random() * TAU; b.yawT = b.yaw;
        perchPos(pc, b.p); b.p.y += BODY_H * b.sc;
      });
      flock.phase = 'down'; flock.downEnd = WG.time + 30;
    },
    state: () => ({ flock: flock.phase, roost: flock.roost, bad: flock.bad, birds: B.map((b) => b.st + ':' + (b.sit || '-') + (b.perch ? '@' + (b.perch.kind || '') : '')), butterflies: BF.filter((f) => f.alive > 0).length, bfK, dragonflies: DF.filter((d) => d.alive > 0).length, ffK, fish: FI.length, perches: perches().length }),
  };
})();
