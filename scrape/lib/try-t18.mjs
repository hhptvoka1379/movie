import { chromium } from 'playwright';
import { scrapeTickets18, tickets18ToShowings } from '../adapters/tickets18.mjs';
const b = await chromium.launch();
const s = tickets18ToShowings(await scrapeTickets18(b, { base: 'https://arlecchino.cinetecadimilano.18tickets.it/', from: '2026-11-06', to: '2026-11-15' }));
const d = s.map(x => x.date).sort();
console.log('arlecchino showings', s.length, 'films', new Set(s.map(x => x.title)).size, d[0], d.at(-1));
console.log(s.slice(0, 4));
await b.close();
