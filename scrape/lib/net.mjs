import { chromium } from 'playwright';
const url=process.argv[2];
const b=await chromium.launch();
const p=await (await b.newContext({locale:'it-IT',userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36'})).newPage();
p.on('response',async r=>{const t=r.request().resourceType();if(['xhr','fetch'].includes(t)){let s='';try{s=(await r.text()).slice(0,200).replace(/\s+/g,' ')}catch{}console.log(r.status(),r.request().method(),r.url().slice(0,160),'\n   ',s)}});
await p.goto(url,{waitUntil:'networkidle',timeout:60000}).catch(e=>console.error(e.message));
await p.waitForTimeout(4000);
console.log((await p.innerText('body')).slice(0,1500));
await b.close();
