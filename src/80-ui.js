/* Weatherglass — the interface layer: the title, the action pill, the toolbar with its tooltips, the clock and
   sun-height curve, the temperature and season dial, hints, the guided first visit, and the phone drawer.
   Everything lives in #wg-ui; it only reads WG.state and calls WG.api. */
(function () {
  'use strict';
  const WG = window.WG, U = WG.util;
  const ui = (WG.ui = WG.ui || {});
  ui.hint = ui.hint || (() => null);
  ui.isOver = ui.isOver || (() => false);

  const STILL = WG.flag('paused');
  const A = () => WG.api || {};
  const reduced = () => !!WG.reducedMotion;
  const snd = (name, o) => { try { if (WG.audio && WG.audio.one) WG.audio.one(name, o || {}); } catch (e) { /* sound is optional */ } };
  const wake = () => { try { if (WG.audio && WG.audio.start) WG.audio.start(); } catch (e) { /* ignore */ } };
  const emit = (n, d) => { try { WG.bus.emit(n, d); } catch (e) { /* ignore */ } };
  const on = (n, f) => { try { WG.bus.on(n, f); } catch (e) { /* ignore */ } };
  const store = {
    get(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };
  const animate = (el, frames, opts) => { if (!el || !el.animate || reduced() || STILL) return null; try { return el.animate(frames, opts); } catch (e) { return null; } };

  /* ------------------------------------------------------------------ icons: thin line drawings */
  const CLOUD = 'M6.8 18.5h9.7a3.8 3.8 0 0 0 .5-7.57A5.3 5.3 0 0 0 6.8 11.6a3.45 3.45 0 0 0 0 6.9z';
  const DROP = (x, y) => `M${x} ${y}c.45.6.9 1.1.9 1.65a.9.9 0 0 1-1.8 0c0-.55.45-1.05.9-1.65z`;
  const I = {
    hand: '<path d="M8 14.6V6.2a1.6 1.6 0 0 1 3.2 0V11"/><path d="M11.2 10.6V4.4a1.6 1.6 0 0 1 3.2 0v6.4"/><path d="M14.4 11V5.8a1.6 1.6 0 0 1 3.2 0v5.6"/><path d="M17.6 11.4V8.6a1.6 1.6 0 0 1 3.2 0v5.2c0 4.4-3.2 7.7-7.4 7.7h-1.3c-2.3 0-3.9-.8-5.3-2.3l-3.4-3.8a1.5 1.5 0 0 1 2.2-2.1L8 14.6"/>',
    wind: '<path d="M3.5 9h10a3 3 0 1 0-3-3"/><path d="M3.5 14h14a3 3 0 1 1-3 3"/>',
    cloud: `<path d="${CLOUD}"/><path d="M19.6 2.6v4.6M17.3 4.9h4.6"/>`,
    fog: '<path d="M3 7.5c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0 3 1.2 4.5 0"/><path d="M3 12c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0 3 1.2 4.5 0"/><path d="M3 16.5c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0 3 1.2 4.5 0"/>',
    wipe: `<rect x="3.5" y="3.5" width="17" height="17" rx="3.2"/><path d="M6.6 14.2 14.2 6.6M9.8 17.4 17.4 9.8"/><path d="${DROP(7.7, 6)}"/><path d="${DROP(16.3, 14.6)}"/>`,
    sound: '<path d="M4.6 9.6h2.8l4.1-3.4v11.6l-4.1-3.4H4.6a.9.9 0 0 1-.9-.9v-3a.9.9 0 0 1 .9-.9z"/><path d="M15 9.3a3.8 3.8 0 0 1 0 5.4"/><path d="M17.6 6.8a7.3 7.3 0 0 1 0 10.4"/>',
    mute: '<path d="M4.6 9.6h2.8l4.1-3.4v11.6l-4.1-3.4H4.6a.9.9 0 0 1-.9-.9v-3a.9.9 0 0 1 .9-.9z"/><path d="M15.6 9.6l4.8 4.8M20.4 9.6l-4.8 4.8"/>',
    full: '<path d="M4 8.6V6a2 2 0 0 1 2-2h2.6M15.4 4H18a2 2 0 0 1 2 2v2.6M20 15.4V18a2 2 0 0 1-2 2h-2.6M8.6 20H6a2 2 0 0 1-2-2v-2.6"/>',
    unfull: '<path d="M8.6 4v2.6a2 2 0 0 1-2 2H4M20 8.6h-2.6a2 2 0 0 1-2-2V4M15.4 20v-2.6a2 2 0 0 1 2-2H20M4 15.4h2.6a2 2 0 0 1 2 2V20"/>',
    eyeoff: '<path d="M3 12s3.3-5.6 9-5.6 9 5.6 9 5.6-3.3 5.6-9 5.6S3 12 3 12z"/><circle cx="12" cy="12" r="2.6"/><path d="M4.6 19.4 19.4 4.6"/>',
    eye: '<path d="M3 12s3.3-5.6 9-5.6 9 5.6 9 5.6-3.3 5.6-9 5.6S3 12 3 12z"/><circle cx="12" cy="12" r="2.6"/>',
    play: '<path class="wg-pl" fill="currentColor" stroke-width="1.6" d="M9 7.3v9.4a.75.75 0 0 0 1.15.63l7.2-4.7a.75.75 0 0 0 0-1.26l-7.2-4.7A.75.75 0 0 0 9 7.3z"/><path class="wg-pz" d="M9.4 7.2v9.6M14.6 7.2v9.6"/>',
    dial: '<circle cx="12" cy="12" r="8.2"/><path d="M12 6.6v1.5M17.4 12h-1.5M12 17.4v-1.5M6.6 12h1.5"/><circle cx="17.8" cy="6.2" r="1.5" fill="currentColor"/>',
    next: '<path d="M10 6.8 15.2 12 10 17.2"/>',
    close: '<path d="M7.4 7.4l9.2 9.2M16.6 7.4l-9.2 9.2"/>',
    tick: '<path d="M6 12.6l3.9 3.9L18 8.2"/>',
    rain: `<g transform="translate(0 -3)"><path d="${CLOUD}"/></g><path d="M8.6 18.6l-1.1 2.4M12.6 18.6l-1.1 2.4M16.6 18.6l-1.1 2.4"/>`,
    bolt: `<g transform="translate(0 -3)"><path d="${CLOUD}"/></g><path d="M12.9 16.2l-2.3 3.2h3l-2.3 3.2"/>`,
    sun: '<circle cx="12" cy="12" r="3.9"/><path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4"/>',
  };
  const ico = (name, cls) => `<svg class="wg-ico${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${I[name]}</svg>`;

  const TOOLS = [
    { id: 'hand', name: 'Hand', key: '1', alt: 'H', line: 'Grab & fling clouds · hold still to squeeze rain · shake for lightning · drag the sun' },
    { id: 'wind', name: 'Wind', key: '2', alt: 'W', line: 'Sweep across the land to blow' },
    { id: 'cloud', name: 'Cloud', key: '3', alt: 'C', line: 'Press in the sky to condense a cloud' },
    { id: 'fog', name: 'Fog', key: '4', alt: 'F', line: 'Brush mist into the valley' },
    { id: 'wipe', name: 'Wipe', key: '5', alt: 'G', line: 'Wipe condensation off the glass' },
  ];
  const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];

  /* ------------------------------------------------------------------ state of the interface */
  let root = null, built = false, compact = false, drawerOpen = false, hiddenNow = false;
  const el = {};
  const last = { t: -1, m: -1, s: -9, curveS: -9, tempV: null, phrase: null, foliage: null, playing: null, tool: null, sound: null, sx: -1, sy: -1, sunA: -1, name: null };
  const tmpV = WG.THREE ? new WG.THREE.Vector3() : { x: 0, y: 0, z: 0, set() { return this; } };
  const sunHeight = (h) => { try { return WG.world.sunDirAt(h, tmpV).y; } catch (e) { return Math.sin(((h - 6) / 12) * Math.PI) * 0.75; } };
  const fmt = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const tempText = (t) => { const v = Math.round(t) || 0; return (v < 0 ? '−' + -v : String(v)) + '°'; };

  /* ------------------------------------------------------------------ build */
  function build() {
    root = document.getElementById('wg-ui');
    if (!root) { root = document.createElement('div'); root.id = 'wg-ui'; (document.getElementById('wg-root') || document.body).appendChild(root); }
    root.classList.add('wg-pre');
    if (STILL) root.classList.add('wg-still');
    /* a software renderer redraws every backdrop blur on the CPU each frame: keep the frosted look for real GPUs and stills only */
    else if (WG.param('blur', null) !== '1' && softwareGL()) root.classList.add('wg-noblur');
    root.setAttribute('aria-label', 'Weatherglass controls');

    const toolBtns = TOOLS.map((t, i) => `<button class="wg-btn wg-tool" type="button" data-tool="${t.id}" aria-label="${t.name} tool" aria-pressed="false" aria-keyshortcuts="${t.key} ${t.alt}" aria-describedby="wgui-d-${t.id}">${ico(t.id)}<span id="wgui-d-${t.id}" hidden>${t.line}</span></button>`).join('');
    root.innerHTML = `
      <h1 class="wg-title wg-fx wg-up">Weatherglass</h1>
      <div class="wg-actions wg-panel wg-fx wg-up" role="group" aria-label="View">
        <button class="wg-btn wg-round wg-sound" type="button" aria-label="Sound" aria-pressed="true">${ico('sound', 'wg-i-on')}${ico('mute', 'wg-i-off')}<span class="wg-ring"></span><span class="wg-tag">Sound on</span></button>
        <button class="wg-btn wg-round wg-full" type="button" aria-label="Fullscreen">${ico('full', 'wg-i-on')}${ico('unfull', 'wg-i-off')}<span class="wg-ring"></span><span class="wg-tag">Fullscreen</span></button>
        <button class="wg-btn wg-round wg-hide" type="button" aria-label="Hide controls" aria-keyshortcuts="U">${ico('eyeoff')}<span class="wg-ring"></span><span class="wg-tag wg-r">Hide controls (U)</span></button>
      </div>
      <button class="wg-btn wg-round wg-reveal" type="button" aria-label="Show controls" aria-keyshortcuts="U" tabindex="-1">${ico('eye')}</button>
      <div class="wg-notes wg-fx" aria-live="polite"></div>
      <div class="wg-drawer" id="wgui-drawer">
        <div class="wg-time wg-panel wg-fx" role="group" aria-label="Time of day">
          <div class="wg-time-row">
            <button class="wg-btn wg-play" type="button" aria-label="Play time" aria-pressed="false">${ico('play')}</button>
            <span class="wg-clock" aria-hidden="true">15:14</span>
          </div>
          <div class="wg-track" role="slider" tabindex="0" aria-label="Time of day" aria-valuemin="0" aria-valuemax="1439" aria-valuenow="0">
            <span class="wg-hair"></span>
            <svg class="wg-curve" width="156" height="30" aria-hidden="true" focusable="false">
              <defs>
                <clipPath id="wgui-above"><rect class="wg-ca" x="-20" y="-20" width="200" height="36"/></clipPath>
                <clipPath id="wgui-below"><rect class="wg-cb" x="-20" y="16" width="200" height="40"/></clipPath>
                <linearGradient id="wgui-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffcf7a" stop-opacity=".34"/><stop offset="1" stop-color="#ffcf7a" stop-opacity=".02"/></linearGradient>
                <radialGradient id="wgui-glow"><stop offset="0" stop-color="#ffd98a" stop-opacity=".7"/><stop offset=".45" stop-color="#ffc062" stop-opacity=".22"/><stop offset="1" stop-color="#ffc062" stop-opacity="0"/></radialGradient>
                <radialGradient id="wgui-mglow"><stop offset="0" stop-color="#cfe0f6" stop-opacity=".45"/><stop offset="1" stop-color="#cfe0f6" stop-opacity="0"/></radialGradient>
              </defs>
              <line class="wg-hz" x1="0" x2="156" y1="16" y2="16" stroke="rgba(244,239,230,.2)" stroke-width="1"/>
              <path class="wg-ticks" d="" stroke="rgba(244,239,230,.42)" stroke-width="1" stroke-linecap="round"/>
              <path class="wg-fill" d="" fill="url(#wgui-fill)" clip-path="url(#wgui-above)"/>
              <path class="wg-lo" d="" fill="none" stroke="rgba(176,204,238,.62)" stroke-width="1.2" stroke-dasharray="1.6 3" stroke-linecap="round" clip-path="url(#wgui-below)"/>
              <path class="wg-hi" d="" fill="none" stroke="#f3c56a" stroke-width="1.5" stroke-linecap="round" clip-path="url(#wgui-above)" style="filter:drop-shadow(0 0 2px rgba(255,200,110,.55))"/>
              <g class="wg-mk"><g class="wg-mk-in">
                <g class="wg-sunmk"><circle r="10" fill="url(#wgui-glow)"/><circle r="3.3" fill="#ffe4a6"/><path d="M0-5v-1.6M0 5v1.6M-5 0h-1.6M5 0h1.6M3.55-3.55l1.1-1.1M-3.55 3.55l-1.1 1.1M3.55 3.55l1.1 1.1M-3.55-3.55l-1.1-1.1" stroke="#ffd98a" stroke-width="1.1" stroke-linecap="round"/></g>
                <g class="wg-moonmk"><circle r="8" fill="url(#wgui-mglow)"/><path d="M1.2-3.4A3.6 3.6 0 1 0 1.2 3.4 3.85 3.85 0 0 1 1.2-3.4z" fill="#e3ebf6"/></g>
              </g></g>
            </svg>
          </div>
        </div>
        <div class="wg-clim wg-panel wg-fx" role="group" aria-label="Climate">
          <div class="wg-read" aria-live="off">
            <span class="wg-temp" title="Temperature at lake level">18°</span>
            <span class="wg-phrase">sunny</span>
          </div>
          <div class="wg-dial" role="slider" tabindex="0" aria-label="Season" aria-valuemin="0" aria-valuemax="4" aria-valuenow="0">
            <div class="wg-dial-ring2"></div><div class="wg-dial-ring"></div>
            <div class="wg-dial-glow"></div>
            <svg viewBox="0 0 92 92" width="92" height="92" aria-hidden="true" focusable="false">${dialSvg()}</svg>
            <div class="wg-dial-name">Spring</div>
          </div>
        </div>
      </div>
      <div class="wg-dock wg-fx">
        <div class="wg-tools wg-panel" role="toolbar" aria-label="Tools"><span class="wg-hl"></span>${toolBtns}</div>
        <button class="wg-btn wg-drawbtn wg-panel" type="button" aria-label="Time and season" aria-expanded="false" aria-controls="wgui-drawer">${ico('dial')}</button>
      </div>
      <div class="wg-tip" role="tooltip" aria-hidden="true"><div class="wg-tip-h"><span class="wg-tip-name"></span><span class="wg-key"></span></div><div class="wg-tip-line"></div></div>`;

    const q = (s) => root.querySelector(s);
    Object.assign(el, {
      title: q('.wg-title'), actions: q('.wg-actions'), sound: q('.wg-sound'), full: q('.wg-full'), hide: q('.wg-hide'), reveal: q('.wg-reveal'),
      notes: q('.wg-notes'), drawer: q('.wg-drawer'), time: q('.wg-time'), clim: q('.wg-clim'), play: q('.wg-play'), clock: q('.wg-clock'),
      track: q('.wg-track'), curve: q('.wg-curve'), hair: q('.wg-hair'), hz: q('.wg-hz'), ticks: q('.wg-ticks'), fill: q('.wg-fill'), hi: q('.wg-hi'), lo: q('.wg-lo'),
      ca: q('.wg-ca'), cb: q('.wg-cb'), mk: q('.wg-mk'), sunmk: q('.wg-sunmk'), moonmk: q('.wg-moonmk'),
      temp: q('.wg-temp'), phrase: q('.wg-phrase'), dial: q('.wg-dial'), knob: q('.wg-knob'), dname: q('.wg-dial-name'), glow: q('.wg-dial-glow'),
      syms: Array.from(root.querySelectorAll('.wg-sym-in')), dock: q('.wg-dock'), tools: q('.wg-tools'), hl: q('.wg-hl'),
      toolBtns: Array.from(root.querySelectorAll('.wg-tool')), drawbtn: q('.wg-drawbtn'), tip: q('.wg-tip'),
    });
    el.tipName = el.tip.querySelector('.wg-tip-name'); el.tipKey = el.tip.querySelector('.wg-key'); el.tipLine = el.tip.querySelector('.wg-tip-line');
    el.fullscreenOK = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
    if (!el.fullscreenOK) el.full.hidden = true;

    wireIsolation(); wireActions(); wireTools(); wireTime(); wireDial(); wireDrawer();
    built = true;
  }

  function softwareGL() {
    try {
      const gl = WG.renderer && WG.renderer.getContext && WG.renderer.getContext(); if (!gl) return false;
      const e = gl.getExtension('WEBGL_debug_renderer_info');
      const r = String(e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      return /swiftshader|llvmpipe|software|basic render/i.test(r);
    } catch (e) { return false; }
  }

  /* the dial's ticks, the four season symbols and the brass knob, in a 92 × 92 box */
  function dialSvg() {
    const c = 46; let ticks = '';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, major = i % 3 === 0, r0 = major ? 42.6 : 43.4, r1 = 45.2, s = Math.sin(a), co = -Math.cos(a);
      ticks += `M${(c + s * r0).toFixed(2)} ${(c + co * r0).toFixed(2)}L${(c + s * r1).toFixed(2)} ${(c + co * r1).toFixed(2)}`;
    }
    let flake = '';
    for (let k = 0; k < 6; k++) flake += `<g transform="rotate(${k * 60})"><path d="M0 0V-4.4M-1.15-3.35 0-2.35 1.15-3.35"/></g>`;
    let petals = '';
    for (let k = 0; k < 5; k++) petals += `<ellipse cx="0" cy="-2.15" rx="1.4" ry="2.05" transform="rotate(${k * 72})"/>`;
    const SY = [
      `<g fill="#f6b2cb">${petals}</g><circle r=".95" fill="#fff1c6"/>`,
      '<circle r="2.15" fill="#f7c95a"/><path d="M0-3.35v-1.25M0 3.35v1.25M-3.35 0h-1.25M3.35 0h1.25M2.37-2.37l.88-.88M-2.37 2.37l-.88.88M2.37 2.37l.88.88M-2.37-2.37l-.88-.88" stroke="#f7c95a" stroke-width="1.05" stroke-linecap="round"/>',
      '<path fill="#f5953f" d="M0-4.6l1 2.3 1.6-.8-.4 2.2 2.2-.5-1 1.9.9.6-3 .7-.6 1.3-.7-.8-.7.8-.6-1.3-3-.7.9-.6-1-1.9 2.2.5-.4-2.2 1.6.8z"/><path d="M0 2.3v1.7" stroke="#f5953f" stroke-width=".95" stroke-linecap="round"/>',
      `<g stroke="#d8eaf8" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" fill="none">${flake}</g>`,
    ];
    const pos = [[0, -29], [29, 0], [0, 29], [-29, 0]];
    const syms = SY.map((s, i) => `<g class="wg-sym" transform="translate(${c + pos[i][0]} ${c + pos[i][1]})"><g class="wg-sym-in" opacity=".62">${s}</g></g>`).join('');
    return `<defs><radialGradient id="wgui-brass" cx=".36" cy=".3" r=".75"><stop offset="0" stop-color="#fff4d2"/><stop offset=".42" stop-color="#f3cb7c"/><stop offset="1" stop-color="#9c6f2a"/></radialGradient></defs>
      <path d="${ticks}" stroke="rgba(244,239,230,.3)" stroke-width="1" stroke-linecap="round"/>
      ${syms}
      <g class="wg-knob" transform="translate(46 7.2)"><circle r="4.9" cy="1" fill="rgba(0,0,0,.5)"/><circle r="4.5" fill="url(#wgui-brass)" stroke="rgba(70,46,12,.7)" stroke-width=".7"/><circle r="1.3" cx="-1.25" cy="-1.4" fill="rgba(255,255,244,.75)"/></g>`;
  }

  /* interface clicks never reach the scene behind */
  function wireIsolation() {
    const stop = (e) => { e.stopPropagation(); };
    root.addEventListener('pointerdown', (e) => { wake(); stop(e); });
    for (const t of ['click', 'dblclick', 'contextmenu', 'wheel', 'touchstart']) root.addEventListener(t, stop, { passive: t === 'touchstart' });
    root.addEventListener('keydown', (e) => {
      const k = e.key;
      if (k === 'Enter' || k === ' ' || k === 'Escape' || k.indexOf('Arrow') === 0 || k === 'Home' || k === 'End' || k === 'PageUp' || k === 'PageDown') {
        if (e.target && e.target !== document.body && root.contains(e.target)) e.stopPropagation();
      }
      if (k === 'Escape' && drawerOpen) { setDrawer(false); el.drawbtn.focus(); }
    });
  }

  /* a brief brass ring pulsing out from a button */
  function pulse(btn) {
    const r = btn.querySelector('.wg-ring'); if (!r) return;
    animate(r, [{ opacity: 0.85, transform: 'scale(.86)' }, { opacity: 0, transform: 'scale(1.8)' }], { duration: 620, easing: 'cubic-bezier(.2,.7,.3,1)' });
  }

  /* ------------------------------------------------------------------ action pill */
  function wireActions() {
    el.sound.addEventListener('click', () => {
      wake(); pulse(el.sound);
      const now = A().toggleSound ? A().toggleSound() : false;
      if (now) setTimeout(() => snd('pop', { level: 0.6 }), 40);
      syncSound();
    });
    el.full.addEventListener('click', () => { pulse(el.full); snd('pop', { level: 0.6 }); if (A().fullscreen) A().fullscreen(); });
    el.hide.addEventListener('click', () => { pulse(el.hide); snd('pop', { level: 0.5 }); if (A().toggleUI) A().toggleUI(true); else setHidden(true); });
    el.reveal.addEventListener('click', () => { snd('pop', { level: 0.5 }); if (A().toggleUI) A().toggleUI(false); else setHidden(false); });
    const fsc = () => { const f = !!(document.fullscreenElement || document.webkitFullscreenElement); el.full.classList.toggle('on', f); el.full.querySelector('.wg-i-on').style.display = f ? 'none' : ''; el.full.querySelector('.wg-i-off').style.display = f ? '' : 'none'; el.full.setAttribute('aria-label', f ? 'Exit fullscreen' : 'Fullscreen'); el.full.querySelector('.wg-tag').textContent = f ? 'Exit fullscreen' : 'Fullscreen'; };
    document.addEventListener('fullscreenchange', fsc); document.addEventListener('webkitfullscreenchange', fsc); fsc();
  }
  function syncSound() {
    const s = A().soundOn !== false; if (s === last.sound) return; last.sound = s;
    el.sound.classList.toggle('on', s); el.sound.setAttribute('aria-pressed', String(s));
    el.sound.querySelector('.wg-i-on').style.display = s ? '' : 'none'; el.sound.querySelector('.wg-i-off').style.display = s ? 'none' : '';
    el.sound.querySelector('.wg-tag').textContent = s ? 'Sound on' : 'Sound off';
  }
  function setHidden(h) {
    if (!built || h === hiddenNow) return;
    const hadFocus = root.contains(document.activeElement);
    hiddenNow = h; root.classList.toggle('wg-hidden', h);
    for (const n of [el.title, el.actions, el.notes, el.drawer, el.dock]) { try { n.inert = h; } catch (e) { /* older browsers */ } }
    el.reveal.tabIndex = h ? 0 : -1;
    hideTip(true);
    if (hadFocus) { try { (h ? el.reveal : el.hide).focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }

  /* ------------------------------------------------------------------ toolbar */
  let hlIndex = -1, tipTimer = 0, tipShownAt = 0, tipFor = null, lastPType = 'mouse';
  const touchSeen = {};
  function wireTools() {
    el.toolBtns.forEach((b, i) => {
      const t = TOOLS[i];
      b.addEventListener('pointerdown', (e) => { lastPType = e.pointerType || 'mouse'; hideTip(); clearTimeout(tipTimer); });
      b.addEventListener('click', () => {
        const api = A();
        if (api.tool !== t.id) { if (api.setTool) api.setTool(t.id); snd('tick', { level: 0.55 }); }
        else popIcon(b);
        syncTool();
        if (lastPType === 'touch' && !touchSeen[t.id]) { touchSeen[t.id] = true; hint(t.line); }
        lastPType = 'mouse';
      });
      b.addEventListener('pointerenter', (e) => { if (e.pointerType === 'touch') return; scheduleTip(b, t); });
      b.addEventListener('pointerleave', () => { clearTimeout(tipTimer); hideTip(); });
      b.addEventListener('focus', () => { let fv = false; try { fv = b.matches(':focus-visible'); } catch (e) { /* ignore */ } if (fv) showTip(b, t); });
      b.addEventListener('blur', () => hideTip());
      b.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault(); const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + TOOLS.length) % TOOLS.length; el.toolBtns[j].focus();
      });
    });
  }
  function scheduleTip(b, t) {
    clearTimeout(tipTimer);
    const quick = performance.now() - tipShownAt < 400;
    tipTimer = setTimeout(() => showTip(b, t), quick ? 0 : 520);
  }
  function showTip(b, t) {
    if (hiddenNow || !el.tip) return;
    tipFor = b;
    el.tipName.textContent = t.name; el.tipKey.textContent = t.key; el.tipLine.textContent = t.line;
    const rr = root.getBoundingClientRect(), br = b.getBoundingClientRect(), pr = el.tools.getBoundingClientRect();
    el.tip.style.left = '0px'; el.tip.classList.add('show');
    const tw = el.tip.offsetWidth, edge = 12, cx = br.left + br.width / 2 - rr.left;
    const x = U.clamp(cx - tw / 2, edge, rr.width - edge - tw);
    el.tip.style.left = x + 'px';
    el.tip.style.bottom = (rr.bottom - pr.top + 10) + 'px';
    el.tip.style.setProperty('--ax', (cx - x) + 'px');
    tipShownAt = performance.now();
    root.classList.add('wg-tipping');
  }
  function hideTip(now) {
    clearTimeout(tipTimer);
    if (!el.tip || !el.tip.classList.contains('show')) return;
    el.tip.classList.remove('show'); tipFor = null; root.classList.remove('wg-tipping');
    if (!now) tipShownAt = performance.now();
  }
  function popIcon(b) { animate(b.querySelector('.wg-ico'), [{ transform: 'scale(1)' }, { transform: 'scale(1.16)', offset: 0.4 }, { transform: 'scale(.97)', offset: 0.75 }, { transform: 'scale(1)' }], { duration: 380, easing: 'ease-out' }); }
  function placeHL(i, slide) {
    const b = el.toolBtns[i]; if (!b) return;
    const to = b.offsetLeft, from = hlIndex >= 0 && el.toolBtns[hlIndex] ? el.toolBtns[hlIndex].offsetLeft : to;
    el.hl.style.width = b.offsetWidth + 'px'; el.hl.style.height = b.offsetHeight + 'px'; el.hl.style.top = b.offsetTop + 'px';
    el.hl.style.transform = `translateX(${to}px)`;
    if (slide && from !== to) {
      const mid = from + (to - from) * 0.55;
      animate(el.hl, [
        { transform: `translateX(${from}px) scale(1, 1)` },
        { transform: `translateX(${mid}px) scale(1.2, .86)`, offset: 0.42 },
        { transform: `translateX(${to + (to - from) * 0.04}px) scale(.94, 1.05)`, offset: 0.72 },
        { transform: `translateX(${to}px) scale(1, 1)` },
      ], { duration: 430, easing: 'cubic-bezier(.3,.7,.4,1)' });
    }
    hlIndex = i;
  }
  function syncTool(force) {
    const t = A().tool || 'hand'; if (t === last.tool && !force) return;
    const first = last.tool === null; last.tool = t;
    const i = Math.max(0, TOOLS.findIndex((x) => x.id === t));
    el.toolBtns.forEach((b, j) => { b.classList.toggle('on', j === i); b.setAttribute('aria-pressed', String(j === i)); });
    placeHL(i, !first && !force);
    if (!first && !force) popIcon(el.toolBtns[i]);
    tourToolChanged(t);
  }

  /* ------------------------------------------------------------------ time panel */
  const CV = { w: 156, h: 30, hz: 15.5, amp: 17 };
  function buildCurve() {
    const w = Math.max(60, (el.track.clientWidth || 164) - 8);
    CV.w = w;
    el.curve.setAttribute('width', w); el.curve.setAttribute('height', CV.h);
    const n = 96; let d = '', pts = [];
    for (let i = 0; i <= n; i++) { const h = (i / n) * 24, x = (i / n) * w, y = CV.hz - sunHeight(h) * CV.amp; pts.push([x, y]); d += (i ? 'L' : 'M') + x.toFixed(2) + ' ' + y.toFixed(2); }
    el.hi.setAttribute('d', d); el.lo.setAttribute('d', d);
    el.fill.setAttribute('d', d + `L${w} ${CV.hz}L0 ${CV.hz}Z`);
    el.hz.setAttribute('x2', w);
    el.ca.setAttribute('width', w + 40); el.cb.setAttribute('width', w + 40);
    el.ca.setAttribute('height', CV.hz + 20); el.cb.setAttribute('y', CV.hz);
    let tk = '';
    for (const h of [6, 12, 18]) { const x = (h / 24) * w; tk += `M${x.toFixed(2)} ${CV.hz - 2.6}V${CV.hz + 2.6}`; }
    el.ticks.setAttribute('d', tk);
    last.curveS = WG.state ? WG.state.season : 0; last.sx = -1;
  }
  function placeSun(t) {
    const x = (t / 24) * CV.w, sy = sunHeight(t), y = CV.hz - sy * CV.amp;
    if (Math.abs(x - last.sx) > 0.05 || Math.abs(y - last.sy) > 0.05) { el.mk.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`); last.sx = x; last.sy = y; }
    const a = U.smooth(-0.05, 0.05, sy);
    if (Math.abs(a - last.sunA) > 0.01) { el.sunmk.setAttribute('opacity', a.toFixed(3)); el.moonmk.setAttribute('opacity', (1 - a).toFixed(3)); last.sunA = a; }
  }
  function wireTime() {
    el.play.addEventListener('click', () => { wake(); snd('pop', { level: 0.5 }); if (A().togglePlay) A().togglePlay(); syncPlay(); });
    const tr = el.track; let drag = null;
    const timeAt = (cx) => { const r = el.curve.getBoundingClientRect(); return U.wrap(((cx - r.left) / Math.max(1, r.width)) * 24, 24); };
    tr.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return; e.preventDefault();
      try { tr.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ }
      drag = { id: e.pointerId, x0: e.clientX, h0: timeAt(e.clientX), moved: false };
      tr.classList.add('drag');
    });
    tr.addEventListener('pointermove', (e) => {
      const r = el.curve.getBoundingClientRect();
      el.hair.style.transform = `translateX(${U.clamp(e.clientX - tr.getBoundingClientRect().left, 4, r.width + 4)}px)`;
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x0;
      if (!drag.moved && Math.abs(dx) > 3) drag.moved = true;
      if (drag.moved) {
        const h = U.wrap(drag.h0 + (dx / Math.max(1, r.width)) * 24, 24);
        if (A().setTime) A().setTime(h, false);
        emit('time:scrub', { time: h });
      }
    });
    const end = (e) => {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      if (!drag.moved && e && e.type === 'pointerup') { if (A().setTime) A().setTime(drag.h0, true); emit('time:scrub', { time: drag.h0, glide: true }); }
      drag = null; tr.classList.remove('drag');
    };
    tr.addEventListener('pointerup', end); tr.addEventListener('pointercancel', end); tr.addEventListener('lostpointercapture', end);
    tr.addEventListener('wheel', (e) => {
      e.preventDefault();
      const d = (e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY) + (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0);
      const dh = U.clamp(-d / 100, -1.5, 1.5) * 0.25;
      if (A().nudgeTime) A().nudgeTime(dh);
      emit('time:scrub', { time: WG.state.time });
    }, { passive: false });
    tr.addEventListener('keydown', (e) => {
      const S = WG.state; let goal = null, glide = false;
      const step = e.shiftKey ? 1 : 0.25, snap = (v) => Math.round(v / 0.25) * 0.25;
      switch (e.key) {
        case 'ArrowRight': case 'ArrowUp': goal = snap(S.time + step); break;
        case 'ArrowLeft': case 'ArrowDown': goal = snap(S.time - step); break;
        case 'PageUp': goal = snap(S.time + 1); break;
        case 'PageDown': goal = snap(S.time - 1); break;
        case 'Home': goal = 0; glide = true; break;
        case 'End': goal = 23 + 59 / 60; glide = true; break;
        case ' ': case 'Enter': if (A().togglePlay) A().togglePlay(); syncPlay(); e.preventDefault(); return;
        default: return;
      }
      e.preventDefault();
      if (A().setTime) A().setTime(goal, glide);
      emit('time:scrub', { time: U.wrap(goal, 24), key: true });
    });
  }
  function syncPlay() {
    const p = !!(WG.state && WG.state.playing); if (p === last.playing) return; last.playing = p;
    el.play.classList.toggle('on', p); el.play.setAttribute('aria-pressed', String(p)); el.play.setAttribute('aria-label', p ? 'Pause time' : 'Play time');
  }

  /* ------------------------------------------------------------------ season dial */
  const SYM = [[0, -29], [29, 0], [0, 29], [-29, 0]];
  function seasonTinks(a, b) { if (Math.floor(a) !== Math.floor(b)) snd('tink', { level: 0.32 }); }
  function wireDial() {
    const d = el.dial; let drag = null;
    const geo = (e) => { const r = d.getBoundingClientRect(), k = r.width / 92, x = (e.clientX - r.left) / k - 46, y = (e.clientY - r.top) / k - 46; return { x, y, r: Math.hypot(x, y), a: Math.atan2(x, -y) }; };
    const region = (g) => {
      if (g.r < 19) return { kind: 'centre' };
      for (let i = 0; i < 4; i++) if (Math.hypot(g.x - SYM[i][0], g.y - SYM[i][1]) < 8.5) return { kind: 'sym', i };
      return { kind: 'ring' };
    };
    d.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return; e.preventDefault();
      try { d.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ }
      const g = geo(e);
      drag = { id: e.pointerId, g0: g, prevA: g.a, acc: 0, s0: WG.state.season, moved: false, reg: region(g), x0: e.clientX, y0: e.clientY };
    });
    d.addEventListener('pointermove', (e) => {
      const g = geo(e);
      if (!drag) { const rg = region(g); d.classList.toggle('over-c', rg.kind !== 'ring'); return; }
      if (e.pointerId !== drag.id) return;
      if (g.r > 6) { drag.acc += U.cyc(drag.prevA, g.a, Math.PI * 2); drag.prevA = g.a; }
      if (!drag.moved && (Math.abs(drag.acc) > 0.12 || Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 6)) { drag.moved = true; d.classList.add('drag'); }
      if (drag.moved) {
        const prev = WG.state.season, raw = drag.s0 + drag.acc / (Math.PI / 2);
        const prevRaw = drag.lastRaw !== undefined ? drag.lastRaw : drag.s0;
        if (A().setSeason) A().setSeason(raw, false);
        seasonTinks(prevRaw, raw); drag.lastRaw = raw;
        if (Math.abs(prev - WG.state.season) > 1e-5) emit('season:turn', { season: WG.state.season });
      }
    });
    const end = (e) => {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      const dr = drag; drag = null; d.classList.remove('drag');
      if (dr.moved || !e || e.type !== 'pointerup') return;
      const api = A();
      if (dr.reg.kind === 'centre') { if (api.nextSeason) api.nextSeason(); snd('chime', { level: 0.5 }); }
      else if (dr.reg.kind === 'sym') { if (api.setSeason) api.setSeason(dr.reg.i, true); snd('chime', { level: 0.5 }); }
      else { const s = U.wrap(dr.g0.a / (Math.PI / 2), 4); if (api.setSeason) api.setSeason(s, true); snd('tink', { level: 0.4 }); }
      emit('season:turn', { season: WG.state.season, glide: true });
    };
    d.addEventListener('pointerup', end); d.addEventListener('pointercancel', end); d.addEventListener('lostpointercapture', end);
    d.addEventListener('pointerleave', () => { if (!drag) d.classList.remove('over-c'); });
    d.addEventListener('wheel', (e) => {
      e.preventDefault();
      const dy = (e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY) + (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0);
      const ds = U.clamp(-dy / 100, -1.5, 1.5) * 0.08, s0 = WG.state.season;
      if (A().nudgeSeason) A().nudgeSeason(ds);
      seasonTinks(s0, s0 + ds); emit('season:turn', { season: WG.state.season });
    }, { passive: false });
    d.addEventListener('keydown', (e) => {
      const api = A(), s = WG.state.season; let glideTo = null, nudge = 0;
      switch (e.key) {
        case 'ArrowRight': case 'ArrowUp': nudge = e.shiftKey ? 0.25 : 0.1; break;
        case 'ArrowLeft': case 'ArrowDown': nudge = e.shiftKey ? -0.25 : -0.1; break;
        case 'PageUp': case 'Enter': case ' ': glideTo = Math.round(s) + 1; break;
        case 'PageDown': glideTo = Math.round(s) - 1; break;
        case 'Home': glideTo = 0; break;
        case 'End': glideTo = 3; break;
        default: return;
      }
      e.preventDefault();
      if (nudge) { if (api.nudgeSeason) api.nudgeSeason(nudge); seasonTinks(s, s + nudge); }
      else { if (api.setSeason) api.setSeason(glideTo, true); snd('chime', { level: 0.45 }); }
      emit('season:turn', { season: WG.state.season, key: true });
    });
  }
  function seasonText(s) {
    const n = Math.round(s), off = s - n, name = SEASONS[((n % 4) + 4) % 4];
    if (Math.abs(off) < 0.15) return name;
    return (off < 0 ? 'Early ' : 'Late ') + name.toLowerCase();
  }
  function placeDial(s) {
    const a = (s / 4) * Math.PI * 2, r = 38.8, x = 46 + Math.sin(a) * r, y = 46 - Math.cos(a) * r;
    el.knob.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
    for (let i = 0; i < 4; i++) {
      const k = U.smooth(0.85, 0, Math.abs(U.cyc(s, i, 4)));
      el.syms[i].setAttribute('opacity', (0.62 + 0.38 * k).toFixed(3));
      el.syms[i].setAttribute('transform', `scale(${(1 + 0.24 * k).toFixed(3)})`);
    }
    el.dial.setAttribute('aria-valuenow', s.toFixed(2));
    el.dial.setAttribute('aria-valuetext', seasonText(s));
  }

  /* ------------------------------------------------------------------ phone drawer */
  function wireDrawer() {
    el.drawbtn.addEventListener('click', () => { snd('pop', { level: 0.5 }); setDrawer(!drawerOpen); });
  }
  function setDrawer(open) {
    drawerOpen = !!open && compact;
    el.drawer.classList.toggle('open', drawerOpen);
    el.drawbtn.setAttribute('aria-expanded', String(drawerOpen));
    try { el.drawer.inert = compact && !drawerOpen; } catch (e) { /* ignore */ }
    if (drawerOpen) requestAnimationFrame(buildCurve);
    tourBeckon();
  }
  function layout() {
    if (!built) return;
    const w = root.clientWidth || window.innerWidth, h = root.clientHeight || window.innerHeight;
    const c = w < 680 || h < 470;
    if (c !== compact) {
      compact = c; root.classList.toggle('wg-compact', c);
      if (!c) { drawerOpen = false; el.drawer.classList.remove('open'); try { el.drawer.inert = false; } catch (e) { /* ignore */ } }
      else setDrawer(drawerOpen);
    }
    buildCurve(); placeHL(Math.max(0, hlIndex), false); hideTip(true);
    if (WG.state) placeSun(WG.state.time);
    tourBeckon();
  }

  /* ------------------------------------------------------------------ hints */
  const hints = [];
  function hint(text, opts) {
    if (!built || !el.notes) return null;
    text = String(text || '').trim(); if (!text) return null;
    opts = opts || {};
    for (const h of hints) if (h.text === text && !h.gone) { clearTimeout(h.timer); h.timer = setTimeout(() => dropHint(h), h.life); return h.el; }
    const live = hints.filter((h) => !h.gone);
    while (live.length >= 3) dropHint(live.shift(), true);
    const n = document.createElement('div');
    n.className = 'wg-hint wg-panel'; n.textContent = text; n.title = 'Dismiss';
    el.notes.appendChild(n);
    const h = { text, el: n, gone: false, life: opts.life || 4200 + Math.min(3000, text.length * 35) };
    animate(n, [{ opacity: 0, transform: compact ? 'translateY(-8px) scale(.96)' : 'translateY(10px) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 480, easing: 'cubic-bezier(.34,1.4,.64,1)' });
    n.addEventListener('click', () => dropHint(h));
    h.timer = setTimeout(() => dropHint(h), h.life);
    hints.push(h);
    return n;
  }
  function dropHint(h, fast) {
    if (!h || h.gone) return; h.gone = true; clearTimeout(h.timer);
    const done = () => { if (h.el.parentNode) h.el.parentNode.removeChild(h.el); const i = hints.indexOf(h); if (i >= 0) hints.splice(i, 1); };
    const an = animate(h.el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: compact ? 'translateY(-6px) scale(.98)' : 'translateY(-6px) scale(.98)' }], { duration: fast ? 160 : 380, easing: 'ease-in', fill: 'forwards' });
    if (an) an.onfinish = done; else done();
  }

  /* ------------------------------------------------------------------ the guided first visit */
  const KEY = 'weatherglass-opus55.tour.v1';   /* namespaced: several Weatherglass builds share the todsawat.github.io origin */
  const TIPS = [
    { id: 'drag', icon: 'hand', text: 'Grab a cloud and drag it across the sky' },
    { id: 'rain', icon: 'rain', text: 'Hold still on a cloud to squeeze out rain' },
    { id: 'storm', icon: 'bolt', text: 'Shake a cloud hard to build a storm' },
    { id: 'wind', icon: 'wind', text: 'Pick the Wind tool and sweep across the meadow', alt: 'Now sweep across the meadow', target: 'wind' },
    { id: 'sun', icon: 'sun', text: 'Drag the sun to change the time of day' },
    { id: 'season', icon: 'dial', text: 'Turn the season dial', target: 'dial' },
  ];
  const tour = { el: null, cur: -1, done: new Set(), active: false, finished: false, busy: false, final: false, timer: 0 };
  function loadTour() {
    let o = null; try { o = JSON.parse(store.get(KEY) || 'null'); } catch (e) { o = null; }
    if (o && Array.isArray(o.done)) for (const d of o.done) tour.done.add(d);
    tour.finished = !!(o && o.finished);
  }
  function saveTour() { store.set(KEY, JSON.stringify({ done: Array.from(tour.done), finished: tour.finished })); }
  function tourMark(id) {
    if (tour.done.has(id)) return;
    tour.done.add(id); if (!tour.finished) saveTour();
    if (!tour.active || tour.final) return;
    const t = TIPS[tour.cur];
    if (t && t.id === id && !tour.busy) completeTip();
    else renderDots();
  }
  function buildTour() {
    const n = document.createElement('div');
    n.className = 'wg-tour wg-panel'; n.setAttribute('role', 'group'); n.setAttribute('aria-label', 'Tips');
    n.innerHTML = `<span class="wg-tour-ico" aria-hidden="true"></span><div class="wg-tour-body"><div class="wg-tour-text"></div><div class="wg-dots" aria-hidden="true">${'<i></i>'.repeat(TIPS.length)}</div></div>
      <button class="wg-btn wg-mini wg-tnext" type="button" aria-label="Next tip">${ico('next')}</button><button class="wg-btn wg-mini wg-tclose" type="button" aria-label="Dismiss tips">${ico('close')}</button>`;
    n.querySelector('.wg-tnext').addEventListener('click', () => { snd('tick', { level: 0.4 }); if (tour.final) endTour(); else advance(true); });
    n.querySelector('.wg-tclose').addEventListener('click', () => { snd('pop', { level: 0.4 }); endTour(); });
    tour.el = n; tour.ico = n.querySelector('.wg-tour-ico'); tour.text = n.querySelector('.wg-tour-text'); tour.dots = Array.from(n.querySelectorAll('.wg-dots i'));
    tour.nextBtn = n.querySelector('.wg-tnext');
    el.notes.insertBefore(n, el.notes.firstChild);
  }
  function startTour(force) {
    if (!built || tour.active) return;
    if (force) { tour.finished = false; if (force === 'reset') tour.done.clear(); }
    if (tour.finished) return;
    if (hiddenNow) { clearTimeout(tour.timer); tour.timer = setTimeout(() => startTour(force), 1500); return; }
    if (!tour.el) buildTour();
    tour.active = true; tour.final = false; tour.cur = -1;
    animate(tour.el, [{ opacity: 0, transform: compact ? 'translateY(-10px) scale(.95)' : 'translateY(14px) scale(.95)' }, { opacity: 1, transform: 'none' }], { duration: 620, easing: 'cubic-bezier(.34,1.45,.64,1)' });
    advance(false, true);
  }
  function setTourText(txt, iconName, doneIcon) {
    const apply = () => { tour.text.textContent = txt; tour.ico.innerHTML = ico(iconName); tour.ico.classList.toggle('done', !!doneIcon); };
    if (!tour.text.textContent || STILL || reduced()) { apply(); return; }
    tour.text.classList.add('swap');
    setTimeout(() => { apply(); tour.text.classList.remove('swap'); animate(tour.ico, [{ transform: 'scale(.7)', opacity: 0.4 }, { transform: 'scale(1.08)', offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }], { duration: 420, easing: 'ease-out' }); }, 150);
  }
  function renderDots() {
    tour.dots.forEach((d, i) => { d.classList.toggle('done', tour.done.has(TIPS[i].id) || (tour.final && false)); d.classList.toggle('cur', i === tour.cur && !tour.final); });
  }
  function tipText(t) { return t.target === 'wind' && (A().tool === 'wind') ? t.alt : t.text; }
  function advance(manual, first) {
    let i = tour.cur + 1;
    while (i < TIPS.length && tour.done.has(TIPS[i].id)) i++;
    if (i >= TIPS.length) { showFinal(); return; }
    tour.cur = i; const t = TIPS[i];
    setTourText(tipText(t), t.icon);
    renderDots(); tourBeckon();
    if (manual && first === undefined) { /* the user skipped ahead */ }
  }
  function completeTip() {
    tour.busy = true;
    tour.ico.innerHTML = ico('tick'); tour.ico.classList.add('done');
    animate(tour.ico, [{ transform: 'scale(.8)' }, { transform: 'scale(1.18)', offset: 0.5 }, { transform: 'scale(1)' }], { duration: 460, easing: 'ease-out' });
    renderDots(); clearBeckon();
    snd('tick', { level: 0.5 }); setTimeout(() => snd('chime', { level: 0.55 }), 110);
    setTimeout(() => { tour.busy = false; if (tour.active && !tour.final) advance(false); }, STILL ? 0 : 1500);
  }
  function showFinal() {
    tour.final = true; tour.cur = TIPS.length; clearBeckon();
    const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches;
    setTourText(touch ? 'That’s the whole glass — tap the eye to hide the controls' : 'That’s the whole glass — press U to hide the controls', 'eyeoff', false);
    tour.nextBtn.setAttribute('aria-label', 'Close tips');
    renderDots();
    tour.finished = true; saveTour();
    clearTimeout(tour.timer); tour.timer = setTimeout(endTour, 9000);
  }
  function endTour() {
    if (!tour.el || !tour.active) return;
    tour.active = false; tour.finished = true; saveTour(); clearBeckon(); clearTimeout(tour.timer);
    const n = tour.el;
    const an = animate(n, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(6px) scale(.97)' }], { duration: 320, easing: 'ease-in', fill: 'forwards' });
    const rm = () => { if (n.parentNode) n.parentNode.removeChild(n); if (tour.el === n) tour.el = null; };
    if (an) an.onfinish = rm; else rm();
  }
  function clearBeckon() { for (const n of root.querySelectorAll('.wg-beckon')) n.classList.remove('wg-beckon'); }
  function tourBeckon() {
    if (!built) return;
    clearBeckon();
    if (!tour.active || tour.final || tour.busy) return;
    const t = TIPS[tour.cur]; if (!t || !t.target) return;
    if (t.target === 'wind' && A().tool !== 'wind') el.toolBtns[1].classList.add('wg-beckon');
    if (t.target === 'dial') (compact && !drawerOpen ? el.drawbtn : el.dial).classList.add('wg-beckon');
  }
  function tourToolChanged() {
    if (!tour.active || tour.final || tour.busy) return;
    const t = TIPS[tour.cur]; if (!t || t.target !== 'wind') return;
    const want = tipText(t); if (tour.text.textContent !== want) setTourText(want, t.icon);
    tourBeckon();
  }
  function wireTourEvents() {
    on('cloud:dragged', () => tourMark('drag'));
    on('cloud:rain', () => tourMark('rain'));
    on('cloud:strike', () => { if (WG.clouds && WG.clouds.held) tourMark('storm'); });
    on('wind:sweep', () => tourMark('wind'));
    on('sun:drag', () => tourMark('sun'));
    on('season:turn', () => tourMark('season'));
  }

  /* ------------------------------------------------------------------ live readouts (touch the DOM only when something changes) */
  function update() {
    if (!built) return;
    const S = WG.state; if (!S) return;
    if (Math.abs(S.season - last.curveS) > 0.01) buildCurve();
    if (S.time !== last.t || last.sx < 0) {
      last.t = S.time;
      const m = Math.floor(S.time * 60 + 1e-6) % 1440;
      if (m !== last.m) { last.m = m; const s = fmt(m); el.clock.textContent = s; el.track.setAttribute('aria-valuenow', m); el.track.setAttribute('aria-valuetext', s); }
      placeSun(S.time);
    }
    if (Math.abs(S.season - last.s) > 1e-4) { last.s = S.season; placeDial(S.season); }
    if (S.seasonName !== last.name) {
      const first = last.name === null; last.name = S.seasonName;
      if (first || STILL || reduced()) el.dname.textContent = S.seasonName;
      else { el.dname.classList.add('swap'); setTimeout(() => { el.dname.textContent = WG.state.seasonName; el.dname.classList.remove('swap'); }, 110); }
    }
    const tv = tempText(S.temp); if (tv !== last.tempV) { last.tempV = tv; el.temp.textContent = tv; }
    if (S.phrase !== last.phrase) {
      const first = last.phrase === null; last.phrase = S.phrase;
      if (first || STILL || reduced()) el.phrase.textContent = S.phrase;
      else { el.phrase.classList.add('swap'); setTimeout(() => { el.phrase.textContent = WG.state.phrase; el.phrase.classList.remove('swap'); }, 130); }
    }
    if (S.foliage !== last.foliage) { last.foliage = S.foliage; el.dial.style.setProperty('--fol', S.foliage); }
    syncPlay(); syncSound(); syncTool();
    const h = !!A().uiHidden; if (h !== hiddenNow) setHidden(h);
  }

  /* ------------------------------------------------------------------ public */
  ui.hint = (text, opts) => hint(text, opts);
  ui.isOver = (x, y) => {
    if (!built) return false;
    const n = document.elementFromPoint(x, y);
    return !!(n && n !== root && root.contains(n));
  };
  ui.drawer = (open) => { setDrawer(open === undefined ? !drawerOpen : open); return drawerOpen; };
  ui.tour = { start: (force) => startTour(force === undefined ? true : force), end: () => endTour(), mark: (id) => tourMark(id), get state() { return { active: tour.active, cur: tour.cur, final: tour.final, done: Array.from(tour.done) }; } };
  Object.defineProperty(ui, 'compact', { get: () => compact, configurable: true });

  WG.register('ui', {
    init() {
      build();
      loadTour(); wireTourEvents();
      layout(); syncTool(true); update();
      on('resize', layout);
      window.addEventListener('resize', () => requestAnimationFrame(layout));
      on('tool', () => syncTool());
      on('sound', () => syncSound());
      on('play', () => syncPlay());
      on('ui:hidden', (d) => setHidden(d && d.hidden !== undefined ? !!d.hidden : !!A().uiHidden));
      const once = {};
      const hintOnce = (k, text) => { if (once[k]) return; once[k] = true; hint(text); };
      on('sun:hover', () => hintOnce('sun', 'Drag the sun to change the time of day'));
      on('moon:hover', () => hintOnce('moon', 'Drag the moon to turn the night'));
      on('glass:wipe', (d) => { if (d && d.first) hintOnce('wipe', 'Wiped glass slowly mists back over'); });
      const reveal = () => { root.classList.remove('wg-pre'); };
      if (STILL) reveal(); else on('ready', () => setTimeout(reveal, 420));
      const wantTour = WG.param('tour', null);
      if (STILL) { if (wantTour && wantTour !== '0') startTour(wantTour === 'reset' ? 'reset' : true); }
      else if (wantTour !== '0') on('ready', () => { tour.timer = setTimeout(() => startTour(wantTour ? (wantTour === 'reset' ? 'reset' : true) : false), 3600); });
    },
    update,
  });
})();
