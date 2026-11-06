// WebTic family adapter (Crea Informatica). Drives the real WebTic page in a browser and
// captures the page's own getFullScheduling / getLocalInfo responses.
export async function scrapeWebtic(browser, localId) {
  const ctx = await browser.newContext({ locale: 'it-IT' });
  const p = await ctx.newPage();
  const got = {};
  p.on('response', async r => {
    const m = r.url().match(/wtid=(getFullScheduling|getLocalInfo)/);
    if (m) { try { got[m[1]] = JSON.parse(await r.text()); } catch {} }
  });
  await p.goto(`https://www.webtic.it/#/shopping?action=loadLocal&localId=${localId}`, { waitUntil: 'networkidle', timeout: 60000 });
  for (let i = 0; i < 10 && !got.getFullScheduling; i++) await p.waitForTimeout(1000);
  await ctx.close();
  if (!got.getFullScheduling?.DS) throw new Error('webtic: no scheduling payload for local ' + localId);
  return { scheduling: got.getFullScheduling.DS.Scheduling, info: got.getLocalInfo };
}
export function webticToShowings(scheduling, localId) {
  const out = [];
  for (const e of scheduling.Events || []) {
    const props = e.Properties || [];
    const lang = props.some(x => /^(O\.?V\.?|VO|ENG?)$/i.test(x)) || /^\(?O\.?V\.?\)?/i.test(e.Title) ? (props.some(x => /SUB-?IT/i.test(x)) ? 'vos' : 'vo') : 'ita';
    const fmt = props.find(x => /^(2D|3D|IMAX)$/i.test(x))?.toUpperCase() || (e.Is3D ? '3D' : null);
    const [h, m] = (e.Duration || '00:00').split(':').map(Number);
    for (const d of e.Days || []) for (const pf of d.Performances || []) {
      out.push({ title: e.Title.replace(/^\((O\.?V\.?)\)\s*/i, ''), original_title: e.OriginalTitle || null, year: e.Year || null,
        runtime_min: h * 60 + m || pf.Duration || null, date: pf.StartTime.slice(0, 10), time: pf.Time, language: lang,
        format: fmt, price_eur: null, booking_url: null, event_id: e.EventId, perf_id: pf.PerformanceId, tags: props });
    }
  }
  return out;
}
