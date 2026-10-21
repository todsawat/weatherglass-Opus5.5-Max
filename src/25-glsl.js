/* Weatherglass — shared shader language: one set of global uniforms (WG.G), noise, wind, shadows, studio reflections,
   weathering (wet / snow / frost) and the lit-material builder every part uses so the whole scene is lit as one photograph. */
(function () {
  'use strict';
  const WG = window.WG, THREE = WG.THREE, U = WG.util, C = WG.C, T = WG.terrain, W = WG.world, Q = WG.Q;
  const V2 = THREE.Vector2, V3 = THREE.Vector3, V4 = THREE.Vector4, Col = THREE.Color;

  /* ---- a small RG noise texture: G is R shifted by (37,17), which turns one bilinear fetch into 3D value noise ---- */
  const noiseTex = (function () {
    const n = 256, d = new Uint8Array(n * n * 4), rnd = U.rng(9173), r = new Uint8Array(n * n);
    for (let i = 0; i < n * n; i++) r[i] = (rnd() * 256) | 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const k = (y * n + x) * 4; d[k] = r[y * n + x]; d[k + 1] = r[((y + 17) & 255) * n + ((x + 37) & 255)]; d[k + 2] = r[((y + 91) & 255) * n + ((x + 53) & 255)]; d[k + 3] = r[((y + 151) & 255) * n + ((x + 211) & 255)]; }
    const t = new THREE.DataTexture(d, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true; return t;
  })();
  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); white.needsUpdate = true;
  const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1); black.needsUpdate = true;
  WG.tex = { noise: noiseTex, white, black };

  /* ---- global uniforms: every material shares these value holders, so setting one here changes the whole scene ---- */
  const G = (WG.G = {
    uTime: { value: 0 },
    uSunDir: { value: new V3(0, 1, 0) },     // key light: toward the sun by day, the moon by night
    uSunCol: { value: new V3(1, 1, 1) },     // its colour x intensity (linear, may exceed 1)
    uSkyCol: { value: new V3(0.3, 0.35, 0.45) }, uGndCol: { value: new V3(0.1, 0.09, 0.08) },  // hemisphere ambient
    uFillDir: { value: new V3(0.25, 0.55, 0.8).normalize() }, uFillCol: { value: new V3(0.05, 0.05, 0.05) }, // studio fill
    uEnvCol: { value: new V3(0.4, 0.45, 0.55) }, // what glossy things inside the case reflect
    uRoomCol: { value: new V3(0.03, 0.025, 0.02) }, // the studio's own colour
    uStudio: { value: new V4(1, 1, 0, 0) },   // x softbox brightness, y night (0..1), z storm (0..1), w golden (0..1)
    uFlashPos: { value: new V3(0, 5, 0) }, uFlashCol: { value: new V3(0, 0, 0) },
    uShadowMap: { value: white }, uShadowMat: { value: new THREE.Matrix4() }, uShadowP: { value: new V4(1 / 2048, 0.0015, 60, 0) }, // texel, bias, penumbra scale, enabled
    uCloudMap: { value: black }, uCloudP: { value: new V4(5.4, 1, 0, 0) },   // mean cloud height, shadow strength
    uGroundTex: { value: W.groundTex }, uFogTex: { value: W.fogTex }, uWindTex: { value: W.windTex },
    uHeightTex: { value: T.heightTex }, uMask1: { value: T.mask1Tex }, uMask2: { value: T.mask2Tex }, uNoiseTex: { value: noiseTex },
    uWind: { value: new V4(1, 0, 0.3, 0) },   // dir.x, dir.z, speed, travelling phase
    uSeason: { value: 0 }, uSeasonW: { value: new V4(1, 0, 0, 0) },          // 0..4 and the four weights (spring, summer, autumn, winter)
    uLake: { value: new V4(C.LAKE, 0, 0, 1) }, // level, ice, turbidity, flow
    uAir: { value: new V4(18, 0.45, 0, 0) },   // temperature at the lake, humidity, storm, rain
    uGrassA: { value: new Col(0x6f9a3f) }, uGrassB: { value: new Col(0x9aa24e) }, // lush and dry grass of the season (shared by turf and blades)
    uClipY: { value: -100 },                    // >-90: discard everything below this height (reflection pass)
    uRes: { value: new V2(1, 1) },
    uReflTex: { value: black }, uReflMat: { value: new THREE.Matrix4() }, uReflOn: { value: 0 },   // the lake's mirror image (highest detail level only)
  });
  const seasonW = (s) => { s = U.wrap(s, 4); const w = [0, 0, 0, 0], i = Math.floor(s), f = s - i, t = f * f * (3 - 2 * f); w[i] = 1 - t; w[(i + 1) & 3] = t; return w; };
  WG.syncGlobals = () => {
    const S = WG.state;
    G.uTime.value = WG.time;
    G.uWind.value.set(S.wind.dx, S.wind.dz, S.wind.speed, S.wind.phase);
    G.uSeason.value = S.season; const w = seasonW(S.season); G.uSeasonW.value.set(w[0], w[1], w[2], w[3]);
    G.uLake.value.set(S.lakeLevel, S.ice, S.turbid, S.flow);
    G.uAir.value.set(S.temp, S.humidity, S.storm, S.rain);
  };

  const glsl = (WG.glsl = {});
  glsl.globals = /* glsl */ `
uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uSkyCol; uniform vec3 uGndCol;
uniform vec3 uFillDir; uniform vec3 uFillCol; uniform vec3 uEnvCol; uniform vec3 uRoomCol; uniform vec4 uStudio;
uniform vec3 uFlashPos; uniform vec3 uFlashCol;
uniform sampler2D uShadowMap; uniform mat4 uShadowMat; uniform vec4 uShadowP;
uniform sampler2D uCloudMap; uniform vec4 uCloudP;
uniform sampler2D uGroundTex; uniform sampler2D uFogTex; uniform sampler2D uWindTex; uniform sampler2D uHeightTex;
uniform sampler2D uMask1; uniform sampler2D uMask2; uniform sampler2D uNoiseTex;
uniform vec4 uWind; uniform float uSeason; uniform vec4 uSeasonW; uniform vec4 uLake; uniform vec4 uAir;
uniform vec3 uGrassA; uniform vec3 uGrassB; uniform float uClipY; uniform vec2 uRes;
uniform sampler2D uReflTex; uniform mat4 uReflMat; uniform float uReflOn;
#define WG_PI 3.14159265
vec2 wgUV(vec2 xz){ return (xz - vec2(-6.0,-4.0)) / vec2(12.0, 8.0); }
`;
  glsl.noise = /* glsl */ `
float wgHash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 wgHash2(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float wgNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(wgHash(i), wgHash(i+vec2(1,0)), f.x), mix(wgHash(i+vec2(0,1)), wgHash(i+vec2(1,1)), f.x), f.y); }
float wgFbm(vec2 p){ float a = 0.5, s = 0.0; for(int i=0;i<4;i++){ s += a*wgNoise(p); p = p*2.03 + vec2(17.1, 3.7); a *= 0.5; } return s; }
float wgFbm2(vec2 p){ return 0.667*wgNoise(p) + 0.333*wgNoise(p*2.07 + vec2(5.2, 1.3)); }
/* 3D value noise from one texture fetch (0..1) */
float wgNoise3(vec3 x){ vec3 p = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  vec2 uv = (p.xy + vec2(37.0, 17.0)*p.z) + f.xy; vec2 rg = texture2D(uNoiseTex, (uv + 0.5)/256.0).yx; return mix(rg.x, rg.y, f.z); }
float wgIGN(vec2 fc){ return fract(52.9829189 * fract(dot(fc, vec2(0.06711056, 0.00583715)))); }
float wgSat(float x){ return clamp(x, 0.0, 1.0); }
`;
  /* wind felt at a world position: the travelling breeze plus the local gusts painted by the wind tool (xz, units/s) */
  glsl.wind = /* glsl */ `
vec2 wgWindAt(vec3 wp){
  vec2 d = uWind.xy; float along = dot(wp.xz, d), across = dot(wp.xz, vec2(-d.y, d.x));
  float g = wgNoise(vec2(along*0.19 - uWind.w*0.19, across*0.25 + uTime*0.05));
  float fine = wgNoise(vec2(along*0.9 - uWind.w*0.9, across*0.7 + uTime*0.31));
  vec2 w = d * uWind.z * (0.45 + 1.1*g) * (0.8 + 0.4*fine);
  vec2 l = texture2D(uWindTex, wgUV(wp.xz)).xy * 2.0 - 1.0;
  return w + l * 3.0 * step(0.012, dot(l,l));
}
`;
  glsl.light = /* glsl */ `
float wgHeight(vec2 xz){ vec2 uv = (wgUV(xz) * vec2(384.0, 256.0) + 0.5) / vec2(385.0, 257.0); return texture2D(uHeightTex, uv).r; }
vec4 wgGround(vec2 xz){ return texture2D(uGroundTex, wgUV(xz)); }   /* r wet, g snow, b frost, a rain landing now */
const vec2 WG_PD[12] = vec2[12](vec2(-0.326,-0.406), vec2(-0.840,-0.074), vec2(-0.696,0.457), vec2(-0.203,0.621), vec2(0.962,-0.195), vec2(0.473,-0.480),
  vec2(0.519,0.767), vec2(0.185,-0.893), vec2(0.507,0.064), vec2(0.896,0.412), vec2(-0.322,-0.933), vec2(-0.792,-0.598));
float wgShadow(vec3 P, vec3 N){
  if (uShadowP.w < 0.5) return 1.0;
  vec4 sc = uShadowMat * vec4(P + N * (uShadowP.x * 26.0), 1.0);
  vec3 c = sc.xyz;
  if (c.x < 0.002 || c.x > 0.998 || c.y < 0.002 || c.y > 0.998 || c.z > 1.0) return 1.0;
  float zr = c.z - uShadowP.y;
  float ang = wgIGN(gl_FragCoord.xy) * 6.2831853; float cs = cos(ang), sn = sin(ang); mat2 rot = mat2(cs, sn, -sn, cs);
#if WG_SHADOW_TAPS <= 4
  float s = 0.0;
  for (int i = 0; i < 4; i++) s += step(zr, texture2D(uShadowMap, c.xy + rot * WG_PD[i*3] * uShadowP.x * 1.6).r);
  return s * 0.25;
#else
  float bs = 0.0, bn = 0.0;
  for (int i = 0; i < 6; i++) { float d = texture2D(uShadowMap, c.xy + rot * WG_PD[i*2] * uShadowP.x * 5.0).r; if (d < zr) { bs += d; bn += 1.0; } }
  if (bn < 0.5) return 1.0;
  float pen = clamp((zr - bs/bn) * uShadowP.z, 1.1, 9.0);
  float s = 0.0;
  for (int i = 0; i < WG_SHADOW_TAPS; i++) s += step(zr, texture2D(uShadowMap, c.xy + rot * WG_PD[i] * uShadowP.x * pen).r);
  return s / float(WG_SHADOW_TAPS);
#endif
}
/* soft moving shadows of the clouds: 1 = full light */
float wgCloudShadow(vec3 P){
  float t = (uCloudP.x - P.y) / max(uSunDir.y, 0.14);
  vec2 q = P.xz + uSunDir.xz * t;
  vec4 c = texture2D(uCloudMap, (q - vec2(-8.0, -6.0)) / vec2(16.0, 12.0));
  return 1.0 - clamp(c.r * (0.5 + 0.45*c.g), 0.0, 0.93) * uCloudP.y * step(P.y, uCloudP.x + 0.3);
}
/* the studio as reflected by glass and brass: four tall softboxes round the room and one overhead */
vec3 wgStudio(vec3 R, float rough){
  vec3 col = uRoomCol * (0.55 + 0.6*max(R.y, 0.0));
  float az = atan(R.z, R.x), el = asin(clamp(R.y, -1.0, 1.0)), soft = 0.05 + rough*0.55, boxes = 0.0;
  for (int i = 0; i < 4; i++) { float a0 = 0.785398 + 1.570796*float(i); float da = abs(atan(sin(az - a0), cos(az - a0)));
    boxes += smoothstep(0.24 + soft, 0.24 - soft*0.5, da) * smoothstep(-0.3 - soft, -0.12, el) * smoothstep(1.02 + soft, 0.86 - soft, el) * (i == 1 ? 1.0 : 0.75); }
  float top = smoothstep(0.80 - soft, 0.93, R.y);
  col += (vec3(1.0, 0.955, 0.89)*boxes*2.4 + vec3(1.0, 0.97, 0.93)*top*1.9) * uStudio.x / (1.0 + rough*2.5);
  return col;
}
vec3 wgSkyEnv(vec3 R){ return mix(uGndCol * 1.2, uEnvCol, smoothstep(-0.25, 0.45, R.y)); }
/* bump a normal from a scalar height h (screen-space derivatives) */
vec3 wgBump(vec3 P, vec3 N, float h, float k){
  vec3 dpx = dFdx(P), dpy = dFdy(P); float dhx = dFdx(h), dhy = dFdy(h);
  vec3 r1 = cross(dpy, N), r2 = cross(N, dpx); float det = dot(dpx, r1);
  vec3 g = (r1 * dhx + r2 * dhy) * sign(det) / max(abs(det), 1e-7);
  return normalize(N - g * k);
}
/* moving light patterns on a bed under water (0..~1.5) */
float wgCaustic(vec2 uv, float t){
  vec2 p = mod(uv * 6.2831853, 6.2831853) - 250.0, i = p; float c = 1.0;
  for (int n = 0; n < 4; n++) { float tt = t * (1.0 - 3.5 / float(n + 1)); i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x)); c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / 0.005), p.y / (cos(i.y + tt) / 0.005))); }
  c = 1.17 - pow(c / 4.0, 1.4); return pow(abs(c), 8.0);
}
/* expanding raindrop rings on still water: returns a signed ripple height; p in cells of ~1 ring */
float wgRings(vec2 p, float t){
  vec2 i = floor(p), f = fract(p); float s = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y)); vec2 h = wgHash2(i + o); float ph = fract(t * 0.85 + h.x * 7.0);
    float d = length(o + 0.2 + 0.6 * h - f), rr = ph * 0.9;
    s += sin((d - rr) * 42.0) * smoothstep(0.11, 0.0, abs(d - rr)) * (1.0 - ph);
  }
  return s;
}
/* rain, snow and frost on any surface */
void wgWeather(vec3 P, vec3 N, float wetK, float snowK, inout vec3 albedo, inout float rough, inout float spec, inout vec3 emissive){
  vec4 g = wgGround(P.xz);
  float wet = g.r * wetK;
  albedo *= mix(1.0, 0.5, wet*0.9); rough = mix(rough, 0.2, wet*0.78); spec = mix(spec, 0.075, wet);
  float n = wgNoise(P.xz*13.0)*0.6 + wgNoise(P.xz*41.0)*0.4;
  float need = mix(0.95, 0.03, smoothstep(0.42, 0.93, N.y));
  float cover = smoothstep(0.0, 0.13, g.g*snowK - need + (n - 0.45)*0.12);
  vec3 V = normalize(cameraPosition - P);
  float gl = wgHash(floor(P.xz*190.0) + floor(dot(V, vec3(7.0, 3.0, 5.0))*6.0));
  albedo = mix(albedo, vec3(0.9, 0.925, 0.96), cover); rough = mix(rough, 0.85, cover); spec = mix(spec, 0.03, cover);
  emissive += cover * step(0.994, gl) * uSunCol * 1.6 * max(dot(N, uSunDir), 0.0);
  float fr = g.b * smoothstep(0.3, 0.85, N.y) * (1.0 - cover);
  albedo = mix(albedo, vec3(0.78, 0.86, 0.92), fr*0.6*(0.6 + 0.4*n));
}
vec3 wgShade(vec3 P, vec3 N, vec3 V, vec3 albedo, float rough, float spec, float metal, float ao, float trans, float shadowK){
  vec3 Ld = uSunDir; float ndl = dot(N, Ld);
  float sh = 1.0;
  if (uSunCol.r + uSunCol.g + uSunCol.b > 0.002) sh = mix(1.0, wgShadow(P, N), shadowK) * wgCloudShadow(P);
  float diff = max(ndl, 0.0);
  if (trans > 0.001) diff = max((ndl + trans*0.55) / (1.0 + trans*0.55), 0.0);
  vec3 direct = uSunCol * diff * sh;
  float vdl = max(dot(V, -Ld), 0.0);
  vec3 through = uSunCol * sh * trans * max(-ndl*0.6 + 0.4, 0.0) * (0.25 + 1.5*vdl*vdl*vdl);
  float hemi = N.y*0.5 + 0.5;
  vec3 amb = mix(uGndCol, uSkyCol, hemi) + uFillCol * (max(dot(N, uFillDir), 0.0)*0.8 + 0.2);
  vec3 fl = vec3(0.0);
  if (uFlashCol.b > 0.002) { vec3 fd = uFlashPos - P; float fdl = length(fd); fl = uFlashCol * (max(dot(N, fd/fdl), 0.0)*0.75 + 0.25) / (1.0 + fdl*fdl*0.035); }
  vec3 dcol = albedo * (1.0 - metal);
  vec3 col = dcol * (direct + amb*ao + fl) + albedo * through * (albedo + 0.25);
  vec3 F0 = mix(vec3(spec), albedo, metal);
  vec3 H = normalize(Ld + V); float ndh = max(dot(N, H), 0.0), ndv = max(dot(N, V), 0.001);
  float a = max(rough*rough, 0.003), a2 = a*a, dd = ndh*ndh*(a2 - 1.0) + 1.0;
  float D = min(a2 / (WG_PI*dd*dd), 90.0);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - max(dot(H, V), 0.0), 5.0);
  col += (uSunCol * sh + fl) * max(ndl, 0.0) * D * F * 0.25 / mix(1.0, max(ndv, 0.25), 0.7);
#ifndef WG_ENV_NONE
  vec3 R = reflect(-V, N);
  vec3 Fe = F0 + (max(vec3(1.0 - rough), F0) - F0) * pow(1.0 - ndv, 5.0);
#ifdef WG_ENV_STUDIO
  col += wgStudio(R, rough) * Fe * ao;
#else
  col += wgSkyEnv(R) * Fe * ao * (1.0 - rough*0.6);
#endif
#endif
  return col;
}
`;

  /* ---------------------------------------------------------------- material builders */
  const head = `${glsl.globals}\n${glsl.noise}\n`;
  const vary = `varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying vec3 vCol;\n`;
  function vertexShader(o) {
    return `${head}${glsl.wind}${vary}${o.vertexDecl || ''}
void main(){
  vec3 pos = position; vec3 nrm = normal; vUv = uv; vCol = vec3(1.0);
#ifdef USE_COLOR
  vCol *= color.rgb;
#endif
#ifdef USE_INSTANCING_COLOR
  vCol *= instanceColor;
#endif
  mat4 M = modelMatrix;
#ifdef USE_INSTANCING
  M = M * instanceMatrix;
#endif
  ${o.vertexLocal || ''}
  vec4 w = M * vec4(pos, 1.0);
  vec3 wn = normalize(mat3(M) * nrm);
  ${o.vertexWorld || ''}
  vW = w.xyz; vN = wn;
  gl_Position = projectionMatrix * viewMatrix * w;
  ${o.vertexEnd || ''}
}`;
  }
  function fragmentShader(o, lit, transparent) {
    const out = transparent ? 'alpha' : 'length(cameraPosition - vW)';
    return `#define WG_SHADOW_TAPS ${Q.shadowTaps}
${head}${glsl.light}${vary}${o.fragDecl || ''}
void main(){
  if (uClipY > -90.0 && vW.y < uClipY) discard;
  vec3 P = vW; vec3 V = normalize(cameraPosition - P); vec3 N = normalize(vN);
#ifdef WG_DOUBLE
  if (!gl_FrontFacing) N = -N;
#endif
  vec3 albedo = vCol; float rough = 0.85; float spec = 0.04; float metal = 0.0; float ao = 1.0; vec3 emissive = vec3(0.0);
  float alpha = 1.0; float trans = 0.0; float wetK = 1.0; float snowK = 1.0; float shadowK = 1.0; vec3 col = vec3(0.0);
  ${o.frag || ''}
${lit ? `#ifdef WG_WEATHER
  wgWeather(P, N, wetK, snowK, albedo, rough, spec, emissive);
#endif
  col = wgShade(P, N, V, albedo, rough, spec, metal, ao, trans, shadowK) + emissive;` : ''}
  ${o.fragPost || ''}
  gl_FragColor = vec4(col, ${out});
}`;
  }
  function depthMaterial(o) {
    return new THREE.ShaderMaterial({
      uniforms: Object.assign({}, G, o.uniforms), defines: Object.assign({}, o.defines), side: o.shadowSide !== undefined ? o.shadowSide : (o.side !== undefined ? o.side : THREE.FrontSide),
      vertexShader: vertexShader(o), vertexColors: !!o.vertexColors, colorWrite: false,
      fragmentShader: `${head}${vary}${o.fragDecl && o.depthFrag ? o.fragDecl : ''}\nvoid main(){ ${o.depthFrag || ''} gl_FragColor = vec4(1.0); }`,
    });
  }
  function build(o, lit) {
    o = o || {};
    const transparent = !!o.transparent || !!o.additive;
    const defines = Object.assign({}, o.defines);
    if (o.weather) defines.WG_WEATHER = 1;
    if (o.side === THREE.DoubleSide) defines.WG_DOUBLE = 1;
    defines['WG_ENV_' + String(o.env || 'sky').toUpperCase()] = 1;
    const m = new THREE.ShaderMaterial({
      name: o.name || '', uniforms: Object.assign({}, G, o.uniforms), defines,
      vertexShader: vertexShader(o), fragmentShader: fragmentShader(o, lit, transparent),
      side: o.side !== undefined ? o.side : THREE.FrontSide, transparent,
      depthWrite: o.depthWrite !== undefined ? o.depthWrite : !transparent, depthTest: o.depthTest !== false, vertexColors: !!o.vertexColors,
    });
    if (transparent) {
      /* colour blends as usual, but the alpha channel of the scene buffer holds distance and must be left alone */
      m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation;
      m.blendSrc = o.premultiplied ? THREE.OneFactor : THREE.SrcAlphaFactor; m.blendDst = o.additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor;
      m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor;
    }
    if (o.polygonOffset) { m.polygonOffset = true; m.polygonOffsetFactor = o.polygonOffset; m.polygonOffsetUnits = o.polygonOffset; }
    if (!transparent && o.shadow !== false) m.userData.depthMat = depthMaterial(o);
    return m;
  }
  /* WG.mat.lit(options)  -> ShaderMaterial lit by the shared sun/moon, sky, studio fill, lightning, cast and cloud shadows.
     WG.mat.unlit(options)-> same plumbing, but your fragment code writes \`col\` (and \`alpha\`) itself.
     options: name, uniforms, defines, vertexColors, side, transparent, additive, premultiplied, depthWrite, depthTest, shadow(false to not cast),
              weather (true: rain darkens, snow and frost settle), env ('sky' | 'studio' | 'none'),
              vertexDecl, vertexLocal (object space: pos, nrm), vertexWorld (world space: w, wn), vertexEnd,
              fragDecl, frag (set albedo, rough, spec, metal, N, ao, emissive, alpha, trans, wetK, snowK, shadowK), fragPost (adjust col), depthFrag (e.g. alpha-test discard) */
  WG.mat = { lit: (o) => build(o, true), unlit: (o) => build(o, false) };

  /* ---------------------------------------------------------------- scene helpers */
  WG.casters = [];
  /* put an object in the scene. opts: pass 'A' (before the air and clouds are drawn, default) or 'B' (after: near glass, rain, sparks);
     shadow: true makes it cast; reflect: true shows it in the lake's mirror image; parent: another Object3D */
  WG.add = (obj, opts) => {
    opts = opts || {};
    const layer = opts.pass === 'B' ? WG.L.B : WG.L.A;
    obj.traverse((n) => {
      n.layers.set(layer);
      if (opts.shadow && (n.isMesh || n.isInstancedMesh)) { n.layers.enable(WG.L.SHADOW); WG.casters.push(n); }
      if (opts.reflect) n.layers.enable(WG.L.REFL);
      if (n.isMesh || n.isPoints || n.isLine) n.frustumCulled = opts.cull === true;
    });
    if (opts.order !== undefined) obj.renderOrder = opts.order;
    (opts.parent || WG.scene).add(obj);
    return obj;
  };
  WG.setPass = (obj, pass) => { const l = pass === 'B' ? WG.L.B : WG.L.A; obj.traverse((n) => { const sh = n.layers.isEnabled(WG.L.SHADOW), rf = n.layers.isEnabled(WG.L.REFL); n.layers.set(l); if (sh) n.layers.enable(WG.L.SHADOW); if (rf) n.layers.enable(WG.L.REFL); }); };
})();
