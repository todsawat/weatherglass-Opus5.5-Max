/* Weatherglass — start-up and the frame loop */
(function () {
  'use strict';
  const WG = window.WG, U = WG.util;
  const loading = document.getElementById('wg-loading'), note = document.getElementById('wg-loading-note');
  const paused = WG.flag('paused');
  let last = 0, running = false, hidden = false;

  function tick(now) {
    if (!running) return;
    requestAnimationFrame(tick);
    if (hidden) { last = now; return; }
    const raw = (now - last) / 1000; last = now;
    const dt = Math.min(Math.max(raw, 0.001), 0.05);
    WG.time += dt;
    WG.updateModules(dt, WG.time);
    try { WG.render.frame(); } catch (e) { if (!tick.failed) { tick.failed = true; WG.fail('frame', e); } }
    WG.render.adapt(raw * 1000);
  }

  /* for checking the look without waiting in real time: advance the weather, then draw one frame */
  WG.debug = {
    step(seconds, dt) { dt = dt || 1 / 30; const n = Math.max(1, Math.round(seconds / dt)); for (let i = 0; i < n; i++) { WG.time += dt; WG.updateModules(dt, WG.time); } },
    frame() { WG.render.frame(); },
    cam(az, el, zoom, tx, ty, tz) { WG.cam.set(az, el, zoom, tx, ty, tz); },
    errors: () => WG.errors.slice(),
  };

  function boot() {
    if (WG.noGL || !WG.render || !WG.render.frame) {
      note.textContent = 'This needs a browser with WebGL 2. It could not start the 3D view here.'; note.style.animation = 'none'; note.style.letterSpacing = '0.08em'; note.style.textTransform = 'none';
      return;
    }
    WG.initModules();
    WG.updateModules(1 / 60, 0);
    /* compile every shader now, behind the loading screen, so the first lightning or snowfall does not stutter */
    try {
      const hiddenList = [];
      WG.scene.traverse((o) => { if (!o.visible) { hiddenList.push(o); o.visible = true; } });
      const cam = WG.camera, mask = cam.layers.mask; cam.layers.enableAll();
      WG.renderer.compile(WG.scene, cam);
      cam.layers.mask = mask; for (const o of hiddenList) o.visible = false;
    } catch (e) { WG.fail('precompile', e); }
    try { WG.render.frame(); } catch (e) { WG.fail('first frame', e); }
    WG.ready = true;
    WG.bus.emit('ready', {});
    if (paused) loading.hidden = true; else { loading.classList.add('wg-done'); setTimeout(() => { loading.hidden = true; }, 1700); }
    if (!paused) { running = true; last = performance.now(); requestAnimationFrame(tick); }
  }
  document.addEventListener('visibilitychange', () => { hidden = document.hidden; });
  /* let the loading screen paint once before the heavy start-up work */
  requestAnimationFrame(() => setTimeout(boot, 30));
})();
