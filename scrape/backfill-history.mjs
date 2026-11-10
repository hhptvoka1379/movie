// Restore showings for past days that later refreshes dropped, from earlier committed snapshots of
// data/showtimes.json. Only fills (date, cinema) pairs that currently have no showings; never edits
// existing rows. Idempotent.   node backfill-history.mjs [--dry-run] [--before YYYY-MM-DD]
//   sources, freshest first: 0f112a8 (9 Nov listings), 284f3ac (6 Nov full rebuild)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalId, stripNoise } from './lib/normalize.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data', 'showtimes.json');
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const bi = args.indexOf('--before');
const BEFORE = bi >= 0 ? args[bi + 1] : '2026-11-10'; // fill days strictly before this date
const SOURCES = ['0f112a8', '284f3ac'];

const d = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const cinemas = new Set(d.cinemas.map(c => c.id));
const films = new Map(d.films.map(f => [f.id, f]));
const have = new Set(d.showings.map(s => `${s.date}|${s.cinema_id}`));
const key = s => [s.film_id, s.cinema_id, s.date, s.time, s.language].join('|');
const seen = new Set(d.showings.map(key));
let added = 0; const per = {};

for (const rev of SOURCES) {
  const old = JSON.parse(execFileSync('git', ['show', `${rev}:data/showtimes.json`], { cwd: ROOT, maxBuffer: 1 << 28 }));
  const oldFilms = new Map(old.films.map(f => [f.id, f]));
  for (const s of old.showings) {
    if (s.date >= BEFORE || !cinemas.has(s.cinema_id) || have.has(`${s.date}|${s.cinema_id}`)) continue;
    const fid = canonicalId(s.film_id);
    const n = { ...s, film_id: fid };
    if (seen.has(key(n))) continue;
    if (!films.has(fid)) {
      const of = oldFilms.get(s.film_id); if (!of) continue;
      films.set(fid, { ...of, id: fid, title: stripNoise(of.title) || of.title });
    }
    seen.add(key(n)); d.showings.push(n); added++;
    per[`${s.date} ${rev}`] = (per[`${s.date} ${rev}`] || 0) + 1;
  }
  // a pair is complete once any (fresher) source supplied it
  for (const s of d.showings) have.add(`${s.date}|${s.cinema_id}`);
}
d.films = [...films.values()].sort((a, b) => a.title.localeCompare(b.title, 'it'));
d.showings.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.cinema_id.localeCompare(b.cinema_id) || a.film_id.localeCompare(b.film_id));
console.log(`backfilled ${added} showings`, per);
if (!DRY) fs.writeFileSync(DATA, JSON.stringify(d, null, 2) + '\n');
