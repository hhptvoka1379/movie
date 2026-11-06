// Offline tests for fetch-missing-prices.mjs. No network: every page is a synthetic fixture.
//   cd scrape && node --test tests/fetch-missing-prices.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as P from '../lib/prices.mjs';
import { tariffUrlsOf, selectTargets, evaluatePage, buildEvidence, coverage } from '../fetch-missing-prices.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FX = path.join(HERE, 'fixtures');
const read = f => fs.readFileSync(path.join(FX, f), 'utf8');
const APPLY = path.join(HERE, '..', 'apply-prices.mjs');
const REAL_DATA = path.join(HERE, '..', '..', 'data', 'showtimes.json');
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

test('tariffUrlsOf reads tariffUrls and tariffUrl, keeps http(s) only, dedupes', () => {
  assert.deepEqual(tariffUrlsOf({ source: { tariffUrls: ['https://a.it/x', 'https://a.it/x', 'ftp://no'] } }), ['https://a.it/x']);
  assert.deepEqual(tariffUrlsOf({ source: { tariffUrl: 'https://b.it/' } }), ['https://b.it/']);
  assert.deepEqual(tariffUrlsOf({ source: { adapter: 'none' } }), []);
  assert.deepEqual(tariffUrlsOf({}), []);
});

test('selectTargets skips cinemas with no null price, with curated rates, or with no tariff page', () => {
  const cinemas = [
    { id: 'full', source: { tariffUrls: ['https://x.it/'] } },       // no null showings -> not a target
    { id: 'curated', source: { tariffUrls: ['https://x.it/'] } },    // curated rates exist -> skipped
    { id: 'nopage', source: { adapter: 'webtic' } },                 // null, no URL -> skipped
    { id: 'todo', source: { tariffUrls: ['https://y.it/p'] } },      // null, URL -> fetched
    { id: 'preserved', source: { tariffUrls: ['https://x.it/'] } },  // per-showing curation -> skipped
  ];
  const showings = [
    { cinema_id: 'full', price_eur: 7 },
    { cinema_id: 'curated', price_eur: null },
    { cinema_id: 'nopage', price_eur: null },
    { cinema_id: 'todo', price_eur: null },
    { cinema_id: 'preserved', price_eur: null },
  ];
  const curated = { cinemas: {
    curated: { rates: [{ label: 'Intero', eur: 7 }] },
    preserved: { preserve_showing_prices: true, rates: [] },
  } };
  const t = selectTargets({ cinemas, showings, curated });
  const byId = Object.fromEntries(t.map(x => [x.id, x]));
  assert.equal(byId.full, undefined);
  assert.match(byId.preserved.skip, /preserve_showing_prices/);
  assert.match(byId.curated.skip, /curated tariffs/);
  assert.match(byId.nopage.skip, /no tariff page/);
  assert.deepEqual(byId.todo.urls, ['https://y.it/p']);
  assert.deepEqual(selectTargets({ cinemas, showings, curated, only: new Set(['nopage']) }).map(x => x.id), ['nopage']);
});

test('evaluatePage: a bot wall is recorded as blocked and nothing is parsed from it', () => {
  const byStatus = evaluatePage({ url: 'https://z.it/', status: 999, body: '' });
  assert.equal(byStatus.blocked, true);
  assert.match(byStatus.reason, /not bypassed/);
  const byBody = evaluatePage({ url: 'https://z.it/', status: 200, body: read('missing-waf-block.html') });
  assert.equal(byBody.blocked, true);
  assert.deepEqual(byBody.rates, []);
  assert.equal(evaluatePage({ url: 'https://z.it/', status: 429, body: '' }).blocked, true);
});

test('evaluatePage reads the full-price rates a page states and reports HTTP and network errors', () => {
  const r = evaluatePage({ url: 'https://t.it/prezzi', status: 200, body: read('missing-tariff-page.html') });
  assert.equal(r.blocked, false);
  const byLabel = Object.fromEntries(r.rates.map(x => [x.label, x.eur]));
  assert.equal(byLabel['Intero feriali'], 6);
  assert.equal(byLabel['Intero festivi'], 8);
  assert.equal(r.reason, null);
  assert.equal(evaluatePage({ url: 'https://t.it/x', status: 404, body: '' }).reason, 'HTTP 404');
  assert.match(evaluatePage({ url: 'https://t.it/x', error: 'timeout' }).reason, /request failed/);
});

test('cineforum and card rates are never taken as the full ticket price', () => {
  assert.equal(P.labelIsFull('Cineforum Pomeridiano'), false);
  assert.equal(P.labelIsFull('Cineforum Serale'), false);
  assert.equal(P.labelIsFull('Carta Cinema'), false);
  assert.equal(P.labelIsFull('Intero'), true);
  assert.equal(P.labelIsFull('Pomeridiano feriale'), true);
});

test('a membership-only page yields no ticket price', () => {
  const r = evaluatePage({ url: 'https://c.it/', status: 200, body: read('missing-membership.html') });
  assert.deepEqual(r.rates, []);
  assert.equal(r.reason, 'page states no full ticket price');
});

test('the rates from the fixture page resolve to the stated day price', () => {
  const rates = evaluatePage({ url: 'https://t.it/', status: 200, body: read('missing-tariff-page.html') }).rates;
  assert.equal(P.resolvePrice({ date: '2026-11-10', format: '2D' }, rates).eur, 6); // Tue -> feriali
  assert.equal(P.resolvePrice({ date: '2026-11-14', format: '2D' }, rates).eur, 8); // Sat -> festivi
});

test('buildEvidence has the shape apply-prices reads and keeps the reason when nothing is stated', () => {
  const ok = evaluatePage({ url: 'https://t.it/', status: 200, body: read('missing-tariff-page.html') });
  const no = evaluatePage({ url: 'https://c.it/', status: 999, body: '' });
  const ev = buildEvidence({ venueA: [ok], venueB: [no] });
  assert.equal(ev.cinemas.venueA.price_source, 'https://t.it/');
  assert.ok(ev.cinemas.venueA.rates.length >= 2);
  assert.equal(ev.cinemas.venueB.rates.length, 0);
  assert.equal(ev.cinemas.venueB.prices_checked, true);
  assert.match(ev.cinemas.venueB.price_reason, /blocked/);
});

test('coverage counts priced and total showings for one cinema', () => {
  const s = [{ cinema_id: 'a', price_eur: 1 }, { cinema_id: 'a', price_eur: null }, { cinema_id: 'b', price_eur: 2 }];
  assert.deepEqual(coverage(s, 'a'), { total: 2, priced: 1 });
  assert.deepEqual(coverage(s, 'none'), { total: 0, priced: 0 });
});

test('end to end on a temp copy: stated prices reach the showings, the real data file is untouched', () => {
  const before = sha(REAL_DATA);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fmp-test-'));
  try {
    const data = {
      generated_at: 'test', range: {}, films: [],
      cinemas: [{ id: 'fixture-venue', name: 'Fixture', notes: '' }, { id: 'blocked-venue', name: 'Blocked', notes: '' }],
      showings: [
        { film_id: 'f1', cinema_id: 'fixture-venue', date: '2026-11-10', time: '20:00', language: 'ita', format: '2D', price_eur: null, booking_url: null },
        { film_id: 'f1', cinema_id: 'fixture-venue', date: '2026-11-14', time: '20:00', language: 'ita', format: '2D', price_eur: null, booking_url: null },
        { film_id: 'f2', cinema_id: 'blocked-venue', date: '2026-11-10', time: '20:00', language: 'ita', format: '2D', price_eur: null, booking_url: null },
      ],
    };
    const dataFile = path.join(dir, 'showtimes.json');
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
    const ev = buildEvidence({
      'fixture-venue': [evaluatePage({ url: 'https://t.it/', status: 200, body: read('missing-tariff-page.html') })],
      'blocked-venue': [evaluatePage({ url: 'https://b.it/', status: 999, body: '' })],
    });
    const evFile = path.join(dir, 'evidence.json');
    fs.writeFileSync(evFile, JSON.stringify(ev));
    const r = spawnSync(process.execPath, [APPLY, '--evidence', evFile, '--data', dataFile, 'fixture-venue', 'blocked-venue'], { encoding: 'utf8' });
    assert.ok(r.status === 0 || r.status === 1, r.stderr);
    const out = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    const byKey = Object.fromEntries(out.showings.map(s => [`${s.cinema_id}|${s.date}`, s]));
    assert.equal(byKey['fixture-venue|2026-11-10'].price_eur, 6);   // Tue -> feriali
    assert.equal(byKey['fixture-venue|2026-11-14'].price_eur, 8);   // Sat -> festivi
    assert.equal(byKey['blocked-venue|2026-11-10'].price_eur, null); // blocked: stays null
    const note = out.cinemas.find(c => c.id === 'blocked-venue').notes;
    assert.match(note, /Prices: not stated publicly/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(sha(REAL_DATA), before, 'real data/showtimes.json must not change in tests');
});
