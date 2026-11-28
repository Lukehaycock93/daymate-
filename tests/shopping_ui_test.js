// Browser tests: Stage 5 Shopping upgrade.   Run: node tests/shopping_ui_test.js
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
const results = []; const ok = (n, c, d = '') => { results.push(c); console.log(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + d}`); };
let base;
async function boot(browser, vp, theme) {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: vp.width < 700 });
  await ctx.route(/supabase\.co|jsdelivr|googletagmanager|googlesyndication/, (r) => r.abort());
  await ctx.route(/open-meteo|postcodes\.io/, (r) => r.abort());
  await ctx.addInitScript((t) => { try { localStorage.setItem('daymate:consent', JSON.stringify({ analytics: false })); localStorage.setItem('daymate:theme', t); } catch (_) {} }, theme);
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base); await page.waitForFunction(() => window.DAYMATE);
  await page.fill('#welcomeName', 'Luke'); await page.click('#welcomeForm button[type=submit]'); await page.waitForTimeout(400);
  return { ctx, page, errors };
}
const add = async (page, t) => { await page.fill('#shoppingInput', t); await page.press('#shoppingInput', 'Enter'); await page.waitForTimeout(80); };
(async () => {
  await new Promise((r) => server.listen(0, r)); base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  for (const theme of ['dark', 'light']) for (const w of [320, 390]) {
    const { ctx, page, errors } = await boot(browser, { width: w, height: 844 }, theme); const tag = `${theme} ${w}px`;
    await page.evaluate(() => DAYMATE.Store.add('shopping', { name: 'Legacy item', checked: false }));   // old-style item, no category
    await page.evaluate(() => { location.hash = '#/home'; }); await page.click('[data-action="open-shopping"]'); await page.waitForSelector('#m-shopping .sheet', { state: 'visible' });
    await add(page, '2 litres of milk'); await add(page, 'Bananas'); await add(page, '500g mince'); await add(page, 'toilet roll'); await add(page, 'Chocolate');
    const st = await page.evaluate(() => DAYMATE.Store.state.shopping.map((i) => [i.name, i.quantity, i.category]));
    const get = (n) => st.find((x) => x[0] === n);
    ok(`${tag}: "2 litres of milk" saved as milk / 2 litres / dairy`, JSON.stringify(get('milk')) === '["milk","2 litres","dairy"]', JSON.stringify(st));
    ok(`${tag}: mince is 500g / meat`, JSON.stringify(get('mince')) === '["mince","500g","meat"]');
    ok(`${tag}: toilet roll goes to household, bananas to produce`, get('toilet roll')[2] === 'household' && get('Bananas')[2] === 'produce');
    ok(`${tag}: old item without a category is treated as "other"`, (!get('Legacy item')[2] || get('Legacy item')[2] === 'other') && !get('Legacy item')[1]);
    const heads = await page.$$eval('#shoppingList .shop__head h3', (n) => n.map((e) => e.childNodes[0].textContent));
    ok(`${tag}: groups appear in aisle order`, heads.join('|') === 'Fruit & veg|Dairy & eggs|Meat & fish|Cupboard|Household|Other', heads.join('|'));
    ok(`${tag}: quantity pill shown`, (await page.textContent('#shoppingList')).includes('2 litres'));
    await page.fill('#shoppingInput', '3 apples'); ok(`${tag}: live preview explains what will be added`, /Adding 3 × apples · Fruit & veg/.test(await page.textContent('#shoppingHint')), await page.textContent('#shoppingHint'));
    await page.fill('#shoppingInput', '');
    await add(page, 'MILK'); ok(`${tag}: duplicate (case-insensitive) is refused`, (await page.evaluate(() => DAYMATE.Store.state.shopping.filter((i) => /^milk$/i.test(i.name)).length)) === 1);
    // edit
    await page.click('#shoppingList [data-action="edit-shop"] >> text=Bananas');
    ok(`${tag}: tapping an item opens inline edit`, await page.isVisible('#shoppingList .is-editing'));
    await page.fill('#shoppingList .is-editing [data-f=name]', 'Bananas (ripe)'); await page.fill('#shoppingList .is-editing [data-f=quantity]', '6'); await page.selectOption('#shoppingList .is-editing [data-f=category]', 'pantry');
    await page.press('#shoppingList .is-editing [data-f=quantity]', 'Enter'); await page.waitForTimeout(100);
    const b = await page.evaluate(() => DAYMATE.Store.state.shopping.find((i) => /ripe/.test(i.name)));
    ok(`${tag}: edit saved name, quantity and aisle`, b && b.quantity === '6' && b.category === 'pantry', JSON.stringify(b));
    await page.click('#shoppingList [data-action="edit-shop"] >> text=mince'); await page.keyboard.press('Escape'); await page.waitForTimeout(100);
    ok(`${tag}: Escape cancels edit without closing the sheet`, !(await page.isVisible('#shoppingList .is-editing')) && await page.isVisible('#m-shopping .sheet'));
    // tick -> trolley group
    await page.click('#shoppingList li:has-text("mince") .check'); await page.waitForTimeout(100);
    const last = await page.$$eval('#shoppingList .shop__head h3', (n) => n[n.length - 1].childNodes[0].textContent);
    ok(`${tag}: ticked items drop to "In the trolley"`, last === 'In the trolley', last);
    // sort
    await page.click('[data-action="shop-sort"][data-mode="added"]'); await page.waitForTimeout(100);
    const names = await page.$$eval('#shoppingList .shop__name', (n) => n.map((e) => e.textContent));
    ok(`${tag}: "As added" shows one list in order added`, names[0] === 'Legacy item' && names[1] === 'milk', names.join(','));
    await page.click('[data-action="shop-sort"][data-mode="aisle"]');
    // delete + undo
    await page.click('#shoppingList li:has-text("toilet roll") [data-action="delete-shop"]'); await page.waitForTimeout(100);
    ok(`${tag}: delete works`, !(await page.textContent('#shoppingList')).includes('toilet roll'));
    await page.click('.toast [data-action], .toast button').catch(() => {}); await page.waitForTimeout(150);
    ok(`${tag}: undo restores the item with its aisle`, await page.evaluate(() => { const i = DAYMATE.Store.state.shopping.find((x) => x.name === 'toilet roll'); return !!i && i.category === 'household'; }));
    // clear ticked
    await page.click('#shoppingClear'); await page.waitForTimeout(150);
    ok(`${tag}: clear ticked removes the trolley group`, !(await page.textContent('#shoppingList')).includes('In the trolley'));
    // layout
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, ls: document.querySelector('#m-shopping .sheet').scrollWidth, lc: document.querySelector('#m-shopping .sheet').clientWidth }));
    ok(`${tag}: no horizontal overflow`, m.sw <= m.cw && m.ls <= m.lc, JSON.stringify(m));
    await add(page, 'x'.repeat(90) + ' very long name to wrap nicely');
    const m2 = await page.evaluate(() => { const s = document.querySelector('#m-shopping .sheet'); return s.scrollWidth <= s.clientWidth; });
    ok(`${tag}: long names wrap`, m2);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    ok(`${tag}: no page errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  // persistence + cloud mapping
  {
    const { ctx, page, errors } = await boot(browser, { width: 390, height: 844 }, 'dark');
    await page.evaluate(() => DAYMATE.Store.add('shopping', { name: 'Yoghurt', quantity: '4', category: 'dairy', checked: false }));
    await page.reload(); await page.waitForFunction(() => window.DAYMATE); await page.waitForTimeout(300);
    const r = await page.evaluate(() => DAYMATE.Store.state.shopping.find((i) => i.name === 'Yoghurt'));
    ok('quantity and aisle survive a reload', r && r.quantity === '4' && r.category === 'dairy', JSON.stringify(r));
    await page.evaluate(() => { const S = DAYMATE.Store; S.add('shopping', { name: 'Bad', quantity: 'q'.repeat(60), category: 'nonsense', checked: false }); });
    await page.reload(); await page.waitForFunction(() => window.DAYMATE);
    const bd = await page.evaluate(() => DAYMATE.Store.state.shopping.find((i) => i.name === 'Bad'));
    ok('bad stored category/quantity is cleaned on load', bd && bd.category === 'other' && bd.quantity.length <= 30, JSON.stringify(bd));
    const map = await page.evaluate(async () => { const m = await import('./js/mapping.js'); const row = m.toRow('shopping', { id: '11111111-1111-4111-8111-111111111111', name: 'Milk', quantity: '2', category: 'dairy', checked: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, 'u1'); const back = m.fromRow('shopping_items', { ...row, created_at: row.created_at || new Date().toISOString(), updated_at: row.updated_at || new Date().toISOString() }); return { row, back }; }).catch((e) => ({ err: String(e) }));
    ok('cloud mapping carries quantity and category both ways', map.row && map.row.quantity === '2' && map.row.category === 'dairy' && map.back.quantity === '2' && map.back.category === 'dairy', JSON.stringify(map).slice(0, 300));
    ok('no page errors (persistence)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  await browser.close(); server.close();
  const f = results.filter((x) => !x).length; console.log(`\n${results.length - f}/${results.length} passed`); process.exit(f ? 1 : 0);
})();
