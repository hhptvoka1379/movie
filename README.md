# Cinema site

A static site that shows film showtimes for local cinemas on one page. A scraper
collects the showtimes into `data/showtimes.json`, a poster script attaches
TMDB posters, and the page is plain HTML served from the project root.

## Usage

Scrape showtimes (writes `data/showtimes.json`):

```sh
cd scrape && node run.mjs
```

Fetch posters (needs a TMDB API key; writes `assets/posters/` and `data/posters.json`):

```sh
TMDB_API_KEY=your_key node scrape/posters.mjs
```

or put `TMDB_API_KEY=your_key` in a `.env` file in the project root. `.env` is
gitignored. Useful flags: `--dry` (search and print only, write nothing),
`--force` (re-download existing posters), `--in <path>` (use another input file).

Serve the site:

```sh
python3 -m http.server 8000
```

then open http://localhost:8000.

## Testing

Run the scraper unit tests, offline pipeline verifier, and end-to-end Playwright + `axe-core` smoke suite (`390x844` and `1280x800`):

```sh
cd scrape && npm test
cd scrape && npm run smoke
```

See [`docs/QA.md`](docs/QA.md) for full venue/price coverage and QA notes.

## Attribution

This product uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.

Required wording and logo rules from the TMDB API terms of use
(https://www.themoviedb.org/api-terms-of-use, read 2026-11-06): the notice must
appear prominently in the application and states the product is not endorsed,
certified or otherwise approved by TMDB. The TMDB logo must be less prominent
than this project's own marks and must not imply endorsement. The terms do not
specify a link requirement. Use is limited to non-commercial purposes, and the
TMDB content may not be used to train machine learning or AI systems. Check the
terms page before any change in use; the wording above is the one to keep.

Map data: OpenStreetMap contributors (© OpenStreetMap, ODbL), via Nominatim.
Use Nominatim under its usage policy (https://operations.osmfoundation.org/policies/nominatim/),
which limits request rates and requires attribution.

## Data sources

- Showtimes: scraped from the cinema websites by `scrape/run.mjs`. Re-run it to refresh.
- Film metadata and posters: The Movie Database (TMDB) search API. `scrape/logs/tmdb-matches.log`
  records each match decision (query, matched title, TMDB id, confidence, or NO MATCH). Each run
  overwrites that log.
- Posters are small (w185) thumbnails and are stored locally in `assets/posters/`.
