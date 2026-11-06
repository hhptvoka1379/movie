import { chromium } from 'playwright';
import { scrapeAnteo, anteoToShowings } from '../adapters/anteo.mjs';
const b = await chromium.launch();
for (const c of ['Citylife anteo', 'Ariosto']) {
  const s = anteoToShowings(await scrapeAnteo(b, { from: '2026-11-06', to: '2026-11-15', cinemaParam: c }));
  const dates = s.map(x => x.date).sort();
  console.log(c, 'showings', s.length, 'films', new Set(s.map(x => x.title.toLowerCase())).size, 'range', dates[0], dates.at(-1), 'vos', s.filter(x => x.language === 'vos').length);
}
await b.close();
