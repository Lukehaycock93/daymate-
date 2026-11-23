/* ==========================================================================
   DAYMATE — Planner (Day · Week · Month)

   One screen over the SAME tasks and reminders as Home — no second data
   store. Appointments and important dates are reminders of type "event".
   • Repeating items: finishing one creates the next; repeating appointments
     and important dates roll forward on their own (the server does the same
     overnight, so phone alerts keep working).
   • Drag (press-and-hold on touch) a row onto a day to reschedule it.
   ========================================================================== */
import { addDays, nextOccurrence, onOrAfter, occursOn } from './recur.js';

const MODES = ['day', 'week', 'month'];
const HORIZON_DAYS = 800;       // how far ahead repeating items are shown

export function initPlanner(DM) {
  const { Store, UI, helpers, CATEGORIES, PRIORITY_LABEL, PRIORITY_RANK } = DM;
  const { $, $$, esc, icon, plural, todayStr, nowHM, parseDate, toDateStr, emptyState, safeLS } = helpers;
  const catOf = (k) => CATEGORIES.find((c) => c.key === k) || CATEGORIES[0];
  const loadMode = () => { const m = safeLS.get('daymate:plannerMode'); return MODES.includes(m) ? m : 'day'; };
  const ui = { mode: loadMode(), selected: todayStr(), filter: 'all', drag: null };

  /* ---------------- dates ---------------- */
  const mondayOf = (s) => { const d = parseDate(s); const wd = (d.getDay() + 6) % 7; return addDays(s, -wd); };
  const monthStart = (s) => `${s.slice(0, 7)}-01`;
  function backMonths(s, n) { let d = parseDate(s); d = new Date(d.getFullYear(), d.getMonth() - n, 1); return toDateStr(d); }
  const fmtDay = (s, o) => parseDate(s).toLocaleDateString('en-GB', o);
  const heading = () => {
    if (ui.mode === 'month') return fmtDay(ui.selected, { month: 'long', year: 'numeric' });
    if (ui.mode === 'week') { const a = mondayOf(ui.selected), b = addDays(a, 6); return `${fmtDay(a, { day: 'numeric', month: 'short' })} – ${fmtDay(b, { day: 'numeric', month: 'short' })}`; }
    return ui.selected === todayStr() ? 'Today' : fmtDay(ui.selected, { weekday: 'long', day: 'numeric', month: 'short' });
  };

  /* ---------------- data ---------------- */
  function sources() {
    const out = [];
    Store.state.tasks.forEach((t) => out.push({ col: 'tasks', type: 'task', src: t, done: !!t.completed }));
    Store.state.reminders.forEach((r) => out.push({ col: 'reminders', type: r.kind, src: r, done: !!r.done }));
    return out;
  }
  const passesFilter = (s) => ui.filter === 'all' || (s.src.category || 'personal') === ui.filter;

  /** Everything that falls on one day (stored items + repeats of open series). */
  function itemsOn(day, all = sources()) {
    const rows = [];
    for (const s of all) {
      if (!passesFilter(s)) continue;
      const it = s.src;
      if (it.date === day) { rows.push({ ...s, day, projected: false }); continue; }
      if (it.repeat && !s.done && day > it.date && day <= addDays(it.date, HORIZON_DAYS) && occursOn(it.date, it.repeat, day)) {
        rows.push({ ...s, day, projected: true });
      }
    }
    return rows.sort((a, b) => (a.src.time || '') === (b.src.time || '')
      ? (PRIORITY_RANK[a.src.priority || 'medium'] - PRIORITY_RANK[b.src.priority || 'medium']) || a.src.title.localeCompare(b.src.title)
      : (a.src.time || '') < (b.src.time || '') ? -1 : 1);
  }
  const isOverdue = (s, today, now) => !s.done && (s.src.date < today || (s.src.date === today && s.type !== 'task' && s.src.time && s.src.time < now));
  function overdueRows() {
    const today = todayStr(), now = nowHM();
    return sources().filter((s) => passesFilter(s) && isOverdue(s, today, now)).sort((a, b) => a.src.date.localeCompare(b.src.date) || (a.src.time || '').localeCompare(b.src.time || ''));
  }

  /* ---------------- repeats ---------------- */
  function spawnNext(col, item) {
    if (!item || !item.repeat || item.kind === 'event') return;
    const today = todayStr();
    // Next repeat after BOTH the due date and today, so finishing something late doesn't pile up overdue copies.
    const date = nextOccurrence(item.date, item.repeat, item.date > today ? item.date : today);
    if (!date) return;
    const dupe = Store.state[col].find((x) => x.id !== item.id && x.title === item.title && x.date === date && x.repeat === item.repeat && !(x.completed || x.done));
    if (dupe) return;
    const copy = { ...item };
    ['id', 'createdAt', 'updatedAt', 'tbl'].forEach((k) => delete copy[k]);
    Object.assign(copy, { date, ...(col === 'tasks' ? { completed: false, completedOn: '', completedAt: '' } : { done: false }) });
    Store.add(col, copy);
  }
  function rollEvents() {
    const today = todayStr();
    Store.state.reminders.filter((r) => r.kind === 'event' && r.repeat && r.date < today).forEach((r) => {
      const next = onOrAfter(r.date, r.repeat, today);
      if (next !== r.date) Store.update('reminders', r.id, { date: next, done: false });
    });
  }
  DM.onComplete((col, item) => spawnNext(col, item));

  /* ---------------- rendering ---------------- */
  const dotsFor = (rows, today, now) => {
    const od = rows.some((r) => isOverdue(r, today, now));
    const t = rows.filter((r) => r.type === 'task' && !r.done).length;
    const e = rows.filter((r) => r.type !== 'task' && !r.done).length;
    return `${od ? '<i class="pl-dot pl-dot--od"></i>' : ''}${t ? '<i class="pl-dot pl-dot--t"></i>' : ''}${e ? '<i class="pl-dot pl-dot--e"></i>' : ''}`;
  };

  function rowHtml(r, today, now) {
    const it = r.src, cat = catOf(it.category), over = isOverdue(r, today, now);
    const pri = r.type === 'task' && (it.priority === 'urgent' || it.priority === 'high') ? `<span class="pl-chip pl-chip--${it.priority}">${PRIORITY_LABEL[it.priority]}</span>` : '';
    const kindLbl = r.type === 'event' ? 'Appointment' : r.type === 'bill' ? 'Bill' : '';
    const checkable = r.type !== 'event';
    const edit = r.type === 'task' ? 'planner-edit-task' : 'planner-edit-reminder';
    return `
      <li class="pl-row${r.done ? ' is-done' : ''}${over ? ' is-over' : ''}${r.projected ? ' is-proj' : ''}" data-id="${esc(it.id)}" data-col="${r.col}" data-date="${esc(it.date)}" data-cat="${esc(cat.key)}" ${r.projected ? '' : 'data-drag="1"'}>
        <span class="pl-time">${it.time ? esc(it.time) : '<small>All day</small>'}</span>
        ${checkable && !r.projected
          ? `<button type="button" class="check" role="checkbox" aria-checked="${r.done}" data-action="planner-toggle" aria-label="${r.done ? 'Mark as not done' : 'Mark as done'}: ${esc(it.title)}">${icon('check')}</button>`
          : `<span class="pl-mark">${r.type === 'event' ? icon('calendar') : icon('repeat')}</span>`}
        <button type="button" class="pl-body" data-action="${edit}" aria-label="Edit: ${esc(it.title)}">
          <strong>${it.important ? '<span class="pl-star" aria-label="Important">★</span> ' : ''}${esc(it.title)}</strong>
          <span class="pl-meta">
            ${over ? '<span class="pl-chip pl-chip--over">Overdue</span>' : ''}${pri}
            <span class="pl-chip pl-chip--cat">${esc(cat.label)}</span>
            ${kindLbl ? `<span class="pl-sub">${kindLbl}</span>` : ''}
            ${it.repeat ? `<span class="pl-sub">${icon('repeat')} ${esc({ daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' }[it.repeat])}</span>` : ''}
          </span>
        </button>
      </li>`;
  }

  function dayList(day, today, now) {
    const rows = itemsOn(day);
    const showOver = day === today ? overdueRows().filter((o) => o.src.date < today) : [];
    const overIds = new Set(showOver.map((o) => `${o.col}:${o.src.id}`));
    const body = rows.filter((r) => !overIds.has(`${r.col}:${r.src.id}`));
    const nice = fmtDay(day, { weekday: 'long', day: 'numeric', month: 'long' });
    let html = `<h3 class="pl-h">${day === today ? 'Today · ' : ''}${esc(nice)}</h3>`;
    if (showOver.length) html += `<div class="pl-over"><p class="pl-over__t">${icon('clock')} ${plural(showOver.length, 'overdue item', 'overdue items')}</p><ul class="pl-list">${showOver.map((r) => rowHtml(r, today, now)).join('')}</ul></div>`;
    if (body.length) html += `<ul class="pl-list">${body.map((r) => rowHtml(r, today, now)).join('')}</ul>`;
    else if (!showOver.length) html += emptyState({ iconName: 'calendar', title: day < today ? 'Nothing was planned' : 'A clear day', text: day < today ? 'No tasks or appointments on this day.' : 'Nothing planned yet. Add a task or appointment for this day.' });
    return html;
  }

  function comingUp(today) {
    const all = sources().filter((s) => s.src.important && !s.done);
    const out = [];
    for (let i = 0; i <= 30 && out.length < 3; i++) {
      const d = addDays(today, i);
      all.forEach((s) => { if (s.src.date === d || (s.src.repeat && occursOn(s.src.date, s.src.repeat, d))) out.push({ d, s }); });
    }
    if (!out.length) return '';
    return `<section class="card pl-up"><p class="pl-up__t">★ Important dates</p>${out.slice(0, 3).map(({ d, s }) =>
      `<p class="pl-up__r"><span>${esc(s.src.title)}</span><b>${d === today ? 'Today' : d === addDays(today, 1) ? 'Tomorrow' : esc(fmtDay(d, { weekday: 'short', day: 'numeric', month: 'short' }))}</b></p>`).join('')}</section>`;
  }

  function weekStrip(today, now, all) {
    const start = mondayOf(ui.selected);
    return `<div class="pl-week" role="group" aria-label="Week">${Array.from({ length: 7 }, (_, i) => {
      const d = addDays(start, i), rows = itemsOn(d, all);
      return `<button type="button" class="pl-wd${d === ui.selected ? ' is-sel' : ''}${d === today ? ' is-today' : ''}" data-action="planner-pick" data-date="${d}" data-drop-date="${d}" aria-label="${esc(fmtDay(d, { weekday: 'long', day: 'numeric', month: 'long' }))}" aria-pressed="${d === ui.selected}">
        <small>${esc(fmtDay(d, { weekday: 'short' }))}</small><b>${parseDate(d).getDate()}</b><span class="pl-dots">${dotsFor(rows, today, now)}</span></button>`;
    }).join('')}</div>`;
  }

  function monthGrid(today, now, all) {
    const first = monthStart(ui.selected);
    const start = mondayOf(first);
    const month = first.slice(0, 7);
    const heads = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<span class="pl-mh">${d}</span>`).join('');
    const cells = Array.from({ length: 42 }, (_, i) => {
      const d = addDays(start, i), rows = itemsOn(d, all), out = d.slice(0, 7) !== month;
      return `<button type="button" class="pl-mc${out ? ' is-out' : ''}${d === ui.selected ? ' is-sel' : ''}${d === today ? ' is-today' : ''}" data-action="planner-pick" data-date="${d}" data-drop-date="${d}" aria-label="${esc(fmtDay(d, { weekday: 'long', day: 'numeric', month: 'long' }))}" aria-pressed="${d === ui.selected}">
        <b>${parseDate(d).getDate()}</b><span class="pl-dots">${dotsFor(rows, today, now)}</span></button>`;
    }).join('');
    return `<div class="pl-month" role="group" aria-label="Month">${heads}${cells}</div>`;
  }

  function render(host) {
    if (ui.drag && ui.drag.active) return;                     // never rebuild the screen mid-drag
    rollEvents();
    const today = todayStr(), now = nowHM(), all = sources();
    const od = overdueRows().length;
    const nextWeek = [0, 1, 2, 3, 4, 5, 6].reduce((n, i) => n + itemsOn(addDays(today, i), all).filter((r) => !r.done && !r.projected).length, 0);
    const empty = !Store.state.tasks.length && !Store.state.reminders.length;

    host.innerHTML = `
      <div class="pl">
        <div class="pl-top">
          <div class="pl-modes seg" role="tablist" aria-label="Calendar view">
            ${MODES.map((m) => `<button type="button" role="tab" class="pl-mode${m === ui.mode ? ' is-on' : ''}" aria-selected="${m === ui.mode}" data-action="planner-mode" data-mode="${m}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}
          </div>
          <div class="pl-nav">
            <button type="button" class="icon-btn" data-action="planner-prev" aria-label="Previous ${ui.mode}">‹</button>
            <strong class="pl-title" aria-live="polite">${esc(heading())}</strong>
            <button type="button" class="icon-btn" data-action="planner-next" aria-label="Next ${ui.mode}">›</button>
            <button type="button" class="pl-today" data-action="planner-today"${ui.selected === today ? ' disabled' : ''}>Today</button>
          </div>
        </div>
        <div class="pl-stats">
          <span class="pl-stat${od ? ' pl-stat--od' : ''}"><b>${od}</b> overdue</span>
          <span class="pl-stat"><b>${nextWeek}</b> in the next 7 days</span>
        </div>
        <div class="pl-cats" role="group" aria-label="Filter by category">
          ${[{ key: 'all', label: 'All' }, ...CATEGORIES].map((c) => `<button type="button" class="chip${ui.filter === c.key ? ' is-on' : ''}" aria-pressed="${ui.filter === c.key}" data-action="planner-filter" data-cat="${c.key}">${esc(c.label)}</button>`).join('')}
        </div>
        ${ui.mode === 'week' ? weekStrip(today, now, all) : ui.mode === 'month' ? monthGrid(today, now, all) : ''}
        <section class="pl-day">${dayList(ui.selected, today, now)}</section>
        ${comingUp(today)}
        ${empty ? `<p class="fine">Tip: press and hold an item, then drag it onto another day to reschedule it.</p>` : ''}
        <div class="pl-add">
          <button type="button" class="btn btn--primary" data-action="planner-add-task">${icon('plus')} Task</button>
          <button type="button" class="btn btn--ghost" data-action="planner-add-event">${icon('calendar')} Appointment</button>
          <button type="button" class="btn btn--ghost" data-action="planner-add-reminder">${icon('bell')} Reminder</button>
        </div>
      </div>`;
  }

  /* ---------------- actions ---------------- */
  const redraw = () => DM.helpers && DM.views.renderAll();
  const step = (dir) => {
    if (ui.mode === 'day') ui.selected = addDays(ui.selected, dir);
    else if (ui.mode === 'week') ui.selected = addDays(ui.selected, 7 * dir);
    else { const f = monthStart(ui.selected); const t = backMonths(f, -dir); const day = Math.min(Number(ui.selected.slice(8)), new Date(Number(t.slice(0, 4)), Number(t.slice(5, 7)), 0).getDate()); ui.selected = `${t.slice(0, 8)}${String(day).padStart(2, '0')}`; }
    redraw();
  };
  const idOf = (el) => { const li = el.closest('[data-id]'); return li ? li.dataset.id : ''; };
  const openAdd = (kind) => {
    DM.setPresetDate(ui.selected);
    if (kind === 'task') DM.views.openTaskSheet();
    else { DM.views.openReminderSheet(); const r = $(`#reminderForm input[name="kind"][value="${kind}"]`); if (r) r.checked = true; }
  };

  DM.registerActions({
    'planner-mode': (el) => { ui.mode = MODES.includes(el.dataset.mode) ? el.dataset.mode : 'day'; safeLS.set('daymate:plannerMode', ui.mode); redraw(); },
    'planner-prev': () => step(-1),
    'planner-next': () => step(1),
    'planner-today': () => { ui.selected = todayStr(); redraw(); },
    'planner-pick': (el) => { if (ui.suppressClick) return; ui.selected = el.dataset.date; redraw(); },
    'planner-filter': (el) => { ui.filter = el.dataset.cat || 'all'; redraw(); },
    'planner-edit-task': (el) => { if (ui.suppressClick) return; const id = idOf(el); if (id) DM.views.openTaskSheet(id); },
    'planner-edit-reminder': (el) => { if (ui.suppressClick) return; const id = idOf(el); if (id) DM.views.openReminderSheet(id); },
    'planner-toggle': (el) => {
      const li = el.closest('[data-id]'); if (!li) return;
      const col = li.dataset.col, it = Store.get(col, li.dataset.id); if (!it) return;
      if (col === 'tasks') {
        const completed = !it.completed;
        Store.update('tasks', it.id, { completed, completedOn: completed ? todayStr() : '', completedAt: completed ? new Date().toISOString() : '' });
        if (completed) spawnNext('tasks', Store.get('tasks', it.id));
      } else {
        Store.update('reminders', it.id, { done: !it.done });
        if (!it.done) spawnNext('reminders', Store.get('reminders', it.id));
      }
    },
    'planner-add-task': () => openAdd('task'),
    'planner-add-event': () => openAdd('event'),
    'planner-add-reminder': () => openAdd('reminder'),
  });
  DM.registerRoute('planner', { render });

  /* ---------------- drag to reschedule ---------------- */
  const HOLD_MS = 350, SLOP = 10;
  function dropTargetAt(x, y) {
    const el = document.elementFromPoint(x, y);
    return el ? el.closest('[data-drop-date]') : null;
  }
  function clearHighlights() { $$('.is-drop').forEach((e) => e.classList.remove('is-drop')); }
  function endDrag(commit, x, y) {
    const d = ui.drag; if (!d) return;
    clearTimeout(d.timer);
    if (d.ghost) d.ghost.remove();
    d.row.classList.remove('is-dragging');
    let target = null;
    if (commit && d.active) target = dropTargetAt(x, y);
    clearHighlights();
    const wasActive = d.active;
    ui.drag = null;
    if (wasActive) { ui.suppressClick = true; setTimeout(() => { ui.suppressClick = false; }, 350); }
    if (target) {
      const date = target.dataset.dropDate, it = Store.get(d.col, d.id);
      if (it && date && date !== it.date) {
        const before = it.date;
        Store.update(d.col, d.id, { date });
        UI.toast(`Moved to ${fmtDay(date, { weekday: 'short', day: 'numeric', month: 'short' })}`, { action: { label: 'Undo', fn: () => Store.update(d.col, d.id, { date: before }) } });
        return;
      }
    }
    if (wasActive) redraw();
  }
  function beginDrag(d) {
    d.active = true;
    d.ghost = d.row.cloneNode(true);
    d.ghost.classList.add('pl-ghost');
    d.ghost.style.width = `${d.row.offsetWidth}px`;
    document.body.appendChild(d.ghost);
    d.row.classList.add('is-dragging');
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch (_) { /* not supported */ } }
    moveGhost(d.x, d.y);
  }
  function moveGhost(x, y) { const g = ui.drag && ui.drag.ghost; if (g) { g.style.left = `${x - 40}px`; g.style.top = `${y - 28}px`; } }

  document.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    const row = e.target.closest && e.target.closest('#view-planner .pl-row[data-drag]');
    if (!row || e.target.closest('.check')) return;
    const d = { row, id: row.dataset.id, col: row.dataset.col, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, pid: e.pointerId, touch: e.pointerType === 'touch', active: false, ghost: null, timer: 0 };
    ui.drag = d;
    if (d.touch) d.timer = setTimeout(() => { if (ui.drag === d) beginDrag(d); }, HOLD_MS);
  });
  document.addEventListener('pointermove', (e) => {
    const d = ui.drag; if (!d || e.pointerId !== d.pid) return;
    d.x = e.clientX; d.y = e.clientY;
    if (!d.active) {
      const moved = Math.hypot(d.x - d.sx, d.y - d.sy);
      if (d.touch) { if (moved > SLOP) { clearTimeout(d.timer); ui.drag = null; } }      // they're scrolling, not dragging
      else if (moved > 6) beginDrag(d);
      return;
    }
    moveGhost(d.x, d.y);
    clearHighlights();
    const t = dropTargetAt(d.x, d.y); if (t) t.classList.add('is-drop');
  });
  document.addEventListener('pointerup', (e) => { const d = ui.drag; if (d && e.pointerId === d.pid) endDrag(true, e.clientX, e.clientY); });
  document.addEventListener('pointercancel', (e) => { const d = ui.drag; if (d && e.pointerId === d.pid) endDrag(false); });
  // While a drag is active the page must not scroll.
  document.addEventListener('touchmove', (e) => { if (ui.drag && ui.drag.active && e.cancelable) e.preventDefault(); }, { passive: false });
  document.addEventListener('contextmenu', (e) => { if (ui.drag && ui.drag.active) e.preventDefault(); });

  try { rollEvents(); } catch (err) { console.warn('[DAYMATE] roll-forward failed:', err); }
  window.__daymatePlanner = { spawnNext, itemsOn };   // used by the tests
}
