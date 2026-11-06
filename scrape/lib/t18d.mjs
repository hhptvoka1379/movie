import { chromium } from 'playwright';
const b=await chromium.launch();const p=await (await b.newContext({locale:'it-IT'})).newPage();
await p.goto('https://arlecchino.cinetecadimilano.18tickets.it/',{waitUntil:'networkidle'});
const l=await p.$$eval('a[href*="/film/"]',a=>a.map(x=>x.innerText.trim().replace(/\s+/g,' ')+' | '+x.href+' | '+(x.dataset.dateExtended||'')));
console.log(l.filter(s=>/^\d\d:\d\d/.test(s)).join('\n'));
await b.close();
