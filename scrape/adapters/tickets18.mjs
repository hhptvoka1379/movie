// 18tickets family adapter (used by Cineteca Milano Arlecchino). Server-rendered film pages with a
// date strip; clicking a date reveals a.film-projection elements carrying date/time/title.
//
// Prices: read from what the film page states in its public body text, and from the projection
// page each a.film-projection links to. A login dialog is a site gate: it is closed, never
// bypassed, and a gated page contributes no price (null) instead of a guessed one.
import { ratesFromText, policyStatements } from '../lib/prices.mjs';

export async function scrapeTickets18(browser, { base, from, to, tariffUrls = [], perProjection = true, maxProjectionPages = 400, throttleMs = 250 }) {
  const ctx = await browser.newContext({ locale: 'it-IT', timezoneId: 'Europe/Rome' });
  const p = await ctx.newPage();
  p.setDefaultTimeout(8000);
  try {
    await p.goto(base, { waitUntil: 'networkidle', timeout: 60000 });
    const baseText = await p.evaluate(() => document.body.innerText);
    const films = await p.$$eval('a[href*="/film/"]', a => [...new Map(a.map(x => [x.href.split(/[?#]/)[0], x.innerText.trim().replace(/\s+/g, ' ')]).filter(([h]) => /\/film\/\d+$/.test(h))).entries()].map(([href, text]) => ({ href, text })));
    if (!films.length) throw new Error('tickets18: no films listed at ' + base);
    const rows = [];
    const warnings = [];
    const filmRates = new Map(); // film href -> rates[] stated on that film's page
    for (const f of films) {
     try {
      await p.goto(f.href, { waitUntil: 'networkidle', timeout: 60000 });
      // A login dialog is a site gate, not something to bypass: close it if it offers a close, else skip.
      if (await p.locator('#modal-login.show').count()) {
        await p.keyboard.press('Escape');
        await p.waitForTimeout(500);
        if (await p.locator('#modal-login.show').count()) throw new Error('login-gated page, skipped');
      }
      const info = await p.evaluate(() => {
        const t = document.body.innerText;
        return { runtime: +(t.match(/Durata:\s*(\d+)/) || [])[1] || null, lang: (t.match(/Lingua:\s*([^\n]+)/) || [])[1] || null, year: (t.match(/Anno:\s*(\d{4})/) || [])[1] || null, text: t };
      });
      const rates = ratesFromText(info.text, f.href);
      if (rates.length) filmRates.set(f.href, rates);
      await p.waitForSelector('a.film-projection', { timeout: 6000 }).catch(() => {});
      const days = await p.$$eval('.m18-day-elem[data-target]', e => e.map(x => x.dataset.target));
      const collect = async () => {
        const perfs = await p.$$eval('a.film-projection', a => a.map(x => ({ ext: x.dataset.dateExtended, title: x.dataset.title, id: x.dataset.id })));
        for (const pf of perfs) {
          const m = (pf.ext || '').match(/(\d\d)\/(\d\d)\/(\d{4}) ore (\d\d:\d\d)/);
          if (!m) continue;
          const date = `${m[3]}-${m[2]}-${m[1]}`;
          if (date < from || date > to) continue;
          rows.push({ title: pf.title, date, time: m[4], runtime_min: info.runtime, lang: info.lang, year: info.year, booking_url: `${f.href}/${pf.id}#theater-init`, perf_id: pf.id, film_href: f.href });
        }
      };
      await collect(); // the pre-selected date (or the only date, when there is no date strip)
      const selected = await p.$eval('.m18-day-elem.selected[data-target]', e => e.dataset.target).catch(() => null);
      for (const d of days.filter(d => d >= from && d <= to && d !== selected)) {
        await p.click(`.m18-day-elem[data-target="${d}"]`);
        await p.waitForTimeout(400);
        await collect();
      }
     } catch (e) { warnings.push(`${f.text || f.href}: ${e.message.split('\n')[0]}`); }
    }
    if (warnings.length) console.warn(`[tickets18] ${base}: ${warnings.length} film page(s) skipped:\n  ` + warnings.join('\n  '));
    rows.warnings = warnings;

    const projectionPrices = perProjection
      ? await tickets18ProjectionPrices(p, rows, { maxProjectionPages, throttleMs, warnings })
      : new Map();
    const venueRates = [];
    const policyTexts = [baseText];
    const tried = [{ url: base, note: 'venue home page' }];
    let tariffUrlHit = null;
    for (const tUrl of tariffUrls || []) {
      try {
        const tp = await ctx.newPage();
        try {
          const resp = await tp.goto(tUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          const st = resp ? resp.status() : 0;
          tried.push({ url: tUrl, status: st });
          if (st && st < 400) {
            const body = await tp.evaluate(() => {
              const clone = document.body.cloneNode(true);
              clone.querySelectorAll('script, style, noscript, nav, footer').forEach(el => el.remove());
              return { html: clone.innerHTML || '', text: clone.innerText || '' };
            });
            const r = ratesFromText(body.html || body.text, tUrl);
            if (r.length) {
              venueRates.push(...r);
              if (!tariffUrlHit) tariffUrlHit = tUrl;
            }
            if (body.text) policyTexts.push(body.text);
          }
        } finally { await tp.close(); }
      } catch (e) {
        tried.push({ url: tUrl, error: String(e.message || e).split('\n')[0] });
      }
    }
    const tariffs = { url: tariffUrlHit, rates: venueRates, policy: policyStatements(policyTexts), tried };
    if (!filmRates.size && !projectionPrices.size && !venueRates.length) {
      tariffs.reason = `no film, projection or venue tariff page on ${base} states a ticket price`;
      warnings.push(`tickets18: ${tariffs.reason}`);
    }
    const out = rows;
    out.filmRates = filmRates;
    out.projectionPrices = projectionPrices;
    out.tariffs = tariffs;
    out.policy = tariffs.policy;
    return out;
  } finally { await ctx.close(); }
}

// Opens the projection page behind each a.film-projection link and keeps the price it states.
// Capped so one venue cannot turn into thousands of requests; failures are warnings only.
export async function tickets18ProjectionPrices(page, rows, { maxProjectionPages = 400, throttleMs = 250, warnings = [] } = {}) {
  const map = new Map();
  const urls = [...new Set(rows.map(r => r.booking_url).filter(Boolean))];
  let gated = 0, fetched = 0;
  for (const url of urls.slice(0, maxProjectionPages)) {
    try {
      const res = await page.evaluate(async u => {
        const r = await fetch(u, { headers: { Accept: 'text/html' } });
        return { status: r.status, text: r.ok ? await r.text() : null };
      }, url);
      if (!res.text) { warnings.push(`price page ${url}: HTTP ${res.status}`); continue; }
      if (/id=["']?modal-login/i.test(res.text)) { gated++; continue; } // login gate: no public price
      const text = await page.evaluate(t => {
        const d = document.implementation.createHTMLDocument('t');
        d.body.innerHTML = t;
        return d.body.innerText || d.body.textContent || '';
      }, res.text);
      const rates = ratesFromText(text, url);
      if (rates.length) map.set(url, rates);
      fetched++;
    } catch (e) {
      warnings.push(`price page ${url}: ${String(e.message || e).split('\n')[0]}`);
    }
    if (throttleMs) await page.waitForTimeout(throttleMs);
  }
  if (urls.length > maxProjectionPages) warnings.push(`tickets18: price checked on ${maxProjectionPages} of ${urls.length} projection pages`);
  if (gated) warnings.push(`tickets18: ${gated} projection page(s) are login-gated, price left null`);
  map.warnings = warnings;
  map.fetched = fetched;
  return map;
}

export function tickets18ToShowings(input, tariffs) {
  // Accepts the enriched result of scrapeTickets18 (array plus attached maps) or a bare array.
  const rows = Array.isArray(input) ? input : input.rows || [];
  const filmRates = (input && input.filmRates) || new Map();
  const projectionPrices = (input && input.projectionPrices) || new Map();
  const fallbackRates = (tariffs && tariffs.rates) || (input && input.tariffs && input.tariffs.rates) || [];
  const seen = new Set();
  const out = rows.filter(r => { const k = r.perf_id; if (seen.has(k)) return false; seen.add(k); return true; }).map(r => {
    const vo = /\bV\.?\s?O\.?\b/i.test(r.title) || (r.lang && !/italiano/i.test(r.lang));
    const perProjection = (r.booking_url && projectionPrices.get(r.booking_url)) || null;
    const perFilm = (r.film_href && filmRates.get(r.film_href)) || null;
    const chosenRates = (perProjection && perProjection.length) ? perProjection : ((perFilm && perFilm.length) ? perFilm : fallbackRates);
    return { title: r.title.replace(/\s*-?\s*\(?\s?V\.?\s?O\.?\)?\s*$/i, '').replace(/\s*\(RIED\.?\)\s*$/i, '').trim(), original_title: null, year: r.year, runtime_min: r.runtime_min,
      date: r.date, time: r.time, language: vo ? 'vos' : 'ita', format: null, price_eur: null,
      rates: chosenRates,
      booking_url: r.booking_url, tags: [r.lang] };
  });
  out.warnings = rows.warnings;
  return out;
}
