/* Cinema Milano - mappa degli orari. Static, no build step.
   Data: data/showtimes.json (or data/sample.json with ?sample=1).
   Optional: data/posters.json maps film_id -> { file }. */
(function () {
  'use strict';

  var CENTER = [45.4641, 9.1919];   // Duomo
  var ZOOM = 13;
  var PIN_W = 140, PIN_H = 84, DOT_R = 7;
  var PALETTE = ['#F2C14E', '#8FB8A8', '#E38B6F', '#A9C6E8', '#D8B4D9', '#C9D8A0', '#F4A6A0', '#D9C8A3'];
  var WD = ['DOM', 'LUN', 'MAR', 'MER', 'GIO', 'VEN', 'SAB'];
  var MESI = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];
  var LANG_LABEL = { ita: 'ITA', vo: 'VO', vos: 'VOS', other: 'ALTRO' };
  var TYPE_LABEL = { film: 'Film', event: 'Evento', classic: 'Classico' };
  var ARROWS = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];
  var TMDB_NOTE = 'Poster: This product uses the TMDB API but is not endorsed or certified by TMDB.';
  var OSM_NOTE = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
  var TIME_LABEL = { tutti: 'tutti gli orari', mattina: 'mattina', pomeriggio: 'pomeriggio', sera: 'sera' };

  // ---- state -------------------------------------------------------------
  var S = { d: null, l: 'ita', t: 'tutti', fmt: 'tutti', tipo: 'tutti', q: '', c: null, film: null, v: 'mappa', dock: false };
  var DATA = null;          // prepared dataset
  var POSTERS = {};
  var SAMPLE = false;
  var LOAD_STATE = 'loading'; // loading | ready | error
  var LAST_IDX = { list: [], byCinema: new Map() };
  var FILTERS_OPEN = false;
  var map = null, cluster = null, attrib = null;
  var dragY = null, dragged = false;

  // ---- helpers -----------------------------------------------------------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function uniq(a) { return Array.prototype.slice.call(new Set(a)); }
  function isDesktop() { return window.matchMedia('(min-width: 900px)').matches; }
  function canHover() { return window.matchMedia('(hover: hover) and (min-width: 900px)').matches; }
  function hashStr(s) { var h = 5381; for (var i = 0; i < s.length; i++) { h = ((h << 5) + h + s.charCodeAt(i)) | 0; } return Math.abs(h); }
  function colorFor(id) { return PALETTE[hashStr(String(id)) % PALETTE.length]; }
  function priceStr(p) { return isNum(p) ? '€' + p.toFixed(2).replace('.', ',') : ''; }
  function ddmm(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7); }
  function todayISO() { var t = new Date(); return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate()); }
  function nowHHMM() { var n = new Date(); return pad(n.getHours()) + ':' + pad(n.getMinutes()); }
  function timeHour(t) { return parseInt(String(t).slice(0, 2), 10); }
  function addDays(iso, n) {
    var p = iso.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
  }
  function wdOf(iso) { var p = iso.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(); }
  function longDate(iso) {
    var p = iso.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2])).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  }
  function dayParts(iso) {
    var p = iso.split('-').map(Number);
    return { wd: WD[wdOf(iso)], dn: p[2], long: longDate(iso), mon: MESI[p[1] - 1] };
  }

  // ---- data preparation --------------------------------------------------
  function buildDates(range, showings) {
    var from = range && range.from, to = range && range.to;
    if (!from || !to) {
      if (!showings.length) return [];
      from = showings[0].date;
      to = showings[showings.length - 1].date;
    }
    var out = [], d = from, guard = 0;
    while (d <= to && guard++ < 62) { out.push(d); d = addDays(d, 1); }
    return out;
  }

  function prepare(json) {
    var cinemas = (json.cinemas || []).filter(function (c) { return c && c.id; });
    var films = (json.films || []).filter(function (f) { return f && f.id; });
    var cinemaById = new Map(cinemas.map(function (c) { return [c.id, c]; }));
    var filmById = new Map(films.map(function (f) { return [f.id, f]; }));
    var showings = (json.showings || []).filter(function (s) {
      return s && s.date && s.time && cinemaById.has(s.cinema_id) && filmById.has(s.film_id);
    });
    showings.forEach(function (s) { s.time = String(s.time).slice(0, 5); });
    showings.sort(function (a, b) {
      return a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.cinema_id.localeCompare(b.cinema_id);
    });
    var byDate = new Map();
    showings.forEach(function (s) {
      if (!byDate.has(s.date)) byDate.set(s.date, []);
      byDate.get(s.date).push(s);
    });
    var dates = buildDates(json.range, showings);
    var formats = uniq(showings.map(function (s) { return s.format; }).filter(Boolean)).sort();
    var rangeTo = (json.range && json.range.to) || (dates.length ? dates[dates.length - 1] : '');
    return {
      generated_at: json.generated_at || null,
      rangeTo: rangeTo,
      cinemas: cinemas, films: films,
      cinemaById: cinemaById, filmById: filmById,
      showings: showings, byDate: byDate,
      dates: dates, formats: formats
    };
  }

  // ---- filtering ---------------------------------------------------------
  function filtersActive() {
    return S.l !== 'ita' || S.t !== 'tutti' || S.fmt !== 'tutti' || S.tipo !== 'tutti' || !!S.q;
  }

  function passes(s) {
    if (S.l === 'ita' && s.language !== 'ita') return false;
    if (S.l === 'vo' && s.language !== 'vo' && s.language !== 'vos') return false;
    var h = timeHour(s.time);
    if (S.t === 'mattina' && !(h < 14)) return false;
    if (S.t === 'pomeriggio' && !(h >= 14 && h < 18)) return false;
    if (S.t === 'sera' && !(h >= 18)) return false;
    if (S.fmt !== 'tutti' && s.format !== S.fmt) return false;
    var f = DATA.filmById.get(s.film_id);
    if (S.tipo !== 'tutti' && f.type !== S.tipo) return false;
    if (S.q) {
      var q = norm(S.q);
      var c = DATA.cinemaById.get(s.cinema_id);
      if (!norm(f.title).includes(q) && !norm(f.original_title).includes(q) && !norm(c.name).includes(q)) return false;
    }
    return true;
  }

  function dayIndex() {
    var list = DATA && S.d ? (DATA.byDate.get(S.d) || []).filter(passes) : [];
    var byCinema = new Map();
    list.forEach(function (s) {
      if (!byCinema.has(s.cinema_id)) byCinema.set(s.cinema_id, []);
      byCinema.get(s.cinema_id).push(s);
    });
    return { list: list, byCinema: byCinema };
  }

  function groupByFilm(list) {
    var m = new Map();
    list.forEach(function (s) {
      if (!m.has(s.film_id)) m.set(s.film_id, { film: DATA.filmById.get(s.film_id), shows: [] });
      m.get(s.film_id).shows.push(s);
    });
    var arr = Array.from(m.values());
    arr.forEach(function (g) { g.shows.sort(function (a, b) { return a.time.localeCompare(b.time); }); });
    arr.sort(function (a, b) {
      return a.shows[0].time.localeCompare(b.shows[0].time) || a.film.title.localeCompare(b.film.title, 'it');
    });
    return arr;
  }

  function cinemasOf(shows) {
    var m = new Map();
    shows.forEach(function (s) {
      if (!m.has(s.cinema_id)) m.set(s.cinema_id, []);
      m.get(s.cinema_id).push(s);
    });
    return Array.from(m.entries()).map(function (e) {
      return { c: DATA.cinemaById.get(e[0]), shows: e[1] };
    }).sort(function (a, b) { return a.c.name.localeCompare(b.c.name, 'it'); });
  }

  function isStale(c) { return !!c.published_until && c.published_until < DATA.rangeTo; }

  // ---- posters -----------------------------------------------------------
  function posterSrc(id) {
    var e = POSTERS[id];
    if (e && e.file) return /\//.test(e.file) ? e.file : 'assets/posters/' + e.file;
    return 'assets/posters/' + encodeURIComponent(id) + '.jpg';
  }
  function posterHTML(film, cls) {
    if (!film) return '';
    return '<span class="poster ' + (cls || '') + '" style="background:' + colorFor(film.id) + '">' +
      '<span class="poster-title">' + esc(film.title) + '</span>' +
      '<img alt="" loading="lazy" decoding="async" data-poster="1" src="' + esc(posterSrc(film.id)) + '">' +
      '</span>';
  }
  // a poster that fails to load simply loses its image and keeps the title card
  document.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t.tagName === 'IMG' && t.hasAttribute('data-poster')) t.remove();
  }, true);

  // ---- markup pieces -----------------------------------------------------
  function bookingUrl(s) {
    var c = DATA.cinemaById.get(s.cinema_id);
    return s.booking_url || c.booking_url || c.website || '';
  }
  function timeHTML(s) {
    var url = bookingUrl(s), p = priceStr(s.price_eur);
    var inner = '<b>' + esc(s.time) + '</b>' + (p ? '<small>' + esc(p) + '</small>' : '');
    if (/^https?:\/\//.test(url)) {
      return '<li><a class="time" href="' + esc(url) + '" target="_blank" rel="noopener">' + inner + '</a></li>';
    }
    return '<li><span class="time-plain">' + inner + '</span></li>';
  }
  function metaLine(film, shows) {
    var parts = [];
    if (film && isNum(film.runtime_min)) parts.push(film.runtime_min + ' min');
    var langs = uniq(shows.map(function (s) { return LANG_LABEL[s.language] || 'ALTRO'; }));
    if (langs.length) parts.push(langs.join(' / '));
    var fmts = uniq(shows.map(function (s) { return s.format; }).filter(Boolean));
    if (fmts.length) parts.push(fmts.join(' / '));
    return parts.join(' · ');
  }
  function filmCard(g) {
    return '<article class="fcard">' + posterHTML(g.film, '') +
      '<div class="fbody">' +
      '<button type="button" class="ftitle" data-film="' + esc(g.film.id) + '" data-key="ft:' + esc(g.film.id) + '">' + esc(g.film.title) + '</button>' +
      '<p class="fmeta">' + esc(metaLine(g.film, g.shows)) + '</p>' +
      '<ul class="times">' + g.shows.map(timeHTML).join('') + '</ul>' +
      '</div></article>';
  }
  function emptyInner(sub) {
    var on = filtersActive();
    return '<p>' + (on ? 'Nessuna proiezione con questi filtri' : 'Nessuna proiezione in questo giorno') + '</p>' +
      (sub ? '<p class="sub">' + esc(sub) + '</p>' : '') +
      (on ? '<button type="button" class="btn-solid" data-act="reset" data-key="act:reset">Azzera filtri</button>' : '');
  }
  function noteCard(c, where) {
    var label = c.status === 'blocked' ? 'Programmazione non disponibile.' : 'Nessuna programmazione.';
    var site = c.website ? '<a href="' + esc(c.website) + '" target="_blank" rel="noopener">Sito del cinema</a>' : '';
    if (where === 'dock') {
      return '<div class="note-block"><strong>' + label + '</strong><p>' + esc(c.notes || '') + '</p>' + site + '</div>';
    }
    return '<article class="cnote"><h3>' + esc(c.name) + '</h3><p class="sub">' + esc(c.address || '') + '</p>' +
      '<p><strong>' + label + '</strong> ' + esc(c.notes || '') + '</p>' + (site ? '<p>' + site + '</p>' : '') + '</article>';
  }

  // ---- map ---------------------------------------------------------------
  function pinIcon(c, films, count, selected) {
    var n = films.length;
    var cfg = n === 1 ? [[70, 4]] : n === 2 ? [[60, -8], [80, 6]] : [[52, -10], [70, 0], [88, 9]];
    var thumbs = films.map(function (f, i) {
      return '<span class="thumb" style="left:' + (cfg[i][0] - 13) + 'px;transform:rotate(' + cfg[i][1] + 'deg)">' + posterHTML(f, 'tiny') + '</span>';
    }).join('');
    var label = c.name + (count ? ', ' + count + (count === 1 ? ' proiezione' : ' proiezioni') : ', nessuna proiezione');
    var html = '<button type="button" class="pin' + (selected ? ' is-on' : '') + (count ? '' : ' is-empty') + '" data-pin="' + esc(c.id) +
      '" data-key="pin:' + esc(c.id) + '" aria-label="' + esc(label) + '">' +
      '<span class="pin-fan">' + thumbs + '</span>' +
      '<span class="pin-tag">' + esc(c.name) + '</span>' +
      '<span class="pin-dot"></span></button>';
    return L.divIcon({ className: 'pin-icon', html: html, iconSize: [PIN_W, PIN_H], iconAnchor: [PIN_W / 2, PIN_H - DOT_R] });
  }

  function initMap() {
    map = L.map('map', { center: CENTER, zoom: ZOOM, minZoom: 11, maxZoom: 18, zoomControl: false, attributionControl: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    attrib = L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(map);
    attrib.addAttribution(OSM_NOTE);
    attrib.addAttribution(TMDB_NOTE);
    cluster = L.markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      maxClusterRadius: 56,
      iconCreateFunction: function (cl) {
        return L.divIcon({
          className: 'cluster-wrap',
          html: '<span class="cluster-bubble">' + cl.getChildCount() + '</span>',
          iconSize: [38, 38], iconAnchor: [19, 19]
        });
      }
    });
    cluster.addTo(map);
    map.on('moveend', renderOffscreen);
    map.on('click', function () {
      hidePreview();
      if (S.dock && DATA) commit({ dock: false });
    });
  }

  function renderMap(idx) {
    cluster.clearLayers();
    DATA.cinemas.forEach(function (c) {
      if (c.status !== 'ok' || !isNum(c.lat) || !isNum(c.lng)) return;
      var shows = idx.byCinema.get(c.id) || [];
      var films = groupByFilm(shows).slice(0, 3).map(function (g) { return g.film; });
      var selected = S.c === c.id;
      var m = L.marker([c.lat, c.lng], {
        icon: pinIcon(c, films, shows.length, selected),
        keyboard: false,
        riseOnHover: true,
        zIndexOffset: selected ? 1000 : 0
      });
      m.on('click', function () { pickCinema(c.id); });
      cluster.addLayer(m);
    });
  }

  function visibleRect() {
    var mr = $('#map').getBoundingClientRect();
    var tb = $('#topbar').getBoundingClientRect();
    var r = { l: 8, t: tb.bottom - mr.top + 8, r: mr.width - 8, b: mr.height - 8 };
    var dock = $('#dock');
    if (isDesktop()) {
      if (S.c && S.dock && S.v === 'mappa') r.r = dock.getBoundingClientRect().left - mr.left - 8;
    } else {
      r.b = Math.min(r.b, dock.getBoundingClientRect().top - mr.top - 8);
    }
    // keep pills clear of the bottom-left control stack (zoom + attribution)
    var corner = $('.leaflet-bottom.leaflet-left');
    if (corner && corner.offsetHeight) {
      r.b = Math.min(r.b, corner.getBoundingClientRect().top - mr.top - 8);
    }
    return r;
  }

  function renderOffscreen() {
    var wrap = $('#offscreen');
    wrap.innerHTML = '';
    if (!map || !DATA || S.v !== 'mappa') return;
    var r = visibleRect();
    if (r.r - r.l < 120 || r.b - r.t < 80) return;
    var cx = (r.l + r.r) / 2, cy = (r.t + r.b) / 2;
    var hw = (r.r - r.l) / 2, hh = (r.b - r.t) / 2;
    var mx = 80, my = 22; // approximate half size of a pill
    var items = [];
    DATA.cinemas.forEach(function (c) {
      if (c.status !== 'ok' || !isNum(c.lat) || !isNum(c.lng)) return;
      if (!(LAST_IDX.byCinema.get(c.id) || []).length) return;
      var p = map.latLngToContainerPoint([c.lat, c.lng]);
      if (p.x >= r.l && p.x <= r.r && p.y >= r.t && p.y <= r.b) return;
      var dx = p.x - cx, dy = p.y - cy;
      var sx = Math.abs(dx) > 0 ? Math.max(hw - mx, 0) / Math.abs(dx) : Infinity;
      var sy = Math.abs(dy) > 0 ? Math.max(hh - my, 0) / Math.abs(dy) : Infinity;
      var s = Math.min(sx, sy, 1);
      var a = Math.atan2(dy, dx);
      var k = (Math.round(a / (Math.PI / 4)) + 8) % 8;
      items.push({ c: c, x: cx + dx * s, y: cy + dy * s, dist: Math.hypot(dx, dy), arrow: ARROWS[k] });
    });
    items.sort(function (a, b) { return a.dist - b.dist; });
    wrap.innerHTML = items.slice(0, 6).map(function (it) {
      return '<button type="button" class="offpill" style="left:' + Math.round(it.x) + 'px;top:' + Math.round(it.y) + 'px" data-pan="' + esc(it.c.id) +
        '" data-key="pan:' + esc(it.c.id) + '" aria-label="Vai a ' + esc(it.c.name) + '">' +
        '<span class="arr" aria-hidden="true">' + it.arrow + '</span>' + esc(it.c.name) + '</button>';
    }).join('');
  }

  // hover preview (desktop)
  function showPreview(pinEl) {
    var id = pinEl.getAttribute('data-pin');
    var c = DATA.cinemaById.get(id);
    var list = LAST_IDX.byCinema.get(id) || [];
    var next = list.slice(0, 3);
    if (S.d === todayISO()) next = list.filter(function (s) { return s.time >= nowHHMM(); }).slice(0, 3);
    var body;
    if (next.length) {
      body = '<ul>' + next.map(function (s) {
        var p = priceStr(s.price_eur);
        return '<li><span>' + esc(s.time) + '</span><small>' + esc(LANG_LABEL[s.language] || '') + (p ? ' · ' + esc(p) : '') + '</small></li>';
      }).join('') + '</ul>';
    } else if (!list.length) {
      body = '<p>Nessuna proiezione' + (filtersActive() ? ' con questi filtri' : ' in questo giorno') + '.</p>';
    } else {
      body = '<p>Nessuna proiezione dopo le ' + nowHHMM() + '.</p>';
    }
    var el = $('#hover-preview');
    el.innerHTML = '<h3>' + esc(c.name) + '</h3>' + body;
    var rect = pinEl.getBoundingClientRect();
    el.style.left = Math.round(rect.left + rect.width / 2) + 'px';
    el.style.top = Math.round(rect.top + 4) + 'px';
    el.hidden = false;
  }
  function hidePreview() { $('#hover-preview').hidden = true; }

  // ---- panels ------------------------------------------------------------
  function renderTop() {
    if (!DATA) return;
    $('#view-map').setAttribute('aria-pressed', String(S.v === 'mappa'));
    $('#view-list').setAttribute('aria-pressed', String(S.v === 'lista'));
    var langTxt = S.l === 'tutte' ? 'TUTTE' : S.l === 'vo' ? 'VO' : 'ITA';
    var parts = [langTxt, TIME_LABEL[S.t]];
    if (S.fmt !== 'tutti') parts.push(S.fmt);
    if (S.tipo !== 'tutti') parts.push(TYPE_LABEL[S.tipo].toLowerCase());
    if (S.q) parts.push('“' + S.q + '”');
    var pill = $('#filter-pill');
    pill.textContent = parts.join(' · ');
    pill.setAttribute('aria-expanded', String(FILTERS_OPEN));
    $('#search-btn').setAttribute('aria-expanded', String(FILTERS_OPEN));
    $('#filters').hidden = !FILTERS_OPEN;

    var strip = $('#strip');
    $$('.day', strip).forEach(function (b) {
      var on = b.getAttribute('data-day') === S.d;
      b.setAttribute('aria-pressed', String(on));
      if (on && b.getAttribute('data-scrolled') !== '1') {
        var sr = strip.getBoundingClientRect(), br = b.getBoundingClientRect();
        strip.scrollLeft += (br.left - sr.left) - (sr.width / 2 - br.width / 2);
        b.setAttribute('data-scrolled', '1');
      }
      if (!on) b.removeAttribute('data-scrolled');
    });

    ['l', 't', 'tipo'].forEach(function (k) {
      var el = $('input[name="' + k + '"][value="' + S[k] + '"]');
      if (el && !el.checked) el.checked = true;
    });
    var sel = $('#fmt');
    if (sel.value !== S.fmt) sel.value = S.fmt;
    var q = $('#q');
    if (document.activeElement !== q && q.value !== S.q) q.value = S.q;
  }

  function renderMapVisibility() {
    var mapOn = S.v === 'mappa';
    var wrap = $('#map-wrap');
    var was = !wrap.hidden;
    wrap.hidden = !mapOn;
    $('#dock').hidden = !mapOn;
    $('#list').hidden = mapOn;
    if (mapOn && !was && map) map.invalidateSize();
  }

  function renderDock(idx) {
    var dock = $('#dock');
    var c = DATA && S.c ? DATA.cinemaById.get(S.c) : null;
    var open = !!c && S.dock && S.v === 'mappa';
    dock.classList.toggle('is-collapsed', !open);
    $('#dock-handle').setAttribute('aria-expanded', String(open));
    $('#dock-hint').textContent = c ? c.name : 'Tocca un cinema sulla mappa';
    var head = $('#dock-head'), body = $('#dock-body');
    if (!open) { head.innerHTML = ''; body.innerHTML = ''; return; }

    var shows = idx.byCinema.get(c.id) || [];
    var films = groupByFilm(shows);
    var meta = '<div class="dock-meta">' + esc(c.address || '') +
      (c.status === 'ok' ? '<br><span class="count">' + films.length + ' film</span>' : '') + '</div>';
    head.innerHTML = '<h2 class="dock-name">' + esc(c.name) + '</h2>' + meta +
      (isStale(c) ? '<p class="fresh">Programmazione pubblicata solo fino al ' + ddmm(c.published_until) + '</p>' : '');

    if (c.status !== 'ok') { body.innerHTML = noteCard(c, 'dock'); return; }
    if (!films.length) { body.innerHTML = '<div class="empty-msg">' + emptyInner() + '</div>'; return; }
    body.innerHTML = films.map(filmCard).join('');
    body.scrollLeft = 0;
  }

  function renderList(idx) {
    var el = $('#list');
    if (S.v !== 'lista' || !DATA) { el.innerHTML = ''; return; }
    var html = '<div class="list-inner"><h2 class="day-title">' + esc(cap(longDate(S.d))) + '</h2>';
    DATA.cinemas.filter(isStale).forEach(function (c) {
      if (c.status !== 'ok') return;
      html += '<p class="fresh-note"><strong>' + esc(c.name) + '</strong> · Programmazione pubblicata solo fino al ' + ddmm(c.published_until) + '</p>';
    });
    var groups = groupByFilm(idx.list).sort(function (a, b) { return a.film.title.localeCompare(b.film.title, 'it'); });
    if (!groups.length) {
      html += '<div class="status-box">' + emptyInner() + '</div>';
    }
    groups.forEach(function (g) {
      html += '<article class="lcard">' + posterHTML(g.film, 'small') +
        '<div class="lcard-main"><h3><button type="button" data-film="' + esc(g.film.id) + '" data-key="ft:' + esc(g.film.id) + '">' + esc(g.film.title) + '</button></h3>' +
        '<p class="lmeta">' + esc(metaLine(g.film, g.shows)) + '</p>' +
        cinemasOf(g.shows).map(function (ci) {
          return '<div class="lrow"><button type="button" class="lcin" data-c="' + esc(ci.c.id) + '" data-key="lc:' + esc(ci.c.id) + '">' + esc(ci.c.name) + '</button>' +
            '<ul class="times">' + ci.shows.map(timeHTML).join('') + '</ul></div>';
        }).join('') +
        '</div></article>';
    });
    var off = DATA.cinemas.filter(function (c) { return c.status !== 'ok'; });
    if (off.length) {
      html += '<h3 class="blocked-head">Senza programmazione</h3>' + off.map(function (c) { return noteCard(c, 'list'); }).join('');
    }
    var gen = '';
    if (DATA.generated_at) {
      var gd = new Date(DATA.generated_at);
      if (!isNaN(gd)) gen = 'Dati aggiornati il ' + gd.toLocaleString('it-IT', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    }
    if (SAMPLE) gen = (gen ? gen + ' · ' : '') + 'Dati di prova';
    html += '<p class="credit">' + esc(TMDB_NOTE) + (gen ? '<br>' + esc(gen) : '') + '</p></div>';
    el.innerHTML = html;
  }

  function filmDialogHTML(f) {
    var shows = DATA.showings.filter(function (s) { return s.film_id === f.id && passes(s); });
    var byDate = new Map();
    shows.forEach(function (s) {
      if (!byDate.has(s.date)) byDate.set(s.date, []);
      byDate.get(s.date).push(s);
    });
    var rows = '';
    DATA.dates.forEach(function (d) {
      var arr = byDate.get(d);
      if (!arr) return;
      rows += '<section class="dgrid-day"><h3>' + esc(cap(longDate(d))) + '</h3>' +
        cinemasOf(arr).map(function (ci) {
          return '<div class="dgrid-cin"><button type="button" class="lcin" data-c="' + esc(ci.c.id) + '">' + esc(ci.c.name) + '</button>' +
            '<ul class="times">' + ci.shows.map(timeHTML).join('') + '</ul></div>';
        }).join('') + '</section>';
    });
    return '<div class="dlg">' +
      '<div class="dlg-top"><span class="lmeta">' + esc(TYPE_LABEL[f.type] || '') + '</span>' +
      '<button type="button" class="dlg-close" data-act="close-film" data-key="act:close-film">Chiudi</button></div>' +
      '<div class="dlg-film">' + posterHTML(f, 'big') + '<div>' +
      '<h2 id="film-dialog-title">' + esc(f.title) + '</h2>' +
      (f.original_title && f.original_title !== f.title ? '<p class="orig">' + esc(f.original_title) + '</p>' : '') +
      '<p class="lmeta">' + esc(metaLine(f, shows)) + '</p></div></div>' +
      (rows || '<div class="empty-msg">' + emptyInner() + '</div>') +
      '</div>';
  }

  function renderFilm() {
    var dlg = $('#film-dialog');
    var f = DATA && S.film ? DATA.filmById.get(S.film) : null;
    if (!f) { if (dlg.open) dlg.close(); return; }
    dlg.innerHTML = filmDialogHTML(f);
    if (!dlg.open) dlg.showModal();
  }

  function renderStatus(idx) {
    var box = $('#status-box');
    if (S.v !== 'mappa') { box.hidden = true; return; }
    if (LOAD_STATE === 'loading') {
      box.hidden = false;
      box.innerHTML = '<div class="loader"><span class="blink" aria-hidden="true"></span><span>Caricamento orari…</span></div>';
      return;
    }
    if (LOAD_STATE === 'error') {
      box.hidden = false;
      box.innerHTML = '<p>Impossibile caricare gli orari</p><p class="sub">Controlla la connessione e riprova.</p>' +
        '<button type="button" class="btn-solid" data-act="retry" data-key="act:retry">Riprova</button>';
      return;
    }
    if (DATA && !idx.list.length) {
      box.hidden = false;
      box.innerHTML = emptyInner();
      return;
    }
    box.hidden = true;
  }

  function updateChromeVars() {
    var tb = $('#topbar').getBoundingClientRect();
    document.documentElement.style.setProperty('--top-h', Math.round(tb.bottom) + 'px');
    var dock = $('#dock');
    var dh = (!isDesktop() && !dock.hidden) ? dock.getBoundingClientRect().height : 0;
    document.documentElement.style.setProperty('--dock-h', Math.round(dh) + 'px');
    var panel = isDesktop() && S.v === 'mappa' && !!S.c && S.dock;
    document.body.classList.toggle('has-panel', panel);
  }

  // ---- render orchestration -----------------------------------------------
  function keyOfActive() {
    var a = document.activeElement;
    if (!a || a === document.body) return null;
    return a.getAttribute('data-key');
  }
  function restoreFocus(key) {
    if (!key) return;
    var el = $$('[data-key]').filter(function (e) { return e.getAttribute('data-key') === key; })[0];
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
  }

  function render() {
    var key = keyOfActive();
    hidePreview();
    var idx = DATA ? dayIndex() : { list: [], byCinema: new Map() };
    LAST_IDX = idx;
    renderTop();
    renderMapVisibility();
    if (DATA && LOAD_STATE === 'ready') {
      renderMap(idx);
    }
    renderDock(idx);
    renderList(idx);
    renderFilm();
    renderStatus(idx);
    updateChromeVars();
    renderOffscreen();
    restoreFocus(key);
  }

  function writeHash() {
    if (!DATA) return;
    var p = new URLSearchParams();
    if (S.d) p.set('d', S.d);
    p.set('l', S.l);
    if (S.t !== 'tutti') p.set('t', S.t);
    if (S.fmt !== 'tutti') p.set('fmt', S.fmt);
    if (S.tipo !== 'tutti') p.set('tipo', S.tipo);
    if (S.q) p.set('q', S.q);
    if (S.c) p.set('c', S.c);
    if (S.film) p.set('film', S.film);
    if (S.v !== 'mappa') p.set('v', S.v);
    var h = '#' + p.toString();
    if (location.hash !== h) {
      try { history.replaceState(null, '', location.pathname + location.search + h); } catch (e) { /* ignore */ }
    }
  }

  function readHash() {
    var p = new URLSearchParams(location.hash.replace(/^#/, ''));
    var prevC = S.c;
    var dates = DATA.dates;
    var d = p.get('d');
    if (!d || dates.indexOf(d) < 0) {
      d = dates.indexOf(todayISO()) >= 0 ? todayISO() : (dates[0] || null);
    }
    S.d = d;
    var l = p.get('l');
    S.l = (l === 'tutte' || l === 'ita' || l === 'vo') ? l : 'ita';
    var t = p.get('t');
    S.t = (t === 'mattina' || t === 'pomeriggio' || t === 'sera') ? t : 'tutti';
    var fmt = p.get('fmt');
    S.fmt = fmt && DATA.formats.indexOf(fmt) >= 0 ? fmt : 'tutti';
    var tipo = p.get('tipo');
    S.tipo = (tipo === 'film' || tipo === 'event' || tipo === 'classic') ? tipo : 'tutti';
    S.q = (p.get('q') || '').slice(0, 80);
    var c = p.get('c');
    S.c = c && DATA.cinemaById.has(c) ? c : null;
    var film = p.get('film');
    S.film = film && DATA.filmById.has(film) ? film : null;
    S.v = p.get('v') === 'lista' ? 'lista' : 'mappa';
    if (S.c !== prevC) S.dock = !!S.c;
  }

  function commit(patch) {
    Object.assign(S, patch);
    writeHash();
    render();
  }

  function resetFilters() {
    commit({ l: 'ita', t: 'tutti', fmt: 'tutti', tipo: 'tutti', q: '' });
  }
  function pickCinema(id) {
    commit({ c: id, dock: true });
  }
  function goToCinema(id) {
    var c = DATA.cinemaById.get(id);
    commit({ film: null, v: 'mappa', c: id, dock: true });
    if (map && c && isNum(c.lat) && isNum(c.lng)) map.panTo([c.lat, c.lng]);
  }
  function openFilm(id) { commit({ film: id }); }
  function toggleFilters(force, focusQ) {
    FILTERS_OPEN = typeof force === 'boolean' ? force : !FILTERS_OPEN;
    render();
    if (FILTERS_OPEN && focusQ) $('#q').focus();
  }

  // ---- UI bindings -------------------------------------------------------
  function buildStrip() {
    $('#strip').innerHTML = DATA.dates.map(function (d) {
      var p = dayParts(d);
      return '<button type="button" class="day" data-day="' + d + '" data-key="day:' + d + '" aria-pressed="false" aria-label="' + esc(cap(p.long)) + '">' +
        '<span class="wd" aria-hidden="true">' + p.wd + '</span><span class="dn" aria-hidden="true">' + p.dn + '</span></button>';
    }).join('');
  }
  function buildFormats() {
    $('#fmt').innerHTML = '<option value="tutti">Tutti i formati</option>' +
      DATA.formats.map(function (f) { return '<option value="' + esc(f) + '">' + esc(f) + '</option>'; }).join('');
  }

  function bindUI() {
    $('#view-map').addEventListener('click', function () { if (DATA) commit({ v: 'mappa' }); });
    $('#view-list').addEventListener('click', function () { if (DATA) commit({ v: 'lista' }); });
    $('#search-btn').addEventListener('click', function () { toggleFilters(true, true); });
    $('#filter-pill').addEventListener('click', function () { toggleFilters(); });
    $('#close-filters').addEventListener('click', function () { toggleFilters(false); $('#filter-pill').focus(); });
    $('#reset-filters').addEventListener('click', resetFilters);

    var filters = $('#filters');
    filters.addEventListener('change', function (e) {
      if (!DATA) return;
      var t = e.target;
      if (t.name === 'l') commit({ l: t.value });
      else if (t.name === 't') commit({ t: t.value });
      else if (t.name === 'tipo') commit({ tipo: t.value });
      else if (t.id === 'fmt') commit({ fmt: t.value });
    });
    $('#q').addEventListener('input', function (e) {
      if (!DATA) return;
      commit({ q: e.target.value.trim() });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && FILTERS_OPEN && !$('#film-dialog').open) {
        toggleFilters(false);
        $('#filter-pill').focus();
      }
    });

    document.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-act],[data-film],[data-c],[data-day],[data-pan]') : null;
      if (!t) return;
      if (t.hasAttribute('data-act')) {
        var act = t.getAttribute('data-act');
        if (act === 'retry') load();
        else if (!DATA) return;
        else if (act === 'reset') resetFilters();
        else if (act === 'close-film') $('#film-dialog').close();
        return;
      }
      if (!DATA) return;
      if (t.hasAttribute('data-film')) {
        openFilm(t.getAttribute('data-film'));
      } else if (t.hasAttribute('data-c')) {
        goToCinema(t.getAttribute('data-c'));
      } else if (t.hasAttribute('data-day')) {
        commit({ d: t.getAttribute('data-day') });
      } else if (t.hasAttribute('data-pan')) {
        var c = DATA.cinemaById.get(t.getAttribute('data-pan'));
        if (c && map) map.panTo([c.lat, c.lng]);
      }
    });

    var mapWrap = $('#map-wrap');
    mapWrap.addEventListener('mouseover', function (e) {
      var p = e.target.closest ? e.target.closest('[data-pin]') : null;
      if (p && canHover() && DATA) showPreview(p);
    });
    mapWrap.addEventListener('mouseout', function (e) {
      var p = e.target.closest ? e.target.closest('[data-pin]') : null;
      if (p && !p.contains(e.relatedTarget)) hidePreview();
    });

    var handle = $('#dock-handle');
    handle.addEventListener('pointerdown', function (e) { dragY = e.clientY; dragged = false; });
    handle.addEventListener('pointerup', function (e) {
      if (dragY === null) return;
      var dy = e.clientY - dragY;
      dragY = null;
      if (Math.abs(dy) > 28 && S.c) { dragged = true; commit({ dock: dy < 0 }); }
    });
    handle.addEventListener('click', function () {
      if (dragged) { dragged = false; return; }
      if (!S.c || !DATA) return;
      commit({ dock: !S.dock });
    });

    $('#film-dialog').addEventListener('close', function () {
      if (S.film && DATA) commit({ film: null });
    });

    window.addEventListener('hashchange', function () {
      if (!DATA) return;
      readHash();
      render();
    });
    window.addEventListener('resize', function () { updateChromeVars(); renderOffscreen(); });
    if ('ResizeObserver' in window) {
      var ro = new ResizeObserver(function () { updateChromeVars(); renderOffscreen(); });
      ro.observe($('#topbar'));
      ro.observe($('#dock'));
    }
  }

  // ---- loading -----------------------------------------------------------
  function load() {
    LOAD_STATE = 'loading';
    render();
    var params = new URLSearchParams(location.search);
    SAMPLE = params.has('sample') && params.get('sample') !== '0';
    var url = SAMPLE ? 'data/sample.json' : 'data/showtimes.json';
    Promise.all([
      fetch(url, { cache: 'no-cache' }),
      fetch('data/posters.json', { cache: 'no-cache' }).catch(function () { return null; })
    ]).then(function (res) {
      var main = res[0], pres = res[1];
      if (!main.ok) throw new Error('HTTP ' + main.status + ' per ' + url);
      return main.json().then(function (json) {
        var postersP = pres && pres.ok ? pres.json().catch(function () { return {}; }) : Promise.resolve({});
        return postersP.then(function (posters) { return { json: json, posters: posters }; });
      });
    }).then(function (r) {
      DATA = prepare(r.json);
      POSTERS = (r.posters && typeof r.posters === 'object') ? r.posters : {};
      LOAD_STATE = 'ready';
      buildStrip();
      buildFormats();
      readHash();
      render();
      writeHash();
    }).catch(function (err) {
      if (window.console) console.error(err);
      LOAD_STATE = 'error';
      render();
    });
  }

  // ---- start -------------------------------------------------------------
  function start() {
    if (typeof window.L === 'undefined' || !L.markerClusterGroup) {
      $('#status-box').hidden = false;
      $('#status-box').innerHTML = '<p>Impossibile caricare la mappa</p><p class="sub">Controlla la connessione e ricarica la pagina.</p>';
      return;
    }
    initMap();
    bindUI();
    load();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
