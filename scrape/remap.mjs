// Idempotent: apply canonicalId() to an existing data/showtimes.json without re-scraping.
import fs from 'node:fs';
import { canonicalId } from './lib/normalize.mjs';

const F = new URL('../data/showtimes.json', import.meta.url);
const P = new URL('../data/posters.json', import.meta.url);
const poster = id => new URL(`../assets/posters/${id}.jpg`, import.meta.url);
const d = JSON.parse(fs.readFileSync(F));
const posters = fs.existsSync(P) ? JSON.parse(fs.readFileSync(P)) : {};
const PREFIX = /^(?:atmos|sala xl|xl|jp|lingua or\w*\.?)\s*[-–:]?\s*/i;
const SUFFIX = /\s*[-–(]\s*(?:ospiti in sala|evento)\s*\)?\s*$/i;
const clean = t => t.replace(PREFIX, '').replace(SUFFIX, '').trim();

const map = new Map(d.films.map(f => [f.id, canonicalId(f.id)]));
const films = new Map(), log = [];
for (const f of d.films) {
  const id = map.get(f.id);
  const cur = films.get(id);
  if (!cur) { films.set(id, { ...f, id, title: clean(f.title) || f.title }); continue; }
  log.push(`${f.id} -> ${id}`);
  const t = clean(f.title);
  if (t.length > cur.title.length) cur.title = t;
  cur.original_title ||= f.original_title;
  cur.runtime_min ||= f.runtime_min;
  if (f.type === 'event' || cur.type === 'event') cur.type = 'event';
  else if (f.type === 'classic' && cur.type !== 'film') cur.type = 'classic';
}

const seen = new Set(), showings = [];
for (const s of d.showings) {
  const n = { ...s, film_id: map.get(s.film_id) };
  const k = [n.film_id, n.cinema_id, n.date, n.time, n.language].join('|');
  if (!seen.has(k)) { seen.add(k); showings.push(n); }
}
for (const c of d.cinemas) if (c.id === 'uci-certosa') c.name = 'UCI Certosa'; // rename to Cinelandia is in notes
d.films = [...films.values()];
d.showings = showings;
fs.writeFileSync(F, JSON.stringify(d, null, 1));

let moved = 0;
for (const [oldId, nid] of map) {
  if (oldId === nid) continue;
  if (fs.existsSync(poster(oldId))) {
    if (fs.existsSync(poster(nid))) fs.unlinkSync(poster(oldId)); else fs.renameSync(poster(oldId), poster(nid));
    moved++;
  }
  if (posters[oldId]) {
    posters[nid] ||= { ...posters[oldId], file: posters[oldId].file?.replace(oldId, nid) };
    delete posters[oldId];
  }
}
fs.writeFileSync(P, JSON.stringify(posters, null, 1));
console.log(`films ${map.size} -> ${films.size}; showings ${d.showings.length}; posters moved/removed ${moved}`);
console.log(log.join('\n'));
