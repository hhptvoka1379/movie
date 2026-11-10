# COVERAGE — Milan cinema schedules & prices, 6–15 Nov 2026 (capture date 2026-11-10, ~10:30–11:30 CET)

Transport reality first, because it shapes everything below: **this sandbox cannot open arbitrary HTTP directly.**
`curl` to cinema hosts fails (exit 6/35 — egress allow-list is github.com, api.github.com, codeload.github.com,
registry.npmjs.org, pypi.org, files.pythonhosted.org). Playwright is unusable (browser binaries come from
cdn.playwright.dev, blocked) and GitHub Actions cannot be pushed (token lacks `workflows` permission).
Every capture therefore went through the platform's server-side page-fetch service, which returns **text/markdown
extraction (and PDF text), not byte-exact HTML**, with a default UA — the mandated iPhone-Safari UA could not be set.
See MANIFEST.json → `transport`.

Also: today is Tue 10 Nov 2026. **6–9 Nov are already in the past**, so venues no longer publish them. Wayback was
tried for those days and for the JS-only grids: it holds **no Nov-2026 captures** of these pages (cinearcobaleno
/programmazione: 28 captures, newest 19 May 2026; uci-bicocca: 6 captures, newest 24 Sep 2026) and silently serves the
nearest older snapshot, so past days cannot be reconstructed that way.

Legend: ✅ captured · 🟡 partial (see note) · ⬜ nothing published for that date · ❌ not captured (gap)

## 1. Schedule matrix (venue × date)

| venue (id) | 6 Fr | 7 Sa | 8 Su | 9 Mo | 10 Tu | 11 We | 12 Th | 13 **Fr** | 14 Sa | 15 Su |
|---|---|---|---|---|---|---|---|---|---|---|
| uci-bicocca | ⬜ | ⬜ | ⬜ | ⬜ | ✅ | 🟡 tab only | 🟡 tab only | 🟡 tab only | 🟡 tab only | 🟡 tab only |
| uci-certosa (unlisted/possibly closed) | – | – | – | – | ❌ shell | ❌ | ❌ | ❌ | ❌ | ❌ |
| notorious-merlata | ⬜ | ⬜ | ⬜ | 🟡 4 titles | ✅ 4 titles | ✅ 4 titles | 🟡 Godzilla only | 🟡 Godzilla only | 🟡 Godzilla only | 🟡 Godzilla only |
| notorious-gloria | ✅ 4 titles | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ not yet published | ❌ | ❌ | ❌ |
| anteo-palazzo | ❌ | ❌ | ❌ | ❌ | 🟡 1 film | ❌ | ❌ | ❌ | ❌ | ❌ |
| citylife-anteo | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| ariosto-spaziocinema | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| apollo-spaziocinema | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| cineteca-arlecchino (PGC 19) | ⬜ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ PDF cap | ❌ | ❌ |
| cineteca-mic (PGC + Cinema da paura) | ⬜ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ 1 event | ❌ |
| cinema-beltrade | ⬜ | ⬜ | ⬜ | ⬜ | ✅ | ✅ | ✅ | ✅ 7 titles | 🟡 cut off | 🟡 cut off |
| cineteatro-arcobaleno | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ✅ | ✅ |
| arcobaleno-filmcenter | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| cinema-mexico | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| parish halls (ITL/ACEC: Cinequattro Stella, Oscar, Osoppo San Protaso, Wagner) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| fondazione-prada / cinema-godard | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| cinema-san-fedele | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| the-space-odeon (via S. Radegonda) | 🚫 closed — venue under redevelopment, cinema reopening slated 2nd half 2027 (press, Nov 2025); no schedule exists to capture |

Notes: 🟡 UCI rows — the venue page prints the day-tab calendar and "Stai guardando la programmazione di martedì 10
novembre"; the per-day grids for 11–15 Nov are injected by JS from a tab click and the server ignores `?date=`.
🟡 Notorious — the weekly grid is a JS carousel; only the "consiglia" titles surfaced. Beltrade 14–15 Nov were past
the fetch chunk boundary (the page keeps listing them).

## 2. Prices (the priority)

| venue | prices? | what the capture proves | source URL |
|---|---|---|---|
| notorious-merlata | ✅ full tariff | Festivo intero €10,70/rid. €8,90; feriale dopo 18.55 €10,50/8,40; pomeridiano €8,50/6,50; mercoledì promo €8,50; matinée €6,00; Notorious Card €38/5; online fee €1,20; Top film +€1,00 / Super Top +€1,50 | https://www.notoriouscinemas.it/merlata/prezzi.php |
| notorious-gloria | ✅ full tariff | Festivo/feriale intero €9,00 rid. €6,50; pomeridiano €6,50/5,00; mercoledì €6,50; matinée €5,00; Card €30/5; fee €1,20 | https://www.notoriouscinemas.it/gloria/prezzi.php |
| uci-bicocca | 🟡 per-showtime | page prints "Da 6,90 €" (2D), "Da 7,90 €" (XL), "Da 8,40 €" (3D) before checkout — i.e. min price per format on 10 Nov; general tariff page not found | https://ucicinemas.it/cinema/uci-cinemas-bicocca-milano |
| cineteca-mic | ✅ | sala cinema intero €6,50 / cinetessera+under25+univ. €5 / disabile €3,50 / family €6 a testa; museo €9 / €7 / €6; Cinetessera €15 (under 25 €3) | https://www.cinetecamilano.it/luogo/cineteca-milano-mic/ |
| cineteca-* (PGC festival) | ✅ | PGC intero €5,00; Cinetessera 2026 €3,00; abbonamento Super8 €12/8; Gerima Tour €9; masterclass e trilogia Wang Bing gratis con prenotazione | PGC2026_CALENDARIO_DIGITALE_V2.pdf |
| arcobaleno-filmcenter + cineteca-arlecchino | ✅ | Intero €8,50 / ridotto €7,50 (under 25, over 65) / VR €4 / disabilità €5; MIC intero €5 | https://www.filmmakerfest.com/Festival/2542 |
| anteo-palazzo | 🟡 cards only | Tessere: 7 spett. €42, 10 spett. €65, 6 serali €21, Under25 €20/28gg, Tessera Milano 20ingr. €140 / 10ingr. €70; single intero/ridotto NOT published on that page | https://www.spaziocinema.info/cinema/abbonamenti-e-tessere/milano/anteo-palazzo-del-cinema |
| cinema-beltrade | 🟡 "From" prices | DICE lists every performance "From €7" and the 13 Nov *Mustang* event "From €9"; own tariff page 404 | https://dice.fm/venue/cinema-beltrade-bd3k |
| cineteatro-arcobaleno | ❌ | a "Prezzi Film" block exists on the programmazione page (indexed: intero €8,00 / ridotto €5,00 / lunedì €6,50) but it did not come through in the extraction → needs a Safari archive | https://www.cinearcobaleno.com/programmazione/ |
| uci-certosa, arcobaleno-filmcenter(schedule), cinema-mexico, parish halls, prada/godard, san fedele | ❌ | see LINKS-FOR-HUMAN.md | — |

## 3. Venues discovered that were not obvious

- **Filmmaker Fest (filmmakerfest.com) runs Arcobaleno Film Center** (via Friuli) *and* publishes the ticket prices
  for Cineteca Milano Arlecchino and MIC. Its WebTic local id is 5066 (`secure.webtic.it/... lid=5066`).
- **Notorious Cinemas has two Milan venues**, not one: *Merlata Bloom Milano* and **Gloria Milano** (a former UCI
  "Multisala Gloria" slot appears in UCI's own discount list, so the Gloria banner changed hands — worth verifying).
- **spaziocinema.info = the Anteo group** (Anteo Palazzo del Cinema, CityLife Anteo, Ariosto, Apollo spazioCinema,
  plus AriAnteo open-air/pop-up labels Incoronata, CityLife, Fabbrica del Vapore, Palazzo Reale). It is *not*
  "Circuito Cinema": **circuitocinema.com is a Rome/Bologna circuit** (Nazionale, Giulio Cesare, 4 Fontane, Olimpia,
  Metropolitan, Fossolo…) and was deliberately excluded as out-of-scope after checking its venue list.
- **Cineteca Milano** is three rooms: Arlecchino (via San Pietro all'Orto 9), MIC (v.le Fulvio Testi 121) and
  **Metropolis in Paderno Dugnano — outside Milan city**, so excluded from the city grid but present in the
  Piccolo Grande Cinema programme (7–15 Nov, which heavily covers Fri 13 Nov: Wang Bing masterclass).
- **Parish/community circuit**: 74 "Sale della Comunità" in the diocese, 62 programmed by **ITL Cinema**
  (sdcmilano.it). Milan-city ones identified: Cinequattro Stella (via Pezzotti 53), Sala Oscar (via Lattanzio 58),
  Osoppo San Protaso (via Osoppo 2), Sala Wagner (p.zza Wagner 2). Their schedules live on the individual parish
  sites/ITL, not on a city-wide grid.
- **CineTeatro Arcobaleno** (cinearcobaleno.com) is a *different* venue from **Arcobaleno Film Center**; it sells via
  **cinebot** (`ticket.cinebot.it/cinearcobaleno/`), a platform not in the brief's list.
- **Cinema Beltrade's** real domain is **cinemabeltrade.net**, which now resolves into a shared WordPress network
  `bandhi.it/bah/beltrade/` ("Barz And Hippo"); beltrade.it is a parked register.it page.
- **Only ONE UCI is inside Milan city**: UCI Bicocca. UCI's own index files Lissone, MilanoFiori (Assago) and Pioltello
  under "Milano", and has **no Certosa entry at all** although a Certosa page still resolves — treat Certosa as
  unlisted/closed until a human confirms (see uci-cinemas/ucicinemas.it__venue-index__all.md).
- **cinemamexico.it has been serving HTTP 500 since at least 17 Sep 2026** — the Wayback capture of that date shows the
  same "ARR-OK / Rewrite Maps" error, so this is a broken origin, not a bot block.
- **The Space Odeon (Duomo)** has no screenings: the building is being redeveloped, cinema reopening announced for
  H2 2027.
