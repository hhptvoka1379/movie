#!/usr/bin/env node
// Scrapes Milan cinema showtimes for FROM..TO, normalizes them and writes ../data/showtimes.json.
// Usage: cd scrape && node run.mjs      (rerunnable; exit code 1 if a cinema errored unexpectedly)
//        node run.mjs --replay [logs]   (offline: rebuild from captured payloads, never writes)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { scrapeWebtic, webticToShowings, collectPrices, webticPolicy, webticBooking, mergeTariffPages } from './adapters/webtic.mjs';
import { scrapeAnteo, anteoToShowings } from './adapters/anteo.mjs';
import { scrapeTickets18, tickets18ToShowings } from './adapters/tickets18.mjs';
import { normalizeTitle, displayTitle, filmType, isNonFilm, MergeLog } from './lib/normalize.mjs';
import { ensureGeocoded } from './lib/geocode.mjs';
import { resolvePrice, ratesNote, cleanRates, coverageRow } from './lib/prices.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CINEMAS_FILE = path.join(HERE, 'cinemas.json');
// Swarm mode (parallel agents, one cinema group each, never touching the real data file):
//   SCRAPE_ONLY=id1,id2  run only these cinema ids
//   SCRAPE_OUT=path      write the rows to this file; logs go next to it (<path>.merges.log, <path>.prices.json)
//   SCRAPE_TO=YYYY-MM-DD last day to keep (default 2026-11-15)
const SWARM_OUT = process.env.SCRAPE_OUT ? path.resolve(process.env.SCRAPE_OUT) : null;
const SCRAPE_ONLY = process.env.SCRAPE_ONLY ? new Set(process.env.SCRAPE_ONLY.split(',').map(s => s.trim()).filter(Boolean)) : null;
const OUT_FILE = SWARM_OUT || path.join(ROOT, 'data', 'showtimes.json');
const MERGE_LOG = SWARM_OUT ? SWARM_OUT + '.merges.log' : path.join(HERE, 'logs', 'merges.log');
const FROM = '2026-11-06';
const TO = process.env.SCRAPE_TO || '2026-11-15';
const LANGS = new Set(['ita', 'vo', 'vos', 'other']);
const BLOCK_RE = /\b(403|429)\b|captcha|cloudflare|access denied|forbidden|too many requests|bot detection|blocked/i;
const PRICE_EVIDENCE = SWARM_OUT ? SWARM_OUT + '.prices.json' : path.join(HERE, 'logs', 'prices.json');

// --replay [dir]: rebuild a venue from a payload already captured in scrape/logs instead of
// fetching it. Runs the whole normalization, price and coverage path offline on a machine that
// cannot reach the cinema sites. Never writes: replay implies --dry-run unless --write is given.
const replayIdx = process.argv.indexOf('--replay');
const REPLAY = replayIdx >= 0;
const REPLAY_DIR = REPLAY
  ? path.resolve(HERE, (process.argv[replayIdx + 1] && !process.argv[replayIdx + 1].startsWith('--'))
      ? process.argv[replayIdx + 1] : 'logs')
  : null;

// --dry-run : scrape and report, but write neither data/showtimes.json nor logs/prices.json
// --no-prices: skip price capture (schedules only, price_eur stays null)
const DRY_RUN = process.argv.includes('--dry-run') || REPLAY;
// A replay only covers the venues that happen to have a capture, so writing its output would
// delete every other cinema from data/showtimes.json. Refuse instead of trusting a flag.
if (REPLAY && process.argv.includes('--write')) {
  console.error('\n!!!!! --replay cannot be combined with --write: a replay only covers the venues ' +
    'that have a capture,\nwriting it would drop every other cinema from data/showtimes.json. ' +
    'Run without --replay on a connected machine. !!!!!\n');
  process.exit(2);
}
const NO_PRICES = process.argv.includes('--no-prices');
const FORCE = process.argv.includes('--force');   // skip the pre-flight reachability check


// Origins the adapters need. A sandbox or a firewall that blocks them makes every cinema fail,
// so say so once, loudly, before the run wastes minutes producing nothing.
const NEEDED_ORIGINS = [
  ['webtic', 'https://www.webtic.it/'],
  ['spaziocinema', 'https://www.spaziocinema.info/milano/cinema'],
  ['18tickets', 'https://arlecchino.cinetecadimilano.18tickets.it/'],
  ['progettolumiere', 'https://www.progettolumiere.it/mexico/home.php'],
  ['cinebazin', 'https://www.cinebazin.it/new/'],
];

async function preflight() {
  const problems = [];
  let browser = null;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (e) {
    problems.push(`playwright cannot start a browser: ${String(e.message || e).split('\n')[0]}
      -> in scrape/: npm ci && npx playwright install chromium`);
  } finally {
    if (browser) await browser.close();
  }
  for (const [name, url] of NEEDED_ORIGINS) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 8000);
      const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctl.signal });
      clearTimeout(t);
      console.log(`[preflight] ${name}: reachable (HTTP ${res.status})`);
    } catch (e) {
      problems.push(`${name} (${url}) unreachable: ${String(e.message || e).split('\n')[0]}`);
    }
  }
  if (problems.length) {
    console.error(`\n!!!!! PRE-FLIGHT FAILED - the pipeline cannot fetch anything !!!!!\n` +
      problems.map(p => '  - ' + p).join('\n') +
      `\nNothing was written. Re-run on a machine that can reach the cinema sites,` +
      `\nor use --force to run anyway (each cinema will fail loudly).\n`);
    process.exit(2);
  }
}

// Generic (MyMovies) adapter is written by another agent; load it if present, else null.
async function loadGeneric() {
  const file = path.join(HERE, 'adapters', 'generic.mjs');
  if (!fs.existsSync(file)) return null;
  return import(pathToFileURL(file).href);
}

// Normalises what each adapter found about prices into { rates, source, reason }.
function buildPriceInfo(r, adapter) {
  if (NO_PRICES) return { rates: [], source: null, reason: null };
  if (adapter === 'webtic') {
    const p = r.prices || {};
    const rates = cleanRates(p.local && p.local.length ? p.local : (p.rates || []));
    const source = rates.length ? (p.sources || []).slice(0, 2).join(' ') : null;
    return { rates, source, reason: rates.length ? null : (p.reason || 'no tariff endpoint on the public page') };
  }
  const t = r.tariffs || {};
  const perFilm = [...((r.showings || []).filter(x => x.rates && x.rates.length).map(x => x.rates))].flat();
  const rates = cleanRates(perFilm.length ? perFilm : (t.rates || []));
  const source = rates.length ? (t.url || (r.showings || []).find(x => x.rates && x.rates.length)?.rates[0]?.source || null) : null;
  return { rates, source, reason: rates.length ? null : (t.reason || 'no public page states a price') };
}

// Reads a captured WebTic payload pair (logs/wt-<localId>.json scheduling, logs/wt-<localId>-info.json
// local info) and returns the same shape scrapeWebtic() would, or null when there is no capture.
function replayWebtic(localId, tariffUrls) {
  const schedFile = path.join(REPLAY_DIR, `wt-${localId}.json`);
  if (!fs.existsSync(schedFile)) return null;
  const payload = JSON.parse(fs.readFileSync(schedFile, 'utf8'));
  const scheduling = payload?.DS?.Scheduling;
  if (!scheduling) throw new Error(`replay: ${schedFile} has no DS.Scheduling payload`);
  const infoFile = path.join(REPLAY_DIR, `wt-${localId}-info.json`);
  const info = fs.existsSync(infoFile) ? JSON.parse(fs.readFileSync(infoFile, 'utf8')) : null;
  const got = { getFullScheduling: payload };
  if (info) got.getLocalInfo = info;
  const prices = collectPrices(got, [], localId);
  // A tariff page saved by an earlier live run can be replayed too: logs/wt-<localId>-tariff.json
  const tariffFile = path.join(REPLAY_DIR, `wt-${localId}-tariff.json`);
  const pages = fs.existsSync(tariffFile) ? JSON.parse(fs.readFileSync(tariffFile, 'utf8')) : [];
  mergeTariffPages(prices, pages);
  if (tariffUrls && !pages.length) console.log(`  [replay] tariff url(s) configured but no capture at ${tariffFile}`);
  return {
    scheduling, info, prices,
    policy: webticPolicy(info, pages),
    booking: webticBooking(localId),
  };
}

// Returns { showings, warnings } or { noAdapter: true } or { noReplay: true }. Throws on scrape failure.
async function fetchShowings(browser, c, generic) {
  const s = c.source;
  switch (s.adapter) {
    case 'webtic': {
      const tariffUrls = s.tariffUrls || s.tariffUrl || null; // optional, set in cinemas.json
      const r = REPLAY ? replayWebtic(s.localId, tariffUrls) : await scrapeWebtic(browser, s.localId, { tariffUrls });
      if (!r) return { noReplay: true };
      const all = webticToShowings(r.scheduling, s.localId, r.prices);
      const kept = all.filter(x => !isNonFilm(x.title));
      if (kept.length !== all.length) console.log(`  [${c.id}] dropped non-film events: ${[...new Set(all.filter(x => isNonFilm(x.title)).map(x => x.title))].join(' | ')}`);
      return { showings: kept, warnings: [], prices: r.prices, policy: r.policy, booking: r.booking };
    }
    case 'anteo': {
      if (REPLAY) return { noReplay: true };
      const r = await scrapeAnteo(browser, { from: FROM, to: TO, cinemaParam: s.cinemaParam, tariffUrls: s.tariffUrls || [], perProjection: !NO_PRICES });
      const showings = anteoToShowings(r, r.tariffs);
      return { showings, warnings: r.projectionPrices?.warnings || [], tariffs: r.tariffs, policy: r.tariffs?.policy || null };
    }
    case 'tickets18': {
      if (REPLAY) return { noReplay: true };
      const rows = await scrapeTickets18(browser, { base: s.base, from: FROM, to: TO, tariffUrls: s.tariffUrls || [], perProjection: !NO_PRICES });
      const showings = tickets18ToShowings(rows, rows.tariffs);
      return { showings, warnings: rows.warnings || [], tariffs: rows.tariffs || null, policy: rows.policy || null };
    }
    case 'progettolumiere': {
      if (REPLAY) return { noReplay: true };
      if (!generic || typeof generic.scrapeProgettoLumiere !== 'function') return { noAdapter: true };
      const showings = await generic.scrapeProgettoLumiere(browser, {
        slug: s.slug || c.id,
        url: s.url || c.website,
        cineforumPdfUrl: s.cineforumPdfUrl,
        from: FROM,
        to: TO,
      });
      const pricedAny = (showings || []).some(x => x.price_eur != null);
      const tariffUrl = s.url ? s.url.replace(/\/[^/]*$/, '/contact.php') : null;
      return {
        showings: showings || [],
        warnings: [],
        tariffs: pricedAny ? { url: tariffUrl, rates: [{ label: 'stated on contact.php', eur: showings.find(x => x.price_eur != null).price_eur, source: tariffUrl }] } : { url: tariffUrl, rates: [], reason: 'no price resolved from contact.php' },
      };
    }
    case 'cinebazin': {
      if (REPLAY) return { noReplay: true };
      if (!generic || typeof generic.scrapeCinebazin !== 'function') return { noAdapter: true };
      const showings = await generic.scrapeCinebazin(browser, { url: s.url || c.website, from: FROM, to: TO });
      return {
        showings: showings || [],
        warnings: [],
        tariffs: { url: s.url || c.website, rates: [], reason: 'seasonal cineforum membership pass only (no single-ticket price)' },
      };
    }
    case 'mymovies': {
      if (REPLAY) return { noReplay: true };
      if (!generic || typeof generic.scrapeMymovies !== 'function') return { noAdapter: true };
      const showings = await generic.scrapeMymovies(browser, { id: s.id, from: FROM, to: TO });
      return { showings: showings || [], warnings: [] };
    }
    case 'snapshot': {
      // Showings imported from a saved page (see beltrade-archive.mjs); not refetched.
      if (REPLAY) return { noReplay: true };
      const snap = JSON.parse(fs.readFileSync(path.resolve(HERE, s.file), 'utf8'));
      return { showings: snap.showings || [], warnings: [], tariffs: { url: c.website, rates: [], reason: 'no price on the schedule page' } };
    }
    default:
      throw new Error(`unknown adapter "${s.adapter}"`);
  }
}

if (REPLAY) console.log(`[replay] rebuilding from captured payloads in ${REPLAY_DIR}; nothing will be written${DRY_RUN ? '' : ' (--write given)'}`);
else if (!FORCE) await preflight();

const cinemas = JSON.parse(fs.readFileSync(CINEMAS_FILE, 'utf8'));
// Geocode the whole file first: ensureGeocoded rewrites cinemas.json, so it must never see a subset.
const unplaced = await ensureGeocoded(cinemas, CINEMAS_FILE);
if (unplaced.length) console.warn(`[geocode] not placed inside Milan: ${unplaced.join(', ')}`);
if (SCRAPE_ONLY) {
  const known = new Set(cinemas.map(c => c.id));
  const unknown = [...SCRAPE_ONLY].filter(id => !known.has(id));
  if (unknown.length) { console.error(`SCRAPE_ONLY has unknown ids: ${unknown.join(', ')}`); process.exit(2); }
  cinemas.splice(0, cinemas.length, ...cinemas.filter(c => SCRAPE_ONLY.has(c.id)));
}

const generic = await loadGeneric();
if (!generic) console.warn('[mymovies] adapters/generic.mjs not present; MyMovies cinemas marked no_schedule.');

const mergeLog = new MergeLog();
const films = new Map(); // film id -> { raws:Set, displays:Map, original_title, year, runtime_min }
const showingRows = [];
const cinemaOut = [];
const summary = [];
const priceCoverage = [];
const evidence = {};
const replaySkipped = [];

const browser = REPLAY ? null : await chromium.launch({ headless: true });
try {
  for (const c of cinemas) {
    const s = c.source;
    const notes = [c.notes];
    let status;
    let showings = [];
    let sourceUsed = null;
    let unexpected = false;
    let priceInfo = null;   // { rates, source, reason }
    let policy = null;      // { reserve, group }
    let bookingInfo = null; // { venue, perfTemplate, reason }

    console.log(`\n== ${c.id} (${s.adapter}) ==`);
    if (REPLAY && s.adapter !== 'none') {
      const hasCapture = s.adapter === 'webtic' && fs.existsSync(path.join(REPLAY_DIR, `wt-${s.localId}.json`));
      if (!hasCapture) { replaySkipped.push(c.id); console.log(`  [replay] skipped: no captured payload for ${s.adapter}`); continue; }
    }
    if (s.adapter === 'none') {
      status = 'no_schedule';
    } else {
      try {
        const r = await fetchShowings(browser, c, generic);
        if (r.noReplay) {
          replaySkipped.push(c.id);
          console.log(`  [replay] skipped: adapter ${s.adapter} cannot be replayed from a capture`);
          continue;
        }
        if (r.noAdapter) {
          status = 'no_schedule';
          notes.push('MyMovies adapter not available yet (adapters/generic.mjs missing scrapeMymovies).');
        } else {
          showings = r.showings;
          sourceUsed = s.adapter;
          policy = r.policy || null;
          bookingInfo = r.booking || null;
          priceInfo = buildPriceInfo(r, s.adapter);
          if (priceInfo.reason) notes.push(`Prices: ${priceInfo.reason}`);
          if (priceInfo.source) notes.push(`Prices: stated by ${priceInfo.source} (${priceInfo.rates.length} rate(s) read).`);
          if (policy && policy.reserve && policy.reserve !== 'not stated') notes.push(`Reserve without paying: ${policy.reserve}.`);
          if (policy && policy.group && policy.group !== 'not stated') notes.push(`Group policy: ${policy.group}.`);
          if (bookingInfo && bookingInfo.reason) notes.push(`Booking link: ${bookingInfo.reason}.`);
          if (r.warnings.length) notes.push(`Skipped ${r.warnings.length} page(s): ${r.warnings.slice(0, 4).join('; ')}`);
        }
      } catch (e) {
        const msg = (e.message || String(e)).split('\n')[0];
        unexpected = true;
        status = BLOCK_RE.test(msg) ? 'blocked' : 'no_schedule';
        notes.push(`ERROR: ${msg}`);
        console.error(`  !! ${c.id}: ${msg}`);
      }
    }

    // Keep only the date range, validate language, normalize films.
    const inRange = showings.filter(x => x.date && x.date >= FROM && x.date <= TO && x.time && x.title);
    if (status === undefined) {
      if (inRange.length) status = 'ok';
      else { status = 'no_schedule'; notes.push(`No showings found for ${FROM} to ${TO}.`); }
    }

    const seen = new Set();
    let published_until = null;
    for (const x of inRange) {
      const raw = String(x.title).trim();
      const id = normalizeTitle(raw);
      mergeLog.add(id, raw, c.id);
      if (!films.has(id)) films.set(id, { raws: new Set(), displays: new Map(), original_title: null, year: null, runtime_min: null });
      const f = films.get(id);
      f.raws.add(raw);
      const d = displayTitle(raw);
      f.displays.set(d, (f.displays.get(d) || 0) + 1);
      f.original_title ||= x.original_title || null;
      f.year ||= x.year ? Number(x.year) || null : null;
      f.runtime_min ||= x.runtime_min ? Number(x.runtime_min) || null : null;

      // Full price for this showing: only what the source states, matched to the showing's
      // day and format. Null when the source states nothing, or states several conflicting
      // full prices for it. The rates the site states are kept verbatim in price_note.
      const resolved = x.price_eur != null ? { eur: Number(x.price_eur), label: 'stated on the showing' } : resolvePrice(x, x.rates || priceInfo?.rates || []);
      const row = {
        film_id: id,
        cinema_id: c.id,
        date: x.date,
        time: x.time,
        language: LANGS.has(x.language) ? x.language : 'other',
        format: x.format || null,
        price_eur: resolved ? resolved.eur : null,
        price_note: ratesNote(x.rates && x.rates.length ? x.rates : (priceInfo?.rates || [])) || null,
        booking_url: x.booking_url || c.booking_url || null,
      };
      const k = [row.film_id, row.cinema_id, row.date, row.time, row.language, row.format].join('|');
      if (seen.has(k)) continue;
      seen.add(k);
      showingRows.push(row);
      if (!published_until || row.date > published_until) published_until = row.date;
    }

    const count = [...seen].length;
    const cinemaShowings = showingRows.filter(r => r.cinema_id === c.id);
    const coverage = coverageRow(c.id, cinemaShowings, priceInfo ? { rates: priceInfo.rates, source: priceInfo.source, reason: priceInfo.reason } : null);
    priceCoverage.push(coverage);
    if (sourceUsed && !count) console.error(`  !! ${c.id}: source ${sourceUsed} returned 0 showings in range`);
    if (sourceUsed && count && !coverage.priced) console.error(`  !! ${c.id}: NO PRICE captured for ${count} showing(s): ${coverage.reason || 'unknown reason'}`);
    if (sourceUsed) console.log(`  prices: ${coverage.priced}/${coverage.showings} (${coverage.pct}%)${priceInfo?.source ? ' via ' + priceInfo.source : ''}`);

    evidence[c.id] = {
      cinema: c.id, adapter: s.adapter, status,
      rates: cleanRates(priceInfo?.rates || []),
      prices_checked: true,
      price_source: priceInfo?.source || null,
      price_reason: priceInfo?.reason || null,
      policy: policy ? { reserve: policy.reserve || 'not stated', group: policy.group || 'not stated' } : null,
      booking: bookingInfo,
      showings: coverage.showings, priced: coverage.priced, pct: coverage.pct,
      captured_endpoints: null,
    };

    cinemaOut.push({
      id: c.id,
      name: c.name,
      address: c.address,
      lat: c.lat,
      lng: c.lng,
      website: c.website || null,
      booking_url: c.booking_url || null,
      source_used: sourceUsed,
      published_until,
      status,
      notes: [...new Set(notes.filter(Boolean))].join(' | '),
    });
    summary.push({ id: c.id, status, showings: count, published_until, unexpected, error: notes.find(n => n.startsWith('ERROR:')) || '' });
    console.log(`  -> ${status}, ${count} showings, published_until=${published_until}`);
  }
} finally {
  if (browser) await browser.close();
}

// Film records: type from all raw titles seen; display title = most frequent cleaned title.
const filmOut = [...films].map(([id, f]) => {
  const title = [...f.displays].sort((a, b) => b[1] - a[1])[0]?.[0] || id;
  return { id, title, original_title: f.original_title, type: filmType([...f.raws], f.year), runtime_min: f.runtime_min };
}).sort((a, b) => a.title.localeCompare(b.title, 'it'));

// Refuse to overwrite good data with a run in which nothing could be fetched (no network,
// total block). The pipeline fails loudly instead of wiping data/showtimes.json.
const scraped = summary.filter(r => r.status !== 'no_schedule' || r.error);
const hadData = fs.existsSync(OUT_FILE) && (JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')).showings || []).length > 0;
const allFailed = scraped.length > 0 && scraped.every(r => r.unexpected || r.status === 'blocked');
const wouldWipe = hadData && showingRows.length === 0;

// Only films that actually have showings in range.
const usedFilmIds = new Set(showingRows.map(r => r.film_id));
const filmsFinal = filmOut.filter(f => usedFilmIds.has(f.id));
showingRows.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.cinema_id.localeCompare(b.cinema_id) || a.film_id.localeCompare(b.film_id));

const out = {
  generated_at: new Date().toISOString(),
  range: { from: FROM, to: TO },
  cinemas: cinemaOut,
  films: filmsFinal,
  showings: showingRows,
};
fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
if (DRY_RUN) {
  console.log(`\n[dry-run] not writing ${OUT_FILE} or ${PRICE_EVIDENCE}`);
} else if (allFailed || wouldWipe) {
  console.error(`\n!!!!! REFUSING TO WRITE ${OUT_FILE}: ` +
    (allFailed ? `every scraped cinema failed (${scraped.map(r => r.id).join(', ')})`
               : `the run produced 0 showings but the current file has data`) +
    `. Check network/blocking and re-run. !!!!!`);
  process.exitCode = 2;
} else {
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n');
  fs.writeFileSync(PRICE_EVIDENCE, JSON.stringify({
    generated_at: out.generated_at, range: out.range, note: 'price/policy evidence captured by run.mjs; applied offline by apply-prices.mjs', cinemas: evidence,
  }, null, 2) + '\n');
}
const merges = DRY_RUN ? mergeLog.merges().length : mergeLog.write(MERGE_LOG);

// Loud summary table
const bar = '='.repeat(100);
console.log(`\n${bar}\nSUMMARY  range ${FROM}..${TO}\n${bar}`);
console.log(['cinema'.padEnd(26), 'status'.padEnd(12), 'showings'.padStart(9), 'published_until'.padEnd(17), 'error'].join(' '));
for (const r of summary) {
  console.log([r.id.padEnd(26), r.status.padEnd(12), String(r.showings).padStart(9), String(r.published_until ?? '-').padEnd(17), r.error].join(' '));
}
console.log(`\nPRICE COVERAGE (full price stated by the source, per showing)`);
console.log(['cinema'.padEnd(26), 'showings'.padStart(9), 'priced'.padStart(8), 'cov'.padStart(5), '  source / reason'].join(' '));
for (const r of priceCoverage) {
  console.log([r.cinema.padEnd(26), String(r.showings).padStart(9), String(r.priced).padStart(8), (r.pct + '%').padStart(5),
    '  ' + (r.source || r.reason || '-')].join(' '));
}
if (REPLAY) console.log(`[replay] rebuilt ${priceCoverage.length} cinema(s); skipped ${replaySkipped.length}: ${replaySkipped.join(', ') || '-'}`);
const priced = showingRows.filter(r => r.price_eur != null).length;
console.log(`${bar}\ntotal price coverage: ${priced}/${showingRows.length} showings (${showingRows.length ? Math.round(priced / showingRows.length * 100) : 0}%)`);
console.log(`${bar}\nfilms ${filmsFinal.length}, showings ${showingRows.length}, film merges logged ${merges} (${MERGE_LOG})`);
if (DRY_RUN) console.log(`[dry-run] ${OUT_FILE} left untouched`);
else console.log(`wrote ${OUT_FILE}`);

const bad = summary.filter(r => r.unexpected);
if (bad.length) {
  console.error(`\n!!!!! ${bad.length} cinema(s) errored unexpectedly: ${bad.map(r => r.id).join(', ')} !!!!!`);
  process.exitCode = 1;
}
