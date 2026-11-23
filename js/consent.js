/* ==========================================================================
   DAYMATE — privacy choices + Google Analytics 4 (consent first)

   • Nothing from Google is loaded until the person taps "Allow analytics".
   • Choosing "No thanks" (or doing nothing) means no analytics, ever, and no
     Google script is requested at all.
   • Only the screen name is sent (e.g. "/planner"). Never task titles, memory
     text, names, emails or account ids.
   • The choice can be changed at any time in Settings → Privacy.
   ========================================================================== */
import { CONFIG } from './config.js';

const KEY = 'daymate:consent';
const ID_RE = /^G-[A-Z0-9]{4,20}$/;
let loaded = false;

function read() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && typeof v.analytics === 'boolean' ? v : null; } catch (_) { return null; }
}
function write(analytics) {
  try { localStorage.setItem(KEY, JSON.stringify({ analytics, at: new Date().toISOString(), v: 1 })); } catch (_) { /* private mode: choice lasts this visit only */ }
  state = { analytics };
}
let state = read();

const measurementId = () => (ID_RE.test(CONFIG.ga4MeasurementId || '') ? CONFIG.ga4MeasurementId : '');

function pagePath() {
  const m = /^#\/([a-z]+)/.exec(window.location.hash);
  return `/${m ? m[1] : 'home'}`;
}
function sendPageView() {
  if (!loaded || typeof window.gtag !== 'function') return;
  window.gtag('event', 'page_view', { page_path: pagePath(), page_title: pagePath().slice(1) });
}

function startAnalytics() {
  const id = measurementId();
  if (!id || loaded) return;
  window[`ga-disable-${id}`] = false;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', id, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    cookie_flags: 'SameSite=Lax;Secure',
  });
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(s);
  loaded = true;
  sendPageView();
}

function stopAnalytics() {
  const id = measurementId();
  if (id) window[`ga-disable-${id}`] = true;
  // Remove Google's cookies for this site.
  const host = location.hostname;
  document.cookie.split(';').map((c) => c.trim().split('=')[0]).filter((n) => n === '_ga' || n.startsWith('_ga_') || n === '_gid').forEach((n) => {
    [host, `.${host}`, ''].forEach((d) => { document.cookie = `${n}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${d ? `; domain=${d}` : ''}`; });
  });
}

export function initConsent(DM) {
  const { UI, helpers } = DM;
  const { $, esc } = helpers;
  const available = Boolean(measurementId());

  function apply() { if (state && state.analytics) startAnalytics(); else stopAnalytics(); }

  function hideBanner() { const b = $('#consentBanner'); if (b) b.remove(); }

  function showBanner() {
    if (!available || state || $('#consentBanner')) return;
    const el = document.createElement('section');
    el.id = 'consentBanner';
    el.className = 'consent';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Privacy choices');
    el.innerHTML = `
      <h2>Help improve DAYMATE?</h2>
      <p>With your OK, we use Google Analytics to count which screens are used. It never sees your tasks, memories or name. You can change this any time in Settings.</p>
      <div class="consent__btns">
        <button type="button" class="btn btn--primary" data-consent="yes">Allow analytics</button>
        <button type="button" class="btn btn--ghost" data-consent="no">No thanks</button>
      </div>
      <a class="consent__link" href="privacy.html">Read the privacy policy</a>`;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-consent]');
      if (!b) return;
      write(b.dataset.consent === 'yes');
      apply();
      hideBanner();
    });
    document.body.appendChild(el);
  }

  function settingsRow() {
    const about = $('#settingsAbout');
    if (!about) return;
    let box = $('#privacyField');
    if (!box) {
      box = document.createElement('div');
      box.className = 'field';
      box.id = 'privacyField';
      about.parentNode.insertBefore(box, about);
    }
    const on = !!(state && state.analytics);
    box.innerHTML = `
      <span class="field__label">Privacy</span>
      ${available ? `
      <button type="button" class="row" data-action="toggle-analytics" role="switch" aria-checked="${on}">
        <span class="row__icon"><svg class="icon"><use href="#i-sliders"/></svg></span>
        <span class="row__text"><strong>Usage analytics: ${on ? 'On' : 'Off'}</strong><small>${on ? 'Tap to turn off' : 'Tap to allow anonymous screen counts'}</small></span>
      </button>` : ''}
      <a class="row" href="privacy.html">
        <span class="row__icon"><svg class="icon"><use href="#i-lock"/></svg></span>
        <span class="row__text"><strong>Privacy policy</strong><small>What DAYMATE stores and why</small></span>
      </a>`;
  }

  DM.registerActions({
    'toggle-analytics': () => {
      write(!(state && state.analytics));
      apply();
      settingsRow();
      UI.toast(state.analytics ? 'Analytics turned on' : 'Analytics turned off');
    },
  });
  DM.onSettingsOpen(settingsRow);
  window.addEventListener('hashchange', sendPageView);

  apply();
  // Wait until no sheet is open (e.g. the first-run welcome), so the banner never sits underneath one.
  const wait = setInterval(() => {
    if (state || !available) { clearInterval(wait); return; }
    if (!document.querySelector('.modal.is-open')) { clearInterval(wait); showBanner(); }
  }, 700);
}
