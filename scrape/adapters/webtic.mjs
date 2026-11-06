// WebTic family adapter (Crea Informatica). Drives the real WebTic page in a browser and
// captures the page's own getFullScheduling / getLocalInfo responses.
//
// Prices: the public page is sniffed for any JSON response that states tariffs
// (getLocalPrices / getTariffe / getPriceList / getEventPrices / getPerformancePrices
// and anything else the page itself asks for). Only what the page loads on its own is
// read: no login, no seat selection, no checkout step is ever reached.
import { ratesFromJson, scopedRowRates, policyStatements, cleanRates, ratesFromText, decodeHtml } from '../lib/prices.mjs';

// Response names worth keeping in full; everything else is kept only when it mentions money.
const WANTED = /(getFullScheduling|getLocalInfo|getLocalPrices|getPrices?|getTariff\w*|getPriceList|getTariffs?|getEventPrices|getPerformancePrices|getTickets?|getRates)/i;
const MONEY_HINT = /(price|tariff|prezzo|importo|amount|rate\b)/i;

// opts.tariffUrls: public tariff page(s) of the venue's own site (ucicinemas.it, cinenauta.it,
// orfeomultisala.com, ...). WebTic itself states no price, so this is where a stated price for a
// WebTic venue can come from. Optional: set it per cinema in scrape/cinemas.json as
// source.tariffUrl (string or array) - that file belongs to another chunk.
export async function scrapeWebtic(browser, localId, opts = {}) {
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
  const tariffPages = await fetchTariffPages(p, opts.tariffUrls);
  await ctx.close();
  if (!got.getFullScheduling?.DS) throw new Error('webtic: no scheduling payload for local ' + localId);
  const prices = collectPrices(got, others, localId);
  mergeTariffPages(prices, tariffPages);
  return {
    scheduling: got.getFullScheduling.DS.Scheduling,
    info: got.getLocalInfo,
    captured: Object.keys(got).concat(others.map(o => o.url.slice(0, 80))).concat(tariffPages.map(t => t.url)),
    prices,
    policy: webticPolicy(got.getLocalInfo, tariffPages),
    booking: webticBooking(localId),
    tariffPages,
  };
}

// Fetches public tariff pages via Playwright's HTTP client (avoiding cross-origin CORS blocks
// when the page itself is on webtic.it) and parses HTML tables + text. Failures are recorded,
// never thrown: a venue without a reachable tariff page still has a schedule, just null price.
export async function fetchTariffPages(page, urls) {
  const list = (Array.isArray(urls) ? urls : urls ? [urls] : []).filter(u => /^https?:\/\//i.test(String(u)));
  const out = [];
  for (const url of list) {
    try {
      let res;
      if (page && page.request && typeof page.request.get === 'function') {
        const r = await page.request.get(url, { headers: { Accept: 'text/html' }, timeout: 25000 });
        res = { status: r.status(), text: r.ok() ? await r.text() : null };
      } else {
        res = await page.evaluate(async u => {
          const r = await fetch(u, { headers: { Accept: 'text/html' } });
          return { status: r.status, text: r.ok ? await r.text() : null };
        }, url);
      }
      if (!res.text) { out.push({ url, status: res.status, rates: [], reason: `HTTP ${res.status}` }); continue; }
      const parsed = await page.evaluate(t => {
        const d = document.implementation.createHTMLDocument('t');
        d.body.innerHTML = t;
        d.querySelectorAll('script, style, noscript, nav, footer').forEach(el => el.remove());
        return { html: d.body.innerHTML || '', text: d.body.innerText || d.body.textContent || '' };
      }, res.text);
      const rates = ratesFromText(parsed.html || parsed.text, url);
      out.push({ url, status: res.status, rates, text: parsed.text || decodeHtml(res.text), reason: rates.length ? null : 'page states no euro amount' });
    } catch (e) {
      out.push({ url, status: null, rates: [], reason: String(e.message || e).split('\n')[0] });
    }
  }
  return out;
}

// Tariff-page rates are venue-wide: they join the local rate set and become the stated source.
export function mergeTariffPages(prices, pages) {
  const stated = (pages || []).filter(pg => pg.rates && pg.rates.length);
  if (!stated.length) {
    if ((pages || []).length && prices.reason) {
      prices.reason += ` Venue tariff page(s) tried: ${pages.map(pg => `${pg.url} (${pg.reason})`).join(', ')}.`;
    }
    return prices;
  }
  for (const pg of stated) {
    prices.local.push(...cleanRates(pg.rates));
    prices.sources.push(pg.url);
  }
  prices.rates = prices.local.length ? prices.local : prices.rates;
  prices.reason = null;
  prices.tariffUrls = stated.map(pg => pg.url);
  return prices;
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
export function webticPolicy(info, tariffPages) {
  const local = info?.DS?.Local;
  if (!local) {
    const texts = (tariffPages || []).map(pg => pg.text).filter(Boolean);
    const st = texts.length ? policyStatements(texts) : { reserve: 'not stated', group: 'not stated', quotes: [] };
    return { ...st, source: st.reserve !== 'not stated' || st.group !== 'not stated' ? (tariffPages || []).find(pg => pg.text)?.url || null : null };
  }
  const i = local.Infos || {};
  const texts = [i.Booking, i.Purchases, i.Welcome, i.InfoLocal, i.Cards, i.ThankYouPage].filter(Boolean);
  const st = policyStatements(texts);
  // The venue's own text wins. The platform flags are only a tie-breaker, and only as a flag -
  // never as a price or a deadline. Generic WebTic wording ("per ogni biglietto prenotato e/o
  // acquistato ... 1,80 \u20ac") describes online purchase too, so on its own it is not evidence
  // that this venue lets you reserve without paying: when the venue filed no booking text of its
  // own and WebTic reports booking disabled, the answer is no.
  const hasVenueBookingText = Boolean((i.Booking || '').trim());
  const bookingEnabled = local.BookingConfig && local.BookingConfig.Enabled;
  const purchaseEnabled = local.PurchaseConfig && local.PurchaseConfig.Enabled;
  if (bookingEnabled === false && (!hasVenueBookingText || st.reserve === 'not stated') && purchaseEnabled === true) {
    st.reserve = 'no \u2014 WebTic reports booking disabled and purchase enabled for this venue' +
      (st.reserve === 'not stated' ? '' : ' (the site only states the generic online-purchase fee)');
    st.source = 'webtic getLocalInfo BookingConfig/PurchaseConfig';
  }
  if ((st.reserve === 'not stated' || st.group === 'not stated') && (tariffPages || []).length) {
    const pg = tariffPages.find(x => x.text);
    if (pg) {
      const extra = policyStatements([pg.text]);
      if (st.reserve === 'not stated' && extra.reserve !== 'not stated') { st.reserve = extra.reserve; st.source = pg.url; }
      if (st.group === 'not stated' && extra.group !== 'not stated') { st.group = extra.group; st.source = st.source || pg.url; }
    }
  }
  return { ...st, source: st.source || (st.reserve !== 'not stated' || st.group !== 'not stated' ? 'webtic getLocalInfo Infos' : null) };
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
    const rawTitle = String(e.Title || '');
    const titleVo = /\b(?:O\.?\s*V\.?|V\.?\s*O\.?|Lingua\s+Or(?:ig(?:inale)?|ginale)\.?)\b/i.test(rawTitle)
      || /^\s*\((?:JP|Ch|Kor|Xl-Kor)\)/i.test(rawTitle);
    const hasVoProp = props.some(x => /^(O\.?V\.?|VO|ENG?)$/i.test(x));
    const hasSubProp = props.some(x => /SUB-?IT/i.test(x)) || /\b(?:sott|sub)\b/i.test(rawTitle) || /Lingua\s+Or/i.test(rawTitle) || /^\s*\((?:JP|Ch)\)/i.test(rawTitle);
    const lang = (hasVoProp || titleVo) ? (hasSubProp ? 'vos' : 'vo') : 'ita';
    const fmt = props.find(x => /^(2D|3D|IMAX)$/i.test(x))?.toUpperCase()
      || (e.Is3D ? '3D' : (/^\s*Atmos\s*[-–]/i.test(rawTitle) ? 'DOLBY' : null));
    const [h, m] = (e.Duration || '00:00').split(':').map(Number);
    const cleanedTitle = rawTitle
      .replace(/^\s*\((?:O\.?\s*V\.?|V\.?\s*O\.?|Lingua\s+Or\w*\.?|Sala\s+XL|XL(?:-Kor)?|JP|Ch|Kor)\)\s*/i, '')
      .replace(/^\s*(?:Atmos|V\.?\s*M\.?\s*\d+)\s*[-–:]\s*/i, '')
      .replace(/\s*\((?:O\.?\s*V\.?|V\.?\s*O\.?)\)\s*$/i, '')
      .trim();
    for (const d of e.Days || []) for (const pf of d.Performances || []) {
      const rates = byPerformance.get(pf.PerformanceId) || byEvent.get(e.EventId) || local;
      const booking_url = PERF_TEMPLATE
        ? PERF_TEMPLATE.replace('{localId}', localId).replace('{eventId}', e.EventId).replace('{performanceId}', pf.PerformanceId)
        : null; // run.mjs falls back to the cinema booking_url
      out.push({ title: cleanedTitle || rawTitle, original_title: e.OriginalTitle || null, year: e.Year || null,
        runtime_min: h * 60 + m || pf.Duration || null, date: pf.StartTime.slice(0, 10), time: pf.Time, language: lang,
        format: fmt, price_eur: null, rates, booking_url, event_id: e.EventId, perf_id: pf.PerformanceId,
        screen: pf.Screen || null, tags: props });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Direct API replay (no browser). The WebTic front end (secure.webtic.it/angwt) calls one
// JSON service, POST https://secure.webtic.it/api/wtjsonservices.ashx?wtid=<name>&...  with an
// empty body and no credentials:
//   getFullScheduling      localid, trackid                          -> every performance of a venue
//   getPurchaseTicketsInfo localid, trackid, eventid, performanceid  -> price list per sector for
//                                                                       ONE performance (what the
//                                                                       page loads when a showing
//                                                                       is opened, before any seat
//                                                                       is picked or held)
// Nothing here creates a cart, a hold or an order.
import { normalizeTitle } from '../lib/normalize.mjs';

export const WEBTIC_API = 'https://secure.webtic.it/api/wtjsonservices.ashx';
export const WEBTIC_TRACK_ID = 33; // the portal's own trackid (kid=33 in its URL)
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export function webticRequest(wtid, params, localId) {
  const q = new URLSearchParams({ ...params, localid: String(localId), trackid: String(WEBTIC_TRACK_ID), wtid });
  return {
    url: `${WEBTIC_API}?${q}`,
    init: {
      method: 'POST',
      body: '', // the page POSTs an empty body; without it the server answers 411
      headers: {
        'User-Agent': UA,
        Accept: 'application/json, text/plain, */*',
        Referer: `https://secure.webtic.it/angwt/webtic.aspx?lid=${localId}&kid=${WEBTIC_TRACK_ID}`,
      },
    },
  };
}

// Result: { status, json, blocked, reason }. blocked=true on 429/403/5xx/captcha/HTML answers: the
// caller must stop hitting the host.
export async function webticCall(wtid, params, localId, fetchImpl = fetch) {
  const { url, init } = webticRequest(wtid, params, localId);
  let res;
  try { res = await fetchImpl(url, init); } catch (e) { return { status: null, json: null, blocked: true, reason: 'network: ' + String(e.message || e).split('\n')[0] }; }
  const status = res.status;
  if (status === 429 || status === 403 || status >= 500) return { status, json: null, blocked: true, reason: `HTTP ${status}` };
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* handled below */ }
  if (!json || !json.userdata) {
    const captcha = /captcha|access denied|forbidden|cloudflare/i.test(text);
    return { status, json: null, blocked: true, reason: captcha ? 'captcha/bot check' : `HTTP ${status} non-JSON answer` };
  }
  if (json.userdata.StatusOk === false && /captcha|recaptcha/i.test(String(json.userdata.Message || ''))) {
    return { status, json, blocked: true, reason: 'captcha required: ' + json.userdata.Message };
  }
  return { status, json, blocked: false, reason: null };
}

// Pure: the full-price (Intero) ticket stated by a getPurchaseTicketsInfo answer.
//   Only price rows open to anyone are read: PriceOrigin '****' (no card/skin/combo) whose
//   PriceTypeDescription is INTERNET INTERO. The WebTic page itself prints TotalPrice
//   (NetPrice + ExtraPrice, its template comments the split out), so field 'total' is the
//   default price_eur; 'net' gives the ticket without WebTic's per-ticket online fee. Both
//   amounts are always kept (net_eur / fee_eur).
//   Sectors can price the same Intero differently (UCI: CLAS / PLUS / VIP). policy 'min' takes
//   the cheapest stated sector and lists the rest in `sectors`; 'null' returns null when they differ.
export function parseIntero(json, policy = 'min', field = 'total') {
  const sectors = json?.DS?.Performance?.Tickets?.Sectors;
  if (!Array.isArray(sectors)) return { eur: null, reason: json?.userdata?.Message || 'no Tickets.Sectors in the answer', sectors: [] };
  const rows = [];
  for (const sec of sectors) {
    for (const p of sec.PriceList || []) {
      if (p.PriceOrigin !== '****') continue;
      if (!/INTERNET\s+INTERO/i.test(String(p.PriceTypeDescription || ''))) continue;
      const net = Number(p.NetPrice);
      if (!isFinite(net) || net <= 0) continue;
      const fee = isFinite(Number(p.ExtraPrice)) ? round2(Number(p.ExtraPrice)) : 0;
      const total = isFinite(Number(p.TotalPrice)) && Number(p.TotalPrice) > 0 ? round2(Number(p.TotalPrice)) : round2(net + fee);
      rows.push({ sector: sec.SectorId || sec.SectorName || null, sector_name: p.SectorName || sec.SectorName || null, label: String(p.PriceDescription || '').trim(), eur: field === 'net' ? round2(net) : total, net_eur: round2(net), fee_eur: fee });
    }
  }
  if (!rows.length) return { eur: null, reason: 'answer lists no public Intero row (PriceOrigin ****, INTERNET INTERO)', sectors: [] };
  const amounts = [...new Set(rows.map(r => r.eur))].sort((a, b) => a - b);
  if (amounts.length > 1 && policy === 'null') return { eur: null, reason: `Intero differs by sector (${amounts.join('/')})`, sectors: rows };
  const best = rows.find(r => r.eur === amounts[0]);
  return { eur: best.eur, net_eur: best.net_eur, fee_eur: best.fee_eur, label: best.label, sector: best.sector, multi_sector: amounts.length > 1, sectors: rows, reason: null };
}

function round2(v) { return Math.round(v * 100) / 100; }

// Performances of a getFullScheduling answer, shaped like the showings in data/showtimes.json
// (film_id from the same normalizeTitle the pipeline uses) plus event/performance ids.
export function schedulingPerformances(scheduling, localId) {
  return webticToShowings(scheduling, localId, null).map(x => ({
    film_id: normalizeTitle(String(x.title).trim()),
    date: x.date, time: x.time, language: x.language, format: x.format || null,
    event_id: x.event_id, perf_id: x.perf_id, screen: x.screen || null,
  }));
}
