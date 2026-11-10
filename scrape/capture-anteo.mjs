// Save the spazioCinema (Anteo) calendar JSON per venue per day into scrape/raw/<date>/<venue>/, the same files
// merge-anteo.mjs reads. Uses the site's public calendar endpoint (plain GET, no login). Days that return an empty
// list are not written, so earlier captures are never overwritten by an empty past day. The default start is
// tomorrow: today's list only holds the shows still to come and would replace a fuller morning capture.
//   node scrape/capture-anteo.mjs [--raw 2026-11-10] [--from 2026-11-10] [--to 2026-11-15]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const a = process.argv.slice(2), opt = (k, d) => (a.indexOf(k) >= 0 ? a[a.indexOf(k) + 1] : d);
const RAW = path.join(HERE, 'raw', opt('--raw', '2026-11-10'));
const FROM = opt('--from', new Date(Date.now() + 864e5).toISOString().slice(0, 10)), TO = opt('--to', '2026-11-15');
const VENUES = { 'anteo-palazzo': 'Anteo+palazzo+del+cinema', 'citylife-anteo': 'Citylife+anteo', 'ariosto-anteo': 'Ariosto' };
const days = []; for (let d = new Date(FROM + 'T12:00:00Z'); d <= new Date(TO + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
for (const [id, param] of Object.entries(VENUES)) {
  let wrote = 0, total = 0;
  for (const day of days) {
    const res = await fetch(`https://www.spaziocinema.info/cinema/@@get-calendario?dt=${day}&cinema=${param}`, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) { console.error(`${id} ${day}: HTTP ${res.status}`); process.exitCode = 1; continue; }
    const films = await res.json();
    const n = films.reduce((s, f) => s + (f.orari || []).length, 0);
    if (!Array.isArray(films) || !n) continue;
    fs.mkdirSync(path.join(RAW, id), { recursive: true });
    fs.writeFileSync(path.join(RAW, id, `spaziocinema.info_get-calendario__schedule__${day}.json`), JSON.stringify(films));
    wrote++; total += n;
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`${id}: wrote ${wrote} day(s), ${total} showings`);
}
