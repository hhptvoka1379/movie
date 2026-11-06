/* Film panel enhancer.
   app.js renders #film-dialog with one section per day. This module replaces those
   day sections with a proper day-by-cinema grid (columns = all days in the data
   range, rows = cinemas) built from the same dataset and the same hash filters,
   so the 44px time links and the booking_url -> cinema booking_url -> website
   fallback keep working. If anything fails, app.js's day sections stay in place. */
(function () {
  'use strict';

  var dlg = document.getElementById('film-dialog');
  if (!dlg) return;

  var LANG_LABEL = { ita: 'ITA', vo: 'VO', vos: 'VOS', other: 'ALTRO' };
  var WD = ['DOM', 'LUN', 'MAR', 'MER', 'GIO', 'VEN', 'SAB'];

  function $(sel, root) { return (root || dlg).querySelector(sel); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function norm(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function priceStr(p) { return isNum(p) ? '€' + p.toFixed(2).replace('.', ',') : ''; }
  function timeHour(t) { return parseInt(String(t).slice(0, 2), 10); }
  function hashParams() { return new URLSearchParams(location.hash.replace(/^#/, '')); }
  function isSample() {
    var p = new URLSearchParams(location.search);
    return p.has('sample') && p.get('sample') !== '0';
  }
  function parts(iso) {
    var p = iso.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return {
      wd: WD[d.getUTCDay()],
      dn: p[2],
      long: d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }),
      short: d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    };
  }
  function ddmm(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7); }
  function buildDates(from, to) {
    var out = [], d = from, guard = 0;
    while (d && d <= to && guard++ < 62) {
      out.push(d);
      var p = d.split('-').map(Number);
      d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + 1)).toISOString().slice(0, 10);
    }
    return out;
  }

  var dataPromise = null;
  function loadData() {
    if (!dataPromise) {
      dataPromise = fetch(isSample() ? 'data/sample.json' : 'data/showtimes.json', { cache: 'no-cache' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .catch(function () { return null; });
    }
    return dataPromise;
  }

  function currentState() {
    if (window.CinemaApp && window.CinemaApp.getState) return window.CinemaApp.getState();
    var p = hashParams();
    return {
      l: p.get('l') || 'ita',
      t: p.get('t') || 'tutti',
      fmt: p.get('fmt') || 'tutti',
      tipo: p.get('tipo') || 'tutti',
      q: p.get('q') || '',
      film: p.get('film') || null
    };
  }

  // same filter rules as app.js (day itself is irrelevant: we show every day)
  function passes(s, film, cinema, st) {
    var l = st.l || 'ita';
    if (l === 'ita' && s.language !== 'ita') return false;
    if (l === 'vo' && s.language !== 'vo' && s.language !== 'vos') return false;
    var t = st.t || 'tutti';
    var h = timeHour(s.time);
    if (t === 'mattina') { if (!(h < 14)) return false; }
    else if (t === 'pomeriggio') { if (!(h >= 14 && h < 18)) return false; }
    else if (t === 'sera') { if (!(h >= 18)) return false; }
    var fmt = st.fmt;
    if (fmt && fmt !== 'tutti' && s.format !== fmt) return false;
    var tipo = st.tipo;
    if (tipo && tipo !== 'tutti' && film && film.type !== tipo) return false;
    var q = norm(st.q || '');
    if (q) {
      var ok = (film && (norm(film.title).indexOf(q) >= 0 || norm(film.original_title).indexOf(q) >= 0)) ||
        (cinema && norm(cinema.name).indexOf(q) >= 0);
      if (!ok) return false;
    }
    return true;
  }

  function bookingUrl(s, cinema) {
    return s.booking_url || (cinema && cinema.booking_url) || (cinema && cinema.website) || '';
  }

  function timeLi(s, cinema) {
    var url = bookingUrl(s, cinema);
    var lang = LANG_LABEL[s.language] || 'ALTRO';
    var price = priceStr(s.price_eur);
    var small = lang + (price ? ' · ' + esc(price) : '');
    var inner = '<b>' + esc(String(s.time).slice(0, 5)) + '</b><small>' + small + '</small>';
    if (/^https?:\/\//.test(url)) {
      return '<li><a class="time" href="' + esc(url) + '" target="_blank" rel="noopener">' + inner + '</a></li>';
    }
    return '<li><span class="time-plain">' + inner + '</span></li>';
  }

  function gridHTML(data, filmId) {
    var films = new Map((data.films || []).map(function (f) { return [f.id, f]; }));
    var film = films.get(filmId);
    if (!film) return null;
    var allCinemas = (data.cinemas || []).filter(function (c) { return c && c.id && c.status === 'ok'; })
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'it'); });
    var cinById = new Map(allCinemas.map(function (c) { return [c.id, c]; }));
    var range = data.range || {};
    var from = range.from, to = range.to;
    if (!from || !to) {
      var ds = (data.showings || []).map(function (s) { return s.date; }).sort();
      from = ds[0]; to = ds[ds.length - 1];
    }
    var dates = data.dates && data.dates.length ? data.dates : buildDates(from, to);
    var st = currentState();
    var shows = (data.showings || []).filter(function (s) {
      if (s.film_id !== filmId) return false;
      var sCopy = { date: s.date, time: String(s.time).slice(0, 5), language: s.language, format: s.format, price_eur: s.price_eur, booking_url: s.booking_url };
      return passes(sCopy, film, cinById.get(s.cinema_id), st);
    });
    if (!shows.length) return null; // keep app.js's empty state
    var byCin = new Map();
    shows.forEach(function (s) {
      if (!byCin.has(s.cinema_id)) byCin.set(s.cinema_id, new Map());
      var m = byCin.get(s.cinema_id);
      if (!m.has(s.date)) m.set(s.date, []);
      m.get(s.date).push(s);
    });
    byCin.forEach(function (m) {
      m.forEach(function (arr) { arr.sort(function (a, b) { return String(a.time).localeCompare(String(b.time)); }); });
    });
    var cinemas = allCinemas.filter(function (c) { return byCin.has(c.id); });

    var head = '<caption class="sr-only">Orari di ' + esc(film.title) + ' per giorno e cinema, dal ' +
      esc(ddmm(dates[0])) + ' al ' + esc(ddmm(dates[dates.length - 1])) + '</caption>' +
      '<thead><tr><th scope="col" class="fpg-corner">Cinema</th>' +
      dates.map(function (d) {
        var pt = parts(d);
        return '<th scope="col"><button type="button" class="fpg-day" data-day="' + esc(d) +
          '" aria-label="Vai al giorno ' + esc(cap(pt.long)) + '"><span class="fpg-wd">' + pt.wd +
          '</span><span class="fpg-dn">' + pt.dn + '</span></button></th>';
      }).join('') + '</tr></thead>';

    var body = '<tbody>' + cinemas.map(function (c) {
      var perDate = byCin.get(c.id);
      var cells = dates.map(function (d) {
        var arr = perDate && perDate.get(d);
        if (!arr || !arr.length) {
          return '<td class="fpg-empty" aria-label="Nessuna proiezione il ' + esc(parts(d).long) + '"><span class="fpg-none" aria-hidden="true">—</span></td>';
        }
        return '<td><ul class="times">' + arr.map(function (s) { return timeLi(s, c); }).join('') + '</ul></td>';
      }).join('');
      return '<tr><th scope="row"><button type="button" class="fpg-cin" data-c="' + esc(c.id) +
        '">' + esc(c.name) + '</button></th>' + cells + '</tr>';
    }).join('') + '</tbody>';

    var summary = '<p class="fpg-summary">' + shows.length + (shows.length === 1 ? ' spettacolo' : ' spettacoli') +
      ' · ' + esc(ddmm(dates[0])) + ' – ' + esc(ddmm(dates[dates.length - 1])) + '</p>';

    return summary +
      '<div class="fpg-scroll" tabindex="0" role="region" aria-label="Griglia orari per giorno e cinema">' +
      '<table class="fpg-table">' + head + body + '</table></div>';
  }

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  function applyGrid(container, data, filmId) {
    if (!data || !document.body.contains(container)) return;
    if ($('.fpg-scroll', container)) return;
    var html = gridHTML(data, filmId);
    if (!html) return;
    Array.prototype.slice.call(container.querySelectorAll('.dgrid-day')).forEach(function (n) { n.remove(); });
    container.insertAdjacentHTML('beforeend', html);
  }

  var enhancing = false;
  function enhance() {
    if (enhancing) return;
    var container = $('.dlg');
    if (!container) return;
    if ($('.fpg-scroll', container)) return; // already enhanced this render
    var st = currentState();
    var filmId = st.film || hashParams().get('film');
    if (!filmId) return;
    var memData = window.CinemaApp && window.CinemaApp.getData ? window.CinemaApp.getData() : null;
    if (memData) {
      applyGrid(container, memData, filmId);
      return;
    }
    enhancing = true;
    loadData().then(function (data) {
      enhancing = false;
      var nowId = currentState().film || hashParams().get('film');
      if (nowId !== filmId) return;
      applyGrid(container, data, filmId);
    }, function () {
      enhancing = false;
    });
  }

  var mo = new MutationObserver(function (mutations) {
    var relevant = mutations.some(function (m) {
      return Array.prototype.some.call(m.addedNodes, function (n) {
        return n.nodeType === 1 && (n.classList && n.classList.contains('dlg'));
      });
    });
    if (relevant) enhance();
  });
  mo.observe(dlg, { childList: true });

  // day cells in the grid act as shortcuts to the global day filter (state + hash)
  dlg.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('.fpg-day[data-day]') : null;
    if (!t) return;
    var strip = document.getElementById('strip');
    var btn = strip && strip.querySelector('.day[data-day="' + t.getAttribute('data-day') + '"]');
    if (btn) btn.click();
  });
})();
