import { chromium } from 'playwright';
const ids={arlecchino:22550,centrale:22546,colosseo:60616,ducale:60614,plinius:60563,orfeo:33662,mexico:60562,arcobaleno:22557};
const b=await chromium.launch();
const p=await (await b.newContext({locale:'en-US',userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36'})).newPage();
for(const [k,id] of Object.entries(ids)){
 await p.goto('https://cinematreasures.org/theaters/'+id,{waitUntil:'domcontentloaded',timeout:40000}).catch(()=>{});
 const l=await p.$$eval('a',a=>a.filter(x=>/official|website/i.test(x.innerText)||x.rel.includes('nofollow')).map(x=>x.innerText.trim()+' '+x.href));
 console.log(k,l.filter(s=>!/cinematreasures/.test(s)).slice(0,4));
}
await b.close();
