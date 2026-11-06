// MyMovies.it cinema-page adapter (aggregator fallback for small independents)
// plus re-exports of official venue adapters (progettolumiere, cinebazin).
//
// Findings about https://www.mymovies.it/cinema/milano/<id>/ :
// - The page publishes only the cinema's schedule for the current day ("OGGI AL CINEMA").
//   Query strings (?data=, ?giorno=, ?day=, ?offset=, ...) and paths (/domani/, /settimana/, ...)
//   are ignored or 404, and no day selector exists in the DOM or scripts. So the adapter emits
//   showings only for the site's current day (Europe/Rome) and only when that day lies in [from,to].
// - When a listed venue has no screenings today (e.g. parish hall Cinema Osoppo id=6637 on dark days),
//   MyMovies renders "Non sono presenti film in programmazione." without an "OGGI AL CINEMA" block;
//   we return [] so run.mjs records status="no_schedule" cleanly rather than an unexpected error.
// - Film blocks: `.schedine-titolo a` (title), `.schedine-lancio` (genre, country, year, "Durata N Minuti"),
//   and `.orari-dettaglio` holding the showtimes (HH:MM). VO is labelled inside the block, e.g.
//   "Versione originale con sottotitoli:".
import { scrapeProgettoLumiere } from './progettolumiere.mjs';
import { scrapeCinebazin } from './cinebazin.mjs';

export { scrapeProgettoLumiere, scrapeCinebazin };

const SITE = 'https://www.mymovies.it/cinema/milano/';

function romeToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function languageOf(text) {
  if (/versione\s+originale|\bV\.\s?O\.?(?=\W|$)/i.test(text)) {
    return /sottotit|sott\.|subtit/i.test(text) ? 'vos' : 'vo';
  }
  return 'ita';
}

async function dismissConsent(page) {
  // Decline non-essential consent if a banner is shown; ignore if absent.
  const btn = page.locator('button, a').filter({ hasText: /^(rifiuta( tutto)?|continua senza accettare|reject all)$/i }).first();
  try {
    if (await btn.isVisible({ timeout: 1500 })) await btn.click({ timeout: 2000 });
  } catch { /* no banner */ }
}

export async function scrapeMymovies(browser, { id, url: overrideUrl, from, to }) {
  if (!id && !overrideUrl) throw new Error('mymovies: missing cinema id');
  const ctx = await browser.newContext({ locale: 'it-IT', timezoneId: 'Europe/Rome' });
  try {
    const page = await ctx.newPage();
    const url = overrideUrl || `${SITE}${id}/`;
    const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    const status = resp ? resp.status() : 0;
    if (status === 401 || status === 403 || status === 429 || status === 503) {
      throw new Error(`BLOCKED: mymovies ${url} returned HTTP ${status}`);
    }
    await dismissConsent(page);

    const bodyText = await page.innerText('body').catch(() => '');
    if (/captcha|cloudflare|verify you are human|access denied|accesso negato|verifica di sicurezza/i.test(bodyText) && !/OGGI AL CINEMA|Non sono presenti film in programmazione/i.test(bodyText)) {
      throw new Error(`BLOCKED: mymovies ${url} shows a bot/access check`);
    }
    if (status === 404 || /La pagina cercata non esiste/i.test(bodyText)) {
      throw new Error(`mymovies: cinema page ${url} not found (HTTP ${status})`);
    }

    // Valid venue page with zero scheduled screenings today (e.g. parish hall dark day).
    if (/Non sono presenti film in programmazione/i.test(bodyText)) {
      return [];
    }

    // Walk titles and schedule blocks in DOM order; each schedule block belongs to the last title seen.
    const blocks = await page.evaluate(() => {
      const nodes = document.querySelectorAll('.schedine-titolo, .orari-dettaglio');
      const out = [];
      let current = null;
      for (const n of nodes) {
        if (n.classList.contains('schedine-titolo')) {
          const a = n.querySelector('a');
          current = {
            title: (a?.getAttribute('title') || a?.innerText || n.innerText || '').replace(/\s+/g, ' ').trim(),
            lancio: '',
          };
          const lancio = n.parentElement?.querySelector('.schedine-lancio');
          if (lancio) current.lancio = lancio.innerText.replace(/\s+/g, ' ').trim();
        } else if (current) {
          out.push({ ...current, sched: n.innerText.replace(/\s+/g, ' ').trim() });
        }
      }
      return { films: document.querySelectorAll('.schedine-titolo').length, blocks: out, hasHeading: /OGGI AL CINEMA/i.test(document.body.innerText) };
    });

    if (!blocks.hasHeading && blocks.films === 0) {
      throw new Error(`mymovies: page structure not recognised for cinema ${id} (no "OGGI AL CINEMA" section or film blocks)`);
    }
    if (blocks.films > 0 && blocks.blocks.length === 0 && /\b\d{1,2}:\d{2}\b/.test(bodyText)) {
      throw new Error(`mymovies: showtimes present for cinema ${id} but not in the expected .orari-dettaglio blocks`);
    }

    const today = romeToday();
    const inRange = today >= from && today <= to;
    if (!inRange) {
      throw new Error(`mymovies: cinema ${id} page only publishes the current day (${today}), outside requested range ${from}..${to}`);
    }

    const out = [];
    const seen = new Set();
    for (const b of blocks.blocks) {
      const times = [...b.sched.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g)].map(m => m[1].padStart(2, '0') + ':' + m[2]);
      if (!b.title || times.length === 0) continue;
      const year = (b.lancio.match(/\b(19|20)\d{2}\b/) || [])[0];
      const runtime = (b.lancio.match(/Durata\s+(\d{1,3})\s+minut/i) || [])[1];
      const language = languageOf(b.sched);
      for (const time of times) {
        const key = `${today}|${time}|${b.title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          title: b.title,
          original_title: null,
          year: year ? Number(year) : null,
          runtime_min: runtime ? Number(runtime) : null,
          date: today,
          time,
          language,
          format: null,
          price_eur: null,
          booking_url: null,
        });
      }
    }

    if (out.length === 0 && blocks.films > 0) {
      throw new Error(`mymovies: cinema ${id} lists ${blocks.films} film(s) but no showtimes were parsed`);
    }
    return out;
  } finally {
    await ctx.close();
  }
}
