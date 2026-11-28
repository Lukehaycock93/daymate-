// Browser tests: Stage 4 Planner polish.   Run: node tests/planner_polish_test.js
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
const results = []; const ok = (n, c, d = '') => { results.push(c); console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + d}`); };
let base;
async function boot(browser, vp, theme) {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: vp.width < 700 });
  await ctx.route(/supabase\.co|jsdelivr|googletagmanager|googlesyndication/, (r) => r.abort());
  await ctx.addInitScript((t) => { try { localStorage.setItem('daymate:consent', JSON.stringify({ analytics: false })); localStorage.setItem('daymate:theme', t); } catch (_) {} }, theme);
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base); await page.waitForFunction(() => window.DAYMATE);
  await page.fill('#welcomeName', 'Luke'); await page.click('#welcomeForm button[type=submit]'); await page.waitForTimeout(400);
  await page.evaluate(() => { const S = DAYMATE.Store; const add = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString('en-CA');
    const T = (title, n, time, pri, cat) => S.add('tasks', { title, priority: pri, category: cat, repeat: '', date: add(n), time, completed: false, completedOn: '', completedAt: '' });
    const E = (title, n, time, loc, cat) => S.add('reminders', { title, kind: 'event', category: cat, repeat: '', important: false, date: add(n), time, note: '', location: loc, done: false });
    T('Call the council', 0, '', 'high', 'family'); E('Late appointment', 0, '23:59', 'Headingley Dental, 12 Otley Rd, Leeds LS6 3AA', 'family'); E('No address appt', 0, '23:58', '', 'personal');
    E('Two a', 3, '09:00', '', 'personal'); T('Two b', 3, '', 'low', 'work');
    T('Five a', 4, '', 'low', 'work'); E('Five b', 4, '08:00', '', 'personal'); E('Five c', 4, '13:00', 'Kwik Fit, Kirkstall Rd, Leeds', 'personal'); E('Five d', 4, '18:30', '', 'family'); T('Five e', 4, '20:00', 'medium', 'family'); });
  await page.evaluate(() => { location.hash = '#/planner'; }); await page.waitForTimeout(300);
  return { ctx, page, errors };
}
const swipe = (page, sel, x0, y0, x1, y1) => page.evaluate(([sel, x0, y0, x1, y1]) => {
  const el = document.querySelector(sel); const mk = (x, y) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
  el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [mk(x0, y0)], targetTouches: [mk(x0, y0)], changedTouches: [mk(x0, y0)] }));
  el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [mk(x1, y1)] }));
}, [sel, x0, y0, x1, y1]);
(async () => {
  await new Promise((r) => server.listen(0, r)); base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  for (const theme of ['dark', 'light']) for (const w of [320, 390, 430]) {
    const { ctx, page, errors } = await boot(browser, { width: w, height: 844 }, theme); const tag = `${theme} ${w}px`;
    for (const mode of ['day', 'week', 'month']) {
      await page.click(`[data-mode="${mode}"]`); await page.waitForTimeout(200);
      const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      ok(`${tag}: ${mode} view has no horizontal overflow`, m.sw <= m.cw, JSON.stringify(m));
    }
    if (w === 390 && theme === 'dark') {
      await page.click('[data-mode="day"]'); await page.waitForTimeout(150);
      /* header + navigation */
      const arrows = await page.$$eval('.pl-arrow', (a) => a.map((x) => { const r = x.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), !!x.querySelector('svg'), x.getAttribute('aria-label')]; }));
      ok('date arrows are 44px icon buttons with labels', arrows.length === 2 && arrows.every(([wd, ht, svg, lbl]) => wd >= 44 && ht >= 44 && svg && /Previous|Next/.test(lbl)), JSON.stringify(arrows));
      ok('day view shows "Today" with the full date underneath', (await page.textContent('.pl-title')).trim() === 'Today' && /\w+day \d+ \w+/.test(await page.textContent('.pl-subtitle')));
      ok('Today pill is disabled on today', await page.isDisabled('.pl-today'));
      await page.click('[data-action="planner-next"]'); await page.waitForTimeout(150);
      ok('next day: subtitle says Tomorrow and Today pill is enabled', /Tomorrow/.test(await page.textContent('.pl-subtitle')) && !(await page.isDisabled('.pl-today')));
      await page.click('[data-action="planner-prev"]'); await page.click('[data-action="planner-prev"]'); await page.waitForTimeout(150);
      ok('previous day: subtitle says Yesterday', /Yesterday/.test(await page.textContent('.pl-subtitle')));
      await page.click('.pl-today'); await page.waitForTimeout(150);
      ok('Today pill returns to today', (await page.textContent('.pl-title')).trim() === 'Today');
      /* jump to date */
      const jump = await page.$eval('.pl-jump__in', (i) => ({ type: i.type, label: i.getAttribute('aria-label'), w: i.getBoundingClientRect().width }));
      ok('title is a jump-to-date control', jump.type === 'date' && /Jump/.test(jump.label) && jump.w > 100, JSON.stringify(jump));
      await page.fill('.pl-jump__in', '2027-01-15'); await page.waitForTimeout(250);
      ok('picking a date jumps there', /15 Jan/.test(await page.textContent('.pl-title')), await page.textContent('.pl-title'));
      await page.click('.pl-today'); await page.waitForTimeout(150);
      /* swipe */
      const t0 = (await page.textContent('.pl-title')).trim();
      await swipe(page, '.pl-day', 300, 500, 120, 505); await page.waitForTimeout(200);
      ok('swipe left goes to the next day', /Tomorrow/.test(await page.textContent('.pl-subtitle')), t0);
      await swipe(page, '.pl-day', 120, 500, 300, 505); await page.waitForTimeout(200);
      ok('swipe right goes back', (await page.textContent('.pl-title')).trim() === 'Today');
      await swipe(page, '.pl-day', 300, 400, 120, 560); await page.waitForTimeout(150);
      ok('a diagonal / vertical scroll does not change the date', (await page.textContent('.pl-title')).trim() === 'Today');
      await swipe(page, '.pl-day', 10, 500, 200, 502); await page.waitForTimeout(150);
      ok('a swipe from the very left edge is ignored (iPhone back gesture)', (await page.textContent('.pl-title')).trim() === 'Today');
      await swipe(page, '.pl-cats', 300, 380, 100, 382); await page.waitForTimeout(150);
      ok('swiping the category chips scrolls them, it does not change the date', (await page.textContent('.pl-title')).trim() === 'Today');
      /* week + month headings and keyboard */
      await page.click('[data-mode="week"]'); await page.waitForTimeout(150);
      ok('week view subtitle says This week', /This week/.test(await page.textContent('.pl-subtitle')));
      const lbl = await page.$eval('.pl-wd.is-today', (b) => [b.getAttribute('aria-label'), b.getAttribute('aria-current')]);
      ok('week days announce their item count and mark today', /\d+ items?/.test(lbl[0]) && lbl[1] === 'date', JSON.stringify(lbl));
      await page.focus('.pl-wd.is-sel'); const before = await page.$eval('.pl-wd.is-sel', (b) => b.dataset.date);
      await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150);
      const after = await page.evaluate(() => [document.activeElement.dataset.date, document.activeElement.classList.contains('is-sel')]);
      ok('arrow keys move the selected day and keep focus', after[0] > before && after[1] === true, JSON.stringify([before, after]));
      await page.click('[data-mode="month"]'); await page.waitForTimeout(150);
      ok('month view subtitle says This month', /This month/.test(await page.textContent('.pl-subtitle')));
      await page.focus('.pl-mc.is-sel'); const mb = await page.$eval('.pl-mc.is-sel', (b) => b.dataset.date); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(150);
      ok('month: arrow down moves a week', await page.evaluate((mb) => { const d = document.activeElement.dataset.date; return !!d && d > mb; }, mb));
      await page.click('.pl-today').catch(() => {}); await page.click('[data-mode="day"]'); await page.waitForTimeout(150);
      /* cards */
      ok('appointment cards use the event style', (await page.$$('.pl-row.is-event')).length >= 2);
      ok('time is a bold, prominent label', await page.$eval('.pl-row.is-event .pl-time b', (b) => parseFloat(getComputedStyle(b).fontWeight) >= 700));
      ok('rows show a chevron to signal they open', (await page.$$('.pl-row .pl-chev')).length === (await page.$$('.pl-row')).length);
      const next = await page.$$eval('.pl-chip--next', (n) => n.length);
      ok('exactly one "Next up" marker on today', next === 1, String(next));
      const nextTitle = await page.$eval('.pl-row.is-next strong', (s) => s.textContent.trim());
      ok('"Next up" is the first upcoming timed item', /No address appt/.test(nextTitle), nextTitle);
      ok('day heading summarises items and appointments', /\d+ items? · \d+ appointments?/.test(await page.textContent('.pl-hsub')), await page.textContent('.pl-hsub'));
      const links = await page.$$eval('.pl-row .mapbtn', (a) => a.map((x) => x.href));
      ok('address and Google/Apple buttons are kept on appointment cards', links.length === 2 && /google\.com\/maps\/dir\/\?api=1&destination=Headingley%20Dental/.test(links[0]) && /maps\.apple\.com\/\?daddr=Headingley%20Dental/.test(links[1]), links.join(' '));
      ok('appointment without an address shows no map buttons', await page.evaluate(() => { const r = [...document.querySelectorAll('.pl-row')].find((x) => /No address appt/.test(x.textContent)); return !!r && !r.querySelector('.mapbtn, .loc'); }));
      /* grouping */
      ok('a light day (under 4 items) has no time-of-day headings', (await page.$$('.pl-grp')).length === 0);
      await page.fill('.pl-jump__in', await page.evaluate(() => new Date(Date.now() + 4 * 864e5).toLocaleDateString('en-CA'))); await page.waitForTimeout(250);
      const grp = await page.$$eval('.pl-grp', (g) => g.map((x) => x.textContent));
      ok('a busy day is grouped All day / Morning / Afternoon / Evening', grp.join('|') === 'All day|Morning|Afternoon|Evening', grp.join('|'));
      ok('grouped rows are still draggable and editable', (await page.$$('.pl-row[data-drag]')).length === 5);
      /* behaviours kept */
      await page.click('.pl-row:has-text("Five a") .pl-body'); await page.waitForTimeout(400);
      ok('tapping a card still opens it for editing', await page.isVisible('#m-task .sheet'));
      await page.keyboard.press('Escape'); await page.waitForTimeout(400);
      await page.click('.pl-row:has-text("Five a") .check'); await page.waitForTimeout(250);
      ok('ticking a task still works', await page.evaluate(() => DAYMATE.Store.state.tasks.find((t) => t.title === 'Five a').completed === true));
      await page.click('[data-cat="work"]'); await page.waitForTimeout(150);
      ok('category filter still works', (await page.$$('.pl-row')).every((r) => true) && (await page.$$('.pl-row[data-cat="family"]')).length === 0);
      await page.click('[data-cat="all"]');
      const dots = await page.$eval('.pl-cats .chip[data-cat="family"]', (c) => getComputedStyle(c, '::before').width);
      ok('category chips carry their colour dot', dots === '8px', dots);
      const tp = await page.evaluate(() => { const c = document.querySelector('.pl-today'); const r = c.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y - 3); return r.height >= 36 && (e === c || c.contains(e)); });
      ok('Today pill has a 44px touch area', tp);
      await page.click('[data-action="planner-add-event"]'); await page.waitForTimeout(400);
      ok('adding an appointment from the Planner still opens the form', await page.isVisible('#m-reminder .sheet'));
    }
    ok(`${tag}: no script errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  { const { ctx, page, errors } = await boot(browser, { width: 1280, height: 900 }, 'dark');
    for (const mode of ['day', 'week', 'month']) { await page.click(`[data-mode="${mode}"]`); await page.waitForTimeout(150); ok(`desktop: ${mode} has no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)); }
    ok('desktop: no script errors', errors.length === 0, errors.join(' | ')); await ctx.close(); }
  await browser.close(); server.close();
  const pass = results.filter(Boolean).length; console.log(`\n${pass}/${results.length} passed`); process.exit(pass === results.length ? 0 : 1);
})();
