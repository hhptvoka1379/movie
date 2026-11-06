#!/usr/bin/env node
// Scrapes Milan cinema showtimes for FROM..TO, normalizes them and writes ../data/showtimes.json.
// Usage: cd scrape && node run.mjs      (rerunnable; exit code 1 if a cinema errored unexpectedly)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { scrapeWebtic, webticToShowings } from './adapters/webtic.mjs';
import { scrapeAnteo, anteoToShowings } from './adapters/anteo.mjs';
import { scrapeTickets18, tickets18ToShowings } from './adapters/tickets18.mjs';
import { normalizeTitle, displayTitle, filmType, isNonFilm, MergeLog } from './lib/normalize.mjs';
import { ensureGeocoded } from './lib/geocode.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CINEMAS_FILE = path.join(HERE, 'cinemas.json');
const OUT_FILE = path.join(ROOT, 'data', 'showtimes.json');
const MERGE_LOG = path.join(HERE, 'logs', 'merges.log');
const FROM = '2026-11-06';
const TO = '2026-11-15';
const LANGS = new Set(['ita', 'vo', 'vos', 'other']);
const BLOCK_RE = /\b(403|429)\b|captcha|cloudflare|access denied|forbidden|too many requests|bot detection|blocked/i;

// Generic (MyMovies) adapter is written by another agent; load it if present, else null.
async function loadGeneric() {
  const file = path.join(HERE, 'adapters', 'generic.mjs');
  if (!fs.existsSync(file)) return null;
  return import(pathToFileURL(file).href);
}

// Returns { showings, warnings } or { noAdapter: true }. Throws on scrape failure.
async function fetchShowings(browser, c, generic) {
  const s = c.source;
  switch (s.adapter) {
    case 'webtic': {
      const { scheduling } = await scrapeWebtic(browser, s.localId);
      const all = webticToShowings(scheduling, s.localId);
      const kept = all.filter(x => !isNonFilm(x.title));
      if (kept.length !== all.length) console.log(`  [${c.id}] dropped non-film events: ${[...new Set(all.filter(x => isNonFilm(x.title)).map(x => x.title))].join(' | ')}`);
      return { showings: kept, warnings: [] };
    }
    case 'anteo': {
      const rows = await scrapeAnteo(browser, { from: FROM, to: TO, cinemaParam: s.cinemaParam });
      return { showings: anteoToShowings(rows), warnings: [] };
    }
    case 'tickets18': {
      const rows = await scrapeTickets18(browser, { base: s.base, from: FROM, to: TO });
      return { showings: tickets18ToShowings(rows), warnings: rows.warnings || [] };
    }
    case 'mymovies': {
      if (!generic || typeof generic.scrapeMymovies !== 'function') return { noAdapter: true };
      const showings = await generic.scrapeMymovies(browser, { id: s.id, from: FROM, to: TO });
      return { showings: showings || [], warnings: [] };
    }
    default:
      throw new Error(`unknown adapter "${s.adapter}"`);
  }
}

const cinemas = JSON.parse(fs.readFileSync(CINEMAS_FILE, 'utf8'));
const unplaced = await ensureGeocoded(cinemas, CINEMAS_FILE);
if (unplaced.length) console.warn(`[geocode] not placed inside Milan: ${unplaced.join(', ')}`);

const generic = await loadGeneric();
if (!generic) console.warn('[mymovies] adapters/generic.mjs not present; MyMovies cinemas marked no_schedule.');

const mergeLog = new MergeLog();
const films = new Map(); // film id -> { raws:Set, displays:Map, original_title, year, runtime_min }
const showingRows = [];
const cinemaOut = [];
const summary = [];

const browser = await chromium.launch({ headless: true });
try {
  for (const c of cinemas) {
    const s = c.source;
    const notes = [c.notes];
    let status;
    let showings = [];
    let sourceUsed = null;
    let unexpected = false;

    console.log(`\n== ${c.id} (${s.adapter}) ==`);
    if (s.adapter === 'none') {
      status = 'no_schedule';
    } else {
      try {
        const r = await fetchShowings(browser, c, generic);
        if (r.noAdapter) {
          status = 'no_schedule';
          notes.push('MyMovies adapter not available yet (adapters/generic.mjs missing scrapeMymovies).');
        } else {
          showings = r.showings;
          sourceUsed = s.adapter;
          if (r.warnings.length) notes.push(`Skipped ${r.warnings.length} film page(s): ${r.warnings.join('; ')}`);
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

      const row = {
        film_id: id,
        cinema_id: c.id,
        date: x.date,
        time: x.time,
        language: LANGS.has(x.language) ? x.language : 'other',
        format: x.format || null,
        price_eur: x.price_eur ?? null,
        booking_url: x.booking_url || c.booking_url || null,
      };
      const k = [row.film_id, row.cinema_id, row.date, row.time, row.language, row.format].join('|');
      if (seen.has(k)) continue;
      seen.add(k);
      showingRows.push(row);
      if (!published_until || row.date > published_until) published_until = row.date;
    }

    const count = [...seen].length;
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
  await browser.close();
}

// Film records: type from all raw titles seen; display title = most frequent cleaned title.
const filmOut = [...films].map(([id, f]) => {
  const title = [...f.displays].sort((a, b) => b[1] - a[1])[0]?.[0] || id;
  return { id, title, original_title: f.original_title, type: filmType([...f.raws], f.year), runtime_min: f.runtime_min };
}).sort((a, b) => a.title.localeCompare(b.title, 'it'));

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
fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n');
const merges = mergeLog.write(MERGE_LOG);

// Loud summary table
const bar = '='.repeat(100);
console.log(`\n${bar}\nSUMMARY  range ${FROM}..${TO}\n${bar}`);
console.log(['cinema'.padEnd(26), 'status'.padEnd(12), 'showings'.padStart(9), 'published_until'.padEnd(17), 'error'].join(' '));
for (const r of summary) {
  console.log([r.id.padEnd(26), r.status.padEnd(12), String(r.showings).padStart(9), String(r.published_until ?? '-').padEnd(17), r.error].join(' '));
}
console.log(`${bar}\nfilms ${filmsFinal.length}, showings ${showingRows.length}, film merges logged ${merges} (${MERGE_LOG})`);
console.log(`wrote ${OUT_FILE}`);

const bad = summary.filter(r => r.unexpected);
if (bad.length) {
  console.error(`\n!!!!! ${bad.length} cinema(s) errored unexpectedly: ${bad.map(r => r.id).join(', ')} !!!!!`);
  process.exitCode = 1;
}
