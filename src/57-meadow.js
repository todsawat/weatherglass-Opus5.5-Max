/* Weatherglass — the meadow's small plants: grass blades in tufts, wildflowers in drifts, reed beds, lily pads, and a little pollen
   (or snow dust) lifted by the wind tool. Everything is instanced; the vertex shaders do the bending, the season and the weather. */
(function () {
  'use strict';
  const WG = window.WG; if (!WG) return;
  const THREE = WG.THREE, U = WG.util, C = WG.C, T = WG.terrain, L = WG.layout, Q = WG.Q;
  const KINDS = ['daisy', 'buttercup', 'violet', 'poppy', 'cornflower', 'aster'];
  /* bloom windows on the continuous season (0 spring, 1 summer, 2 autumn, 3 winter; may run past 4 into the next year) */
  const WIN = [[3.5, 5.5], [3.5, 4.75], [3.5, 4.5], [0.12, 1.5], [0.5, 1.75], [0.75, 2.5]];
  const KH = [0.075, 0.095, 0.04, 0.135, 0.125, 0.115];        // stem heights
  const KR = [0.019, 0.016, 0.013, 0.027, 0.02, 0.019];       // head radii
  const M = (WG.meadow = { flowerSpots: [], bloom: [0, 0, 0, 0, 0, 0], kinds: KINDS, reedBeds: [], lilyClusters: [], meshes: {} });
  const motion = WG.reducedMotion ? 0.3 : 1;

  /* JS twin of wgHash / wgNoise / wgFbm (25-glsl) so blades take the same dry/lush patches as the turf beneath them */
  const fract = (x) => x - Math.floor(x);
  const gHash = (px, py) => { let x = fract(px * 0.1031), y = fract(py * 0.1031), z = x; const d = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33); x += d; y += d; z += d; return fract((x + y) * z); };
  const gNoise = (px, py) => { const ix = Math.floor(px), iy = Math.floor(py); let fx = px - ix, fy = py - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); const a = gHash(ix, iy), b = gHash(ix + 1, iy), c = gHash(ix, iy + 1), d = gHash(ix + 1, iy + 1); return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy; };
  const gFbm = (px, py) => { let a = 0.5, s = 0; for (let i = 0; i < 4; i++) { s += a * gNoise(px, py); px = px * 2.03 + 17.1; py = py * 2.03 + 3.7; a *= 0.5; } return s; };
  /* a smooth window [a, b] on the cyclic season */
  const win = (s, a, b, f) => { const s0 = a - 2 * f, sp = s0 + U.wrap(s - s0, 4); return U.smooth(a - f, a + f, sp) * U.smooth(b + f, b - f, sp); };

  /* ------------------------------------------------------------------ where grass grows: a density grid */
  const GS = 0.05, GX = Math.round(12 / GS), GZ = Math.round(8 / GS);
  let dens = null, wdist = null;
  function bakeDensity() {
    dens = new Float32Array(GX * GZ); wdist = new Float32Array(GX * GZ);
    const cab = L.cabin;
    for (let j = 0; j < GZ; j++) for (let i = 0; i < GX; i++) {
      const x = C.X0 + (i + 0.5) * GS, z = C.Z0 + (j + 0.5) * GS, k = j * GX + i;
      if (!T.inside(x, z, 0.03)) continue;
      let d = T.grassDensity(x, z);
      if (d <= 0.01) continue;
      if (cab && Math.hypot(x - cab.x, z - cab.z) < 0.5) d = 0;
      for (const b of L.boulders || []) { const q = Math.hypot(x - b.x, z - b.z) / b.r; if (q < 1.1) d *= U.smooth(0.75, 1.1, q); }
      if (L.jetty) { const jx = L.jetty.x0, jz = L.jetty.z0; if (Math.hypot(x - jx, z - jz) < 0.18) d = 0; }
      dens[k] = d; wdist[k] = T.waterDist(x, z);
    }
  }
  const densAt = (x, z) => { const i = ((x - C.X0) / GS) | 0, j = ((z - C.Z0) / GS) | 0; if (i < 0 || j < 0 || i >= GX || j >= GZ) return 0; return dens[j * GX + i]; };

  /* ------------------------------------------------------------------ grass */
  const grassV = /* glsl */ `
    float side = position.x, h = position.y;
    float ca = cos(iA.w), sa = sin(iA.w);
    vec2 off = vec2(ca * aBlade.x - sa * aBlade.y, sa * aBlade.x + ca * aBlade.y);
    vec3 root = vec3(iA.x + off.x, iA.y, iA.z + off.y);
    float r = fract(aBlade.w + iB.z * 7.31), r2 = fract(r * 13.17 + iB.z * 3.1 + 0.37);
    vec4 gs = texture2D(uGroundTex, wgUV(root.xz));
    float snow = gs.g;
    /* length: the tuft's height, per-blade spread, shorter and thinner in winter, gone under snow */
    float Lb = iB.x * (0.68 + 0.55 * r2);
    Lb *= 1.0 - 0.3 * uSeasonW.w;
    float thin = 0.45 * uSeasonW.w;
    Lb *= smoothstep(thin - 0.04, thin + 0.001, fract(r * 7.7 + 0.13));
    Lb *= 1.0 - smoothstep(0.18, 0.72, snow);
    root.y += snow * 0.042;
    /* wind: travelling gust waves plus the wind tool's local gusts; strong wind lays the blades flat */
    vec2 wv = wgWindAt(root); float ws = length(wv); vec2 wd = wv / max(ws, 1e-4);
    float bw = 1.5 * (1.0 - exp(-0.8 * ws / (0.8 + 0.4 * r)));
    float fl = sin(uTime * (3.2 + 2.6 * r) - dot(root.xz, wd) * 7.0 + r * 6.283) * (0.035 + 0.085 * min(ws, 2.0)) * uMotion;
    vec2 lean = normalize(off + vec2(1e-4, 0.0)) * (0.1 + 0.42 * r2 + 1.1 * snow);
    vec2 Bv = lean + wd * (bw + fl);
    float th = min(length(Bv), 1.5); vec2 bd = Bv / max(length(Bv), 1e-4);
    vec3 tipv = vec3(bd.x * sin(th), cos(th), bd.y * sin(th)) * Lb, upv = vec3(0.0, Lb, 0.0);
    vec3 P = root + upv * (h * (1.0 - h)) + tipv * (h * h);
    vec3 tg = normalize(upv * (1.0 - 2.0 * h) + 2.0 * h * tipv + vec3(0.0, 1e-6, 0.0));
    float phi = iA.w + aBlade.z;
    vec3 across = vec3(cos(phi), 0.0, sin(phi));
    P += across * side * uBladeW * (0.75 + 0.5 * r2) * pow(1.0 - h, 0.8) * 0.5;
    vec3 bn = cross(across, tg); bn *= sign(bn.y + 1e-4);
    pos = P;
    nrm = normalize(normalize(bn + vec3(0.0, 1e-4, 0.0)) * 0.4 + vec3(0.0, 0.62, 0.0) + across * side * 0.22);
    /* colour: the turf's lush/dry patches, a few yellow-green and straw blades, dark in the sward, pale at the tips */
    float dry = clamp(smoothstep(0.38, 0.72, iB.y) + (r - 0.5) * 0.42, 0.0, 1.0);
    vec3 c = mix(uGrassA, uGrassB, dry);
    float kind = fract(r * 5.31 + 0.71);
    float strawP = 0.04 + 0.05 * uSeasonW.y + 0.1 * uSeasonW.z + 0.55 * uSeasonW.w + 0.12 * smoothstep(0.6, 1.0, dry);
    if (kind < strawP) c = mix(c, vec3(0.37, 0.3, 0.13), 0.85);
    else if (kind < strawP + 0.15) c = mix(c, vec3(c.g * 1.0, c.g * 1.1, c.b * 0.6), 0.5);
    c = mix(c, vec3(0.2, 0.2, 0.13), smoothstep(1.1, 2.5, root.y) * 0.55);
    c *= 0.8 + 0.34 * r2;
    c *= mix(0.4, 1.04, h * (2.0 - h));
    c *= 1.0 - 0.3 * gs.r;
    c = mix(c, vec3(0.8, 0.87, 0.93), gs.b * smoothstep(0.2, 1.0, h) * 0.85);
    vCol = c;
    vSheen = smoothstep(0.12, 1.05, bw) * h;
    vAo = mix(0.42, 1.0, h) * (1.0 - 0.25 * smoothstep(0.08, 0.14, Lb));`;

  function buildGrass() {
    const B = Q.tier >= 2 ? 6 : Q.tier === 1 ? 5 : 4;
    const NT = Math.max(200, Math.round(Q.grass / B));
    const rad = Q.tier >= 2 ? 0.018 : Q.tier === 1 ? 0.022 : 0.03;
    const rnd = U.rng(51177);
    /* one tuft: B blades, three quads and a tip each */
    const LV = [0, 0.3, 0.62], per = LV.length * 2 + 1;
    const pos = new Float32Array(B * per * 3), bl = new Float32Array(B * per * 4), idx = [];
    for (let b = 0; b < B; b++) {
      const a = rnd() * 6.283, rr = Math.sqrt(rnd()) * rad, ox = Math.cos(a) * rr, oz = Math.sin(a) * rr, face = rnd() * 6.283, rb = rnd();
      let v = b * per;
      const put = (s, h) => { pos[v * 3] = s; pos[v * 3 + 1] = h; pos[v * 3 + 2] = b; bl[v * 4] = ox; bl[v * 4 + 1] = oz; bl[v * 4 + 2] = face; bl[v * 4 + 3] = rb; v++; };
      for (const h of LV) { put(-1, h); put(1, h); }
      put(0, 1);
      const base = b * per;
      for (let l = 0; l < LV.length - 1; l++) { const q = base + l * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
      const q = base + (LV.length - 1) * 2; idx.push(q, q + 1, base + per - 1);
    }
    /* tufts: importance-sampled from the density grid */
    const cdf = new Float64Array(GX * GZ); let acc = 0;
    for (let k = 0; k < cdf.length; k++) { const d = dens[k]; acc += d > 0.03 ? Math.pow(d, 1.5) : 0; cdf[k] = acc; }
    const iA = new Float32Array(NT * 4), iB = new Float32Array(NT * 4);
    for (let t = 0; t < NT; t++) {
      const u = rnd() * acc; let lo = 0, hi = cdf.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < u) lo = mid + 1; else hi = mid; }
      const i = lo % GX, j = (lo / GX) | 0;
      const x = C.X0 + (i + rnd()) * GS, z = C.Z0 + (j + rnd()) * GS, y = T.height(x, z) - 0.004;
      const d = dens[lo], wd = wdist[lo];
      const lush = 1 - U.smooth(0.03, 1.2, wd), upK = U.smooth(0.85, 2.3, y);
      const hgt = U.lerp(0.062, 0.128, lush) * (1 - 0.45 * upK) * (0.78 + 0.27 * d) * (0.8 + 0.4 * rnd());
      const dry = gFbm(x * 0.85 + 7, z * 0.85 + 7) + (gNoise(x * 17, z * 17) - 0.5) * 0.18 + 0.2 * upK - 0.22 * lush;
      iA[t * 4] = x; iA[t * 4 + 1] = y; iA[t * 4 + 2] = z; iA[t * 4 + 3] = rnd() * 6.283;
      iB[t * 4] = hgt; iB[t * 4 + 1] = dry; iB[t * 4 + 2] = rnd(); iB[t * 4 + 3] = d;
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aBlade', new THREE.BufferAttribute(bl, 4));
    g.setIndex(idx);
    g.setAttribute('iA', new THREE.InstancedBufferAttribute(iA, 4));
    g.setAttribute('iB', new THREE.InstancedBufferAttribute(iB, 4));
    g.instanceCount = NT;
    const uni = { uBladeW: { value: 0.0085 * U.clamp(Math.sqrt(120000 / Q.grass), 1, 2.3) }, uMotion: { value: motion } };
    const mat = WG.mat.lit({
      name: 'grass', side: THREE.DoubleSide, shadow: false, uniforms: uni,
      vertexDecl: 'attribute vec4 aBlade; attribute vec4 iA; attribute vec4 iB; uniform float uBladeW; uniform float uMotion; varying float vSheen; varying float vAo;',
      vertexLocal: grassV,
      fragDecl: 'varying float vSheen; varying float vAo;',
      frag: 'N = normalize(vN); albedo = (vCol * vec3(1.03, 1.03, 1.25) + vSheen * vec3(0.075, 0.085, 0.05)) * (1.0 + 0.28 * uStudio.y); ao = vAo; rough = 0.62 - 0.22 * vSheen; spec = 0.035 + 0.05 * vSheen; trans = 0.3;',
    });
    const mesh = new THREE.Mesh(g, mat); mesh.name = 'grass';
    WG.add(mesh, { pass: 'A' });
    M.meshes.grass = mesh; M.grassTufts = NT; M.grassBlades = NT * B;
  }

  /* ------------------------------------------------------------------ wildflowers */
  const flowerV = /* glsl */ `
    int k = int(fA.w + 0.5);
    float bl = uBloom[k];
    vec3 root = fA.xyz;
    vec4 gs = texture2D(uGroundTex, wgUV(root.xz));
    float hide = 1.0 - smoothstep(0.1, 0.45, gs.g);
    root.y += gs.g * 0.042;
    float H = fB.x * smoothstep(0.0, 0.3, bl) * hide;
    float R = fB.y * smoothstep(0.08, 0.5, bl) * hide;
    float rr = fB.z;
    vec2 wv = wgWindAt(root); float ws = length(wv); vec2 wd = wv / max(ws, 1e-4);
    float bw = 1.15 * (1.0 - exp(-0.6 * ws));
    float fl = sin(uTime * (2.4 + 1.6 * rr) - dot(root.xz, wd) * 7.0 + rr * 6.283) * (0.05 + 0.08 * min(ws, 2.0)) * uMotion;
    vec2 lean = vec2(cos(fB.w), sin(fB.w)) * (0.06 + 0.16 * rr);
    vec2 Bv = lean + wd * (bw + fl);
    float th = min(length(Bv), 1.35); vec2 bd = Bv / max(length(Bv), 1e-4);
    vec3 tipv = vec3(bd.x * sin(th), cos(th), bd.y * sin(th)) * H, upv = vec3(0.0, H, 0.0);
    vec3 P; vec3 Nn;
    if (position.z < 0.5) {
      float h = position.y;
      P = root + upv * (h * (1.0 - h)) + tipv * (h * h);
      vec3 tg = normalize(upv * (1.0 - 2.0 * h) + 2.0 * h * tipv + vec3(0.0, 1e-6, 0.0));
      vec3 ac = vec3(cos(fB.w + 1.57), 0.0, sin(fB.w + 1.57));
      P += ac * position.x * uStemW * (1.0 - 0.45 * h) * step(1e-5, H);
      Nn = cross(ac, tg); Nn *= sign(Nn.y + 1e-4); Nn = normalize(Nn + vec3(0.0, 0.7, 0.0));
      vF = vec4(h, 0.0, 0.0, fA.w);
    } else {
      vec3 top = root + tipv;
      vec3 ax = normalize(2.0 * tipv - upv + vec3(0.0, 1e-5, 0.0));
      ax = normalize(mix(ax, uSunReal, 0.42 * uSunFace));                                      /* follow the sun by day */
      vec3 nod = normalize(vec3(cos(fB.w) * 0.9, -0.45, sin(fB.w) * 0.9));
      ax = normalize(mix(ax, nod, 0.7 * uNight));                                               /* nod at night */
      float open = clamp(smoothstep(0.45, 0.95, bl) * (1.0 - 0.92 * uNight) + uOpenBoost, 0.0, 1.0);
      float fold = mix(1.38, CUP[k], open);
      vec3 hp = abs(ax.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
      vec3 e1 = normalize(cross(hp, ax)), e2 = cross(ax, e1);
      float rho = position.x, al = position.y + rr * 6.283, rc = RC[k];
      vec3 rad = e1 * cos(al) + e2 * sin(al);
      if (rho <= rc) { P = top + rad * rho * R + ax * (1.0 - rho * rho / (rc * rc)) * 0.14 * R; Nn = ax; }
      else { float d = rho - rc; P = top + rad * (rc + d * cos(fold)) * R + ax * d * sin(fold) * R; Nn = normalize(ax * cos(fold) - rad * sin(fold) * 0.8); }
      vF = vec4(rho, position.y, 1.0, fA.w);
    }
    pos = P; nrm = Nn;`;
  const flowerConsts = /* glsl */ `
    const float RC[6] = float[6](0.3, 0.24, 0.14, 0.24, 0.22, 0.3);
    const float CUP[6] = float[6](0.1, 0.6, 0.2, 0.5, 0.22, 0.12);`;
  const flowerF = /* glsl */ `
    int k = int(vF.w + 0.5);
    N = normalize(vN);
    if (vF.z < 0.5) { albedo = vec3(0.075, 0.15, 0.04) * (0.7 + 0.5 * vF.x); rough = 0.7; trans = 0.3; }
    else {
      float rho = vF.x, a = vF.y;
      float f = abs(cos(a * PN[k] * 0.5));
      float Rr = mix(PE[k], 1.0, pow(f, PS[k]));
      if (k == 4) Rr *= 0.8 + 0.2 * abs(sin(a * PN[k] * 2.5 + 1.0));
      if (rho > Rr) discard;
      float t = rho / Rr;
      vec3 c = mix(PC[k], TC[k], smoothstep(0.5, 1.0, t));
      c = mix(CC[k], c, smoothstep(RC[k] - 0.035, RC[k] + 0.02, rho));
      albedo = c; rough = k == 1 ? 0.22 : 0.55; spec = k == 1 ? 0.12 : 0.04; trans = 0.45;
    }`;
  const flowerFDecl = /* glsl */ `varying vec4 vF;
    const float PN[6] = float[6](16.0, 5.0, 5.0, 4.0, 9.0, 22.0);
    const float PS[6] = float[6](0.6, 0.22, 0.45, 0.12, 0.5, 0.9);
    const float PE[6] = float[6](0.33, 0.62, 0.38, 0.78, 0.3, 0.31);
    const float RC[6] = float[6](0.3, 0.24, 0.14, 0.24, 0.22, 0.3);
    const vec3 PC[6] = vec3[6](vec3(0.72, 0.72, 0.68), vec3(0.9, 0.6, 0.02), vec3(0.2, 0.06, 0.42), vec3(0.72, 0.025, 0.012), vec3(0.06, 0.17, 0.7), vec3(0.46, 0.3, 0.72));
    const vec3 TC[6] = vec3[6](vec3(0.78, 0.3, 0.42), vec3(0.95, 0.7, 0.05), vec3(0.3, 0.1, 0.58), vec3(0.78, 0.05, 0.02), vec3(0.12, 0.3, 0.88), vec3(0.55, 0.4, 0.82));
    const vec3 CC[6] = vec3[6](vec3(0.85, 0.55, 0.03), vec3(0.7, 0.5, 0.03), vec3(0.85, 0.8, 0.35), vec3(0.02, 0.015, 0.02), vec3(0.1, 0.05, 0.3), vec3(0.85, 0.58, 0.04));`;

  let flowerU = null;
  function buildFlowers() {
    const rnd = U.rng(77031);
    /* drift centres: a few dozen, the same at every detail level */
    const spots = [], NS = 42; let perm = [];
    for (let guard = 0; spots.length < NS && guard < 9000; guard++) {
      const x = -5.6 + rnd() * 11.2, z = -3.6 + rnd() * 7.35;
      if (densAt(x, z) < 0.55 || T.height(x, z) > 1.6 || T.lakeR(x, z) < 1.25 || T.waterDist(x, z) < 0.12) continue;
      let ok = true; for (const s of spots) if ((s.x - x) ** 2 + (s.z - z) ** 2 < 0.55 * 0.55) { ok = false; break; }
      if (!ok) continue;
      if (!perm.length) { perm = [0, 1, 2, 3, 4, 5]; for (let i = 5; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = perm[i]; perm[i] = perm[j]; perm[j] = t; } }
      const kind = perm.pop();
      spots.push({ x, y: T.height(x, z), z, kind, name: KINDS[kind], r: 0.16 + rnd() * 0.22, n: 0, bloom: 0 });
    }
    M.flowerSpots = spots;
    const per = Math.max(4, Math.floor(Q.flowers / Math.max(1, spots.length)));
    const fA = [], fB = [];
    for (const s of spots) {
      for (let n = 0; n < per; n++) {
        let x = 0, z = 0, ok = false;
        for (let tr = 0; tr < 5 && !ok; tr++) {
          const a = rnd() * 6.283, rr = s.r * Math.min(2.2, Math.sqrt(-2 * Math.log(1 - rnd() * 0.999)) * 0.62);
          x = s.x + Math.cos(a) * rr; z = s.z + Math.sin(a) * rr * 0.85;
          ok = densAt(x, z) > 0.25;
        }
        if (!ok) continue;
        fA.push(x, T.height(x, z) - 0.003, z, s.kind);
        fB.push(KH[s.kind] * (0.72 + 0.56 * rnd()), KR[s.kind] * (0.8 + 0.4 * rnd()), rnd(), rnd() * 6.283);
        s.n++;
      }
    }
    const NF = fA.length / 4; if (!NF) return;
    /* one flower: a two-segment stem and a head of three rings (centre disc, mid petal, petal tip) */
    const SEG = 12, RINGS = [0.24, 0.62, 1.0], P = [], I = [];
    for (let h = 0; h <= 2; h++) { P.push(-1, h / 2, 0, 1, h / 2, 0); }
    for (let h = 0; h < 2; h++) { const q = h * 2; I.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
    const hb = P.length / 3;
    for (let s = 0; s < SEG; s++) P.push(0, ((s + 0.5) / SEG) * 6.2832, 1);       // centre vertices (one per sector, at its middle angle)
    const ring0 = P.length / 3;
    for (const r of RINGS) for (let s = 0; s <= SEG; s++) P.push(r, (s / SEG) * 6.2832, 1);
    for (let s = 0; s < SEG; s++) {
      I.push(hb + s, ring0 + s, ring0 + s + 1);
      for (let r = 0; r < RINGS.length - 1; r++) { const a = ring0 + r * (SEG + 1) + s, b = a + SEG + 1; I.push(a, b, a + 1, a + 1, b, b + 1); }
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3)); g.setIndex(I);
    g.setAttribute('fA', new THREE.InstancedBufferAttribute(new Float32Array(fA), 4));
    g.setAttribute('fB', new THREE.InstancedBufferAttribute(new Float32Array(fB), 4));
    g.instanceCount = NF;
    flowerU = { uBloom: { value: [0, 0, 0, 0, 0, 0] }, uNight: { value: 0 }, uOpenBoost: { value: 0 }, uSunReal: { value: new THREE.Vector3(0, 1, 0) }, uSunFace: { value: 0 }, uMotion: { value: motion }, uStemW: { value: 0.0026 * U.clamp(Math.sqrt(8000 / Q.flowers), 1, 1.8) } };
    const mat = WG.mat.lit({
      name: 'flowers', side: THREE.DoubleSide, shadow: false, uniforms: flowerU,
      vertexDecl: 'attribute vec4 fA; attribute vec4 fB; uniform float uBloom[6]; uniform float uNight; uniform float uOpenBoost; uniform vec3 uSunReal; uniform float uSunFace; uniform float uMotion; uniform float uStemW; varying vec4 vF;' + flowerConsts,
      vertexLocal: flowerV, fragDecl: flowerFDecl, frag: flowerF,
    });
    const mesh = new THREE.Mesh(g, mat); mesh.name = 'flowers';
    WG.add(mesh, { pass: 'A' });
    M.meshes.flowers = mesh; M.flowerCount = NF;
  }

  /* ------------------------------------------------------------------ reeds and cattails */
  const reedV = /* glsl */ `
    vec3 root = rA.xyz; float Hh = rB.x, sd = rB.w;
    vec4 gs = texture2D(uGroundTex, wgUV(root.xz));
    float snow = gs.g;
    vec3 bedP = vec3(rB.y, root.y, rB.z);
    vec2 wv = wgWindAt(bedP); float ws = length(wv); vec2 wd = wv / max(ws, 1e-4);
    float bedPh = dot(rB.yz, vec2(3.1, 4.7));
    float bw = 0.85 * (1.0 - exp(-0.55 * ws)) + sin(uTime * 1.6 + bedPh) * (0.035 + 0.07 * min(ws, 2.0)) * uMotion;
    float part = position.z, h = position.y;
    vec2 dd = vec2(cos(rA.w), sin(rA.w));
    vec3 P; vec3 Nn; float isHead = 0.0;
    if (part < 0.5 || part > 2.5) {
      vec2 Bv = dd * (0.05 + 0.1 * fract(sd * 3.1) + snow * 0.85) + wd * bw;
      float th = min(length(Bv), 1.45); vec2 bd = Bv / max(length(Bv), 1e-4);
      vec3 tipv = vec3(bd.x * sin(th), cos(th), bd.y * sin(th)) * Hh, upv = vec3(0.0, Hh, 0.0);
      if (part < 0.5) {
        P = root + upv * (h * (1.0 - h)) + tipv * (h * h);
        vec3 tg = normalize(upv * (1.0 - 2.0 * h) + 2.0 * h * tipv + vec3(0.0, 1e-6, 0.0));
        vec3 ac = vec3(-dd.y, 0.0, dd.x);
        P += ac * position.x * uReedW * (1.0 - 0.7 * h);
        Nn = cross(ac, tg); Nn *= sign(Nn.y + 1e-4); Nn = normalize(Nn + vec3(0.0, 0.5, 0.0));
      } else {
        float cat = step(0.8, fract(sd * 13.7));
        float hh = mix(0.6, 0.84, h);
        vec3 c = root + upv * (hh * (1.0 - hh)) + tipv * (hh * hh);
        float rad = uCatR * cat * (h > 0.02 && h < 0.98 ? 1.0 : 0.45);
        vec3 rd = vec3(cos(position.x), 0.0, sin(position.x));
        P = c + rd * rad; Nn = normalize(rd + vec3(0.0, 0.25, 0.0)); isHead = 1.0;
      }
    } else {
      float la = rA.w + (part < 1.5 ? 1.3 : -1.6) + (fract(sd * 5.3) - 0.5) * 0.8;
      vec2 ld = vec2(cos(la), sin(la));
      float LL = Hh * (0.55 + 0.3 * fract(sd * 7.7));
      vec2 Bv = ld * (0.3 + 0.35 * fract(sd * 9.1) + snow * 0.9) + wd * bw * 1.25;
      float th = min(length(Bv), 1.7); vec2 bd = Bv / max(length(Bv), 1e-4);
      vec3 tipv = vec3(bd.x * sin(th), cos(th), bd.y * sin(th)) * LL, upv = vec3(0.0, LL, 0.0);
      P = root + upv * (h * (1.0 - h)) + tipv * (h * h);
      vec3 tg = normalize(upv * (1.0 - 2.0 * h) + 2.0 * h * tipv + vec3(0.0, 1e-6, 0.0));
      vec3 ac = vec3(-ld.y, 0.0, ld.x);
      P += ac * position.x * uReedW * 1.7 * pow(1.0 - h, 0.7);
      Nn = cross(ac, tg); Nn *= sign(Nn.y + 1e-4); Nn = normalize(Nn + vec3(0.0, 0.4, 0.0));
    }
    float b = clamp(uBleach + (fract(sd * 4.1) - 0.5) * 0.45, 0.0, 1.0);
    vec3 green = mix(vec3(0.085, 0.17, 0.04), vec3(0.16, 0.24, 0.06), fract(sd * 2.3));
    vec3 c = mix(green, mix(vec3(0.42, 0.34, 0.18), vec3(0.5, 0.45, 0.33), uSeasonW.w), b);
    c *= mix(0.55, 1.1, h);
    if (isHead > 0.5) c = vec3(0.12, 0.06, 0.028) * (0.8 + 0.3 * fract(sd * 6.1));
    c = mix(c, vec3(0.86, 0.89, 0.93), snow * 0.45 * h * step(0.2, Nn.y));
    c = mix(c, vec3(0.8, 0.87, 0.93), gs.b * h * 0.6);
    vCol = c;
    pos = P; nrm = Nn;`;

  let reedU = null;
  function buildReeds() {
    const rnd = U.rng(88213), lk = L.lake, beds = [];
    const jet = L.jetty, boat = L.boat;
    const nearJetty = (x, z) => {
      if (!jet) return false;
      const vx = jet.x1 - jet.x0, vz = jet.z1 - jet.z0, t = U.sat(((x - jet.x0) * vx + (z - jet.z0) * vz) / (vx * vx + vz * vz));
      if (Math.hypot(x - jet.x0 - vx * t, z - jet.z0 - vz * t) < 0.38) return true;
      return boat ? Math.hypot(x - boat.x, z - boat.z) < 0.45 : false;
    };
    const far = (x, z, d) => { for (const b of beds) if ((b.x - x) ** 2 + (b.z - z) ** 2 < d * d) return false; return true; };
    for (let g = 0; beds.length < 11 && g < 12000; g++) {
      const x = lk.cx + (rnd() * 2 - 1) * 2.7, z = lk.cz + (rnd() * 2 - 1) * 2.8, r = T.lakeR(x, z);
      if (r < 0.97 || r > 1.04 || z > 3.75 || !T.inside(x, z, 0.15) || nearJetty(x, z) || !far(x, z, 0.62)) continue;
      beds.push({ x, z, kind: 'lake', r: 0.11 + rnd() * 0.07 });
    }
    const riv = L.river;
    const nLake = beds.length;
    for (let g = 0; beds.length < nLake + 8 && g < 6000; g++) {
      const s = 0.52 + rnd() * 0.42, p = T.riverAt(s), sideS = rnd() < 0.5 ? -1 : 1, o = p.w * 0.5 + 0.03;
      const x = p.x - p.tz * o * sideS, z = p.z + p.tx * o * sideS;
      if (!T.inside(x, z, 0.15) || nearJetty(x, z) || !far(x, z, 0.45) || T.lakeR(x, z) < 1.0) continue;
      beds.push({ x, z, kind: 'river', s, r: 0.09 + rnd() * 0.05 });
    }
    M.reedBeds = beds;
    if (!beds.length) return;
    const per = Math.max(3, Math.floor(Q.reeds / beds.length)), rA = [], rB = [];
    for (const b of beds) {
      for (let n = 0; n < per; n++) {
        let x = 0, z = 0, ok = false;
        for (let tr = 0; tr < 6 && !ok; tr++) {
          const a = rnd() * 6.283, rr = Math.sqrt(rnd()) * b.r; x = b.x + Math.cos(a) * rr; z = b.z + Math.sin(a) * rr;
          if (b.kind === 'lake') { const r = T.lakeR(x, z); ok = r > 0.93 && r < 1.07; }
          else { const ri = T.riverInfo(x, z); ok = ri.d > ri.w * 0.5 - 0.04 && ri.d < ri.w * 0.5 + 0.09 && ri.s > 0.45; }
          if (ok && nearJetty(x, z)) ok = false;
        }
        if (!ok) continue;
        const y = T.height(x, z) - 0.01;
        rA.push(x, y, z, rnd() * 6.283);
        rB.push(0.15 + 0.15 * Math.pow(rnd(), 0.8), b.x, b.z, rnd());
      }
    }
    const NR = rA.length / 4; if (!NR) return;
    /* one reed: a four-segment stem, two base leaves, a six-sided cattail head (collapsed unless the reed carries one) */
    const P = [], I = [];
    const strip = (part, levels) => { const b0 = P.length / 3; for (let l = 0; l < levels.length; l++) { P.push(-1, levels[l], part, 1, levels[l], part); } for (let l = 0; l < levels.length - 1; l++) { const q = b0 + l * 2; I.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); } const tip = P.length / 3; P.push(0, 1, part); const q = b0 + (levels.length - 1) * 2; I.push(q, q + 1, tip); };
    strip(0, [0, 0.3, 0.6, 0.85]);
    strip(1, [0, 0.35, 0.7]);
    strip(2, [0, 0.35, 0.7]);
    const hb = P.length / 3, SIDES = 6, HR = [0, 0.15, 0.85, 1];
    for (const hr of HR) for (let s = 0; s <= SIDES; s++) P.push((s / SIDES) * 6.2832, hr, 3);
    for (let r = 0; r < HR.length - 1; r++) for (let s = 0; s < SIDES; s++) { const a = hb + r * (SIDES + 1) + s, b = a + SIDES + 1; I.push(a, b, a + 1, a + 1, b, b + 1); }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3)); g.setIndex(I);
    g.setAttribute('rA', new THREE.InstancedBufferAttribute(new Float32Array(rA), 4));
    g.setAttribute('rB', new THREE.InstancedBufferAttribute(new Float32Array(rB), 4));
    g.instanceCount = NR;
    reedU = { uBleach: { value: 0.3 }, uMotion: { value: motion }, uReedW: { value: 0.0042 * U.clamp(Math.sqrt(420 / Q.reeds), 1, 1.5) }, uCatR: { value: 0.0105 } };
    const mat = WG.mat.lit({
      name: 'reeds', side: THREE.DoubleSide, shadow: false, uniforms: reedU,
      vertexDecl: 'attribute vec4 rA; attribute vec4 rB; uniform float uBleach; uniform float uMotion; uniform float uReedW; uniform float uCatR;',
      vertexLocal: reedV,
      frag: 'N = normalize(vN); albedo = vCol; rough = 0.6; spec = 0.04; trans = 0.25;',
    });
    const mesh = new THREE.Mesh(g, mat); mesh.name = 'reeds';
    WG.add(mesh, { pass: 'A' });
    M.meshes.reeds = mesh; M.reedCount = NR;
  }

  /* ------------------------------------------------------------------ lily pads */
  const lilyV = /* glsl */ `
    float part = position.z, rho = position.x, al = position.y;
    float pres = uLily.x * (1.0 - smoothstep(0.15, 0.5, uLake.y));
    float R = lA.w * pres;
    float t = uTime * uMotion;
    vec2 tilt = vec2(sin(t * 0.8 + lA.x * 4.0 + lB.x * 6.0), cos(t * 0.67 + lA.y * 5.0 + lB.x * 3.0)) * (0.025 + 0.05 * min(uWind.z, 1.5));
    float lvl = uLake.x + 0.004 + sin(t * 1.1 + lB.x * 6.283 + lA.x * 3.0) * 0.0015;
    vec3 P; vec3 Nn = normalize(vec3(-tilt.x, 1.0, -tilt.y));
    if (part < 0.5) {
      vec2 l = vec2(cos(al + lA.z), sin(al + lA.z)) * rho * R;
      P = vec3(lA.x + l.x, lvl + dot(tilt, l), lA.y + l.y);
    } else {
      float fr = R * 0.66 * lB.y * smoothstep(0.05, 0.6, uLily.y);
      float open = smoothstep(0.3, 0.9, uLily.y) * (1.0 - 0.8 * uNight);
      float fold = mix(1.35, 0.6, open), rc = 0.25;
      vec2 cen = vec2(lA.x, lA.y) + vec2(cos(lA.z + 3.1), sin(lA.z + 3.1)) * R * 0.3;
      vec3 top = vec3(cen.x, lvl + 0.01, cen.y);
      vec3 rad = vec3(cos(al + lA.z), 0.0, sin(al + lA.z));
      if (rho <= rc) P = top + rad * rho * fr + vec3(0.0, (1.0 - rho * rho / (rc * rc)) * 0.15 * fr, 0.0);
      else { float d = rho - rc; P = top + rad * (rc + d * cos(fold)) * fr + vec3(0.0, d * sin(fold) * fr, 0.0); Nn = normalize(vec3(0.0, cos(fold), 0.0) - rad * sin(fold)); }
    }
    vL = vec4(rho, al, part, lB.x);
    pos = P; nrm = Nn;`;
  const lilyF = /* glsl */ `
    N = normalize(vN);
    float rho = vL.x, a = vL.y, sd = vL.w;
    if (vL.z < 0.5) {
      vec3 g = mix(vec3(0.05, 0.14, 0.035), vec3(0.09, 0.2, 0.045), sd);
      g *= 0.85 + 0.25 * (1.0 - rho);
      g *= 1.0 - 0.18 * smoothstep(0.9, 1.0, abs(cos(a * 9.0))) * rho;
      g = mix(g, vec3(0.2, 0.1, 0.035) * (0.8 + 0.4 * sd), uLily.z * (0.55 + 0.45 * sd));
      g *= mix(1.0, 0.72, smoothstep(0.86, 1.0, rho));
      albedo = g; rough = 0.3; spec = 0.05;
    } else {
      float f = abs(cos(a * 5.0)); float Rr = mix(0.45, 1.0, pow(f, 0.5));
      if (rho > Rr) discard;
      vec3 c = mix(vec3(0.78, 0.76, 0.72), vec3(0.8, 0.38, 0.5), smoothstep(0.62, 1.0, rho / Rr));
      albedo = mix(vec3(0.85, 0.6, 0.05), c, smoothstep(0.2, 0.28, rho)); rough = 0.5; trans = 0.4;
    }`;
  let lilyU = null;
  function buildLily() {
    const rnd = U.rng(31415), lk = L.lake, jet = L.jetty, boat = L.boat, clusters = [];
    const clear = (x, z, d) => { if (jet && Math.hypot(x - jet.x1, z - jet.z1) < d + 0.25) return false; if (boat && Math.hypot(x - boat.x, z - boat.z) < d + 0.25) return false; return z < 3.8; };
    for (let g = 0; clusters.length < 4 && g < 5000; g++) {
      const x = lk.cx + (rnd() * 2 - 1) * 2.4, z = lk.cz + (rnd() * 2 - 1) * 2.4, r = T.lakeR(x, z);
      if (r < 0.79 || r > 0.9 || !clear(x, z, 0.35) || !T.inside(x, z, 0.3)) continue;
      let ok = true; for (const c of clusters) if (Math.hypot(c.x - x, c.z - z) < 1.0) ok = false;
      if (ok) clusters.push({ x, z });
    }
    M.lilyClusters = clusters;
    const pads = [], NL = Q.lily;
    for (let g = 0; pads.length < NL && g < 8000 && clusters.length; g++) {
      const c = clusters[g % clusters.length], a = rnd() * 6.283, rr = Math.sqrt(rnd()) * 0.3;
      const x = c.x + Math.cos(a) * rr, z = c.z + Math.sin(a) * rr, R = 0.034 + rnd() * 0.028, r = T.lakeR(x, z);
      if (r < 0.72 || r > 0.96 || !clear(x, z, R)) continue;
      let ok = true; for (const p of pads) if (Math.hypot(p.x - x, p.z - z) < (p.R + R) * 0.92) { ok = false; break; }
      if (ok) pads.push({ x, z, R, rot: rnd() * 6.283, sd: rnd(), fl: 0 });
    }
    if (!pads.length) return;
    for (let i = 0; i < pads.length; i += 5) pads[(i + ((rnd() * 5) | 0)) % pads.length].fl = 1;   // about a fifth flower
    const lA = [], lB = [];
    for (const p of pads) { lA.push(p.x, p.z, p.rot, p.R); lB.push(p.sd, p.fl, 0, 0); }
    /* one pad: a notched disc; one flower: a cup of petals */
    const P = [], I = [], SEG = 14, notch = 0.5;
    P.push(0, 0, 0);
    for (let s = 0; s <= SEG; s++) P.push(1, notch / 2 + (s / SEG) * (6.2832 - notch), 0);
    for (let s = 0; s < SEG; s++) I.push(0, s + 2, s + 1);
    const FS = 10, hb = P.length / 3; for (let s = 0; s < FS; s++) P.push(0, ((s + 0.5) / FS) * 6.2832, 1);
    const ring0 = P.length / 3, RINGS = [0.25, 0.6, 1.0];
    for (const r of RINGS) for (let s = 0; s <= FS; s++) P.push(r, (s / FS) * 6.2832, 1);
    for (let s = 0; s < FS; s++) { I.push(hb + s, ring0 + s, ring0 + s + 1); for (let r = 0; r < RINGS.length - 1; r++) { const a = ring0 + r * (FS + 1) + s, b = a + FS + 1; I.push(a, b, a + 1, a + 1, b, b + 1); } }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3)); g.setIndex(I);
    g.setAttribute('lA', new THREE.InstancedBufferAttribute(new Float32Array(lA), 4));
    g.setAttribute('lB', new THREE.InstancedBufferAttribute(new Float32Array(lB), 4));
    g.instanceCount = pads.length;
    lilyU = { uLily: { value: new THREE.Vector3(1, 0, 0) }, uNight: { value: 0 }, uMotion: { value: motion } };
    const mat = WG.mat.lit({
      name: 'lily', side: THREE.DoubleSide, shadow: false, uniforms: lilyU,
      vertexDecl: 'attribute vec4 lA; attribute vec4 lB; uniform vec3 uLily; uniform float uNight; uniform float uMotion; varying vec4 vL;',
      vertexLocal: lilyV, fragDecl: 'uniform vec3 uLily; varying vec4 vL;', frag: lilyF,
    });
    const mesh = new THREE.Mesh(g, mat); mesh.name = 'lily';
    WG.add(mesh, { pass: 'A' });
    M.meshes.lily = mesh; M.lilyCount = pads.length; M.lilyPads = pads;
  }

  /* ------------------------------------------------------------------ pollen and snow dust lifted by the wind tool */
  const NP = 140;
  const pp = new Float32Array(NP * 3), pv = new Float32Array(NP * 3), pl = new Float32Array(NP), plMax = new Float32Array(NP), pa = new Float32Array(NP), pk = new Float32Array(NP);
  let pAlive = 0, pNext = 0, pBudget = 0, pGeo = null;
  function buildPollen() {
    for (let i = 0; i < NP; i++) pp[i * 3 + 1] = -50;
    pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pp, 3).setUsage(THREE.DynamicDrawUsage));
    pGeo.setAttribute('aA', new THREE.BufferAttribute(pa, 1).setUsage(THREE.DynamicDrawUsage));
    pGeo.setAttribute('aK', new THREE.BufferAttribute(pk, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = WG.mat.unlit({
      name: 'pollen', transparent: true, depthWrite: false, shadow: false,
      vertexDecl: 'attribute float aA; attribute float aK; varying float vA; varying float vK;',
      vertexLocal: 'nrm = vec3(0.0, 1.0, 0.0); vA = aA; vK = aK;',
      vertexEnd: 'gl_PointSize = clamp((0.009 + 0.004 * vK) * projectionMatrix[1][1] * uRes.y * 0.5 / gl_Position.w, 1.2, 9.0);',
      fragDecl: 'varying float vA; varying float vK;',
      frag: `vec2 q = gl_PointCoord * 2.0 - 1.0; float d = dot(q, q); if (d > 1.0 || vA < 0.003) discard;
        vec3 base = mix(vec3(1.0, 0.86, 0.38), vec3(0.95, 0.97, 1.0), vK);
        col = base * (uSunCol * 0.45 + uSkyCol * 1.3 + uFillCol + 0.015); alpha = vA * (1.0 - d) * (0.65 + 0.25 * vK);`,
    });
    const pts = new THREE.Points(pGeo, mat); pts.name = 'pollen';
    WG.add(pts, { pass: 'A' });
    M.meshes.pollen = pts;
  }
  /* lift a puff at (x, z): pollen in the growing seasons, snow dust where snow lies */
  M.puff = (x, z, strength) => {
    if (!pGeo) return 0;
    const S = WG.state, sw = WG.G && WG.G.uSeasonW ? WG.G.uSeasonW.value : { x: 1, y: 0, z: 0, w: 0 };
    const snow = WG.world && WG.world.snowAt ? WG.world.snowAt(x, z) : 0;
    const pollenK = U.sat((sw.x + sw.y) * 1.2 - 0.2) * (1 - U.sat(snow * 3)) * (S && S.rain > 0.3 ? 0.3 : 1) * U.sat(densAt(x, z) * 1.5);
    const snowK = U.smooth(0.25, 0.6, snow);
    const kind = snowK > pollenK ? 1 : 0, amt = Math.max(pollenK, snowK);
    if (amt < 0.05) return 0;
    const n = Math.min(pBudget | 0, Math.round((kind ? 4 : 2) * U.clamp(strength || 1, 0.5, 2.5) * amt + 0.4));
    if (n <= 0) return 0;
    pBudget -= n;
    const w = { x: 0, z: 0 }; if (WG.world && WG.world.windAt) WG.world.windAt(x, z, w);
    for (let m = 0; m < n; m++) {
      const i = pNext; pNext = (pNext + 1) % NP;
      const px = x + (Math.random() - 0.5) * 0.4, pz = z + (Math.random() - 0.5) * 0.4;
      pp[i * 3] = px; pp[i * 3 + 1] = T.height(px, pz) + 0.04 + Math.random() * 0.06; pp[i * 3 + 2] = pz;
      pv[i * 3] = w.x * 0.35 + (Math.random() - 0.5) * 0.15; pv[i * 3 + 1] = 0.22 + Math.random() * 0.3 + (kind ? 0.15 : 0); pv[i * 3 + 2] = w.z * 0.35 + (Math.random() - 0.5) * 0.15;
      plMax[i] = pl[i] = 2.2 + Math.random() * 2.2; pk[i] = kind; pa[i] = 0;
    }
    pAlive = NP;
    return n;
  };
  const wtmp = { x: 0, z: 0 };
  function updatePollen(dt) {
    pBudget = Math.min(10, pBudget + dt * 40);
    if (!pGeo || pAlive <= 0) return;
    let alive = 0;
    for (let i = 0; i < NP; i++) {
      if (pl[i] <= 0) { if (pa[i] !== 0) { pa[i] = 0; pp[i * 3 + 1] = -50; } continue; }
      alive++; pl[i] -= dt;
      const k = i * 3; if (WG.world && WG.world.windAt) WG.world.windAt(pp[k], pp[k + 2], wtmp);
      const drag = 1 - Math.exp(-dt * 1.4);
      pv[k] += (wtmp.x * 0.55 - pv[k]) * drag; pv[k + 2] += (wtmp.z * 0.55 - pv[k + 2]) * drag;
      pv[k + 1] += ((pk[i] ? -0.06 : 0.02) - pv[k + 1]) * (1 - Math.exp(-dt * 0.8));
      pv[k] += (Math.random() - 0.5) * dt * 0.4; pv[k + 2] += (Math.random() - 0.5) * dt * 0.4;
      pp[k] = U.clamp(pp[k] + pv[k] * dt, C.X0 + 0.05, C.X1 - 0.05); pp[k + 2] = U.clamp(pp[k + 2] + pv[k + 2] * dt, C.Z0 + 0.05, C.Z1 - 0.05);
      pp[k + 1] = Math.max(T.height(pp[k], pp[k + 2]) + 0.01, pp[k + 1] + pv[k + 1] * dt);
      const age = plMax[i] - pl[i];
      pa[i] = U.smooth(0, 0.25, age) * U.smooth(0, 0.9, pl[i]);
      if (pl[i] <= 0) { pa[i] = 0; pp[k + 1] = -50; }
    }
    pAlive = alive ? NP : 0;
    pGeo.attributes.position.needsUpdate = true; pGeo.attributes.aA.needsUpdate = true; pGeo.attributes.aK.needsUpdate = true;
  }

  /* ------------------------------------------------------------------ module */
  const sunTmp = new THREE.Vector3();
  WG.register('meadow', {
    init() {
      bakeDensity();
      const parts = [['grass', buildGrass], ['flowers', buildFlowers], ['reeds', buildReeds], ['lily', buildLily], ['pollen', buildPollen]];
      for (const [n, f] of parts) { try { f(); } catch (e) { WG.fail('meadow.' + n, e); } }
      WG.bus.on('wind:sweep', (e) => { if (e && isFinite(e.x) && isFinite(e.z)) M.puff(e.x, e.z, e.speed || 1); });
      M.ready = true;
    },
    update(dt) {
      const S = WG.state, s = S.season;
      for (let k = 0; k < 6; k++) M.bloom[k] = win(s, WIN[k][0], WIN[k][1], 0.16);
      for (const sp of M.flowerSpots) sp.bloom = M.bloom[sp.kind] * (1 - U.smooth(0.15, 0.5, S.snowAvg));
      if (flowerU) {
        const b = flowerU.uBloom.value; for (let k = 0; k < 6; k++) b[k] = M.bloom[k];
        flowerU.uNight.value = S.night;
        flowerU.uOpenBoost.value = 0.18 * U.sat(S.wetAvg * 1.6) * (1 - S.night);
        sunTmp.copy(S.sunDir); flowerU.uSunReal.value.copy(sunTmp.normalize());
        flowerU.uSunFace.value = S.sunUp * (1 - S.night) * (0.4 + 0.6 * S.sunI);
      }
      if (reedU) reedU.uBleach.value = U.bySeason(s, 0.28, 0.05, 0.85, 1.0);
      if (lilyU) {
        const brown = s < 3 ? U.smooth(1.8, 2.5, s) : U.smooth(3.65, 3.3, s);
        lilyU.uLily.value.set(win(s, 3.7, 6.85, 0.2), win(s, 0.5, 1.9, 0.2), brown);
        lilyU.uNight.value = S.night;
      }
      updatePollen(dt);
    },
  });
})();
