/* ==========================================================================
   DAYMATE — in-app notification rules (pure, testable)

   This mirrors the SQL function due_notification_candidates() so that the
   in-app notification centre and the server's push notifications agree and
   share the same dedupe keys (the same alert is never created twice).
   It only fills the in-app centre while DAYMATE is open. Phone (push)
   notifications are scheduled and sent by the server, never by browser timers.
   ========================================================================== */
export const CATCHUP_MIN = 120;      // same window the server uses
export const MISSED_AFTER_MIN = 60;  // a reminder still not done this long after its time counts as missed
export const MISSED_MAX_DAYS = 7;

const pad = (n) => String(n).padStart(2, '0');

export function dueLocal(date, time, defaultTime) { return `${date}T${time || defaultTime}`; }

export function dueAt(date, time, defaultTime) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = (time || defaultTime).split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

export function leadBody(lead, note) {
  const tail = note ? ` · ${note}` : '';
  if (lead === 0) return `Due now${tail}`;
  if (lead < 60) return `Due in ${lead} min${tail}`;
  return `Due in ${Math.floor(lead / 60)} h${tail}`;
}

export function activeLeads(prefs, premium) {
  const leads = Array.isArray(prefs.leadMinutes) && prefs.leadMinutes.length ? prefs.leadMinutes : [0];
  return premium ? leads : leads.slice(0, 1);
}

/** Which in-app notifications should exist right now that don't already? */
export function computeNotifications({ now, tasks, reminders, prefs, premium, existingKeys }) {
  const out = [];
  const nowMs = now.getTime();
  const have = new Set(existingKeys);
  const leads = activeLeads(prefs, premium);

  const consider = (sourceType, notifType, enabled, item, itemTitle, note, date, time) => {
    if (!enabled) return;
    const due = dueAt(date, time, prefs.defaultTime);
    const dl = dueLocal(date, time, prefs.defaultTime);
    const dueMs = due.getTime();
    const hhmm = `${pad(due.getHours())}:${pad(due.getMinutes())}`;

    for (const lead of leads) {
      const notifyMs = dueMs - lead * 60000;
      if (notifyMs > nowMs) continue;                          // not yet
      if (nowMs > dueMs + MISSED_AFTER_MIN * 60000) continue;  // too old: "missed" handles it
      const key = `${sourceType}:${item.id}:L${lead}:${dl}`;
      if (have.has(key)) continue;
      have.add(key);
      out.push({ type: notifType, title: itemTitle, body: leadBody(lead, note), sourceType, sourceId: item.id, dedupeKey: key });
    }

    // Missed: reminders, appointments and bills only (overdue tasks already show as "Overdue" on Home).
    if (sourceType !== 'task') {
      const ageMs = nowMs - dueMs;
      if (ageMs >= MISSED_AFTER_MIN * 60000 && ageMs <= MISSED_MAX_DAYS * 86400000) {
        const key = `missed:${sourceType}:${item.id}:${dl}`;
        if (!have.has(key)) {
          have.add(key);
          out.push({ type: 'missed', title: `Missed: ${itemTitle}`, body: `Was due ${date} at ${hhmm}`, sourceType, sourceId: item.id, dedupeKey: key });
        }
      }
    }
  };

  tasks.forEach((t) => { if (!t.completed) consider('task', 'task', prefs.tasks, t, t.title, '', t.date, t.time); });
  reminders.forEach((r) => {
    if (r.done) return;
    if (r.kind === 'event') consider('appointment', 'appointment', prefs.appointments, r, r.title, r.note, r.date, r.time);
    else if (r.kind === 'bill') consider('reminder', 'bill', prefs.bills, r, r.title, r.note, r.date, r.time);
    else consider('reminder', 'reminder', prefs.reminders, r, r.title, r.note, r.date, r.time);
  });
  return out.slice(0, 25);   // never flood the inbox in one pass
}
