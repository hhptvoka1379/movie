// Merge the spazioCinema (Anteo) calendar captures for every Anteo venue into data/showtimes.json.
// Source: scrape/raw/<date>/<venue>/spaziocinema.info_get-calendario__schedule__<day>.json (the site's own
// calendar endpoint, saved per day). Nothing is rescraped. Idempotent.
//
// Per venue: showings are rebuilt from the capture; price_eur / price_note already in the file are kept for
// showings that still exist (same film, day, time, language, format). Existing cinema metadata (notes,
// address, coordinates, links) is kept; only published_until and status are refreshed.
//
//   node scrape/merge-anteo.mjs [--dry-run] [--raw 2026-11-10] [venue-id ...]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeTitle, displayTitle, filmType } from './lib/normalize.mjs';
import { anteoToShowings } from './adapters/anteo.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '../data/showtimes.json');
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const rawIdx = args.indexOf('--raw');
const RAW = path.join(HERE, 'raw', rawIdx >= 0 ? args[rawIdx + 1] : '2026-11-10');
const only = new Set(args.filter((a, i) => !a.startsWith('--') && i !== rawIdx + 1));

// Known spazioCinema Milano venues. Folder name = cinema id. `fallback` is used only if the venue is not yet in the file.
const VENUES = {
  'anteo-palazzo': { name: 'Anteo Palazzo del Cinema', address: 'Piazza XXV Aprile 8, Milano', lat: 45.4800568, lng: 9.1877898 },
  'citylife-anteo': { name: 'CityLife Anteo', address: 'Piazza Tre Torri, Milano' },
  'ariosto-anteo': { name: 'Ariosto', address: 'Via Ludovico Ariosto 16, Milano' },
};

// Full (intero) price from the venue's own tariff page (captured 10 Nov, see raw/*/anteo-palazzo/*tariffe*.md).
// Matinee = starts before 14:00; afternoon = up to 17:45; evening = 17:50 on. Saturday first show = before 15:30.
function palazzoIntero({ date, time }) {
  const dow = new Date(date + 'T12:00:00Z').getUTCDay();      // 0 Sun .. 6 Sat
  const m = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const weekend = dow === 0 || dow === 6;
  if (m < 14 * 60) return weekend ? 6.5 : 5.5;
  if (m <= 17 * 60 + 45) return dow === 6 ? (m < 15 * 60 + 30 ? 8 : 9.5) : dow === 0 ? 9.5 : 6.5;
  return dow === 3 ? 8 : 9.5;
}
const PALAZZO_NOTE = 'Intero da tariffe Anteo Palazzo (matinée prima delle 14:00, pomeridiano fino alle 17:45, serale dopo); 3D, eventi speciali e anteprime del mercoledì possono costare di più (anteprime mer: intero €9,50)';
const PRICERS = { 'anteo-palazzo': r => ({ price_eur: palazzoIntero(r), price_note: PALAZZO_NOTE }) };

const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const filmIdx = new Map(data.films.map(f => [f.id, f]));
const key = s => [s.film_id, s.date, s.time, s.language, s.format || ''].join('|');
const report = [];

for (const [id, fallback] of Object.entries(VENUES)) {
  if (only.size && !only.has(id)) continue;
  const dir = path.join(RAW, id);
  if (!fs.existsSync(dir)) { report.push(`${id}: no capture folder, skipped`); continue; }
  const days = fs.readdirSync(dir).filter(f => /get-calendario.*\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  if (!days.length) { report.push(`${id}: no calendar files, skipped`); continue; }

  const rows = [];
  for (const f of days) {
    const films = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const film of films) for (const o of film.orari || []) rows.push({ film, o });
  }
  const dates = days.map(f => f.match(/(\d{4}-\d{2}-\d{2})\.json$/)[1]);
  const from = dates[0], to = dates[dates.length - 1];
  const incoming = anteoToShowings({ rows, tariffs: null }, null).filter(s => s.date >= from && s.date <= to);

  // Only days the capture actually has programme for are replaced. The site returns an empty list for past
  // days, so earlier backfilled rows (and anything outside the captured days) are left exactly as they are.
  const live = new Set(incoming.map(s => s.date));
  const old = new Map(data.showings.filter(s => s.cinema_id === id && live.has(s.date)).map(s => [key(s), s]));
  // Prices at these venues depend on day, time and format, not on the film: a new showing can borrow the price of an
  // existing one at the same slot.
  const slot = new Map(data.showings.filter(s => s.cinema_id === id && s.price_eur != null).map(s => [[s.date, s.time, s.format || ''].join('|'), s]));
  const fresh = new Map();   // key -> row, in capture order

  const seen = new Set(); let until = null, kept = 0;
  const prior = data.showings.filter(s => s.cinema_id === id && !live.has(s.date)).map(s => s.date);
  for (const d of prior) if (!until || d > until) until = d;
  for (const x of incoming) {
    const fid = normalizeTitle(String(x.title).trim());
    const row = { film_id: fid, cinema_id: id, date: x.date, time: x.time, language: x.language, format: x.format || null,
      price_eur: null, price_note: null, booking_url: x.booking_url || null };
    const k = key(row);
    if (seen.has(k)) continue; seen.add(k);
    const prev = old.get(k);
    if (prev && prev.price_eur != null) { row.price_eur = prev.price_eur; row.price_note = prev.price_note ?? null; kept++; }
    else if (PRICERS[id]) Object.assign(row, PRICERS[id](row));
    else { const t = slot.get([row.date, row.time, row.format || ''].join('|')); if (t) { row.price_eur = t.price_eur; row.price_note = t.price_note ?? null; } }
    fresh.set(k, row);
    if (!until || row.date > until) until = row.date;
    if (!filmIdx.has(fid)) {
      const f = { id: fid, title: displayTitle(x.title), original_title: x.original_title || null, type: filmType([x.title], x.year), runtime_min: x.runtime_min || null };
      filmIdx.set(fid, f); data.films.push(f);
    }
  }

  // Update rows already in the file in place (so re-runs leave the file's order and diff alone),
  // drop rows the capture no longer has, append genuinely new ones at the end.
  const placed = new Set();
  data.showings = data.showings.flatMap(s => {
    if (s.cinema_id !== id || !live.has(s.date)) return [s];
    const k = key(s), row = fresh.get(k);
    if (!row || placed.has(k)) return [];
    placed.add(k);
    return [row];
  });
  for (const [k, row] of fresh) if (!placed.has(k)) data.showings.push(row);

  const i = data.cinemas.findIndex(c => c.id === id);
  const base = i >= 0 ? data.cinemas[i] : { id, ...fallback, website: 'https://www.spaziocinema.info/milano', booking_url: 'https://www.spaziocinema.info/milano', source_used: 'anteo-capture', notes: '' };
  const next = { ...base, published_until: until, status: seen.size ? 'ok' : 'no_schedule' };
  if (i >= 0) data.cinemas[i] = next; else data.cinemas.push(next);
  report.push(`${id}: ${seen.size} showings (${from}..${to}), until ${until}; ${kept} kept prices, ${[...old.keys()].filter(k => !fresh.has(k)).length} old rows dropped`);
}

data.films.sort((a, b) => a.title.localeCompare(b.title, 'it'));
console.log(report.join('\n'));
if (!DRY) { fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + '\n'); console.log('wrote', DATA); }
