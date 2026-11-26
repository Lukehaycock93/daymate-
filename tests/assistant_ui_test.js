// Browser tests: AI assistant screen with a stubbed server. Run: node tests/assistant_ui_test.js
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
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route(/supabase\.co|jsdelivr|googletagmanager/, (r) => r.abort());
  await ctx.addInitScript(() => { try { localStorage.setItem('daymate:consent', JSON.stringify({ analytics: false })); } catch (_) {} });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base); await page.waitForFunction(() => window.DAYMATE);
  await page.fill('#welcomeName', 'Luke'); await page.click('#welcomeForm button[type=submit]'); await page.waitForTimeout(500);
  const D = (off) => page.evaluate((o) => { const d = new Date(); d.setDate(d.getDate() + o); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }, off);
  const d1 = await D(1), d3 = await D(3), d7 = await D(7);

  // signed out
  await page.evaluate(() => { location.hash = '#/assistant'; }); await page.waitForTimeout(400);
  ok('signed out: asks to sign in, no chat box', /Sign in to use the assistant/.test(await page.textContent('#view-assistant')) && !(await page.$('#aiInput')));

  // install a stub server
  await page.evaluate(async ([d1, d3, d7]) => {
    const { session } = await import('./js/session.js');
    const state = { consent: null, calls: [], convs: [{ id: 'c1', title: 'Old chat about dinner', updated_at: new Date().toISOString() }], msgs: { c1: [{ id: 'm1', role: 'user', content: 'dinner?', proposals: null }, { id: 'm2', role: 'assistant', content: 'How about pasta? <img src=x onerror="window.__xss=1">', proposals: null }] }, next: null };
    window.__stub = state;
    const q = (table) => {
      let op = 'select', payload = null; const b = {
        select() { return b; }, order() { return b; }, limit() { return b; }, eq(k, v) { b._eq = [k, v]; return b; },
        update(p) { op = 'update'; payload = p; return b; }, delete() { op = 'delete'; return b; },
        maybeSingle() { return Promise.resolve({ data: { ai_consent_at: state.consent }, error: null }); },
        then(res, rej) {
          let out = { data: null, error: null };
          if (table === 'user_preferences' && op === 'update') { state.consent = payload.ai_consent_at; }
          else if (table === 'ai_conversations' && op === 'select') out.data = state.convs;
          else if (table === 'ai_conversations' && op === 'delete') state.convs = state.convs.filter((c) => c.id !== b._eq[1]);
          else if (table === 'ai_messages') out.data = state.msgs[b._eq[1]] || [];
          return Promise.resolve(out).then(res, rej);
        },
      }; return b;
    };
    session.client = { from: q, functions: { invoke: async (name, { body }) => { state.calls.push(body); const r = state.next; state.next = null; return r; } } };
    session.user = { id: 'u1', email: 'a@b.c' };
    DAYMATE.Account.set({ configured: true, user: { id: 'u1', email: 'a@b.c' } });
    window.__dates = { d1, d3, d7 };
  }, [d1, d3, d7]);
  await page.waitForTimeout(500);
  ok('signed in, no agreement yet: consent card', /Before you chat with Daymate AI/.test(await page.textContent('#view-assistant')));
  ok('consent card says what is sent and the free-tier caveat', /Google Gemini/.test(await page.textContent('.ai-consent')) && /improve its products/.test(await page.textContent('.ai-consent')) && /Sensitive/.test(await page.textContent('.ai-consent')));
  ok('no chat box before agreeing', !(await page.$('#aiInput')));
  await page.click('[data-action="ai-consent"]'); await page.waitForSelector('#aiInput');
  ok('agreeing saved on the server and opens chat', await page.evaluate(() => !!window.__stub.consent));

  // the spec's example
  const props = (d1, d3, d7) => [
    { kind: 'task', title: 'Go shopping', date: d1, time: null, priority: 'medium', category: 'shopping', repeat: '', important: false, note: '', date_basis: 'tomorrow', needs_clarification: null, conflict: null },
    { kind: 'bill', title: 'Pay electricity bill', date: d3, time: null, priority: 'high', category: 'bills', repeat: '', important: false, note: '', date_basis: 'Friday', needs_clarification: null, conflict: null },
    { kind: 'event', title: 'School appointment', date: d7, time: '14:30', priority: 'medium', category: 'family', repeat: '', important: false, note: '', date_basis: 'next Tuesday', needs_clarification: null, conflict: 'Clashes with “Dentist” at 14:00.' },
  ];
  await page.evaluate(([a, b, c]) => { window.__stub.next = { data: { conversationId: 'c9', messageId: 'a1', reply: 'Here’s what I’d add — tap Add to confirm.', plan: 'free', used: 1, limit: 10, today: a, proposals: [
    { kind: 'task', title: 'Go shopping', date: a, time: null, priority: 'medium', category: 'shopping', repeat: '', important: false, note: '', date_basis: 'tomorrow', needs_clarification: null, conflict: null },
    { kind: 'bill', title: 'Pay electricity bill', date: b, time: null, priority: 'high', category: 'bills', repeat: '', important: false, note: '', date_basis: 'Friday', needs_clarification: null, conflict: null },
    { kind: 'event', title: 'School appointment', date: c, time: '14:30', priority: 'medium', category: 'family', repeat: '', important: false, note: '', date_basis: 'next Tuesday', needs_clarification: null, conflict: 'Clashes with “Dentist” at 14:00.' }] }, error: null }; }, [d1, d3, d7]);
  await page.fill('#aiInput', 'I need to go shopping tomorrow, pay my electricity bill Friday and remember my son’s school appointment next Tuesday.');
  await page.click('.ai-send'); await page.waitForSelector('.ai-prop');
  ok('the box is cleared after sending', (await page.inputValue('#aiInput')) === '');
  ok('request sent with the message and no conversation yet', await page.evaluate(() => window.__stub.calls[0].message.includes('electricity') && !window.__stub.calls[0].conversationId));
  ok('three cards shown', (await page.$$('.ai-prop')).length === 3);
  await page.waitForTimeout(300);
  let st = await page.evaluate(() => ({ t: DAYMATE.Store.state.tasks.map((x) => [x.title, x.date, x.category]), r: DAYMATE.Store.state.reminders.map((x) => [x.title, x.kind, x.date, x.time, x.category]) }));
  ok('adds with clear dates are applied straight away, correctly dated', st.t.length === 1 && st.t[0][0] === 'Go shopping' && st.t[0][1] === d1 && st.t[0][2] === 'shopping' && st.r.length === 2, JSON.stringify(st));
  ok('the bill + appointment landed with the right kind/date/time', st.r.some((x) => x[1] === 'bill' && x[2] === d3 && x[4] === 'bills') && st.r.some((x) => x[1] === 'event' && x[2] === d7 && x[3] === '14:30'), JSON.stringify(st.r));
  ok('how the date was worked out is shown', /Friday/.test(await page.textContent('.ai-prop:nth-child(2)')) && /next Tuesday/.test(await page.textContent('.ai-prop:nth-child(3)')));
  ok('clash warning shown', /Clashes with .Dentist./.test(await page.textContent('.ai-prop:nth-child(3)')));
  ok('messages-left counter', /9 messages left/.test(await page.textContent('.ai-left')));
  ok('cards show what was done, with Undo', /Added/.test(await page.textContent('.ai-prop:nth-child(1)')) && !!(await page.$('.ai-prop:nth-child(1) [data-action="ai-undo"]')));
  ok('adding twice is impossible (dedupe)', await page.evaluate(() => { const before = DAYMATE.Store.state.tasks.length; window.__daymateAssistant.addProposal('a1', 0); return DAYMATE.Store.state.tasks.length === before; }));

  // follow-up uses the same conversation; ambiguous date asks
  await page.evaluate(() => { window.__stub.next = { data: { conversationId: 'c9', messageId: 'a2', reply: 'When should I book the dentist?', plan: 'free', used: 2, limit: 10, proposals: [{ kind: 'event', title: 'Dentist', date: null, time: null, priority: 'medium', category: 'personal', repeat: '', important: false, note: '', date_basis: '', needs_clarification: 'Which day next week?', conflict: null }] }, error: null }; });
  await page.fill('#aiInput', 'book dentist sometime next week'); await page.click('.ai-send'); await page.waitForSelector('.ai-prop__q');
  ok('follow-up continues the same conversation', await page.evaluate(() => window.__stub.calls[1].conversationId === 'c9'));
  ok('ambiguous: shows the question + a date picker, not a date', /Which day next week/.test(await page.textContent('.ai-prop__q')) && !!(await page.$('.ai-prop__date')));
  await page.click('.ai-msg:last-child [data-action="ai-add"]'); await page.waitForTimeout(200);
  ok('ambiguous: Add without a date does nothing', await page.evaluate(() => !DAYMATE.Store.state.reminders.some((x) => x.title === 'Dentist')));
  await page.fill('.ai-prop__date', d3); await page.click('.ai-msg:last-child [data-action="ai-add"]'); await page.waitForTimeout(300);
  ok('ambiguous: once the person picks a date it is added with THAT date', await page.evaluate((d) => DAYMATE.Store.state.reminders.some((x) => x.title === 'Dentist' && x.date === d), d3));

  // errors
  const failWith = (code, status = 429, extra = {}) => page.evaluate(([code, extra]) => { window.__stub.next = { data: null, error: { context: { json: async () => ({ error: code, ...extra }) } } }; }, [code, extra]);
  await failWith('limit_reached', 429, { limit: 10, plan: 'free' });
  await page.fill('#aiInput', 'one more'); await page.click('.ai-send'); await page.waitForSelector('.ai-error');
  ok('limit: friendly message with the number', /today’s 10 messages/.test(await page.textContent('.ai-error')));
  ok('limit: the typed message is not lost', (await page.inputValue('#aiInput')) === 'one more');
  await failWith('ai_not_configured');
  await page.click('.ai-send'); await page.waitForFunction(() => /isn’t switched on/.test(document.querySelector('.ai-error')?.textContent || ''));
  ok('not configured: clear message', true);
  await failWith('provider_busy');
  await page.click('.ai-send'); await page.waitForFunction(() => /busy/.test(document.querySelector('.ai-error')?.textContent || ''));
  ok('provider busy: clear message', true);
  ok('failed sends leave no phantom user bubble', await page.evaluate(() => [...document.querySelectorAll('.ai-msg--user')].every((m) => !m.textContent.includes('one more'))));

  // history
  await page.click('[data-action="ai-history"]'); await page.waitForSelector('.ai-hist');
  ok('history lists saved chats', /Old chat about dinner/.test(await page.textContent('.ai-hist')));
  await page.click('[data-action="ai-open"]'); await page.waitForTimeout(400);
  ok('opening a chat shows its messages', /pasta/.test(await page.textContent('#aiMsgs')));
  ok('assistant text is escaped (no script/HTML injection)', (await page.evaluate(() => window.__xss)) === undefined && !(await page.$('#aiMsgs img')));
  await page.click('[data-action="ai-history"]'); await page.waitForSelector('.ai-hist');
  await page.click('[data-action="ai-delete"]'); await page.waitForSelector('#m-confirm.is-open'); await page.click('#confirmOk'); await page.waitForTimeout(500);
  ok('deleting a chat removes it', await page.evaluate(() => window.__stub.convs.length === 0));
  await page.click('[data-action="ai-new"]');
  ok('new chat clears the screen', !!(await page.$('.ai-hello')));

  // planner shows what was added
  await page.evaluate(() => { location.hash = '#/planner'; }); await page.waitForSelector('.pl'); await page.click('[data-mode="month"]'); await page.waitForTimeout(300);
  ok('planner month view has dots for the new items', (await page.$$('.pl-dot')).length >= 3);
  // More menu entry + sign-out reset
  await page.evaluate(() => { location.hash = '#/more'; }); await page.waitForTimeout(300);
  ok('More tab has an Ask DAYMATE row', /Ask DAYMATE/.test(await page.textContent('#view-more')));
  await page.evaluate(async () => { const { session } = await import('./js/session.js'); session.user = null; DAYMATE.Account.set({ user: null }); location.hash = '#/assistant'; });
  await page.waitForTimeout(400);
  ok('after sign-out the chat is gone', /Sign in to use the assistant/.test(await page.textContent('#view-assistant')) && !(await page.$('.ai-msg')));
  ok('no page errors', errors.length === 0, errors.join('|'));
  await page.evaluate(() => { location.hash = '#/assistant'; });
  ok('mobile: no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await browser.close(); server.close();
  let bad = 0; results.forEach(([n, c, d]) => { if (!c) bad++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + d)); });
  console.log(`\n${results.length - bad}/${results.length} passed`); process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
