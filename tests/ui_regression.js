// Browser tests: Part 1 regression + Part 2 signed-out behaviour. Run: node ui_regression.js
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
const results = []; const ok = (n, c, d = '') => { results.push([n, !!c, d]); };
(async () => {
  await new Promise((r) => server.listen(0, r)); const base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  let askedPermission = false;
  await page.addInitScript(() => { window.__permAsked = false; const N = window.Notification; if (N) { const orig = N.requestPermission; N.requestPermission = function () { window.__permAsked = true; return orig.apply(this, arguments); }; } });

  await page.goto(base); await page.waitForFunction(() => window.DAYMATE);
  await page.waitForTimeout(700);
  ok('app boots with no errors', errors.length === 0, errors.join(' | '));
  ok('notification permission NOT requested on load', !(await page.evaluate(() => window.__permAsked)));
  const baselinePerm = await (async () => { const c = await browser.newContext(); const b = await c.newPage(); await b.goto('about:blank'); const v = await b.evaluate(() => Notification.permission); await c.close(); return v; })();
  ok('Notification.permission untouched (same as a blank page: ' + baselinePerm + ')', (await page.evaluate(() => Notification.permission)) === baselinePerm);

  // welcome sheet -> name
  await page.fill('#welcomeName', 'Luke'); await page.click('#welcomeForm button[type=submit]'); await page.waitForTimeout(450);
  ok('greeting uses name', (await page.textContent('#hdTitle')).includes('Luke'));

  // Part 1: tasks
  await page.fill('#quickAddInput', 'Buy bin bags'); await page.press('#quickAddInput', 'Enter'); await page.waitForTimeout(250);
  ok('quick-add task appears', (await page.textContent('#taskList')).includes('Buy bin bags'));
  await page.click('#taskList .check'); await page.waitForTimeout(900);
  ok('task can be completed', (await page.textContent('#ovDone')) === '1');
  await page.click('[data-action=add-task] >> nth=0'); await page.fill('#taskTitle', 'Call council'); await page.click('label.seg__opt--high'); await page.click('#taskSave'); await page.waitForTimeout(350);
  ok('sheet task saved', (await page.textContent('#taskList')).includes('Call council'));

  // reminders incl. new Bill kind, due in the past so the centre has something to say
  const today = await page.evaluate(() => window.DAYMATE.helpers.todayStr());
  await page.click('[data-action=add-reminder] >> nth=0'); await page.fill('#reminderTitle', 'Energy bill');
  await page.click('label.seg__opt:has(input[value=bill])'); await page.fill('#reminderDate', today); await page.fill('#reminderTime', '00:01'); await page.click('#reminderSave'); await page.waitForTimeout(400);
  const st1 = await page.evaluate(() => window.DAYMATE.Store.state.reminders.map((r) => [r.title, r.kind]));
  ok('bill reminder stored with kind=bill', JSON.stringify(st1) === JSON.stringify([['Energy bill', 'bill']]), JSON.stringify(st1));
  ok('Upcoming shows Bill label', (await page.textContent('#upcomingList')).includes('Bill'));

  // shopping
  await page.click('[data-action=open-shopping] >> nth=0'); await page.fill('#shoppingInput', 'Milk'); await page.press('#shoppingInput', 'Enter'); await page.waitForTimeout(200);
  ok('shopping item added', (await page.textContent('#shoppingList')).includes('Milk'));
  await page.click('#m-shopping [data-action=close-modal] >> nth=-1'); await page.waitForTimeout(400);

  // persistence across reload + schema v2 + still same storage key
  await page.reload(); await page.waitForFunction(() => window.DAYMATE); await page.waitForTimeout(600);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('daymate:v1')));
  ok('data persists in daymate:v1 after reload', saved.tasks.length === 2 && saved.shopping.length === 1 && saved.reminders.length === 1);
  ok('signed-out: no sync bookkeeping recorded', saved.sync.tombstones.length === 0 && Object.values(saved.sync.dirty).every((a) => a.length === 0));

  // Part-1-format data (no memories/notifications/sync keys) still loads
  const legacy = { schemaVersion: 1, settings: { name: 'Old', onboarded: true, premiumInterest: false }, tasks: [{ id: 'x1', title: 'Legacy task', priority: 'low', date: today, time: '', completed: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }], reminders: [{ id: 'x2', title: 'Legacy appt', kind: 'event', date: today, time: '23:00', note: '', done: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }], shopping: [] };
  const ctx2 = await browser.newContext(); const p2 = await ctx2.newPage();
  await p2.addInitScript((l) => { if (!localStorage.getItem('daymate:v1')) localStorage.setItem('daymate:v1', JSON.stringify(l)); }, legacy);
  await p2.goto(base); await p2.waitForFunction(() => window.DAYMATE); await p2.waitForTimeout(500);
  const loaded = await p2.evaluate(() => { const s = window.DAYMATE.Store.state; return { tasks: s.tasks.length, rem: s.reminders.length, name: s.settings.name, mem: s.memories.length, paused: s.settings.memoryPaused }; });
  ok('Part 1 localStorage data loads unchanged', loaded.tasks === 1 && loaded.rem === 1 && loaded.name === 'Old', JSON.stringify(loaded));
  ok('memory collection defaults to paused', loaded.paused === true);
  const legacyUI = await p2.textContent('#taskList'); ok('legacy task is rendered on Home', legacyUI.includes('Legacy task'));
  await ctx2.close();

  // Memory
  await page.goto(base + '#/memory'); await page.waitForTimeout(400);
  ok('memory route shows empty state', (await page.textContent('#view-memory')).includes('Nothing remembered yet'));
  ok('memory explains approve-before-save', (await page.textContent('#view-memory')).includes('Nothing is saved until you tap Save'));
  ok('pause toggle checked by default', await page.isChecked('[data-memory-pause]'));
  await page.click('#view-memory button.btn--primary >> text=Add a memory'); await page.waitForTimeout(250);
  ok('9 categories offered', (await page.locator('#memoryCategory option').count()) === 9);
  await page.selectOption('#memoryCategory', 'meal_preferences'); await page.fill('#memoryTitle', 'Curry night'); await page.fill('#memoryContent', 'Loves a vindaloo on Fridays'); await page.click('#memorySave'); await page.waitForTimeout(400);
  ok('memory saved + listed', (await page.textContent('#view-memory')).includes('vindaloo'));
  await page.click('#view-memory [data-action=add-memory] >> nth=0'); await page.selectOption('#memoryCategory', 'household'); await page.fill('#memoryContent', 'Wifi password is in the kitchen drawer'); await page.check('#memorySensitive'); await page.click('#memorySave'); await page.waitForTimeout(400);
  ok('sensitive memory is hidden until tapped', !(await page.textContent('#view-memory')).includes('kitchen drawer'));
  await page.click('[data-action=reveal-memory]'); await page.waitForTimeout(200);
  ok('sensitive memory reveals on tap', (await page.textContent('#view-memory')).includes('kitchen drawer'));
  await page.fill('#memSearch', 'vindaloo'); await page.waitForTimeout(200);
  ok('search narrows results', (await page.locator('.mem').count()) === 1);
  await page.fill('#memSearch', ''); await page.click('[data-action=memory-category][data-category=household]'); await page.waitForTimeout(200);
  ok('category filter works', (await page.locator('.mem').count()) === 1 && (await page.textContent('.mem')).includes('Household'));
  await page.click('[data-action=memory-category][data-category=all]'); await page.click('.mem >> text=Curry night >> xpath=ancestor::li >> [data-action=edit-memory]'); await page.fill('#memoryContent', 'Loves a madras on Fridays'); await page.click('#memorySave'); await page.waitForTimeout(300);
  ok('memory can be edited', (await page.textContent('#view-memory')).includes('madras'));
  await page.click('.mem >> text=madras >> xpath=ancestor::li >> [data-action=delete-memory]'); await page.waitForTimeout(300);
  ok('memory can be deleted', !(await page.textContent('#view-memory')).includes('madras'));
  const memSource = await page.evaluate(() => window.DAYMATE.Store.state.memories.map((m) => m.source));
  ok('all memories are source=manual (no AI pretence)', memSource.every((s) => s === 'manual'));
  await page.uncheck('[data-memory-pause]'); await page.waitForTimeout(150);
  ok('pause switch persists choice', (await page.evaluate(() => window.DAYMATE.Store.state.settings.memoryPaused)) === false);

  // Notification centre
  await page.goto(base + '#/notifications'); await page.waitForTimeout(500);
  await page.evaluate(() => window.DAYMATE.views.renderAll()); await page.waitForTimeout(200);
  const notes = await page.evaluate(() => window.DAYMATE.Store.state.notifications.map((n) => [n.type, n.title]));
  ok('bill due earlier today produces in-app alerts (bill and/or missed)', notes.some(([t]) => t === 'missed' || t === 'bill'), JSON.stringify(notes));
  ok('bell shows unread count', !(await page.locator('#bellBadge').isHidden()));
  const unreadBefore = await page.locator('.note.is-unread').count();
  await page.click('.note.is-unread .note__main >> nth=0'); await page.waitForTimeout(200);
  ok('tap marks one as read', (await page.locator('.note.is-unread').count()) === unreadBefore - 1);
  // add two more unread alerts so 'mark all' has real work to do
  await page.evaluate(() => { const S = window.DAYMATE.Store; ['a', 'b'].forEach((k) => S.add('notifications', { type: 'system', title: 'Test ' + k, body: '', sourceType: '', sourceId: '', dedupeKey: 'test:' + k, readAt: '', dismissedAt: '' })); });
  await page.waitForTimeout(200);
  ok('new alerts show as unread', (await page.locator('.note.is-unread').count()) === 2);
  await page.click('[data-action=mark-all-read]'); await page.waitForTimeout(200);
  ok('mark all read', (await page.locator('.note.is-unread').count()) === 0);
  await page.click('[data-action=clear-all-notifications]'); await page.waitForTimeout(250);
  ok('clear all empties the inbox', (await page.textContent('#view-notifications')).includes('all caught up'));
  await page.click('[data-action=notif-tab][data-tab=history]'); await page.waitForTimeout(200);
  ok('cleared alerts remain in history', (await page.locator('.note').count()) > 0);
  await page.click('[data-action=notif-tab][data-tab=inbox]');
  const before = await page.evaluate(() => window.DAYMATE.Store.state.notifications.length);
  await page.evaluate(() => window.DAYMATE.views.renderAll()); await page.waitForTimeout(200);
  ok('alerts are not re-created after clearing (dedupe)', (await page.evaluate(() => window.DAYMATE.Store.state.notifications.length)) === before);

  // Notification settings + permission rules
  await page.goto(base + '#/more'); await page.waitForTimeout(300);
  await page.click('[data-action=open-notify-prefs]'); await page.waitForTimeout(500);
  const body = await page.textContent('#notifyBody');
  ok('signed-out: push panel asks to sign in (no permission prompt)', body.includes('Sign in to get phone notifications') || body.includes('Not set up yet'));
  ok('permission still not requested', !(await page.evaluate(() => window.__permAsked)));
  ok('free plan: morning briefing is locked', body.includes('Premium · coming soon'));
  ok('free plan: single lead-time select', (await page.locator('#leadSelect').count()) === 1);
  await page.selectOption('#leadSelect', '15'); await page.waitForTimeout(150);
  ok('lead time saved', (await page.evaluate(() => JSON.stringify(window.DAYMATE.Store.state.settings.notify.leadMinutes))) === '[15]');
  await page.uncheck('[data-pref=bills]'); await page.waitForTimeout(100);
  ok('category toggle saved', (await page.evaluate(() => window.DAYMATE.Store.state.settings.notify.bills)) === false);
  await page.click('#m-notify [data-action=close-modal] >> nth=-1'); await page.waitForTimeout(400);

  // Account UI (not configured)
  await page.click('[data-action=open-settings] >> nth=0'); await page.waitForTimeout(400);
  ok('settings has account section (signed out)', (await page.textContent('#accountSection')).includes('Not signed in'));
  await page.click('#accountSection [data-action=open-auth]'); await page.waitForTimeout(400);
  ok('auth sheet explains accounts are not set up (no config)', (await page.textContent('#authSetup')).includes('Accounts aren’t set up'));
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(400);

  // Entitlements can't be faked from the browser
  await page.evaluate(() => { localStorage.setItem('daymate:v1', JSON.stringify({ ...JSON.parse(localStorage.getItem('daymate:v1')), plan: 'premium', settings: { ...JSON.parse(localStorage.getItem('daymate:v1')).settings, plan: 'premium' } })); });
  await page.reload(); await page.waitForFunction(() => window.DAYMATE); await page.waitForTimeout(400);
  ok('editing localStorage cannot grant Premium', (await page.evaluate(() => window.DAYMATE.Account.getPlan())) === 'free' && !(await page.evaluate(() => window.DAYMATE.Entitlements.has('morning-briefing'))));
  ok('free features still free', await page.evaluate(() => window.DAYMATE.Entitlements.has('memory-manual') && window.DAYMATE.Entitlements.has('notifications-basic')));

  // Export strips internal bookkeeping
  const exported = await page.evaluate(() => JSON.stringify(window.DAYMATE.Store.snapshot()));
  ok('backup snapshot excludes sync internals', !exported.includes('"tombstones"'));

  // Service worker has push handlers
  const sw = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');
  ok('service worker handles push + notificationclick', sw.includes("addEventListener('push'") && sw.includes("addEventListener('notificationclick'"));
  // routes of every view render without error
  for (const r of ['home', 'planner', 'money', 'household', 'more', 'notifications', 'memory']) { await page.goto(base + '#/' + r); await page.waitForTimeout(150); }
  ok('all 7 routes render', errors.length === 0, errors.join(' | '));
  // desktop layout
  await page.setViewportSize({ width: 1280, height: 800 }); await page.goto(base + '#/memory'); await page.waitForTimeout(300);
  ok('desktop: no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.setViewportSize({ width: 360, height: 740 }); await page.goto(base + '#/notifications'); await page.waitForTimeout(300);
  ok('small phone: no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: '/tmp/daymate-shot-notifications.png' });
  await page.goto(base + '#/memory'); await page.waitForTimeout(300); await page.screenshot({ path: '/tmp/daymate-shot-memory.png' });

  await browser.close(); server.close();
  const failed = results.filter((r) => !r[1]);
  results.forEach(([n, c, d]) => console.log((c ? 'PASS' : 'FAIL') + ' | ' + n + (c ? '' : ' | ' + d)));
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, ${results.length} total`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH', e); process.exit(2); });
