import { chromium } from 'playwright';
const urls = process.argv.slice(2);
const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'it-IT', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36' });
for (const u of urls) {
  const p = await ctx.newPage();
  try {
    const r = await p.goto(u, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await p.waitForTimeout(2500);
    const t = (await p.innerText('body')).replace(/\s+/g, ' ').slice(0, 220);
    const l = (await p.$$eval('a', a => a.map(x => x.innerText.trim().replace(/\s+/g, ' ') + '|' + x.href).filter(s => /orari|program|bigliett|prenot|webtic|18tickets|acquista/i.test(s)).slice(0, 5)));
    console.log('\n' + u, r?.status(), '\n ', t, '\n ', l.join('\n  '));
  } catch (e) { console.log('\n' + u, 'FAIL', e.message.split('\n')[0]); }
  await p.close();
}
await b.close();
