// Pure helpers for fetch-prices-fast.mjs: match showings to platform performances, build the
// evidence record, apply it to data/showtimes.json. No network, no clock: all testable offline.

export const SOURCE = 'webtic:getPurchaseTicketsInfo';

const eurIt = v => '€' + Number(v).toFixed(2).replace('.', ',');
// A showing whose price this module filled in (its price_note carries the marker). Re-runs refresh
// those and never touch a price that came from anywhere else.
const MARK = 'prezzo mostrato da WebTic per questa proiezione';
export const isFastPriced = s => s.price_eur != null && String(s.price_note || '').includes(MARK);
const showingKey = s => [s.film_id, s.cinema_id, s.date, s.time, s.language, s.format || ''].join('|');

// Which performance(s) is each target showing? perfs come from schedulingPerformances().
// Returns { matched: [{ showing, perfs: [perf], how }], unmatched: [{ showing, reason }] }.
export function matchShowings(showings, perfs) {
  const byFull = new Map(), byTime = new Map();
  for (const p of perfs) {
    const k1 = [p.film_id, p.date, p.time].join('|');
    const k2 = [p.date, p.time].join('|');
    (byFull.get(k1) || byFull.set(k1, []).get(k1)).push(p);
    (byTime.get(k2) || byTime.set(k2, []).get(k2)).push(p);
  }
  const dataAtTime = new Map();
  for (const s of showings) { const k = [s.date, s.time].join('|'); dataAtTime.set(k, (dataAtTime.get(k) || 0) + 1); }
  const matched = [], unmatched = [];
  for (const s of showings) {
    let c = byFull.get([s.film_id, s.date, s.time].join('|')) || [];
    let how = 'film+time';
    if (c.length > 1) {
      const byLang = c.filter(p => p.language === s.language);
      if (byLang.length) c = byLang;
      const byFmt = c.filter(p => (p.format || '') === (s.format || ''));
      if (byFmt.length) c = byFmt;
    }
    if (!c.length) {
      // Same slot, title spelled differently: accepted only when the slot holds exactly one
      // performance on the platform and exactly one showing in our data.
      const t = byTime.get([s.date, s.time].join('|')) || [];
      if (t.length === 1 && dataAtTime.get([s.date, s.time].join('|')) === 1) { c = t; how = 'time-unique'; }
    }
    if (!c.length) unmatched.push({ showing: s, reason: 'no performance at that date/time/film in the live schedule' });
    else matched.push({ showing: s, perfs: c, how });
  }
  return { matched, unmatched };
}

// parsed: Map perf_id -> parseIntero() result. Several candidate performances must agree.
export function resolveMatch(m, parsed) {
  const rs = m.perfs.map(p => ({ p, r: parsed.get(p.perf_id) })).filter(x => x.r);
  if (!rs.length) return { reason: 'price list not fetched' };
  const priced = rs.filter(x => x.r.eur != null);
  if (!priced.length) return { reason: rs[0].r.reason || 'no Intero stated' };
  if (new Set(priced.map(x => x.r.eur)).size > 1 || priced.length !== rs.length) return { reason: 'several performances share this slot with different prices' };
  const { p, r } = priced[0];
  return { entry: {
    film_id: m.showing.film_id, date: m.showing.date, time: m.showing.time, language: m.showing.language, format: m.showing.format || null,
    perf_id: p.perf_id, event_id: p.event_id, match: m.how,
    eur: r.eur, net_eur: r.net_eur, fee_eur: r.fee_eur, label: r.label, sector: r.sector, multi_sector: !!r.multi_sector,
    sectors: !r.multi_sector ? [] : r.sectors.map(x => ({ sector: x.sector_name || x.sector, label: x.label, eur: x.eur, net_eur: x.net_eur, fee_eur: x.fee_eur })),
  } };
}

// Wording kept on the showing so the fee and the sector spread are not lost.
export function noteFor(e) {
  let t = `Intero ${eurIt(e.eur)}`;
  if (e.multi_sector) {
    const others = [...new Map(e.sectors.filter(s => s.eur !== e.eur).map(s => [s.sector + s.eur, s])).values()];
    t += ` (settore più economico; ${others.map(s => `${s.sector} ${eurIt(s.eur)}`).join(', ')})`;
  }
  if (e.fee_eur && e.net_eur != null && Math.abs(e.net_eur + e.fee_eur - e.eur) < 0.005) t += ` online (biglietto ${eurIt(e.net_eur)} + ${eurIt(e.fee_eur)} commissione)`;
  else if (e.fee_eur) t += `, commissione online ${eurIt(e.fee_eur)}`;
  return t + ' — ' + MARK;
}

// Evidence in the scrape/apply-prices.mjs shape (cinemas[id] with rates/price_source/...), plus
// the per-performance rows that shape cannot hold. `rates` only for a fully covered cinema, and
// then with preserve_showing_prices so apply-prices never re-resolves a showing from them.
export function buildEvidence({ range, results, generatedAt, blocked, adapter = 'webtic' }) {
  const cinemas = {};
  for (const r of results) {
    const total = r.total, priced = r.prices.length + r.alreadyPriced;
    const rates = [];
    if (r.alreadyPriced === 0 && r.prices.length === total && total) {
      const seen = new Set();
      for (const e of r.prices) {
        const k = e.eur; if (seen.has(k)) continue; seen.add(k);
        rates.push({ label: 'Intero', eur: e.eur, condition: null, source: SOURCE });
      }
    }
    cinemas[r.cinema] = {
      cinema: r.cinema, adapter, status: r.status, rates, preserve_showing_prices: true,
      price_source: SOURCE, price_reason: r.reason || null,
      showings: total, priced, pct: total ? Math.round(priced / total * 100) : 0,
      prices: r.prices, unmatched: r.unmatched.map(u => ({ film_id: u.showing.film_id, date: u.showing.date, time: u.showing.time, language: u.showing.language, format: u.showing.format || null, reason: u.reason })),
    };
  }
  return { generated_at: generatedAt, range, note: 'per-performance Intero from the public WebTic price list', blocked: blocked || [], cinemas };
}

const STALE_NOTE = [
  /\s*Prezzo intero dinamico al checkout \("da €[\d,]+"\)\.?/i,
  /\s*Tariffa intera mostrata solo dopo la scelta del posto\.?/i,
  /\s*Tariffario non pubblicato sul sito \(in revisione\); prezzo visibile dopo selezione posto\.?/i,
];
const NOTE_TAG = 'Prezzo intero per proiezione:';

// Applies evidence to a showtimes object in place. Only fills price_eur where it is null; a
// different existing price is counted as a conflict and left alone. Idempotent.
export function applyEvidence(data, ev, { only } = {}) {
  const idx = new Map();
  for (const s of data.showings) idx.set(showingKey(s), s);
  const stats = { set: 0, unchanged: 0, conflicts: [], missing: 0, notes: 0 };
  for (const [cid, c] of Object.entries(ev.cinemas || {})) {
    if (only && only.size && !only.has(cid)) continue;
    for (const e of c.prices || []) {
      const s = idx.get(showingKey({ ...e, cinema_id: cid }));
      if (!s) { stats.missing++; continue; }
      if (s.price_eur != null && s.price_eur !== e.eur && !isFastPriced(s)) { stats.conflicts.push({ cinema: cid, film_id: s.film_id, date: s.date, time: s.time, existing: s.price_eur, api: e.eur }); continue; }
      const note = noteFor(e);
      if (s.price_eur === e.eur && s.price_note === note) { stats.unchanged++; continue; }
      s.price_eur = e.eur;
      s.price_note = note;
      stats.set++;
    }
    const cin = data.cinemas.find(x => x.id === cid);
    const mine = data.showings.filter(x => x.cinema_id === cid);
    const fast = mine.filter(isFastPriced);
    if (cin && fast.length) {
      let n = String(cin.notes || '');
      for (const re of STALE_NOTE) n = n.replace(re, '');
      n = n.replace(/\s*Prezzo intero per proiezione:[^|]*$/i, '').replace(/\s+$/, '');
      const lo = Math.min(...fast.map(x => x.price_eur)), hi = Math.max(...fast.map(x => x.price_eur));
      const range = lo === hi ? eurIt(lo) : `${eurIt(lo)}\u2013${eurIt(hi)}`;
      const left = mine.filter(x => x.price_eur == null).length;
      const add = `${NOTE_TAG} ${range} online, letto per ogni proiezione dal listino pubblico WebTic (${fast.length} di ${mine.length}${left ? `; ${left} senza prezzo: proiezione non pi\u00f9 in programma su WebTic` : ''}); include la commissione online per biglietto.`;
      const next = `${n}${n && !/[.!]$/.test(n) ? '.' : ''} ${add}`.trim();
      if (next !== cin.notes) { cin.notes = next; stats.notes++; }
    }
  }
  return stats;
}
