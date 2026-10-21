/* Weatherglass — which build this is: a small link under the title to the source repository */
(function () {
  'use strict';
  const WG = window.WG;
  const INFO = (WG.buildInfo = {
    model: 'Claude Opus 5.5', effort: 'Max effort', label: 'Claude Opus 5.5 · Max effort',
    repo: 'https://github.com/todsawat/weatherglass-Opus5.5-Max',
  });
  WG.register('build', {
    init() {
      const ui = document.getElementById('wg-ui'); if (!ui) return;
      const a = document.createElement('a');
      a.className = 'wg-build wg-fx wg-up'; a.href = INFO.repo; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = INFO.label; a.title = 'This build: ' + INFO.label + ' — source on GitHub';
      a.setAttribute('aria-label', 'This build: ' + INFO.label + '. Opens the source on GitHub');
      ui.appendChild(a);
      try { console.info('[Weatherglass]', INFO.label); } catch (e) { /* no console */ }
    },
  });
})();
