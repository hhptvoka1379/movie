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
