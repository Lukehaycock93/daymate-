/* ==========================================================================
   DAYMATE — cloud sync (local-first)

   The app always reads and writes its local cache; this module mirrors changes
   to Supabase while signed in.
     push  : records the Store marked dirty (by id) + tombstones for deletions
     pull  : rows changed since a per-table cursor (synced_at, 2 min overlap)
   Conflict rule: the newer updatedAt wins, per record. The database enforces
   the same rule, so an old device can never overwrite newer data.
   Nothing here can change Premium status: that table is read-only to browsers.
   ========================================================================== */
import { SYNC_COLLECTIONS, tableFor, colFor, toRow, fromRow, stampOf, settingsToRows, rowsToSettings } from './mapping.js';

const OVERLAP_MS = 2 * 60 * 1000;
const PAGE = 500;
const PULL_TABLES = ['tasks', 'appointments', 'reminders', 'shopping_items', 'memories'];
const PRIVATE_TEXT_COLS = new Set(['memories']);   // wipe content when deleting

const isNetworkError = (err) => !navigator.onLine || /failed to fetch|networkerror|load failed|network request failed/i.test(String(err && err.message));
/** Validation / integrity failures (Postgres classes 22 and 23) will never succeed on retry; everything else might. */
const isPermanentError = (err) => /^(22|23)\d{3}$/.test(String((err && err.code) || ''));
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const deviceTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London'; } catch (_) { return 'Europe/London'; } };

export function createSync({ client, user, DM }) {
  const { Store, Account } = DM;
  const LS = DM.storage.safeLS;
  const cursorKey = `daymate:cursor:${user.id}`;
  let stopped = false, running = null, rerun = false, pushTimer = null, pollTimer = null, retryTimer = null, retryMs = 0;
  let unsub = null;
  const quarantined = [];

  const cursors = () => { try { return JSON.parse(LS.get(cursorKey) || '{}'); } catch (_) { return {}; } };
  const saveCursors = (c) => LS.set(cursorKey, JSON.stringify(c));
  const setState = (syncState, syncDetail = '') => Account.set({ syncState, syncDetail });

  /* ------------------------------ pull ------------------------------ */
  async function fetchTable(tbl, since) {
    const rows = [];
    let cursor = since ? new Date(Date.parse(since) - OVERLAP_MS).toISOString() : null;
    for (;;) {
      let q = client.from(tbl).select('*').order('synced_at', { ascending: true }).limit(PAGE);
      if (cursor) q = q.gt('synced_at', cursor);
      const { data, error } = await q;
      if (error) throw error;
      rows.push(...data);
      if (data.length < PAGE) break;
      cursor = data[data.length - 1].synced_at;
    }
    return rows;
  }

  async function fetchNotifications() {
    const { data, error } = await client.from('notifications').select('*').order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    return data;
  }

  /** Merge fetched rows into the Store. Pure bookkeeping; no network. Exposed for tests. */
  function applyBatch(batch) {
    const st = Store.state;
    const best = new Map();
    for (const [tbl, rows] of Object.entries(batch)) {
      for (const row of rows) {
        const item = fromRow(tbl, row);
        const col = colFor(tbl);
        const cand = { col, tbl, item, deleted: !!row.deleted_at, t: stampOf(item) };
        const k = `${col}:${item.id}`;
        const prev = best.get(k);
        // newest wins; on a tie a live row beats a deleted one (a reminder moved between tables leaves a deleted twin)
        if (!prev || cand.t > prev.t || (cand.t === prev.t && prev.deleted && !cand.deleted)) best.set(k, cand);
      }
    }
    const ops = [], clearDirty = {}, clearTombs = [], markNew = [];
    const clear = (col, id) => { (clearDirty[col] = clearDirty[col] || []).push(id); };

    for (const { col, item, deleted, t } of best.values()) {
      const local = st[col].find((x) => x.id === item.id);
      const dirty = st.sync.dirty[col].includes(item.id);
      const tomb = st.sync.tombstones.find((x) => x.col === col && x.id === item.id);

      if (col === 'notifications') {
        const dup = st.notifications.find((x) => x.dedupeKey === item.dedupeKey && x.id !== item.id);
        const mine = local || dup;
        if (dup) { ops.push({ col, id: dup.id, remove: true }); clear(col, dup.id); }
        if (mine) {                                // read / dismissed move forward, unless a newer local change is waiting to sync
          const localPending = st.sync.dirty.notifications.includes(mine.id);
          const readAt = localPending ? mine.readAt : (item.readAt || mine.readAt);
          const dismissedAt = localPending ? mine.dismissedAt : (item.dismissedAt || mine.dismissedAt);
          if (readAt !== item.readAt || dismissedAt !== item.dismissedAt) { item.readAt = readAt; item.dismissedAt = dismissedAt; markNew.push({ col, id: item.id }); }
        }
        if (tomb) continue;
        ops.push({ col, id: item.id, item });
        continue;
      }

      if (tomb) { if (Date.parse(tomb.deletedAt) >= t) continue; clearTombs.push(tomb); }   // local delete is newer: keep it
      if (local && dirty && stampOf(local) >= t) continue;                                   // local edit is newer: keep it
      if (deleted) { if (local) ops.push({ col, id: item.id, remove: true }); }
      else ops.push({ col, id: item.id, item });
      if (dirty) clear(col, item.id);
    }
    Store.applyRemote(ops);
    Store.clearSynced({ dirty: clearDirty, tombstones: clearTombs });
    markNew.forEach((m) => Store.state.sync.dirty[m.col].includes(m.id) || Store.state.sync.dirty[m.col].push(m.id));
    return ops.length;
  }

  async function pullSettings() {
    const [p, u, n] = await Promise.all([
      client.from('profiles').select('display_name,timezone,updated_at').eq('id', user.id).maybeSingle(),
      client.from('user_preferences').select('*').eq('user_id', user.id).maybeSingle(),
      client.from('notification_preferences').select('*').eq('user_id', user.id).maybeSingle(),
    ]);
    for (const r of [p, u, n]) if (r.error) throw r.error;
    if (!Store.state.sync.settingsDirty && (p.data || u.data || n.data)) {
      Store.applySettingsRemote(rowsToSettings({ profile: p.data, prefs: u.data, notify: n.data }, Store.state.settings));
    }
    // The device's time zone is the source of truth for scheduling push notifications.
    if (p.data && p.data.timezone !== deviceTz()) {
      await client.from('profiles').update({ timezone: deviceTz() }).eq('id', user.id);
    }
  }

  async function pullEntitlement() {
    const { data, error } = await client.from('entitlements').select('plan,status,current_period_end').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    Account.set({ entitlement: data ? { plan: data.plan, status: data.status, currentPeriodEnd: data.current_period_end } : { plan: 'free', status: 'active', currentPeriodEnd: null } });
  }

  async function pull() {
    const c = cursors();
    const batch = {};
    const next = { ...c };
    for (const tbl of PULL_TABLES) {
      const rows = await fetchTable(tbl, c[tbl]);
      batch[tbl] = rows;
      if (rows.length) next[tbl] = rows[rows.length - 1].synced_at;
    }
    batch.notifications = await fetchNotifications();
    applyBatch(batch);
    saveCursors(next);
    await pullSettings();
    await pullEntitlement();
  }

  /* ------------------------------ push ------------------------------ */
  async function upsertSafely(tbl, rows, onConflict, extra = {}) {
    if (!rows.length) return { ok: [], failed: [] };
    const run = async (batch) => client.from(tbl).upsert(batch, { onConflict, ...extra });
    const first = await run(rows);
    if (!first.error) return { ok: rows.map((r) => r.id), failed: [] };
    if (!isPermanentError(first.error)) throw first.error;       // network / server trouble: keep everything queued and retry later
    // A genuinely invalid record must not block everything behind it: retry one by one, set aside the ones the server rejects.
    const ok = [], failed = [];
    for (const r of rows) {
      const one = await run([r]);
      if (!one.error) ok.push(r.id);
      else if (!isPermanentError(one.error)) throw one.error;
      else { failed.push({ id: r.id, message: one.error.message }); console.warn('[DAYMATE] Record rejected by server:', tbl, r.id, one.error.message); }
    }
    return { ok, failed };
  }

  async function push() {
    const st = Store.state;
    const done = { dirty: {}, tombstones: [], settings: false };
    const mark = (col, ids) => { (done.dirty[col] = done.dirty[col] || []).push(...ids); };

    // 1. upserts, grouped by cloud table
    const groups = new Map();           // `${col}|${tbl}` -> { col, tbl, items }
    const moves = [];                    // reminder moved between reminders <-> appointments
    for (const col of SYNC_COLLECTIONS) {
      for (const id of st.sync.dirty[col]) {
        const item = st[col].find((x) => x.id === id);
        if (!item) { mark(col, [id]); continue; }       // deleted meanwhile; tombstone covers it
        const tbl = tableFor(col, item);
        if (col === 'reminders' && item.tbl && item.tbl !== tbl) moves.push({ id, from: item.tbl, updatedAt: item.updatedAt });
        const key = `${col}|${tbl}`;
        if (!groups.has(key)) groups.set(key, { col, tbl, items: [] });
        groups.get(key).items.push(item);
      }
    }
    for (const m of moves) {
      const { error } = await client.from(m.from).update({ deleted_at: new Date().toISOString(), updated_at: m.updatedAt }).eq('id', m.id);
      if (error && isNetworkError(error)) throw error;
    }
    for (const { col, tbl, items } of groups.values()) {
      for (const part of chunk(items, 100)) {
        const rows = part.map((it) => toRow(col, it, user.id));
        const res = col === 'notifications'
          ? await upsertSafely(tbl, rows, 'user_id,dedupe_key', { ignoreDuplicates: true })
          : await upsertSafely(tbl, rows, 'user_id,id');
        if (col === 'notifications') {   // read / dismissed state on rows that may already exist
          for (const it of part.filter((n) => n.readAt || n.dismissedAt)) {
            const { error } = await client.from('notifications').update({ read_at: it.readAt || null, dismissed_at: it.dismissedAt || null }).eq('id', it.id);
            if (error && isNetworkError(error)) throw error;
          }
        }
        mark(col, [...res.ok, ...res.failed.map((f) => f.id)]);   // rejected ones are set aside, not retried forever
        res.failed.forEach((f) => quarantined.push({ col, ...f }));
        if (col === 'reminders') res.ok.forEach((id) => Store.patchQuiet('reminders', id, { tbl }));
      }
    }

    // 2. deletions
    const byTable = new Map();
    for (const t of st.sync.tombstones) {
      const tables = t.tbl ? [t.tbl] : t.col === 'reminders' ? ['reminders', 'appointments'] : [tableFor(t.col, {})];
      tables.forEach((tbl) => { if (!byTable.has(tbl)) byTable.set(tbl, []); byTable.get(tbl).push(t); });
    }
    for (const [tbl, list] of byTable) {
      for (const part of chunk(list, 100)) {
        const ids = part.map((t) => t.id);
        let error;
        if (tbl === 'notifications') ({ error } = await client.from(tbl).delete().in('id', ids));
        else {
          const when = part.reduce((m, t) => (t.deletedAt > m ? t.deletedAt : m), part[0].deletedAt);
          const patch = { deleted_at: when, updated_at: when };
          if (PRIVATE_TEXT_COLS.has(tbl)) { patch.content = '·'; patch.title = ''; }   // don't leave deleted memories readable
          ({ error } = await client.from(tbl).update(patch).in('id', ids));
        }
        if (error) { if (isNetworkError(error)) throw error; console.warn('[DAYMATE] Delete not applied:', tbl, error.message); }
      }
    }
    done.tombstones = st.sync.tombstones.slice();

    // 3. settings
    if (st.sync.settingsDirty) {
      const rows = settingsToRows(st.settings, deviceTz());
      const results = await Promise.all([
        client.from('profiles').update(rows.profile).eq('id', user.id),
        client.from('user_preferences').update(rows.prefs).eq('user_id', user.id),
        client.from('notification_preferences').update(rows.notify).eq('user_id', user.id),
      ]);
      const bad = results.find((r) => r.error);
      if (bad) throw bad.error;
      done.settings = true;
    }
    Store.clearSynced(done);
  }

  /* --------------------------- orchestration --------------------------- */
  function hasPending() {
    const s = Store.state.sync;
    return s.tombstones.length > 0 || s.settingsDirty || SYNC_COLLECTIONS.some((c) => s.dirty[c].length > 0);
  }

  async function runOnce() {
    setState('syncing');
    try {
      await push();
      await pull();
      await push();                       // anything the pull marked (e.g. merged read state)
      retryMs = 0;
      setState(quarantined.length ? 'error' : 'synced', quarantined.length ? `${quarantined.length} item(s) couldn't be saved to your account.` : '');
      return true;
    } catch (err) {
      const offline = isNetworkError(err);
      console.warn('[DAYMATE] Sync failed:', err && err.message);
      setState(offline ? 'offline' : 'error', offline ? '' : String(err && err.message || err));
      if (!stopped) {                    // retry with backoff: 15 s → 5 min
        retryMs = Math.min(retryMs ? retryMs * 2 : 15000, 300000);
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => sync(), retryMs);
      }
      return false;
    }
  }

  function sync() {
    if (stopped) return Promise.resolve(false);
    if (running) { rerun = true; return running; }
    running = (async () => {
      let ok = await runOnce();
      while (rerun && !stopped) { rerun = false; ok = await runOnce(); }
      return ok;
    })().finally(() => { running = null; });
    return running;
  }

  function schedulePush() {
    if (stopped) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { if (hasPending()) sync(); }, 1500);
  }

  const onVisible = () => { if (!document.hidden) sync(); };
  const onOnline = () => sync();

  return {
    hasPending,
    sync,
    applyBatch,
    quarantined,
    async start() {
      stopped = false;
      unsub = Store.subscribe((source) => { if (source === 'local') schedulePush(); });
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('online', onOnline);
      pollTimer = setInterval(() => { if (!document.hidden) sync(); }, 60000);
      return sync();
    },
    stop() {
      stopped = true;
      clearTimeout(pushTimer); clearTimeout(retryTimer); clearInterval(pollTimer);
      if (unsub) unsub();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    },
    forgetCursor() { LS.del(cursorKey); },
  };
}
