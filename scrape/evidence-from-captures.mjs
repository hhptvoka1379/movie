#!/usr/bin/env node
// Builds scrape/logs/prices.json from WebTic getLocalInfo captures that are already committed in
// scrape/logs (wt-*-info.json), for machines that cannot reach the sites.
//
//   cd scrape && node evidence-from-captures.mjs [--dry-run]
//
// It extracts ONLY the two statements the brief asks for - what the site says about reserving
// without paying, and about groups - plus what the capture says about online sale. It does not
// invent prices: prices_checked is written as false so apply-prices.mjs leaves price_eur alone
// until a live `node run.mjs` has actually probed for tariffs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webticPolicy, webticBooking } from './adapters/webtic.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const LOGS = path.join(HERE, 'logs');
const OUT = path.join(LOGS, 'prices.json');
const DRY = process.argv.includes('--dry-run');

const cinemas = JSON.parse(fs.readFileSync(path.join(HERE, 'cinemas.json'), 'utf8'));
const captures = fs.readdirSync(LOGS).filter(f => /^wt-\d+-info\.json$/.test(f));
const byLocal = new Map(captures.map(f => [f.match(/^wt-(\d+)-info\.json$/)[1], path.join(LOGS, f)]));

// Never throw away tariff evidence a live run already captured: merge into it.
const existing = fs.existsSync(OUT) ? (JSON.parse(fs.readFileSync(OUT, 'utf8')).cinemas || {}) : {};
if (Object.keys(existing).length) console.log(`merging into existing ${path.relative(ROOT, OUT)} (${Object.keys(existing).length} cinema(s) already recorded)`);
const evidence = {};
const report = [];
for (const c of cinemas) {
  const s = c.source || {};
  if (s.adapter !== 'webtic' || !s.localId) continue;
  const file = byLocal.get(String(s.localId));
  if (!file) {
    report.push([c.id, `no capture for localId ${s.localId}`, '', '']);
    continue;
  }
  const info = JSON.parse(fs.readFileSync(file, 'utf8'));
  const policy = webticPolicy(info);
  const booking = webticBooking(s.localId);
  const purchase = info?.DS?.Local?.PurchaseConfig?.Enabled;
  const onlineSale = purchase === true ? 'yes (WebTic purchase enabled for this venue)'
    : purchase === false ? 'not stated (WebTic reports purchase disabled for this venue)'
      : null;
  const prev = existing[c.id] || {};
  evidence[c.id] = {
    ...prev,
    cinema: c.id,
    adapter: 'webtic',
    status: 'ok',
    rates: prev.rates || [],
    prices_checked: prev.prices_checked === true,   // only a live run may claim prices were probed
    price_source: prev.price_source || null,
    tariff_urls: s.tariffUrls || s.tariffUrl || null,
    price_reason: prev.price_reason || ('tariffs were not probed: this evidence comes from a cached getLocalInfo capture' +
      ((s.tariffUrls || s.tariffUrl) ? '' : '; no source.tariffUrl configured in cinemas.json for this venue')),
    policy: { reserve: policy.reserve, group: policy.group },
    online_sale: onlineSale,
    booking,
    evidence_file: path.relative(ROOT, file),
  };
  report.push([c.id, policy.reserve, policy.group, onlineSale || '-']);
}

const bar = '='.repeat(110);
console.log(`\n${bar}\nWebTic statements read from committed captures (${captures.length} file(s))\n${bar}`);
console.log(['cinema'.padEnd(22), 'reserve without paying'.padEnd(58), 'group'.padEnd(24), 'online sale'].join(' '));
for (const [id, reserve, group, sale] of report) {
  console.log([id.padEnd(22), String(reserve).slice(0, 57).padEnd(58), String(group).slice(0, 23).padEnd(24), String(sale).slice(0, 40)].join(' '));
}

const payload = {
  generated_at: new Date().toISOString(),
  range: { from: '2026-11-06', to: '2026-11-15' },
  note: 'policy statements read from cached webtic getLocalInfo captures in scrape/logs; ' +
        'prices_checked=false, so no price is claimed. Run `node run.mjs` on a connected machine for tariffs.',
  cinemas: evidence,
};
// Keep the previous timestamp when nothing but the timestamp changed, so re-running this on the
// same captures does not churn a committed file.
const prevRaw = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
if (prevRaw) {
  const prev = JSON.parse(prevRaw);
  payload.generated_at = prev.generated_at;
  if (JSON.stringify(prev, null, 2) + '\n' === JSON.stringify(payload, null, 2) + '\n') {
    console.log(`\n${OUT} already up to date (${Object.keys(evidence).length} cinema(s)); nothing written`);
    process.exit(0);
  }
  payload.generated_at = new Date().toISOString();
}
if (DRY) {
  console.log(`\n[dry-run] not writing ${OUT}`);
} else {
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
  console.log(`\nwrote ${OUT} (${Object.keys(evidence).length} cinema(s))`);
}
