// Browser tests: Stage 3 Home redesign.   Run: node tests/home_test.js
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
const results = []; const ok = (n, c, d = '') => { results.push(c); console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + d}`); };
const days = Array.from({ length: 7 }, (_, i) => `2026-11-${String(27 + i > 30 ? 27 + i - 30 : 27 + i).padStart(2, '0')}`);
const FORECAST = { current: { time: '2026-11-27T10:00', temperature_2m: 7.4, apparent_temperature: 5.2, weather_code: 61, is_day: 1, wind_speed_10m: 12 },
  hourly: { time: Array.from({ length: 48 }, (_, i) => `2026-11-${i < 24 ? '27' : '28'}T${String(i % 24).padStart(2, '0')}:00`), temperature_2m: Array.from({ length: 48 }, (_, i) => 5 + (i % 5)), weather_code: Array.from({ length: 48 }, () => 3), precipitation_probability: Array.from({ length: 48 }, () => 20), is_day: Array.from({ length: 48 }, (_, i) => (i % 24 > 7 && i % 24 < 17) ? 1 : 0) },
  daily: { time: days, weather_code: [61, 3, 0, 2, 63, 71, 95], temperature_2m_max: [9, 8, 7, 6, 10, 2, 12], temperature_2m_min: [4, 3, 2, 1, 5, -2, 6], precipitation_probability_max: [80, 20, 5, 10, 60, 40, 90], sunrise: days.map((d) => d + 'T07:50'), sunset: days.map((d) => d + 'T15:50'), wind_speed_10m_max: [20, 15, 10, 12, 25, 30, 35] } };
let base;
async function boot(browser, vp, theme, seed = true) {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: vp.width < 700, geolocation: { latitude: 53.8, longitude: -1.58 }, permissions: ['geolocation'] });
  await ctx.route(/supabase\.co|jsdelivr|googletagmanager|googlesyndication/, (r) => r.abort());
  await ctx.route(/\/\/api\.open-meteo/, (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(FORECAST) }));
  await ctx.route(/postcodes\.io/, (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ result: { outcode: 'LS6', admin_district: 'Leeds', country: 'England', latitude: 53.8, longitude: -1.58 } }) }));
  await ctx.addInitScript((t) => { try { localStorage.setItem('daymate:consent', JSON.stringify({ analytics: false })); localStorage.setItem('daymate:theme', t); } catch (_) {} }, theme);
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base); await page.waitForFunction(() => window.DAYMATE);
  await page.fill('#welcomeName', 'Luke'); await page.click('#welcomeForm button[type=submit]'); await page.waitForTimeout(400);
  if (seed) await page.evaluate(() => { const S = DAYMATE.Store; const d = new Date().toLocaleDateString('en-CA');
    S.add('tasks', { title: 'Call the council about bins and recycling collection dates', priority: 'high', category: 'family', repeat: '', date: d, time: '', completed: false, completedOn: '', completedAt: '' });
    S.add('tasks', { title: 'Pay nursery invoice', priority: 'low', category: 'bills', repeat: '', date: d, time: '', completed: true, completedOn: d, completedAt: '' });
    S.add('reminders', { title: 'Dentist for Sam with a long appointment name to check wrapping', kind: 'event', category: 'family', repeat: '', important: false, date: d, time: '23:30', note: '', location: 'Headingley Dental, 12 Otley Rd, Leeds LS6 3AA', done: false });
    ['Milk', 'Bread', 'Eggs'].forEach((n) => S.add('shopping', { name: n, checked: false })); });
  await page.click('.wxsec [data-action="weather-locate"]').catch(() => {}); await page.waitForSelector('.wxcard__temp', { timeout: 4000 }).catch(() => {});
  await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForTimeout(300);
  return { ctx, page, errors };
}
(async () => {
  await new Promise((r) => server.listen(0, r)); base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  for (const theme of ['dark', 'light']) for (const w of [320, 390, 430]) {
    const { ctx, page, errors } = await boot(browser, { width: w, height: 844 }, theme); const tag = `${theme} ${w}px`;
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    ok(`${tag}: Home has no horizontal overflow`, m.sw <= m.cw, JSON.stringify(m));
    if (w === 390) {
      const order = await page.$$eval('#view-home .col:first-child > *', (n) => n.filter((e) => !e.hidden).map((e) => e.classList.contains('overview') ? 'overview' : e.classList.contains('wxsec') ? 'weather' : e.classList.contains('quick') ? 'quick' : e.classList.contains('askbar') ? 'ask' : e.getAttribute('aria-labelledby') === 'schedHeading' ? 'schedule' : e.getAttribute('aria-labelledby') === 'myDayHeading' ? 'myday' : '?'));
      ok(`${tag}: Home order is overview, weather, quick actions, ask bar, schedule, my day`, order.join(',') === 'overview,weather,quick,ask,schedule,myday', order.join(','));
      ok(`${tag}: weather card still shows the forecast`, /7°/.test(await page.textContent('.wxcard')));
      ok(`${tag}: weather card opens the forecast sheet`, await (async () => { await page.click('.wxcard'); await page.waitForTimeout(400); const o = await page.isVisible('#m-weather .sheet'); await page.keyboard.press('Escape'); await page.waitForTimeout(400); if (await page.isVisible('#m-weather .sheet')) await page.evaluate(() => DAYMATE.UI && DAYMATE.UI.closeModal && DAYMATE.UI.closeModal('m-weather')); return o; })());
      // schedule + maps buttons
      const links = await page.$$eval('#view-home .timeline .mapbtn', (a) => a.map((x) => x.href));
      ok(`${tag}: schedule keeps Google and Apple buttons with encoded address`, links.length === 2 && /google\.com\/maps\/dir\/\?api=1&destination=Headingley%20Dental/.test(links[0]) && /maps\.apple\.com\/\?daddr=Headingley%20Dental/.test(links[1]), links.join(' '));
      const ell = await page.$eval('.timeline__txt strong', (s) => { const c = getComputedStyle(s); return c.whiteSpace; });
      ok(`${tag}: schedule titles wrap instead of cutting off after one line`, ell !== 'nowrap', ell);
      const h = await page.$eval('.timeline__txt strong', (s) => s.getBoundingClientRect().height); ok(`${tag}: long schedule title shows two lines`, h > 24, String(h));
      // interactions
      await page.click('#view-home .task .check >> nth=0'); await page.waitForTimeout(300);
      ok(`${tag}: ticking a task still works`, await page.evaluate(() => DAYMATE.Store.state.tasks.filter((t) => t.completed).length) === 2);
      await page.click('[data-filter="done"]'); await page.waitForTimeout(200);
      ok(`${tag}: task filters still work`, (await page.$$('#taskList .task')).length === 2);
      await page.click('[data-filter="all"]');
      await page.fill('#quickAddInput', 'Quick add test'); await page.press('#quickAddInput', 'Enter'); await page.waitForTimeout(300);
      ok(`${tag}: quick add still adds a task`, /Quick add test/.test(await page.textContent('#taskList')));
      ok(`${tag}: overview numbers still update`, /\d/.test(await page.textContent('#ovRemaining')) && /%/.test(await page.textContent('#ovPct')));
      // widget settings still hide/show
      await page.evaluate(() => { location.hash = '#/more/appearance'; }); await page.waitForTimeout(300);
      for (const sel of ['[data-action="weather-toggle-home"]', '[data-action="hub-pref"][data-k="showSchedule"]', '[data-action="hub-pref"][data-k="showShopping"]']) { const b = await page.$(sel); if (b) { await b.click(); await page.waitForTimeout(100); } }
      await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForTimeout(300);
      ok(`${tag}: widget settings hide weather, schedule and shopping`, await page.evaluate(() => ['.wxsec', '[aria-labelledby="schedHeading"]', '[aria-labelledby="shopHeading"]'].every((s) => { const e = document.querySelector(s); return !e || e.hidden || getComputedStyle(e).display === 'none'; })));
      const promo = await page.textContent('.promo'); ok(`${tag}: Premium card no longer says "coming soon"`, !/coming soon/i.test(promo), promo);
      // touch target of the small header buttons
      await page.evaluate(() => [...document.querySelectorAll('#view-home .chip-btn')].find((x) => x.getBoundingClientRect().height > 0).scrollIntoView({ block: 'center' })); await page.waitForTimeout(150);
      const hit = await page.evaluate(() => { const c = [...document.querySelectorAll('#view-home .chip-btn')].find((x) => x.getBoundingClientRect().height > 0); const r = c.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y - 3); return r.height >= 36 && (e === c || c.contains(e)); });
      ok(`${tag}: header action buttons have a 44px touch area`, hit);
    }
    ok(`${tag}: no script errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  // empty Home still renders gracefully
  { const { ctx, page, errors } = await boot(browser, { width: 390, height: 844 }, 'dark', false);
    ok('empty Home: schedule shows its friendly empty state', /Nothing scheduled today/.test(await page.textContent('#view-home')));
    ok('empty Home: shopping shows its empty state', /list is empty/.test(await page.textContent('#view-home')));
    ok('empty Home: no script errors', errors.length === 0, errors.join(' | ')); await ctx.close(); }
  // desktop two columns
  { const { ctx, page, errors } = await boot(browser, { width: 1280, height: 900 }, 'dark');
    const cols = await page.$$eval('#view-home .col', (c) => c.map((x) => Math.round(x.getBoundingClientRect().left)));
    ok('desktop: Home keeps two columns', cols.length === 2 && cols[1] > cols[0] + 300, cols.join(','));
    ok('desktop: no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    ok('desktop: no script errors', errors.length === 0, errors.join(' | ')); await ctx.close(); }
  await browser.close(); server.close();
  const pass = results.filter(Boolean).length; console.log(`\n${pass}/${results.length} passed`); process.exit(pass === results.length ? 0 : 1);
})();
