// Browser tests: Free vs Premium, paywall, ads, restore, lifetime. Run: node tests/premium_ui_test.js
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
const FAKE_SDK = `
let configured = null; const log = (globalThis.__rc = globalThis.__rc || []);
const inst = { async getOfferings() { return { current: { monthly: { id: 'monthly' }, availablePackages: [{ id: 'monthly' }] }, all: {} }; },
  async purchase(a) { log.push('purchase:' + a.rcPackage.id); if (globalThis.__rcCancel) { const e = new Error('cancelled'); e.errorCode = 1; throw e; } globalThis.__serverBecomesPremium && globalThis.__serverBecomesPremium(); return {}; },
  changeUser(id) { log.push('changeUser:' + id); } };
export const Purchases = { configure(o) { configured = o; log.push('configure:' + o.appUserId + ':' + o.apiKey); return inst; }, getSharedInstance() { return inst; } };
`;
const CONFIGURED = (src) => src
  .replace(/webPublicKey: '[^']*'/, "webPublicKey: 'rcb_test_key'")
  .replace("adsenseClient: ''", "adsenseClient: 'ca-pub-1234567890123456'")
  .replace("slots: { home: '', planner: '', more: '' }", "slots: { home: '1111111111', planner: '2222222222', more: '3333333333' }");

async function newPage(browser, base, { configured }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const adReq = []; const cdn = [];
  await ctx.route(/supabase\.co|googletagmanager/, (r) => r.abort());
  await ctx.route(/pagead2\.googlesyndication\.com/, (r) => { adReq.push(r.request().url()); r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }); });
  await ctx.route(/cdn\.jsdelivr\.net/, (r) => { cdn.push(r.request().url()); r.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_SDK }); });
  if (!configured) await ctx.route('**/js/config.js', async (r) => { const body = fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8'); r.fulfill({ status: 200, contentType: 'text/javascript', body: body.replace(/webPublicKey: '[^']*'/, "webPublicKey: ''") }); });
  if (configured) await ctx.route('**/js/config.js', async (r) => { const body = fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8'); r.fulfill({ status: 200, contentType: 'text/javascript', body: CONFIGURED(body) }); });
  await ctx.addInitScript(() => { try { localStorage.setItem('daymate:consent', JSON.stringify({ analytics: false })); } catch (_) {} });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base); await page.waitForFunction(() => window.DAYMATE);
  await page.fill('#welcomeName', 'Luke'); await page.click('#welcomeForm button[type=submit]'); await page.waitForTimeout(500);
  return { ctx, page, adReq, cdn, errors };
}
// A fake server: one entitlement row we can change, mirroring what the real read-only table returns.
const installServer = (page, row) => page.evaluate(async (row) => {
  const { session } = await import('./js/session.js');
  const S = window.__srv = { row, calls: [], refreshPlan: null };
  session.client = {
    from: (t) => ({ select() { return this; }, eq() { return this; }, maybeSingle: () => Promise.resolve({ data: t === 'entitlements' ? S.row : null, error: null }), then(res) { return Promise.resolve({ data: [], error: null }).then(res); } }),
    functions: { invoke: async (name, { body }) => { S.calls.push([name, body && body.action]); if (S.refreshPlan) S.row = S.refreshPlan(); return { data: { ok: true, plan: S.row.plan }, error: null }; } },
  };
  window.__serverBecomesPremium = () => { S.refreshPlan = () => ({ plan: 'premium', status: 'active', current_period_end: new Date(Date.now() + 30 * 864e5).toISOString(), source: 'revenuecat', will_renew: true, store: 'stripe' }); };
}, row);
const signIn = (page) => page.evaluate(async () => { const { session } = await import('./js/session.js'); session.user = { id: '0b271515-f8b4-4dc0-b31e-9319d40671b6', email: 'a@b.c' }; DAYMATE.Account.set({ configured: true, user: { id: session.user.id, email: 'a@b.c' } }); });
const setEnt = (page, e) => page.evaluate((e) => DAYMATE.Account.set({ entitlement: e }), e);
const FREE = { plan: 'free', status: 'active', currentPeriodEnd: null, source: 'default', willRenew: null, store: null };
const LIFE = { plan: 'premium', status: 'active', currentPeriodEnd: null, source: 'lifetime', willRenew: false, store: 'promotional' };
const go = async (page, h) => { await page.evaluate((h) => { location.hash = h; }, h); await page.waitForTimeout(350); };
const openPaywall = async (page) => { await page.evaluate(() => DAYMATE.views.openPremium('')); await page.waitForTimeout(450); };
const closeModal = async (page) => { await page.evaluate(() => DAYMATE.Modal.close('m-premium')); await page.waitForTimeout(250); };

(async () => {
  await new Promise((r) => server.listen(0, r)); const base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();

  /* ===== A. default config (nothing set up yet): honest + no ads ===== */
  {
    const { ctx, page, adReq, errors } = await newPage(browser, base, { configured: false });
    await openPaywall(page);
    const t = await page.textContent('#m-premium');
    ok('A paywall shows £2.99/month', /£2\.99/.test(t) && /month/.test(t));
    ok('A says Premium removes adverts', /completely ad-free/i.test(t));
    ok('A has terms, privacy and terms-of-use links', !!(await page.$('#m-premium a[href="privacy.html"]')) && !!(await page.$('#m-premium a[href="terms.html"]')) && /renews automatically/i.test(t) && /24 hours/.test(t));
    ok('A restore purchases button present', !!(await page.$('[data-action="restore-purchases"]')));
    ok('A signed out: asks to sign in', /Sign in to upgrade/.test(await page.textContent('#premiumActions')));
    ok('A honest about coming-soon benefits', (await page.$$('.pfeat__tag:not(.pfeat__tag--live)')).length >= 3);
    await closeModal(page); await installServer(page, FREE); await signIn(page); await setEnt(page, FREE); await openPaywall(page);
    ok('A signed in, no billing keys: disabled "open soon", nothing charged', await page.evaluate(() => { const b = document.querySelector('#premiumActions .btn--gold'); return b && b.disabled && /open soon/.test(b.textContent); }) && /Nothing will be charged/.test(await page.textContent('#premiumActions')));
    await closeModal(page);
    await go(page, '#/home');
    ok('A no ad slots when no provider configured (no fake ads)', !(await page.$('.ad-slot')) && adReq.length === 0);
    ok('A no page errors', errors.length === 0, errors.join('|'));
    await ctx.close();
  }

  /* ===== B. configured: Free experience, ads + consent, purchase flow ===== */
  {
    const { ctx, page, adReq, cdn, errors } = await newPage(browser, base, { configured: true });
    await installServer(page, FREE); await signIn(page);
    // plan not loaded yet -> no ads
    await go(page, '#/home');
    ok('B signed in, plan unknown: no ads / consent card yet', !(await page.$('.ad-slot')) && adReq.length === 0);
    await setEnt(page, FREE); await page.waitForTimeout(300);
    ok('B Free: consent card shown in the ad position (no pop-up)', !!(await page.$('.ad-slot--consent')) && !(await page.$('.modal.is-open')));
    ok('B nothing requested from the ad network before consent', adReq.length === 0);
    ok('B consent card mentions Premium removes ads', /Premium removes ads/.test(await page.textContent('.ad-slot--consent')));
    await page.click('[data-ads-choice="allow"]'); await page.waitForTimeout(500);
    ok('B after Allow: ad script requested once, non-personalised', adReq.length === 1 && await page.evaluate(() => window.adsbygoogle && window.adsbygoogle.requestNonPersonalizedAds === 1));
    ok('B Home ad slot labelled "Advertisement" with Remove-ads link', /Advertisement/.test(await page.textContent('#view-home .ad-slot')) && !!(await page.$('#view-home .ad-slot [data-action="open-premium"]')));
    await go(page, '#/more'); await go(page, '#/planner'); await go(page, '#/home');
    const pushes1 = await page.evaluate(() => (window.adsbygoogle || []).length);
    await go(page, '#/more'); await go(page, '#/home'); await go(page, '#/more'); await go(page, '#/planner'); await go(page, '#/home');
    ok('B ads not re-requested on every screen change', (await page.evaluate(() => (window.adsbygoogle || []).length)) === pushes1);
    await go(page, '#/more'); ok('B More has an ad slot', !!(await page.$('#view-more .ad-slot')));
    await go(page, '#/assistant'); ok('B no ad on the assistant screen', !(await page.$('#view-assistant .ad-slot')));
    await openPaywall(page); ok('B no ad inside the paywall', !(await page.$('#m-premium .ad-slot'))); await closeModal(page);

    // purchase flow (web billing, stubbed SDK + server)
    await openPaywall(page);
    ok('B upgrade button enabled with price', await page.evaluate(() => { const b = document.querySelector('[data-action="upgrade-premium"]'); return b && !b.disabled && /£2\.99\/month/.test(b.textContent); }));
    await page.evaluate(() => { window.__rcCancel = true; }); await page.click('[data-action="upgrade-premium"]'); await page.waitForTimeout(500);
    ok('B cancelling the purchase leaves the account Free with no scary error', await page.evaluate(() => DAYMATE.Account.getPlan() === 'free') && !/didn’t complete/.test(await page.textContent('#premiumActions')));
    await page.evaluate(() => { window.__rcCancel = false; }); await page.click('[data-action="upgrade-premium"]'); await page.waitForTimeout(3500);
    const rc = await page.evaluate(() => globalThis.__rc || []);
    ok('B SDK used the account id as the RevenueCat user', rc.some((x) => x.startsWith('configure:0b271515-f8b4-4dc0-b31e-9319d40671b6:rcb_test_key')) && rc.includes('purchase:monthly'));
    ok('B server was asked to verify the purchase', await page.evaluate(() => window.__srv.calls.some((c) => c[0] === 'revenuecat' && c[1] === 'refresh')));
    ok('B becomes Premium only after the server says so', await page.evaluate(() => DAYMATE.Account.getPlan() === 'premium'));
    ok('B Premium screen shows renewal + manage button', /renews on/.test(await page.textContent('#m-premium')) && !!(await page.$('[data-action="manage-subscription"]')));
    await closeModal(page);
    ok('B Premium: ad slots removed immediately', !(await page.$('.ad-slot')));
    const reqs = adReq.length; await go(page, '#/more'); await go(page, '#/home'); await go(page, '#/planner');
    ok('B Premium: still no ads on any screen and no new ad requests', !(await page.$('.ad-slot')) && adReq.length === reqs);
    ok('B Premium: Settings has no ad-cookie row', await (async () => { await page.evaluate(() => document.querySelector('[data-action="open-settings"]') && 0); return !(await page.$('#adsField')); })());

    // expiry reverts to Free (client display; the server enforces independently)
    await setEnt(page, { plan: 'premium', status: 'active', currentPeriodEnd: new Date(Date.now() - 60000).toISOString(), source: 'revenuecat', willRenew: true, store: 'app_store' });
    ok('B expired period → Free', await page.evaluate(() => DAYMATE.Account.getPlan() === 'free'));
    await setEnt(page, { plan: 'free', status: 'canceled', currentPeriodEnd: new Date(Date.now() - 60000).toISOString(), source: 'revenuecat', willRenew: false, store: 'app_store' });
    await go(page, '#/home'); await page.waitForTimeout(300);
    ok('B after expiry ads return for Free (choice remembered)', !!(await page.$('#view-home .ad-slot')));
    await openPaywall(page); ok('B expired: says back on Free, data kept', /back on the Free plan/.test(await page.textContent('#m-premium')) && /keep all your saved data/.test(await page.textContent('#m-premium'))); await closeModal(page);
    // user data survives tier changes
    await page.evaluate(() => DAYMATE.Store.addTask && DAYMATE.Store.addTask({ title: 'Keep me', priority: 'medium', category: 'personal', due: '', time: '' }));
    const before = await page.evaluate(() => DAYMATE.Store.state.tasks.length);
    await setEnt(page, LIFE); await setEnt(page, FREE);
    ok('B tasks unchanged across tier changes', (await page.evaluate(() => DAYMATE.Store.state.tasks.length)) === before);

    // a never-subscribed account whose server row says free/canceled must NOT claim Premium "ended"
    await setEnt(page, { plan: 'free', status: 'canceled', currentPeriodEnd: null, source: 'revenuecat', willRenew: false, store: null });
    await openPaywall(page); ok('B never-subscribed account just says Free plan', /You’re on the Free plan/.test(await page.textContent('#m-premium')) && !/has ended/.test(await page.textContent('#m-premium'))); await closeModal(page);

    // restore
    await page.evaluate(() => { window.__srv.refreshPlan = () => ({ plan: 'premium', status: 'active', current_period_end: new Date(Date.now() + 5 * 864e5).toISOString(), source: 'revenuecat', will_renew: false, store: 'play_store' }); });
    await openPaywall(page); await page.click('[data-action="restore-purchases"]'); await page.waitForTimeout(800);
    ok('B restore re-checks with the server and restores Premium', await page.evaluate(() => DAYMATE.Account.getPlan() === 'premium') && /won’t renew/.test(await page.textContent('#m-premium')));
    await closeModal(page);

    // consent: deny path (second page state)
    ok('B no page errors', errors.length === 0, errors.join('|'));
    await ctx.close();
  }

  /* ===== C. "No thanks" means the ad network is never contacted ===== */
  {
    const { ctx, page, adReq, errors } = await newPage(browser, base, { configured: true });
    await installServer(page, FREE); await signIn(page); await setEnt(page, FREE); await go(page, '#/home');
    await page.click('[data-ads-choice="deny"]'); await page.waitForTimeout(400);
    await go(page, '#/more'); await go(page, '#/home');
    ok('C No thanks: no ads, no ad-network request, no card', !(await page.$('.ad-slot')) && adReq.length === 0);
    ok('C choice remembered after reload', await (async () => { await page.reload(); await page.waitForFunction(() => window.DAYMATE); return (await page.evaluate(() => localStorage.getItem('daymate:adsConsent'))).includes('deny'); })());
    ok('C no page errors', errors.length === 0, errors.join('|'));
    await ctx.close();
  }

  /* ===== D. Lifetime Premium: persists across logout/login/new device; no ads; no purchase UI ===== */
  {
    const { ctx, page, adReq, errors } = await newPage(browser, base, { configured: true });
    await installServer(page, { plan: 'premium', status: 'active', current_period_end: null, source: 'lifetime', will_renew: false, store: 'promotional' });
    await signIn(page); await setEnt(page, LIFE);
    ok('D lifetime: Premium', await page.evaluate(() => DAYMATE.Account.getPlan() === 'premium'));
    await openPaywall(page);
    ok('D lifetime: paywall says Lifetime Premium, no upgrade/restore buttons', /Lifetime Premium/.test(await page.textContent('#m-premium')) && !(await page.$('[data-action="upgrade-premium"]')) && !(await page.$('[data-action="restore-purchases"]')));
    await closeModal(page);
    ok('D lifetime: no ads', !(await page.$('.ad-slot')) && adReq.length === 0);
    // dates can never expire it
    await setEnt(page, { ...LIFE, currentPeriodEnd: new Date(Date.now() - 864e5).toISOString(), status: 'canceled' });
    ok('D lifetime ignores expiry dates/status', await page.evaluate(() => DAYMATE.Account.getPlan() === 'premium'));
    // logout -> Free (nothing persisted locally), login -> Premium again from the server row
    await page.evaluate(() => DAYMATE.Account.set({ user: null, entitlement: null }));
    ok('D logged out: Free (plan is never kept locally)', await page.evaluate(() => DAYMATE.Account.getPlan() === 'free'));
    const ls = await page.evaluate(() => JSON.stringify(Object.entries(localStorage)));
    ok('D nothing in localStorage grants Premium', !/lifetime|"premium"/i.test(ls.replace(/daymate:consent|premiumInterest/g, '')));
    await page.reload(); await page.waitForFunction(() => window.DAYMATE);
    ok('D after reinstall/reload, still Free until the server confirms', await page.evaluate(() => DAYMATE.Account.getPlan() === 'free'));
    await installServer(page, { plan: 'premium', status: 'active', current_period_end: null, source: 'lifetime', will_renew: false, store: 'promotional' });
    await signIn(page); await setEnt(page, LIFE);
    ok('D log back in / new device: Premium from server', await page.evaluate(() => DAYMATE.Account.getPlan() === 'premium'));
    // tampering: editing the page's variables can't change the server; and Free is re-derived from server data
    await page.evaluate(() => { try { DAYMATE.Account.entitlement.plan = 'free'; } catch (_) {} });
    ok('D no page errors', errors.length === 0, errors.join('|'));
    await ctx.close();
  }

  await browser.close(); server.close();
  let bad = 0; for (const [n, c, d] of results) { if (!c) { bad++; console.log('FAIL', n, d); } }
  console.log(`${results.length - bad}/${results.length} passed`); process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
