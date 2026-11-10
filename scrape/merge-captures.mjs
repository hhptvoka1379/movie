// Incremental merge of hand/browser-captured venues into data/showtimes.json.
// Source: scrape/raw/2026-11-10 (first-party captures). Does NOT rescrape anything and does not touch
// venues already in the file, apart from adding the rows below. Safe to re-run (idempotent).
//   node scrape/merge-captures.mjs [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeTitle, displayTitle, filmType } from './lib/normalize.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(HERE, 'raw/2026-11-10');
const DATA = path.join(HERE, '../data/showtimes.json');
const DRY = process.argv.includes('--dry-run');
const FROM = '2026-11-06', TO = '2026-11-15';
const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));

const venues = [];

// Anteo venues (Palazzo, CityLife, Ariosto) are merged by scrape/merge-anteo.mjs.

// ---- Il Cinemino: schedule read from the rendered page (browser pane text), prices from /ingressi -----
{
  const S = (title, date, time, language) => ({ title, date, time, language, format: null, price_eur: 9, rates: [], booking_url: 'https://www.ilcinemino.it/programmazione/', price_note: 'Biglietto unico €9,00 + tessera associativa; ridotto €7,00 (under 18, over 65, universitari under 25; first weekday afternoon show and weekend matinee always ridotto)' });
  venues.push({
    cinema: {
      id: 'cinemino', name: 'Il Cinemino', address: 'Via Seneca 6, Milano', lat: 45.4541227, lng: 9.2083301,
      website: 'https://www.ilcinemino.it', booking_url: 'https://www.ilcinemino.it/ingressi/', source_used: 'snapshot',
      notes: 'Programme read from the rendered programmazione page on 10 Nov; only 10 and 13 Nov were published | Membership card (tessera Seiseneca) is always required | Carnets: 4 ingressi €22, 7 €35, 10 €48',
    },
    showings: [
      S('JE SO\' PAZZO', '2026-11-10', '15:00', 'ita'), S('LA BAMBOLA', '2026-11-10', '17:00', 'vos'),
      S('NEL SILENZIO DELLE STANZE', '2026-11-10', '19:00', 'vos'), S('WHITE LIES - DOC ITALIANI', '2026-11-10', '21:00', 'ita'),
      S('BALCANICA - INCONTRO CON SCENEGGIATORE', '2026-11-13', '21:30', 'ita'),
    ],
  });
}

// ---- Cinema Godard (Fondazione Prada): monthly programme PDF, text extract ----------------------------
{
  const P85 = /^(La gradiva|Naza|Wild Horse Nine|Fatherland|Douglas Gordon|Look Back|Fjord|L'essere amato|Il canto della foresta|Werner Herzog)/i;
  const price = t => /^(2001|Lorenzo)/i.test(t) ? 10 : /^You Can See Everything/i.test(t) ? 15 : P85.test(t) ? 8.5 : 6;
  const prog = [
    ['2026-11-06', '16:30', 'Naza'], ['2026-11-06', '18:00', 'Wild Horse Nine'], ['2026-11-06', '20:30', 'Fatherland'],
    ['2026-11-07', '16:00', 'East of Paradise'], ['2026-11-07', '18:00', 'Wild Horse Nine'], ['2026-11-07', '20:30', 'Douglas Gordon by Douglas Gordon'],
    ['2026-11-08', '16:00', 'Tuttaunanotte 2 - Programma 1'], ['2026-11-08', '17:45', 'Tuttaunanotte 2 - Programma 2'], ['2026-11-08', '20:45', 'Wild Horse Nine'],
    ['2026-11-12', '17:45', 'Look Back'], ['2026-11-12', '19:45', 'Fjord'],
    ['2026-11-13', '16:00', 'Wild Horse Nine'], ['2026-11-13', '18:15', 'Look Back'], ['2026-11-13', '20:30', 'D.O.A. - A Right of Passage'],
    ['2026-11-14', '15:00', 'Look Back'], ['2026-11-14', '21:00', 'Wild Horse Nine'],
    ['2026-11-14', '17:30', 'Incontro con Angela Davis, a seguire The Black Power Mixtape 1967-1975'],
    ['2026-11-15', '16:00', 'Trainspotting'], ['2026-11-15', '18:00', 'L\'impero dei sensi'], ['2026-11-15', '20:15', 'Look Back'],
  ];
  const note = 'Intero €6 / ridotto €4 (under 26, over 65) base; €8,50 / €7 for selected films; the ticket does not include access to the Foundation exhibitions';
  venues.push({
    cinema: {
      id: 'cinema-godard', name: 'Cinema Godard (Fondazione Prada)', address: 'Largo Isarco 2, Milano', lat: 45.4443737, lng: 9.2053306,
      website: 'https://www.fondazioneprada.org/cinema/', booking_url: 'https://www.fondazioneprada.org/cinema/', source_used: 'snapshot',
      notes: 'Programme from the venue\'s own monthly programme PDF (10 Nov); no screenings listed 9-11 Nov | ' + note,
    },
    showings: prog.map(([date, time, title]) => ({ title, date, time, language: /^look back/i.test(title) ? 'vos' : /fatherland|naza|fjord|wild horse|east of paradise|douglas|d\.o\.a|black power/i.test(title) ? 'other' : 'ita', format: null, price_eur: price(title), rates: [], price_note: note, booking_url: 'https://www.fondazioneprada.org/cinema/' })),
  });
}

// ---- merge ---------------------------------------------------------------------------------------------
const filmIdx = new Map(data.films.map(f => [f.id, f]));
const added = [];
for (const v of venues) {
  const id = v.cinema.id;
  data.showings = data.showings.filter(s => s.cinema_id !== id);       // idempotent
  data.cinemas = data.cinemas.filter(c => c.id !== id);
  const inRange = v.showings.filter(s => s.date >= FROM && s.date <= TO);
  const seen = new Set(); const raws = new Map(); let until = null;
  for (const x of inRange) {
    const raw = String(x.title).trim(); const fid = normalizeTitle(raw);
    if (!raws.has(fid)) raws.set(fid, { raws: [], year: x.year || null, runtime: x.runtime_min || null });
    raws.get(fid).raws.push(raw);
    const row = { film_id: fid, cinema_id: id, date: x.date, time: x.time, language: ['ita', 'vo', 'vos', 'other'].includes(x.language) ? x.language : 'other', format: x.format || null,
      price_eur: x.price_eur ?? null, price_note: x.price_note || null, booking_url: x.booking_url || v.cinema.booking_url || null };
    const k = [fid, id, row.date, row.time, row.language, row.format].join('|');
    if (seen.has(k)) continue; seen.add(k);
    data.showings.push(row); if (!until || row.date > until) until = row.date;
    if (!filmIdx.has(fid)) { const f = { id: fid, title: displayTitle(raw), original_title: x.original_title || null, type: filmType([raw], x.year), runtime_min: x.runtime_min || null }; filmIdx.set(fid, f); data.films.push(f); }
  }
  data.cinemas.push({ ...v.cinema, lat: v.cinema.lat ?? null, lng: v.cinema.lng ?? null, published_until: until, status: seen.size ? 'ok' : 'no_schedule' });
  added.push(`${id}: ${seen.size} showings, until ${until}`);
}
data.films.sort((a, b) => a.title.localeCompare(b.title, 'it'));
console.log(added.join('\n'));
if (!DRY) { fs.writeFileSync(DATA, JSON.stringify(data, null, 2) + '\n'); console.log('wrote', DATA); }
