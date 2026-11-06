import { chromium } from 'playwright';
const b=await chromium.launch();
const p=await (await b.newContext({locale:'it-IT'})).newPage();
await p.goto('https://www.spaziocinema.info/milano/film/dio-ride',{waitUntil:'networkidle'});
const t=await p.evaluate(async()=>{const r=await fetch('/film/dio-ride/@@get-programmazione?dt=2026-11-10&town=Milano');return r.text()});
console.log(t.slice(0,3500));
await b.close();
