// Browser tests: More settings hub + weather widget.   Run: node tests/hub_weather_test.js
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end('nf'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
const results = []; const ok = (n, c, d = '') => { results.push(c); console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + d}`); };
const days = Array.from({ length: 7 }, (_, i) => `2026-11-${String(27 + i > 30 ? 27 + i - 30 : 27 + i).padStart(2, '0')}`);
const FORECAST = { current: { time: '2026-11-27T10:00', temperature_2m: 7.4, apparent_temperature: 5.2, weather_code: 61, is_day: 1, wind_speed_10m: 12 },
  hourly: { time: Array.from({ length: 48 }, (_, i) => `2026-11-${i < 24 ? '27' : '28'}T${String(i % 24).padStart(2, '0')}:00`), temperature_2m: Array.from({ length: 48 }, (_, i) => 5 + (i % 5)), weather_code: Array.from({ length: 48 }, () => 61), precipitation_probability: Array.from({ length: 48 }, () => 60) },
  daily: { time: days, weather_code: [61, 3, 0, 2, 63, 71, 95], temperature_2m_max: [9, 8, 7, 6, 10, 2, 12], temperature_2m_min: [4, 3, 2, 1, 5, -2, 6], precipitation_probability_max: [80, 20, 5, 10, 90, 60, 70] } };

async function boot(browser, { geo = true, forecast = true, vp = { width: 390, height: 844 } } = {}) {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: vp.width < 700, ...(geo ? { geolocation: { latitude: 53.8123, longitude: -1.5791 }, permissions: ['geolocation'] } : {}) });
  const hits = { forecast: 0, urls: [] };
  await ctx.route(/supabase\.co|jsdelivr|googletagmanager|googlesyndication/, (r) => r.abort());
  await ctx.route(/api\.open-meteo\.com/, (r) => { hits.forecast++; hits.urls.push(r.request().url()); return forecast ? r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(FORECAST) }) : r.abort(); });
  await ctx.route(/api\.postcodes\.io/, (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ result: { outcode: 'LS6', admin_district: 'Leeds', country: 'England', latitude: 53.8123, longitude: -1.5791 } }) }));
  await ctx.route(/geocoding-api\.open-meteo\.com/, (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ results: [{ name: 'York', admin1: 'England', country: 'United Kingdom', latitude: 53.96, longitude: -1.08 }] }) }));
  await ctx.addInitScript(() => { try { localStorage.setItem('daymate:consent', JSON.stringify({ analytics: false })); } catch (_) {} });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base); await page.waitForFunction(() => window.DAYMATE);
  await page.fill('#welcomeName', 'Luke'); await page.click('#welcomeForm button[type=submit]'); await page.waitForTimeout(500);
  return { ctx, page, errors, hits };
}
let base;
(async () => {
  await new Promise((r) => server.listen(0, r)); base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();

  /* ---- weather: no location yet ---- */
  let { ctx, page, errors, hits } = await boot(browser);
  ok('home: prompt to set a location when none is set', /See today’s weather/.test(await page.textContent('.wxsec')) && !!(await page.$('.wxsec [data-action="weather-locate"]')));
  ok('home: no weather request before a location exists', hits.forecast === 0);
  /* ---- current location (permission granted) ---- */
  await page.click('.wxsec [data-action="weather-locate"]'); await page.waitForSelector('.wxcard__temp', { timeout: 5000 });
  ok('current location: card shows temperature + condition', /7°/.test(await page.textContent('.wxcard')) && /Light rain/.test(await page.textContent('.wxcard')));
  ok('current location: shows today’s high/low + summary', /H 9° · L 4°/.test(await page.textContent('.wxcard')) && /Take an umbrella/.test(await page.textContent('.wxcard')));
  ok('current location: uses rounded coordinates', /latitude=53\.81/.test(hits.urls[0]) && /longitude=-1\.58/.test(hits.urls[0]), hits.urls[0]);
  ok('card has an accessible label and an icon', /Weather for/.test(await page.getAttribute('.wxcard', 'aria-label')) && !!(await page.$('.wxcard .wxicon')));
  /* cache: no extra request within 30 minutes */
  const before = hits.forecast; await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await page.waitForTimeout(300);
  ok('refresh is throttled (no repeat request within 30 min)', hits.forecast === before);
  /* detail sheet */
  await page.click('.wxcard'); await page.waitForTimeout(300);
  const det = await page.textContent('#weatherDetail');
  ok('tap opens the detailed forecast (hourly + 7 days)', /Next 12 hours/.test(det) && /This week/.test(det) && (await page.$$('#weatherDetail .wxd__days li')).length === 7 && (await page.$$('#weatherDetail .wxd__hours li')).length === 12);
  await page.click('#m-weather .icon-btn[data-action="close-modal"]'); await page.waitForTimeout(300);
  /* units */
  await page.evaluate(() => { location.hash = '#/more/weather'; }); await page.waitForTimeout(300);
  ok('weather settings page has unit buttons', !!(await page.$('[data-action="weather-unit"][data-unit="f"]')));
  await page.click('[data-action="weather-unit"][data-unit="f"]'); await page.waitForTimeout(200);
  ok('Fahrenheit persists', (await page.evaluate(() => JSON.parse(localStorage.getItem('daymate:prefs')).tempUnit)) === 'f');
  await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForTimeout(300);
  ok('Fahrenheit shown on the card (7.4°C = 45°F)', /45°F|45°/.test(await page.textContent('.wxcard')) && /F/.test(await page.textContent('.wxcard__temp')));
  /* hide widget */
  await page.evaluate(() => { location.hash = '#/more/appearance'; }); await page.waitForTimeout(300);
  await page.click('[data-action="weather-toggle-home"]'); await page.waitForTimeout(200);
  await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForTimeout(300);
  ok('Home weather can be hidden', await page.isHidden('.wxsec'));
  await page.evaluate(() => { location.hash = '#/more/appearance'; }); await page.waitForTimeout(300);
  await page.click('[data-action="weather-toggle-home"]');
  /* manual postcode */
  await page.evaluate(() => { location.hash = '#/more/weather'; }); await page.waitForTimeout(300);
  await page.fill('#wxInput', 'ls6 1aa'); await page.click('[data-action="weather-search"]'); await page.waitForTimeout(400);
  ok('postcode search finds the area', /LS6, Leeds/.test(await page.textContent('.sp-body')));
  await page.click('[data-action="weather-pick"]'); await page.waitForTimeout(500);
  ok('manual location saved (area name, rounded position)', (await page.evaluate(() => JSON.parse(localStorage.getItem('daymate:weather-loc')))).name === 'LS6, Leeds');
  ok('postcode itself is never stored', !/1AA/i.test(await page.evaluate(() => localStorage.getItem('daymate:weather-loc'))));
  await page.fill('#wxInput', 'York'); await page.press('#wxInput', 'Enter'); await page.waitForTimeout(400);
  ok('town search + Enter key works', /York, England/.test(await page.textContent('.sp-body')));
  await page.click('[data-action="weather-pick"]'); await page.waitForTimeout(500);
  ok('picking a town switches the location', (await page.evaluate(() => JSON.parse(localStorage.getItem('daymate:weather-loc')))).name === 'York, England');
  await page.click('[data-action="weather-clear"]'); await page.waitForTimeout(300);
  ok('remove location clears it', (await page.evaluate(() => localStorage.getItem('daymate:weather-loc'))) === null);
  ok('no script errors (weather)', errors.length === 0, errors.join('|'));
  await ctx.close();

  /* ---- denied permission ---- */
  ({ ctx, page, errors } = await boot(browser, { geo: false }));
  await page.click('.wxsec [data-action="weather-locate"]'); await page.waitForTimeout(800);
  ok('denied location: friendly message + manual option', /blocked|couldn’t get|Enter a postcode/i.test(await page.textContent('.wxsec')) && !!(await page.$('.wxsec [data-action="weather-settings"]')));
  ok('denied location: nothing crashed', errors.length === 0, errors.join('|'));
  await ctx.close();

  /* ---- network error ---- */
  ({ ctx, page, errors } = await boot(browser, { forecast: false }));
  await page.evaluate(() => { localStorage.setItem('daymate:weather-loc', JSON.stringify({ name: 'Leeds', lat: 53.8, lon: -1.55, mode: 'manual' })); });
  await page.reload(); await page.waitForFunction(() => window.DAYMATE); await page.waitForTimeout(1200);
  ok('network error: "Weather unavailable" with a retry, app still works', /Weather unavailable/.test(await page.textContent('.wxsec')) && !!(await page.$('.wxsec [data-action="weather-refresh"]')) && await page.isVisible('#view-home'));
  ok('network error: no script errors', errors.length === 0, errors.join('|'));
  await ctx.close();

  /* ---- settings hub ---- */
  ({ ctx, page, errors } = await boot(browser));
  await page.evaluate(() => { location.hash = '#/more'; }); await page.waitForTimeout(400);
  const landing = await page.textContent('#view-more');
  for (const t of ['Account & Profile', 'Notifications', 'AI & Assistant', 'Weather & Location', 'Appearance & Home', 'Privacy & Permissions', 'Data & Backup', 'Help & About']) ok(`hub: category "${t}" listed`, landing.includes(t));
  for (const t of ['Notification centre', 'Ask DAYMATE', 'Memory', 'Check for updates', 'Download a backup', 'DAYMATE Premium', 'Set up your profile'].map((x) => x)) ok(`hub: existing option kept — ${t}`, landing.includes(t) || (t === 'Set up your profile' && /Luke/.test(landing)));
  ok('hub: sync status line kept', !!(await page.$('#view-more .sync-line')));
  const pages = { account: 'open-settings', notifications: 'open-notify-prefs', ai: 'hub-memory-suggest', weather: 'weather-locate', appearance: 'hub-theme', privacy: 'Privacy policy', data: 'export-data', help: 'Contact support' };
  for (const [p, needle] of Object.entries(pages)) {
    await page.evaluate((p) => { location.hash = '#/more/' + p; }, p); await page.waitForTimeout(250);
    const html = await page.innerHTML('#view-more');
    ok(`hub page "${p}" renders with a back button and its controls`, html.includes(needle) && !!(await page.$('#view-more .sp-back')) && (await page.textContent('#view-more h2')).length > 3);
  }
  await page.evaluate(() => { location.hash = '#/more/data'; }); await page.waitForTimeout(250);
  ok('data page keeps Erase all data', !!(await page.$('#view-more [data-action="reset-data"]')));
  await page.evaluate(() => { location.hash = '#/more/notifications'; }); await page.waitForTimeout(250);
  await page.click('#view-more [data-action="open-notify-prefs"]'); await page.waitForTimeout(400);
  ok('Notification settings still open the original sheet', await page.isVisible('#m-notify'));
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  await page.evaluate(() => { location.hash = '#/more/account'; }); await page.waitForTimeout(250);
  await page.click('#view-more [data-action="open-settings"]'); await page.waitForTimeout(400);
  ok('Profile still opens the original settings sheet (name, account, backup)', await page.isVisible('#m-settings') && (await page.inputValue('#settingsName')) === 'Luke');
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  /* appearance persistence */
  await page.evaluate(() => { location.hash = '#/more/appearance'; }); await page.waitForTimeout(250);
  await page.click('[data-action="hub-theme"][data-v="light"]'); await page.waitForTimeout(200);
  ok('theme: Light applies and persists', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light' && (await page.evaluate(() => localStorage.getItem('daymate:theme'))) === 'light');
  await page.click('[data-action="hub-theme"][data-v="dark"]'); await page.waitForTimeout(200);
  ok('theme: Dark applies', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
  await page.click('[data-action="hub-pref"][data-k="showSchedule"]'); await page.waitForTimeout(200);
  await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForTimeout(300);
  ok('Home: Today’s schedule can be hidden', await page.isHidden('[aria-labelledby="schedHeading"]'));
  await page.evaluate(() => { location.hash = '#/more/appearance'; }); await page.waitForTimeout(250);
  await page.click('[data-action="hub-pref"][data-k="showSchedule"]');
  /* memory suggestion switch writes the real setting */
  await page.evaluate(() => { location.hash = '#/more/ai'; }); await page.waitForTimeout(250);
  const was = await page.evaluate(() => DAYMATE.Store.state.settings.memoryPaused);
  await page.click('[data-action="hub-memory-suggest"]'); await page.waitForTimeout(200);
  ok('memory-suggestions switch flips the real setting', (await page.evaluate(() => DAYMATE.Store.state.settings.memoryPaused)) === !was);
  /* search */
  await page.evaluate(() => { location.hash = '#/more'; }); await page.waitForTimeout(300);
  await page.fill('#hubSearch', 'fahrenheit'); await page.waitForTimeout(200);
  ok('search finds Temperature unit', /Temperature unit/.test(await page.textContent('#hubResults')));
  await page.fill('#hubSearch', 'zzzzqq'); await page.waitForTimeout(200);
  ok('search: nothing found message', /No settings match/.test(await page.textContent('#hubResults')));
  /* back navigation */
  await page.fill('#hubSearch', ''); await page.click('a[href="#/more/help"]'); await page.waitForTimeout(250);
  await page.click('[data-action="hub-back"]'); await page.waitForTimeout(300);
  ok('Back returns to the settings list', !!(await page.$('#view-more .promo')) && !(await page.$('#view-more .sp-back')));
  ok('no script errors (hub)', errors.length === 0, errors.join('|'));
  await ctx.close();

  /* ---- desktop layout ---- */
  ({ ctx, page, errors } = await boot(browser, { vp: { width: 1280, height: 800 } }));
  await page.evaluate(() => { location.hash = '#/more'; }); await page.waitForTimeout(400);
  ok('desktop: hub renders without horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForTimeout(300);
  ok('desktop: weather card fits', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  ok('desktop: no script errors', errors.length === 0, errors.join('|'));
  await ctx.close();

  await browser.close(); server.close();
  const bad = results.filter((r) => !r).length; console.log(bad ? `${bad} FAILED` : `${results.length}/${results.length} passed`); process.exit(bad ? 1 : 0);
})();
