import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ locale: 'it-IT' })).newPage();
const reqs = [];
p.on('response', r => { const u = r.url(); if (/spaziocinema/.test(u) && ['xhr', 'fetch'].includes(r.request().resourceType())) reqs.push(u.slice(0, 150)); });
await p.goto('https://www.spaziocinema.info/milano/cinema', { waitUntil: 'networkidle' });
const n0 = (await p.$$('a[href*="/milano/film/"]')).length;
for (let i = 0; i < 8; i++) { await p.mouse.wheel(0, 4000); await p.waitForTimeout(700); }
const n1 = (await p.$$('a[href*="/milano/film/"]')).length;
console.log('links before/after scroll', n0, n1);
console.log(reqs.join('\n'));
const txt = await p.innerText('body');
const i = txt.indexOf('Calendario');
console.log(txt.slice(Math.max(0, i - 300), i + 900));
await b.close();
