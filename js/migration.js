/* ==========================================================================
   DAYMATE — device data → account migration

   Part 1 stored everything in localStorage under `daymate:v1`. When someone
   signs in we OFFER to move that data to their account. Safety rules:
     • nothing on the device is deleted until the cloud copy is read back and
       confirmed (every migrated id must exist in the database)
     • same ids are skipped, and so is the same content under a different id
       (e.g. already imported from another device) → no duplicates
     • a failure leaves the device data untouched; retrying is safe (idempotent)
     • a safety copy of the device data is kept in `daymate:premigration-backup`
   ========================================================================== */
import { isUuid, fingerprint, tableFor } from './mapping.js';

const COLS = ['tasks', 'reminders', 'shopping', 'memories', 'notifications'];
const BACKUP_KEY = 'daymate:premigration-backup';

const countOf = (s) => COLS.reduce((n, c) => n + s[c].length, 0);

/** Look at anonymous (signed-out) device data. Returns null when there is nothing worth moving. */
export function detectLocalData(DM) {
  const raw = DM.storage.safeLS.get(DM.APP.storageKey);
  if (!raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) { return null; }
  const state = DM.Store.sanitizeExternal(parsed);
  const total = countOf(state);
  if (!total && !state.settings.name) return null;
  const maxStamp = COLS.flatMap((c) => state[c].map((i) => i.updatedAt || i.createdAt)).sort().pop() || '';
  return { state, total, counts: Object.fromEntries(COLS.map((c) => [c, state[c].length])), fingerprint: `${total}|${maxStamp}|${state.settings.name}` };
}

export const skipKey = (uid) => `daymate:migration-skip:${uid}`;

/** Same input → same UUID, so a retried migration maps legacy ids identically and can never create twins. */
async function stableUuid(userId, legacyId) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`daymate-migrate:${userId}:${legacyId}`));
  const h = Array.from(new Uint8Array(buf).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${'89ab'[parseInt(h[16], 16) % 4]}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function remapIds(state, userId) {
  const map = new Map();
  for (const c of COLS) {
    for (const it of state[c]) {
      if (!isUuid(it.id)) { const n = await stableUuid(userId, it.id); map.set(it.id, n); it.id = n; }
    }
  }
  state.notifications.forEach((n) => { if (n.sourceId && map.has(n.sourceId)) n.sourceId = map.get(n.sourceId); });
}

/**
 * Move device data into the signed-in account.
 * `deps` = { DM, session }  (session.sync is the running sync engine)
 */
export async function migrate({ DM, session, onProgress = () => {} }) {
  const { Store, storage } = DM;
  const found = detectLocalData(DM);
  if (!found) return { ok: true, added: 0, duplicates: 0, nothing: true };
  const uid = session.user.id;
  const anon = found.state;

  // 0. safety copy
  try { storage.safeLS.set(BACKUP_KEY, JSON.stringify({ at: new Date().toISOString(), userId: uid, data: anon })); } catch (_) { /* best effort */ }

  try {
    onProgress('Reading your account…');
    await session.sync.sync();                       // make sure the Store already holds what the cloud has
    if (session.sync.hasPending() === false && DM.Account.syncState === 'offline') throw new Error('You appear to be offline.');

    await remapIds(anon, uid);

    // 1. work out what is genuinely new
    const st = Store.state;
    const have = {};
    COLS.forEach((c) => { have[c] = { ids: new Set(st[c].map((i) => i.id)), prints: new Set(st[c].map((i) => fingerprint(c, i))) }; });
    const toAdd = {}, toVerify = {};
    let duplicates = 0, resumed = 0;
    COLS.forEach((c) => {
      toAdd[c] = []; toVerify[c] = [];
      anon[c].forEach((it) => {
        const fp = fingerprint(c, it);
        if (have[c].ids.has(it.id)) { resumed++; toVerify[c].push(it); return; }       // imported by an earlier, interrupted attempt: still must be confirmed
        if (have[c].prints.has(fp)) { duplicates++; return; }                           // same thing already in the account under another id
        have[c].prints.add(fp);
        toAdd[c].push({ ...it }); toVerify[c].push(it);
      });
    });
    const added = COLS.reduce((n, c) => n + toAdd[c].length, 0) + resumed;

    // 2. bring it in as normal (dirty) records and settings
    onProgress('Saving to your account…');
    COLS.forEach((c) => { if (toAdd[c].length) Store.importItems(c, toAdd[c]); });
    const patch = {};
    if (!st.settings.name && anon.settings.name) patch.name = anon.settings.name;
    if (anon.settings.premiumInterest && !st.settings.premiumInterest) patch.premiumInterest = true;
    patch.onboarded = true;
    Store.setSettings(patch);
    await Store.flush();

    const ok = await session.sync.sync();
    if (!ok || session.sync.hasPending() || session.sync.quarantined.length) throw new Error('Some items could not be saved to your account yet.');

    // 3. confirm: every item we added must now exist in the cloud
    onProgress('Checking everything arrived…');
    for (const c of COLS) {
      if (!toVerify[c].length) continue;
      const tableGroups = new Map();
      toVerify[c].forEach((it) => { const t = tableFor(c, it); if (!tableGroups.has(t)) tableGroups.set(t, []); tableGroups.get(t).push(it.id); });
      for (const [tbl, tids] of tableGroups) {
        for (let i = 0; i < tids.length; i += 150) {
          const part = tids.slice(i, i + 150);
          const { data, error } = await session.client.from(tbl).select('id').in('id', part);
          if (error) throw error;
          if (data.length !== part.length) throw new Error(`Only ${data.length} of ${part.length} ${c} were confirmed.`);
        }
      }
    }

    // 4. confirmed → only now remove the device-only copy
    storage.safeLS.del(DM.APP.storageKey);
    storage.safeLS.del(skipKey(uid));
    return { ok: true, added, duplicates };
  } catch (err) {
    console.warn('[DAYMATE] Migration failed; device data was left untouched:', err);
    return { ok: false, error: String((err && err.message) || err) };
  }
}
