import { chromium } from 'playwright';
import { scrapeWebtic, webticToShowings } from '../adapters/webtic.mjs';
import fs from 'fs';
const ids={colosseo:5062,eliseo:5064,ducale:5065,arcobaleno:5066,uci_bicocca:5068,plinius:5094,orfeo:5351,gloria:5491,centrale:5742,certosa:5868};
const b=await chromium.launch();
for(const [k,id] of Object.entries(ids)){
 try{const r=await scrapeWebtic(b,id);const s=webticToShowings(r.scheduling,id);
  const dates=s.map(x=>x.date).sort();fs.writeFileSync(`logs/wt-${id}-info.json`,JSON.stringify(r.info));
  const win=s.filter(x=>x.date>='2026-11-06'&&x.date<='2026-11-15');
  console.log(k,id,'events',r.scheduling.Events.length,'showings',s.length,'inwindow',win.length,'range',dates[0],dates.at(-1));
 }catch(e){console.log(k,id,'FAIL',e.message)}
}
await b.close();
