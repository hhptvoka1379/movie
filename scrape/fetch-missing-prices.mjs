#!/usr/bin/env node
// Fetches the public tariff page of every cinema that still has showings with price_eur null,
// parses it with lib/prices.mjs, applies what the page states through apply-prices.mjs, and
// prints per-cinema price coverage before and after.
//
//   node fetch-missing-prices.mjs                  # fetch, apply to data/showtimes.json, report
//   node fetch-missing-prices.mjs --dry-run        # fetch and report, write nothing
//   node fetch-missing-prices.mjs uci-bicocca      # only these cinema ids
//
// Rules this script keeps to:
//   - plain HTTP GET of public pages listed as tariffUrls in scrape/cinemas.json; no login, no
//     cookies set by us, no form posts, no seat selection, no checkout, no held seats;
//   - a block (HTTP 403/429/999, a queue or captcha page) is recorded as blocked and never
//     bypassed: no retries with other headers, no browser automation to get past it;
//   - a venue whose curated evidence (scrape/logs/prices.json) already carries rates is left
//     alone: those rates were read from the page's own tariff block by run.mjs, and parsing the
//     whole page can pick up unrelated promo prices (see the Cinelandia Certosa page);
//   - nothing is inferred: price_eur comes only from a rate the page states (resolvePrice).
// Evidence goes to a temp file, never into the repo; apply-prices.mjs does the one data write.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ratesFromText, cleanRates } from './lib/prices.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DATA = path.join(ROOT, 'data', 'showtimes.json');
const CINEMAS = path.join(HERE, 'cinemas.json');
const CURATED = path.join(HERE, 'logs', 'prices.json');
const APPLY = path.join(HERE, 'apply-prices.mjs');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TIMEOUT_MS = 25000;
const BLOCK_STATUS = new Set([403, 429, 999]);
// Markers of a bot wall or waiting room. Checked on the first part of the body only.
const BLOCK_BODY = /queue-?it|cf-chl-|captcha-delivery|AW Special Error|request blocked|access denied/i;

// ------------------------------------------------------------------ pure helpers (tested)

export function tariffUrlsOf(cinema) {
  const s = (cinema && cinema.source) || {};
  const list = [].concat(s.tariffUrls || [], s.tariffUrl || []);
  return [...new Set(list.filter(u => typeof u === 'string' && /^https?:\/\//i.test(u)))];
}

export function countNull(showings, cinemaId) {
  return showings.filter(s => s.cinema_id === cinemaId && s.price_eur == null).length;
}

// Decides, per cinema with null-price showings, whether it is fetched or why it is skipped.
export function selectTargets({ cinemas, showings, curated, only = new Set() }) {
  const out = [];
  for (const c of cinemas) {
    if (only.size && !only.has(c.id)) continue;
    if (!countNull(showings, c.id)) continue;
    const urls = tariffUrlsOf(c);
    const cur = curated && curated.cinemas && curated.cinemas[c.id];
    if (cur && cur.preserve_showing_prices) {
      out.push({ id: c.id, skip: 'per-showing prices curated in logs/prices.json (preserve_showing_prices); a page rate would guess the unstated time cutoff' });
    } else if (cur && (cur.rates || []).length) {
      out.push({ id: c.id, skip: `curated tariffs in logs/prices.json (${cur.rates.length} rates from run.mjs); not re-parsed` });
    } else if (!urls.length) {
      out.push({ id: c.id, skip: 'no tariff page configured in scrape/cinemas.json' });
    } else {
      out.push({ id: c.id, urls });
    }
  }
  return out;
}

// Turns one HTTP response into a result. Pure: no network.
export function evaluatePage({ url, status, body = '', error = null }) {
  const base = { url, status, rates: [], blocked: false };
  if (error) return { ...base, reason: `request failed: ${error}` };
  if (BLOCK_STATUS.has(status) || (status === 200 && BLOCK_BODY.test(String(body).slice(0, 5000)))) {
    return { ...base, blocked: true, reason: `blocked by the site (HTTP ${status}); not bypassed` };
  }
  if (status !== 200) return { ...base, reason: `HTTP ${status}` };
  const rates = cleanRates(ratesFromText(String(body), url)).filter(r => r.eur != null);
  return { ...base, rates, reason: rates.length ? null : 'page states no full ticket price' };
}

// Evidence in the same shape run.mjs writes, for apply-prices.mjs to read.
export function buildEvidence(byCinema) {
  const cinemas = {};
  for (const [id, pages] of Object.entries(byCinema)) {
    const rated = pages.filter(p => p.rates.length);
    const rates = rated.flatMap(p => p.rates);
    cinemas[id] = {
      rates,
      prices_checked: true,
      price_source: rated.length ? rated[0].url : null,
      price_reason: rates.length ? null : pages.map(p => `${p.url}: ${p.reason}`).join('; '),
      fetched: pages.map(p => ({ url: p.url, status: p.status, blocked: p.blocked, rates: p.rates.length, reason: p.reason })),
    };
  }
  return { generated_at: new Date().toISOString(), note: 'public tariff pages fetched by fetch-missing-prices.mjs', cinemas };
}

export function coverage(showings, cinemaId) {
  const rows = showings.filter(s => s.cinema_id === cinemaId);
  const priced = rows.filter(s => s.price_eur != null).length;
  return { total: rows.length, priced };
}

// ------------------------------------------------------------------ network and apply

async function fetchPage(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'it-IT,it;q=0.9' },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    return { status: r.status, body: await r.text() };
  } catch (e) {
    return { status: null, body: '', error: e.name === 'AbortError' ? 'timeout' : String(e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

function runApply({ evidenceFile, dataFile, ids, dry }) {
  const args = [APPLY, '--evidence', evidenceFile, '--data', dataFile, ...(dry ? ['--dry-run'] : []), ...ids];
  const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
  // apply-prices exits 1 when some cinema still has no price; that is the expected outcome here.
  if (r.status !== 0 && r.status !== 1) {
    throw new Error(`apply-prices failed (exit ${r.status}): ${(r.stderr || r.stdout || '').trim()}`);
  }
  return r.stdout;
}

function printReport(rows) {
  const bar = '='.repeat(104);
  console.log(bar);
  console.log(['cinema'.padEnd(24), 'before'.padStart(13), 'after'.padStart(13), 'delta'.padStart(6), '  status'].join(' '));
  console.log(bar);
  for (const r of rows) {
    const pct = (c) => (c.total ? `${c.priced}/${c.total} ${Math.round((c.priced / c.total) * 100)}%` : '0/0');
    console.log([r.id.padEnd(24), pct(r.before).padStart(13), pct(r.after).padStart(13),
      (r.after.priced - r.before.priced >= 0 ? '+' : '') + (r.after.priced - r.before.priced), '  ' + r.status].join(' '));
  }
  console.log(bar);
}

// ------------------------------------------------------------------ main

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry-run');
  const only = new Set(args.filter(a => !a.startsWith('--')));
  const dataFile = DATA;

  const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const cinemasCfg = JSON.parse(fs.readFileSync(CINEMAS, 'utf8'));
  const curated = fs.existsSync(CURATED) ? JSON.parse(fs.readFileSync(CURATED, 'utf8')) : { cinemas: {} };
  const before = Object.fromEntries(data.cinemas.map(c => [c.id, coverage(data.showings, c.id)]));

  const targets = selectTargets({ cinemas: cinemasCfg, showings: data.showings, curated, only });
  const byCinema = {};
  const statusById = {};
  for (const t of targets) {
    if (t.skip) { statusById[t.id] = `skipped: ${t.skip}`; continue; }
    const pages = [];
    for (const url of t.urls) {
      const got = await fetchPage(url);
      pages.push(evaluatePage({ url, ...got }));
    }
    byCinema[t.id] = pages;
    const hits = pages.reduce((n, p) => n + p.rates.length, 0);
    const blocked = pages.filter(p => p.blocked).length;
    statusById[t.id] = hits ? `${hits} rate(s) stated on the tariff page`
      : blocked ? `blocked (${blocked}/${pages.length} page(s)); not bypassed`
        : pages.map(p => p.reason).join('; ');
  }

  const ids = Object.keys(byCinema);
  let applyOut = '';
  if (ids.length) {
    const evidenceFile = path.join(os.tmpdir(), `fetch-missing-prices-${process.pid}.json`);
    fs.writeFileSync(evidenceFile, JSON.stringify(buildEvidence(byCinema), null, 2));
    try {
      applyOut = runApply({ evidenceFile, dataFile, ids, dry });
    } finally {
      fs.rmSync(evidenceFile, { force: true });
    }
  }

  const after = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const rows = data.cinemas.filter(c => statusById[c.id] !== undefined).map(c => ({
    id: c.id,
    before: before[c.id],
    after: coverage(after.showings, c.id),
    status: statusById[c.id],
  }));
  const totalBefore = data.showings.filter(s => s.price_eur != null).length;
  const totalAfter = after.showings.filter(s => s.price_eur != null).length;

  console.log(`fetch-missing-prices${dry ? ' [dry-run]' : ''}: ${targets.length} cinema(s) with null-price showings, ${ids.length} fetched`);
  printReport(rows);
  console.log(`all cinemas: priced ${totalBefore} -> ${totalAfter} of ${data.showings.length} showings`);
  if (applyOut.trim()) console.log('\n' + applyOut.trim());
  console.log(dry ? '[dry-run] nothing written' : `wrote ${path.relative(ROOT, dataFile)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(e => { console.error(`fetch-missing-prices: ${e.message}`); process.exit(1); });
}
