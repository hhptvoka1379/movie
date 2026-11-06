// Offline tests for the WebTic API price fill. Everything runs on SYNTHETIC answers in
// tests/fixtures/fast (invented venue, films and prices); no network is touched.
//   cd scrape && node --test tests/fetch-prices-fast.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseIntero, schedulingPerformances, webticCall, webticRequest } from '../adapters/webtic.mjs';
import { matchShowings, resolveMatch, applyEvidence, buildEvidence, noteFor } from '../lib/prices-fast.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FX = path.join(HERE, 'fixtures', 'fast');
const rd = f => JSON.parse(fs.readFileSync(path.join(FX, f), 'utf8'));

test('webticRequest builds the front end call: POST, empty body, wtid + ids in the query', () => {
  const { url, init } = webticRequest('getPurchaseTicketsInfo', { eventid: 7, performanceid: 8 }, 5065);
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, 'https://secure.webtic.it/api/wtjsonservices.ashx');
  assert.equal(u.searchParams.get('wtid'), 'getPurchaseTicketsInfo');
  assert.equal(u.searchParams.get('localid'), '5065');
  assert.equal(u.searchParams.get('performanceid'), '8');
  assert.equal(init.method, 'POST');
  assert.equal(init.body, '');
  assert.ok(!('Authorization' in init.headers) && !('Cookie' in init.headers));
});

test('webticCall marks 429, 5xx, HTML and captcha answers as blocked', async () => {
  const mk = (status, text) => async () => ({ status, text: async () => text });
  assert.equal((await webticCall('x', {}, 1, mk(429, ''))).blocked, true);
  assert.equal((await webticCall('x', {}, 1, mk(503, ''))).blocked, true);
  const html = await webticCall('x', {}, 1, mk(200, '<html>Access denied - captcha</html>'));
  assert.equal(html.blocked, true);
  assert.match(html.reason, /captcha/);
  const rc = await webticCall('x', {}, 1, mk(200, JSON.stringify({ userdata: { StatusOk: false, Message: 'recaptcha required' } })));
  assert.equal(rc.blocked, true);
  const ok = await webticCall('x', {}, 1, mk(200, JSON.stringify({ userdata: { StatusOk: true }, DS: {} })));
  assert.equal(ok.blocked, false);
  assert.equal((await webticCall('x', {}, 1, async () => { throw new Error('ECONNRESET'); })).blocked, true);
});

test('parseIntero reads the public Intero net price, never fee, reduced or card rows', () => {
  const r = parseIntero(rd('tickets-900101.json'));
  assert.equal(r.eur, 8.5, 'price printed by the page = NetPrice + ExtraPrice');
  assert.equal(r.net_eur, 7.5);
  assert.equal(r.fee_eur, 1);
  assert.equal(parseIntero(rd('tickets-900101.json'), 'min', 'net').eur, 7.5);
  assert.equal(r.multi_sector, false);
  assert.equal(r.sectors.length, 1);
});

test('parseIntero: sectors that price Intero differently -> cheapest, spread kept; policy null -> null', () => {
  const j = rd('tickets-900201.json');
  const r = parseIntero(j);
  assert.equal(r.eur, 6.7);
  assert.equal(r.fee_eur, 1.2);
  assert.equal(r.multi_sector, true);
  assert.deepEqual(r.sectors.map(s => s.eur).sort((a, b) => a - b), [6.7, 12.7]);
  const strict = parseIntero(j, 'null');
  assert.equal(strict.eur, null);
  assert.match(strict.reason, /differs by sector/);
});

test('parseIntero: no public Intero row, or no Tickets block, stays null with a reason', () => {
  assert.equal(parseIntero(rd('tickets-900301.json')).eur, null);
  assert.match(parseIntero(rd('tickets-900301.json')).reason, /no public Intero/);
  const none = parseIntero({ userdata: { StatusOk: false, Message: 'denied' }, DS: {} });
  assert.equal(none.eur, null);
  assert.equal(parseIntero(null).eur, null);
});

test('schedulingPerformances + matchShowings pair showings with performance ids', () => {
  const perfs = schedulingPerformances(rd('scheduling-5065.json').DS.Scheduling, 5065);
  assert.equal(perfs.length, 5);
  assert.equal(perfs[0].film_id, 'film-sintetico-uno');
  const data = rd('data.json');
  const targets = data.showings.filter(s => s.price_eur == null);
  const { matched, unmatched } = matchShowings(targets, perfs);
  assert.equal(matched.length, 4);
  assert.equal(unmatched.length, 1);
  assert.equal(unmatched[0].showing.film_id, 'film-fantasma');
  const due = matched.find(m => m.showing.film_id === 'film-sintetico-due');
  assert.deepEqual(due.perfs.map(p => p.perf_id), [900201]);
});

test('matchShowings: a renamed title is matched by slot only when the slot is unique on both sides', () => {
  const perfs = [{ film_id: 'new-spelling', date: '2026-11-09', time: '18:00', language: 'ita', format: '2D', event_id: 1, perf_id: 11 }];
  const one = [{ film_id: 'old-spelling', cinema_id: 'c', date: '2026-11-09', time: '18:00', language: 'ita', format: '2D' }];
  assert.equal(matchShowings(one, perfs).matched[0].how, 'time-unique');
  const two = [...one, { ...one[0], film_id: 'other' }];
  assert.equal(matchShowings(two, perfs).matched.length, 0);
});

test('resolveMatch refuses slot candidates that disagree on price', () => {
  const m = { showing: { film_id: 'f', date: 'd', time: 't', language: 'ita', format: '2D' }, how: 'film+time', perfs: [{ perf_id: 1, event_id: 1 }, { perf_id: 2, event_id: 1 }] };
  const mkr = eur => ({ eur, fee_eur: 1, label: 'INTERO', sector: 'PT', sectors: [{ sector: 'PT', label: 'INTERO', eur, fee_eur: 1 }] });
  assert.ok(resolveMatch(m, new Map([[1, mkr(7)], [2, mkr(7)]])).entry);
  assert.match(resolveMatch(m, new Map([[1, mkr(7)], [2, mkr(8)]])).reason, /different prices/);
  assert.match(resolveMatch(m, new Map([[1, mkr(7)], [2, { eur: null, reason: 'no Intero stated' }]])).reason, /different prices/);
});

function runOffline(dataIn, extra = []) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fast-'));
  const data = path.join(tmp, 'showtimes.json');
  const evidence = path.join(tmp, 'prices-fast.json');
  fs.copyFileSync(dataIn, data);
  const run = (more = []) => spawnSync(process.execPath, [path.join(HERE, '..', 'fetch-prices-fast.mjs'), '--offline', FX, '--data', data, '--evidence', evidence, ...extra, ...more], { encoding: 'utf8' });
  return { tmp, data, evidence, run };
}

test('offline run fills only null prices, keeps null where no Intero is stated, and is idempotent', () => {
  const t = runOffline(path.join(FX, 'data.json'), ['--only', 'ducale']);
  const r1 = t.run();
  assert.equal(r1.status, 0, r1.stderr);
  const d1 = JSON.parse(fs.readFileSync(t.data, 'utf8'));
  const by = (film, time, date = '2026-11-09') => d1.showings.find(s => s.film_id === film && s.time === time && s.date === date);
  assert.equal(by('film-sintetico-uno', '18:00').price_eur, 8.5);
  assert.equal(by('film-sintetico-uno', '21:00').price_eur, 10);
  assert.equal(by('film-sintetico-uno', '18:00', '2026-11-10').price_eur, 6.0, 'an existing price is never overwritten');
  assert.equal(by('film-sintetico-due', '18:00').price_eur, 6.7, 'cheapest sector Intero');
  assert.match(by('film-sintetico-due', '18:00').price_note, /VIP/);
  assert.equal(by('film-sintetico-tre', '20:00').price_eur, null, 'no public Intero row -> null');
  assert.equal(by('film-fantasma', '19:00', '2026-11-12').price_eur, null, 'unknown performance -> null');
  assert.match(d1.cinemas[0].notes, /Prezzo intero per proiezione/);
  assert.ok(!/mostrata solo dopo/.test(d1.cinemas[0].notes), 'stale "price only after seat pick" note replaced');
  const ev = JSON.parse(fs.readFileSync(t.evidence, 'utf8'));
  assert.equal(ev.cinemas.ducale.prices.length, 3);
  assert.equal(ev.cinemas.ducale.unmatched.length, 2);
  assert.equal(ev.cinemas.ducale.preserve_showing_prices, true);
  assert.deepEqual(ev.cinemas.ducale.rates, [], 'partial coverage -> no venue-wide rates for apply-prices to re-resolve from');
  // second run and a replay from the saved evidence change nothing
  const before = fs.readFileSync(t.data, 'utf8');
  assert.equal(t.run().status, 0);
  assert.equal(fs.readFileSync(t.data, 'utf8'), before);
  const re = spawnSync(process.execPath, [path.join(HERE, '..', 'fetch-prices-fast.mjs'), '--from-evidence', t.evidence, '--data', t.data], { encoding: 'utf8' });
  assert.equal(re.status, 0, re.stderr);
  assert.equal(fs.readFileSync(t.data, 'utf8'), before);
});

test('applyEvidence leaves a different existing price alone and reports the conflict', () => {
  const data = rd('data.json');
  data.showings[0].price_eur = 6.5;
  const ev = { cinemas: { ducale: { prices: [{ film_id: 'film-sintetico-uno', date: '2026-11-09', time: '18:00', language: 'ita', format: '2D', eur: 7.5, fee_eur: 1, multi_sector: false, sectors: [] }], unmatched: [] } } };
  const st = applyEvidence(data, ev);
  assert.equal(st.conflicts.length, 1);
  assert.equal(st.set, 0);
  assert.equal(data.showings[0].price_eur, 6.5);
});

test('buildEvidence emits venue rates only when every showing was priced', () => {
  const entry = { eur: 8, net_eur: 7, fee_eur: 1 };
  const full = buildEvidence({ range: {}, generatedAt: 'x', results: [{ cinema: 'a', total: 2, alreadyPriced: 0, prices: [entry, entry], unmatched: [], status: 'ok' }] });
  assert.equal(full.cinemas.a.rates.length, 1);
  assert.equal(full.cinemas.a.pct, 100);
  const part = buildEvidence({ range: {}, generatedAt: 'x', results: [{ cinema: 'a', total: 3, alreadyPriced: 0, prices: [entry, entry], unmatched: [{ showing: {}, reason: 'r' }], status: 'ok' }] });
  assert.deepEqual(part.cinemas.a.rates, []);
});

test('noteFor splits ticket and fee and lists the other sectors', () => {
  const n = noteFor({ eur: 6.7, net_eur: 5.5, fee_eur: 1.2, multi_sector: true, sectors: [{ sector: 'CLASSIC', eur: 6.7 }, { sector: 'VIP', eur: 12.7 }] });
  assert.match(n, /Intero €6,70/);
  assert.match(n, /VIP €12,70/);
  assert.match(n, /biglietto €5,50 \+ €1,20 commissione/);
});
