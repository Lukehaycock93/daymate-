// In-memory stand-in for the Supabase client, used ONLY by tests. It mirrors the server rules the
// real database enforces (per-user filtering, stale-write guard, synced_at stamping, dedupe keys).
window.makeFakeBackend = () => {
  const tables = {};
  ['tasks', 'appointments', 'reminders', 'shopping_items', 'household_info', 'memories', 'notifications'].forEach((t) => { tables[t] = []; });
  const settings = { profiles: [], user_preferences: [], notification_preferences: [], entitlements: [] };
  let tick = Date.parse('2030-01-01T00:00:00Z');
  const stamp = () => new Date((tick += 1000)).toISOString();
  const be = { tables, settings, offline: false, rejectTitle: null, failTable: null, calls: [], seedUser(uid, plan = 'free') {
    settings.profiles.push({ id: uid, display_name: '', timezone: 'Europe/London', updated_at: stamp() });
    settings.user_preferences.push({ user_id: uid, onboarded: false, premium_interest: false, memory_collection_paused: true });
    settings.notification_preferences.push({ user_id: uid, push_enabled: false, tasks_enabled: true, appointments_enabled: true, reminders_enabled: true, bills_enabled: true, lead_minutes: [0], default_time: '09:00:00', morning_summary_enabled: false, morning_summary_time: '08:00:00' });
    settings.entitlements.push({ user_id: uid, plan, status: 'active', current_period_end: null });
  } };
  const netErr = () => ({ data: null, error: { message: 'Failed to fetch' } });

  function client(uid) {
    const idCol = (t) => (t === 'profiles' ? 'id' : 'user_id');
    const rowsOf = (t) => (tables[t] ? tables[t] : settings[t]).filter((r) => r[idCol(t) === 'id' && !tables[t] ? 'id' : (tables[t] ? 'user_id' : idCol(t))] === uid);
    class Q {
      constructor(t) { this.t = t; this.op = 'select'; this.filters = []; this.lim = Infinity; this.ord = null; this.patch = null; this.rows = null; this.opts = {}; this.single = false; }
      select() { if (this.op === 'select') this.op = 'select'; return this; }
      order(c, o) { this.ord = [c, o.ascending !== false]; return this; }
      limit(n) { this.lim = n; return this; }
      gt(c, v) { this.filters.push((r) => r[c] > v); return this; }
      eq(c, v) { this.filters.push((r) => r[c] === v); return this; }
      in(c, vs) { this.filters.push((r) => vs.includes(r[c])); return this; }
      update(p) { this.op = 'update'; this.patch = p; return this; }
      delete() { this.op = 'delete'; return this; }
      upsert(rows, opts = {}) { this.op = 'upsert'; this.rows = rows; this.opts = opts; return this; }
      maybeSingle() { this.single = true; return this; }
      then(res, rej) { return Promise.resolve().then(() => this.exec()).then(res, rej); }
      exec() {
        be.calls.push(`${this.op}:${this.t}`);
        if (be.offline) return netErr();
        if (be.failTable === this.t && this.op !== 'select') return { data: null, error: { message: 'simulated server error', code: '500' } };
        const store = tables[this.t] || settings[this.t];
        if (!store) return { data: null, error: { message: 'no such table ' + this.t } };
        const own = (r) => r[tables[this.t] ? 'user_id' : (this.t === 'profiles' ? 'id' : 'user_id')] === uid;
        if (this.op === 'select') {
          let rows = store.filter(own).filter((r) => this.filters.every((f) => f(r)));
          if (this.ord) rows = rows.slice().sort((a, b) => (a[this.ord[0]] < b[this.ord[0]] ? -1 : 1) * (this.ord[1] ? 1 : -1));
          rows = rows.slice(0, this.lim).map((r) => ({ ...r }));
          return this.single ? { data: rows[0] || null, error: null } : { data: rows, error: null };
        }
        if (this.op === 'update') {
          store.filter(own).filter((r) => this.filters.every((f) => f(r))).forEach((r) => {
            if (tables[this.t] && this.patch.updated_at && r.updated_at && this.patch.updated_at < r.updated_at) return;       // stale-write trigger
            Object.assign(r, this.patch); if ('synced_at' in r) r.synced_at = stamp();
          });
          return { data: null, error: null };
        }
        if (this.op === 'delete') {
          for (let i = store.length - 1; i >= 0; i--) if (own(store[i]) && this.filters.every((f) => f(store[i]))) store.splice(i, 1);
          return { data: null, error: null };
        }
        if (this.op === 'upsert') {
          for (const row of this.rows) {
            if (row.user_id !== uid) return { data: null, error: { message: 'new row violates row-level security policy', code: '42501' } };
            if (be.rejectTitle && row.title === be.rejectTitle) return { data: null, error: { message: 'violates check constraint', code: '23514' } };
            if (this.t === 'notifications') {
              if (store.some((r) => r.user_id === uid && (r.id === row.id || r.dedupe_key === row.dedupe_key))) continue;   // ON CONFLICT DO NOTHING
              store.push({ ...row }); continue;
            }
            const ex = store.find((r) => r.user_id === uid && r.id === row.id);
            if (ex) { if (row.updated_at < ex.updated_at) continue; Object.assign(ex, row, { synced_at: stamp() }); }
            else store.push({ ...row, synced_at: stamp() });
          }
          return { data: null, error: null };
        }
        return { data: null, error: { message: 'unsupported' } };
      }
    }
    return { from: (t) => new Q(t), rpc: async () => ({ error: null }), functions: { invoke: async () => ({ data: { sent: 1 }, error: null }) }, auth: {} };
  }
  be.client = client;
  return be;
};
