/* ==========================================================================
   DAYMATE — Weather
   • Home-screen weather card (tap for the full forecast)
   • One place that owns the weather location: current location (with permission) or a postcode / town
   • Data: Open-Meteo (free, no key). Postcodes: postcodes.io (free, UK). Towns: Open-Meteo geocoding.
   • Fetches at most once every 30 minutes (and only while the app is visible); results are cached on the device.
   • Signed-in people also have their (rounded) location saved to their account so Daymate AI can answer weather questions.
   ========================================================================== */
import { session } from './session.js';
import { getPref, setPref } from './prefs.js';

const LOC_KEY = 'daymate:weather-loc';
const CACHE_KEY = 'daymate:weather-cache';
const STALE_MS = 30 * 60 * 1000;
const UK_POSTCODE = /^[A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[A-Za-z]{2}$/;
const r2 = (n) => Math.round(n * 100) / 100;

const COND = {
  0: ['Clear', 'sun'], 1: ['Mostly clear', 'sun'], 2: ['Partly cloudy', 'partly'], 3: ['Overcast', 'cloud'], 45: ['Fog', 'fog'], 48: ['Fog', 'fog'],
  51: ['Light drizzle', 'rain'], 53: ['Drizzle', 'rain'], 55: ['Heavy drizzle', 'rain'], 56: ['Freezing drizzle', 'rain'], 57: ['Freezing drizzle', 'rain'],
  61: ['Light rain', 'rain'], 63: ['Rain', 'rain'], 65: ['Heavy rain', 'rain'], 66: ['Freezing rain', 'rain'], 67: ['Freezing rain', 'rain'],
  71: ['Light snow', 'snow'], 73: ['Snow', 'snow'], 75: ['Heavy snow', 'snow'], 77: ['Snow grains', 'snow'],
  80: ['Light showers', 'rain'], 81: ['Showers', 'rain'], 82: ['Heavy showers', 'rain'], 85: ['Snow showers', 'snow'], 86: ['Snow showers', 'snow'],
  95: ['Thunderstorm', 'storm'], 96: ['Thunderstorm', 'storm'], 99: ['Thunderstorm', 'storm'],
};
export const condition = (code) => COND[code] || ['Mixed', 'cloud'];

/* ---------- pure helpers (unit-tested) ---------- */
export const toUnit = (c, unit) => Math.round(unit === 'f' ? (c * 9) / 5 + 32 : c);
export const fmtTemp = (c, unit) => `${toUnit(c, unit)}°`;
/** One friendly sentence for today. `d` is the Open-Meteo daily block, index 0 = today. */
export function summary(d, unit) {
  if (!d || !d.time || !d.time.length) return '';
  const [label] = condition(d.weather_code[0]);
  const hi = d.temperature_2m_max[0], lo = d.temperature_2m_min[0], rain = d.precipitation_probability_max ? d.precipitation_probability_max[0] : null;
  let tip = '';
  const code = d.weather_code[0];
  if ((rain != null && rain >= 50) || [95, 96, 99].includes(code)) tip = ' Take an umbrella.';
  else if ([71, 73, 75, 77, 85, 86].includes(code)) tip = ' Wrap up warm.';
  else if (lo <= 2) tip = ' Cold start, so wrap up.';
  else if (hi >= 25) tip = ' A warm one.';
  return `${label} today, ${toUnit(lo, unit)}–${toUnit(hi, unit)}°${unit === 'f' ? 'F' : 'C'}.${tip}`;
}
export const isUkPostcode = (s) => UK_POSTCODE.test(String(s || '').trim());
export const forecastUrl = (lat, lon) => `https://api.open-meteo.com/v1/forecast?${new URLSearchParams({
  latitude: String(lat), longitude: String(lon), timezone: 'auto', forecast_days: '7', wind_speed_unit: 'mph',
  current: 'temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m',
  hourly: 'temperature_2m,weather_code,precipitation_probability',
  daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
})}`;
/** Next `n` hours from the hourly block, starting at the current hour (location time, as returned by the API). */
export function nextHours(j, n = 12) {
  if (!j || !j.hourly || !j.hourly.time || !j.current) return [];
  const nowKey = String(j.current.time || '').slice(0, 13);
  let i = j.hourly.time.findIndex((t) => String(t).slice(0, 13) >= nowKey); if (i < 0) i = 0;
  const out = [];
  for (let k = i; k < Math.min(i + n, j.hourly.time.length); k++) out.push({ time: String(j.hourly.time[k]).slice(11, 16), temp: j.hourly.temperature_2m[k], code: j.hourly.weather_code[k], rain: j.hourly.precipitation_probability ? j.hourly.precipitation_probability[k] : null });
  return out;
}

/* ---------- icons ---------- */
const S = 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
const CLOUD = '<path d="M7 18h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7.2 9.2 4.4 4.4 0 0 0 7 18z"/>';
export function wxIcon(code, isDay = 1) {
  const kind = condition(code)[1];
  const sun = '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>';
  const moon = '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>';
  const body = {
    sun: isDay ? sun : moon,
    partly: `<path d="M8 8.5V7M4.3 9.8 3 8.5M12 9.8l1.3-1.3M3.5 14H2" /><circle cx="8" cy="12" r="2.6"/><path d="M9.5 20h8a3.5 3.5 0 0 0 .5-6.96A4.6 4.6 0 0 0 9.4 14 3 3 0 0 0 9.5 20z"/>`,
    cloud: CLOUD,
    fog: `<path d="M7 14h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7.2 5.2 4.4 4.4 0 0 0 7 14z"/><path d="M5 18h14M8 21h8"/>`,
    rain: `<path d="M7 15h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7.2 6.2 4.4 4.4 0 0 0 7 15z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>`,
    snow: `<path d="M7 15h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7.2 6.2 4.4 4.4 0 0 0 7 15z"/><path d="M8 18.5h.01M12 18.5h.01M16 18.5h.01M10 21h.01M14 21h.01"/>`,
    storm: `<path d="M7 14h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7.2 5.2 4.4 4.4 0 0 0 7 14z"/><path d="m12 14-2 4h3l-1 3"/>`,
  }[kind];
  return `<svg class="wxicon" viewBox="0 0 24 24" ${S} aria-hidden="true">${body}</svg>`;
}

/* ---------- state ---------- */
const st = { loc: null, data: null, at: 0, status: 'idle', error: '', denied: false, busy: false, results: null, msg: '' };

function loadLoc() { try { const j = JSON.parse(localStorage.getItem(LOC_KEY) || 'null'); if (j && typeof j.lat === 'number' && typeof j.lon === 'number') st.loc = j; } catch (_) { /* none */ } }
function saveLoc(loc) { st.loc = loc; try { if (loc) localStorage.setItem(LOC_KEY, JSON.stringify(loc)); else localStorage.removeItem(LOC_KEY); } catch (_) { /* ok */ } }
function loadCache() {
  try {
    const j = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (j && j.data && j.key === keyOf(st.loc)) { st.data = j.data; st.at = j.at; st.status = 'ready'; }
  } catch (_) { /* none */ }
}
const keyOf = (loc) => (loc ? `${loc.lat},${loc.lon}` : '');

let DM = null; let redraw = () => {};

export async function refresh(force = false) {
  if (!st.loc || st.busy) return;
  if (!force && st.data && Date.now() - st.at < STALE_MS) return;
  if (document.hidden && st.data) return;
  st.busy = true; if (!st.data) st.status = 'loading'; redraw();
  try {
    const r = await fetch(forecastUrl(st.loc.lat, st.loc.lon));
    if (!r.ok) throw new Error(`weather ${r.status}`);
    const j = await r.json();
    if (!j || !j.current || !j.daily) throw new Error('bad data');
    st.data = j; st.at = Date.now(); st.status = 'ready'; st.error = '';
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ key: keyOf(st.loc), at: st.at, data: j })); } catch (_) { /* too big or blocked */ }
  } catch (e) {
    st.error = navigator.onLine ? 'Weather isn’t available right now.' : 'You’re offline.';
    if (!st.data) st.status = 'error';
  }
  st.busy = false; redraw();
}

async function syncToAccount(loc) {
  try {
    if (!session.user || !session.client) return;
    await session.client.from('user_preferences').update(loc
      ? { home_name: loc.name.slice(0, 80), home_lat: loc.lat, home_lon: loc.lon }
      : { home_name: null, home_lat: null, home_lon: null }).eq('user_id', session.user.id);
  } catch (_) { /* the device copy still works */ }
}
let pulled = '';
async function pullFromAccount() {
  if (!session.user || !session.client || pulled === session.user.id) return;
  pulled = session.user.id;
  if (st.loc) { syncToAccount(st.loc); return; }                     // this device already has one: keep the account in step
  try {
    const { data } = await session.client.from('user_preferences').select('home_name,home_lat,home_lon').eq('user_id', session.user.id).maybeSingle();
    if (data && data.home_name && typeof data.home_lat === 'number') { saveLoc({ name: data.home_name, lat: data.home_lat, lon: data.home_lon, mode: 'manual' }); loadCache(); refresh(true); redraw(); }
  } catch (_) { /* ignore */ }
}

export async function setLocation(loc) {
  saveLoc(loc); st.data = null; st.status = loc ? 'loading' : 'idle'; st.results = null; st.msg = ''; st.denied = false;
  try { localStorage.removeItem(CACHE_KEY); } catch (_) { /* ok */ }
  redraw(); syncToAccount(loc); if (loc) await refresh(true);
}

export function useCurrentLocation() {
  if (!navigator.geolocation) { st.msg = 'This device can’t share its location. Enter a postcode or town instead.'; redraw(); return; }
  st.msg = 'Finding your location…'; st.busy = true; redraw();
  navigator.geolocation.getCurrentPosition(
    (pos) => { st.busy = false; setLocation({ name: 'Current location', lat: r2(pos.coords.latitude), lon: r2(pos.coords.longitude), mode: 'auto' }); },
    (err) => {
      st.busy = false; st.denied = err && err.code === 1;
      st.msg = st.denied ? 'Location is blocked for DAYMATE. You can allow it in your phone or browser settings, or enter a postcode or town instead.' : 'Couldn’t get your location. Try again, or enter a postcode or town.';
      redraw();
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60 * 1000 });
}

export async function search(q) {
  q = String(q || '').trim();
  if (q.length < 2) return;
  st.msg = 'Searching…'; st.results = null; redraw();
  try {
    if (isUkPostcode(q)) {
      const r = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(q.replace(/\s+/g, ''))}`); const j = await r.json(); const x = j && j.result;
      st.results = x && x.latitude != null ? [{ name: [x.outcode, x.admin_district].filter(Boolean).join(', '), sub: x.country || 'United Kingdom', lat: r2(x.latitude), lon: r2(x.longitude) }] : [];
      st.msg = st.results.length ? 'Is this you?' : 'I couldn’t find that postcode. Check it, or try your town.';
    } else {
      const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`); const j = await r.json();
      st.results = (j.results || []).map((x) => ({ name: [x.name, x.admin1].filter((v, i, a) => v && a.indexOf(v) === i).join(', '), sub: x.country || '', lat: r2(x.latitude), lon: r2(x.longitude) }));
      st.msg = st.results.length ? 'Pick your town:' : 'No town found. Try another spelling or a postcode.';
    }
  } catch (_) { st.msg = navigator.onLine ? 'Couldn’t search just now. Try again.' : 'You’re offline.'; }
  redraw();
}

/* ---------- rendering ---------- */
let esc = (v) => String(v ?? ''); let icon = () => '';
const unit = () => getPref('tempUnit');
const hhmm = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const dayName = (t, i) => (i === 0 ? 'Today' : new Date(`${t}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' }));

function cardHtml() {
  const j = st.data;
  if (!st.loc) {
    return `<div class="card wxcard wxcard--empty"><span class="wxcard__ico">${wxIcon(2)}</span>
      <div class="wxcard__txt"><strong>See today’s weather</strong><small>${esc(st.msg || 'Add your location to see it here and let Daymate AI plan around it.')}</small></div>
      <div class="wxcard__btns"><button type="button" class="btn btn--primary btn--sm" data-action="weather-locate">Use my location</button><button type="button" class="btn btn--ghost btn--sm" data-action="weather-settings">Enter a postcode</button></div></div>`;
  }
  if (!j && st.status === 'loading') return `<div class="card wxcard wxcard--loading" aria-busy="true" role="status"><span class="wxcard__skel"></span><div class="wxcard__txt"><i class="skel skel--a"></i><i class="skel skel--b"></i></div></div>`;
  if (!j) return `<div class="card wxcard wxcard--empty"><span class="wxcard__ico">${wxIcon(3)}</span><div class="wxcard__txt"><strong>Weather unavailable</strong><small>${esc(st.error || 'Couldn’t load the weather.')}</small></div><div class="wxcard__btns"><button type="button" class="btn btn--ghost btn--sm" data-action="weather-refresh">Try again</button></div></div>`;
  const u = unit(); const c = j.current; const [label] = condition(c.weather_code);
  return `<button type="button" class="card wxcard" data-action="weather-open" aria-label="Weather for ${esc(st.loc.name)}: ${toUnit(c.temperature_2m, u)} degrees, ${esc(label)}. Open forecast">
      <span class="wxcard__ico">${wxIcon(c.weather_code, c.is_day)}</span>
      <span class="wxcard__main"><span class="wxcard__temp">${fmtTemp(c.temperature_2m, u)}<small>${u === 'f' ? 'F' : 'C'}</small></span><span class="wxcard__cond">${esc(label)}</span></span>
      <span class="wxcard__side"><span class="wxcard__loc">${icon('pin')}${esc(st.loc.name)}</span><span class="wxcard__hl">H ${fmtTemp(j.daily.temperature_2m_max[0], u)} · L ${fmtTemp(j.daily.temperature_2m_min[0], u)}</span></span>
      <span class="wxcard__sum">${esc(summary(j.daily, u))}</span></button>`;
}

function detailHtml() {
  const j = st.data; if (!j || !st.loc) return '<p class="fine">No forecast yet.</p>';
  const u = unit(); const c = j.current; const [label] = condition(c.weather_code);
  const hours = nextHours(j, 12).map((h, i) => `<li><span>${i === 0 ? 'Now' : esc(h.time)}</span>${wxIcon(h.code, 1)}<strong>${fmtTemp(h.temp, u)}</strong>${h.rain != null && h.rain >= 20 ? `<small>${h.rain}%</small>` : '<small>&nbsp;</small>'}</li>`).join('');
  const days = j.daily.time.map((t, i) => `<li><span>${esc(dayName(t, i))}</span>${wxIcon(j.daily.weather_code[i], 1)}<span class="wxd__cond">${esc(condition(j.daily.weather_code[i])[0])}</span><small>${j.daily.precipitation_probability_max && j.daily.precipitation_probability_max[i] != null ? `${j.daily.precipitation_probability_max[i]}%` : ''}</small><strong>${toUnit(j.daily.temperature_2m_min[i], u)}–${toUnit(j.daily.temperature_2m_max[i], u)}°</strong></li>`).join('');
  return `<div class="wxd__now">${wxIcon(c.weather_code, c.is_day)}<div><strong class="wxd__temp">${fmtTemp(c.temperature_2m, u)}${u === 'f' ? 'F' : 'C'}</strong><span>${esc(label)} · feels like ${fmtTemp(c.apparent_temperature, u)} · wind ${Math.round(c.wind_speed_10m)} mph</span></div></div>
    <p class="wxd__sum">${esc(summary(j.daily, u))}</p>
    <h3 class="group-title">Next 12 hours</h3><ul class="wxd__hours">${hours}</ul>
    <h3 class="group-title">This week</h3><ul class="wxd__days">${days}</ul>
    <p class="fine">${esc(st.loc.name)} · updated ${esc(hhmm(st.at))} · forecast from Open-Meteo</p>
    <div class="wxd__btns"><button type="button" class="btn btn--ghost" data-action="weather-refresh">Refresh</button><button type="button" class="btn btn--ghost" data-action="weather-settings">Weather settings</button></div>`;
}

/** The Weather page inside More › Settings. */
export function settingsHtml() {
  const u = unit(); const perm = st.denied ? 'Location is blocked. Allow it in your phone or browser settings to use it.' : '';
  return `
    <div class="sp-block"><h3 class="group-title">Location</h3>
      <p class="sp-line"><strong>${st.loc ? esc(st.loc.name) : 'Not set'}</strong><small>${st.loc ? (st.loc.mode === 'auto' ? 'Using your current location' : 'Chosen by you') : 'Pick a location to show the weather'}</small></p>
      <div class="rows"><button type="button" class="row" data-action="weather-locate"><span class="row__icon">${icon('target')}</span><span class="row__text"><strong>Use my current location</strong><small>Asks your phone for permission. Only a rounded position is kept.</small></span></button></div>
      <div class="ai-home"><input class="input" id="wxInput" type="text" maxlength="60" placeholder="Postcode or town, e.g. LS6 1AA" autocomplete="postal-code" enterkeyhint="search" aria-label="Postcode or town"><button type="button" class="btn btn--ghost btn--sm" data-action="weather-search">Find</button></div>
      ${st.msg || perm ? `<p class="field__hint" role="status">${esc(st.msg || perm)}</p>` : '<p class="field__hint">Only the area name and a rounded map position are saved, never your full postcode.</p>'}
      ${st.results ? `<ul class="ai-home__list">${st.results.map((r, i) => `<li><button type="button" class="row" data-action="weather-pick" data-i="${i}"><span class="row__text"><strong>${esc(r.name)}</strong><small>${esc(r.sub)}</small></span></button></li>`).join('')}</ul>` : ''}
      ${st.loc ? '<button type="button" class="link-btn" data-action="weather-clear">Remove my location</button>' : ''}
    </div>
    <div class="sp-block"><h3 class="group-title">Display</h3>
      <div class="seg" role="radiogroup" aria-label="Temperature unit">
        <button type="button" class="seg__opt${u === 'c' ? ' is-on' : ''}" role="radio" aria-checked="${u === 'c'}" data-action="weather-unit" data-unit="c"><span>°C Celsius</span></button>
        <button type="button" class="seg__opt${u === 'f' ? ' is-on' : ''}" role="radio" aria-checked="${u === 'f'}" data-action="weather-unit" data-unit="f"><span>°F Fahrenheit</span></button>
      </div>
      <button type="button" class="row sp-switch" role="switch" aria-checked="${getPref('showWeather')}" data-action="weather-toggle-home"><span class="row__text"><strong>Show weather on Home</strong><small>${getPref('showWeather') ? 'On' : 'Off'}</small></span><span class="sw${getPref('showWeather') ? ' is-on' : ''}" aria-hidden="true"></span></button>
    </div>
    ${st.data ? `<div class="sp-block"><h3 class="group-title">Right now</h3>${cardHtml().replace('data-action="weather-open"', 'data-action="weather-open"')}</div>` : ''}`;
}

export const state = st;

export function initWeather(dm) {
  DM = dm; esc = dm.helpers.esc; icon = dm.helpers.icon;
  loadLoc(); loadCache();
  const home = document.getElementById('view-home'); if (!home) return;
  const widget = document.createElement('section'); widget.className = 'section wxsec'; widget.setAttribute('aria-label', 'Weather');
  const anchor = home.querySelector('.quick') || home.querySelector('.askbar');
  if (!anchor) return;
  anchor.before(widget);

  const draw = () => {
    widget.hidden = !getPref('showWeather');
    if (!widget.hidden) widget.innerHTML = cardHtml();
    const det = document.getElementById('weatherDetail'); if (det && document.getElementById('m-weather') && !document.getElementById('m-weather').hidden) det.innerHTML = detailHtml();
  };
  redraw = () => { try { DM.views.renderAll(); } catch (_) { /* ignore */ } };
  DM.onRender(draw); draw();

  DM.registerActions({
    'weather-open': () => { const det = document.getElementById('weatherDetail'); if (det) { det.innerHTML = detailHtml(); DM.Modal.open('m-weather'); } refresh(); },
    'weather-refresh': () => refresh(true),
    'weather-locate': () => useCurrentLocation(),
    'weather-search': () => search((document.getElementById('wxInput') || {}).value),
    'weather-pick': (el) => { const r = st.results && st.results[Number(el.dataset.i)]; if (r) setLocation({ name: r.name.slice(0, 80), lat: r.lat, lon: r.lon, mode: 'manual' }); },
    'weather-clear': () => setLocation(null),
    'weather-unit': (el) => { setPref('tempUnit', el.dataset.unit === 'f' ? 'f' : 'c'); redraw(); },
    'weather-toggle-home': () => { setPref('showWeather', !getPref('showWeather')); redraw(); },
    'weather-settings': () => { DM.Modal.close('m-weather'); window.dispatchEvent(new CustomEvent('daymate:open-settings-page', { detail: 'weather' })); },
  });
  window.addEventListener('daymate:prefs', draw);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('online', () => refresh());
  setInterval(() => { if (!document.hidden) refresh(); }, 10 * 60 * 1000);
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target && e.target.id === 'wxInput') { e.preventDefault(); search(e.target.value); } });
  DM.onRender(() => { pullFromAccount(); });
  if (st.loc) refresh();
}
