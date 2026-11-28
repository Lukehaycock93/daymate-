/* ==========================================================================
   DAYMATE — household logic (pure: no DOM, no network; unit-tested in tests/household_logic_test.mjs)
   Three kinds of record share the existing `household_info` table (category = kind):
     note   label = title, value = the note text
     date   label = title, value = JSON {d: date, r: repeat, t: note}
     chore  label = title, value = JSON {e: every, u: due, l: last done, x: done(1), t: note}
   ========================================================================== */

export const KINDS = ['note', 'date', 'chore'];
export const DATE_REPEATS = [['', 'Doesn’t repeat'], ['yearly', 'Every year'], ['monthly', 'Every month']];
export const CHORE_EVERY = [['', 'Just once'], ['daily', 'Every day'], ['weekly', 'Every week'], ['fortnightly', 'Every 2 weeks'], ['monthly', 'Every month']];
export const NOTE_STARTERS = ['Bin day', 'Wifi', 'Meter readings', 'Handy numbers'];
export const LIMITS = { title: 80, value: 500 };

const pad = (n) => String(n).padStart(2, '0');
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && toStr(parse(s)) === s;
export const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const toStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return toStr(d); };
/** Add months, clamping the day (31 Jan + 1 month = 28/29 Feb). */
export const addMonths = (s, n) => {
  const d = parse(s); const day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last)); return toStr(d);
};
const utc = (s) => { const d = parse(s); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); };
export const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);

const clean = (s, max) => String(s ?? '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim().slice(0, max);

/* ---- storage form ⇄ cloud row ---- */
export function encode(item) {
  if (item.kind === 'note') return clean(item.text, LIMITS.value);
  const o = item.kind === 'date'
    ? { d: item.date || '', r: item.repeat || '' }
    : { e: item.every || '', u: item.due || '', l: item.lastDone || '', x: item.done ? 1 : 0 };
  let t = clean(item.text, 300);
  let s = JSON.stringify({ ...o, t });
  while (s.length > LIMITS.value && t) { t = t.slice(0, Math.max(0, t.length - 20)); s = JSON.stringify({ ...o, t }); }
  return s;
}
export function decode(kind, value) {
  if (kind === 'note') return { text: clean(value, LIMITS.value) };
  let o = {};
  try { const j = JSON.parse(value); if (j && typeof j === 'object') o = j; } catch (_) { /* a hand-edited row: show it as a note rather than lose it */ return { text: clean(value, 300) }; }
  const text = clean(o.t, 300);
  if (kind === 'date') return { date: isDate(o.d) ? o.d : '', repeat: ['yearly', 'monthly'].includes(o.r) ? o.r : '', text };
  return { every: CHORE_EVERY.some(([k]) => k === o.e) ? o.e : '', due: isDate(o.u) ? o.u : '', lastDone: isDate(o.l) ? o.l : '', done: o.x === 1 || o.x === true, text };
}
/** Clean any object into a valid household record (used when loading local data and pulling from the cloud). Returns null if unusable. */
export function normalise(raw) {
  if (!raw || typeof raw !== 'object' || !KINDS.includes(raw.kind)) return null;
  const title = clean(raw.title, LIMITS.title).replace(/\n/g, ' ');
  if (!title) return null;
  const rec = { kind: raw.kind, title, text: clean(raw.text, raw.kind === 'note' ? LIMITS.value : 300) };
  if (raw.kind === 'date') { rec.date = isDate(raw.date) ? raw.date : ''; rec.repeat = ['yearly', 'monthly'].includes(raw.repeat) ? raw.repeat : ''; if (!rec.date) return null; }
  if (raw.kind === 'chore') {
    rec.every = CHORE_EVERY.some(([k]) => k === raw.every) ? raw.every : '';
    rec.due = isDate(raw.due) ? raw.due : ''; rec.lastDone = isDate(raw.lastDone) ? raw.lastDone : '';
    rec.done = raw.done === true && !rec.every;
  }
  return rec;
}

/* ---- dates ---- */
/** Next time a key date happens on or after `today` (repeats roll forward). '' if it has passed and doesn't repeat. */
export function nextOccurrence(item, today) {
  let d = item.date; if (!isDate(d)) return '';
  if (d >= today) return d;
  if (item.repeat === 'yearly') {
    const base = parse(d); let y = parse(today).getFullYear();
    for (let i = 0; i < 2; i++, y++) { const c = new Date(y, base.getMonth(), 1); c.setDate(Math.min(base.getDate(), new Date(y, base.getMonth() + 1, 0).getDate())); const s = toStr(c); if (s >= today) return s; }
  }
  if (item.repeat === 'monthly') {
    let guard = 0; while (d < today && guard++ < 2400) d = addMonths(item.date, monthsDiff(item.date, d) + 1);
    return d >= today ? d : '';
  }
  return '';
}
const monthsDiff = (a, b) => (parse(b).getFullYear() - parse(a).getFullYear()) * 12 + parse(b).getMonth() - parse(a).getMonth();
export function dateInfo(item, today) {
  const next = nextOccurrence(item, today);
  if (!next) return { next: '', days: null, state: 'past' };
  const days = daysBetween(today, next);
  return { next, days, state: days === 0 ? 'today' : days <= 7 ? 'soon' : 'later' };
}
export const sortDates = (items, today) => [...items].sort((a, b) => {
  const x = dateInfo(a, today), y = dateInfo(b, today);
  if (!x.next !== !y.next) return x.next ? -1 : 1;           // past one-offs last
  return (x.next || a.date).localeCompare(y.next || b.date) || a.title.localeCompare(b.title);
});

/* ---- chores ---- */
export function advance(due, every) {
  switch (every) { case 'daily': return addDays(due, 1); case 'weekly': return addDays(due, 7); case 'fortnightly': return addDays(due, 14); case 'monthly': return addMonths(due, 1); default: return ''; }
}
/** Mark a chore done today. Repeating chores roll their due date forward past today; one-offs become done. */
export function completeChore(chore, today) {
  if (!chore.every) return { done: true, lastDone: today };
  let next = chore.due && chore.due > today ? advance(chore.due, chore.every) : advance(chore.due || today, chore.every);
  let guard = 0; while (next && next <= today && guard++ < 1000) next = advance(next, chore.every);
  return { done: false, lastDone: today, due: next };
}
export function reopenChore(chore, prev) { return { done: false, lastDone: prev.lastDone || '', due: prev.due || chore.due || '' }; }
/** status: done | overdue | today | soon (next 2 days) | later | anytime (no date) */
export function choreStatus(chore, today) {
  if (chore.done) return { state: 'done', days: null };
  if (!chore.due) return { state: 'anytime', days: null };
  const days = daysBetween(today, chore.due);
  return { state: days < 0 ? 'overdue' : days === 0 ? 'today' : days <= 2 ? 'soon' : 'later', days };
}
const ORDER = { overdue: 0, today: 1, soon: 2, later: 3, anytime: 4, done: 5 };
export const sortChores = (items, today) => [...items].sort((a, b) => {
  const x = choreStatus(a, today), y = choreStatus(b, today);
  return ORDER[x.state] - ORDER[y.state] || (a.due || '9').localeCompare(b.due || '9') || a.title.localeCompare(b.title);
});

/* ---- labels ---- */
export function whenLabel(days) {
  if (days === null || days === undefined) return '';
  if (days === 0) return 'Today'; if (days === 1) return 'Tomorrow'; if (days === -1) return 'Yesterday';
  return days < 0 ? `${-days} days overdue` : `In ${days} days`;
}
export const everyLabel = (e) => (CHORE_EVERY.find(([k]) => k === e) || CHORE_EVERY[0])[1];

/* ---- overview ---- */
export function overview(items, today, shoppingLeft = 0) {
  const chores = items.filter((i) => i.kind === 'chore'), dates = items.filter((i) => i.kind === 'date'), notes = items.filter((i) => i.kind === 'note');
  const st = chores.map((c) => choreStatus(c, today).state);
  const upcoming = sortDates(dates, today).map((d) => ({ d, info: dateInfo(d, today) })).filter((x) => x.info.next);
  const nextDate = upcoming[0] || null;
  return {
    overdue: st.filter((s) => s === 'overdue').length,
    dueToday: st.filter((s) => s === 'today').length,
    open: st.filter((s) => s !== 'done').length,
    doneChores: st.filter((s) => s === 'done').length,
    datesSoon: upcoming.filter((x) => x.info.days <= 14).length,
    nextDate, notes: notes.length, shoppingLeft,
    empty: !items.length,
  };
}
