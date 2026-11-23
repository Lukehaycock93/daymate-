/* ==========================================================================
   DAYMATE — app.js (Part 2)
   --------------------------------------------------------------------------
   One file, organised into clearly separated modules so it can be split into
   ES modules later (js/store.js, js/entitlements.js …) with no logic changes.

   MODULE MAP
     1.  Config            App constants, feature catalogue, preview content
     2.  Utils             Dates, escaping, ids, DOM helpers
     3.  Storage adapters  Local cache (per signed-in user, or anonymous)
     4.  Store             In-memory state, validation, persistence, undo,
                           plus sync bookkeeping (dirty ids + tombstones)
     5.  Account & Entitlements   Free/Premium gate fed by server entitlements
     6.  UI primitives     Icons, modals, toasts
     7.  Selectors         Derived data (today's tasks, upcoming, stats)
     8.  Renderers         Home, preview screens, More, Premium
     9.  Flows             Task / reminder / shopping / settings forms
     10. Router & events   Hash routing, delegated clicks, init

   PART 2 ADDITIONS (accounts, cloud sync, memory, notifications)
     The new features live in js/*.js (ES modules). They plug into this file
     through the small bridge exposed as window.DAYMATE at the end of boot():
     registerRoute / registerActions / onRender / onSettingsOpen + Store/UI/etc.
     Premium is decided by the server-side `entitlements` table; the browser only
     ever displays it (see Account.getPlan).
   ========================================================================== */
(() => {
  'use strict';

  /* ======================================================================
     1. CONFIG
     ====================================================================== */
  const APP = {
    name: 'DAYMATE',
    tagline: 'Your Life, Better Organised.',
    version: '0.2.0',
    stage: 2,
    storageKey: 'daymate:v1',          // anonymous / signed-out data (unchanged from Part 1)
    userKeyPrefix: 'daymate:u:',       // per-user cache once signed in
    lastUserKey: 'daymate:lastUser',   // pointer only; never trusted for cloud access
    schemaVersion: 2,
  };

  const ROUTES = {
    home:      { title: null,        sub: null },
    planner:   { title: 'Planner',   sub: 'Plan your days with ease' },
    money:     { title: 'Money',     sub: 'Calm control of your finances' },
    household: { title: 'Household', sub: 'Keep your home running smoothly' },
    more:      { title: 'More',      sub: 'Account, settings and what’s next' },
    notifications: { title: 'Notifications', sub: 'Reminders, alerts and history' },
    memory:        { title: 'Memory',        sub: 'Things DAYMATE should remember' },
  };

  /**
   * Feature catalogue — the single source of truth for what is Free and what
   * is Premium. Premium rows drive the Premium screen and every locked door.
   */
  const FEATURES = {
    tasks:     { tier: 'free' },
    reminders: { tier: 'free' },
    shopping:  { tier: 'free' },
    accounts:  { tier: 'free' },
    'memory-manual':        { tier: 'free' },
    'notifications-basic':  { tier: 'free' },

    'ai-assistant':       { tier: 'premium', icon: 'sparkles',       title: 'AI life assistant',            text: 'Ask, plan and organise your day in plain English.' },
    'gmail':              { tier: 'premium', icon: 'mail',           title: 'Gmail integration',            text: 'Turn emails into tasks, bills and appointments.' },
    'google-calendar':    { tier: 'premium', icon: 'calendar',       title: 'Google Calendar integration',  text: 'Two-way sync with the calendar you already use.' },
    'outlook':            { tier: 'premium', icon: 'calendar-check', title: 'Microsoft Outlook integration', text: 'Bring your Outlook mail and calendar into one place.' },
    'smart-reminders':    { tier: 'premium', icon: 'bolt',           title: 'Advanced smart reminders',     text: 'Repeating, location-aware reminders that nudge until done.' },
    'budgeting':          { tier: 'premium', icon: 'chart',          title: 'Budgeting & bill management',  text: 'Set budgets, track spending and never miss a bill.' },
    'meal-planning':      { tier: 'premium', icon: 'utensils',       title: 'Meal planning',                text: 'Weekly meal plans that build your shopping list.' },
    'household-advanced': { tier: 'premium', icon: 'sofa',           title: 'Advanced household management', text: 'Shared homes, chore rotas and maintenance schedules.' },
    'smart-scheduling':   { tier: 'premium', icon: 'clock',          title: 'Intelligent daily scheduling', text: 'A suggested plan for your day, built around your commitments.' },
    'morning-briefing':   { tier: 'premium', icon: 'bell',           title: 'Personalised morning briefings', text: 'A daily push summary of your tasks, appointments and bills.' },
    'memory-advanced':    { tier: 'premium', icon: 'sparkles',       title: 'Advanced memory features',     text: 'Smarter organisation and review of everything DAYMATE remembers.' },
    'ai-memory':          { tier: 'premium', icon: 'sparkles',       title: 'AI-powered memory retrieval',  text: 'Ask DAYMATE what it knows and get the right memory back. Not available yet.' },
    'ad-free':            { tier: 'premium', icon: 'shield',         title: 'Ad-free experience',           text: 'Enjoy DAYMATE without any adverts.' },
  };

  /** Content for the preview screens (Planner / Money / Household). */
  const PREVIEWS = {
    planner: {
      icon: 'calendar',
      heroTitle: 'Your whole week, at a glance.',
      heroText: 'A full planner is on its way. Until then, tasks and reminders from Home are counted below.',
      extra: 'week',
      groups: [
        { title: 'Coming to everyone', items: [
          { status: 'soon', icon: 'calendar', title: 'Week & month views', text: 'See everything on one clear, scrollable calendar.' },
          { status: 'soon', icon: 'repeat',   title: 'Repeating tasks',    text: 'Set it once — repeat daily, weekly or monthly.' },
          { status: 'soon', icon: 'clock',    title: 'Appointment timeline', text: 'Your day laid out hour by hour.' },
        ]},
        { title: 'With Premium', items: [
          { status: 'premium', feature: 'google-calendar' },
          { status: 'premium', feature: 'outlook' },
          { status: 'premium', feature: 'smart-scheduling' },
        ]},
      ],
    },
    money: {
      icon: 'wallet',
      heroTitle: 'Calm control of your money.',
      heroText: 'Budgets, bills and goals — all in the same place as the rest of your life. Coming in a future update.',
      extra: 'budget',
      groups: [
        { title: 'Coming to everyone', items: [
          { status: 'soon', icon: 'target',  title: 'Savings goals',  text: 'Set a goal and watch your progress grow.' },
          { status: 'soon', icon: 'receipt', title: 'Spending notes', text: 'Jot down what you spend in a couple of taps.' },
        ]},
        { title: 'With Premium', items: [
          { status: 'premium', feature: 'budgeting' },
          { status: 'premium', feature: 'gmail' },
        ]},
      ],
    },
    household: {
      icon: 'sofa',
      heroTitle: 'A home that runs itself (almost).',
      heroText: 'Your shopping list is ready now. Chores, routines and meal planning are on the way.',
      extra: null,
      groups: [
        { title: 'Available now', items: [
          { status: 'live', icon: 'basket', title: 'Shopping list', action: 'open-shopping', dynamic: 'shopping' },
        ]},
        { title: 'Coming to everyone', items: [
          { status: 'soon', icon: 'repeat', title: 'Chores & routines', text: 'Recurring jobs that never slip through the cracks.' },
          { status: 'soon', icon: 'bell',   title: 'Home notes & key dates', text: 'Bin days, renewals, birthdays — all in one spot.' },
        ]},
        { title: 'With Premium', items: [
          { status: 'premium', feature: 'meal-planning' },
          { status: 'premium', feature: 'household-advanced' },
        ]},
      ],
    },
  };

  const ROADMAP = [
    { status: 'soon', icon: 'calendar', title: 'Calendar & email connections', text: 'Connect Google and Microsoft accounts.' },
    { status: 'soon', icon: 'sparkles', title: 'AI assistant & AI memory',     text: 'A personal assistant that remembers and helps run your day.' },
    { status: 'soon', icon: 'card',     title: 'Premium subscriptions',        text: 'Secure payments are still to come.' },
  ];

  const PRIORITIES = ['low', 'medium', 'high'];
  const PRIORITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High' };
  const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

  /** DAYMATE Memory categories (keys match the database check constraint). */
  const MEMORY_CATEGORIES = [
    { key: 'personal_preferences', label: 'Personal preferences',  icon: 'user',     hint: 'How you like things done.' },
    { key: 'daily_routines',       label: 'Daily routines',        icon: 'clock',    hint: 'Habits and regular times.' },
    { key: 'household',            label: 'Household information', icon: 'sofa',     hint: 'Bin days, wifi, who lives where.' },
    { key: 'important_dates',      label: 'Important dates',       icon: 'calendar', hint: 'Birthdays, renewals, anniversaries.' },
    { key: 'goals',                label: 'Goals and ambitions',   icon: 'target',   hint: 'What you’re working towards.' },
    { key: 'shopping_preferences', label: 'Shopping preferences',  icon: 'basket',   hint: 'Brands, sizes, favourite shops.' },
    { key: 'meal_preferences',     label: 'Meal preferences',      icon: 'utensils', hint: 'Likes, dislikes and go-to meals.' },
    { key: 'ongoing_projects',     label: 'Ongoing projects',      icon: 'flag',     hint: 'Things you’re in the middle of.' },
    { key: 'conversation_info',    label: 'Useful information',    icon: 'info',     hint: 'Handy facts worth keeping.' },
  ];
  const MEMORY_KEYS = MEMORY_CATEGORIES.map((c) => c.key);
  const NOTIF_TYPES = ['task', 'appointment', 'reminder', 'bill', 'missed', 'summary', 'system'];
  const COLLECTIONS = ['tasks', 'reminders', 'shopping', 'memories', 'notifications'];
  const REMINDER_KINDS = ['reminder', 'event', 'bill'];

  /* ======================================================================
     2. UTILS
     ====================================================================== */
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const pad = (n) => String(n).padStart(2, '0');
  const toDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayStr = () => toDateStr(new Date());
  const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return toDateStr(d); };
  const isValidDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && toDateStr(parseDate(s)) === s;
  const isValidTime = (s) => s === '' || (typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s));

  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const shortName = (s) => s.slice(0, 3);

  const longDate = (d = new Date()) => `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  function dayLabel(dateStr, today = todayStr()) {
    if (dateStr === today) return 'Today';
    if (dateStr === addDays(today, 1)) return 'Tomorrow';
    if (dateStr === addDays(today, -1)) return 'Yesterday';
    const d = parseDate(dateStr);
    const year = d.getFullYear() !== parseDate(today).getFullYear() ? ` ${d.getFullYear()}` : '';
    return `${shortName(WEEKDAYS[d.getDay()])} ${d.getDate()} ${shortName(MONTHS[d.getMonth()])}${year}`;
  }

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const uid = () => {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
  const nowISO = () => new Date().toISOString();
  const cleanText = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const cleanMultiline = (s, max) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);

  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  /* ======================================================================
     3. STORAGE ADAPTERS
     Contract:  load() → Promise<object|null>
                save(state) → Promise<void>   (may throw)
                onExternalChange(cb) (optional) → fires when another tab/device changed data
     ====================================================================== */
  const localAdapter = (key) => ({
    name: 'local',
    key,
    async load() {
      try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch (err) {
        console.warn('[DAYMATE] Could not read saved data:', err);
        return null;
      }
    },
    async save(state) {
      window.localStorage.setItem(key, JSON.stringify(state));
    },
    onExternalChange(cb) {
      window.addEventListener('storage', (e) => { if (e.key === key) cb(); });
    },
  });
  const userCacheKey = (userId) => `${APP.userKeyPrefix}${userId}`;
  const safeLS = {
    get(k) { try { return window.localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { window.localStorage.setItem(k, v); } catch (_) { /* ignore */ } },
    del(k) { try { window.localStorage.removeItem(k); } catch (_) { /* ignore */ } },
  };

  /* ======================================================================
     4. STORE
     In-memory state, validated on load, persisted through the adapter.
     Every record carries id + createdAt + updatedAt so it can sync later.
     ====================================================================== */
  const NOTIFY_DEFAULTS = Object.freeze({
    push: false, tasks: true, appointments: true, reminders: true, bills: true,
    leadMinutes: [0], defaultTime: '09:00', morningSummary: false, morningTime: '08:00',
  });

  const Store = (() => {
    let state = blank();
    let adapter = null;
    let saveTimer = null;
    let saveFailedNotified = false;
    let tracking = false;               // true while signed in: record dirty ids + tombstones for sync
    const subs = new Set();

    function emptySync() { return { dirty: { tasks: [], reminders: [], shopping: [], memories: [], notifications: [] }, tombstones: [], settingsDirty: false }; }

    function blank() {
      return {
        schemaVersion: APP.schemaVersion,
        settings: { name: '', onboarded: false, premiumInterest: false, memoryPaused: true, notify: { ...NOTIFY_DEFAULTS, leadMinutes: [0] }, updatedAt: '' },
        tasks: [],
        reminders: [],
        shopping: [],
        memories: [],
        notifications: [],
        sync: emptySync(),
      };
    }

    function sanitizeNotify(n) {
      const d = { ...NOTIFY_DEFAULTS, leadMinutes: [0] };
      if (!n || typeof n !== 'object') return d;
      const out = { ...d };
      ['push', 'tasks', 'appointments', 'reminders', 'bills', 'morningSummary'].forEach((k) => { if (typeof n[k] === 'boolean') out[k] = n[k]; });
      if (Array.isArray(n.leadMinutes)) {
        const lead = n.leadMinutes.map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 10080);
        if (lead.length) out.leadMinutes = Array.from(new Set(lead)).slice(0, 4);
      }
      if (isValidTime(n.defaultTime) && n.defaultTime) out.defaultTime = n.defaultTime;
      if (isValidTime(n.morningTime) && n.morningTime) out.morningTime = n.morningTime;
      return out;
    }

    function sanitize(raw) {
      const s = blank();
      if (!raw || typeof raw !== 'object') return s;
      const today = todayStr();
      const stamp = (v) => (typeof v === 'string' && v ? v : nowISO());
      const id = (v) => (typeof v === 'string' && v ? v : uid());
      const optStamp = (v) => (typeof v === 'string' && v ? v : '');

      const set = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
      s.settings.name = cleanText(set.name, 30);
      s.settings.onboarded = set.onboarded === true;
      s.settings.premiumInterest = set.premiumInterest === true;
      s.settings.memoryPaused = set.memoryPaused !== false;       // paused unless explicitly switched on
      s.settings.notify = sanitizeNotify(set.notify);
      s.settings.updatedAt = optStamp(set.updatedAt);

      if (Array.isArray(raw.tasks)) {
        raw.tasks.forEach((t) => {
          if (!t || typeof t !== 'object') return;
          const title = cleanText(t.title, 120);
          if (!title) return;
          const completed = t.completed === true;
          s.tasks.push({
            id: id(t.id), title,
            priority: PRIORITIES.includes(t.priority) ? t.priority : 'medium',
            date: isValidDate(t.date) ? t.date : today,
            time: isValidTime(t.time) ? t.time : '',
            completed,
            completedOn: completed && isValidDate(t.completedOn) ? t.completedOn : '',
            completedAt: completed && typeof t.completedAt === 'string' ? t.completedAt : '',
            createdAt: stamp(t.createdAt), updatedAt: stamp(t.updatedAt),
          });
        });
      }
      if (Array.isArray(raw.reminders)) {
        raw.reminders.forEach((r) => {
          if (!r || typeof r !== 'object') return;
          const title = cleanText(r.title, 120);
          if (!title) return;
          s.reminders.push({
            id: id(r.id), title,
            kind: REMINDER_KINDS.includes(r.kind) ? r.kind : 'reminder',
            date: isValidDate(r.date) ? r.date : today,
            time: isValidTime(r.time) ? r.time : '',
            note: cleanText(r.note, 200),
            done: r.done === true,
            tbl: r.tbl === 'appointments' || r.tbl === 'reminders' ? r.tbl : '',   // which cloud table currently holds it
            createdAt: stamp(r.createdAt), updatedAt: stamp(r.updatedAt),
          });
        });
      }
      if (Array.isArray(raw.shopping)) {
        raw.shopping.forEach((i) => {
          if (!i || typeof i !== 'object') return;
          const name = cleanText(i.name, 80);
          if (!name) return;
          s.shopping.push({ id: id(i.id), name, checked: i.checked === true, createdAt: stamp(i.createdAt), updatedAt: stamp(i.updatedAt) });
        });
      }
      if (Array.isArray(raw.memories)) {
        raw.memories.forEach((m) => {
          if (!m || typeof m !== 'object') return;
          const content = cleanMultiline(m.content, 1000);
          if (!content) return;
          s.memories.push({
            id: id(m.id),
            category: MEMORY_KEYS.includes(m.category) ? m.category : 'conversation_info',
            title: cleanText(m.title, 80),
            content,
            source: m.source === 'ai' ? 'ai' : 'manual',
            sensitive: m.sensitive === true,
            createdAt: stamp(m.createdAt), updatedAt: stamp(m.updatedAt),
          });
        });
      }
      if (Array.isArray(raw.notifications)) {
        raw.notifications.forEach((n) => {
          if (!n || typeof n !== 'object') return;
          const title = cleanText(n.title, 160);
          const dedupeKey = cleanText(n.dedupeKey, 200);
          if (!title || !dedupeKey) return;
          s.notifications.push({
            id: id(n.id),
            type: NOTIF_TYPES.includes(n.type) ? n.type : 'system',
            title, body: cleanText(n.body, 300),
            sourceType: cleanText(n.sourceType, 20), sourceId: cleanText(n.sourceId, 64),
            dedupeKey,
            createdAt: stamp(n.createdAt), readAt: optStamp(n.readAt), dismissedAt: optStamp(n.dismissedAt),
          });
        });
      }

      const sy = raw.sync && typeof raw.sync === 'object' ? raw.sync : {};
      COLLECTIONS.forEach((c) => {
        const list = sy.dirty && Array.isArray(sy.dirty[c]) ? sy.dirty[c] : [];
        s.sync.dirty[c] = Array.from(new Set(list.filter((x) => typeof x === 'string' && x)));
      });
      if (Array.isArray(sy.tombstones)) {
        sy.tombstones.forEach((t) => {
          if (!t || !COLLECTIONS.includes(t.col) || typeof t.id !== 'string' || !t.id) return;
          s.sync.tombstones.push({ col: t.col, id: t.id, tbl: t.tbl === 'appointments' || t.tbl === 'reminders' ? t.tbl : '', deletedAt: stamp(t.deletedAt) });
        });
      }
      s.sync.settingsDirty = sy.settingsDirty === true;
      return s;
    }

    const emit = (source) => subs.forEach((fn) => fn(source));

    function queueSave() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flush, 150);
    }
    async function flush() {
      clearTimeout(saveTimer);
      if (!adapter) return;
      try { await adapter.save(state); saveFailedNotified = false; }
      catch (err) {
        console.warn('[DAYMATE] Save failed:', err);
        if (!saveFailedNotified) {
          saveFailedNotified = true;
          UI.toast('Couldn’t save to this browser. Changes may be lost when you close the app.', { duration: 6000 });
        }
      }
    }
    function commit(source = 'local') { queueSave(); emit(source); }

    /* ---- sync bookkeeping (only while signed in) ---- */
    function markDirty(col, id) {
      if (!tracking) return;
      const list = state.sync.dirty[col];
      if (!list.includes(id)) list.push(id);
      state.sync.tombstones = state.sync.tombstones.filter((t) => !(t.col === col && t.id === id));
    }
    function addTombstone(col, item) {
      if (!tracking) return;
      state.sync.dirty[col] = state.sync.dirty[col].filter((x) => x !== item.id);
      state.sync.tombstones = state.sync.tombstones.filter((t) => !(t.col === col && t.id === item.id));
      state.sync.tombstones.push({ col, id: item.id, tbl: item.tbl || '', deletedAt: nowISO() });
    }
    const hasTombstone = (col, id) => state.sync.tombstones.some((t) => t.col === col && t.id === id);

    return {
      async init(a) { await this.useAdapter(a); },
      /** Load state from a different adapter (e.g. switching to a signed-in user's cache). */
      async useAdapter(a) {
        await flush();
        adapter = a;
        state = sanitize(await a.load());
        if (a.onExternalChange) {
          a.onExternalChange(async () => { if (a !== adapter) return; state = sanitize(await a.load()); emit('external'); });
        }
        emit('adapter');
      },
      get adapterKey() { return adapter ? adapter.key : ''; },
      get state() { return state; },
      subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
      flush,
      setTracking(on) { tracking = !!on; },
      get tracking() { return tracking; },

      get(col, id) { return state[col].find((x) => x.id === id) || null; },
      add(col, fields) {
        const stamp = nowISO();
        const item = { id: uid(), ...fields, createdAt: stamp, updatedAt: stamp };
        state[col].push(item);
        markDirty(col, item.id);
        commit();
        return item;
      },
      update(col, id, patch) {
        const item = this.get(col, id);
        if (!item) return null;
        Object.assign(item, patch, { updatedAt: nowISO() });
        markDirty(col, id);
        commit();
        return item;
      },
      remove(col, id) {
        const index = state[col].findIndex((x) => x.id === id);
        if (index < 0) return null;
        const [item] = state[col].splice(index, 1);
        addTombstone(col, item);
        commit();
        return { item, index };
      },
      restore(col, item, index) {
        item.updatedAt = nowISO();          // newer than the delete, so it wins when synced
        state[col].splice(Math.min(index, state[col].length), 0, item);
        markDirty(col, item.id);
        commit();
      },
      /** Bring in items from elsewhere (device data → account), keeping ids and timestamps. */
      importItems(col, items) {
        items.forEach((it) => { state[col].push(it); markDirty(col, it.id); });
        if (items.length) commit();
      },
      replace(col, items) {
        const keep = new Set(items.map((x) => x.id));
        state[col].forEach((old) => { if (!keep.has(old.id)) addTombstone(col, old); });
        items.forEach((it) => {
          if (hasTombstone(col, it.id)) { it.updatedAt = nowISO(); markDirty(col, it.id); }   // undo of a delete
        });
        state[col] = items;
        commit();
      },
      setSettings(patch) {
        Object.assign(state.settings, patch);
        if (tracking) { state.settings.updatedAt = nowISO(); state.sync.settingsDirty = true; }
        commit();
      },
      reset() {
        const old = state;
        state = blank();
        if (tracking) {
          COLLECTIONS.forEach((c) => old[c].forEach((item) => {
            state.sync.tombstones.push({ col: c, id: item.id, tbl: item.tbl || '', deletedAt: nowISO() });
          }));
          state.sync.settingsDirty = true;
          state.settings.updatedAt = nowISO();
        }
        commit();
      },

      /* ---- used by the sync / migration modules ---- */
      /** Apply records that arrived from the cloud. Does NOT mark anything dirty. */
      applyRemote(ops) {
        ops.forEach((op) => {
          const list = state[op.col];
          const i = list.findIndex((x) => x.id === op.id);
          if (op.remove) { if (i >= 0) list.splice(i, 1); }
          else if (i >= 0) list[i] = op.item;
          else list.push(op.item);
        });
        if (ops.length) commit('remote');
      },
      applySettingsRemote(patch) { Object.assign(state.settings, patch); commit('remote'); },
      /** After a successful push: forget those ids / tombstones. */
      clearSynced({ dirty = {}, tombstones = [], settings = false }) {
        Object.keys(dirty).forEach((c) => { const done = new Set(dirty[c]); state.sync.dirty[c] = state.sync.dirty[c].filter((x) => !done.has(x)); });
        if (tombstones.length) { const done = new Set(tombstones.map((t) => `${t.col}:${t.id}`)); state.sync.tombstones = state.sync.tombstones.filter((t) => !done.has(`${t.col}:${t.id}`)); }
        if (settings) state.sync.settingsDirty = false;
        queueSave();
      },
      /** Set a record's bookkeeping field (e.g. tbl) without bumping updatedAt. */
      patchQuiet(col, id, patch) { const it = this.get(col, id); if (it) { Object.assign(it, patch); queueSave(); } },
      markAllDirty() {
        COLLECTIONS.forEach((c) => { state.sync.dirty[c] = state[c].map((x) => x.id); });
        state.sync.tombstones = [];
        state.sync.settingsDirty = true;
        queueSave();
      },
      /** A deep copy of user data without internal sync bookkeeping (for backups / migration). */
      snapshot() {
        const copy = JSON.parse(JSON.stringify(state));
        delete copy.sync;
        return copy;
      },
      sanitizeExternal: sanitize,
    };
  })();

  /* ======================================================================
     5. ACCOUNT & ENTITLEMENTS
     The plan is NEVER read from localStorage, so it can't be switched on by
     editing local data. It is fetched from the server's `entitlements` table
     (read-only for the signed-in user) and held in memory only. Everything
     here is for DISPLAY: the database and Edge Functions enforce Premium
     rules themselves (see supabase/migrations). Stripe will later write that
     table from a webhook; nothing in the browser can.
     ====================================================================== */
  const Account = {
    user: null,                  // { id, email } when signed in
    entitlement: null,           // { plan, status, currentPeriodEnd } from the server
    configured: false,           // Supabase settings present in config.js
    syncState: 'local',          // local | syncing | synced | offline | error
    syncDetail: '',
    getPlan() {
      const e = this.entitlement;
      if (!this.user || !e) return 'free';
      const live = e.plan === 'premium' && ['active', 'trialing'].includes(e.status)
        && (!e.currentPeriodEnd || new Date(e.currentPeriodEnd) > new Date());
      return live ? 'premium' : 'free';
    },
    planLabel() { return this.getPlan() === 'premium' ? 'Premium' : 'Free plan'; },
    /** Modules call this when account/sync info changes; it refreshes the UI. */
    set(patch) { Object.assign(this, patch); if (typeof renderAll === 'function' && ui.ready) renderAll(); },
  };

  const Entitlements = {
    plan() { return Account.getPlan(); },
    has(featureId) {
      const f = FEATURES[featureId];
      if (!f) return false;
      return f.tier === 'free' || this.plan() === 'premium';
    },
    /** Run `fn` if allowed, otherwise show the Premium screen focused on that feature. */
    guard(featureId, fn) {
      if (this.has(featureId)) return fn();
      openPremium(featureId);
      return undefined;
    },
    premiumFeatures() {
      return Object.entries(FEATURES).filter(([, f]) => f.tier === 'premium').map(([id, f]) => ({ id, ...f }));
    },
  };

  /* ======================================================================
     6. UI PRIMITIVES
     ====================================================================== */
  const icon = (name, cls = '') => `<svg class="icon ${cls}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;

  const Modal = (() => {
    let z = 100;
    const stack = [];
    const lastFocus = new Map();
    const timers = new Map();

    function open(id, opts = {}) {
      const el = document.getElementById(id);
      if (!el) return null;
      clearTimeout(timers.get(id));
      if (!stack.includes(id)) stack.push(id);
      lastFocus.set(id, document.activeElement);
      el.style.zIndex = String(++z);
      el.hidden = false;
      el.classList.remove('is-closing');
      document.body.classList.add('is-locked');
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-open')));
      if (opts.focus) setTimeout(() => { const f = $(opts.focus, el); if (f) f.focus({ preventScroll: true }); }, 80);
      return el;
    }

    function close(id) {
      const el = document.getElementById(id);
      if (!el || el.hidden || !stack.includes(id)) return;
      stack.splice(stack.lastIndexOf(id), 1);
      el.dispatchEvent(new CustomEvent('modal:close'));
      el.classList.remove('is-open');
      el.classList.add('is-closing');
      if (!stack.length) document.body.classList.remove('is-locked');
      timers.set(id, setTimeout(() => {
        el.hidden = true;
        el.classList.remove('is-closing');
        const sheet = $('.sheet', el);
        if (sheet) sheet.style.transform = '';
      }, 320));
      const prev = lastFocus.get(id);
      lastFocus.delete(id);
      if (prev && typeof prev.focus === 'function' && document.contains(prev)) prev.focus({ preventScroll: true });
    }

    return { open, close, top: () => stack[stack.length - 1], isOpen: (id) => stack.includes(id) };
  })();

  const UI = {
    toast(message, opts = {}) {
      const root = $('#toasts');
      if (!root) return;
      while (root.children.length >= 2) root.firstElementChild.remove();
      const el = document.createElement('div');
      el.className = 'toast';
      el.setAttribute('role', 'status');
      const msg = document.createElement('span');
      msg.textContent = message;
      el.appendChild(msg);
      let timer;
      const dismiss = () => {
        clearTimeout(timer);
        if (!el.parentNode) return;
        el.classList.add('is-leaving');
        setTimeout(() => el.remove(), 260);
      };
      if (opts.action) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'toast__btn';
        btn.textContent = opts.action.label;
        btn.addEventListener('click', () => { dismiss(); opts.action.fn(); });
        el.appendChild(btn);
      }
      root.appendChild(el);
      timer = setTimeout(dismiss, opts.duration || 4500);
    },
  };

  function confirmDialog({ title, message, okLabel = 'Confirm' }) {
    return new Promise((resolve) => {
      $('#confirmTitle').textContent = title;
      $('#confirmText').textContent = message;
      const ok = $('#confirmOk');
      const cancel = $('#confirmCancel');
      const el = $('#m-confirm');
      ok.textContent = okLabel;
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        ok.removeEventListener('click', onOk);
        cancel.removeEventListener('click', onCancel);
        el.removeEventListener('modal:close', onClose);
        resolve(value);
      };
      const onOk = () => { finish(true); Modal.close('m-confirm'); };
      const onCancel = () => Modal.close('m-confirm');
      const onClose = () => finish(false);
      ok.addEventListener('click', onOk);
      cancel.addEventListener('click', onCancel);
      el.addEventListener('modal:close', onClose);
      Modal.open('m-confirm', { focus: '#confirmCancel' });
    });
  }

  /* ======================================================================
     7. SELECTORS (derived data)
     ====================================================================== */
  const ui = {
    route: 'home',
    filter: 'all',
    upExpanded: false,
    showDone: false,
    hold: false,           // pauses task-list re-render so the tick animation can play
    holdTimer: null,
    seen: new Set(),       // ids already rendered (so only new rows animate in)
    barsShown: false,
    sig: '',
    welcomed: false,
    ready: false,
  };

  /** Extension points used by js/*.js modules (see window.DAYMATE at the end of boot). */
  const extraRoutes = {};
  const hooks = { render: [], settingsOpen: [] };
  const runHooks = (list) => list.forEach((fn) => { try { fn(); } catch (err) { console.warn('[DAYMATE] hook failed:', err); } });

  function compareTasks(a, b, today) {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (a.completed) return (b.completedAt || '').localeCompare(a.completedAt || '');
    const ao = a.date < today, bo = b.date < today;
    if (ao !== bo) return ao ? -1 : 1;
    if (PRIORITY_RANK[a.priority] !== PRIORITY_RANK[b.priority]) return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    const at = a.time || '99:99', bt = b.time || '99:99';
    if (at !== bt) return at < bt ? -1 : 1;
    return a.createdAt.localeCompare(b.createdAt);
  }

  /** Everything that belongs on "My day": due today, overdue & unfinished, or finished today. */
  function dayData() {
    const today = todayStr();
    const list = Store.state.tasks
      .filter((t) => t.date === today || (!t.completed && t.date < today) || (t.completed && t.completedOn === today))
      .sort((a, b) => compareTasks(a, b, today));
    const done = list.filter((t) => t.completed);
    const remaining = list.filter((t) => !t.completed);
    return { today, list, done, remaining };
  }

  const isReminderOverdue = (r, today = todayStr(), hm = nowHM()) =>
    !r.done && (r.date < today || (r.date === today && r.time !== '' && r.time < hm));

  function upcomingItems() {
    const today = todayStr();
    const hm = nowHM();
    const items = [];
    Store.state.reminders.forEach((r) => {
      if (r.done) return;
      items.push({ type: r.kind, id: r.id, title: r.title, date: r.date, time: r.time, note: r.note, overdue: isReminderOverdue(r, today, hm) });
    });
    Store.state.tasks.forEach((t) => {
      if (t.completed || t.date <= today) return;
      items.push({ type: 'task', id: t.id, title: t.title, date: t.date, time: t.time, note: '', overdue: false });
    });
    items.sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      const at = a.time || '00:00', bt = b.time || '00:00';
      return at < bt ? -1 : at > bt ? 1 : 0;
    });
    return items;
  }

  const shoppingLeft = () => Store.state.shopping.filter((i) => !i.checked).length;
  const remindersToday = () => { const t = todayStr(); return Store.state.reminders.filter((r) => !r.done && r.date === t).length; };
  const kindLabel = (k) => (k === 'event' ? 'Appointment' : k === 'bill' ? 'Bill' : 'Reminder');
  const kindIcon = (k) => (k === 'event' ? 'calendar' : k === 'bill' ? 'receipt' : 'bell');
  const timeSignature = () => {
    const today = todayStr(), hm = nowHM();
    return `${today}|${Store.state.reminders.filter((r) => isReminderOverdue(r, today, hm)).map((r) => r.id).join(',')}`;
  };

  /* ======================================================================
     8. RENDERERS
     ====================================================================== */
  const greeting = () => {
    const h = new Date().getHours();
    return h >= 5 && h < 12 ? 'Good morning' : h >= 12 && h < 18 ? 'Good afternoon' : 'Good evening';
  };

  function renderChrome() {
    const name = Store.state.settings.name;
    const route = ROUTES[ui.route] || ROUTES.home;
    $('#hdTitle').textContent = ui.route === 'home' ? `${greeting()}${name ? `, ${name}` : ''}` : route.title;
    $('#hdSub').textContent = ui.route === 'home' ? longDate() : route.sub;
    const initial = $('#avatarInitial');
    initial.textContent = name ? name.charAt(0).toUpperCase() : '';
    $('#avatarIcon').style.display = name ? 'none' : '';
    const navPlan = $('#navPlan');
    if (navPlan) navPlan.textContent = Account.planLabel();
    const navPlanSub = $('#navPlanSub');
    if (navPlanSub) navPlanSub.textContent = Account.getPlan() === 'premium' ? 'Thank you for supporting DAYMATE' : 'Premium coming soon';
  }

  /* ---- Home: overview ---- */
  function renderOverview() {
    const { list, done, remaining } = dayData();
    const now = new Date();
    const total = list.length;
    const pct = total ? Math.round((done.length / total) * 100) : 0;

    $('#ovDay').textContent = String(now.getDate());
    $('#ovMonth').textContent = shortName(MONTHS[now.getMonth()]).toUpperCase();
    $('#ovWeekday').textContent = WEEKDAYS[now.getDay()];
    $('#ovHeadline').textContent = total === 0 ? 'A fresh, clear day'
      : remaining.length === 0 ? 'All done for today'
      : `${plural(remaining.length, 'task', 'tasks')} to go`;

    let msg;
    if (total === 0) msg = 'Nothing planned yet. Add a task and start your day with a clear plan.';
    else if (remaining.length === 0) msg = 'Brilliant work — you’ve cleared your list. Enjoy the rest of your day.';
    else if (done.length === 0) msg = 'A new day and a fresh start. Pick one thing and begin.';
    else if (pct >= 50) msg = 'More than halfway there. Keep the momentum going.';
    else msg = 'Good start. One task at a time — you’ve got this.';
    $('#ovMessage').textContent = msg;

    $('#ovRemaining').textContent = String(remaining.length);
    $('#ovDone').textContent = String(done.length);
    $('#ovReminders').textContent = String(remindersToday());
    $('#ovPct').textContent = `${pct}%`;
    $('#ovRing').setAttribute('aria-label', `Daily progress ${pct}%`);
    $('#ovRingBar').style.strokeDashoffset = String(213.63 * (1 - pct / 100));

    const left = shoppingLeft();
    const badge = $('#qaShopBadge');
    badge.hidden = left === 0;
    badge.textContent = String(left);
  }

  /* ---- Home: tasks ---- */
  function taskRow(t, today) {
    const overdue = !t.completed && t.date < today;
    const isNew = !ui.seen.has(t.id);
    return `
      <li class="task pri-${t.priority}${t.completed ? ' is-done' : ''}${isNew ? ' is-new' : ''}" data-id="${esc(t.id)}">
        <button type="button" class="check" role="checkbox" aria-checked="${t.completed}" data-action="toggle-task"
                aria-label="${t.completed ? 'Mark as not done' : 'Mark as done'}: ${esc(t.title)}">${icon('check')}</button>
        <button type="button" class="task__body" data-action="edit-task" aria-label="Edit task: ${esc(t.title)}">
          <span class="task__title">${esc(t.title)}</span>
          <span class="task__meta">
            ${t.time ? `<span class="meta">${icon('clock')}${esc(t.time)}</span>` : ''}
            <span class="meta meta--${t.priority}"><i class="dot"></i>${PRIORITY_LABEL[t.priority]}</span>
            ${overdue ? `<span class="meta meta--overdue">Overdue · ${esc(dayLabel(t.date, today))}</span>` : ''}
          </span>
        </button>
        <button type="button" class="icon-btn icon-btn--danger" data-action="delete-task" aria-label="Delete task: ${esc(t.title)}">${icon('trash')}</button>
      </li>`;
  }

  function emptyState({ iconName, title, text, button }) {
    return `
      <div class="empty">
        <div class="empty__art">${icon(iconName)}</div>
        <h3>${esc(title)}</h3>
        <p>${esc(text)}</p>
        ${button ? `<button type="button" class="btn btn--primary" data-action="${button.action}">${esc(button.label)}</button>` : ''}
      </div>`;
  }

  function renderTasks() {
    if (ui.hold) return;
    const { today, list, done, remaining } = dayData();
    $('#fAll').textContent = String(list.length);
    $('#fTodo').textContent = String(remaining.length);
    $('#fDone').textContent = String(done.length);
    $$('#taskFilter .filter__btn').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.filter === ui.filter)));

    const shown = ui.filter === 'todo' ? remaining : ui.filter === 'done' ? done : list;
    const host = $('#taskList');
    if (shown.length) {
      host.innerHTML = shown.map((t) => taskRow(t, today)).join('');
    } else if (!list.length) {
      host.innerHTML = `<li>${emptyState({ iconName: 'list', title: 'Nothing planned yet', text: 'Add your first task and make today count.', button: { action: 'add-task', label: 'Add a task' } })}</li>`;
    } else if (ui.filter === 'todo') {
      host.innerHTML = `<li>${emptyState({ iconName: 'sparkles', title: 'Everything’s done', text: 'You’ve completed every task for today. Time to enjoy it.' })}</li>`;
    } else {
      host.innerHTML = `<li>${emptyState({ iconName: 'check', title: 'Nothing completed yet', text: 'Tick off a task and it will show up here.' })}</li>`;
    }
    shown.forEach((t) => ui.seen.add(t.id));
    $('#taskFoot').hidden = !(ui.filter === 'done' && done.length > 0);
  }

  /* ---- Home: upcoming ---- */
  function upcomingRow(it, today) {
    const isNew = !ui.seen.has(`u-${it.id}`);
    const chipCls = it.type === 'event' ? ' up__chip--event' : it.type === 'task' ? ' up__chip--task' : '';
    const chipIcon = it.type === 'task' ? 'list' : kindIcon(it.type);
    const typeLabel = it.type === 'task' ? 'Task' : kindLabel(it.type);
    const when = [it.overdue ? `<span class="meta--overdue">Overdue</span>` : '', esc(`${typeLabel}${it.time ? ` · ${it.time}` : ''}${it.overdue ? ` · ${dayLabel(it.date, today)}` : ''}`)].join('');
    const editAction = it.type === 'task' ? 'edit-task' : 'edit-reminder';
    const delAction = it.type === 'task' ? 'delete-task' : 'delete-reminder';
    return `
      <li class="up${isNew ? ' is-new' : ''}" data-id="${esc(it.id)}">
        <span class="up__chip${chipCls}">${icon(chipIcon)}</span>
        <button type="button" class="up__body" data-action="${editAction}" aria-label="Edit: ${esc(it.title)}">
          <span class="up__title">${esc(it.title)}</span>
          <span class="up__meta">${when}</span>
        </button>
        ${it.type === 'task' ? '' : `<button type="button" class="tick" data-action="toggle-reminder" aria-pressed="false" aria-label="Mark done: ${esc(it.title)}">${icon('check')}</button>`}
        <button type="button" class="icon-btn icon-btn--danger" data-action="${delAction}" aria-label="Delete: ${esc(it.title)}">${icon('trash')}</button>
      </li>`;
  }

  function renderUpcoming() {
    const host = $('#upcomingList');
    const today = todayStr();
    const all = upcomingItems();
    const LIMIT = 5;
    const shown = ui.upExpanded ? all : all.slice(0, LIMIT);
    const doneReminders = Store.state.reminders.filter((r) => r.done).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    let html = '';
    if (!shown.length) {
      html += emptyState({ iconName: 'bell', title: 'Nothing coming up', text: 'Add a reminder or appointment so you never have to remember it yourself.', button: { action: 'add-reminder', label: 'Add a reminder' } });
    } else {
      const groups = [];
      shown.forEach((it) => {
        const key = it.overdue ? 'overdue' : it.date;
        let g = groups[groups.length - 1];
        if (!g || g.key !== key) { g = { key, items: [] }; groups.push(g); }
        g.items.push(it);
      });
      html += groups.map((g) => {
        const label = g.key === 'overdue' ? 'Overdue' : dayLabel(g.key, today);
        const cls = g.key === 'overdue' ? ' is-overdue' : g.key === today ? ' is-today' : '';
        return `<div class="upgroup"><h3 class="upgroup__label${cls}">${esc(label)}</h3><ul class="uplist">${g.items.map((it) => upcomingRow(it, today)).join('')}</ul></div>`;
      }).join('');
      if (all.length > LIMIT) {
        html += `<div class="up-more"><button type="button" class="link-btn" data-action="toggle-upcoming">${ui.upExpanded ? 'Show less' : `Show all ${all.length}`}</button></div>`;
      }
    }

    if (doneReminders.length) {
      html += `<div class="up-more"><button type="button" class="link-btn" data-action="toggle-done-reminders">${ui.showDone ? 'Hide completed' : `Completed reminders (${doneReminders.length})`}</button></div>`;
      if (ui.showDone) {
        html += `<ul class="uplist">${doneReminders.slice(0, 8).map((r) => `
          <li class="up is-done" data-id="${esc(r.id)}">
            <span class="up__chip${r.kind === 'event' ? ' up__chip--event' : ''}">${icon(kindIcon(r.kind))}</span>
            <button type="button" class="up__body" data-action="edit-reminder" aria-label="Edit: ${esc(r.title)}">
              <span class="up__title">${esc(r.title)}</span>
              <span class="up__meta">${esc(dayLabel(r.date, today))}${r.time ? ` · ${esc(r.time)}` : ''}</span>
            </button>
            <button type="button" class="tick" data-action="toggle-reminder" aria-pressed="true" aria-label="Mark not done: ${esc(r.title)}">${icon('check')}</button>
            <button type="button" class="icon-btn icon-btn--danger" data-action="delete-reminder" aria-label="Delete: ${esc(r.title)}">${icon('trash')}</button>
          </li>`).join('')}</ul>`;
      }
    }
    host.innerHTML = html;
    shown.forEach((it) => ui.seen.add(`u-${it.id}`));
  }

  /* ---- Home: daily summary ---- */
  function renderSummary() {
    const { today, list, done, remaining } = dayData();
    const hi = remaining.filter((t) => t.priority === 'high').length;
    const overdue = remaining.filter((t) => t.date < today).length;

    const days = [];
    for (let i = 6; i >= 0; i--) {
      const date = addDays(today, -i);
      days.push({ date, n: Store.state.tasks.filter((t) => t.completed && t.completedOn === date).length });
    }
    const max = Math.max(1, ...days.map((d) => d.n));
    const weekTotal = days.reduce((s, d) => s + d.n, 0);
    const animate = !ui.barsShown;
    ui.barsShown = true;

    const line = list.length === 0
      ? 'No tasks planned for today — a wonderfully clear schedule.'
      : `You’ve completed <span>${done.length} of ${list.length}</span> ${list.length === 1 ? 'task' : 'tasks'} today.`;

    $('#summaryCard').innerHTML = `
      <p class="summary__line">${line}</p>
      <div class="summary__chips">
        <div class="sumchip"><strong>${hi}</strong><small>High priority left</small></div>
        <div class="sumchip"><strong>${overdue}</strong><small>Overdue</small></div>
        <div class="sumchip"><strong>${shoppingLeft()}</strong><small>To buy</small></div>
      </div>
      <div class="bars${animate ? ' bars--anim' : ''}" role="img" aria-label="Tasks completed in the last 7 days: ${days.map((d) => `${dayLabel(d.date, today)} ${d.n}`).join(', ')}">
        <p class="bars__title">Completed · last 7 days (${weekTotal})</p>
        <div class="bars__grid">
          ${days.map((d, i) => `
            <div class="bar${d.n ? ' has-value' : ''}${i === 6 ? ' is-today' : ''}">
              <span class="bar__n">${d.n || ''}</span>
              <span class="bar__fill" style="height:${Math.max(6, Math.round((d.n / max) * 56))}px"></span>
            </div>`).join('')}
        </div>
        <div class="bars__days" aria-hidden="true">
          ${days.map((d, i) => `<span class="${i === 6 ? 'is-today' : ''}">${WEEKDAYS[parseDate(d.date).getDay()].charAt(0)}</span>`).join('')}
        </div>
      </div>`;
  }

  function renderHome() {
    renderOverview();
    renderTasks();
    renderUpcoming();
    renderSummary();
  }

  /* ---- Preview screens ---- */
  function featureRow(item) {
    const base = item.feature ? { ...FEATURES[item.feature], ...item } : item;
    let text = base.text;
    if (base.dynamic === 'shopping') {
      const n = shoppingLeft();
      text = n ? `${plural(n, 'item', 'items')} to buy` : 'Keep track of everything you need to buy.';
    }
    const badge = base.status === 'live'
      ? `<span class="badge badge--live">${icon('check')}Available now</span>`
      : base.status === 'premium'
        ? `<span class="badge badge--premium">${icon('lock')}Premium · Soon</span>`
        : `<span class="badge badge--soon">Coming soon</span>`;
    const inner = `
      <span class="feature__icon">${icon(base.icon)}</span>
      <span class="feature__text"><strong>${esc(base.title)}</strong><small>${esc(text)}</small></span>
      <span class="feature__side">${badge}${base.status === 'soon' ? '' : icon('chevron', 'feature__chev')}</span>`;
    if (base.status === 'live') return `<li><button type="button" class="feature feature--live" data-action="${base.action}">${inner}</button></li>`;
    if (base.status === 'premium') return `<li><button type="button" class="feature feature--premium" data-action="open-premium" data-feature="${esc(item.feature)}">${inner}</button></li>`;
    return `<li><div class="feature">${inner}</div></li>`;
  }

  function weekStrip() {
    const today = todayStr();
    const cells = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(today, i);
      const d = parseDate(date);
      const n = Store.state.tasks.filter((t) => !t.completed && t.date === date).length
        + Store.state.reminders.filter((r) => !r.done && r.date === date).length;
      const dots = Math.min(n, 3);
      cells.push(`
        <div class="wday${i === 0 ? ' is-today' : ''}" role="group" aria-label="${esc(dayLabel(date, today))}: ${plural(n, 'item', 'items')}">
          <small>${shortName(WEEKDAYS[d.getDay()])}</small>
          <strong>${d.getDate()}</strong>
          <span class="wday__dots" aria-hidden="true">${'<i></i>'.repeat(dots)}</span>
        </div>`);
    }
    return `<div class="card week" aria-label="Your next seven days">${cells.join('')}</div>`;
  }

  function budgetMock() {
    return `
      <div class="card mockcard">
        <span class="mockcard__tag">Sample preview</span>
        <h3>Monthly budget</h3>
        <div class="mockcard__row">
          <div class="mini-ring">
            <svg viewBox="0 0 80 80" aria-hidden="true">
              <circle class="ring__track" cx="40" cy="40" r="34"/>
              <circle class="ring__bar" cx="40" cy="40" r="34" transform="rotate(-90 40 40)"/>
            </svg>
            <span>63%</span>
          </div>
          <div class="cats">
            <div class="cat"><div class="cat__top"><b>Groceries</b><span>£250 / £400</span></div><div class="cat__bar"><i style="width:62%"></i></div></div>
            <div class="cat"><div class="cat__top"><b>Transport</b><span>£90 / £150</span></div><div class="cat__bar"><i style="width:60%"></i></div></div>
            <div class="cat"><div class="cat__top"><b>Bills</b><span>£410 / £520</span></div><div class="cat__bar"><i style="width:79%"></i></div></div>
          </div>
        </div>
        <p class="fine">Example only — not your data. Budgeting arrives with Premium.</p>
      </div>`;
  }

  function renderPreview(route) {
    const cfg = PREVIEWS[route];
    const host = $(`#view-${route}`);
    if (!cfg || !host) return;
    const groups = cfg.groups.map((g) => `
      <h3 class="group-title">${esc(g.title)}</h3>
      <ul class="features">${g.items.map(featureRow).join('')}</ul>`).join('');
    host.innerHTML = `
      <div class="preview-wrap">
        <section class="card hero">
          <div class="hero__icon">${icon(cfg.icon)}</div>
          <span class="badge badge--soon">Coming in a future update</span>
          <h2>${esc(cfg.heroTitle)}</h2>
          <p>${esc(cfg.heroText)}</p>
        </section>
        ${cfg.extra === 'week' ? weekStrip() : ''}
        ${cfg.extra === 'budget' ? budgetMock() : ''}
        ${groups}
        <p class="closing">DAYMATE is being built in stages — new features appear here as they’re ready.</p>
      </div>`;
  }

  /* ---- More ---- */
  function syncLine() {
    if (!Account.configured) return 'Stored on this device only. Cloud accounts need setting up first.';
    if (!Account.user) return 'Stored on this device only. Sign in to back up and sync.';
    const map = { syncing: 'Syncing…', synced: 'Synced to your account', offline: 'Offline — will sync when you’re back online', error: 'Sync problem — will retry', local: 'Signed in' };
    return map[Account.syncState] || 'Signed in';
  }

  function renderMore() {
    const host = $('#view-more');
    const name = Store.state.settings.name;
    const email = Account.user ? Account.user.email : '';
    const unread = Store.state.notifications.filter((n) => !n.readAt && !n.dismissedAt).length;
    host.innerHTML = `
      <div class="preview-wrap">
        <button type="button" class="card account" data-action="open-settings">
          <span class="account__avatar">${name ? esc(name.charAt(0).toUpperCase()) : icon('user')}</span>
          <span class="account__text"><strong>${name ? esc(name) : 'Set up your profile'}</strong><small>${email ? esc(email) : (name ? 'Profile & settings' : 'Add your name for a personal greeting')}</small></span>
          <span class="plan-tag">${esc(Account.planLabel())}</span>
        </button>
        <p class="sync-line" role="status"><i class="sync-dot sync-dot--${esc(Account.user ? Account.syncState : 'local')}"></i>${esc(syncLine())}</p>

        ${Account.user ? '' : `<button type="button" class="row row--solo" data-action="open-auth" data-mode="signin">
          <span class="row__icon">${icon('lock')}</span>
          <span class="row__text"><strong>Sign in or create an account</strong><small>Keep your data safe and use DAYMATE on every device</small></span>
          ${icon('chevron', 'row__chev')}
        </button>`}

        <button type="button" class="promo" data-action="open-premium">
          <span class="promo__icon">${icon('sparkles')}</span>
          <span class="promo__text"><strong>DAYMATE Premium</strong><small>${Account.getPlan() === 'premium' ? 'You have Premium' : 'Coming soon · See what’s planned'}</small></span>
          ${icon('chevron', 'promo__chev')}
        </button>

        <h3 class="group-title">Your DAYMATE</h3>
        <div class="rows">
          <a class="row" href="#/notifications">
            <span class="row__icon">${icon('bell')}</span>
            <span class="row__text"><strong>Notification centre</strong><small>${unread ? `${plural(unread, 'unread alert', 'unread alerts')}` : 'Reminders, alerts and history'}</small></span>
            ${icon('chevron', 'row__chev')}
          </a>
          <a class="row" href="#/memory">
            <span class="row__icon">${icon('sparkles')}</span>
            <span class="row__text"><strong>Memory</strong><small>${plural(Store.state.memories.length, 'thing', 'things')} remembered</small></span>
            ${icon('chevron', 'row__chev')}
          </a>
          <button type="button" class="row" data-action="open-notify-prefs">
            <span class="row__icon">${icon('sliders')}</span>
            <span class="row__text"><strong>Notification settings</strong><small>Phone alerts, reminder times, morning summary</small></span>
            ${icon('chevron', 'row__chev')}
          </button>
        </div>

        <h3 class="group-title">App</h3>
        <div class="rows">
          ${isStandalone() ? '' : `<button type="button" class="row" data-action="install-app">
            <span class="row__icon">${icon('device')}</span>
            <span class="row__text"><strong>Install DAYMATE</strong><small>Add it to your Home Screen like an app</small></span>
            ${icon('chevron', 'row__chev')}
          </button>`}
          <button type="button" class="row" data-action="open-settings">
            <span class="row__icon">${icon('sliders')}</span>
            <span class="row__text"><strong>Account & settings</strong><small>Your name, account, backup and data</small></span>
            ${icon('chevron', 'row__chev')}
          </button>
          <button type="button" class="row" data-action="export-data">
            <span class="row__icon">${icon('download')}</span>
            <span class="row__text"><strong>Download a backup</strong><small>Save your data as a file</small></span>
          </button>
        </div>

        <h3 class="group-title">What’s coming next</h3>
        <ul class="features">${ROADMAP.map(featureRow).join('')}</ul>

        <p class="about"><strong>DAYMATE</strong><br>${esc(APP.tagline)}<br>Version ${esc(APP.version)} · Part ${APP.stage}<br>${esc(Account.user ? 'Your data is saved to your account and cached on this device.' : 'Your data is stored on this device only.')}</p>
      </div>`;
  }

  /* ---- Premium screen ---- */
  function renderPremium() {
    $('#premiumFeatures').innerHTML = Entitlements.premiumFeatures().map((f) => `
      <li class="pfeat" data-feature="${esc(f.id)}">
        <span class="pfeat__icon">${icon(f.icon)}</span>
        <span class="pfeat__text"><strong>${esc(f.title)}</strong><small>${esc(f.text)}</small></span>
        ${icon('lock', 'pfeat__lock')}
      </li>`).join('');

    $('#premiumMocks').innerHTML = `
      <div class="mock" aria-label="Example: AI assistant">
        <div class="mock__tag"><span>AI assistant · Example</span>${icon('lock')}</div>
        <div class="mock__bubble mock__bubble--me">What’s on tomorrow?</div>
        <div class="mock__bubble mock__bubble--ai">You have 3 tasks and a 2:30pm appointment. Want me to plan around it?</div>
      </div>
      <div class="mock" aria-label="Example: smart reminder">
        <div class="mock__tag"><span>Smart reminder · Example</span>${icon('lock')}</div>
        <p class="mock__title">Bins out tonight</p>
        <p class="mock__text">Repeats every Tuesday and nudges you until it’s ticked off.</p>
      </div>
      <div class="mock" aria-label="Example: bill tracking">
        <div class="mock__tag"><span>Bills · Example</span>${icon('lock')}</div>
        <p class="mock__title">Energy bill due in 3 days</p>
        <div class="mock__meter"><i></i></div>
        <p class="mock__small">68% of this month’s bills paid</p>
      </div>`;
    const pill = $('.plan-pill');
    if (pill) pill.innerHTML = `<span class="plan-pill__dot"></span>${Account.getPlan() === 'premium' ? 'You have Premium' : 'You’re on the Free plan'}`;
    updateNotifyButton();
  }

  function updateNotifyButton() {
    const on = Store.state.settings.premiumInterest;
    const btn = $('#premiumNotify');
    btn.classList.toggle('is-on', on);
    btn.textContent = on ? '✓ You’re on the list' : 'Notify me at launch';
    btn.setAttribute('aria-pressed', String(on));
  }

  function openPremium(featureId) {
    renderPremium();
    $$('.pfeat.is-focus').forEach((el) => el.classList.remove('is-focus'));
    Modal.open('m-premium');
    $('#premiumScroll').scrollTop = 0;
    if (featureId) {
      const target = $$('.pfeat').find((el) => el.dataset.feature === featureId);
      if (target) {
        target.classList.add('is-focus');
        setTimeout(() => target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 380);
      }
    }
  }

  /* ---- Orchestration ---- */
  function renderRoute() {
    if (ui.route === 'home') renderHome();
    else if (ui.route === 'more') renderMore();
    else if (extraRoutes[ui.route]) extraRoutes[ui.route].render($(`#view-${ui.route}`));
    else renderPreview(ui.route);
  }

  function renderAll() {
    renderChrome();
    renderRoute();
    if (ui.route !== 'home') { renderOverview(); }     // keeps the shopping badge etc. correct
    if (Modal.isOpen('m-shopping')) renderShopping();
    if (Modal.isOpen('m-premium')) updateNotifyButton();
    runHooks(hooks.render);
  }

  /* ======================================================================
     9. FLOWS (forms)
     ====================================================================== */
  const setRadio = (form, name, value) => { const r = $$(`input[name="${name}"]`, form).find((x) => x.value === value); if (r) r.checked = true; };
  const getRadio = (form, name) => { const r = $$(`input[name="${name}"]`, form).find((x) => x.checked); return r ? r.value : ''; };
  const showError = (inputId, errId, msg) => { const i = $(`#${inputId}`); i.classList.add('is-invalid'); $(`#${errId}`).textContent = msg; i.setAttribute('aria-invalid', 'true'); };
  const clearErrors = (form) => { $$('.is-invalid', form).forEach((i) => { i.classList.remove('is-invalid'); i.removeAttribute('aria-invalid'); }); $$('.field__error', form).forEach((e) => { e.textContent = ''; }); };

  /* ---- Tasks ---- */
  function openTaskSheet(id) {
    const t = id ? Store.get('tasks', id) : null;
    const form = $('#taskForm');
    clearErrors(form);
    form.dataset.id = t ? t.id : '';
    $('#taskSheetTitle').textContent = t ? 'Edit task' : 'New task';
    $('#taskSave').textContent = t ? 'Save changes' : 'Add task';
    $('#taskTitle').value = t ? t.title : '';
    setRadio(form, 'priority', t ? t.priority : 'medium');
    $('#taskDate').value = t ? t.date : todayStr();
    $('#taskTime').value = t ? t.time : '';
    $('#taskDelete').hidden = !t;
    Modal.open('m-task', { focus: t ? null : '#taskTitle' });
  }

  function submitTask(e) {
    e.preventDefault();
    const form = e.currentTarget;
    clearErrors(form);
    const title = cleanText($('#taskTitle').value, 120);
    const date = $('#taskDate').value;
    const time = $('#taskTime').value;
    let ok = true;
    if (!title) { showError('taskTitle', 'taskTitleError', 'Give your task a name.'); ok = false; }
    if (!isValidDate(date)) { showError('taskDate', 'taskDateError', 'Pick a valid date.'); ok = false; }
    else if (!isValidTime(time)) { showError('taskTime', 'taskDateError', 'Enter a valid time, or leave it blank.'); ok = false; }
    if (!ok) { const bad = $('.is-invalid', form); if (bad) bad.focus(); return; }
    const priority = PRIORITIES.includes(getRadio(form, 'priority')) ? getRadio(form, 'priority') : 'medium';
    if (form.dataset.id) Store.update('tasks', form.dataset.id, { title, priority, date, time });
    else Store.add('tasks', { title, priority, date, time, completed: false, completedOn: '', completedAt: '' });
    Modal.close('m-task');
  }

  function toggleTask(id) {
    const t = Store.get('tasks', id);
    if (!t) return;
    const completed = !t.completed;
    ui.hold = true;
    Store.update('tasks', id, { completed, completedOn: completed ? todayStr() : '', completedAt: completed ? nowISO() : '' });
    const row = $$('#taskList > li').find((li) => li.dataset.id === id);
    if (row) {
      row.classList.toggle('is-done', completed);
      const cb = $('.check', row);
      cb.setAttribute('aria-checked', String(completed));
      cb.setAttribute('aria-label', `${completed ? 'Mark as not done' : 'Mark as done'}: ${t.title}`);
    }
    clearTimeout(ui.holdTimer);
    ui.holdTimer = setTimeout(() => { ui.hold = false; renderTasks(); }, 650);
  }

  function deleteTask(id) {
    const r = Store.remove('tasks', id);
    if (!r) return;
    UI.toast('Task deleted', { action: { label: 'Undo', fn: () => Store.restore('tasks', r.item, r.index) } });
  }

  function quickAddTask(e) {
    e.preventDefault();
    const input = $('#quickAddInput');
    const title = cleanText(input.value, 120);
    if (!title) {
      input.classList.remove('is-invalid'); void input.offsetWidth; input.classList.add('is-invalid');
      input.focus();
      return;
    }
    input.classList.remove('is-invalid');
    Store.add('tasks', { title, priority: 'medium', date: todayStr(), time: '', completed: false, completedOn: '', completedAt: '' });
    input.value = '';
    if (ui.filter === 'done') { ui.filter = 'all'; renderTasks(); }
    input.focus();
  }

  /* ---- Reminders ---- */
  function openReminderSheet(id) {
    const r = id ? Store.get('reminders', id) : null;
    const form = $('#reminderForm');
    clearErrors(form);
    form.dataset.id = r ? r.id : '';
    $('#reminderSheetTitle').textContent = r ? `Edit ${kindLabel(r.kind).toLowerCase()}` : 'New reminder';
    $('#reminderSave').textContent = r ? 'Save changes' : 'Add reminder';
    $('#reminderTitle').value = r ? r.title : '';
    setRadio(form, 'kind', r ? r.kind : 'reminder');
    $('#reminderDate').value = r ? r.date : todayStr();
    $('#reminderTime').value = r ? r.time : '';
    $('#reminderNote').value = r ? r.note : '';
    $('#reminderDelete').hidden = !r;
    Modal.open('m-reminder', { focus: r ? null : '#reminderTitle' });
  }

  function submitReminder(e) {
    e.preventDefault();
    const form = e.currentTarget;
    clearErrors(form);
    const title = cleanText($('#reminderTitle').value, 120);
    const date = $('#reminderDate').value;
    const time = $('#reminderTime').value;
    const note = cleanText($('#reminderNote').value, 200);
    let ok = true;
    if (!title) { showError('reminderTitle', 'reminderTitleError', 'What should we remind you about?'); ok = false; }
    if (!isValidDate(date)) { showError('reminderDate', 'reminderDateError', 'Pick a valid date.'); ok = false; }
    else if (!isValidTime(time)) { showError('reminderTime', 'reminderDateError', 'Enter a valid time, or leave it blank.'); ok = false; }
    if (!ok) { const bad = $('.is-invalid', form); if (bad) bad.focus(); return; }
    const kindRaw = getRadio(form, 'kind');
    const kind = REMINDER_KINDS.includes(kindRaw) ? kindRaw : 'reminder';
    if (form.dataset.id) Store.update('reminders', form.dataset.id, { title, kind, date, time, note, done: false });
    else Store.add('reminders', { title, kind, date, time, note, done: false });
    Modal.close('m-reminder');
  }

  function toggleReminder(id) {
    const r = Store.get('reminders', id);
    if (r) Store.update('reminders', id, { done: !r.done });
  }

  function deleteReminder(id) {
    const r = Store.remove('reminders', id);
    if (!r) return;
    UI.toast(`${kindLabel(r.item.kind)} deleted`, { action: { label: 'Undo', fn: () => Store.restore('reminders', r.item, r.index) } });
  }

  /* ---- Shopping ---- */
  function renderShopping() {
    const items = [...Store.state.shopping].sort((a, b) => Number(a.checked) - Number(b.checked) || a.createdAt.localeCompare(b.createdAt));
    const left = items.filter((i) => !i.checked).length;
    $('#shoppingCount').textContent = !items.length ? 'Nothing on your list yet' : left === 0 ? 'Everything’s ticked off' : `${left} to buy`;
    $('#shoppingClear').hidden = !items.some((i) => i.checked);
    $('#shoppingList').innerHTML = items.length ? items.map((i) => {
      const isNew = !ui.seen.has(`s-${i.id}`);
      ui.seen.add(`s-${i.id}`);
      return `
        <li class="shop__item${i.checked ? ' is-checked' : ''}${isNew ? ' is-new' : ''}" data-id="${esc(i.id)}">
          <button type="button" class="check" role="checkbox" aria-checked="${i.checked}" data-action="toggle-shop" aria-label="${i.checked ? 'Untick' : 'Tick off'}: ${esc(i.name)}">${icon('check')}</button>
          <span class="shop__name">${esc(i.name)}</span>
          <button type="button" class="icon-btn icon-btn--danger" data-action="delete-shop" aria-label="Remove ${esc(i.name)}">${icon('trash')}</button>
        </li>`;
    }).join('') : `
      <li class="shop__empty">
        <div class="empty__art">${icon('basket')}</div>
        <p>Add the things you need to pick up — they’ll be here when you’re at the shops.</p>
      </li>`;
  }

  function openShopping() {
    renderShopping();
    Modal.open('m-shopping', { focus: '#shoppingInput' });
  }

  function addShoppingItem(e) {
    e.preventDefault();
    const input = $('#shoppingInput');
    const name = cleanText(input.value, 80);
    if (!name) { input.classList.remove('is-invalid'); void input.offsetWidth; input.classList.add('is-invalid'); input.focus(); return; }
    input.classList.remove('is-invalid');
    if (Store.state.shopping.some((i) => !i.checked && i.name.toLowerCase() === name.toLowerCase())) {
      UI.toast(`“${name}” is already on your list`);
      input.select();
      return;
    }
    Store.add('shopping', { name, checked: false });
    input.value = '';
    input.focus();
  }

  /* ---- Settings, data, onboarding ---- */
  function openSettings() {
    $('#settingsName').value = Store.state.settings.name;
    $('#settingsAbout').textContent = `${APP.name} ${APP.version} · Part ${APP.stage}. ${Account.user ? 'Your data is saved to your account and cached on this device.' : 'Signed out: your data lives on this device only.'}`;
    runHooks(hooks.settingsOpen);
    Modal.open('m-settings');
  }

  function exportData() {
    try {
      const payload = { app: APP.name, version: APP.version, exportedAt: nowISO(), data: Store.snapshot() };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `daymate-backup-${todayStr()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      UI.toast('Backup downloaded');
    } catch (err) {
      console.warn('[DAYMATE] Export failed:', err);
      UI.toast('Couldn’t create the backup on this device.');
    }
  }

  async function resetData() {
    const yes = await confirmDialog({
      title: 'Erase all data?',
      message: Account.user
        ? 'This permanently removes every task, reminder, shopping item, memory and notification from this device AND from your DAYMATE account. It can’t be undone.'
        : 'This permanently removes every task, reminder, shopping item and memory stored on this device. It can’t be undone.',
      okLabel: 'Erase everything',
    });
    if (!yes) return;
    ui.seen.clear();
    ui.barsShown = false;
    Store.reset();
    Modal.close('m-settings');
    UI.toast('All data erased');
    ui.welcomed = false;
    setTimeout(maybeWelcome, 600);
  }

  function maybeWelcome() {
    if (Store.state.settings.onboarded || ui.welcomed) return;
    ui.welcomed = true;
    $('#welcomeName').value = '';
    Modal.open('m-welcome', { focus: '#welcomeName' });
  }

  function openInstallHelp() {
    const ios = isIOS();
    $('#installBody').innerHTML = ios ? `
      <ol class="steps">
        <li><span>Open DAYMATE in <strong>Safari</strong>.</span></li>
        <li><span>Tap the Share button ${icon('share')} at the bottom of the screen.</span></li>
        <li><span>Scroll down and tap <strong>Add to Home Screen</strong>.</span></li>
        <li><span>Tap <strong>Add</strong>. DAYMATE now opens full-screen like an app.</span></li>
      </ol>` : `
      <ol class="steps">
        <li><span>Open DAYMATE in <strong>Chrome</strong> or <strong>Edge</strong>.</span></li>
        <li><span>Open the browser menu (⋮) or look for the install icon in the address bar.</span></li>
        <li><span>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</span></li>
      </ol>
      <p class="fine">Installing works once DAYMATE is hosted on a secure (https) address such as GitHub Pages.</p>`;
    Modal.open('m-install');
  }

  let deferredInstall = null;

  /* ======================================================================
     10. ROUTER & EVENTS
     ====================================================================== */
  function currentRoute() {
    const m = /^#\/([a-z]+)/.exec(window.location.hash);
    return m && ROUTES[m[1]] ? m[1] : 'home';
  }

  function applyRoute() {
    const next = currentRoute();
    const changed = next !== ui.route;
    ui.route = next;
    $$('.view').forEach((v) => {
      const active = v.dataset.view === next;
      if (active && v.hidden) { v.hidden = false; v.style.animation = 'none'; void v.offsetWidth; v.style.animation = ''; }
      else if (!active) v.hidden = true;
    });
    $$('.nav__item').forEach((a) => {
      if (a.dataset.route === next) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    renderAll();
    if (changed) { window.scrollTo(0, 0); $('#main').focus({ preventScroll: true }); }
  }

  const actions = {
    'add-task':        () => openTaskSheet(),
    'edit-task':       (el) => { const id = idOf(el); if (id) openTaskSheet(id); },
    'toggle-task':     (el) => { const id = idOf(el); if (id) toggleTask(id); },
    'delete-task':     (el) => { const id = idOf(el); if (id) deleteTask(id); },
    'delete-task-sheet': () => { const id = $('#taskForm').dataset.id; Modal.close('m-task'); if (id) deleteTask(id); },
    'task-date':       (el) => { $('#taskDate').value = addDays(todayStr(), Number(el.dataset.offset) || 0); },

    'add-reminder':    () => openReminderSheet(),
    'edit-reminder':   (el) => { const id = idOf(el); if (id) openReminderSheet(id); },
    'toggle-reminder': (el) => { const id = idOf(el); if (id) toggleReminder(id); },
    'delete-reminder': (el) => { const id = idOf(el); if (id) deleteReminder(id); },
    'delete-reminder-sheet': () => { const id = $('#reminderForm').dataset.id; Modal.close('m-reminder'); if (id) deleteReminder(id); },
    'reminder-date':   (el) => { $('#reminderDate').value = addDays(todayStr(), Number(el.dataset.offset) || 0); },

    'open-shopping':   () => openShopping(),
    'toggle-shop':     (el) => { const id = idOf(el); const i = id && Store.get('shopping', id); if (i) Store.update('shopping', id, { checked: !i.checked }); },
    'delete-shop':     (el) => {
      const id = idOf(el); const r = id && Store.remove('shopping', id);
      if (r) UI.toast(`Removed “${r.item.name}”`, { action: { label: 'Undo', fn: () => Store.restore('shopping', r.item, r.index) } });
    },
    'clear-shopping':  () => {
      const before = Store.state.shopping.slice();
      const kept = before.filter((i) => !i.checked);
      const n = before.length - kept.length;
      if (!n) return;
      Store.replace('shopping', kept);
      UI.toast(`Cleared ${plural(n, 'item', 'items')}`, { action: { label: 'Undo', fn: () => Store.replace('shopping', before) } });
    },

    'set-filter':      (el) => { ui.filter = el.dataset.filter; renderTasks(); },
    'clear-completed': () => {
      const { done } = dayData();
      if (!done.length) return;
      const removedIds = new Set(done.map((t) => t.id));
      const before = Store.state.tasks.slice();
      Store.replace('tasks', before.filter((t) => !removedIds.has(t.id)));
      UI.toast(`Cleared ${plural(done.length, 'completed task', 'completed tasks')}`, { action: { label: 'Undo', fn: () => Store.replace('tasks', before) } });
    },
    'toggle-upcoming':       () => { ui.upExpanded = !ui.upExpanded; renderUpcoming(); },
    'toggle-done-reminders': () => { ui.showDone = !ui.showDone; renderUpcoming(); },

    'open-premium':    (el) => openPremium(el.dataset.feature || ''),
    'notify-premium':  () => {
      const on = !Store.state.settings.premiumInterest;
      Store.setSettings({ premiumInterest: on });
      updateNotifyButton();
      if (on) UI.toast(Account.user ? 'You’re on the list.' : 'You’re on the list. Saved on this device for now.');
    },

    'open-settings':   () => openSettings(),
    'export-data':     () => exportData(),
    'reset-data':      () => resetData(),
    'install-app':     async () => {
      if (deferredInstall) {
        const p = deferredInstall; deferredInstall = null;
        try { p.prompt(); await p.userChoice; } catch (_) { /* user dismissed */ }
      } else openInstallHelp();
    },

    'close-modal':     (el) => { const m = el.closest('.modal'); if (m) Modal.close(m.id); },
  };

  function idOf(el) { const host = el.closest('[data-id]'); return host ? host.dataset.id : ''; }

  function bindEvents() {
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const fn = actions[el.dataset.action];
      if (fn) fn(el, e);
    });

    document.addEventListener('keydown', (e) => {
      const top = Modal.top();
      if (e.key === 'Escape' && top) { e.preventDefault(); Modal.close(top); return; }
      if (e.key === 'Tab' && top) {
        const root = $(`#${top} .sheet`);
        if (!root) return;
        const focusable = $$('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])', root)
          .filter((x) => !x.hidden && x.offsetParent !== null);
        if (!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });

    $('#taskForm').addEventListener('submit', submitTask);
    $('#reminderForm').addEventListener('submit', submitReminder);
    $('#quickAdd').addEventListener('submit', quickAddTask);
    $('#shoppingForm').addEventListener('submit', addShoppingItem);

    $('#settingsForm').addEventListener('submit', (e) => {
      e.preventDefault();
      Store.setSettings({ name: cleanText($('#settingsName').value, 30) });
      Modal.close('m-settings');
      UI.toast('Saved');
    });

    $('#welcomeForm').addEventListener('submit', (e) => {
      e.preventDefault();
      Store.setSettings({ name: cleanText($('#welcomeName').value, 30), onboarded: true });
      Modal.close('m-welcome');
    });
    $('#m-welcome').addEventListener('modal:close', () => {
      if (!Store.state.settings.onboarded) Store.setSettings({ onboarded: true });
    });

    ['#quickAddInput', '#shoppingInput', '#taskTitle', '#reminderTitle'].forEach((sel) => {
      $(sel).addEventListener('input', (e) => { e.target.classList.remove('is-invalid'); });
    });

    window.addEventListener('hashchange', applyRoute);
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; });
    window.addEventListener('appinstalled', () => { deferredInstall = null; UI.toast('DAYMATE installed'); if (ui.route === 'more') renderMore(); });
    window.addEventListener('pagehide', () => { Store.flush(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) Store.flush(); else tickCheck(true); });
  }

  /** Swipe a sheet down by its handle to dismiss (touch layouts only). */
  function bindSheetDrag() {
    const desktop = window.matchMedia('(min-width: 900px)');
    $$('.modal').forEach((modal) => {
      const sheet = $('.sheet', modal);
      const head = $('.sheet__head', modal);
      if (!sheet || !head) return;
      let startY = 0, dy = 0, dragging = false;
      head.addEventListener('pointerdown', (e) => {
        if (desktop.matches || e.target.closest('button')) return;
        dragging = true; startY = e.clientY; dy = 0;
        try { head.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        sheet.classList.add('is-dragging');
      });
      head.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        dy = Math.max(0, e.clientY - startY);
        sheet.style.transform = `translateY(${dy}px)`;
      });
      const end = () => {
        if (!dragging) return;
        dragging = false;
        sheet.classList.remove('is-dragging');
        sheet.style.transform = '';
        if (dy > 110) Modal.close(modal.id);
      };
      head.addEventListener('pointerup', end);
      head.addEventListener('pointercancel', end);
    });
  }

  /** Re-render when the day rolls over or a timed reminder becomes overdue. */
  function tickCheck(force) {
    const sig = timeSignature();
    if (force === true || sig !== ui.sig) { ui.sig = sig; renderAll(); }
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    const secure = window.location.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
    if (!secure) return;
    const hadController = !!navigator.serviceWorker.controller;
    const start = () => {
      navigator.serviceWorker.register('./service-worker.js', { scope: './' }).then((reg) => {
        reg.addEventListener('updatefound', () => {
          const worker = reg.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              UI.toast('A new version is ready', { duration: 15000, action: { label: 'Update', fn: () => worker.postMessage({ type: 'SKIP_WAITING' }) } });
            }
          });
        });
      }).catch((err) => console.warn('[DAYMATE] Service worker not registered:', err));
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || reloading) return;
        reloading = true;
        window.location.reload();
      });
    };
    if (document.readyState === 'complete') start(); else window.addEventListener('load', start);
  }

  async function boot() {
    // If someone was signed in on this device, start from THEIR cache so the first
    // paint is already correct. This pointer grants no cloud access; the real
    // session is checked by js/auth.js, which switches back to anonymous data if
    // there is no valid session.
    let hintId = '';
    try { const h = JSON.parse(safeLS.get(APP.lastUserKey) || 'null'); hintId = h && typeof h.id === 'string' ? h.id : ''; } catch (_) { /* ignore */ }
    await Store.init(localAdapter(hintId ? userCacheKey(hintId) : APP.storageKey));
    Store.subscribe(() => { renderAll(); });
    bindEvents();
    bindSheetDrag();
    applyRoute();
    ui.ready = true;
    ui.sig = timeSignature();
    setInterval(tickCheck, 30000);
    registerServiceWorker();
    setTimeout(maybeWelcome, 450);
    exposeBridge();
  }

  /** The small, deliberate surface that js/*.js modules build on. */
  function exposeBridge() {
    window.DAYMATE = Object.freeze({
      APP, Store, Account, Entitlements, UI, Modal, confirmDialog,
      MEMORY_CATEGORIES, NOTIF_TYPES, NOTIFY_DEFAULTS, FEATURES, COLLECTIONS, REMINDER_KINDS,
      helpers: { $, $$, esc, icon, plural, cleanText, cleanMultiline, uid, nowISO, pad, todayStr, nowHM, addDays, parseDate, toDateStr,
                 dayLabel, longDate, isValidDate, isValidTime, isStandalone, isIOS, emptyState, kindLabel, kindIcon, safeLS },
      storage: { localAdapter, userCacheKey, safeLS },
      views: { upcomingItems, isReminderOverdue, openPremium, openTaskSheet, openReminderSheet, renderAll },
      registerRoute(name, cfg) { extraRoutes[name] = cfg; if (ui.route === name) renderAll(); },
      registerActions(map) { Object.assign(actions, map); },
      onRender(fn) { hooks.render.push(fn); },
      onSettingsOpen(fn) { hooks.settingsOpen.push(fn); },
      get route() { return ui.route; },
    });
    window.dispatchEvent(new CustomEvent('daymate:ready'));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
