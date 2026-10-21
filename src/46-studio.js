/* Weatherglass — the studio: brass frame, walnut plinth, engraved plaque, the humidity/temperature gauge,
   the table and the room behind it. Everything here sits outside the glass and follows the light of the weather. */
(function () {
  'use strict';
  const WG = window.WG, THREE = WG.THREE, U = WG.util, C = WG.C, S = WG.state, Q = WG.Q;
  const D2R = Math.PI / 180;
  const T0 = Q.tier;

  /* ------------------------------------------------------------------ shared case dimensions (CONTRACT.md) */
  const PL = { hx: 6.62, hz: 4.62, top: C.Y0, bot: C.TABLE_Y, rc: 0.35 };     // plinth footprint and corner radius
  const POST = { x: 6.13, z: 4.13, r: 0.09 };
  const RAIL = { hx: 6.105, hz: 4.105 };                                     // outer faces of the rails (0.035 proud of the glass)
  const FRIEZE_O = -0.215;                                                   // frieze set back from the plinth edge
  const FZ = PL.hz + FRIEZE_O;                                               // z of the front frieze
  const FY = -2.43;                                                          // centre height of the frieze
  const GAUGE = { x: 1.62, y: FY, z: FZ, r: 0.25 };

  /* ------------------------------------------------------------------ a tiny geometry builder (auto-orients every triangle to its normals) */
  function Builder() {
    const P = [], N = [], UV = [], CO = [], I = [];
    let n = 0;
    const b = {
      v(x, y, z, nx, ny, nz, u, w, r, g, bl) {
        const l = Math.hypot(nx, ny, nz) || 1;
        P.push(x, y, z); N.push(nx / l, ny / l, nz / l); UV.push(u || 0, w || 0); CO.push(r === undefined ? 1 : r, g || 0, bl || 0);
        return n++;
      },
      tri(a, c, d) {
        const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
        const e1x = P[c * 3] - ax, e1y = P[c * 3 + 1] - ay, e1z = P[c * 3 + 2] - az, e2x = P[d * 3] - ax, e2y = P[d * 3 + 1] - ay, e2z = P[d * 3 + 2] - az;
        const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
        if (fx * fx + fy * fy + fz * fz < 1e-16) return;
        const sx = N[a * 3] + N[c * 3] + N[d * 3], sy = N[a * 3 + 1] + N[c * 3 + 1] + N[d * 3 + 1], sz = N[a * 3 + 2] + N[c * 3 + 2] + N[d * 3 + 2];
        if (fx * sx + fy * sy + fz * sz < 0) I.push(a, d, c); else I.push(a, c, d);
      },
      quad(a, c, d, e) { b.tri(a, c, d); b.tri(a, d, e); },
      grid(rows) { for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < rows[i].length - 1; j++) b.quad(rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]); },
      get count() { return n; },
      geo() {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
        g.setAttribute('color', new THREE.Float32BufferAttribute(CO, 3));
        g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(I, 1) : new THREE.Uint16BufferAttribute(I, 1));
        g.computeBoundingSphere();
        return g;
      },
    };
    return b;
  }
  /* 2D normals of a profile polyline. Repeated points mark creases (each side keeps its own normal). flip: profile runs top->bottom */
  function profNormals(prof, flip) {
    const same = (p, q) => q && Math.abs(q[0] - p[0]) < 1e-7 && Math.abs(q[1] - p[1]) < 1e-7;
    return prof.map((p, i) => {
      const a = prof[i - 1], c = prof[i + 1];
      let p0 = a || p, p1 = c || p;
      if (same(p, c)) p1 = p;
      if (same(p, a)) p0 = p;
      let tx = p1[0] - p0[0], ty = p1[1] - p0[1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      return flip ? [-ty, tx] : [ty, -tx];
    });
  }
  const profLen = (prof) => { const w = [0]; for (let i = 1; i < prof.length; i++) w.push(w[i - 1] + Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1])); return w; };
  /* helpers to write profiles: arcs and curves appended to a point list (each point [a, b, ao, polish]) */
  const arc = (out, cx, cy, r, a0, a1, n, ao, pol, ry) => { for (let i = 0; i <= n; i++) { const a = (a0 + (a1 - a0) * (i / n)) * D2R; out.push([cx + r * Math.cos(a), cy + (ry || r) * Math.sin(a), ao === undefined ? 1 : ao, pol || 0]); } };
  const pt = (out, a, b, ao, pol) => out.push([a, b, ao === undefined ? 1 : ao, pol || 0]);
  const crease = (out) => { const p = out[out.length - 1]; out.push(p.slice()); };

  /* a profile (r, h) turned round an axis. frame: origin O, axis A, and two unit vectors E1, E2 across it. profile runs from the base up (h increasing) */
  function lathe(B, prof, seg, O, A, E1, E2, polAll) {
    const nr = profNormals(prof, false), rows = [];
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), row = [];
      const ex = E1[0] * ca + E2[0] * sa, ey = E1[1] * ca + E2[1] * sa, ez = E1[2] * ca + E2[2] * sa;
      for (let j = 0; j < prof.length; j++) {
        const [r, h, ao, pol] = prof[j], [nr0, nh] = nr[j];
        row.push(B.v(O[0] + ex * r + A[0] * h, O[1] + ey * r + A[1] * h, O[2] + ez * r + A[2] * h,
          ex * nr0 + A[0] * nh, ey * nr0 + A[1] * nh, ez * nr0 + A[2] * nh, s / seg, j / (prof.length - 1), ao, Math.max(pol || 0, polAll || 0), 0));
      }
      rows.push(row);
    }
    B.grid(rows);
  }
  /* a profile (o, y) swept round a rounded rectangle (half extents hx, hz, corner radius rc at o = 0). profile runs top->bottom.
     uv = (distance along the perimeter, distance along the profile) so wood grain can run along each face */
  function sweep(B, prof, hx, hz, rc, ns, cap) {
    const fr = [], corners = [[1, 1, 90, 0], [1, -1, 0, -90], [-1, -1, -90, -180], [-1, 1, -180, -270]];
    for (const [sx, sz, a0, a1] of corners) for (let k = 0; k <= ns; k++) { const a = (a0 + ((a1 - a0) * k) / ns) * D2R; fr.push({ cx: sx * (hx - rc), cz: sz * (hz - rc), nx: Math.cos(a), nz: Math.sin(a) }); }
    fr.push(fr[0]);
    let u = 0; const us = [0];
    for (let i = 1; i < fr.length; i++) { const p = fr[i - 1], q = fr[i]; u += Math.hypot(q.cx + q.nx * rc - p.cx - p.nx * rc, q.cz + q.nz * rc - p.cz - p.nz * rc); us.push(u); }
    const nr = profNormals(prof, true), w = profLen(prof), rows = [];
    for (let i = 0; i < fr.length; i++) {
      const f = fr[i], row = [];
      for (let j = 0; j < prof.length; j++) {
        const [o, y, ao, pol] = prof[j], r = Math.max(rc + o, 0), [no, ny] = nr[j];
        row.push(B.v(f.cx + f.nx * r, y, f.cz + f.nz * r, f.nx * no, ny, f.nz * no, us[i], w[j], ao, pol || 0, 0));
      }
      rows.push(row);
    }
    B.grid(rows);
    if (cap) {   /* close the top with a fan from the centre (hidden under the land, keeps shadows solid) */
      const c = B.v(0, prof[0][1], 0, 0, 1, 0, 0, 0, 1, 0, 0);
      for (let i = 0; i < rows.length - 1; i++) B.tri(c, rows[i][0], rows[i + 1][0]);
    }
  }

  /* ------------------------------------------------------------------ the studio backdrop as seen along a view ray (shared by the room and the far table) */
  const BK = { uBkSun: { value: new THREE.Vector3(-8, 9, 4) }, uBkP: { value: new THREE.Vector4(1, 0, 0, 0) } };
  const BACK_GLSL = /* glsl */ `
uniform vec3 uBkSun; uniform vec4 uBkP;   /* light near the sun/moon; x its strength, y 1 when it is the moon */
vec3 wgsBack(vec3 d){
  vec3 ro = cameraPosition;
  float b = dot(ro, d), c = dot(ro, ro) - 3600.0; float t = -b + sqrt(max(b*b - c, 0.0));
  vec3 Q = ro + d * t;                                   /* where this ray meets the backdrop cloth */
  vec3 cd = normalize(vec3(0.4, 2.6, 0.0) - ro);         /* toward the case */
  vec3 sd = normalize(cross(cd, vec3(0.0, 1.0, 0.0)) + vec3(0.0, 0.0, 1e-5)); vec3 ud = cross(sd, cd);
  float sx = dot(d, sd), sy = dot(d, ud) - 0.05;
  float r2 = sx*sx*0.75 + sy*sy*1.25;
  float halo = exp(-r2 * 7.0), wide = exp(-r2 * 1.8);
  vec3 ld = normalize(uBkSun - ro); float sk = max(dot(d, ld), 0.0);
  float lamp = (pow(sk, 7.0) * 0.8 + pow(sk, 40.0) * 0.5) * uBkP.x;
  /* cloth: soft mottling and a few loose vertical folds */
  vec3 q = Q * 0.085;
  float m = wgNoise3(q) * 0.55 + wgNoise3(q * 2.7 + 5.3) * 0.3 + wgNoise3(q * 7.1 + 1.7) * 0.15;
  float fold = sin(atan(Q.z, Q.x) * 9.0 + wgNoise3(Q * 0.04) * 5.0 + Q.y * 0.03) * smoothstep(0.75, 0.25, abs(Q.y) / 60.0);
  float cloth = (0.88 + 0.24 * (m - 0.5)) * (0.97 + 0.03 * fold);
  float ceilK = mix(1.0, 0.42, smoothstep(-0.05, 0.6, Q.y / 60.0 - 0.05));
  float floorK = mix(0.55, 1.0, smoothstep(-0.12, 0.02, Q.y / 60.0));
  vec3 warm = mix(vec3(1.0, 0.92, 0.82), vec3(1.5, 0.66, 0.24), uStudio.w);
  vec3 lampCol = uBkP.y > 0.5 ? vec3(0.75, 0.85, 1.1) : warm;
  float lum = 0.55 + 0.55 * wide + 1.15 * halo;
  vec3 col = uRoomCol * lum * mix(vec3(1.0), warm, 0.25 + 0.6 * halo);
  col += uRoomCol * lamp * 2.3 * lampCol;
  /* night: almost black with a cool cast */
  float n = uStudio.y; float l = dot(col, vec3(0.3, 0.55, 0.15));
  col = mix(col, l * vec3(0.86, 0.94, 1.16), n * 0.65);
  /* lightning lights the room for an instant */
  col += uFlashCol * 0.0035 * (0.5 + halo + wide * 0.5);
  return col * cloth * ceilK * floorK;
}
/* soft light from the studio's softboxes on things outside the case (dims at night and in storms with the reflections) */
vec3 wgsFill(vec3 N){ return uStudio.x * (1.0 - 0.45 * uStudio.y) * mix(vec3(1.0, 0.9, 0.78), vec3(0.75, 0.85, 1.1), uStudio.y) * (0.1 + 0.07 * max(N.y, 0.0) + 0.05 * max(N.z, 0.0) + 0.03 * abs(N.x)); }
/* signed distance (xz) from the plinth's rounded footprint */
float wgsFoot(vec2 xz){ vec2 q = abs(xz) - vec2(${(PL.hx - PL.rc).toFixed(3)}, ${(PL.hz - PL.rc).toFixed(3)}); return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - ${PL.rc.toFixed(3)}; }
`;

  /* ------------------------------------------------------------------ backdrop */
  function buildBackdrop() {
    const g = new THREE.SphereGeometry(60, 48, 24);
    const m = WG.mat.unlit({ name: 'studioBackdrop', side: THREE.BackSide, shadow: false, uniforms: BK, fragDecl: BACK_GLSL, frag: 'col = wgsBack(-V); alpha = 1.0;' });
    const mesh = new THREE.Mesh(g, m);
    WG.add(mesh, { pass: 'A' });
    return mesh;
  }

  /* ------------------------------------------------------------------ table */
  function buildTable() {
    const g = new THREE.CircleGeometry(59.6, 96); g.rotateX(-Math.PI / 2); g.translate(0, PL.bot, 0);
    const m = WG.mat.lit({
      name: 'studioTable', env: 'studio', shadow: false, uniforms: BK, fragDecl: BACK_GLSL,
      frag: /* glsl */ `
        vec2 xz = P.xz; float dd = wgsFoot(xz);
        float pw = 2.35, ry = (xz.y + 0.61) / pw, row = floor(ry), fy = fract(ry);
        float off = wgHash(vec2(row, 3.1)) * 11.0, L = 10.5 + wgHash(vec2(row, 7.7)) * 7.0;
        float rx = (xz.x + off) / L, cl = floor(rx), fx = fract(rx);
        vec2 bid = vec2(row, cl); float h1 = wgHash(bid * 1.37 + 0.5), h2 = wgHash(bid * 2.11 + 9.3);
        /* grain along the boards: long wavy growth lines, flecks and fine pores */
        float gy = (xz.y + h1 * 31.0) * 6.5, gx = xz.x * 0.5 + h2 * 20.0;
        float warp = wgNoise(vec2(gx * 0.33, gy * 0.11)) * 3.2 + wgNoise(vec2(gx * 1.1, gy * 0.4)) * 0.8;
        float lines = 0.5 + 0.5 * sin(gy * 1.7 + warp * 2.4);
        float fine = wgNoise(vec2(xz.x * 2.2, xz.y * 70.0));
        float pf = clamp(1.0 - fwidth(xz.y) * 30.0, 0.0, 1.0);
        vec3 base = mix(vec3(0.036, 0.021, 0.013), vec3(0.055, 0.033, 0.02), h1) * (0.85 + 0.3 * h2);
        albedo = base * (0.78 + 0.3 * lines * lines + 0.16 * (fine - 0.5) * pf);
        albedo *= 1.0 - 0.18 * smoothstep(0.55, 0.9, wgNoise(vec2(gx * 0.7, gy * 0.05 + 3.0)));
        /* joints between boards: a dark gap and slightly eased edges */
        float ey = min(fy, 1.0 - fy) * pw, ex = min(fx, 1.0 - fx) * L;
        float gap = 1.0 - smoothstep(0.006, 0.022, ey) * smoothstep(0.004, 0.018, ex);
        albedo *= 1.0 - 0.85 * gap;
        float eased = 1.0 - smoothstep(0.0, 0.05, ey);
        N = normalize(N + vec3(0.0, 0.0, (fy < 0.5 ? -1.0 : 1.0) * eased * 0.35));
        rough = 0.7 + 0.12 * fine; spec = 0.03; metal = 0.0;
        /* a soft pool of light round the case, a deep contact shadow under the plinth */
        float pool = mix(0.12, 1.0, exp(-max(dd, 0.0) * 0.3));
        float contact = mix(0.06, 1.0, smoothstep(-0.01, 0.42, dd)) * mix(0.55, 1.0, smoothstep(0.0, 2.4, dd));
        ao = contact * 0.5;`,
      fragPost: /* glsl */ `
        col += albedo * wgsFill(N) * contact * 1.6;
        col *= pool * contact;
        col = mix(wgsBack(-V), col, smoothstep(13.0, 3.0, dd));`,
    });
    const mesh = new THREE.Mesh(g, m);
    WG.add(mesh, { pass: 'A' });
    return mesh;
  }

  /* ------------------------------------------------------------------ plinth: a moulded walnut base swept round a rounded rectangle */
  function plinthProfile() {
    const p = [], nArc = T0 === 0 ? 7 : 10;
    pt(p, -0.62, PL.top);                                         // flat top, from under the glass
    pt(p, -0.3, PL.top);
    pt(p, -0.075, PL.top);
    arc(p, -0.075, -1.875, 0.075, 90, -70, nArc + 2);             // rounded nosing
    p[p.length - 1][2] = 0.75; crease(p); p[p.length - 1][2] = 0.5;
    pt(p, -0.092, -1.9455, 0.45);                                 // quirk under the nosing
    arc(p, -0.092, -2.07, 0.1245, 90, 180, nArc, 0.6);             // concave cove
    for (let i = p.length - nArc - 1; i < p.length; i++) p[i][2] = 0.55 + 0.35 * Math.sin(((i - (p.length - nArc - 1)) / nArc) * Math.PI);
    arc(p, -0.2165, -2.094, 0.024, 90, -90, 8, 0.85);              // small bead
    p[p.length - 1][2] = 0.55; crease(p);
    pt(p, -0.215, -2.13, 0.75);
    pt(p, -0.215, -2.43);                                          // flat frieze, 0.6 tall
    pt(p, -0.215, -2.73, 0.8);
    for (let i = 1; i <= 12; i++) { const t = i / 12; pt(p, -0.215 + 0.175 * (0.5 - 0.5 * Math.cos(Math.PI * t)), -2.73 - 0.145 * t, 0.6 + 0.4 * t); }  // S-curved base moulding
    crease(p); p[p.length - 1][2] = 0.6;
    pt(p, -0.004, -2.875, 0.8);                                    // fillet ledge
    pt(p, 0, -2.879, 0.8);
    crease(p);
    pt(p, 0, -2.99, 0.6);                                          // plain foot
    pt(p, -0.008, -3.0, 0.4);
    return p;
  }
  function buildPlinth() {
    const B = Builder();
    sweep(B, plinthProfile(), PL.hx, PL.hz, PL.rc, T0 === 0 ? 9 : T0 === 1 ? 13 : 18, true);
    const m = WG.mat.lit({
      name: 'plinth', env: 'studio', vertexColors: true, uniforms: BK, fragDecl: BACK_GLSL,
      frag: /* glsl */ `
        float u = vUv.x, w = vUv.y;
        /* growth lines run along each face and wave across it; lighter figure, fine pores */
        float warp = wgNoise(vec2(u * 0.16, w * 1.3 + 3.0)) * 2.3 + wgNoise(vec2(u * 0.7, w * 4.0)) * 0.45 + wgNoise(vec2(u * 2.3, w * 9.0)) * 0.12;
        float L = w * 6.5 + warp * 1.7 + sin(u * 0.21 + w * 2.0) * 0.5;
        float band = 0.5 + 0.5 * sin(L * 6.2831853);
        float lineD = smoothstep(0.72, 0.97, band);
        float fig = smoothstep(0.42, 0.82, wgNoise(vec2(u * 0.55 + w * 0.6, w * 5.0 - u * 0.15)) * 0.7 + wgNoise(vec2(u * 2.5, w * 14.0)) * 0.3);
        float pf = clamp(1.6 - max(fwidth(u), fwidth(w)) * 260.0, 0.0, 1.0);
        float pores = smoothstep(0.8, 0.95, wgNoise(vec2(u * 85.0, w * 520.0))) * pf;
        vec3 dark = vec3(0.028, 0.012, 0.006), mid = vec3(0.07, 0.032, 0.016), light = vec3(0.14, 0.072, 0.036);
        albedo = mix(mid, light, fig * 0.7);
        albedo = mix(albedo, dark, lineD * 0.65 + 0.3 * wgNoise(vec2(u * 1.3, w * 11.0)) - 0.1);
        albedo *= 1.0 - pores * 0.5;
        /* worn and paler along the top edge, darker toward the foot */
        float wear = smoothstep(-1.97, -1.86, P.y) * smoothstep(0.3, 0.54, w) * (0.45 + 0.55 * wgNoise(vec2(u * 2.2, 1.7)));
        albedo = mix(albedo, albedo * 1.7 + vec3(0.016, 0.01, 0.005), wear * 0.85);
        albedo *= mix(1.0, 0.6, smoothstep(-2.55, -3.0, P.y));
        ao = vCol.r * 0.45;
        rough = mix(0.3, 0.5, wear) + 0.07 * pores + 0.04 * wgNoise(vec2(u * 0.6, w * 3.0));
        spec = 0.035; metal = 0.0;`,
      fragPost: 'col += albedo * wgsFill(N) * vCol.r * 2.0; col *= mix(0.6, 1.0, vCol.r);',
    });
    const mesh = new THREE.Mesh(B.geo(), m);
    WG.add(mesh, { pass: 'A', shadow: true });
    return mesh;
  }

  /* ------------------------------------------------------------------ brass: posts, rails, rivets, lid knob, gauge bezel and hub (one mesh) */
  function postProfile() {
    const p = [];
    pt(p, 0.0, -1.8, 0.5); pt(p, 0.148, -1.8, 0.45);
    arc(p, 0.148, -1.79, 0.01, -90, 90, 4, 0.7);                // rounded foot ring
    crease(p); p[p.length - 1][2] = 0.5;
    pt(p, 0.128, -1.765, 0.45);
    pt(p, 0.124, -1.745, 0.5);
    arc(p, 0.124, -1.72, 0.025, -90, 90, 8, 0.85);               // torus
    crease(p); p[p.length - 1][2] = 0.45;
    pt(p, 0.112, -1.69, 0.45);
    for (let i = 1; i <= 10; i++) { const t = i / 10; pt(p, 0.0925 + 0.0195 * Math.pow(1 - t, 2.4), -1.69 + 0.27 * t, 0.55 + 0.45 * t); }  // flared trumpet base
    arc(p, 0.0925, -1.406, 0.014, -90, 90, 6, 0.9);               // bead
    crease(p);
    pt(p, 0.09, -1.392, 0.7); pt(p, 0.09, -1.3, 1.0);
    pt(p, 0.09, 7.02, 1.0); pt(p, 0.09, 7.035, 0.75);               // long plain shaft
    arc(p, 0.09, 7.068, 0.033, -90, 90, 10, 1.0);                 // collar
    crease(p); p[p.length - 1][2] = 0.6;
    pt(p, 0.094, 7.101, 0.6); pt(p, 0.094, 7.13); crease(p); pt(p, 0.101, 7.13); pt(p, 0.101, 7.158); crease(p); pt(p, 0.09, 7.162, 0.6);
    pt(p, 0.09, 7.56, 0.8);                                         // behind the top rail and the lid
    crease(p); pt(p, 0.106, 7.566, 0.7);
    pt(p, 0.108, 7.6, 1.0, 0.3);
    arc(p, 0, 7.6, 0.108, 0, 76, 8, 1.0, 0.7, 0.062);              // domed cap
    pt(p, 0.021, 7.672, 0.7, 0.6);                                  // neck
    arc(p, 0, 7.8, 0.075, -75, 90, 12, 1.0, 1.0);                  // ball finial
    return p;
  }
  function knobProfile() {
    const p = [];
    pt(p, 0.0, 7.58, 0.5); pt(p, 0.12, 7.58, 0.5);
    arc(p, 0.12, 7.59, 0.01, -90, 90, 4, 0.8, 0.5);
    crease(p);
    for (let i = 0; i <= 8; i++) { const t = i / 8; pt(p, 0.112 - 0.075 * Math.sin(t * Math.PI / 2), 7.6 + 0.05 * (1 - Math.cos(t * Math.PI / 2)), 0.7 + 0.3 * t, 0.6); }  // cove
    pt(p, 0.033, 7.663, 0.8, 0.7);
    arc(p, 0.033, 7.676, 0.013, -90, 90, 6, 1.0, 0.8);            // bead on the stem
    pt(p, 0.028, 7.7, 0.7, 0.8);
    arc(p, 0, 7.785, 0.072, -67, 90, 14, 1.0, 1.0, 0.085);         // polished ball
    return p;
  }
  function railProfile(y0, y1) {
    const p = [];
    pt(p, -0.04, y1, 0.6); pt(p, -0.008, y1, 0.9);
    arc(p, -0.008, y1 - 0.008, 0.008, 90, 0, 4, 1.0, 0.5);         // eased top edge
    pt(p, 0, y1 - 0.02);
    crease(p); pt(p, -0.004, y1 - 0.024, 0.7); pt(p, -0.004, y1 - 0.03, 0.7); crease(p); pt(p, 0, y1 - 0.034);   // fine groove
    pt(p, 0, y0 + 0.034); crease(p); pt(p, -0.004, y0 + 0.03, 0.7); pt(p, -0.004, y0 + 0.024, 0.7); crease(p); pt(p, 0, y0 + 0.02);
    arc(p, -0.008, y0 + 0.008, 0.008, 0, -90, 4, 0.8);
    pt(p, -0.04, y0, 0.5); crease(p);
    pt(p, -0.04, y1, 0.5);                                          // the inner face, against the glass
    return p;
  }
  function rivetList() {
    const out = [];   // {x,y,z, ax,az}
    for (const y of [7.28, -1.575]) {
      for (let i = 0; i < 9; i++) { const x = -POST.x + ((i + 1) * 2 * POST.x) / 10; out.push([x, y, RAIL.hz, 0, 1]); out.push([x, y, -RAIL.hz, 0, -1]); }
      for (let i = 0; i < 5; i++) { const z = -POST.z + ((i + 1) * 2 * POST.z) / 6; out.push([RAIL.hx, y, z, 1, 0]); out.push([-RAIL.hx, y, z, -1, 0]); }
    }
    return out;
  }
  function buildBrass() {
    const B = Builder(), seg = T0 === 0 ? 24 : T0 === 1 ? 32 : 40;
    const post = postProfile();
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) lathe(B, post, seg, [sx * POST.x, 0, sz * POST.z], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
    lathe(B, knobProfile(), seg, [0, 0, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
    sweep(B, railProfile(7.16, 7.4), RAIL.hx, RAIL.hz, 0.025, 2, false);
    sweep(B, railProfile(-1.8, -1.35), RAIL.hx, RAIL.hz, 0.025, 2, false);
    const dome = []; arc(dome, 0, 0, 0.028, 0, 90, 5, 1.0, 0.75, 0.016); dome.unshift([0.03, -0.004, 0.6, 0]);
    for (const [x, y, z, ax, az] of rivetList()) lathe(B, dome, T0 === 0 ? 8 : 10, [x, y, z], [ax, 0, az], [az, 0, -ax], [0, 1, 0]);
    /* gauge bezel and the needle hub, turned round the z axis */
    const bz = [];
    pt(bz, 0.198, 0.012, 0.3); pt(bz, 0.203, 0.03, 0.5); crease(bz);
    arc(bz, 0.229, 0.032, 0.022, 160, 0, 10, 1.0, 0.6, 0.018);     // rolled bezel
    pt(bz, 0.252, 0.012, 0.8); pt(bz, 0.256, 0.004, 0.6); pt(bz, 0.256, -0.002, 0.4);
    bz.reverse();
    lathe(B, bz, T0 === 0 ? 40 : 56, [GAUGE.x, GAUGE.y, GAUGE.z], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
    const hub = []; pt(hub, 0.014, 0.0, 0.7, 0.6); arc(hub, 0, 0.0, 0.014, 0, 90, 5, 1.0, 1.0, 0.008);
    lathe(B, hub, 14, [GAUGE.x, GAUGE.y, GAUGE.z + 0.029], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
    const m = WG.mat.lit({
      name: 'brass', env: 'studio', vertexColors: true,
      frag: /* glsl */ `
        float rec = 1.0 - vCol.r, pol = vCol.g;
        pol = clamp(pol + smoothstep(0.45, 0.95, N.y) * 0.6, 0.0, 1.0);
        float n1 = wgNoise3(P * 5.0), n2 = wgNoise3(P * 23.0 + 3.1), n3 = wgNoise3(P * 95.0 + 1.3);
        float low = smoothstep(3.0, -1.9, P.y);
        float age = clamp(0.12 + 0.42 * low + 0.6 * rec + (n1 - 0.5) * 0.6 + (n2 - 0.5) * 0.22 - pol * 0.9, 0.0, 1.0);
        vec3 bright = vec3(0.88, 0.66, 0.34), dull = vec3(0.5, 0.34, 0.15), brown = vec3(0.16, 0.095, 0.04);
        albedo = mix(bright, dull, smoothstep(0.0, 0.55, age));
        albedo = mix(albedo, brown, smoothstep(0.5, 1.0, age));
        rough = clamp(mix(0.17, 0.5, age) + (n3 - 0.5) * 0.08, 0.06, 0.9);
        metal = mix(1.0, 0.7, age);
        /* a few green-black patina freckles where hands do not reach */
        float fn = wgNoise3(P * 38.0 + 7.0);
        float fk = smoothstep(0.84, 0.92, fn) * smoothstep(0.62, 0.88, wgNoise3(P * 1.3 + 1.0) + low * 0.25) * (1.0 - pol);
        albedo *= 1.0 - 0.3 * smoothstep(0.7, 0.85, fn) * smoothstep(0.62, 0.88, wgNoise3(P * 1.3 + 1.0) + low * 0.25) * (1.0 - pol);
        albedo = mix(albedo, mix(vec3(0.025, 0.04, 0.028), vec3(0.06, 0.12, 0.075), n3), fk * 0.75);
        metal = mix(metal, 0.15, fk); rough = mix(rough, 0.85, fk);
        ao = mix(1.0, 0.3, rec);
        spec = 0.04;`,
      uniforms: BK, fragDecl: BACK_GLSL,
      fragPost: /* glsl */ `
        col += albedo * wgsFill(N) * (0.7 + 1.1 * rough) * metal;            /* the big softboxes, blurred by the aged surface */
        col *= mix(1.0, 0.55, rec);
        col += uFlashCol * 0.05 * albedo * metal * (0.4 + 0.6 * max(dot(N, normalize(uFlashPos - P)), 0.0));`,
    });
    const mesh = new THREE.Mesh(B.geo(), m);
    WG.add(mesh, { pass: 'A', shadow: true });
    return mesh;
  }

  /* ------------------------------------------------------------------ canvas helpers */
  const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, "Times New Roman", "Liberation Serif", "DejaVu Serif", serif';
  function spaced(g, text, cx, cy, spacing) {
    const ch = Array.from(text), ws = ch.map((c) => g.measureText(c).width);
    const tot = ws.reduce((a, b) => a + b, 0) + spacing * (ch.length - 1);
    let x = cx - tot / 2; const al = g.textAlign; g.textAlign = 'left';
    for (let i = 0; i < ch.length; i++) { g.fillText(ch[i], x, cy); x += ws[i] + spacing; }
    g.textAlign = al; return tot;
  }
  const maxAniso = () => { try { return Math.min(8, WG.renderer.capabilities.getMaxAnisotropy()); } catch (e) { return 1; } };

  /* ------------------------------------------------------------------ plaque */
  function drawPlaque() {
    const W = 2048, H = 268, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    /* R: crisp engraving */
    const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
    const eng = mk(), eg = eng.getContext('2d');
    eg.fillStyle = '#000'; eg.fillRect(0, 0, W, H); eg.fillStyle = '#fff'; eg.strokeStyle = '#fff';
    eg.lineWidth = 7; eg.strokeRect(110, 24, W - 220, H - 48);
    eg.lineWidth = 3; eg.strokeRect(128, 42, W - 256, H - 84);
    const dia = (x, y, s) => { eg.beginPath(); eg.moveTo(x, y - s); eg.lineTo(x + s * 1.3, y); eg.lineTo(x, y + s); eg.lineTo(x - s * 1.3, y); eg.closePath(); eg.fill(); };
    dia(205, H / 2, 20); dia(W - 205, H / 2, 20);
    eg.font = `bold 128px ${SERIF}`; eg.textBaseline = 'middle';
    const ws = Array.from('WEATHERGLASS').map((c) => eg.measureText(c).width).reduce((a, b) => a + b, 0);
    const spacing = Math.max(18, (1460 - ws) / 11);
    spaced(eg, 'WEATHERGLASS', W / 2, H / 2 + 6, spacing);
    /* screw slots are engraved too */
    eg.save(); for (const [x, a] of [[58, 0.5], [W - 58, -0.35]]) { eg.translate(x, H / 2); eg.rotate(a); eg.fillRect(-25, -4, 50, 8); eg.setTransform(1, 0, 0, 1, 0, 0); } eg.restore();
    /* G: the same, softened, for the bump of the groove walls */
    const blr = mk(), bg = blr.getContext('2d');
    bg.fillStyle = '#000'; bg.fillRect(0, 0, W, H);
    try { bg.filter = 'blur(2.5px)'; } catch (e) { /* no canvas filters: crisp bump */ }
    bg.drawImage(eng, 0, 0); bg.filter = 'none';
    /* B: screw domes */
    const scr = mk(), sg = scr.getContext('2d');
    sg.fillStyle = '#000'; sg.fillRect(0, 0, W, H);
    for (const x of [58, W - 58]) { const gr = sg.createRadialGradient(x, H / 2, 0, x, H / 2, 32); gr.addColorStop(0, '#fff'); gr.addColorStop(0.6, '#c8c8c8'); gr.addColorStop(0.92, '#5a5a5a'); gr.addColorStop(1, '#000'); sg.fillStyle = gr; sg.beginPath(); sg.arc(x, H / 2, 32, 0, Math.PI * 2); sg.fill(); }
    const a = eg.getImageData(0, 0, W, H).data, b = bg.getImageData(0, 0, W, H).data, s = sg.getImageData(0, 0, W, H).data;
    const out = g.createImageData(W, H), o = out.data;
    for (let i = 0; i < o.length; i += 4) { o[i] = a[i]; o[i + 1] = b[i]; o[i + 2] = s[i]; o[i + 3] = 255; }
    g.putImageData(out, 0, 0);
    const t = new THREE.CanvasTexture(cv); t.anisotropy = maxAniso(); t.needsUpdate = true;
    return t;
  }
  function buildPlaque() {
    const tex = drawPlaque();
    const g = new THREE.BoxGeometry(2.3, 0.3, 0.012);
    const m = WG.mat.lit({
      name: 'plaque', env: 'studio', uniforms: { uPlq: { value: tex }, uPx: { value: new THREE.Vector2(1.6 / 2048, 1.6 / 268) } },
      fragDecl: 'uniform sampler2D uPlq; uniform vec2 uPx; float plqH(vec2 uv){ vec4 t = texture2D(uPlq, uv); return -t.g * 0.5 + t.b * 5.0; }',
      frag: /* glsl */ `
        float front = step(0.9, N.z);
        vec2 uv = vUv; vec4 t = texture2D(uPlq, uv) * front;
        float hl = plqH(uv - vec2(uPx.x, 0.0)), hr = plqH(uv + vec2(uPx.x, 0.0)), hd = plqH(uv - vec2(0.0, uPx.y)), hu = plqH(uv + vec2(0.0, uPx.y));
        /* a fine chamfer round the edge of the plate */
        float ex = min(uv.x, 1.0 - uv.x) * 2.3, ey = min(uv.y, 1.0 - uv.y) * 0.3;
        vec2 bev = vec2(uv.x < 0.5 ? -1.0 : 1.0, uv.y < 0.5 ? -1.0 : 1.0) * vec2(1.0 - smoothstep(0.0, 0.006, ex), 1.0 - smoothstep(0.0, 0.006, ey));
        vec3 bn = normalize(vec3(-(hr - hl) * 0.55 + bev.x * 0.6, -(hu - hd) * 0.55 + bev.y * 0.6, 1.0));
        N = normalize(mix(N, bn, front));
        float st = wgNoise(vec2(uv.x * 9.0, uv.y * 260.0)) * 0.55 + wgNoise(vec2(uv.x * 31.0, uv.y * 700.0)) * 0.45;
        float grime = smoothstep(0.03, 0.0, min(ex, ey * 2.0)) * 0.5 + wgNoise(P.xy * 9.0) * 0.25;
        albedo = vec3(0.8, 0.6, 0.31) * (0.86 + 0.24 * st) * (1.0 - 0.35 * grime);
        rough = 0.22 + 0.14 * st + 0.15 * grime; metal = 1.0;
        float eng = t.r;
        float edge = clamp((t.g - t.r) * 3.0, 0.0, 1.0);
        albedo = mix(albedo, vec3(0.018, 0.013, 0.009), eng);
        metal = mix(metal, 0.15, eng); rough = mix(rough, 0.8, eng);
        albedo *= 1.0 + 0.45 * edge; rough = max(0.08, rough - 0.12 * edge);
        float screw = smoothstep(0.02, 0.1, t.b);
        albedo = mix(albedo, vec3(0.62, 0.5, 0.33), screw * 0.6); rough = mix(rough, 0.3, screw);
        ao = mix(1.0, 0.5, eng);`,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(0, FY, FZ + 0.006);
    WG.add(mesh, { pass: 'A', shadow: true });
    return mesh;
  }

  /* ------------------------------------------------------------------ gauge */
  function drawDial(SZ) {
    const cv = document.createElement('canvas'); cv.width = cv.height = SZ;
    const g = cv.getContext('2d'), c = SZ / 2, R = SZ / 2;
    let gr = g.createRadialGradient(c, c * 0.9, 0, c, c, R);
    gr.addColorStop(0, '#f6e9c8'); gr.addColorStop(0.55, '#f0e0ba'); gr.addColorStop(0.82, '#e2cc9e'); gr.addColorStop(0.95, '#c9ad7c'); gr.addColorStop(1, '#957a52');
    g.fillStyle = gr; g.fillRect(0, 0, SZ, SZ);
    /* paper: faint foxing and fibres */
    const rnd = U.rng(7711);
    for (let i = 0; i < 1600; i++) { const x = rnd() * SZ, y = rnd() * SZ, r = (0.4 + rnd() * 1.6) * SZ / 1024; g.fillStyle = `rgba(${120 + rnd() * 40 | 0},${95 + rnd() * 30 | 0},${60 | 0},${0.03 + rnd() * 0.05})`; g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill(); }
    for (let i = 0; i < 26; i++) { const x = rnd() * SZ, y = rnd() * SZ, r = (6 + rnd() * 22) * SZ / 1024; const fg = g.createRadialGradient(x, y, 0, x, y, r); fg.addColorStop(0, 'rgba(150,115,60,0.07)'); fg.addColorStop(1, 'rgba(150,115,60,0)'); g.fillStyle = fg; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
    const ang = (v) => (-135 + 270 * v) * D2R;
    const at = (r, a) => [c + r * Math.sin(a), c - r * Math.cos(a)];
    const band = (r0, r1, v0, v1, col) => {
      g.save(); try { g.filter = `blur(${(SZ / 512).toFixed(1)}px)`; } catch (e) { /* ignore */ }
      g.beginPath(); g.arc(c, c, r1, ang(v0) - Math.PI / 2, ang(v1) - Math.PI / 2); g.arc(c, c, r0, ang(v1) - Math.PI / 2, ang(v0) - Math.PI / 2, true); g.closePath(); g.fillStyle = col; g.fill(); g.restore();
    };
    const tick = (r0, r1, a, w, col) => { const [x0, y0] = at(r0, a), [x1, y1] = at(r1, a); g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
    const NAVY = '#1c2846', RED = '#8a1d16', INK = '#2c2620';
    /* outer: humidity 0..100 */
    band(0.835 * R, 0.915 * R, 0.4, 0.6, 'rgba(78,146,84,0.38)');
    g.strokeStyle = INK; g.lineWidth = R * 0.006; g.beginPath(); g.arc(c, c, 0.925 * R, ang(0) - Math.PI / 2, ang(1) - Math.PI / 2); g.stroke();
    for (let v = 0; v <= 100; v += 1) {
      const a = ang(v / 100), maj = v % 20 === 0, mid = v % 10 === 0, half = v % 2 === 0;
      if (!half && !mid) { tick(0.925 * R, 0.9 * R, a, R * 0.0035, INK); continue; }
      tick(0.925 * R, (maj ? 0.84 : mid ? 0.855 : 0.885) * R, a, R * (maj ? 0.013 : mid ? 0.009 : 0.005), maj ? NAVY : INK);
    }
    g.fillStyle = NAVY; g.font = `600 ${(0.088 * R) | 0}px ${SERIF}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let v = 0; v <= 100; v += 20) { const [x, y] = at(0.745 * R, ang(v / 100)); g.fillText(String(v), x, y + R * 0.006); }
    /* inner: temperature -20..40 °C */
    band(0.535 * R, 0.6 * R, 0, 1 / 3, 'rgba(70,112,196,0.36)');
    g.strokeStyle = INK; g.lineWidth = R * 0.005; g.beginPath(); g.arc(c, c, 0.6 * R, ang(0) - Math.PI / 2, ang(1) - Math.PI / 2); g.stroke();
    for (let T = -20; T <= 40; T += 1) {
      const a = ang((T + 20) / 60), maj = T % 10 === 0, half = T % 2 === 0;
      tick(0.6 * R, (maj ? 0.535 : half ? 0.56 : 0.578) * R, a, R * (maj ? 0.011 : half ? 0.0055 : 0.0032), maj ? RED : INK);
    }
    g.fillStyle = RED; g.font = `600 ${(0.07 * R) | 0}px ${SERIF}`;
    for (let T = -20; T <= 40; T += 10) { const [x, y] = at(0.465 * R, ang((T + 20) / 60)); g.fillText(T < 0 ? '−' + Math.abs(T) : String(T), x - (T < 0 ? R * 0.012 : 0), y + R * 0.005); }
    /* lettering */
    g.fillStyle = NAVY; g.font = `500 ${(0.047 * R) | 0}px ${SERIF}`;
    spaced(g, 'HUMIDITY %', c, c - 0.25 * R, R * 0.018);
    g.fillStyle = RED; g.font = `600 ${(0.068 * R) | 0}px ${SERIF}`; g.fillText('°C', c, c + 0.25 * R);
    g.fillStyle = INK; g.font = `italic 400 ${(0.052 * R) | 0}px ${SERIF}`; g.fillText('Weatherglass & Co.', c, c + 0.73 * R);
    /* a printed centre ring and a soft shadow under the bezel lip */
    g.strokeStyle = 'rgba(40,34,28,0.5)'; g.lineWidth = R * 0.006; g.beginPath(); g.arc(c, c, 0.085 * R, 0, 6.283); g.stroke();
    gr = g.createRadialGradient(c, c, 0.9 * R, c, c, R); gr.addColorStop(0, 'rgba(60,45,25,0)'); gr.addColorStop(1, 'rgba(60,45,25,0.35)'); g.fillStyle = gr; g.fillRect(0, 0, SZ, SZ);
    const t = new THREE.CanvasTexture(cv); t.anisotropy = maxAniso(); t.needsUpdate = true;
    return t;
  }
  function needleGeo(kind) {
    const s = new THREE.Shape(), shapes = [s];
    if (kind === 'h') {
      s.moveTo(-0.0062, -0.034); s.lineTo(-0.0042, 0.0); s.lineTo(-0.0011, 0.168); s.lineTo(0, 0.19); s.lineTo(0.0011, 0.168); s.lineTo(0.0042, 0.0); s.lineTo(0.0062, -0.034); s.closePath();
      const w = new THREE.Shape(); w.absarc(0, -0.04, 0.009, 0, Math.PI * 2, false); shapes.push(w);
    } else {
      s.moveTo(-0.0045, -0.026); s.lineTo(-0.0036, 0.0); s.lineTo(-0.0014, 0.104); s.lineTo(-0.0068, 0.106); s.lineTo(0, 0.137); s.lineTo(0.0068, 0.106); s.lineTo(0.0014, 0.104); s.lineTo(0.0036, 0.0); s.lineTo(0.0045, -0.026); s.closePath();
      const w = new THREE.Shape(); w.absarc(0, -0.028, 0.0085, 0, Math.PI * 2, false); shapes.push(w);
    }
    const ring = new THREE.Shape(); ring.absarc(0, 0, kind === 'h' ? 0.0095 : 0.0075, 0, Math.PI * 2, false); shapes.push(ring);
    return new THREE.ShapeGeometry(shapes, 12);
  }
  const gauge = (WG.gauge = {
    centre: { x: GAUGE.x, y: GAUGE.y, z: GAUGE.z + 0.04 }, radius: GAUGE.r,
    hum: new U.Spring(0, 42, 4.4), tmp: new U.Spring(0, 46, 4.8), tapK: 0, lastTap: -10,
    /* does the ray (o, d) meet the dial? */
    hit(o, d) {
      if (!o || !d || Math.abs(d.z) < 1e-6) return false;
      const t = (GAUGE.z + 0.04 - o.z) / d.z; if (t <= 0) return false;
      const x = o.x + d.x * t - GAUGE.x, y = o.y + d.y * t - GAUGE.y;
      return x * x + y * y < (GAUGE.r + 0.02) * (GAUGE.r + 0.02);
    },
    /* a knock on the glass: both needles jump and resettle */
    tap() {
      const now = performance.now() / 1000; if (now - gauge.lastTap < 0.15) return false;
      gauge.lastTap = now;
      const k = WG.reducedMotion ? 0.45 : 1, sgn = () => (Math.random() < 0.5 ? -1 : 1);
      gauge.hum.v += sgn() * (2.6 + Math.random() * 1.8) * k; gauge.tmp.v += sgn() * (2.2 + Math.random() * 1.6) * k;
      gauge.tapK = 1;
      const pan = WG.cam && WG.cam.panOf ? WG.cam.panOf(GAUGE.x, GAUGE.y, GAUGE.z) : 0;
      WG.bus.emit('gauge:tap', { x: GAUGE.x, y: GAUGE.y, z: GAUGE.z, pan });
      return true;
    },
  });
  const angH = (h) => (-135 + 270 * U.sat(h)) * D2R;
  const angT = (t) => (-135 + 270 * U.sat((t + 20) / 60)) * D2R;
  function buildGauge() {
    const tex = drawDial(T0 === 2 ? 2048 : 1024);
    const dial = new THREE.Mesh(new THREE.CircleGeometry(0.205, 96), WG.mat.lit({
      name: 'gaugeDial', env: 'studio', uniforms: Object.assign({ uDial: { value: tex } }, BK), fragDecl: 'uniform sampler2D uDial;' + BACK_GLSL,
      frag: /* glsl */ `vec3 tc = texture2D(uDial, vUv).rgb; albedo = pow(tc, vec3(2.2)) * 0.6;
        float r = length(vUv - 0.5) * 2.0; ao = mix(1.0, 0.5, smoothstep(0.86, 1.0, r)) * 0.5; rough = 0.6; spec = 0.03;`,
      fragPost: 'col += albedo * wgsFill(N) * 0.8; col *= mix(1.0, 0.6, smoothstep(0.9, 1.0, r));',
    }));
    dial.position.set(GAUGE.x, GAUGE.y, GAUGE.z + 0.012);
    WG.add(dial, { pass: 'A', shadow: false });
    const nH = new THREE.Mesh(needleGeo('h'), WG.mat.lit({ name: 'needleH', env: 'studio', shadow: true, frag: 'albedo = vec3(0.035, 0.07, 0.19); metal = 0.65; rough = 0.28; spec = 0.05;' }));
    const nT = new THREE.Mesh(needleGeo('t'), WG.mat.lit({ name: 'needleT', env: 'studio', shadow: true, frag: 'albedo = vec3(0.42, 0.035, 0.025); metal = 0.0; rough = 0.42; spec = 0.045;' }));
    nH.position.set(GAUGE.x, GAUGE.y, GAUGE.z + 0.024); nT.position.set(GAUGE.x, GAUGE.y, GAUGE.z + 0.019);
    WG.add(nH, { pass: 'A', shadow: true }); WG.add(nT, { pass: 'A', shadow: true });
    /* the domed crystal */
    const rs = (0.207 * 0.207 + 0.028 * 0.028) / (2 * 0.028), th = Math.asin(0.207 / rs);
    const cg = new THREE.SphereGeometry(rs, T0 === 0 ? 32 : 48, 8, 0, Math.PI * 2, 0, th); cg.rotateX(Math.PI / 2);
    const crystal = new THREE.Mesh(cg, WG.mat.lit({
      name: 'gaugeCrystal', env: 'studio', transparent: true, premultiplied: true, shadow: false,
      frag: /* glsl */ `albedo = vec3(0.0); metal = 0.0; spec = 0.045; float smudge = wgNoise(P.xy * 60.0) * wgNoise(P.xy * 13.0 + 2.0);
        rough = 0.04 + 0.12 * smoothstep(0.35, 0.8, smudge); float fr = pow(1.0 - max(dot(N, V), 0.0), 5.0); alpha = 0.035 + 0.35 * fr;`,
    }));
    crystal.position.set(GAUGE.x, GAUGE.y, GAUGE.z + 0.036 + 0.028 - rs);
    crystal.renderOrder = 3;
    WG.add(crystal, { pass: 'A' });
    gauge.hum.x = gauge.hum.t = angH(S.humidity); gauge.tmp.x = gauge.tmp.t = angT(S.temp);
    nH.rotation.z = -gauge.hum.x; nT.rotation.z = -gauge.tmp.x;
    return { dial, nH, nT, crystal };
  }
  const STOP = 141 * D2R;
  function needles(g, dt, t) {
    const rm = WG.reducedMotion ? 0.25 : 1;
    gauge.tapK = Math.max(0, gauge.tapK - dt * 0.9);
    const air = U.sat(S.wind.speed * 0.4 + S.storm * 0.8 + S.rain * 0.3);
    const qv = (0.0025 + 0.006 * air + 0.012 * gauge.tapK) * rm;
    gauge.hum.t = angH(S.humidity) + (U.vnoise(t * 2.7, 1.3, 11) - 0.5) * qv * 2 + Math.sin(t * 23.0) * qv * 0.35;
    gauge.tmp.t = angT(S.temp) + (U.vnoise(t * 3.1, 4.7, 12) - 0.5) * qv * 1.6 + Math.sin(t * 19.0 + 1.0) * qv * 0.3;
    const n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 2; k++) { const s = k ? gauge.tmp : gauge.hum; s.step(h); if (s.x > STOP) { s.x = STOP; s.v = -Math.abs(s.v) * 0.35; } else if (s.x < -STOP) { s.x = -STOP; s.v = Math.abs(s.v) * 0.35; } }
    }
    g.nH.rotation.z = -gauge.hum.x; g.nT.rotation.z = -gauge.tmp.x;
  }

  /* ------------------------------------------------------------------ the part */
  const studio = (WG.studio = { backGLSL: BACK_GLSL, uniforms: BK, meshes: {} });
  let G8 = null;
  WG.register('studio', {
    init() {
      const M = studio.meshes;
      const tryB = (name, fn) => { try { M[name] = fn(); } catch (e) { WG.fail('studio.' + name, e); } };
      tryB('backdrop', buildBackdrop);
      tryB('table', buildTable);
      tryB('plinth', buildPlinth);
      tryB('brass', buildBrass);
      tryB('plaque', buildPlaque);
      tryB('gauge', buildGauge);
      G8 = M.gauge || null;
      /* a click that lands on the dial taps it (the interaction layer may also call gauge.tap; repeated taps are merged) */
      WG.bus.on('scene:click', (e) => {
        if (!e || e.x === undefined || !WG.cam || !WG.cam.ray || performance.now() / 1000 - gauge.lastTap < 0.8) return;
        const r = WG.cam.ray(e.x, e.y); if (gauge.hit(r.o, r.d)) gauge.tap();
      });
    },
    update(dt, t) {
      /* the lamp glow on the backdrop follows the sun, or faintly the moon */
      const sky = WG.sky || {};
      const moon = !!sky.keyIsMoon;
      if (moon) { BK.uBkSun.value.copy(S.moonPos); BK.uBkP.value.x = 0.25 * S.moonUp * (1 - 0.8 * S.storm); BK.uBkP.value.y = 1; }
      else { BK.uBkSun.value.copy(S.sunPos); BK.uBkP.value.x = U.smooth(-0.06, 0.12, S.sunDir.y) * (1 - 0.75 * S.storm) * (1 - 0.45 * U.smooth(0.3, 1, S.cover)); BK.uBkP.value.y = 0; }
      if (G8) needles(G8, dt, t);
    },
  });
})();
