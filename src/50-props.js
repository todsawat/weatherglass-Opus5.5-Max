/* Weatherglass — props: the log cabin and its yard, chimney smoke and lit windows, the jetty, the rowing boat,
   the six boulders, the scattered stones, the stepping stones and the wet boulders round the plunge pool. */
(function () {
  'use strict';
  const WG = window.WG, THREE = WG.THREE, U = WG.util, C = WG.C, T = WG.terrain, L = WG.layout, Q = WG.Q;
  const V3 = THREE.Vector3, M4 = THREE.Matrix4, Quat = THREE.Quaternion, Eul = THREE.Euler, Col = THREE.Color;
  const W = WG.world;
  const props = (WG.props = { boat: { rock() {} }, chimneyTop: { x: L.cabin.x, y: 1.4, z: L.cabin.z }, rocks: [], glow: 0, stoke: 0 });

  /* ================================================================ geometry merging */
  const _v = new V3(), _n3 = new THREE.Matrix3(), _q = new Quat(), _e = new Eul(), _s = new V3(), _p = new V3();
  function trs(x, y, z, rx, ry, rz, sx, sy, sz) {
    _e.set(rx || 0, ry || 0, rz || 0, 'YXZ'); _q.setFromEuler(_e);
    return new M4().compose(_p.set(x, y, z), _q, _s.set(sx === undefined ? 1 : sx, sy === undefined ? sx === undefined ? 1 : sx : sy, sz === undefined ? sx === undefined ? 1 : sx : sz));
  }
  const mul = (a, b) => new M4().multiplyMatrices(a, b);
  const ni = (g) => (g.index ? g._ni || (g._ni = g.toNonIndexed()) : g);
  class Merge {
    constructor() { this.p = []; this.n = []; this.c = []; this.uv = []; this.k = []; }
    /* add a geometry under matrix m with colour col and kind vector k = [kind, a, b, shelter]; cylinder caps (groups > 0) may take capCol / capK */
    add(geo, m, col, k, capCol, capK) {
      const g = ni(geo), pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
      _n3.getNormalMatrix(m);
      const groups = g.groups.length ? g.groups : [{ start: 0, count: pos.count, materialIndex: 0 }];
      for (const gr of groups) {
        const cap = gr.materialIndex > 0 && capK, cc = cap ? capCol || col : col, kk = cap ? capK : k;
        const end = Math.min(pos.count, gr.start + gr.count);
        for (let i = gr.start; i < end; i++) {
          _v.fromBufferAttribute(pos, i).applyMatrix4(m); this.p.push(_v.x, _v.y, _v.z);
          _v.fromBufferAttribute(nor, i).applyMatrix3(_n3).normalize(); this.n.push(_v.x, _v.y, _v.z);
          this.c.push(cc.r, cc.g, cc.b);
          if (uv) this.uv.push(uv.getX(i), uv.getY(i)); else this.uv.push(0, 0);
          this.k.push(kk[0], kk[1] || 0, kk[2] || 0, kk[3] || 0);
        }
      }
    }
    build() {
      const g = new THREE.BufferGeometry(), F = THREE.Float32BufferAttribute;
      g.setAttribute('position', new F(this.p, 3)); g.setAttribute('normal', new F(this.n, 3)); g.setAttribute('color', new F(this.c, 3));
      g.setAttribute('uv', new F(this.uv, 2)); g.setAttribute('aK', new F(this.k, 4));
      return g;
    }
  }
  const BOX = new THREE.BoxGeometry(1, 1, 1);
  const CYL = {}; const cyl = (n) => CYL[n] || (CYL[n] = new THREE.CylinderGeometry(1, 1, 1, n, 1));
  const ICO0 = new THREE.IcosahedronGeometry(1, 0), ICO1 = new THREE.IcosahedronGeometry(1, 1);
  const hex = (h) => new Col(h);
  const tint = (c, f) => c.clone().multiplyScalar(f);
  const cut = (segs, a, b) => { const out = []; for (const [s, e] of segs) { if (b <= s || a >= e) { out.push([s, e]); continue; } if (a > s) out.push([s, a]); if (b < e) out.push([b, e]); } return out; };

  /* ================================================================ materials */
  const uGlow = { value: 0 }, uLamp = { value: 0 }, uLampPos = { value: new V3() };
  const PROP_DECL = /* glsl */ `
    varying vec4 vK; varying vec3 vLoc; uniform float uGlow; uniform float uLamp; uniform vec3 uLampPos;
    float pVor(vec2 sp, out vec2 id){ vec2 ip = floor(sp), fp = fract(sp); float d1 = 9.0, d2 = 9.0; id = ip;
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec2 o = vec2(float(i), float(j)); vec2 r = o + wgHash2(ip + o) * 0.8 + 0.1 - fp; float d = dot(r, r);
        if (d < d1) { d2 = d1; d1 = d; id = ip + o; } else if (d < d2) d2 = d; }
      return sqrt(d2) - sqrt(d1); }`;
  const PROP_FRAG = /* glsl */ `
    int k = int(vK.x + 0.5);
    float shel = vK.w; wetK = 1.0 - shel; snowK = 1.0 - shel;
    vec2 uv = vUv; float nA = wgNoise(P.xz * 160.0 + P.y * 57.0);
    rough = 0.85; spec = 0.035;
    if (k == 1) {                         /* round log with bark */
      float Ln = max(vK.y, 0.02);
      float st = wgNoise(vec2(uv.x * 26.0 + vK.z * 9.0, uv.y * Ln * 34.0)), st2 = wgNoise(vec2(uv.x * 71.0 + vK.z * 5.0, uv.y * Ln * 95.0));
      float knot = smoothstep(0.8, 0.93, wgNoise(vec2(uv.x * 6.0 + vK.z * 3.0, uv.y * Ln * 14.0)));
      albedo *= (0.72 + 0.36 * st + 0.16 * st2) * (1.0 - 0.45 * knot);
      N = wgBump(P, N, st * 0.0012 + st2 * 0.0006 - knot * 0.0008, 1.0);
      rough = 0.78;
    } else if (k == 2) {                  /* end grain of a sawn or split log */
      vec2 c = uv - 0.5; float r = length(c) * 2.0;
      float ring = 0.5 + 0.5 * sin(r * 30.0 + wgNoise(uv * 9.0 + vK.z * 7.0) * 2.5);
      vec3 wood = mix(vec3(0.3, 0.2, 0.1), vec3(0.6, 0.45, 0.27), 0.55 + 0.45 * ring) * albedo;
      albedo = mix(wood, vec3(0.13, 0.085, 0.05), smoothstep(0.8, 0.95, r));
      rough = 0.9;
    } else if (k == 3) {                  /* cedar shingles: tabs in staggered rows, moss on the shaded slope */
      float Ln = max(vK.y, 0.05); float x = uv.x * Ln / 0.026 + vK.z * 7.3;
      float rs = floor(vK.z * 97.0), id = floor(x), f = fract(x);
      /* irregular tab widths: some joints are missing, so two tabs read as one wide shingle */
      float skip = step(wgHash(vec2(id, rs + 11.0)), 0.35), skipN = step(wgHash(vec2(id + 1.0, rs + 11.0)), 0.35);
      float h = wgHash(vec2(id - skip, rs));
      vec3 ced = mix(vec3(0.14, 0.12, 0.1), vec3(0.33, 0.285, 0.24), h) * albedo;
      ced *= 0.8 + 0.32 * wgNoise(vec2(x * 4.0, uv.y * 22.0));
      float gap = (1.0 - smoothstep(0.0, 0.07, f)) * (1.0 - skip) + (1.0 - smoothstep(1.0, 0.93, f)) * (1.0 - skipN);
      ced *= 1.0 - 0.7 * gap;
      float moss = smoothstep(0.12, 0.42, N.z) * smoothstep(0.66, 0.84, wgNoise(P.xz * 26.0 + 3.0) * 0.6 + wgNoise(P.xz * 95.0) * 0.4 + vK.z * 0.1);
      ced = mix(ced, vec3(0.075, 0.12, 0.035) * (0.75 + 0.5 * nA), moss * 0.85);
      albedo = ced; rough = mix(0.8, 0.95, moss);
      N = wgBump(P, N, -gap * 0.0012, 1.0);
    } else if (k == 4 || k == 5) {        /* boards and planks (5: painted) */
      float cnt = max(vK.y, 1.0); float x = (vK.z > 0.5 ? uv.y : uv.x) * cnt, along = vK.z > 0.5 ? uv.x : uv.y;
      float id = floor(x), f = fract(x), h = wgHash(vec2(id, 7.0 + cnt));
      albedo *= (0.84 + 0.28 * h) * (0.86 + 0.24 * wgNoise(vec2(x * 3.0, along * 36.0)));
      float seam = 1.0 - smoothstep(0.0, 0.07, f) * smoothstep(1.0, 0.93, f);
      albedo *= 1.0 - 0.55 * seam;
      N = wgBump(P, N, -seam * 0.0006, 1.0);
      if (k == 5) { rough = 0.58; spec = 0.045; albedo *= 0.9 + 0.2 * nA; }
    } else if (k == 6) {                  /* cream painted trim */
      albedo *= 0.93 + 0.1 * nA; rough = 0.55; spec = 0.045;
    } else if (k == 7) {                  /* window glass, with curtains, a pot plant and the warm room behind */
      vec2 q = uv; float wi = vK.y;
      float curt = max(smoothstep(0.32, 0.22, q.x), smoothstep(0.68, 0.78, q.x));
      float folds = 0.75 + 0.25 * sin(q.x * 90.0);
      float plant = 0.0;
      if (wi < 0.5) {
        float pot = step(abs(q.x - 0.5), 0.085 - (0.22 - q.y) * 0.12) * step(q.y, 0.22) * step(0.03, q.y);
        vec2 lp = (q - vec2(0.5, 0.36)) * vec2(1.0, 1.25);
        float leaves = smoothstep(0.17, 0.12, length(lp) + (wgNoise(q * 26.0) - 0.5) * 0.12) * step(0.2, q.y);
        plant = max(pot, leaves);
      }
      albedo = mix(vec3(0.014, 0.017, 0.02), vec3(0.3, 0.1, 0.06) * folds, curt * 0.45);
      rough = 0.07; spec = 0.06; wetK = 0.0; snowK = 0.0;
      float fl = 0.86 + 0.07 * sin(uTime * 7.3 + vK.z * 5.0) + 0.07 * sin(uTime * 12.7 + vK.z * 2.0) * sin(uTime * 2.3 + vK.z);
      vec3 room = vec3(1.0, 0.3, 0.085) * mix(1.0, 0.5 * folds, curt);
      room *= 0.7 + 0.55 * smoothstep(0.75, 0.0, length(q - vec2(0.5, 0.32)));
      room *= 1.0 - 0.88 * plant;
      emissive += room * uGlow * fl * 2.25;
    } else if (k == 8) {                  /* black iron */
      rough = 0.42; metal = 0.55; spec = 0.05; albedo *= 0.85 + 0.3 * nA;
    } else if (k == 9) {                  /* fieldstone masonry (vK.y: height of the sooty top, vK.z: 1 on the chimney) */
      vec3 an = abs(N); vec2 tg = normalize(vec2(-N.z, N.x) + vec2(1e-4, 0.0));
      vec2 sp = an.y > 0.7 ? P.xz * 46.0 : vec2(dot(P.xz, tg) * 46.0, P.y * 58.0);
      vec2 id; float edge = pVor(sp, id);
      float h = wgHash(id), h2 = wgHash(id + 7.3);
      vec3 stc = mix(vec3(0.2, 0.195, 0.185), vec3(0.4, 0.37, 0.33), h);
      stc = mix(stc, vec3(0.38, 0.3, 0.2), step(0.68, h2) * 0.7);
      float mortar = smoothstep(0.1, 0.03, edge);
      albedo = mix(stc * (0.82 + 0.3 * wgNoise(sp * 2.7)), vec3(0.14, 0.135, 0.125), mortar);
      N = wgBump(P, N, (1.0 - mortar) * smoothstep(0.0, 0.3, edge) * 0.003, 1.0);
      float soot = smoothstep(vK.y - 0.16, vK.y - 0.01, P.y) * step(0.5, vK.z);
      albedo = mix(albedo, vec3(0.025, 0.022, 0.02), soot * 0.88);
      rough = 0.82;
    } else if (k == 10) {                 /* petals and leaves */
      rough = 0.6; trans = 0.35;
    } else if (k == 11) {                 /* weathered silver-grey wood (vK.y 1: pile with an algae band at the waterline) */
      float along = vK.z > 0.5 ? uv.y : uv.x, across = vK.z > 0.5 ? uv.x : uv.y;
      float g1 = wgNoise(vec2(across * 34.0 + vK.y * 3.0, along * 3.0)), g2 = wgNoise(vec2(across * 110.0, along * 9.0));
      albedo *= 0.78 + 0.3 * g1 + 0.12 * g2;
      N = wgBump(P, N, g1 * 0.0007, 1.0);
      rough = 0.86;
      if (vK.y > 0.5) {
        float dy = P.y - uLake.x;
        float band = smoothstep(0.034, 0.012, dy) * smoothstep(-0.06, -0.012, dy);
        float under = smoothstep(-0.004, -0.03, dy);
        albedo = mix(albedo, vec3(0.03, 0.06, 0.022) * (0.75 + 0.5 * g2), band);
        albedo = mix(albedo, albedo * vec3(0.35, 0.42, 0.3), under);
        rough = mix(rough, 0.32, max(band, under));
      }
    } else if (k == 12) {                 /* rope */
      albedo *= 0.72 + 0.34 * (0.5 + 0.5 * sin(uv.x * 18.85 + uv.y * 260.0)); rough = 0.92;
    } else if (k == 13) {                 /* the boat's hull: dark green above the waterline, red-brown below */
      float wl = 0.021 + 0.001 * sin(vLoc.x * 50.0);
      vec3 green = vec3(0.046, 0.147, 0.112), red = vec3(0.2, 0.06, 0.032);
      albedo = vLoc.y > wl ? green : red;
      albedo = mix(albedo, vec3(0.6, 0.57, 0.5), smoothstep(0.0012, 0.0, abs(vLoc.y - wl - 0.0015)) * 0.6);
      albedo *= (0.86 + 0.24 * wgNoise(vLoc.xy * 260.0)) * (1.0 - 0.2 * smoothstep(0.82, 1.0, fract(vLoc.y * 110.0)));
      rough = 0.5; spec = 0.05;
    } else if (k == 14) {                 /* pale wood: the boat's inside, seats, oars */
      albedo *= 0.84 + 0.24 * wgNoise(vec2(vLoc.x * 22.0, vLoc.y * 260.0 + vLoc.z * 260.0)); rough = 0.7;
    } else if (k == 15) {                 /* the lantern's glass */
      albedo = vec3(0.2, 0.15, 0.08); rough = 0.2; spec = 0.05; wetK = 0.0; snowK = 0.0;
      emissive += vec3(1.0, 0.6, 0.26) * uLamp * 5.0;
    } else if (k == 16) {                 /* barrel staves */
      float f = fract(uv.x * 16.0); albedo *= (0.8 + 0.3 * wgHash(vec2(floor(uv.x * 16.0), 3.0))) * (0.85 + 0.2 * wgNoise(vec2(uv.x * 70.0, uv.y * 8.0)));
      albedo *= 1.0 - 0.5 * (1.0 - smoothstep(0.0, 0.1, f) * smoothstep(1.0, 0.9, f)); rough = 0.8;
    } else if (k == 17) {                 /* dark still water, soot */
      albedo = vec3(0.012, 0.015, 0.017); rough = 0.08; spec = 0.05;
    } else if (k == 18) {                 /* loose stones */
      albedo *= 0.8 + 0.35 * nA; rough = 0.78;
    } else {
      albedo *= 0.94 + 0.1 * nA; rough = 0.92;
    }`;
  const PROP_POST = /* glsl */ `
    if (uLamp > 0.001 && k != 15) {
      vec3 ld = uLampPos - P; float dl = length(ld);
      float lk = uLamp * (max(dot(N, ld / max(dl, 1e-4)), 0.0) * 0.75 + 0.25) / (1.0 + dl * dl * 520.0);
      col += albedo * vec3(1.0, 0.52, 0.2) * lk * 3.0;
    }`;
  let propMat = null;
  function makePropMat() {
    return WG.mat.lit({
      name: 'props', vertexColors: true, weather: true, side: THREE.DoubleSide,
      uniforms: { uGlow, uLamp, uLampPos },
      vertexDecl: 'attribute vec4 aK; varying vec4 vK; varying vec3 vLoc;',
      vertexLocal: 'vK = aK; vLoc = pos;',
      fragDecl: PROP_DECL, frag: PROP_FRAG, fragPost: PROP_POST,
    });
  }
  /* rocks: chiselled grey stone, lichen on top, moss on the damp sides, cracks; vR = (moss, always wet, lichen, seed) */
  function makeRockMat(scale) {
    return WG.mat.lit({
      name: 'props-rock', vertexColors: true, weather: true,
      uniforms: { uRS: { value: scale } },
      vertexDecl: 'attribute vec4 aR; varying vec4 vR; varying vec3 vLoc;',
      vertexLocal: 'vR = aR; vLoc = pos;',
      fragDecl: 'varying vec4 vR; varying vec3 vLoc; uniform float uRS;',
      frag: /* glsl */ `
        vec3 q = vLoc * uRS + vR.w * 13.7;
        float n1 = wgNoise3(q), n2 = wgNoise3(q * 3.1 + 5.0), n3 = wgNoise3(q * 9.3 + 2.0);
        vec3 c = vCol * (0.76 + 0.32 * n1 + 0.14 * n2 + 0.1 * n3);
        c = mix(c, c * vec3(1.1, 1.0, 0.88), smoothstep(0.55, 0.78, wgNoise3(q * 0.7 + 3.0)));
        float cn = wgNoise3(q * 1.6 + 11.0), cn2 = wgNoise3(q * 3.4 + 21.0);
        float crack = max(smoothstep(0.03, 0.0, abs(cn - 0.5)), smoothstep(0.022, 0.0, abs(cn2 - 0.5)) * 0.7);
        c *= 1.0 - 0.6 * crack;
        float lich = smoothstep(0.66, 0.72, wgNoise3(q * 7.3 + 7.0) * 0.75 + n3 * 0.25) * smoothstep(0.2, 0.7, N.y) * vR.z;
        c = mix(c, vec3(0.58, 0.58, 0.46) * (0.85 + 0.3 * n3), lich * 0.65);
        float damp = clamp(0.5 - 0.5 * N.y + 0.32 * N.z + 0.45 * smoothstep(0.85, 1.0, vR.x), 0.0, 1.0);
        float moss = smoothstep(0.42, 0.62, wgNoise3(q * 2.3 + 3.0) * 0.55 + damp * 0.62) * min(vR.x * 1.15, 1.0);
        c = mix(c, vec3(0.07, 0.13, 0.035) * (0.75 + 0.5 * n3), moss);
        albedo = c; rough = mix(0.74, 0.92, moss); spec = 0.04;
        N = wgBump(P, N, (n2 * 0.6 + n3 * 0.4) * 0.0012 - crack * 0.0012, 1.0);
        albedo *= mix(1.0, 0.5, vR.y); rough = mix(rough, 0.2, vR.y); spec = mix(spec, 0.07, vR.y);`,
    });
  }

  /* ================================================================ the cabin, its yard, the jetty (one merged mesh) */
  const CB = L.cabin, LEN = CB.len, DEP = CB.dep, HL = LEN / 2, HD = DEP / 2;
  const R0 = 0.025, SP = 0.058, Y0 = 0.035, EXT = 0.035;
  const PITCH = (40 * Math.PI) / 180, TANP = Math.tan(PITCH), COSP = Math.cos(PITCH), SINP = Math.sin(PITCH);
  const WALLTOP = Y0 + R0 + 5 * SP + R0;           // top of the front and back logs
  const YR = WALLTOP + HD * TANP;                  // underside of the roof at the ridge
  const OVX = 0.065, OVB = 0.06, PORCH = 0.16;
  const RLEN = LEN + 2 * OVX;
  const cabM = trs(CB.x, CB.padY, CB.z, 0, CB.rot, 0);
  const toWorld = (x, y, z) => new V3(x, y, z).applyMatrix4(cabM);
  const groundLocal = (lx, lz) => { const w = toWorld(lx, 0, lz); return T.height(w.x, w.z) - CB.padY; };
  const WALLS = {
    front: { ry: 0, ox: 0, oz: HD, half: HL, ends: false, shel: 0.85 },
    back: { ry: Math.PI, ox: 0, oz: -HD, half: HL, ends: false, shel: 0.3 },
    right: { ry: Math.PI / 2, ox: HL, oz: 0, half: HD, ends: true, shel: 0.35 },
    left: { ry: -Math.PI / 2, ox: -HL, oz: 0, half: HD, ends: true, shel: 0.35 },
  };
  const OPEN = {
    front: [{ t: 0.07, w: 0.1, y0: Y0, y1: 0.208, door: true }, { t: -0.17, w: 0.11, y0: 0.115, y1: 0.207, idx: 0 }],
    right: [{ t: 0, w: 0.1, y0: 0.125, y1: 0.212, idx: 1 }],
    back: [{ t: -0.12, w: 0.1, y0: 0.12, y1: 0.207, idx: 2 }],
    left: [{ t: 0.14, w: 0.066, y0: 0.15, y1: 0.212, idx: 3 }],
  };
  const CHIM = { x: -(HL + EXT + 0.046), top: 0.695 };
  const lanternLocal = new V3(0.158, 0.232, HD + 0.043);
  const perchLocal = [];

  function buildCabin(M, SN) {
    const rnd = U.rng(7311);
    const at = (m) => mul(cabM, m);
    const wallM = (w, t, y, n, rx, ry, rz, sx, sy, sz) => at(mul(trs(w.ox, 0, w.oz, 0, w.ry, 0), trs(t, y, n, rx, ry, rz, sx, sy, sz)));
    const LOG = [hex(0x8a6440), hex(0x9c7650), hex(0x765435), hex(0x82603e), hex(0x6c4c31)];
    const logCol = () => tint(LOG[(rnd() * LOG.length) | 0], 0.9 + rnd() * 0.2);
    const endCol = () => tint(hex(0xd9c3a0), 0.75 + rnd() * 0.3);
    const CHINK = hex(0xcfc4ab), TRIM = hex(0xe4dcc6), IRON = hex(0x1b1a19), BOARD = hex(0x6b5038), GREYW = hex(0x8c877e);

    /* ---- log walls, chinking, openings ---- */
    for (const key in WALLS) {
      const w = WALLS[key], ops = OPEN[key], nC = w.ends ? 5 : 6;
      for (let i = 0; i < nC; i++) {
        const yc = Y0 + R0 + (i + (w.ends ? 0.5 : 0)) * SP;
        let segs = [[-w.half - EXT - rnd() * 0.008, w.half + EXT + rnd() * 0.008]];
        for (const o of ops) if (yc > o.y0 - R0 * 0.6 && yc < o.y1 + R0 * 0.6) segs = cut(segs, o.t - o.w / 2 - 0.003, o.t + o.w / 2 + 0.003);
        const r = R0 * (0.92 + rnd() * 0.12), c = logCol(), ec = endCol();
        for (const [a, b] of segs) if (b - a > 0.008) M.add(cyl(10), wallM(w, (a + b) / 2, yc, (rnd() - 0.5) * 0.003, 0, 0, Math.PI / 2, r, b - a, r), c, [1, b - a, rnd(), w.shel], ec, [2, 0, rnd(), w.shel]);
      }
      if (w.ends) M.add(cyl(8), wallM(w, 0, Y0 + 0.014, 0, 0, 0, Math.PI / 2, 0.015, DEP, 0.015), LOG[2], [1, DEP, rnd(), w.shel], endCol(), [2, 0, rnd(), w.shel]);
      /* chinking slab, with holes for the openings */
      const top = w.ends ? Y0 + R0 + 4.5 * SP : Y0 + R0 + 5 * SP, holes = ops.map((o) => ({ a: o.t - o.w / 2, b: o.t + o.w / 2, y0: o.y0, y1: o.y1 }));
      const xs = [-w.half, w.half]; for (const h of holes) xs.push(h.a, h.b); xs.sort((a, b) => a - b);
      for (let i = 0; i < xs.length - 1; i++) {
        const a = xs[i], b = xs[i + 1]; if (b - a < 1e-4) continue; const mid = (a + b) / 2;
        let ys = [[Y0, top]]; for (const h of holes) if (mid > h.a && mid < h.b) ys = cut(ys, h.y0, h.y1);
        for (const [c0, d0] of ys) if (d0 - c0 > 1e-4) M.add(BOX, wallM(w, mid, (c0 + d0) / 2, 0, 0, 0, 0, b - a, d0 - c0, 0.032), CHINK, [0, 0, 0, w.shel]);
      }
      /* openings */
      for (const o of ops) {
        const tw = 0.011, dd = 0.03, nC2 = 0.012, h = o.y1 - o.y0, mid = (o.y0 + o.y1) / 2, sh = key === 'front' ? 1 : w.shel;
        const frame = o.door ? tint(BOARD, 0.8) : TRIM, fk = o.door ? [4, 1, 0, sh] : [6, 0, 0, sh];
        for (const s of [-1, 1]) M.add(BOX, wallM(w, o.t + s * (o.w / 2 + tw / 2 - 0.002), mid + (o.door ? 0 : 0), nC2, 0, 0, 0, tw, h + (o.door ? 0.004 : 2 * tw), dd), frame, fk);
        M.add(BOX, wallM(w, o.t, o.y1 + tw / 2 - 0.002, nC2, 0, 0, 0, o.w + 2 * tw, tw, dd), frame, fk);
        if (o.door) {
          M.add(BOX, wallM(w, o.t, mid, 0.0, 0, 0, 0, o.w - 0.004, h, 0.012), hex(0x7a2c22), [5, 4, 0, 1]);
          for (const hy of [Y0 + 0.035, o.y1 - 0.035]) M.add(BOX, wallM(w, o.t - o.w / 2 + 0.03, hy, 0.0072, 0, 0, 0, 0.056, 0.0065, 0.0025), IRON, [8, 0, 0, 1]);
          M.add(ICO0, wallM(w, o.t + o.w / 2 - 0.016, 0.112, 0.009, 0, 0, 0, 0.0042, 0.0042, 0.0042), hex(0x2a2826), [8, 0, 0, 1]);
          continue;
        }
        M.add(BOX, wallM(w, o.t, o.y0 - tw / 2 + 0.002, nC2 + 0.006, 0, 0, 0, o.w + 2 * tw + 0.012, tw * 0.9, dd + 0.012), TRIM, [6, 0, 0, sh]);
        M.add(BOX, wallM(w, o.t, mid, -0.002, 0, 0, 0, o.w, h, 0.004), hex(0x101214), [7, o.idx, o.idx * 1.7 + 0.3, 1]);
        M.add(BOX, wallM(w, o.t, mid, 0.0015, 0, 0, 0, 0.0038, h, 0.006), TRIM, [6, 0, 0, sh]);
        M.add(BOX, wallM(w, o.t, mid, 0.0015, 0, 0, 0, o.w, 0.0038, 0.006), TRIM, [6, 0, 0, sh]);
        if (o.idx === 0 || o.idx === 1) {   /* shutters, opened back */
          const sw = o.w * 0.5 + 0.003;
          for (const s of [-1, 1]) M.add(BOX, wallM(w, o.t + s * (o.w / 2 + tw + sw / 2 + 0.001), mid, 0.03 + 0.004, 0, s * 0.22, 0, sw, h + 0.012, 0.005), tint(hex(0x3c5e48), 0.9 + rnd() * 0.2), [5, 3, 0, sh]);
        }
        if (o.idx === 0) {                  /* flower box */
          const fy = o.y0 - 0.022;
          M.add(BOX, wallM(w, o.t, fy, 0.045, 0, 0, 0, o.w + 0.03, 0.022, 0.026), hex(0x5a3a22), [4, 2, 1, 1]);
          M.add(BOX, wallM(w, o.t, fy + 0.0105, 0.045, 0, 0, 0, o.w + 0.024, 0.003, 0.02), hex(0x22180f), [18, 0, 0, 1]);
          const FL = [hex(0xc8352a), hex(0xe68fae), hex(0xf2eee4), hex(0xe9862a), hex(0xd2445c)];
          for (let i = 0; i < 16; i++) M.add(ICO0, wallM(w, o.t + (rnd() - 0.5) * (o.w + 0.016), fy + 0.017 + rnd() * 0.012, 0.038 + rnd() * 0.016, rnd() * 3, rnd() * 3, 0, 0.0055 + rnd() * 0.002), FL[(rnd() * FL.length) | 0], [10, 0, 0, 1]);
          for (let i = 0; i < 12; i++) M.add(ICO0, wallM(w, o.t + (rnd() - 0.5) * (o.w + 0.02), fy + 0.013 + rnd() * 0.006, 0.036 + rnd() * 0.02, rnd() * 3, rnd() * 3, 0, 0.006), tint(hex(0x3f6b2c), 0.8 + rnd() * 0.4), [10, 0, 0, 1]);
          perchLocal.push({ p: new V3(o.t + 0.04, fy + 0.012, HD + 0.045 + 0.012), sheltered: true, kind: 'eave' });
        }
      }
    }
    /* ---- gable ends: vertical boards ---- */
    {
      const gb = Y0 + R0 + 4.5 * SP - 0.008, e = HD + 0.012, sh = new THREE.Shape();
      sh.moveTo(-e, gb); sh.lineTo(e, gb); sh.lineTo(e, YR - e * TANP - 0.004); sh.lineTo(0, YR - 0.004); sh.lineTo(-e, YR - e * TANP - 0.004); sh.closePath();
      const gg = new THREE.ExtrudeGeometry(sh, { depth: 0.018, bevelEnabled: false });
      for (const s of [-1, 1]) M.add(gg, at(trs(s * HL - 0.009, 0, 0, 0, Math.PI / 2, 0)), tint(BOARD, 0.95), [4, 22, 0, 0.45]);
    }
    /* ---- footing: fieldstone ---- */
    const footK = [9, 0, 0, 0.3];
    M.add(BOX, at(trs(0, Y0 / 2 - 0.022, HD, 0, 0, 0, LEN + 0.07, Y0 + 0.044, 0.056)), hex(0xffffff), footK);
    M.add(BOX, at(trs(0, Y0 / 2 - 0.022, -HD, 0, 0, 0, LEN + 0.07, Y0 + 0.044, 0.056)), hex(0xffffff), footK);
    for (const s of [-1, 1]) M.add(BOX, at(trs(s * HL, Y0 / 2 - 0.022, 0, 0, 0, 0, 0.056, Y0 + 0.044, DEP)), hex(0xffffff), footK);
    const STONES = [hex(0x8a8780), hex(0x9b9284), hex(0x6f6c68), hex(0xa59a86), hex(0x7d7469)];
    const stone = () => tint(STONES[(rnd() * STONES.length) | 0], 0.85 + rnd() * 0.3);
    for (let i = 0; i < 46; i++) {
      const side = i % 4, f = rnd() * 2 - 1, r = 0.011 + rnd() * 0.008;
      let x, z; if (side < 2) { x = f * (HL + 0.03); z = (side ? -1 : 1) * (HD + 0.026); } else { x = (side === 2 ? -1 : 1) * (HL + 0.026); z = f * HD; }
      if (side === 0 && x > -0.36 && x < 0.36) continue;   // under the porch deck
      M.add(ICO0, at(trs(x, 0.006 + rnd() * 0.02, z, rnd() * 3, rnd() * 3, rnd() * 3, r * 1.25, r * 0.8, r)), stone(), [18, 0, 0, 0.2]);
    }
    /* ---- the chimney: fieldstone stack outside the left end, sooty top ---- */
    const chTopW = toWorld(CHIM.x, CHIM.top, 0).y, chK = [9, chTopW, 1, 0.1];
    M.add(BOX, at(trs(CHIM.x, 0.15, 0, 0, 0, 0, 0.092, 0.37, 0.165)), hex(0xffffff), chK);
    M.add(BOX, at(trs(CHIM.x - 0.004, 0.36, 0, 0, 0, 0, 0.082, 0.05, 0.12)), hex(0xffffff), chK);
    M.add(BOX, at(trs(CHIM.x - 0.006, (0.385 + CHIM.top) / 2, 0, 0, 0, 0, 0.07, CHIM.top - 0.385, 0.088)), hex(0xffffff), chK);
    M.add(BOX, at(trs(CHIM.x - 0.006, CHIM.top + 0.005, 0, 0, 0, 0, 0.084, 0.012, 0.1)), tint(hex(0x5a5550), 0.8), [9, chTopW, 1, 0]);
    M.add(BOX, at(trs(CHIM.x - 0.006, CHIM.top + 0.0115, 0, 0, 0, 0, 0.042, 0.002, 0.05)), hex(0x050505), [17, 0, 0, 1]);
    for (let i = 0; i < 18; i++) {
      const y = rnd() * (CHIM.top - 0.02), wide = y < 0.33, hx = wide ? 0.046 : 0.035, hz = wide ? 0.082 : 0.044;
      const sx = rnd() < 0.5 ? -1 : 1, sz = rnd() < 0.5 ? -1 : 1, r = 0.009 + rnd() * 0.006;
      M.add(ICO0, at(trs(CHIM.x - 0.004 + sx * hx * (0.85 + rnd() * 0.2), y, sz * hz * (0.85 + rnd() * 0.2), rnd() * 3, rnd() * 3, 0, r * 1.3, r * 0.75, r)), stone(), [18, 0, 0, 0.1]);
    }
    /* ---- roof: stepped rows of cedar shingles on both slopes, ridge boards, barge boards ---- */
    const ROW = 0.044, OVL = 0.016, TH = 0.0065, TAU = (3.4 * Math.PI) / 180;
    for (const sgn of [1, -1]) {
      const horiz = sgn > 0 ? HD + PORCH : HD + OVB, Sl = horiz / COSP, nRows = Math.ceil(Sl / ROW);
      for (let j = 0; j < nRows; j++) {
        const lo = Sl - j * ROW, hi = Math.max(0, lo - ROW - OVL), sc = (lo + hi) / 2, wd = lo - hi, off = TH / 2 + 0.0012;
        const y = YR - SINP * sc + COSP * off, z = sgn * (COSP * sc + SINP * off);
        M.add(BOX, at(trs((rnd() - 0.5) * 0.004, y, z, sgn * (PITCH - TAU), 0, 0, RLEN, TH, wd)), tint(hex(0xffffff), 0.92 + rnd() * 0.16), [3, RLEN, rnd(), 0]);
      }
      for (const s of [-1, 1]) M.add(BOX, at(trs(s * (RLEN / 2 + 0.003), YR - SINP * Sl / 2 - COSP * 0.002, sgn * (COSP * Sl / 2 - SINP * 0.002), sgn * PITCH, 0, 0, 0.008, 0.024, Sl)), tint(BOARD, 0.8), [4, 1, 0, 0.2]);
      M.add(BOX, at(trs(0, YR - SINP * 0.017 + COSP * (TH + 0.005), sgn * (COSP * 0.017 + SINP * (TH + 0.005)), sgn * PITCH, 0, 0, RLEN + 0.012, 0.006, 0.036)), GREYW, [11, 0, 0, 0]);
      /* snow blanket over this slope (hidden under the shingles until snow lies) */
      const nu = 26, nv = Math.ceil(Sl / 0.025) + 1, base = SN.p.length / 3, nrm = new V3(0, COSP, sgn * SINP).applyMatrix3(new THREE.Matrix3().setFromMatrix4(cabM)).normalize();
      for (let jv = 0; jv <= nv; jv++) for (let iu = 0; iu <= nu; iu++) {
        const x = (iu / nu - 0.5) * (RLEN + 0.004), s = (jv / nv) * (Sl + 0.006), h = TH + 0.003;
        const p = toWorld(x, YR - SINP * s + COSP * h, sgn * (COSP * s + SINP * h));
        const edge = Math.max(U.smooth(Sl - 0.03, Sl + 0.006, s), U.smooth(RLEN / 2 - 0.03, RLEN / 2, Math.abs(x)) * 0.6);
        SN.p.push(p.x, p.y, p.z); SN.n.push(nrm.x, nrm.y, nrm.z); SN.a.push(0, 0, 0, 1 + edge);
      }
      for (let jv = 0; jv < nv; jv++) for (let iu = 0; iu < nu; iu++) { const a = base + jv * (nu + 1) + iu, b = a + 1, c = a + nu + 1, d = c + 1; SN.i.push(a, c, b, b, c, d); }
    }
    /* ---- porch: deck, posts, beam ---- */
    const pz0 = HD + 0.02, pz1 = HD + PORCH - 0.006;
    M.add(BOX, at(trs(0, Y0 - 0.006, (pz0 + pz1) / 2, 0, 0, 0, LEN - 0.01, 0.02, pz1 - pz0)), hex(0x77685a), [4, 5, 1, 1]);
    const postZ = HD + PORCH - 0.026, eaveY = YR - postZ * TANP - 0.004;
    for (const s of [-1, 1]) M.add(cyl(8), at(trs(s * (HL - 0.022), (Y0 + 0.004 + eaveY - 0.014) / 2, postZ, (rnd() - 0.5) * 0.04, 0, (rnd() - 0.5) * 0.04, 0.0085, eaveY - 0.014 - Y0, 0.0085)), LOG[0], [1, 0.2, rnd(), 0.9], endCol(), [2, 0, rnd(), 0.9]);
    M.add(BOX, at(trs(0, eaveY - 0.012, postZ, 0, 0, 0, LEN + 0.02, 0.016, 0.017)), LOG[3], [4, 1, 0, 0.9]);
    perchLocal.push({ p: new V3(-HL + 0.05, eaveY - 0.0035, postZ), sheltered: true, kind: 'eave' }, { p: new V3(HL - 0.12, eaveY - 0.0035, postZ), sheltered: true, kind: 'eave' });
    /* door step */
    M.add(BOX, at(trs(0.07, Y0 - 0.026, HD + PORCH + 0.026, 0, 0.04, 0, 0.13, 0.024, 0.05)), hex(0xffffff), [9, 0, 0, 0]);
    /* ---- firewood stacked beside the door ---- */
    {
      const fw = WALLS.front;
      for (let row = 0; row < 4; row++) for (let i = 0; i < 6 - (row >> 1); i++) {
        const t = 0.175 + i * 0.023 + (row & 1) * 0.011, y = Y0 + 0.016 + row * 0.019, r = 0.0105 + rnd() * 0.002;
        M.add(cyl(3), mul(wallM(fw, t, y, 0.06, Math.PI / 2, 0, 0), trs(0, 0, 0, 0, rnd() * 6, 0, r, 0.05 + rnd() * 0.006, r)), tint(hex(0xa07c52), 0.85 + rnd() * 0.3), [1, 0.05, rnd(), 1], endCol(), [2, 0, rnd(), 1]);
      }
      perchLocal.push({ p: new V3(0.23, Y0 + 3 * 0.019 + 0.03, HD + 0.06), sheltered: true, kind: 'eave' });
    }
    /* ---- lantern on the wall above the woodpile ---- */
    {
      const lp = lanternLocal;
      M.add(BOX, at(trs(lp.x, lp.y + 0.018, HD + 0.03, 0, 0, 0, 0.004, 0.004, 0.03)), IRON, [8, 0, 0, 1]);
      M.add(BOX, at(trs(lp.x, lp.y, lp.z, 0, 0, 0, 0.012, 0.017, 0.012)), hex(0xffffff), [15, 0, 0, 1]);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) M.add(BOX, at(trs(lp.x + sx * 0.0068, lp.y, lp.z + sz * 0.0068, 0, 0, 0, 0.0022, 0.019, 0.0022)), IRON, [8, 0, 0, 1]);
      M.add(cyl(4), at(trs(lp.x, lp.y + 0.012, lp.z, 0, Math.PI / 4, 0, 0.011, 0.006, 0.011)), IRON, [8, 0, 0, 1]);
      M.add(BOX, at(trs(lp.x, lp.y - 0.0105, lp.z, 0, 0, 0, 0.016, 0.003, 0.016)), IRON, [8, 0, 0, 1]);
    }
    /* ---- the yard: chopping block with an axe, split logs, rain barrel, rail fence ---- */
    const capAt = (lx, ly, lz, rx, ry, rz, ry2) => addCap(SN, toWorld(lx, ly, lz), rx, ry, rz, CB.rot + (ry2 || 0));
    {
      const bx = -0.13, bz = 0.6, gy = groundLocal(bx, bz), hb = 0.034;
      M.add(cyl(12), at(trs(bx, gy + hb / 2 - 0.003, bz, 0, 0, 0, 0.03, hb, 0.03)), tint(LOG[2], 0.9), [1, 0.1, 0.3, 0], hex(0xd8c09a), [2, 0, 0.6, 0]);
      const yT = gy + hb - 0.003, a = (38 * Math.PI) / 180;
      M.add(BOX, at(trs(bx + 0.004, yT + 0.002, bz, 0, 0.5, 0.18, 0.022, 0.014, 0.0035)), hex(0x3a3a3c), [8, 0, 0, 0]);
      const hx = bx + 0.004 + Math.sin(a) * 0.036 * Math.cos(0.5), hz = bz - Math.sin(a) * 0.036 * Math.sin(0.5);
      M.add(cyl(6), at(trs(hx, yT + 0.002 + Math.cos(a) * 0.036, hz, 0, 0.5, -a, 0.0026, 0.074, 0.0026)), hex(0xb08c5e), [14, 0, 0, 0]);
      capAt(bx, yT + 0.001, bz, 0.03, 0.012, 0.03);
      for (let i = 0; i < 4; i++) {
        const ang = rnd() * 6.28, d = 0.05 + rnd() * 0.04, x = bx + Math.cos(ang) * d, z = bz + Math.sin(ang) * d, r = 0.011 + rnd() * 0.003;
        M.add(cyl(3), at(trs(x, groundLocal(x, z) + r * 0.45, z, rnd() * 6, rnd() * 6.28, Math.PI / 2, r, 0.042, r)), tint(hex(0xb48d5c), 0.85 + rnd() * 0.25), [14, 0, 0, 0], hex(0xd8c09a), [2, 0, rnd(), 0]);
      }
    }
    {
      const bx = HL + 0.052, bz = HD + 0.105, gy = groundLocal(bx, bz), hb = 0.075, r = 0.034;
      M.add(cyl(16), at(trs(bx, gy + hb / 2 - 0.003, bz, 0, 0, 0, r, hb, r)), hex(0x6e4a2c), [16, 0, 0, 0], hex(0xffffff), [17, 0, 0, 0]);
      for (const hy of [0.013, 0.058]) M.add(cyl(16), at(trs(bx, gy + hy, bz, 0, 0, 0, r + 0.0018, 0.0055, r + 0.0018)), IRON, [8, 0, 0, 0]);
      capAt(bx, gy + hb - 0.004, bz, r * 1.02, 0.014, r * 1.02);
    }
    /* fence: six crooked posts curving round the chimney end, two rails between each pair */
    {
      const posts = [];
      for (let i = 0; i < 6; i++) {
        const ph = ((122 + i * 23.5 + (rnd() - 0.5) * 6) * Math.PI) / 180, R = 0.6 + (rnd() - 0.5) * 0.05;
        const x = Math.cos(ph) * R - 0.04, z = Math.sin(ph) * R, gy = groundLocal(x, z), h = 0.125 + (rnd() - 0.5) * 0.02, lx = (rnd() - 0.5) * 0.12, lz = (rnd() - 0.5) * 0.12;
        M.add(cyl(6), at(trs(x, gy + h / 2 - 0.01, z, lx, rnd() * 3, lz, 0.0105, h + 0.02, 0.0105)), tint(GREYW, 0.85 + rnd() * 0.25), [11, 0, 1, 0], hex(0x9a9286), [2, 0, rnd(), 0]);
        const top = new V3(x - Math.sin(lz) * h * 0.5, gy + h + 0.0, z + Math.sin(lx) * h * 0.5);
        posts.push({ x, z, gy, top });
        capAt(top.x, top.y - 0.001, top.z, 0.012, 0.008, 0.012);
        perchLocal.push({ p: top.clone().setY(top.y + 0.002), sheltered: false, kind: 'fence' });
      }
      for (let i = 0; i < 5; i++) {
        const a = posts[i], b = posts[i + 1];
        for (const rh of [0.045, 0.095]) {
          const ya = a.gy + rh + (rnd() - 0.5) * 0.016, yb = b.gy + rh + (rnd() - 0.5) * 0.016, dx = b.x - a.x, dz = b.z - a.z, dy = yb - ya, len = Math.hypot(dx, dy, dz) + 0.03;
          const m = new M4().makeBasis(new V3(), new V3(), new V3());
          const dir = new V3(dx, dy, dz).normalize(), q = new Quat().setFromUnitVectors(new V3(0, 1, 0), dir);
          m.compose(new V3((a.x + b.x) / 2, (ya + yb) / 2, (a.z + b.z) / 2), q, new V3(0.0065, len, 0.0065));
          M.add(cyl(5), at(m), tint(GREYW, 0.8 + rnd() * 0.3), [11, 0, 1, 0], hex(0x9a9286), [2, 0, rnd(), 0]);
          if (rh > 0.07) addCapAlong(SN, toWorld((a.x + b.x) / 2, (ya + yb) / 2 + 0.005, (a.z + b.z) / 2), toWorld(dx, dy, dz).sub(toWorld(0, 0, 0)), len * 0.92);
        }
      }
    }
    /* perches on the ridge and the chimney */
    for (const x of [-0.22, 0.04, 0.27]) perchLocal.push({ p: new V3(x, YR + TH + 0.016, 0), sheltered: false, kind: 'ridge' });
    perchLocal.push({ p: new V3(CHIM.x - 0.006, CHIM.top + 0.012, 0.03), sheltered: false, kind: 'chimney' });
  }

  /* ---- snow caps: a dome over a point that grows with the snow lying there (aSn.w 0), or a blanket that lifts along its normal (aSn.w >= 1) ---- */
  const DOME = new THREE.SphereGeometry(1, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  function addCap(SN, base, rx, ry, rz, yaw) {
    const g = ni(DOME), p = g.attributes.position, n = g.attributes.normal, m = trs(base.x, base.y, base.z, 0, yaw || 0, 0, rx, ry, rz), nm = new THREE.Matrix3().getNormalMatrix(m), b0 = SN.p.length / 3;
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i); const wob = 1 + 0.12 * Math.sin(_v.x * 7 + _v.z * 5 + base.x * 40); _v.y *= wob; _v.applyMatrix4(m); SN.p.push(_v.x, _v.y, _v.z);
      _v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); SN.n.push(_v.x, _v.y, _v.z); SN.a.push(base.x, base.y, base.z, 0); SN.i.push(b0 + i);
    }
  }
  function addCapAlong(SN, mid, dir, len) {
    const d = dir.clone(); d.y = 0; const yaw = Math.atan2(-d.z, d.x);
    addCap(SN, mid, len / 2, 0.006, 0.0075, yaw);
  }
  function makeSnowMesh(SN) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(SN.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(SN.n, 3));
    g.setAttribute('aSn', new THREE.Float32BufferAttribute(SN.a, 4)); g.setIndex(SN.i);
    const mat = WG.mat.lit({
      name: 'props-snow', shadow: false,
      vertexDecl: 'attribute vec4 aSn; varying float vSn;',
      vertexLocal: /* glsl */ `
        vec2 sxz = aSn.w < 0.5 ? aSn.xz : pos.xz;
        float sn = texture2D(uGroundTex, wgUV(sxz)).g; vSn = sn;
        if (aSn.w < 0.5) { float s = smoothstep(0.06, 0.5, sn); pos = aSn.xyz + (pos - aSn.xyz) * vec3(s, s * (0.5 + 0.5 * s), s); }
        else {
          float lump = wgNoise(pos.xz * 16.0 + 1.7) * 0.6 + wgNoise(pos.xz * 37.0 + 3.0) * 0.3 + wgNoise(pos.xz * 70.0) * 0.1;
          float th = smoothstep(0.04, 0.55, sn) * (0.016 + 0.026 * lump);
          float e = aSn.w - 1.0;
          pos += nrm * (th - 0.006) * (1.0 - 0.35 * e);
          pos.y -= e * th * 0.55;
        }`,
      fragDecl: 'varying float vSn;',
      frag: /* glsl */ `
        if (vSn < 0.05) discard;
        float n = wgNoise(P.xz * 140.0 + P.y * 40.0);
        albedo = vec3(0.88, 0.9, 0.94) * (0.94 + 0.08 * n); rough = 0.82; spec = 0.03;
        N = wgBump(P, N, n * 0.0015, 1.0);
        float gl = wgHash(floor(P.xz * 300.0) + floor(dot(V, vec3(7.0, 3.0, 5.0)) * 5.0));
        emissive += step(0.994, gl) * uSunCol * 1.5 * max(dot(N, uSunDir), 0.0);`,
    });
    return new THREE.Mesh(g, mat);
  }

  /* ================================================================ jetty */
  const J = L.jetty, DECK = 0.37, JYAW = Math.atan2(-J.dz, J.dx);
  const jettyM = trs(J.x0, 0, J.z0, 0, JYAW, 0);
  const jW = (x, y, z) => new V3(x, y, z).applyMatrix4(jettyM);
  const PILE_X = [0.07, 0.34, 0.6, J.len - 0.035], PILE_Z = 0.074, POST_UP = 0.075;
  const mooring = [];
  function buildJetty(M) {
    const rnd = U.rng(5521), at = (m) => mul(jettyM, m);
    const GREYS = [hex(0x9a958c), hex(0x8b867d), hex(0xa8a299), hex(0x7d786f), hex(0x928a7e)];
    const n = Math.round(J.len / 0.031);
    for (let i = 0; i < n; i++) {
      const x = ((i + 0.5) / n) * J.len;
      M.add(BOX, at(trs(x + (rnd() - 0.5) * 0.002, DECK - 0.003 + (rnd() - 0.5) * 0.0016, (rnd() - 0.5) * 0.006, (rnd() - 0.5) * 0.03, (rnd() - 0.5) * 0.04, 0, 0.027, 0.006, J.width + (rnd() - 0.5) * 0.01)), tint(GREYS[(rnd() * 5) | 0], 0.88 + rnd() * 0.2), [11, 0, 1, 0]);
    }
    for (const s of [-1, 1]) M.add(BOX, at(trs(J.len / 2, DECK - 0.013, s * 0.058, 0, 0, 0, J.len, 0.013, 0.013)), tint(GREYS[3], 0.85), [11, 0, 0, 0]);
    for (const x of PILE_X) M.add(BOX, at(trs(x, DECK - 0.022, 0, 0, 0, 0, 0.012, 0.012, 2 * PILE_Z + 0.02)), tint(GREYS[3], 0.8), [11, 0, 0, 0]);
    PILE_X.forEach((x, pi) => {
      const last = pi === PILE_X.length - 1;
      for (const s of [-1, 1]) {
        const z = s * PILE_Z, w = jW(x, 0, z), gy = T.height(w.x, w.z), y0 = Math.min(gy - 0.08, C.LAKE - 0.15), y1 = DECK - 0.004 + (last ? POST_UP : 0), r = last ? 0.0125 : 0.011;
        M.add(cyl(9), at(trs(x, (y0 + y1) / 2, z, (rnd() - 0.5) * 0.02, rnd() * 3, (rnd() - 0.5) * 0.02, r, y1 - y0, r)), tint(GREYS[(rnd() * 5) | 0], 0.85 + rnd() * 0.2), [11, 1, 1, 0], hex(0xb3aa9c), [2, 0, rnd(), 0]);
        if (last) { const top = jW(x, y1 + 0.002, z); mooring.push(top); }
      }
      if (pi > 0) {   /* cross-braces between the pair */
        const ya = Math.max(C.LAKE - 0.03, T.height(jW(x, 0, 0).x, jW(x, 0, 0).z) + 0.02), yb = DECK - 0.03, dz = 2 * PILE_Z, len = Math.hypot(dz, yb - ya) + 0.01, ang = Math.atan2(yb - ya, dz);
        for (const s of [-1, 1]) M.add(BOX, at(trs(x + s * 0.013, (ya + yb) / 2, 0, s * ang, 0, 0, 0.004, 0.009, len)), tint(GREYS[1], 0.8), [11, 1, 0, 0]);
      }
    });
    /* fieldstone abutment at the shore */
    { const w = jW(0.0, 0, 0), gy = T.height(w.x, w.z); M.add(BOX, at(trs(0.0, (gy - 0.04 + DECK - 0.018) / 2, 0, 0, 0, 0, 0.05, DECK - 0.018 - gy + 0.04, J.width + 0.02)), hex(0xffffff), [9, 0, 0, 0]); }
    /* a coil of rope on the deck */
    const TOR = new THREE.TorusGeometry(1, 0.2, 5, 18);
    for (let i = 0; i < 3; i++) { const r = 0.017 - i * 0.0035; M.add(TOR, at(trs(J.len - 0.13, DECK + 0.0035 + i * 0.0045, 0.035, Math.PI / 2, 0, i * 0.5, r, r, r * 0.9)), hex(0xb39a6c), [12, 0, 0, 0]); }
    for (const m of mooring) WG.perches.push({ x: m.x, y: m.y + 0.002, z: m.z, sheltered: false, kind: 'post' });
  }

  /* ================================================================ boat */
  const BL = L.boat.len, BW = 0.118, BD = 0.05;
  const hwB = (u) => (u < 0.45 ? (BW / 2) * (0.7 + 0.3 * U.smooth(0, 0.45, u)) : (BW / 2) * Math.pow(Math.max(0, 1 - Math.pow((u - 0.45) / 0.55, 2)), 0.62));
  const gyB = (u) => BD * (1 + 0.34 * Math.pow(U.smooth(0.45, 1, u), 1.6) + 0.07 * U.smooth(0.25, 0, u));
  const kyB = (u) => 0.026 * Math.pow(U.smooth(0.55, 1, u), 2) + 0.006 * U.smooth(0.3, 0, u);
  function hullPt(u, th, inset) {
    const h = Math.max(hwB(u) - inset, 0), s = Math.sin(th), c = Math.cos(th);
    const lat = h * Math.sign(s) * Math.pow(Math.abs(s), 0.5), k0 = kyB(u) + inset * 1.2, g = gyB(u);
    return [(u - 0.5) * BL, k0 + (g - k0) * Math.pow(1 - c, 0.8), lat];
  }
  function gridGeo(nu, nv, f) {
    const pos = [], idx = [];
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) pos.push(...f(i / nu, j / nv));
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = i * (nv + 1) + j, b = a + 1, c = a + nv + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
    return g;
  }
  function buildBoat() {
    const M = new Merge(), I = new M4(), rnd = U.rng(881);
    M.add(gridGeo(22, 12, (u, v) => hullPt(u, -Math.PI / 2 + v * Math.PI, 0)), I, hex(0xffffff), [13, 0, 0, 0]);
    M.add(gridGeo(22, 12, (u, v) => hullPt(u, -Math.PI / 2 + v * Math.PI, 0.0045)), I, hex(0xc9a87c), [14, 0, 0, 0]);
    for (const s of [-1, 1]) M.add(gridGeo(22, 1, (u, v) => { const o = hullPt(u, s * Math.PI / 2, v * 0.0045); return [o[0], o[1] + 0.0018, o[2]]; }), I, hex(0x5e4630), [14, 0, 0, 0]);
    /* transom */
    { const pts = []; for (let j = 0; j <= 12; j++) pts.push(hullPt(0, -Math.PI / 2 + (j / 12) * Math.PI, 0)); const cy = (kyB(0) + gyB(0)) / 2, pos = [];
      for (let j = 0; j < 12; j++) pos.push(pts[j][0], pts[j][1], pts[j][2], pts[j + 1][0], pts[j + 1][1], pts[j + 1][2], -BL / 2, cy, 0);
      pos.push(pts[12][0], pts[12][1], pts[12][2], pts[0][0], pts[0][1], pts[0][2], -BL / 2, cy, 0);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); M.add(g, I, hex(0xffffff), [13, 0, 0, 0]); }
    /* seats, floorboards, oars, bow ring */
    for (const u of [0.22, 0.5, 0.77]) { const y = gyB(u) * 0.74, w = 2 * (hwB(u) * 0.92 - 0.004); M.add(BOX, trs((u - 0.5) * BL, y, 0, 0, 0, 0, 0.022, 0.0045, w), hex(0xb8956a), [14, 0, 0, 0]); }
    M.add(BOX, trs(-0.01, kyB(0.5) + 0.0085, 0, 0, 0, 0, BL * 0.62, 0.0025, 0.034), hex(0xa58058), [14, 0, 0, 0]);
    for (const s of [-1, 1]) {
      const z = s * 0.021, y = gyB(0.5) * 0.74 + 0.006, yaw = s * 0.035;
      M.add(cyl(6), trs(0.005, y, z, 0, yaw, Math.PI / 2, 0.0032, 0.25, 0.0032), hex(0xd5b78c), [14, 0, 0, 0]);
      M.add(BOX, trs(-0.118, y - 0.0005, z - s * 0.002, 0, yaw, 0, 0.068, 0.0022, 0.016), hex(0xd5b78c), [14, 0, 0, 0]);
      M.add(BOX, trs(0, gyB(0.5) + 0.003, s * (hwB(0.5) - 0.002), 0, 0, 0, 0.006, 0.006, 0.004), hex(0x222222), [8, 0, 0, 0]);
    }
    M.add(new THREE.TorusGeometry(1, 0.25, 4, 10), trs(BL / 2 - 0.008, gyB(0.98) + 0.004, 0, 0, Math.PI / 2, 0, 0.0055), hex(0x2a2a2a), [8, 0, 0, 0]);
    return M.build();
  }

  /* ================================================================ rocks */
  function rockGeo(seed, detail, cuts, sx, sy, sz, flatTop, rough) {
    const g = new THREE.IcosahedronGeometry(1, detail), p = g.attributes.position, r = U.rng(seed), planes = [];
    for (let i = 0; i < cuts; i++) { const th = r() * 6.283, cy = r() * 1.5 - 0.5, sq = Math.sqrt(1 - cy * cy); planes.push([Math.cos(th) * sq, cy, Math.sin(th) * sq, 0.64 + r() * 0.26]); }
    if (flatTop) planes.push([0, 1, 0, flatTop]);
    const off = (seed % 97) * 0.731;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = 1 + rough * (U.vnoise3(x * 1.6 + off, y * 1.6, z * 1.6, seed & 255) - 0.5) * 2 + rough * 0.45 * (U.vnoise3(x * 4.1 + off, y * 4.1, z * 4.1, (seed + 7) & 255) - 0.5) * 2;
      x *= n; y *= n; z *= n;
      for (const pl of planes) { const e = x * pl[0] + y * pl[1] + z * pl[2] - pl[3]; if (e > 0) { x -= pl[0] * e; y -= pl[1] * e; z -= pl[2] * e; } }
      p.setXYZ(i, x * sx, y * sy, z * sz);
    }
    g.computeVertexNormals();
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(p.count * 3).fill(1), 3));
    return g;
  }
  const ROCKC = [0x8b8882, 0x7f7c76, 0x938c80, 0x86857f, 0x8f8a84, 0x7a7771, 0x9a948a, 0x84796c].map(hex);
  function placeRocks() {
    const rnd = U.rng(424242), list = [];
    const Lk = L.lake, POOL = L.pool, FALL = L.fall, jet = L.jetty;
    const cabinD = (x, z) => Math.hypot(x - CB.x, z - CB.z);
    const segD = (x, z, ax, az, bx, bz) => { const vx = bx - ax, vz = bz - az, wx = x - ax, wz = z - az, t = U.sat((wx * vx + wz * vz) / (vx * vx + vz * vz)); return Math.hypot(wx - vx * t, wz - vz * t); };
    const wet = (x, z) => { if (T.height(x, z) < C.LAKE + 0.006 && T.lakeR(x, z) < 1.6) return true; if (Math.hypot(x - POOL.x, z - POOL.z) < POOL.r * 1.02) return true; const ri = T.riverInfo(x, z); return ri.d < ri.w * 0.5 + 0.015 && ri.s < 0.95 && z > FALL.zLip + 0.15; };
    const free = (x, z, r) => {
      if (!T.inside(x, z, 0.12 + r)) return false;
      if (wet(x, z) || T.pathDist(x, z) < 0.85 + r * 6 || cabinD(x, z) < 0.88) return false;
      if (segD(x, z, jet.x0 - 0.2 * jet.dx, jet.z0 - 0.2 * jet.dz, jet.x1, jet.z1) < 0.16 + r) return false;
      if (Math.hypot(x - L.boat.x, z - L.boat.z) < 0.3) return false;
      for (const t of L.trees) if (Math.hypot(x - t.x, z - t.z) < 0.07 + r) return false;
      for (const b of L.boulders) if (Math.hypot(x - b.x, z - b.z) < b.r * 1.05 + r) return false;
      for (const s of L.stones) if (Math.hypot(x - s.x, z - s.z) < s.r + r + 0.02) return false;
      for (const o of list) if (Math.hypot(x - o.x, z - o.z) < (o.r + r) * 0.9) return false;
      return true;
    };
    const add = (x, z, r, o) => {
      const sunk = o.sunk === undefined ? 0.3 : o.sunk, sy = o.sy || 0.75;
      let gy = T.height(x, z); for (let k = 0; k < 4; k++) gy = Math.min(gy, T.height(x + Math.cos(k * 1.57) * r * 0.8, z + Math.sin(k * 1.57) * r * 0.8));
      const y = o.y !== undefined ? o.y : gy - r * sy * sunk;
      const c = tint(ROCKC[(rnd() * ROCKC.length) | 0], 0.85 + rnd() * 0.25);
      list.push({ x, y, z, r, sx: r * (0.85 + rnd() * 0.35), sy: r * sy * (0.8 + rnd() * 0.3), sz: r * (0.85 + rnd() * 0.35), ry: rnd() * 6.283, tx: (rnd() - 0.5) * 0.3, tz: (rnd() - 0.5) * 0.3, c, moss: o.moss !== undefined ? o.moss : 0.35 + rnd() * 0.4, wet: o.wet || 0, lich: o.lich !== undefined ? o.lich : 0.6 + rnd() * 0.4, seed: rnd() * 50, fam: o.fam !== undefined ? o.fam : (rnd() * 3) | 0 });
    };
    /* pebbles beside the big boulders */
    for (const b of L.boulders) for (let i = 0; i < 3; i++) for (let g = 0; g < 20; g++) { const a = rnd() * 6.283, d = b.r * (1.08 + rnd() * 0.5), x = b.x + Math.cos(a) * d, z = b.z + Math.sin(a) * d, r = 0.02 + rnd() * 0.03; if (!free(x, z, r)) continue; add(x, z, r, {}); break; }
    /* wet mossy boulders ringing the plunge pool */
    const outA = Math.atan2(L.river.pts[6].z - POOL.z, L.river.pts[6].x - POOL.x);
    for (let i = 0; i < 9; i++) {
      const a = ((-35 + i * 31 + (rnd() - 0.5) * 10) * Math.PI) / 180; if (Math.abs(U.cyc(a, outA, 6.283)) < 0.42) continue;
      const d = POOL.r * (1.06 + rnd() * 0.18), x = POOL.x + Math.cos(a) * d, z = POOL.z + Math.sin(a) * d, r = 0.06 + rnd() * 0.05;
      if (z < FALL.zLip + 0.02) continue;
      add(x, z, r, { moss: 0.85 + rnd() * 0.15, wet: 0.85, lich: 0.2, sunk: 0.35 });
    }
    /* scattered stones: lake shore, river banks, cliff foot, mountain slopes */
    const target = Math.max(list.length + 20, Q.rocks - 6 - (L.stones.length + 1));
    let tries = 0;
    while (list.length < target && tries++ < 20000) {
      const cat = rnd(); let x, z, r;
      if (cat < 0.3) { x = Lk.cx + (rnd() - 0.5) * 6.2; z = Lk.cz + (rnd() - 0.5) * 5.4; const lr = T.lakeR(x, z); if (lr < 1.02 || lr > 1.25) continue; r = 0.018 + rnd() * 0.035; }
      else if (cat < 0.6) { const s = 0.04 + rnd() * 0.86, p = T.riverAt(s), side = rnd() < 0.5 ? -1 : 1, off = p.w * 0.5 + 0.03 + rnd() * 0.13; x = p.x - p.tz * off * side; z = p.z + p.tx * off * side; r = 0.02 + rnd() * 0.04; }
      else if (cat < 0.72) { x = FALL.x + (rnd() - 0.5) * 1.5; z = FALL.zLip + 0.05 + rnd() * 0.8; if (Math.hypot(x - POOL.x, z - POOL.z) < POOL.r * 1.35) continue; r = 0.035 + rnd() * 0.06; }
      else { x = -5.8 + rnd() * 11.6; z = -3.85 + rnd() * 3.2; const h = T.height(x, z); if (h < 1.15 || T.up(x, z) < 0.5) continue; r = 0.04 + rnd() * 0.08; }
      if (!free(x, z, r)) continue;
      add(x, z, r, {});
    }
    return list;
  }

  /* ================================================================ smoke */
  const NS = [96, 144, 192][Q.tier] || 144, S0 = [0.055, 0.045, 0.038][Q.tier] || 0.045;
  const sm = { x: new Float32Array(NS), y: new Float32Array(NS), z: new Float32Array(NS), age: new Float32Array(NS), life: new Float32Array(NS), seed: new Float32Array(NS), alive: new Uint8Array(NS), acc: 0, next: 0 };
  let smokeGeo = null;
  const wv = { x: 0, z: 0 };
  function smokeStep(dt) {
    const S = WG.state, top = props.chimneyTop, k = props.stoke;
    const rain = U.sat(Math.max(S.rain, W.rainAt(top.x, top.z)) * 1.3);
    sm.acc += dt * (NS / 21.5);
    while (sm.acc >= 1) {
      sm.acc -= 1; const i = sm.next; sm.next = (sm.next + 1) % NS;
      sm.x[i] = top.x + (Math.random() - 0.5) * 0.012; sm.y[i] = top.y + 0.004; sm.z[i] = top.z + (Math.random() - 0.5) * 0.012;
      sm.age[i] = 0; sm.life[i] = (21 - 6.5 * k) * (1 - 0.6 * rain) * (0.85 + Math.random() * 0.3); sm.seed[i] = Math.random(); sm.alive[i] = 1;
    }
    const pa = smokeGeo.attributes.position.array, aa = smokeGeo.attributes.aP.array, t = WG.time;
    for (let i = 0; i < NS; i++) {
      const o = i * 4;
      if (!sm.alive[i]) { aa[o + 1] = 0; aa[o] = 0; continue; }
      const age = (sm.age[i] += dt), a = age / sm.life[i];
      if (a >= 1) { sm.alive[i] = 0; aa[o + 1] = 0; aa[o] = 0; continue; }
      let x = sm.x[i], y = sm.y[i], z = sm.z[i];
      W.windAt(x, z, wv);
      const expo = 0.3 + 0.7 * U.smooth(0, 1.1, y - top.y), sd = sm.seed[i];
      let vy = (0.22 + 0.24 * k) * (0.55 + 0.45 * Math.exp(-age * 0.22)) + 0.1 * Math.exp(-age * 2.5);
      vy *= 1 - 0.82 * rain; vy -= rain * 0.05 * U.smooth(0.5, 3, age);
      if (y > 6.9) vy *= U.sat((7.33 - y) / 0.43);
      const tb = Math.min(1, age * 0.4) * 0.11;
      const vx = wv.x * expo * 0.8 + (U.vnoise(x * 1.7 + sd * 9, y * 1.3 - t * 0.25, 5) - 0.5) * tb + (sd - 0.5) * 0.08 * U.smooth(6.8, 7.3, y);
      const vz = wv.z * expo * 0.8 + (U.vnoise(z * 1.7 + sd * 7, y * 1.3 - t * 0.25, 6) - 0.5) * tb + (sm.seed[(i + 7) % NS] - 0.5) * 0.08 * U.smooth(6.8, 7.3, y);
      x = U.clamp(x + vx * dt, C.X0 + 0.15, C.X1 - 0.15); z = U.clamp(z + vz * dt, C.Z0 + 0.15, C.Z1 - 0.15); y = Math.max(Math.min(y + vy * dt, 7.31), T.height(x, z) + 0.05);
      sm.x[i] = x; sm.y[i] = y; sm.z[i] = z;
      const size = S0 * (1 + 0.7 * k) + (0.05 + 0.035 * k) * Math.pow(age, 0.9) * (1 + 1.6 * U.smooth(6.6, 7.3, y)) * (1 + rain * 1.2);
      const alpha = (0.5 + 0.35 * k) * U.smooth(0, 0.025, a) * Math.pow(1 - a, 1.1) * Math.pow(S0 / size, 0.62) * (1 - 0.3 * rain);
      pa[i * 3] = x; pa[i * 3 + 1] = y; pa[i * 3 + 2] = z;
      aa[o] = size; aa[o + 1] = alpha; aa[o + 2] = 0.08 + 0.55 * k + 0.12 * rain; aa[o + 3] = sd;
    }
    smokeGeo.attributes.position.needsUpdate = true; smokeGeo.attributes.aP.needsUpdate = true;
  }
  function makeSmoke() {
    smokeGeo = new THREE.BufferGeometry();
    smokeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NS * 3), 3).setUsage(THREE.DynamicDrawUsage));
    smokeGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(NS * 3).fill(0.5), 3));
    smokeGeo.setAttribute('aP', new THREE.BufferAttribute(new Float32Array(NS * 4), 4).setUsage(THREE.DynamicDrawUsage));
    const mat = WG.mat.unlit({
      name: 'props-smoke', transparent: true, depthWrite: false,
      vertexDecl: 'attribute vec4 aP; varying vec4 vP;',
      vertexLocal: 'vP = aP;',
      vertexEnd: 'gl_PointSize = aP.y < 0.001 ? 0.0 : clamp(aP.x * uRes.y * projectionMatrix[1][1] * 0.5 / gl_Position.w, 1.5, 300.0);',
      fragDecl: 'varying vec4 vP;',
      frag: /* glsl */ `
        vec2 q = gl_PointCoord - 0.5; float d = length(q) * 2.0;
        float n = wgNoise(q * 4.5 + vP.w * 31.0 + uTime * 0.12) + 0.5 * wgNoise(q * 9.0 - vP.w * 17.0);
        float a = smoothstep(1.0, 0.1, d + (n - 0.75) * 0.55) * vP.y;
        if (a < 0.003) discard;
        vec3 base = mix(vec3(0.78, 0.79, 0.82), vec3(0.3, 0.29, 0.285), vP.z);
        float lit = 0.6 + 0.4 * (0.5 - q.y);
        col = base * (uSkyCol * 1.3 + uFillCol * 0.6 + uSunCol * 0.4 * lit) + uFlashCol * 0.04;
        alpha = a;`,
    });
    return new THREE.Points(smokeGeo, mat);
  }

  /* ================================================================ module state */
  let boatObj = null, ropeGeo = null, decalMat = null;
  const bs = { phi: 0, phiV: 0, R: 0, roll: 0, rollV: 0, pitch: 0, pitchV: 0, heave: 0, heaveV: 0, post: null, len: 0, x: L.boat.x, z: L.boat.z };
  const bowLocal = new V3(BL / 2 - 0.008, gyB(0.98) + 0.003, 0), _bw = new V3();
  const RS = 14, RSD = 3;
  function makeRope() {
    ropeGeo = new THREE.BufferGeometry(); const nv = (RS + 1) * RSD, idx = [];
    for (let i = 0; i < RS; i++) for (let j = 0; j < RSD; j++) { const a = i * RSD + j, b = i * RSD + ((j + 1) % RSD), c = a + RSD, d = b + RSD; idx.push(a, c, b, b, c, d); }
    ropeGeo.setIndex(idx);
    ropeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    ropeGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const uv = new Float32Array(nv * 2), col = new Float32Array(nv * 3), k = new Float32Array(nv * 4), rc = hex(0xa88f62);
    for (let i = 0; i <= RS; i++) for (let j = 0; j < RSD; j++) { const v = i * RSD + j; uv[v * 2] = j / RSD; uv[v * 2 + 1] = i / RS * 0.3; col[v * 3] = rc.r; col[v * 3 + 1] = rc.g; col[v * 3 + 2] = rc.b; k[v * 4] = 12; }
    ropeGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); ropeGeo.setAttribute('color', new THREE.BufferAttribute(col, 3)); ropeGeo.setAttribute('aK', new THREE.BufferAttribute(k, 4));
    return new THREE.Mesh(ropeGeo, propMat);
  }
  const _ra = new V3(), _rb = new V3(), _rp = new V3(), _rt = new V3(), _r1 = new V3(), _r2 = new V3(), UP = new V3(0, 1, 0);
  function updateRope(a, b, sag) {
    const pa = ropeGeo.attributes.position.array, na = ropeGeo.attributes.normal.array, rr = 0.0022;
    for (let i = 0; i <= RS; i++) {
      const t = i / RS, s = 4 * t * (1 - t);
      _rp.lerpVectors(a, b, t); _rp.y -= sag * s;
      const t2 = Math.min(1, t + 0.02), t1 = Math.max(0, t - 0.02);
      _rt.lerpVectors(a, b, t2); _rt.y -= sag * 4 * t2 * (1 - t2); _r1.lerpVectors(a, b, t1); _r1.y -= sag * 4 * t1 * (1 - t1); _rt.sub(_r1).normalize();
      _r1.crossVectors(_rt, UP); if (_r1.lengthSq() < 1e-6) _r1.set(1, 0, 0); _r1.normalize(); _r2.crossVectors(_r1, _rt).normalize();
      for (let j = 0; j < RSD; j++) {
        const an = (j / RSD) * 6.283, c = Math.cos(an), sn = Math.sin(an), v = (i * RSD + j) * 3;
        const nx = _r1.x * c + _r2.x * sn, ny = _r1.y * c + _r2.y * sn, nz = _r1.z * c + _r2.z * sn;
        pa[v] = _rp.x + nx * rr; pa[v + 1] = _rp.y + ny * rr; pa[v + 2] = _rp.z + nz * rr; na[v] = nx; na[v + 1] = ny; na[v + 2] = nz;
      }
    }
    ropeGeo.attributes.position.needsUpdate = true; ropeGeo.attributes.normal.needsUpdate = true;
  }
  function boatStep(dt, t) {
    if (!boatObj) return;
    const S = WG.state, ice = U.smooth(0.3, 0.75, S.ice), free = 1 - ice, rm = WG.reducedMotion ? 0.4 : 1;
    W.windAt(bs.x, bs.z, wv);
    const ws = Math.hypot(wv.x, wv.z), wa = Math.atan2(wv.z, wv.x);
    const target = bs.phi0 + U.clamp(U.cyc(bs.phi0, wa, Math.PI * 2), -0.75, 0.75) * U.sat(ws / 1.1) * 0.75;
    bs.phiV += ((target - bs.phi) * 2.4 - bs.phiV * 1.3 + (U.vnoise(t * 0.7, 3.1, 11) - 0.5) * ws * 1.4) * dt * free;
    bs.phi += bs.phiV * dt * free;
    const amp = (0.0014 + 0.0035 * U.sat(ws) + 0.009 * S.storm) * free * rm;
    bs.rollV += (-34 * bs.roll - 2.6 * bs.rollV) * dt; bs.roll += bs.rollV * dt * free;
    bs.pitchV += (-40 * bs.pitch - 3 * bs.pitchV) * dt; bs.pitch += bs.pitchV * dt * free;
    bs.heaveV += (-30 * bs.heave - 3.5 * bs.heaveV) * dt; bs.heave += bs.heaveV * dt * free;
    if (ice > 0.98) { bs.roll *= 0.9; bs.pitch *= 0.9; bs.heave *= 0.9; bs.rollV = bs.pitchV = bs.heaveV = bs.phiV = 0; }
    const w1 = Math.sin(t * 1.7 + 0.4), w2 = Math.sin(t * 2.9 + 1.3), w3 = Math.sin(t * 1.1 + 2.2);
    const post = bs.post;
    bs.x = post.x + Math.cos(bs.phi) * bs.R; bs.z = post.z + Math.sin(bs.phi) * bs.R;
    const y = S.lakeLevel - 0.016 + ice * 0.004 + bs.heave + amp * (0.6 * w1 + 0.4 * w2);
    boatObj.position.set(bs.x, y, bs.z);
    boatObj.rotation.set(bs.roll + amp * 9 * (0.7 * w2 + 0.3 * w3), Math.PI - bs.phi, bs.pitch + amp * 5 * w1, 'YXZ');
    boatObj.updateMatrixWorld(true);
    _ra.copy(bowLocal).applyMatrix4(boatObj.matrixWorld); _rb.set(post.x, post.y - 0.012, post.z);
    const d = _ra.distanceTo(_rb);
    updateRope(_ra, _rb, Math.max(0.006, (bs.len - d) * 0.9 + 0.01));
  }
  props.boat.rock = (strength) => {
    const s = U.clamp(+strength || 0.5, 0, 1.5), free = 1 - U.smooth(0.3, 0.75, WG.state.ice);
    if (free < 0.02) return;
    const sg = Math.random() < 0.5 ? -1 : 1;
    bs.rollV += sg * s * 1.3 * free; bs.pitchV += (Math.random() - 0.5) * s * 1.1 * free; bs.heaveV += s * 0.04 * free; bs.phiV += (Math.random() - 0.5) * s * 0.6 * free;
    if (WG.water && WG.water.ring) { try { WG.water.ring(bs.x, bs.z, 0.4 + s * 0.4); } catch (e) { /* optional */ } }
  };

  /* ================================================================ module */
  WG.register('props', {
    init() {
      propMat = makePropMat();
      const M = new Merge(), SN = { p: [], n: [], a: [], i: [] };
      buildCabin(M, SN);
      buildJetty(M);
      const cabin = new THREE.Mesh(M.build(), propMat); cabin.name = 'props-cabin';
      WG.add(cabin, { shadow: true, reflect: true });
      props.cabin = cabin;
      /* chimney top, lantern, perches */
      const ct = toWorld(CHIM.x - 0.006, CHIM.top + 0.012, 0); props.chimneyTop = { x: ct.x, y: ct.y, z: ct.z };
      uLampPos.value.copy(toWorld(lanternLocal.x, lanternLocal.y, lanternLocal.z + 0.004));
      for (const p of perchLocal) { const w = toWorld(p.p.x, p.p.y, p.p.z); WG.perches.push({ x: w.x, y: w.y, z: w.z, sheltered: p.sheltered, kind: p.kind }); }
      /* snow on the roof, fence, barrel and block */
      const snow = makeSnowMesh(SN); snow.name = 'props-snow'; WG.add(snow, {});
      /* the porch's pool of warm light on the ground */
      {
        const c = toWorld(0.07, 0, HD + PORCH + 0.1), n = 14, sz = 0.7, pos = [], idx = [];
        for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { const x = c.x + (i / n - 0.5) * sz, z = c.z + (j / n - 0.5) * sz; pos.push(x, T.height(x, z) + 0.006, z); }
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i; idx.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2); }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((v, i) => (i % 3 === 1 ? 1 : 0)), 3)); g.setIndex(idx);
        const lc = toWorld(0.1, 0, HD + 0.12);
        decalMat = WG.mat.unlit({
          name: 'props-porchlight', additive: true, depthWrite: false, polygonOffset: -1,
          uniforms: { uLC: { value: new THREE.Vector2(lc.x, lc.z) }, uLamp },
          fragDecl: 'uniform vec2 uLC; uniform float uLamp;',
          frag: 'float d = length(P.xz - uLC); float k = smoothstep(0.34, 0.0, d); col = vec3(1.0, 0.48, 0.17) * k * k * uLamp * 0.16 * (0.9 + 0.2 * wgNoise(P.xz * 40.0)); alpha = 1.0;',
        });
        const decal = new THREE.Mesh(g, decalMat); decal.name = 'props-porchlight'; WG.add(decal, { order: 2 });
      }
      /* boat and its rope */
      {
        boatObj = new THREE.Mesh(buildBoat(), propMat); boatObj.name = 'props-boat';
        WG.add(boatObj, { shadow: true, reflect: true });
        const post = mooring.length ? mooring.reduce((a, b) => (Math.hypot(a.x - L.boat.x, a.z - L.boat.z) < Math.hypot(b.x - L.boat.x, b.z - L.boat.z) ? a : b)) : new V3(J.x1, DECK + 0.07, J.z1);
        bs.post = post; bs.phi0 = bs.phi = Math.atan2(L.boat.z - post.z, L.boat.x - post.x); bs.R = Math.hypot(L.boat.x - post.x, L.boat.z - post.z);
        bs.len = Math.hypot(bs.R - BL / 2 + 0.008, post.y - (C.LAKE + 0.05)) + 0.03;
        const rope = makeRope(); rope.name = 'props-rope'; WG.add(rope, { shadow: false });
        props.boat.mesh = boatObj; props.boat.post = post;
        WG.bus.on('splash', (e) => { const d = Math.hypot((e.x || 0) - bs.x, (e.z || 0) - bs.z); if (d < 1.6) props.boat.rock(U.sat((e.size === undefined ? 0.6 : e.size) * (1 - d / 1.6) * 1.3)); });
        WG.bus.on('lightning', (e) => { if (e && e.target === 'lake') { const d = Math.hypot((e.x || 0) - bs.x, (e.z || 0) - bs.z); if (d < 3) props.boat.rock(1.2 * (1 - d / 3)); } });
        boatStep(0, 0);
      }
      /* rocks */
      {
        const list = placeRocks();
        props.rocks = list.map((r) => ({ x: r.x, y: r.y + r.sy * 0.6, z: r.z, r: r.r }));
        /* the six boulders: one merged mesh, each its own chiselled shape, a few pebbles beside each (above) */
        const bm = { p: [], n: [], c: [], a: [] }, rnd = U.rng(9090);
        L.boulders.forEach((b, i) => {
          const g = rockGeo(b.seed * 13 + 5, 2, 7 + (i % 3), 1, 1, 1, 0, 0.13), sx = b.r * (1 + rnd() * 0.25), sy = b.r * (0.62 + rnd() * 0.22), sz = b.r * (0.8 + rnd() * 0.25);
          let gy = T.height(b.x, b.z); for (let k = 0; k < 6; k++) gy = Math.min(gy, T.height(b.x + Math.cos(k * 1.05) * b.r * 0.85, b.z + Math.sin(k * 1.05) * b.r * 0.85));
          const m = trs(b.x, gy - sy * 0.22, b.z, (rnd() - 0.5) * 0.25, rnd() * 6.28, (rnd() - 0.5) * 0.25, sx, sy, sz), nm = new THREE.Matrix3().getNormalMatrix(m);
          const c = tint(ROCKC[i % ROCKC.length], 0.95 + rnd() * 0.12), p = g.attributes.position, n = g.attributes.normal;
          for (let v = 0; v < p.count; v++) { _v.fromBufferAttribute(p, v).applyMatrix4(m); bm.p.push(_v.x, _v.y, _v.z); _v.fromBufferAttribute(n, v).applyMatrix3(nm).normalize(); bm.n.push(_v.x, _v.y, _v.z); bm.c.push(c.r, c.g, c.b); bm.a.push(0.55 + rnd() * 0.0 + 0.2, 0, 1, i * 7.1); }
          props.rocks.push({ x: b.x, y: gy + sy * 0.6, z: b.z, r: b.r, big: true });
        });
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(bm.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(bm.n, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(bm.c, 3)); g.setAttribute('aR', new THREE.Float32BufferAttribute(bm.a, 4));
        const boulders = new THREE.Mesh(g, makeRockMat(9)); boulders.name = 'props-boulders';
        WG.add(boulders, { shadow: true, reflect: true });
        /* small stones: three shape families, plus a flat family for the stepping stones */
        const fams = [rockGeo(901, 1, 4, 1, 0.78, 0.92, 0, 0.12), rockGeo(902, 1, 5, 1, 0.66, 1, 0.55, 0.1), rockGeo(903, 1, 3, 0.9, 0.85, 1, 0, 0.15)];
        const flat = rockGeo(904, 1, 5, 1, 1, 1, 0.4, 0.07);
        const stepList = L.stones.map((s, i) => ({ x: s.x, y: s.y - 0.009, z: s.z, sx: s.r * 1.12, sy: 0.034, sz: s.r * 0.92, ry: U.hash(i, 5, 3) * 6.28, tx: 0, tz: 0, c: tint(ROCKC[(i * 3) % 8], 0.9), moss: 0.92, wet: 0.45, lich: 0.2, seed: i * 3.3 }));
        { const w = toWorld(0.16, 0, 0.6); stepList.push({ x: w.x, y: T.height(w.x, w.z) - 0.008, z: w.z, sx: 0.045, sy: 0.026, sz: 0.038, ry: 0.7, tx: 0, tz: 0, c: tint(ROCKC[2], 0.95), moss: 0.7, wet: 0, lich: 0.4, seed: 21 }); }
        const mk = (geo, items, scale) => {
          const im = new THREE.InstancedMesh(geo, makeRockMat(scale), Math.max(1, items.length)), ar = new Float32Array(Math.max(1, items.length) * 4);
          items.forEach((r, i) => {
            im.setMatrixAt(i, trs(r.x, r.y, r.z, r.tx, r.ry, r.tz, r.sx, r.sy, r.sz)); im.setColorAt(i, r.c);
            ar[i * 4] = r.moss; ar[i * 4 + 1] = r.wet; ar[i * 4 + 2] = r.lich; ar[i * 4 + 3] = r.seed;
          });
          im.count = items.length; geo.setAttribute('aR', new THREE.InstancedBufferAttribute(ar, 4));
          im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
          return im;
        };
        fams.forEach((geo, f) => { const items = list.filter((r) => r.fam === f); if (!items.length) return; const im = mk(geo, items, 2.6); im.name = 'props-rocks' + f; WG.add(im, { shadow: true }); });
        const st = mk(flat, stepList, 2.2); st.name = 'props-stepping'; WG.add(st, { shadow: true });
        for (const s of stepList) props.rocks.push({ x: s.x, y: s.y + 0.015, z: s.z, r: s.sx, step: true });
      }
      /* smoke, warmed up so the plume already stands */
      {
        const pts = makeSmoke(); pts.name = 'props-smoke'; WG.add(pts, { order: 5 });
        props.stoke = 0.3;
        for (let i = 0; i < 240; i++) smokeStep(0.1);
      }
      lights(1);
    },
    update(dt, t) {
      lights(dt);
      smokeStep(dt);
      boatStep(dt, t);
    },
  });

  /* windows, lantern and the fire follow the dark, the cold and the storm */
  function lights(dt) {
    const S = WG.state;
    const on = U.sat(Math.max(S.dusk * 1.7, S.night, S.storm * 1.4, U.smooth(0.9, 1, S.cover) * 0.6, U.smooth(0.2, 0.02, S.sunDir.y) * 0.8));
    const h = S.time, small = U.smooth(0.6, 1.4, h) * U.smooth(5.4, 4.6, h);
    props.glow = U.damp(props.glow, on * (1 - 0.67 * small), 1.5, dt);
    uGlow.value = props.glow;
    const fl = WG.reducedMotion ? 1 : 0.9 + 0.06 * Math.sin(WG.time * 9.1) + 0.04 * Math.sin(WG.time * 23.3);
    uLamp.value = U.sat(props.glow * 1.25) * fl;
    const stoke = U.sat(Math.max(U.smooth(12, -2, S.temp), S.night * 0.85, S.storm, U.smooth(0.82, 1, S.cover) * 0.4));
    props.stoke = U.damp(props.stoke, stoke, 0.6, dt);
  }
})();
