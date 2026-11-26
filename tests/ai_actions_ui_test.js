// Browser tests: floating Daymate AI + actions (add / move / tick off / delete / shopping) + themes.
// Run: node tests/ai_actions_ui_test.js    (SHOTS=/some/dir also saves screenshots)
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'); const SHOTS = process.env.SHOTS || '';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
const results = []; const ok = (n, c, d = '') => results.push([n, !!c, d]);

async function boot(browser, { width = 390, height = 844, scheme = 'dark', pref } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, hasTouch: width < 700, deviceScaleFactor: 2 });
  await ctx.route(/supabase\.co|jsdelivr|googletagmanager|googlesyndication/, (r) => r.abort());
  await ctx.addInitScript((pref) => { try { localStorage.setItem('daymate:consent', JSON.stringify({ analytics: false })); if (pref) localStorage.setItem('daymate:theme', pref); } catch (_) {} }, pref || null);
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base); await page.waitForFunction(() => window.DAYMATE);
  await page.fill('#welcomeName', 'Luke'); await page.click('#welcomeForm button[type=submit]'); await page.waitForTimeout(500);
  return { ctx, page, errors };
}
let base;
const D = (page, off) => page.evaluate((o) => { const d = new Date(); d.setDate(d.getDate() + o); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }, off);

// Seed the planner and fake the signed-in server (replies are queued in window.__stub.next)
async function seed(page) {
  const [d1, d2, d3] = [await D(page, 1), await D(page, 2), await D(page, 3)]; const t0 = await D(page, 0);
  await page.evaluate(async ([t0, d1, d2, d3]) => {
    const { session } = await import('./js/session.js'); const { Store } = DAYMATE;
    Store.add('reminders', { title: 'Dentist', kind: 'event', category: 'personal', repeat: '', important: false, date: d3, time: '14:00', note: '', done: false });
    Store.add('reminders', { title: 'School run', kind: 'event', category: 'family', repeat: '', important: false, date: d1, time: '08:45', note: '', done: false });
    Store.add('tasks', { title: 'Call the bank', priority: 'high', category: 'personal', repeat: '', date: t0, time: '', completed: false, completedOn: '', completedAt: '' });
    Store.add('tasks', { title: 'Book MOT', priority: 'medium', category: 'personal', repeat: '', date: d2, time: '', completed: false, completedOn: '', completedAt: '' });
    Store.add('shopping', { name: 'Milk', checked: false });
    const state = { consent: new Date().toISOString(), calls: [], next: null };
    window.__stub = state;
    const q = () => { const b = { select() { return b; }, order() { return b; }, limit() { return b; }, eq() { return b; }, update() { return b; }, delete() { return b; },
      maybeSingle: () => Promise.resolve({ data: { ai_consent_at: state.consent }, error: null }),
      then(res, rej) { return Promise.resolve({ data: [], error: null }).then(res, rej); } }; return b; };
    session.client = { from: q, functions: { invoke: async (name, { body }) => { state.calls.push(body); const r = state.next; state.next = null; return r; } } };
    session.user = { id: 'u1', email: 'a@b.c' };
    DAYMATE.Account.set({ configured: true, user: { id: 'u1', email: 'a@b.c' } });
  }, [t0, d1, d2, d3]);
  await page.waitForTimeout(400);
  return { t0, d1, d2, d3 };
}
const reply = (page, o) => page.evaluate((o) => { window.__stub.next = { data: { conversationId: 'c1', messageId: 'm' + Math.random().toString(36).slice(2, 8), plan: 'free', used: 1, limit: 10, today: '', proposals: [], ...o }, error: null }; }, o);
const P = (o) => ({ op: 'add', kind: 'task', title: '', date: null, time: null, priority: 'medium', category: 'personal', repeat: '', important: false, note: '', date_basis: '', needs_clarification: null, conflict: null, items: [], target: null, changes: null, ask_date: false, ...o });
const ask = async (page, text) => { await page.fill('#aiInput', text); await page.click('.ai-send'); await page.waitForSelector('.ai-msg--assistant:last-child .ai-bubble:not(.ai-typing)'); await page.waitForTimeout(250); };
const state = (page, col) => page.evaluate((c) => DAYMATE.Store.state[c].map((x) => ({ ...x })), col);
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };

(async () => {
  await new Promise((r) => server.listen(0, r)); base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();

  /* ---------- phone, dark ---------- */
  let { ctx, page, errors } = await boot(browser);
  await shot(page, '01-home-dark');
  ok('floating button is on the home screen', await page.isVisible('#aiFab'));
  for (const h of ['#/planner', '#/money', '#/household', '#/more']) { await page.evaluate((h) => { location.hash = h; }, h); await page.waitForTimeout(250); ok(`floating button visible on ${h}`, await page.isVisible('#aiFab')); }
  await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForTimeout(200);
  const box = await page.locator('#aiFab').boundingBox(); const navBox = await page.locator('#nav').boundingBox();
  ok('button sits above the bottom navigation, not over it', box.y + box.height <= navBox.y + 2, JSON.stringify([box, navBox]));
  const ids = await seed(page);

  await page.evaluate(() => { const { Store } = DAYMATE; const d = new Date(); const p = (n) => String(n).padStart(2, '0'); const t = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; Store.add('reminders', { title: 'Parents’ evening', kind: 'event', category: 'family', repeat: '', important: false, date: t, time: '23:30', note: '', done: false }); Store.add('reminders', { title: 'Pay water bill', kind: 'bill', category: 'bills', repeat: '', important: false, date: t, time: '', note: '', done: false }); });
  await page.waitForTimeout(300);
  ok('dashboard: Today’s schedule lists today’s items in time order', /Today’s schedule/.test(await page.textContent('#view-home')) && (await page.$$eval('.timeline__item strong', (e) => e.map((x) => x.textContent))).join('|') === 'Pay water bill|Parents’ evening', (await page.$$eval('.timeline__item strong', (e) => e.map((x) => x.textContent))).join('|'));
  ok('dashboard: next-up is highlighted', !!(await page.$('.timeline__item.is-next')));
  ok('dashboard: shopping overview shows the list', /Milk/.test(await page.textContent('.shopmini__card')) && /1 to buy/.test(await page.textContent('#shopHeading + .chip-btn')));
  await shot(page, '05-home-seeded-dark');
  await page.tap('.askbar'); await page.waitForSelector('#aiSheet.is-open'); ok('dashboard: "Ask Daymate AI" bar opens the assistant', true);
  await page.keyboard.press('Escape'); await page.waitForTimeout(450);
  await page.tap('#aiFab'); await page.waitForSelector('#aiSheet.is-open'); await page.waitForTimeout(500);
  ok('sheet opens with the title "Daymate AI"', (await page.textContent('#aiSheetTitle')) === 'Daymate AI');
  ok('suggested prompts shown (5)', (await page.$$('.ai-starters .chip')).length === 5);
  const labels = await page.$$eval('.ai-starters .chip', (els) => els.map((e) => e.textContent));
  ok('prompts are the ones asked for', ['Plan my day', 'What’s coming up?', 'Add an event', 'Organise my tasks', 'Create a shopping list'].every((l) => labels.includes(l)), labels.join('|'));
  ok('button hides while the sheet is open', !(await page.evaluate(() => getComputedStyle(document.getElementById('aiFab')).opacity === '1')));
  await shot(page, '02-sheet-open-dark');
  const pb = await page.locator('.ai-sheet__panel').boundingBox();
  ok('on a phone the sheet fills the width and most of the height', pb.width >= 388 && pb.height > 780, JSON.stringify(pb));

  // starter that fills the box instead of sending
  await page.click('.ai-starters .chip:has-text("Add an event")');
  ok('"Add an event" fills the box and waits', (await page.inputValue('#aiInput')).startsWith('Add an appointment') && (await page.evaluate(() => window.__stub.calls.length)) === 0);
  await page.fill('#aiInput', '');

  // 1) add: appointment + shopping, applied immediately with Undo
  await reply(page, { reply: 'I’ve added a dentist check-up and put bread and eggs on your list.', proposals: [
    P({ kind: 'event', title: 'Hygienist', date: ids.d2, time: '10:30', category: 'personal' }),
    P({ kind: 'shopping', title: 'Bread, Eggs', items: ['Bread', 'Eggs', 'milk'] }) ] });
  await ask(page, 'Add hygienist on Friday at 10:30 and bread and eggs to my shopping list');
  let rem = await state(page, 'reminders'); let shop = await state(page, 'shopping');
  ok('appointment was added straight away', rem.some((r) => r.title === 'Hygienist' && r.date === ids.d2 && r.time === '10:30' && r.kind === 'event'));
  ok('shopping items added, duplicate "milk" skipped', shop.map((s) => s.name).sort().join() === 'Bread,Eggs,Milk', shop.map((s) => s.name).join());
  ok('cards show what happened', /Added “Hygienist”/.test(await page.textContent('.ai-msg:last-child')) && /Added 2 items/.test(await page.textContent('.ai-msg:last-child')));
  await shot(page, '03-actions-applied-dark');
  await page.click('.ai-msg:last-child .ai-prop:nth-child(2) [data-action="ai-undo"]'); await page.waitForTimeout(200);
  shop = await state(page, 'shopping');
  ok('Undo removes just those shopping items', shop.map((s) => s.name).join() === 'Milk');
  ok('undone card offers to apply again', !!(await page.$('.ai-msg:last-child .ai-prop:nth-child(2) [data-action="ai-add"]')));
  await page.click('.ai-msg:last-child .ai-prop:nth-child(2) [data-action="ai-add"]'); await page.waitForTimeout(200);
  ok('...and applying again works', (await state(page, 'shopping')).length === 3);

  // 2) move an appointment (update), only the date changes
  const dentist = (await state(page, 'reminders')).find((r) => r.title === 'Dentist');
  await reply(page, { reply: 'I’ve moved your dentist appointment to Monday.', proposals: [P({ op: 'update', kind: 'event', title: 'Dentist', target: { id: dentist.id, kind: 'event', title: 'Dentist', date: dentist.date, time: '14:00' }, changes: { date: ids.d3 } })] });
  const newDate = await D(page, 5);
  await page.evaluate(([id, nd]) => { window.__stub.next.data.proposals[0].changes.date = nd; }, [dentist.id, newDate]);
  await ask(page, 'Move my dentist appointment to Monday');
  const after = (await state(page, 'reminders')).find((r) => r.id === dentist.id);
  ok('appointment moved, time kept', after.date === newDate && after.time === '14:00' && after.title === 'Dentist');
  await page.click('.ai-msg:last-child [data-action="ai-undo"]'); await page.waitForTimeout(150);
  ok('Undo puts the date back', (await state(page, 'reminders')).find((r) => r.id === dentist.id).date === dentist.date);

  // 3) tick off a task
  const bank = (await state(page, 'tasks')).find((t) => t.title === 'Call the bank');
  await reply(page, { reply: 'Done — ticked off.', proposals: [P({ op: 'complete', kind: 'task', title: 'Call the bank', target: { id: bank.id, kind: 'task', title: 'Call the bank', date: bank.date, time: null } })] });
  await ask(page, 'I called the bank');
  ok('task marked done', (await state(page, 'tasks')).find((t) => t.id === bank.id).completed === true);

  // 4) delete ALWAYS waits for confirmation
  const mot = (await state(page, 'tasks')).find((t) => t.title === 'Book MOT');
  await reply(page, { reply: 'I’ll delete “Book MOT” once you confirm.', proposals: [P({ op: 'delete', kind: 'task', title: 'Book MOT', target: { id: mot.id, kind: 'task', title: 'Book MOT', date: mot.date, time: null } })] });
  await ask(page, 'Delete my MOT task');
  ok('nothing deleted yet', (await state(page, 'tasks')).some((t) => t.id === mot.id));
  ok('delete card asks for confirmation', /Delete/.test(await page.textContent('.ai-prop.is-delete')) && !!(await page.$('.ai-prop.is-delete .btn--danger')));
  await shot(page, '04-delete-confirm-dark');
  await page.click('.ai-prop.is-delete [data-action="ai-skip"]'); await page.waitForTimeout(150);
  ok('"Keep it" leaves it alone', (await state(page, 'tasks')).some((t) => t.id === mot.id));
  await reply(page, { reply: 'Confirm to delete.', proposals: [P({ op: 'delete', kind: 'task', title: 'Book MOT', target: { id: mot.id, kind: 'task', title: 'Book MOT', date: mot.date, time: null } })] });
  await ask(page, 'Delete my MOT task please');
  await page.click('.ai-msg:last-child .ai-prop.is-delete [data-action="ai-add"]'); await page.waitForTimeout(200);
  ok('after tapping Delete it is gone', !(await state(page, 'tasks')).some((t) => t.id === mot.id));
  await page.click('.ai-msg:last-child [data-action="ai-undo"]'); await page.waitForTimeout(150);
  ok('...and Undo brings it back', (await state(page, 'tasks')).some((t) => t.id === mot.id));

  // 5) an item that no longer exists is handled, not a crash
  await reply(page, { reply: 'Deleting.', proposals: [P({ op: 'delete', kind: 'task', title: 'Ghost', target: { id: 'nope-nope', kind: 'task', title: 'Ghost', date: null, time: null } })] });
  await ask(page, 'delete ghost');
  await page.click('.ai-msg:last-child .ai-prop [data-action="ai-add"]'); await page.waitForTimeout(150);
  ok('missing item: friendly message, nothing broke', /isn.t in your planner/.test(await page.textContent('.ai-msg:last-child')) && !errors.length, errors.join('|'));

  // 6) big batches wait for one tap; nothing is applied silently
  const before = (await state(page, 'tasks')).length;
  await reply(page, { reply: 'Here’s a plan.', proposals: Array.from({ length: 8 }, (_, i) => P({ kind: 'task', title: 'Batch ' + i, date: ids.d2 })) });
  await ask(page, 'add lots of things');
  ok('8 changes are not applied silently', (await state(page, 'tasks')).length === before && /Apply all 8/.test(await page.textContent('.ai-msg:last-child')));
  await page.click('[data-action="ai-add-all"]'); await page.waitForTimeout(250);
  ok('Apply all adds them', (await state(page, 'tasks')).length === before + 8);

  // 7) missing date asks, never guesses
  await reply(page, { reply: 'Which day?', proposals: [P({ kind: 'event', title: 'Haircut', date: null, needs_clarification: 'Which day next week?' })] });
  await ask(page, 'haircut next week');
  ok('no date: asked, not added', !(await state(page, 'reminders')).some((r) => r.title === 'Haircut') && !!(await page.$('.ai-msg:last-child .ai-prop__date')));

  // 7b) memory suggestions: nothing saved until Save; No thanks saves nothing
  const memsBefore = (await state(page, 'memories')).length;
  await reply(page, { reply: 'Noted, I’ll keep school pickup in mind.', memorySuggestions: [{ id: 'mc1', category: 'daily_routines', content: 'School pickup is at 3:15pm' }, { id: 'mc2', category: 'household', content: 'Has a dog called Biscuit' }] });
  await ask(page, 'School pickup is 3:15 and we have a dog called Biscuit');
  ok('suggestions shown, nothing saved yet', (await page.$$('.ai-msg:last-child .ai-mem')).length === 2 && (await state(page, 'memories')).length === memsBefore);
  await page.click('.ai-msg:last-child .ai-mem[data-mem="mc1"] [data-action="ai-mem-save"]'); await page.waitForTimeout(200);
  const mems = await state(page, 'memories');
  ok('Save stores an ai memory', mems.length === memsBefore + 1 && mems.some((m) => m.content === 'School pickup is at 3:15pm' && m.source === 'ai' && m.category === 'daily_routines' && !m.sensitive));
  await page.click('.ai-msg:last-child .ai-mem[data-mem="mc2"] [data-action="ai-mem-no"]'); await page.waitForTimeout(200);
  ok('No thanks saves nothing and hides the card', (await state(page, 'memories')).length === memsBefore + 1 && !(await page.$('.ai-msg:last-child .ai-mem')));

  // 7c) home town for weather (Settings): search, pick, save, clear
  await page.evaluate(() => { window.__upd = []; const st = window.__stubFrom; });
  await page.evaluate(async () => {
    const { session } = await import('./js/session.js'); const orig = session.client.from;
    session.client.from = (t) => { const b = orig(t); const u = b.update; b.update = (v) => { if (t === 'user_preferences') window.__upd.push(v); return u.call(b, v); }; return b; };
    window.__realFetch = window.fetch;
    window.fetch = async (url, o) => /api\.postcodes\.io/.test(String(url)) ? new Response(JSON.stringify({ result: { outcode: 'LS6', admin_district: 'Leeds', country: 'England', latitude: 53.8123, longitude: -1.5791 } })) : /\/\/api\.open-meteo\.com/.test(String(url)) ? new Response(JSON.stringify({ current: { temperature_2m: 7.4, weather_code: 61, wind_speed_10m: 12 }, daily: { time: ['2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29'], weather_code: [3, 61, 0, 2], temperature_2m_max: [9, 8, 7, 6], temperature_2m_min: [4, 3, 2, 1], precipitation_probability_max: [40, 80, 10, 20] } })) : /geocoding-api/.test(String(url)) ? new Response(JSON.stringify({ results: [{ name: 'Leeds', admin1: 'England', country: 'United Kingdom', latitude: 53.7965, longitude: -1.5478 }] })) : window.__realFetch(url, o);
  });
  await page.keyboard.press('Escape'); await page.waitForTimeout(450);
  await page.evaluate(() => document.querySelector('[data-action="open-settings"]').click()); await page.waitForTimeout(500);
  ok('settings has a location & weather section above Appearance', !!(await page.$('#homeInput')));
  await page.fill('#homeInput', 'Leeds'); await page.click('[data-action="home-search"]'); await page.waitForTimeout(400);
  ok('search shows the town to pick', /Leeds/.test(await page.textContent('#homeField')) && !!(await page.$('[data-action="home-pick"]')));
  await page.click('[data-action="home-pick"]'); await page.waitForTimeout(300);
  const saved = await page.evaluate(() => window.__upd[window.__upd.length - 1]);
  ok('pick saves name + rounded coordinates only', saved && saved.home_name === 'Leeds, England' && saved.home_lat === 53.8 && saved.home_lon === -1.55, JSON.stringify(saved));
  ok('weather shown after saving', /7°C/.test(await page.textContent('#homeField')) && /Light rain/.test(await page.textContent('#homeField')));
  await page.fill('#homeInput', 'ls6 1aa'); await page.click('[data-action="home-search"]'); await page.waitForTimeout(400);
  ok('UK postcode finds the area', /LS6, Leeds/.test(await page.textContent('#homeField')));
  await page.click('[data-action="home-pick"]'); await page.waitForTimeout(300);
  const pc = await page.evaluate(() => window.__upd[window.__upd.length - 1]);
  ok('postcode saves area + rounded position, not the postcode', pc.home_name === 'LS6, Leeds' && pc.home_lat === 53.81 && pc.home_lon === -1.58 && !/1AA/i.test(JSON.stringify(pc)), JSON.stringify(pc));
  await page.click('[data-action="home-clear"]'); await page.waitForTimeout(300);
  const cleared = await page.evaluate(() => window.__upd[window.__upd.length - 1]);
  ok('remove clears the saved town', cleared && cleared.home_name === null && cleared.home_lat === null);
  await page.evaluate(() => { document.querySelector('.modal.is-open [data-close], .modal.is-open .modal__close') && document.querySelector('.modal.is-open [data-close], .modal.is-open .modal__close').click(); });
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  await page.evaluate(() => { window.fetch = window.__realFetch; });
  if (await page.evaluate(() => document.getElementById('aiSheet').hidden)) { await page.tap('#aiFab'); await page.waitForTimeout(450); }

  // 8) keyboard: the panel follows the visual viewport (mobile keyboard)
  await page.evaluate(() => { const p = document.querySelector('.ai-sheet__panel'); p.style.setProperty('--vvh', '420px'); });
  const kb = await page.locator('.ai-form').boundingBox();
  ok('with the keyboard up the message box stays on screen', kb.y + kb.height <= 430, JSON.stringify(kb));
  await page.evaluate(() => { document.querySelector('.ai-sheet__panel').style.removeProperty('--vvh'); window.visualViewport && window.dispatchEvent(new Event('resize')); });

  // close
  await page.click('.ai-sheet__head [data-action="ai-sheet-close"]'); await page.waitForTimeout(450);
  ok('close button minimises the sheet', await page.evaluate(() => document.getElementById('aiSheet').hidden) && await page.isVisible('#aiFab'));
  await page.tap('#aiFab'); await page.waitForTimeout(450);
  ok('reopening keeps the conversation', (await page.$$('.ai-msg')).length > 5);
  await page.keyboard.press('Escape'); await page.waitForTimeout(450);
  ok('Escape closes it too', await page.evaluate(() => document.getElementById('aiSheet').hidden));
  ok('no script errors (phone, dark)', errors.length === 0, errors.join('|'));
  await ctx.close();

  /* ---------- phone, light ---------- */
  ({ ctx, page, errors } = await boot(browser, { scheme: 'light' }));
  ok('Auto follows the phone: light', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light');
  await seed(page);
  await page.waitForTimeout(300); await shot(page, '10-home-light');
  await page.evaluate(() => window.scrollTo(0, 700)); await shot(page, '10b-home-light-scrolled'); await page.evaluate(() => window.scrollTo(0, 0));
  for (const [h, n] of [['#/planner', '11-planner-light'], ['#/money', '12-money-light'], ['#/household', '13-household-light'], ['#/more', '14-more-light']]) { await page.evaluate((h) => { location.hash = h; }, h); await page.waitForTimeout(350); await shot(page, n); }
  await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForTimeout(200);
  await page.tap('#aiFab'); await page.waitForTimeout(600); await shot(page, '15-sheet-light');
  await reply(page, { reply: 'I’ve moved it.', proposals: [P({ kind: 'event', title: 'Hygienist', date: await D(page, 2), time: '10:30' }), P({ kind: 'shopping', items: ['Bread', 'Eggs'] }), P({ kind: 'task', title: 'Water the plants', date: null, needs_clarification: 'Which day?' })] });
  await ask(page, 'x'); await shot(page, '16-actions-light');
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  await page.evaluate(() => DAYMATE.views.openTaskSheet && DAYMATE.views.openTaskSheet()); await page.waitForTimeout(500); await shot(page, '18-task-sheet-light');
  await page.evaluate(() => DAYMATE.Modal.close('m-task')); await page.waitForTimeout(300);
  await page.evaluate(() => DAYMATE.views.openPremium('')); await page.waitForTimeout(600); await shot(page, '19-premium-light');
  await page.evaluate(() => DAYMATE.Modal.close('m-premium')); await page.waitForTimeout(300);
  // settings: appearance control
  await page.evaluate(() => DAYMATE.Modal.open('m-settings')); await page.waitForTimeout(500);
  await page.click('#themeSeg label:has-text("Dark")'); await page.waitForTimeout(200);
  ok('choosing Dark switches immediately and is remembered', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark' && (await page.evaluate(() => localStorage.getItem('daymate:theme'))) === 'dark');
  await page.click('#themeSeg label:has-text("Auto")'); await page.waitForTimeout(200);
  ok('Auto goes back to following the phone', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light');
  await page.click('#themeSeg label:has-text("Light")'); await page.waitForTimeout(200); await shot(page, '17-settings-light');
  ok('no script errors (phone, light)', errors.length === 0, errors.join('|'));
  await ctx.close();

  /* ---------- desktop ---------- */
  ({ ctx, page, errors } = await boot(browser, { width: 1280, height: 800, scheme: 'dark' }));
  await seed(page); await shot(page, '20-home-desktop-dark');
  const fb = await page.locator('#aiFab').boundingBox();
  ok('desktop: button bottom-right with a label', fb.x > 1100 && fb.y > 700 && /Ask AI/.test(await page.textContent('#aiFab')), JSON.stringify(fb));
  await page.click('#aiFab'); await page.waitForTimeout(600);
  const dp = await page.locator('.ai-sheet__panel').boundingBox();
  ok('desktop: floating panel (not full screen), bottom-right', dp.width < 500 && dp.x > 800 && dp.height < 760, JSON.stringify(dp));
  ok('desktop: page behind stays usable (no scroll lock)', await page.evaluate(() => getComputedStyle(document.body).overflow !== 'hidden'));
  await reply(page, { reply: 'You have the school run tomorrow at 08:45.', proposals: [] });
  await page.click('.ai-starters .chip:has-text("What’s coming up?")'); await page.waitForSelector('.ai-msg--assistant'); await page.waitForTimeout(300);
  await shot(page, '21-panel-desktop-dark');
  ok('suggested prompt sends and gets an answer', /school run/.test(await page.textContent('.ai-msgs')) && (await page.evaluate(() => window.__stub.calls.length)) === 1);
  ok('no script errors (desktop)', errors.length === 0, errors.join('|'));
  await ctx.close();

  await browser.close(); server.close();
  const bad = results.filter((r) => !r[1]);
  results.forEach(([n, c, d]) => console.log(c ? 'PASS' : 'FAIL', n, c ? '' : d));
  console.log(bad.length ? `${bad.length} of ${results.length} FAILED` : `${results.length}/${results.length} passed`); process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
