/* Weatherglass — trees and bushes (WG.flora).
   Pines and spruces of stacked drooping fronds, oaks, birches and cherries with real branches and lumpy leaf clusters,
   low bushes. Four draw calls: bark, fronds, leaf clusters (instanced), falling leaves / petals / snow puffs (instanced).
   Every tree carries a damped spring (wind lean, grabbing, flicks, lightning) that the shaders read from a small float
   texture together with the local wind; seasons are continuous and per-cluster, so leaves come and go one at a time. */
(function () {
  'use strict';
  const WG = window.WG, THREE = WG.THREE, U = WG.util, C = WG.C, T = WG.terrain, L = WG.layout, Q = WG.Q;
  const F = (WG.flora = { trees: [], bushes: [], held: null, hover: null });

  /* ------------------------------------------------------------------ per-tree state texture
     row 0: base x, y, z, height · row 1: bend x, bend z (fraction of height at the top), shiver, snow load
     row 2: crown centre x, y, z, crown radius · row 3: early leaf-fall from shaking, 0, 0, 0 */
  const MAXT = 128;
  const tdata = new Float32Array(MAXT * 4 * 4);
  const treeTex = new THREE.DataTexture(tdata, MAXT, 4, THREE.RGBAFormat, THREE.FloatType);
  treeTex.minFilter = treeTex.magFilter = THREE.NearestFilter; treeTex.needsUpdate = true;
  const uTreeTex = { value: treeTex }, uMotion = { value: WG.reducedMotion ? 0.35 : 1 };
  const setRow = (i, r, a, b, c, d) => { const k = (r * MAXT + i) * 4; tdata[k] = a; tdata[k + 1] = b; tdata[k + 2] = c; tdata[k + 3] = d; };

  const lin = (h) => { const c = new THREE.Color(h); return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`; };

  /* ------------------------------------------------------------------ shared vertex GLSL: bending, shivering, fluttering */
  const BEND = /* glsl */ `
uniform sampler2D uTreeTex; uniform float uMotion;
vec4 tTex(float ti, int row){ return texelFetch(uTreeTex, ivec2(int(ti + 0.5), row), 0); }
vec3 treeBend(vec3 p, float ti, float flex, float phase, float flut){
  vec4 tb = tTex(ti, 0), ts = tTex(ti, 1);
  float h = max(tb.w, 0.05), hf = clamp((p.y - tb.y) / h, 0.0, 1.6);
  vec3 p0 = p;
  vec2 wv = wgWindAt(p);
  float ws = min(length(wv), 4.0);
  vec2 off = (ts.xy + wv * 0.012) * h * hf * hf;
  float t = uTime, ph = phase * 6.2831853;
  float amp = (0.0025 + 0.009 * ws + 0.03 * ts.z) * flex * h * uMotion;
  vec3 sh = vec3(sin(t * 4.1 + ph) + 0.45 * sin(t * 9.3 + ph * 2.1), 0.6 * sin(t * 5.9 + ph * 1.7), cos(t * 3.7 + ph * 1.3) + 0.45 * sin(t * 8.1 + ph * 0.7));
  p += amp * sh;
  p.xz += off + wv * (0.012 * flex * h * uMotion);
  p.y -= dot(off, off) / (2.0 * max(hf * h, 0.03));
  if (flut > 0.0) {
    float fa = (0.0012 + 0.0035 * ws + 0.012 * ts.z) * flut * uMotion;
    p += fa * vec3(sin(t * 13.0 + dot(p0, vec3(91.0, 57.0, 73.0))), sin(t * 16.0 + dot(p0, vec3(43.0, 87.0, 29.0))), sin(t * 11.0 + dot(p0, vec3(67.0, 31.0, 97.0))));
  }
  return p;
}
`;

  /* ------------------------------------------------------------------ seasons of the leaves (GLSL and a JS mirror) */
  const COL = {
    OAK_Y: '#7f9c3e', OAK_S: '#3e6b2a', OAK_A1: '#a14a1a', OAK_A2: '#c0782a', OAK_K: '#7a5232',
    BIR_Y: '#8fab47', BIR_S: '#5b8c35', BIR_A1: '#d9a21e', BIR_A2: '#ecc23e',
    CH_Y: '#7d8a3e', CH_S: '#456f2e', CH_A1: '#a3182a', CH_A2: '#c8401e', BLOSSOM: '#f5c5ca',
    BU_Y: '#78993f', BU_S: '#45722f', BU_A1: '#b35a1e', BU_A2: '#8c3a1c',
    EV: '#2e4d27', EV_Y: '#7da244',
  };
  const LEAF = /* glsl */ `
void leafState(float kind, float thr, float thr2, float keep, float shed, out float pres, out vec3 col){
  float s = uSeason, sw = s < 3.0 ? s : s - 4.0, p = mod(s - 3.5, 4.0);
  if (kind > 3.5) { pres = 1.0; col = mix(${lin(COL.EV)}, ${lin(COL.EV_Y)}, uSeasonW.x * 0.55 * thr); return; }
  float p0, pF; vec3 young, summer, autumn;
  if (kind < 0.5) { p0 = 0.28 + 0.2 * thr; pF = 2.85 + 0.6 * thr; young = ${lin(COL.OAK_Y)}; summer = ${lin(COL.OAK_S)}; autumn = mix(${lin(COL.OAK_A1)}, ${lin(COL.OAK_A2)}, fract(thr2 * 7.3)); }
  else if (kind < 1.5) { p0 = 0.22 + 0.2 * thr; pF = 2.7 + 0.6 * thr; young = ${lin(COL.BIR_Y)}; summer = ${lin(COL.BIR_S)}; autumn = mix(${lin(COL.BIR_A1)}, ${lin(COL.BIR_A2)}, fract(thr2 * 7.3)); }
  else if (kind < 2.5) { p0 = 0.08 + 0.12 * thr; pF = 2.75 + 0.55 * thr; young = ${lin(COL.CH_Y)}; summer = ${lin(COL.CH_S)}; autumn = mix(${lin(COL.CH_A1)}, ${lin(COL.CH_A2)}, fract(thr2 * 7.3)); }
  else { p0 = 0.25 + 0.2 * thr; pF = 2.8 + 0.6 * thr; young = ${lin(COL.BU_Y)}; summer = ${lin(COL.BU_S)}; autumn = mix(${lin(COL.BU_A1)}, ${lin(COL.BU_A2)}, fract(thr2 * 7.3)); }
  pF -= shed;
  if (keep > 0.5) pF = 9.0;
  pres = smoothstep(p0, p0 + 0.16, p) * (1.0 - smoothstep(pF, pF + 0.035, p));
  float yk = 1.0 - smoothstep(0.25, 0.95, sw);
  float turn = smoothstep(1.45 + 0.62 * thr2, 1.72 + 0.62 * thr2, sw);
  col = mix(mix(summer, young, yk), autumn, turn);
  if (keep > 0.5) col = mix(col, ${lin(COL.OAK_K)}, smoothstep(2.5, 2.95, sw));
  if (kind > 1.5 && kind < 2.5) { float b = smoothstep(-0.42, -0.1, sw) * (1.0 - smoothstep(0.05, 0.3, sw)); col = mix(col, ${lin(COL.BLOSSOM)}, b); }
}
`;
  const sWrap = (s) => { s = U.wrap(s, 4); return s < 3 ? s : s - 4; };
  function leafPres(kind, thr, keep, shed, s) {
    if (kind === 4) return 1;
    const p = U.wrap(s - 3.5, 4); let p0, pF;
    if (kind === 0) { p0 = 0.28 + 0.2 * thr; pF = 2.85 + 0.6 * thr; } else if (kind === 1) { p0 = 0.22 + 0.2 * thr; pF = 2.7 + 0.6 * thr; }
    else if (kind === 2) { p0 = 0.08 + 0.12 * thr; pF = 2.75 + 0.55 * thr; } else { p0 = 0.25 + 0.2 * thr; pF = 2.8 + 0.6 * thr; }
    pF -= shed; if (keep) pF = 9;
    return U.smooth(p0, p0 + 0.16, p) * (1 - U.smooth(pF, pF + 0.035, p));
  }
  const blossomK = (s) => { const sw = sWrap(s); return U.smooth(-0.42, -0.1, sw) * (1 - U.smooth(0.05, 0.3, sw)); };

  /* ------------------------------------------------------------------ geometry accumulation */
  function Geo() { return { p: [], n: [], uv: [], a: [], c: [], idx: [], vc: 0 }; }
  function vert(G, x, y, z, nx, ny, nz, u, v, a0, a1, a2, a3, col) {
    G.p.push(x, y, z); G.n.push(nx, ny, nz); G.uv.push(u, v); G.a.push(a0, a1, a2, a3); G.c.push(col[0], col[1], col[2]); return G.vc++;
  }
  function toGeometry(G) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(G.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(G.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(G.uv, 2));
    g.setAttribute('aTree', new THREE.Float32BufferAttribute(G.a, 4));
    g.setAttribute('color', new THREE.Float32BufferAttribute(G.c, 3));
    g.setIndex(G.vc > 65535 ? new THREE.Uint32BufferAttribute(G.idx, 1) : new THREE.Uint16BufferAttribute(G.idx, 1));
    return g;
  }
  const WHITE = [1, 1, 1];
  /* a tapered tube along a polyline. o: {ti, f0, f1 (flex at both ends), ph, kind, v0, col} */
  function tube(G, pts, rad, sides, o) {
    const n = pts.length, base = G.vc; let len = o.v0 || 0, px = 0, py = 0, pz = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2]; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      if (i === 0) { let rx = 0, ry = 1, rz = 0; if (Math.abs(ty) > 0.9) { rx = 1; ry = 0; } const d = rx * tx + ry * ty + rz * tz; px = rx - tx * d; py = ry - ty * d; pz = rz - tz * d; }
      else { const d = px * tx + py * ty + pz * tz; px -= tx * d; py -= ty * d; pz -= tz * d; len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]); }
      const pl = Math.hypot(px, py, pz) || 1; px /= pl; py /= pl; pz /= pl;
      const bx = ty * pz - tz * py, by = tz * px - tx * pz, bz = tx * py - ty * px;
      const f = U.lerp(o.f0, o.f1, n > 1 ? i / (n - 1) : 0), r = rad[i];
      for (let s = 0; s <= sides; s++) {
        const ang = (s / sides) * Math.PI * 2, ca = Math.cos(ang), sa = Math.sin(ang);
        const nx = px * ca + bx * sa, ny = py * ca + by * sa, nz = pz * ca + bz * sa;
        vert(G, pts[i][0] + nx * r, pts[i][1] + ny * r, pts[i][2] + nz * r, nx, ny, nz, s / sides, len, o.ti, f, o.ph, o.kind, o.col || WHITE);
      }
    }
    for (let i = 0; i < n - 1; i++) for (let s = 0; s < sides; s++) { const a = base + i * (sides + 1) + s, b = a + 1, c = a + sides + 1, d = c + 1; G.idx.push(a, b, c, b, d, c); }
    return len;
  }
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  /* point along a polyline at fraction t */
  const along = (pts, t) => { const f = U.clamp(t, 0, 1) * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)); return lerp3(pts[i], pts[i + 1], f - i); };
  /* a gently curved branch path from a to b, bowing by `bow` (vector) in the middle */
  const curve = (a, b, bow, n) => { const out = []; for (let i = 0; i <= n; i++) { const t = i / n, k = 4 * t * (1 - t); const p = lerp3(a, b, t); out.push([p[0] + bow[0] * k, p[1] + bow[1] * k, p[2] + bow[2] * k]); } return out; };

  /* ------------------------------------------------------------------ leaf clusters (instances) */
  const CL = { x: [], y: [], z: [], s: [], sy: [], rot: [], ti: [], thr: [], thr2: [], kind: [], keep: [], depth: [], flex: [], ph: [], prev: [] };
  function addCluster(x, y, z, size, ti, kind, depth, flex, ph, R, keep) {
    CL.x.push(x); CL.y.push(y); CL.z.push(z); CL.s.push(size); CL.sy.push(size * (0.78 + R() * 0.12)); CL.rot.push(R() * 6.283);
    CL.ti.push(ti); CL.thr.push(R()); CL.thr2.push(R()); CL.kind.push(kind); CL.keep.push(keep ? 1 : 0);
    CL.depth.push(U.clamp(depth, 0.15, 1)); CL.flex.push(flex); CL.ph.push(ph); CL.prev.push(-1);
  }
  const crownDepth = (p, cr) => Math.sqrt(((p[0] - cr.x) / cr.rx) ** 2 + ((p[1] - cr.y) / cr.ry) ** 2 + ((p[2] - cr.z) / cr.rx) ** 2);

  /* ------------------------------------------------------------------ the tree builders */
  const BARK = { oak: 0, birch: 1, cherry: 2, pine: 3, spruce: 3, bush: 4 };
  const KIND = { oak: 0, birch: 1, cherry: 2 };

  /* oaks and cherries: a short trunk forking into main limbs that reach for a rounded crown, sub-branches, twigs, clusters at the ends */
  function genSpreading(t, ti, B) {
    const R = U.rng(t.seed * 31 + 7), H = t.h, r = t.r, oak = t.kind === 'oak', kind = KIND[t.kind], bark = BARK[t.kind];
    const keepTree = oak && R() < 0.4;
    const cr = { x: t.x, y: t.y + (oak ? 0.6 : 0.6) * H, z: t.z, rx: r, ry: (oak ? 0.36 : 0.27) * H };
    t.crown = cr;
    const base = [t.x, t.y - 0.04 * H, t.z];
    const lx = (R() - 0.5) * 0.07 * H, lz = (R() - 0.5) * 0.07 * H, fy = t.y + (oak ? 0.31 + R() * 0.06 : 0.24 + R() * 0.05) * H;
    const Fk = [t.x + lx, fy, t.z + lz];
    const tr = (oak ? 0.04 : 0.042) * H;
    const trunk = [base, [t.x + lx * 0.25, base[1] + (fy - base[1]) * 0.35, t.z + lz * 0.25], [t.x + lx * 0.7, base[1] + (fy - base[1]) * 0.72, t.z + lz * 0.7], Fk];
    tube(B, trunk, [tr * 1.55, tr * 1.08, tr * 0.95, tr * 0.82], 7, { ti, f0: 0, f1: 0.08, ph: R(), kind: bark });
    const nb = (oak ? 4 : 3) + (R() < 0.55 ? 1 : 0), a0 = R() * 6.283, csz = r * (oak ? 0.31 : 0.33);
    let ncl = 0;
    const leaf = (p, dirOut, size, flex, ph) => {
      const q = [p[0] + dirOut[0] * size * 0.35, p[1] + dirOut[1] * size * 0.35 + size * 0.15, p[2] + dirOut[2] * size * 0.35];
      addCluster(q[0], q[1], q[2], size, ti, kind, crownDepth(q, cr), flex, ph, R, keepTree && R() < 0.5); ncl++;
    };
    for (let i = 0; i < nb; i++) {
      const az = a0 + (i * 6.283) / nb + (R() - 0.5) * 0.7, phi = oak ? 0.5 + R() * 0.62 : 0.85 + R() * 0.45;
      const dir = [Math.cos(az) * Math.sin(phi), Math.cos(phi), Math.sin(az) * Math.sin(phi)];
      const reach = 0.7 + R() * 0.12;
      const E = [cr.x + dir[0] * cr.rx * reach, cr.y + dir[1] * cr.ry * reach, cr.z + dir[2] * cr.rx * reach];
      const main = curve(Fk, E, [0, 0.06 * H, 0], 4);
      const mph = R();
      const mlen = tube(B, main, [tr * 0.72, tr * 0.6, tr * 0.46, tr * 0.34, tr * 0.24], 5, { ti, f0: 0.1, f1: 0.42, ph: mph, kind: bark });
      leaf(E, dir, csz * (0.95 + R() * 0.25), 0.45, mph);
      for (const st of [0.48, 0.78]) {
        const S0 = along(main, st);
        const d2 = norm3([dir[0] + (R() - 0.5) * 1.1, dir[1] + (R() - 0.3) * 0.7, dir[2] + (R() - 0.5) * 1.1]);
        const E2 = [cr.x + d2[0] * cr.rx * 0.9, cr.y + d2[1] * cr.ry * 0.9, cr.z + d2[2] * cr.rx * 0.9];
        const sub = curve(S0, E2, [0, 0.03 * H, 0], 3), sph = R();
        tube(B, sub, [tr * 0.3, tr * 0.22, tr * 0.16, tr * 0.11], 4, { ti, f0: 0.3 + st * 0.2, f1: 0.72, ph: sph, kind: bark, v0: mlen * st });
        leaf(E2, d2, csz * (0.85 + R() * 0.25), 0.75, sph);
        const nt = 2 + (R() < 0.5 ? 1 : 0);
        for (let k = 0; k < nt; k++) {
          const d3 = norm3([d2[0] + (R() - 0.5) * 1.4, d2[1] + (R() - 0.2) * 0.9, d2[2] + (R() - 0.5) * 1.4]);
          const tl = (0.08 + R() * 0.06) * H, S1 = along(sub, 0.55 + R() * 0.35), E3 = [S1[0] + d3[0] * tl, S1[1] + d3[1] * tl, S1[2] + d3[2] * tl];
          const tph = R();
          tube(B, [S1, lerp3(S1, E3, 0.5), E3], [tr * 0.1, tr * 0.07, tr * 0.035], 3, { ti, f0: 0.7, f1: 1, ph: tph, kind: bark });
          leaf(E3, d3, csz * (0.72 + R() * 0.25), 1, tph);
        }
      }
    }
    /* fill the shell, and a few dark clusters inside */
    for (let k = 0; k < (oak ? 7 : 5); k++) {
      const az = R() * 6.283, ph2 = Math.acos(U.lerp(0.95, oak ? -0.25 : 0.1, R())), d = [Math.cos(az) * Math.sin(ph2), Math.cos(ph2), Math.sin(az) * Math.sin(ph2)];
      const rr = k < 3 ? 0.35 + R() * 0.2 : 0.68 + R() * 0.15;
      const p = [cr.x + d[0] * cr.rx * rr, cr.y + d[1] * cr.ry * rr, cr.z + d[2] * cr.rx * rr];
      addCluster(p[0], p[1], p[2], csz * (k < 3 ? 1.05 : 0.9), ti, kind, crownDepth(p, cr), 0.5, R(), R, keepTree && R() < 0.5); ncl++;
    }
    t.top = cr.y + cr.ry * 0.95;
  }

  /* birches: a tall slender white leader, short upward branches and drooping twig sprays */
  function genBirch(t, ti, B) {
    const R = U.rng(t.seed * 37 + 3), H = t.h, r = t.r;
    const cr = { x: t.x, y: t.y + 0.64 * H, z: t.z, rx: r, ry: 0.33 * H }; t.crown = cr;
    const wob = [(R() - 0.5) * 0.05 * H, (R() - 0.5) * 0.05 * H];
    const trunk = []; for (let i = 0; i <= 6; i++) { const f = i / 6, k = Math.sin(f * Math.PI * 1.3); trunk.push([t.x + wob[0] * k, t.y - 0.04 * H + f * 1.02 * H, t.z + wob[1] * k]); }
    const tr = 0.021 * H, rad = trunk.map((_, i) => tr * (i === 0 ? 1.4 : U.lerp(1, 0.18, i / 6)));
    tube(B, trunk, rad, 6, { ti, f0: 0, f1: 0.3, ph: R(), kind: 1 });
    const nb = 8 + Math.floor(R() * 3), csz = r * 0.42; let az = R() * 6.283;
    for (let i = 0; i < nb; i++) {
      az += 2.39996 + (R() - 0.5) * 0.4;
      const hf = U.lerp(0.4, 0.9, i / (nb - 1)) + (R() - 0.5) * 0.04, S0 = along(trunk, hf / 1.02);
      const lenK = 0.55 + 0.55 * (1 - Math.abs(hf - 0.6) * 1.6), Lb = r * lenK;
      const up = 0.65 + R() * 0.35, E = [S0[0] + Math.cos(az) * Lb, S0[1] + Lb * up, S0[2] + Math.sin(az) * Lb];
      const br = curve(S0, E, [0, -0.02 * H, 0], 3), bph = R();
      tube(B, br, [tr * 0.38, tr * 0.28, tr * 0.18, tr * 0.1], 4, { ti, f0: 0.25, f1: 0.65, ph: bph, kind: 1 });
      addCluster(E[0], E[1] + csz * 0.2, E[2], csz * (0.85 + R() * 0.2), ti, 1, crownDepth(E, cr), 0.7, bph, R, false);
      for (let k = 0; k < 2; k++) {
        const S1 = along(br, 0.45 + k * 0.45), a2 = az + (R() - 0.5) * 1.6, out = (0.03 + R() * 0.03) * H, drop = (0.1 + R() * 0.07) * H;
        const P1 = [S1[0] + Math.cos(a2) * out, S1[1] + 0.012 * H, S1[2] + Math.sin(a2) * out], P2 = [P1[0] + Math.cos(a2) * out * 0.5, P1[1] - drop, P1[2] + Math.sin(a2) * out * 0.5];
        const tw = [S1, P1, lerp3(P1, P2, 0.5), P2], tph = R();
        tube(B, tw, [tr * 0.1, tr * 0.07, tr * 0.05, tr * 0.03], 3, { ti, f0: 0.65, f1: 1, ph: tph, kind: 1 });
        const m = lerp3(P1, P2, 0.35);
        addCluster(m[0], m[1], m[2], csz * (0.8 + R() * 0.2), ti, 1, crownDepth(m, cr), 0.85, tph, R, false);
        addCluster(P2[0], P2[1] + csz * 0.2, P2[2], csz * (0.7 + R() * 0.2), ti, 1, crownDepth(P2, cr), 1, tph, R, false);
      }
    }
    for (let k = 0; k < 3; k++) { const p = along(trunk, 0.8 + k * 0.07); addCluster(p[0] + (R() - 0.5) * 0.05, p[1], p[2] + (R() - 0.5) * 0.05, csz * 0.85, ti, 1, 0.5, 0.4, R(), R, false); }
    t.top = t.y + 1.0 * H;
  }

  /* pines and spruces: a thin trunk, a dark core and stacked tiers of drooping, needle-fringed fronds */
  function genConifer(t, ti, B, Fr) {
    const R = U.rng(t.seed * 41 + 5), H = t.h, spruce = t.kind === 'spruce';
    const base = [t.x, t.y - 0.05 * H, t.z], topP = [t.x + (R() - 0.5) * 0.02, t.y + H, t.z + (R() - 0.5) * 0.02];
    tube(B, [base, lerp3(base, topP, 0.5), topP], [0.026 * H, 0.014 * H, 0.002], 5, { ti, f0: 0, f1: 0.25, ph: R(), kind: 3 });
    const shade = 0.85 + R() * 0.3;
    const baseCol = new THREE.Color(t.blue ? '#2c504e' : spruce ? '#1f4a2c' : '#27522c').multiplyScalar(shade);
    const col = [baseCol.r, baseCol.g, baseCol.b], core = [col[0] * 0.55, col[1] * 0.55, col[2] * 0.55];
    const hb = (spruce ? 0.1 : 0.2 + R() * 0.08) * H, rmax = t.r * (spruce ? 1.18 : 1.12), ex = spruce ? 1.0 : 0.72;
    const nT = Math.round((spruce ? 6.5 : 5) + H * (spruce ? 5.5 : 4));
    const R0 = rmax;
    /* the dark core: keeps the crown from looking hollow */
    tube(Fr, [[t.x, t.y + hb, t.z], [t.x, t.y + U.lerp(hb, H, 0.5), t.z], [t.x, t.y + H * 0.99, t.z]], [R0 * 0.42, R0 * 0.2, 0.004], 7, { ti, f0: 0.05, f1: 0.3, ph: R(), kind: -1, col: core });
    for (let i = 0; i < nT; i++) {
      const f = i / (nT - 1), yi = t.y + hb + (H * 0.97 - hb) * Math.pow(f, 0.92);
      const tf = (yi - t.y - hb) / (H - hb);
      const Rt = rmax * Math.pow(Math.max(0, 1 - tf), ex) * (0.88 + R() * 0.24) + 0.025 * H;
      const K = (spruce ? 8 : 7) + (R() < 0.5 ? 1 : 0) - (f > 0.8 ? 2 : 0), a0 = R() * 6.283;
      const droop = (spruce ? 0.5 : 0.3) * (1 - f * 0.4), lift = 0.18 + f * 0.5;
      for (let k = 0; k < K; k++) frond(Fr, t.x, yi, t.z, a0 + (k / K) * 6.283 + (R() - 0.5) * 0.35, Rt * (0.85 + R() * 0.25), droop, lift, K, ti, R(), f, col);
    }
    t.crown = { x: t.x, y: t.y + H * 0.45, z: t.z, rx: t.r, ry: H * 0.5 };
    t.top = t.y + H;
  }
  function frond(G, ox, oy, oz, ang, Lf, droop, lift, K, ti, ph, tierF, col) {
    const ca = Math.cos(ang), sa = Math.sin(ang), wmax = 0.5 * Lf * (6.283 / K) * 0.85, SEG = 4, e = 1e-3;
    const Pf = (u, v) => {
      const x = 0.006 + u * Lf, w = wmax * Math.pow(Math.max(0, Math.sin(Math.PI * (0.14 + 0.86 * u))), 0.7);
      const y = lift * Lf * u - droop * Lf * u * u - Math.abs(v) * w * 0.38, z = v * w;
      return [ox + ca * x - sa * z, oy + y, oz + sa * x + ca * z];
    };
    const base = G.vc;
    for (let i = 0; i <= SEG; i++) {
      const u = i / SEG;
      for (let j = -1; j <= 1; j++) {
        const p = Pf(u, j), du = lerp3(Pf(Math.max(0, u - e), j), Pf(Math.min(1, u + e), j), 1), a = Pf(Math.max(0, u - e), j);
        const tu = [du[0] - a[0], du[1] - a[1], du[2] - a[2]], v0 = Pf(u, Math.max(-1, j - 0.5)), v1 = Pf(u, Math.min(1, j + 0.5)), tv = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
        let nn = norm3([tu[1] * tv[2] - tu[2] * tv[1], tu[2] * tv[0] - tu[0] * tv[2], tu[0] * tv[1] - tu[1] * tv[0]]);
        if (nn[1] < 0) nn = [-nn[0], -nn[1], -nn[2]];
        /* lean the normals outward a little so the cone reads as a rounded mass */
        nn = norm3([nn[0] + ca * 0.35, nn[1], nn[2] + sa * 0.35]);
        vert(G, p[0], p[1], p[2], nn[0], nn[1], nn[2], u, j, ti, 0.15 + 0.85 * u, ph, tierF, col);
      }
    }
    for (let i = 0; i < SEG; i++) for (let j = 0; j < 2; j++) {
      const a = base + i * 3 + j, b = a + 1, c = a + 3, d = c + 1;
      /* wind each quad so its front face agrees with the (upward) normal */
      const P = G.p, ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
      const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az, wx = P[c * 3] - ax, wy = P[c * 3 + 1] - ay, wz = P[c * 3 + 2] - az;
      const fy = uz * wx - ux * wz;   /* y of (b-a) x (c-a) */
      if (fy >= 0) G.idx.push(a, b, c, b, d, c); else G.idx.push(a, c, b, b, c, d);
    }
  }

  /* ------------------------------------------------------------------ bushes */
  function placeBushes() {
    const want = Q.bushes, rnd = U.rng(77123), out = [];
    const ok = (x, z, rb) => {
      if (!T.inside(x, z, 0.22) || (x > 0 && z > 0.8)) return false;
      if (T.lakeR(x, z) < 1.28 || T.waterAt(x, z)) return false;
      if (Math.hypot(x - L.cabin.x, z - L.cabin.z) < 1.0) return false;
      if (T.pathDist(x, z) < 1.5) return false;
      const ri = T.riverInfo(x, z); if (ri.d < ri.w * 0.5 + 0.1 && ri.s < 0.97) return false;
      if (Math.abs(x - L.fall.x) < 0.6 && z < -1.3) return false;
      if (Math.hypot(x - L.pool.x, z - L.pool.z) < L.pool.r + 0.3) return false;
      if (T.up(x, z) < 0.8 || T.height(x, z) > 2.3) return false;
      for (const s of L.stones || []) if (Math.hypot(s.x - x, s.z - z) < 0.25) return false;
      for (const b of L.boulders) if (Math.hypot(b.x - x, b.z - z) < b.r * 0.85 + rb * 0.7) return false;
      for (const t of L.trees) if (Math.hypot(t.x - x, t.z - z) < 0.1 + rb) return false;
      for (const b of out) if (Math.hypot(b.x - x, b.z - z) < b.r + rb + 0.03) return false;
      return true;
    };
    const broad = L.trees.filter((t) => t.kind !== 'pine' && t.kind !== 'spruce');
    for (let guard = 0, n = 0; out.length < want && guard < 6000; guard++) {
      const cat = n % 3, rb = 0.1 + rnd() * 0.08; let x, z;
      if (cat === 0) { const t = rnd() < 0.7 && broad.length ? broad[(rnd() * broad.length) | 0] : L.trees[(rnd() * L.trees.length) | 0]; const a = rnd() * 6.283, d = t.r * (0.85 + rnd() * 0.45) + 0.04; x = t.x + Math.cos(a) * d; z = t.z + Math.sin(a) * d; }
      else if (cat === 1) { const b = L.boulders[(rnd() * L.boulders.length) | 0], a = rnd() * 6.283, d = b.r + 0.06 + rnd() * 0.14; x = b.x + Math.cos(a) * d; z = b.z + Math.sin(a) * d; }
      else if (rnd() < 0.6) { const p = T.riverAt(0.12 + rnd() * 0.8), sd = rnd() < 0.5 ? -1 : 1, o = p.w * 0.5 + 0.17 + rnd() * 0.2; x = p.x - p.tz * o * sd; z = p.z + p.tx * o * sd; }
      else { const LK = L.lake, a = 1.3 + rnd() * 2.6, k = 1.45 + rnd() * 0.2; x = LK.cx + Math.cos(a) * LK.rx * k; z = LK.cz + Math.sin(a) * (Math.sin(a) > 0 ? LK.rzFront : LK.rzBack) * k; }
      if (!ok(x, z, rb)) continue;
      out.push({ x, z, y: T.height(x, z), r: rb, h: rb * 1.25, ever: rnd() < 0.4, seed: 900 + out.length, kind: 'bush' });
      n++;
    }
    return out;
  }
  function genBush(b, ti, B) {
    const R = U.rng(b.seed * 13 + 1), kind = b.ever ? 4 : 3, n = 3 + Math.floor(R() * 3);
    b.crown = { x: b.x, y: b.y + b.h * 0.45, z: b.z, rx: b.r, ry: b.h * 0.5 };
    for (let i = 0; i < n; i++) {
      const a = R() * 6.283, d = (i === 0 ? 0 : 0.5 + R() * 0.4) * b.r, sz = b.r * (i === 0 ? 0.78 : 0.55 + R() * 0.2);
      const p = [b.x + Math.cos(a) * d, b.y + sz * (i === 0 ? 0.75 : 0.55) + R() * 0.02, b.z + Math.sin(a) * d];
      addCluster(p[0], p[1], p[2], sz, ti, kind, 0.55 + 0.45 * (d / b.r), 0.5, R(), R, !b.ever && R() < 0.25);
      if (!b.ever) tube(B, [[b.x, b.y - 0.01, b.z], lerp3([b.x, b.y, b.z], p, 0.5), [p[0], p[1] + sz * 0.3, p[2]]], [0.008, 0.005, 0.002], 3, { ti, f0: 0, f1: 0.8, ph: R(), kind: 0 });
    }
    b.top = b.y + b.h;
  }

  /* ------------------------------------------------------------------ materials */
  function barkMaterial() {
    return WG.mat.lit({
      name: 'bark', weather: true, side: THREE.DoubleSide, vertexColors: true, uniforms: { uTreeTex, uMotion },
      vertexDecl: BEND + 'attribute vec4 aTree; varying vec4 vBk; varying float vSnowL;',
      vertexWorld: 'w.xyz = treeBend(w.xyz, aTree.x, aTree.y, aTree.z, 0.0); vBk = aTree; vSnowL = tTex(aTree.x, 1).w;',
      fragDecl: 'varying vec4 vBk; varying float vSnowL;',
      frag: /* glsl */ `
        float k = vBk.w, fl = vBk.y; vec2 q = vUv;
        float n = wgNoise(vec2(q.x * 7.0, q.y * 24.0)), n2 = wgNoise(vec2(q.x * 3.0 + 5.0, q.y * 90.0));
        vec3 a;
        if (k < 0.5) { a = mix(vec3(0.05, 0.042, 0.033), vec3(0.17, 0.15, 0.12), n) * (0.8 + 0.4 * n2); a = mix(a, vec3(0.06, 0.08, 0.035), smoothstep(0.55, 0.8, wgNoise(vec2(q.x * 4.0, q.y * 8.0))) * smoothstep(0.35, 0.05, q.y) * 0.7); rough = 0.9; }
        else if (k < 1.5) {
          a = vec3(0.74, 0.73, 0.68) * (0.88 + 0.12 * n);
          float m = smoothstep(0.58, 0.64, wgNoise(vec2(q.x * 2.5, q.y * 70.0))) * smoothstep(0.3, 0.55, wgNoise(vec2(q.x * 6.0 + 2.0, q.y * 13.0)));
          a = mix(a, vec3(0.035, 0.03, 0.028), m * 0.92);
          a = mix(a, vec3(0.06, 0.055, 0.05), smoothstep(0.1, 0.0, q.y) * 0.85);
          a = mix(a, vec3(0.09, 0.055, 0.04), smoothstep(0.35, 0.7, fl));
          rough = 0.75;
        }
        else if (k < 2.5) {
          a = vec3(0.1, 0.04, 0.035) * (0.8 + 0.4 * n);
          float len = smoothstep(0.88, 0.95, fract(q.y * 48.0 + n * 0.4)) * smoothstep(0.4, 0.6, wgNoise(vec2(q.x * 6.0, q.y * 20.0)));
          a = mix(a, vec3(0.2, 0.15, 0.12), len); rough = 0.5; spec = 0.05;
        }
        else if (k < 3.5) { a = mix(vec3(0.09, 0.045, 0.028), vec3(0.2, 0.12, 0.075), n) * (0.8 + 0.35 * n2); rough = 0.88; }
        else { a = vec3(0.07, 0.05, 0.04) * (0.8 + 0.4 * n); }
        albedo = a; ao = 0.75 + 0.25 * fl; snowK = vSnowL;`,
    });
  }
  function frondMaterial() {
    return WG.mat.lit({
      name: 'fronds', weather: true, side: THREE.DoubleSide, vertexColors: true, uniforms: { uTreeTex, uMotion },
      vertexDecl: BEND + 'attribute vec4 aTree; varying vec4 vBk; varying float vSnowL;',
      vertexWorld: 'vec3 q0 = w.xyz; w.xyz = treeBend(w.xyz, aTree.x, aTree.y, aTree.z, 0.0); float ws = length(wgWindAt(q0)); w.y += sin(uTime * 2.6 + aTree.z * 6.28) * aTree.y * (0.002 + 0.006 * ws) * uMotion; vBk = aTree; vSnowL = tTex(aTree.x, 1).w;',
      fragDecl: 'varying vec4 vBk; varying float vSnowL;',
      depthFrag: 'if (vBk.w >= 0.0) { float saw = fract(vUv.x * 22.0 + abs(vUv.y) * 2.5); if (abs(vUv.y) > 0.6 + 0.4 * saw) discard; }',
      frag: /* glsl */ `
        float u = vUv.x, v = vUv.y;
        if (vBk.w >= 0.0) { float saw = fract(u * 22.0 + abs(v) * 2.5); if (abs(v) > 0.6 + 0.4 * saw) discard; }
        float nd = wgNoise(vec2(u * 46.0 + vBk.z * 31.0, v * 5.0 + vBk.z * 13.0)), nd2 = wgNoise(P.xz * 40.0 + P.y * 9.0);
        albedo = vCol * (0.7 + 0.42 * nd) * (0.85 + 0.3 * nd2);
        if (vBk.w >= 0.0) albedo *= mix(0.5, 1.05, smoothstep(0.0, 0.75, u));
        albedo = mix(albedo, ${lin('#8fae4a')}, uSeasonW.x * smoothstep(0.72, 0.97, u) * 0.6 * step(0.0, vBk.w));
        N = normalize(N + vec3(0.0, 0.15, 0.0));
        ao = mix(0.55, 1.0, smoothstep(0.0, 0.8, u)) * (vBk.w < 0.0 ? 0.6 : 1.0);
        trans = 0.28; rough = 0.72; spec = 0.035;
        /* snow in clumps on the upper sides of the branches */
        float sn = wgGround(P.xz).g * vSnowL;
        float cl = wgNoise3(P * 26.0) * 0.65 + wgNoise3(P * 61.0) * 0.35;
        float cover = smoothstep(0.78, 0.86, cl * 0.75 + sn * smoothstep(0.3, 0.85, N.y) * 0.42 * smoothstep(0.05, 0.3, u)) * step(0.03, sn);
        albedo = mix(albedo, vec3(0.88, 0.9, 0.94), cover); rough = mix(rough, 0.9, cover); trans *= 1.0 - cover;
        N = normalize(mix(N, vec3(0.0, 1.0, 0.0), cover * 0.6));
        snowK = 0.0;`,
    });
  }
  function clusterMaterial() {
    return WG.mat.lit({
      name: 'leaves', weather: true, uniforms: { uTreeTex, uMotion },
      vertexDecl: BEND + LEAF + 'attribute vec4 aLeaf; attribute vec4 aLeaf2; varying vec3 vLeafCol; varying float vPres; varying float vDepth; varying vec3 vCrownN; varying float vSnowL; varying float vSeed;',
      vertexLocal: /* glsl */ `
        float pres; vec3 lcol;
        leafState(aLeaf.w, aLeaf.y, aLeaf.z, aLeaf2.w, tTex(aLeaf.x, 3).x, pres, lcol);
        vPres = pres; vLeafCol = lcol; vSeed = aLeaf2.z;
        pos *= (0.35 + 0.65 * pres) * (1.0 + 0.36 * (wgNoise3(pos * 1.9 + aLeaf2.z * 17.0) - 0.5));
        if (pres < 0.015) pos *= 0.0;`,
      vertexWorld: /* glsl */ `
        vec4 cc = tTex(aLeaf.x, 2);
        vCrownN = normalize((w.xyz - cc.xyz) / vec3(cc.w, max(cc.w * 0.8, 0.05), cc.w) + vec3(0.0, 0.25, 0.0));
        w.xyz = treeBend(w.xyz, aLeaf.x, aLeaf2.y, aLeaf2.z, 1.0);
        vDepth = aLeaf2.x; vSnowL = tTex(aLeaf.x, 1).w;`,
      fragDecl: 'varying vec3 vLeafCol; varying float vPres; varying float vDepth; varying vec3 vCrownN; varying float vSnowL; varying float vSeed;',
      depthFrag: 'vec3 Vd = normalize(cameraPosition - vW); float ndv = abs(dot(normalize(vN), Vd)); float lf = wgNoise3(vW * 36.0 + vSeed * 9.0); if (lf < 0.2 + (1.0 - smoothstep(0.05, 0.55, ndv)) * 0.5 + (1.0 - vPres) * 0.85) discard;',
      frag: /* glsl */ `
        float ndv = abs(dot(N, V));
        float lf = wgNoise3(P * 36.0 + vSeed * 9.0);
        float cut = 0.2 + (1.0 - smoothstep(0.05, 0.55, ndv)) * 0.5 + (1.0 - vPres) * 0.85;
        if (lf < cut) discard;
        float lf2 = wgNoise3(P * 79.0 + 3.0), lf3 = wgNoise3(P * 37.0 + 11.0);
        vec3 Nc = normalize(mix(N, vCrownN, 0.62));
        N = wgBump(P, Nc, lf * 0.02 + lf2 * 0.005, 1.0);
        albedo = vLeafCol * (0.55 + 0.6 * lf3) * (0.88 + 0.24 * fract(vSeed * 13.7)) * mix(0.45, 1.0, smoothstep(cut, cut + 0.22, lf));
        ao = mix(0.25, 1.0, vDepth) * (0.42 + 0.58 * smoothstep(-0.7, 0.75, Nc.y));
        trans = 0.6; rough = 0.62; spec = 0.035; wetK = 0.8; snowK = vSnowL * 0.55;`,
      /* backlit glow: leaves lit from behind shine through, most at the crown's rim */
      fragPost: /* glsl */ `
        float vdl = max(dot(V, -uSunDir), 0.0);
        if (vdl > 0.25 && uSunCol.r + uSunCol.g > 0.01) {
          float rim = 1.0 - abs(dot(normalize(vCrownN), V));
          col += vLeafCol * uSunCol * pow(vdl, 5.0) * (0.25 + 0.9 * rim) * 1.6 * wgCloudShadow(P) * mix(1.0, wgShadow(P, normalize(vCrownN)), 0.75);
        }`,
    });
  }
  function particleMaterial() {
    return WG.mat.lit({
      name: 'leaf-fall', weather: true, side: THREE.DoubleSide,
      frag: 'albedo = vCol; trans = 0.55; rough = 0.6; spec = 0.03; snowK = 0.0; wetK = 0.6;',
      shadow: false,
    });
  }

  /* ------------------------------------------------------------------ build */
  let barkMesh = null, frondMesh = null, clusterMesh = null, partMesh = null, NT = 0, NB = 0;
  function build() {
    const B = Geo(), Fr = Geo();
    const list = L.trees || [];
    let idx = 0;
    for (const lt of list) {
      if (idx >= MAXT - 1) break;
      const t = Object.assign({}, lt, { idx, bx: 0, bz: 0, vx: 0, vz: 0, px: 0, pz: 0, shiver: 0, snowLoad: 1, shed: 0, pull: null, hfGrab: 0.6 });
      if (t.kind === 'pine' || t.kind === 'spruce') genConifer(t, idx, B, Fr);
      else if (t.kind === 'birch') genBirch(t, idx, B);
      else genSpreading(t, idx, B);
      const f = t.kind === 'pine' || t.kind === 'spruce' ? 1.5 : t.kind === 'birch' ? 1.35 + 0.5 * (1.2 - t.h) : 1.45 + 0.8 * (1.3 - t.h);
      t.w0 = f * 6.283; t.zeta = 0.085 + 0.03 * U.hash(idx, 3, 7);
      t.leanK = t.kind === 'birch' ? 0.06 : t.kind === 'oak' ? 0.042 : t.kind === 'cherry' ? 0.05 : t.kind === 'spruce' ? 0.038 : 0.034;
      setRow(idx, 0, t.x, t.y, t.z, t.h); setRow(idx, 2, t.crown.x, t.crown.y, t.crown.z, t.crown.rx);
      F.trees.push(t); idx++;
    }
    NT = idx;
    for (const b of placeBushes()) {
      if (idx >= MAXT) break;
      const t = Object.assign(b, { idx, bx: 0, bz: 0, vx: 0, vz: 0, shiver: 0, snowLoad: 1, shed: 0, w0: 2.6 * 6.283, zeta: 0.15, leanK: 0.03 });
      genBush(t, idx, B);
      setRow(idx, 0, t.x, t.y, t.z, t.h); setRow(idx, 2, t.crown.x, t.crown.y, t.crown.z, t.crown.rx);
      F.bushes.push(t); idx++;
    }
    NB = idx - NT;
    treeTex.needsUpdate = true;

    barkMesh = new THREE.Mesh(toGeometry(B), barkMaterial()); barkMesh.name = 'trees-bark';
    WG.add(barkMesh, { shadow: true, reflect: true });
    if (Fr.vc > 0) { frondMesh = new THREE.Mesh(toGeometry(Fr), frondMaterial()); frondMesh.name = 'trees-fronds'; WG.add(frondMesh, { shadow: true, reflect: true }); }

    /* leaf clusters */
    const n = CL.x.length;
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const a1 = new Float32Array(n * 4), a2 = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      a1[i * 4] = CL.ti[i]; a1[i * 4 + 1] = CL.thr[i]; a1[i * 4 + 2] = CL.thr2[i]; a1[i * 4 + 3] = CL.kind[i];
      a2[i * 4] = CL.depth[i]; a2[i * 4 + 1] = CL.flex[i]; a2[i * 4 + 2] = CL.ph[i]; a2[i * 4 + 3] = CL.keep[i];
    }
    geo.setAttribute('aLeaf', new THREE.InstancedBufferAttribute(a1, 4));
    geo.setAttribute('aLeaf2', new THREE.InstancedBufferAttribute(a2, 4));
    clusterMesh = new THREE.InstancedMesh(geo, clusterMaterial(), n); clusterMesh.name = 'trees-leaves';
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pv = new THREE.Vector3(), sv = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      e.set((U.hash(i, 1, 5) - 0.5) * 0.5, CL.rot[i], (U.hash(i, 2, 5) - 0.5) * 0.5); q.setFromEuler(e);
      m.compose(pv.set(CL.x[i], CL.y[i], CL.z[i]), q, sv.set(CL.s[i], CL.sy[i], CL.s[i])); clusterMesh.setMatrixAt(i, m);
    }
    clusterMesh.instanceMatrix.needsUpdate = true;
    WG.add(clusterMesh, { shadow: true, reflect: true });

    buildParticles();

    /* perches: exposed tree tops and sheltered spots inside the crowns */
    if (WG.perches) for (const t of F.trees) {
      const pine = t.kind === 'pine' || t.kind === 'spruce';
      WG.perches.push({ x: t.x, y: pine ? t.y + t.h * 0.985 : t.top, z: t.z, sheltered: false, kind: 'treetop', tree: t });
      const a = U.hash(t.idx, 9, 4) * 6.283, rr = pine ? t.r * 0.35 : t.r * 0.45;
      WG.perches.push({ x: t.x + Math.cos(a) * rr, y: pine ? t.y + t.h * 0.5 : t.crown.y - t.crown.ry * 0.15, z: t.z + Math.sin(a) * rr, sheltered: true, kind: 'branch', tree: t });
    }
  }

  /* ------------------------------------------------------------------ falling leaves, petals and snow puffs */
  const NP = Math.max(60, Q.leaves | 0);
  const P = { x: new Float32Array(NP), y: new Float32Array(NP), z: new Float32Array(NP), vx: new Float32Array(NP), vy: new Float32Array(NP), vz: new Float32Array(NP),
    a: new Float32Array(NP), b: new Float32Array(NP), c: new Float32Array(NP), sa: new Float32Array(NP), sb: new Float32Array(NP), life: new Float32Array(NP),
    size: new Float32Array(NP), st: new Uint8Array(NP), kind: new Uint8Array(NP) };
  let pNext = 0, pDirty = true;
  const pal = (list) => list.map((h) => new THREE.Color(h));
  const PAL = [pal(['#c8461a', '#b5301c', '#e07b1f', '#8a4e22']), pal(['#e9a92b', '#f0c24a', '#e07b1f']), pal(['#b5301c', '#c8461a', '#e07b1f']), pal(['#c8461a', '#e07b1f', '#e9a92b', '#b5301c', '#f0c24a'])];
  const PETAL = pal(['#f6dde2', '#f2cfd8', '#fbe8ec']), SNOWC = new THREE.Color('#f2f5fa');
  function buildParticles() {
    const g = new THREE.BufferGeometry();
    const v = [0, 0, -0.5, -0.3, 0.05, 0, 0, -0.03, 0, 0.3, 0.05, 0, 0, 0, 0.5];
    const pos = [], nor = [];
    const tri = (i, j, k) => { for (const q of [i, j, k]) { pos.push(v[q * 3], v[q * 3 + 1], v[q * 3 + 2]); nor.push(0, 1, 0); } };
    tri(0, 2, 1); tri(2, 4, 1); tri(0, 3, 2); tri(2, 3, 4);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2));
    partMesh = new THREE.InstancedMesh(g, particleMaterial(), NP); partMesh.name = 'trees-fall';
    const z = new THREE.Matrix4().makeScale(0, 0, 0), c = new THREE.Color(1, 1, 1);
    for (let i = 0; i < NP; i++) { partMesh.setMatrixAt(i, z); partMesh.setColorAt(i, c); }
    partMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    WG.add(partMesh, {});
  }
  /* kind 0 leaf, 1 petal, 2 snow */
  function spawn(x, y, z, vx, vy, vz, kind, col, ground) {
    let i = -1;
    for (let k = 0; k < 48; k++) { const j = (pNext + k) % NP; if (!P.st[j]) { i = j; break; } }
    if (i < 0) i = pNext;
    pNext = (i + 1) % NP;
    P.x[i] = x; P.y[i] = y; P.z[i] = z; P.vx[i] = vx; P.vy[i] = vy; P.vz[i] = vz;
    P.a[i] = Math.random() * 6.283; P.b[i] = Math.random() * 6.283; P.c[i] = Math.random() * 6.283;
    P.sa[i] = (Math.random() - 0.5) * 7; P.sb[i] = (Math.random() - 0.5) * 9;
    P.kind[i] = kind; P.st[i] = ground ? 2 : 1;
    P.size[i] = kind === 0 ? 0.04 + Math.random() * 0.016 : kind === 1 ? 0.019 + Math.random() * 0.008 : 0.011 + Math.random() * 0.01;
    P.life[i] = kind === 2 ? 6 : ground ? 15 + Math.random() * 45 : 60;
    if (ground) { P.b[i] = (Math.random() - 0.5) * 0.3; P.c[i] = (Math.random() - 0.5) * 0.3; }
    if (partMesh) partMesh.setColorAt(i, col);
    pDirty = true;
    return i;
  }
  const _w = { x: 0, z: 0 };
  /* where a cluster is now, approximately, following its tree's bend */
  function clusterPos(i, out) {
    const t = treeOf(CL.ti[i]); let x = CL.x[i], y = CL.y[i], z = CL.z[i];
    if (t) { const hf = U.clamp((y - t.y) / t.h, 0, 1.5); x += t.bx * t.h * hf * hf; z += t.bz * t.h * hf * hf; }
    const s = CL.s[i] * 0.8; out[0] = x + (Math.random() - 0.5) * s; out[1] = y + (Math.random() - 0.5) * s; out[2] = z + (Math.random() - 0.5) * s; return out;
  }
  const treeOf = (ti) => (ti < NT ? F.trees[ti] : F.bushes[ti - NT]);
  const _cp = [0, 0, 0];
  function leafFrom(i, n) {
    const k = CL.kind[i], palK = k === 4 ? 3 : Math.min(3, k);
    for (let j = 0; j < n; j++) {
      clusterPos(i, _cp); W().windAt(_cp[0], _cp[2], _w);
      spawn(_cp[0], _cp[1], _cp[2], _w.x * 0.5, -0.05, _w.z * 0.5, 0, PAL[palK][(Math.random() * PAL[palK].length) | 0], false);
    }
  }
  function petalFrom(i, n) { for (let j = 0; j < n; j++) { clusterPos(i, _cp); spawn(_cp[0], _cp[1], _cp[2], 0, 0, 0, 1, PETAL[(Math.random() * 3) | 0], false); } }
  const W = () => WG.world;

  /* the crowns of a tree shed whatever they carry: leaves in autumn, petals in blossom time, snow in winter */
  function shed(t, amount) {
    const s = WG.state.season, sw = sWrap(s), ti = t.idx;
    const autumn = sw > 1.7 && sw < 3.05, bl = t.kind === 'cherry' ? blossomK(s) : 0;
    const mine = [];
    for (let i = 0; i < CL.ti.length; i++) if (CL.ti[i] === ti && CL.prev[i] > 0.3) mine.push(i);
    if (autumn && mine.length && t.kind !== 'pine' && t.kind !== 'spruce') {
      const n = Math.round(4 + 22 * amount);
      for (let k = 0; k < n; k++) leafFrom(mine[(Math.random() * mine.length) | 0], 1);
      t.shed = Math.min(0.45, t.shed + 0.06 * amount);
    }
    if (bl > 0.15 && mine.length) { const n = Math.round((8 + 30 * amount) * bl); for (let k = 0; k < n; k++) petalFrom(mine[(Math.random() * mine.length) | 0], 1); }
    const g = WG.world.snowAt ? WG.world.snowAt(t.x, t.z) : 0;
    if (g * t.snowLoad > 0.12) {
      const n = Math.round((10 + 36 * amount) * Math.min(1, g * t.snowLoad));
      for (let k = 0; k < n; k++) {
        const a = Math.random() * 6.283, rr = Math.sqrt(Math.random()) * (t.r || 0.2), hy = t.y + t.h * (0.25 + Math.random() * 0.75);
        spawn(t.x + t.bx * t.h + Math.cos(a) * rr, hy, t.z + t.bz * t.h + Math.sin(a) * rr, (Math.random() - 0.5) * 0.3, 0.05 + Math.random() * 0.2, (Math.random() - 0.5) * 0.3, 2, SNOWC, false);
      }
      t.snowLoad = Math.max(0.15, t.snowLoad - 0.55 * amount);
    }
  }

  /* lay a carpet of fallen leaves at once when the scene opens in (or jumps to) autumn */
  function seedFallen() {
    const s = WG.state.season, sw = sWrap(s);
    if (sw < 1.8 || sw > 3.0) return;
    const broad = F.trees.filter((t) => t.kind !== 'pine' && t.kind !== 'spruce');
    if (!broad.length) return;
    const n = Math.floor(NP * 0.55 * U.smooth(1.7, 2.2, sw)), R = U.rng(4242);
    for (let k = 0; k < n; k++) {
      const t = broad[(R() * broad.length) | 0], a = R() * 6.283, rr = Math.sqrt(R()) * t.r * 1.7, x = t.x + Math.cos(a) * rr, z = t.z + Math.sin(a) * rr;
      if (!T.inside(x, z, 0.05)) continue;
      const pk = t.kind === 'birch' ? 1 : t.kind === 'cherry' ? 2 : 0, col = PAL[pk][(R() * PAL[pk].length) | 0];
      const water = T.lakeR(x, z) < 1 && T.height(x, z) < WG.state.lakeLevel;
      const i = spawn(x, water ? WG.state.lakeLevel + 0.002 : T.height(x, z) + 0.012, z, 0, 0, 0, 0, col, true);
      if (water) P.st[i] = 3;
      P.life[i] = 20 + R() * 50;
    }
  }

  const eu = new THREE.Euler(), qu = new THREE.Quaternion(), mm = new THREE.Matrix4(), pp = new THREE.Vector3(), ps = new THREE.Vector3();
  let frameN = 0;
  function updateParticles(dt) {
    const S = WG.state, Wd = WG.world, lvl = S.lakeLevel, frozen = S.ice > 0.5, t = WG.time;
    frameN++;
    let any = pDirty;
    for (let i = 0; i < NP; i++) {
      const st = P.st[i]; if (!st) continue;
      any = true;
      const kind = P.kind[i];
      P.life[i] -= dt;
      if (P.life[i] <= 0) { P.st[i] = 0; partMesh.setMatrixAt(i, mm.makeScale(0, 0, 0)); continue; }
      let x = P.x[i], y = P.y[i], z = P.z[i];
      if (st === 1) {
        Wd.windAt(x, z, _w);
        const drag = kind === 2 ? 2.6 : kind === 1 ? 2.2 : 1.5, kd = 1 - Math.exp(-drag * dt);
        P.vx[i] += (_w.x * 0.95 - P.vx[i]) * kd; P.vz[i] += (_w.z * 0.95 - P.vz[i]) * kd;
        const fall = kind === 2 ? -0.32 : kind === 1 ? -0.1 : -0.19, flut = kind === 2 ? 0 : Math.sin(t * 3.7 + i * 1.7) * (kind === 1 ? 0.08 : 0.13);
        P.vy[i] += (fall + flut - P.vy[i]) * (1 - Math.exp(-2.5 * dt));
        x += P.vx[i] * dt + (kind !== 2 ? Math.sin(t * 2.3 + i) * 0.03 * dt : 0); y += P.vy[i] * dt; z += P.vz[i] * dt;
        const sp = 1 + Math.hypot(P.vx[i], P.vz[i]);
        P.a[i] += P.sa[i] * dt * sp; P.b[i] += P.sb[i] * dt * sp; P.c[i] += P.sa[i] * 0.6 * dt * sp;
        if (x < C.X0 + 0.04) { x = C.X0 + 0.04; P.vx[i] = Math.abs(P.vx[i]) * 0.3; } else if (x > C.X1 - 0.04) { x = C.X1 - 0.04; P.vx[i] = -Math.abs(P.vx[i]) * 0.3; }
        if (z < C.Z0 + 0.04) { z = C.Z0 + 0.04; P.vz[i] = Math.abs(P.vz[i]) * 0.3; } else if (z > C.Z1 - 0.04) { z = C.Z1 - 0.04; P.vz[i] = -Math.abs(P.vz[i]) * 0.3; }
        if (y > C.Y1 - 0.15) { y = C.Y1 - 0.15; P.vy[i] = -Math.abs(P.vy[i]); }
        const g = T.height(x, z);
        if (T.lakeR(x, z) < 1.0 && g < lvl && y <= lvl + 0.003) {
          if (kind === 2) { P.st[i] = 0; partMesh.setMatrixAt(i, mm.makeScale(0, 0, 0)); continue; }
          P.st[i] = 3; y = lvl + 0.002; P.b[i] = (Math.random() - 0.5) * 0.2; P.c[i] = (Math.random() - 0.5) * 0.2; P.life[i] = kind === 1 ? 14 + Math.random() * 10 : 30 + Math.random() * 40;
        } else if (y <= g + 0.012) {
          if (kind === 2) { P.st[i] = 0; partMesh.setMatrixAt(i, mm.makeScale(0, 0, 0)); continue; }
          P.st[i] = 2; y = g + 0.012; P.b[i] = (Math.random() - 0.5) * 0.3; P.c[i] = (Math.random() - 0.5) * 0.3; P.life[i] = kind === 1 ? 8 + Math.random() * 8 : 22 + Math.random() * 35;
        }
      } else if (st === 2) {
        /* lying leaves fly up again in a strong gust (the wind tool, storms) */
        if (((i + frameN) & 3) === 0) {
          Wd.windAt(x, z, _w); const sp = Math.hypot(_w.x, _w.z);
          if (sp > 1.45 && Math.random() < (sp - 1.45) * 0.4) { P.st[i] = 1; P.vy[i] = 0.35 + Math.random() * 0.6; P.vx[i] = _w.x * 0.6; P.vz[i] = _w.z * 0.6; P.life[i] = Math.max(P.life[i], 12); }
          if (Wd.snowAt && Wd.snowAt(x, z) > 0.45) P.life[i] -= dt * 12;
        }
      } else if (st === 3) {
        if (!frozen) { Wd.windAt(x, z, _w); x += _w.x * 0.07 * dt; z += _w.z * 0.07 * dt; }
        y = lvl + 0.002 + (frozen ? 0 : Math.sin(t * 1.6 + i) * 0.0018);
        if (T.lakeR(x, z) > 1.0 || T.height(x, z) > lvl) { P.st[i] = 2; y = T.height(x, z) + 0.012; }
      }
      P.x[i] = x; P.y[i] = y; P.z[i] = z;
      const fade = P.life[i] < 2.5 ? P.life[i] / 2.5 : 1, sc = P.size[i] * fade * (P.st[i] === 1 ? 1 : 1.3);
      if (P.st[i] === 1) eu.set(P.b[i], P.a[i], P.c[i]); else eu.set(P.b[i], P.a[i], P.c[i]);
      qu.setFromEuler(eu); mm.compose(pp.set(x, y, z), qu, ps.set(sc, sc, sc * (kind === 1 ? 0.8 : 1)));
      partMesh.setMatrixAt(i, mm);
    }
    if (any) { partMesh.instanceMatrix.needsUpdate = true; if (partMesh.instanceColor) partMesh.instanceColor.needsUpdate = true; }
    pDirty = false;
  }

  /* ------------------------------------------------------------------ interaction */
  const panOf = (x, y, z) => (WG.cam && WG.cam.panOf ? WG.cam.panOf(x, y, z) : 0);
  function rayCapsule(o, d, ax, ay, az, bx, by, bz, r) {
    const ux = bx - ax, uy = by - ay, uz = bz - az, wx = o.x - ax, wy = o.y - ay, wz = o.z - az;
    const a = d.x * d.x + d.y * d.y + d.z * d.z, b = d.x * ux + d.y * uy + d.z * uz, c = ux * ux + uy * uy + uz * uz || 1e-6, dd = d.x * wx + d.y * wy + d.z * wz, e = ux * wx + uy * wy + uz * wz;
    const den = a * c - b * b;
    let s = den > 1e-9 ? U.clamp((a * e - b * dd) / den, 0, 1) : 0;
    let t = Math.max(0, (b * s - dd) / a);
    s = U.clamp((e + b * t) / c, 0, 1); t = Math.max(0, (b * s - dd) / a);
    const qx = wx + d.x * t - ux * s, qy = wy + d.y * t - uy * s, qz = wz + d.z * t - uz * s, d2 = qx * qx + qy * qy + qz * qz;
    if (d2 > r * r) return -1;
    return Math.max(0, t - Math.sqrt(r * r - d2));
  }
  F.pickTree = (o, d) => {
    let best = null, bt = 1e9;
    for (const t of F.trees) {
      const pine = t.kind === 'pine' || t.kind === 'spruce', ox = t.bx * t.h, oz = t.bz * t.h;
      let hit;
      if (pine) hit = rayCapsule(o, d, t.x, t.y + t.h * 0.18, t.z, t.x + ox * 0.8, t.y + t.h * 0.92, t.z + oz * 0.8, Math.max(0.09, t.r * 0.82));
      else {
        const cr = t.crown, k = ((cr.y - t.y) / t.h) ** 2;
        hit = rayCapsule(o, d, cr.x + ox * k, cr.y - cr.ry * 0.25, cr.z + oz * k, cr.x + ox * k, cr.y + cr.ry * 0.3, cr.z + oz * k, cr.rx * 0.95);
        const h2 = rayCapsule(o, d, t.x, t.y, t.z, cr.x + ox * k, cr.y, cr.z + oz * k, 0.06);
        if (h2 >= 0 && (hit < 0 || h2 < hit)) hit = h2;
      }
      if (hit >= 0 && hit < bt) { bt = hit; best = t; }
    }
    if (!best) return null;
    const ground = T.rayHit(o.x, o.y, o.z, d.x, d.y, d.z, true);
    if (ground >= 0 && ground < bt - 0.08) return null;
    return { tree: best, t: bt, x: o.x + d.x * bt, y: o.y + d.y * bt, z: o.z + d.z * bt };
  };
  F.grabTree = (tree, hit) => {
    if (!tree) return;
    if (F.held && F.held !== tree) F.releaseTree();
    const hx = hit ? hit.x : tree.x, hy = hit ? hit.y : tree.y + tree.h * 0.7, hz = hit ? hit.z : tree.z;
    const hf = U.clamp((hy - tree.y) / tree.h, 0.3, 1.05), k = tree.h * hf * hf;
    tree.hfGrab = hf; tree.grabY = hy; tree.anchorX = hx - tree.bx * k; tree.anchorZ = hz - tree.bz * k; tree.gx = hx; tree.gz = hz;
    tree.pull = { x: tree.bx, z: tree.bz }; tree.held = true; F.held = tree;
    tree.shiver = Math.max(tree.shiver, 0.5);
    if (WG.fauna && WG.fauna.flush) { try { WG.fauna.flush(tree.x, tree.top, tree.z); } catch (e) { /* optional */ } }
    WG.bus.emit('tree:grab', { tree, pan: panOf(tree.x, tree.top, tree.z) });
  };
  F.pullTree = (o, d) => {
    const t = F.held; if (!t || !o || !d) return;
    let nx = WG.cam && WG.cam.fwd ? WG.cam.fwd.x : d.x, nz = WG.cam && WG.cam.fwd ? WG.cam.fwd.z : d.z; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
    const den = d.x * nx + d.z * nz; if (Math.abs(den) < 1e-4) return;
    const s = ((t.gx - o.x) * nx + (t.gz - o.z) * nz) / den; if (s <= 0) return;
    const px = o.x + d.x * s, pz = o.z + d.z * s, k = t.h * t.hfGrab * t.hfGrab;
    let bx = (px - t.anchorX) / k, bz = (pz - t.anchorZ) / k; const m = Math.hypot(bx, bz), MX = t.kind === 'pine' || t.kind === 'spruce' ? 0.42 : 0.55;
    if (m > 1e-6) { const f = (MX * Math.tanh(m / MX)) / m; bx *= f; bz *= f; }
    t.pull.x = bx; t.pull.z = bz;
  };
  F.releaseTree = () => {
    const t = F.held; if (!t) return;
    F.held = null; t.held = false; t.pull = null;
    const strength = U.sat(Math.hypot(t.bx, t.bz) / 0.45);
    t.shiver = Math.max(t.shiver, 0.4 + strength);
    if (strength > 0.15) shed(t, strength);
    WG.bus.emit('tree:release', { tree: t, pan: panOf(t.x, t.top, t.z), strength });
  };
  F.flickTree = (tree, dx, dz) => {
    if (!tree) return;
    let l = Math.hypot(dx || 0, dz || 0); if (l < 1e-6) { const a = Math.random() * 6.283; dx = Math.cos(a); dz = Math.sin(a); l = 1; }
    tree.vx += (dx / l) * 1.9; tree.vz += (dz / l) * 1.9; tree.shiver = Math.max(tree.shiver, 0.9);
    shed(tree, 0.45);
    if (WG.fauna && WG.fauna.flush) { try { WG.fauna.flush(tree.x, tree.top, tree.z); } catch (e) { /* optional */ } }
    WG.bus.emit('tree:flick', { tree, pan: panOf(tree.x, tree.top, tree.z) });
  };
  F.hoverTree = (tree) => { F.hover = tree || null; };
  let lastShake = -9;
  F.shakeAt = (x, z, strength, radius) => {
    strength = strength === undefined ? 1 : strength; radius = radius || 1.2; lastShake = WG.time;
    for (const t of F.trees.concat(F.bushes)) {
      const dx = t.x - x, dz = t.z - z, d = Math.hypot(dx, dz); if (d > radius) continue;
      const f = strength * (1 - d / radius) ** 1.2, a = d > 1e-3 ? Math.atan2(dz, dx) : Math.random() * 6.283;
      t.vx += Math.cos(a) * 2.6 * f + (Math.random() - 0.5) * f; t.vz += Math.sin(a) * 2.6 * f + (Math.random() - 0.5) * f;
      t.shiver = Math.min(2.5, t.shiver + 1.4 * f);
      if (f > 0.08) shed(t, Math.min(1, f));
    }
  };
  F.tallestNear = (x, z, radius) => {
    let best = null, by = -1e9;
    for (const t of F.trees) { if (Math.hypot(t.x - x, t.z - z) > radius) continue; const top = t.y + t.h; if (top > by) { by = top; best = t; } }
    return best ? { x: best.x + best.bx * best.h, y: by, z: best.z + best.bz * best.h, tree: best } : null;
  };
  WG.bus.on('lightning', (e) => {
    if (!e || WG.time - lastShake < 0.35) return;
    if (e.target === 'tree' || e.tree) F.shakeAt(e.x, e.z, Math.min(1.5, e.power || 1), 1.35);
    else if (e.target === 'ground') F.shakeAt(e.x, e.z, 0.5 * (e.power || 1), 0.9);
  });

  /* ------------------------------------------------------------------ update */
  let ready = false, lastSeason = null, clTimer = 0, dripAcc = 0, petAcc = 0;
  const broadIdx = [], cherryIdx = [];
  function update(dt) {
    if (!ready) return;
    const S = WG.state, Wd = WG.world, s = S.season, sw = sWrap(s), time = WG.time, rm = WG.reducedMotion ? 0.4 : 1;
    if (lastSeason === null || Math.abs(U.cyc(lastSeason, s, 4)) > 0.3) seedFallen();
    lastSeason = s;
    /* springs */
    const all = F.trees.length + F.bushes.length;
    for (let j = 0; j < all; j++) {
      const t = j < F.trees.length ? F.trees[j] : F.bushes[j - F.trees.length];
      Wd.windAt(t.x, t.z, _w);
      const ws = Math.hypot(_w.x, _w.z);
      let tx = _w.x * t.leanK, tz = _w.z * t.leanK;
      const n1 = U.vnoise(time * 1.1 + t.idx * 3.7, 0.5, 4) - 0.5, n2 = U.vnoise(time * 1.3 + t.idx * 5.1, 2.5, 4) - 0.5;
      tx += n1 * ws * 0.07 * rm; tz += n2 * ws * 0.07 * rm;
      let w0 = t.w0, zeta = t.zeta;
      if (t.held && t.pull) { tx = t.pull.x; tz = t.pull.z; w0 = 9; zeta = 0.8; }
      const k = w0 * w0, c = 2 * zeta * w0, h = Math.min(dt, 0.05) / 2;
      for (let it = 0; it < 2; it++) {
        t.vx += ((tx - t.bx) * k - t.vx * c) * h; t.vz += ((tz - t.bz) * k - t.vz * c) * h;
        t.bx += t.vx * h; t.bz += t.vz * h;
      }
      const bm = Math.hypot(t.bx, t.bz); if (bm > 0.8) { t.bx *= 0.8 / bm; t.bz *= 0.8 / bm; }
      const want = t === F.hover ? 0.45 : 0;
      t.shiver += (want - t.shiver) * (1 - Math.exp(-dt * (want > t.shiver ? 6 : 1.6)));
      /* snow shaken off comes back only while it snows; a thaw resets it */
      const g = Wd.snowAt ? Wd.snowAt(t.x, t.z) : 0;
      if (g < 0.03) t.snowLoad = 1; else t.snowLoad = Math.min(1, t.snowLoad + dt * (0.004 + 0.25 * S.snowing));
      if (sw < 1.6 || sw > 3.2) t.shed = Math.max(0, t.shed - dt * 0.2);
      setRow(t.idx, 1, t.bx, t.bz, t.shiver * rm, t.snowLoad); setRow(t.idx, 3, t.shed, 0, 0, 0);
    }
    treeTex.needsUpdate = true;

    /* leaves leave one at a time: watch every cluster's presence and drop a few leaves where one goes */
    clTimer += dt;
    if (clTimer > 0.1) {
      clTimer = 0;
      const falling = sw > 1.7 && sw < 3.25;
      for (let i = 0; i < CL.x.length; i++) {
        const t = treeOf(CL.ti[i]); const p = leafPres(CL.kind[i], CL.thr[i], CL.keep[i], t ? t.shed : 0, s);
        if (falling && CL.prev[i] > 0.4 && p <= 0.4) leafFrom(i, 2 + ((Math.random() * 2) | 0));
        CL.prev[i] = p;
      }
    }
    /* autumn drizzle of single leaves, more in wind; petals drifting in blossom time */
    const wsp = S.wind.speed;
    if (sw > 1.7 && sw < 3.0 && broadIdx.length) {
      dripAcc += dt * (2 + 8 * wsp) * (NP / 380) * U.smooth(1.7, 1.95, sw);
      while (dripAcc > 1) { dripAcc -= 1; const i = broadIdx[(Math.random() * broadIdx.length) | 0]; if (CL.prev[i] > 0.5) leafFrom(i, 1); }
    } else dripAcc = 0;
    const bl = blossomK(s);
    if (bl > 0.1 && cherryIdx.length) {
      petAcc += dt * (1.2 + 6 * wsp) * bl * (NP / 380);
      while (petAcc > 1) { petAcc -= 1; petalFrom(cherryIdx[(Math.random() * cherryIdx.length) | 0], 1); }
    } else petAcc = 0;
    updateParticles(Math.min(dt, 0.05));
  }

  WG.register('trees', {
    init() {
      build();
      for (let i = 0; i < CL.x.length; i++) { if (CL.kind[i] <= 3) broadIdx.push(i); if (CL.kind[i] === 2) cherryIdx.push(i); }
      ready = true;
    },
    update,
  });
})();
