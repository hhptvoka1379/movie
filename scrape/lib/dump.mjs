import { chromium } from 'playwright';
const [url, sel] = process.argv.slice(2);
const b = await chromium.launch();
const p = await (await b.newContext({locale:'it-IT',userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36'})).newPage();
await p.goto(url,{waitUntil:'networkidle',timeout:45000}).catch(e=>console.error('goto',e.message));
if(sel==='links'){console.log((await p.$$eval('a',a=>a.map(x=>x.innerText.trim().replace(/\s+/g,' ')+' | '+x.href).filter(s=>s.length>5))).join('\n'));}
else console.log((await p.innerText('body')).slice(0,6000));
await b.close();
