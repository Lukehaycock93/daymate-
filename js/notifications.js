/* ==========================================================================
   DAYMATE — Notification centre + notification preferences

   The centre lists what's coming up, alerts (task / appointment / bill /
   reminder / missed / summary), read & unread, history, dismiss and clear all.
   In-app alerts are created while DAYMATE is open (see schedule.js). Phone
   notifications while the app is closed are sent by the server.
   ========================================================================== */
import { computeNotifications } from './schedule.js';
import { session } from './session.js';
import * as push from './push.js';

const LEAD_OPTIONS = [[0, 'At the time'], [5, '5 minutes before'], [15, '15 minutes before'], [30, '30 minutes before'], [60, '1 hour before'], [120, '2 hours before'], [1440, '1 day before']];
const TYPE_META = {
  task: { label: 'Task', icon: 'list' }, appointment: { label: 'Appointment', icon: 'calendar' }, reminder: { label: 'Reminder', icon: 'bell' },
  bill: { label: 'Bill', icon: 'receipt' }, missed: { label: 'Missed', icon: 'clock' }, summary: { label: 'Morning summary', icon: 'sparkles' }, system: { label: 'DAYMATE', icon: 'info' },
};
const FILTERS = [['all', 'All'], ['task', 'Tasks'], ['appointment', 'Appointments'], ['bill', 'Bills'], ['reminder', 'Reminders'], ['missed', 'Missed']];

export function initNotifications(DM) {
  const { Store, Account, UI, Modal, Entitlements, helpers } = DM;
  const { $, $$, esc, icon, plural, dayLabel, todayStr } = helpers;
  const ui = { tab: 'inbox', filter: 'all', pushStatus: { state: 'off' } };
  const MAX_KEEP = 200;

  const visible = () => Store.state.notifications.filter((n) => !n.dismissedAt);
  const unreadCount = () => visible().filter((n) => !n.readAt).length;
  const sorted = (list) => list.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  /* ---------------- in-app generation ---------------- */
  function generate() {
    const st = Store.state;
    const fresh = computeNotifications({
      now: new Date(), tasks: st.tasks, reminders: st.reminders, prefs: st.settings.notify,
      premium: Account.getPlan() === 'premium', existingKeys: st.notifications.map((n) => n.dedupeKey),
    });
    if (!fresh.length) return;
    fresh.forEach((n) => Store.add('notifications', { ...n, readAt: '', dismissedAt: '' }));
    const extra = Store.state.notifications.length - MAX_KEEP;
    if (extra > 0) {                                  // keep history bounded: drop oldest already-dismissed ones first
      const drop = sorted(Store.state.notifications).reverse().filter((n) => n.dismissedAt).slice(0, extra);
      drop.forEach((n) => Store.remove('notifications', n.id));
    }
  }

  /* ---------------- bell badge ---------------- */
  function renderBell() {
    const badge = $('#bellBadge');
    if (!badge) return;
    const n = unreadCount();
    badge.hidden = n === 0;
    badge.textContent = n > 9 ? '9+' : String(n);
    $('#bellBtn').setAttribute('aria-label', n ? `Notifications, ${plural(n, 'unread', 'unread')}` : 'Notifications');
  }

  /* ---------------- centre view ---------------- */
  function row(n, inHistory) {
    const meta = TYPE_META[n.type] || TYPE_META.system;
    const when = new Date(n.createdAt);
    const label = `${dayLabel(helpers.toDateStr(when))} · ${helpers.pad(when.getHours())}:${helpers.pad(when.getMinutes())}`;
    return `
      <li class="note${n.readAt ? '' : ' is-unread'}${n.type === 'missed' ? ' is-missed' : ''}${n.dismissedAt ? ' is-dismissed' : ''}" data-id="${esc(n.id)}">
        <button type="button" class="note__main" data-action="read-notification" aria-label="${n.readAt ? '' : 'Unread. '}${esc(n.title)}">
          <span class="note__icon">${icon(meta.icon)}</span>
          <span class="note__text"><strong>${esc(n.title)}</strong>${n.body ? `<small>${esc(n.body)}</small>` : ''}<em>${esc(meta.label)} · ${esc(label)}${n.dismissedAt ? ' · Dismissed' : ''}</em></span>
          ${n.readAt ? '' : '<i class="note__dot" aria-hidden="true"></i>'}
        </button>
        ${inHistory ? '' : `<button type="button" class="icon-btn" data-action="dismiss-notification" aria-label="Dismiss: ${esc(n.title)}">${icon('x')}</button>`}
      </li>`;
  }

  function upcomingBlock() {
    const today = todayStr();
    const limit = helpers.addDays(today, 7);
    const items = DM.views.upcomingItems().filter((i) => i.date <= limit && !i.overdue).slice(0, 5);
    if (!items.length) return '';
    return `
      <section class="section" aria-labelledby="ncUp">
        <div class="section__head"><h2 id="ncUp">Coming up</h2><a class="chip-btn" href="#/home">Open Home</a></div>
        <ul class="uplist">${items.map((it) => `
          <li class="up"><span class="up__chip${it.type === 'event' ? ' up__chip--event' : it.type === 'task' ? ' up__chip--task' : ''}">${icon(it.type === 'task' ? 'list' : helpers.kindIcon(it.type))}</span>
            <span class="up__body"><span class="up__title">${esc(it.title)}</span><span class="up__meta">${esc(dayLabel(it.date, today))}${it.time ? ` · ${esc(it.time)}` : ''}</span></span></li>`).join('')}</ul>
      </section>`;
  }

  function render(host) {
    const inHistory = ui.tab === 'history';
    const base = inHistory ? Store.state.notifications : visible();
    const list = sorted(base).filter((n) => ui.filter === 'all' || n.type === ui.filter);
    const unread = unreadCount();
    const s = Store.state.settings.notify;
    const pushOn = ui.pushStatus.state === 'on';

    let body;
    if (!list.length) {
      body = base.length
        ? helpers.emptyState({ iconName: 'sliders', title: 'Nothing here', text: 'No notifications of this type.' })
        : helpers.emptyState({ iconName: 'bell', title: inHistory ? 'No history yet' : 'You’re all caught up', text: inHistory ? 'Alerts you’ve received will be kept here.' : 'Alerts for tasks, appointments, bills and reminders appear here when they’re due.' });
    } else body = `<ul class="notes">${list.map((n) => row(n, inHistory)).join('')}</ul>`;

    host.innerHTML = `
      <div class="preview-wrap">
        ${pushOn ? '' : `<button type="button" class="promo promo--soft" data-action="open-notify-prefs">
          <span class="promo__icon">${icon('bell')}</span>
          <span class="promo__text"><strong>Get alerts on your phone</strong><small>Turn on notifications to be reminded even when DAYMATE is closed</small></span>
          ${icon('chevron', 'promo__chev')}</button>`}
        ${upcomingBlock()}
        <div class="tabs" role="tablist">
          <button type="button" role="tab" class="filter__btn" aria-selected="${!inHistory}" data-action="notif-tab" data-tab="inbox">Inbox${unread ? ` <span class="filter__n">${unread}</span>` : ''}</button>
          <button type="button" role="tab" class="filter__btn" aria-selected="${inHistory}" data-action="notif-tab" data-tab="history">History</button>
        </div>
        <div class="catbar" role="group" aria-label="Filter notifications">
          ${FILTERS.map(([k, l]) => `<button type="button" class="chip${ui.filter === k ? ' is-on' : ''}" aria-pressed="${ui.filter === k}" data-action="notif-filter" data-filter="${k}">${l}</button>`).join('')}
        </div>
        <div class="note-tools">
          ${inHistory
            ? `<button type="button" class="link-btn" data-action="delete-history"${Store.state.notifications.some((n) => n.dismissedAt) ? '' : ' disabled'}>Delete dismissed history</button>`
            : `<button type="button" class="link-btn" data-action="mark-all-read"${unread ? '' : ' disabled'}>Mark all as read</button>
               <button type="button" class="link-btn link-btn--danger" data-action="clear-all-notifications"${visible().length ? '' : ' disabled'}>Clear all</button>`}
        </div>
        ${body}
        <p class="fine">${inHistory ? 'Dismissed alerts stay here until you delete them.' : 'Clearing moves alerts to History. Nothing is lost.'}</p>
      </div>`;
  }

  /* ---------------- actions ---------------- */
  const idOf = (el) => { const h = el.closest('[data-id]'); return h ? h.dataset.id : ''; };
  const now = () => new Date().toISOString();

  /* ---------------- preferences sheet ---------------- */
  function pushPanel(st) {
    const premium = Account.getPlan() === 'premium';
    const msg = {
      'ios-install': { t: 'Add DAYMATE to your Home Screen first', d: 'On iPhone and iPad, notifications only work for apps added to the Home Screen. Tap Share, then “Add to Home Screen”, open DAYMATE from there, and come back here to turn notifications on.', btn: 'Show me how', act: 'install-app' },
      unsupported: { t: 'Not supported in this browser', d: 'This browser can’t receive phone notifications from DAYMATE. Try Chrome or Edge on Android or desktop, or Safari on an iPhone with DAYMATE added to the Home Screen.' },
      unconfigured: { t: 'Not set up yet', d: 'Phone notifications need the Web Push key in js/config.js. SETUP.md explains how to add it.' },
      'signed-out': { t: 'Sign in to get phone notifications', d: 'Phone notifications are scheduled on DAYMATE’s server for your account, so you’ll need to sign in first.', btn: 'Sign in', act: 'open-auth' },
      denied: { t: 'Notifications are blocked', d: 'You blocked notifications for DAYMATE. To turn them on, allow notifications for this site in your browser or phone settings, then return here.' },
      off: { t: 'Phone notifications are off', d: 'Turn them on to be reminded about tasks, appointments and bills even when DAYMATE is closed. We’ll ask your browser for permission only when you tap the button.', btn: 'Turn on phone notifications', act: 'enable-push' },
      on: { t: 'Phone notifications are on', d: 'This device will be notified when things are due.', btn: 'Turn off', act: 'disable-push', ghost: true },
    }[st.state];
    return `
      <div class="field">
        <span class="field__label">Phone notifications</span>
        <div class="acct">
          <p class="acct__line"><strong>${esc(msg.t)}</strong><br><small>${esc(msg.d)}</small></p>
          ${msg.btn ? `<button type="button" class="btn ${msg.ghost ? 'btn--ghost' : 'btn--primary'}" data-action="${msg.act}" id="pushBtn">${esc(msg.btn)}</button>` : ''}
          ${st.state === 'on' ? `<button type="button" class="btn btn--ghost" data-action="test-push" id="testPushBtn">Send a test notification</button><p class="fine">The test is sent by the server to your devices. If it doesn’t arrive within a few seconds, notifications aren’t working on this device yet.</p>` : ''}
        </div>
      </div>`;
  }

  const toggle = (id, label, checked, hint = '') => `
    <label class="switch switch--row"><span class="switch__text"><strong>${label}</strong>${hint ? `<small>${hint}</small>` : ''}</span>
      <input type="checkbox" class="switch__input" data-pref="${id}" ${checked ? 'checked' : ''}><i class="switch__ui" aria-hidden="true"></i></label>`;

  async function renderPrefs() {
    ui.pushStatus = await push.getStatus(DM);
    const n = Store.state.settings.notify;
    const premium = Account.getPlan() === 'premium';
    const leads = premium ? n.leadMinutes : n.leadMinutes.slice(0, 1);
    $('#notifyBody').innerHTML = `
      ${pushPanel(ui.pushStatus)}
      <div class="field">
        <span class="field__label">What to be notified about</span>
        <div class="switches">
          ${toggle('tasks', 'Tasks', n.tasks)}${toggle('appointments', 'Appointments', n.appointments)}
          ${toggle('reminders', 'Reminders', n.reminders)}${toggle('bills', 'Bill reminders', n.bills)}
        </div>
      </div>
      <div class="field">
        <span class="field__label">When to remind me</span>
        ${premium
          ? `<div class="checks">${LEAD_OPTIONS.map(([v, l]) => `<label class="check-row"><input type="checkbox" data-lead="${v}" ${leads.includes(v) ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div><p class="field__hint">Choose up to 4. Premium lets you be reminded more than once.</p>`
          : `<select class="input" id="leadSelect" aria-label="When to remind me">${LEAD_OPTIONS.map(([v, l]) => `<option value="${v}" ${leads[0] === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
             <button type="button" class="link-btn" data-action="open-premium" data-feature="smart-reminders">${icon('lock')} Premium: get reminded more than once</button>`}
      </div>
      <div class="field">
        <label class="field__label" for="defaultTime">Time for items without a time</label>
        <input class="input" id="defaultTime" type="time" value="${esc(n.defaultTime)}">
        <p class="field__hint">Tasks and reminders that only have a date are notified at this time.</p>
      </div>
      <div class="field">
        <span class="field__label">Morning summary</span>
        ${premium
          ? `${toggle('morningSummary', 'Personalised morning briefing', n.morningSummary, 'A daily notification with what’s on today.')}
             <input class="input" id="morningTime" type="time" value="${esc(n.morningTime)}" aria-label="Morning summary time" ${n.morningSummary ? '' : 'disabled'}>`
          : `<button type="button" class="row" data-action="open-premium" data-feature="morning-briefing"><span class="row__icon">${icon('lock')}</span><span class="row__text"><strong>Personalised morning briefing</strong><small>A daily summary of your day. Premium · coming soon</small></span>${icon('chevron', 'row__chev')}</button>`}
      </div>
      <p class="fine">Settings are saved to your account${Account.user ? '' : ' once you sign in (for now they’re on this device)'}. Alerts are decided on the server, and Premium options are checked there too.</p>`;
  }

  function openPrefs() { Modal.open('m-notify'); renderPrefs(); }

  function patchNotify(patch) { Store.setSettings({ notify: { ...Store.state.settings.notify, ...patch } }); }

  async function guarded(btn, fn) {
    if (btn) btn.disabled = true;
    try { await fn(); } catch (err) { console.warn('[DAYMATE] Notification action failed:', err); UI.toast(String((err && err.message) || 'Something went wrong.').slice(0, 120)); }
    finally { await renderPrefs(); }
  }

  DM.registerRoute('notifications', { render });
  DM.registerActions({
    'open-notify-prefs': () => openPrefs(),
    'notif-tab': (el) => { ui.tab = el.dataset.tab; DM.views.renderAll(); },
    'notif-filter': (el) => { ui.filter = el.dataset.filter; DM.views.renderAll(); },
    'read-notification': (el) => { const id = idOf(el); const n = id && Store.get('notifications', id); if (n && !n.readAt) Store.update('notifications', id, { readAt: now() }); },
    'dismiss-notification': (el) => { const id = idOf(el); if (id) Store.update('notifications', id, { dismissedAt: now(), readAt: Store.get('notifications', id).readAt || now() }); },
    'mark-all-read': () => { const t = now(); visible().filter((n) => !n.readAt).forEach((n) => Store.update('notifications', n.id, { readAt: t })); },
    'clear-all-notifications': () => {
      const t = now(); const ids = visible().map((n) => n.id);
      ids.forEach((id) => Store.update('notifications', id, { dismissedAt: t, readAt: Store.get('notifications', id).readAt || t }));
      UI.toast(`Cleared ${plural(ids.length, 'notification', 'notifications')}`, { action: { label: 'Undo', fn: () => ids.forEach((id) => Store.update('notifications', id, { dismissedAt: '' })) } });
    },
    'delete-history': async () => {
      const gone = Store.state.notifications.filter((n) => n.dismissedAt);
      if (!gone.length) return;
      if (await DM.confirmDialog({ title: 'Delete dismissed history?', message: `This permanently deletes ${plural(gone.length, 'dismissed notification', 'dismissed notifications')}.`, okLabel: 'Delete' })) gone.forEach((n) => Store.remove('notifications', n.id));
    },
    'enable-push': (el) => guarded(el, async () => {
      const r = await push.enable(DM);      // permission prompt happens here, from this tap, and nowhere else
      if (r.ok) UI.toast('Phone notifications are on');
      else if (r.reason === 'denied') UI.toast('Notifications are blocked for DAYMATE in your browser settings.');
      else UI.toast('No problem. Notifications stay off.');
    }),
    'disable-push': (el) => guarded(el, async () => { await push.disable(DM); UI.toast('Phone notifications are off'); }),
    'test-push': (el) => guarded(el, async () => {
      const r = await push.sendTest();
      UI.toast(r && r.sent > 0 ? `Test sent to ${plural(r.sent, 'device', 'devices')}. Did it arrive?` : 'The server has no registered device for you. Turn notifications off and on again.', { duration: 7000 });
    }),
  });

  const sheet = $('#m-notify');
  sheet.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.pref) { patchNotify({ [t.dataset.pref]: t.checked }); if (t.dataset.pref === 'morningSummary') renderPrefs(); }
    else if (t.id === 'leadSelect') patchNotify({ leadMinutes: [Number(t.value)] });
    else if (t.dataset.lead !== undefined) {
      const picked = $$('[data-lead]', sheet).filter((x) => x.checked).map((x) => Number(x.dataset.lead));
      if (!picked.length) { t.checked = true; UI.toast('Keep at least one reminder time.'); return; }
      if (picked.length > 4) { t.checked = false; UI.toast('You can choose up to 4.'); return; }
      patchNotify({ leadMinutes: picked });
    } else if (t.id === 'defaultTime') { if (helpers.isValidTime(t.value) && t.value) patchNotify({ defaultTime: t.value }); }
    else if (t.id === 'morningTime') { if (helpers.isValidTime(t.value) && t.value) patchNotify({ morningTime: t.value }); }
  });

  /* ---------------- wiring ---------------- */
  DM.onRender(renderBell);
  let lastGen = 0;
  const tick = () => { if (Date.now() - lastGen > 20000) { lastGen = Date.now(); generate(); } };
  DM.onRender(tick);
  setInterval(tick, 30000);                      // in-app centre only; phone notifications are server-scheduled
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  DM.views.renderAll();
}
