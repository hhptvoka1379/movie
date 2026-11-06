import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ locale: 'it-IT' })).newPage();
for (const id of [5546, 5435]) {
  await p.goto(`https://www.mymovies.it/cinema/milano/${id}/`, { waitUntil: 'networkidle', timeout: 60000 });
  const t = (await p.innerText('body')).replace(/\n+/g, '\n');
  const i = t.search(/Mexico|Palestrina/);
  console.log('=====', id, '\n', t.slice(i, i + 1500));
  const l = await p.$$eval('a', a => a.map(x => x.innerText.trim().replace(/\s+/g, ' ') + ' | ' + x.href).filter(s => /sito|web|www|orari|\d\d[.:]\d\d|giorno|data=|domani/i.test(s)).slice(0, 12));
  console.log(l.join('\n'));
}
await b.close();
