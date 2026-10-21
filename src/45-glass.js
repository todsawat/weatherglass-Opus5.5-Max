/* Weatherglass — the glass: five panes (four walls and a thick bevelled lid) with studio reflections, a mirrored key light,
   bottle-green grazing tint, glowing teal cut edges, faint grime, and the glass in weather: mist that creeps in from the edges,
   beads, drops that gather and run leaving clear streaks, rain on the panes, fern frost, wiping and tapping. */
(function () {
  'use strict';
  const WG = window.WG, THREE = WG.THREE, U = WG.util, C = WG.C, Q = WG.Q;
  const V3 = THREE.Vector3, V4 = THREE.Vector4;

  /* ------------------------------------------------------------------ the five panes
     n: outer normal, u/v: in-plane axes (u x v = n), out: outer face distance along n, inn: inner face,
     rect s0..s1 (along u), h0..h1 (along v) in world units; lidOut/lidL: this side's piece of the lid rim. */
  const PANES = [
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], out: 4.07, inn: 4.0, s0: -6.07, s1: 6.07, h0: -1.8, h1: 7.4, lidOut: 4.17, lidL: 6.17 },
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], out: 4.07, inn: 4.0, s0: -6.07, s1: 6.07, h0: -1.8, h1: 7.4, lidOut: 4.17, lidL: 6.17 },
    { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], out: 6.07, inn: 6.0, s0: -4.07, s1: 4.07, h0: -1.8, h1: 7.4, lidOut: 6.17, lidL: 4.17 },
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], out: 6.07, inn: 6.0, s0: -4.07, s1: 4.07, h0: -1.8, h1: 7.4, lidOut: 6.17, lidL: 4.17 },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], out: 7.58, inn: 7.4, s0: -6.17, s1: 6.17, h0: -4.17, h1: 4.17 },
  ];
  const LID_Y0 = 7.4, LID_Y1 = 7.58, BEV = 0.05, RAIL_TOP = 7.16, RAIL_LOW = -1.35;
  const MW = 192, MH = 128, MN = MW * MH;           // per-pane wipe / clear mask (about 0.065 units a cell)
  const MAXD = 8, NDROPS = [4, 6, 8][Q.tier] || 6;   // running drops per pane (uniform array is always 8)

  const dotA = (a, x, y, z) => a[0] * x + a[1] * y + a[2] * z;
  const world = (P, s, h, d, out) => { out = out || {}; out.x = P.n[0] * d + P.u[0] * s + P.v[0] * h; out.y = P.n[1] * d + P.u[1] * s + P.v[1] * h; out.z = P.n[2] * d + P.u[2] * s + P.v[2] * h; return out; };

  /* ------------------------------------------------------------------ CPU fields: where mist starts, what has been wiped */
  const field = new Float32Array(5 * MN), clear = new Float32Array(5 * MN), ridge = new Float32Array(5 * MN);
  const maskData = new Uint8Array(5 * MN * 2), fieldData = new Uint8Array(5 * MN);
  const ground = [];                                  // per wall: ground height along the pane (MW columns)
  let maskTex = null, fieldTex = null, maskDirty = true, maskLive = false, maskAcc = 0, maskUp = 0;

  function buildFields() {
    const T = WG.terrain;
    for (let p = 0; p < 5; p++) {
      const P = PANES[p], g = new Float32Array(MW); ground[p] = g;
      for (let i = 0; i < MW; i++) {
        if (p === 4) { g[i] = -9; continue; }
        const s = P.s0 + ((i + 0.5) / MW) * (P.s1 - P.s0), w = world(P, s, 0, P.inn - 0.06);
        const x = U.clamp(w.x, C.X0 + 0.04, C.X1 - 0.04), z = U.clamp(w.z, C.Z0 + 0.04, C.Z1 - 0.04);
        let h = -0.2;
        try { if (T && T.height) { h = T.height(x, z); if (T.lakeR && T.lakeR(x, z) < 1) h = Math.max(h, C.LAKE + 0.03); } } catch (e) { /* keep default */ }
        g[i] = h;
      }
      for (let j = 0; j < MH; j++) {
        const h = P.h0 + ((j + 0.5) / MH) * (P.h1 - P.h0);
        for (let i = 0; i < MW; i++) {
          const s = P.s0 + ((i + 0.5) / MW) * (P.s1 - P.s0);
          let F;
          if (p === 4) {
            const d = Math.min(s + 6.0, 6.0 - s, h + 4.0, 4.0 - h);
            F = Math.max(0, d) / 3.0;
          } else {
            const gr = g[i];
            if (h < gr + 0.03) F = 1.5;
            else {
              const dSide = Math.min(s - (P.s0 + 0.03), P.s1 - 0.03 - s), dTop = RAIL_TOP - h, dG = h - gr;
              F = Math.max(0, Math.min(dSide, dTop * 0.78, dG * 1.4 + 0.25)) / 3.0;
            }
          }
          if (F < 1.45) F += U.fbm(s * 0.55 + p * 13.1, h * 0.55 - p * 7.7, 3, 77) * 0.2 + U.fbm(s * 1.8, h * 1.8, 2, 78 + p) * 0.07;
          field[p * MN + j * MW + i] = U.clamp(F, 0, 1.5);
        }
      }
    }
  }
  function uploadMask() {
    for (let k = 0, n = 5 * MN; k < n; k++) { const o = k * 2; maskData[o] = clear[k] * 255; maskData[o + 1] = ridge[k] * 255; }
    if (maskTex) maskTex.needsUpdate = true;
    maskDirty = false;
  }
  /* bilinear sample of a mask array at pane coords */
  function sampleA(A, p, s, h) {
    const P = PANES[p];
    const fx = U.clamp(((s - P.s0) / (P.s1 - P.s0)) * MW - 0.5, 0, MW - 1.001), fy = U.clamp(((h - P.h0) / (P.h1 - P.h0)) * MH - 0.5, 0, MH - 1.001);
    const i = fx | 0, j = fy | 0, a = fx - i, b = fy - j, k = p * MN + j * MW + i;
    return A[k] * (1 - a) * (1 - b) + A[k + 1] * a * (1 - b) + A[k + MW] * (1 - a) * b + A[k + MW + 1] * a * b;
  }
  const S = () => WG.state;
  const waterOf = (p) => { const st = S(); return Math.max((st.mist && st.mist[p]) || 0, ((st.glassFrost || 0) * 0.55)); };
  /* coverage before any wiping, from the start field and the pane's mist level (mirrors the shader without its fine noise) */
  const covField = (F, water) => U.smooth(F - 0.07, F + 0.07, water * 1.12 - 0.04);
  function coverAt(p, s, h) { return covField(sampleA(field, p, s, h), waterOf(p)) * (1 - U.sat(sampleA(clear, p, s, h) * 1.3 - 0.12)); }
  function groundAt(p, s) { if (p === 4) return -9; const P = PANES[p]; return ground[p][U.clamp((((s - P.s0) / (P.s1 - P.s0)) * MW) | 0, 0, MW - 1)]; }

  /* clear a soft disc in the mask; ridgeK > 0 pushes the water aside into a rim (wiping) */
  function stamp(p, s, h, r, amt, ridgeK) {
    const P = PANES[p], cw = (P.s1 - P.s0) / MW, chh = (P.h1 - P.h0) / MH, R = r * 1.3;
    const i0 = Math.max(0, Math.floor((s - R - P.s0) / cw)), i1 = Math.min(MW - 1, Math.ceil((s + R - P.s0) / cw));
    const j0 = Math.max(0, Math.floor((h - R - P.h0) / chh)), j1 = Math.min(MH - 1, Math.ceil((h + R - P.h0) / chh));
    const water = waterOf(p);
    let wiped = 0;
    for (let j = j0; j <= j1; j++) {
      const ch = P.h0 + (j + 0.5) * chh;
      for (let i = i0; i <= i1; i++) {
        const cs = P.s0 + (i + 0.5) * cw, d = Math.hypot(cs - s, ch - h) / r; if (d > 1.3) continue;
        const k = p * MN + j * MW + i, core = (1 - U.smooth(0.7, 1.0, d)) * amt;
        if (ridgeK > 0) {
          const before = covField(field[k], water) * (1 - U.sat(clear[k] * 1.3 - 0.12));
          wiped += before * core;
          const rim = Math.exp(-Math.pow((d - 1.05) / 0.11, 2));
          ridge[k] = U.sat(ridge[k] * (1 - core) + rim * before * ridgeK);
        } else ridge[k] *= 1 - core * 0.6;
        if (core > clear[k]) clear[k] = core;
      }
    }
    maskDirty = true; maskLive = true;
    return wiped;
  }
  function decayMask(dt) {
    let any = false; const kc = dt / 55, kr = dt / 38;
    for (let k = 0, n = 5 * MN; k < n; k++) {
      if (clear[k] > 0) { clear[k] = Math.max(0, clear[k] - kc); any = true; }
      if (ridge[k] > 0) { ridge[k] = Math.max(0, ridge[k] - kr); any = true; }
    }
    if (any) maskDirty = true;
    maskLive = any;
  }

  /* ------------------------------------------------------------------ detail texture: R fern frost, G scratches + dust, B smudges */
  function makeDetail() {
    const N = 1024, cv = document.createElement('canvas'); cv.width = cv.height = N;
    const g = cv.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, N, N);
    g.globalCompositeOperation = 'lighter'; g.lineCap = 'round'; g.lineJoin = 'round';
    const rnd = U.rng(45117);
    /* frost: feathery ferns, each a curving stem with alternating side branches which branch again */
    const paths = [[], [], []];
    function fernAt(rr, x, y, a, len) {
      const f2 = (x2, y2, a2, l2, depth) => {
        const steps = Math.max(3, Math.round(l2 / 7)), st = l2 / steps, curl = (rr() - 0.5) * 0.05; let cx = x2, cy = y2, ang = a2;
        const seg = paths[depth]; seg.push(cx, cy, NaN);
        for (let i = 0; i < steps; i++) {
          const nx = cx + Math.cos(ang) * st, ny = cy + Math.sin(ang) * st; seg.push(nx, ny, 0);
          if (depth < 2 && i > 0 && i < steps - 1) {
            const k = 1 - i / steps, side = (i & 1) ? 1 : -1, sub = l2 * (depth === 0 ? 0.42 : 0.5) * k * (0.7 + rr() * 0.5);
            if (sub > 5) f2(nx, ny, ang + side * (0.95 + rr() * 0.35), sub, depth + 1);
            if (depth === 0 && rr() < 0.75 && sub > 5) f2(nx, ny, ang - side * (0.95 + rr() * 0.35), sub * 0.85, depth + 1);
          }
          cx = nx; cy = ny; ang += curl + (rr() - 0.5) * 0.12;
        }
      };
      f2(x, y, a, len, 0);
    }
    for (let f = 0; f < 70; f++) {
      const x = rnd() * N, y = rnd() * N, a = rnd() * Math.PI * 2, len = 70 + rnd() * 170;
      /* the same fern again at each wrap offset it reaches, so the texture tiles */
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        if ((ox && (x + ox * N < -len * 1.3 || x + ox * N > N + len * 1.3)) || (oy && (y + oy * N < -len * 1.3 || y + oy * N > N + len * 1.3))) continue;
        fernAt(U.rng(f * 977 + 13), x + ox * N, y + oy * N, a, len);
      }
    }
    const widths = [2.6, 1.6, 1.0], alphas = [0.85, 0.7, 0.55];
    for (let d = 0; d < 3; d++) {
      const a = paths[d]; g.strokeStyle = `rgba(255,0,0,${alphas[d]})`; g.lineWidth = widths[d]; g.beginPath();
      for (let i = 0; i < a.length; i += 3) { if (a[i + 2] !== a[i + 2]) g.moveTo(a[i], a[i + 1]); else g.lineTo(a[i], a[i + 1]); }
      g.stroke();
    }
    /* scratches: hairlines and the faint swirls of an old polishing cloth */
    for (let i = 0; i < 90; i++) {
      const x = rnd() * N, y = rnd() * N, a = rnd() * Math.PI, l = 15 + rnd() * rnd() * 260;
      g.strokeStyle = `rgba(0,255,0,${0.25 + rnd() * 0.55})`; g.lineWidth = 0.6 + rnd() * 0.7; g.beginPath();
      g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (rnd() - 0.5) * 18, y + Math.sin(a) * l * 0.5 + (rnd() - 0.5) * 18, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    for (let i = 0; i < 9; i++) {
      const x = rnd() * N, y = rnd() * N, r0 = 30 + rnd() * 90;
      for (let k = 0; k < 7; k++) { const r = r0 + k * (3 + rnd() * 4), a0 = rnd() * 6.28; g.strokeStyle = `rgba(0,255,0,${0.08 + rnd() * 0.12})`; g.lineWidth = 0.6; g.beginPath(); g.arc(x, y, r, a0, a0 + 0.6 + rnd() * 1.6); g.stroke(); }
    }
    /* dust specks */
    for (let i = 0; i < 1600; i++) { const x = rnd() * N, y = rnd() * N, r = 0.5 + rnd() * rnd() * 1.6; g.fillStyle = `rgba(0,255,0,${0.35 + rnd() * 0.65})`; g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill(); }
    /* greasy smudges and smears */
    for (let i = 0; i < 46; i++) {
      const x = rnd() * N, y = rnd() * N, r = 18 + rnd() * 80, sx = 0.5 + rnd(), a = rnd() * 3.14;
      g.save(); g.translate(x, y); g.rotate(a); g.scale(sx, 1 / sx);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, r); gr.addColorStop(0, `rgba(0,0,255,${0.18 + rnd() * 0.3})`); gr.addColorStop(0.6, `rgba(0,0,255,${0.08 + rnd() * 0.12})`); gr.addColorStop(1, 'rgba(0,0,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r, 0, 6.2832); g.fill(); g.restore();
    }
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
    t.anisotropy = Q.tier >= 1 ? 4 : 1; t.needsUpdate = true;
    return t;
  }

  /* ------------------------------------------------------------------ shader */
  const FRAG_DECL = /* glsl */ `
varying float vKind; varying float vBand;
uniform vec3 uPN; uniform vec3 uPU; uniform vec3 uPV; uniform vec4 uRect; uniform vec4 uFrame; uniform float uPane;
uniform vec4 uState; uniform vec4 uTaps[3]; uniform vec4 uDrops[8];
uniform sampler2D uMask; uniform sampler2D uField; uniform sampler2D uDetail;
uniform vec3 uKeyPos; uniform vec3 uKeyCol; uniform vec4 uGlassP;
float gLum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
/* the studio as the glass sees it: the same four tall softboxes and the overhead one as wgStudio, but reaching lower,
   so a camera looking down on the case still catches their long vertical reflections in the panes */
vec3 gStudio(vec3 R, float rough){
  vec3 col = uRoomCol * (0.55 + 0.6*max(R.y, 0.0));
  float az = atan(R.z, R.x), el = asin(clamp(R.y, -1.0, 1.0)), soft = 0.05 + rough*0.55, boxes = 0.0;
  for (int i = 0; i < 4; i++) { float a0 = 0.785398 + 1.570796*float(i); float da = abs(atan(sin(az - a0), cos(az - a0)));
    boxes += smoothstep(0.08 + soft, 0.08 - soft*0.5, da) * (0.75 + 0.25*smoothstep(0.08, 0.0, da)) * smoothstep(-0.95 - soft, -0.62, el) * smoothstep(1.02 + soft, 0.86 - soft, el)
           * (0.3 + 0.7*smoothstep(-0.7, 0.25, el)) * (i == 1 ? 1.0 : 0.7); }
  float top = smoothstep(0.80 - soft, 0.93, R.y);
  col += (vec3(1.0, 0.955, 0.89)*boxes*1.5 + vec3(1.0, 0.97, 0.93)*top*1.6) * uStudio.x / (1.0 + rough*2.5);
  return col;
}
vec3 gIri(float x){ return 0.5 + 0.5*cos(6.2831853*(x + vec3(0.0, 0.33, 0.67))); }
/* a water lens (bead or drop), o in radii: x inside, y dark refracting band, z focused light + thin rim, w glint */
vec4 gLens(vec2 o, float px, vec2 Lp){
  float d = length(o), aa = min(0.9, px*1.5 + 0.04);
  float ins = smoothstep(1.0, 1.0 - aa, d);
  float dark = smoothstep(0.45, 0.93, d) * ins;
  float caust = smoothstep(0.85, 0.15, length(o + Lp*0.42)) * ins;
  float rim = smoothstep(0.78, 0.96, d) * ins * (0.35 + 0.65*max(0.0, dot(normalize(o + 1e-4), -Lp)));
  float spec = smoothstep(0.32, 0.0, length(o - Lp*0.48)) * ins;
  return vec4(ins, dark, caust*0.7 + rim, spec);
}
/* one layer of condensation beads on a rotated, jittered grid */
vec4 gBeads(vec2 p, float scale, float amt, vec2 Lp, float seed){
  float an = seed*0.7; mat2 m = mat2(cos(an), sin(an), -sin(an), cos(an));
  vec2 q = (m*p)*scale; vec2 c = floor(q); vec2 f = fract(q) - 0.5; vec2 h = wgHash2(c + seed); vec2 h2 = wgHash2(c.yx + seed*1.7);
  float rad = (0.1 + 0.3*h.y*h.y) * smoothstep(0.0, 0.3, amt - h.x*0.75);
  if (rad < 0.01) return vec4(0.0);
  vec2 o = (f - (h2 - 0.5)*(1.0 - 2.0*rad)) / rad;
  float px = fwidth(q.x) / rad;
  return gLens(o, px, m*Lp) * smoothstep(1.1, 0.35, px);
}
float gPrints(vec2 sh){
  float acc = 0.0;
  for (int i = 0; i < 3; i++) {
    vec2 hs = wgHash2(vec2(uPane*3.17 + float(i)*1.31, 4.7 + float(i)));
    vec2 c = mix(uFrame.xz + vec2(0.5, 1.6), uFrame.yw - vec2(0.5, 0.6), hs);
    float ang = hs.x*6.2831853 + hs.y*2.0, cs = cos(ang), sn = sin(ang);
    vec2 q = sh - c; q = vec2(cs*q.x - sn*q.y, sn*q.x + cs*q.y) / vec2(0.15, 0.2);
    float r = length(q); if (r > 1.3) continue;
    float m = smoothstep(1.05, 0.55, r + (wgNoise(q*3.0 + hs*10.0) - 0.5)*0.45);
    float ph = length(q*vec2(1.0, 0.82) + vec2(0.0, 0.18)) * 56.0 + wgNoise(q*2.2 + hs*5.0)*2.4;
    float aa = smoothstep(2.4, 0.9, fwidth(ph));
    acc += m * mix(0.45, 0.5 + 0.5*sin(ph), aa) * (0.65 + 0.35*wgNoise(q*5.0));
  }
  return acc;
}
`;
  const FRAG = /* glsl */ `
  vec2 sh = vec2(dot(P, uPU), dot(P, uPV));
  float outF = dot(cameraPosition - P, uPN) > 0.0 ? 1.0 : 0.0;
  vec3 Lk = normalize(uKeyPos - P);
  float edgeL = uGlassP.y;
  if (vKind > 0.5) {
    /* ---- a cut edge or the lid's bevel: light trapped in the glass glows teal-green, with bands that move with the eye */
    float ph = dot(V, uPU)*10.0 + dot(V, N)*15.0 + dot(V, uPV)*6.0;
    float b1 = 0.5 + 0.5*sin(vBand*15.0 + ph), b2 = 0.5 + 0.5*sin(vBand*38.0 - ph*1.7);
    vec3 teal = vec3(0.045, 0.25, 0.175);
    col = teal * edgeL * (0.58 + 0.42*b1 + 0.2*b2);
    if (vKind > 1.5) col *= 1.45;
    float ndvE = clamp(dot(N, V), 0.0, 1.0), frE = 0.04 + 0.96*pow(1.0 - ndvE, 5.0);
    vec3 RE = reflect(-V, N);
    col += wgStudio(RE, 0.1) * frE * (vKind > 1.5 ? 1.1 : 0.3) * vec3(0.8, 1.0, 0.95);
    col += uKeyCol * (pow(max(dot(RE, Lk), 0.0), 400.0)*3.0 + 0.22*teal*4.0*max(dot(N, uSunDir), 0.0));
    col += (uFlashCol*0.2) * teal * 0.5;
    alpha = 0.84;
  } else {
    /* ---- a pane face */
    vec3 n = outF > 0.5 ? uPN : -uPN;
    vec2 rs = uRect.yw - uRect.xz, uv01 = (sh - uRect.xz) / rs;
    vec2 tilt = vec2(0.0);
    if (abs(uState.w) > 1e-5) {
      vec2 a = uv01 * 3.14159265;
      tilt += uState.w * (vec2(cos(a.x)*sin(a.y), sin(a.x)*cos(a.y)) + 0.6*vec2(cos(a.x*3.0)*sin(a.y*2.0), sin(a.x*3.0)*cos(a.y*2.0)));
    }
    /* tap rings: two faint iridescent ripples */
    vec3 ringC = vec3(0.0);
    for (int i = 0; i < 3; i++) {
      vec4 tp = uTaps[i]; if (tp.w <= 0.001) continue;
      vec2 dv = sh - tp.xy; float d = length(dv);
      for (int k = 0; k < 2; k++) {
        float ag = tp.z - float(k)*0.17; if (ag <= 0.0) continue;
        float rr = ag*2.3 + 0.03, w = 0.025 + ag*0.04, x = (d - rr)/w, e = exp(-x*x), fade = exp(-ag*1.5) * tp.w * (k == 0 ? 1.0 : 0.65);
        ringC += gIri(d*1.6 - ag*0.9 + float(k)*0.37) * e * fade;
        tilt += (dv / max(d, 1e-3)) * (-x*e) * 0.03 * fade;
      }
    }
    n = normalize(n + (uPU*tilt.x + uPV*tilt.y));
    float ndv = clamp(dot(n, V), 0.001, 1.0);
    float fr = 0.04 + 0.96*pow(1.0 - ndv, 5.0);
    vec3 R = reflect(-V, n);
    /* outside: the studio's softboxes; inside: the diorama's own sky and haze */
    vec3 env = outF > 0.5 ? gStudio(R, 0.05) : (wgSkyEnv(R)*0.22 + uRoomCol);
    float keySide = step(0.0, dot(Lk, n));
    float rk = max(dot(R, Lk), 0.0);
    float sharp = uGlassP.x > 0.5 ? 9000.0 : 2600.0;
    vec3 keyR = uKeyCol * (pow(rk, sharp)*(uGlassP.x > 0.5 ? 140.0 : 70.0) + pow(rk, 260.0)*0.9 + pow(rk, 40.0)*0.04) * keySide;
    keyR *= outF > 0.5 ? 1.0 : 0.3;
    col = env * fr * 1.05 + keyR * (fr + 0.06) + (uFlashCol*0.2) * (fr*0.7 + 0.012);
    /* bottle green: faint straight on, stronger at grazing angles and near the frame, with light/dark bands at the edge */
    float dfr = min(min(sh.x - uFrame.x, uFrame.y - sh.x), min(sh.y - uFrame.z, uFrame.w - sh.y));
    float topK = uPane < 3.5 ? 0.6 + 0.8*smoothstep(0.5, 0.0, uFrame.w - sh.y) : 1.6;
    float nearF = exp(-max(dfr, 0.0) / 0.12);
    float graze = pow(1.0 - ndv, 3.0);
    float tintA = 0.006 + 0.2*graze + 0.08*nearF;
    float ambL = gLum(uSkyCol)*0.45 + gLum(uRoomCol)*4.0 + 0.035*uStudio.x;
    col += vec3(0.11, 0.30, 0.235) * ambL * tintA;
    float bph = dfr*72.0 + dot(V, uPU)*13.0 + dot(V, uPV)*9.0 + dot(V, uPN)*7.0;
    float bands = mix(0.5, 0.5 + 0.5*sin(bph), smoothstep(2.6, 0.9, fwidth(bph)));
    col += vec3(0.07, 0.30, 0.215) * edgeL * exp(-max(dfr, 0.0)/0.045) * (0.35 + 0.9*bands) * topK * 0.8;
    alpha = fr*0.75 + tintA;
    /* grime that only shows where light catches it */
    vec2 duv = sh/12.0 + vec2(0.31, 0.17)*uPane;
    vec4 det = texture2D(uDetail, duv);
    float prints = gPrints(sh);
    vec3 catchL = (outF > 0.5 ? gStudio(R, 0.6) : wgSkyEnv(R)*0.5) + uKeyCol * (pow(rk, 30.0)*0.9 + pow(rk, 5.0)*0.06) * keySide + (uFlashCol*0.2)*0.06;
    float imp = det.b*0.09 + prints*0.11 + det.g*0.4;
    col += catchL * imp * (0.22 + fr*2.5);
    alpha += imp*0.012;
    col += ringC * 0.2 * (0.35 + gLum(env)*0.6 + edgeL*0.35);

    /* ---- the inside of the glass: mist, beads, drops, rain, frost */
    vec2 Lp = vec2(dot(uSunDir, uPU), dot(uSunDir, uPV)); Lp = Lp / max(length(Lp), 1e-3);
    vec2 muv = vec2(clamp(uv01.x, 0.0, 1.0), (uPane + clamp(uv01.y, 0.006, 0.994)) / 5.0);
    vec4 mk = texture2D(uMask, muv);
    float water = max(uState.x, uState.y*0.55);
    float aM = 0.0; vec3 cM = vec3(0.0);
    vec3 mAmb = uSkyCol*0.45 + uEnvCol*0.3 + uRoomCol*3.0 + vec3(0.05, 0.048, 0.045)*uStudio.x;
    float fwd = pow(max(dot(-V, uSunDir), 0.0), 5.0), behind = dot(uSunDir, n) < 0.0 ? 1.0 : 0.0;
    vec3 mCol = mAmb + uSunCol * (max(dot(n, uSunDir), 0.0)*0.1 + behind*(0.05 + 0.5*fwd)) + (uFlashCol*0.2)*0.12;
    float frz = smoothstep(0.0, 1.0, uState.y);
    float dropIn = 0.0; vec3 dropC = vec3(0.0); float dropA = 0.0;
    if (water > 0.004 || mk.g > 0.01) {
      float fN = texture2D(uField, muv).r*1.5 + (wgNoise(sh*6.0) - 0.5)*0.07 + (wgNoise(sh*19.0 + 3.0) - 0.5)*0.035;
      float clr = clamp(mk.r*1.3 - wgNoise(sh*3.3 + 7.0)*0.32, 0.0, 1.0);
      float wl = water*1.12 - 0.04;
      float cov = smoothstep(fN - 0.11, fN + 0.09, wl) * (1.0 - clr);
      /* fine grain of the condensation: micro-droplets, fading out where they get smaller than a pixel */
      vec2 gq = sh*42.0; float gAA = smoothstep(1.2, 0.4, fwidth(gq.x));
      float grain = mix(0.5, wgNoise(gq), gAA)*0.55 + wgNoise(sh*13.0)*0.45;
      float dens = cov * (0.17 + 0.27*water) * (0.55 + 0.45*smoothstep(fN, fN + 0.3, wl)) * (0.78 + 0.44*grain) * (0.88 + 0.24*wgNoise(sh*2.3 + 1.7));
      /* mist */
      aM = dens * (1.0 - frz);
      cM = mCol * aM;
      /* beads as it thickens */
      float bAmt = smoothstep(0.3, 0.85, water) * cov * (1.0 - frz);
      if (bAmt > 0.01) {
        vec4 bb = max(max(gBeads(sh, 17.0, bAmt, Lp, 3.0), gBeads(sh + 0.37, 8.0, bAmt*0.85 - 0.1, Lp, 11.0)), gBeads(sh + 1.3, 31.0, bAmt*1.1, Lp, 5.0));
        aM *= 1.0 - bb.x*0.85;
        cM *= 1.0 - bb.x*0.85;
        cM += bb.z * (mCol*0.75 + env*0.25) + bb.w * (uKeyCol*0.5 + vec3(gLum(env))*1.6 + 0.12);
        aM += bb.y * 0.4 + bb.x*0.05;
      }
      /* the ridge of water pushed aside by a wipe */
      float rg = smoothstep(0.05, 0.7, mk.g);
      if (rg > 0.0) {
        vec4 rb = gBeads(sh, 26.0, rg*1.2, Lp, 21.0);
        cM += rg * (mCol*0.18 + env*0.25) + rb.z*rg*mCol*0.7 + rb.w*rg*(uKeyCol*0.4 + vec3(gLum(env))*1.4 + 0.1);
        aM = max(aM, rg*0.32);
      }
      /* frost: fern-like crystals that grow in from the edges and sparkle */
      if (frz > 0.001) {
        float fern = max(texture2D(uDetail, sh/4.2 + vec2(0.13, 0.71)*uPane).r, texture2D(uDetail, sh.yx/3.1 + vec2(0.57, 0.29)*uPane).r*0.85);
        float grow = smoothstep(fN - 0.05, fN + 0.32, water*1.15) * (1.0 - clr);
        float cry = smoothstep(0.2, 0.8, fern*(0.55 + 0.65*grow)) * grow;
        float haze = cov*0.16 + grow*0.06;
        vec3 fc = mCol*1.15 + vec3(0.03, 0.04, 0.055);
        float gl = step(0.988, wgHash(floor(sh*80.0) + floor(V.xy*7.0 + V.z*5.0)));
        cM += frz * (fc*(cry*0.55 + haze) + gl*cry*(uKeyCol*2.5 + vec3(gLum(env))*3.0 + 0.6));
        aM += frz * (cry*0.55 + haze);
      }
    }
    /* drops that gather, hang and run (from the CPU) */
    for (int i = 0; i < 8; i++) {
      vec4 dr = uDrops[i]; if (dr.z <= 0.0) continue;
      vec2 o = (sh - dr.xy) / vec2(dr.z, dr.z*dr.w);
      o.y += 0.18*o.x*o.x*(dr.w - 1.0);
      float d = length(o); if (d > 1.4) continue;
      vec4 ln = gLens(o, fwidth(sh.x) / dr.z, Lp);
      dropIn = max(dropIn, ln.x);
      dropC += ln.x*(mAmb*0.1*(0.5 - 0.5*o.y)) + ln.z*(mCol*0.9 + env*0.35) + ln.w*(uKeyCol*1.2 + vec3(gLum(env))*2.5 + 0.3);
      dropA = max(dropA, ln.y*0.55 + ln.x*0.06);
    }
    /* rain running down a wall */
    float rainA = 0.0; vec3 rainC = vec3(0.0);
    if (uState.z > 0.02 && uPane < 3.5) {
      float pxs = fwidth(sh.x);
      for (int l = 0; l < 2; l++) {
        float cw = l == 0 ? 0.14 : 0.23;
        float qx = sh.x / cw + float(l)*0.5, ci = floor(qx);
        vec2 hh = wgHash2(vec2(ci, uPane*7.0 + float(l)*31.0));
        if (hh.x > uState.z*0.85) continue;
        float span = rs.y + 3.0, speed = 1.3 + 2.4*hh.y;
        float tt = uTime*speed + hh.y*37.0; tt += 0.35*sin(tt*1.7 + hh.x*9.0);
        float head = uRect.w + 1.0 - mod(tt, span);
        float rr = 0.022 + 0.016*hh.y;
        float x = (fract(qx) - 0.5)*cw + sin(sh.y*6.0 + hh.x*20.0)*0.014;
        float dy = sh.y - head;
        float hd = length(vec2(x, dy*0.7)) / rr;
        float hIn = smoothstep(1.0, 0.65, hd);
        float tw = max(rr*0.3, pxs*0.7);
        float trail = smoothstep(tw, tw*0.3, abs(x)) * (rr*0.3/tw) * step(0.0, dy) * exp(-dy*1.4);
        rainA = max(rainA, hIn*0.3 + trail*0.16);
        rainC += hIn*(mCol*0.3 + env*0.5) + smoothstep(0.35, 0.0, length(vec2(x, dy*0.7)/rr - vec2(Lp.x, Lp.y)*0.4))*hIn*(uKeyCol*0.6 + vec3(gLum(env))*1.5) + trail*(mCol*0.25 + env*0.4);
        aM *= 1.0 - trail*0.7; cM *= 1.0 - trail*0.7;
      }
      /* clinging spatter */
      vec4 sb = gBeads(sh + vec2(0.0, floor(uTime*0.25 + 0.5)*0.13), 9.0, uState.z*0.9, Lp, 41.0);
      rainA = max(rainA, sb.y*0.45 + sb.x*0.04);
      rainC += sb.z*(mCol*0.6 + env*0.3) + sb.w*(uKeyCol*0.4 + vec3(gLum(env))*1.5);
    }
    aM *= 1.0 - dropIn*0.9; cM *= 1.0 - dropIn*0.9;
    float tr = 1.0 - fr;
    col += (cM + dropC + rainC) * tr;
    alpha = 1.0 - (1.0 - clamp(alpha, 0.0, 1.0)) * (1.0 - clamp(aM, 0.0, 0.92)) * (1.0 - dropA) * (1.0 - rainA);
  }
`;

  /* ------------------------------------------------------------------ geometry */
  function geoBuilder() {
    const pos = [], nrm = [], kind = [], band = [], uv = [], idx = [];
    const api = {
      quad(a, b, c, d, n, k, ba, bb) {     /* corners a b c d, band values ba (a,b side) bb (c,d side) */
        const i0 = pos.length / 3;
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const flip = cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] < 0;
        for (const [p, bv, u, v] of [[a, ba, 0, 0], [b, ba, 1, 0], [c, bb, 1, 1], [d, bb, 0, 1]]) { pos.push(p[0], p[1], p[2]); nrm.push(n[0], n[1], n[2]); kind.push(k); band.push(bv); uv.push(u, v); }
        if (flip) idx.push(i0, i0 + 2, i0 + 1, i0, i0 + 3, i0 + 2); else idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
      },
      build(cx, cy, cz) {
        for (let i = 0; i < pos.length; i += 3) { pos[i] -= cx; pos[i + 1] -= cy; pos[i + 2] -= cz; }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
        g.setAttribute('aBand', new THREE.Float32BufferAttribute(band, 1));
        g.setIndex(idx); g.computeBoundingSphere();
        return g;
      },
    };
    return api;
  }
  const W3 = (P, s, h, d) => { const o = world(P, s, h, d); return [o.x, o.y, o.z]; };
  function paneGeometry(p) {
    const P = PANES[p], B = geoBuilder();
    if (p < 4) {
      /* the outer face */
      B.quad(W3(P, P.s0, P.h0, P.out), W3(P, P.s1, P.h0, P.out), W3(P, P.s1, P.h1, P.out), W3(P, P.s0, P.h1, P.out), P.n, 0, 0, 0);
      /* the wall's top cut edge, seen through the lid */
      const y = LID_Y0 - 0.002, a = W3(P, P.s0 + 0.0, 0, P.inn), b = W3(P, P.s1, 0, P.inn), c = W3(P, P.s1, 0, P.out), d = W3(P, P.s0, 0, P.out);
      a[1] = b[1] = c[1] = d[1] = y;
      B.quad(a, b, c, d, [0, 1, 0], 1, 0, 1);
      /* this side's part of the lid rim: a vertical cut face and a 45 degree bevel above it */
      const L = P.lidL, o = P.lidOut, yb = LID_Y1 - BEV;
      const r0 = W3(P, -L, 0, o), r1 = W3(P, L, 0, o), r2 = W3(P, L, 0, o), r3 = W3(P, -L, 0, o);
      r0[1] = r1[1] = LID_Y0; r2[1] = r3[1] = yb;
      B.quad(r0, r1, r2, r3, P.n, 1, 0, 1);
      const bn = new V3(P.n[0], 1, P.n[2]).normalize();
      const v0 = W3(P, -L, 0, o), v1 = W3(P, L, 0, o), v2 = W3(P, L - BEV, 0, o - BEV), v3 = W3(P, -L + BEV, 0, o - BEV);
      v0[1] = v1[1] = yb; v2[1] = v3[1] = LID_Y1;
      B.quad(v0, v1, v2, v3, [bn.x, bn.y, bn.z], 2, 0, 1);
      const c3 = W3(P, 0, (P.h0 + P.h1) / 2, P.out);
      return { geo: B.build(c3[0], c3[1], c3[2]), centre: c3 };
    }
    const e = BEV, x0 = P.s0 + e, x1 = P.s1 - e, z0 = P.h0 + e, z1 = P.h1 - e;
    B.quad([x0, LID_Y1, -z0], [x1, LID_Y1, -z0], [x1, LID_Y1, -z1], [x0, LID_Y1, -z1], [0, 1, 0], 0, 0, 0);
    return { geo: B.build(0, LID_Y1, 0), centre: [0, LID_Y1, 0] };
  }

  /* ------------------------------------------------------------------ state */
  const meshes = [], mats = [], near = [null, null, null, null, null];
  const shared = { uKeyPos: { value: new V3(0, 20, 0) }, uKeyCol: { value: new V3() }, uGlassP: { value: new V4(0, 1, Q.tier, 0) }, uMask: { value: null }, uField: { value: null }, uDetail: { value: null } };
  const taps = [[], [], [], [], []], shiver = [0, 0, 0, 0, 0].map(() => ({ t: 9, a: 0 }));
  const drops = [];
  const spawnAcc = [0, 0, 0, 0, 0];
  const lastWipe = { p: -1, s: 0, h: 0, t: -9 };
  let firstWipe = true;
  const rand = Math.random;

  /* ------------------------------------------------------------------ drops: gather, hang, run in fits and starts */
  function newDrop(d) { d.on = false; d.s = 0; d.h = 0; d.r = 0; d.rMax = 0; d.mode = 0; d.t = 0; d.dur = 0; d.vy = 0; d.go = false; d.goT = 0; d.spd = 0; d.ph = 0; d.st = 1; d.travel = 0; d.ls = 0; d.lh = 0; d.life = 0; return d; }
  function spawnDrop(p, fromRain) {
    const P = PANES[p], list = drops[p];
    let d = null; for (let i = 0; i < NDROPS; i++) if (!list[i].on) { d = list[i]; break; }
    if (!d) return;
    for (let tries = 0; tries < 10; tries++) {
      const s = P.s0 + 0.45 + rand() * (P.s1 - P.s0 - 0.9);
      let h;
      if (p === 4) h = P.h0 + 0.4 + rand() * (P.h1 - P.h0 - 0.8);
      else { const g = Math.max(groundAt(p, s), RAIL_LOW); h = U.lerp(g + 1.0, RAIL_TOP - 0.25, Math.sqrt(rand())); if (h < g + 0.9) continue; }
      if (!fromRain && coverAt(p, s, h) < 0.6) continue;
      newDrop(d); d.on = true; d.s = d.ls = s; d.h = d.lh = h; d.rMax = (fromRain ? 0.05 : 0.045) + rand() * 0.045; d.r = fromRain ? d.rMax * 0.8 : 0.01;
      d.mode = fromRain ? 1 : 0; d.dur = fromRain ? 0.3 + rand() * 1.2 : 2.5 + rand() * 3.5; d.ph = rand() * 6.28;
      return;
    }
  }
  function stepDrops(p, dt) {
    const st = S(), list = drops[p], P = PANES[p];
    const frozen = U.smooth(0.3, 0.7, st.glassFrost || 0);
    const mist = (st.mist && st.mist[p]) || 0, rain = (st.paneRain && st.paneRain[p]) || 0;
    const rate = (p === 4 ? 0.06 : 0.09) * U.smooth(0.45, 0.92, mist) * (1 - frozen);
    const rateRain = p === 4 ? 0 : 1.1 * U.smooth(0.05, 0.6, rain) * (1 - frozen);
    spawnAcc[p] += dt * (rate + rateRain);
    if (spawnAcc[p] > 1) { spawnAcc[p] -= 1 + rand() * 0.5; spawnDrop(p, rand() < rateRain / Math.max(1e-4, rate + rateRain)); }
    const calm = WG.reducedMotion ? 0.35 : 1;
    for (let i = 0; i < NDROPS; i++) {
      const d = list[i]; if (!d.on) continue;
      d.t += dt; d.life += dt;
      if (d.mode === 0) {                                     /* gathering */
        d.r = U.lerp(0.01, d.rMax, U.smooth(0, d.dur, d.t));
        if (d.t > d.dur * 0.4 && (rand() < dt * 2)) stamp(p, d.s, d.h, d.r * 2.0, 0.45, 0);
        if (d.t >= d.dur) { d.mode = 1; d.t = 0; d.dur = p === 4 ? 12 + rand() * 14 : 0.8 + rand() * 2.2; }
      } else if (d.mode === 1) {                              /* hanging, sagging a little */
        d.st = 1 + 0.14 * U.smooth(0, d.dur, d.t);
        if (d.t >= d.dur) { if (p === 4) { d.mode = 3; d.t = 0; } else { d.mode = 2; d.t = 0; d.go = true; d.goT = 0.2 + rand() * 0.5; d.spd = 0.4 + rand() * 0.8; } }
      } else if (d.mode === 2) {                              /* running in fits and starts */
        d.goT -= dt;
        if (d.goT <= 0) { d.go = !d.go; d.goT = d.go ? 0.15 + rand() * 0.7 : 0.08 + rand() * 0.8 * (1 - rain * 0.7); d.spd = (0.35 + rand() * 0.9) * (0.6 + d.r / 0.05 * 0.6); }
        d.vy = U.damp(d.vy, d.go ? d.spd : 0, d.go ? 9 : 14, dt);
        d.ls = d.s; d.lh = d.h;
        d.h -= d.vy * dt;
        d.s += (Math.sin(d.t * 8 + d.ph) * 0.035 + (rand() - 0.5) * 0.25) * d.vy * dt * calm;
        d.st = U.damp(d.st, 1 + Math.min(0.75, d.vy * 0.9), 10, dt);
        d.travel += d.vy * dt;
        const cov = coverAt(p, d.s, d.h);
        d.r += d.vy * dt * (0.012 * cov - 0.009);
        /* the clear streak it leaves */
        const segL = Math.hypot(d.s - d.ls, d.h - d.lh);
        if (segL > 1e-4) { const n = Math.ceil(segL / (d.r * 0.5)); for (let k = 1; k <= n; k++) { const f = k / n; stamp(p, U.lerp(d.ls, d.s, f), U.lerp(d.lh, d.h, f) + d.r * 0.5, d.r * 1.1, 1, 0); } }
        if (d.h < Math.max(groundAt(p, d.s), RAIL_LOW) + 0.05 || d.r < 0.014 || d.travel > 6.5) { d.mode = 3; d.t = 0; }
      } else {                                                /* fading away (absorbed, or evaporating) */
        d.r = Math.max(0, d.r - dt * 0.05); if (d.r <= 0.006) d.on = false;
      }
      if (d.mode < 3 && mist < 0.25 && rain < 0.05 && d.life > 1) { d.mode = 3; d.t = 0; }
      if (d.s < P.s0 + 0.1 || d.s > P.s1 - 0.1) d.on = false;
    }
    const arr = mats[p].uniforms.uDrops.value;
    for (let i = 0; i < MAXD; i++) { const d = list[i]; if (d && d.on) arr[i].set(d.s, d.h, d.r, d.st); else arr[i].set(0, 0, 0, 1); }
  }

  /* ------------------------------------------------------------------ ray helpers */
  function rayPane(p, o, d) {
    const P = PANES[p], dn = dotA(P.n, d.x, d.y, d.z); if (Math.abs(dn) < 1e-6) return null;
    const plane = p === 4 ? (LID_Y0 + LID_Y1) / 2 : P.out - 0.035;
    const t = (plane - dotA(P.n, o.x, o.y, o.z)) / dn; if (t <= 0) return null;
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    const s = dotA(P.u, x, y, z), h = dotA(P.v, x, y, z);
    if (s < P.s0 || s > P.s1 || h < P.h0 || h > (p === 4 ? P.h1 : LID_Y1)) return null;
    return { pane: p, x, y, z, t, s, h: Math.min(h, P.h1) };
  }
  function allHits(o, d) {
    const out = [];
    for (let p = 0; p < 5; p++) { const r = rayPane(p, o, d); if (r) out.push(r); }
    out.sort((a, b) => a.t - b.t);
    return out;
  }
  const pub = (hit, withT) => (hit ? (withT ? { pane: hit.pane, x: hit.x, y: hit.y, z: hit.z, t: hit.t } : { pane: hit.pane, x: hit.x, y: hit.y, z: hit.z }) : null);
  const panOf = (x, y, z) => { try { return WG.cam && WG.cam.panOf ? WG.cam.panOf(x, y, z) : 0; } catch (e) { return 0; } };

  /* ------------------------------------------------------------------ public */
  const G = (WG.glass = {
    panes: PANES, meshes,
    hitRay(o, d) { if (!o || !d) return null; const h = allHits({ x: o.x, y: o.y, z: o.z }, { x: d.x, y: d.y, z: d.z }); return pub(h[0], true); },
    mistAt(pane, x, y, z) {
      const P = PANES[pane]; if (!P) return 0;
      return U.sat(coverAt(pane, dotA(P.u, x, y, z), dotA(P.v, x, y, z)));
    },
    wipeRay(o, d, radius) {
      if (!o || !d) return null;
      const oo = { x: o.x, y: o.y, z: o.z }, dd = { x: d.x, y: d.y, z: d.z }, r = radius > 0 ? radius : 0.5;
      const hits = allHits(oo, dd);
      let tLand = -1;
      try { if (WG.terrain && WG.terrain.rayHit) tLand = WG.terrain.rayHit(oo.x, oo.y, oo.z, dd.x, dd.y, dd.z, false); } catch (e) { tLand = -1; }
      const now = performance.now() / 1000, stroke = now - lastWipe.t < 0.35 ? lastWipe.p : -1;
      for (const hit of hits) {
        if (tLand > 0 && hit.t > tLand + 0.05) break;           /* the land is in the way of a far pane */
        const cov = coverAt(hit.pane, hit.s, hit.h);
        /* the near pane unless it is already clear here; a stroke in progress stays on its pane */
        if (cov < 0.06 && hit.pane !== stroke) continue;
        const wiped = stamp(hit.pane, hit.s, hit.h, r, 1, 0.75);
        let speed = 0;
        if (lastWipe.p === hit.pane && now - lastWipe.t < 0.3 && now > lastWipe.t) speed = Math.min(12, Math.hypot(hit.s - lastWipe.s, hit.h - lastWipe.h) / (now - lastWipe.t));
        lastWipe.p = hit.pane; lastWipe.s = hit.s; lastWipe.h = hit.h; lastWipe.t = now;
        const pan = panOf(hit.x, hit.y, hit.z);
        WG.bus.emit('glass:wipe', { pane: hit.pane, speed, pan, first: firstWipe, x: hit.x, y: hit.y, z: hit.z, amount: wiped });
        firstWipe = false;
        try { if (WG.audio && WG.audio.cont) WG.audio.cont('wipe', U.sat(0.25 + speed / 4) * U.sat(cov * 1.4), pan); } catch (e) { /* sound is optional */ }
        /* drops caught by the cloth are gone */
        const list = drops[hit.pane]; if (list) for (const dr of list) if (dr.on && Math.hypot(dr.s - hit.s, dr.h - hit.h) < r) dr.on = false;
        return pub(hit);
      }
      return null;
    },
    tapRay(o, d) {
      if (!o || !d) return null;
      const hit = allHits({ x: o.x, y: o.y, z: o.z }, { x: d.x, y: d.y, z: d.z })[0]; if (!hit) return null;
      const list = taps[hit.pane]; list.unshift({ s: hit.s, h: hit.h, age: 0, k: 1 }); if (list.length > 3) list.length = 3;
      const sv = shiver[hit.pane]; sv.t = 0; sv.a = Math.min(0.06, sv.a * 0.5 + 0.045) * (WG.reducedMotion ? 0.35 : 1);
      const pan = panOf(hit.x, hit.y, hit.z);
      WG.bus.emit('glass:tap', { pane: hit.pane, x: hit.x, y: hit.y, z: hit.z, pan });
      try { if (WG.fauna && WG.fauna.flush) { const P = PANES[hit.pane]; WG.fauna.flush(hit.x - P.n[0] * 1.5, hit.y - P.n[1] * 1.5, hit.z - P.n[2] * 1.5); } } catch (e) { /* birds are optional */ }
      /* a knock shakes loose a drop or two */
      const dl = drops[hit.pane]; if (dl) for (const dr of dl) if (dr.on && dr.mode === 1) dr.t = dr.dur;
      return pub(hit);
    },
    /* for tests and tools */
    clearAll() { clear.fill(0); ridge.fill(0); maskDirty = true; },
    _drops: drops,
  });

  /* ------------------------------------------------------------------ per-frame: which pass each pane belongs to, light */
  function syncPasses() {
    const cp = WG.camera ? WG.camera.position : null; if (!cp) return;
    for (let p = 0; p < 5; p++) {
      const P = PANES[p], m = meshes[p]; if (!m) continue;
      const isNear = dotA(P.n, cp.x, cp.y, cp.z) > P.out;
      if (isNear !== near[p]) { near[p] = isNear; WG.setPass(m, isNear ? 'B' : 'A'); m.renderOrder = isNear ? 20 + (p === 4 ? 1 : 0) : -20; }
    }
    const st = S(), sky = WG.sky, gu = WG.G;
    const moon = !!(sky && sky.keyIsMoon);
    shared.uKeyPos.value.copy(moon ? st.moonPos : st.sunPos);
    shared.uKeyCol.value.copy(gu.uSunCol.value);
    if (moon) shared.uKeyCol.value.multiplyScalar(2.2);
    const studio = gu.uStudio.value.x, sunL = (gu.uSunCol.value.x + gu.uSunCol.value.y + gu.uSunCol.value.z) / 3;
    shared.uGlassP.value.set(moon ? 1 : 0, 0.12 + 0.88 * studio + 0.06 * Math.min(sunL, 3) + 0.5 * (st.flash || 0), Q.tier, WG.time);
  }

  WG.register('glass', {
    init() {
      buildFields();
      const mk = (data, fmt) => { const t = new THREE.DataTexture(data, MW, 5 * MH, fmt, THREE.UnsignedByteType); t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.unpackAlignment = 1; t.needsUpdate = true; return t; };
      for (let k = 0; k < 5 * MN; k++) fieldData[k] = (field[k] / 1.5) * 255;
      maskTex = mk(maskData, THREE.RGFormat); fieldTex = mk(fieldData, THREE.RedFormat);
      uploadMask();
      shared.uMask.value = maskTex; shared.uField.value = fieldTex;
      shared.uDetail.value = makeDetail();
      for (let p = 0; p < 5; p++) {
        const P = PANES[p];
        const frame = p === 4 ? new V4(P.s0 + BEV, P.s1 - BEV, P.h0 + BEV, P.h1 - BEV) : new V4(P.s0 + 0.03, P.s1 - 0.03, RAIL_LOW, RAIL_TOP);
        const uniforms = Object.assign({}, shared, {
          uPN: { value: new V3(P.n[0], P.n[1], P.n[2]) }, uPU: { value: new V3(P.u[0], P.u[1], P.u[2]) }, uPV: { value: new V3(P.v[0], P.v[1], P.v[2]) },
          uRect: { value: new V4(P.s0, P.s1, P.h0, P.h1) }, uFrame: { value: frame }, uPane: { value: p },
          uState: { value: new V4() }, uTaps: { value: [new V4(), new V4(), new V4()] }, uDrops: { value: Array.from({ length: MAXD }, () => new V4(0, 0, 0, 1)) },
        });
        const mat = WG.mat.unlit({
          name: 'glass-' + p, uniforms, side: THREE.DoubleSide, transparent: true, premultiplied: true, depthWrite: false, shadow: false, env: 'none',
          vertexDecl: 'attribute float aKind; attribute float aBand; varying float vKind; varying float vBand;',
          vertexLocal: 'vKind = aKind; vBand = aBand;',
          fragDecl: FRAG_DECL, frag: FRAG,
        });
        mats[p] = mat;
        const g = paneGeometry(p), mesh = new THREE.Mesh(g.geo, mat);
        mesh.position.set(g.centre[0], g.centre[1], g.centre[2]); mesh.name = 'glass-pane-' + p;
        WG.add(mesh, { pass: 'A', order: -20 });
        meshes[p] = mesh;
        drops[p] = Array.from({ length: MAXD }, () => newDrop({}));
      }
      if (WG.render && WG.render.pre) WG.render.pre.push(() => syncPasses());
      syncPasses();
    },
    update(dt) {
      const st = S();
      for (let p = 0; p < 5; p++) {
        const m = mats[p]; if (!m) continue;
        /* taps age; the pane shivers */
        const tl = taps[p], arr = m.uniforms.uTaps.value;
        for (let i = tl.length - 1; i >= 0; i--) { tl[i].age += dt; if (tl[i].age > 2.6) tl.splice(i, 1); }
        for (let i = 0; i < 3; i++) { const t = tl[i]; if (t) arr[i].set(t.s, t.h, t.age, t.k); else arr[i].set(0, 0, 0, 0); }
        const sv = shiver[p]; sv.t += dt;
        const shv = sv.t < 1.6 ? sv.a * Math.exp(-sv.t * 4.2) * Math.sin(sv.t * 2 * Math.PI * 11) : 0;
        if (sv.t >= 1.6) sv.a = 0;
        m.uniforms.uState.value.set((st.mist && st.mist[p]) || 0, st.glassFrost || 0, (st.paneRain && st.paneRain[p]) || 0, shv);
        stepDrops(p, dt);
      }
      maskAcc += dt;
      if (maskLive && maskAcc > 0.1) { decayMask(maskAcc); maskAcc = 0; }
      maskUp += dt;
      if (maskDirty && maskUp > (performance.now() / 1000 - lastWipe.t < 0.5 ? 1 / 30 : 1 / 12)) { uploadMask(); maskUp = 0; }
    },
  });
})();
