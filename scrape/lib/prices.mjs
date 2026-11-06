// Shared price handling for the scrape pipeline.
//
// Rule: price_eur is the FULL-PRICE ticket for a showing, as the source site
// states it. Nothing is inferred, averaged or copied from another cinema, and
// nothing behind a login or a checkout is read. When a site does not state a
// price the value stays null and the reason is recorded on the cinema.
//
// A source states its tariffs as a list of rates: { label, eur, condition, source }.
//   label      the site's own wording, e.g. "Intero feriali", "3D", "Lun/Mer 5,50"
//   eur        parsed number of euros, null when the line has no readable amount
//   condition  what the site says the rate depends on: 'day', 'format' or null
//   source     where it was read (endpoint or page URL)

// ---------------------------------------------------------------- euro parsing

// Italian style: 1.234,50 (dot thousands, comma decimals) or 12,50 or 12.50 or 12.
const EUR_AMOUNT = /(\d{1,3}(?:[.\u00a0]\d{3})+,\d{1,2}|\d+(?:[.,]\d{1,2})?)/;
const EUR_LINE = new RegExp('(?:\\u20ac|\\beur(?:o|i)?\\b)\\s*' + EUR_AMOUNT.source + '|' +
  EUR_AMOUNT.source + '\\s*(?:\\u20ac|\\beur(?:o|i)?\\b)', 'i');

export function parseEur(text) {
  if (text == null) return null;
  if (typeof text === 'number') return Number.isFinite(text) ? round2(text) : null;
  const m = String(text).replace(/\u00a0/g, ' ').match(EUR_AMOUNT);
  if (!m) return null;
  let s = m[1];
  if (/^[1-9]\d{0,2}([.\u00a0 ]\d{3})+(,\d{1,2})?$/.test(s)) s = s.replace(/[.\u00a0 ]/g, ''); // 1.234 or 1.234,50
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');                                  // 12,50
  else if (/^\d+\.\d{3}$/.test(s)) s = s.replace('.', '');                                    // 12.500 -> thousands
  const v = Number(s);
  return Number.isFinite(v) && v > 0 && v < 1000 ? round2(v) : null;
}

// "Intero 8,50 EUR" / "feriali: 7.50\u20ac" -> 7.5 ; "biglietti" -> null
export function eurFromText(text) {
  if (text == null) return null;
  const s = String(text);
  if (!EUR_LINE.test(s)) return null;
  return parseEur(s);
}

export function formatEur(v) {
  return isFinite(v) && v != null ? '\u20ac' + v.toFixed(2).replace('.', ',') : '\u20ac?';
}

function round2(v) { return Math.round(v * 100) / 100; }
function isBlank(s) { return !String(s == null ? '' : s).trim(); }

// ------------------------------------------------------------- label semantics

// Discounted / non-full-price rates: never used for price_eur.
const REDUCED = /\b(ridott\w*|scontat\w*|sconto|under\s*\d+|over\s*\d+|senior|junior|bambin\w*|ragazz\w*|bimbo|kids?|teen|student\w*|universitar\w*|universit\u00e0|giovani|anzian\w*|pensionat\w*|disabil\w*|invalid\w*|accompagnator\w*|famigli\w*|family|genitor\w*|militar\w*|polizi\w*|carabinier\w*|forze dell'ordine|giornalist\w*|stampa|critic\w*|associazion\w*|cral\b|dopolavoro|convenzion\w*|abbonat\w*|abbonament\w*|tesserat\w*|tessera|soc[io]\b|fidelity|cin[e]?card|card\b|promo\w*|promozion\w*|offerta|coupon|voucher|buon[oi]|omaggi\w*|gratis|gratuit\w*|free|prenotazion\w*|prevendita|commission\w*|diritti?\b|supplemento servizio|online\b)/i;
// Words that make a line about something other than a ticket.
const NOT_TICKET = /\b(pop\s?corn|bar\b|cibi|bevande|drink|caff[e\u00e8]|menu|men\u00f9|park\w*|parchegg\w*|guardaroba|sala privat\w*|affitto|noleggio|abbonament\w*|tessera|gift\s?card|occhial\w*|3d glasses|prevendita\b)/i;
// The full/standard rate as Italian sites word it.
const FULL = /\b(intero|full|normale|standard|base|ordinario|regolare|biglietto\s+intero|prezzo\s+intero|tariffa\s+intera|adult\w*)\b/i;
// Rates the site ties to a day (or to a named day promo such as "Luned\u00ec 5,50").
const DAY_COND = /\b(ferial[i|e]|festiv[i|e]|prefestiv[i|e]|week\s?end|fine settimana|luned[i\u00ec]|marted[i\u00ec]|mercoled[i\u00ec]|gioved[i\u00ec]|venerd[i\u00ec]|sabato|domenica|giorn[oa]|day\b|daily|dal lun|al lun|ogni giorno|tutti i giorni|notte|midnight|mercoled\u00ec cinema|cinema\s?revolution|estivo|invernale|stagione)\b/i;
const WEEKDAY_WORD = /\b(luned[i\u00ec]|marted[i\u00ec]|mercoled[i\u00ec]|gioved[i\u00ec]|venerd[i\u00ec]|lun|mar|mer|gio|ven|sab|dom)\b/i;
// Rates the site ties to a presentation format.
const FORMAT_COND = /\b(3d|2d|imax|4dx|screen\s?x|screenx|dolby(?:\s?cinema|\s?atmos)?|atmos|vip|poltronissim\w*|galleria|platea|premium|lux[e]?|sala\s?xl|xl|dbox|onix|grande schermo|vhs)\b/i;
const FORMAT_3D = /\b(3d|imax|4dx|screen\s?x|screenx|dolby(?:\s?cinema|\s?atmos)?|atmos|dbox|onix|vip|poltronissim\w*|premium|lux[e]?|sala\s?xl)\b/i;

export function labelIsFull(label) {
  const s = String(label || '');
  if (REDUCED.test(s) || NOT_TICKET.test(s)) return false;
  if (FULL.test(s)) return true;
  // "3D" or "Luned\u00ec" alone is a condition, not a statement that it is the full rate.
  return !FORMAT_COND.test(s) && !DAY_COND.test(s);
}

export function labelCondition(label) {
  const s = String(label || '');
  const day = DAY_COND.test(s) || WEEKDAY_WORD.test(s);
  const format = FORMAT_COND.test(s);
  return { day, format, any: day || format };
}

// Normalise the site's own wording to the format vocabulary used in showings.json.
export function normalizeFormat(label) {
  const s = String(label || '').toUpperCase();
  if (/\bIMAX\b/.test(s)) return 'IMAX';
  if (/\b4DX\b/.test(s)) return '4DX';
  if (/SCREEN\s?X/.test(s)) return 'SCREENX';
  if (/\bDOLBY\b|\bATMOS\b/.test(s)) return 'DOLBY';
  if (/\b3D\b/.test(s)) return '3D';
  if (/\b2D\b/.test(s)) return '2D';
  return null;
}

export function isWeekend(date) {
  const d = new Date(String(date) + 'T12:00:00Z');
  const w = d.getUTCDay();
  return w === 0 || w === 6;
}

// ------------------------------------------------------------------- rate sets

export function cleanRates(rates) {
  const out = [];
  for (const r of rates || []) {
    if (!r) continue;
    const eur = isFinite(r.eur) && r.eur != null ? round2(r.eur) : eurFromText(r.label);
    const label = String(r.label == null ? '' : r.label).replace(/\s+/g, ' ').trim();
    if (isBlank(label) && eur == null) continue;
    if (NOT_TICKET.test(label)) continue;
    out.push({
      label: label || (eur != null ? formatEur(eur) : ''),
      eur,
      condition: r.condition === 'day' || r.condition === 'format' ? r.condition : (labelCondition(label).any ? (labelCondition(label).day ? 'day' : 'format') : null),
      source: r.source || null,
    });
  }
  return out;
}

// The full-price rate that applies to one showing.
//   1. only rates the site states as full price (never a reduced one);
//   2. among those, prefer one that matches the showing's day and format;
//   3. if several still match, or none does, return null - the site does not
//      state a single unambiguous full price for this showing.
export function resolvePrice(showing, rates) {
  const list = cleanRates(rates).filter(r => r.eur != null && labelIsFull(r.label));
  if (!list.length) return null;

  const date = showing && showing.date;
  const fmt = String((showing && showing.format) || '').toUpperCase();
  const weekend = date ? isWeekend(date) : null;
  const is3D = /3D|IMAX|4DX|SCREENX|DOLBY/.test(fmt);

  const score = r => {
    const c = labelCondition(r.label);
    const lf = normalizeFormat(r.label);
    let s = 0;
    // format agreement
    if (lf) s += (lf === fmt || (lf === '3D' && is3D) || (fmt === '3D' && lf === '3D')) ? 3 : -6;
    else if (c.format) s += -4;           // says it depends on format but names none we know
    else s += is3D ? -1 : 1;              // unqualified rate: applies to plain 2D showings
    // day agreement
    const w = WEEKDAY_WORD.exec(r.label);
    if (/\bferial/i.test(r.label)) s += weekend === false ? 3 : -6;
    else if (/\bfestiv|prefestiv|week\s?end|fine settimana/i.test(r.label)) s += weekend === true ? 3 : -6;
    else if (w) {
      const names = { lun: 1, mar: 2, mer: 3, gio: 4, ven: 5, sab: 6, dom: 0 };
      const dayNames = { luned: 1, marted: 2, mercoled: 3, gioved: 4, venerd: 5, sabato: 6, domenica: 0 };
      const key = w[1].toLowerCase().replace(/[$\u00ec]/g, '');
      const dw = names[key] ?? dayNames[key] ?? null;
      const sd = date ? new Date(date + 'T12:00:00Z').getUTCDay() : null;
      s += (dw != null && sd != null && dw === sd) ? 3 : -6;
    } else if (c.day) s += -2;            // varies by day but names none
    else s += 1;
    return s;
  };

  const scored = list.map(r => ({ r, s: score(r) })).sort((a, b) => b.s - a.s);
  const best = scored[0];
  const tied = scored.filter(x => x.s === best.s);
  if (tied.length > 1) {
    const eurs = new Set(tied.map(x => x.r.eur));
    if (eurs.size > 1) return null;       // ambiguous: several different full prices apply
  }
  return best.r;
}

// Human-readable summary of every rate the site states, kept on the showing so
// day/format variations are not lost when price_eur holds a single number.
export function ratesNote(rates, max = 5) {
  const list = cleanRates(rates).filter(r => r.eur != null);
  if (!list.length) return null;
  const seen = new Set();
  const parts = [];
  for (const r of list) {
    const key = r.label.toLowerCase() + '|' + r.eur;
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(`${r.label} ${formatEur(r.eur)}${labelIsFull(r.label) ? '' : ' (ridotto)'}`);
    if (parts.length >= max) break;
  }
  const extra = list.length > parts.length ? ` +${list.length - parts.length} altre` : '';
  return parts.join('; ') + extra;
}

// ------------------------------------------------------- tariff text/HTML input

// Reads "label ... 8,50 \u20ac" lines out of a tariff page or a JSON string blob.
export function ratesFromText(text, source) {
  const s = String(text == null ? '' : text)
    .replace(/<\s*(br|\/p|\/div|\/li|\/tr|\/h[1-6])\s*\/?>/gi, '\n')
    .replace(/<\s*(td|th)\s*[^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;?/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&#8364;|\u20ac/gi, '\u20ac');
  const out = [];
  for (const rawLine of s.split(/\n|\|/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (!line || line.length > 180) continue;
    const eur = eurFromText(line);
    if (eur == null) continue;
    const label = line
      .replace(/(?:\u20ac|eur(?:o|i)?)\s*(\d{1,3}(?:[.\u00a0]\d{3})+,\d{1,2}|\d+(?:[.,]\d{1,2})?)/gi, ' ')
      .replace(/(\d{1,3}(?:[.\u00a0]\d{3})+,\d{1,2}|\d+(?:[.,]\d{1,2})?)\s*(?:\u20ac|eur(?:o|i)?)/gi, ' ')
      .replace(/^[^A-Za-z0-9]+/, '').replace(/[^A-Za-z0-9]+$/, '')
      .replace(/\s+/g, ' ').trim();
    if (NOT_TICKET.test(label)) continue;
    out.push({ label: label || formatEur(eur), eur, source });
  }
  return dedupe(out);
}

// Walks an arbitrary JSON payload (a captured endpoint response) and collects
// objects that look like a tariff row: a text field plus a money field.
const MONEY_KEYS = /^(price|prices|amount|amounts|cost|tariffa?|tariffe|prezzo|prezzi|importo|valore|fullprice|standardprice|ticketprice)$/i;
const TEXT_KEYS = /^(description|descrizione|label|name|nome|tariffaname|title|titolo|text|codice|code)$/i;

export function ratesFromJson(payload, source) {
  const out = [];
  const seen = new Set();
  (function walk(node, path) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach((n, i) => walk(n, `${path}[${i}]`)); return; }
    const money = Object.keys(node).filter(k => MONEY_KEYS.test(k));
    const text = Object.keys(node).filter(k => TEXT_KEYS.test(k));
    if (money.length) {
      for (const mk of money) {
        const eur = typeof node[mk] === 'object' ? null : eurFromText(node[mk]);
        if (eur == null) continue;
        const label = text.map(k => node[k]).filter(v => typeof v === 'string' && v.trim()).join(' ').trim() || mk;
        const key = (label + '|' + eur).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ label, eur, source: source + (path ? '#' + path : '') });
      }
    }
    for (const [k, v] of Object.entries(node)) walk(v, path ? path + '.' + k : k);
  })(payload, '');
  return out;
}

export function dedupe(rates) {
  const seen = new Set();
  return (rates || []).filter(r => {
    const k = `${String(r.label).toLowerCase()}|${r.eur}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ------------------------------------------------------------------- statements

// Turns free text (e.g. WebTic getLocalInfo Infos.Booking) into the two
// statements the brief asks for. Only what the text actually states is kept.
const RESERVE_YES = /prenot\w+|reservation|reserve|booking\b/i;
const PICKUP = /(?:ritirat\w+|ritiro|collected?|picked up)[^.]*?(\d{1,3})\s*(?:minut\w+|minuti|min\b)/i;
const BOOKING_FEE = /(?:costo|corrispettivo|commissione|diritti|supplemento|fee)[^.]*?(\d+(?:[.,]\d{1,2})?)\s*(?:\u20ac|eur)/i;
const BOOKING_FEE2 = /(\d+(?:[.,]\d{1,2})?)\s*(?:\u20ac|eur)[^.]*?(?:per ogni (?:posto|biglietto)|a biglietto|per biglietto|per posto)/i;
const MAX_SEATS = /(?:massimo|fino a|max|up to)\s*(\d{1,3})\s*(?:posti|postazioni|tickets|seats)/i;
const NO_RESERVE = /(?:non\s+(?:\u00e8\s+)?(?:attivo|disponibile|possibile)|not available)[^.]*?prenot\w+|prenot\w+[^.]*?non\s+(?:\u00e8\s+)?(?:attivo|disponibile|possibile)|solo\s+l['\u2019]?acquisto/i;
const GROUP = /\bgrupp\w*|\bgroup\b|scolaresch\w*|comitive/i;

export function policyStatements(texts) {
  const all = (texts || []).filter(t => typeof t === 'string' && t.trim());
  const body = all.join('\n');
  if (!body.trim()) return { reserve: 'not stated', group: 'not stated', quotes: [] };

  const reserveBits = [];
  const quotes = [];
  if (RESERVE_YES.test(body)) {
    const m = body.match(PICKUP);
    if (m) reserveBits.push(`bookings must be collected at the box office at least ${m[1]} minutes before the show`);
    const f = body.match(BOOKING_FEE) || body.match(BOOKING_FEE2);
    if (f) {
      const eur = parseEur(f[1]);
      if (eur != null) reserveBits.push(`booking costs ${formatEur(eur)} per ticket on top of the ticket price`);
    }
    if (NO_RESERVE.test(body)) reserveBits.push('booking is not offered for some shows (purchase only)');
    if (!reserveBits.length) reserveBits.push('the site offers booking');
    quotes.push(firstSentence(body, /prenot\w+/i));
  }
  const reserve = reserveBits.length ? `yes \u2014 ${reserveBits.join('; ')}` : 'not stated';

  let group = 'not stated';
  if (GROUP.test(body)) {
    const q = firstSentence(body, GROUP);
    if (q) { group = `stated \u2014 ${trimSentence(q)}`; quotes.push(q); }
  } else {
    const seats = body.match(MAX_SEATS);
    if (seats && reserveBits.length) group = `not stated (online booking is limited to ${seats[1]} adjacent seats)`;
  }
  return { reserve, group, quotes: quotes.filter(Boolean) };
}

function firstSentence(text, re) {
  for (const s of String(text).split(/(?<=[.!?])\s+|\r?\n/)) {
    if (re.test(s)) return s.trim();
  }
  return null;
}
function trimSentence(s, n = 220) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).replace(/[\s,;]+$/, '') + '\u2026' : t;
}

// Price-coverage summary for one cinema, used by the loud report.
export function coverageRow(cinemaId, showings, evidence) {
  const total = showings.length;
  const withPrice = showings.filter(s => s.price_eur != null).length;
  const pct = total ? Math.round((withPrice / total) * 100) : 0;
  return {
    cinema: cinemaId,
    showings: total,
    priced: withPrice,
    pct,
    rates: (evidence && evidence.rates ? evidence.rates.length : 0),
    source: (evidence && (evidence.source || evidence.url)) || null,
    reason: (evidence && evidence.reason) || (total && !withPrice ? 'no price stated by the source' : null),
  };
}
