# COVERAGE — Milan cinema schedules & prices, 6–15 Nov 2026 (captures 2026-11-10, ~10:30–12:00 CET)

Transport reality first, because it shapes everything below: **this sandbox cannot open arbitrary HTTP directly.**
`curl` to cinema hosts fails (exit 6/35 — egress allow-list is github.com, api.github.com, codeload.github.com,
registry.npmjs.org, pypi.org, files.pythonhosted.org). Playwright is unusable (binaries come from cdn.playwright.dev,
blocked) and GitHub Actions cannot be pushed (token lacks `workflows` permission). Every capture therefore went
through the platform's server-side page-fetch service → **text/markdown extraction and PDF text, not byte-exact HTML**,
default UA (the mandated iPhone-Safari UA is not settable). See MANIFEST.json → `transport`.

Today is Tue 10 Nov 2026, so **6–9 Nov are already past**; venues no longer publish them. Wayback holds **no Nov-2026
captures** of these pages (cinearcobaleno /programmazione: newest 19 May 2026; uci-bicocca: newest 24 Sep 2026) and
silently serves the nearest older snapshot, so past days cannot be reconstructed there.

Legend: ✅ captured · 🟡 partial · ⬜ nothing published · ❌ gap · 🚫 venue closed

## 1. Schedule matrix (venue × date)

| venue (id) | 6 Fr | 7 Sa | 8 Su | 9 Mo | 10 Tu | 11 We | 12 Th | 13 **Fr** | 14 Sa | 15 Su |
|---|---|---|---|---|---|---|---|---|---|---|
| fondazione-prada (Cinema Godard) | ✅ | ✅ | ✅ | ⬜ | ⬜ | ⬜ | ✅ | ✅ | ✅ | ✅ |
| cineteca-arlecchino (PGC 19) | ⬜ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 18:30 Wang Bing masterclass (PDF cap) | ❌ | ❌ |
| cineteca-mic (PGC + Cinema da paura) | ⬜ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ 1 event | ❌ |
| cinema-beltrade | ⬜ | ⬜ | ⬜ | ⬜ | ✅ | ✅ | ✅ | ✅ 7 titles | 🟡 cut off | 🟡 cut off |
| cinema-san-fedele | ⬜ | ⬜ | ⬜ | ⬜ | ✅ 15.15 | ⬜ | ✅ 15.00+20.00 | ⬜ none (Tue/Thu only) | ⬜ | ⬜ |
| notorious-gloria | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| notorious-merlata | ⬜ | ⬜ | ⬜ | 🟡 4 titles | ✅ 4 titles | ✅ 4 titles | 🟡 Godzilla | 🟡 Godzilla | 🟡 Godzilla | 🟡 Godzilla |
| uci-bicocca | ⬜ | ⬜ | ⬜ | ⬜ | ✅ | 🟡 tab only | 🟡 tab only | 🟡 tab only | 🟡 tab only | 🟡 tab only |
| anteo-palazzo | ⬜ | ⬜ | ⬜ | ⬜ | 🟡 1 film | 🟡 1 film | ❌ | ❌ | ❌ | ❌ |
| citylife-anteo | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| ariosto-spaziocinema | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| apollo-spaziocinema | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| cineteatro-arcobaleno | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ✅ | ✅ |
| arcobaleno-filmcenter | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| cinema-mexico | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| cinema-colosseo (Il Regno del Cinema) | ❌ | ❌ | ❌ | ❌ | ✅ 5 titles | ✅ 5 titles | ❌ | ❌ | ❌ | ❌ |
| cinema-eliseo (Il Regno del Cinema) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| sala-oscar (via Lattanzio 58) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| other parish halls (Cinequattro Stella, Osoppo San Protaso, Wagner) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| uci-certosa (unlisted, possibly closed) | – | – | – | – | ❌ shell | ❌ | ❌ | ❌ | ❌ | ❌ |
| the-space-odeon (via S. Radegonda) | 🚫 closed for redevelopment, cinema reopening slated H2 2027 — nothing to capture |

Notes: **Anteo** — 18tickets exposes only a **rolling ~2-day sale window** (the date strip offers 10 and 11 Nov only),
which is why 12–15 Nov are absent there rather than merely hidden; `?ref_date=` is accepted in links but ignored by
the server. **UCI** — per-day grids are injected on tab click, `?date=`/`/2026-11-13`/`/api/showtimes` all 404 or
return the 10 Nov payload. **Notorious Merlata** — weekly grid is a JS carousel; Merlata's print view 404s (Gloria's works). **Arlecchino Fri 13 Nov** —
the festival PDF extract dies at 12 Nov, but the venue page itself gives the 18:30 Wang Bing masterclass (booking link
`arlecchino.cinetecadimilano.18tickets.it/film/120533`), so 13 Nov is no longer a bare gap for that room.

## 2. Prices (the priority)

| venue | prices? | what the capture proves | source URL |
|---|---|---|---|
| fondazione-prada / Cinema Godard | ✅ full, tiered | base **Intero 6 € / Ridotto 4 €** (under 26, over 65); selected first-run titles **8,50 / 7 €** (incl. *Look Back*, *Wild Horse Nine*, *Fjord*); *2001* **10 / 8,50 €**; *You Can See Everything* **15 / 13 €**; free for disabled + companion; Human Brains free | CinemaGodard_programma.pdf |
| notorious-merlata | ✅ full tariff | festivo intero €10,70/rid. €8,90; feriale dopo 18.55 €10,50/8,40; pomeridiano €8,50/6,50; mercoledì €8,50; matinée €6,00; Card €38/5; fee €1,20; Top +€1,00 / Super Top +€1,50 | notoriouscinemas.it/merlata/prezzi.php |
| notorious-gloria | ✅ full tariff | festivo/feriale €9,00/6,50; pomeridiano €6,50/5,00; mercoledì €6,50; matinée €5,00; Card €30/5; fee €1,20 | notoriouscinemas.it/gloria/prezzi.php |
| uci-bicocca | 🟡 per-showtime | "Da 6,90 €" (2D), "Da 7,90 €" (XL), "Da 8,40 €" (3D) printed pre-checkout on 10 Nov | ucicinemas.it/cinema/uci-cinemas-bicocca-milano |
| cineteca-mic | ✅ | sala cinema €6,50 / cinetessera+under25+univ. €5 / disabile €3,50 / family €6 a testa; museo €9 / €7 / €6; Cinetessera €15 (u25 €3) | cinetecamilano.it/luogo/cineteca-milano-mic/ |
| cineteca (PGC festival) | ✅ | PGC intero €5,00; Cinetessera 2026 €3,00; Super8 €12/8 proiezioni; Gerima Tour €9; masterclass + Wang Bing trilogy free w/ booking | PGC2026_CALENDARIO_DIGITALE_V2.pdf |
| arcobaleno-filmcenter + cineteca-arlecchino | ✅ | Intero €8,50 / ridotto €7,50 (u25, over 65) / VR €4 / disabilità €5; MIC intero €5 | filmmakerfest.com/Festival/2542 |
| cinema-san-fedele | 🟡 season block (page still headed "Stagione 2024-2025") | S.F.1 biglietto intero €8 / studenti €6; S.F.2 intero €7 / studenti €6; abbonamenti 20 film €88–108, Under 25 (10 film) €20, Oro 40 film €132–144 | centrosanfedele.net/cinema/abbonamenti-e-biglietti/ |
| anteo-palazzo | 🟡 cards only | tessere 7 spett. €42, 10 spett. €65, 6 serali €21, Under25 €20/28gg, Tessera Milano €140/20ingr. o €70/10; single intero/ridotto not published on that page | spaziocinema.info/…/abbonamenti-e-tessere/… |
| cinema-beltrade | 🟡 "From" | DICE: every performance "From €7"; *Mustang* + Kasia Smutniak (Fri 13) "From €9" | dice.fm/venue/cinema-beltrade-bd3k |
| cineteatro-arcobaleno | ❌ | a "Prezzi Film" block exists on the programmazione page (indexed text: intero €8,00 / ridotto €5,00 / lunedì €6,50) but did not come through extraction | cinearcobaleno.com/programmazione/ |
| sala-oscar | 🟡 municipal lead | Comune di Milano sportello page: biglietto €5,00 / ridotto under 20 €3,00, two shows each Monday 15:15 & 21:00 (that page is from a previous season — needs the sala's own tariff) | fareimpresa.comune.milano.it/web/municipio-4/-/cineforum-oscar |
| cinema-colosseo / cinema-eliseo | ❌ | no tariff page found (`/colosseo/prezzi.php` errors); per-showtime prices not printed in the extraction | — |
| uci-certosa, arcobaleno-filmcenter (schedules), cinema-mexico, other parish halls | ❌ | see LINKS-FOR-HUMAN.md | — |

## 3. Venues discovered / traps found

- **Cinema Godard (Fondazione Prada)** publishes a *monthly programme PDF* — far richer than its HTML page, and the only
  venue in this set with three price tiers by title.
- **Cinema San Fedele's real domain is `centrosanfedele.net`** (the `.it` serves a single image). It runs two cineforum
  rooms, **Tue 15:15 and Thu 15:15/20:45 only** — so Friday 13 Nov has no San Fedele screening at all.
- **Trap avoided: "Cinema Teatro Agnelli"** (cineteatroagnelli.it) looks exactly like a Milan parish "sala della
  Comunità", publishes clean prices and a live programme — but its footer reads *Parrocchia San Giovanni Bosco,
  Via Paolo Sarpi 111, 10135 **Torino***. It is in Turin, so it is deliberately **not** captured. Same trap family:
  "Cinema Famiglia" and the "Sala della Comunità di Noventa Vicentina" that surface on Milan-oriented queries.
- **Filmmaker Fest (filmmakerfest.com) runs Arcobaleno Film Center** (viale Tunisia 11) and publishes the prices for
  both Arcobaleno and Cineteca Milano Arlecchino; its WebTic local id is 5066. Arlecchino's 18tickets subsite also
  carries the **Filmmaker Festival 2026** line-up (Le rocce rosse, Selfie – Lato B, [Odio], Heaven, Ubersang…), i.e.
  Arlecchino is double-booked with PGC that week.
- **Notorious Cinemas has two Milan venues**: Merlata Bloom Milano **and Gloria Milano**.
- **Only ONE UCI is inside Milan city**: Bicocca. UCI's index files Lissone, MilanoFiori (Assago) and Pioltello under
  "Milano" and has **no Certosa entry** although a Certosa page still resolves — treat Certosa as unlisted/closed.
- **spaziocinema.info is the Anteo group** (Anteo Palazzo del Cinema, CityLife Anteo, Ariosto, Apollo spazioCinema, plus
  AriAnteo labels and "Fuoricinema"). It is **not** "Circuito Cinema": **circuitocinema.com is a Rome/Bologna circuit**
  (Nazionale, Giulio Cesare, 4 Fontane, Olimpia, Metropolitan, Fossolo…), excluded after checking its own venue list.
- **CineTeatro Arcobaleno** (cinearcobaleno.com) ≠ Arcobaleno Film Center; it sells via **cinebot**
  (`ticket.cinebot.it/cinearcobaleno/`).
- **Cinema Beltrade's** real domain is **cinemabeltrade.net**, now inside a shared WordPress network
  `bandhi.it/bah/beltrade/`; beltrade.it is a parked register.it page.
- **cinemamexico.it has served HTTP 500 since at least 17 Sep 2026** (Wayback shows the same ARR-OK error) — broken origin.
- **Il Regno del Cinema** (ilregnodelcinema.com) — one of the platforms named in the brief — runs **two Milan venues**:
  Multisala Colosseo (viale Monte Nero 84) **and Multisala Eliseo**. Careful: Milan's Eliseo (Regno del Cinema) is a
  different house from the Rome Eliseo in circuitocinema.com's list. Its print view redirects to a generic landing, so
  the day grid is JS-only.
- **The Space Odeon (Duomo)** is closed for redevelopment (reopening H2 2027).
