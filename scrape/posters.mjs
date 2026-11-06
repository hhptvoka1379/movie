#!/usr/bin/env node
// Looks up each film from data/showtimes.json on TMDB, downloads the best
// match's poster into assets/posters/<film_id>.jpg and writes data/posters.json.
//
// Usage: node scrape/posters.mjs [--in <path>] [--force] [--dry]
//   --in <path>  input file (default: data/showtimes.json)
//   --force      re-download posters that already exist
//   --dry        search and print decisions only; write nothing
//
// API key: TMDB_API_KEY env var, else TMDB_API_KEY=... in <project>/.env.
// Exit codes: 0 ok, 1 input/other error, 2 missing or rejected API key.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DEFAULT_IN = path.join(ROOT, 'data', 'showtimes.json');
const POSTERS_JSON = path.join(ROOT, 'data', 'posters.json');
const POSTER_DIR = path.join(ROOT, 'assets', 'posters');
const LOG_FILE = path.join(HERE, 'logs', 'tmdb-matches.log');
const ENV_FILE = path.join(ROOT, '.env');

const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/w185';
const MIN_INTERVAL_MS = 250; // 4 requests per second at most
const SIM_THRESHOLD = 0.8;   // minimum title similarity for a non-exact match

class HttpError extends Error {
  constructor(status) {
    super(`TMDB responded HTTP ${status}`);
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- arguments and key ----------

export function parseArgs(argv) {
  const opts = { in: DEFAULT_IN, force: false, dry: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') opts.force = true;
    else if (a === '--dry') opts.dry = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--in') opts.in = path.resolve(process.cwd(), argv[++i] ?? '');
    else if (a.startsWith('--in=')) opts.in = path.resolve(process.cwd(), a.slice(5));
    else throw new Error(`unknown argument: ${a}`);
  }
  return opts;
}

export function readKey(env = process.env, envFile = ENV_FILE) {
  const fromEnv = (env.TMDB_API_KEY ?? '').trim();
  if (fromEnv) return fromEnv;
  if (!existsSync(envFile)) return '';
  for (const raw of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?TMDB_API_KEY\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[1].trim();
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '').trim();
    if (v) return v;
  }
  return '';
}

// ---------- matching helpers (pure, exported for testing) ----------

export function normalize(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function levenshtein(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// 1 = identical after normalization, 0 = nothing in common.
export function similarity(a, b) {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

// Picks the best TMDB result for `query`. An exact normalized title match
// (title or original_title) wins, ties broken by popularity. Otherwise the
// most similar result at or above `threshold` wins, popularity breaks ties.
// Results without a poster are ignored. If `year` is known, results whose
// release year differs by more than one year are ignored.
export function pickMatch(query, results, { year, threshold = SIM_THRESHOLD } = {}) {
  const qn = normalize(query);
  const yearOk = (r) => {
    if (!year) return true;
    const ry = parseInt(String(r.release_date ?? '').slice(0, 4), 10);
    return !ry || Math.abs(ry - Number(year)) <= 1;
  };
  const cands = (results ?? [])
    .filter((r) => r && r.id && r.poster_path && yearOk(r))
    .map((r) => {
      const exact = normalize(r.title) === qn || normalize(r.original_title) === qn;
      const sim = exact ? 1 : Math.max(similarity(query, r.title), similarity(query, r.original_title));
      return { r, exact, sim, pop: Number(r.popularity) || 0 };
    });
  const exact = cands.filter((c) => c.exact).sort((a, b) => b.pop - a.pop);
  const similar = cands
    .filter((c) => c.sim >= threshold)
    .sort((a, b) => Math.round(b.sim * 100) - Math.round(a.sim * 100) || b.pop - a.pop);
  const pick = exact[0] ?? similar[0];
  if (!pick) return null;
  const date = String(pick.r.release_date ?? '');
  return {
    tmdbId: pick.r.id,
    matchedTitle: pick.r.title ?? pick.r.original_title ?? '',
    year: date.slice(0, 4) || null,
    confidence: pick.exact ? 'exact' : Number(pick.sim.toFixed(2)),
    posterPath: pick.r.poster_path,
  };
}

// ---------- network ----------

let lastRequestAt = 0;
async function throttle() {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

// v4 read tokens are JWTs (start with "eyJ") and go in a header; v3 keys go in api_key.
function authFor(key) {
  return key.startsWith('eyJ')
    ? { headers: { Authorization: `Bearer ${key}` }, extra: {} }
    : { headers: {}, extra: { api_key: key } };
}

async function tmdbGet(key, pathname, params) {
  const auth = authFor(key);
  const url = new URL(API + pathname);
  for (const [k, v] of Object.entries({ ...params, ...auth.extra })) url.searchParams.set(k, String(v));
  for (let attempt = 1; attempt <= 4; attempt++) {
    await throttle();
    let res;
    try {
      res = await fetch(url, { headers: auth.headers });
    } catch (e) {
      if (attempt === 4) throw new Error(`network error: ${e.message}`);
      await sleep(1000 * attempt);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      await sleep(2000 * attempt);
      continue;
    }
    if (!res.ok) throw new HttpError(res.status);
    return res.json();
  }
  throw new Error('gave up after retries');
}

async function searchMovies(key, query, year) {
  const params = { query, language: 'it-IT', include_adult: 'false' };
  if (year) params.year = year;
  const data = await tmdbGet(key, '/search/movie', params);
  return data.results ?? [];
}

async function matchFilm(key, film) {
  const queries = [...new Set([film.title, film.original_title].map((s) => String(s ?? '').trim()).filter(Boolean))];
  for (const q of queries) {
    const results = await searchMovies(key, q, film.year);
    const match = pickMatch(q, results, { year: film.year });
    if (match) return { query: q, queries, match };
  }
  return { query: null, queries, match: null };
}

async function downloadPoster(posterPath, dest) {
  if (!/^\/[A-Za-z0-9._-]+\.(jpg|png)$/i.test(posterPath)) throw new Error('unexpected poster_path');
  await throttle();
  const res = await fetch(IMG + posterPath);
  if (!res.ok) throw new HttpError(res.status);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

// ---------- main ----------

const USAGE = `Usage: node scrape/posters.mjs [--in <path>] [--force] [--dry]
  TMDB_API_KEY from the environment or from <project>/.env`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }

  const key = readKey();
  if (!key) {
    console.error('TMDB_API_KEY is not set. Export it, or add TMDB_API_KEY=... to the project .env file.');
    console.error('Nothing was written.');
    return 2;
  }
  if (!existsSync(opts.in)) {
    console.error(`Input not found: ${opts.in}. Run the showtimes scraper first. Nothing was written.`);
    return 1;
  }

  const doc = JSON.parse(await readFile(opts.in, 'utf8'));
  const films = Array.isArray(doc.films) ? doc.films : [];
  const stamp = () => new Date().toISOString();
  const logLines = [`# run ${stamp()} in=${path.relative(ROOT, opts.in)} dry=${opts.dry} films=${films.length}`];
  const newEntries = {};
  const counts = { matched: 0, noMatch: 0, error: 0, downloaded: 0, existing: 0, failedDownload: 0 };

  for (const film of films) {
    const id = String(film.id);
    const safeId = id.replace(/[^A-Za-z0-9._-]/g, '_');
    const relFile = `assets/posters/${safeId}.jpg`;
    const dest = path.join(ROOT, relFile);
    let r;
    try {
      r = await matchFilm(key, film);
    } catch (e) {
      if (e instanceof HttpError && (e.status === 401 || e.status === 403)) {
        console.error(`TMDB rejected the API key (HTTP ${e.status}). Check TMDB_API_KEY. Nothing was written.`);
        return 2;
      }
      counts.error++;
      const line = `${stamp()} film_id=${id} ERROR ${e.message}`;
      logLines.push(line);
      console.log(line);
      continue;
    }

    if (!r.match) {
      counts.noMatch++;
      const line = `${stamp()} film_id=${id} query=${JSON.stringify(r.queries.join(' | '))} NO MATCH`;
      logLines.push(line);
      console.log(line);
      continue;
    }

    counts.matched++;
    const m = r.match;
    let poster;
    if (opts.dry) {
      poster = `dry-run (would write ${relFile})`;
    } else if (existsSync(dest) && !opts.force) {
      poster = 'exists';
      counts.existing++;
    } else {
      try {
        await mkdir(POSTER_DIR, { recursive: true });
        await downloadPoster(m.posterPath, dest);
        poster = 'downloaded';
        counts.downloaded++;
      } catch (e) {
        poster = `download failed: ${e.message}`;
        counts.failedDownload++;
      }
    }
    if (!opts.dry && (poster === 'exists' || poster === 'downloaded')) {
      newEntries[id] = { file: relFile, tmdb_id: m.tmdbId, matched_title: m.matchedTitle };
    }
    const line = `${stamp()} film_id=${id} query=${JSON.stringify(r.query)} matched=${JSON.stringify(m.matchedTitle)} tmdb_id=${m.tmdbId} year=${m.year ?? '?'} confidence=${m.confidence} poster=${poster}`;
    logLines.push(line);
    console.log(line);
  }

  console.log(
    `Done: ${films.length} films, ${counts.matched} matched, ${counts.noMatch} no match, ${counts.error} errors, ` +
      `${counts.downloaded} posters downloaded, ${counts.existing} already present, ${counts.failedDownload} download failures.`,
  );

  if (opts.dry) {
    console.log('Dry run: nothing written.');
    return 0;
  }

  await mkdir(path.dirname(LOG_FILE), { recursive: true });
  await writeFile(LOG_FILE, logLines.join('\n') + '\n');

  // Keep entries for films not in this input; replace entries for films in it.
  const processed = new Set(films.map((f) => String(f.id)));
  let previous = {};
  if (existsSync(POSTERS_JSON)) {
    try {
      previous = JSON.parse(await readFile(POSTERS_JSON, 'utf8'));
    } catch {
      console.error(`Warning: ${POSTERS_JSON} is not valid JSON; it will be overwritten.`);
    }
  }
  const merged = {};
  for (const [k, v] of Object.entries(previous)) if (!processed.has(k)) merged[k] = v;
  Object.assign(merged, newEntries);
  const sorted = Object.fromEntries(Object.keys(merged).sort().map((k) => [k, merged[k]]));
  await writeFile(POSTERS_JSON, JSON.stringify(sorted, null, 2) + '\n');
  console.log(`Wrote ${POSTERS_JSON} (${Object.keys(sorted).length} entries) and ${path.relative(ROOT, LOG_FILE)}.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    });
}
