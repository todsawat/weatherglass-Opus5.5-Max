/* Weatherglass — renderer, the frame pipeline and the camera.
   Frame: cloud map -> shadow map -> (lake mirror) -> pass A (everything behind the air) -> air, fog and clouds ->
          pass B (near glass, rain, sparks) -> bloom -> tilt-shift, grade, grain -> screen. */
(function () {
  'use strict';
  const WG = window.WG, THREE = WG.THREE, U = WG.util, C = WG.C, G = WG.G, Q = WG.Q, L = WG.L;
  const canvas = document.getElementById('wg-canvas');
  const R = (WG.render = { pre: [], volMaterial: null, stats: { ms: 16, fps: 60 }, degrade: 0, tiltK: 1 });
  let renderer = null;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
    if (!renderer.capabilities.isWebGL2) throw new Error('WebGL 2 is not available');
  } catch (e) { WG.noGL = true; WG.fail('renderer', e); }
  if (!renderer) return;
  WG.renderer = renderer;
  renderer.autoClear = false; renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping; renderer.setPixelRatio(1);
  renderer.debug.checkShaderErrors = WG.flag('debug') || WG.flag('paused');
  const gl = renderer.getContext();
  try { gl.getExtension('EXT_color_buffer_float'); gl.getExtension('EXT_color_buffer_half_float'); } catch (e) { /* the renderer reports it if HDR targets fail */ }
  const scene = (WG.scene = new THREE.Scene()); scene.matrixWorldAutoUpdate = true;
  const camera = (WG.camera = new THREE.PerspectiveCamera(34, 1.6, 0.4, 160));

  /* ------------------------------------------------------------ full-screen passes */
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  tri.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  const fsScene = new THREE.Scene(), fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), fsMesh = new THREE.Mesh(tri, null);
  fsMesh.frustumCulled = false; fsScene.add(fsMesh);
  const FS_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  R.FS_VERT = FS_VERT;
  R.fsMaterial = (frag, uniforms, extra) => new THREE.ShaderMaterial(Object.assign({ vertexShader: FS_VERT, fragmentShader: frag, uniforms: uniforms || {}, depthTest: false, depthWrite: false }, extra));
  R.blit = (mat, target) => { fsMesh.material = mat; renderer.setRenderTarget(target || null); renderer.render(fsScene, fsCam); };

  /* ------------------------------------------------------------ targets */
  const HF = THREE.HalfFloatType;
  const mkRT = (w, h, o) => new THREE.WebGLRenderTarget(w, h, Object.assign({ type: HF, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false }, o));
  const sceneDepth = new THREE.DepthTexture(4, 4, THREE.UnsignedIntType); sceneDepth.minFilter = sceneDepth.magFilter = THREE.NearestFilter;
  const rtScene = mkRT(4, 4, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, depthTexture: sceneDepth });
  const rtComp = mkRT(4, 4, { depthBuffer: true, depthTexture: sceneDepth });
  const rtVol = mkRT(4, 4);
  const rtBloom = []; for (let i = 0; i < Q.bloom; i++) rtBloom.push(mkRT(4, 4));
  const rtLDR = new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
  const rtRefl = Q.reflect ? mkRT(4, 4, { depthBuffer: true }) : null;
  const shadowDepth = new THREE.DepthTexture(Q.shadow, Q.shadow, THREE.UnsignedIntType); shadowDepth.minFilter = shadowDepth.magFilter = THREE.NearestFilter;
  const rtShadow = new THREE.WebGLRenderTarget(Q.shadow, Q.shadow, { depthBuffer: true, depthTexture: shadowDepth, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  R.rtScene = rtScene; R.rtComp = rtComp; R.rtVol = rtVol; R.rtRefl = rtRefl;

  let W = 4, H = 4, cssW = 4, cssH = 4, cw = 4, ch = 4;
  function resize(force) {
    const el = canvas.parentElement || document.body;
    const w = Math.max(2, el.clientWidth | 0), h = Math.max(2, el.clientHeight | 0), dpr = Math.min(window.devicePixelRatio || 1, Q.dpr);
    const ncw = Math.round(w * dpr), nch = Math.round(h * dpr), nW = Math.max(2, Math.round(ncw * Q.scale)), nH = Math.max(2, Math.round(nch * Q.scale));
    if (!force && ncw === cw && nch === ch && nW === W && nH === H) return;
    cssW = w; cssH = h; cw = ncw; ch = nch; W = nW; H = nH;
    renderer.setSize(cw, ch, false);
    rtScene.setSize(W, H); rtComp.setSize(W, H); rtLDR.setSize(W, H);
    rtVol.setSize(Math.max(2, Math.round(W * Q.volScale)), Math.max(2, Math.round(H * Q.volScale)));
    let bw = W, bh = H; for (const b of rtBloom) { bw = Math.max(2, bw >> 1); bh = Math.max(2, bh >> 1); b.setSize(bw, bh); }
    if (rtRefl) rtRefl.setSize(Math.max(2, W >> 1), Math.max(2, H >> 1));
    camera.aspect = w / h; G.uRes.value.set(W, H);
    R.width = W; R.height = H; R.cssW = cssW; R.cssH = cssH;
    WG.bus.emit('resize', { w: cssW, h: cssH });
  }
  R.resize = resize;
  window.addEventListener('resize', () => resize(false));

  /* ------------------------------------------------------------ shadow map */
  const shadowCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100); shadowCam.layers.set(L.SHADOW);
  const plainDepth = new THREE.ShaderMaterial({ colorWrite: false, side: THREE.DoubleSide, vertexShader: 'void main(){ mat4 M = modelMatrix;\n#ifdef USE_INSTANCING\nM = M * instanceMatrix;\n#endif\n gl_Position = projectionMatrix * viewMatrix * M * vec4(position, 1.0); }', fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }' });
  const corners = []; for (let i = 0; i < 8; i++) corners.push(new THREE.Vector3());
  const v3 = new THREE.Vector3(), m4 = new THREE.Matrix4(), biasM = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  const SB = { x0: C.X0 - 0.75, x1: C.X1 + 0.75, y0: C.TABLE_Y, y1: C.Y1 + 0.75, z0: C.Z0 - 0.75, z1: C.Z1 + 0.75 };
  function renderShadow() {
    const d = G.uSunDir.value, lum = G.uSunCol.value.x + G.uSunCol.value.y + G.uSunCol.value.z;
    if (lum < 0.004 || d.y < 0.03) { G.uShadowP.value.w = 0; return; }
    const cx = 0, cy = 2.2, cz = 0;
    shadowCam.position.set(cx + d.x * 60, cy + d.y * 60, cz + d.z * 60); shadowCam.up.set(0, Math.abs(d.y) > 0.98 ? 0 : 1, Math.abs(d.y) > 0.98 ? -1 : 0); shadowCam.lookAt(cx, cy, cz); shadowCam.updateMatrixWorld(true);
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9, n = 0;
    for (const x of [SB.x0, SB.x1]) for (const y of [SB.y0, SB.y1]) for (const z of [SB.z0, SB.z1]) { const p = corners[n++].set(x, y, z).applyMatrix4(shadowCam.matrixWorldInverse); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    const near = -z1 - 0.5, far = -z0 + Math.min(60, (SB.y1 - SB.y0) / Math.max(d.y, 0.12)) + 1;
    shadowCam.left = x0; shadowCam.right = x1; shadowCam.bottom = y0; shadowCam.top = y1; shadowCam.near = near; shadowCam.far = far; shadowCam.updateProjectionMatrix();
    const list = WG.casters, saved = R._saved || (R._saved = []);
    for (let i = 0; i < list.length; i++) { const o = list[i]; saved[i] = o.material; const dm = o.material && o.material.userData && o.material.userData.depthMat; o.material = dm || plainDepth; }
    renderer.setRenderTarget(rtShadow); renderer.clear(true, true, false); renderer.render(scene, shadowCam);
    for (let i = 0; i < list.length; i++) list[i].material = saved[i];
    G.uShadowMap.value = shadowDepth;
    G.uShadowMat.value.copy(biasM).multiply(shadowCam.projectionMatrix).multiply(shadowCam.matrixWorldInverse);
    const texelWorld = Math.max(x1 - x0, y1 - y0) / Q.shadow;
    G.uShadowP.value.set(1 / Q.shadow, 0.02 / (far - near), ((far - near) * 0.05) / texelWorld, 1);
  }

  /* ------------------------------------------------------------ lake mirror */
  const reflCam = new THREE.PerspectiveCamera(); reflCam.matrixAutoUpdate = false; reflCam.matrixWorldAutoUpdate = false; reflCam.layers.set(L.REFL);
  const flipX = new THREE.Matrix4().makeScale(-1, 1, 1), mirror = new THREE.Matrix4();
  function renderReflection() {
    if (!rtRefl || !R.reflectionWanted) { G.uReflOn.value = 0; return; }
    const y = WG.state.lakeLevel;
    mirror.set(1, 0, 0, 0, 0, -1, 0, 2 * y, 0, 0, 1, 0, 0, 0, 0, 1);
    reflCam.matrixWorld.copy(mirror).multiply(camera.matrixWorld);
    reflCam.matrixWorldInverse.copy(reflCam.matrixWorld).invert();
    reflCam.projectionMatrix.copy(flipX).multiply(camera.projectionMatrix);          // two mirrors keep the triangle winding
    reflCam.projectionMatrixInverse.copy(reflCam.projectionMatrix).invert();
    G.uClipY.value = y - 0.01;
    renderer.setRenderTarget(rtRefl); const e = G.uEnvCol.value; gl.clearBufferfv(gl.COLOR, 0, [e.x, e.y, e.z, 1000]); renderer.clear(false, true, false);
    renderer.render(scene, reflCam);
    G.uClipY.value = -100;
    G.uReflTex.value = rtRefl.texture; G.uReflOn.value = 1;
    G.uReflMat.value.copy(biasM).multiply(reflCam.projectionMatrix).multiply(reflCam.matrixWorldInverse);
  }

  /* ------------------------------------------------------------ post materials */
  const uScene = { value: rtScene.texture }, uVol = { value: rtVol.texture }, uComp = { value: rtComp.texture };
  const compositeMat = R.fsMaterial(/* glsl */ `
    varying vec2 vUv; uniform sampler2D uScene; uniform sampler2D uVol; uniform vec2 uVolRes; uniform float uOn;
    void main(){
      vec4 s = texture2D(uScene, vUv);
      if (uOn < 0.5) { gl_FragColor = vec4(s.rgb, 1.0); return; }
      /* depth-aware upsample of the half-resolution air so cloud edges do not halo round the mountains */
      vec2 p = vUv * uVolRes - 0.5, f = fract(p), b = (floor(p) + 0.5) / uVolRes, t = 1.0 / uVolRes;
      vec4 acc = vec4(0.0); float wsum = 0.0;
      for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
        vec2 uv = b + vec2(float(i), float(j)) * t;
        float d = texture2D(uScene, uv).a;
        float w = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y) / (0.02 + abs(d - s.a) / max(s.a, 0.5));
        acc += texture2D(uVol, uv) * w; wsum += w;
      }
      vec4 v = acc / max(wsum, 1e-5);
      gl_FragColor = vec4(s.rgb * v.a + v.rgb, 1.0);
    }`, { uScene, uVol, uVolRes: { value: new THREE.Vector2(2, 2) }, uOn: { value: 0 } });

  const bloomPre = R.fsMaterial(/* glsl */ `
    varying vec2 vUv; uniform sampler2D uTex; uniform vec2 uPx; uniform float uThresh;
    vec3 pre(vec2 uv){ vec3 c = min(texture2D(uTex, uv).rgb, vec3(60.0)); float l = max(c.r, max(c.g, c.b)); float k = max(l - uThresh, 0.0); k = k*k / (k + 0.6); return c * k / max(l, 1e-4); }
    void main(){ vec3 c = pre(vUv + uPx*vec2(-1,-1)) + pre(vUv + uPx*vec2(1,-1)) + pre(vUv + uPx*vec2(-1,1)) + pre(vUv + uPx*vec2(1,1)); gl_FragColor = vec4(c*0.25, 1.0); }`,
    { uTex: uComp, uPx: { value: new THREE.Vector2() }, uThresh: { value: 1.0 } });
  const bloomDown = R.fsMaterial(/* glsl */ `
    varying vec2 vUv; uniform sampler2D uTex; uniform vec2 uPx;
    void main(){ vec3 c = texture2D(uTex, vUv).rgb*4.0;
      c += texture2D(uTex, vUv + uPx*vec2(-1,-1)).rgb + texture2D(uTex, vUv + uPx*vec2(1,-1)).rgb + texture2D(uTex, vUv + uPx*vec2(-1,1)).rgb + texture2D(uTex, vUv + uPx*vec2(1,1)).rgb;
      gl_FragColor = vec4(c/8.0, 1.0); }`, { uTex: { value: null }, uPx: { value: new THREE.Vector2() } });
  const bloomUp = R.fsMaterial(/* glsl */ `
    varying vec2 vUv; uniform sampler2D uTex; uniform vec2 uPx; uniform float uK;
    void main(){ vec3 c = texture2D(uTex, vUv + uPx*vec2(-1,0)).rgb + texture2D(uTex, vUv + uPx*vec2(1,0)).rgb + texture2D(uTex, vUv + uPx*vec2(0,-1)).rgb + texture2D(uTex, vUv + uPx*vec2(0,1)).rgb;
      c = c*2.0 + texture2D(uTex, vUv + uPx*vec2(-1,-1)).rgb + texture2D(uTex, vUv + uPx*vec2(1,-1)).rgb + texture2D(uTex, vUv + uPx*vec2(-1,1)).rgb + texture2D(uTex, vUv + uPx*vec2(1,1)).rgb;
      gl_FragColor = vec4(c/12.0*uK, 1.0); }`, { uTex: { value: null }, uPx: { value: new THREE.Vector2() }, uK: { value: 1 } },
    { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, transparent: true });

  const P = (R.post = { exposure: 1, bloom: 0.55, vignette: 0.42, grain: 0.035, warm: 0.5, tiltR: 0.0045, tiltBand: 0.27, tiltY: 0.5, flash: 0, sat: 1 });
  const gradeU = { uTex: uComp, uBloom: { value: rtBloom[0].texture }, uPx: { value: new THREE.Vector2() }, uP: { value: new THREE.Vector4() }, uTilt: { value: new THREE.Vector4() }, uT: { value: 0 }, uP2: { value: new THREE.Vector4() } };
  const GRADE = /* glsl */ `
    varying vec2 vUv; uniform sampler2D uTex; uniform sampler2D uBloom; uniform vec2 uPx; uniform vec4 uP; uniform vec4 uTilt; uniform float uT; uniform vec4 uP2;
    float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    vec3 tone(vec3 x){ x *= uP.x; vec3 a = x * (1.0 + x / 9.0) / (1.0 + x); float l = dot(x, vec3(0.2126, 0.7152, 0.0722)); float lt = l * (1.0 + l / 9.0) / (1.0 + l); vec3 b = x * (lt / max(l, 1e-4)); return mix(a, min(b, vec3(1.0)), 0.35); }
    void main(){
      vec3 c;
    #ifdef TILT
      float coc = uTilt.x * smoothstep(uTilt.y, 0.5, abs(vUv.y - uTilt.z));
      if (coc * uTilt.w > 0.6) {
        vec3 acc = vec3(0.0); float ang = h21(gl_FragCoord.xy) * 6.2831853;
        for (int i = 0; i < TILT; i++) { float fi = float(i) + 0.5; float r = sqrt(fi / float(TILT)); float a = fi * 2.399963 + ang; acc += texture2D(uTex, vUv + vec2(cos(a) * uPx.x / uPx.y, sin(a)) * r * coc).rgb; }
        c = acc / float(TILT);
      } else c = texture2D(uTex, vUv).rgb;
    #else
      c = texture2D(uTex, vUv).rgb;
    #endif
      c += texture2D(uBloom, vUv).rgb * uP.y;
      c = tone(c);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uP2.x);
      c *= mix(vec3(1.0), vec3(1.035, 1.0, 0.95), smoothstep(0.45, 1.0, l) * uP.w);           /* very slightly warm highlights */
      vec2 q = vUv - 0.5; float vg = smoothstep(0.25, 0.95, length(q * vec2(1.0, 0.85)) * 1.25);
      c *= 1.0 - vg * uP.z;
      c = pow(max(c, 0.0), vec3(1.0 / 2.2));
    #ifdef TO_SCREEN
      c += (h21(gl_FragCoord.xy + fract(uT) * 517.0) - 0.5) * uP2.y;
    #endif
      gl_FragColor = vec4(c, 1.0);
    }`;
  const gradeMat = R.fsMaterial(GRADE, gradeU, { defines: Object.assign({}, Q.tilt ? { TILT: Q.tier === 2 ? 14 : 9 } : {}, Q.fxaa ? {} : { TO_SCREEN: 1 }) });
  const finishMat = R.fsMaterial(/* glsl */ `
    varying vec2 vUv; uniform sampler2D uTex; uniform vec2 uPx; uniform float uT; uniform float uGrain;
    float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main(){
      vec3 lw = vec3(0.299, 0.587, 0.114);
      vec3 nw = texture2D(uTex, vUv + vec2(-1.0, -1.0)*uPx).rgb, ne = texture2D(uTex, vUv + vec2(1.0, -1.0)*uPx).rgb, sw = texture2D(uTex, vUv + vec2(-1.0, 1.0)*uPx).rgb, se = texture2D(uTex, vUv + vec2(1.0, 1.0)*uPx).rgb, m = texture2D(uTex, vUv).rgb;
      float lnw = dot(nw, lw), lne = dot(ne, lw), lsw = dot(sw, lw), lse = dot(se, lw), lm = dot(m, lw);
      float lmin = min(lm, min(min(lnw, lne), min(lsw, lse))), lmax = max(lm, max(max(lnw, lne), max(lsw, lse)));
      vec2 dir = vec2(-((lnw + lne) - (lsw + lse)), ((lnw + lsw) - (lne + lse)));
      float red = max((lnw + lne + lsw + lse) * 0.03125, 1.0/128.0), rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
      dir = clamp(dir * rcp, -8.0, 8.0) * uPx;
      vec3 a = 0.5 * (texture2D(uTex, vUv + dir * (1.0/3.0 - 0.5)).rgb + texture2D(uTex, vUv + dir * (2.0/3.0 - 0.5)).rgb);
      vec3 b = a * 0.5 + 0.25 * (texture2D(uTex, vUv - dir * 0.5).rgb + texture2D(uTex, vUv + dir * 0.5).rgb);
      float lb = dot(b, lw); vec3 c = (lb < lmin || lb > lmax) ? a : b;
      c += (h21(gl_FragCoord.xy + fract(uT) * 517.0) - 0.5) * uGrain;
      gl_FragColor = vec4(c, 1.0);
    }`, { uTex: { value: rtLDR.texture }, uPx: { value: new THREE.Vector2() }, uT: { value: 0 }, uGrain: { value: 0.035 } });

  /* ------------------------------------------------------------ the frame */
  const invVP = new THREE.Matrix4();
  R.invVP = invVP;
  R.frame = function () {
    resize(false);
    WG.syncGlobals();
    camera.updateMatrixWorld(true);
    invVP.copy(camera.matrixWorld).multiply(camera.projectionMatrixInverse);
    for (const f of R.pre) { try { f(renderer); } catch (e) { if (!f._failed) { f._failed = true; WG.fail('render.pre', e); } } }
    renderShadow();
    renderReflection();
    /* pass A */
    camera.layers.set(L.A);
    renderer.setRenderTarget(rtScene);
    const rc = G.uRoomCol.value; gl.clearBufferfv(gl.COLOR, 0, [rc.x, rc.y, rc.z, 1000]); renderer.clear(false, true, false);
    renderer.render(scene, camera);
    /* air, fog, clouds */
    const vol = R.volMaterial && !WG.flag('novol');
    if (vol) { R.blit(R.volMaterial, rtVol); compositeMat.uniforms.uVolRes.value.set(rtVol.width, rtVol.height); }
    compositeMat.uniforms.uOn.value = vol ? 1 : 0;
    R.blit(compositeMat, rtComp);
    /* pass B */
    camera.layers.set(L.B);
    renderer.setRenderTarget(rtComp); renderer.render(scene, camera);
    camera.layers.set(L.A);
    /* bloom */
    if (!WG.flag('nopost')) {
      bloomPre.uniforms.uPx.value.set(0.5 / W, 0.5 / H); R.blit(bloomPre, rtBloom[0]);
      for (let i = 1; i < rtBloom.length; i++) { bloomDown.uniforms.uTex.value = rtBloom[i - 1].texture; bloomDown.uniforms.uPx.value.set(1 / rtBloom[i - 1].width, 1 / rtBloom[i - 1].height); R.blit(bloomDown, rtBloom[i]); }
      for (let i = rtBloom.length - 2; i >= 0; i--) { bloomUp.uniforms.uTex.value = rtBloom[i + 1].texture; bloomUp.uniforms.uPx.value.set(1 / rtBloom[i + 1].width, 1 / rtBloom[i + 1].height); bloomUp.uniforms.uK.value = 0.85; R.blit(bloomUp, rtBloom[i]); }
    }
    /* grade */
    gradeU.uPx.value.set(1 / W, 1 / H); gradeU.uT.value = WG.time;
    gradeU.uP.value.set(P.exposure, WG.flag('nopost') ? 0 : P.bloom, P.vignette, P.warm); gradeU.uP2.value.set(P.sat, P.grain, 0, 0);
    gradeU.uTilt.value.set(P.tiltR, P.tiltBand, P.tiltY, H);
    if (Q.fxaa) {
      R.blit(gradeMat, rtLDR);
      finishMat.uniforms.uPx.value.set(1 / W, 1 / H); finishMat.uniforms.uT.value = WG.time; finishMat.uniforms.uGrain.value = P.grain;
      renderer.setRenderTarget(null); renderer.setViewport(0, 0, cw, ch); R.blit(finishMat, null);
    } else { renderer.setRenderTarget(null); renderer.setViewport(0, 0, cw, ch); R.blit(gradeMat, null); }
  };

  /* keep the frame rate smooth by trading sharpness */
  let slow = 0, fast = 0;
  R.adapt = (ms) => {
    R.stats.ms = U.lerp(R.stats.ms, ms, 0.06);
    if (WG.flag('paused') || WG.param('scale', null)) return;
    if (R.stats.ms > 21) { slow++; fast = 0; } else if (R.stats.ms < 12.5) { fast++; slow = 0; } else { slow = fast = 0; }
    if (slow > 45 && Q.scale > 0.5) { Q.scale = Math.max(0.5, Q.scale * 0.88); slow = 0; resize(true); }
    else if (slow > 90 && Q.scale <= 0.5 && R.degrade < 2) {
      /* still slow at the lowest sharpness: thin the air pass, then the grass, without removing anything */
      R.degrade++; slow = 0;
      if (R.degrade === 1) { Q.volScale *= 0.7; R.tiltK = 0; resize(true); }
      if (R.degrade === 2) { const m = WG.meadow && WG.meadow.meshes; if (m) for (const k in m) { const o = m[k]; if (o && o.isInstancedMesh && o.count > 4000) o.count = Math.floor(o.count * 0.55); } }
      WG.bus.emit('quality:degrade', { level: R.degrade });
    }
    if (fast > 240 && Q.scale < 1) { Q.scale = Math.min(1, Q.scale * 1.07); fast = 0; resize(true); }
  };
  if (WG.param('scale', null)) Q.scale = WG.paramNum('scale', 1);

  /* ------------------------------------------------------------ camera rig */
  const D2R = Math.PI / 180;
  const cam = (WG.cam = {
    az: 22 * D2R, el: 25 * D2R, zoom: 1, tx: 0.85, ty: 2.4, tz: 0,              // current
    gAz: 22 * D2R, gEl: 25 * D2R, gZoom: 1, gTx: 0.85, gTy: 2.4, gTz: 0,       // goals (set these)
    base: 19.0, fov: 34, trauma: 0, idle: 0, pos: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(), fwd: new THREE.Vector3(),
    EL_MIN: -15 * D2R, EL_MAX: 86 * D2R, ZOOM_MIN: 0.3, ZOOM_MAX: 1.95,
  });
  cam.orbit = (dAz, dEl) => { cam.gAz += dAz; cam.gEl = U.clamp(cam.gEl + dEl, cam.EL_MIN, cam.EL_MAX); cam.idle = 0; };
  cam.dolly = (f) => { cam.gZoom = U.clamp(cam.gZoom * f, cam.ZOOM_MIN, cam.ZOOM_MAX); cam.idle = 0; };
  cam.pan = (dx, dy) => { cam.gTx = U.clamp(cam.gTx - cam.right.x * dx - cam.up.x * dy, -2.2, 2.2); cam.gTy = U.clamp(cam.gTy - cam.up.y * dy, 0.6, 4.6); cam.gTz = U.clamp(cam.gTz - cam.right.z * dx - cam.up.z * dy, -1.6, 1.6); cam.idle = 0; };
  cam.shake = (a) => { if (!WG.reducedMotion) cam.trauma = Math.min(1, cam.trauma + a); };
  cam.reset = () => { cam.gAz = 22 * D2R; cam.gEl = 25 * D2R; cam.gZoom = 1; cam.gTx = 0.85; cam.gTy = 2.4; cam.gTz = 0; };
  cam.set = (azDeg, elDeg, zoom, tx, ty, tz) => { cam.az = cam.gAz = azDeg * D2R; cam.el = cam.gEl = elDeg * D2R; if (zoom) cam.zoom = cam.gZoom = zoom; if (tx !== undefined) { cam.tx = cam.gTx = tx; cam.ty = cam.gTy = ty; cam.tz = cam.gTz = tz; } place(0); };
  const pv = new THREE.Vector3();
  /* world point -> css pixel position {x, y, z: distance in front (negative when behind), nx: -1..1 across the screen} */
  cam.project = (x, y, z, out) => { out = out || {}; pv.set(x, y, z).applyMatrix4(camera.matrixWorldInverse); out.z = -pv.z; pv.applyMatrix4(camera.projectionMatrix); out.nx = pv.x; out.ny = pv.y; out.x = (pv.x * 0.5 + 0.5) * cssW; out.y = (0.5 - pv.y * 0.5) * cssH; return out; };
  cam.panOf = (x, y, z) => { const p = cam.project(x, y, z, cam._p || (cam._p = {})); return p.z > 0 ? U.clamp(p.nx, -1, 1) : 0; };
  /* css pixel -> world ray {o, d} */
  const ro = new THREE.Vector3(), rd = new THREE.Vector3();
  cam.ray = (px, py) => { rd.set((px / cssW) * 2 - 1, 1 - (py / cssH) * 2, 0.5).unproject(camera).sub(ro.copy(camera.position)).normalize(); return { o: ro, d: rd }; };
  function place(dt) {
    const asp = camera.aspect;
    /* a tall screen: widen the lens a little and pull back so the whole case always fits */
    const fov = cam.fov + U.clamp((1.25 - asp) * 9, 0, 9);
    const tanH = Math.tan((fov * D2R) / 2) * asp;
    const fit = Math.max(cam.base, 7.9 / tanH + 3.6);
    const dist = fit * cam.zoom;
    const t = WG.time, breathe = WG.reducedMotion ? 0 : Math.sin(t * 0.55) * 0.022 + Math.sin(t * 0.23) * 0.012;
    const sway = WG.reducedMotion ? 0 : U.smooth(30, 42, cam.idle) * Math.sin(t * 0.06) * 0.05;
    const az = cam.az + sway, el = cam.el, ce = Math.cos(el);
    let sx = 0, sy = 0;
    if (cam.trauma > 0) { const s = cam.trauma * cam.trauma * 0.22; sx = (U.vnoise(t * 31, 1.3, 1) - 0.5) * s; sy = (U.vnoise(t * 29, 7.7, 2) - 0.5) * s; }
    camera.fov = fov; camera.near = Math.max(0.3, dist * 0.04); camera.far = dist + 90; camera.updateProjectionMatrix();
    camera.position.set(cam.tx + Math.sin(az) * ce * dist, Math.max(C.TABLE_Y + 0.35, cam.ty + Math.sin(el) * dist + breathe), cam.tz + Math.cos(az) * ce * dist);
    camera.up.set(0, 1, 0); camera.lookAt(cam.tx + sx, cam.ty + sy, cam.tz); camera.updateMatrixWorld(true);
    cam.pos.copy(camera.position); cam.dist = dist; cam.fit = fit;
    const e = camera.matrixWorld.elements; cam.right.set(e[0], e[1], e[2]); cam.up.set(e[4], e[5], e[6]); cam.fwd.set(-e[8], -e[9], -e[10]);
    /* tilt-shift: stronger and narrower when zoomed in, weaker from above */
    const zin = U.sat((1 - cam.zoom) / 0.7), above = U.smooth(40 * D2R, 82 * D2R, el);
    P.tiltR = (0.0052 + 0.008 * zin) * (1 - 0.75 * above) * R.tiltK; P.tiltBand = 0.27 - 0.13 * zin; P.tiltY = 0.48;
  }
  WG.register('camera', {
    init() { resize(true); place(0); },
    update(dt) {
      const k = 1 - Math.exp(-dt * 7.5);
      cam.az += (cam.gAz - cam.az) * k; cam.el += (cam.gEl - cam.el) * k; cam.zoom += (cam.gZoom - cam.zoom) * (1 - Math.exp(-dt * 6));
      cam.tx += (cam.gTx - cam.tx) * k; cam.ty += (cam.gTy - cam.ty) * k; cam.tz += (cam.gTz - cam.tz) * k;
      cam.trauma = Math.max(0, cam.trauma - dt * 1.6); cam.idle += dt;
      place(dt);
    },
  });
  WG.bus.on('lightning', (e) => cam.shake(0.55 * (e.power || 1)));
})();
