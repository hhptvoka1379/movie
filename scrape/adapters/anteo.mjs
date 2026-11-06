// Anteo / spazioCinema adapter. Calls the site's own calendar endpoint from inside the page
// (same request the on-page calendar widget makes), once per cinema per day.
//
// Prices: read from the venue's public tariff page (spaziocinema.info/cinema/tariffe/...),
// which states tariffs per day and per format, and optionally from each projection page the
// calendar already links to. Nothing is read behind a login or in a checkout.
import { ratesFromText, policyStatements, cleanRates } from '../lib/prices.mjs';

export function dateRange(from, to) {
  const o = [];
  for (let d = new Date(from + 'T12:00:00Z'); d <= new Date(to + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) o.push(d.toISOString().slice(0, 10));
  return o;
}

// Tariff page candidates for one venue, most specific first. `cinemaParam` is the value the
// site's widget uses for ?cinema=, e.g. "Citylife anteo" / "Ariosto".
export function tariffUrls(cinemaParam, origin = 'https://www.spaziocinema.info') {
  const slug = String(cinemaParam || '').trim().toLowerCase()
    .normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const first = slug.split('-')[0];
  const out = [];
  if (slug) out.push(`${origin}/cinema/tariffe/${slug}`, `${origin}/cinema/tariffe/${slug.replace(/-anteo$/, '')}`);
  if (first && first !== slug) out.push(`${origin}/cinema/tariffe/${first}`, `${origin}/milano/cinema/tariffe/${first}`);
  out.push(`${origin}/cinema/tariffe`, `${origin}/milano/tariffe`);
  return [...new Set(out)];
}

// cinemaParam: value the site's widget uses for ?cinema=
// opts.perProjection: also open each projection page and take the price it states (default true)
export async function scrapeAnteo(browser, { from, to, cinemaParam, perProjection = true, throttleMs = 350 }) {
  const ctx = await browser.newContext({ locale: 'it-IT' });
  const p = await ctx.newPage();
  try {
    await p.goto('https://www.spaziocinema.info/milano/cinema', { waitUntil: 'networkidle', timeout: 60000 });
    const rows = [];
    for (const dt of dateRange(from, to)) {
      const q = `/cinema/@@get-calendario?dt=${dt}&cinema=${encodeURIComponent(cinemaParam).replace(/%20/g, '+')}`;
      const films = await p.evaluate(async u => { const r = await fetch(u); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }, q);
      if (!Array.isArray(films)) throw new Error('anteo: unexpected payload for ' + q);
      for (const f of films) for (const o of f.orari || []) rows.push({ film: f, o });
    }
    const tariffs = await anteoTariffs(p, cinemaParam);
    const projectionPrices = perProjection && rows.length
      ? await anteoProjectionPrices(p, rows, { throttleMs })
      : new Map();
    return { rows, tariffs, projectionPrices };
  } finally { await ctx.close(); }
}

// Fetches the first tariff candidate that answers and states at least one euro amount.
export async function anteoTariffs(page, cinemaParam) {
  const tried = [];
  for (const url of tariffUrls(cinemaParam)) {
    let res;
    try {
      res = await page.evaluate(async u => {
        const r = await fetch(u, { headers: { Accept: 'text/html' } });
        return { status: r.status, text: r.ok ? await r.text() : null };
      }, url);
    } catch (e) {
      tried.push({ url, error: String(e.message || e).split('\n')[0] });
      continue;
    }
    tried.push({ url, status: res.status, amounts: res.text ? (res.text.match(/\u20ac/g) || []).length : 0 });
    if (!res.status || res.status >= 400 || !res.text) continue;
    const text = await page.evaluate(t => {
      const d = document.implementation.createHTMLDocument('t');
      d.body.innerHTML = t;
      return d.body.innerText || d.body.textContent || '';
    }, res.text);
    const rates = ratesFromText(text, url);
    if (!rates.length) continue;
    const policy = policyStatements([text]);
    return { url, status: res.status, rates, policy, tried };
  }
  return {
    url: null, status: null, rates: [], policy: { reserve: 'not stated', group: 'not stated' },
    tried,
    reason: `no public tariff page answered with a stated price (tried ${tried.map(t => t.url + (t.status ? ' -> HTTP ' + t.status : '')).join(', ')})`,
  };
}

// Each calendar row already carries the projection URL the site shows; open it and keep the
// price it states. Failures are warnings, never fatal: the tariff page is the main source.
export async function anteoProjectionPrices(page, rows, { throttleMs = 350 } = {}) {
  const map = new Map();
  const warnings = [];
  for (const { o } of rows) {
    const url = o.projection_url;
    if (!url || map.has(url)) continue;
    try {
      const res = await page.evaluate(async u => {
        const r = await fetch(u, { headers: { Accept: 'text/html' } });
        return { status: r.status, text: r.ok ? await r.text() : null };
      }, url);
      if (!res.text) { warnings.push(`${url}: HTTP ${res.status}`); continue; }
      const text = await page.evaluate(t => {
        const d = document.implementation.createHTMLDocument('t');
        d.body.innerHTML = t;
        return d.body.innerText || d.body.textContent || '';
      }, res.text);
      const rates = ratesFromText(text, url);
      if (rates.length) map.set(url, rates);
    } catch (e) {
      warnings.push(`${url}: ${String(e.message || e).split('\n')[0]}`);
    }
    if (throttleMs) await page.waitForTimeout(throttleMs);
  }
  map.warnings = warnings;
  return map;
}

const VO_PREFIX = /^\s*v\.?\s?o\.?\s*(sott\.?\s*ita\.?)?\s*[-\u2013]?\s*/i;
export function anteoToShowings(input, tariffs) {
  // Accepts the { rows, tariffs, projectionPrices } object, or a bare rows array (old call sites).
  const rows = Array.isArray(input) ? input : input.rows;
  const projectionPrices = (!Array.isArray(input) && input.projectionPrices) || new Map();
  const localRates = cleanRates(tariffs?.rates || []);
  return rows.map(({ film: f, o }) => {
    const vo = VO_PREFIX.test(f.title) || /- v\. ?o\.?$/i.test(f.title.trim()) || /LINGUA ORIGINALE/i.test(f.technologies || '') || (f.language && !/^italiano$/i.test(f.language));
    const title = f.title.replace(VO_PREFIX, '').replace(/\s*-\s*v\.?\s?o\.?\s*$/i, '').trim();
    const t = [...(o.technologies || []), f.technologies || ''].join(' ');
    const perProjection = (o.projection_url && projectionPrices.get(o.projection_url)) || null;
    return { title, original_title: null, year: f.year || null, runtime_min: f.length || null, tmdb_id: f.tmdb_id || null,
      date: o.date, time: o.hour, language: vo ? 'vos' : 'ita', format: /3D/.test(t) ? '3D' : null,
      price_eur: null, rates: perProjection && perProjection.length ? perProjection : localRates,
      booking_url: o.projection_url || null, tags: [f.language, f.technologies].filter(Boolean), notes: f.notes?.trim() || null };
  });
}
