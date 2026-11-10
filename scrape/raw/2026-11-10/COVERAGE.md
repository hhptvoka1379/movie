# COVERAGE (fetched 2026-11-10, first-party only)

Schedule cell: `Y` = ISO date found in saved JSON/HTML (not parsed or validated), `.` = not found. Raw capture only.

| venue | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | price source (has € in page) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| anteo-palazzo | Y | Y | . | Y | Y | Y | Y | Y | Y | Y | spaziocinema.info_milano__schedule__all.html |
| arcobaleno | . | . | . | . | Y | Y | . | . | . | . | webtic_xhr_7_wtjsonservices_ashx_getLocalInfo__schedule__all.json |
| ariosto-anteo | Y | Y | . | Y | Y | Y | Y | Y | Y | Y | spaziocinema.info_milano__schedule__all.html; spaziocinema.info_rendered__cinema_tariffe_milano_ariosto__prices__all.html |
| arlecchino | . | . | . | . | Y | Y | Y | Y | Y | Y | cinetecamilano.it_luogo_cineteca_milano_arlecchino___schedule__all.html (full 8.50, reduced 7.50/5, Thu 6.50) |
| auditorium-don-bosco | . | . | . | . | . | . | . | Y | . | . | MISSING |
| beltrade | . | . | . | . | Y | Y | Y | Y | Y | Y | bandhi.it_bah_beltrade_biglietti___prices__all.html |
| centrale | . | . | . | . | Y | Y | . | . | . | . | multisalacentrale.it_rendered____prices__all.html |
| cinemino | . | . | . | . | Y | . | . | Y | . | . | MISSING |
| citylife-anteo | Y | Y | . | Y | Y | Y | Y | Y | Y | Y | spaziocinema.info_cinema_abbonamenti_e_tessere__prices__all.html; spaziocinema.info_milano__schedule__all.html |
| colosseo | . | . | . | . | Y | Y | . | . | . | . | ilregnodelcinema.com_rendered__colosseo_prezzi_php__prices__all.html; webtic_xhr_27_wtjsonservices_ashx_getLocalInfo__schedule__all.json |
| ducale | . | . | . | . | Y | Y | . | . | . | . | webtic_xhr_22_wtjsonservices_ashx_getLocalInfo__schedule__all.json |
| eliseo | . | . | . | . | Y | Y | . | . | . | . | ilregnodelcinema.com_rendered__eliseo_prezzi_php__prices__all.html; webtic_xhr_15_wtjsonservices_ashx_getLocalInfo__schedule__all.json |
| gloria | . | . | . | . | Y | Y | . | . | . | . | notoriouscinemas.it_gloria_infocinema_php__prices__all.html; notoriouscinemas.it_gloria_prezzi_php__prices__all.html |
| mexico | . | . | . | . | . | Y | Y | Y | . | . | progettolumiere.it_rendered__mexico_contact_php__prices__all.html |
| orfeo | . | . | Y | Y | Y | Y | . | . | . | . | orfeomultisala.com_prezzi___prices__all.html |
| osoppo | . | . | . | . | Y | . | . | . | . | . | MISSING |
| palestrina | . | . | . | . | . | Y | . | . | . | . | progettolumiere.it_rendered__palestrina_contact_php__prices__all.html |
| plinius | . | . | . | . | Y | Y | Y | Y | Y | Y | multisalaplinius.com_card_e_abbonamenti___prices__all.html; multisalaplinius.com_informazioni_e_prezzi___prices__all.html |
| space-odeon | . | . | . | Y | . | Y | Y | . | . | . | MISSING |
| uci-bicocca | Y | . | . | Y | Y | Y | Y | Y | Y | Y | ucicinemas.it_rendered__cinema_uci_cinemas_bicocca_mi__prices__all.html; webtic_xhr_6_wtjsonservices_ashx_getLocalInfo__schedule__all.json |
| uci-certosa | . | . | . | . | Y | Y | Y | Y | Y | Y | cinelandia.it_faq___prices__all.html |

## Findings
- WebTic venues (UCI Bicocca/Certosa, Plinius full to 15 Nov; Gloria, Arcobaleno, Ducale, Colosseo, Eliseo, Centrale, Orfeo only to 11 Nov): WebTic publishes about 2 days ahead for these, so Fri 13 Nov is NOT published yet. Re-fetch on 11-12 Nov.
- Anteo group (CityLife, Ariosto, Palazzo del Cinema): per-day calendar JSON saved for every day 6-15 Nov.
- The Space Cinema: no Milan-city site exists in its own cinema list (nearest Cerro Maggiore, Rozzano, Vimercate), so only the cinema list is kept.
- Newly found: Il Cinemino (ilcinemino.it), SdC Milano site (sdcmilano.it) as the Osoppo parent.
- Beltrade (bandhi.it) fetched as static HTML; not rendered per day.
- Not covered: Spazio Oberdan, Fondazione Prada, Cinema del Carbone, other parish halls, museum screenings.

## Second pass
- Arlecchino schedule 10-15 Nov captured from the rendered 18tickets listing DOM in the built-in browser pane at human pace (file `arlecchino/18tickets_listing-dom_extract__schedule__2026-11-10_to_15.json`, 18 showtimes). Dates 6-9 Nov are in the past and not listed. The earlier curl 429s are avoided by using the already-rendered page instead of per-performance requests.
- Arlecchino prices were already in the saved venue page; the first coverage check missed them.

## Third pass (built-in browser pane, human pace; Milan city only)
- Il Cinemino: calendar published only for Tue 10 (4 shows) and Fri 13 Nov (Balcanica, 21:30); nothing listed 11, 12, 14, 15. Prices: full 9.00 + tessera, reduced 7.00, carnets 22/35/48 (cinemino/*ingressi*).
- Auditorium Don Bosco (Cinebazin): hours Sun 16:00, Mon/Wed/Fri 21:00; La Grazia 8-13 Nov. No price stated anywhere on the site (members' tessera).
- Osoppo: real SdC page found (/sale-della-comunita/sala-osoppo-san-protaso); parish's own cinema page 404, parish home has no cinema link. No schedule or price: still a gap.
- Teatro Oscar (Via Lattanzio 58, Milano): a theatre with a Cineforum menu; no film dates for 6-15 Nov found on incamminati.teatrooscar.it. Not a film venue for this window.
- Spazio Oberdan: still 503, in LINKS-FOR-HUMAN.
