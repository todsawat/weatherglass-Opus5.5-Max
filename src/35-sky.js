/* Weatherglass — light. Turns the clock, season and weather into the colours every material shares,
   and draws the sun, the moon, the stars under the lid, shooting stars and the aurora. */
(function () {
  'use strict';
  const WG = window.WG, THREE = WG.THREE, U = WG.util, C = WG.C, G = WG.G, S = WG.state, Q = WG.Q;
  const V3 = THREE.Vector3;
  const sky = (WG.sky = {
    hazeCol: new V3(0.5, 0.55, 0.62), hazeDen: 0.012, shaft: 0,          // the air inside the case (used by the air/cloud pass)
    cloudLit: new V3(1, 1, 1), cloudAmbTop: new V3(0.5, 0.55, 0.65), cloudAmbBase: new V3(0.3, 0.3, 0.33),
    sunCol: new V3(), sunLum: 0, moonLum: 0, keyIsMoon: false, starVis: 0, hover: null, hoverK: 0, grab: null,
    sunVisible: 1, sunScreen: { x: 0, y: 0, z: 1 }, moonScreen: { x: 0, y: 0, z: 1 },
  });
  const v = (r, g, b) => new V3(r, g, b);
  const mix3 = (out, a, b, t) => out.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
  const K = {
    /* hemisphere sky / ground, studio fill, reflected environment, haze, room */
    day: { sky: v(0.168, 0.205, 0.265), gnd: v(0.08, 0.072, 0.06), fill: v(0.05, 0.046, 0.042), env: v(0.46, 0.53, 0.62), haze: v(0.62, 0.68, 0.76), room: v(0.022, 0.018, 0.0145), den: 0.0036, ct: v(0.57, 0.585, 0.63), cb: v(0.3, 0.3, 0.32) },
    gold: { sky: v(0.3, 0.235, 0.2), gnd: v(0.12, 0.085, 0.055), fill: v(0.07, 0.055, 0.045), env: v(0.72, 0.5, 0.33), haze: v(1.05, 0.66, 0.36), room: v(0.03, 0.02, 0.012), den: 0.01, ct: v(0.42, 0.36, 0.52), cb: v(0.26, 0.2, 0.3) },
    dusk: { sky: v(0.085, 0.095, 0.18), gnd: v(0.03, 0.03, 0.05), fill: v(0.022, 0.022, 0.035), env: v(0.16, 0.17, 0.31), haze: v(0.2, 0.2, 0.36), room: v(0.008, 0.007, 0.009), den: 0.009, ct: v(0.2, 0.21, 0.36), cb: v(0.08, 0.085, 0.15) },
    night: { sky: v(0.02, 0.028, 0.052), gnd: v(0.007, 0.009, 0.015), fill: v(0.006, 0.007, 0.011), env: v(0.03, 0.043, 0.08), haze: v(0.05, 0.065, 0.12), room: v(0.0045, 0.004, 0.0042), den: 0.007, ct: v(0.15, 0.2, 0.31), cb: v(0.055, 0.075, 0.125) },
  };
  const OVER = { sky: v(0.24, 0.25, 0.27), gnd: v(0.085, 0.085, 0.085), env: v(0.42, 0.44, 0.47), haze: v(0.5, 0.52, 0.55) };
  const STORM = { sky: v(0.085, 0.1, 0.125), gnd: v(0.035, 0.04, 0.045), env: v(0.13, 0.15, 0.18), haze: v(0.16, 0.185, 0.22), room: v(0.0035, 0.003, 0.0026) };
  const SUNC = [[0.36, v(1.0, 0.94, 0.86)], [0.2, v(1.0, 0.68, 0.38)], [0.06, v(1.0, 0.43, 0.2)], [-0.03, v(1.0, 0.2, 0.07)]];
  const tmp = { sky: v(), gnd: v(), fill: v(), env: v(), haze: v(), room: v(), ct: v(), cb: v(), den: 0 }, t2 = v(), sc = v();
  function blendKeys(e) {
    /* weights of day / golden hour / dusk / night from the sine of the sun's elevation */
    const d = U.smooth(0.14, 0.36, e), n = 1 - U.smooth(-0.36, -0.1, e), u = (1 - U.smooth(-0.06, 0.04, e)) * (1 - n), g = Math.max(0, 1 - d - n - u);
    for (const k of ['sky', 'gnd', 'fill', 'env', 'haze', 'room', 'ct', 'cb']) tmp[k].set(0, 0, 0).addScaledVector(K.day[k], d).addScaledVector(K.gold[k], g).addScaledVector(K.dusk[k], u).addScaledVector(K.night[k], n);
    tmp.den = K.day.den * d + K.gold.den * g + K.dusk.den * u + K.night.den * n;
    return g;
  }
  function sunColour(e, out) {
    if (e >= SUNC[0][0]) return out.copy(SUNC[0][1]);
    for (let i = 0; i < SUNC.length - 1; i++) if (e >= SUNC[i + 1][0]) return mix3(out, SUNC[i + 1][1], SUNC[i][1], (e - SUNC[i + 1][0]) / (SUNC[i][0] - SUNC[i + 1][0]));
    return out.copy(SUNC[SUNC.length - 1][1]);
  }

  function lighting(dt) {
    const e = S.sunDir.y, gold = blendKeys(e), over = U.smooth(0.25, 0.95, S.cover) * (1 - S.night * 0.5), storm = S.storm;
    for (const k of ['sky', 'gnd', 'env', 'haze']) { tmp[k].lerp(t2.copy(OVER[k]).multiplyScalar(0.25 + 0.75 * S.sunUp + 0.05), over * 0.75 * (0.3 + 0.7 * S.sunUp)); tmp[k].lerp(t2.copy(STORM[k]).multiplyScalar(0.3 + 0.7 * S.sunUp), storm * 0.85); }
    tmp.room.lerp(STORM.room, storm * 0.8); tmp.fill.multiplyScalar(1 - 0.6 * storm);
    /* sun */
    sunColour(e, sc);
    const sunI = 2.95 * U.smooth(-0.03, 0.08, e) * U.lerp(0.5, 1, U.smooth(0, 0.35, e)) * (1 - 0.82 * U.smooth(0.2, 0.95, S.cover)) * (1 - 0.72 * storm) * (1 - 0.45 * S.fogAvg);
    if (over > 0) sc.lerp(t2.set(0.9, 0.93, 1.0), over * 0.5);
    sky.sunCol.copy(sc).multiplyScalar(sunI); sky.sunLum = sunI;
    /* moon */
    const moonI = 0.34 * S.moonUp * U.smooth(0.35, 0.95, S.night) * (1 - 0.75 * U.smooth(0.2, 0.95, S.cover)) * (1 - 0.8 * storm) * (1 - 0.5 * S.fogAvg);
    sky.moonLum = moonI;
    const useMoon = moonI > sunI * 0.9;
    sky.keyIsMoon = useMoon;
    if (useMoon) { G.uSunDir.value.copy(S.moonDir); G.uSunCol.value.set(0.42, 0.56, 1.0).multiplyScalar(moonI); }
    else { G.uSunDir.value.copy(S.sunDir); G.uSunCol.value.copy(sky.sunCol); }
    if (G.uSunDir.value.y < 0.02) { G.uSunDir.value.y = 0.02; G.uSunDir.value.normalize(); }
    G.uSkyCol.value.copy(tmp.sky); G.uGndCol.value.copy(tmp.gnd); G.uFillCol.value.copy(tmp.fill); G.uEnvCol.value.copy(tmp.env); G.uRoomCol.value.copy(tmp.room);
    G.uStudio.value.set((1 - 0.72 * S.night) * (1 - 0.6 * storm) * (0.85 + 0.15 * S.sunUp), S.night, storm, gold);
    /* lightning lights everything for an instant */
    const f = S.flash; G.uFlashCol.value.set(0.72 * f * 7, 0.84 * f * 7, 1.0 * f * 7); G.uFlashPos.value.copy(S.flashPos);
    if (f > 0.01) { G.uRoomCol.value.addScaledVector(t2.set(0.05, 0.06, 0.08), f); G.uEnvCol.value.addScaledVector(t2.set(0.6, 0.7, 0.9), f); }
    /* the air in the case */
    const humid = U.smooth(0.5, 1, S.humidity);
    sky.hazeCol.copy(tmp.haze);
    sky.hazeDen = tmp.den * (1 + 1.0 * humid + 1.2 * U.sat(S.rain * 1.5) + 1.4 * storm + 1.1 * S.fogAvg);
    sky.shaft = U.sat(gold * 1.2 + S.fogAvg * 0.6) * (useMoon ? 0.4 : 1);
    /* cloud lighting */
    sky.cloudLit.copy(G.uSunCol.value);
    sky.cloudAmbTop.copy(tmp.ct).lerp(t2.copy(OVER.sky).multiplyScalar(1.5 * (0.25 + 0.75 * S.sunUp)), over * 0.6).multiplyScalar(1 - 0.55 * storm);
    sky.cloudAmbBase.copy(tmp.cb).lerp(t2.copy(OVER.gnd).multiplyScalar(2.2 * (0.25 + 0.75 * S.sunUp)), over * 0.6).multiplyScalar(1 - 0.6 * storm);
    if (useMoon) sky.cloudLit.multiplyScalar(1.5);
    if (f > 0.01) { sky.cloudAmbTop.addScaledVector(t2.set(0.5, 0.6, 0.8), f * 1.4); sky.cloudAmbBase.addScaledVector(t2.set(0.5, 0.6, 0.8), f * 1.8); }
    sky.starVis = U.smooth(0.55, 1, S.night) * (1 - U.smooth(0.15, 0.7, S.cover)) * (1 - storm) * (1 - U.sat(S.fogAvg * 1.6));
    /* the turf and the blades share their seasonal greens */
    const gA = U.bySeason, s = S.season;
    G.uGrassA.value.setRGB(gA(s, 0.215, 0.13, 0.26, 0.3), gA(s, 0.35, 0.265, 0.27, 0.27), gA(s, 0.085, 0.06, 0.065, 0.13));
    G.uGrassB.value.setRGB(gA(s, 0.33, 0.32, 0.4, 0.42), gA(s, 0.4, 0.33, 0.33, 0.36), gA(s, 0.1, 0.09, 0.1, 0.17));
  }

  /* ---------------------------------------------------------------- sun, moon */
  let sun, sunGlow, moon, moonGlow, stars, shoot, aurora = [];
  const billboardV = `vec3 cr = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), cu = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    w.xyz = uCen + (cr * pos.x * uSize.x + cu * pos.y * uSize.y);`;
  function buildBodies() {
    const sph = new THREE.SphereGeometry(1, 24, 16), quad = new THREE.PlaneGeometry(2, 2);
    sun = new THREE.Mesh(sph, WG.mat.unlit({ name: 'sun', shadow: false, uniforms: { uCol: { value: new V3(40, 36, 28) } }, fragDecl: 'uniform vec3 uCol;', frag: 'col = uCol * (0.75 + 0.25 * max(dot(N, V), 0.0));' }));
    sunGlow = new THREE.Mesh(quad, WG.mat.unlit({
      name: 'sunGlow', additive: true, depthWrite: false, uniforms: { uCen: { value: new V3() }, uSize: { value: new THREE.Vector2(3, 3) }, uCol: { value: new V3(1, 0.9, 0.7) }, uK: { value: 1 } },
      vertexDecl: 'uniform vec3 uCen; uniform vec2 uSize;', vertexWorld: billboardV, fragDecl: 'uniform vec3 uCol; uniform float uK;',
      frag: `vec2 q = vUv * 2.0 - 1.0; float r = length(q), a = atan(q.y, q.x), edge = 1.0 - smoothstep(0.55, 1.0, r);
        float glow = 0.022 / (r * r + 0.022) * 0.55 + exp(-r * 5.5) * 0.3;
        float six = pow(abs(cos(a * 3.0 + 0.3)), 60.0) * exp(-r * 4.2) * 0.9;
        float streak = exp(-abs(q.y) * 70.0) * exp(-abs(q.x) * 3.2) * 0.9;
        float rays = wgNoise(vec2(a * 9.0, 2.0)) * wgNoise(vec2(a * 23.0, 7.0)) * exp(-r * 6.0) * 0.5;
        col = uCol * (glow + six + streak + rays) * edge * uK;`,
    }));
    moon = new THREE.Mesh(sph, WG.mat.unlit({
      name: 'moon', shadow: false, uniforms: { uCol: { value: new V3(1, 1, 1) }, uLit: { value: new V3(1, 0, 0) } }, vertexDecl: 'varying vec3 vO;', vertexLocal: 'vO = position;', fragDecl: 'uniform vec3 uCol; uniform vec3 uLit; varying vec3 vO;',
      frag: `vec3 o = normalize(vO); float maria = smoothstep(0.42, 0.62, wgNoise3(o * 2.3 + 4.0) * 0.65 + wgNoise3(o * 5.1) * 0.35);
        float cr = 0.0; for (int i = 0; i < 5; i++) { vec3 c = normalize(vec3(sin(float(i) * 2.4 + 0.5), cos(float(i) * 1.7 + 1.0), sin(float(i) * 3.1 + 2.0))); float d = distance(o, c); float rr = 0.16 + 0.05 * float(i % 3); cr += smoothstep(rr, rr * 0.82, d) * 0.5 - smoothstep(rr * 0.75, rr * 0.4, d) * 0.4; }
        float shade = 0.42 + 0.58 * smoothstep(-0.35, 0.75, dot(N, uLit));
        col = uCol * (1.0 - 0.34 * maria + 0.1 * cr) * shade * (0.82 + 0.18 * max(dot(N, V), 0.0));`,
    }));
    moonGlow = new THREE.Mesh(quad, WG.mat.unlit({
      name: 'moonGlow', additive: true, depthWrite: false, uniforms: { uCen: { value: new V3() }, uSize: { value: new THREE.Vector2(2.4, 2.4) }, uCol: { value: new V3(0.4, 0.55, 1) }, uK: { value: 1 }, uRing: { value: 0 } },
      vertexDecl: 'uniform vec3 uCen; uniform vec2 uSize;', vertexWorld: billboardV, fragDecl: 'uniform vec3 uCol; uniform float uK; uniform float uRing;',
      frag: `vec2 q = vUv * 2.0 - 1.0; float r = length(q), edge = 1.0 - smoothstep(0.6, 1.0, r);
        float halo = exp(-r * 4.5) * 0.5 + 0.012 / (r * r + 0.03);
        float ring = exp(-pow((r - 0.56) * 22.0, 2.0));
        vec3 rc = mix(vec3(1.0, 0.75, 0.55), vec3(0.6, 0.8, 1.0), smoothstep(0.52, 0.6, r));
        col = (uCol * halo + rc * ring * uRing * 0.25) * edge * uK;`,
    }));
    for (const m of [sun, sunGlow, moon, moonGlow]) WG.add(m, { pass: 'A' });
    sunGlow.renderOrder = 5; moonGlow.renderOrder = 5;
  }
  const scr = {}, cc = new V3(0, 2.4, 0);
  function bodies(dt) {
    const cam = WG.cam, e = S.sunDir.y;
    sky.hoverK = U.damp(sky.hoverK, sky.hover || sky.grab ? 1 : 0, 10, dt);
    /* sun: grows a little, reddens and flattens toward the horizon */
    const sv = U.smooth(-0.1, 0.0, e);
    const low = U.smooth(0.34, 0.0, e), hs = sky.hover === 'sun' || sky.grab === 'sun' ? sky.hoverK : 0;
    const r = 0.2 * (1 + 0.28 * low) * (1 + 0.14 * hs);
    sun.visible = sunGlow.visible = sv > 0.01;
    sun.position.copy(S.sunPos); sun.scale.set(r * sv, r * sv * (1 - 0.16 * U.smooth(0.12, 0.0, e)), r * sv);
    sunColour(e, sc);
    const veil = (1 - 0.93 * S.storm) * (1 - 0.55 * U.smooth(0.3, 0.95, S.cover)) * (1 - 0.5 * S.fogAvg);
    sun.material.uniforms.uCol.value.copy(sc).multiplyScalar((34 - 18 * low) * (1 + 0.35 * hs) * veil);
    const gu = sunGlow.material.uniforms; gu.uCen.value.copy(S.sunPos); gu.uSize.value.setScalar(3.3 * (1 + 0.2 * low) * (1 + 0.1 * hs)); gu.uCol.value.copy(sc).multiplyScalar(1.15 + 0.35 * hs); gu.uK.value = sv * veil;
    cam.project(S.sunPos.x, S.sunPos.y, S.sunPos.z, sky.sunScreen);
    /* moon: pale by day, bright at night, a coloured ring in humid air */
    const mv = U.smooth(-0.1, 0.0, S.moonDir.y), hm = sky.hover === 'moon' || sky.grab === 'moon' ? sky.hoverK : 0;
    moon.visible = moonGlow.visible = mv > 0.01;
    const mr = 0.27 * (1 + 0.12 * hm);
    moon.position.copy(S.moonPos); moon.scale.setScalar(mr * mv);
    const mb = U.lerp(0.32, 3.4, U.smooth(0.2, 0.9, S.night)) * (1 + 0.3 * hm) * (1 - 0.7 * S.storm);
    moon.material.uniforms.uCol.value.set(0.86 * mb, 0.9 * mb, 1.0 * mb); moon.material.uniforms.uLit.value.copy(S.sunDir).multiplyScalar(-1).add(cc.set(0.5, 0.3, 0.2)).normalize();
    const mu = moonGlow.material.uniforms; mu.uCen.value.copy(S.moonPos); mu.uSize.value.setScalar(2.5 * (1 + 0.1 * hm)); mu.uK.value = mv * U.lerp(0.06, 1, S.night) * (1 + 0.4 * hm); mu.uRing.value = U.smooth(0.58, 0.85, S.humidity) * S.night;
    cam.project(S.moonPos.x, S.moonPos.y, S.moonPos.z, sky.moonScreen);
    /* a body behind the case is drawn before the clouds (so they can hide it); in front of it, after */
    const dc = cam.pos.distanceTo(cc.set(0, 2.4, 0));
    WG.setPass(sun, cam.pos.distanceTo(S.sunPos) > dc ? 'A' : 'B'); WG.setPass(sunGlow, cam.pos.distanceTo(S.sunPos) > dc ? 'A' : 'B');
    WG.setPass(moon, cam.pos.distanceTo(S.moonPos) > dc ? 'A' : 'B'); WG.setPass(moonGlow, cam.pos.distanceTo(S.moonPos) > dc ? 'A' : 'B');
  }

  /* ---------------------------------------------------------------- stars under the lid, shooting stars */
  let shootT = 6, shootLife = 0; const shootA = new V3(), shootB = new V3();
  function buildStars() {
    const n = Q.stars, rnd = U.rng(424242), pos = new Float32Array(n * 3), dat = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = U.lerp(C.X0 + 0.25, C.X1 - 0.25, rnd()); pos[i * 3 + 1] = U.lerp(4.9, C.Y1 - 0.2, Math.pow(rnd(), 0.75)); pos[i * 3 + 2] = U.lerp(C.Z0 + 0.25, C.Z1 - 0.25, rnd());
      const big = rnd() < 0.07; dat[i * 4] = big ? 2.4 + rnd() * 1.2 : 0.7 + rnd() * rnd() * 1.3; dat[i * 4 + 1] = rnd() * 6.283; dat[i * 4 + 2] = rnd(); dat[i * 4 + 3] = big ? 1 : 0;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aDat', new THREE.BufferAttribute(dat, 4));
    stars = new THREE.Points(g, WG.mat.unlit({
      name: 'stars', additive: true, depthWrite: false, uniforms: { uVis: { value: 0 }, uPx: { value: 1 } },
      vertexDecl: 'attribute vec4 aDat; varying vec4 vDat; uniform float uPx;',
      vertexEnd: 'vDat = aDat; gl_PointSize = max(1.5, aDat.x * uPx * 34.0 / gl_Position.w);',
      fragDecl: 'varying vec4 vDat; uniform float uVis;',
      frag: `vec2 q = gl_PointCoord * 2.0 - 1.0; float r = length(q);
        float tw = 0.62 + 0.38 * sin(uTime * (1.3 + vDat.z * 2.4) + vDat.y) * sin(uTime * 0.7 + vDat.y * 3.0);
        float core = exp(-r * r * (vDat.w > 0.5 ? 18.0 : 5.0));
        float cross = vDat.w * (exp(-abs(q.x) * 26.0) * exp(-abs(q.y) * 3.0) + exp(-abs(q.y) * 26.0) * exp(-abs(q.x) * 3.0)) * 0.9;
        vec3 tint = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.88, 0.72), smoothstep(0.55, 1.0, vDat.z));
        col = tint * (core + cross) * tw * uVis * (vDat.w > 0.5 ? 3.2 : 1.7) * (1.0 - smoothstep(0.8, 1.0, r));`,
    }));
    WG.add(stars, { pass: 'A' });
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3)); sg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2)); sg.setIndex([0, 1, 2, 2, 1, 3]);
    shoot = new THREE.Mesh(sg, WG.mat.unlit({ name: 'shootingStar', additive: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uK: { value: 0 } }, fragDecl: 'uniform float uK;', frag: 'col = vec3(0.85, 0.92, 1.0) * uK * 3.0 * smoothstep(0.0, 1.0, vUv.x) * exp(-pow((vUv.y - 0.5) * 5.0, 2.0));' }));
    shoot.visible = false; WG.add(shoot, { pass: 'A' });
  }
  function starsUpdate(dt) {
    stars.visible = sky.starVis > 0.01; stars.material.uniforms.uVis.value = sky.starVis; stars.material.uniforms.uPx.value = WG.render.height / 900;
    shootT -= dt;
    if (shootT <= 0 && shootLife <= 0) {
      shootT = 15 + Math.random() * 25;
      if (sky.starVis > 0.4) { shootLife = 0.7; shootA.set(U.lerp(-4.5, 4.5, Math.random()), U.lerp(6.2, 7.1, Math.random()), U.lerp(-3, 3, Math.random())); const a = Math.random() * 6.283; shootB.set(Math.cos(a) * 2.6, -0.35 - Math.random() * 0.4, Math.sin(a) * 1.7); }
    }
    if (shootLife > 0) {
      shootLife -= dt; const t = 1 - shootLife / 0.7, p = shoot.geometry.attributes.position, cam = WG.cam;
      const hx = U.clamp(shootA.x + shootB.x * t, C.X0 + 0.2, C.X1 - 0.2), hy = shootA.y + shootB.y * t, hz = U.clamp(shootA.z + shootB.z * t, C.Z0 + 0.2, C.Z1 - 0.2), len = 0.5 * Math.sin(Math.PI * t), l = shootB.length();
      const tx = hx - (shootB.x / l) * len, ty = hy - (shootB.y / l) * len, tz = hz - (shootB.z / l) * len, w = 0.02;
      p.setXYZ(0, tx - cam.up.x * w, ty - cam.up.y * w, tz - cam.up.z * w); p.setXYZ(1, hx - cam.up.x * w, hy - cam.up.y * w, hz - cam.up.z * w);
      p.setXYZ(2, tx + cam.up.x * w, ty + cam.up.y * w, tz + cam.up.z * w); p.setXYZ(3, hx + cam.up.x * w, hy + cam.up.y * w, hz + cam.up.z * w); p.needsUpdate = true;
      shoot.material.uniforms.uK.value = Math.sin(Math.PI * t) * sky.starVis; shoot.visible = true;
    } else shoot.visible = false;
  }

  /* ---------------------------------------------------------------- aurora: three curtains just under the lid */
  function buildAurora() {
    for (let i = 0; i < 3; i++) {
      const g = new THREE.PlaneGeometry(10.6, 1.9, 72, 1);
      const m = new THREE.Mesh(g, WG.mat.unlit({
        name: 'aurora', additive: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uK: { value: 0 }, uPh: { value: i * 2.1 } },
        vertexDecl: 'uniform float uPh;', vertexLocal: 'pos.z += sin(pos.x * 0.9 + uTime * 0.22 + uPh) * 0.42 + sin(pos.x * 2.3 - uTime * 0.31 + uPh * 2.0) * 0.16; pos.y += sin(pos.x * 0.6 + uTime * 0.17 + uPh) * 0.1;',
        fragDecl: 'uniform float uK; uniform float uPh;',
        frag: `float h = vUv.y; float rays = 0.45 + 0.55 * wgNoise(vec2(vUv.x * 46.0 + uPh * 9.0 + sin(uTime * 0.2 + uPh) * 2.0, uTime * 0.12));
          float env = smoothstep(0.0, 0.16, h) * pow(1.0 - h, 1.25) * smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
          float drift = 0.55 + 0.45 * wgNoise(vec2(vUv.x * 3.0 - uTime * 0.07 + uPh, 3.0));
          col = mix(vec3(0.1, 1.0, 0.45), vec3(0.55, 0.25, 0.95), smoothstep(0.35, 0.95, h)) * env * rays * drift * uK * 1.25;`,
      }));
      m.position.set(0, 6.35, -2.3 + i * 1.9); m.visible = false; WG.add(m, { pass: 'A' }); aurora.push(m);
    }
  }
  let auroraK = 0;
  function auroraUpdate(dt) {
    const s = U.wrap(S.season, 4), late = U.smooth(2.45, 2.8, s) * U.smooth(3.75, 3.45, s);
    const want = sky.starVis * late * U.smooth(4, 0, S.temp);
    auroraK = U.damp(auroraK, want, 0.5, dt);
    for (const a of aurora) { a.visible = auroraK > 0.01; a.material.uniforms.uK.value = auroraK; }
    sky.aurora = auroraK;
  }

  WG.register('sky', {
    init() { lighting(0); try { buildBodies(); } catch (e) { WG.fail('sky.bodies', e); } try { buildStars(); } catch (e) { WG.fail('sky.stars', e); } try { buildAurora(); } catch (e) { WG.fail('sky.aurora', e); } },
    update(dt) { lighting(dt); if (sun) bodies(dt); if (stars) starsUpdate(dt); if (aurora.length) auroraUpdate(dt); },
  });
})();
