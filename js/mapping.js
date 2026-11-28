/* ==========================================================================
   DAYMATE — local ⇄ cloud record mapping (pure functions, no DOM, no network)

   Local collections:  tasks · reminders · shopping · memories · notifications
   Cloud tables:       tasks · appointments + reminders · shopping_items · memories · notifications
   A local "reminder" is stored in `appointments` when kind === 'event', otherwise in
   `reminders` (category 'bill' or 'general').
   ========================================================================== */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

const hm = (t) => (typeof t === 'string' && t ? t.slice(0, 5) : '');
const orNull = (v) => (v ? v : null);
import { KINDS, encode, decode, normalise } from './household-logic.js';
const iso = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toISOString(); };

export const SYNC_COLLECTIONS = ['tasks', 'reminders', 'shopping', 'household', 'memories', 'notifications'];

export function tableFor(col, item) {
  switch (col) {
    case 'tasks': return 'tasks';
    case 'reminders': return item && item.kind === 'event' ? 'appointments' : 'reminders';
    case 'shopping': return 'shopping_items';
    case 'household': return 'household_info';
    case 'memories': return 'memories';
    case 'notifications': return 'notifications';
    default: throw new Error(`Unknown collection ${col}`);
  }
}

export function colFor(tbl) {
  const c = { tasks: 'tasks', appointments: 'reminders', reminders: 'reminders', shopping_items: 'shopping', household_info: 'household', memories: 'memories', notifications: 'notifications' }[tbl];
  if (!c) throw new Error(`Unknown table ${tbl}`);
  return c;
}

export function toRow(col, item, userId) {
  const base = { user_id: userId, id: item.id };
  const stamps = { created_at: item.createdAt, updated_at: item.updatedAt, deleted_at: null };
  switch (col) {
    case 'tasks':
      return { ...base, title: item.title, priority: item.priority, category: item.category || 'personal', repeat_rule: item.repeat || '', due_date: item.date, due_time: orNull(item.time),
        completed: !!item.completed, completed_on: orNull(item.completedOn), completed_at: orNull(item.completedAt), ...stamps };
    case 'reminders':
      if (item.kind === 'event') {
        return { ...base, title: item.title, appt_date: item.date, appt_time: orNull(item.time), note: item.note || '', location: orNull(item.location), done: !!item.done,
          category: item.category || 'personal', repeat_rule: item.repeat || '', important: !!item.important, ...stamps };
      }
      return { ...base, title: item.title, category: item.kind === 'bill' ? 'bill' : 'general',
        remind_date: item.date, remind_time: orNull(item.time), note: item.note || '', location: orNull(item.location), done: !!item.done,
        category_tag: item.category || 'personal', repeat_rule: item.repeat || '', important: !!item.important, ...stamps };
    case 'shopping':
      return { ...base, name: item.name, category: item.category || 'other', quantity: item.quantity || '', checked: !!item.checked, ...stamps };
    case 'household':
      return { ...base, label: item.title, category: item.kind, value: encode(item), ...stamps };
    case 'memories':
      return { ...base, category: item.category, title: item.title || '', content: item.content,
        source: item.source === 'ai' ? 'ai' : 'manual', sensitive: !!item.sensitive, ...stamps };
    case 'notifications':
      return { ...base, type: item.type, title: item.title, body: item.body || '',
        source_type: orNull(item.sourceType), source_id: isUuid(item.sourceId) ? item.sourceId : null,
        dedupe_key: item.dedupeKey, created_at: item.createdAt, read_at: orNull(item.readAt), dismissed_at: orNull(item.dismissedAt) };
    default: throw new Error(`Unknown collection ${col}`);
  }
}

export function fromRow(tbl, row) {
  const common = { id: row.id, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
  switch (tbl) {
    case 'tasks':
      return { ...common, title: row.title, priority: row.priority, category: row.category || 'personal', repeat: row.repeat_rule || '', date: row.due_date, time: hm(row.due_time),
        completed: !!row.completed, completedOn: row.completed_on || '', completedAt: row.completed_at ? iso(row.completed_at) : '' };
    case 'appointments':
      return { ...common, title: row.title, kind: 'event', date: row.appt_date, time: hm(row.appt_time), note: row.note || '', location: row.location || '', done: !!row.done, tbl: 'appointments',
        category: row.category || 'personal', repeat: row.repeat_rule || '', important: !!row.important };
    case 'reminders':
      return { ...common, title: row.title, kind: row.category === 'bill' ? 'bill' : 'reminder', date: row.remind_date, time: hm(row.remind_time),
        note: row.note || '', location: row.location || '', done: !!row.done, tbl: 'reminders',
        category: row.category_tag || (row.category === 'bill' ? 'bills' : 'personal'), repeat: row.repeat_rule || '', important: !!row.important };
    case 'shopping_items':
      return { ...common, name: row.name, category: row.category || 'other', quantity: row.quantity || '', checked: !!row.checked };
    case 'household_info': {
      const kind = KINDS.includes(row.category) ? row.category : 'note';
      const rec = normalise({ kind, title: row.label, ...decode(kind, row.value || '') }) || { kind: 'note', title: String(row.label || '').slice(0, 80) || 'Note', text: String(row.value || '').slice(0, 500) };
      return { ...common, ...rec };
    }
    case 'memories':
      return { ...common, category: row.category, title: row.title || '', content: row.content, source: row.source === 'ai' ? 'ai' : 'manual', sensitive: !!row.sensitive };
    case 'notifications':
      return { id: row.id, type: row.type, title: row.title, body: row.body || '', sourceType: row.source_type || '', sourceId: row.source_id || '',
        dedupeKey: row.dedupe_key, createdAt: iso(row.created_at), readAt: row.read_at ? iso(row.read_at) : '', dismissedAt: row.dismissed_at ? iso(row.dismissed_at) : '' };
    default: throw new Error(`Unknown table ${tbl}`);
  }
}

/** Timestamp used to decide "which copy is newer". Notifications have no updatedAt. */
export function stampOf(item) {
  if (item.updatedAt) return Date.parse(item.updatedAt) || 0;
  return Math.max(Date.parse(item.createdAt) || 0, Date.parse(item.readAt) || 0, Date.parse(item.dismissedAt) || 0);
}

/** Content identity, used to avoid duplicates when the same thing exists under two different ids. */
export function fingerprint(col, item) {
  const n = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  switch (col) {
    case 'tasks': return `t|${n(item.title)}|${item.date}|${item.time || ''}`;
    case 'reminders': return `r|${item.kind}|${n(item.title)}|${item.date}|${item.time || ''}`;
    case 'shopping': return `s|${n(item.name)}`;
    case 'household': return `h|${item.kind}|${n(item.title)}|${item.date || ''}`;
    case 'memories': return `m|${item.category}|${n(item.content)}`;
    case 'notifications': return `n|${item.dedupeKey}`;
    default: return `${col}|${item.id}`;
  }
}

/* ---- settings ⇄ cloud rows ---- */
export function settingsToRows(settings, timezone) {
  const n = settings.notify;
  const stamp = settings.updatedAt || new Date().toISOString();
  return {
    profile: { display_name: settings.name || '', timezone, updated_at: stamp },
    prefs: { onboarded: !!settings.onboarded, premium_interest: !!settings.premiumInterest, memory_collection_paused: settings.memoryPaused !== false, updated_at: stamp },
    notify: {
      push_enabled: !!n.push, tasks_enabled: !!n.tasks, appointments_enabled: !!n.appointments, reminders_enabled: !!n.reminders, bills_enabled: !!n.bills,
      lead_minutes: n.leadMinutes, default_time: n.defaultTime, morning_summary_enabled: !!n.morningSummary, morning_summary_time: n.morningTime,
    },
  };
}

export function rowsToSettings({ profile, prefs, notify }, current) {
  const out = {};
  if (profile) out.name = profile.display_name || '';
  if (prefs) {
    out.onboarded = !!prefs.onboarded || !!(profile && profile.display_name);
    out.premiumInterest = !!prefs.premium_interest;
    out.memoryPaused = prefs.memory_collection_paused !== false;
  }
  if (notify) {
    out.notify = {
      ...current.notify,
      push: !!notify.push_enabled, tasks: !!notify.tasks_enabled, appointments: !!notify.appointments_enabled,
      reminders: !!notify.reminders_enabled, bills: !!notify.bills_enabled,
      leadMinutes: Array.isArray(notify.lead_minutes) && notify.lead_minutes.length ? notify.lead_minutes.map(Number) : [0],
      defaultTime: hm(notify.default_time) || '09:00', morningSummary: !!notify.morning_summary_enabled, morningTime: hm(notify.morning_summary_time) || '08:00',
    };
  }
  return out;
}
