// Cinecircolo André Bazin official adapter (cinebazin.it/new/) for Auditorium Don Bosco.
// Reads screening weekday/time slots from "Orari Proiezioni" (id=3) and expands
// published weekly film articles ("da domenica DD a venerdì DD <mese> YYYY")
// across [from, to]. Unpublished future menu slots (id=21 "Avvisi") are skipped.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const BLOCK_RE = /captcha|cloudflare|attention required|verify you are human|enable javascript and cookies|just a moment|checking your browser|access denied|403 forbidden/i;

const MONTHS_IT = {
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6,
  luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
};

const WEEKDAYS_IT = [
  [/(?:^|[^a-zà-ú])domenica(?=$|[^a-zà-ú])/i, 0],
  [/(?:^|[^a-zà-ú])luned[iì](?=$|[^a-zà-ú])/i, 1],
  [/(?:^|[^a-zà-ú])marted[iì](?=$|[^a-zà-ú])/i, 2],
  [/(?:^|[^a-zà-ú])mercoled[iì](?=$|[^a-zà-ú])/i, 3],
  [/(?:^|[^a-zà-ú])gioved[iì](?=$|[^a-zà-ú])/i, 4],
  [/(?:^|[^a-zà-ú])venerd[iì](?=$|[^a-zà-ú])/i, 5],
  [/(?:^|[^a-zà-ú])sabato(?=$|[^a-zà-ú])/i, 6],
];

const DEFAULT_SLOTS = new Map([
  [0, ['16:00']],
  [1, ['21:00']],
  [3, ['21:00']],
  [5, ['21:00']],
]);

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toISO(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function addDaysISO(iso, delta) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

function weekdayUTC(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function cleanTitle(raw) {
  return String(raw || '')
    .replace(/[\u2018\u2019`]/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function toDisplayCase(raw) {
  const t = cleanTitle(raw);
  if (!t) return t;
  const letters = t.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, '');
  if (letters && letters === letters.toUpperCase()) {
    return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
  }
  return t;
}

function detectBlock(resp, bodySample, hasLoginOnly) {
  const st = resp ? resp.status() : 0;
  if (st === 401 || st === 403 || st === 429) {
    return `HTTP ${st} block/auth response`;
  }
  const hit = String(bodySample || '').slice(0, 4000).match(BLOCK_RE);
  if (hit) return `bot/challenge detected: "${hit[0]}"`;
  if (hasLoginOnly) return 'login form required';
  return null;
}

export function parseCinebazinHours(text) {
  const slots = new Map();
  const norm = String(text || '').replace(/\u00a0/g, ' ');
  // Match clauses such as "Domenica ore 16.00" or "lunedì, mercoledì e venerdì Ore 21"
  const clauseRe = /((?:(?:domenica|luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato)[\s,e]*)+)\s*ore\s*(\d{1,2})(?:[.:](\d{2}))?/gi;
  for (const m of norm.matchAll(clauseRe)) {
    const daysChunk = m[1];
    const hh = Number(m[2]);
    const mm = m[3] ? Number(m[3]) : 0;
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) continue;
    const hhmm = `${pad2(hh)}:${pad2(mm)}`;
    for (const [re, wd] of WEEKDAYS_IT) {
      if (re.test(daysChunk)) {
        if (!slots.has(wd)) slots.set(wd, []);
        if (!slots.get(wd).includes(hhmm)) slots.get(wd).push(hhmm);
      }
    }
  }
  return slots.size ? slots : new Map([...DEFAULT_SLOTS.entries()].map(([k, v]) => [k, [...v]]));
}

export function parseCinebazinDateRange(text) {
  const norm = String(text || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
  const m = norm.match(
    /da\s+(?:domenica|luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato)\s+(\d{1,2})(?:\s+([a-zà-ú]+))?(?:\s+(\d{4}))?\s+a\s+(?:domenica|luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato)\s+(\d{1,2})\s+([a-zà-ú]+)\s+(\d{4})\b/i
  );
  if (!m) return null;
  const startDay = Number(m[1]);
  const startMonRaw = m[2] ? MONTHS_IT[m[2].toLowerCase()] : null;
  const startYearRaw = m[3] ? Number(m[3]) : null;
  const endDay = Number(m[4]);
  const endMon = MONTHS_IT[m[5].toLowerCase()];
  const endYear = Number(m[6]);
  if (!endMon) return null;

  let startMon = startMonRaw || endMon;
  let startYear = startYearRaw || endYear;
  if (!startMonRaw && startDay > endDay) {
    startMon = endMon === 1 ? 12 : endMon - 1;
    if (endMon === 1 && !startYearRaw) startYear = endYear - 1;
  }

  const start = toISO(startYear, startMon, startDay);
  const end = toISO(endYear, endMon, endDay);
  if (!start || !end || start > end) return null;
  return { start, end };
}

function parseRuntimeFromReviewText(text) {
  const norm = String(text || '').replace(/\s+/g, ' ');
  const minM = norm.match(/durata\s*:?\s*(\d{2,3})\s*(?:min|')/i) || norm.match(/\b(\d{2,3})\s+minuti\b/i);
  if (minM) {
    const n = Number(minM[1]);
    if (n >= 45 && n <= 300) return n;
  }
  const wordHours = { una: 1, un: 1, "un'": 1, due: 2, tre: 3 };
  const hm = norm.match(/\b(un'?|una|due|tre|\d)\s+or[ae]\s+e\s+(\d{1,2})\s+minuti\b/i);
  if (hm) {
    const h = wordHours[hm[1].toLowerCase()] ?? Number(hm[1]);
    const mins = Number(hm[2]);
    if (Number.isFinite(h) && Number.isFinite(mins)) return h * 60 + mins;
  }
  return null;
}

async function extractArticlesOnPage(page) {
  return page.evaluate(() => {
    const bodyText = document.body?.innerText || document.body?.textContent || '';
    const hasPw = Boolean(document.querySelector('input[type="password"]'));

    const items = [];

    // Strategy 1: Category blog items / multi-article containers starting at h5/h2 article links.
    const headingLinks = [...document.querySelectorAll('h5 a[href*="view=article"], h2 a[href*="view=article"]')];
    if (headingLinks.length) {
      for (let i = 0; i < headingLinks.length; i++) {
        const a = headingLinks[i];
        const href = new URL(a.getAttribute('href'), location.href).href;
        if (/[?&]id=21(?::|&|$)/.test(href)) continue; // placeholder "Avvisi"
        const headingTitle = (a.textContent || '').replace(/\s+/g, ' ').trim();

        // Walk up to the article/item wrapper that does not swallow sibling headingLinks.
        let box = a.closest('article, .item, .leading-0, .blog-featured, .item-page');
        if (!box || box.querySelectorAll('h5 a[href*="view=article"], h2 a[href*="view=article"]').length > 1) {
          // Collect sibling DOM text between this heading and the next headingLink.
          const nextHeading = headingLinks[i + 1]?.closest('h5, h2') || null;
          const startHeading = a.closest('h5, h2');
          let chunk = '';
          let cur = startHeading;
          while (cur && cur !== nextHeading) {
            chunk += '\n' + (cur.innerText || cur.textContent || '');
            cur = cur.nextElementSibling;
          }
          items.push({ title: headingTitle, url: href, text: chunk });
        } else {
          items.push({ title: headingTitle, url: href, text: box.innerText || box.textContent || '' });
        }
      }
    }

    // Strategy 2: Single-article / homepage featured film block ("da domenica ... a venerdì ...").
    const mainArea = document.querySelector('.item-page, #ja-content, #content, main') || document.body;
    if (mainArea && !/[?&]id=21(?::|&|$)/.test(location.href)) {
      const mText = mainArea.innerText || mainArea.textContent || '';
      if (/da\s+(?:domenica|luned[iì])/i.test(mText) && !items.length) {
        // Look for film H1 other than site logo banner.
        let filmH1 = '';
        for (const h1 of mainArea.querySelectorAll('h1')) {
          const t = (h1.textContent || '').replace(/\s+/g, ' ').trim();
          if (t && !/^titolo$/i.test(t)) {
            filmH1 = t;
            break;
          }
        }
        items.push({ title: filmH1, url: location.href, text: mText });
      }
    }

    // Also collect published "FILM IN PROGRAMMA" menu links (skipping id=21 placeholder & non-film pages).
    const menuArticleUrls = [];
    for (const a of document.querySelectorAll('a[href*="view=article"]')) {
      try {
        const u = new URL(a.getAttribute('href'), location.href);
        u.hash = '';
        const h = u.href;
        if (/[?&]id=(?:1|2|3|6|21|108)(?::|&|$)/.test(h)) continue;
        if (/[?&]catid=8\b/.test(h) || /[?&]Itemid=(?:10[789]|11[789]|12\d|16\d)\b/.test(h)) {
          if (!menuArticleUrls.includes(h)) menuArticleUrls.push(h);
        }
      } catch {}
    }

    return {
      bodySample: bodyText.slice(0, 4000),
      hasLoginOnly: hasPw && !items.length && !/\bda\s+domenica\b/i.test(bodyText),
      items,
      menuArticleUrls,
    };
  });
}

export async function scrapeCinebazin(browser, { url = 'https://www.cinebazin.it/new/', from, to }) {
  const baseUrl = url.endsWith('/') ? url : `${url}/`;
  const hoursUrl = new URL('index.php?option=com_content&view=article&id=3&Itemid=116', baseUrl).href;
  const categoryUrl = new URL('index.php?option=com_content&view=category&id=8&Itemid=132', baseUrl).href;

  const ctx = await browser.newContext({
    userAgent: UA,
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
  });

  try {
    const page = await ctx.newPage();

    // 1. Load homepage first and check for bot/challenge block.
    const homeResp = await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const homeStatus = homeResp ? homeResp.status() : 0;
    if (homeStatus === 401 || homeStatus === 403 || homeStatus === 429) {
      throw new Error(`BLOCKED: cinebazin ${baseUrl} returned HTTP ${homeStatus}`);
    }
    if (homeStatus >= 500 || homeStatus === 404) {
      throw new Error(`cinebazin: ${baseUrl} returned HTTP ${homeStatus}`);
    }

    const homeExtracted = await extractArticlesOnPage(page);
    const blockReason = detectBlock(homeResp, homeExtracted.bodySample, homeExtracted.hasLoginOnly);
    if (blockReason) {
      throw new Error(`BLOCKED: cinebazin ${baseUrl} (${blockReason})`);
    }

    // 2. Load "Orari Proiezioni" page to get official weekday/time slots.
    let weekdaySlots = DEFAULT_SLOTS;
    try {
      const hResp = await page.goto(hoursUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      if (hResp && hResp.ok()) {
        const hText = await page.evaluate(() => {
          const main = document.querySelector('.item-page, #content, main') || document.body;
          return main?.innerText || main?.textContent || '';
        });
        weekdaySlots = parseCinebazinHours(hText);
      }
    } catch {}

    // 3. Collect dated film articles from homepage, category blog (id=8), and any newly published menu links.
    const collectedArticles = [...homeExtracted.items];
    const visitedUrls = new Set([baseUrl]);

    try {
      const catResp = await page.goto(categoryUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      visitedUrls.add(categoryUrl);
      if (catResp && catResp.ok()) {
        const catExtracted = await extractArticlesOnPage(page);
        collectedArticles.push(...catExtracted.items);
        for (const mu of catExtracted.menuArticleUrls) {
          if (!homeExtracted.menuArticleUrls.includes(mu)) homeExtracted.menuArticleUrls.push(mu);
        }
      }
    } catch {}

    const knownUrls = new Set(collectedArticles.map((x) => {
      try { const u = new URL(x.url); u.hash = ''; return u.href; } catch { return x.url; }
    }));
    const knownIds = new Set(
      [...knownUrls]
        .map((u) => u.match(/[?&]id=(\d+)/)?.[1])
        .filter(Boolean)
    );

    for (const artUrl of homeExtracted.menuArticleUrls) {
      const artId = artUrl.match(/[?&]id=(\d+)/)?.[1];
      if ((artId && knownIds.has(artId)) || visitedUrls.has(artUrl)) continue;
      visitedUrls.add(artUrl);
      try {
        const aResp = await page.goto(artUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        if (aResp && aResp.ok()) {
          const aExtracted = await extractArticlesOnPage(page);
          collectedArticles.push(...aExtracted.items);
          if (artId) knownIds.add(artId);
        }
      } catch {}
    }

    // 4. Expand overlapping date ranges across weekdaySlots within [from, to].
    const byKey = new Map();
    for (const art of collectedArticles) {
      const range = parseCinebazinDateRange(art.text);
      if (!range) continue;
      if (range.end < from || range.start > to) continue;

      const title = toDisplayCase(art.title);
      if (!title || /^avvisi$/i.test(title)) continue;

      const runtimeMin = parseRuntimeFromReviewText(art.text);
      const headerSlice = String(art.text || '').slice(0, 350);
      const language = /\b(?:versione\s+originale|v\.?\s*o\.?\s*s\.?|sottotitolat[oa])\b/i.test(headerSlice)
        ? 'vos'
        : 'ita';

      let cur = range.start < from ? from : range.start;
      const last = range.end > to ? to : range.end;
      let guard = 0;
      while (cur <= last && guard++ < 31) {
        const wd = weekdayUTC(cur);
        const times = weekdaySlots.get(wd) || [];
        for (const time of times) {
          const key = `${title.toLowerCase()}|${cur}|${time}`;
          const candidateUrl = art.url || baseUrl;
          const prev = byKey.get(key);
          if (!prev || (!prev.booking_url.includes('view=article') && candidateUrl.includes('view=article'))) {
            byKey.set(key, {
              title,
              original_title: null,
              year: null,
              runtime_min: runtimeMin ?? prev?.runtime_min ?? null,
              date: cur,
              time,
              language,
              format: null,
              price_eur: null,
              booking_url: candidateUrl,
            });
          }
        }
        cur = addDaysISO(cur, 1);
      }
    }

    const showings = [...byKey.values()].sort(
      (a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.title.localeCompare(b.title, 'it')
    );

    return showings;
  } finally {
    await ctx.close();
  }
}
