// Film title normalization, film typing, non-film filtering and merge logging for the showtimes pipeline.
import fs from 'node:fs';

// Leading version tags: "(O.V.) Title", "V.O. Title", "VO - Title". Requires a real tag, so "Vox Populi" is untouched.
const VO_PREFIX = /^\s*(?:\(\s*(?:o\.?\s?v\.?|v\.?\s?o\.?)\s*\)|(?:o\.v\.|v\.o\.)|(?:ov|vo)(?=\s*[-–:]))\s*[-–:]?\s*/i;
// Trailing version tags: "Title - V.O.", "Title (V.O.)", "Title - V.O. Sott. Ita"
const VO_SUFFIX = /\s*[-–(]\s*v\.?\s?o\.?\s*(?:sott\.?\s*ita\.?)?\s*\)?\s*$/i;
const RIED = /\(\s*ried\.?\s*\)|\s+-?\s*ried\.?\s*$/i;
// Format / presentation noise that does not change the film identity (format is kept on the showing itself).
const NOISE = /\b(infinity vision|imax|4dx|screenx|dolby cinema|dolby atmos|3d|2d|anteprima)\b/gi;
// Titles that are event-like (concert, preview, series, talk...). Event-like titles are never dropped as non-films.
const EVENT = /\b(concert|concerto|tour|anteprima|rassegna|ospite|evento|event|balletto|opera|teatro|festival|talk|incontro|dibattito|serata|rassegna)\b|\blive\b(?!\s+action)/i;
// Titles that look like something other than a film (memberships, vouchers, food, promos).
const NONFILM = /\b(abbonament\w*|tessera|gift\s*card|buon[oi]|voucher|pop\s?corn|promo\w*|ingresso|biglietti?|sconto|carta|noleggio|sala privata|private screening)\b/i;

export function stripNoise(raw) {
  let s = String(raw || '').trim();
  s = s.replace(VO_PREFIX, '').replace(VO_SUFFIX, '');
  s = s.replace(/\(\s*ried\.?\s*\)/gi, '').replace(/\s+-?\s*ried\.?\s*$/i, '');
  s = s.replace(NOISE, ' ');
  s = s.replace(/\s+/g, ' ').replace(/^[\s\-–:,]+/, '').replace(/[\s\-–:,]+$/, '').trim();
  return s;
}

// Film id: lowercase, accents and punctuation stripped, words joined with '-'.
export function normalizeTitle(raw) {
  const base = stripNoise(raw).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return base ? base.replace(/ /g, '-') : 'untitled-' + Buffer.from(String(raw)).toString('hex').slice(0, 12);
}

// Human-readable title for the film record (original casing, noise removed).
export function displayTitle(raw) {
  return stripNoise(raw) || String(raw).trim();
}

export function isEventTitle(raw) {
  return EVENT.test(String(raw || ''));
}

export function isRiedTitle(raw) {
  return RIED.test(String(raw || ''));
}

// True when a webtic event title looks like a non-film and is not clearly an event.
export function isNonFilm(raw) {
  const s = String(raw || '');
  return NONFILM.test(s) && !EVENT.test(s);
}

// Film type from all raw titles seen for the film plus its year.
// event if any raw title is event-like; classic if year < 2024 or a restored version "(ried.)"; otherwise film.
export function filmType(rawTitles, year) {
  if (rawTitles.some(isEventTitle)) return 'event';
  if (rawTitles.some(isRiedTitle)) return 'classic';
  if (year && Number(year) < 2024) return 'classic';
  return 'film';
}

// Records which raw titles were folded into the same film id, and writes them to a log.
export class MergeLog {
  constructor() { this.map = new Map(); }
  add(id, raw, cinemaId) {
    if (!this.map.has(id)) this.map.set(id, new Map());
    const raws = this.map.get(id);
    if (!raws.has(raw)) raws.set(raw, new Set());
    raws.get(raw).add(cinemaId);
  }
  merges() {
    return [...this.map].filter(([, raws]) => raws.size > 1);
  }
  write(file) {
    const stamp = new Date().toISOString();
    const lines = [`# film merges, generated ${stamp}`, `# format: film-id: "raw title" [cinema ids] + "other raw title" [cinema ids]`];
    for (const [id, raws] of this.merges()) {
      lines.push(`${id}: ` + [...raws].map(([r, c]) => `"${r}" [${[...c].join(', ')}]`).join(' + '));
    }
    fs.writeFileSync(file, lines.join('\n') + '\n');
    return this.merges().length;
  }
}
