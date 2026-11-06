#!/usr/bin/env node
// Applies captured price/policy evidence to ../data/showtimes.json without re-scraping.
//
//   node apply-prices.mjs                          # logs/prices.json -> data/showtimes.json
//   node apply-prices.mjs --dry-run                # report only, write nothing
//   node apply-prices.mjs --evidence <file>        # another evidence file (e.g. a fixture)
//   node apply-prices.mjs --data <file>            # another showtimes file (e.g. a temp copy)
//   node apply-prices.mjs orfeo colosseo           # only these cinema ids
//
// Evidence is produced by run.mjs (scrape/logs/prices.json). Only what a source states is
// applied: price_eur is the full price for that showing's day and format, null when the
// source states none or several conflicting full prices. Idempotent.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalId } from './lib/normalize.mjs';
import { resolvePrice, ratesNote, cleanRates, formatEur } from './lib/prices.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DEFAULT_DATA = path.join(ROOT, 'data', 'showtimes.json');
const DEFAULT_EVIDENCE = path.join(HERE, 'logs', 'prices.json');

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const flagPath = name => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? path.resolve(args[i + 1]) : null;
};
const EVIDENCE = flagPath('--evidence') || DEFAULT_EVIDENCE;
const DATA = flagPath('--data') || DEFAULT_DATA;
const valueIdx = new Set(['--evidence', '--data'].map(f => args.indexOf(f) + 1).filter(i => i > 0));
const only = new Set(args.filter((a, i) => !a.startsWith('--') && !valueIdx.has(i)));

if (!fs.existsSync(EVIDENCE)) {
  console.error(`apply-prices: no evidence file at ${EVIDENCE}`);
  console.error('Run "cd scrape && node run.mjs" on a machine that can reach the cinema sites first.');
  process.exit(1);
}
const ev = JSON.parse(fs.readFileSync(EVIDENCE, 'utf8'));
const d = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const bar = '='.repeat(96);

let touched = 0, priced = 0, notesChanged = 0;

// ---------------------------------------------------------------- showings
for (const s of d.showings) {
  s.film_id = canonicalId(s.film_id); // ids stay canonical even when evidence is applied directly
  const e = ev.cinemas && ev.cinemas[s.cinema_id];
  if (!e || (only.size && !only.has(s.cinema_id))) continue;
  const rates = cleanRates(e.rates || []);
  if (!rates.length) continue;
  const r = resolvePrice(s, rates);
  const before = s.price_eur;
  s.price_eur = r ? r.eur : null;
  // Only write price_note where there is something to say, so showings with no stated price
  // keep the shape they already have in the committed file.
  const note = ratesNote(rates);
  if (r || note) s.price_note = note;
  if (s.price_eur != null) priced++;
  if (before !== s.price_eur) touched++;
}

// ---------------------------------------------------------------- cinemas
// Replaces a "Label: ..." statement in a cinema's notes. Existing notes separate sentences
// with ". " and appended ones with " | ", so normalise to " | " segments first; that keeps the
// update idempotent instead of stacking a second copy of the same statement.
const statement = (notes, label, value) => {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${esc}:`, 'i');
  const segments = String(notes || '')
    .split(' | ')
    .flatMap(seg => seg.split(/\.\s+(?=[A-Z][^:]{0,40}:)/))
    .map(seg => seg.replace(/\.+\s*$/, '').trim())
    .filter(Boolean)
    .filter(seg => !re.test(seg));
  const v = String(value == null ? '' : value).replace(/\.+\s*$/, '').trim();
  if (v && v !== 'not stated') segments.push(`${label}: ${v}`);
  else if (!segments.some(seg => re.test(seg))) segments.push(`${label}: not stated`);
  return segments.join(' | ');
};

for (const c of d.cinemas) {
  const e = ev.cinemas && ev.cinemas[c.id];
  if (!e || (only.size && !only.has(c.id))) continue;
  const before = c.notes;
  const rates = cleanRates(e.rates || []);
  if (e.policy) {
    if (e.policy.reserve) c.notes = statement(c.notes, 'Reserve without paying', e.policy.reserve);
    if (e.policy.group) c.notes = statement(c.notes, 'Group policy', e.policy.group);
  }
  if (rates.length) {
    c.notes = statement(c.notes, 'Prices', `as stated by ${e.price_source || 'the site'}: ${ratesNote(rates, 6)}`);
  } else if (e.price_reason && e.prices_checked !== false) {
    c.notes = statement(c.notes, 'Prices', `not stated publicly (${e.price_reason})`);
  }
  if (c.notes !== before) notesChanged++;
}

// ---------------------------------------------------------------- report
const perCinema = new Map();
for (const s of d.showings) {
  const row = perCinema.get(s.cinema_id) || { total: 0, priced: 0 };
  row.total++;
  if (s.price_eur != null) row.priced++;
  perCinema.set(s.cinema_id, row);
}
console.log(bar);
console.log(`apply-prices  evidence=${path.relative(ROOT, EVIDENCE)}  data=${path.relative(ROOT, DATA)}${DRY ? '  [dry-run]' : ''}`);
console.log(bar);
console.log(['cinema'.padEnd(26), 'showings'.padStart(9), 'priced'.padStart(8), 'cov'.padStart(6), '  full price / why not'].join(' '));
const noEvidence = [];
for (const c of d.cinemas) {
  const row = perCinema.get(c.id) || { total: 0, priced: 0 };
  const e = ev.cinemas && ev.cinemas[c.id];
  const pct = row.total ? Math.round((row.priced / row.total) * 100) : 0;
  const why = !e ? 'no evidence captured'
    : (e.rates && e.rates.length) ? (e.price_source || 'stated') + ' ' + (e.rates[0].eur != null ? formatEur(e.rates[0].eur) : '')
      : (e.price_reason || 'no price stated by the source');
  console.log([c.id.padEnd(26), String(row.total).padStart(9), String(row.priced).padStart(8), (pct + '%').padStart(6), '  ' + why].join(' '));
  if (!row.priced) noEvidence.push(c.id);
}
const total = d.showings.length;
console.log(bar);
console.log(`showings ${total}, priced ${priced} (${total ? Math.round(priced / total * 100) : 0}%), price values changed ${touched}, cinema notes updated ${notesChanged}`);

if (DRY) {
  console.log('[dry-run] nothing written');
} else {
  fs.writeFileSync(DATA, JSON.stringify(d, null, 1));
  console.log(`wrote ${DATA}`);
}
if (noEvidence.length) {
  console.error(`\n!!!!! ${noEvidence.length} cinema(s) still have no price: ${noEvidence.join(', ')} !!!!!`);
  process.exitCode = 1;
}
