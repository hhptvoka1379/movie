// Idempotent: apply canonicalId() to an existing data/showtimes.json without re-scraping.
//   node remap.mjs                # data/showtimes.json + data/posters.json
//   node remap.mjs --data <file> --posters <file>   # other files (e.g. temp copies for a test)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalId, stripNoise } from './lib/normalize.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flagPath = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? path.resolve(args[i + 1]) : dflt;
};
const DEFAULT_DATA = path.join(ROOT, 'data', 'showtimes.json');
const DEFAULT_POSTERS = path.join(ROOT, 'data', 'posters.json');
const F = flagPath('--data', DEFAULT_DATA);
const P = flagPath('--posters', DEFAULT_POSTERS);
const POSTER_DIR = path.join(ROOT, 'assets', 'posters');
const poster = id => path.join(POSTER_DIR, `${id}.jpg`);
const d = JSON.parse(fs.readFileSync(F));
const posters = fs.existsSync(P) ? JSON.parse(fs.readFileSync(P)) : {};
const clean = t => stripNoise(t) || String(t || '').trim();

const map = new Map(d.films.map(f => [f.id, canonicalId(f.id)]));
const films = new Map(), log = [];
for (const f of d.films) {
  const id = map.get(f.id);
  const cleaned = clean(f.title);
  const cur = films.get(id);
  if (!cur) { films.set(id, { ...f, id, title: cleaned }); continue; }
  log.push(`${f.id} -> ${id}`);
  if (cleaned.length > cur.title.length && !/^\(/.test(cleaned)) cur.title = cleaned;
  cur.original_title ||= f.original_title;
  cur.runtime_min ||= f.runtime_min;
  if (f.type === 'event' || cur.type === 'event') cur.type = 'event';
  else if (f.type === 'classic' || cur.type === 'classic') cur.type = 'classic';
}

const seen = new Set(), showings = [];
for (const s of d.showings) {
  const n = { ...s, film_id: map.get(s.film_id) };
  const k = [n.film_id, n.cinema_id, n.date, n.time, n.language].join('|');
  if (!seen.has(k)) { seen.add(k); showings.push(n); }
}
for (const c of d.cinemas) if (c.id === 'uci-certosa') c.name = 'Cinelandia Milano Certosa (ex UCI Certosa)';
d.films = [...films.values()].sort((a, b) => a.title.localeCompare(b.title, 'it'));
d.showings = showings;
fs.writeFileSync(F, JSON.stringify(d, null, 2) + '\n');

let moved = 0;
const mutateDiskPosters = (P === DEFAULT_POSTERS && F === DEFAULT_DATA);
for (const [oldId, nid] of map) {
  if (oldId === nid) continue;
  if (mutateDiskPosters && fs.existsSync(poster(oldId))) {
    if (fs.existsSync(poster(nid))) fs.unlinkSync(poster(oldId)); else fs.renameSync(poster(oldId), poster(nid));
    moved++;
  }
  if (posters[oldId]) {
    posters[nid] ||= { ...posters[oldId], file: posters[oldId].file?.replace(oldId, nid) };
    delete posters[oldId];
  }
}
fs.writeFileSync(P, JSON.stringify(posters, null, 2) + '\n');
console.log(`films ${map.size} -> ${films.size}; showings ${d.showings.length}; posters moved/removed ${moved}`);
console.log(log.join('\n'));

// Prices are applied by apply-prices.mjs (it keeps ids canonical via canonicalId) so that
// remapping ids here never has to know about tariffs, and neither script touches the other's
// output. Point at it when captured evidence is waiting.
const EVIDENCE = new URL('./logs/prices.json', import.meta.url);
if (fs.existsSync(EVIDENCE)) console.log('price evidence present: run `node apply-prices.mjs` to apply it to data/showtimes.json');
