#!/usr/bin/env node
/* End-to-end Playwright + axe-core smoke suite for Cinema Milano.
 * Verifies data integrity, zero console/page/HTTP errors, 390x844 mobile and
 * 1280x800 desktop layouts, >=44x44px touch targets, filter reactivity,
 * mobile dock drag/collapse, desktop hover preview & side panel, 10-day film
 * grid dialog, list view, URL hash round-trip, keyboard-only pin-to-showtime
 * flow, prefers-reduced-motion, ?sample=1 fixture, error/retry handling, and
 * zero axe-core accessibility violations.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRAPE_NM = path.join(ROOT, 'scrape', 'node_modules');
const req = createRequire(path.join(ROOT, 'scrape', 'package.json'));

const { chromium } = req('playwright');
const AXE_SOURCE = fs.readFileSync(req.resolve('axe-core/axe.min.js'), 'utf8');

const CDN_FILES = new Map([
  ['leaflet.min.js', fs.readFileSync(req.resolve('leaflet/dist/leaflet.js'))],
  ['leaflet.min.css', fs.readFileSync(req.resolve('leaflet/dist/leaflet.css'))],
  ['leaflet.markercluster.js', fs.readFileSync(req.resolve('leaflet.markercluster/dist/leaflet.markercluster.js'))],
  ['MarkerCluster.css', fs.readFileSync(req.resolve('leaflet.markercluster/dist/MarkerCluster.css'))]
]);

const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIAAAUAAeImBZsAAAAASUVORK5CYII=',
  'base64'
);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const SHOT_DIR = process.env.QA_SCREENSHOT_DIR || '';
if (SHOT_DIR) fs.mkdirSync(SHOT_DIR, { recursive: true });

const results = [];
async function step(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    const ms = Date.now() - t0;
    results.push({ ok: true, name, detail, ms });
    console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''} (${ms}ms)`);
  } catch (err) {
    const ms = Date.now() - t0;
    results.push({ ok: false, name, err: err && err.stack ? err.stack : String(err), ms });
    console.error(`  FAIL  ${name} (${ms}ms)\n        ${err && err.message ? err.message : err}`);
  }
}

function startStaticServer() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((rq, rs) => {
      try {
        const u = new URL(rq.url || '/', 'http://127.0.0.1');
        let rel = decodeURIComponent(u.pathname);
        if (rel === '/') rel = '/index.html';
        const fp = path.resolve(ROOT, '.' + rel);
        if (!fp.startsWith(ROOT + path.sep) && fp !== ROOT) {
          rs.writeHead(403); rs.end('Forbidden'); return;
        }
        if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
          rs.writeHead(404); rs.end('Not found'); return;
        }
        const ext = path.extname(fp).toLowerCase();
        rs.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        rs.end(fs.readFileSync(fp));
      } catch (e) {
        rs.writeHead(500); rs.end(String(e));
      }
    });
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true });
  } catch {
    process.env.AWS_EXECUTION_ENV = process.env.AWS_EXECUTION_ENV || 'AWS_Lambda_nodejs22.x';
    const sparticuzPath = path.join(SCRAPE_NM, '@sparticuz', 'chromium', 'build', 'index.js');
    const mod = await import(pathToFileURL(sparticuzPath).href);
    const sp = mod.default || mod;
    const executablePath = await sp.executablePath();
    const ldParts = ['/tmp/al2023/lib', process.env.LD_LIBRARY_PATH].filter(Boolean);
    const cleanArgs = sp.args.filter(a => a !== '--single-process');
    return await chromium.launch({
      executablePath,
      headless: true,
      args: [...cleanArgs, '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
      env: { ...process.env, LD_LIBRARY_PATH: ldParts.join(':') }
    });
  }
}

async function installOfflineRoutes(context, baseOrigin, errorTracker, opts = {}) {
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith(baseOrigin)) {
      if (opts.failShowtimes && url.includes('/data/showtimes.json')) {
        await route.abort('failed');
        return;
      }
      await route.continue();
      return;
    }
    const base = path.basename(new URL(url).pathname);
    if (CDN_FILES.has(base)) {
      const ext = path.extname(base).toLowerCase();
      await route.fulfill({ status: 200, contentType: MIME[ext] || 'text/plain', body: CDN_FILES.get(base) });
      return;
    }
    if (url.includes('tile.openstreetmap.org')) {
      await route.fulfill({ status: 200, contentType: 'image/png', body: TRANSPARENT_PNG });
      return;
    }
    if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
      await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
      return;
    }
    errorTracker.unexpectedExternal.push(url);
    await route.abort();
  });
}

function attachGuards(page, baseOrigin) {
  const tracker = { consoleErrors: [], pageErrors: [], badResponses: [], unexpectedExternal: [] };
  page.on('console', msg => {
    if (msg.type() === 'error') tracker.consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => tracker.pageErrors.push(err.message || String(err)));
  page.on('response', res => {
    if (res.url().startsWith(baseOrigin) && res.status() >= 400) {
      tracker.badResponses.push(`${res.status()} ${res.url()}`);
    }
  });
  return tracker;
}

async function checkTapTargets(page, scopeLabel) {
  const undersized = await page.evaluate(() => {
    const sel = 'button, a[href], select, input:not([type="radio"]):not([type="checkbox"]), .opts span';
      const bad = [];
      const openDialog = document.querySelector('dialog[open]');
      const root = openDialog || document;
      for (const el of root.querySelectorAll(sel)) {
        const st = getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) continue;
        if (el.closest('[hidden]') || (!openDialog && el.closest('dialog:not([open])'))) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.width < 43.5 || r.height < 43.5) {
        bad.push({
          tag: el.tagName.toLowerCase(),
          cls: el.className,
          txt: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 32),
          w: Math.round(r.width * 10) / 10,
          h: Math.round(r.height * 10) / 10
        });
      }
    }
    return bad;
  });
  assert.equal(
    undersized.length,
    0,
    `${scopeLabel}: ${undersized.length} interactive target(s) smaller than 44x44px: ${JSON.stringify(undersized.slice(0, 6))}`
  );
}

async function runAxe(page, scopeLabel) {
  await page.evaluate(src => {
    if (!window.axe) (0, eval)(src);
  }, AXE_SOURCE);
  const res = await page.evaluate(async () => {
    return await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }
    });
  });
  assert.equal(
    res.violations.length,
    0,
    `${scopeLabel} axe violations: ${JSON.stringify(res.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map(n => n.html.slice(0, 120)) })))}`
  );
  return `${res.passes.length} rules passed, 0 violations`;
}

async function main() {
  console.log('=== Cinema Milano end-to-end smoke & accessibility suite ===\n');

  await step('dataset & poster integrity (data/showtimes.json + data/posters.json)', async () => {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'showtimes.json'), 'utf8'));
    const posters = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'posters.json'), 'utf8'));
    assert.equal(data.range.from, '2026-11-06');
    assert.equal(data.range.to, '2026-11-15');
    assert.ok(data.cinemas.length >= 19, 'expected >= 19 cinemas');
    const okCinemas = data.cinemas.filter(c => c.status === 'ok');
    assert.ok(okCinemas.length >= 16, `expected >= 16 ok cinemas, got ${okCinemas.length}`);
    for (const c of okCinemas) {
      assert.ok(c.lat >= 45.35 && c.lat <= 45.60 && c.lng >= 9.05 && c.lng <= 9.35, `bad coords for ${c.id}`);
    }
    const filmIds = new Set();
    for (const f of data.films) {
      assert.ok(!filmIds.has(f.id), `duplicate film id ${f.id}`);
      filmIds.add(f.id);
      assert.ok(!/\((?:lingua originale|o\.?v\.?|sala xl)\)/i.test(f.title), `uncleaned title: ${f.title}`);
    }
    let priced = 0;
    for (const s of data.showings) {
      assert.ok(s.date >= '2026-11-06' && s.date <= '2026-11-15', `out-of-range showing ${s.date}`);
      assert.ok(/^\d{2}:\d{2}$/.test(s.time), `bad time ${s.time}`);
      assert.ok(filmIds.has(s.film_id), `missing film ${s.film_id}`);
      if (s.price_eur !== null) {
        assert.ok(typeof s.price_eur === 'number' && s.price_eur >= 3 && s.price_eur <= 25, `implausible price ${s.price_eur}`);
        priced++;
      }
    }
    assert.ok(priced >= 600, `expected >= 600 priced showings, got ${priced}`);
    for (const [id, entry] of Object.entries(posters)) {
      const fp = /\//.test(entry.file) ? path.join(ROOT, entry.file) : path.join(ROOT, 'assets', 'posters', entry.file);
      assert.ok(fs.existsSync(fp), `missing poster file for ${id}: ${entry.file}`);
    }
    return `${data.cinemas.length} cinemas (${okCinemas.length} ok), ${data.films.length} films, ${data.showings.length} showings (${priced} priced)`;
  });

  const srv = await startStaticServer();
  const port = srv.address().port;
  const baseOrigin = `http://127.0.0.1:${port}`;
  const browser = await launchBrowser();

  try {
    for (const vp of [
      { label: 'mobile-390x844', width: 390, height: 844, isMobile: true },
      { label: 'desktop-1280x800', width: 1280, height: 800, isMobile: false }
    ]) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'it-IT' });
      const page = await context.newPage();
      const tracker = attachGuards(page, baseOrigin);
      await installOfflineRoutes(context, baseOrigin, tracker);

      await step(`${vp.label}: initial map load, day strip, pins/clusters & zero errors`, async () => {
        await page.goto(`${baseOrigin}/#d=2026-11-06`, { waitUntil: 'networkidle' });
        await page.waitForSelector('#strip .day[data-day="2026-11-06"][aria-pressed="true"]');
        const dayCount = await page.locator('#strip .day').count();
        assert.equal(dayCount, 10, 'expected 10 days in #strip');
        const markersCount = await page.locator('.pin, .cluster-bubble').count();
        assert.ok(markersCount >= 4, `expected >= 4 map pins/clusters, got ${markersCount}`);
        const horizOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert.ok(horizOverflow <= 0, `unexpected horizontal overflow: ${horizOverflow}px`);
        await checkTapTargets(page, `${vp.label} map initial`);
        if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `${vp.label}-01-map.png`) });
        assert.equal(tracker.pageErrors.length, 0, `pageErrors: ${tracker.pageErrors.join('; ')}`);
        assert.equal(tracker.consoleErrors.length, 0, `consoleErrors: ${tracker.consoleErrors.join('; ')}`);
        assert.equal(tracker.badResponses.length, 0, `badResponses: ${tracker.badResponses.join('; ')}`);
        return `${markersCount} visible markers/clusters, 10 day buttons, 0 errors`;
      });

      await step(`${vp.label}: axe-core accessibility on initial Map view`, async () => {
        return await runAxe(page, `${vp.label} map initial`);
      });

      await step(`${vp.label}: every filter changes results & reset restores baseline`, async () => {
        const countShows = () => page.evaluate(() => {
          const d = window.CinemaApp.getData();
          const st = window.CinemaApp.getState();
          return (d.byDate.get(st.d) || []).filter(window.CinemaApp.passes).length;
        });
        const baseCount = await countShows();
        assert.ok(baseCount > 50, `expected > 50 ITA showings on 2026-11-06, got ${baseCount}`);

        // Day filter via strip
        await page.click('#strip .day[data-day="2026-11-09"]');
        const monCount = await countShows();
        assert.notEqual(monCount, baseCount, 'switching day should change showing count');
        await page.click('#strip .day[data-day="2026-11-06"]');

        // Open filters sheet & verify tap targets + axe
        await page.click('#filter-pill');
        await page.waitForSelector('#filters:not([hidden])');
        await checkTapTargets(page, `${vp.label} filters sheet`);
        await runAxe(page, `${vp.label} filters open`);
        if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `${vp.label}-02-filters.png`) });

        // Language filter: tutte -> vo -> ita
        await page.locator('#opt-lang input[value="tutte"]').locator('..').click();
        const allLangCount = await countShows();
        assert.ok(allLangCount > baseCount, `tutte (${allLangCount}) should exceed ita (${baseCount})`);

        await page.locator('#opt-lang input[value="vo"]').locator('..').click();
        const voCount = await countShows();
        assert.ok(voCount > 0 && voCount < allLangCount, `vo (${voCount}) should be >0 and < tutte (${allLangCount})`);

        await page.locator('#opt-lang input[value="tutte"]').locator('..').click();

        // Time window filter
        await page.locator('#opt-time input[value="pomeriggio"]').locator('..').click();
        const pomCount = await countShows();
        assert.ok(pomCount > 0 && pomCount < allLangCount, `pomeriggio (${pomCount}) should narrow tutte (${allLangCount})`);
        await page.locator('#opt-time input[value="tutti"]').locator('..').click();

        // Format filter
        await page.selectOption('#fmt', 'DOLBY');
        const dolbyCount = await countShows();
        assert.ok(dolbyCount > 0 && dolbyCount < allLangCount, `DOLBY (${dolbyCount}) should narrow results`);
        await page.selectOption('#fmt', 'tutti');

        // Type filter
        await page.locator('#opt-tipo input[value="event"]').locator('..').click();
        const eventCount = await countShows();
        assert.ok(eventCount > 0 && eventCount < allLangCount, `event (${eventCount}) should narrow results`);
        await page.locator('#opt-tipo input[value="tutti"]').locator('..').click();

        // Search filter
        await page.fill('#q', 'CityLife');
        const qCount = await countShows();
        assert.ok(qCount > 0 && qCount < allLangCount, `search CityLife (${qCount}) should narrow results`);

        // Reset restores baseline
        await page.click('#reset-filters');
        const afterReset = await countShows();
        assert.equal(afterReset, baseCount, 'reset-filters must restore baseline count');
        await page.click('#close-filters');
        await page.waitForSelector('#filters[hidden]', { state: 'attached' });
        return `ita=${baseCount}, tutte=${allLangCount}, vo=${voCount}, pom=${pomCount}, dolby=${dolbyCount}, event=${eventCount}, q=${qCount}`;
      });

      await step(`${vp.label}: cinema selection, dock/panel, prices, tap targets & axe`, async () => {
        if (!vp.isMobile) {
          const hoverPin = page.locator('.pin:not(.is-empty)').first();
          await hoverPin.hover();
          await page.waitForSelector('#hover-preview:not([hidden])');
          const hpBox = await page.locator('#hover-preview').boundingBox();
          assert.ok(hpBox && hpBox.x >= 0 && hpBox.y >= 0 && hpBox.x + hpBox.width <= vp.width, 'hover preview stays within viewport');
        }

        // Select Colosseo via URL hash or visible pin to guarantee priced showtimes
        await page.evaluate(() => window.CinemaApp.commit({ l: 'tutte', c: 'colosseo', dock: true }));
        await page.waitForSelector('#dock:not(.is-collapsed) .fcard');
        const priceBadges = await page.locator('#dock .time small').allTextContents();
        assert.ok(priceBadges.some(t => /€\d+,\d{2}/.test(t)), `expected formatted € price in dock, got ${JSON.stringify(priceBadges)}`);
        await checkTapTargets(page, `${vp.label} dock open`);
        await runAxe(page, `${vp.label} dock open`);
        if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `${vp.label}-03-dock.png`) });

        if (vp.isMobile) {
          // Collapse via dock handle click and verify dock=0 in hash
          await page.click('#dock-handle');
          await page.waitForSelector('#dock.is-collapsed');
          await page.waitForFunction(() => Math.round(document.getElementById('dock').getBoundingClientRect().height) === 56);
          assert.ok(page.url().includes('dock=0'), `expected dock=0 in hash, got ${page.url()}`);
          // Re-open via upward pointer drag on #dock-handle
          const hb = await page.locator('#dock-handle').boundingBox();
          await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
          await page.mouse.down();
          await page.mouse.move(hb.x + hb.width / 2, hb.y - 120, { steps: 5 });
          await page.mouse.up();
          await page.waitForSelector('#dock:not(.is-collapsed)');
          await page.waitForFunction(() => document.getElementById('dock').getBoundingClientRect().height >= 200);
        } else {
          const hasPanel = await page.evaluate(() => document.body.classList.contains('has-panel'));
          assert.ok(hasPanel, 'desktop should set body.has-panel when cinema panel is open');
          const dBox = await page.locator('#dock').boundingBox();
          assert.equal(Math.round(dBox.width), 380, 'desktop side panel should be 380px wide');
        }
        return `${priceBadges.length} priced showtime badges in Colosseo dock`;
      });

      await step(`${vp.label}: 10-day film grid dialog, tap targets & axe`, async () => {
        await page.locator('#dock .ftitle').first().click();
        await page.waitForSelector('#film-dialog[open] .fpg-table');
        const colCount = await page.locator('#film-dialog .fpg-table thead th').count();
        assert.equal(colCount, 11, '1 corner column + 10 day columns (6-15 Nov)');
        const timeLinks = await page.locator('#film-dialog .fpg-table .time').count();
        assert.ok(timeLinks >= 1, 'expected clickable showtime links in film grid');
        await checkTapTargets(page, `${vp.label} film dialog`);
        await runAxe(page, `${vp.label} film dialog`);
        if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `${vp.label}-04-film-grid.png`) });
        await page.click('#film-dialog .dlg-close');
        await page.waitForFunction(() => !document.getElementById('film-dialog').open);
        return `${colCount - 1} day columns, ${timeLinks} showtime links`;
      });

      await step(`${vp.label}: List view, Senza programmazione section, tap targets & axe`, async () => {
        await page.click('#view-list');
        await page.waitForSelector('#list:not([hidden]) .lcard');
        const cards = await page.locator('#list .lcard').count();
        const notes = await page.locator('#list .cnote').count();
        assert.ok(cards >= 15, `expected >= 15 film cards in list view, got ${cards}`);
        assert.equal(notes, 3, `expected 3 non-ok cinema note cards, got ${notes}`);
        await checkTapTargets(page, `${vp.label} list view`);
        await runAxe(page, `${vp.label} list view`);
        if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `${vp.label}-05-list.png`) });
        await page.click('#view-map');
        await page.waitForSelector('#map-wrap:not([hidden])');
        return `${cards} film cards, ${notes} status notes`;
      });

      await step(`${vp.label}: keyboard-only flow (Tab to pin -> Enter -> Tab to showtime)`, async () => {
        await page.goto(`${baseOrigin}/#d=2026-11-06&l=tutte`, { waitUntil: 'networkidle' });
        await page.locator('#strip .day').last().focus();
        let reachedPin = false;
        for (let i = 0; i < 25; i++) {
          await page.keyboard.press('Tab');
          const onNonEmptyPin = await page.evaluate(() => {
            const a = document.activeElement;
            return !!(a && a.classList.contains('pin') && !a.classList.contains('is-empty'));
          });
          if (onNonEmptyPin) { reachedPin = true; break; }
        }
        assert.ok(reachedPin, 'Tab from #strip must reach an active .pin on the map');
        await page.keyboard.press('Enter');
        await page.waitForSelector('#dock:not(.is-collapsed) .dock-name');
        const focusAfterEnter = await page.evaluate(() => document.activeElement && document.activeElement.className);
        assert.equal(focusAfterEnter, 'dock-name', 'Enter on pin must move focus to .dock-name');

        let reachedShowtime = false;
        let tabsToShowtime = 0;
        for (let i = 1; i <= 4; i++) {
          await page.keyboard.press('Tab');
          const isTime = await page.evaluate(() => {
            const a = document.activeElement;
            return !!(a && a.closest('#dock') && a.classList.contains('time'));
          });
          if (isTime) { reachedShowtime = true; tabsToShowtime = i; break; }
        }
        assert.ok(reachedShowtime, 'Tab from opened dock must reach a .time showtime link within <=4 Tabs');
        return `focused .dock-name on Enter, reached .time in ${tabsToShowtime} Tab(s)`;
      });

      await step(`${vp.label}: URL hash round-trip (open + collapsed dock=0)`, async () => {
        await page.goto(`${baseOrigin}/#d=2026-11-08&l=vo&t=sera&c=citylife-anteo`, { waitUntil: 'networkidle' });
        const st1 = await page.evaluate(() => ({ ...window.CinemaApp.getState() }));
        assert.equal(st1.d, '2026-11-08');
        assert.equal(st1.l, 'vo');
        assert.equal(st1.t, 'sera');
        assert.equal(st1.c, 'citylife-anteo');
        assert.equal(st1.dock, true);

        await page.goto(`${baseOrigin}/#d=2026-11-08&l=ita&c=citylife-anteo&dock=0`, { waitUntil: 'networkidle' });
        const st2 = await page.evaluate(() => ({ ...window.CinemaApp.getState(), collapsed: document.getElementById('dock').classList.contains('is-collapsed') }));
        assert.equal(st2.c, 'citylife-anteo');
        assert.equal(st2.dock, false);
        assert.equal(st2.collapsed, true);
        return 'restored d/l/t/c/dock=true and dock=0 round-trip';
      });

      await step(`${vp.label}: prefers-reduced-motion disables transitions & animations`, async () => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const durations = await page.evaluate(() => {
          const d = getComputedStyle(document.getElementById('dock'));
          const lb = document.querySelector('.leaflet-bottom');
          const lbs = lb ? getComputedStyle(lb) : { transitionDuration: '0s' };
          return { dockTransition: d.transitionDuration, leafletTransition: lbs.transitionDuration };
        });
        assert.equal(durations.dockTransition, '0s');
        assert.equal(durations.leafletTransition, '0s');
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        assert.equal(tracker.pageErrors.length, 0, `pageErrors: ${tracker.pageErrors.join('; ')}`);
        assert.equal(tracker.consoleErrors.length, 0, `consoleErrors: ${tracker.consoleErrors.join('; ')}`);
        assert.equal(tracker.badResponses.length, 0, `badResponses: ${tracker.badResponses.join('; ')}`);
        return 'transition-duration=0s verified';
      });

      await context.close();
    }

    await step('?sample=1 fixture & network-failure retry recovery', async () => {
      const ctx1 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'it-IT' });
      const p1 = await ctx1.newPage();
      const tr1 = attachGuards(p1, baseOrigin);
      await installOfflineRoutes(ctx1, baseOrigin, tr1);
      await p1.goto(`${baseOrigin}/?sample=1`, { waitUntil: 'networkidle' });
      await p1.waitForSelector('.pin');
      assert.equal(tr1.badResponses.length, 0, `sample=1 404s: ${tr1.badResponses.join('; ')}`);
      assert.equal(tr1.consoleErrors.length, 0);
      await ctx1.close();

      let failNow = true;
      const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'it-IT' });
      const p2 = await ctx2.newPage();
      await ctx2.route('**/*', async route => {
        const url = route.request().url();
        if (failNow && url.includes('/data/showtimes.json')) {
          await route.abort('failed');
          return;
        }
        if (url.startsWith(baseOrigin)) { await route.continue(); return; }
        const base = path.basename(new URL(url).pathname);
        if (CDN_FILES.has(base)) {
          const ext = path.extname(base).toLowerCase();
          await route.fulfill({ status: 200, contentType: MIME[ext] || 'text/plain', body: CDN_FILES.get(base) });
          return;
        }
        if (url.includes('tile.openstreetmap.org')) {
          await route.fulfill({ status: 200, contentType: 'image/png', body: TRANSPARENT_PNG });
          return;
        }
        await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
      });
      await p2.goto(baseOrigin, { waitUntil: 'domcontentloaded' });
      await p2.waitForSelector('#status-box:not([hidden]) [data-act="retry"]');
      failNow = false;
      await p2.click('[data-act="retry"]');
      await p2.waitForSelector('.pin');
      await ctx2.close();
      return '?sample=1 clean (0 404s) + error state Riprova recovered';
    });
  } finally {
    await browser.close();
    srv.close();
  }

  const failed = results.filter(r => !r.ok);
  console.log(`\n=== Summary: ${results.length - failed.length}/${results.length} passed ===`);
  if (failed.length) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
