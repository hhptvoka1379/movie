import { chromium } from 'playwright';
const [url] = process.argv.slice(2);
const b = await chromium.launch();
const p = await (await b.newContext({ locale: 'it-IT' })).newPage();
await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
const html = await p.evaluate(() => {
  const el = [...document.querySelectorAll('*')].find(e => /\b\d\d:\d\d\b/.test(e.textContent) && ![...e.children].some(c => /\b\d\d:\d\d\b/.test(c.textContent)));
  const root = el.closest('[class*=perf],[class*=show],[class*=sala],li,div') || el;
  return el.parentElement.parentElement.outerHTML.slice(0, 900);
});
console.log(html);
await b.close();
