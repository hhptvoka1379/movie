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
const AMOUNT_SRC = '\\d{1,3}(?:[.\\u00a0]\\d{3})+,\\d{1,2}(?!\\d)|\\d+(?:[.,]\\d{1,2}(?!\\d))?';
const EUR_AMOUNT = new RegExp('(' + AMOUNT_SRC + ')');
const AMOUNT_RE = new RegExp(AMOUNT_SRC, 'g');
// A thousands-grouped amount always carries its decimals (1.234,50); 12.500 is not a ticket price.
const THOUSANDS_RE = /\d{1,3}[.\u00a0]\d{3}(?:[.\u00a0]\d{3})*,\d{1,2}/;
const EUR_LINE = new RegExp('(?:\\u20ac|\\beur(?:o|i)?\\b)\\s*' + EUR_AMOUNT.source + '|' +
  EUR_AMOUNT.source + '\\s*(?:\\u20ac|\\beur(?:o|i)?\\b)', 'i');

const ENTITIES = { euro: '\u20ac', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", egrave: '\u00e8', eacute: '\u00e9', igrave: '\u00ec', iacute: '\u00ed', ograve: '\u00f2', oacute: '\u00f3', ugrave: '\u00f9', uacute: '\u00fa', agrave: '\u00e0', aacute: '\u00e1' };
function decodeEntity(_, dec, hex, name) {
  if (dec) return String.fromCharCode(Number(dec));
  if (hex) return String.fromCharCode(parseInt(hex, 16));
  return ENTITIES[String(name).toLowerCase()] || '';
}

export function parseEur(text) {
  if (text == null) return null;
  if (typeof text === 'number') return Number.isFinite(text) ? round2(text) : null;
  const t = String(text).replace(/\u00a0/g, ' ').trim();
  const th = t.match(THOUSANDS_RE);
  if (th) return parsePlain(th[0].replace(/[.\u00a0 ]/g, '').replace(',', '.'));
  if (/^\d{1,3}([.\u00a0 ]\d{3})+$/.test(t)) return null; // 12.500: thousands, no ticket costs that much
  const m = t.match(EUR_AMOUNT);
  if (!m) return null;
  return parsePlain(m[0].replace(',', '.'));
}

function parsePlain(s) {
  const v = Number(String(s).replace(/\s+/g, ''));
  return Number.isFinite(v) && v > 0 && v < 1000 ? round2(v) : null;
}

// "Intero 8,50 EUR" / "feriali: 7.50\u20ac" -> 7.5 ; "biglietti" -> null
// An amount only counts as euros when the source marks it as money: a currency sign, the
// word euro, or a field that is already a number (an API price field). Bare digits inside a
// sentence ("under 26", "Durata: 118") are not prices.
export function eurFromText(text) {
  if (text == null) return null;
  if (typeof text === 'number') return parseEur(text);
  const s = String(text);
  const th = s.match(THOUSANDS_RE);                       // 1.234,50 must win over the '1' in it
  const m = s.match(EUR_LINE);
  if (!th && !m) return null;
  const amount = (th ? th[0] : (m[1] || m[2] || '')).replace(/\u00a0/g, ' ');
  if (!amount) return null;
  const plain = amount.replace(/[.\u00a0 ](?=\d{3}\b)/g, '').replace(',', '.');
  const v = Number(plain);
  return Number.isFinite(v) && v > 0 && v < 1000 ? round2(v) : null;
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
// Supplements: stated as an extra on top of the ticket, never the ticket itself.
const SUPPLEMENT = /\b(supplement\w*|maggiorazion\w*|sovrapprezz\w*|extra\b|plus\b|aggiunt\w*|occhial\w*|3d\s*\+|\+\s*\d)/i;
// The full/standard rate as Italian sites word it.
const FULL = /\b(intero|full|normale|standard|base|ordinario|regolare|biglietto\s+intero|prezzo\s+intero|tariffa\s+intera|adult\w*)\b/i;
// Rates the site ties to a day (or to a named day promo such as "Luned\u00ec 5,50").
const DAY_COND = /\b(ferial[i|e]|festiv[i|e]|prefestiv[i|e]|week\s?end|fine settimana|luned[i\u00ec]|marted[i\u00ec]|mercoled[i\u00ec]|gioved[i\u00ec]|venerd[i\u00ec]|sabato|domenica|giorn[oa]|day|daily|dal lun|al lun|giornata|notte|midnight|cinema\s?revolution|estivo|invernale|stagione)(?![a-z\u00ec\u00e8])/i;
const WEEKDAY_WORD = /\b(luned[i\u00ec]|marted[i\u00ec]|mercoled[i\u00ec]|gioved[i\u00ec]|venerd[i\u00ec]|sabato|domenica|lun|mar|mer|gio|ven|sab|dom)(?![a-z\u00ec\u00e8])/i;
// Rates the site ties to a presentation format.
const FORMAT_COND = /\b(3d|2d|imax|4dx|screen\s?x|screenx|dolby(?:\s?cinema|\s?atmos)?|atmos|vip|poltronissim\w*|galleria|platea|premium|luxe|lux|dbox|onix|sala\s?xl|grande schermo)(?![a-z])/i;
const FORMAT_3D = /\b(3d|imax|4dx|screen\s?x|screenx|dolby(?:\s?cinema|\s?atmos)?|atmos|dbox|onix|vip|poltronissim\w*|premium|luxe|sala\s?xl)(?![a-z])/i;

export function labelIsSupplement(label) { return SUPPLEMENT.test(String(label || '')); }

// True when the site states this rate as a full ticket price rather than a discount, a
// subscription or an extra on top of a ticket. A rate may still be limited to some days or
// formats ("Mercoled\u00ec 5,50", "Intero 3D 12,00"): that limit is a condition the resolver
// matches against the showing, not a reason to call the rate reduced.
export function labelIsFull(label) {
  const s = String(label || '');
  if (REDUCED.test(s) || NOT_TICKET.test(s) || labelIsSupplement(s)) return false;
  return true;
}

export function labelCondition(label) {
  const s = String(label || '');
  const day = DAY_COND.test(s) || WEEKDAY_WORD.test(s);
  const format = FORMAT_COND.test(s);
  return { day, format, supplement: labelIsSupplement(s), any: day || format };
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
      supplement: labelIsSupplement(label),
      source: r.source || null,
    });
  }
  return out;
}

// The full-price rate that applies to one showing, plus any supplement the site
// states for that showing's format (e.g. "Supplemento 3D 2,00 €" on a 3D screening).
//   1. only rates the site states as full price (never a reduced one, never a supplement);
//   2. among those, prefer one that matches the showing's day and format;
//   3. if several still match with different amounts, or none does, return null - the site
//      does not state a single unambiguous full price for this showing.
export function resolvePrice(showing, rates) {
  const list = cleanRates(rates).filter(r => r.eur != null);
  const full = list.filter(r => !r.supplement && labelIsFull(r.label));
  if (!full.length) return null;

  const date = showing && showing.date;
  const fmt = String((showing && showing.format) || '').toUpperCase();
  const weekend = date ? isWeekend(date) : null;
  const weekday = date ? new Date(date + 'T12:00:00Z').getUTCDay() : null;
  const is3D = /3D|IMAX|4DX|SCREENX|DOLBY/.test(fmt);
  const DAYNUM = { lun: 1, mar: 2, mer: 3, gio: 4, ven: 5, sab: 6, dom: 0 };

  // Day names stated as ranges or inside brackets ("Intero feriali (lun-ven)") describe a
  // class, not a named-day price: only a day name standing alone ("Lunedì cinema") counts as
  // one, and it wins over the class that also covers that day.
  const NAMED_DAY = /(^|[^\p{L}\p{N}-])(luned[i\u00ec]|marted[i\u00ec]|mercoled[i\u00ec]|gioved[i\u00ec]|venerd[i\u00ec]|sabato|domenica)(?![\p{L}-])/iu;
  const dayMatches = label => {
    if (NAMED_DAY.test(label)) {
      const key = label.match(NAMED_DAY)[2].toLowerCase().replace(/[\u00ec]/g, 'i').slice(0, 3);
      const dw = DAYNUM[key];
      return dw != null && weekday != null && dw === weekday;
    }
    if (/\bferial/i.test(label)) return weekend === false;
    if (/\b(?:pre)?festiv/i.test(label) || /\bweek\s?end\b|\bfine settimana\b/i.test(label)) return weekend === true;
    const w = WEEKDAY_WORD.exec(label);
    if (w) return null; // names days but as a range or a class: not a single-day price
    return null;        // says nothing about days
  };

  const score = r => {
    const c = labelCondition(r.label);
    const lf = normalizeFormat(r.label);
    let s = 0;
    if (lf) s += (lf === fmt || (lf === '3D' && is3D)) ? 3 : -6;
    else if (c.format) s += -4;            // depends on format but names none we know
    else s += is3D ? -1 : 1;               // unqualified rate: the plain 2D ticket
    const dm = dayMatches(r.label);
    if (dm === true) {
      // A rate naming this exact weekday ("Mercoled\u00ec 5,50") beats a day class that also
      // covers it ("Intero feriali"), which is how the venues state their weekly promos.
      s += NAMED_DAY.test(r.label) ? 4 : 3;
    } else if (dm === false) s += -6;
    else if (c.day) s += -2;               // varies by day but names none
    else s += 1;
    // A rate that names a day or a day class only applies to those days. Until it matches,
    // it must lose to a rate that says nothing about days, or a Monday promo price would be
    // reported as the full price of a Saturday show.
    if (c.day && dm !== true) s -= 2;
    return s;
  };

  const scored = full.map(r => ({ r, s: score(r) })).sort((a, b) => b.s - a.s);
  const best = scored[0];
  const tied = scored.filter(x => x.s === best.s);
  if (tied.length > 1 && new Set(tied.map(x => x.r.eur)).size > 1) return null; // ambiguous

  // Stated supplements for this showing's format are part of the full price the site states.
  let supplement = null;
  for (const r of list.filter(x => x.supplement)) {
    const lf = normalizeFormat(r.label);
    if (!lf) continue;
    if (lf === fmt || (lf === '3D' && is3D)) { supplement = r; break; }
  }
  const eur = supplement ? round2(best.r.eur + supplement.eur) : best.r.eur;
  return {
    eur,
    label: supplement ? `${best.r.label} + ${supplement.label}` : best.r.label,
    base: best.r.eur,
    supplement: supplement ? supplement.eur : null,
    source: supplement ? (best.r.source || supplement.source) : best.r.source,
  };
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
    const tag = labelIsFull(r.label) ? '' : (r.supplement ? ' (supplemento)' : ' (ridotto)');
    parts.push(`${r.label} ${formatEur(r.eur)}${tag}`);
    if (parts.length >= max) break;
  }
  const extra = list.length > parts.length ? ` +${list.length - parts.length} altre` : '';
  return parts.join('; ') + extra;
}

// ------------------------------------------------------- tariff text/HTML input

// Reads tariff rows out of a page or a text blob. A row is either one line ("Intero 8,50 \u20ac"),
// one table row ("Intero | 8,50 \u20ac"), or a label line followed by an amount-only line.
export function ratesFromText(text, source) {
  const body = decodeHtml(text);
  const rows = [];
  let pending = null; // a label line still waiting for its amount

  const flush = () => { pending = null; };
  const push = row => {
    const line = row.replace(/\s+/g, ' ').trim();
    if (!line || line.length > 200) return flush();
    const eur = eurFromText(line);
    if (eur == null) {
      // No amount here: it may be a label whose price sits on the next row.
      if (/[A-Za-z]{3}/.test(line) && !NOT_TICKET.test(line)) pending = line;
      else flush();
      return;
    }
    const label = stripAmount(line) || (pending ? stripAmount(pending) : '') || formatEur(eur);
    if (NOT_TICKET.test(label)) return flush();
    rows.push({ label: label.trim(), eur, source });
    flush();
  };

  for (const chunk of body.split(/\n+/)) {
    if (!/<\s*tr[\s>]/i.test(chunk)) { push(chunk); continue; }
    // A table: keep each <tr> on one row so a label cell stays with its price cell.
    for (const rawTr of chunk.replace(/<\s*tr[\s>]/gi, '\n<tr ').split('\n')) {
      if (!/<\s*tr[\s>]/i.test(rawTr)) continue;
      const end = rawTr.search(/<\/\s*tr>/i);
      const tr = end >= 0 ? rawTr.slice(0, end) : rawTr;
      const cells = tr.split(/<\s*t[dh][\s>]/i).slice(1)
        .map(c => decodeHtml(c.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      if (!cells.length) continue;
      push(cells.join(' '));
    }
  }
  return dedupe(rows);
}

// Tags to row/cell separators, then entities to characters.
export function decodeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/<\s*(?:br|hr)\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(?:p|div|li|ul|ol|h[1-6]|section|article|table|thead|tbody|tr|dt|dd|figcaption)\s*>/gi, '\n')
    .replace(/<\s*(?:td|th)[\s>]/gi, ' | ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;?/gi, ' ')
    .replace(/&(?:#(\d+)|#x([0-9a-f]+)|(euro|amp|lt|gt|quot|apos|egrave|eacute|igrave|iacute|ograve|oacute|ugrave|uacute|agrave|aacute));?/gi, decodeEntity)
    .replace(/[ \t]*\|[ \t]*/g, ' ')
    .replace(/\n{2,}/g, '\n');
}

// "Intero feriali 7,50 \u20ac" -> "Intero feriali"
function stripAmount(line) {
  return String(line == null ? '' : line)
    .replace(new RegExp('(?:\\u20ac|\\beur(?:o|i)?\\b)\\s*(?:' + AMOUNT_SRC + ')', 'gi'), ' ')
    .replace(new RegExp('(?:' + AMOUNT_SRC + ')\\s*(?:\\u20ac|\\beur(?:o|i)?\\b)', 'gi'), ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N})\]]+$/u, '')   // accents are letters
    .replace(/[,;:\s]+$/, '')
    .trim();
}

// Walks an arbitrary JSON payload (a captured endpoint response) and collects
// objects that look like a tariff row: a text field plus a money field.
const MONEY_KEYS = /^(price|prices|amount|amounts|cost|tariffa?|tariffe|prezzo|prezzi|importo|valore|fullprice|standardprice|ticketprice|standard|intero)$/i;
const TEXT_KEYS = /^(description|descrizione|label|name|nome|tariffaname|title|titolo|text|codice|code|tipo|tipologia)$/i;
const ID_KEYS = { PerformanceId: 'performance', performanceId: 'performance', IdPerformance: 'performance', EventId: 'event', eventId: 'event', MasterEventId: 'event', TitleId: 'event' };

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
        const raw = node[mk];
        const eur = (typeof raw === 'number' ? parseEur(raw) : eurFromText(raw));
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

// Tariff rows that sit inside an object carrying a performance/event id, so a showing can be
// matched exactly instead of inheriting the venue's rates. Returns [{ scope, id, label, eur }].
export function scopedRowRates(payload, source) {
  const out = [];
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    let scope = null, id = null;
    for (const [k, which] of Object.entries(ID_KEYS)) {
      if (node[k] != null && node[k] !== '') { scope = which; id = Number(node[k]); break; }
    }
    if (scope && id != null) {
      for (const r of ratesFromJson(node, source)) out.push({ scope, id, ...r });
    }
    for (const v of Object.values(node)) walk(v);
  })(payload);
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
const MAX_SEATS = /(?:massimo(?:\s+di)?|fino\s+(?:ad|a)(?:\s+un)?(?:\s+massimo\s+(?:di)?)?|max(?:\s+di)?|up\s+to)\s+(\d{1,3})\s+(?:posti|postazioni|tickets|seats)/i;
const NO_PREPAY = /senza\s+(?:alcun\s+)?pagamento\s+anticipato|senza\s+pagare|non\s+richiede\s+(?:alcun\s+)?pagamento|pagamento\s+(?:in|alla)\s+cassa|pay\s+at\s+the\s+(?:box\s?office|cinema)|without\s+(?:any\s+)?(?:advance\s+)?payment/i;
// The venue itself says booking is not offered at all (vs. generic platform wording that
// merely describes how bookings work when they exist).
const NO_RESERVE_AT_ALL = /prenot\w*\s+(?:non\s+)?(?:\w+\s+){0,2}non\s+(?:\u00e8|e'|è)\s+previst[ao]|(?:il\s+)?servizio\s+(?:di\s+)?prenot\w+\s+non\s+(?:\u00e8|e')\s+(?:attivo|abilitato|disponibile|previst)\w*|prenot\w+\s+non\s+(?:\u00e8|e')\s+(?:attivo|abilitato|disponibile|previst)\w*|servizio\s+non\s+abilitato|booking\s+(?:is\s+)?not\s+(?:available|offered)/i;
const NO_RESERVE = /(?:non\s+(?:\u00e8\s+)?(?:attivo|disponibile|possibile)|not available)[^.]*?prenot\w+|prenot\w+[^.]*?non\s+(?:\u00e8\s+)?(?:attivo|disponibile|possibile)|solo\s+l['\u2019]?acquisto/i;
const GROUP = /\bgrupp\w*|\bgroup\b|scolaresch\w*|comitive/i;

export function policyStatements(texts) {
  const all = (texts || []).filter(t => typeof t === 'string' && t.trim()).map(decodeHtml);
  const body = all.join('\n');
  if (!body.trim()) return { reserve: 'not stated', group: 'not stated', quotes: [] };

  const reserveBits = [];
  const quotes = [];
  const qNo = bestSentence(body, NO_RESERVE_AT_ALL);
  if (qNo) {
    // An explicit "booking is not offered here" beats every generic sentence about bookings.
    const st = { reserve: `no \u2014 the site states ${trimSentence(qNo, 160)}`, group: 'not stated', quotes: [qNo] };
    const g = bestSentence(body, GROUP);
    if (g) st.group = groupStatement(g);
    return st;
  }
  if (RESERVE_YES.test(body)) {
    const m = body.match(PICKUP);
    if (m) reserveBits.push(`bookings must be collected at the box office at least ${m[1]} minutes before the show`);
    if (NO_PREPAY.test(body)) reserveBits.push('the site states booking happens without paying in advance, the ticket is paid at the box office');
    else {
      const f = body.match(BOOKING_FEE) || body.match(BOOKING_FEE2);
      if (f) {
        const eur = parseEur(f[1]);
        if (eur != null) reserveBits.push(`booking costs ${formatEur(eur)} per ticket on top of the ticket price`);
      }
    }
    if (NO_RESERVE.test(body)) reserveBits.push('booking is not offered for some shows (purchase only)');
    if (!reserveBits.length) reserveBits.push('the site offers booking');
    const q = firstSentence(body, /prenot\w+/i);
    if (q) quotes.push(q);
  }
  const reserve = reserveBits.length ? `yes \u2014 ${reserveBits.join('; ')}` : 'not stated';

  let group = 'not stated';
  const g = GROUP.test(body) ? bestSentence(body, GROUP) : null;
  if (g) {
    group = groupStatement(g);
    quotes.push(g);
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

function groupStatement(sentence) {
  return /@|mail|e-mail|telefon|chiam|contatt|scrivere/i.test(sentence)
    ? 'stated \u2014 the site describes group bookings and asks to contact the cinema'
    : `stated \u2014 ${trimSentence(sentence)}`;
}

// Headings match a keyword too, so take the longest matching sentence: that is the one that
// actually states something.
function bestSentence(text, re) {
  const hits = String(text).split(/(?<=[.!?])\s+|\r?\n/).map(s => s.trim()).filter(s => re.test(s));
  if (!hits.length) return null;
  return hits.sort((a, b) => b.length - a.length)[0];
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
