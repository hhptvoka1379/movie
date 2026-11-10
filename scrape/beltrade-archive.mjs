#!/usr/bin/env node
// Imports the Cinema Beltrade programme from a saved copy of https://bandhi.it/bah/beltrade/
// (Safari .webarchive or plain .html), because the live site refuses automated connections.
//
//   node beltrade-archive.mjs ~/Downloads/page.webarchive            # snapshot + merge into data/showtimes.json
//   node beltrade-archive.mjs ~/Downloads/page.webarchive --dry-run  # report only
//
// Writes logs/beltrade-snapshot.json (read by the "snapshot" adapter in run.mjs) and replaces
// the beltrade cinema, its showings and any films only it shows in ../data/showtimes.json. Idempotent.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeTitle, displayTitle, filmType, isNonFilm } from './lib/normalize.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '..', 'data', 'showtimes.json');
const SNAP = path.join(HERE, 'logs', 'beltrade-snapshot.json');
const FROM = '2026-11-06', TO = '2026-11-15';
const ID = 'beltrade';
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const input = args.find(a => !a.startsWith('--'));
if (!input) { console.error('usage: node beltrade-archive.mjs <file.webarchive|file.html> [--dry-run]'); process.exit(2); }

function readHtml(file) {
  const buf = fs.readFileSync(file);
  if (!buf.subarray(0, 8).toString('latin1').startsWith('bplist') && !buf.subarray(0, 100).toString().includes('<?xml')) return buf.toString('utf8');
  // .webarchive is a plist; ask plutil (macOS) for the main resource as JSON-safe base64.
  const out = execFileSync('python3', ['-I', '-c',
    'import plistlib,sys;p=plistlib.load(open(sys.argv[1],"rb"));sys.stdout.buffer.write(p["WebMainResource"]["WebResourceData"])', file],
  { maxBuffer: 64 << 20 });
  return out.toString('utf8');
}
const dec = s => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#8211;|&ndash;/g, '–').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const rome = ts => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ts * 1000)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
};

const html = readHtml(input);
const rows = [];
// Each event: data-wpt-start epoch, then the title link (production page).
const re = /data-wpt-start="(\d+)"[\s\S]*?class="wp_theatre_event_title"><a href="([^"]+)">([\s\S]*?)<\/a>/g;
for (let m; (m = re.exec(html));) {
  const { date, time } = rome(+m[1]);
  rows.push({ title: dec(m[3]).trim(), date, time, booking_url: m[2] });
}
// 06:00 "KEEP CALM" slots are the site's "schedule coming soon" placeholder, not screenings.
const kept = rows.filter(r => !/^keep calm$/i.test(r.title) && !isNonFilm(r.title) && r.date >= FROM && r.date <= TO);
console.log(`parsed ${rows.length} entries; keeping ${kept.length} (dropped placeholders / out of range)`);
console.log('dates:', [...new Set(kept.map(r => r.date))].join(', '));

const snapshot = {
  cinema: ID, source_url: 'https://bandhi.it/bah/beltrade/', captured_from: path.basename(input),
  captured_at: (html.match(/OGGI, [^<]+/) || [''])[0],
  showings: kept.map(r => ({ title: r.title, original_title: null, year: null, runtime_min: null, date: r.date, time: r.time,
    language: 'other', format: null, price_eur: null, booking_url: r.booking_url })),
};

const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const cfg = JSON.parse(fs.readFileSync(path.join(HERE, 'cinemas.json'), 'utf8')).find(c => c.id === ID);
if (!cfg || cfg.lat == null) { console.error('add beltrade to cinemas.json and geocode it first (node lib/geocode.mjs)'); process.exit(2); }
const cinema = {
  id: ID, name: cfg.name, address: cfg.address, lat: cfg.lat, lng: cfg.lng,
  website: 'https://bandhi.it/bah/beltrade/', booking_url: 'https://bandhi.it/bah/beltrade/',
  source_used: 'snapshot', published_until: kept.map(r => r.date).sort().pop() || null, status: kept.length ? 'ok' : 'no_schedule',
  notes: `Programme read from a saved copy of the cinema site (${snapshot.captured_at}); the live site blocks automated access. Language not stated on the schedule page (stored as other). Prices: not stated on the schedule page (see the site's Biglietti page) | Reserve without paying: not stated | Group policy: not stated`,
};
const old = data.showings.filter(s => s.cinema_id === ID).length;
data.showings = data.showings.filter(s => s.cinema_id !== ID);
const seen = new Set(data.films.map(f => f.id));
for (const r of kept) {
  const film_id = normalizeTitle(r.title);
  if (!seen.has(film_id)) {
    seen.add(film_id);
    data.films.push({ id: film_id, title: displayTitle(r.title), original_title: null, type: filmType([r.title], null), runtime_min: null });
  }
  data.showings.push({ film_id, cinema_id: ID, date: r.date, time: r.time, language: 'other', format: null, price_eur: null, price_note: null, booking_url: r.booking_url });
}
data.cinemas = data.cinemas.filter(c => c.id !== ID).concat(cinema);
const used = new Set(data.showings.map(s => s.film_id));
data.films = data.films.filter(f => used.has(f.id)).sort((a, b) => a.title.localeCompare(b.title, 'it'));
data.showings.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.cinema_id.localeCompare(b.cinema_id) || a.film_id.localeCompare(b.film_id));
console.log(`beltrade: ${old} -> ${kept.length} showings; films now ${data.films.length}`);
if (DRY) { console.log('[dry-run] nothing written'); process.exit(0); }
fs.writeFileSync(SNAP, JSON.stringify(snapshot, null, 2) + '\n');
fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + '\n');
console.log(`wrote ${SNAP} and ${DATA}`);
