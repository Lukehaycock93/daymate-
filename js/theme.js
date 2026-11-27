/* ==========================================================================
   DAYMATE — appearance (Auto / Light / Dark)
   The choice lives on this device only (localStorage). An inline script in index.html applies it
   before the first paint so there's no flash; this module keeps it in step with the phone's setting
   and the Settings control.
   ========================================================================== */
const KEY = 'daymate:theme';
const COLORS = { light: '#f3f6fc', dark: '#0a1230' };
const read = () => { try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'auto'; } catch (_) { return 'auto'; } };
const write = (v) => { try { localStorage.setItem(KEY, v); } catch (_) { /* applies for this visit only */ } };
const prefersLight = () => !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
export const resolve = (pref) => (pref === 'light' || (pref === 'auto' && prefersLight()) ? 'light' : 'dark');

export function applyTheme(pref = read()) {
  const t = resolve(pref);
  document.documentElement.dataset.theme = t;
  document.documentElement.dataset.themePref = pref;
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', COLORS[t]);
  const cs = document.querySelector('meta[name="color-scheme"]'); if (cs) cs.setAttribute('content', t);
  return t;
}

export function initTheme(DM) {
  applyTheme();
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => { if (read() === 'auto') applyTheme('auto'); };
    if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
  }
  const radios = () => [...document.querySelectorAll('#themeSeg input[name="theme"]')];
  const show = () => { const v = read(); radios().forEach((r) => { r.checked = r.value === v; }); };
  document.addEventListener('change', (e) => {
    if (e.target && e.target.name === 'theme' && e.target.closest('#themeSeg')) { write(e.target.value); applyTheme(e.target.value); }
  });
  if (DM && DM.onSettingsOpen) DM.onSettingsOpen(show);
  show();
}

export const getThemePref = read;
export const setThemePref = (v) => { const t = v === 'light' || v === 'dark' ? v : 'auto'; write(t); applyTheme(t); };
