// Browser tests: Stage 2 glass design foundation + navigation.   Run: node tests/glass_test.js
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
const results = []; const ok = (n, c, d = '') => { results.push(c); console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + d}`); };
const SHOTS = process.env.SHOTS || '';
let base;
async function boot(browser, vp, theme, extra = {}) {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: vp.width < 700, ...extra });
  await ctx.route(/supabase\.co|jsdelivr|googletagmanager|googlesyndication|open-meteo|postcodes\.io/, (r) => r.abort());
  await ctx.addInitScript((t) => { try { localStorage.setItem('daymate:consent', JSON.stringify({ analytics: false })); localStorage.setItem('daymate:theme', t); } catch (_) {} }, theme);
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base); await page.waitForFunction(() => window.DAYMATE);
  await page.fill('#welcomeName', 'Luke'); await page.click('#welcomeForm button[type=submit]'); await page.waitForTimeout(500);
  return { ctx, page, errors };
}
(async () => {
  await new Promise((r) => server.listen(0, r)); base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  const ROUTES = ['home', 'planner', 'wellbeing', 'household', 'more', 'money', 'notifications', 'memory'];

  for (const theme of ['dark', 'light']) for (const w of [320, 390, 430]) {
    const { ctx, page, errors } = await boot(browser, { width: w, height: 800 }, theme);
    const tag = `${theme} ${w}px`;
    if (w === 390) {
      ok(`${tag}: nav order is Home, Planner, Wellbeing, Household, More`, (await page.$$eval('.nav__item span', (n) => n.map((x) => x.textContent))).join('|') === 'Home|Planner|Wellbeing|Household|More');
      ok(`${tag}: no Money tab in the nav`, !(await page.$('.nav__item[data-route="money"]')));
      const nav = await page.$eval('.nav', (n) => { const c = getComputedStyle(n), r = n.getBoundingClientRect(); return { pos: c.position, blur: c.backdropFilter || c.webkitBackdropFilter, radius: parseFloat(c.borderTopLeftRadius), floatsAbove: innerHeight - r.bottom, left: r.left, right: innerWidth - r.right }; });
      ok(`${tag}: nav floats above the screen edge with rounded glass`, nav.pos === 'fixed' && nav.floatsAbove >= 8 && nav.radius >= 20 && /blur/.test(nav.blur || ''), JSON.stringify(nav));
      ok(`${tag}: nav stays inside the screen sides`, nav.left >= 8 && nav.right >= 8, JSON.stringify(nav));
      const tap = await page.$$eval('.nav__item', (n) => n.map((x) => x.getBoundingClientRect()).every((r) => r.height >= 44 && r.width >= 44));
      ok(`${tag}: nav targets are at least 44px`, tap);
      const cards = await page.$eval('.card', (c) => getComputedStyle(c).backdropFilter);
      ok(`${tag}: ordinary cards do not use blur (performance)`, !cards || cards === 'none');
    }
    for (const r of ROUTES) {
      await page.evaluate((h) => { location.hash = h; }, '#/' + r); await page.waitForTimeout(220);
      const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      const wide = m.sw > m.cw ? await page.evaluate((cw) => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > cw + 1).slice(0, 4).map((e) => e.tagName + '.' + e.className + '<' + e.parentElement.className + '> ' + e.textContent.slice(0,14) + ' r' + Math.round(e.getBoundingClientRect().right)), m.cw) : [];
      ok(`${tag}: #/${r} has no horizontal overflow`, m.sw <= m.cw, JSON.stringify(m) + ' ' + wide.join(' ; '));
      if (SHOTS && w === 390) await page.screenshot({ path: path.join(SHOTS, `${theme}-${r}.png`) });
    }
    // last item on the page can scroll clear of the floating nav
    await page.evaluate(() => { location.hash = '#/more'; }); await page.waitForTimeout(250);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await page.waitForTimeout(150);
    const clear = await page.evaluate(() => { const nav = document.querySelector('.nav').getBoundingClientRect(); const last = [...document.querySelectorAll('#view-more .about, #view-more .row')].pop().getBoundingClientRect(); return last.bottom <= nav.top + 1; });
    ok(`${tag}: end of the page scrolls clear of the nav`, clear);
    ok(`${tag}: no script errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // Money still reachable and keeps its content; Wellbeing is a placeholder only
  { const { ctx, page, errors } = await boot(browser, { width: 390, height: 844 }, 'dark');
    await page.evaluate(() => { location.hash = '#/more'; }); await page.waitForTimeout(250);
    ok('More has a Money row', !!(await page.$('#view-more a[href="#/money"]')));
    await page.click('#view-more a[href="#/money"]'); await page.waitForTimeout(250);
    ok('Money screen still renders its content', /Calm control of your money/.test(await page.textContent('#view-money')) && (await page.$$('#view-money .features')).length > 0);
    ok('Money highlights More in the nav', (await page.getAttribute('.nav__item[data-route="more"]', 'aria-current')) === 'page');
    await page.click('.nav__item[data-route="wellbeing"]'); await page.waitForTimeout(250);
    ok('Wellbeing opens as a simple coming-soon screen', /Wellbeing/.test(await page.textContent('#hdTitle')) && /Coming in a future update/.test(await page.textContent('#view-wellbeing')));
    ok('Wellbeing has no fake controls', (await page.$$('#view-wellbeing button, #view-wellbeing input')).length === 0);
    ok('Wellbeing tab is highlighted', (await page.getAttribute('.nav__item[data-route="wellbeing"]', 'aria-current')) === 'page');
    // sheet glass
    await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForTimeout(200);
    await page.click('#aiFab'.replace('#aiFab', '[data-action="open-shopping"]')).catch(() => {}); await page.waitForTimeout(450);
    const sheet = await page.$eval('#m-shopping .sheet', (s) => { const c = getComputedStyle(s); return { blur: c.backdropFilter, bg: c.backgroundImage }; }).catch(() => null);
    ok('sheets use the glass blur', !!sheet && /blur/.test(sheet.blur || ''), JSON.stringify(sheet));
    const scrim = await page.$eval('#m-shopping .modal__scrim', (s) => getComputedStyle(s).backdropFilter).catch(() => 'x');
    ok('scrim has no second blur layer', scrim === 'none' || scrim === '' , scrim);
    ok('no script errors (nav / routes)', errors.length === 0, errors.join(' | '));
    await ctx.close(); }

  // Reduced motion: transitions collapse
  { const { ctx, page } = await boot(browser, { width: 390, height: 844 }, 'dark', { reducedMotion: 'reduce' });
    const d = await page.$eval('.nav__item', (n) => getComputedStyle(n).transitionDuration);
    ok('reduced motion shortens transitions', parseFloat(d) < 0.05, d);
    await ctx.close(); }

  // Desktop: floating sidebar, shell not covered
  { const { ctx, page, errors } = await boot(browser, { width: 1280, height: 800 }, 'dark');
    const r = await page.evaluate(() => { const n = document.querySelector('.nav').getBoundingClientRect(), s = document.querySelector('.shell').getBoundingClientRect(); return { navRight: n.right, shellLeft: s.left, navTop: n.top, navH: n.height, vh: innerHeight, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }; });
    ok('desktop: sidebar is a floating panel and the page sits beside it', r.navRight <= r.shellLeft && r.navTop >= 8 && r.navTop + r.navH <= r.vh - 8, JSON.stringify(r));
    ok('desktop: no horizontal overflow', r.sw <= r.cw);
    ok('desktop: no script errors', errors.length === 0, errors.join(' | '));
    await ctx.close(); }

  await browser.close(); server.close();
  const pass = results.filter(Boolean).length; console.log(`\n${pass}/${results.length} passed`); process.exit(pass === results.length ? 0 : 1);
})();
