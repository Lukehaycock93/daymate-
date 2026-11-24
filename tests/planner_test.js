// Browser tests: Stage C planner. Run: node tests/planner_test.js
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
const results = []; const ok = (n, c, d = '') => results.push([n, !!c, d]);
(async () => {
  await new Promise((r) => server.listen(0, r)); const base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await ctx.route(/supabase\.co/, (r) => r.abort());
  await ctx.route(/googletagmanager|google-analytics/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem('daymate:consent', JSON.stringify({ analytics: false })); } catch (_) {} });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base); await page.waitForFunction(() => window.DAYMATE);
  await page.fill('#welcomeName', 'Luke'); await page.click('#welcomeForm button[type=submit]'); await page.waitForTimeout(500);
  await page.evaluate(() => localStorage.setItem('daymate:consent', JSON.stringify({ analytics: false })));
  const D = (off) => page.evaluate((o) => { const d = new Date(); d.setDate(d.getDate() + o); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }, off);
  const today = await D(0), tomorrow = await D(1), yesterday = await D(-1), lastWeek = await D(-7), in3 = await D(3);

  await page.evaluate(() => { location.hash = '#/planner'; }); await page.waitForSelector('.pl');
  ok('planner route renders (no preview screen)', !!(await page.$('.pl-modes')) && !(await page.$('#view-planner .hero')));
  ok('boots without errors', errors.length === 0, errors.join('|'));
  ok('empty day shows empty state', /clear day/i.test(await page.textContent('.pl-day')));

  // --- add via the real sheets ---
  await page.click('[data-action="planner-add-task"]'); await page.waitForSelector('#m-task.is-open');
  ok('new task sheet preset to selected day', (await page.inputValue('#taskDate')) === today);
  await page.fill('#taskTitle', 'Pay electricity'); await page.click('#taskForm .seg__opt--urgent');
  await page.selectOption('#taskCategory', 'bills'); await page.selectOption('#taskRepeat', 'weekly');
  await page.click('#taskForm button[type=submit]'); await page.waitForTimeout(300);
  let t = await page.evaluate(() => DAYMATE.Store.state.tasks[0]);
  ok('task saved with urgent / bills / weekly', t && t.priority === 'urgent' && t.category === 'bills' && t.repeat === 'weekly', JSON.stringify(t));
  ok('row shows Urgent + Bills + Weekly', /Urgent/.test(await page.textContent('.pl-row')) && /Bills/.test(await page.textContent('.pl-row')) && /Weekly/.test(await page.textContent('.pl-row')));

  await page.click('[data-action="planner-add-event"]'); await page.waitForSelector('#m-reminder.is-open');
  ok('appointment button preselects Appointment', await page.isChecked('input[name="kind"][value="event"]'));
  await page.fill('#reminderTitle', "Sam's school appointment"); await page.fill('#reminderTime', '14:30');
  await page.selectOption('#reminderCategory', 'family'); await page.check('#reminderImportant');
  await page.click('#reminderForm button[type=submit]'); await page.waitForTimeout(300);
  let ev = await page.evaluate(() => DAYMATE.Store.state.reminders[0]);
  ok('event saved family + important', ev && ev.kind === 'event' && ev.category === 'family' && ev.important === true, JSON.stringify(ev));
  const order = await page.$$eval('.pl-row strong', (e) => e.map((x) => x.textContent.trim()));
  ok('all-day items before timed items', order[0].includes('Pay electricity') && order[1].includes('school'), order.join(' | '));

  // --- views / navigation ---
  await page.click('[data-mode="week"]'); await page.waitForSelector('.pl-week');
  ok('week strip has 7 days', (await page.$$('.pl-wd')).length === 7);
  ok('today marked in week strip', !!(await page.$('.pl-wd.is-today')));
  await page.click('[data-mode="month"]'); await page.waitForSelector('.pl-month');
  ok('month grid has 42 cells + 7 headings', (await page.$$('.pl-mc')).length === 42 && (await page.$$('.pl-mh')).length === 7);
  ok('month remembers choice after reload', await (async () => { await page.reload(); await page.waitForFunction(() => window.DAYMATE); await page.evaluate(() => { location.hash = '#/planner'; }); await page.waitForSelector('.pl-month'); return true; })());
  const title0 = await page.textContent('.pl-title');
  await page.click('[data-action="planner-next"]'); const title1 = await page.textContent('.pl-title');
  await page.click('[data-action="planner-prev"]'); await page.click('[data-action="planner-prev"]'); const title2 = await page.textContent('.pl-title');
  await page.click('[data-action="planner-today"]');
  ok('month next/prev/today work', title0 !== title1 && title1 !== title2 && (await page.textContent('.pl-title')) === title0);
  ok('repeating task projected into future weeks (dashed row)', await (async () => { await page.click('[data-mode="day"]'); for (let i = 0; i < 7; i++) await page.click('[data-action="planner-next"]'); return /Pay electricity/.test(await page.textContent('.pl-day')); })());
  await page.click('[data-action="planner-today"]');

  // --- completing a repeating task spawns the next one, once ---
  await page.click('.pl-row[data-col="tasks"] .check'); await page.waitForTimeout(300);
  let tasks = await page.evaluate(() => DAYMATE.Store.state.tasks.map((x) => ({ d: x.date, c: x.completed, t: x.title })));
  const nextWeek = await D(7);
  ok('weekly task: next copy created for +7 days', tasks.length === 2 && tasks.some((x) => !x.c && x.d === nextWeek), JSON.stringify(tasks));
  await page.click('.pl-row[data-col="tasks"] .check'); await page.waitForTimeout(100); await page.click('.pl-row[data-col="tasks"] .check'); await page.waitForTimeout(300);
  tasks = await page.evaluate(() => DAYMATE.Store.state.tasks.length);
  ok('re-ticking does not pile up duplicates', tasks === 2, String(tasks));

  // --- overdue + roll forward ---
  await page.evaluate(([y, lw]) => { const S = DAYMATE.Store; S.add('tasks', { title: 'Late thing', priority: 'high', category: 'work', repeat: '', date: y, time: '', completed: false, completedOn: '', completedAt: '' });
    S.add('reminders', { title: 'Mum birthday', kind: 'event', category: 'family', repeat: 'yearly', important: true, date: lw, time: '', note: '', done: false }); }, [yesterday, lastWeek]);
  await page.waitForTimeout(300);
  ok('overdue banner + section list the late task', /[1-9]\d* overdue/.test(await page.textContent('.pl-stats')) && /Late thing/.test(await page.textContent('.pl-over')), await page.textContent('.pl-stats'));
  const bd = await page.evaluate(() => DAYMATE.Store.state.reminders.find((r) => r.title === 'Mum birthday').date);
  ok('past yearly event rolled forward (not overdue)', bd > today, bd);
  ok('important dates card appears', /Important dates/.test(await page.textContent('.pl')) );
  await page.click('[data-cat="work"]'); await page.waitForTimeout(200);
  ok('category filter hides other categories', !/Pay electricity/.test(await page.textContent('.pl-day')) && /Late thing/.test(await page.textContent('.pl-day')));
  await page.click('[data-cat="all"]');

  // --- drag and drop (mouse) ---
  await page.click('[data-mode="week"]'); await page.waitForSelector('.pl-week');
  await page.evaluate(([i3]) => DAYMATE.Store.add('tasks', { title: 'Drag me', priority: 'medium', category: 'personal', repeat: '', date: new Date().toLocaleDateString('en-CA'), time: '', completed: false, completedOn: '', completedAt: '' }), [in3]);
  await page.waitForTimeout(300);
  const row = await page.$('.pl-row[data-drag] >> text=Drag me'); const rb = await (await page.$('.pl-row:has-text("Drag me")')).boundingBox();
  const chip = await page.$(`.pl-wd[data-date="${tomorrow}"]`); const cb = await chip.boundingBox();
  await page.mouse.move(rb.x + 120, rb.y + rb.height / 2); await page.mouse.down(); await page.mouse.move(rb.x + 130, rb.y + 20, { steps: 3 });
  ok('ghost appears while dragging', !!(await page.$('.pl-ghost')));
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2, { steps: 6 });
  ok('target day highlighted', !!(await page.$('.is-drop')));
  await page.mouse.up(); await page.waitForTimeout(300);
  let moved = await page.evaluate(() => DAYMATE.Store.state.tasks.find((x) => x.title === 'Drag me').date);
  ok('mouse drag reschedules to the dropped day', moved === tomorrow, moved);
  ok('no edit sheet opened by the drop', !(await page.$('#m-task.is-open')));
  await page.click('.toast [data-action], .toast button').catch(() => {}); await page.waitForTimeout(300);
  moved = await page.evaluate(() => DAYMATE.Store.state.tasks.find((x) => x.title === 'Drag me').date);
  ok('Undo puts it back', moved === today, moved);

  // --- drag and drop (touch long-press) ---
  const touch = await page.evaluate(async ([tm]) => {
    const row = [...document.querySelectorAll('.pl-row')].find((r) => r.textContent.includes('Drag me'));
    const chip = document.querySelector(`.pl-wd[data-date="${tm}"]`); const rb = row.getBoundingClientRect(), cb = chip.getBoundingClientRect();
    const fire = (el, type, x, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, button: 0 }));
    fire(row.querySelector('.pl-body'), 'pointerdown', rb.x + 100, rb.y + 20);
    await new Promise((r) => setTimeout(r, 450));
    const ghostAfterHold = !!document.querySelector('.pl-ghost');
    fire(document, 'pointermove', cb.x + cb.width / 2, cb.y + cb.height / 2);
    fire(document, 'pointerup', cb.x + cb.width / 2, cb.y + cb.height / 2);
    await new Promise((r) => setTimeout(r, 300));
    return { ghostAfterHold, date: DAYMATE.Store.state.tasks.find((x) => x.title === 'Drag me').date };
  }, [tomorrow]);
  ok('touch: press-and-hold starts a drag', touch.ghostAfterHold);
  ok('touch: drop reschedules', touch.date === tomorrow, touch.date);
  const scroll = await page.evaluate(async () => {
    const row = [...document.querySelectorAll('.pl-row')].find((r) => r.textContent.includes('Drag me')) || document.querySelector('.pl-row[data-drag]');
    const before = row.dataset.date; const r = row.getBoundingClientRect();
    const fire = (el, type, x, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'touch', clientX: x, clientY: y, button: 0 }));
    fire(row.querySelector('.pl-body'), 'pointerdown', r.x + 100, r.y + 20); fire(document, 'pointermove', r.x + 100, r.y + 60);
    await new Promise((x) => setTimeout(x, 450));
    const started = !!document.querySelector('.pl-ghost'); fire(document, 'pointerup', r.x + 100, r.y + 60); return { started, before };
  });
  ok('touch: moving before the hold = scrolling, no drag', scroll.started === false);

  // --- edit sheet shows stored values ---
  await page.click('[data-action="planner-today"]').catch(() => {}); await page.click('[data-mode="day"]');
  await page.evaluate((d) => { document.querySelector('[data-action="planner-today"]').click(); }, today);
  await page.waitForTimeout(200);
  await page.click('.pl-row[data-col="tasks"][data-date="' + today + '"] [data-action="planner-edit-task"]').catch(async () => { await page.click('[data-action="planner-edit-task"]'); });
  await page.waitForSelector('#m-task.is-open');
  ok('edit sheet loads category/repeat/priority', ['bills', 'work', 'personal'].includes(await page.inputValue('#taskCategory')) && ['urgent', 'high', 'medium'].includes(await page.evaluate(() => document.querySelector('input[name="priority"]:checked').value)));
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);

  // --- Home still works with the new data ---
  await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForTimeout(400);
  ok('Home renders tasks incl. urgent', /Pay electricity/.test(await page.textContent('#view-home')) && /Urgent/.test(await page.textContent('#view-home')));
  ok('no page errors during whole run', errors.length === 0, errors.join('|'));
  // overflow
  await page.evaluate(() => { location.hash = '#/planner'; }); await page.click('[data-mode="month"]'); await page.waitForTimeout(300);
  ok('mobile: no horizontal overflow in month view', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await browser.close(); server.close();
  let bad = 0; results.forEach(([n, c, d]) => { if (!c) bad++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + d)); });
  console.log(`\n${results.length - bad}/${results.length} passed`); process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
