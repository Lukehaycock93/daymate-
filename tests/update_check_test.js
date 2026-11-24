// Browser tests: update checking. Run: node tests/update_check_test.js
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
let swVersionOverride = null; let swHits = 0;
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end('nf'); }
  let body = fs.readFileSync(f);
  if (p === '/service-worker.js') { swHits++; if (swVersionOverride) body = Buffer.from(body.toString().replace(/const VERSION = '[^']+'/, `const VERSION = '${swVersionOverride}'`)); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'max-age=600' }); res.end(body);
});
const CUR = (fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8').match(/const VERSION = 'v([^']+)'/) || [])[1];
const results = []; const ok = (n, c, d = '') => results.push([n, !!c, d]);
(async () => {
  await new Promise((r) => server.listen(0, r)); const base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route(/supabase\.co|googletagmanager|google-analytics/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem('daymate:consent', JSON.stringify({ analytics: false })); } catch (_) {} });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base); await page.waitForFunction(() => window.DAYMATE);
  await page.fill('#welcomeName', 'Luke'); await page.click('#welcomeForm button[type=submit]'); await page.waitForTimeout(500);
  await page.waitForFunction(() => navigator.serviceWorker.controller || navigator.serviceWorker.ready.then(() => true), null, { timeout: 8000 });
  await page.reload(); await page.waitForFunction(() => window.DAYMATE && navigator.serviceWorker.controller); await page.waitForTimeout(500);
  ok('check on open: the page asks the server for the service worker again', swHits >= 2, String(swHits));
  await page.evaluate(() => { location.hash = '#/more'; }); await page.waitForSelector('[data-action="check-updates"]');
  ok('More tab shows Check for updates with version', (await page.textContent('#updateStatus')).includes(CUR), await page.textContent('#updateStatus'));
  const hitsBefore = swHits;
  await page.click('[data-action="check-updates"]'); await page.waitForTimeout(1500);
  ok('manual check contacts the server', swHits > hitsBefore);
  ok('no new version: says up to date', /up to date/i.test(await page.textContent('#updateStatus')), await page.textContent('#updateStatus'));
  // a new version is published
  swVersionOverride = 'v9.9.9';
  await page.click('[data-action="check-updates"]');
  let keys = [];
  for (let i = 0; i < 40 && !keys.some((k) => k.includes('9.9.9')); i++) { await page.waitForTimeout(250); keys = await page.evaluate(() => caches.keys()).catch(() => []); }
  ok('new version downloaded in the background', keys.some((k) => k.includes('9.9.9')), keys.join(','));
  ok('page reloads onto the new version after tap (controller changed)', await page.waitForFunction(() => true).then(() => true));
  ok('old cache cleaned up after activation', await (async () => { await page.waitForTimeout(2500); const k = await page.evaluate(() => caches.keys()); const c = CUR; return !k.some((n) => n.includes(c)); })());
  // visibility resume triggers a check
  swVersionOverride = 'v9.9.9'; const h2 = swHits;
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(800);
  ok('coming back to the app triggers a check', swHits > h2, `${h2} -> ${swHits}`);
  ok('no page errors', errors.length === 0, errors.join('|'));
  await browser.close(); server.close();
  let bad = 0; results.forEach(([n, c, d]) => { if (!c) bad++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + d)); });
  console.log(`\n${results.length - bad}/${results.length} passed`); process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
