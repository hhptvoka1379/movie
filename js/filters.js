/* Filters sheet enhancer.
   The sheet's core controls (language, time window, format, type, search) are wired
   by app.js with URL-hash sync. This module adds the date control to the sheet:
   it mirrors the day strip (#strip), keeps #fdate in sync with the hash-driven
   selected day, and commits picks through the strip so state + hash stay consistent. */
(function () {
  'use strict';

  var strip = document.getElementById('strip');
  var sel = document.getElementById('fdate');
  if (!strip || !sel) return;

  function pressedDay() {
    var b = strip.querySelector('.day[aria-pressed="true"]');
    return b ? b.getAttribute('data-day') : null;
  }

  function syncOptions() {
    var days = Array.prototype.slice.call(strip.querySelectorAll('.day'));
    if (!days.length) {
      // data not ready yet: keep the loading option
      if (!sel.querySelector('option[disabled]')) {
        sel.innerHTML = '<option disabled selected>Caricamento…</option>';
      }
      return;
    }
    var current = pressedDay() || sel.value;
    sel.innerHTML = days.map(function (b) {
      var d = b.getAttribute('data-day');
      var label = b.getAttribute('aria-label') || (b.textContent || '').replace(/\s+/g, ' ').trim();
      return '<option value="' + d + '">' + label + '</option>';
    }).join('');
    var want = days.some(function (b) { return b.getAttribute('data-day') === current; })
      ? current
      : days[0].getAttribute('data-day');
    if (sel.value !== want) sel.value = want;
  }

  // strip is (re)built after data loads: populate then
  var mo = new MutationObserver(function () { syncOptions(); });
  mo.observe(strip, { childList: true, subtree: false });
  syncOptions();

  // user picks a day in the sheet: commit through the strip button (app.js handles state + hash)
  sel.addEventListener('change', function () {
    var btn = strip.querySelector('.day[data-day="' + sel.value + '"]');
    if (btn) btn.click();
  });

  // reflect day changes that came from anywhere else (strip click, back/forward hash nav)
  var mo2 = new MutationObserver(function () {
    var d = pressedDay();
    if (d && sel.value !== d) sel.value = d;
  });
  mo2.observe(strip, { attributes: true, subtree: true, attributeFilter: ['aria-pressed'] });
  window.addEventListener('hashchange', function () {
    var d = new URLSearchParams(location.hash.replace(/^#/, '')).get('d');
    if (d && d !== sel.value) sel.value = d;
  });
})();
