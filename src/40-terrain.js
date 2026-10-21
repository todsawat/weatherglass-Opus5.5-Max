/* Weatherglass — the land: the sculpted surface and the four cut faces of the block that show the soil in cross-section. */
(function () {
  'use strict';
  const WG = window.WG, THREE = WG.THREE, U = WG.util, C = WG.C, T = WG.terrain;

  function buildSurface() {
    const nx = 240, nz = 160, vx = nx + 1, vz = nz + 1;
    const pos = new Float32Array(vx * vz * 3), nor = new Float32Array(vx * vz * 3), n = {};
    for (let j = 0; j < vz; j++) for (let i = 0; i < vx; i++) {
      const x = C.X0 + (i / nx) * 12, z = C.Z0 + (j / nz) * 8, k = (j * vx + i) * 3;
      pos[k] = x; pos[k + 1] = T.height(x, z); pos[k + 2] = z;
      T.normal(U.clamp(x, C.X0 + 0.05, C.X1 - 0.05), U.clamp(z, C.Z0 + 0.05, C.Z1 - 0.05), n); nor[k] = n.x; nor[k + 1] = n.y; nor[k + 2] = n.z;
    }
    const idx = new Uint16Array(nx * nz * 6); let q = 0;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * vx + i, b = a + 1, c = a + vx, d = c + 1; idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1));
    const mat = WG.mat.lit({
      name: 'land', weather: true,
      vertexWorld: 'float sn = texture2D(uGroundTex, wgUV(w.xz)).g; w.y += sn * 0.045 * smoothstep(0.55, 0.92, wn.y);',
      fragDecl: /* glsl */ `
        vec3 landColour(vec3 P, inout vec3 N, out float rough, out float spec, out float ao, out float wetK, out float snowK){
          vec2 uv = wgUV(P.xz); vec4 m1 = texture2D(uMask1, uv), m2 = texture2D(uMask2, uv);
          float path = m1.r, bare = m1.g, hol = m1.b, sand = m1.a, bed = m2.r, mud = m2.g, stream = m2.b, shade = m2.a;
          float n1 = wgFbm(P.xz * 3.1), n2 = wgNoise(P.xz * 17.0), n3 = wgNoise(P.xz * 61.0);
          float slope = 1.0 - N.y;
          float rockK = max(smoothstep(0.2, 0.4, slope + (n1 - 0.5) * 0.14), smoothstep(2.45, 2.95, P.y + (n1 - 0.5) * 0.6));
          rockK = max(rockK, stream * 0.85) * (1.0 - sand) ;
          float shelf = smoothstep(0.78, 0.5, abs(P.x + 1.5)) * smoothstep(-2.02, -2.24, P.z) * smoothstep(1.65, 1.95, P.y);
          rockK = max(rockK, shelf * (0.72 + 0.28 * n1));
          /* turf: lush and dry patches, thinner and duller with height */
          vec3 turf = mix(uGrassA, uGrassB, smoothstep(0.38, 0.72, wgFbm(P.xz * 0.85 + 7.0) + (n2 - 0.5) * 0.18));
          turf *= 0.62 + 0.3 * n2 + 0.12 * n3;
          turf = mix(turf, vec3(0.2, 0.2, 0.13), smoothstep(1.1, 2.5, P.y) * 0.55);
          vec3 earth = mix(vec3(0.15, 0.1, 0.062), vec3(0.235, 0.165, 0.105), n2) * (0.85 + 0.3 * n3);
          earth = mix(earth, vec3(0.37, 0.295, 0.2) * (0.9 + 0.2 * n3), path * path);
          vec3 mudC = vec3(0.07, 0.054, 0.04) * (0.8 + 0.4 * n2);
          vec3 sandC = mix(vec3(0.56, 0.48, 0.35), vec3(0.68, 0.61, 0.47), n2) * (0.93 + 0.07 * sin(dot(P.xz, vec2(11.0, 24.0)) + n1 * 7.0));
          float pc = wgNoise(P.xz * 34.0), pc2 = wgNoise(P.xz * 71.0 + 3.0);
          vec3 peb = mix(vec3(0.2, 0.19, 0.17), vec3(0.5, 0.47, 0.42), pc) * (0.75 + 0.5 * pc2);
          sandC = mix(sandC, peb, smoothstep(0.72, 0.8, pc2) * 0.8);
          /* rock: grey with a warm cast, bedded, cracked, stained, lichen above and moss below */
          float strata = P.y * 6.5 + wgFbm(P.xz * 1.1) * 3.4 + n1 * 1.3 + wgNoise(P.xz * 6.0) * 0.5;
          vec3 rock = mix(vec3(0.31, 0.3, 0.28), vec3(0.5, 0.48, 0.445), wgNoise(vec2(strata * 0.8, 3.7)) * 0.75 + n2 * 0.25);
          rock = mix(rock, vec3(0.43, 0.275, 0.165), smoothstep(0.76, 0.9, wgNoise(vec2(strata * 0.37, 9.1))) * 0.6);
          float ledge = abs(fract(strata) - 0.5);
          rock *= 0.84 + 0.16 * smoothstep(0.0, 0.2, ledge) * (0.6 + 0.8 * wgNoise(vec2(strata * 0.5, 1.3)));
          /* chiselled facets */
          vec3 fq = P * vec3(2.6, 3.4, 2.6);
          float fa = wgNoise3(fq) + 0.5 * wgNoise3(fq * 2.3 + 4.0);
          float cn = wgNoise(P.xz * 5.2 + P.y * 3.1), crack = smoothstep(0.47, 0.5, cn) * smoothstep(0.53, 0.5, cn);
          rock *= 1.0 - crack * 0.55;
          rock *= 0.8 + 0.2 * wgNoise(vec2(P.x * 15.0 + P.z * 9.0, P.y * 1.2));
          rock = mix(rock, vec3(0.5, 0.52, 0.36), smoothstep(0.6, 0.78, wgNoise(P.xz * 7.3 + 2.0)) * smoothstep(0.5, 0.8, N.y) * 0.5);
          rock = mix(rock, vec3(0.085, 0.14, 0.05), smoothstep(0.45, 0.7, wgNoise(P.xz * 4.1 + 9.0)) * smoothstep(2.0, 1.0, P.y) * 0.65 * (0.4 + 0.6 * stream));
          N = wgBump(P, N, (fa * 0.085 + smoothstep(0.0, 0.25, ledge) * 0.012 + n2 * 0.006 - crack * 0.014) * rockK, 1.0);
          vec3 a = turf;
          a = mix(a, earth, max(bare, path));
          a = mix(a, mudC, mud);
          a = mix(a, sandC, sand);
          a = mix(a, peb * 0.8, bed);
          a = mix(a, rock, rockK);
          rough = mix(0.93, 0.78, rockK); spec = 0.035; ao = 1.0 - 0.34 * shade * (1.0 - rockK);
          wetK = 1.0; snowK = 1.0;
          /* the bed of the lake: silty with depth, lit by moving caustics */
          float depth = uLake.x - P.y;
          if (sand > 0.5 && depth > 0.0) {
            a = mix(a * 0.62, vec3(0.1, 0.14, 0.115), smoothstep(0.04, 0.5, depth));
            float ca = wgCaustic(P.xz * 1.25, uTime * 0.55) * smoothstep(0.0, 0.07, depth) * exp(-depth * 1.1) * (1.0 - uLake.y) * (1.0 - 0.7 * uLake.z);
            a *= 0.8 + 1.5 * ca;
            wetK = 0.0; snowK = 0.0;
          } else if (bed > 0.5 || (stream > 0.6 && P.y < 1.5)) { a *= 0.8 + 0.9 * wgCaustic(P.xz * 1.6, uTime * 0.9) * (1.0 - uLake.y); wetK = 0.0; snowK = 0.0; }
          else {
            /* puddles gather in the hollows once the ground is soaked, and mirror the sky */
            vec4 g = wgGround(P.xz);
            float pud = smoothstep(0.62, 0.9, g.r) * smoothstep(0.22, 0.55, hol + (n2 - 0.5) * 0.15) * (1.0 - rockK) * (1.0 - smoothstep(0.1, 0.4, g.g));
            if (pud > 0.01) {
              vec3 pn = vec3(0.0, 1.0, 0.0);
              if (g.a > 0.02) { float e = 0.004; float r0 = wgRings(P.xz * 13.0, uTime), rx = wgRings((P.xz + vec2(e, 0.0)) * 13.0, uTime), rz = wgRings((P.xz + vec2(0.0, e)) * 13.0, uTime); pn = normalize(vec3((r0 - rx) * 0.05, 1.0, (r0 - rz) * 0.05) * vec3(g.a * 6.0, 1.0, g.a * 6.0)); }
              N = normalize(mix(N, pn, pud)); a = mix(a, a * 0.35, pud); rough = mix(rough, 0.03, pud); spec = mix(spec, 0.4, pud);
            }
          }
          return a;
        }`,
      frag: 'albedo = landColour(P, N, rough, spec, ao, wetK, snowK);',
    });
    const mesh = new THREE.Mesh(g, mat); mesh.name = 'land';
    WG.add(mesh, { shadow: true, reflect: true });
    WG.land = mesh;
  }

  /* the four cut faces: turf edge, humus with hanging roots, loam, a band of clay, gravel and cobbles, bedrock */
  function buildSoil() {
    const walls = [
      { name: 'front', n: [0, 0, 1], at: (t) => [C.X0 + t * 12, C.Z1], len: 12, cols: 240 },
      { name: 'back', n: [0, 0, -1], at: (t) => [C.X1 - t * 12, C.Z0], len: 12, cols: 240 },
      { name: 'left', n: [-1, 0, 0], at: (t) => [C.X0, C.Z0 + t * 8], len: 8, cols: 160 },
      { name: 'right', n: [1, 0, 0], at: (t) => [C.X1, C.Z1 - t * 8], len: 8, cols: 160 },
    ];
    const rows = [0, 0, 0.012, 0.03, 0.06, 0.1, 0.16, 0.24, 0.34, 0.46, 0.6, 0.76, 0.9, 1.0]; // row 0 is lifted by snow; fractions of the way down
    const P = [], Nn = [], A = [], I = []; let base = 0, sOff = 0;
    for (const w of walls) {
      const nr = rows.length;
      for (let i = 0; i <= w.cols; i++) {
        const t = i / w.cols, p = w.at(t), top = T.height(U.clamp(p[0], C.X0, C.X1), U.clamp(p[1], C.Z0, C.Z1));
        const inx = U.clamp(p[0] - w.n[0] * 0.06, C.X0 + 0.02, C.X1 - 0.02), inz = U.clamp(p[1] - w.n[2] * 0.06, C.Z0 + 0.02, C.Z1 - 0.02);
        for (let r = 0; r < nr; r++) {
          const y = U.lerp(top, C.Y0, rows[r]);
          P.push(p[0] - w.n[0] * 0.004, y, p[1] - w.n[2] * 0.004); Nn.push(w.n[0], w.n[1], w.n[2]);
          A.push(top, sOff + t * w.len, r === 0 ? 1 : 0, T.lakeR(inx, inz) < 1 ? 1 : 0);
        }
      }
      for (let i = 0; i < w.cols; i++) for (let r = 0; r < nr - 1; r++) { const a = base + i * nr + r, b = a + nr, c = a + 1, d = b + 1; I.push(a, c, b, b, c, d); }
      base += (w.cols + 1) * nr; sOff += w.len + 3.7;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3)); g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(Nn), 3));
    g.setAttribute('aSoil', new THREE.BufferAttribute(new Float32Array(A), 4)); g.setIndex(I);
    const mat = WG.mat.lit({
      name: 'soil',
      vertexDecl: 'attribute vec4 aSoil; varying vec4 vSoil; varying float vSnow; varying float vWet;',
      vertexWorld: 'vSoil = aSoil; vec4 gs = texture2D(uGroundTex, wgUV(w.xz - wn.xz * 0.1)); vSnow = gs.g; vWet = gs.r; w.y += aSoil.z * gs.g * 0.06;',
      fragDecl: /* glsl */ `
        varying vec4 vSoil; varying float vSnow; varying float vWet;
        vec2 soilCells(vec2 p){ vec2 i = floor(p), f = fract(p); float d1 = 9.0, id = 0.0; for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 o = vec2(float(x), float(y)); vec2 h = wgHash2(i + o); float d = length(o + h - f); if (d < d1) { d1 = d; id = h.x; } } return vec2(d1, id); }
      `,
      frag: /* glsl */ `
        float top = vSoil.x, s = vSoil.y, d = top - P.y, lake = vSoil.w;
        float n1 = wgNoise(vec2(s * 9.0, P.y * 9.0)), n2 = wgNoise(vec2(s * 31.0, P.y * 31.0)), n3 = wgNoise(vec2(s * 80.0, P.y * 80.0));
        float mount = smoothstep(0.95, 2.2, top);
        float k = mix(1.0, 0.13, mount);                                   /* soil thins over rising bedrock */
        float wv = wgFbm2(vec2(s * 1.1, 2.0)) - 0.5, wv2 = wgFbm2(vec2(s * 2.3, 7.0)) - 0.5;
        float dHum = 0.035 + (0.03 + 0.2 * wgNoise(vec2(s * 0.8, 5.0))) * k;
        float dLoam = dHum + (0.62 + wv * 0.3) * k;
        float dClay = dLoam + (0.085 + wv2 * 0.05) * k;
        float dGrav = dClay + (0.3 + wv * 0.14) * k;
        vec3 c;
        if (d < 0.0) { c = vec3(0.9, 0.925, 0.96); rough = 0.9; }                        /* snow cap */
        else if (d < 0.022 && lake < 0.5) c = uGrassA * 0.75;                             /* turf edge */
        else if (d < dHum && lake < 0.5) c = vec3(0.04, 0.03, 0.022) * (0.8 + 0.5 * n2);
        else if (d < dLoam) {
          c = mix(vec3(0.185, 0.118, 0.07), vec3(0.25, 0.165, 0.1), n1);
          c = mix(c, vec3(0.32, 0.15, 0.06), smoothstep(0.62, 0.8, wgNoise(vec2(s * 5.0, P.y * 6.0 + 3.0))) * 0.6);    /* rusty mottles */
          vec2 st = soilCells(vec2(s, P.y) * 9.0); c = mix(c, mix(vec3(0.3, 0.29, 0.27), vec3(0.45, 0.42, 0.38), st.y), step(0.9, st.y) * smoothstep(0.26, 0.2, st.x));  /* embedded stones */
          vec2 bh = soilCells(vec2(s * 0.7, P.y) * 6.0 + 11.0); c *= 1.0 - step(0.93, bh.y) * smoothstep(0.16, 0.1, bh.x) * 0.85;                                         /* burrows */
          if (lake > 0.5) c = mix(vec3(0.6, 0.52, 0.38), vec3(0.42, 0.42, 0.4), smoothstep(0.1, 0.45, d)) * (0.85 + 0.3 * n2);                                          /* sand, then grey clay, under the lake */
        }
        else if (d < dClay) c = mix(vec3(0.5, 0.31, 0.15), vec3(0.6, 0.4, 0.2), n1) * (0.86 + 0.14 * sin(P.y * 240.0 + n1 * 5.0));
        else if (d < dGrav) { vec2 cb = soilCells(vec2(s, P.y) * 15.0); c = mix(vec3(0.07, 0.065, 0.06), mix(vec3(0.3, 0.3, 0.29), vec3(0.52, 0.5, 0.46), cb.y) * (0.75 + 0.5 * n3), smoothstep(0.42, 0.3, cb.x)); }
        else {
          float bedc = (P.y + s * mount * 0.9 + wgFbm2(vec2(s * 0.7, 1.0)) * 0.25) * 9.0;                                 /* beds tilt steeply under the mountains */
          c = mix(vec3(0.4, 0.33, 0.25), vec3(0.31, 0.31, 0.31), smoothstep(0.35, 0.65, wgNoise(vec2(floor(bedc), 4.0))));
          c *= 0.7 + 0.3 * smoothstep(0.0, 0.12, abs(fract(bedc) - 0.5));
          float jn = wgNoise(vec2(s * 4.0 + floor(bedc) * 3.3, 8.0)); c *= 1.0 - smoothstep(0.48, 0.5, jn) * smoothstep(0.52, 0.5, jn) * 0.6;   /* joints */
          c *= 0.85 + 0.3 * n2;
        }
        /* roots hanging from the turf: many fine, a few thick */
        if (d > 0.012 && lake < 0.5 && mount < 0.6) {
          float cell = floor(s * 30.0), h = wgHash(vec2(cell, 1.0)); float len = 0.06 + 0.34 * h * h;
          float rx = abs(fract(s * 30.0) - 0.5 + sin(d * 34.0 + h * 6.0) * 0.16);
          float fine = smoothstep(0.1, 0.03, rx) * step(d, len) * smoothstep(len, len * 0.5, d);
          float cell2 = floor(s * 4.6), h2 = wgHash(vec2(cell2, 7.0)); float len2 = 0.25 + 0.5 * h2;
          float rx2 = abs(fract(s * 4.6) - 0.5 + sin(d * 9.0 + h2 * 6.0) * 0.1);
          float thick = step(0.55, h2) * smoothstep(0.045 * (1.0 - d / len2), 0.015 * (1.0 - d / len2), rx2) * step(d, len2);
          c = mix(c, vec3(0.5, 0.4, 0.27), max(fine * 0.75, thick));
        }
        c *= mix(1.0, 0.42, smoothstep(-0.5, -1.8, P.y));                                                                 /* darker toward the foot */
        float wd = vWet * 0.55; c *= mix(1.0, 0.55, smoothstep(wd + 0.1, wd - 0.03, d) * vWet * step(0.0, d));           /* rain soaks down from the top */
        albedo = c; rough = 0.9; ao = 0.9;`,
    });
    const mesh = new THREE.Mesh(g, mat); mesh.name = 'soil';
    WG.add(mesh, { shadow: true });
    WG.soil = mesh;
    /* a floor under the block so no light leaks up through the plinth */
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(12, 8).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ colorWrite: false })); fl.position.y = C.Y0 + 0.01;
    WG.add(fl, { shadow: true }); fl.layers.set(WG.L.SHADOW);
  }

  WG.register('terrain', { init() { buildSurface(); buildSoil(); } });
})();
