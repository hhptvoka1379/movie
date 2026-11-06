import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ locale: 'it-IT' })).newPage();
await p.goto('https://www.spaziocinema.info/milano/cinema', { waitUntil: 'networkidle' });
for (const c of ['Citylife anteo', 'Ariosto', 'Ariosto Anteo spazioCinema', 'Anteo palazzo del cinema']) {
  for (const dt of ['2026-11-06', '2026-11-12', '2026-11-13']) {
    const r = await p.evaluate(async u => { const x = await fetch(u); return { s: x.status, t: await x.text() }; }, `/cinema/@@get-calendario?dt=${dt}&cinema=${encodeURIComponent(c).replace(/%20/g, '+')}`);
    let n = '?', keys = '';
    try { const j = JSON.parse(r.t); n = j.length; keys = Object.keys(j[0] || {}).join(','); } catch {}
    console.log(c, dt, r.s, 'films', n, keys);
  }
}
await b.close();
