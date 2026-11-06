// WebTic family adapter (Crea Informatica). Drives the real WebTic page in a browser and
// captures the page's own getFullScheduling / getLocalInfo responses.
//
// Prices: the public page is sniffed for any JSON response that states tariffs
// (getLocalPrices / getTariffe / getPriceList / getEventPrices / getPerformancePrices
// and anything else the page itself asks for). Only what the page loads on its own is
// read: no login, no seat selection, no checkout step is ever reached.
import { ratesFromJson, scopedRowRates, policyStatements, cleanRates } from '../lib/prices.mjs';

// Response names worth keeping in full; everything else is kept only when it mentions money.
const WANTED = /(getFullScheduling|getLocalInfo|getLocalPrices|getPrices?|getTariff\w*|getPriceList|getTariffs?|getEventPrices|getPerformancePrices|getTickets?|getRates)/i;
const MONEY_HINT = /(price|tariff|prezzo|importo|amount|rate\b)/i;

export async function scrapeWebtic(browser, localId) {
  const ctx = await browser.newContext({ locale: 'it-IT' });
  const p = await ctx.newPage();
  const got = {};        // wtid -> payload
  const others = [];     // { url, payload } for responses without a wtid
  p.on('response', async r => {
    const u = r.url();
    if (!/\bjson\b/i.test(r.headers()['content-type'] || '') && !/wtid=|WebticPortal|\.ashx/i.test(u)) return;
    const m = u.match(/wtid=(\w+)/);
    let payload = null;
    try { payload = JSON.parse(await r.text()); } catch { return; }
    if (m) got[m[1]] = payload;
    else if (WANTED.test(u) || MONEY_HINT.test(u)) others.push({ url: u, payload });
  });
  await p.goto(`https://www.webtic.it/#/shopping?action=loadLocal&localId=${localId}`, { waitUntil: 'networkidle', timeout: 60000 });
  for (let i = 0; i < 10 && !got.getFullScheduling; i++) await p.waitForTimeout(1000);
  await ctx.close();
  if (!got.getFullScheduling?.DS) throw new Error('webtic: no scheduling payload for local ' + localId);
  const prices = collectPrices(got, others, localId);
  return {
    scheduling: got.getFullScheduling.DS.Scheduling,
    info: got.getLocalInfo,
    captured: Object.keys(got).concat(others.map(o => o.url.slice(0, 80))),
    prices,
    policy: webticPolicy(got.getLocalInfo),
    booking: webticBooking(localId),
  };
}

// Gathers tariff rows from every captured payload. Rows nested inside an object that carries a
// PerformanceId / EventId are kept per showing; anything else applies to the whole venue.
export function collectPrices(got, others, localId) {
  const byPerformance = new Map(); // performanceId -> rates[]
  const byEvent = new Map();       // eventId -> rates[]
  const local = [];
  const sources = [];
  const scopedSeen = new Set();

  const consider = (payload, source) => {
    const scoped = scopedRowRates(payload, source);
    let foundAny = false;
    for (const r of scoped) {
      const k = `${r.scope}:${r.id}:${r.label.toLowerCase()}:${r.eur}`;
      if (scopedSeen.has(k)) continue;
      scopedSeen.add(k);
      foundAny = true;
      const list = cleanRates([r]);
      if (!list.length) continue;
      const map = r.scope === 'performance' ? byPerformance : byEvent;
      if (!map.has(r.id)) map.set(r.id, []);
      map.get(r.id).push(...list);
      sources.push(source);
    }
    if (foundAny) return true;
    // No per-showing rows: the payload states venue-wide tariffs, if any.
    const rates = cleanRates(ratesFromJson(payload, source));
    if (!rates.length) return false;
    local.push(...rates);
    sources.push(source);
    return true;
  };

  for (const [wtid, payload] of Object.entries(got)) {
    // getFullScheduling / getLocalInfo carry no tariffs in the captures we have, but a platform
    // update could add them: look anyway, and report what was checked when nothing is found.
    if (wtid === 'getFullScheduling' || wtid === 'getLocalInfo') {
      if (!ratesFromJson(payload, `webtic:${wtid}`).length) continue;
    }
    consider(payload, /localId=/.test(wtid) ? `webtic:${wtid}` : `webtic:${wtid}?localId=${localId}`);
  }
  for (const o of others) consider(o.payload, o.url.slice(0, 200));

  const rates = local.length ? local : [...byEvent.values()].flat();
  const reason = rates.length || byPerformance.size || byEvent.size ? null
    : 'WebTic page exposes no tariff endpoint without entering the purchase flow ' +
      `(checked ${Object.keys(got).join(', ') || 'nothing'}); prices only appear after seat selection.`;
  return {
    local, rates, byPerformance: [...byPerformance], byEvent: [...byEvent],
    sources: [...new Set(sources)], reason,
  };
}

// Reservation-without-payment and group policy, only as getLocalInfo states them.
export function webticPolicy(info) {
  const local = info?.DS?.Local;
  if (!local) return { reserve: 'not stated', group: 'not stated', quotes: [], source: null };
  const i = local.Infos || {};
  const texts = [i.Booking, i.Purchases, i.Welcome, i.InfoLocal, i.Cards, i.ThankYouPage].filter(Boolean);
  const st = policyStatements(texts);
  return { ...st, source: st.reserve !== 'not stated' || st.group !== 'not stated' ? 'webtic getLocalInfo Infos' : null };
}

// Deep per-showing links: the WebTic SPA addresses a venue by localId in the hash. A
// performance-scoped hash is not stated anywhere on the public page, so it is opt-in:
// set WEBTIC_PERF_URL to a template using {localId}, {eventId} and {performanceId}
// once one is confirmed, and every showing gets its own link. Until then the venue
// booking_url is kept, which is what the site itself gives a visitor.
const PERF_TEMPLATE = process.env.WEBTIC_PERF_URL || null;
export function webticBooking(localId) {
  return {
    venue: `https://www.webtic.it/#/shopping?action=loadLocal&localId=${localId}`,
    perfTemplate: PERF_TEMPLATE,
    reason: PERF_TEMPLATE ? null
      : 'no public per-performance URL: the WebTic SPA addresses venues by localId only',
  };
}

export function webticToShowings(scheduling, localId, prices) {
  const byPerformance = new Map(prices?.byPerformance || []);
  const byEvent = new Map(prices?.byEvent || []);
  const local = prices?.local || [];
  const out = [];
  for (const e of scheduling.Events || []) {
    const props = e.Properties || [];
    const lang = props.some(x => /^(O\.?V\.?|VO|ENG?)$/i.test(x)) || /^\(?O\.?V\.?\)?/i.test(e.Title) ? (props.some(x => /SUB-?IT/i.test(x)) ? 'vos' : 'vo') : 'ita';
    const fmt = props.find(x => /^(2D|3D|IMAX)$/i.test(x))?.toUpperCase() || (e.Is3D ? '3D' : null);
    const [h, m] = (e.Duration || '00:00').split(':').map(Number);
    for (const d of e.Days || []) for (const pf of d.Performances || []) {
      const rates = byPerformance.get(pf.PerformanceId) || byEvent.get(e.EventId) || local;
      const booking_url = PERF_TEMPLATE
        ? PERF_TEMPLATE.replace('{localId}', localId).replace('{eventId}', e.EventId).replace('{performanceId}', pf.PerformanceId)
        : null; // run.mjs falls back to the cinema booking_url
      out.push({ title: e.Title.replace(/^\((O\.?V\.?)\)\s*/i, ''), original_title: e.OriginalTitle || null, year: e.Year || null,
        runtime_min: h * 60 + m || pf.Duration || null, date: pf.StartTime.slice(0, 10), time: pf.Time, language: lang,
        format: fmt, price_eur: null, rates, booking_url, event_id: e.EventId, perf_id: pf.PerformanceId,
        screen: pf.Screen || null, tags: props });
    }
  }
  return out;
}
