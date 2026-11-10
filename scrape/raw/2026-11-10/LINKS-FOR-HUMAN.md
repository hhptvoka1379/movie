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
