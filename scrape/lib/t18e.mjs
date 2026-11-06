import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ locale: 'it-IT' })).newPage();
for (const id of ['58857', '107598', '58858']) {
  await p.goto('https://arlecchino.cinetecadimilano.18tickets.it/film/' + id, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  const r = await p.evaluate(() => ({
    modal: !!document.querySelector('#modal-login.show'),
    days: [...document.querySelectorAll('.m18-day-elem')].map(x => x.className.replace('m18-day-elem ', '') + ':' + (x.dataset.target || '-')),
    proj: document.querySelectorAll('a.film-projection').length,
    txt: document.body.innerText.slice(0, 400).replace(/\s+/g, ' '),
  }));
  console.log(id, JSON.stringify(r));
}
await b.close();
