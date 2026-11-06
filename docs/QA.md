# Cinema Milano — QA, Data Coverage & Accessibility Report

Date: 2026-11-06  
Branch: `arena/0847cca5-movie`

## 1. Branch Consolidation Summary

All work streams across the repository were audited, reconciled, bug-fixed, and integrated onto `arena/0847cca5-movie`:

1. **Venue Coverage & Canonicalization (`scrape/adapters/{progettolumiere,cinebazin}.mjs`, `scrape/remap.mjs`, `scrape/lib/normalize.mjs`)**:
   - Restored full schedules for **Mexico** (`3 -> 18` showings), **Palestrina** (`3 -> 20` showings), and **Auditorium Don Bosco** (`no_schedule -> ok`, `4` showings), plus verified status notes for **Space Odeon** (`blocked`), **Sala della Comunità San Protaso / Osoppo** (`no_schedule`), and **Milano a Memoria** (`blocked`, permanently closed).
   - Fixed canonical title selection in `remap.mjs` and `normalize.mjs` so room/language prefixes (`(Sala XL)`, `(Lingua Originale)`, `(O.V.)`, `(JP)`) never leak into display titles, and merged 4 duplicate film pairs (`89 -> 85` canonical films) while preserving `VO`/`VOS` language tags and `DOLBY` Atmos format tags.
2. **Public Full-Price Extraction (`scrape/lib/prices.mjs`, `scrape/apply-prices.mjs`, `scrape/verify-prices.mjs`, `scrape/logs/prices.json`)**:
   - Fixed HTML `<tr>/<td>` table extraction (parsing rows before stripping tags in `decodeHtml`), multi-column weekday matrix parsing (Anteo / Il Regno del Cinema), inherited section headers & two-price time-split lines (Gloria / Plinius), singular `festivo`/`prefestivo` regex matching, day-specificity tie-breaking, and `"Da X,XX €"` floor-price rejection (UCI Bicocca).
   - Populated **705 / 1,405 showings (50%)** across **11 of 16 active cinemas** from official public tariff tables, keeping `price_eur: null` wherever a venue publishes no single full price or where hall-specific pricing is not disambiguated by the public schedule.
3. **Unified Map & Panel Frontend (`index.html`, `app.css`, `css/map.css`, `css/panels.css`, `app.js`, `js/{map,filters,dock,film-panel}.js`)**:
   - Wired `CinemaMap` (`js/map.js` + `css/map.css`) with `app.js` and the panel/grid modules (`js/filters.js`, `js/dock.js`, `js/film-panel.js`, `css/panels.css`) into a zero-build static site.

---

## 2. Venue & Tariff Coverage (`2026-11-06` – `2026-11-15`)

Total: **19 cinemas** (`16 ok`, `3 no_schedule`), **85 canonical films**, **1,405 showings**, **705 priced showings (50%)**, **60 local TMDB posters** (`0` broken poster paths).

| Cinema | Status | Showings | Priced | Public Tariff / Status Summary |
| --- | --- | ---: | ---: | --- |
| `uci-bicocca` | `ok` | 457 | 0 (0%) | States only `"Da €6,90"` dynamic floor price; exact `Intero` shown at seat checkout (`null` kept) |
| `citylife-anteo` | `ok` | 220 | 220 (100%) | Matinée €6,00–6,50; pom. €6,50 (sab 1° spett. €8,00); sera/festivi €9,50 (mer €8,00) |
| `uci-certosa` | `ok` | 169 | 40 (24%) | Cinelandia Certosa: €7,00 lun–gio `<=18:55` & mer (+€1,00 Atmos); sera/weekend differs between Sale 7–8 and altre sale (`null` kept) |
| `eliseo` | `ok` | 113 | 113 (100%) | Lun–ven `<=17:30` €7,50; dom matinée €6,50; sera/sab/dom €10,50 (mer €8,50) |
| `colosseo` | `ok` | 85 | 85 (100%) | Lun–sab `<=17:30` €8,00; dom matinée €6,50; sera/dom €11,00 (mer €9,00); 3D €12,00 |
| `orfeo` | `ok` | 72 | 72 (100%) | 2D lun–ven `<=18:00` €7,00, sera/festivi €10,00 (mer €7,00); 3D €11,50 |
| `plinius` | `ok` | 59 | 59 (100%) | Lun–ven `<=17:55` €6,50; sera & sab/dom/festivi €10,00 |
| `centrale` | `ok` | 48 | 0 (0%) | Public site notes tariff table is under revision; WebTic shows price after seat pick (`null` kept) |
| `gloria` | `ok` | 37 | 37 (100%) | Feriale `<=18:55` €6,50; sera/festivi €9,00; Promo Day mer €6,50 |
| `ducale` | `ok` | 31 | 0 (0%) | Cinenauta / WebTic reveals `Intero` only after interactive seat selection (`null` kept) |
| `arcobaleno` | `ok` | 27 | 0 (0%) | Cinenauta / WebTic reveals `Intero` only after interactive seat selection (`null` kept) |
| `ariosto-anteo` | `ok` | 23 | 23 (100%) | Pom. lun–ven €6,00 (sab 1° spett. €6,50); sera/festivi €8,50 (mer €6,50) |
| `arlecchino` | `ok` | 22 | 22 (100%) | Intero €8,50; giovedì €6,50; feriale ore 15:00 & matinée €5,00 |
| `palestrina` | `ok` | 20 | 16 (80%) | Intero €8,50; pom. feriale €7,00 (18:00/18:15 feriale left `null` as cutoff hour is unstated) |
| `mexico` | `ok` | 18 | 18 (100%) | Intero €8,50; mercoledì pom. €7,00 |
| `auditorium-don-bosco` | `ok` | 4 | 0 (0%) | Cinecircolo André Bazin seasonal membership card (~€109 / 30 films); no single-ticket sale (`null` kept) |
| `space-odeon` | `no_schedule` | 0 | 0 | Closed for renovation since July 2023 (reopening expected H2 2027) |
| `osoppo` | `no_schedule` | 0 | 0 | Sala San Protaso: no screenings published for 6–15 Nov 2026 |
| `milano-a-memoria` | `no_schedule` | 0 | 0 | Permanently closed 5D attraction |
| **Total** | **16 ok / 3 no_schedule** | **1,405** | **705 (50%)** | **11 venues with verified public full-price tariffs** |

---

## 3. Bugs Found & Fixed During Integration & QA

1. **`uniq()` `Set` bug in `app.js`**: `Array.prototype.slice.call(new Set(a))` always returned `[]` because `Set` has no `.length` property. This left `<select id="fmt">` empty (`Tutti i formati` only — missing `2D`, `3D`, `DOLBY`) and stripped `ITA / VO` and `2D / DOLBY` from every film card metadata line. Fixed with `Array.from(new Set(a))`.
2. **HTTP 404 console errors for posterless films (`app.js`, `js/map.js`)**: `posterSrc(id)` fell back to `assets/posters/<id>.jpg` even when `data/posters.json` had no entry, firing 24+ HTTP 404 console errors on initial load and on `?sample=1`. Fixed to render the typographic title card without `<img>` when `!POSTERS[id]`.
3. **HTML table decoding & Italian holiday regex in `scrape/lib/prices.mjs`**: `ratesFromText` previously called `decodeHtml()` (stripping HTML tags) before checking `/<\s*tr[\s>]/i`, making HTML table parsing unreachable; `DAY_COND` used `festiv[i|e]` (missing singular `festivo`/`prefestivo`); `resolvePrice` kept negative-scored mismatches (`s > -2`). All fixed and covered by 31 unit tests.
4. **Undersized `<44x44px` interactive targets (`app.css`, `css/map.css`, `css/panels.css`)**:
   - `.leaflet-touch .leaflet-bar a` (`30x30px`) overrode `.leaflet-control-zoom a` by specificity on desktop (`1280x800`).
   - `.ftitle` (~20px tall), unpriced `.time` (~36px wide), `.opts span`, `.lcin`, and `.note-block a` / `.cnote a` fell below `44x44px`. All enforced to `>= 44x44px`.
5. **Accessibility (`axe-core` WCAG 2.1 A/AA + best-practice)**:
   - Stripped `tabindex`/`role` from outer Leaflet `.cluster-wrap` wrappers to eliminate `nested-interactive` ARIA violations around `<button class="cluster-bubble">`.
   - Added `<h1 class="sr-only">` in `#topbar`, wrapped `#map-wrap`, `#list`, `#dock`, and `#hover-preview` in persistent `<main id="main">`, and changed `#hover-preview` `<h3>` to `<p class="hp-title">` so heading hierarchy never skips levels.
6. **Collapsed dock visibility & keyboard `Tab -> Pin -> Enter -> Tab -> Showtime` flow**:
   - Fixed `.dock.is-collapsed .dock-head, .dock.is-collapsed .dock-body { display: none; }` (previously missing `display: none` due to a trailing comma in `app.css`).
   - Prevented `restoreFocus()` and `js/map.js` `requestAnimationFrame` from stealing focus back to the map pin when `Enter` opens `#dock`; focus moves cleanly to `<h2 class="dock-name" tabindex="-1">`, reaching `.time` in 2 `Tab` presses.
   - Added `dock=0` URL hash serialization so collapsed dock state survives reload.
7. **Visual layout polish (`390x844` & `1280x800`)**:
   - Replaced `justify-content: center` on `#strip` with safe auto-margins on `.day:first-child` / `.day:last-child` so `VEN 6` never clips under `Mappa / Lista` when the desktop side panel narrows `#topbar`.
   - Fitted mobile `#topbar` controls onto a single row on `390px` screens, replaced missing-glyph Unicode diagonal arrows in `.offpill` with rotated inline SVG arrows, sized mobile `.dock` to `38vh` (`min-height: 248px`), and made List-view freshness banners day-aware (`S.d > c.published_until`).

---

## 4. Automated Test Suites & How to Run

```sh
# 1. Price parser & adapter unit tests (31 tests) + offline pipeline verification (13 checks)
cd scrape && npm test

# 2. End-to-end Playwright + axe-core smoke suite at 390x844 & 1280x800 (20 checks)
cd scrape && npm run smoke
```

Latest verification results on `arena/0847cca5-movie`:
- `scrape/tests/prices.test.mjs`: **31 / 31 passed**
- `scrape/verify-prices.mjs`: **13 / 13 passed** (`data/showtimes.json` untouched during offline replay)
- `tests/smoke.mjs`: **20 / 20 passed** (`0` console/page/HTTP errors, `0` undersized `<44x44px` targets, `0` `axe-core` violations across Map, Open Dock/Panel, Filters Sheet, 10-Day Film Grid Dialog, and List View at both `390x844` and `1280x800`, plus `?sample=1` and network-failure retry recovery).
