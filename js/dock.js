/* Mobile dock: drag handle that actually drags + snaps between collapsed and open.
   Visual layer only — app.js owns state (S.dock) and toggles it on pointerup;
   this module drives the sheet's transform during the drag and disables the
   CSS transition while the finger is down so the sheet tracks 1:1, then the
   snap back to the committed state happens via the CSS transition.
   The carousel of film cards (peek + scroll-snap) is pure CSS (css/panels.css). */
(function () {
  'use strict';

  var dock = document.getElementById('dock');
  var handle = document.getElementById('dock-handle');
  if (!dock || !handle) return;

  var COLLAPSED_H = 56;      // must match .dock.is-collapsed height in css/panels.css
  var startY = null;
  var lastDy = 0;
  var pointerId = null;

  function isDesktop() {
    return window.matchMedia('(min-width: 900px)').matches;
  }
  function openHeight() {
    return Math.max(Math.round(window.innerHeight * 0.38), 248);
  }
  function collapsed() {
    return dock.classList.contains('is-collapsed');
  }

  handle.addEventListener('pointerdown', function (e) {
    if (isDesktop()) return; // panel is always visible on desktop
    startY = e.clientY;
    lastDy = 0;
    pointerId = e.pointerId;
    dock.classList.add('is-dragging');
    try { handle.setPointerCapture(pointerId); } catch (err) { /* older engines */ }
  });

  handle.addEventListener('pointermove', function (e) {
    if (startY === null) return;
    var dy = e.clientY - startY;
    var travel = openHeight() - COLLAPSED_H;
    var clamped;
    if (collapsed()) {
      // collapsed: only upward drag moves the sheet; downward gets resistance
      clamped = dy < 0 ? Math.max(dy, -travel) : dy * 0.15;
    } else {
      // open: only downward drag moves the sheet; upward gets resistance
      clamped = dy > 0 ? Math.min(dy, travel) : dy * 0.15;
    }
    lastDy = clamped;
    dock.style.transform = 'translateY(' + clamped + 'px)';
  });

  function endDrag() {
    if (startY === null) return;
    startY = null;
    lastDy = 0;
    pointerId = null;
    dock.classList.remove('is-dragging');
    dock.style.transform = '';
  }

  // app.js runs its pointerup before this one (registered earlier): it commits
  // the state flip on a decisive drag; we then clear the visual offset so the
  // CSS transition snaps the sheet to the committed position.
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);

  // if the viewport crosses into desktop layout, drop any stale inline transform
  window.addEventListener('resize', function () {
    if (isDesktop()) {
      dock.classList.remove('is-dragging');
      dock.style.transform = '';
      startY = null;
    }
  });
})();
