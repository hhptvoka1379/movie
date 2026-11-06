// Anteo / spazioCinema adapter. Calls the site's own calendar endpoint from inside the page
// (same request the on-page calendar widget makes), once per cinema per day.
export function dateRange(from, to) {
  const o = [];
  for (let d = new Date(from + 'T12:00:00Z'); d <= new Date(to + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) o.push(d.toISOString().slice(0, 10));
  return o;
}

// cinemaParam: value the site's widget uses for ?cinema=
export async function scrapeAnteo(browser, { from, to, cinemaParam }) {
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
    return rows;
  } finally { await ctx.close(); }
}

const VO_PREFIX = /^\s*v\.?\s?o\.?\s*(sott\.?\s*ita\.?)?\s*[-–]?\s*/i;
export function anteoToShowings(rows) {
  return rows.map(({ film: f, o }) => {
    const vo = VO_PREFIX.test(f.title) || /- v\. ?o\.?$/i.test(f.title.trim()) || /LINGUA ORIGINALE/i.test(f.technologies || '') || (f.language && !/^italiano$/i.test(f.language));
    const title = f.title.replace(VO_PREFIX, '').replace(/\s*-\s*v\.?\s?o\.?\s*$/i, '').trim();
    const t = [...(o.technologies || []), f.technologies || ''].join(' ');
    return { title, original_title: null, year: f.year || null, runtime_min: f.length || null, tmdb_id: f.tmdb_id || null,
      date: o.date, time: o.hour, language: vo ? 'vos' : 'ita', format: /3D/.test(t) ? '3D' : null,
      price_eur: null, booking_url: o.projection_url || null, tags: [f.language, f.technologies].filter(Boolean), notes: f.notes?.trim() || null };
  });
}
