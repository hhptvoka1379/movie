# Links for human (merged: two independent fetch runs)

Part A = branch raw/fetch-2026-11-10 (curl + Chromium + browser pane). Part B = branch arena/88a3a587-movie. Venue folders differ between runs (e.g. `colosseo/` vs `cinema-colosseo/`); both are kept.

---

## Part A

# LINKS-FOR-HUMAN (open in Safari, save as Web Archive)

| URL | Should contain | Why not fetched | Attempts |
|---|---|---|---|
| https://www.fondazioneprada.org/cinema/ | Fondazione Prada cinema schedule 6-15 Nov | HTTP 403 block page; not requested again | iPhone UA curl, it-IT headers, www host; stopped per no-evasion rule |
| https://www.cinetecamilano.it/luogo/spazio-oberdan/ | Spazio Oberdan schedule and prices | 503 / timeout | curl, Playwright, fetch retry with backoff (3x) |
| https://www.sdcmilano.it/sala-osoppo-san-protaso | Sala Osoppo schedule + ticket price | 404 | www and non-www, trailing slash, /osoppo, /cinema, homepage crawl (homepage saved) |
| https://www.webtic.it/#/shopping?action=loadLocal&localId=5491 (and 5066, 5065, 5062, 5064, 5742, 5351) | Gloria, Arcobaleno, Ducale, Colosseo, Eliseo, Centrale, Orfeo schedule for Fri 13 - Sun 15 Nov | WebTic returns only 10-11 Nov so far | rendered Chromium + all XHR saved; re-fetch 11-12 Nov |
| https://www.cinemabeltrade.it/ | Beltrade own domain | DNS/connect failure | curl, https/http, beltrade.it; bandhi.it/bah/beltrade/ saved instead |
| Arlecchino ticket page https://arlecchino.cinetecadimilano.18tickets.it/ | per-day schedule 6-15 Nov and prices | single shell JSON captured, no per-day calls made | curl, Chromium render; per-day tabs not clicked |
| https://www.ilcinemino.it/programmazione | Il Cinemino schedule 6-15 Nov, prices | static HTML saved, prices not found | curl crawl one level only |
| Milano a Memoria | schedule/prices | no first-party URL found | none |

## Added in second pass
- 18tickets (arlecchino.cinetecadimilano.18tickets.it) rate-limits: 37 of 60 per-performance requests at 1 req/s returned HTTP 429. Remaining performance pages (`/film/<id>/<uuid>`) and per-day views need a slow pass (3s+ spacing) or a manual Safari save.
- WebTic getFullScheduling (secure.webtic.it) directly with date params: it ignores them; only 10-11 Nov exist. Not a fetch gap, the data is not published yet.

- https://www.parrocchiasanprotaso.org/ (Osoppo): ask the parish or check its Facebook/bulletin for the cinema programme and price; own SalaCinema.html is a 404, root has no cinema link (tried http/https, www/non-www, SalaCinema.html, sala-cinema/, SdC listing).
- https://www.cinetecamilano.it/luogo/spazio-oberdan/ : still 503 on retry via curl; not retried in the browser pane.
- https://www.ilcinemino.it/programmazione/ : re-check Thu 12 Nov, only 10 and 13 Nov are published today.


---

## Part B

# LINKS-FOR-HUMAN — open in Safari, save as Web Archive

Why these are here: this sandbox has no direct HTTP egress (only github/npm/pypi). Everything went through the
platform's page-fetch service, which (a) cannot set the iPhone-Safari UA, (b) returns text extraction instead of
HTML, (c) caps PDFs at 30 pages, and (d) does not execute JavaScript. Anything below failed on (c) or (d), or the
host answered 5xx/404 on every path I could construct.

---

### 1. UCI Bicocca — per-day schedule, especially ven 13 nov
URL: https://ucicinemas.it/cinema/uci-cinemas-bicocca-milano
Should contain: showtimes per day for 11–15 Nov (page shows the tab strip "oggi / mer 11 nov / gio 12 nov / ven 13 nov /
sab 14 nov / dom 15 nov" and would print "Stai guardando la programmazione di venerdì 13 novembre" plus the film grid).
Why not fetched: day tabs are client-side; the server returns the 10 Nov grid regardless of URL.
Attempts: (1) `?date=2026-11-13` → ignored, same 10 Nov payload; (2) `/cinema/uci-cinemas-bicocca-milano/info` → 404;
(3) `/prezzi` → 404; (4) `/cinema/uci-cinemas-bicocca-milano/2026-11-13` → 404; (5) `/api/showtimes/5068?date=2026-11-13`
→ 404; (6) `/film/se-domani-non-torno` → per-film page, cinema selector is JS; (7) mobile/desktop variants both resolve
to the same Next.js `_ipx` SPA shell; (8) iPhone UA impossible from this sandbox; (9) Wayback has no Nov-2026 capture.
Also want: the same page for https://ucicinemas.it/cinema/uci-cinemas-certosa-milano (its extraction came back as an
empty showtimes shell + only promo banners).
Save as: uci-bicocca__schedule__2026-11-13.webarchive (and 14, 15), uci-certosa__schedule__<date>.

### 2. UCI — general ticket tariff / supplements (IMAX, XL, 3D, booking fee)
URL: https://ucicinemas.it/ and https://ucicinemas.it/promozioni (there is no `/prezzi` page)
Should contain: intero/ridotto weekday vs weekend, 3D/XL/IMAX supplements, myUCI/Cinefans card pricing, online fee.
Why not fetched: no tariff page located; only per-showtime "Da 6,90 € / Da 7,90 € / Da 8,40 €" leaks onto venue pages.
Attempts: (1) https://ucicinemas.it/prezzi → 404; (2) https://ucicinemas.it/cinema/uci-cinemas-bicocca-milano/info →
404; (3) `/promozioni/offerte/scegli-il-tuo-posto-scegli-il-tuo-prezzo` exists but is seat-map pricing prose, not a
tariff table; (4) site search for "listino" → nothing; (5) `promoprimavera.ucicinemas.it` / `wearefamily.ucicinemas.it`
are stale campaign microsites (2019), not current tariffs.

### 3. Notorious Merlata Bloom — full weekly grid 12–18 Nov
URL: https://www.notoriouscinemas.it/merlata/index.php?week=next
Should contain: all films + all showtimes Thu 12 → Wed 18 Nov (only "Godzilla Minus Zero" survives in text extraction;
the rest of the grid is a JS carousel).
Why not fetched: JS carousel; the advertised print view is broken for this venue only.
Attempts: (1) `?week=next` → 1 title; (2) https://www.notoriouscinemas.it/merlata/printProg.php (linked from the page)
→ 404 Object not found; (3) `/gloria/printProg.php?week=next` works for Gloria but ignores `week`, so the print view
cannot be steered; (4) `index.php?week=next&print=1` → same carousel; (5) per-film pages `generic/scheda.php?id=…`
carry no schedules.

### 4. Piccolo Grande Cinema 19 — Venerdì 13, Sabato 14, Domenica 15 novembre
URL: https://www.cinetecamilano.it/wp-content/uploads/2026/11/PGC2026_CALENDARIO_DIGITALE_V2.pdf
Should contain: the rest of the festival calendar — notably **Fri 13 Nov, Arlecchino: "Youth – Homecoming" (Wang Bing)
+ masterclass**, **Sat 14 Nov: Haile Gerima with "Black Lions – Roman Wolves"**, **Sun 15 Nov 17:00 MIC: "Messalina"
(1923, restored) closing event**.
Why not fetched: PDF text extraction stops at 30 pages; my capture ends at "Giovedì 12 novembre".
Attempts: (1) PDF chunk 0 → days 5–11; (2) PDF chunk 1 → 12 Nov only, `hasMore:false` (30-page cap);
(3) https://www.cinetecamilano.it/evento/piccolo-grande-cinema-2026/ → prose only, no timetable;
(4) https://mic.cinetecadimilano.18tickets.it/ and arlecchino.cinetecadimilano.18tickets.it → film-by-film, JS dates;
(5) https://www.cinetecamilano.it/film/ listing → only current-day showtimes.
Save as: pgc2026-calendario.pdf (the file itself) + the three day pages from the 18tickets subsites.

### 5. Anteo Palazzo del Cinema / CityLife Anteo / Ariosto / Apollo — schedules + single ticket price
URLs: https://anteo.spaziocinema.18tickets.it/ , https://citylife.spaziocinema.18tickets.it/ ,
https://ariosto.spaziocinema.18tickets.it/ , https://www.spaziocinema.info/cinema
Should contain: per-day showtimes 6–15 Nov and the **intero/ridotto single-ticket tariff** (Anteo's own site publishes
subscriptions only). IMPORTANT finding: the 18tickets "Dates" strip offers **only 10 and 11 November** — Anteo sells on a
rolling ~2-day window, so 12–15 Nov (incl. Fri 13) are simply not on sale yet. A human should re-open this on Thu 12 /
Fri 13 Nov to archive the correct days.
Why not fetched: 18tickets is a JS SPA — 19 chunks of film carousel, no day grid, no price until seat selection;
spaziocinema.info's "prezzi" paths do not exist.
Attempts: (1) https://www.spaziocinema.info/milano/prezzi → 404; (2) /milano/cinema/anteo-palazzo-del-cinema → 404;
(3) /cinema/le-sale/milano/anteo-palazzo-del-cinema → 200 but it is the private-hire page; (4) the abbonamenti page →
cards only; (5) https://anteo.spaziocinema.18tickets.it/film/125614 → times for 10 Nov, prices only after seat pick;
(6) https://www.spaziocinema.info/milano homepage → promo teasers ("riVediamoli … €3", "Colazione al cinema €5,50").

### 6. Cinema Mexico (via Savona 57)
URLs: https://www.cinemamexico.it/ , http://www.cinemamexico.it/ , https://cinemamexico.it/
Should contain: programme 6–15 Nov and prices.
Why not fetched: all three forms return **HTTP 500** ("ARR-OK … The domain may not be inserted correctly on Rewrite
Maps") — the site is misconfigured at the host, not blocking me.
Attempts: https www → 500; http www → 500; https apex → 500; (4) Wayback snapshot
https://web.archive.org/web/20260917111403/http://www.cinemamexico.it/ → **the archived page is also HTTP 500**, so the
origin has been broken since >= 17 Sep 2026; (5) no 18tickets/WebTic/DICE presence found for the venue.
NEW LEAD for a human: the venue's ticketing may run on cinetel/webtic under a different host — check the cinema's
Facebook/Instagram bio (facebook.com/cinemamexico).

### 7. Arcobaleno Film Center — schedule (Fri 13 Nov especially)
URL: https://secure.webtic.it/angwt/webtic.aspx?pu=…#/local/it/33/5066  (WebTic local id **5066**), entry point
https://www.webtic.it/#/shopping?action=loadLocal&localId=5066
Should contain: the day-by-day grid + the price shown per performance before checkout.
Why not fetched: WebTic is a fully client-side SPA; the fetch service returns only the shell.
Attempts: (1) https://www.arcobalenofilmcenter.it/ → no such host; (2) https://www.filmmakerfest.com/ → festival news
only, no cinema grid; (3) filmmakerfest biglietti page → tariffs but no timetable; (4) webtic deep link → SPA shell;
(5) search for a WebTic JSON endpoint (`/api/local/5066`) → not discoverable from outside.

### 8. CineTeatro Arcobaleno — the "Prezzi Film" block + 6–13 Nov (if any)
URL: https://www.cinearcobaleno.com/programmazione/
Should contain: price sidebar (intero €8,00; ridotto €5,00 4–17/over 65; gratis ≤3 anni e disabilità; **lunedì intero
€6,50 / ridotto €5,00**) and any 6–13 Nov screenings (page's first future date was Sat 14 Nov).
Why not fetched: the price block sits outside the extracted article body; no separate /prezzi page exists.
Attempts: (1) /prezzi/ → 404 template; (2) / → hero only; (3) /programmazione/ → schedule without the sidebar;
(4) ticket.cinebot.it per-event pages → checkout requires a person (and I must not enter personal data).

### 9. Parish / community halls (ITL Cinema – ACEC Milano)
URL: https://www.sdcmilano.it/sale-della-comunita (filter "Località: MILANO"), per-sala sheets like
Cinequattro Stella (via Pezzotti 53), Sala Oscar (via Lattanzio 58), Osoppo San Protaso (via Osoppo 2), Sala Wagner
(p.zza Wagner 2)
Should contain: per-sala programme for 6–15 Nov and the (usually €5–6) parish tariff.
Why not fetched: the database is a Leaflet map widget — extraction returns map tiles and marker gifs, no rows.
Attempts: (1) /sale-della-comunita → map junk; (2) guessed `?localita=Milano` filter (form is JS-submitted);
(3) https://www.sdcmilano.it/itl-cinema → circuit description, no per-sala data; (4) individual parish sites not
identified yet (needs the per-sala sheet URLs from a real browser).

### 10. Cinema Beltrade — Sat 14 / Sun 15 Nov and the cinema's own tariff
URLs: http://www.cinemabeltrade.net/ (= https://bandhi.it/bah/beltrade/), https://dice.fm/venue/cinema-beltrade-bd3k
Should contain: the rest of the week (my DICE capture ends mid-Friday-13 list) and Beltrade's own price table
(DICE shows "From €7", special events "From €9").
Why not fetched: DICE list was cut by the fetch chunk boundary; the WordPress site is 17 chunks of image markup and
has no /prezzi/ page (404).
Attempts: (1) bandhi.it/bah/beltrade/ → huge markup, current-day block only; (2) /prezzi/ → 404;
(3) beltrade.it + www.beltrade.it → register.it parking page / 500; (4) DICE venue page → chunk 0 ends on Fri 13.

### 11. RESOLVED since the first pass (kept for the record)
- **Fondazione Prada – Cinema Godard** ✅ captured via its monthly PDF (`CinemaGodard_programma.pdf`): full Nov
  programme incl. Fri 13 Nov and all three price tiers.
- **Cinema San Fedele** ✅ captured on the correct domain **centrosanfedele.net** (the `.it` is a broken stub);
  calendar is walkable per day, and Fri 13 Nov genuinely has no screening.
- **Cinema Teatro Agnelli** ✗ NOT a Milan venue — footer: Parrocchia San Giovanni Bosco, via Paolo Sarpi 111, Torino.

### 11a. Newly found, needs a human
- **Multisala Colosseo** (viale Monte Nero 84) + **Multisala Eliseo**, both run by **Il Regno del Cinema**:
  https://www.ilregnodelcinema.com/colosseo/ and https://www.ilregnodelcinema.com/eliseo/
  Should contain: day grids for 6–15 Nov and the tariff. Why not fetched: this CMS renders "Scegli il giorno" by JS and
  `printProg.php` (which works on notoriouscinemas.it/gloria) 302s to a generic landing here; `/colosseo/prezzi.php` errors.
  Attempts: (1) /colosseo/ → only 10–11 Nov for 5 titles; (2) /colosseo/printProg.php → 302 landing;
  (3) /colosseo/printProg.php?week=next → same; (4) /colosseo/prezzi.php → fetch error; (5) /generic/landing.php → venue
  picker only, no day selector; (6) /generic/landing_milano.php → not a schedule page.

### 11b. Still open
- **Sala Oscar / Cinema Teatro Oscar** (via Lattanzio 58, Milano): needs the sala's own site — the municipal page
  `fareimpresa.comune.milano.it/web/municipio-4/-/cineforum-oscar` is an older season (€5,00 / under-20 €3,00, two
  shows every Monday 15:15 & 21:00, which lands on **Mon 9 Nov** in our window).
- **Cinequattro Stella** (via Pezzotti 53) and **Sala Wagner** (p.zza Wagner 2): parish pages not identified yet.
- **Sala Wagner / Osoppo San Protaso** individual parish sheets (see #9).
- **AriAnteo pop-ups** (Palazzo Reale, Fabbrica del Vapore, Incoronata): off-season in November, but specials may exist:
  https://www.spaziocinema.info/milano/eventi-e-rassegne
- **Wayback snapshots for 6–9 Nov** (already-past days): `web.archive.org/web/2026*/<venue schedule URL>` — not
  reachable through the fetch service; open in Safari if the past days matter.

