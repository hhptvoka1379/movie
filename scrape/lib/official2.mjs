import { chromium } from 'playwright';
const pages = {
  mexico: 'https://www.comingsoon.it/cinema/milano/mexico/',
  osoppo: 'https://www.comingsoon.it/cinema/milano/osoppo/876/',
  palestrina: 'https://www.comingsoon.it/cinema/milano/palestrina/877/',
  donbosco: 'https://www.comingsoon.it/cinema/milano/auditorium-don-bosco/836/',
  memoria: 'https://www.comingsoon.it/cinema/milano/milano-a-memoria/5473/',
};
const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'it-IT' });
for (const [k, u] of Object.entries(pages)) {
  const p = await ctx.newPage();
  try {
    await p.goto(u, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await p.waitForTimeout(2500);
    const ext = await p.$$eval('a', a => a.filter(x => x.href && !/comingsoon\.it|google|facebook|twitter|instagram|apple|youtube|whatsapp|iubenda|doubleclick/i.test(x.href)).map(x => x.innerText.trim().replace(/\s+/g, ' ').slice(0, 40) + ' | ' + x.href).slice(0, 8));
    const t = (await p.innerText('body')).replace(/\s+/g, ' ');
    const m = t.match(/(sito|web|www)[^.]{0,60}/i);
    console.log('\n' + k, u, '\n ', ext.join('\n  '), '\n  txt:', (t.match(/Via [^.]{5,60}/) || [''])[0]);
  } catch (e) { console.log('\n' + k, 'FAIL', e.message.split('\n')[0]); }
  await p.close();
}
await b.close();
