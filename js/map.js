/* Map chunk: pins, clustering, off-screen pills, hover preview and panning.
 *
 * This module is deliberately dependency-injected so it can land before the
 * app.js split is wired. The host (js/main.js) creates one controller:
 *
 *   const map = createMap({
 *     getState: () => S,              // { d, c, v, dock, l, t, fmt, tipo, q }
 *     getData: () => DATA,            // prepared dataset { cinemas, cinemaById, filmById }
 *     getIndex: () => LAST_IDX,       // { byCinema: Map<cinemaId, showing[]> }
 *     getPosters: () => POSTERS,      // film_id -> { file }
 *     onSelect: id => pickCinema(id),
 *     onBackgroundClick: () => commit({ dock: false })
 *   });
 *   map.init();
 *   map.render();                     // after data/filter/selection changes
 *   map.refresh();                    // after resize / dock geometry changes
 *   map.panTo(id, { focus: true });   // off-screen pill / list navigation
 *
 * Only js/map.js and css/map.css are owned by this chunk. The host must load
 * css/map.css after the base stylesheet and remove the old map rules from
 * app.css when the split lands.
 */

(function () {
  'use strict';

const CENTER = [45.4641, 9.1919]; // Duomo
const DEFAULT_ZOOM = 13;

const MIN_ZOOM = 11;
const MAX_ZOOM = 18;
const PIN_W = 140;
const PIN_H = 84;
const DOT_R = 7;
const PILL_GAP = 8;
const MAX_PILLS = 8;
const ARROWS = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];
const LANG_LABEL = { ita: 'ITA', vo: 'VO', vos: 'VOS', other: 'ALTRO' };
const PALETTE = ['#F2C14E', '#8FB8A8', '#E38B6F', '#A9C6E8', '#D8B4D9', '#C9D8A0', '#F4A6A0', '#D9C8A3'];
const OSM_NOTE = '© OpenStreetMap contributors';
const TMDB_NOTE = 'Poster: This product uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.';

function isNum(v) { return typeof v === 'number' && isFinite(v); }
function pad(n) { return String(n).padStart(2, '0'); }
function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}
function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function colorFor(id) { return PALETTE[hashStr(String(id)) % PALETTE.length]; }
/* Pin/chip label: one distinctive word per cinema (Ariosto, Orfeo, CityLife…). */
const SHORT_NAMES = [
  [/^UCI Cinemas Bicocca/i, 'Bicocca'],
  [/^UCI Cinemas Certosa/i, 'Certosa'],
  [/^The Space Odeon/i, 'Odeon'],
  [/^Auditorium Don Bosco/i, 'Don Bosco'],
  [/^Notorious Cinemas Gloria/i, 'Gloria'],
  [/^Cineteca Milano Arlecchino/i, 'Arlecchino'],
  [/^Anteo Palazzo/i, 'Anteo'],
  [/^Milano a Memoria/i, 'Memoria'],
  [/^Il Cinemino/i, 'Cinemino'],
  [/^Cinema (Beltrade|Godard)/i, null],
];
function shortName(n) {
  const s = String(n).replace(/\s*\(.*\)\s*$/, '').trim();
  for (const [re, label] of SHORT_NAMES) {
    const m = s.match(re);
    if (m) return label || m[1];
  }
  return s.split(/\s+/)[0];
}
function intersects(a, b) {
  return a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
}
function inflate(r, n) {
  return { l: r.l - n, t: r.t - n, r: r.r + n, b: r.b + n };
}
function rectFromDom(el, origin) {
  const r = el.getBoundingClientRect();
  return { l: r.left - origin.left, t: r.top - origin.top, r: r.right - origin.left, b: r.bottom - origin.top };
}

/* A pin is ~140px wide, so clustering must be wider than Leaflet's default
 * 80px at overview zooms. At the default phone zoom (13) we keep a moderate
 * radius so individual cinemas still appear, and the collision pass below
 * hides any residual overlapping caps tags instead of over-clustering. */
function clusterRadius(zoom) {
  if (zoom <= 11) return 140;
  if (zoom === 12) return 110;
  if (zoom === 13) return 80;
  if (zoom === 14) return 64;
  return 48;
}

function createMap(adapter = {}) {
  const L = adapter.L || window.L;
  const elements = Object.assign({
    map: '#map',
    wrap: '#map-wrap',
    offscreen: '#offscreen',
    preview: '#hover-preview',
    topbar: '#topbar',
    dock: '#dock'
  }, adapter.elements || {});
  const resolve = value => (typeof value === 'string' ? document.querySelector(value) : value);
  const mapEl = resolve(elements.map);
  const wrapEl = resolve(elements.wrap);
  const offEl = resolve(elements.offscreen);
  const previewEl = resolve(elements.preview);
  const topbarEl = resolve(elements.topbar);
  const dockEl = resolve(elements.dock);

  const getState = adapter.getState || (() => ({}));
  const getData = adapter.getData || (() => null);
  const getIndex = adapter.getIndex || (() => ({ byCinema: new Map() }));
  const getPosters = adapter.getPosters || (() => ({}));
  const onSelect = adapter.onSelect || (() => {});
  const onBackgroundClick = adapter.onBackgroundClick || (() => {});
  const isDesktop = adapter.isDesktop || (() => window.matchMedia('(min-width: 900px)').matches);
  const canHover = adapter.canHover || (() => window.matchMedia('(hover: hover) and (min-width: 900px)').matches);
  const todayISO = adapter.todayISO || (() => {
    const n = new Date();
    return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
  });
  const nowHHMM = adapter.nowHHMM || (() => {
    const n = new Date();
    return `${pad(n.getHours())}:${pad(n.getMinutes())}`;
  });
  const filtersActive = adapter.filtersActive || (() => {
    const s = getState();
    return s.l !== 'ita' || s.t !== 'tutti' || s.fmt !== 'tutti' || s.tipo !== 'tutti' || !!s.q;
  });
  const priceStr = adapter.priceStr || (p => (isNum(p) ? '€' + p.toFixed(2).replace('.', ',') : ''));
  const languageLabel = adapter.languageLabel || (l => LANG_LABEL[l] || '');
  const posterSrc = adapter.posterSrc || (id => {
    const entry = getPosters()[id];
    if (entry && entry.file) return /\//.test(entry.file) ? entry.file : 'assets/posters/' + entry.file;
    return '';
  });

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let map = null;
  let cluster = null;
  let layoutFrame = 0;
  let hoveredPin = null;
  let resizeObserver = null;
  const markers = new Map();

  function selectedId() {
    const s = getState();
    return s.c === undefined ? s.selectedCinema : s.c;
  }
  function view() {
    const s = getState();
    return s.v || s.view || 'mappa';
  }
  function dockOpen() {
    const s = getState();
    return s.dock === undefined ? s.dockOpen : s.dock;
  }
  function day() {
    const s = getState();
    return s.d || s.day;
  }

  function posterHTML(film) {
    if (!film) return '';
    const src = posterSrc(film.id);
    return '<span class="poster tiny" style="background:' + colorFor(film.id) + '">' +
      '<span class="poster-title">' + esc(film.title) + '</span>' +
      (src ? '<img alt="" loading="lazy" decoding="async" data-poster="1" src="' + esc(src) + '">' : '') +
      '</span>';
  }

  function fanFilms(shows) {
    const data = getData();
    const seen = new Map();
    for (const s of shows) {
      if (!seen.has(s.film_id)) seen.set(s.film_id, s.time);
    }
    return Array.from(seen.keys())
      .sort((a, b) => seen.get(a).localeCompare(seen.get(b)))
      .slice(0, 3)
      .map(id => data && data.filmById ? data.filmById.get(id) : null)
      .filter(Boolean);
  }

  function pinIcon(cinema, films, count, selected) {
    const n = films.length;
    const cfg = n === 1 ? [[70, 4]] : n === 2 ? [[60, -8], [80, 6]] : [[52, -10], [70, 0], [88, 9]];
    const thumbs = films.map((f, i) => (
      '<span class="thumb" style="left:' + (cfg[i][0] - 13) + 'px;transform:rotate(' + cfg[i][1] + 'deg)">' +
      posterHTML(f) + '</span>'
    )).join('');
    const label = cinema.name + (count ? ', ' + count + (count === 1 ? ' proiezione' : ' proiezioni') : ', nessuna proiezione');
    const html =
      '<button type="button" class="pin' + (selected ? ' is-on' : '') + (count ? '' : ' is-empty') + '"' +
      ' data-pin="' + esc(cinema.id) + '" data-key="pin:' + esc(cinema.id) + '" data-shows="' + count + '"' +
      ' aria-pressed="' + String(selected) + '" aria-label="' + esc(label) + '" title="' + esc(cinema.name) + '">' +
      '<span class="pin-fan" aria-hidden="true">' + thumbs + '</span>' +
      '<span class="pin-tag">' + esc(shortName(cinema.name)) + '</span>' +
      '<span class="pin-dot" aria-hidden="true"></span></button>';
    return L.divIcon({
      className: 'pin-icon',
      html,
      iconSize: [PIN_W, PIN_H],
      iconAnchor: [PIN_W / 2, PIN_H - DOT_R]
    });
  }

  function clusterIcon(cl) {
    const count = cl.getChildCount();
    return L.divIcon({
      className: 'cluster-wrap',
      html: '<button type="button" class="cluster-bubble" aria-label="' + count + ' cinema, tocca per ingrandire">' + count + '</button>',
      iconSize: [44, 44],
      iconAnchor: [22, 22]
    });
  }

  function visibleRect() {
    const mr = mapEl.getBoundingClientRect();
    const tb = topbarEl ? topbarEl.getBoundingClientRect() : null;
    const r = { l: 8, t: tb ? tb.bottom - mr.top + 8 : 8, r: mr.width - 8, b: mr.height - 8 };
    if (isDesktop()) {
      if (selectedId() && dockOpen() && view() === 'mappa' && dockEl) {
        r.r = Math.min(r.r, dockEl.getBoundingClientRect().left - mr.left - 8);
      }
    } else if (dockEl) {
      r.b = Math.min(r.b, dockEl.getBoundingClientRect().top - mr.top - 8);
    }
    const corner = mapEl.querySelector('.leaflet-bottom.leaflet-left');
    if (corner && corner.offsetHeight) {
      r.b = Math.min(r.b, corner.getBoundingClientRect().top - mr.top - 8);
    }
    return r;
  }

  function stripClusterWrapperRoles() {
    if (!mapEl) return;
    mapEl.querySelectorAll('.cluster-wrap[tabindex], .cluster-wrap[role]').forEach(el => {
      el.removeAttribute('tabindex');
      el.removeAttribute('role');
    });
  }

  function scheduleLayout() {
    stripClusterWrapperRoles();
    if (layoutFrame) return;
    layoutFrame = window.requestAnimationFrame(() => {
      layoutFrame = 0;
      stripClusterWrapperRoles();
      layoutLabels();
      renderOffscreen();
    });
  }

  /* Collision-aware caps tags. Selected/focused/hovered pins win; remaining
   * tags are kept in show-count order and hidden if they would overlap a
   * cluster bubble or a higher-priority tag. The pin itself stays clickable
   * and keeps its full accessible name. */
  function layoutLabels() {
    if (!mapEl) return;
    const obstacles = Array.from(mapEl.querySelectorAll('.cluster-bubble')).map(el => el.getBoundingClientRect());
    const items = Array.from(mapEl.querySelectorAll('.pin')).map(pin => {
      const tag = pin.querySelector('.pin-tag');
      if (!tag) return null;
      const count = Number(pin.getAttribute('data-shows') || 0);
      let priority = count;
      if (pin === hoveredPin) priority += 100000;
      if (document.activeElement === pin) priority += 1000000;
      if (pin.classList.contains('is-on')) priority += 10000000;
      return { pin, tag, rect: inflate(tag.getBoundingClientRect(), 2), priority };
    }).filter(Boolean);
    items.sort((a, b) => b.priority - a.priority);
    const kept = [];
    for (const item of items) {
      const forced = item.pin.classList.contains('is-on') || document.activeElement === item.pin || item.pin === hoveredPin;
      const collides = kept.some(r => intersects(item.rect, r)) || obstacles.some(r => intersects(item.rect, inflate(r, 2)));
      const hide = !forced && collides;
      item.pin.classList.toggle('is-label-hidden', hide);
      if (!hide) kept.push(item.rect);
    }
  }

  function renderOffscreen() {
    if (!offEl) return;
    offEl.innerHTML = '';
    const data = getData();
    if (!map || !data || view() !== 'mappa') return;
    const r = visibleRect();
    if (r.r - r.l < 120 || r.b - r.t < 80) return;
    const idx = getIndex();
    const mr = mapEl.getBoundingClientRect();
    const viewport = { l: 0, t: 0, r: mr.width, b: mr.height };
    const cx = (r.l + r.r) / 2;
    const cy = (r.t + r.b) / 2;
    const hw = (r.r - r.l) / 2;
    const hh = (r.b - r.t) / 2;
    const candidates = [];

    for (const cinema of data.cinemas) {
      if (cinema.status !== 'ok' || !isNum(cinema.lat) || !isNum(cinema.lng)) continue;
      const shows = (idx.byCinema && idx.byCinema.get(cinema.id)) || [];
      if (!shows.length) continue;
      const p = map.latLngToContainerPoint([cinema.lat, cinema.lng]);
      const marker = markers.get(cinema.id);
      let pinRect;
      if (marker && cluster) {
        const parent = cluster.getVisibleParent ? cluster.getVisibleParent(marker) : marker;
        const el = parent && parent.getElement ? parent.getElement() : null;
        pinRect = el ? rectFromDom(el, mr) : { l: p.x - PIN_W / 2, t: p.y - (PIN_H - DOT_R), r: p.x + PIN_W / 2, b: p.y + DOT_R };
      } else {
        pinRect = { l: p.x - PIN_W / 2, t: p.y - (PIN_H - DOT_R), r: p.x + PIN_W / 2, b: p.y + DOT_R };
      }
      // Hide the pill as soon as any part of the pin (or its visible cluster)
      // is on screen, even if that part sits under the top bar or dock. Pills
      // themselves are anchored to the usable rect below.
      if (intersects(pinRect, viewport)) continue;
      const dx = p.x - cx;
      const dy = p.y - cy;
      const sx = Math.abs(dx) > 0 ? hw / Math.abs(dx) : Infinity;
      const sy = Math.abs(dy) > 0 ? hh / Math.abs(dy) : Infinity;
      const side = sx <= sy ? (dx < 0 ? 'l' : 'r') : (dy < 0 ? 't' : 'b');
      const angle = Math.atan2(dy, dx);
      const arrow = ARROWS[(Math.round(angle / (Math.PI / 4)) + 8) % 8];
      candidates.push({ cinema, p, side, angle, arrow, count: shows.length, dist: Math.hypot(dx, dy) });
    }

    candidates.sort((a, b) => a.dist - b.dist);
    const chosen = candidates.slice(0, MAX_PILLS);
    if (!chosen.length) return;

    offEl.innerHTML = chosen.map(item => {
      const deg = Math.round((item.angle * 180) / Math.PI);
      const svgArr = '<svg class="arr" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style="transform:rotate(' + deg + 'deg)">' +
        '<path d="M2 6h7M6 2.5 9.5 6 6 9.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"/></svg>';
      return '<button type="button" class="offpill e-' + item.side + '" style="visibility:hidden" data-pan="' + esc(item.cinema.id) + '"' +
        ' data-key="pan:' + esc(item.cinema.id) + '" aria-label="Vai a ' + esc(item.cinema.name) + ', ' + item.count +
        (item.count === 1 ? ' proiezione' : ' proiezioni') + '">' +
        svgArr + esc(shortName(item.cinema.name)) + '</button>';
    }).join('');

    const items = Array.from(offEl.children).map((el, i) => Object.assign({}, chosen[i], {
      el,
      w: el.offsetWidth,
      h: el.offsetHeight,
      desiredX: Math.max(r.l, Math.min(r.r, chosen[i].p.x)),
      desiredY: Math.max(r.t, Math.min(r.b, chosen[i].p.y))
    }));
    const groups = { l: [], r: [], t: [], b: [] };
    items.forEach(item => groups[item.side].push(item));
    const placed = [];

    for (const side of ['l', 'r']) {
      const g = groups[side].sort((a, b) => a.desiredY - b.desiredY);
      let cursor = r.t;
      for (const item of g) {
        const y = Math.max(cursor + item.h / 2, Math.min(r.b - item.h / 2, item.desiredY));
        if (y + item.h / 2 > r.b + 0.5) break;
        placed.push(Object.assign(item, { x: side === 'l' ? r.l : r.r, y }));
        cursor = y + item.h / 2 + PILL_GAP;
      }
    }
    for (const side of ['t', 'b']) {
      const g = groups[side].sort((a, b) => a.desiredX - b.desiredX);
      let cursor = r.l;
      for (const item of g) {
        const x = Math.max(cursor + item.w / 2, Math.min(r.r - item.w / 2, item.desiredX));
        if (x + item.w / 2 > r.r + 0.5) break;
        placed.push(Object.assign(item, { x, y: side === 't' ? r.t : r.b }));
        cursor = x + item.w / 2 + PILL_GAP;
      }
    }

    // Final cross-edge collision guard: nearest pills win corners.
    placed.sort((a, b) => a.dist - b.dist);
    const kept = [];
    for (const item of placed) {
      const rect = {
        l: item.side === 'l' ? item.x : item.side === 'r' ? item.x - item.w : item.x - item.w / 2,
        r: item.side === 'l' ? item.x + item.w : item.side === 'r' ? item.x : item.x + item.w / 2,
        t: item.side === 't' ? item.y : item.side === 'b' ? item.y - item.h : item.y - item.h / 2,
        b: item.side === 't' ? item.y + item.h : item.side === 'b' ? item.y : item.y + item.h / 2
      };
      if (kept.some(k => intersects(inflate(rect, 2), k))) {
        item.el.remove();
        continue;
      }
      kept.push(inflate(rect, 2));
      item.el.style.left = Math.round(item.x) + 'px';
      item.el.style.top = Math.round(item.y) + 'px';
      item.el.style.visibility = '';
    }
  }

  function hidePreview() {
    if (previewEl) previewEl.hidden = true;
  }

  function showPreview(pinEl) {
    if (!previewEl || !pinEl || !isDesktop()) return;
    const data = getData();
    const id = pinEl.getAttribute('data-pin');
    const cinema = data && data.cinemaById ? data.cinemaById.get(id) : null;
    if (!cinema) return;
    const list = (getIndex().byCinema && getIndex().byCinema.get(id)) || [];
    let next = list.slice(0, 3);
    if (day() === todayISO()) next = list.filter(s => s.time >= nowHHMM()).slice(0, 3);
    let body;
    if (next.length) {
      body = '<ul>' + next.map(s => {
        const film = data.filmById ? data.filmById.get(s.film_id) : null;
        const price = priceStr(s.price_eur);
        const meta = languageLabel(s.language) + (price ? ' · ' + price : '');
        return '<li class="hp-row"><span class="hp-time">' + esc(s.time) + '</span>' +
          '<span class="hp-film">' + esc(film ? film.title : '') + '</span>' +
          '<small>' + esc(meta) + '</small></li>';
      }).join('') + '</ul>';
    } else if (!list.length) {
      body = '<p>Nessuna proiezione' + (filtersActive() ? ' con questi filtri' : ' in questo giorno') + '.</p>';
    } else {
      body = '<p>Nessuna proiezione dopo le ' + esc(nowHHMM()) + '.</p>';
    }
    previewEl.innerHTML = '<p class="hp-title">' + esc(cinema.name) + '</p>' + body;
    previewEl.hidden = false;
    const rect = pinEl.getBoundingClientRect();
    const pw = previewEl.offsetWidth;
    const ph = previewEl.offsetHeight;
    const left = Math.max(8 + pw / 2, Math.min(window.innerWidth - 8 - pw / 2, rect.left + rect.width / 2));
    let top = rect.top - 8;
    if (top - ph < 8) top = rect.bottom + 8 + ph;
    top = Math.max(ph + 8, Math.min(window.innerHeight - 8, top));
    previewEl.style.left = Math.round(left) + 'px';
    previewEl.style.top = Math.round(top) + 'px';
  }

  function panTo(id, options = {}) {
    const data = getData();
    const cinema = data && data.cinemaById ? data.cinemaById.get(id) : null;
    if (!map || !cinema || !isNum(cinema.lat) || !isNum(cinema.lng)) return;
    hidePreview();
    const animate = !reduceMotion.matches;
    let focused = false;
    const focusTarget = () => {
      if (focused || !options.focus) return;
      focused = true;
      const marker = markers.get(id);
      const parent = marker && cluster && cluster.getVisibleParent ? cluster.getVisibleParent(marker) : marker;
      const el = parent && parent.getElement ? parent.getElement() : null;
      const target = el ? (el.querySelector('[data-pin]') || el.querySelector('.cluster-bubble') || el) : null;
      if (target && target.focus) target.focus({ preventScroll: true });
    };
    if (options.focus) map.once('moveend', focusTarget);
    map.panTo([cinema.lat, cinema.lng], { animate, duration: 0.25, easeLinearity: 0.25 });
    if (!animate) window.setTimeout(focusTarget, 0);
  }

  function render() {
    const data = getData();
    if (!map || !cluster || !data) return;
    const activePin = document.activeElement && document.activeElement.closest ? document.activeElement.closest('[data-pin]') : null;
    const activeId = activePin ? activePin.getAttribute('data-pin') : null;
    const idx = getIndex();
    const selected = selectedId();
    cluster.clearLayers();
    markers.clear();
    const layers = [];
    for (const cinema of data.cinemas) {
      if (cinema.status !== 'ok' || !isNum(cinema.lat) || !isNum(cinema.lng)) continue;
      const shows = (idx.byCinema && idx.byCinema.get(cinema.id)) || [];
      const films = fanFilms(shows);
      const isOn = selected === cinema.id;
      const marker = L.marker([cinema.lat, cinema.lng], {
        icon: pinIcon(cinema, films, shows.length, isOn),
        keyboard: false,
        riseOnHover: true,
        zIndexOffset: isOn ? 1000 : 0,
        alt: cinema.name
      });
      markers.set(cinema.id, marker);
      layers.push(marker);
    }
    cluster.addLayers(layers);
    stripClusterWrapperRoles();
    scheduleLayout();
    if (activeId) {
      window.requestAnimationFrame(() => {
        if (document.activeElement && document.activeElement !== document.body) return;
        const el = mapEl.querySelector('[data-pin="' + (window.CSS && CSS.escape ? CSS.escape(activeId) : activeId) + '"]');
        if (el) el.focus({ preventScroll: true });
      });
    }
  }

  function refresh() {
    if (!map) return;
    map.invalidateSize();
    scheduleLayout();
  }

  function onMapClick(e) {
    const pin = e.target.closest ? e.target.closest('[data-pin]') : null;
    if (!pin) return;
    e.stopPropagation();
    hidePreview();
    onSelect(pin.getAttribute('data-pin'), { viaKeyboard: e.detail === 0 });
  }

  function onMapKeydown(e) {
    const pin = e.target.closest ? e.target.closest('[data-pin]') : null;
    if (!pin) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      e.stopPropagation();
      hidePreview();
      onSelect(pin.getAttribute('data-pin'), { viaKeyboard: true });
    }
  }

  function onWrapOver(e) {
    const pin = e.target.closest ? e.target.closest('[data-pin]') : null;
    if (!pin || !canHover()) return;
    hoveredPin = pin;
    showPreview(pin);
    scheduleLayout();
  }

  function onWrapOut(e) {
    const pin = e.target.closest ? e.target.closest('[data-pin]') : null;
    if (!pin || pin.contains(e.relatedTarget)) return;
    if (hoveredPin === pin) hoveredPin = null;
    hidePreview();
    scheduleLayout();
  }

  function onWrapFocusIn(e) {
    const pin = e.target.closest ? e.target.closest('[data-pin]') : null;
    if (!pin || !isDesktop()) return;
    hoveredPin = pin;
    showPreview(pin);
    scheduleLayout();
  }

  function onWrapFocusOut(e) {
    const pin = e.target.closest ? e.target.closest('[data-pin]') : null;
    if (!pin) return;
    if (hoveredPin === pin) hoveredPin = null;
    hidePreview();
    scheduleLayout();
  }

  function onOffClick(e) {
    const pill = e.target.closest ? e.target.closest('[data-pan]') : null;
    if (!pill) return;
    e.preventDefault();
    e.stopPropagation();
    panTo(pill.getAttribute('data-pan'), { focus: true });
  }

  function onPosterError(e) {
    const t = e.target;
    if (t && t.tagName === 'IMG' && t.hasAttribute('data-poster')) t.remove();
  }

  function init() {
    if (!L || !L.markerClusterGroup) throw new Error('Leaflet and Leaflet.markercluster are required');
    if (!mapEl) throw new Error('Map container not found');
    const motion = !reduceMotion.matches;
    map = L.map(mapEl, {
      center: CENTER,
      zoom: DEFAULT_ZOOM,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      keyboard: false,
      zoomControl: false,
      attributionControl: false,
      zoomAnimation: motion,
      fadeAnimation: motion,
      markerZoomAnimation: motion
    });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    // Leaflet stacks later bottom controls on top, so add attribution first to sit below the zoom.
    const attrib = L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(map);
    attrib.addAttribution(OSM_NOTE);
    attrib.addAttribution(TMDB_NOTE);
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    cluster = L.markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      maxClusterRadius: clusterRadius,
      iconCreateFunction: clusterIcon,
      animateAddingMarkers: false,
      zoomToBoundsOnClick: true
    });
    cluster.addTo(map);
    map.on('moveend zoomend', scheduleLayout);
    map.on('click', () => {
      hidePreview();
      onBackgroundClick();
    });
    cluster.on('animationend spiderfied unspiderfied', scheduleLayout);
    mapEl.addEventListener('click', onMapClick, true);
    mapEl.addEventListener('keydown', onMapKeydown, true);
    mapEl.addEventListener('error', onPosterError, true);
    if (wrapEl) {
      wrapEl.addEventListener('mouseover', onWrapOver);
      wrapEl.addEventListener('mouseout', onWrapOut);
      wrapEl.addEventListener('focusin', onWrapFocusIn);
      wrapEl.addEventListener('focusout', onWrapFocusOut);
    }
    if (offEl) offEl.addEventListener('click', onOffClick);
    window.addEventListener('resize', refresh);
    if ('ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(refresh);
      if (topbarEl) resizeObserver.observe(topbarEl);
      if (dockEl) resizeObserver.observe(dockEl);
    }
    return api;
  }

  const api = {
    init,
    render,
    refresh,
    panTo,
    showPreview,
    hidePreview,
    invalidateSize: refresh,
    getMap: () => map,
    getCluster: () => cluster,
    destroy() {
      window.removeEventListener('resize', refresh);
      if (resizeObserver) resizeObserver.disconnect();
      resizeObserver = null;
      if (layoutFrame) window.cancelAnimationFrame(layoutFrame);
      layoutFrame = 0;
      if (mapEl) {
        mapEl.removeEventListener('click', onMapClick, true);
        mapEl.removeEventListener('keydown', onMapKeydown, true);
        mapEl.removeEventListener('error', onPosterError, true);
      }
      if (wrapEl) {
        wrapEl.removeEventListener('mouseover', onWrapOver);
        wrapEl.removeEventListener('mouseout', onWrapOut);
        wrapEl.removeEventListener('focusin', onWrapFocusIn);
        wrapEl.removeEventListener('focusout', onWrapFocusOut);
      }
      if (offEl) offEl.removeEventListener('click', onOffClick);
      if (map) map.remove();
      map = null;
      cluster = null;
      markers.clear();
    }
  };
  return api;
}

window.CinemaMap = { CENTER, DEFAULT_ZOOM, createMap };
})();
