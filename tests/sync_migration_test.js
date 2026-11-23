// Sync + migration tests: real client modules in a real browser against the in-memory backend.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
const results = []; const ok = (n, c, d = '') => results.push([n, !!c, d]);
(async () => {
  await new Promise((r) => server.listen(0, r)); const base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch(); const ctx = await browser.newContext(); const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base); await page.waitForFunction(() => window.DAYMATE); await page.addScriptTag({ path: path.join(__dirname, 'fake_supabase.js') });

  const out = await page.evaluate(async () => {
    const R = {}; const DM = window.DAYMATE; const { Store, Account, storage } = DM;
    const { createSync } = await import('./js/sync.js'); const { migrate, detectLocalData } = await import('./js/migration.js');
    const mapping = await import('./js/mapping.js');
    const be = window.makeFakeBackend();
    const UA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', UB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    be.seedUser(UA); be.seedUser(UB);
    const today = DM.helpers.todayStr();
    const session = { client: null, user: null, sync: null };
    const signIn = async (uid, device) => {            // like auth.js onSignedIn, but with the fake backend
      if (session.sync) session.sync.stop();
      await Store.useAdapter(storage.localAdapter(storage.userCacheKey(uid) + ':' + device));
      Store.setTracking(true);
      session.client = be.client(uid); session.user = { id: uid, email: uid + '@x.com' };
      session.sync = createSync({ client: session.client, user: session.user, DM });
      await session.sync.sync(); return session.sync;
    };
    const signOut = async () => { if (session.sync) session.sync.stop(); Store.setTracking(false); await Store.useAdapter(storage.localAdapter(DM.APP.storageKey)); };
    const titles = (c) => Store.state[c].map((x) => x.title || x.name || x.content).sort();

    /* ---------- 1. push from device A1 ---------- */
    await signOut(); localStorage.clear(); await Store.useAdapter(storage.localAdapter(DM.APP.storageKey));
    let sA1 = await signIn(UA, 'A1');
    const t1 = Store.add('tasks', { title: 'Task one', priority: 'high', date: today, time: '09:30', completed: false, completedOn: '', completedAt: '' });
    const rEv = Store.add('reminders', { title: 'Dentist', kind: 'event', date: today, time: '14:30', note: 'bring card', done: false });
    const rBill = Store.add('reminders', { title: 'Energy bill', kind: 'bill', date: today, time: '', note: '', done: false });
    const sh = Store.add('shopping', { name: 'Milk', checked: false });
    const mem = Store.add('memories', { category: 'meal_preferences', title: 'Curry', content: 'Loves vindaloo', source: 'manual', sensitive: false });
    await sA1.sync();
    R.pushTasks = be.tables.tasks.length; R.pushAppts = be.tables.appointments.length; R.pushRem = be.tables.reminders.length; R.pushShop = be.tables.shopping_items.length; R.pushMem = be.tables.memories.length;
    R.apptRow = be.tables.appointments[0]; R.billRow = be.tables.reminders[0]; R.taskRow = be.tables.tasks[0];
    R.dirtyAfterPush = JSON.stringify(Store.state.sync.dirty);

    /* ---------- 2. second device A2 pulls everything ---------- */
    sA1.stop();
    await Store.useAdapter(storage.localAdapter(storage.userCacheKey(UA) + ':A2')); Store.setTracking(true);
    session.client = be.client(UA); session.user = { id: UA }; let sA2 = createSync({ client: session.client, user: session.user, DM }); await sA2.sync();
    R.pulled = { tasks: titles('tasks'), reminders: titles('reminders'), shopping: titles('shopping'), memories: titles('memories') };
    const pulledEv = Store.state.reminders.find((r) => r.title === 'Dentist'); const pulledBill = Store.state.reminders.find((r) => r.title === 'Energy bill');
    R.kinds = [pulledEv.kind, pulledEv.time, pulledEv.note, pulledBill.kind, pulledBill.time];

    /* ---------- 3. A2 edits + deletes; A1 receives ---------- */
    Store.update('tasks', t1.id, { title: 'Task one (edited)', completed: true, completedOn: today, completedAt: new Date().toISOString() });
    Store.remove('shopping', sh.id);
    Store.remove('memories', mem.id);
    Store.update('reminders', rEv.id, { kind: 'reminder' });      // appointment -> reminder moves tables
    await sA2.sync();
    R.afterEdit = { taskTitle: be.tables.tasks[0].title, taskDone: be.tables.tasks[0].completed, shopDeleted: !!be.tables.shopping_items[0].deleted_at,
      memDeleted: !!be.tables.memories[0].deleted_at, memContentWiped: be.tables.memories[0].content, memTitleWiped: be.tables.memories[0].title,
      apptSoftDeleted: !!be.tables.appointments[0].deleted_at, movedToReminders: be.tables.reminders.some((r) => r.title === 'Dentist' && !r.deleted_at && r.category === 'general') };
    sA2.stop();
    sA1 = await signIn(UA, 'A1');
    R.a1After = { tasks: titles('tasks'), shopping: titles('shopping'), memories: titles('memories'), dentist: Store.state.reminders.filter((r) => r.title === 'Dentist').map((r) => r.kind) };

    /* ---------- 4. conflicts: older edit must not overwrite newer ---------- */
    Store.update('tasks', t1.id, { title: 'A1 newer' }); await sA1.sync();
    const staleRow = { ...be.tables.tasks[0] };
    const c = be.client(UA);
    await c.from('tasks').upsert([{ ...staleRow, title: 'STALE', updated_at: '2020-01-01T00:00:00.000Z' }], { onConflict: 'user_id,id' });
    R.staleIgnored = be.tables.tasks[0].title === 'A1 newer';
    /* undo of a delete wins over the tombstone */
    const sh2 = Store.add('shopping', { name: 'Eggs', checked: false }); await sA1.sync();
    const del = Store.remove('shopping', sh2.id); Store.restore('shopping', del.item, del.index); await sA1.sync();
    R.undoDelete = be.tables.shopping_items.find((r) => r.name === 'Eggs') && !be.tables.shopping_items.find((r) => r.name === 'Eggs').deleted_at;

    /* ---------- 5. isolation: user B sees nothing of A ---------- */
    sA1.stop(); await Store.useAdapter(storage.localAdapter(storage.userCacheKey(UB) + ':B1')); Store.setTracking(true);
    session.client = be.client(UB); session.user = { id: UB }; const sB = createSync({ client: session.client, user: session.user, DM }); await sB.sync();
    R.bSees = { tasks: Store.state.tasks.length, reminders: Store.state.reminders.length, shopping: Store.state.shopping.length, memories: Store.state.memories.length };
    const cB = be.client(UB); const attack = await cB.from('tasks').upsert([{ user_id: UA, id: crypto.randomUUID(), title: 'x', priority: 'low', due_date: today }], { onConflict: 'user_id,id' });
    R.bCannotWriteAsA = !!attack.error;
    sB.stop();

    /* ---------- 6. offline: keeps pending changes, recovers ---------- */
    sA1 = await signIn(UA, 'A1');
    be.offline = true; Store.add('tasks', { title: 'Made offline', priority: 'low', date: today, time: '', completed: false, completedOn: '', completedAt: '' });
    const offOk = await sA1.sync(); R.offlineState = Account.syncState; R.offlineSyncReturned = offOk; R.offlinePending = sA1.hasPending();
    be.offline = false; await sA1.sync();
    R.recovered = { state: Account.syncState, pending: sA1.hasPending(), inCloud: be.tables.tasks.some((r) => r.title === 'Made offline') };

    /* ---------- 7. a rejected record doesn't block the rest ---------- */
    be.rejectTitle = 'BAD'; Store.add('tasks', { title: 'BAD', priority: 'low', date: today, time: '', completed: false, completedOn: '', completedAt: '' });
    Store.add('tasks', { title: 'Good after bad', priority: 'low', date: today, time: '', completed: false, completedOn: '', completedAt: '' });
    await sA1.sync(); be.rejectTitle = null;
    R.quarantine = { good: be.tables.tasks.some((r) => r.title === 'Good after bad'), bad: be.tables.tasks.some((r) => r.title === 'BAD'), pending: sA1.hasPending(), quarantined: sA1.quarantined.length, state: Account.syncState };
    sA1.quarantined.length = 0; sA1.stop();

    /* ---------- 8. MIGRATION ---------- */
    be.seedUser('cccccccc-cccc-4ccc-8ccc-cccccccccccc'); const UC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    await signOut();
    const nowIso = new Date().toISOString();
    const anon = { schemaVersion: 1, settings: { name: 'Luke', onboarded: true, premiumInterest: true },
      tasks: [ { id: 'legacy-id-1', title: 'Anon task', priority: 'low', date: today, time: '', completed: false, createdAt: nowIso, updatedAt: nowIso },
               { id: crypto.randomUUID(), title: 'Shared task', priority: 'low', date: today, time: '10:00', completed: false, createdAt: nowIso, updatedAt: nowIso } ],
      reminders: [ { id: crypto.randomUUID(), title: 'Anon appt', kind: 'event', date: today, time: '11:00', note: '', done: false, createdAt: nowIso, updatedAt: nowIso } ],
      shopping: [ { id: crypto.randomUUID(), name: 'Bread', checked: false, createdAt: nowIso, updatedAt: nowIso } ] };
    // user C already has "Shared task" in the cloud under a DIFFERENT id (e.g. imported from another device)
    await be.client(UC).from('tasks').upsert([{ user_id: UC, id: crypto.randomUUID(), title: 'Shared task', priority: 'low', due_date: today, due_time: '10:00:00', completed: false, completed_on: null, completed_at: null, created_at: nowIso, updated_at: nowIso, deleted_at: null }], { onConflict: 'user_id,id' });
    await Store.useAdapter(storage.localAdapter('daymate:scratch'));         // park the Store elsewhere so it can't overwrite what we inject
    localStorage.setItem(DM.APP.storageKey, JSON.stringify(anon));
    R.detect = detectLocalData(DM) && detectLocalData(DM).counts;

    // 8a. failure: server rejects task writes -> device data must stay
    let sC = await signIn(UC, 'C1');
    be.failTable = 'shopping_items';
    const fail = await migrate({ DM, session: { ...session, sync: sC, client: session.client, user: { id: UC } } });
    R.migFail = { ok: fail.ok, anonStillThere: !!localStorage.getItem(DM.APP.storageKey), backup: !!localStorage.getItem('daymate:premigration-backup') };
    // 8b. retry succeeds, no duplicates
    be.failTable = null;
    const good = await migrate({ DM, session: { ...session, sync: sC, client: session.client, user: { id: UC } } });
    R.migOk = { ok: good.ok, added: good.added, duplicates: good.duplicates, anonRemoved: !localStorage.getItem(DM.APP.storageKey), backupKept: !!localStorage.getItem('daymate:premigration-backup') };
    R.cloudAfterMig = { tasks: be.tables.tasks.filter((r) => r.user_id === UC).map((r) => r.title).sort(), appts: be.tables.appointments.filter((r) => r.user_id === UC).length, shop: be.tables.shopping_items.filter((r) => r.user_id === UC).length,
      legacyIdFixed: be.tables.tasks.filter((r) => r.user_id === UC).every((r) => mapping.isUuid(r.id)), nameSet: Store.state.settings.name };
    // 8c. running it again does nothing / adds nothing
    const again = await migrate({ DM, session: { ...session, sync: sC, client: session.client, user: { id: UC } } });
    R.migAgain = { nothing: !!again.nothing, taskRows: be.tables.tasks.filter((r) => r.user_id === UC).length };
    sC.stop();
    R.errors = [];
    return R;
  });
  const O = out;
  ok('push: tasks/appointments/reminders/shopping/memories land in the right tables', O.pushTasks === 1 && O.pushAppts === 1 && O.pushRem === 1 && O.pushShop === 1 && O.pushMem === 1, JSON.stringify([O.pushTasks, O.pushAppts, O.pushRem, O.pushShop, O.pushMem]));
  ok('push: appointment row mapped (appt_date/appt_time/note)', O.apptRow.appt_time === '14:30' && O.apptRow.note === 'bring card' && O.apptRow.title === 'Dentist');
  ok('push: bill stored as category=bill with null time', O.billRow.category === 'bill' && O.billRow.remind_time === null);
  ok('push: task row has user_id + due_time', O.taskRow.user_id.startsWith('aaaaaaaa') && O.taskRow.due_time === '09:30' && O.taskRow.priority === 'high');
  ok('push: dirty list cleared after success', !O.dirtyAfterPush.includes('"') || Object.values(JSON.parse(O.dirtyAfterPush)).every((a) => a.length === 0), O.dirtyAfterPush);
  ok('2nd device pulls everything', JSON.stringify(O.pulled) === JSON.stringify({ tasks: ['Task one'], reminders: ['Dentist', 'Energy bill'], shopping: ['Milk'], memories: ['Curry'] }), JSON.stringify(O.pulled));
  ok('pull converts types back (kind/time/note)', JSON.stringify(O.kinds) === JSON.stringify(['event', '14:30', 'bring card', 'bill', '']), JSON.stringify(O.kinds));
  ok('edits sync', O.afterEdit.taskTitle === 'Task one (edited)' && O.afterEdit.taskDone === true);
  ok('deletes sync as soft-deletes', O.afterEdit.shopDeleted && O.afterEdit.memDeleted);
  ok('deleted memory text is wiped from the row', O.afterEdit.memContentWiped === '·' && O.afterEdit.memTitleWiped === '', JSON.stringify([O.afterEdit.memContentWiped, O.afterEdit.memTitleWiped]));
  ok('reminder moved appointment→reminder (old row soft-deleted, new live)', O.afterEdit.apptSoftDeleted && O.afterEdit.movedToReminders);
  ok('other device receives edits and deletions', O.a1After.tasks[0] === 'Task one (edited)' && O.a1After.shopping.length === 0 && O.a1After.memories.length === 0, JSON.stringify(O.a1After));
  ok('moved reminder appears once with new kind', JSON.stringify(O.a1After.dentist) === JSON.stringify(['reminder']), JSON.stringify(O.a1After.dentist));
  ok('stale (older) write is ignored by server', O.staleIgnored);
  ok('undoing a delete restores it in the cloud', O.undoDelete);
  ok('isolation: user B pulls none of A’s data', JSON.stringify(O.bSees) === JSON.stringify({ tasks: 0, reminders: 0, shopping: 0, memories: 0 }), JSON.stringify(O.bSees));
  ok('isolation: B cannot write rows as A', O.bCannotWriteAsA);
  ok('offline: reports offline, keeps pending change', O.offlineState === 'offline' && O.offlinePending && !O.offlineSyncReturned, JSON.stringify([O.offlineState, O.offlinePending]));
  ok('offline: syncs automatically once back', O.recovered.state === 'synced' && !O.recovered.pending && O.recovered.inCloud, JSON.stringify(O.recovered));
  ok('one rejected record does not block the others', O.quarantine.good && !O.quarantine.bad && !O.quarantine.pending && O.quarantine.quarantined === 1, JSON.stringify(O.quarantine));
  ok('rejected record is surfaced as a sync problem', O.quarantine.state === 'error');
  ok('migration: detects device data', O.detect && O.detect.tasks === 2 && O.detect.reminders === 1 && O.detect.shopping === 1, JSON.stringify(O.detect));
  ok('migration FAILURE leaves device data in place + safety copy', O.migFail.ok === false && O.migFail.anonStillThere && O.migFail.backup, JSON.stringify(O.migFail));
  ok('migration retry succeeds, skips duplicate, removes device copy only after confirm', O.migOk.ok && O.migOk.added === 3 && O.migOk.duplicates === 1 && O.migOk.anonRemoved && O.migOk.backupKept, JSON.stringify(O.migOk));
  ok('migration: cloud has no duplicate "Shared task"', JSON.stringify(O.cloudAfterMig.tasks) === JSON.stringify(['Anon task', 'Shared task']) && O.cloudAfterMig.appts === 1 && O.cloudAfterMig.shop === 1, JSON.stringify(O.cloudAfterMig));
  ok('migration: legacy non-UUID id replaced with a valid UUID', O.cloudAfterMig.legacyIdFixed);
  ok('migration: name carried over', O.cloudAfterMig.nameSet === 'Luke');
  ok('migration is idempotent (nothing left to move)', O.migAgain.nothing && O.migAgain.taskRows === 2, JSON.stringify(O.migAgain));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close(); server.close();
  const failed = results.filter((r) => !r[1]); results.forEach(([n, c, d]) => console.log((c ? 'PASS' : 'FAIL') + ' | ' + n + (c ? '' : ' | ' + d)));
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, ${results.length} total`); process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH', e); process.exit(2); });
