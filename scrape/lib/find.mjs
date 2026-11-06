import { chromium } from 'playwright';
const qs=process.argv.slice(2);
const b=await chromium.launch();
const p=await (await b.newContext({locale:'it-IT',userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36'})).newPage();
for(const q of qs){
 await p.goto('https://html.duckduckgo.com/html/?q='+encodeURIComponent(q),{waitUntil:'domcontentloaded',timeout:40000}).catch(()=>{});
 const r=await p.$$eval('a.result__a',a=>a.slice(0,5).map(x=>x.innerText.trim()+' -> '+decodeURIComponent((x.href.match(/uddg=([^&]+)/)||[])[1]||x.href)));
 console.log('\n# '+q+'\n'+r.join('\n'));
 await p.waitForTimeout(1500);
}
await b.close();
