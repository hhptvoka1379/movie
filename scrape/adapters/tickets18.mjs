// 18tickets family adapter (used by Cineteca Milano Arlecchino). Server-rendered film pages with a
// date strip; clicking a date reveals a.film-projection elements carrying date/time/title.
export async function scrapeTickets18(browser, { base, from, to }) {
  const ctx = await browser.newContext({ locale: 'it-IT' });
  const p = await ctx.newPage();
  p.setDefaultTimeout(8000);
  try {
    await p.goto(base, { waitUntil: 'networkidle', timeout: 60000 });
    const films = await p.$$eval('a[href*="/film/"]', a => [...new Map(a.map(x => [x.href.split(/[?#]/)[0], x.innerText.trim().replace(/\s+/g, ' ')]).filter(([h]) => /\/film\/\d+$/.test(h))).entries()].map(([href, text]) => ({ href, text })));
    if (!films.length) throw new Error('tickets18: no films listed at ' + base);
    const rows = [];
    const warnings = [];
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
        return { runtime: +(t.match(/Durata:\s*(\d+)/) || [])[1] || null, lang: (t.match(/Lingua:\s*([^\n]+)/) || [])[1] || null, year: (t.match(/Anno:\s*(\d{4})/) || [])[1] || null };
      });
      await p.waitForSelector('a.film-projection', { timeout: 6000 }).catch(() => {});
      const days = await p.$$eval('.m18-day-elem[data-target]', e => e.map(x => x.dataset.target));
      const collect = async () => {
        const perfs = await p.$$eval('a.film-projection', a => a.map(x => ({ ext: x.dataset.dateExtended, title: x.dataset.title, id: x.dataset.id })));
        for (const pf of perfs) {
          const m = (pf.ext || '').match(/(\d\d)\/(\d\d)\/(\d{4}) ore (\d\d:\d\d)/);
          if (!m) continue;
          const date = `${m[3]}-${m[2]}-${m[1]}`;
          if (date < from || date > to) continue;
          rows.push({ title: pf.title, date, time: m[4], runtime_min: info.runtime, lang: info.lang, year: info.year, booking_url: `${f.href}/${pf.id}#theater-init`, perf_id: pf.id });
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
    return rows;
  } finally { await ctx.close(); }
}
export function tickets18ToShowings(rows) {
  const seen = new Set();
  return rows.filter(r => { const k = r.perf_id; if (seen.has(k)) return false; seen.add(k); return true; }).map(r => {
    const vo = /\bV\.?\s?O\.?\b/i.test(r.title) || (r.lang && !/italiano/i.test(r.lang));
    return { title: r.title.replace(/\s*-?\s*\(?V\.?\s?O\.?\)?\s*$/i, '').replace(/\s*\(RIED\.?\)\s*$/i, '').trim(), original_title: null, year: r.year, runtime_min: r.runtime_min,
      date: r.date, time: r.time, language: vo ? 'vos' : 'ita', format: null, price_eur: null, booking_url: r.booking_url, tags: [r.lang] };
  });
}
