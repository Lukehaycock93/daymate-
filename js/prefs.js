/* DAYMATE — small per-device preferences (home screen widgets, weather units…).
   Kept in localStorage so they work signed out and never touch the synced settings. */
const KEY = 'daymate:prefs';
const DEFAULTS = { showWeather: true, showSchedule: true, showShopping: true, tempUnit: 'c' };

const mem = {};   // keeps choices working when storage is blocked
function read() {
  let j = {};
  try { j = JSON.parse(localStorage.getItem(KEY) || '{}'); if (!j || typeof j !== 'object') j = {}; } catch (_) { j = {}; }
  return { ...j, ...mem };
}
export function getPref(key) {
  const v = read()[key];
  const d = DEFAULTS[key];
  if (typeof d === 'boolean') return typeof v === 'boolean' ? v : d;
  if (key === 'tempUnit') return v === 'f' ? 'f' : 'c';
  return v === undefined ? d : v;
}
export function setPref(key, value) {
  mem[key] = value; const all = read();
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (_) { /* storage blocked: the choice lasts until reload */ }
  window.dispatchEvent(new CustomEvent('daymate:prefs', { detail: { key, value } }));
}
