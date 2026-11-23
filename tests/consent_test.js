// Browser tests: privacy banner + consent-gated analytics. Run: node tests/consent_test.js
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
const results = []; const ok = (n, c, d = '') => results.push([n, !!c, d]);
(async () => {
  await new Promise((r) => server.listen(0, r)); const base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  async function fresh() {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage(); const g = { hits: [], errors: [] };
    await ctx.route(/googletagmanager\.com/, (r) => { g.hits.push(r.request().url()); r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }); });
    await ctx.route(/google-analytics\.com/, (r) => { g.hits.push(r.request().url()); r.fulfill({ status: 204, body: '' }); });
    await ctx.route('**/*.supabase.co/**', (r) => r.abort());
    page.on('pageerror', (e) => g.errors.push(e.message));
    return { ctx, page, g };
  }
  // A: ignore the banner -> nothing loads
  let { ctx, page, g } = await fresh();
  await page.goto(base); await page.waitForFunction(() => window.DAYMATE);
  await page.waitForSelector('#m-welcome.is-open', { timeout: 4000 });
  ok('banner waits while the welcome sheet is open', !(await page.$('#consentBanner')));
  await page.fill('#welcomeName', 'Luke'); await page.click('#welcomeForm button[type=submit]');
  await page.waitForSelector('#consentBanner', { timeout: 6000 });
  ok('banner appears after welcome closes', true);
  ok('no Google request before a choice', g.hits.length === 0);
  ok('page works behind banner (no errors)', g.errors.length === 0, g.errors.join('|'));
  // B: No thanks
  await page.click('[data-consent="no"]'); await page.waitForTimeout(300);
  ok('banner closes on No thanks', !(await page.$('#consentBanner')));
  ok('No thanks => still no Google request', g.hits.length === 0);
  await page.reload(); await page.waitForFunction(() => window.DAYMATE); await page.waitForTimeout(1800);
  ok('choice remembered (no banner after reload)', !(await page.$('#consentBanner')));
  ok('still no Google request after reload', g.hits.length === 0);
  // settings toggle ON
  await page.evaluate(() => { location.hash = '#/more'; }); await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector('[data-action="open-settings"]').click()); await page.waitForTimeout(400);
  ok('settings shows Privacy row off', /Usage analytics: Off/.test(await page.textContent('#privacyField')));
  await page.click('[data-action="toggle-analytics"]'); await page.waitForTimeout(600);
  ok('toggling ON loads gtag script', g.hits.some((u) => u.includes('gtag/js?id=G-YCQ42P39T4')), g.hits.join(','));
  ok('row now says On', /Usage analytics: On/.test(await page.textContent('#privacyField')));
  const dl = await page.evaluate(() => JSON.stringify(window.dataLayer || []));
  ok('page_view sent with path only', /page_view/.test(dl) && !/Luke|@/.test(dl), dl.slice(0, 200));
  ok('Google signals/ad personalisation disabled', /allow_google_signals":false/.test(dl.replace(/\s/g, '')) || /allow_google_signals/.test(dl));
  await page.click('[data-action="toggle-analytics"]'); await page.waitForTimeout(300);
  ok('toggling OFF sets disable flag', await page.evaluate(() => window['ga-disable-G-YCQ42P39T4'] === true));
  ok('privacy link present', !!(await page.$('#privacyField a[href="privacy.html"]')));
  await ctx.close();
  // C: Allow from banner
  ({ ctx, page, g } = await fresh());
  await page.goto(base); await page.waitForSelector('#m-welcome.is-open'); await page.fill('#welcomeName', 'Sam'); await page.click('#welcomeForm button[type=submit]');
  await page.waitForSelector('#consentBanner', { timeout: 6000 });
  await page.click('[data-consent="yes"]'); await page.waitForTimeout(600);
  ok('Allow loads gtag with the right id', g.hits.some((u) => u.includes('G-YCQ42P39T4')));
  // D: privacy page
  const p2 = await ctx.newPage(); await p2.goto(base + 'privacy.html');
  ok('privacy page renders', /Privacy policy/.test(await p2.textContent('h1')));
  await ctx.close();
  await browser.close(); server.close();
  let bad = 0; results.forEach(([n, c, d]) => { if (!c) bad++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + d)); });
  console.log(`\n${results.length - bad}/${results.length} passed`); process.exit(bad ? 1 : 0);
})();
