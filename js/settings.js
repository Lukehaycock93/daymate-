/* ==========================================================================
   DAYMATE — More: the settings hub
   Replaces the flat More list with a landing page + category pages (#/more/<page>, so the phone's Back button works).
   Every option that existed before is still here and still uses its original action. Only real, working
   settings appear: nothing decorative.
   ========================================================================== */
import { CONFIG } from './config.js';
import { getPref, setPref } from './prefs.js';
import { getThemePref, setThemePref } from './theme.js';
import { settingsHtml as weatherSettings, state as wx } from './weather.js';

const RELEASES = [
  ['0.9', 'Settings hub, weather on Home, Google and Apple Maps buttons for appointments, appointment locations the AI can read from pasted text.'],
  ['0.8', 'Location & weather settings (postcode or town). Daymate AI can answer weather questions.'],
  ['0.7', 'AI memory suggestions you approve before anything is saved (Premium).'],
  ['0.6', 'Daymate AI can add, move, tick off and delete things (with confirmation and Undo). Floating AI button, light and dark mode, richer Home screen.'],
  ['0.5', 'Premium subscriptions, lifetime access, daily limits, morning briefing notifications.'],
];
const FAQ = [
  ['Is my data private?', 'Your planner is saved on your device and, when you sign in, to your private account. Only you can read it. Daymate AI sends your message and your upcoming planner items to Google Gemini to answer; nothing is sent until you press Send.'],
  ['How do I get a phone alert?', 'Open More › Notifications › Notification settings and turn on phone alerts. On iPhone, add DAYMATE to your Home Screen first.'],
  ['Can the AI delete things by mistake?', 'It always asks you to confirm before deleting, and every change it makes has an Undo button.'],
  ['What does Premium add?', 'More Daymate AI messages a day, memory-aware suggestions, a 30-day view for the assistant and a morning briefing.'],
  ['How do I move to a new phone?', 'Sign in with the same account and your data syncs across. You can also download a backup from Data & Backup.'],
];

export function initSettingsHub(DM) {
  const { Store, Account } = DM;
  const { esc, icon, plural } = DM.helpers;
  const mail = CONFIG.contactEmail || '';

  const PAGES = {
    account:       { title: 'Account & Profile', icon: 'user', desc: 'Your name, sign-in and plan' },
    notifications: { title: 'Notifications', icon: 'bell', desc: 'Alerts, reminder times, morning summary' },
    ai:            { title: 'AI & Assistant', icon: 'sparkles', desc: 'Daymate AI, memory and what it can do' },
    weather:       { title: 'Weather & Location', icon: 'target', desc: 'Your location, units and Home card' },
    appearance:    { title: 'Appearance & Home', icon: 'grid', desc: 'Light or dark, and what Home shows' },
    privacy:       { title: 'Privacy & Permissions', icon: 'shield', desc: 'Analytics, permissions and your data' },
    data:          { title: 'Data & Backup', icon: 'download', desc: 'Sync status, backup and erasing data' },
    help:          { title: 'Help & About', icon: 'info', desc: 'FAQs, contact, version and what’s new' },
  };
  /* what search looks through */
  const INDEX = [
    ['account', 'Profile and name', 'name profile account sign in sign out email password plan premium subscription'],
    ['notifications', 'Notification settings', 'notification alert push reminder time lead morning summary briefing quiet'],
    ['notifications', 'Notification centre', 'notification centre history unread alerts'],
    ['ai', 'Daymate AI', 'ai assistant chat gemini confirm delete messages limit'],
    ['ai', 'Memory suggestions', 'memory remember suggest pause approve'],
    ['weather', 'Weather location', 'weather location postcode town city current location gps'],
    ['weather', 'Temperature unit', 'celsius fahrenheit temperature unit degrees'],
    ['appearance', 'Light and dark mode', 'theme appearance light dark auto system colour'],
    ['appearance', 'Home screen widgets', 'home screen widgets weather schedule shopping show hide customise'],
    ['privacy', 'Usage analytics', 'analytics privacy tracking consent'],
    ['privacy', 'Permissions', 'permissions location notifications camera privacy policy'],
    ['data', 'Download a backup', 'backup export download data save'],
    ['data', 'Erase all data', 'erase delete reset clear data'],
    ['data', 'Sync status', 'sync status cloud account offline'],
    ['help', 'Check for updates', 'update version check latest install'],
    ['help', 'Contact support', 'help support contact email feedback report problem bug'],
    ['help', 'What’s new', 'release notes changes new version'],
    ['help', 'Terms and privacy policy', 'terms privacy policy legal credits'],
  ];

  const hub = { q: '' };
  const page = () => { const m = /^#\/more\/([a-z]+)/.exec(window.location.hash); return m && PAGES[m[1]] ? m[1] : ''; };
  const go = (p) => { window.location.hash = p ? `#/more/${p}` : '#/more'; };

  const row = (o) => {
    const inner = `<span class="row__icon">${icon(o.icon || 'sliders')}</span><span class="row__text"><strong>${esc(o.title)}</strong>${o.sub ? `<small${o.subId ? ` id="${o.subId}"` : ''}>${esc(o.sub)}</small>` : ''}</span>${o.value ? `<span class="row__val">${esc(o.value)}</span>` : ''}${o.chev === false ? '' : icon('chevron', 'row__chev')}`;
    if (o.href) return `<a class="row${o.danger ? ' row--danger' : ''}" href="${esc(o.href)}"${o.ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${inner}</a>`;
    return `<button type="button" class="row${o.danger ? ' row--danger' : ''}" data-action="${esc(o.action)}"${o.attrs || ''}>${inner}</button>`;
  };
  const sw = (o) => `<button type="button" class="row sp-switch" role="switch" aria-checked="${o.on}" data-action="${esc(o.action)}"${o.attrs || ''}><span class="row__icon">${icon(o.icon || 'sliders')}</span><span class="row__text"><strong>${esc(o.title)}</strong>${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</span><span class="sw${o.on ? ' is-on' : ''}" aria-hidden="true"></span></button>`;

  const notify = () => Store.state.settings.notify || {};
  const notifyPerm = () => (typeof Notification === 'undefined' ? 'Not supported on this device' : Notification.permission === 'granted' ? 'Allowed' : Notification.permission === 'denied' ? 'Blocked in your phone settings' : 'Not asked yet');
  const analyticsOn = () => { try { const v = JSON.parse(localStorage.getItem('daymate:consent') || 'null'); return !!(v && v.analytics); } catch (_) { return false; } };
  let locPerm = '';
  try { if (navigator.permissions && navigator.permissions.query) navigator.permissions.query({ name: 'geolocation' }).then((r) => { locPerm = r.state === 'granted' ? 'Allowed' : r.state === 'denied' ? 'Blocked in your phone settings' : 'Asked when you use it'; r.onchange = () => { locPerm = r.state === 'granted' ? 'Allowed' : r.state === 'denied' ? 'Blocked in your phone settings' : 'Asked when you use it'; draw(); }; draw(); }).catch(() => {}); } catch (_) { /* not supported */ }

  /* ---------- the pages ---------- */
  const content = {
    account(info) {
      const name = Store.state.settings.name; const email = Account.user ? Account.user.email : '';
      return `<div class="rows">
        ${row({ action: 'open-settings', icon: 'user', title: name || 'Set up your profile', sub: email || 'Name, account and sign-out' })}
        ${Account.user ? '' : row({ action: 'open-auth', attrs: ' data-mode="signin"', icon: 'lock', title: 'Sign in or create an account', sub: 'Back up and use DAYMATE on every device' })}
        ${row({ action: 'open-premium', icon: 'sparkles', title: info.plan === 'premium' ? 'Your Premium plan' : 'DAYMATE Premium', sub: info.plan === 'premium' ? 'Manage or review your plan' : 'See what Premium includes', value: info.planLabel })}
      </div><p class="fine">${esc(info.syncLine)}</p>`;
    },
    notifications(info) {
      const n = notify(); const lead = (n.leadMinutes || [0]).map((m) => (m === 0 ? 'at the time' : m >= 1440 ? `${m / 1440} day${m === 1440 ? '' : 's'} before` : m >= 60 ? `${m / 60} hour${m === 60 ? '' : 's'} before` : `${m} min before`)).join(', ');
      return `<div class="rows">
        ${row({ href: '#/notifications', icon: 'bell', title: 'Notification centre', sub: info.unread ? plural(info.unread, 'unread alert', 'unread alerts') : 'Reminders, alerts and history' })}
        ${row({ action: 'open-notify-prefs', icon: 'sliders', title: 'Notification settings', sub: 'Phone alerts, reminder times, morning summary' })}
      </div>
      <h3 class="group-title">Right now</h3>
      <ul class="sp-facts"><li><span>Phone alerts</span><strong>${n.push ? 'On' : 'Off'}</strong></li><li><span>Phone permission</span><strong>${esc(notifyPerm())}</strong></li><li><span>Reminder times</span><strong>${esc(lead)}</strong></li><li><span>Morning summary</span><strong>${n.morningSummary ? `On, ${esc(n.morningTime || '08:00')}` : 'Off'}</strong></li></ul>`;
    },
    ai(info) {
      const paused = Store.state.settings.memoryPaused !== false;
      return `<div class="rows">
        ${row({ href: '#/assistant', icon: 'sparkles', title: 'Ask DAYMATE', sub: Account.user ? 'Your AI planning assistant' : 'Sign in to chat with your assistant' })}
        ${row({ href: '#/memory', icon: 'sparkles', title: 'Memory', sub: `${plural(Store.state.memories.length, 'thing', 'things')} remembered` })}
        ${sw({ action: 'hub-memory-suggest', on: !paused, icon: 'bolt', title: 'Memory suggestions', sub: info.plan === 'premium' ? (paused ? 'Off. Daymate AI won’t suggest memories.' : 'On. It asks before saving anything.') : 'Premium: the assistant suggests things to remember, you approve each one' })}
      </div>
      <h3 class="group-title">How the assistant behaves</h3>
      <ul class="sp-facts"><li><span>Deleting</span><strong>Always asks you first</strong></li><li><span>Adding with an address</span><strong>Asks you to confirm</strong></li><li><span>Every change</span><strong>Has an Undo</strong></li><li><span>Messages a day</span><strong>${info.plan === 'premium' ? '100 (Premium)' : '10 (Free)'}</strong></li></ul>`;
    },
    weather() { return weatherSettings(); },
    appearance() {
      const t = getThemePref();
      return `<h3 class="group-title">Colour</h3>
      <div class="seg" role="radiogroup" aria-label="Appearance">${[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<button type="button" class="seg__opt${t === v ? ' is-on' : ''}" role="radio" aria-checked="${t === v}" data-action="hub-theme" data-v="${v}"><span>${l}</span></button>`).join('')}</div>
      <p class="field__hint">Auto follows your phone’s light or dark setting.</p>
      <h3 class="group-title">Home screen</h3>
      <div class="rows">
        ${sw({ action: 'weather-toggle-home', on: getPref('showWeather'), icon: 'target', title: 'Weather', sub: 'Today’s forecast card' })}
        ${sw({ action: 'hub-pref', attrs: ' data-k="showSchedule"', on: getPref('showSchedule'), icon: 'calendar', title: 'Today’s schedule', sub: 'Timeline with “next up”' })}
        ${sw({ action: 'hub-pref', attrs: ' data-k="showShopping"', on: getPref('showShopping'), icon: 'basket', title: 'Shopping list overview', sub: 'What’s left to buy' })}
      </div>`;
    },
    privacy() {
      return `<div class="rows">
        ${CONFIG.ga4MeasurementId ? sw({ action: 'toggle-analytics', on: analyticsOn(), icon: 'chart', title: 'Usage analytics', sub: analyticsOn() ? 'On. Anonymous screen counts only.' : 'Off. Nothing is counted.' }) : ''}
        ${row({ href: 'privacy.html', icon: 'lock', title: 'Privacy policy', sub: 'What DAYMATE stores and why' })}
        ${row({ href: 'terms.html', icon: 'receipt', title: 'Terms of service' })}
      </div>
      <h3 class="group-title">Permissions</h3>
      <ul class="sp-facts"><li><span>Notifications</span><strong>${esc(notifyPerm())}</strong></li><li><span>Location (weather)</span><strong>${esc(locPerm || 'Asked when you use it')}</strong></li><li><span>Calendar</span><strong>Not connected</strong></li></ul>
      <h3 class="group-title">AI privacy</h3>
      <p class="fine">When you chat, DAYMATE sends your message and your upcoming tasks, appointments, reminders and shopping list to Google Gemini to answer. Memories marked Sensitive are never sent. While DAYMATE uses Google’s free developer tier, Google may use that content to improve its products, so don’t type anything you wouldn’t want read.</p>`;
    },
    data(info) {
      return `<p class="sync-line" role="status"><i class="sync-dot sync-dot--${esc(Account.user ? Account.syncState : 'local')}"></i>${esc(info.syncLine)}</p>
      <div class="rows">
        ${row({ action: 'export-data', icon: 'download', title: 'Download a backup', sub: 'Saves your tasks, reminders, memories and list as a file', chev: false })}
        ${row({ action: 'open-settings', icon: 'user', title: 'Account data', sub: 'Account, sign-out and erase options' })}
        ${row({ action: 'reset-data', icon: 'trash', title: 'Erase all data', sub: 'Removes everything on this device and in your account', danger: true, chev: false })}
      </div><p class="fine">Erasing always asks you to confirm first.</p>`;
    },
    help(info) {
      const subj = encodeURIComponent(`DAYMATE ${DM.APP.version} — problem report`);
      const body = encodeURIComponent(`What happened:\n\n\nWhat I expected:\n\n\n(Version ${DM.APP.version}, ${navigator.userAgent})`);
      return `<div class="rows">
        ${mail ? row({ href: `mailto:${mail}?subject=${encodeURIComponent('DAYMATE support')}`, ext: true, icon: 'mail', title: 'Contact support', sub: mail }) : ''}
        ${mail ? row({ href: `mailto:${mail}?subject=${subj}&body=${body}`, ext: true, icon: 'flag', title: 'Report a problem', sub: 'Opens an email with your version filled in' }) : ''}
        ${mail ? row({ href: `mailto:${mail}?subject=${encodeURIComponent('DAYMATE feedback')}`, ext: true, icon: 'sparkles', title: 'Send feedback', sub: 'Ideas and things you’d change' }) : ''}
        ${row({ action: 'check-updates', icon: 'repeat', title: 'Check for updates', subId: 'updateStatus', sub: info.updateReady ? 'An update is ready, tap to install' : `Version ${DM.APP.version} · tap to check`, chev: false })}
        ${info.standalone ? '' : row({ action: 'install-app', icon: 'device', title: 'Install DAYMATE', sub: 'Add it to your Home Screen like an app' })}
      </div>
      <h3 class="group-title">FAQs</h3>
      <div class="faq">${FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div>
      <h3 class="group-title">What’s new</h3>
      <ul class="sp-notes">${RELEASES.map(([v, t]) => `<li><strong>${esc(v)}</strong><span>${esc(t)}</span></li>`).join('')}</ul>
      <h3 class="group-title">About</h3>
      <ul class="sp-facts"><li><span>Version</span><strong>${esc(DM.APP.version)}</strong></li><li><span>Build</span><strong>Part ${esc(DM.APP.stage)}</strong></li></ul>
      <div class="rows">${row({ href: 'privacy.html', icon: 'lock', title: 'Privacy policy' })}${row({ href: 'terms.html', icon: 'receipt', title: 'Terms of service' })}</div>
      <p class="fine">Credits: weather by Open-Meteo, UK postcodes by postcodes.io, AI by Google Gemini, accounts and sync by Supabase, subscriptions by RevenueCat. Built by Luke at Nextgen Labs UK.</p>`;
    },
  };

  /* ---------- the landing page ---------- */
  function valueFor(key) {
    if (key === 'weather') return wx.loc ? wx.loc.name : 'Not set';
    if (key === 'appearance') return { auto: 'Auto', light: 'Light', dark: 'Dark' }[getThemePref()];
    if (key === 'notifications') return notify().push ? 'On' : 'Off';
    return '';
  }
  function searchResults() {
    const q = hub.q.trim().toLowerCase(); if (q.length < 2) return '';
    const hits = INDEX.filter(([, label, kw]) => `${label} ${kw}`.toLowerCase().includes(q));
    return `<div class="rows" role="status" aria-label="Search results">${hits.length ? hits.map(([p, label]) => `<a class="row" href="#/more/${p}"><span class="row__icon">${icon(PAGES[p].icon)}</span><span class="row__text"><strong>${esc(label)}</strong><small>${esc(PAGES[p].title)}</small></span>${icon('chevron', 'row__chev')}</a>`).join('') : '<p class="fine">No settings match that.</p>'}</div>`;
  }
  function landing(info) {
    const name = Store.state.settings.name; const email = Account.user ? Account.user.email : '';
    return `<div class="preview-wrap sp">
      <button type="button" class="card account" data-action="open-settings">
        <span class="account__avatar">${name ? esc(name.charAt(0).toUpperCase()) : icon('user')}</span>
        <span class="account__text"><strong>${name ? esc(name) : 'Set up your profile'}</strong><small>${email ? esc(email) : (name ? 'Profile & settings' : 'Add your name for a personal greeting')}</small></span>
        <span class="plan-tag">${esc(info.planLabel)}</span>
      </button>
      <p class="sync-line" role="status"><i class="sync-dot sync-dot--${esc(Account.user ? Account.syncState : 'local')}"></i>${esc(info.syncLine)}</p>
      ${Account.user ? '' : `<button type="button" class="row row--solo" data-action="open-auth" data-mode="signin"><span class="row__icon">${icon('lock')}</span><span class="row__text"><strong>Sign in or create an account</strong><small>Keep your data safe and use DAYMATE on every device</small></span>${icon('chevron', 'row__chev')}</button>`}
      <button type="button" class="promo" data-action="open-premium"><span class="promo__icon">${icon('sparkles')}</span><span class="promo__text"><strong>DAYMATE Premium</strong><small>${info.plan === 'premium' ? (Account.entitlement && Account.entitlement.source === 'lifetime' ? 'Lifetime Premium' : 'You have Premium') : 'Smarter AI, memory and morning briefings'}</small></span>${icon('chevron', 'promo__chev')}</button>

      <label class="sp-search"><span class="sr-only">Search settings</span>${icon('search')}<input id="hubSearch" type="search" placeholder="Search settings" value="${esc(hub.q)}" autocomplete="off" enterkeyhint="search"></label>
      <div id="hubResults">${searchResults()}</div>

      <h3 class="group-title">Your DAYMATE</h3>
      <div class="rows">
        ${row({ href: '#/notifications', icon: 'bell', title: 'Notification centre', sub: info.unread ? plural(info.unread, 'unread alert', 'unread alerts') : 'Reminders, alerts and history' })}
        ${row({ href: '#/assistant', icon: 'sparkles', title: 'Ask DAYMATE', sub: Account.user ? 'Your AI planning assistant' : 'Sign in to chat with your assistant' })}
        ${row({ href: '#/memory', icon: 'sparkles', title: 'Memory', sub: `${plural(Store.state.memories.length, 'thing', 'things')} remembered` })}
        ${row({ action: 'open-notify-prefs', icon: 'sliders', title: 'Notification settings', sub: 'Phone alerts, reminder times, morning summary' })}
      </div>

      <h3 class="group-title">Settings</h3>
      <div class="rows">${Object.entries(PAGES).map(([k, p]) => `<a class="row" href="#/more/${k}"><span class="row__icon">${icon(p.icon)}</span><span class="row__text"><strong>${esc(p.title)}</strong><small>${esc(p.desc)}</small></span>${valueFor(k) ? `<span class="row__val">${esc(valueFor(k))}</span>` : ''}${icon('chevron', 'row__chev')}</a>`).join('')}</div>

      <h3 class="group-title">App</h3>
      <div class="rows">
        ${info.standalone ? '' : row({ action: 'install-app', icon: 'device', title: 'Install DAYMATE', sub: 'Add it to your Home Screen like an app', chev: false })}
        ${row({ action: 'check-updates', icon: 'repeat', title: 'Check for updates', subId: 'updateStatus', sub: info.updateReady ? 'An update is ready, tap to install' : `Version ${DM.APP.version} · tap to check`, chev: false })}
        ${row({ action: 'export-data', icon: 'download', title: 'Download a backup', sub: 'Save your data as a file', chev: false })}
      </div>
      ${info.roadmap.length ? `<h3 class="group-title">What’s coming next</h3><ul class="features">${info.roadmap.map((r) => `<li class="feature"><span class="feature__icon">${icon(r.icon)}</span><span class="feature__text"><strong>${esc(r.title)}</strong><small>${esc(r.text)}</small></span><span class="feature__side"><span class="badge">Soon</span></span></li>`).join('')}</ul>` : ''}
      <p class="about"><strong>DAYMATE</strong><br>${esc(DM.APP.tagline)}<br>Version ${esc(DM.APP.version)} · Part ${esc(DM.APP.stage)}</p></div>`;
  }

  function subpage(p, info) {
    const meta = PAGES[p];
    return `<div class="preview-wrap sp"><div class="sp-head"><button type="button" class="icon-btn sp-back" data-action="hub-back" aria-label="Back to More">${icon('chevron')}</button><div><h2>${esc(meta.title)}</h2><p>${esc(meta.desc)}</p></div></div>
      <div class="sp-body" data-page="${p}">${content[p](info)}</div></div>`;
  }

  function draw() {
    const host = document.getElementById('view-more');
    if (!host || DM.route !== 'more') return;
    const info = DM.moreInfo(); const p = page();
    const scroll = window.scrollY;
    host.innerHTML = p ? subpage(p, info) : landing(info);
    if (!p && hub.q) { const i = document.getElementById('hubSearch'); if (i && document.activeElement !== i && hub.focus) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
    if (hub.keep) { window.scrollTo(0, scroll); hub.keep = false; }
  }

  DM.setMoreRenderer((host) => { if (host !== document.getElementById('view-more')) return false; draw(); return true; });
  window.addEventListener('hashchange', () => { if (DM.route === 'more') { hub.q = ''; draw(); window.scrollTo(0, 0); } });
  window.addEventListener('daymate:open-settings-page', (e) => { go(e.detail); });
  window.addEventListener('daymate:prefs', () => { if (DM.route === 'more') { hub.keep = true; draw(); } });
  document.addEventListener('input', (e) => {
    if (e.target && e.target.id === 'hubSearch') { hub.q = e.target.value; hub.focus = true; const r = document.getElementById('hubResults'); if (r) r.innerHTML = searchResults(); }
  });
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('[data-action="toggle-analytics"]')) setTimeout(() => { hub.keep = true; draw(); }, 50); });

  DM.registerActions({
    'hub-back': () => { if (window.history.length > 1) window.history.back(); else go(''); },
    'hub-theme': (el) => { setThemePref(el.dataset.v); hub.keep = true; draw(); },
    'hub-pref': (el) => { const k = el.dataset.k; if (k) setPref(k, !getPref(k)); },
    'hub-memory-suggest': () => { const paused = Store.state.settings.memoryPaused !== false; Store.setSettings({ memoryPaused: !paused }); DM.UI.toast(paused ? 'Memory suggestions on. You approve each one.' : 'Memory suggestions off'); hub.keep = true; draw(); },
  });
}
