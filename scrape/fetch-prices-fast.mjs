#!/usr/bin/env node
// Fast price fill: replays the WebTic front end's own JSON calls (no browser, no page parsing).
//
//   node fetch-prices-fast.mjs                  # fetch Intero for every null-price WebTic showing, patch data/showtimes.json
//   node fetch-prices-fast.mjs --dry-run        # fetch + report, write nothing
//   node fetch-prices-fast.mjs --only centrale,ducale
//   node fetch-prices-fast.mjs --validate 8     # also read 8 already-priced showings per venue and compare (never overwritten)
//   node fetch-prices-fast.mjs --from-evidence logs/prices-fast.json   # re-apply saved evidence, no network
//   node fetch-prices-fast.mjs --offline tests/fixtures/fast   # replay saved answers (tests)
//   flags: --price-field total|net --concurrency 3 --delay 1000 --limit N --refresh --sector-policy min|null --data f --evidence f
//
// Endpoints (what secure.webtic.it/angwt itself calls, anonymous, POST with empty body):
//   getFullScheduling       ?localid&trackid&wtid
//   getPurchaseTicketsInfo  ?localid&trackid&wtid&eventid&performanceid   -> Tickets.Sectors[].PriceList[]
// No login, no cart, no seat hold. A host answering 429/403/5xx/captcha is abandoned and recorded as blocked.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webticCall, parseIntero, schedulingPerformances, WEBTIC_API } from './adapters/webtic.mjs';
import { matchShowings, resolveMatch, buildEvidence, applyEvidence, isFastPriced } from './lib/prices-fast.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const has = n => args.includes(n);
const DRY = has('--dry-run');
const DATA = path.resolve(flag('--data', path.join(ROOT, 'data', 'showtimes.json')));
const EVIDENCE = path.resolve(flag('--evidence', path.join(HERE, 'logs', 'prices-fast.json')));
const OFFLINE = flag('--offline') ? path.resolve(flag('--offline')) : null;
const FROM_EV = flag('--from-evidence') ? path.resolve(flag('--from-evidence')) : null;
const CONC = Math.max(1, Math.min(4, Number(flag('--concurrency', 3))));
const DELAY = Number(flag('--delay', 1000));
const LIMIT = Number(flag('--limit', 0)) || Infinity;
const VALIDATE = Number(flag('--validate', 0)) || 0;
const POLICY = flag('--sector-policy', 'min');
const FIELD = flag('--price-field', 'total'); // total = NetPrice+ExtraPrice as the WebTic page prints it; net = ticket only
const only = new Set((flag('--only', '') || '').split(',').filter(Boolean));
const CACHE = path.join(HERE, 'cache', 'webtic-fast');
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Evidence: one line per cinema, per-performance rows compact (the file stays small and diffable).
const writeEvidence = (f, ev) => {
  const { cinemas, ...rest } = ev;
  const head = JSON.stringify(rest, null, 2).replace(/\n}$/, '');
  const body = Object.entries(cinemas).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, `${head},\n  "cinemas": {\n${body}\n  }\n}\n`);
};
const write = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n'); };

const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const bar = '='.repeat(96);

function report(stats, ev) {
  console.log(bar);
  console.log(['cinema'.padEnd(24), 'showings'.padStart(9), 'priced'.padStart(8), 'cov'.padStart(6), '  notes'].join(' '));
  const per = new Map();
  for (const s of data.showings) { const r = per.get(s.cinema_id) || { t: 0, p: 0 }; r.t++; if (s.price_eur != null) r.p++; per.set(s.cinema_id, r); }
  for (const c of data.cinemas) {
    const r = per.get(c.id) || { t: 0, p: 0 };
    if (!r.t) continue;
    const e = ev && ev.cinemas[c.id];
    console.log([c.id.padEnd(24), String(r.t).padStart(9), String(r.p).padStart(8), (Math.round(r.p / r.t * 100) + '%').padStart(6), '  ' + (e ? `${e.prices.length} from API, ${e.unmatched.length} unmatched${e.price_reason ? ' - ' + e.price_reason : ''}` : '')].join(' '));
  }
  const tot = data.showings.length, pr = data.showings.filter(s => s.price_eur != null).length;
  console.log(bar);
  console.log(`showings ${tot}, priced ${pr} (${Math.round(pr / tot * 100)}%)  set ${stats.set}, unchanged ${stats.unchanged}, conflicts left alone ${stats.conflicts.length}, notes updated ${stats.notes}`);
  for (const c of stats.conflicts.slice(0, 10)) console.log(`  conflict ${c.cinema} ${c.date} ${c.time} ${c.film_id}: file ${c.existing} vs API ${c.api}`);
}

async function main() {
  if (FROM_EV) {
    const ev = JSON.parse(fs.readFileSync(FROM_EV, 'utf8'));
    const stats = applyEvidence(data, ev, { only });
    report(stats, ev);
    if (DRY) console.log('[dry-run] nothing written'); else { write(DATA, data); console.log('wrote ' + DATA); }
    return;
  }

  const cfg = JSON.parse(fs.readFileSync(path.join(HERE, 'cinemas.json'), 'utf8'));
  const cinemas = (Array.isArray(cfg) ? cfg : cfg.cinemas).filter(c => c.source && c.source.adapter === 'webtic' && c.source.localId && (!only.size || only.has(c.id)));
  const range = data.range;
  const blocked = [];
  let hostBlocked = false;
  const live = !OFFLINE;
  let consecutiveBlocks = 0;

  // ---- one limiter for the whole host: CONC workers, DELAY ms between a worker's requests
  const queue = [];
  const worker = async () => {
    for (;;) {
      const job = queue.shift();
      if (!job) return;
      if (hostBlocked) { job.resolve({ skipped: true }); continue; }
      let r = await job.run();
      if (r.blocked) { await sleep(live ? 4000 : 0); r = await job.run(); }   // one backoff + retry
      if (r.blocked) {
        if (++consecutiveBlocks >= 2 || r.status === 429) {
          hostBlocked = true;
          blocked.push({ host: new URL(WEBTIC_API).host, status: r.status, reason: r.reason, at: new Date().toISOString() });
          console.error(`!! ${new URL(WEBTIC_API).host} blocked (${r.reason}); stopping on this host`);
        }
      } else consecutiveBlocks = 0;
      job.resolve(r);
      if (live) await sleep(DELAY);
    }
  };
  const submit = run => new Promise(resolve => queue.push({ run, resolve }));

  const readOff = f => { const p = path.join(OFFLINE, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
  const getScheduling = (localId) => OFFLINE
    ? Promise.resolve({ json: readOff(`scheduling-${localId}.json`), blocked: false })
    : submit(() => webticCall('getFullScheduling', {}, localId));
  const trim = j => ({ userdata: { StatusOk: j.userdata.StatusOk, Message: j.userdata.Message || '' }, DS: { Performance: { Tickets: j.DS && j.DS.Performance && j.DS.Performance.Tickets ? { Sectors: (j.DS.Performance.Tickets.Sectors || []).map(s => ({ SectorId: s.SectorId, SectorName: s.SectorName, PriceList: (s.PriceList || []).map(p => ({ PriceOrigin: p.PriceOrigin, PriceDescription: p.PriceDescription, PriceTypeDescription: p.PriceTypeDescription, SectorName: p.SectorName, NetPrice: p.NetPrice, ExtraPrice: p.ExtraPrice, TotalPrice: p.TotalPrice })) })) } : null } } });
  const getTickets = async (localId, p) => {
    if (OFFLINE) return { json: readOff(`tickets-${p.perf_id}.json`), blocked: false };
    const cf = path.join(CACHE, `${localId}-${p.perf_id}.json`);
    if (!has('--refresh') && fs.existsSync(cf)) return { json: JSON.parse(fs.readFileSync(cf, 'utf8')), blocked: false, cached: true };
    const r = await submit(() => webticCall('getPurchaseTicketsInfo', { eventid: p.event_id, performanceid: p.perf_id }, localId));
    if (r.json && r.json.userdata && r.json.userdata.StatusOk) { fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(cf, JSON.stringify(trim(r.json))); }
    return r;
  };
  // workers exit when the queue is empty, so they are started per batch (all jobs are queued synchronously first)
  const drain = async fn => { const ps = fn(); const ws = Array.from({ length: CONC }, () => worker()); await Promise.all([ps, ...ws]); };

  const results = [], validation = [];
  for (const c of cinemas) {
    const localId = c.source.localId;
    const mine = data.showings.filter(s => s.cinema_id === c.id);
    const targets = mine.filter(s => s.price_eur == null || isFastPriced(s)).slice(0, LIMIT);
    const result = { cinema: c.id, localId, total: mine.length, alreadyPriced: mine.filter(s => s.price_eur != null && !isFastPriced(s)).length, prices: [], unmatched: [], status: 'ok', reason: null };
    results.push(result);
    if (!targets.length && !VALIDATE) { result.status = 'nothing-to-do'; continue; }
    if (hostBlocked) { result.status = 'blocked'; result.reason = 'WebTic host blocked earlier in this run'; continue; }
    const sample = VALIDATE ? mine.filter(s => s.price_eur != null && !isFastPriced(s)).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / VALIDATE)) === 0).slice(0, VALIDATE) : [];

    let sched = null;
    await drain(async () => { sched = await getScheduling(localId); });
    if (!sched || !sched.json || sched.blocked || !sched.json.DS || !sched.json.DS.Scheduling) {
      const b = sched && (sched.blocked || sched.skipped);
      result.status = b ? 'blocked' : 'no-schedule';
      result.reason = sched && sched.reason ? sched.reason : (b ? 'WebTic host blocked' : 'getFullScheduling returned no Scheduling');
      continue;
    }
    const perfs = schedulingPerformances(sched.json.DS.Scheduling, localId).filter(p => p.date >= range.from && p.date <= range.to);
    const { matched, unmatched } = matchShowings(targets, perfs);
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
    result.unmatched.push(...unmatched.map(u => u.showing.date < today ? { ...u, reason: 'date already past: WebTic no longer lists the performance' } : u));
    const vm = matchShowings(sample, perfs).matched;

    const need = new Map();
    for (const m of [...matched, ...vm]) for (const p of m.perfs) need.set(p.perf_id, p);
    const parsed = new Map();
    let done = 0;
    await drain(async () => {
      await Promise.all([...need.values()].map(async p => {
        const r = await getTickets(localId, p);
        if (r.skipped) return;
        if (r.blocked) { parsed.set(p.perf_id, { eur: null, reason: r.reason }); return; }
        parsed.set(p.perf_id, r.json ? parseIntero(r.json, POLICY, FIELD) : { eur: null, reason: 'no answer' });
        if (live && ++done % 50 === 0) console.error(`  ${c.id}: ${done}/${need.size}`);
      }));
    });
    for (const m of matched) {
      const x = resolveMatch(m, parsed);
      if (x.entry) result.prices.push(x.entry); else result.unmatched.push({ showing: m.showing, reason: x.reason });
    }
    for (const m of vm) {
      const x = resolveMatch(m, parsed);
      if (x.entry) validation.push({ cinema: c.id, date: m.showing.date, time: m.showing.time, film_id: m.showing.film_id, file: m.showing.price_eur, api: x.entry.eur, same: m.showing.price_eur === x.entry.eur });
    }
    if (hostBlocked) { result.status = 'blocked'; result.reason = blocked[blocked.length - 1].reason; }
    console.error(`${c.id}: ${result.prices.length}/${targets.length} priced from API, ${result.unmatched.length} unmatched`);
    for (const u of result.unmatched.slice(0, 6)) console.error(`    - ${u.showing.date} ${u.showing.time} ${u.showing.film_id} ${u.showing.language}/${u.showing.format}: ${u.reason}`);
  }

  const ev = buildEvidence({ range, results, generatedAt: new Date().toISOString(), blocked });
  ev.validation = validation;
  const stats = applyEvidence(data, ev, { only });
  report(stats, ev);
  if (validation.length) {
    const same = validation.filter(v => v.same).length;
    console.log(`validation vs prices already in the file: ${same}/${validation.length} equal`);
    for (const v of validation.filter(v => !v.same)) console.log(`  differs ${v.cinema} ${v.date} ${v.time} ${v.film_id}: file ${v.file} API ${v.api}`);
  }
  if (blocked.length) console.error('BLOCKED: ' + JSON.stringify(blocked));
  if (DRY) { console.log('[dry-run] nothing written'); return; }
  writeEvidence(EVIDENCE, ev);
  write(DATA, data);
  console.log(`wrote ${path.relative(ROOT, DATA)} and ${path.relative(ROOT, EVIDENCE)}`);
}

main().catch(e => { console.error('FAILED: ' + (e && e.stack || e)); process.exit(1); });
