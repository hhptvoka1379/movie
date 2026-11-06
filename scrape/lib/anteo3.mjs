import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ locale: 'it-IT', viewport: { width: 1280, height: 1000 } })).newPage();
p.on('response', async r => {
  const u = r.url();
  if (/spaziocinema/.test(u) && ['xhr', 'fetch'].includes(r.request().resourceType())) {
    let t = ''; try { t = (await r.text()).slice(0, 400).replace(/\s+/g, ' '); } catch {}
    console.log(r.status(), u.slice(0, 170), '\n   ', t);
  }
});
await p.goto('https://www.spaziocinema.info/milano/cinema', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /rifiuta/i }).first().click({ timeout: 3000 }).catch(() => {});
console.log('--- click Citylife');
await p.getByText('Citylife Anteo', { exact: true }).first().click({ timeout: 5000 }).catch(e => console.log('noclick', e.message.slice(0, 80)));
await p.waitForTimeout(3000);
const txt = await p.innerText('body');
const i = txt.indexOf('Scegli il cinema');
console.log(txt.slice(i, i + 1800));
await p.screenshot({ path: 'logs/anteo.png', fullPage: true });
await b.close();
