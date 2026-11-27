// Browser tests: appointment "Where" field + Google / Apple Maps buttons.   Run: node tests/maps_test.js
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
const results = []; const ok = (n, c, d = '') => { results.push(c); console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + d}`); };
(async () => {
  await new Promise((r) => server.listen(0, r)); const base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  for (const [label, vp] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 800 }]]) {
    const ctx = await browser.newContext({ viewport: vp, hasTouch: vp.width < 700 });
    await ctx.route(/supabase\.co|jsdelivr|googletagmanager|googlesyndication|open-meteo|postcodes/, (r) => r.abort());
    await ctx.addInitScript(() => { try { localStorage.setItem('daymate:consent', JSON.stringify({ analytics: false })); } catch (_) {} });
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base); await page.waitForFunction(() => window.DAYMATE);
    await page.fill('#welcomeName', 'Luke'); await page.click('#welcomeForm button[type=submit]'); await page.waitForTimeout(500);
    const today = await page.evaluate(() => DAYMATE.helpers.todayStr());
    const tomorrow = await page.evaluate(() => DAYMATE.helpers.addDays(DAYMATE.helpers.todayStr(), 1));
    const addr = 'Trinity House, 5 High St & Co, Leeds LS1 4AB (rear entrance) #2';

    // add through the real form
    await page.evaluate(() => DAYMATE.views.openReminderSheet());
    ok(`${label}: Where field hidden for a plain reminder`, await page.isHidden('#locationField'));
    await page.fill('#reminderTitle', 'Oral surgery'); await page.check('input[name=kind][value=event]');
    ok(`${label}: Where field appears for appointments`, await page.isVisible('#locationField'));
    await page.fill('#reminderDate', tomorrow); await page.fill('#reminderTime', '10:40'); await page.fill('#reminderLocation', addr);
    await page.click('#reminderSave'); await page.waitForTimeout(300);
    const saved = await page.evaluate(() => DAYMATE.Store.state.reminders.find((r) => r.title === 'Oral surgery'));
    ok(`${label}: location saved on the appointment`, saved && saved.location === addr, JSON.stringify(saved));

    // a no-address appointment and a reminder
    await page.evaluate(([d]) => { DAYMATE.Store.add('reminders', { title: 'No address appt', kind: 'event', category: 'personal', repeat: '', important: false, date: d, time: '12:00', note: '', location: '', done: false }); DAYMATE.Store.add('reminders', { title: 'Plain reminder', kind: 'reminder', category: 'personal', repeat: '', important: false, date: d, time: '', note: '', location: 'should not show', done: false }); }, [tomorrow]);
    await page.waitForTimeout(300);

    // home > upcoming
    await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForTimeout(300);
    const row = page.locator('li.up', { hasText: 'Oral surgery' });
    ok(`${label}: Upcoming shows the address`, (await row.locator('.loc__addr').textContent()).includes('Trinity House'));
    const g = await row.locator('.mapbtn').first().getAttribute('href'); const a = await row.locator('.mapbtn--apple').getAttribute('href');
    const enc = encodeURIComponent(addr);
    ok(`${label}: Google link has the encoded address`, g === `https://www.google.com/maps/dir/?api=1&destination=${enc}`, g);
    ok(`${label}: Apple link has the encoded address`, a === `https://maps.apple.com/?daddr=${enc}&dirflg=d`, a);
    ok(`${label}: special characters survive (& # ( ) , spaces)`, /%26/.test(g) && /%23/.test(g) && /%2C/.test(g) && !/ /.test(g));
    ok(`${label}: buttons open in a new tab, safely`, (await row.locator('.mapbtn').first().getAttribute('target')) === '_blank' && /noopener/.test(await row.locator('.mapbtn').first().getAttribute('rel')));
    ok(`${label}: buttons have accessible labels`, /Google Maps/.test(await row.locator('.mapbtn').first().getAttribute('aria-label')) && /Apple Maps/.test(await row.locator('.mapbtn--apple').getAttribute('aria-label')));
    const bb = await row.locator('.mapbtn').first().boundingBox();
    ok(`${label}: touch target at least 36px tall`, bb.height >= 36, JSON.stringify(bb));
    ok(`${label}: no buttons for an appointment without an address`, (await page.locator('li.up', { hasText: 'No address appt' }).locator('.mapbtn').count()) === 0);
    ok(`${label}: no buttons for a plain reminder`, (await page.locator('li.up', { hasText: 'Plain reminder' }).locator('.mapbtn').count()) === 0);
    const rb = await row.boundingBox(); ok(`${label}: row not wider than screen`, rb.x >= 0 && rb.x + rb.width <= vp.width + 1, JSON.stringify(rb));

    // other controls still work: tap the title opens the editor with the address
    await row.locator('.up__body').click(); await page.waitForTimeout(300);
    ok(`${label}: editing still works and shows the address`, (await page.inputValue('#reminderLocation')) === addr && await page.isVisible('#locationField'));
    await page.fill('#reminderLocation', '1 New Road, Leeds'); await page.click('#reminderSave'); await page.waitForTimeout(300);
    ok(`${label}: edit saves the new address`, (await page.evaluate(() => DAYMATE.Store.state.reminders.find((r) => r.title === 'Oral surgery').location)) === '1 New Road, Leeds');
    // switching an appointment to a reminder drops the address
    await page.evaluate(() => { const r = DAYMATE.Store.state.reminders.find((x) => x.title === 'Oral surgery'); DAYMATE.views.openReminderSheet(r.id); });
    await page.check('input[name=kind][value=reminder]'); ok(`${label}: Where hides when type changes`, await page.isHidden('#locationField'));
    await page.click('#reminderSave'); await page.waitForTimeout(300);
    ok(`${label}: no stray address kept on a reminder`, (await page.evaluate(() => DAYMATE.Store.state.reminders.find((r) => r.title === 'Oral surgery').location)) === '');
    await page.evaluate(() => { const r = DAYMATE.Store.state.reminders.find((x) => x.title === 'Oral surgery'); DAYMATE.Store.update('reminders', r.id, { kind: 'event', location: 'LS6 1AA' }); });

    // planner + dashboard timeline
    await page.evaluate(() => { location.hash = '#/planner'; }); await page.waitForTimeout(300);
    await page.evaluate((d) => { DAYMATE.setPresetDate && DAYMATE.setPresetDate(d); }, tomorrow);
    const hasPlanner = await page.evaluate(() => !!document.querySelector('.pl-row'));
    const plHtml = await page.evaluate(() => document.getElementById('view-planner').innerHTML);
    ok(`${label}: planner renders without errors`, hasPlanner || plHtml.length > 0);
    await page.evaluate((d) => { DAYMATE.Store.add('reminders', { title: 'Today appt', kind: 'event', category: 'personal', repeat: '', important: false, date: d, time: '23:00', note: '', location: 'LS6 1AA', done: false }); }, today);
    await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForTimeout(400);
    ok(`${label}: Today's schedule shows the buttons`, (await page.locator('.timeline__item', { hasText: 'Today appt' }).locator('.mapbtn').count()) === 2);
    await page.evaluate(() => { location.hash = '#/planner'; }); await page.waitForTimeout(400);
    ok(`${label}: planner row shows the buttons`, (await page.locator('.pl-row', { hasText: 'Today appt' }).locator('.mapbtn').count()) === 2);
    ok(`${label}: planner edit button still present`, (await page.locator('.pl-row', { hasText: 'Today appt' }).locator('[data-action="planner-edit-reminder"]').count()) === 1);
    ok(`${label}: no script errors`, errors.length === 0, errors.join('|'));
    await ctx.close();
  }
  await browser.close(); server.close();
  const bad = results.filter((r) => !r).length; console.log(bad ? `${bad} FAILED` : `${results.length}/${results.length} passed`); process.exit(bad ? 1 : 0);
})();
