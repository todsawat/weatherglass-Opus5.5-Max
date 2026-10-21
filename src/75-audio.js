/* Weatherglass — sound. Everything is synthesised live with the Web Audio API (no audio files):
   noise buffers through filters for wind, rain, water and thunder; oscillators with envelopes for birds, insects,
   frogs, glass and the chime; a generated room reverb; a limiter so thunder never clips.
   The ambience follows WG.state every frame; events arrive on the bus; held gestures call WG.audio.cont().
   makeEngine(ctx) works on any BaseAudioContext, so the whole engine can be rendered offline for tests. */
(function () {
  'use strict';
  const WG = window.WG, U = WG.util;
  const AC = window.AudioContext || window.webkitAudioContext;
  const sat = U.sat, sm = U.smooth, clamp = U.clamp, R = Math.random;
  const rnd = (a, b) => a + (b - a) * Math.random();
  const fin = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const clampP = (p) => clamp(fin(p, 0), -1, 1) * 0.9;

  function makeEngine(ctx) {
    const sr = ctx.sampleRate, E = { ctx, clock: 0 };
    const now = () => ctx.currentTime;

    /* ------------------------------------------------------------ generated buffers */
    function noise(kind, secs) {          // 0 white, 1 pink, 2 brown; seamless loop, normalised to rms 0.25
      const n = Math.floor(sr * secs), m = Math.floor(sr * 0.05), tmp = new Float32Array(n + m);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
      for (let i = 0; i < n + m; i++) {
        const w = R() * 2 - 1;
        if (kind === 0) tmp[i] = w;
        else if (kind === 1) { b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898; tmp[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926; }
        else { br = (br + 0.02 * w) / 1.02; tmp[i] = br; }
      }
      const b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = tmp[i];
      for (let j = 0; j < m; j++) { const f = j / m; d[j] = tmp[j] * f + tmp[n + j] * (1 - f); }
      let mean = 0; for (let i = 0; i < n; i++) mean += d[i]; mean /= n;
      let s = 0; for (let i = 0; i < n; i++) { d[i] -= mean; s += d[i] * d[i]; }
      const k = 0.25 / Math.sqrt(s / n + 1e-12); for (let i = 0; i < n; i++) d[i] *= k;
      return b;
    }
    /* sparse grains: static crackle (clustered clicks) or papery leaf rustle (dense tiny grains coming in flurries) */
    function grains(secs, density, minL, maxL, flurry) {
      const n = Math.floor(sr * secs), b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
      let i = 0, pk = 0;
      while (i < n) {
        const ph = i / n, f = flurry ? 0.25 + 0.75 * Math.pow(0.5 + 0.5 * Math.sin(ph * Math.PI * 2 * 5 + Math.sin(ph * 31) * 1.3), 2) : (R() < 0.12 ? 7 : 1);
        i += 1 + Math.floor((-Math.log(1 - R() * 0.9999) * sr) / (density * f));
        if (i >= n) break;
        const a = Math.pow(R(), 2.2) * (R() < 0.5 ? -1 : 1), L = minL + Math.floor(R() * (maxL - minL));
        for (let k = 0; k < L; k++) { const j = (i + k) % n; d[j] += a * (R() * 2 - 1) * Math.exp(-k / (L * 0.3)); }
      }
      for (let j = 0; j < n; j++) pk = Math.max(pk, Math.abs(d[j]));
      const k = 0.9 / (pk || 1); for (let j = 0; j < n; j++) d[j] *= k;
      return b;
    }
    /* smooth random modulation, -1..1, loopable, `hz` new values per second */
    function modBuf(secs, hz) {
      const n = Math.floor(sr * secs), pts = Math.max(4, Math.round(secs * hz)), v = []; for (let k = 0; k < pts; k++) v.push(R() * 2 - 1);
      const b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) { const x = (i / n) * pts, k = Math.floor(x), f = x - k, s = f * f * (3 - 2 * f); d[i] = v[k % pts] + (v[(k + 1) % pts] - v[k % pts]) * s; }
      return b;
    }
    /* one water drop: a tiny bubble 'plink' (a damped sine sweeping up) plus a tick */
    function dropBuf(f0, f1, len, tick, decay) {
      const n = Math.floor(sr * len), b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0); let ph = 0;
      for (let i = 0; i < n; i++) { const t = i / sr, f = f0 * Math.pow(f1 / f0, Math.min(1, t / (len * 0.6))); ph += (2 * Math.PI * f) / sr; d[i] = Math.sin(ph) * Math.exp(-t * decay) * (1 - Math.exp(-t * 4000)) * 0.8 + (R() * 2 - 1) * Math.exp(-t * 1100) * tick; }
      return b;
    }
    /* a small wooden room with glass walls: early reflections and a darkening tail */
    function impulse(secs) {
      const n = Math.floor(sr * secs), b = ctx.createBuffer(2, n, sr);
      for (let c = 0; c < 2; c++) {
        const d = b.getChannelData(c); let lp = 0;
        for (let i = 0; i < n; i++) { const t = i / sr, cut = 0.08 + 0.6 * Math.exp(-t * 3); lp += (R() * 2 - 1 - lp) * cut; d[i] = t < 0.006 ? 0 : lp * Math.exp(-t / 0.3) * (1 - Math.exp(-(t - 0.006) * 400)); }
        for (let k = 0; k < 7; k++) { const j = Math.floor(sr * (0.007 + R() * 0.045)); if (j < n) d[j] += (R() - 0.5) * 0.5 * Math.exp(-j / sr / 0.05); }
      }
      return b;
    }
    const NB = { w: noise(0, 4), p: noise(1, 4), b: noise(2, 3) };
    const CRK = grains(3, 70, 6, 60, false), RUS = grains(4, 900, 10, 40, true), MOD = modBuf(4, 11);
    const DROPS = [dropBuf(1700, 3100, 0.06, 0.25, 70), dropBuf(1250, 2500, 0.07, 0.2, 60), dropBuf(2500, 4100, 0.045, 0.3, 90), dropBuf(900, 960, 0.03, 0.9, 140), dropBuf(3300, 3400, 0.025, 0.8, 160), dropBuf(2000, 2050, 0.03, 0.6, 150)];
    let HOLLOW = null; try { HOLLOW = ctx.createPeriodicWave(new Float32Array([0, 0, 0, 0]), new Float32Array([0, 1, 0.16, 0.05])); } catch (e) { HOLLOW = null; }

    /* ------------------------------------------------------------ node helpers */
    const g = (v, dest) => { const n = ctx.createGain(); n.gain.value = v; if (dest) n.connect(dest); return n; };
    const filt = (type, f, q, dest) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q === undefined ? 0.7 : q; if (dest) n.connect(dest); return n; };
    const panN = (p, dest) => {
      let n; if (ctx.createStereoPanner) { n = ctx.createStereoPanner(); n.pan.value = clampP(p); } else { n = ctx.createGain(); n.pan = null; }
      if (dest) n.connect(dest); return n;
    };
    const src = (b, rate, loop) => { const s = ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate || 1; s.loop = !!loop; return s; };
    const loopSrc = (b, rate) => { const s = src(b, rate, true); s.start(now(), R() * b.duration * 0.95); return s; };
    const tgt = (param, v, tc) => { if (param && isFinite(v)) param.setTargetAtTime(v, now(), tc || 0.1); };
    const setPan = (n, v, tc) => { if (n && n.pan) tgt(n.pan, clampP(v), tc || 0.15); };
    const P = (x, y, z) => { try { return WG.cam && WG.cam.panOf ? clampP(WG.cam.panOf(x, y, z)) : 0; } catch (e) { return 0; } };

    /* ------------------------------------------------------------ master chain */
    const out = g(0, ctx.destination);
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -12; lim.knee.value = 6; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.25;
    lim.connect(out);
    const master = g(0.6, lim);          // the compressor adds about +7 dB of make-up gain below its threshold; above it, output stays under about -4 dBFS
    const verb = ctx.createConvolver(); verb.buffer = impulse(1.4);
    const verbOut = g(0.42, master); verb.connect(verbOut);
    const send = g(1, verb);
    const amb = g(1, master), fx = g(1, master);
    E.setOn = (on, instant) => { const v = on ? 0.92 : 0; if (instant) { out.gain.cancelScheduledValues(now()); out.gain.setValueAtTime(v, now()); } else tgt(out.gain, v, on ? 0.25 : 0.08); };

    /* a layer of the ambience: a gain whose input chain is unplugged (stops being processed) after a few silent seconds */
    function Layer(dest) {
      const L = { g: g(0), on: false, quiet: 0 };
      L.set = (v, tc, dt) => {
        if (v > 2e-4) { if (!L.on) { L.g.connect(dest); L.on = true; } L.quiet = 0; tgt(L.g.gain, v, tc); }
        else if (L.on) { tgt(L.g.gain, 0, 0.3); L.quiet += dt; if (L.quiet > 3) { try { L.g.disconnect(); } catch (e) { /* */ } L.on = false; } }
      };
      return L;
    }

    /* ------------------------------------------------------------ ambience graph */
    // room tone: a barely audible low hum of the room so silence never feels dead
    const room = Layer(master); loopSrc(NB.b, 0.9).connect(filt('lowpass', 200, 0.5, room.g));
    // wind: two decorrelated rushes left and right, plus a low body in strong wind
    const wind = [-1, 1].map((side) => { const p = panN(side * 0.65, amb), L = Layer(p), f = filt('bandpass', 500, 0.6, L.g); loopSrc(NB.p, 1 + side * 0.035).connect(f); return { L, f, p }; });
    const windLow = Layer(amb); loopSrc(NB.b, 1.1).connect(filt('lowpass', 220, 0.6, windLow.g));
    // leaves: papery grains, band-passed, with a fluttering amplitude
    const leaves = [-1, 1].map((side) => {
      const p = panN(side * 0.5, amb), L = Layer(p), am = g(0.7, L.g), f = filt('bandpass', side < 0 ? 3600 : 4600, 0.8, am);
      loopSrc(RUS, side < 0 ? 1 : 0.88).connect(f); const m = loopSrc(MOD, side < 0 ? 1.6 : 2.1); m.connect(g(0.3, am.gain)); return { L, p };
    });
    // storm howl: resonant bands in pink noise whose pitch glides
    const howl = Layer(amb); howl.g.connect(g(0.3, send));
    const h1 = filt('bandpass', 320, 11), h2 = filt('bandpass', 500, 13), hs = loopSrc(NB.p, 0.97); hs.connect(h1); hs.connect(h2); h1.connect(howl.g); h2.connect(howl.g);
    // rain: hiss, mid wash and low roar from where the rain falls; patter of single drops on top
    const rainP = panN(0, amb);
    const hiss = Layer(rainP); loopSrc(NB.w, 1).connect(filt('highpass', 2000, 0.5, filt('lowpass', 9500, 0.5, hiss.g)));
    const rmid = Layer(rainP); loopSrc(NB.p, 1.04).connect(filt('bandpass', 1100, 0.55, rmid.g));
    const roar = Layer(rainP); loopSrc(NB.b, 0.95).connect(filt('lowpass', 340, 0.6, roar.g));
    const patterBus = g(0, amb); patterBus.connect(g(0.12, send));
    // snowfall: a very quiet soft hush
    const hush = Layer(amb); loopSrc(NB.p, 0.92).connect(filt('lowpass', 650, 0.5, hush.g));
    // waterfall: a steady wash from its side of the case
    const fallP = panN(0, amb), fall = Layer(fallP); fall.g.connect(g(0.12, send));
    { const s1 = loopSrc(NB.p, 0.9), s2 = loopSrc(NB.w, 1.02); s1.connect(filt('bandpass', 620, 0.6, fall.g)); s2.connect(filt('bandpass', 2600, 0.7, g(0.55, fall.g))); }
    // river: a brighter babble (band-passed noise whose level bubbles), gurgles are one-shots
    const riverP = panN(0, amb), river = Layer(riverP), rAm = g(0.55, river.g);
    { const s = loopSrc(NB.w, 0.97); s.connect(filt('bandpass', 2300, 1.4, rAm)); loopSrc(NB.p, 1.07).connect(filt('bandpass', 950, 1.1, g(0.6, rAm))); const m = loopSrc(MOD, 0.9); m.connect(g(0.45, rAm.gain)); }
    // birds and night creatures share a gentle top cut and a little room
    const birdBus = g(1); birdBus.connect(filt('lowpass', 8500, 0.5, amb)); birdBus.connect(g(0.28, send));

    /* ------------------------------------------------------------ one-shot voices */
    let voices = 0; const CAP = 48;
    E.voices = () => voices;
    /* a small group of sources sharing a panner and a reverb send; disconnects itself when its sources end */
    function V(pan, sendAmt, dest) {
      const inp = ctx.createGain(), p = panN(pan, dest || fx), nodes = [inp, p]; inp.connect(p);
      if (sendAmt) { const sg = g(sendAmt, send); inp.connect(sg); nodes.push(sg); }
      let live = 0;
      const own = (s, chain) => { live++; voices++; for (const c of chain) nodes.push(c); s.onended = () => { voices--; if (--live === 0) for (const x of nodes) { try { x.disconnect(); } catch (e) { /* */ } } }; };
      const env = (param, o) => {
        const t = o.t, a = Math.max(1e-4, o.a), at = o.att || 0.005, h = o.hold || 0;
        param.setValueAtTime(1e-4, t); param.exponentialRampToValueAtTime(a, t + at); if (h) param.setValueAtTime(a, t + at + h);
        param.exponentialRampToValueAtTime(1e-4, t + at + h + o.dec); return t + at + h + o.dec;
      };
      return {
        inp,
        tone(o) {   // {t, f, f1, glide, type, wave, a, att, hold, dec, vib, vibHz}
          const os = ctx.createOscillator(), eg = g(0, inp);
          if (o.wave) os.setPeriodicWave(o.wave); else os.type = o.type || 'sine';
          os.frequency.setValueAtTime(o.f, o.t); if (o.f1) os.frequency.exponentialRampToValueAtTime(o.f1, o.t + (o.glide || (o.att || 0.005) + o.dec));
          os.connect(eg); const end = env(eg.gain, o), chain = [os, eg];
          if (o.vib) { const l = ctx.createOscillator(), lg = g(o.vib); l.frequency.value = o.vibHz || 5; l.connect(lg); lg.connect(os.frequency); l.start(o.t); l.stop(end + 0.05); chain.push(l, lg); }
          os.start(o.t); os.stop(end + 0.05); own(os, chain); return end;
        },
        noise(o) {  // {t, buf, rate, type, f, f1, q, a, att, hold, dec}
          const s = src(o.buf || NB.w, o.rate || 1, true), f = filt(o.type || 'bandpass', o.f, o.q), eg = g(0, inp);
          s.connect(f); f.connect(eg);
          const end = env(eg.gain, o);
          if (o.f1) { f.frequency.setValueAtTime(o.f, o.t); if (o.fm) f.frequency.exponentialRampToValueAtTime(o.fm, o.t + (o.att || 0.005)); f.frequency.exponentialRampToValueAtTime(o.f1, end); }
          s.start(o.t, R() * s.buffer.duration * 0.9); s.stop(end + 0.05); own(s, [s, f, eg]); return end;
        },
        buf(o) {    // {t, buf, rate, a}
          const s = src(o.buf, o.rate || 1, false), eg = g(o.a, inp); s.connect(eg); s.start(o.t); own(s, [s, eg]);
        },
      };
    }
    const free = (n) => voices + (n || 1) <= CAP;

    /* ---- small building blocks */
    function tink(t, f, a, dec, pan, sendAmt) {     // struck glass: a few inharmonic partials and a click
      if (!free(5)) return; const v = V(pan, sendAmt), ra = [1, 2.76, 5.4, 8.93], am = [1, 0.42, 0.2, 0.08];
      for (let i = 0; i < 4; i++) v.tone({ t, f: f * ra[i] * (1 + (R() - 0.5) * 0.006), a: a * am[i], att: 0.0015, dec: dec / (1 + i * 1.1) });
      v.noise({ t, buf: NB.w, type: 'highpass', f: 5000, q: 0.5, a: a * 0.35, att: 0.001, dec: 0.012 });
    }
    function drip(t, lv, pan, pitch) {
      if (!free(1)) return; const v = V(pan, 0.3);
      v.buf({ t, buf: DROPS[(R() * 3) | 0], rate: (pitch || 1) * rnd(0.85, 1.2), a: 0.22 * lv });
    }
    function whoosh(t, lv, pan, pitch, size, buf) {
      if (!free(1)) return; const v = V(pan, 0.15), sz = 0.6 + sat(size === undefined ? 0.5 : size) * 0.8, pi = pitch || 1;
      v.noise({ t, buf: buf || NB.p, type: 'bandpass', f: 420 * pi, fm: 1500 * pi, f1: 380 * pi, q: 1.1, a: 0.16 * lv, att: 0.16 * sz, dec: 0.38 * sz });
    }
    const MOTIFS = [[0, 4, 7, 12], [0, 2, 7, 9], [0, 7, 9, 12], [2, 4, 9, 14], [0, 4, 9]];
    function chime(t, lv, pan, pitch) {
      if (!free(12)) return; const m = MOTIFS[(R() * MOTIFS.length) | 0], base = 784 * (pitch || 1), v = V(pan * 0.5, 0.65);
      m.forEach((st, i) => {
        const f = base * Math.pow(2, st / 12), tt = t + i * 0.17 + R() * 0.012, a = 0.05 * lv * (1 - i * 0.07);
        v.tone({ t: tt, f, a, att: 0.006, dec: 2.4 }); v.tone({ t: tt, f: f * 2.004, a: a * 0.25, att: 0.004, dec: 1.1 }); v.tone({ t: tt, f: f * 3.01, a: a * 0.07, att: 0.003, dec: 0.5 });
      });
    }
    function rustle(t, lv, pan) {
      if (!free(1) || lv < 0.01) return; const v = V(pan, 0.1);
      v.noise({ t, buf: RUS, rate: rnd(0.9, 1.2), type: 'bandpass', f: 4000, q: 0.8, a: 0.3 * lv, att: 0.05, dec: 0.55 });
    }

    /* ---- thunder: a crack at the flash, then a roll that arrives later and duller the farther away */
    E.thunder = (o) => {
      o = o || {};
      const t = now() + 0.005, dist = clamp(fin(o.dist, 20), 5, 50), near = 1 - sm(10, 35, dist), pw = clamp(fin(o.power, 1), 0.2, 1.5), pan = clampP(o.pan);
      if (o.crack !== false && free(3)) {
        const v = V(pan, 0.5);
        v.noise({ t, buf: NB.w, type: 'highpass', f: 900 + 1600 * near, q: 0.6, a: (0.07 + 0.42 * near) * pw, att: 0.0015, dec: 0.08 + 0.14 * near });
        v.noise({ t: t + 0.006, buf: CRK, rate: 1.6, type: 'bandpass', f: 2400, q: 0.5, a: (0.08 + 0.4 * near) * pw, att: 0.002, dec: 0.22 + 0.25 * near });
        if (near > 0.35) v.tone({ t, f: 95, f1: 38, a: 0.32 * near * pw, att: 0.004, dec: 0.3 });
      }
      const tR = t + 0.15 + 1.15 * sat((dist - 10) / 25), dur = 4.2 + 2.6 * R() + 2.2 * near, A = (0.24 + 0.5 * near) * pw;
      const v = V(pan * 0.7, 0.55), env = g(0, v.inp);
      const s1 = src(NB.b, rnd(0.8, 1.0), true), lp1 = filt('lowpass', 260 + 900 * near, 0.6, env);
      const s2 = src(NB.b, rnd(0.45, 0.6), true), lp2 = filt('lowpass', 90, 0.7, g(1.2, env));
      const s3 = src(NB.p, rnd(0.9, 1.1), true), cg = g(0, env), lp3 = filt('lowpass', 500 + 2600 * near, 0.5, cg);
      s1.connect(lp1); s2.connect(lp2); s3.connect(lp3);
      lp1.frequency.setValueAtTime(260 + 900 * near, tR); lp1.frequency.exponentialRampToValueAtTime(110 + 90 * near, tR + dur);
      cg.gain.setValueAtTime(1e-4, tR); cg.gain.exponentialRampToValueAtTime(0.5 * near + 0.12, tR + 0.03); cg.gain.exponentialRampToValueAtTime(1e-4, tR + 0.6 + 0.9 * near);
      env.gain.setValueAtTime(0, tR); let tt = tR + 0.05 + 0.1 * (1 - near), lvl = A; env.gain.linearRampToValueAtTime(A, tt);
      while (tt < tR + dur - 0.7) {
        tt += rnd(0.2, 0.75); lvl *= rnd(0.7, 0.9); env.gain.linearRampToValueAtTime(lvl * rnd(0.25, 0.55), tt);
        tt += rnd(0.12, 0.4); env.gain.linearRampToValueAtTime(lvl * rnd(0.75, 1.1), tt);
      }
      env.gain.linearRampToValueAtTime(0, tR + dur);
      for (const s of [s1, s2, s3]) { s.start(tR, R() * 2); s.stop(tR + dur + 0.1); }
      voices++; s1.onended = () => { voices--; for (const x of [s1, s2, s3, lp1, lp2, lp3, cg, env, v.inp]) { try { x.disconnect(); } catch (e) { /* */ } } };
    };

    /* ---- the named one-shots */
    const lastEvt = {};
    const gate = (name, gap) => { const t = now(); if (lastEvt[name] !== undefined && t - lastEvt[name] < gap) return false; lastEvt[name] = t; return true; };
    E.one = (name, o) => {
      o = o || {}; const pan = clampP(o.pan), lv = fin(o.level, 1), pitch = fin(o.pitch, 1) || 1, size = fin(o.size, 0.5), t = now() + 0.005;
      switch (name) {
        case 'tick': { if (!free(2) || !gate('tick', 0.06)) return; const v = V(pan, 0); v.noise({ t, type: 'bandpass', f: 3800 * pitch, q: 2.5, a: 0.12 * lv, att: 0.001, dec: 0.014 }); v.tone({ t, f: 2300 * pitch, a: 0.025 * lv, att: 0.001, dec: 0.025 }); break; }
        case 'tink': tink(t, 3100 * pitch, 0.04 * lv, 0.22, pan, 0.2); break;
        case 'pop': { if (!free(2)) return; const v = V(pan, 0.1); v.tone({ t, f: 700 * pitch, f1: 240 * pitch, glide: 0.05, a: 0.12 * lv, att: 0.002, dec: 0.07 }); v.noise({ t, buf: NB.p, type: 'bandpass', f: 1600, q: 1, a: 0.05 * lv, att: 0.001, dec: 0.025 }); break; }
        case 'chime': if (gate('chime', 0.3)) chime(t, lv, pan, pitch); break;
        case 'whoosh': whoosh(t, lv, pan, pitch, size); break;
        case 'drip': drip(t, lv, pan, pitch); break;
        default: break;
      }
    };

    /* ---- events from the bus */
    const evPan = (d) => (d && typeof d.pan === 'number' ? clampP(d.pan) : d && typeof d.x === 'number' ? P(d.x, fin(d.y, 1), fin(d.z, 0)) : 0);
    E.event = (name, d) => {
      d = d || {}; const t = now() + 0.005, pan = evPan(d);
      switch (name) {
        case 'lightning': E.thunder({ dist: d.dist, pan, power: d.power }); break;
        case 'cloud:storm': if (gate(name, 4)) E.thunder({ dist: 40, pan, power: 0.45, crack: false }); break;
        case 'cloud:grab': {
          if (!gate(name, 0.05) || !free(2)) return; const sz = clamp(fin(d.size, 0.6), 0.25, 1.6), k = Math.pow(0.6 / sz, 0.7), v = V(pan, 0.25);
          v.noise({ t, buf: NB.p, type: 'bandpass', f: 650 * k, f1: 1000 * k, q: 1.2, a: 0.14, att: 0.045, dec: 0.3 });
          v.tone({ t, f: 150 * k, f1: 105 * k, a: 0.05, att: 0.02, dec: 0.2 }); break;
        }
        case 'cloud:release': {
          if (!gate(name, 0.05) || !free(1)) return; const k = sat(fin(d.speed, 1) / 5), v = V(pan, 0.2);
          v.noise({ t, buf: NB.p, type: 'bandpass', f: 600, fm: 1300, f1: 360, q: 0.9, a: 0.05 + 0.15 * k, att: 0.06 + 0.06 * (1 - k), dec: 0.35 + 0.45 * k }); break;
        }
        case 'cloud:merge': {
          if (!gate(name, 0.1) || !free(4)) return; const f = clamp(68 * Math.pow(0.8 / clamp(fin(d.size, 0.8), 0.3, 2), 0.35), 40, 95), v = V(pan, 0.35);
          for (let i = 0; i < 2; i++) { const tt = t + i * 0.17; v.tone({ t: tt, f, f1: f * 0.6, a: i ? 0.26 : 0.36, att: 0.012, dec: 0.32 }); v.noise({ t: tt, buf: NB.b, type: 'lowpass', f: 300, q: 0.5, a: i ? 0.1 : 0.14, att: 0.02, dec: 0.28 }); }
          break;
        }
        case 'cloud:pop': { if (!gate(name, 0.04) || !free(2)) return; const v = V(pan, 0.2); v.tone({ t, f: 560, f1: 230, glide: 0.06, a: 0.08, att: 0.003, dec: 0.07 }); v.noise({ t, buf: NB.p, type: 'bandpass', f: 1300, q: 0.9, a: 0.06, att: 0.004, dec: 0.08 }); break; }
        case 'cloud:bounce': { if (!gate(name, 0.15) || !free(2)) return; const k = sat(fin(d.speed, 1) / 4), v = V(pan, 0.2); v.tone({ t, f: 110, f1: 70, a: 0.04 + 0.1 * k, att: 0.01, dec: 0.2 }); v.noise({ t, buf: NB.p, type: 'bandpass', f: 500, q: 0.8, a: 0.03 + 0.06 * k, att: 0.02, dec: 0.25 }); break; }
        case 'splash': {
          if (!gate(name, 0.04) || !free(4)) return; const s = sat(fin(d.size, 0.5)), f0 = 260 + 240 * (1 - s), v = V(pan, 0.3);
          v.tone({ t, f: f0, f1: f0 * 2.4, glide: 0.07, a: 0.13 * (0.5 + 0.5 * s), att: 0.002, dec: 0.12 });
          v.tone({ t, f: 130 + 40 * (1 - s), f1: 70, glide: 0.1, a: 0.1 * s + 0.03, att: 0.003, dec: 0.16 });
          v.noise({ t: t + 0.008, buf: NB.w, type: 'highpass', f: 2200, q: 0.5, a: 0.05 + 0.12 * s, att: 0.008, dec: 0.25 + 0.5 * s });
          v.noise({ t, buf: NB.p, type: 'bandpass', f: 700, q: 0.8, a: 0.05 + 0.07 * s, att: 0.004, dec: 0.15 });
          const n = 2 + Math.floor(s * 5); for (let i = 0; i < n; i++) drip(t + 0.15 + R() * 0.6, 0.2 + 0.3 * R(), pan + (R() - 0.5) * 0.2, rnd(0.9, 1.6));
          break;
        }
        case 'drip': if (gate(name, 0.03)) drip(t, fin(d.level, 0.8), pan, 1); break;
        case 'glass:tap': {
          if (!gate(name, 0.04)) return; const F = [1568, 1480, 1760, 1661, 2093], p = clamp(fin(d.pane, 0) | 0, 0, 4);
          tink(t, F[p] * (1 + (R() - 0.5) * 0.01), 0.07, 0.9, pan, 0.45); break;
        }
        case 'ice:crack': {
          if (!gate(name, 0.05) || !free(8)) return; tink(t, rnd(2600, 3300), 0.06, 0.45, pan, 0.45);
          const v = V(pan, 0.3); v.noise({ t: t + 0.003, buf: CRK, rate: 1.3, type: 'highpass', f: 1800, q: 0.6, a: 0.12, att: 0.002, dec: 0.2 }); v.tone({ t, f: 150, f1: 90, a: 0.06, att: 0.003, dec: 0.12 });
          break;
        }
        case 'gauge:tap': tink(t, 1250, 0.045, 0.35, pan, 0.25); break;
        case 'tree:release': { if (!gate(name, 0.1)) return; const k = sat(fin(d.strength, 0.6)); whoosh(t, 0.35 + 0.5 * k, pan, 0.8, k); rustle(t + 0.03, (0.4 + 0.6 * k) * leafK(), pan); break; }
        case 'tree:flick': if (gate(name, 0.1)) { whoosh(t, 0.3, pan, 1.1, 0.2); rustle(t, 0.6 * leafK(), pan); } break;
        case 'fog:pour': if (gate(name, 0.35)) whoosh(t, 0.4, pan, 0.6, 0.8); break;
        case 'tool': if (gate(name, 0.03)) E.one('tick', { pan: 0 }); break;
        /* one chime per special moment: the dial already chimes when it is turned, so the arrival only chimes after a long glide */
        case 'sun:grab': case 'rainbow': case 'season:arrived': if (gate('chime', name === 'season:arrived' ? 2.5 : 1.2)) chime(t, name === 'season:arrived' ? 0.7 : 0.85, name === 'sun:grab' ? pan : 0, 1); break;
        /* the glass and the pointer code call cont() themselves; these events only stand in when they do not */
        case 'glass:wipe': if (!direct('wipe')) E.cont('wipe', sat(0.35 + fin(d.speed, 1) * 0.25), pan, true); break;
        case 'wind:sweep': if (!direct('windsweep')) E.cont('windsweep', sat(fin(d.speed, 3) / 7), pan, true); break;
        default: break;
      }
    };

    /* ------------------------------------------------------------ held sounds */
    const CDEF = {
      squeeze() {   // wet rubbery squish: wobbling resonant bands, wet bubbles, a rubbery low tone
        const o = g(0), p = panN(0, fx); o.connect(p); const sg = g(0.25, send); o.connect(sg);
        const s1 = loopSrc(NB.b, 1), b1 = filt('bandpass', 320, 3.5, g(2.2, o)); s1.connect(b1);
        const s2 = loopSrc(CRK, 0.6), b2 = filt('bandpass', 900, 5, g(0.9, o)); s2.connect(b2);
        const lfo = ctx.createOscillator(); lfo.frequency.value = 6; lfo.connect(g(140, b1.frequency)); lfo.connect(g(260, b2.frequency)); lfo.start();
        const tone = ctx.createOscillator(); tone.type = 'triangle'; tone.frequency.value = 95; tone.connect(filt('lowpass', 350, 0.7, g(0.1, o))); lfo.connect(g(9, tone.frequency)); tone.start();
        return { srcs: [s1, s2, lfo, tone], o, p, sg, set(l, pan) { tgt(o.gain, 0.32 * l, 0.06); tgt(lfo.frequency, 4.5 + 8 * l, 0.1); tgt(b1.frequency, 260 + 240 * l, 0.1); tgt(b2.frequency, 700 + 600 * l, 0.1); setPan(p, pan, 0.08); } };
      },
      charge() {    // static crackle of a charged cloud, with a faint buzz
        const o = g(0), p = panN(0, fx); o.connect(p); const sg = g(0.2, send); o.connect(sg);
        const s = loopSrc(CRK, 1); s.connect(filt('highpass', 2200, 0.6, o));
        const bz = ctx.createOscillator(); bz.type = 'sawtooth'; bz.frequency.value = 110; bz.connect(filt('bandpass', 1800, 2, g(0.05, o))); bz.start();
        return { srcs: [s, bz], o, p, sg, set(l, pan) { tgt(o.gain, 0.4 * Math.pow(l, 0.8), 0.05); tgt(s.playbackRate, 0.7 + 0.9 * l, 0.1); tgt(bz.frequency, 100 + 50 * l, 0.1); setPan(p, pan, 0.08); } };
      },
      wipe() {      // wet squeak of a finger on glass: a stick-slip chattering tone and a little water
        const o = g(0), p = panN(0, fx); o.connect(p); const sg = g(0.2, send); o.connect(sg);
        const os = ctx.createOscillator(); os.type = 'triangle'; os.frequency.value = 900;
        const chat = g(0.5), bp = filt('bandpass', 1500, 3, chat); chat.connect(o); os.connect(bp);
        const am = ctx.createOscillator(); am.type = 'square'; am.frequency.value = 30; am.connect(g(0.45, chat.gain));
        const vib = ctx.createOscillator(); vib.frequency.value = 5.3; vib.connect(g(70, os.frequency));
        const n = loopSrc(NB.w, 1); n.connect(filt('bandpass', 2600, 1.4, g(0.35, o)));
        os.start(); am.start(); vib.start();
        return { srcs: [os, am, vib, n], o, p, sg, set(l, pan) { tgt(o.gain, 0.12 * l, 0.04); tgt(os.frequency, 650 + 700 * l, 0.08); tgt(am.frequency, 22 + 30 * l, 0.08); setPan(p, pan, 0.06); } };
      },
      windsweep() { // rushing sweep that follows the stroke, louder and brighter the faster
        const o = g(0), p = panN(0, fx); o.connect(p);
        const s = loopSrc(NB.p, 1), bp = filt('bandpass', 600, 0.9, o); s.connect(bp);
        const hiG = g(0, o), s2 = loopSrc(NB.w, 1); s2.connect(filt('highpass', 3200, 0.5, hiG));
        return { srcs: [s, s2], o, p, set(l, pan) { tgt(o.gain, 0.3 * l, 0.06); tgt(bp.frequency, 380 + 2200 * l, 0.08); tgt(hiG.gain, 0.4 * l * l, 0.08); setPan(p, pan, 0.06); } };
      },
    };
    const conts = {};
    const direct = (name) => { const c = conts[name]; return !!c && E.clock - c.direct < 0.5; };
    E.cont = (name, level, pan, fromEvent) => {
      if (!CDEF[name]) return;
      const c = conts[name] || (conts[name] = { level: 0, pan: 0, last: -9, direct: -9, idle: 0, node: null });
      if (!fromEvent) c.direct = E.clock;
      level = sat(fin(level, 0));
      c.level = c.last === E.clock ? Math.max(c.level, level) : level;
      c.pan = clampP(pan); c.last = E.clock;
      if (!c.node && level > 1e-3) { try { c.node = CDEF[name](); c.idle = 0; } catch (e) { c.node = null; } }
    };
    function contUpdate(dt) {
      for (const k in conts) {
        const c = conts[k], active = E.clock - c.last < 0.15, l = active ? c.level : 0;
        if (!c.node) continue;
        c.node.set(l, c.pan);
        if (l > 1e-3) c.idle = 0; else if ((c.idle += dt) > 1.5) {
          for (const s of c.node.srcs) { try { s.stop(); } catch (e) { /* */ } try { s.disconnect(); } catch (e) { /* */ } }
          for (const x of [c.node.o, c.node.p, c.node.sg]) if (x) { try { x.disconnect(); } catch (e) { /* */ } }
          c.node = null;
        }
      }
    }

    /* ------------------------------------------------------------ the living scene */
    const S = () => WG.state || {};
    const L = () => WG.layout || {};
    const leafK = () => { const s = S(); return U.bySeason(fin(s.season, 0), 0.8, 1, 0.75, 0); };
    let rainPan = 0, rainK = 0;
    const lvl = {};   // last targets, for tests and debugging
    E.debug = () => Object.assign({ voices, clock: E.clock, rainPan }, lvl);

    /* positions */
    const trees = () => (L().trees && L().trees.length ? L().trees : null);
    const treePos = (seed) => { const T = trees(); if (!T) return { x: (U.hash(seed, 3, 9) - 0.5) * 10, y: 2, z: (U.hash(seed, 5, 9) - 0.5) * 6 }; const tr = T[Math.floor(U.hash(seed, 7, 11) * T.length) % T.length]; return { x: tr.x, y: fin(tr.y, 0.5) + fin(tr.h, 1.5) * 0.8, z: tr.z }; };
    const lakePt = (a) => { const lk = L().lake || { cx: 2.75, cz: 2.65, rx: 2.3, rzBack: 1.7 }; return { x: lk.cx + Math.cos(a) * lk.rx * 0.95, y: 0.2, z: lk.cz + Math.sin(a) * (lk.rzBack || 1.7) * 0.9 }; };
    const riverPt = (s) => { try { if (WG.terrain && WG.terrain.riverAt) { const r = WG.terrain.riverAt(s); return { x: r.x, y: r.y, z: r.z }; } } catch (e) { /* */ } return { x: -0.5 + s * 2, y: 0.6, z: -1 + s * 2.5 }; };

    /* birds: several unseen singers with their own songs */
    const KINDS = ['chirp', 'warbler', 'whistle', 'trill', 'dove', 'warbler', 'whistle', 'chirp'];
    const singers = KINDS.map((kind, i) => {
      const pm = rnd(0.9, 1.12), motif = [];
      const nm = 7 + ((R() * 6) | 0); for (let k = 0; k < nm; k++) { const f0 = rnd(2700, 5600) * pm; motif.push([f0, f0 * rnd(0.78, 1.3), rnd(0.04, 0.09)]); }
      return { kind, pm, motif, seed: 101 + i * 37, next: rnd(0.5, 6), lv: rnd(0.55, 1) };
    });
    const cuckoo = { next: rnd(8, 20), seed: 977 }, owl = { next: rnd(4, 12), seed: 433 };
    let birdsLive = 0;
    function phrase(notes, pan, level, wave, dest) {
      if (birdsLive >= 5 || !free(2)) return;
      const t0 = now() + 0.03, v = V(pan, 0, dest || birdBus); birdsLive++;
      const os = ctx.createOscillator(), eg = g(0, v.inp); if (wave) os.setPeriodicWave(wave); os.connect(eg);
      let end = t0; os.frequency.setValueAtTime(notes[0][2], t0);
      for (const n of notes) {
        const s = t0 + n[0], e = s + n[1], at = n[5] || Math.min(0.012, n[1] * 0.3), a = n[4] * level;
        os.frequency.setValueAtTime(n[2], s); os.frequency.exponentialRampToValueAtTime(n[3], e);
        eg.gain.setValueAtTime(0, s); eg.gain.linearRampToValueAtTime(a, s + at); eg.gain.linearRampToValueAtTime(a * 0.75, Math.max(s + at, e - Math.min(0.03, n[1] * 0.3))); eg.gain.linearRampToValueAtTime(0, e);
        end = Math.max(end, e);
      }
      const extra = [os, eg];
      if (wave && notes.length < 6) { const l = ctx.createOscillator(), lg = g(4); l.frequency.value = 5.5; l.connect(lg); lg.connect(os.frequency); l.start(t0); l.stop(end + 0.05); extra.push(l, lg); }
      os.start(t0); os.stop(end + 0.05);
      voices++; os.onended = () => { voices--; birdsLive--; for (const x of extra.concat([v.inp])) { try { x.disconnect(); } catch (e) { /* */ } } };
    }
    function song(sg, pan, level) {
      const j = () => 1 + (R() - 0.5) * 0.05, pm = sg.pm, N = [];
      if (sg.kind === 'warbler') { let tt = 0; const n = sg.motif.length - ((R() * 3) | 0); for (let i = 0; i < n; i++) { const m = sg.motif[i], k = j(); N.push([tt, m[2], m[0] * k, m[1] * k, 0.55 + 0.45 * R()]); tt += m[2] + rnd(0.012, 0.035); } }
      else if (sg.kind === 'whistle') { const k = j(); N.push([0, 0.3, 3900 * pm * k, 3820 * pm * k, 1], [0.38, 0.36, 3150 * pm * k, 3080 * pm * k, 0.9]); if (R() < 0.35) N.push([0.82, 0.3, 3150 * pm * k, 3060 * pm * k, 0.7]); }
      else if (sg.kind === 'trill') { const n = 12 + ((R() * 10) | 0), k = j(); for (let i = 0; i < n; i++) { const f = 4400 * pm * k * (1 - i * 0.008); N.push([i * 0.052, 0.032, f, f * 0.86, Math.sin(((i + 0.5) / n) * Math.PI) * 0.8 + 0.2]); } }
      else if (sg.kind === 'chirp') { let tt = 0; const n = 2 + ((R() * 3) | 0); for (let i = 0; i < n; i++) { const k = j(); N.push([tt, 0.055, 5200 * pm * k, 2900 * pm * k, 0.8 + 0.2 * R()]); tt += rnd(0.11, 0.22); } }
      else if (sg.kind === 'dove') { const k = pm * 0.5 + 0.5; N.push([0, 0.28, 470 * k, 520 * k, 0.6, 0.08], [0.36, 0.55, 560 * k, 470 * k, 1, 0.1], [1.0, 0.3, 470 * k, 455 * k, 0.7, 0.06], [1.42, 0.3, 470 * k, 448 * k, 0.6, 0.06]); return phrase(N, pan, level * 0.05, HOLLOW); }
      if (N.length) phrase(N, pan, level * 0.045);
    }
    function birds(t, dt) {
      const s = S(), h = fin(s.time, 12), storm = fin(s.storm, 0), rain = fin(s.rain, 0), snow = fin(s.snowing, 0), w = s.wind ? fin(s.wind.speed, 0.3) : 0.3;
      const day = sm(5.4, 6.4, h) * sm(19.2, 18.2, h), dawn = sm(4.6, 5.3, h) * sm(7.4, 6.5, h), dusk = sm(17.5, 18.1, h) * sm(19.7, 18.9, h);
      const calm = (1 - sm(0.2, 0.55, storm)) * (1 - sm(0.35, 0.75, rain)) * (1 - 0.7 * sm(0.2, 0.7, snow)) * (1 - 0.6 * sm(0.9, 1.8, w));
      const A = (0.4 * day + 1.0 * dawn + 0.4 * dusk) * calm, seasonK = U.bySeason(fin(s.season, 0), 1, 0.85, 0.5, 0.3);
      lvl.birds = A;
      const present = seasonK * (0.5 + 0.5 * sat(A / 0.8));
      for (let i = 0; i < singers.length; i++) {
        const sg = singers[i]; if (t < sg.next) continue;
        sg.next = t + rnd(4, 12) / (0.35 + A);
        if ((i + 0.5) / singers.length > present || A < 0.03 || R() > sat(A * 2)) continue;
        const p = treePos(sg.seed); song(sg, P(p.x, p.y, p.z), sg.lv * (0.6 + 0.4 * sat(A)));
      }
      const spring = U.bySeason(fin(s.season, 0), 1, 0.1, 0, 0);
      if (t >= cuckoo.next) {
        cuckoo.next = t + rnd(16, 34);
        if (R() < spring * A * 1.6) { const p = treePos(cuckoo.seed), N = [], n = 2 + ((R() * 4) | 0); for (let i = 0; i < n; i++) N.push([i * 0.78, 0.16, 690, 680, 0.85, 0.03], [i * 0.78 + 0.27, 0.32, 560, 548, 1, 0.04]); phrase(N, P(p.x, p.y, p.z), 0.05, HOLLOW); }
      }
      const owlK = sm(0.5, 0.9, fin(s.night, 0)) * U.bySeason(fin(s.season, 0), 0.3, 0.2, 1, 0.45) * (1 - sm(0.15, 0.45, rain)) * (1 - storm);
      lvl.owl = owlK;
      if (t >= owl.next) {
        owl.next = t + rnd(10, 26);
        if (R() < owlK) { const p = treePos(owl.seed + ((R() * 3) | 0)); phrase([[0, 0.5, 395, 372, 0.9, 0.07], [2.1, 0.13, 380, 400, 0.45, 0.03], [2.36, 1.15, 410, 378, 0.85, 0.09]], P(p.x, p.y, p.z), 0.06, HOLLOW); }
      }
      return dt;
    }

    /* crickets: a few persistent oscillators whose pulse trains are scheduled ahead; Dolbear's law sets the rate */
    const CPOS = [[-3.2, 0.5, 1.4], [0.6, 0.4, 0.4], [4.4, 0.4, -0.6], [-1.2, 0.6, 2.6]];
    const crickets = { list: null, quiet: 0 };
    function cricketsStep(t, dt, level, T) {
      if (level < 0.004) {
        if (crickets.list && (crickets.quiet += dt) > 4) { for (const c of crickets.list) { try { c.o.stop(); c.o.disconnect(); c.p.disconnect(); } catch (e) { /* */ } } crickets.list = null; }
        if (crickets.list) for (const c of crickets.list) { tgt(c.lv.gain, 0, 0.4); c.next = t + 0.1; }
        return;
      }
      crickets.quiet = 0;
      if (!crickets.list) crickets.list = CPOS.map((q, i) => { const o = ctx.createOscillator(), pg = g(0), lv = g(0), p = panN(0, amb); o.frequency.value = rnd(4200, 4900); o.connect(pg); pg.connect(lv); lv.connect(p); o.start(); return { o, pg, lv, p, q, next: t + R() * 0.6, rate: 1 + (i - 1.5) * 0.04, amp: rnd(0.55, 1) }; });
      const N = Math.max(40, 7 * clamp(T, 10, 36) - 30);   // chirps per minute (Dolbear, °C)
      lvl.cricketRate = N;
      for (const c of crickets.list) {
        tgt(c.lv.gain, level * c.amp * 0.028, 0.5); setPan(c.p, P(c.q[0], c.q[1], c.q[2]), 0.3);
        if (c.next < t) c.next = t + 0.02;
        while (c.next < t + 0.3) {
          const np = 3 + (R() < 0.3 ? 1 : 0);
          for (let k = 0; k < np; k++) { const s = c.next + k * 0.022; c.pg.gain.setValueAtTime(0, s); c.pg.gain.linearRampToValueAtTime(1, s + 0.003); c.pg.gain.linearRampToValueAtTime(0, s + 0.014); }
          c.next += (60 / (N * c.rate)) * (1 + (R() - 0.5) * 0.05);
        }
      }
    }

    /* frogs: croakers and peepers round the lake on mild spring nights */
    const frogs = [0, 1, 2, 3].map((i) => ({ kind: i < 2 ? 'croak' : 'peep', a: -2.4 + i * 0.95 + rnd(-0.2, 0.2), next: rnd(0.5, 3), burst: 0 }));
    function frogStep(t, fK) {
      lvl.frogs = fK;
      for (const f of frogs) {
        if (t < f.next) continue;
        if (fK < 0.03) { f.next = t + rnd(2, 5); continue; }
        if (f.burst <= 0) { if (R() > fK) { f.next = t + rnd(2, 6); continue; } f.burst = 3 + ((R() * 6) | 0); }
        f.burst--; const q = lakePt(f.a), pan = P(q.x, q.y, q.z), t0 = now() + 0.02;
        if (!free(1)) { f.next = t + 1; continue; }
        const v = V(pan, 0.15, amb);
        if (f.kind === 'croak') {
          f.next = t + (f.burst > 0 ? rnd(0.5, 1.1) : rnd(2, 6));
          const os = ctx.createOscillator(), bp = filt('bandpass', 520, 2.5), eg = g(0, v.inp); os.type = 'sawtooth'; const f0 = rnd(150, 230); os.frequency.setValueAtTime(f0, t0); os.frequency.linearRampToValueAtTime(f0 * 1.15, t0 + 0.2); os.connect(bp); bp.connect(eg);
          const np = 2 + ((R() * 2) | 0); for (let k = 0; k < np; k++) { const s = t0 + k * 0.075; eg.gain.setValueAtTime(0, s); eg.gain.linearRampToValueAtTime(0.11 * fK + 0.03, s + 0.012); eg.gain.linearRampToValueAtTime(0, s + 0.055); }
          os.start(t0); os.stop(t0 + np * 0.075 + 0.05); voices++; os.onended = () => { voices--; for (const x of [os, bp, eg, v.inp]) { try { x.disconnect(); } catch (e) { /* */ } } };
        } else {
          f.next = t + (f.burst > 0 ? rnd(0.7, 1.3) : rnd(3, 7));
          v.tone({ t: t0, f: rnd(2500, 2800), f1: rnd(3000, 3300), glide: 0.12, a: 0.025 + 0.03 * fK, att: 0.03, hold: 0.05, dec: 0.05 });
        }
      }
    }

    /* river gurgles: small bubbles, sometimes a deeper run of them */
    let gurAcc = 0, patAcc = 0;
    function gurgle(t0, k) {
      if (!free(2)) return; const q = riverPt(rnd(0.15, 0.85)), pan = P(q.x, q.y, q.z), v = V(pan, 0.2, amb), deep = R() < 0.25, n = deep ? 2 + ((R() * 3) | 0) : 1;
      for (let i = 0; i < n; i++) { const f = deep ? rnd(260, 480) : rnd(500, 1100), tt = t0 + i * rnd(0.04, 0.09); v.tone({ t: tt, f, f1: f * rnd(1.5, 2.1), glide: 0.06, a: (deep ? 0.05 : 0.03) * k, att: 0.003, dec: 0.07 }); }
    }
    let patDrops = 0;
    function patter(t0, pan, a) {
      if (patDrops > 24) return; const s = src(DROPS[(R() * DROPS.length) | 0], rnd(0.8, 1.35)), eg = g(a * rnd(0.25, 1)), p = panN(pan, patterBus);
      s.connect(eg); eg.connect(p); s.start(t0); patDrops++; s.onended = () => { patDrops--; try { s.disconnect(); eg.disconnect(); p.disconnect(); } catch (e) { /* */ } };
    }
    function rainSources() {     // where the rain is falling: the weighted pan of the raining clouds
      const list = WG.clouds && WG.clouds.list; let sw = 0, sp = 0;
      if (list) for (const c of list) { const r = fin(c.rain, 0); if (r > 0.02) { sw += r; sp += r * P(c.x, 0.4, c.z); } }
      return sw > 0 ? sp / sw : 0;
    }
    function dropPan() {
      const list = WG.clouds && WG.clouds.list;
      if (list) { let tot = 0; for (const c of list) tot += Math.max(0, fin(c.rain, 0)); let pick = R() * tot; for (const c of list) { pick -= Math.max(0, fin(c.rain, 0)); if (pick <= 0 && c.rain > 0) { const r = fin(c.R, 0.8); return P(c.x + (R() - 0.5) * 2 * r, 0.2, c.z + (R() - 0.5) * 2 * r); } } }
      return (R() - 0.5) * 1.2;
    }

    /* ------------------------------------------------------------ every frame */
    let ambAcc = 1;
    E.update = (dt) => {
      dt = clamp(fin(dt, 0.016), 0, 0.25); E.clock += dt;
      contUpdate(dt);
      ambAcc += dt; if (ambAcc < 0.05) return; const adt = Math.min(ambAcc, 0.25); ambAcc = 0;
      const s = S(), t = now(), tc = 0.25;
      const w = s.wind ? fin(s.wind.speed, 0.3) : 0.3, storm = fin(s.storm, 0), rain = fin(s.rain, 0), snow = fin(s.snowing, 0), temp = fin(s.temp, 15);
      const flow = fin(s.flow, 1), night = fin(s.night, 0), ice = fin(s.ice, 0);
      /* wind gusts: slow and fast noise per side */
      const gA = U.vnoise(E.clock * 0.33, 0.7, 41), gB = U.vnoise(E.clock * 0.29, 5.1, 43), gF = U.vnoise(E.clock * 1.6, 2.2, 44);
      const wk = sm(0.04, 1.9, w), gusts = [0.4 + 0.95 * gA * (0.75 + 0.25 * gF), 0.4 + 0.95 * gB * (0.75 + 0.25 * gF)];
      for (let i = 0; i < 2; i++) { wind[i].L.set((0.045 + 0.3 * Math.pow(wk, 0.8)) * gusts[i], tc, adt); tgt(wind[i].f.frequency, 240 + 650 * wk * gusts[i] + 140 * gF, tc); }
      windLow.set(0.16 * wk * wk * gusts[0], tc, adt);
      const lk = leafK() * sm(0.06, 0.9, w * (0.55 + 0.6 * gA)) * (1 - 0.6 * sm(0.3, 0.9, rain));
      leaves[0].L.set(0.2 * lk * (0.6 + 0.6 * gA), tc, adt); leaves[1].L.set(0.2 * lk * (0.6 + 0.6 * gB), tc, adt);
      const hk = Math.pow(storm, 1.3) * sm(0.3, 1.4, w) * (0.45 + 0.7 * gA);
      howl.set(0.55 * hk, 0.4, adt); tgt(h1.frequency, 270 + 170 * gA + 60 * gF, 0.5); tgt(h2.frequency, 430 + 260 * gB + 80 * gF, 0.5);
      lvl.wind = (0.045 + 0.3 * Math.pow(wk, 0.8)); lvl.leaves = lk; lvl.howl = hk;
      /* rain: patter alone when light, hiss as it builds, a low roar in a downpour */
      rainK = rain; rainPan = U.lerp(rainPan, rainSources(), 0.3); setPan(rainP, rainPan * 0.6, 0.3);
      hiss.set(0.17 * sm(0.08, 0.9, rain), tc, adt); rmid.set(0.11 * sm(0.03, 0.7, rain), tc, adt); roar.set((0.22 * sm(0.5, 1, rain) + 0.06 * storm * sm(0.1, 0.5, rain)), tc, adt);
      tgt(patterBus.gain, 0.3 * sm(0.004, 0.08, rain) * (1 - 0.5 * sm(0.4, 1, rain)), tc);
      const rate = rain > 0.004 ? 3 + 55 * Math.sqrt(rain) : 0;
      patAcc += rate * adt; let nd = 0;
      while (patAcc >= 1) { patAcc -= 1; if (++nd <= 12) patter(t + 0.02 + R() * adt, dropPan(), 0.5); }
      if (nd > 12) patAcc = 0;
      lvl.rain = rain; lvl.hiss = 0.17 * sm(0.08, 0.9, rain);
      hush.set(0.022 * sm(0.02, 0.6, snow) * (1 - 0.5 * sm(0.1, 0.5, rain)), 0.6, adt); lvl.snow = snow;
      /* water: waterfall and river, fuller after rain, nearly silent when frozen */
      const F = L().fall || { x: -1.5, zLip: -2.2, yTop: 2.2, yPool: 1.16 };
      const fk = (1 - 0.95 * sat(fin(s.fallIce, 0))) * (0.5 + 0.5 * sm(1, 2.3, flow));
      fall.set(0.13 * fk, 0.5, adt); setPan(fallP, P(F.x, (F.yTop + F.yPool) / 2, F.zLip), 0.2);
      const rk = (1 - 0.95 * sat(fin(s.riverIce, 0))) * (0.45 + 0.55 * sm(1, 2.3, flow));
      river.set(0.11 * rk, 0.5, adt); { const q = riverPt(0.55); setPan(riverP, P(q.x, q.y, q.z), 0.2); }
      lvl.fall = fk; lvl.river = rk;
      gurAcc += (0.5 + 2.2 * sm(1, 2.3, flow)) * rk * adt;
      while (gurAcc >= 1) { gurAcc -= 1; if (R() < 0.85) gurgle(t + 0.02 + R() * adt, rk); }
      room.set(0.014, 1, adt);
      /* life */
      birds(E.clock, adt);
      const cK = sm(0.35, 0.8, night + 0.4 * fin(s.dusk, 0)) * sm(13, 19, temp) * U.bySeason(fin(s.season, 0), 0.15, 1, 0.45, 0) * (1 - sm(0.03, 0.25, rain)) * (1 - sm(0.1, 0.4, storm)) * (1 - 0.7 * sm(0.8, 1.6, w));
      lvl.crickets = cK; cricketsStep(t, adt, cK, temp);
      const fK = sm(0.3, 0.8, night + 0.5 * fin(s.dusk, 0)) * U.bySeason(fin(s.season, 0), 1, 0.35, 0.05, 0) * sm(5, 11, temp) * (1 - ice) * (1 - 0.85 * storm) * (1 - 0.5 * sm(0.4, 0.9, rain));
      frogStep(E.clock, fK);
    };
    return E;
  }

  /* ------------------------------------------------------------ the live engine */
  let ctx = null, eng = null, dead = !AC, enabled = false, sleepT = 0;
  const soundOn = () => !(WG.api && WG.api.soundOn === false);
  const running = () => !!(eng && ctx && ctx.state === 'running');
  const armed = () => !!(eng && ctx && ctx.state !== 'closed' && soundOn());
  function start() {
    if (dead || !enabled) return false;
    try {
      if (!ctx) { try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); } }
      if (!eng) { eng = makeEngine(ctx); eng.setOn(false, true); if (soundOn()) eng.setOn(true); }
      if (soundOn() && ctx.state !== 'running' && ctx.state !== 'closed') { const p = ctx.resume(); if (p && p.catch) p.catch(() => { /* needs a gesture */ }); }
      else if (!soundOn() && ctx.state === 'running') { const p = ctx.suspend(); if (p && p.catch) p.catch(() => {}); }
      return true;
    } catch (e) { dead = true; eng = null; console.warn('[WG] audio unavailable:', e && e.message); return false; }
  }
  function setSound(on) {
    if (!eng) { if (on) start(); return; }
    clearTimeout(sleepT);
    if (on) { start(); eng.setOn(true); }
    else { eng.setOn(false); sleepT = setTimeout(() => { if (!soundOn() && ctx && ctx.state === 'running') { const p = ctx.suspend(); if (p && p.catch) p.catch(() => {}); } }, 500); }
  }
  const A = (WG.audio = {
    start,
    cont(name, level, pan) { if (eng) { try { eng.cont(name, level, pan); } catch (e) { /* */ } } },
    one(name, o) { if (armed()) { try { eng.one(name, o); } catch (e) { /* */ } } },
    get ready() { return running(); },
    get ctx() { return ctx; },
    makeEngine,
    debug: () => (eng ? eng.debug() : null),
  });
  const EVENTS = ['lightning', 'cloud:storm', 'cloud:grab', 'cloud:release', 'cloud:merge', 'cloud:pop', 'cloud:bounce', 'splash', 'drip', 'glass:tap', 'glass:wipe', 'ice:crack', 'gauge:tap', 'tree:release', 'tree:flick', 'fog:pour', 'tool', 'sun:grab', 'rainbow', 'season:arrived', 'wind:sweep'];
  const UNLOCK = ['pointerdown', 'pointerup', 'mousedown', 'keydown', 'touchend', 'click'];
  function unlock() { start(); if (dead || (eng && (running() || !soundOn()))) for (const e of UNLOCK) window.removeEventListener(e, unlock, true); }

  WG.register('audio', {
    init() {
      enabled = true;
      for (const e of UNLOCK) window.addEventListener(e, unlock, true);
      for (const name of EVENTS) WG.bus.on(name, (d) => { if (armed()) eng.event(name, d); });
      WG.bus.on('sound', (d) => setSound(d && d.on !== undefined ? !!d.on : soundOn()));
      document.addEventListener('visibilitychange', () => {
        if (!ctx || !eng) return;
        try { if (document.hidden) { if (ctx.state === 'running') ctx.suspend().catch(() => {}); } else if (soundOn()) ctx.resume().catch(() => {}); } catch (e) { /* */ }
      });
    },
    update(dt) { if (running()) eng.update(dt); },
  });
  void A;
})();
