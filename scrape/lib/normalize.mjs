// Film title normalization, film typing, non-film filtering and merge logging for the showtimes pipeline.
import fs from 'node:fs';

// Leading version/hall/rating tags: "(O.V.) Title", "(Lingua Originale) Title", "(Sala XL) Title", "(JP) Title", "V.M. 18 - Title".
const VO_PREFIX = /^\s*(?:\(\s*(?:o\.?\s?v\.?|v\.?\s?o\.?|lingua\s+or[a-z]*\.?|sala\s+xl|xl(?:-[a-z]+)?|jp|ch|kor)\s*\)|(?:o\.v\.|v\.o\.|v\.?\s*m\.?\s*\d+)|(?:ov|vo|atmos|sala\s+xl)(?=\s*[-–:]))\s*[-–:]?\s*/i;
// Trailing version tags: "Title - V.O.", "Title (V.O.)", "Title (O.V.)", "Title - V.O. Sott. Ita"
const VO_SUFFIX = /\s*[-–(]\s*(?:o\.?\s?v\.?|v\.?\s?o\.?)\s*(?:sott\.?\s*ita\.?)?\s*\)?\s*$/i;
const RIED = /\(\s*ried\.?(?:\s*4k)?\s*\)|\s+-?\s*ried\.?\s*$/i;
// Format / presentation noise that does not change the film identity (format is kept on the showing itself).
const NOISE = /\b(infinity vision|imax|4dx|screenx|dolby cinema|dolby atmos|3d|2d|anteprima)\b/gi;
// Titles that are event-like (concert, preview, series, talk...). Event-like titles are never dropped as non-films.
const EVENT = /\b(concert|concerto|tour|anteprima|rassegna|ospite|evento|event|balletto|opera|teatro|festival|talk|incontro|dibattito|serata|rassegna)\b|\blive\b(?!\s+action)/i;
// Titles that look like something other than a film (memberships, vouchers, food, promos).
const NONFILM = /\b(abbonament\w*|tessera|gift\s*card|buon[oi]|voucher|pop\s?corn|promo\w*|ingresso|biglietti?|sconto|carta|noleggio|sala privata|private screening)\b/i;

export function stripNoise(raw) {
  let s = String(raw || '').trim();
  // Repair mangled angle-bracket tour titles such as `<run it="">Live View</run>` -> `<RUN IT> Live View`
  s = s.replace(/<run\s+it(?:="")?\s*>\s*/gi, '<RUN IT> ').replace(/<\/run>/gi, ' ');
  let prev;
  do {
    prev = s;
    s = s.replace(VO_PREFIX, '').replace(VO_SUFFIX, '');
  } while (s !== prev);
  s = s.replace(/\(\s*ried\.?(?:\s*4k)?\s*\)/gi, '').replace(/\s+-?\s*ried\.?\s*$/i, '');
  s = s.replace(NOISE, ' ').replace(/\s*[-–(]\s*(?:ospiti in sala|evento)\s*\)?\s*$/i, '');
  s = s.replace(/\s+/g, ' ').replace(/^[\s\-–:,]+/, '').replace(/[\s\-–:,]+$/, '').trim();
  return s;
}

// Presentation prefixes/suffixes that sneak into titles (sound formats, screening halls, version tags, truncations).
const ID_PREFIX = /^(?:atmos|sala-xl|xl(?:-kor)?|jp|lingua-or[a-z]*)-/;
const ID_SUFFIX = /-(?:evento|ospiti-in-sala|o-v|v-o)$/;
// Same film, different spellings the rules above cannot catch (subtitles, truncations, typos, original titles).
// Confirmed by matching TMDB ids or obvious title overlap; keep in sync with scrape/logs/merges.log.
export const ID_ALIASES = {
  'wildwood': 'wildwood-i-segreti-del-bosco-proibito',
  'wildwood-i-segreti-del-bosco-p': 'wildwood-i-segreti-del-bosco-proibito',
  'il-gruffalo-e-la-sua-p-bastoncino-aut': 'il-gruffalo-e-la-sua-picc-bastoncino',
  'taddeo-l-esploratore-e-la-lampada-m': 'taddeo-l-esploratore-e-la-lampada-magica',
  'il-gatto-con-il-cappello': 'il-gatto-col-cappello',
  'il-gatto-col-cappello-the-cat-in-the-hat': 'il-gatto-col-cappello',
  'ebenezer': 'scrooge-e-gli-spiriti-del-natale',
  'shaun-vita-da-pecora-op-z-u-c-c-a': 'shaun-vita-da-pecora-operazione-z-u-c-c-a',
  'shaun-vita-da-pecora-operazione-z-u-c': 'shaun-vita-da-pecora-operazione-z-u-c-c-a',
  'george-michael-the-fa': 'george-michael-the-faith-tour',
  'minotaur': 'minotaur-nel-labirinto-del-potere',
  'minotaur-nel-labirinto-del-potere-minotaure': 'minotaur-nel-labirinto-del-potere',
  'prime-time': 'primetime',
  'ragione-e-sentimento-sense-and-sensibility': 'ragione-e-sentimento-2026',
  'trainspotting-ried-4k': 'trainspotting-30-anniversario-4k',
  'l-impero-dei-sensi': 'v-m-18-ecco-l-impero-dei-sensi-o-v',
  'v-m-18-ecco-l-impero-dei-sensi': 'v-m-18-ecco-l-impero-dei-sensi-o-v',
  'stray-kids-wt-run-it-live-view-run': 'kor-stray-kids-wt-run-it-live-view-run',
  'godzilla-minus-zero': 'godzilla-minus-zero',
  'wild-horse-nine': 'wild-horse-nine',
};
export function canonicalId(id) {
  let x = id, prev;
  do { prev = x; x = x.replace(ID_PREFIX, '').replace(ID_SUFFIX, ''); } while (x !== prev);
  return ID_ALIASES[x] || x;
}

// Film id: lowercase, accents and punctuation stripped, words joined with '-'.
export function normalizeTitle(raw) {
  const base = stripNoise(raw).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return base ? canonicalId(base.replace(/ /g, '-')) : 'untitled-' + Buffer.from(String(raw)).toString('hex').slice(0, 12);
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
