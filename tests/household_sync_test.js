// Household sync tests: real client modules, in-memory backend that enforces per-user rules.   Run: node tests/household_sync_test.js
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
const results = []; const ok = (n, c, d = '') => { results.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + d}`); };
(async () => {
  await new Promise((r) => server.listen(0, r)); const base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch(); const ctx = await browser.newContext(); const page = await ctx.newPage(); const errors = [];
  await ctx.route(/supabase\.co|jsdelivr|googletagmanager|googlesyndication/, (r) => r.abort());
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base); await page.waitForFunction(() => window.DAYMATE); await page.addScriptTag({ path: path.join(__dirname, 'fake_supabase.js') });
  const R = await page.evaluate(async () => {
    const R = {}; const DM = window.DAYMATE; const { Store, storage } = DM; const { createSync } = await import('./js/sync.js'); const { detectLocalData, migrate } = await import('./js/migration.js');
    const be = window.makeFakeBackend(); const UA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', UB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; be.seedUser(UA); be.seedUser(UB);
    const today = DM.helpers.todayStr(); const session = { sync: null };
    const signIn = async (uid, dev) => { if (session.sync) session.sync.stop(); await Store.useAdapter(storage.localAdapter(storage.userCacheKey(uid) + ':' + dev)); Store.setTracking(true); session.sync = createSync({ client: be.client(uid), user: { id: uid, email: uid }, DM }); await session.sync.sync(); return session.sync; };
    const signOut = async () => { if (session.sync) session.sync.stop(); Store.setTracking(false); await Store.useAdapter(storage.localAdapter(DM.APP.storageKey)); };

    await signOut(); localStorage.clear(); await Store.useAdapter(storage.localAdapter(DM.APP.storageKey));
    // local-only data first (signed out), then sign in and migrate it
    Store.add('household', { kind: 'note', title: 'Local only', text: 'x' });
    await new Promise((r) => setTimeout(r, 800));
    R.detects = !!detectLocalData(DM) && detectLocalData(DM).counts.household === 1;
    let s = await signIn(UA, 'A1');
    const n0 = Store.add('household', { kind: 'note', title: 'Wifi', text: 'Name: Home\nPass: abc123' });
    const ch = Store.add('household', { kind: 'chore', title: 'Bins', text: '', every: 'weekly', due: today, lastDone: '', done: false });
    const dt = Store.add('household', { kind: 'date', title: 'Car MOT', text: 'Garage', date: '2027-03-01', repeat: 'yearly' });
    Store.update('household', n0.id, { text: 'Name: Home\nPass: abc123\nRouter: BT' });
    await s.sync();
    const rows = be.tables.household_info;
    R.pushed = rows.length;
    const chRow = rows.find((r) => r.id === ch.id), dtRow = rows.find((r) => r.id === dt.id), nRow = rows.find((r) => r.id === n0.id);
    R.rowShape = { chore: [chRow.category, chRow.label, JSON.parse(chRow.value).e], date: [dtRow.category, JSON.parse(dtRow.value).d], note: [nRow.category, nRow.value.includes('Router: BT')], owner: chRow.user_id === UA, lens: rows.every((r) => r.label.length <= 80 && r.value.length <= 500) };
    // complete the chore: rolls forward and syncs
    const { completeChore } = await import('./js/household-logic.js');
    Store.update('household', ch.id, completeChore(Store.get('household', ch.id), today)); await s.sync();
    R.choreSynced = JSON.parse(be.tables.household_info.find((r) => r.id === ch.id).value);
    // second device pulls and decodes
    s.stop(); s = await signIn(UA, 'A2');
    const byT = (t) => Store.state.household.find((x) => x.title === t);
    R.pulled = { n: Store.state.household.length, chore: byT('Bins') && [byT('Bins').kind, byT('Bins').every, byT('Bins').lastDone === today, byT('Bins').due > today], date: byT('Car MOT') && [byT('Car MOT').date, byT('Car MOT').repeat, byT('Car MOT').text], note: byT('Wifi') && byT('Wifi').text };
    // edit on A2 propagates to A1 and delete soft-deletes
    Store.update('household', dt.id, { title: 'Car MOT (Golf)' }); Store.remove('household', n0.id); await s.sync();
    R.cloudAfter = { title: be.tables.household_info.find((r) => r.id === dt.id).label, deleted: !!be.tables.household_info.find((r) => r.id === n0.id).deleted_at };
    s.stop(); s = await signIn(UA, 'A1');
    R.a1After = { titles: Store.state.household.map((x) => x.title).sort(), noteGone: !Store.state.household.some((x) => x.id === n0.id) };
    // stale write is ignored
    const staleRow = { ...be.tables.household_info.find((r) => r.id === dt.id) };
    await be.client(UA).from('household_info').upsert([{ ...staleRow, label: 'STALE', updated_at: '2020-01-01T00:00:00.000Z' }], { onConflict: 'user_id,id' });
    R.staleIgnored = be.tables.household_info.find((r) => r.id === dt.id).label === 'Car MOT (Golf)';
    // isolation
    s.stop(); await Store.useAdapter(storage.localAdapter(storage.userCacheKey(UB) + ':B1')); Store.setTracking(true);
    const sB = createSync({ client: be.client(UB), user: { id: UB }, DM }); await sB.sync();
    R.bSees = Store.state.household.length;
    const atk = await be.client(UB).from('household_info').upsert([{ user_id: UA, id: crypto.randomUUID(), label: 'x', value: '', category: 'note' }], { onConflict: 'user_id,id' });
    R.bCannotWriteAsA = !!atk.error; sB.stop();
    // offline keeps pending, then recovers
    s = await signIn(UA, 'A1'); be.offline = true;
    Store.add('household', { kind: 'note', title: 'Made offline', text: 'x' });
    await s.sync(); R.offline = { pending: s.hasPending(), local: Store.state.household.some((x) => x.title === 'Made offline'), cloud: be.tables.household_info.some((r) => r.label === 'Made offline') };
    be.offline = false; await s.sync(); R.recovered = { pending: s.hasPending(), cloud: be.tables.household_info.some((r) => r.label === 'Made offline') };
    // a hand-edited / foreign row never crashes the pull
    be.tables.household_info.push({ user_id: UA, id: crypto.randomUUID(), label: 'Odd one', value: '{bad json', category: 'chore', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), synced_at: '2031-01-01T00:00:00.000Z', deleted_at: null });
    be.tables.household_info.push({ user_id: UA, id: crypto.randomUUID(), label: 'Old general', value: 'hello', category: 'general', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), synced_at: '2031-01-02T00:00:00.000Z', deleted_at: null });
    await s.sync();
    R.foreign = { odd: (Store.state.household.find((x) => x.title === 'Odd one') || {}).kind, general: (Store.state.household.find((x) => x.title === 'Old general') || {}).kind };
    s.stop(); await signOut();
    return R;
  });
  ok('migration finds local household data', R.detects);
  ok('three records pushed', R.pushed === 3, R.pushed);
  ok('rows use label/category/value correctly', JSON.stringify(R.rowShape.chore) === '["chore","Bins","weekly"]' && JSON.stringify(R.rowShape.date) === '["date","2027-03-01"]' && JSON.stringify(R.rowShape.note) === '["note",true]' && R.rowShape.owner && R.rowShape.lens, JSON.stringify(R.rowShape));
  ok('chore completion syncs (last done set, due rolled forward)', R.choreSynced.l && R.choreSynced.u > R.choreSynced.l && R.choreSynced.x === 0, JSON.stringify(R.choreSynced));
  ok('second device pulls and decodes all three kinds', R.pulled.n === 3 && JSON.stringify(R.pulled.chore) === '["chore","weekly",true,true]' && JSON.stringify(R.pulled.date) === '["2027-03-01","yearly","Garage"]' && /Router: BT/.test(R.pulled.note), JSON.stringify(R.pulled));
  ok('edit and delete reach the cloud (soft delete)', R.cloudAfter.title === 'Car MOT (Golf)' && R.cloudAfter.deleted, JSON.stringify(R.cloudAfter));
  ok('first device receives the edit and the delete', R.a1After.noteGone && R.a1After.titles.includes('Car MOT (Golf)'), JSON.stringify(R.a1After));
  ok('older write cannot overwrite newer data', R.staleIgnored);
  ok('another user sees none of it and cannot write as this user', R.bSees === 0 && R.bCannotWriteAsA, JSON.stringify([R.bSees, R.bCannotWriteAsA]));
  ok('offline: change kept locally and queued', R.offline.pending && R.offline.local && !R.offline.cloud, JSON.stringify(R.offline));
  ok('back online: queued change is pushed', !R.recovered.pending && R.recovered.cloud, JSON.stringify(R.recovered));
  ok('malformed or old-style rows load safely as notes', R.foreign.odd && R.foreign.general === 'note', JSON.stringify(R.foreign));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close(); server.close(); const f = results.filter((x) => !x).length; console.log(`\n${results.length - f}/${results.length} passed`); process.exit(f ? 1 : 0);
})();
