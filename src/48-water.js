/* Weatherglass — all the water: the lake (surface, mirror image, ice and the cut face behind the front glass), the spring,
   the river, the waterfall and its plunge pool, spray and mist, raindrop rings, splashes, wakes and stars of cracks in the ice.
   Everything here is a transparent pass-A object; the water reads the weather (level, ice, flow, turbidity, wind, rain) and
   other parts poke it through WG.water.splash / ring / wake / surfaceY. */
(function () {
  'use strict';
  const WG = window.WG, THREE = WG.THREE, U = WG.util, C = WG.C, T = WG.terrain, L = WG.layout, Q = WG.Q, S = WG.state;
  const V3 = THREE.Vector3, V4 = THREE.Vector4;
  const FALL = L.fall, POOL = L.pool, RIV = L.river;
  const tier = Q.tier;
  const NRING = [256, 384, 512][tier], NDROP = [160, 260, 420][tier], NMIST = 16, NSPL = 8, NICE = [14, 22, 30][tier], NCRACK = 8;
  const MARCH = [9, 12, 12][tier];
  const f4 = (v) => (+v).toFixed(4);
  const water = (WG.water = WG.water || {});

  /* the foot of the fall: where the sheet lands in the pool */
  const IMPACT = { x: FALL.x, z: FALL.zLip + 0.15, y: POOL.y };
  /* the sheet: starts on the shelf just behind the lip, falls as a parabola into the pool */
  const FG = { y0: T.height(FALL.x, FALL.zLip - 0.05) + 0.018, z0: FALL.zLip - 0.05, H: 0, c: 0.2 };
  FG.H = FG.y0 - POOL.y + 0.015;

  /* shared state for every water material */
  const WU = {
    uWat: { value: new V4(0, 0, 0, 0) },          // river flow phase, fall phase, river ice, fall ice
    uCrack: { value: Array.from({ length: NCRACK }, () => new V4(0, 0, -999, 0.3)) },   // x, z, birth time, size
  };

  /* ------------------------------------------------------------------ shared GLSL */
  const WT = WG.glsl.wind + /* glsl */ `
uniform vec4 uWat;
float wtWaveH(vec2 p, float t){
  vec2 d = normalize(uWind.xy + vec2(1e-4, 0.0));
  vec2 q = vec2(dot(p, d), dot(p, vec2(-d.y, d.x)));
  return wgNoise(vec2(q.x * 8.0 - t * 1.6, q.y * 4.5)) * 0.6 + wgNoise(vec2(q.x * 17.0 - t * 2.7, q.y * 11.0 + 3.0)) * 0.3 + wgNoise(p * 31.0 + vec2(t * 0.6, -t * 0.45)) * 0.1;
}
vec3 wtWaveN(vec2 p, float amp){
  float t = uWind.w * 0.9 + uTime * 0.35, e = 0.012;
  float h0 = wtWaveH(p, t), hx = wtWaveH(p + vec2(e, 0.0), t), hz = wtWaveH(p + vec2(0.0, e), t);
  return normalize(vec3((h0 - hx) / e * amp, 1.0, (h0 - hz) / e * amp));
}
/* the colour scattered back by the water body; nearly black-teal at night */
vec3 wtNight(vec3 a){ return a * mix(vec3(1.0), vec3(0.5, 0.48, 0.38), uStudio.y); }
/* light falling on a point: sun or moon (with cast and cloud shadows), sky, studio fill, lightning */
vec3 wtIrr(vec3 P, vec3 N, out float sh){
  sh = 1.0;
  if (uSunCol.r + uSunCol.g + uSunCol.b > 0.002) sh = wgShadow(P, N) * wgCloudShadow(P);
  vec3 amb = mix(uGndCol, uSkyCol, N.y * 0.5 + 0.5) + uFillCol * (max(dot(N, uFillDir), 0.0) * 0.8 + 0.2);
  vec3 fl = vec3(0.0);
  if (uFlashCol.b > 0.002) { vec3 fd = uFlashPos - P; float l = length(fd); fl = uFlashCol * (max(dot(N, fd / l), 0.0) * 0.75 + 0.25) / (1.0 + l * l * 0.035); }
  return uSunCol * max(dot(N, uSunDir), 0.0) * sh + amb + fl;
}
/* a sharp, sparkling reflection of the sun (or the moon) */
vec3 wtGlint(vec3 P, vec3 N, vec3 V, float sh){
  vec3 H = normalize(uSunDir + V); float nh = max(dot(N, H), 0.0);
  float Fs = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
  float sp = pow(nh, 1600.0) * 70.0 + pow(nh, 220.0) * 3.0 + pow(nh, 30.0) * 0.06;
  float glit = step(0.985, wgHash(floor(P.xz * 120.0) + floor(uTime * 7.0) * 13.1)) * pow(nh, 380.0) * 40.0;
  return uSunCol * sh * (sp + glit) * Fs * step(0.0, dot(N, uSunDir));
}
/* the clouds seen in the water: follow the reflected ray up to the clouds' height in the top-down cloud map */
vec3 wtCloudRefl(vec3 P, vec3 R, vec3 base){
  float h = max(uCloudP.x + 0.3, P.y + 1.0);
  float t = (h - P.y) / max(R.y, 0.06);
  vec2 q = P.xz + R.xz * t;
  vec2 uv = (q - vec2(-8.0, -6.0)) / vec2(16.0, 12.0);
  vec4 c = texture2D(uCloudMap, uv);
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  float a = clamp(c.r * 1.25, 0.0, 0.9) * smoothstep(0.02, 0.15, R.y) * inside;
  float dark = c.r > 0.002 ? clamp(c.g / c.r, 0.0, 1.0) : 0.0;
  vec3 cc = (uSunCol * 0.42 + uSkyCol * 1.5 + uEnvCol * 0.45) * mix(1.0, 0.32, dark);
  return mix(base, cc, a);
}
/* what the water mirrors where nothing solid is: the air of the case, darker toward the horizon (back wall, dark studio), with clouds */
vec3 wtSky(vec3 P, vec3 R){ return wtCloudRefl(P, R, mix(uEnvCol * 0.12 + uRoomCol * 2.0, uEnvCol * 0.85, smoothstep(0.4, 0.95, R.y))); }
/* a soft mirror image of the mountains when the planar mirror is not rendered: march the reflected ray over the land */
vec4 wtMarch(vec3 P, vec3 R){
  if (R.y < 0.0) return vec4(0.0);
  float t = 0.0, tp = 0.0;
  for (int i = 0; i < ${MARCH}; i++) {
    tp = t; t += 0.22 + t * 0.2;
    vec3 p = P + R * t;
    if (p.x < -6.0 || p.x > 6.0 || p.z < -4.0 || p.z > 4.0 || p.y > 4.3) break;
    float h = wgHeight(p.xz);
    if (p.y < h) {
      for (int k = 0; k < 3; k++) { float tm = (t + tp) * 0.5; vec3 pm = P + R * tm; if (pm.y < wgHeight(pm.xz)) t = tm; else tp = tm; }
      p = P + R * t; h = wgHeight(p.xz);
      float rk = smoothstep(0.9, 2.1, h);
      vec3 base = mix(uGrassA * 0.8, vec3(0.34, 0.33, 0.31), rk);
      base = mix(base, vec3(0.85, 0.87, 0.9), smoothstep(0.2, 0.6, wgGround(p.xz).g));
      return vec4(base * (uSunCol * max(uSunDir.y, 0.0) * 0.85 + uSkyCol * 1.2), 1.0);
    }
  }
  return vec4(0.0);
}
/* distance to the nearest cell edge: crack networks */
float wtCells(vec2 p){
  vec2 i = floor(p), f = fract(p); float d1 = 9.0, d2 = 9.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y)); float d = length(o + wgHash2(i + o) - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return d2 - d1;
}
/* lit ice: pale blue-white, dark cracks, trapped white bubbles and wind-swept drifts of snow */
vec3 wtIce(vec3 P, vec3 V, float snowAmt, float fine){
  float n1 = wgNoise(P.xz * 3.0), n2 = wgNoise(P.xz * 9.0 + 4.0);
  vec2 wp = P.xz + (vec2(wgNoise(P.xz * 1.7), wgNoise(P.xz * 1.7 + 9.0)) - 0.5) * 0.35;
  float cr = smoothstep(0.045, 0.0, wtCells(wp * 2.4)) * 0.85 + smoothstep(0.03, 0.0, wtCells(wp * 6.5 + 3.0)) * 0.4 * fine;
  vec2 bc = floor(P.xz * 26.0); vec2 bf = fract(P.xz * 26.0) - 0.5 - (wgHash2(bc) - 0.5) * 0.3;
  float bub = step(0.9, wgHash(bc + 7.0)) * smoothstep(0.3, 0.1, length(bf)) * smoothstep(0.42, 0.7, wgNoise(P.xz * 2.2 + 11.0));
  vec3 alb = mix(vec3(0.4, 0.5, 0.56), vec3(0.64, 0.7, 0.74), smoothstep(0.25, 0.7, n1) * 0.75 + n2 * 0.25);
  alb *= 1.0 - cr * 0.7;
  alb = mix(alb, vec3(0.94, 0.95, 0.97), bub);
  vec2 wd = normalize(uWind.xy + vec2(1e-4, 0.0)); float al = dot(P.xz, wd), ac = dot(P.xz, vec2(-wd.y, wd.x));
  float drift = smoothstep(0.56, 0.8, wgNoise(vec2(al * 1.4, ac * 6.0)) * 0.65 + wgNoise(P.xz * 3.7) * 0.35 + snowAmt * 0.16 - 0.05) * smoothstep(0.03, 0.35, snowAmt);
  alb = mix(alb, vec3(0.9, 0.92, 0.95), drift);
  vec3 Ni = normalize(vec3((n2 - 0.5) * 0.05, 1.0, (n1 - 0.5) * 0.05));
  vec3 c = wgShade(P, Ni, V, alb, mix(0.14, 0.85, drift), 0.035, 0.0, 1.0, 0.0, 1.0);
  float Fi = 0.03 + 0.97 * pow(1.0 - max(dot(Ni, V), 0.0), 5.0);
  c += wgSkyEnv(reflect(-V, Ni)) * Fi * (1.0 - drift) * 0.8;
  return c;
}
/* freezing front: the lake freezes from its shallow edges inward */
float wtLakeIce(vec2 xz, float depth){
  return smoothstep(0.0, 0.05, uLake.y * 1.25 - depth - (wgNoise(xz * 3.0) - 0.5) * 0.25 + 0.02) * step(0.001, uLake.y);
}
`;
  const matOpts = (o) => Object.assign({ transparent: true, premultiplied: true, depthWrite: false, env: 'none', shadow: false }, o, { uniforms: Object.assign({}, WU, o.uniforms) });

  /* ------------------------------------------------------------------ lake surface */
  let lake, lakeFace, streams, pool, fall, rings, crowns, drops, mists, icicles;
  function buildLake() {
    const g = new THREE.PlaneGeometry(6.2, 3.6, 80, 46); g.rotateX(-Math.PI / 2); g.translate(2.65, 0, 2.2);
    const p = g.attributes.position, n = p.count, mask = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = p.getX(i), z = p.getZ(i), ri = T.riverInfo(x, z);
      mask[i] = Math.max(1 - U.smooth(1.42, 1.62, T.lakeR(x, z)), ri.d < ri.w * 0.5 + 0.25 && ri.s > 0.55 ? 1 : 0);
    }
    g.setAttribute('aMask', new THREE.BufferAttribute(mask, 1));
    const mat = WG.mat.unlit(matOpts({
      name: 'lake', side: THREE.DoubleSide,
      uniforms: {},
      vertexDecl: 'attribute float aMask; varying float vMask;',
      vertexLocal: 'vMask = aMask;',
      fragDecl: WT + /* glsl */ `
varying float vMask;
uniform vec4 uCrack[${NCRACK}];
vec2 wtStar(vec2 p, float size, float seed){
  float r = length(p); if (r > size) return vec2(0.0);
  float pw = max(0.0032, length(fwidth(p)) * 0.8);
  float a = atan(p.y, p.x) / 6.2831853 + 0.5, n = 7.0, k = floor(a * n), c = 0.0;
  for (int j = -1; j <= 1; j++) {
    float kk = k + float(j), h = wgHash(vec2(kk, seed));
    float ak = (kk + 0.25 + 0.5 * h) / n * 6.2831853 - 3.14159265;
    float len = size * (0.45 + 0.55 * wgHash(vec2(kk, seed + 3.0)));
    vec2 dir = vec2(cos(ak), sin(ak)); float al = dot(p, dir);
    float off = abs(dot(p, vec2(-dir.y, dir.x)) + sin(al * 70.0 + h * 9.0) * 0.005 * al / size);
    c = max(c, smoothstep(pw, 0.0, off) * step(0.0, al) * smoothstep(len, len * 0.6, al));
  }
  float ring = smoothstep(pw * 1.1, 0.0, abs(r - size * 0.3 - (wgNoise(vec2(a * 30.0, seed)) - 0.5) * 0.03)) * 0.8;
  return vec2(max(c, ring), smoothstep(size * 0.09, 0.0, r));
}`,
      frag: /* glsl */ `
  float bed = wgHeight(P.xz), d = uLake.x - bed;
  if (vMask < 0.5 || d < -0.03) discard;
  vec4 g = wgGround(P.xz);
  float turb = uLake.z;
  float ws = length(wgWindAt(P));
  float amp = 0.006 + 0.028 * smoothstep(0.05, 1.8, ws) + 0.012 * uAir.z;
  vec3 Nw = wtWaveN(P.xz, amp);
  if (g.a > 0.02) {
    vec2 rp = P.xz * 13.0; float e = 0.06;
    float r0 = wgRings(rp, uTime), rx = wgRings(rp + vec2(e, 0.0), uTime), rz = wgRings(rp + vec2(0.0, e), uTime);
    Nw = normalize(Nw + vec3(r0 - rx, 0.0, r0 - rz) * 0.35 * min(g.a * 2.0, 1.0));
  }
  float ndv = max(dot(Nw, V), 0.0);
  float F = 0.04 + 0.96 * pow(1.0 - ndv, 3.2);
  vec3 R = reflect(-V, Nw); R.y = abs(R.y);
  float sh; vec3 irr = wtIrr(P, vec3(0.0, 1.0, 0.0), sh);
  /* what the surface mirrors: the planar mirror at the highest detail level, else a marched image of the land; the clouds always */
  vec3 sky = wtSky(P, R), refl;
  if (uReflOn > 0.5) {
    vec4 rp = uReflMat * vec4(P.x + Nw.x * 0.3, P.y, P.z + Nw.z * 0.3, 1.0);
    vec4 rt = texture2D(uReflTex, clamp(rp.xy / rp.w, 0.002, 0.998));
    refl = mix(rt.rgb, sky, step(300.0, rt.a));
  } else {
    vec4 m = wtMarch(P, R);
    refl = mix(sky, m.rgb, m.a * 0.9);
  }
  /* the body of water: clear in the shallows, opaque blue-green in the middle, murky after rain */
  vec3 albW = wtNight(mix(vec3(0.012, 0.158, 0.188), vec3(0.035, 0.1, 0.105), turb));
  float ext = mix(2.6, 5.5, turb);
  float cosT = sqrt(1.0 - (1.0 - ndv * ndv) / 1.77);
  float aBody = 1.0 - exp(-ext * max(d, 0.0) / max(cosT, 0.3));
  vec3 colW = albW * irr * aBody * (1.0 - F) + refl * F;
  float aW = 1.0 - (1.0 - F) * (1.0 - aBody);
  colW += wtGlint(P, Nw, V, sh);
  /* a thin line of foam lapping at the shore */
  float n1 = wgNoise(P.xz * 6.0);
  float lap = 0.003 + sin(uTime * 1.15 + n1 * 5.0 + P.x * 2.0) * 0.0028;
  float foam = smoothstep(0.013 + lap, 0.004 + lap, d) * smoothstep(-0.006, 0.003, d);
  foam *= smoothstep(0.42, 0.75, wgNoise(P.xz * 34.0 + vec2(uTime * 0.25, 0.0)) * 0.55 + n1 * 0.45 + 0.08);
  foam *= 0.7 * (1.0 - uLake.y);
  colW = mix(colW, vec3(0.86, 0.89, 0.9) * irr, foam); aW = mix(aW, 1.0, foam);
  aW *= smoothstep(-0.006, 0.003, d);
  colW *= smoothstep(-0.006, 0.003, d);
  /* ice */
  float iceK = wtLakeIce(P.xz, d);
  if (iceK > 0.001) {
    vec3 ic = wtIce(P, V, g.g, 1.0);
    float lines = 0.0, core = 0.0;
    for (int i = 0; i < ${NCRACK}; i++) {
      vec4 ck = uCrack[i]; float age = uTime - ck.z;
      if (age < 0.0 || age > 50.0) continue;
      vec2 st = wtStar(P.xz - ck.xy, ck.w * (0.55 + 0.45 * smoothstep(0.0, 0.15, age)), float(i) * 3.7 + ck.z);
      float fade = 1.0 - smoothstep(32.0, 50.0, age);
      lines = max(lines, st.x * fade); core = max(core, st.y * fade);
    }
    ic = mix(ic, ic * 0.22, lines);
    ic = mix(ic, irr * 0.95, core * 0.8);
    float ia = mix(0.86, 0.98, smoothstep(0.0, 0.3, d)) * smoothstep(-0.006, 0.0, d);
    colW = mix(colW, ic * ia, iceK); aW = mix(aW, ia, iceK);
  }
  col = colW; alpha = clamp(aW, 0.0, 1.0);`,
    }));
    lake = new THREE.Mesh(g, mat); lake.name = 'lake';
    WG.add(lake, { order: 1 });
  }

  /* ------------------------------------------------------------------ the lake cut by the front glass */
  function buildLakeFace() {
    const cols = [], zF = C.Z1 - 0.0035;
    for (let i = 0; i <= 240; i++) { const x = C.X0 + i * 0.05; if (x < -0.6 || x > 5.9) continue; const b = T.height(x, C.Z1); if (b < 0.4) cols.push([x, b]); }
    const pos = new Float32Array(cols.length * 6), nrm = new Float32Array(cols.length * 6), af = new Float32Array(cols.length * 4), idx = [];
    cols.forEach((c, i) => {
      pos.set([c[0], c[1] - 0.004, zF, c[0], 0.0, zF], i * 6); nrm.set([0, 0, 1, 0, 0, 1], i * 6); af.set([0, c[1], 1, c[1]], i * 4);
      if (i < cols.length - 1 && Math.abs(cols[i + 1][0] - c[0] - 0.05) < 1e-3) { const a = i * 2; idx.push(a, a + 2, a + 3, a, a + 3, a + 1); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); g.setAttribute('aFace', new THREE.BufferAttribute(af, 2)); g.setIndex(idx);
    const mat = WG.mat.unlit(matOpts({
      name: 'lakeFace', side: THREE.FrontSide,
      vertexDecl: 'attribute vec2 aFace; varying vec2 vFace;',
      vertexLocal: 'vFace = aFace; if (aFace.x > 0.5) pos.y = uLake.x + 0.03;',
      fragDecl: WT + 'varying vec2 vFace; uniform sampler2D uSceneTex;',
      uniforms: { uSceneTex: { value: WG.render.rtScene.texture } },
      frag: /* glsl */ `
  float lvl = uLake.x, turb = uLake.z;
  float dx = lvl - vFace.y;
  float iceK = wtLakeIce(vec2(P.x, ${f4(C.Z1 - 0.01)}), dx);
  float t = uWind.w * 0.9 + uTime * 0.35;
  float amp = 0.006 + 0.028 * smoothstep(0.05, 1.8, length(wgWindAt(vec3(P.x, lvl, 3.9))));
  float wav = ((wtWaveH(vec2(P.x, 3.96), t) - 0.5) * amp * 1.3 + sin(P.x * 5.0 - uTime * 1.3) * 0.0025 + sin(P.x * 13.0 + uTime * 2.1) * 0.0012) * (1.0 - iceK);
  float top = lvl + wav;
  if (P.y > top) discard;
  float dd = top - P.y;
  /* how far the view ray runs through the water before it meets the bed or the surface */
  vec3 rd = -V; float path = 4.0, tt = 0.0;
  for (int i = 0; i < 12; i++) { tt += 0.08 + tt * 0.25; vec3 p = P + rd * tt; if (p.y < wgHeight(p.xz) || p.y > lvl) { path = tt; break; } }
  float sceneD = texture2D(uSceneTex, gl_FragCoord.xy / uRes).a; path = min(path, max(sceneD - length(cameraPosition - P), 0.0));
  vec3 albW = wtNight(mix(vec3(0.03, 0.17, 0.19), vec3(0.035, 0.1, 0.105), turb));
  float sh; vec3 irr = wtIrr(vec3(P.x, lvl, P.z - 0.06), vec3(0.0, 1.0, 0.0), sh);
  float ext = mix(1.7, 4.0, turb);
  float lightD = exp(-dd * ext * 1.3);
  float a = mix(0.12, 0.8, 1.0 - exp(-path * ext * 0.95));
  a = mix(a, 0.9, smoothstep(0.06, 0.55, dd) * smoothstep(0.3, 1.2, path) * 0.6);
  vec3 scat = albW * irr * (0.12 + 0.88 * lightD) * mix(1.0, 0.3, iceK);
  /* slanting shafts of light that shift slowly */
  float slant = clamp(-uSunDir.x / max(uSunDir.y, 0.2), -2.5, 2.5);
  float sx = P.x + dd * slant;
  float shaft = smoothstep(0.5, 0.85, wgNoise(vec2(sx * 3.2 + uTime * 0.04, uTime * 0.05 + 3.0))) * (0.55 + 0.45 * wgNoise(vec2(sx * 9.0 - uTime * 0.07, 1.0)));
  shaft *= exp(-dd * 2.4) * smoothstep(0.0, 0.04, dd) * sh * (1.0 - iceK) * (1.0 - turb * 0.7);
  vec3 shaftC = (albW * 2.2 + vec3(0.05, 0.09, 0.09)) * uSunCol * shaft * 0.5;
  /* tiny drifting specks */
  vec2 sp = vec2(P.x * 70.0 + uTime * 0.35, P.y * 70.0 + sin(uTime * 0.3 + P.x * 2.0) * 1.2);
  vec2 sc = floor(sp); float hs = wgHash(sc);
  float speck = step(0.985, hs) * smoothstep(0.4, 0.1, length(fract(sp) - 0.5 - (wgHash2(sc) - 0.5) * 0.3)) * (0.5 + 0.5 * sin(uTime * 2.0 + hs * 40.0));
  vec3 speckC = irr * speck * 0.3 * lightD * (1.0 + turb);
  /* a bright, slightly wavy surface line with a darker band just beneath it */
  float lw = max(0.0035, fwidth(P.y) * 0.9);
  float line = exp(-pow(dd / lw, 2.0)) * (1.0 - iceK) * min(1.0, 0.0035 / lw * 1.6);
  float band = smoothstep(0.003, 0.012, dd) * smoothstep(0.06, 0.02, dd);
  scat *= 1.0 - 0.45 * band;
  vec3 c = scat * a + shaftC + speckC;
  float al = a + band * 0.3 * (1.0 - a);
  vec3 lineC = (irr * 0.6 + wgSkyEnv(vec3(0.0, 1.0, 0.0)) * 0.9 + uSunCol * sh * 0.25) * line * 1.3;
  c += lineC; al = al + line * 0.5 * (1.0 - al);
  /* from the side the ice is a pale band on top of dark water */
  float thick = 0.05 * iceK * (0.75 + 0.25 * wgNoise(vec2(P.x * 6.0, 2.0)));
  float inIce = smoothstep(thick + 0.002, thick - 0.002, dd) * step(0.001, thick);
  vec3 iceC = vec3(0.72, 0.8, 0.86) * irr * 0.85 * (0.85 + 0.15 * wgNoise(vec2(P.x * 30.0, P.y * 90.0)));
  iceC = mix(iceC, irr * 0.95, step(0.97, wgHash(floor(vec2(P.x, P.y) * 160.0))));
  c = mix(c, iceC * 0.97, inIce); al = mix(al, 0.97, inIce);
  col = c; alpha = al;`,
    }));
    lakeFace = new THREE.Mesh(g, mat); lakeFace.name = 'lakeFace';
    WG.add(lakeFace, { pass: 'B', order: -5 });
  }

  /* ------------------------------------------------------------------ the spring and the river (one ribbon geometry) */
  function buildStreams() {
    const P = [], A = [], A2 = [], I = []; const NJ = 5; let base = 0;
    const ribbon = (pts) => {
      for (let i = 0; i < pts.length; i++) {
        const q = pts[i];
        for (let j = 0; j < NJ; j++) {
          const f = (j / (NJ - 1)) * 2 - 1, off = f * q.hw;
          P.push(q.x - q.tz * off, q.y, q.z + q.tx * off);
          A.push(q.al, off, q.steep, q.s); A2.push(q.w * 0.5, q.tx, q.tz, 0);
        }
        if (i < pts.length - 1) for (let j = 0; j < NJ - 1; j++) { const a = base + i * NJ + j, b = a + 1, c = a + NJ, d = c + 1; I.push(a, b, c, b, d, c); }
      }
      base += pts.length * NJ;
    };
    /* river: from the pool to the lake */
    const rp = RIV.pts.map((q) => ({ x: q.x, z: q.z, y: q.y, tx: q.tx, tz: q.tz, w: q.w, hw: q.w * 0.5 + 0.075, steep: q.steep, s: q.s, al: q.s * RIV.len }));
    ribbon(rp);
    /* spring: from where it rises on the shelf to the lip of the cliff */
    const sp = [], n = 14, z0 = FALL.springZ, z1 = FG.z0;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), z = U.lerp(z0, z1, t), x = FALL.springX + Math.sin(t * 5.5) * 0.008 * (1 - t);
      sp.push({ x, z, y: T.height(x, z) + 0.016, tx: 0, tz: 1, w: U.lerp(0.06, 0.12, t), hw: U.lerp(0.045, 0.075, t), steep: 0.15, s: -1, al: t * (z1 - z0) });
    }
    sp[n - 1].y = FG.y0;
    ribbon(sp);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
    g.setAttribute('aR', new THREE.BufferAttribute(new Float32Array(A), 4)); g.setAttribute('aR2', new THREE.BufferAttribute(new Float32Array(A2), 4));
    g.setIndex(I); g.computeVertexNormals();
    const nr = g.attributes.normal; for (let i = 0; i < nr.count; i++) if (nr.getY(i) < 0) nr.setXYZ(i, -nr.getX(i), -nr.getY(i), -nr.getZ(i));
    const mat = WG.mat.unlit(matOpts({
      name: 'streams', side: THREE.DoubleSide,
      vertexDecl: 'attribute vec4 aR; attribute vec4 aR2; varying vec4 vR; varying vec4 vR2;',
      vertexWorld: 'vR = aR; vR2 = aR2; w.y += (uLake.w - 1.0) * 0.014 * step(-0.5, aR.w);',
      fragDecl: WT + /* glsl */ `
varying vec4 vR; varying vec4 vR2;
float wtRiverH(vec2 q, float ft, float steep){
  return wgNoise(vec2(q.x * 7.0 - ft * 7.0, q.y * 15.0)) * 0.6 + wgNoise(vec2(q.x * 16.0 - ft * 16.0, q.y * 31.0 + 2.0)) * 0.4
       + wgNoise(vec2(q.x * 26.0 - ft * 40.0, q.y * 26.0 + 7.0)) * steep * 0.8;
}`,
      frag: /* glsl */ `
  float s = vR.w, along = vR.x, acr = vR.y, steep = vR.z, hw = vR2.x; vec2 fd = vR2.yz;
  float spring = 1.0 - step(-0.5, s);
  float bed = wgHeight(P.xz), d = P.y - bed;
  float fade = 1.0 - smoothstep(0.84, 0.97, s) * (1.0 - spring);
  fade *= 1.0 - smoothstep(0.0, 0.008, uLake.x - P.y) * step(0.5, s);
  fade *= mix(smoothstep(0.06, 0.24, along), smoothstep(0.0, 0.05, along), spring);
  if (fade < 0.004 || d < -0.03) discard;
  float flow = uLake.w, ft = uWat.x, turb = uLake.z;
  float an = abs(acr) / max(hw, 0.01);
  /* ripples travelling downstream */
  vec2 q = vec2(along, acr); float e = 0.01;
  float h0 = wtRiverH(q, ft, steep), ha = wtRiverH(q + vec2(e, 0.0), ft, steep), hc = wtRiverH(q + vec2(0.0, e), ft, steep);
  float amp = 0.005 + 0.012 * steep + 0.004 * (flow - 1.0) + 0.004 * spring;
  vec2 grad = amp * ((ha - h0) / e * fd + (hc - h0) / e * vec2(-fd.y, fd.x));
  vec3 N0 = normalize(vN); if (N0.y < 0.0) N0 = -N0;
  vec3 Nw = normalize(N0 + vec3(-grad.x, 0.0, -grad.y));
  vec4 g = wgGround(P.xz);
  if (g.a > 0.02) {
    vec2 rp = P.xz * 13.0 - fd * ft * 4.0; float er = 0.06;
    float r0 = wgRings(rp, uTime), rx = wgRings(rp + vec2(er, 0.0), uTime), rz = wgRings(rp + vec2(0.0, er), uTime);
    Nw = normalize(Nw + vec3(r0 - rx, 0.0, r0 - rz) * 0.3 * min(g.a * 2.0, 1.0));
  }
  /* white foam streaks on the steeper steps, froth at the banks, thin lines of bubbles */
  float st = wgNoise(vec2(along * 2.2 - ft * 2.6, acr * 26.0)) * 0.65 + wgNoise(vec2(along * 6.0 - ft * 6.5, acr * 45.0 + 4.0)) * 0.35;
  float foamAmt = clamp(steep * 0.55 + (flow - 1.0) * 0.45 + spring * 0.2, 0.0, 1.4);
  float foam = smoothstep(0.8 - 0.3 * foamAmt, 0.96 - 0.28 * foamAmt, st) * min(foamAmt * 1.2, 1.0);
  foam = max(foam, smoothstep(0.8, 1.05, an) * 0.35 * (0.5 + 0.5 * wgNoise(vec2(along * 9.0 - ft * 5.0, acr * 9.0))));
  float lane = acr * 38.0 + wgNoise(vec2(along * 1.5, 1.0)) * 2.0, li = floor(lane), lh = wgHash(vec2(li, 5.0));
  float dash = smoothstep(0.38, 0.75, wgNoise(vec2(along * 10.0 - ft * 10.0 + lh * 20.0, li)));
  float bub = step(0.8, lh) * smoothstep(0.32, 0.0, abs(fract(lane) - 0.5)) * dash * (1.0 - min(an, 1.0) * 0.6) * (1.0 - spring);
  /* clear teal over the pebbly bed */
  vec3 albW = wtNight(mix(vec3(0.02, 0.15, 0.15), vec3(0.04, 0.105, 0.105), turb));
  float a = 1.0 - exp(-max(d, 0.0) * mix(10.0, 20.0, turb));
  a = max(a, 0.3) * smoothstep(-0.008, 0.01, d);
  float sh; vec3 irr = wtIrr(P, vec3(0.0, 1.0, 0.0), sh);
  float ndv = max(dot(Nw, V), 0.0), F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 R = reflect(-V, Nw); R.y = abs(R.y);
  vec3 refl = wtSky(P, R);
  vec3 colW = albW * irr * a * (1.0 - F) + refl * F * smoothstep(-0.008, 0.01, d);
  float aW = 1.0 - (1.0 - F * smoothstep(-0.008, 0.01, d)) * (1.0 - a);
  colW += wtGlint(P, Nw, V, sh);
  float fk = clamp(foam * 0.9 + bub * 0.75, 0.0, 1.0) * smoothstep(-0.01, 0.004, d);
  colW = mix(colW, vec3(0.86, 0.9, 0.9) * irr, fk); aW = mix(aW, 1.0, fk);
  /* ice creeping in from the banks */
  float ni = wgNoise(P.xz * 7.0);
  float iceK = smoothstep(0.0, 0.1, uWat.z * 1.2 - (1.0 - min(an, 1.0)) - (ni - 0.5) * 0.3) * step(0.001, uWat.z);
  if (spring > 0.5) iceK = max(iceK, smoothstep(0.2, 0.7, uWat.w + uWat.z * 0.4));
  if (iceK > 0.001) { vec3 ic = wtIce(P, V, g.g, 0.5); colW = mix(colW, ic * 0.95, iceK); aW = mix(aW, 0.95, iceK); }
  col = colW * fade; alpha = clamp(aW, 0.0, 1.0) * fade;`,
    }));
    streams = new THREE.Mesh(g, mat); streams.name = 'streams';
    WG.add(streams, { order: 1 });
  }

  /* ------------------------------------------------------------------ the plunge pool: churning foam, or a snowy mound when the fall freezes */
  function buildPool() {
    const g = new THREE.CircleGeometry(POOL.r * 1.1, 48, 0, Math.PI * 2); g.rotateX(-Math.PI / 2); g.translate(POOL.x, POOL.y, POOL.z);
    const mat = WG.mat.unlit(matOpts({
      name: 'pool', side: THREE.DoubleSide,
      vertexDecl: 'uniform vec4 uWat;',
      vertexWorld: /* glsl */ `
  vec2 mq = w.xz - vec2(${f4(IMPACT.x)}, ${f4(IMPACT.z + 0.12)}); float m2 = dot(mq, mq) / 0.17;
  float mh = uWat.w * 0.14 * max(0.0, 1.0 - m2) * (1.0 - m2 * 0.3);
  w.y += mh + 0.002;
  vec2 gm = -uWat.w * 0.14 * 2.0 * mq / 0.17 * step(m2, 1.0);
  wn = normalize(vec3(-gm.x, 1.0, -gm.y));`,
      fragDecl: WT,
      frag: /* glsl */ `
  float d = ${f4(POOL.y)} - wgHeight(P.xz);
  if (d < -0.03) discard;
  float flow = uLake.w, ft = uWat.y, ice = uWat.w, turb = uLake.z;
  vec2 ip = P.xz - vec2(${f4(IMPACT.x)}, ${f4(IMPACT.z)}); float rr = length(ip), ang = atan(ip.y, ip.x);
  float pd = length(P.xz - vec2(${f4(POOL.x)}, ${f4(POOL.z)})) / ${f4(POOL.r)};
  float fadeOut = (1.0 - smoothstep(0.86, 1.06, pd)) * smoothstep(-0.003, 0.008, d);
  /* churning, spreading foam, densest where the fall lands */
  float swirl = wgNoise(vec2(rr * 14.0 - ft * 1.3, ang * 2.5 + ft * 0.15)) * 0.55 + wgNoise(P.xz * 30.0 + vec2(ft * 0.7, -ft * 0.5)) * 0.45;
  float core = smoothstep(0.3 + 0.07 * flow, 0.0, rr);
  float rings = (0.5 + 0.5 * sin((rr - ft * 0.09) * 70.0)) * smoothstep(0.42, 0.06, rr);
  float foam = smoothstep(0.78 - core * 0.6 - (flow - 1.0) * 0.18, 0.96 - core * 0.45, swirl + rings * 0.18) * (1.0 - ice);
  float e = 0.012;
  float h0 = swirl + rings * 0.3;
  float hx = wgNoise(vec2(length(ip + vec2(e, 0.0)) * 14.0 - ft * 1.3, ang * 2.5 + ft * 0.15)) * 0.55 + wgNoise((P.xz + vec2(e, 0.0)) * 30.0 + vec2(ft * 0.7, -ft * 0.5)) * 0.45;
  float hz = wgNoise(vec2(length(ip + vec2(0.0, e)) * 14.0 - ft * 1.3, ang * 2.5 + ft * 0.15)) * 0.55 + wgNoise((P.xz + vec2(0.0, e)) * 30.0 + vec2(ft * 0.7, -ft * 0.5)) * 0.45;
  float amp = (0.008 + 0.012 * core) * (0.7 + 0.3 * flow);
  vec3 Nw = normalize(vec3((swirl - hx) / e * amp, 1.0, (swirl - hz) / e * amp));
  vec3 albW = wtNight(mix(vec3(0.04, 0.17, 0.17), vec3(0.04, 0.105, 0.105), turb));
  float a = (1.0 - exp(-max(d, 0.0) * mix(9.0, 20.0, turb))) * smoothstep(-0.01, 0.01, d);
  float sh; vec3 irr = wtIrr(P, vec3(0.0, 1.0, 0.0), sh);
  float ndv = max(dot(Nw, V), 0.0), F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 R = reflect(-V, Nw); R.y = abs(R.y);
  vec3 colW = albW * irr * a * (1.0 - F) + wtSky(P, R) * F;
  float aW = 1.0 - (1.0 - F) * (1.0 - a);
  colW += wtGlint(P, Nw, V, sh);
  colW = mix(colW, vec3(0.88, 0.91, 0.92) * irr, foam * 0.95); aW = mix(aW, 1.0, foam * 0.95);
  colW *= fadeOut; aW *= fadeOut;
  /* frozen: a snowy mound */
  float snowM = smoothstep(0.35, 0.8, ice);
  if (snowM > 0.001) {
    vec3 Ns = normalize(vN); if (Ns.y < 0.0) Ns = -Ns;
    float sn = wgNoise(P.xz * 23.0) * 0.5 + wgNoise(P.xz * 61.0) * 0.5;
    Ns = normalize(Ns + vec3(sn - 0.5, 0.0, wgNoise(P.xz * 23.0 + 5.0) - 0.5) * 0.12);
    vec3 sc = wgShade(P, Ns, V, vec3(0.88, 0.9, 0.93), 0.85, 0.03, 0.0, 1.0, 0.0, 1.0);
    sc += step(0.994, wgHash(floor(P.xz * 190.0) + floor(dot(V, vec3(7.0, 3.0, 5.0)) * 6.0))) * uSunCol * 1.5 * max(dot(Ns, uSunDir), 0.0);
    float sa = smoothstep(-0.02, 0.01, d) * (1.0 - smoothstep(0.92, 1.08, pd));
    colW = mix(colW, sc * sa, snowM); aW = mix(aW, sa, snowM);
  }
  col = colW; alpha = clamp(aW, 0.0, 1.0);`,
    }));
    pool = new THREE.Mesh(g, mat); pool.name = 'pool';
    WG.add(pool, { order: 2 });
  }

  /* ------------------------------------------------------------------ the waterfall */
  function buildFall() {
    const nu = 10, nv = 32, pos = [], af = [], idx = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { pos.push(0, 0, 0); af.push((i / nu) * 2 - 1, j / nv); }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3)); g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(pos.length).fill(0), 3));
    g.setAttribute('aF', new THREE.BufferAttribute(new Float32Array(af), 2)); g.setIndex(idx);
    const mat = WG.mat.unlit(matOpts({
      name: 'fall', side: THREE.DoubleSide,
      uniforms: { uFallG: { value: new V4(FG.y0, FG.z0, FG.H, FG.c) }, uCalm: { value: WG.reducedMotion ? 0.3 : 1 } },
      vertexDecl: 'attribute vec2 aF; varying vec2 vF; uniform vec4 uFallG; uniform float uCalm; uniform vec4 uWat;',
      vertexLocal: /* glsl */ `
  float fu = aF.x, fv = aF.y; vF = aF;
  float flow = uLake.w, fice = uWat.w;
  float hw = mix(0.07, 0.125, smoothstep(0.0, 0.25, fv)) * (0.8 + 0.2 * min(flow, 2.4)) * (1.0 + 0.3 * fv) * mix(1.0, 1.1, fice);
  float cz = uFallG.w * (0.8 + 0.2 * min(flow, 2.0));
  pos = vec3(${f4(FALL.x)} + fu * hw, uFallG.x - uFallG.z * fv * fv, uFallG.y + cz * fv);
  nrm = normalize(vec3(0.0, cz, 2.0 * uFallG.z * fv));`,
      vertexWorld: /* glsl */ `
  vec2 wnd = wgWindAt(w.xyz); float flut = (1.0 - uWat.w) * uCalm;
  w.x += (wnd.x * 0.035 * fv * fv + sin(uTime * 7.0 + fv * 11.0 + fu) * 0.004 * fv) * flut;
  w.z += (wnd.y * 0.035 * fv * fv + sin(uTime * 5.3 + fv * 8.0) * 0.003 * fv) * flut;`,
      fragDecl: WT + 'varying vec2 vF;',
      frag: /* glsl */ `
  float u = vF.x, v = vF.y, flow = uLake.w, fice = uWat.w, ft = uWat.y, au = abs(u);
  vec3 Nf = normalize(vN); if (dot(Nf, V) < 0.0) Nf = -Nf;
  /* freezing grows from the edges and the top; ragged icicle tips at the foot */
  float n0 = wgNoise(vec2(u * 3.0, v * 4.0));
  float iceK = smoothstep(0.0, 0.12, fice * 1.35 - (1.0 - au) * 0.35 - v * 0.45 - n0 * 0.2) * step(0.001, fice);
  float fl = u * 4.5 + 4.5, fi = floor(fl), ff = fract(fl);
  float tip = 1.0 - fice * (0.08 + (0.14 + 0.3 * wgHash(vec2(fi, 2.0))) * (1.0 - (1.0 - abs(ff * 2.0 - 1.0)) * 0.85));
  if (v > tip && iceK > 0.5) discard;
  float edgeN = wgNoise(vec2(v * 9.0 - ft * 1.4, u > 0.0 ? 1.0 : 7.0));
  float edge = 1.0 - smoothstep(0.45 + 0.42 * edgeN, 0.98, au);
  /* strands of white foam sliding down; whiter when the river is full */
  float s1 = wgNoise(vec2(u * 5.0 + 1.7, v * 2.6 - ft));
  float s2 = wgNoise(vec2(u * 11.0, v * 5.0 - ft * 1.5));
  float s3 = wgNoise(vec2(u * 23.0, v * 10.0 - ft * 2.2));
  float strands = s1 * 0.5 + s2 * 0.32 + s3 * 0.18;
  float brk = smoothstep(0.07, 0.36, v);
  float white = clamp(0.15 + 0.4 * (flow - 1.0), 0.0, 0.8);
  float foam = smoothstep(0.5 - white * 0.25, 0.64 - white * 0.2, strands + 0.04 * brk) * brk;
  foam = max(foam, smoothstep(0.86, 1.0, v) * 0.7);
  float gaps = mix(1.0, smoothstep(0.3, 0.5, strands + white * 0.25), smoothstep(0.3, 0.8, v));
  float sh; vec3 irr = wtIrr(P, Nf, sh);
  /* the smooth, dark, glassy tongue at the lip */
  vec3 Ng = normalize(Nf + vec3(u * 0.7 + (s3 - 0.5) * 0.3, 0.0, 0.0));
  float ndv = max(dot(Ng, V), 0.0), F = 0.04 + 0.96 * pow(1.0 - ndv, 4.0);
  vec3 R = reflect(-V, Ng);
  float streak = smoothstep(0.55, 0.9, wgNoise(vec2(u * 18.0, v * 1.5 - ft * 0.8)));
  vec3 glassC = vec3(0.02, 0.06, 0.065) * irr + wgSkyEnv(R) * (F + streak * 0.3) + wtGlint(P, Ng, V, sh) * 0.5;
  vec3 foamC = wgShade(P, Nf, V, vec3(0.92, 0.94, 0.95), 0.7, 0.03, 0.0, 1.0, 0.55, 1.0) + (uSkyCol * 0.9 + uEnvCol * 0.25) * 0.9;
  vec3 c = mix(glassC, foamC, foam);
  float a = mix(0.7, 0.97, foam) * gaps * edge;
  /* a fluted blue-white ice curtain */
  float ph = u * 3.14159 * 4.5 + n0 * 1.2;
  vec3 Ni = normalize(Nf + vec3(cos(ph) * 0.45, 0.0, 0.0));
  vec3 iceAlb = mix(vec3(0.52, 0.7, 0.82), vec3(0.86, 0.92, 0.96), clamp(0.5 + 0.3 * sin(ph) + (wgNoise(vec2(u * 20.0, v * 3.0)) - 0.5) * 0.4 + v * 0.15, 0.0, 1.0));
  vec3 iceC = wgShade(P, Ni, V, iceAlb, 0.2, 0.05, 0.0, 1.0, 0.35, 1.0) + wgSkyEnv(reflect(-V, Ni)) * 0.18;
  float iceA = 0.96 * (1.0 - smoothstep(0.88, 1.0, au));
  c = mix(c, iceC, iceK); a = mix(a, iceA, iceK);
  col = c * a; alpha = a;`,
    }));
    fall = new THREE.Mesh(g, mat); fall.name = 'fall';
    WG.add(fall, { order: 3 });
  }

  /* ------------------------------------------------------------------ rings: one recycled pool of instanced quads */
  const rA = new Float32Array(NRING * 4), rB = new Float32Array(NRING * 4); let ringNext = 0, ringDirty = false;
  for (let i = 0; i < NRING; i++) { rA[i * 4 + 2] = -999; rB[i * 4 + 3] = 1; }
  function buildRings() {
    const base = new THREE.PlaneGeometry(2, 2); base.rotateX(-Math.PI / 2);
    const g = new THREE.InstancedBufferGeometry(); g.index = base.index; g.setAttribute('position', base.attributes.position); g.setAttribute('normal', base.attributes.normal); g.setAttribute('uv', base.attributes.uv);
    g.setAttribute('aA', new THREE.InstancedBufferAttribute(rA, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aB', new THREE.InstancedBufferAttribute(rB, 4).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = NRING;
    const mat = WG.mat.unlit(matOpts({
      name: 'rings', side: THREE.DoubleSide,
      vertexDecl: 'attribute vec4 aA; attribute vec4 aB; varying vec4 vRg; varying vec2 vQ;',
      vertexLocal: /* glsl */ `
  float age = uTime - aA.z, f = age / aB.w;
  float live = step(0.0, f) * step(f, 1.0);
  float Rr = aA.w * (0.12 + 0.88 * (1.0 - (1.0 - clamp(f, 0.0, 1.0)) * (1.0 - clamp(f, 0.0, 1.0))));
  float ext = (Rr * 1.15 + 0.012 + aA.w * 0.05) * live;
  vQ = pos.xz * ext; vRg = vec4(clamp(f, 0.0, 1.0), Rr, aA.w, live);
  pos = vec3(aA.x + aB.x * age + vQ.x, aB.z + 0.0025, aA.y + aB.y * age + vQ.y);`,
      fragDecl: WT + 'varying vec4 vRg; varying vec2 vQ;',
      frag: /* glsl */ `
  if (vRg.w < 0.5) discard;
  float f = vRg.x, Rr = vRg.y, sz = vRg.z, r = length(vQ);
  float wdt = 0.0035 + sz * 0.06 * (0.3 + f);
  float x = (r - Rr) / wdt;
  float crest = exp(-x * x), trough = exp(-(x + 1.7) * (x + 1.7)) + exp(-(x - 1.7) * (x - 1.7)) * 0.5;
  float x2 = (r - Rr * 0.62) / (wdt * 0.8);
  float inner = exp(-x2 * x2) * smoothstep(0.12, 0.3, sz) * 0.7;
  float k = (1.0 - f) * (1.0 - f) * mix(0.75, 1.0, smoothstep(0.03, 0.3, sz)) * (1.0 - uLake.y * 0.8);
  float sh; vec3 irr = wtIrr(P, vec3(0.0, 1.0, 0.0), sh);
  vec3 env = wgSkyEnv(normalize(vec3(V.x, abs(V.y) + 0.3, V.z))) * 0.75 + uSunCol * sh * 0.06;
  col = env * (crest + inner) * k * 0.9;
  alpha = clamp((crest + inner) * 0.12 + trough * 0.32, 0.0, 1.0) * k;`,
    }));
    rings = new THREE.Mesh(g, mat); rings.name = 'rings';
    WG.add(rings, { order: 4 });
  }
  function addRing(x, y, z, size, life, vx, vz, delay) {
    const k = ringNext; ringNext = (ringNext + 1) % NRING;
    rA[k * 4] = x; rA[k * 4 + 1] = z; rA[k * 4 + 2] = WG.time + (delay || 0); rA[k * 4 + 3] = size;
    rB[k * 4] = vx || 0; rB[k * 4 + 1] = vz || 0; rB[k * 4 + 2] = y; rB[k * 4 + 3] = life;
    ringDirty = true;
  }

  /* ------------------------------------------------------------------ splash crowns with a little jet */
  const cS = new Float32Array(NSPL * 4), cT = new Float32Array(NSPL * 4); let splNext = 0, splDirty = false;
  for (let i = 0; i < NSPL; i++) cS[i * 4 + 3] = -999;
  function buildCrowns() {
    const P = [], N = [], part = [], I = []; const MS = 20;
    /* crown: an open tube that flares into a zigzag of spikes */
    for (let j = 0; j <= MS; j++) {
      const a = (j / MS) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), spike = j % 2 === 0 ? 1 : 0.55;
      const rows = [[1, 0], [1.05, 0.5], [1.22, spike]];
      for (const r of rows) { P.push(c * r[0], r[1], s * r[0]); N.push(c, 0.25, s); part.push(0); }
    }
    for (let j = 0; j < MS; j++) for (let r = 0; r < 2; r++) { const a = j * 3 + r, b = a + 3; I.push(a, b, a + 1, a + 1, b, b + 1); }
    /* jet: a slim column with a rounded top */
    const b0 = P.length / 3, K = 6;
    for (let j = 0; j <= K; j++) { const a = (j / K) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a); P.push(c, 0, s, c * 0.7, 0.85, s * 0.7); N.push(c, 0, s, c, 0.4, s); part.push(1, 1); }
    P.push(0, 1, 0); N.push(0, 1, 0); part.push(1); const top = b0 + (K + 1) * 2;
    for (let j = 0; j < K; j++) { const a = b0 + j * 2; I.push(a, a + 2, a + 1, a + 1, a + 2, a + 3, a + 1, a + 3, top); }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3)); g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N), 3));
    g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(part), 1)); g.setIndex(I);
    g.setAttribute('aS', new THREE.InstancedBufferAttribute(cS, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aT', new THREE.InstancedBufferAttribute(cT, 4).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = NSPL;
    const mat = WG.mat.unlit(matOpts({
      name: 'crowns', side: THREE.DoubleSide,
      vertexDecl: 'attribute float aPart; attribute vec4 aS; attribute vec4 aT; varying vec3 vSp;',
      vertexLocal: /* glsl */ `
  float age = uTime - aS.w, sz = aT.x;
  float on = step(0.0, age) * step(age, 1.3);
  vec3 cc = aS.xyz + vec3(aT.y, 0.0, aT.z) * age;
  float k, fade;
  if (aPart < 0.5) {
    k = clamp(age / 0.5, 0.0, 1.0);
    float Rr = sz * (0.025 + 0.085 * sqrt(k)), Hh = sz * 0.13 * sin(3.14159 * k) * (0.7 + 0.3 * k);
    pos = vec3(pos.x * Rr, pos.y * Hh, pos.z * Rr);
    fade = 1.0 - smoothstep(0.6, 1.0, k);
  } else {
    k = clamp((age - 0.16) / 0.62, 0.0, 1.0);
    float Hh = sz * 0.22 * sin(3.14159 * k), rr = sz * 0.013;
    pos = vec3(pos.x * rr, pos.y * Hh, pos.z * rr);
    fade = step(0.001, k) * (1.0 - smoothstep(0.75, 1.0, k));
  }
  pos = pos * on + cc;
  vSp = vec3(fade * on, aPart, k);`,
      fragDecl: WT + 'varying vec3 vSp;',
      frag: /* glsl */ `
  if (vSp.x < 0.01) discard;
  vec3 Nc = normalize(vN); if (dot(Nc, V) < 0.0) Nc = -Nc;
  float sh; vec3 irr = wtIrr(P, Nc, sh);
  float ndv = max(dot(Nc, V), 0.0), F = 0.05 + 0.95 * pow(1.0 - ndv, 4.0);
  vec3 c = vec3(0.7, 0.8, 0.82) * irr * 0.7 + wgSkyEnv(reflect(-V, Nc)) * F + wtGlint(P, Nc, V, sh) * 0.4;
  float a = (0.45 + 0.35 * F) * vSp.x;
  col = c * a; alpha = a;`,
    }));
    crowns = new THREE.Mesh(g, mat); crowns.name = 'splashCrowns';
    WG.add(crowns, { order: 5 });
  }

  /* ------------------------------------------------------------------ droplets: spray at the foot of the fall and splash drops */
  const D = { x: new Float32Array(NDROP), y: new Float32Array(NDROP), z: new Float32Array(NDROP), vx: new Float32Array(NDROP), vy: new Float32Array(NDROP), vz: new Float32Array(NDROP), life: new Float32Array(NDROP), max: new Float32Array(NDROP), size: new Float32Array(NDROP), floor: new Float32Array(NDROP), kind: new Uint8Array(NDROP) };
  let dropNext = 0; const dPos = new Float32Array(NDROP * 3), dDat = new Float32Array(NDROP * 4);
  function buildDrops() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(dPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(NDROP * 3).fill(0.577), 3));
    g.setAttribute('aD', new THREE.BufferAttribute(dDat, 4).setUsage(THREE.DynamicDrawUsage));
    const mat = WG.mat.unlit(matOpts({
      name: 'droplets', uniforms: { uPx: { value: 1 } },
      vertexDecl: 'attribute vec4 aD; varying vec4 vD; uniform float uPx;',
      vertexEnd: 'vD = aD; gl_PointSize = max(1.0, aD.y * uPx / gl_Position.w); if (aD.x <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);',
      fragDecl: WT + 'varying vec4 vD;',
      frag: /* glsl */ `
  vec2 q = gl_PointCoord * 2.0 - 1.0; float r = dot(q, q); if (r > 1.0) discard;
  float sh; vec3 irr = wtIrr(P, vec3(0.0, 1.0, 0.0), sh);
  float back = pow(max(dot(-V, uSunDir), 0.0), 6.0);
  vec3 c = mix(vec3(0.8, 0.86, 0.88), vec3(0.95), vD.z) * irr * 0.8 + uSunCol * sh * back * 1.6;
  float a = (1.0 - r) * (1.0 - r) * smoothstep(0.0, 0.25, vD.x) * mix(0.75, 0.95, vD.z);
  col = c * a; alpha = a;`,
    }));
    drops = new THREE.Points(g, mat); drops.name = 'droplets';
    WG.add(drops, { order: 6 });
  }
  function emitDrop(x, y, z, vx, vy, vz, life, size, floorY, kind) {
    const i = dropNext; dropNext = (dropNext + 1) % NDROP;
    D.x[i] = x; D.y[i] = y; D.z[i] = z; D.vx[i] = vx; D.vy[i] = vy; D.vz[i] = vz; D.life[i] = life; D.max[i] = life; D.size[i] = size; D.floor[i] = floorY; D.kind[i] = kind || 0;
  }

  /* ------------------------------------------------------------------ mist: soft billboards drifting round the pool and over splashes */
  const mA = new Float32Array(NMIST * 4), mB = new Float32Array(NMIST * 4);
  const M = []; for (let i = 0; i < NMIST; i++) M.push({ x: 0, y: -50, z: 0, size: 0.2, a: 0, t: Math.random() * 6, life: 5 + Math.random() * 3, vx: 0, vy: 0, vz: 0, grow: 0, kind: i < 7 ? 0 : 1, peak: 0, seed: Math.random() * 50 });
  let mistNext = 7;
  function buildMist() {
    const base = new THREE.PlaneGeometry(2, 2);
    const g = new THREE.InstancedBufferGeometry(); g.index = base.index; g.setAttribute('position', base.attributes.position); g.setAttribute('normal', base.attributes.normal); g.setAttribute('uv', base.attributes.uv);
    g.setAttribute('aM', new THREE.InstancedBufferAttribute(mA, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aM2', new THREE.InstancedBufferAttribute(mB, 4).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = NMIST;
    const mat = WG.mat.unlit(matOpts({
      name: 'mist', side: THREE.DoubleSide,
      vertexDecl: 'attribute vec4 aM; attribute vec4 aM2; varying vec4 vM;',
      vertexWorld: 'vec3 cr = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), cu = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]); w.xyz = aM.xyz + (cr * pos.x + cu * pos.y) * aM.w; vM = aM2;',
      fragDecl: WT + 'varying vec4 vM;',
      frag: /* glsl */ `
  if (vM.x < 0.003) discard;
  vec2 q = vUv * 2.0 - 1.0; float r = length(q);
  float n = wgNoise(q * 2.2 + vM.y + uTime * 0.12) * 0.6 + wgNoise(q * 5.0 - vM.y - uTime * 0.2) * 0.4;
  float a = smoothstep(1.0, 0.15, r + (n - 0.5) * 0.5) * vM.x;
  float sh; vec3 irr = wtIrr(P, vec3(0.0, 1.0, 0.0), sh);
  float back = pow(max(dot(-V, uSunDir), 0.0), 4.0);
  vec3 c = vec3(0.82, 0.86, 0.88) * (irr * 0.85 + uSunCol * sh * back * 0.8);
  col = c * a; alpha = a;`,
    }));
    mists = new THREE.Mesh(g, mat); mists.name = 'mist';
    WG.add(mists, { order: 7 });
  }

  /* ------------------------------------------------------------------ icicles along the cliff lip */
  function buildIcicles() {
    const rnd = U.rng(48117), iA = new Float32Array(NICE * 4), iB = new Float32Array(NICE * 4);
    for (let k = 0, guard = 0; k < NICE && guard < 400; guard++) {
      const x = FALL.x - 0.6 + rnd() * 1.2;
      if (Math.abs(x - FALL.x) < 0.15) continue;
      const hTop = T.height(x, FALL.zLip - 0.12); let zl = FALL.zLip;
      for (let z = FALL.zLip - 0.15; z < FALL.zLip + 0.15; z += 0.005) if (T.height(x, z) < hTop - 0.06) { zl = z; break; }
      const y = T.height(x, zl - 0.02);
      if (y < FALL.yTop - 0.25) continue;
      iA.set([x, y - 0.004, zl + 0.012, 0.05 + Math.pow(rnd(), 1.6) * 0.2], k * 4); iB.set([0.008 + rnd() * 0.01, rnd(), 0, 0], k * 4); k++;
    }
    const base = new THREE.ConeGeometry(1, 1, 6, 1); base.rotateX(Math.PI); base.translate(0, -0.5, 0);
    const g = new THREE.InstancedBufferGeometry(); g.index = base.index; g.setAttribute('position', base.attributes.position); g.setAttribute('normal', base.attributes.normal); g.setAttribute('uv', base.attributes.uv);
    g.setAttribute('aI', new THREE.InstancedBufferAttribute(iA, 4)); g.setAttribute('aI2', new THREE.InstancedBufferAttribute(iB, 4));
    g.instanceCount = NICE;
    const mat = WG.mat.lit({
      name: 'icicles', shadow: false, env: 'sky', uniforms: { uGrow: { value: 0 } },
      vertexDecl: 'attribute vec4 aI; attribute vec4 aI2; uniform float uGrow;',
      vertexLocal: 'float gr = clamp(uGrow * 1.6 - aI2.y * 0.6, 0.0, 1.0); pos = vec3(pos.x * aI2.x * (0.4 + 0.6 * gr), pos.y * aI.w * gr, pos.z * aI2.x * (0.4 + 0.6 * gr)) + aI.xyz;',
      frag: 'albedo = vec3(0.62, 0.76, 0.86); rough = 0.12; spec = 0.06; trans = 0.5;',
    });
    icicles = new THREE.Mesh(g, mat); icicles.name = 'icicles'; icicles.visible = false;
    WG.add(icicles, {});
  }

  /* ------------------------------------------------------------------ queries */
  function surfaceY(x, z) {
    const k = T.waterAt(x, z);
    if (k === 'lake') { const w = S.wind.speed, t = WG.time; return S.lakeLevel + (Math.sin(x * 7.1 + t * 1.9) * Math.cos(z * 6.3 - t * 1.4) * 0.0025 + Math.sin(x * 2.3 - t * 0.8) * 0.0015) * (0.5 + Math.min(1.5, w)) * (1 - S.ice); }
    if (k === 'pool') return POOL.y;
    if (k === 'river') return T.riverInfo(x, z).y + (S.flow - 1) * 0.014;
    return null;
  }
  function iceAt(x, z) {
    const k = T.waterAt(x, z);
    if (k === 'lake') { const d = S.lakeLevel - T.height(x, z); return S.ice > 0 ? U.sat((S.ice * 1.25 - d + 0.02) / 0.05) : 0; }
    if (k === 'river') { const ri = T.riverInfo(x, z), an = Math.abs(ri.side) / (ri.w * 0.5 + 0.075); return S.riverIce > 0 ? U.sat((S.riverIce * 1.2 - (1 - Math.min(an, 1))) / 0.1) : 0; }
    if (k === 'pool') return U.smooth(0.35, 0.8, S.fallIce);
    return 0;
  }
  const flowVel = (x, z, out) => { const ri = T.riverInfo(x, z), p = RIV.pts[ri.i], sp = 0.32 * S.flow * (1 + 1.2 * p.steep) * (1 - 0.9 * S.riverIce); out.x = p.tx * sp; out.z = p.tz * sp; return out; };
  const _fv = { x: 0, z: 0 };
  const panOf = (x, y, z) => (WG.cam && WG.cam.panOf ? WG.cam.panOf(x, y, z) : 0);

  /* ------------------------------------------------------------------ actions */
  let crackNext = 0;
  function crack(x, z, strength) {
    const c = WU.uCrack.value[crackNext]; crackNext = (crackNext + 1) % NCRACK;
    c.set(x, z, WG.time, 0.16 + 0.22 * U.sat(strength));
    const y = S.lakeLevel + 0.01;
    for (let i = 0; i < 8; i++) { const a = Math.random() * 6.283, sp = 0.15 + Math.random() * 0.3; emitDrop(x, y, z, Math.cos(a) * sp, 0.4 + Math.random() * 0.5, Math.sin(a) * sp, 0.5, 0.012, y - 0.005, 1); }
    WG.bus.emit('ice:crack', { x, z, pan: panOf(x, y, z) });
  }
  function splash(x, z, strength) {
    if (!built) return null;
    strength = U.clamp(strength === undefined ? 1 : +strength || 0, 0.05, 1.5);
    const kind = T.waterAt(x, z); if (!kind) return null;
    const y = surfaceY(x, z), pan = panOf(x, y, z);
    if (iceAt(x, z) > 0.5) {
      if (kind === 'lake') crack(x, z, strength);
      else { for (let i = 0; i < 10; i++) { const a = Math.random() * 6.283, sp = 0.1 + Math.random() * 0.25; emitDrop(x, y + 0.01, z, Math.cos(a) * sp, 0.3 + Math.random() * 0.5, Math.sin(a) * sp, 0.6, 0.014, y, 1); } WG.bus.emit('ice:crack', { x, z, pan }); }
      return 'ice';
    }
    let vx = 0, vz = 0;
    if (kind === 'river') { flowVel(x, z, _fv); vx = _fv.x; vz = _fv.z; }
    /* crown and jet */
    const k = splNext; splNext = (splNext + 1) % NSPL;
    cS[k * 4] = x; cS[k * 4 + 1] = y; cS[k * 4 + 2] = z; cS[k * 4 + 3] = WG.time; cT[k * 4] = 0.55 + 0.6 * strength; cT[k * 4 + 1] = vx; cT[k * 4 + 2] = vz; splDirty = true;
    /* drops */
    const n = Math.round((14 + 26 * strength) * (tier === 0 ? 0.7 : 1));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, r = 0.25 + Math.random() * 0.75, up = 0.7 + Math.random() * 1.0;
      emitDrop(x + Math.cos(a) * 0.03, y + 0.02, z + Math.sin(a) * 0.03, Math.cos(a) * r * 0.55 * strength + vx, up * (0.8 + 0.6 * strength), Math.sin(a) * r * 0.55 * strength + vz, 1.4, 0.022 + Math.random() * 0.02, y, 0);
    }
    /* mist */
    for (let j = 0; j < 2; j++) {
      const m = M[mistNext]; mistNext = 7 + ((mistNext - 7 + 1) % (NMIST - 7));
      Object.assign(m, { x: x + (Math.random() - 0.5) * 0.06, y: y + 0.05 + j * 0.06, z: z + (Math.random() - 0.5) * 0.06, size: 0.08, grow: 0.22 * strength, a: 0, peak: 0.22 * strength, t: 0, life: 2.0 + Math.random() * 0.8, vx: vx * 0.6, vy: 0.05, vz: vz * 0.6 });
    }
    /* rings spreading across the surface */
    const big = 0.32 + 0.28 * strength;
    addRing(x, y, z, big, 2.6, vx, vz, 0); addRing(x, y, z, big * 0.7, 2.3, vx, vz, 0.18); addRing(x, y, z, big * 0.45, 2.0, vx, vz, 0.42);
    addRing(x, y, z, big * 1.25, 3.2, vx, vz, 0.75);
    WG.bus.emit('splash', { x, y, z, size: strength, pan, kind });
    if (WG.fauna && WG.fauna.scatterFish) { try { WG.fauna.scatterFish(x, z); } catch (e) { /* their part */ } }
    if (kind === 'lake' && L.boat && WG.props && WG.props.boat && WG.props.boat.rock) { const bd = Math.hypot(x - L.boat.x, z - L.boat.z); if (bd < 1.6) { try { WG.props.boat.rock(strength * (1 - bd / 1.6)); } catch (e) { /* their part */ } } }
    return kind;
  }
  function ring(x, z, size) {
    if (!built) return;
    const kind = T.waterAt(x, z); if (!kind) return;
    if (iceAt(x, z) > 0.5) return;
    size = U.clamp(size === undefined ? 0.06 : +size || 0.06, 0.015, 0.6);
    let vx = 0, vz = 0; if (kind === 'river') { flowVel(x, z, _fv); vx = _fv.x; vz = _fv.z; }
    addRing(x, surfaceY(x, z), z, size, 0.55 + size * 4.5, vx, vz, 0);
  }
  let wk = { x: 0, z: 0, t: -9 };
  function wake(x, z, dx, dz) {
    if (!built) return;
    const kind = T.waterAt(x, z); if (!kind || iceAt(x, z) > 0.5) return;
    const l = Math.hypot(dx || 0, dz || 0);
    if (Math.hypot(x - wk.x, z - wk.z) < 0.04 && WG.time - wk.t < 0.3) return;
    wk.x = x; wk.z = z; wk.t = WG.time;
    const y = surfaceY(x, z); let vx = 0, vz = 0; if (kind === 'river') { flowVel(x, z, _fv); vx = _fv.x; vz = _fv.z; }
    if (l > 1e-5) {
      const nx = -dz / l, nz = dx / l;
      for (const s of [-1, 1]) addRing(x + nx * 0.02 * s, y, z + nz * 0.02 * s, 0.11, 1.4, vx + nx * s * 0.07 - (dx / l) * 0.02, vz + nz * s * 0.07 - (dz / l) * 0.02, 0);
    }
    addRing(x, y, z, 0.06, 0.9, vx, vz, 0);
    if (Math.random() < 0.35) emitDrop(x, y + 0.01, z, (Math.random() - 0.5) * 0.2 + vx, 0.35 + Math.random() * 0.3, (Math.random() - 0.5) * 0.2 + vz, 0.6, 0.01, y, 0);
  }

  Object.assign(water, { splash, ring, wake, surfaceY, iceAt, impact: IMPACT });

  /* ------------------------------------------------------------------ update */
  let built = false, flowT = 0, fallT = 0, poolRingT = 0, springRingT = 0, sprayAcc = 0, rainAcc = 0;
  const RAIN_BOX = { x0: 0.0, x1: 5.4, z0: 0.7, z1: 3.95 };
  function stepDrops(dt) {
    const g = 3.4, drag = Math.exp(-dt * 0.9);
    for (let i = 0; i < NDROP; i++) {
      if (D.life[i] <= 0) { dDat[i * 4] = 0; continue; }
      D.life[i] -= dt; D.vy[i] -= g * dt; D.vx[i] *= drag; D.vz[i] *= drag;
      D.x[i] += D.vx[i] * dt; D.y[i] += D.vy[i] * dt; D.z[i] += D.vz[i] * dt;
      if (D.vy[i] < 0 && D.y[i] < D.floor[i]) { D.life[i] = 0; if (D.kind[i] === 0 && Math.random() < 0.18) addRing(D.x[i], D.floor[i], D.z[i], 0.035, 0.6, 0, 0, 0); }
      const k = i * 3; dPos[k] = D.x[i]; dPos[k + 1] = D.y[i]; dPos[k + 2] = D.z[i];
      const o = i * 4; dDat[o] = D.life[i] > 0 ? D.life[i] / D.max[i] : 0; dDat[o + 1] = D.size[i]; dDat[o + 2] = D.kind[i]; dDat[o + 3] = 0;
    }
    drops.geometry.attributes.position.needsUpdate = true; drops.geometry.attributes.aD.needsUpdate = true;
    drops.material.uniforms.uPx.value = (WG.render && WG.render.height ? WG.render.height : 600) * 1.6;
  }
  function stepMist(dt, live) {
    const wind = S.wind, calm = WG.reducedMotion ? 0.4 : 1;
    for (let i = 0; i < NMIST; i++) {
      const m = M[i];
      if (m.kind === 0) {
        m.t += dt * calm;
        if (m.t > m.life) { m.t = 0; m.life = 4.5 + Math.random() * 3; const a = Math.random() * 6.283; m.x = IMPACT.x + Math.cos(a) * 0.1; m.z = IMPACT.z + 0.08 + Math.sin(a) * 0.08; m.y = POOL.y + 0.04; m.vx = (Math.random() - 0.5) * 0.05; m.vz = 0.03 + Math.random() * 0.05; m.seed = Math.random() * 50; }
        const f = m.t / m.life;
        m.x += (m.vx + wind.dx * wind.speed * 0.06) * dt * calm; m.z += (m.vz + wind.dz * wind.speed * 0.06) * dt * calm; m.y += 0.035 * dt * calm;
        m.size = 0.12 + 0.3 * f;
        m.a = Math.sin(Math.PI * f) * 0.16 * live;
      } else if (m.peak > 0) {
        m.t += dt; const f = m.t / m.life;
        if (f >= 1) { m.peak = 0; m.a = 0; } else { m.x += m.vx * dt; m.y += m.vy * dt; m.z += m.vz * dt; m.size = 0.06 + m.grow * Math.sqrt(f) * 1.8; m.a = m.peak * Math.sin(Math.PI * Math.min(1, f * 1.6 + 0.05)) * (1 - f); }
      } else m.a = 0;
      const o = i * 4; mA[o] = m.x; mA[o + 1] = m.y; mA[o + 2] = m.z; mA[o + 3] = m.size; mB[o] = m.a; mB[o + 1] = m.seed;
    }
    mists.geometry.attributes.aM.needsUpdate = true; mists.geometry.attributes.aM2.needsUpdate = true;
  }

  WG.register('water', {
    init() {
      const parts = [['lake', buildLake], ['lakeFace', buildLakeFace], ['streams', buildStreams], ['pool', buildPool], ['fall', buildFall], ['rings', buildRings], ['crowns', buildCrowns], ['drops', buildDrops], ['mist', buildMist], ['icicles', buildIcicles]];
      for (const [n, f] of parts) { try { f(); } catch (e) { WG.fail('water.' + n, e); } }
      if (!rings || !drops || !mists || !crowns) throw new Error('water: effect pools failed to build');
      built = true;
      if (WG.render) WG.render.reflectionWanted = !!Q.reflect;
    },
    update(dt) {
      if (WG.render) WG.render.reflectionWanted = !!Q.reflect;
      const flow = S.flow, live = (1 - S.fallIce) * U.smooth(0.0, 0.3, flow);
      flowT += dt * 0.32 * flow * (1 - 0.9 * S.riverIce);
      fallT += dt * (0.75 + 0.3 * flow) * (1 - U.smooth(0.3, 0.95, S.fallIce));
      WU.uWat.value.set(flowT, fallT, S.riverIce, S.fallIce);
      if (icicles) { const gr = U.smooth(0.15, 1.0, S.fallIce); icicles.visible = gr > 0.01; icicles.material.uniforms.uGrow.value = gr; }
      /* the foot of the fall: rings spreading from the impact, fine spray */
      poolRingT -= dt * live * (0.7 + 0.3 * flow);
      if (poolRingT <= 0) { poolRingT = 0.16 + Math.random() * 0.1; const a = Math.random() * 6.283, r = Math.random() * 0.05; addRing(IMPACT.x + Math.cos(a) * r, POOL.y, IMPACT.z + 0.03 + Math.sin(a) * r, 0.14 + Math.random() * 0.1 * flow, 1.5, 0, 0.02, 0); }
      springRingT -= dt * (1 - Math.max(S.fallIce, S.riverIce));
      if (springRingT <= 0) { springRingT = 0.5 + Math.random() * 0.6; addRing(FALL.springX + (Math.random() - 0.5) * 0.03, T.height(FALL.springX, FALL.springZ) + 0.018, FALL.springZ + 0.02 + Math.random() * 0.03, 0.03 + Math.random() * 0.02, 0.8, 0, 0.01, 0); }
      sprayAcc += dt * live * (tier === 0 ? 26 : 42) * (0.6 + 0.4 * flow);
      while (sprayAcc >= 1) {
        sprayAcc -= 1;
        const a = Math.random() * 6.283, s = 0.15 + Math.random() * 0.35;
        emitDrop(IMPACT.x + (Math.random() - 0.5) * 0.2, POOL.y + 0.02, IMPACT.z + Math.random() * 0.05, Math.cos(a) * s * 0.6, 0.45 + Math.random() * 0.7 * (0.7 + 0.3 * flow), 0.12 + Math.abs(Math.sin(a)) * s * 0.6, 0.9, 0.014 + Math.random() * 0.014, POOL.y, 0);
      }
      /* raindrop rings even when no other part reports the drops */
      const pm = WG.mod && WG.mod('precip');
      if (!(pm && pm.ok) && S.rain > 0.02 && WG.world && WG.world.rainAt) {
        rainAcc += dt * 260 * S.rain;
        let guard = 0;
        while (rainAcc >= 1 && guard++ < 60) {
          rainAcc -= 1;
          const x = U.lerp(RAIN_BOX.x0, RAIN_BOX.x1, Math.random()), z = U.lerp(RAIN_BOX.z0, RAIN_BOX.z1, Math.random());
          if (WG.world.rainAt(x, z) > Math.random() * 0.8) ring(x, z, 0.04 + Math.random() * 0.04);
        }
        rainAcc = Math.min(rainAcc, 4);
      }
      stepDrops(dt); stepMist(dt, live);
      if (ringDirty) { rings.geometry.attributes.aA.needsUpdate = true; rings.geometry.attributes.aB.needsUpdate = true; ringDirty = false; }
      if (splDirty) { crowns.geometry.attributes.aS.needsUpdate = true; crowns.geometry.attributes.aT.needsUpdate = true; splDirty = false; }
      if (lake) lake.position.y = S.lakeLevel;
    },
  });
})();
