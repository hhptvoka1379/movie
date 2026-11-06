// Unit tests for the price pipeline. Runs offline against synthetic fixtures:
//   cd scrape && node --test tests/prices.test.mjs
// No price asserted here is a real cinema price; see tests/fixtures/README.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as P from '../lib/prices.mjs';
import { collectPrices, webticToShowings, webticPolicy, webticBooking } from '../adapters/webtic.mjs';
import { tariffUrls, anteoToShowings } from '../adapters/anteo.mjs';

const FX = new URL('./fixtures/', import.meta.url);
const read = f => fs.readFileSync(fileURLToPath(new URL(f, FX)), 'utf8');

// 2026-11-09 Mon, 11 Wed, 14 Sat, 15 Sun
test('parseEur reads Italian amounts', () => {
  assert.equal(P.parseEur('12,50'), 12.5);
  assert.equal(P.parseEur('9.50'), 9.5);
  assert.equal(P.eurFromText('\u20ac 9.50 intero'), 9.5);
  assert.equal(P.parseEur('8'), 8);
  assert.equal(P.parseEur(7.5), 7.5);
  assert.equal(P.parseEur('12.500'), null); // thousands separator only: no ticket costs that much
  assert.equal(P.parseEur('gratis'), null);
  assert.equal(P.parseEur(null), null);
});

test('eurFromText only fires on a stated euro amount', () => {
  assert.equal(P.eurFromText('Intero 8,50 \u20ac'), 8.5);
  assert.equal(P.eurFromText('\u20ac 9.50 intero'), 9.5);
  assert.equal(P.eurFromText('biglietti in vendita'), null);
  assert.equal(P.eurFromText('Durata: 118 minuti'), null);
});

test('full vs reduced vs supplement', () => {
  assert.ok(P.labelIsFull('Intero'));
  assert.ok(P.labelIsFull('Intero feriali (lun-ven)'));
  assert.ok(P.labelIsFull('Intero 3D'));
  assert.ok(!P.labelIsFull('Ridotto under 26'));
  assert.ok(!P.labelIsFull('Abbonamento 10 ingressi'));
  assert.ok(!P.labelIsFull('Supplemento 3D'));
  assert.ok(P.labelIsSupplement('Supplemento 3D'));
  assert.equal(P.labelCondition('Intero festivi').day, true);
  assert.equal(P.labelCondition('Intero 3D').format, true);
  assert.equal(P.labelCondition('Intero').any, false);
});

test('ratesFromText reads a tariff page and decodes entities', () => {
  const rates = P.ratesFromText(read('anteo-tariffe.html'), 'fixture');
  const byLabel = Object.fromEntries(rates.map(r => [r.label, r.eur]));
  assert.equal(byLabel['Intero feriali (lun-ven)'], 7.5);
  assert.equal(byLabel['Intero festivi e prefestivi'], 9);
  assert.equal(byLabel['Ridotto under 26'], 5);
  assert.equal(byLabel['Supplemento 3D'], 2);
  assert.equal(byLabel['Luned\u00ec cinema'], 3.5);
  assert.ok(rates.every(r => r.source === 'fixture'));
});

test('ratesFromText ignores lines that are not ticket prices', () => {
  const rates = P.ratesFromText('Pop corn menu 5,00 \u20ac\nParcheggio 2,00 \u20ac\nIntero 8,00 \u20ac', 'x');
  assert.deepEqual(rates.map(r => r.label), ['Intero']);
});

test('scopedRowRates ties a tariff row to its performance', () => {
  const payload = JSON.parse(read('webtic-prices.json'))['getLocalPrices?localId=5068'];
  const scoped = P.scopedRowRates(payload, 'webtic:getLocalPrices');
  const perf = scoped.filter(r => r.scope === 'performance');
  assert.ok(perf.some(r => r.id === 177377 && r.eur === 9.5));
  assert.ok(scoped.some(r => r.scope === 'event' && r.id === 3016 && r.eur === 8.5));
});

test('resolvePrice follows the day the site states', () => {
  const rates = P.ratesFromText(read('anteo-tariffe.html'), 'fixture');
  assert.equal(P.resolvePrice({ date: '2026-11-11', format: '2D' }, rates).eur, 7.5); // Wed -> feriali
  assert.equal(P.resolvePrice({ date: '2026-11-09', format: null }, rates).eur, 7.5);  // Mon
  assert.equal(P.resolvePrice({ date: '2026-11-14', format: '2D' }, rates).eur, 9);     // Sat -> festivi
  assert.equal(P.resolvePrice({ date: '2026-11-15', format: '2D' }, rates).eur, 9);     // Sun
});

test('resolvePrice adds a stated format supplement', () => {
  const rates = P.ratesFromText(read('anteo-tariffe.html'), 'fixture');
  const r = P.resolvePrice({ date: '2026-11-14', format: '3D' }, rates);
  assert.equal(r.eur, 11);            // 9,00 festivi + 2,00 supplemento 3D
  assert.equal(r.base, 9);
  assert.equal(r.supplement, 2);
  assert.match(r.label, /Supplemento 3D/);
});

test('resolvePrice never returns a reduced rate', () => {
  assert.equal(P.resolvePrice({ date: '2026-11-11' }, [{ label: 'Ridotto studenti', eur: 5 }]), null);
  assert.equal(P.resolvePrice({ date: '2026-11-11' }, [{ label: 'Abbonamento 10 ingressi', eur: 50 }]), null);
});

test('resolvePrice returns null when several full prices could apply', () => {
  assert.equal(P.resolvePrice({ date: '2026-11-11', format: '2D' },
    [{ label: 'Intero sala A', eur: 8 }, { label: 'Intero sala B', eur: 10 }]), null);
});

test('resolvePrice returns null when nothing is stated', () => {
  assert.equal(P.resolvePrice({ date: '2026-11-11' }, []), null);
  assert.equal(P.resolvePrice({ date: '2026-11-11' }, null), null);
});

test('ratesNote keeps every stated rate', () => {
  const note = P.ratesNote(P.ratesFromText(read('anteo-tariffe.html'), 'fixture'));
  assert.match(note, /Intero feriali \(lun-ven\) \u20ac7,50/);
  assert.match(note, /Ridotto under 26 \u20ac5,00 \(ridotto\)/);
  assert.match(note, /Supplemento 3D \u20ac2,00 \(supplemento\)/);
});

test('webtic collectPrices reads the captured tariff payload', () => {
  const cap = JSON.parse(read('webtic-prices.json'));
  const prices = collectPrices(cap, [], 5068);
  const byPerf = new Map(prices.byPerformance);
  assert.equal(byPerf.get(177377).find(r => r.eur === 9.5).label, 'Intero');
  assert.equal(byPerf.get(177378).find(r => r.eur === 12).label, 'Intero 3D');
  assert.equal(prices.reason, null);
});

test('webtic collectPrices says why when the platform states no price', () => {
  const cap = JSON.parse(read('webtic-prices.json'));
  const prices = collectPrices({ getFullScheduling: cap.getFullScheduling, getLocalInfo: cap.getLocalInfo }, [], 5068);
  assert.equal(prices.local.length, 0);
  assert.match(prices.reason, /no tariff endpoint without entering the purchase flow/);
});

test('webtic showings carry the rate set of their own performance', () => {
  const cap = JSON.parse(read('webtic-prices.json'));
  const prices = collectPrices(cap, [], 5068);
  const showings = webticToShowings(cap.getFullScheduling.DS.Scheduling, 5068, prices);
  assert.equal(showings.length, 2);
  const s1 = showings.find(s => s.date === '2026-11-10');
  assert.ok(s1.rates.some(r => r.eur === 9.5 && r.label === 'Intero'));
  assert.equal(P.resolvePrice(s1, s1.rates).eur, 9.5);
  const s2 = showings.find(s => s.date === '2026-11-14');
  assert.equal(P.resolvePrice(s2, s2.rates).eur, 12);
  assert.equal(s1.booking_url, null); // venue booking_url is used until a perf URL is confirmed
});

test('webtic policy statements come only from getLocalInfo text', () => {
  const cap = JSON.parse(read('webtic-prices.json'));
  const st = webticPolicy(cap.getLocalInfo);
  assert.match(st.reserve, /^yes/);
  assert.match(st.reserve, /30 minutes before the show/);
  assert.match(st.reserve, /\u20ac1,00 per ticket/);
  assert.match(st.group, /not stated \(online booking is limited to 8 adjacent seats\)/);
  assert.equal(st.source, 'webtic getLocalInfo Infos');
});

test('webtic policy is "not stated" when the payload has none', () => {
  const st = webticPolicy({ DS: { Local: { LocalId: 1, Infos: {} } } });
  assert.equal(st.reserve, 'not stated');
  assert.equal(st.group, 'not stated');
  assert.equal(webticPolicy(null).reserve, 'not stated');
});

test('webtic booking: no invented deep link', () => {
  const b = webticBooking(5351);
  assert.equal(b.venue, 'https://www.webtic.it/#/shopping?action=loadLocal&localId=5351');
  assert.equal(b.perfTemplate, null);
  assert.match(b.reason, /no public per-performance URL/);
});

test('anteo tariff url candidates', () => {
  const u = tariffUrls('Citylife anteo');
  assert.equal(u[0], 'https://www.spaziocinema.info/cinema/tariffe/citylife-anteo');
  assert.ok(u.includes('https://www.spaziocinema.info/cinema/tariffe/citylife'));
  assert.ok(u.includes('https://www.spaziocinema.info/cinema/tariffe'));
  assert.deepEqual(tariffUrls(''), ['https://www.spaziocinema.info/cinema/tariffe', 'https://www.spaziocinema.info/milano/tariffe']);
});

test('anteo showings take the venue tariff and the projection page price', () => {
  const tariffs = { url: 'fixture', rates: P.ratesFromText(read('anteo-tariffe.html'), 'fixture') };
  const proj = new Map([['https://example.invalid/p/1', P.ratesFromText(read('anteo-projection.html'), 'fixture')]]);
  const rows = [
    { film: { title: 'Film di prova', year: '2026', length: 118, language: 'Italiano', technologies: '' },
      o: { date: '2026-11-11', hour: '21:00', technologies: [], projection_url: 'https://example.invalid/p/1' } },
    { film: { title: 'V.O. Another Film', year: '2026', length: 100, language: 'English', technologies: ['3D'] },
      o: { date: '2026-11-15', hour: '17:30', technologies: ['3D'], projection_url: 'https://example.invalid/p/2' } },
  ];
  const showings = anteoToShowings({ rows, tariffs, projectionPrices: proj }, tariffs);
  assert.equal(showings[0].language, 'ita');
  assert.equal(showings[1].language, 'vos');
  assert.equal(showings[1].format, '3D');
  // the projection page states its own price for that showing
  assert.equal(P.resolvePrice(showings[0], showings[0].rates).eur, 8);
  // the second showing falls back to the venue tariff: Sun festivi + 3D supplement
  assert.equal(P.resolvePrice(showings[1], showings[1].rates).eur, 11);
  assert.equal(showings[0].booking_url, 'https://example.invalid/p/1');
});

test('policyStatements reads reservation and group text', () => {
  const text = read('anteo-tariffe.html');
  const st = P.policyStatements([text]);
  assert.match(st.reserve, /^yes/);
  assert.match(st.group, /^stated/);
  assert.match(st.group, /^stated/);
  assert.match(st.group, /contact the cinema|gruppi oltre 20 persone/i);
});

test('policyStatements stays silent when nothing is stated', () => {
  const st = P.policyStatements(['Il cinema ha tre sale. Orari: dalle 15 alle 24.']);
  assert.equal(st.reserve, 'not stated');
  assert.equal(st.group, 'not stated');
});
