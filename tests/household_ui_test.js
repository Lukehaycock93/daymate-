// Browser tests: Stage 6 Household.   Run: node tests/household_ui_test.js
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
const results = []; const ok = (n, c, d = '') => { results.push(c); console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + d}`); };
let base;
async function boot(browser, vp, theme) {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: vp.width < 700 });
  await ctx.route(/supabase\.co|jsdelivr|googletagmanager|googlesyndication/, (r) => r.abort());
  await ctx.route(/open-meteo|postcodes\.io/, (r) => r.abort());
  await ctx.addInitScript((t) => { try { localStorage.setItem('daymate:consent', JSON.stringify({ analytics: false })); localStorage.setItem('daymate:theme', t); } catch (_) {} }, theme);
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base); await page.waitForFunction(() => window.DAYMATE);
  await page.fill('#welcomeName', 'Luke'); await page.click('#welcomeForm button[type=submit]'); await page.waitForTimeout(400);
  await page.evaluate(() => { location.hash = '#/household'; }); await page.waitForSelector('#view-household .hh'); 
  return { ctx, page, errors };
}
const overflow = (page) => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
(async () => {
  await new Promise((r) => server.listen(0, r)); base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  for (const theme of ['dark', 'light']) for (const w of [320, 390]) {
    const { ctx, page, errors } = await boot(browser, { width: w, height: 844 }, theme); const tag = `${theme} ${w}px`;
    ok(`${tag}: empty state offers quick starts for all three`, (await page.$$('#view-household .hh-starters')).length === 3);
    ok(`${tag}: Shopping row still opens the list`, await (async () => { await page.click('.hh-shop'); await page.waitForSelector('#m-shopping .sheet', { state: 'visible' }); const o = await page.isVisible('#shoppingInput'); await page.keyboard.press('Escape'); await page.waitForTimeout(350); return o; })());
    // chore via quick start
    await page.click('.hh-starters [data-title="Take the bins out"]'); await page.waitForSelector('#m-household .sheet', { state: 'visible' });
    ok(`${tag}: quick start prefills the sheet`, (await page.inputValue('#hhTitle')) === 'Take the bins out' && (await page.inputValue('#hhRepeat')) === 'weekly');
    await page.fill('#hhTitle', ''); await page.click('#hhSave');
    ok(`${tag}: empty title is refused with a message`, /name/i.test(await page.textContent('#hhTitleError')));
    await page.fill('#hhTitle', 'Take the bins out'); await page.click('#hhSave'); await page.waitForTimeout(300);
    let c = await page.evaluate(() => DAYMATE.Store.state.household.find((i) => i.kind === 'chore'));
    ok(`${tag}: chore saved, weekly, due today by default`, c && c.every === 'weekly' && c.due === new Date().toLocaleDateString('en-CA'), JSON.stringify(c));
    ok(`${tag}: chore row shows "Today"`, /Today/.test(await page.textContent('.hh-row--today')));
    await page.click('.hh-row [data-action="hh-done"]'); await page.waitForTimeout(250);
    c = await page.evaluate(() => DAYMATE.Store.state.household.find((i) => i.kind === 'chore'));
    ok(`${tag}: ticking rolls the chore to next week and records last done`, c.due > c.lastDone && c.lastDone === new Date().toLocaleDateString('en-CA') && !c.done, JSON.stringify(c));
    ok(`${tag}: row now says "In 7 days" with Last done`, /In 7 days/.test(await page.textContent('#view-household .hh-list')) && /Last done/.test(await page.textContent('#view-household .hh-list')));
    await page.click('.toast button, .toast [data-action]'); await page.waitForTimeout(250);
    c = await page.evaluate(() => DAYMATE.Store.state.household.find((i) => i.kind === 'chore'));
    ok(`${tag}: Undo restores the previous due date`, c.due === new Date().toLocaleDateString('en-CA') && !c.lastDone, JSON.stringify(c));
    // overdue + one-off
    await page.evaluate(() => { const S = DAYMATE.Store; const y = new Date(Date.now() - 3 * 864e5).toLocaleDateString('en-CA'); S.add('household', { kind: 'chore', title: 'Fix the gate', text: '', every: '', due: y, lastDone: '', done: false }); });
    await page.waitForTimeout(200);
    ok(`${tag}: overdue chore sorts first with a red "3 days overdue" badge`, await page.$eval('.hh-row', (e) => /Fix the gate/.test(e.textContent) && /3 days overdue/.test(e.textContent)));
    ok(`${tag}: overview counts the overdue chore`, /overdue/.test(await page.textContent('.hh-over__top p')) && (await page.$('.sumchip.is-alert')) !== null);
    await page.click('.hh-row--overdue [data-action="hh-done"]'); await page.waitForTimeout(250);
    ok(`${tag}: one-off chore becomes Done and drops to the bottom`, await page.$eval('.hh-list', (l) => { const r = l.lastElementChild; return /Fix the gate/.test(r.textContent) && /Done/.test(r.textContent); }));
    await page.click('.hh-row--done [data-action="hh-done"]'); await page.waitForTimeout(250);
    ok(`${tag}: ticking a done one-off reopens it`, !(await page.evaluate(() => DAYMATE.Store.state.household.find((i) => i.title === 'Fix the gate').done)));
    // date
    await page.click('[data-action="hh-new"][data-kind="date"].chip-btn'); await page.waitForSelector('#m-household .sheet', { state: 'visible' });
    await page.fill('#hhTitle', 'Car MOT'); await page.click('#hhSave');
    ok(`${tag}: key date needs a date`, /Pick a date/.test(await page.textContent('#hhDateError')));
    const in5 = await page.evaluate(() => new Date(Date.now() + 5 * 864e5).toLocaleDateString('en-CA'));
    await page.fill('#hhDate', in5); await page.selectOption('#hhRepeat', 'yearly'); await page.fill('#hhText', 'Garage on Otley Rd'); await page.click('#hhSave'); await page.waitForTimeout(300);
    ok(`${tag}: key date shows "In 5 days" and repeats yearly`, /In 5 days/.test(await page.textContent('#view-household')) && /every year/.test(await page.textContent('#view-household')));
    ok(`${tag}: overview shows next key date`, /Car MOT/.test(await page.textContent('.hh-next')));
    // note
    await page.click('.hh-starters [data-title="Wifi"]'); await page.waitForSelector('#m-household .sheet', { state: 'visible' });
    ok(`${tag}: note sheet hides date and repeat`, !(await page.isVisible('#hhDate')) && !(await page.isVisible('#hhRepeat')));
    await page.fill('#hhText', 'Network: Home\nPassword: hunter2'); await page.click('#hhSave'); await page.waitForTimeout(300);
    ok(`${tag}: note saved with line breaks`, await page.evaluate(() => DAYMATE.Store.state.household.some((i) => i.kind === 'note' && i.text.includes('\n'))));
    // edit + delete + undo
    await page.click('.hh-note [data-action="hh-edit"]'); await page.waitForSelector('#m-household .sheet', { state: 'visible' });
    ok(`${tag}: editing opens with the saved text`, (await page.inputValue('#hhText')).includes('hunter2') && /Edit note/.test(await page.textContent('#hhSheetTitle')));
    await page.fill('#hhTitle', 'Wifi (home)'); await page.click('#hhSave'); await page.waitForTimeout(300);
    ok(`${tag}: edit saved`, /Wifi \(home\)/.test(await page.textContent('.hh-notes')));
    await page.click('.hh-note [data-action="hh-edit"]'); await page.waitForSelector('#m-household .sheet', { state: 'visible' }); await page.click('#hhDelete'); await page.waitForTimeout(300);
    ok(`${tag}: delete removes the note`, !(await page.evaluate(() => DAYMATE.Store.state.household.some((i) => i.kind === 'note'))));
    await page.click('.toast button, .toast [data-action]'); await page.waitForTimeout(250);
    ok(`${tag}: undo brings the note back`, await page.evaluate(() => DAYMATE.Store.state.household.some((i) => i.kind === 'note' && i.title === 'Wifi (home)')));
    // persistence
    await page.waitForTimeout(700); await page.reload(); await page.waitForFunction(() => window.DAYMATE); await page.waitForTimeout(500);
    const counts = await page.evaluate(() => ['chore', 'date', 'note'].map((k) => DAYMATE.Store.state.household.filter((i) => i.kind === k).length));
    ok(`${tag}: everything survives a reload`, JSON.stringify(counts) === '[2,1,1]', JSON.stringify(counts));
    // offline
    await ctx.setOffline(true);
    await page.evaluate(() => { location.hash = '#/household'; }); await page.waitForSelector('#view-household .hh');
    await page.click('[data-action="hh-new"][data-kind="note"].chip-btn'); await page.fill('#hhTitle', 'Offline note'); await page.click('#hhSave'); await page.waitForTimeout(300);
    ok(`${tag}: works offline`, /Offline note/.test(await page.textContent('#view-household')));
    await ctx.setOffline(false);
    // layout
    await page.waitForSelector('#view-household .hh');
    await page.fill && 0;
    const m = await overflow(page); ok(`${tag}: no horizontal overflow`, m.sw <= m.cw, JSON.stringify(m));
    await page.evaluate(() => DAYMATE.Store.add('household', { kind: 'chore', title: 'A very long chore name '.repeat(3).slice(0, 80), text: '', every: 'monthly', due: new Date().toLocaleDateString('en-CA'), lastDone: '', done: false }));
    await page.waitForTimeout(200); const m2 = await overflow(page); ok(`${tag}: long names wrap, no overflow`, m2.sw <= m2.cw, JSON.stringify(m2));
    const small = await page.$$eval('#view-household button', (bs) => bs.filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.height < 28 || r.width < 28); }).length);
    ok(`${tag}: tap targets at least 28px`, small === 0, String(small));
    ok(`${tag}: Premium teasers present`, (await page.$$('#view-household .feature--premium')).length === 2);
    ok(`${tag}: no page errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  await browser.close(); server.close(); const f = results.filter((x) => !x).length; console.log(`\n${results.length - f}/${results.length} passed`); process.exit(f ? 1 : 0);
})();
