import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ locale: 'it-IT' })).newPage();
await p.goto('https://www.mymovies.it/cinema/milano/', { waitUntil: 'networkidle', timeout: 60000 });
const l = await p.$$eval('a', a => a.map(x => x.innerText.trim().replace(/\s+/g, ' ') + ' | ' + x.href).filter(s => /cinema\/milano\/\d+/.test(s)));
console.log([...new Set(l)].join('\n'));
await b.close();
