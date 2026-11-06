import { chromium } from 'playwright';
import fs from 'fs';
const rows = fs.readFileSync('logs/movieplayer-cinemas.txt','utf8').trim().split('\n').map(l=>l.split(' | '));
const b = await chromium.launch();
const p = await (await b.newContext({locale:'it-IT'})).newPage();
const out=[];
for (const [name,url] of rows){
  await p.goto(url,{waitUntil:'domcontentloaded',timeout:45000}).catch(()=>{});
  await p.waitForTimeout(1500);
  const t = await p.innerText('body');
  const addr = (t.match(/CINEMA [^\n]+\n([^\n]+- Milano[^\n]*)/)||[])[1]||'?';
  const noprog = /Non è in programma/.test(t);
  out.push({name,url,address:addr,mp_empty:noprog});
  console.log(name,'|',addr,'|',noprog?'EMPTY(noJS?)':'has schedule');
}
fs.writeFileSync('logs/movieplayer-addresses.json',JSON.stringify(out,null,1));
await b.close();
