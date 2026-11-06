import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ locale: 'it-IT' })).newPage();
await p.goto('https://www.spaziocinema.info/milano/cinema', { waitUntil: 'networkidle' });
const j = await p.evaluate(async () => (await fetch('/cinema/@@get-calendario?dt=2026-11-06&cinema=Anteo+palazzo+del+cinema')).json());
for (const f of j.slice(0, 19)) console.log(JSON.stringify({ t: f.title, y: f.year, len: f.length, lang: f.language, tech: f.technologies, tmdb: f.tmdb_id, notes: f.notes, o: (f.orari || []).slice(0, 2) }).slice(0, 420));
await b.close();
