#!/usr/bin/env node
// Offline end-to-end check of the price pipeline, for machines that cannot reach the cinema
// sites (CI, sandboxes with a network allowlist). Everything it reads is a synthetic fixture:
//   cd scrape && node verify-prices.mjs
//
// It walks the same code path a live run uses - adapter -> rates -> resolvePrice -> row ->
// evidence file -> apply-prices -> data file - and prints the price coverage per cinema.
// Exit code 1 when any step fails.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as P from './lib/prices.mjs';
import { collectPrices, webticToShowings, webticPolicy, webticBooking } from './adapters/webtic.mjs';
import { anteoToShowings, tariffUrls } from './adapters/anteo.mjs';
import { tickets18ToShowings } from './adapters/tickets18.mjs';
import { canonicalId } from './lib/normalize.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const FX = path.join(HERE, 'tests', 'fixtures');
const read = f => fs.readFileSync(path.join(FX, f), 'utf8');

const results = [];
let failed = 0;
function step(name, fn) {
  try {
    const detail = fn();
    results.push({ name, ok: true, detail: detail || '' });
    console.log(`  ok   ${name}${detail ? ' \u2014 ' + detail : ''}`);
  } catch (e) {
    failed++;
    results.push({ name, ok: false, detail: e.message });
    console.error(`  FAIL ${name} \u2014 ${e.message}`);
  }
}
const eq = (a, b, what) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};
const truthy = (v, what) => { if (!v) throw new Error(`${what}: expected a value, got ${JSON.stringify(v)}`); };

console.log('\n=== verify-prices: offline pipeline check (synthetic fixtures) ===\n');

// ---------------------------------------------------------- 1. WebTic venue
const cap = JSON.parse(read('webtic-prices.json'));
let wtShowings = [], wtPrices = null, wtPolicy = null;
step('webtic: tariffs read from the captured endpoint', () => {
  wtPrices = collectPrices(cap, [], 5068);
  eq(wtPrices.reason, null, 'reason');
  eq(wtPrices.byPerformance.length, 2, 'performances with their own tariffs');
  return `${wtPrices.byPerformance.length} performances, ${wtPrices.byEvent.length} events`;
});
step('webtic: each showing carries its own performance tariffs', () => {
  wtShowings = webticToShowings(cap.getFullScheduling.DS.Scheduling, 5068, wtPrices);
  eq(wtShowings.length, 2, 'showings');
  for (const s of wtShowings) truthy(s.rates && s.rates.length, `rates for ${s.date} ${s.time}`);
  return `${wtShowings.length} showings`;
});
step('webtic: policy statements come from getLocalInfo only', () => {
  wtPolicy = webticPolicy(cap.getLocalInfo);
  if (!/^yes/.test(wtPolicy.reserve)) throw new Error('reserve statement not read: ' + wtPolicy.reserve);
  if (!/8 adjacent seats/.test(wtPolicy.group)) throw new Error('group statement not read: ' + wtPolicy.group);
  const booking = webticBooking(5068);
  eq(booking.perfTemplate, null, 'no invented deep link');
  return 'reserve + group read, booking_url kept at venue level';
});

// ---------------------------------------------------------- 2. Anteo venue
let anteoShowings = [];
step('anteo: tariff page candidates are public pages', () => {
  const urls = tariffUrls('Citylife anteo');
  truthy(urls[0].includes('/cinema/tariffe/citylife-anteo'), 'venue-specific tariff url');
  truthy(urls.every(u => u.startsWith('https://www.spaziocinema.info/')), 'same origin');
  return urls.length + ' candidates, most specific first';
});
step('anteo: tariff page + projection page become per-showing rates', () => {
  const tariffs = { url: 'fixture://tariffe', rates: P.ratesFromText(read('anteo-tariffe.html'), 'fixture://tariffe') };
  const proj = new Map([['https://example.invalid/p/1', P.ratesFromText(read('anteo-projection.html'), 'fixture://p/1')]]);
  const rows = [
    { film: { title: 'Film di prova', year: '2026', length: 118, language: 'Italiano', technologies: '' },
      o: { date: '2026-11-11', hour: '21:00', technologies: [], projection_url: 'https://example.invalid/p/1' } },
    { film: { title: 'Film di prova', year: '2026', length: 118, language: 'Italiano', technologies: '' },
      o: { date: '2026-11-14', hour: '20:00', technologies: ['3D'], projection_url: 'https://example.invalid/p/3d' } },
  ];
  anteoShowings = anteoToShowings({ rows, tariffs, projectionPrices: proj }, tariffs);
  eq(anteoShowings.length, 2, 'showings');
  eq(P.resolvePrice(anteoShowings[0], anteoShowings[0].rates).eur, 8, 'projection page price (Wed)');
  eq(P.resolvePrice(anteoShowings[1], anteoShowings[1].rates).eur, 11, 'Sat festivi 9,00 + 3D supplement 2,00');
  return 'projection price wins, venue tariff fills the gap, 3D supplement added';
});

// ---------------------------------------------------------- 3. 18tickets venue
step('tickets18: film page price applies to its showings', () => {
  const rates = P.ratesFromText(read('tickets18-film.html'), 'fixture://film/9');
  const filmRates = new Map([['https://example.invalid/film/9', rates]]);
  const rows = [
    { title: 'Film di prova', date: '2026-11-11', time: '21:00', runtime_min: 118, lang: 'Italiano', year: '2026', booking_url: 'https://example.invalid/film/9/900001#theater-init', perf_id: '900001', film_href: 'https://example.invalid/film/9' },
    { title: 'Film di prova - V.O.', date: '2026-11-15', time: '17:30', runtime_min: 118, lang: 'Inglese', year: '2026', booking_url: 'https://example.invalid/film/9/900002#theater-init', perf_id: '900002', film_href: 'https://example.invalid/film/9' },
  ];
  rows.warnings = [];
  const showings = tickets18ToShowings(Object.assign(rows, { filmRates, projectionPrices: new Map() }));
  eq(showings.length, 2, 'showings');
  eq(showings[1].language, 'vos', 'V.O. language');
  eq(P.resolvePrice(showings[0], showings[0].rates).eur, 5.5, 'Wednesday: the stated Wednesday price');
  // Sunday: neither the Wednesday promo nor the reduced rate may apply.
  eq(P.resolvePrice(showings[1], showings[1].rates).eur, 7.5, 'Sunday keeps the full price');
  truthy(showings[0].booking_url.endsWith('#theater-init'), 'deep booking link kept');
  return 'Wed 5,50 / Sun 7,50 from the same page, deep links kept';
});

// ---------------------------------------------------------- 4. apply-prices on a copy
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prices-'));
const tmpData = path.join(tmp, 'showtimes.json');
const tmpPosters = path.join(tmp, 'posters.json');
fs.copyFileSync(path.join(ROOT, 'data', 'showtimes.json'), tmpData);
fs.copyFileSync(path.join(ROOT, 'data', 'posters.json'), tmpPosters);
const evidence = path.join(FX, 'prices-evidence.json');

step('remap.mjs keeps ids canonical and data intact on a copy', () => {
  execFileSync(process.execPath, [path.join(HERE, 'remap.mjs'), '--data', tmpData, '--posters', tmpPosters], { stdio: 'pipe' });
  const d = JSON.parse(fs.readFileSync(tmpData, 'utf8'));
  eq(d.showings.length, 1369, 'showings preserved');
  eq(d.showings.every(s => s.film_id === canonicalId(s.film_id)), true, 'every film_id canonical');
  return '1369 showings, ids canonical';
});

// apply-prices exits 1 while any cinema has no price: that loud failure is expected here.
function applyPrices(...extra) {
  try {
    return execFileSync(process.execPath, [path.join(HERE, 'apply-prices.mjs'), '--data', tmpData, '--evidence', evidence, ...extra], { stdio: 'pipe' }).toString();
  } catch (e) {
    return (e.stdout || '').toString() + (e.stderr || '').toString();
  }
}

step('apply-prices.mjs writes stated prices into the copy', () => {
  const out = applyPrices();
  const d = JSON.parse(fs.readFileSync(tmpData, 'utf8'));
  const orfeo = d.showings.filter(s => s.cinema_id === 'orfeo');
  const citylife = d.showings.filter(s => s.cinema_id === 'citylife-anteo');
  const bicocca = d.showings.filter(s => s.cinema_id === 'uci-bicocca');
  truthy(orfeo.length && orfeo.every(s => s.price_eur === 8.5), 'orfeo flat full price');
  const weekday = citylife.filter(s => ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'].includes(s.date));
  const weekend = citylife.filter(s => ['2026-11-07', '2026-11-08'].includes(s.date));
  truthy(weekday.length && weekday.every(s => s.price_eur === 7.5), 'citylife weekday price 7,50');
  truthy(weekend.length && weekend.every(s => s.price_eur === 9), 'citylife weekend price 9,00');
  eq(bicocca.every(s => s.price_eur === null), true, 'no price invented for uci-bicocca');
  truthy(/Prices: as stated by/.test(d.cinemas.find(c => c.id === 'orfeo').notes), 'cinema notes state the price source');
  truthy(/Reserve without paying: yes/.test(d.cinemas.find(c => c.id === 'orfeo').notes), 'reserve statement recorded');
  if (!/still have no price/.test(out)) throw new Error('expected a loud report of the cinemas with no price');
  return `${d.showings.filter(s => s.price_eur != null).length} priced showings in the copy`;
});

step('apply-prices.mjs is idempotent', () => {
  const before = fs.readFileSync(tmpData, 'utf8');
  applyPrices();
  const after = JSON.parse(fs.readFileSync(tmpData, 'utf8'));
  const b = JSON.parse(before);
  eq(after.showings, b.showings, 'showings unchanged by a second pass');
  return 'second pass changes nothing';
});

step('run.mjs refuses to overwrite data when nothing could be fetched', () => {
  const src = fs.readFileSync(path.join(HERE, 'run.mjs'), 'utf8');
  truthy(/REFUSING TO WRITE/.test(src), 'write guard present');
  truthy(/wouldWipe/.test(src), 'zero-showing guard present');
  truthy(/NO PRICE captured/.test(src), 'loud per-cinema price failure present');
  return 'guards present in run.mjs';
});

step('run.mjs --replay rebuilds a real venue offline and writes nothing', () => {
  const before = fs.readFileSync(path.join(ROOT, 'data', 'showtimes.json'), 'utf8');
  const out = execFileSync(process.execPath, [path.join(HERE, 'run.mjs'), '--replay', path.join(HERE, 'logs')], { stdio: 'pipe' }).toString();
  if (!/\[replay\] rebuilding from captured payloads/.test(out)) throw new Error('replay did not start');
  if (!/^orfeo\s+ok\s+72/m.test(out)) throw new Error('orfeo was not rebuilt from its capture');
  if (!/total price coverage: 0\/72/.test(out)) throw new Error('no price coverage reported');
  if (!/no tariff endpoint without entering the purchase flow/.test(out)) throw new Error('the WebTic no-price reason was not reported');
  if (!/left untouched/.test(out)) throw new Error('replay claimed to write');
  eq(fs.readFileSync(path.join(ROOT, 'data', 'showtimes.json'), 'utf8') === before, true, 'data/showtimes.json unchanged by the replay');
  return 'orfeo: 72 showings rebuilt from logs/wt-5351.json, 0 prices (WebTic exposes none publicly), data untouched';
});

step('run.mjs refuses to let a replay overwrite the data', () => {
  try {
    execFileSync(process.execPath, [path.join(HERE, 'run.mjs'), '--replay', '--write'], { stdio: 'pipe' });
  } catch (e) {
    const out = (e.stdout || '').toString() + (e.stderr || '').toString();
    if (!/--replay cannot be combined with --write/.test(out)) throw new Error('wrong refusal: ' + out.slice(0, 120));
    eq(e.status, 2, 'exit code');
    return 'exit 2 with the reason';
  }
  throw new Error('--replay --write was accepted');
});

step('the real data/showtimes.json was not touched by this check', () => {
  const real = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'showtimes.json'), 'utf8'));
  eq(real.showings.every(s => s.price_eur === null), true, 'no fixture price leaked into real data');
  eq(real.showings.length, 1369, 'showings count');
  return 'real data untouched (live prices need a live run)';
});

fs.rmSync(tmp, { recursive: true, force: true });

// ---------------------------------------------------------- coverage report
console.log('\n=== price coverage in this offline check (fixture venues) ===');
const rows = [
  ['webtic venue (fixture)', wtShowings, wtPrices],
  ['anteo venue (fixture)', anteoShowings, { rates: P.ratesFromText(read('anteo-tariffe.html'), 'fixture'), source: 'fixture://tariffe' }],
];
for (const [name, showings, info] of rows) {
  const priced = showings.filter(s => P.resolvePrice(s, s.rates && s.rates.length ? s.rates : (info.rates || []))).length;
  const pct = showings.length ? Math.round(priced / showings.length * 100) : 0;
  console.log(`  ${name.padEnd(28)} ${String(priced).padStart(3)}/${String(showings.length).padEnd(3)} (${String(pct).padStart(3)}%)  ${info.source || (info.sources || []).join(' ') || ''}`);
}

console.log(`\n${failed ? `FAILED: ${failed} step(s)` : 'all steps passed'} (${results.length} steps)`);
process.exitCode = failed ? 1 : 0;
