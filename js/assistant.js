/* ==========================================================================
   DAYMATE — Daymate AI (full screen + floating chat)

   • Needs an account (the AI runs on the server, never in the browser — the
     provider key is a server secret) and the person's one-time agreement.
   • The assistant can add, change, move, tick off and (after a confirmation)
     delete events, tasks, reminders, bills and shopping items. Adds, edits and
     tick-offs are applied straight away with an Undo; a delete always waits for
     the person to tap Delete. Anything without a clear date asks for one.
   • The server never touches planner data: it returns validated actions that
     refer to real items by id, and this file applies them through the same
     Store the rest of the app uses (so they sync like any other change).
   • Chats are saved to the account (Settings → delete any time).
   ========================================================================== */
import { session } from './session.js';

const DONE_KEY = 'daymate:aiDone';
const KINDS = { task: 'Task', event: 'Appointment', reminder: 'Reminder', bill: 'Bill', shopping: 'Shopping' };
const COL = { task: 'tasks', event: 'reminders', reminder: 'reminders', bill: 'reminders', shopping: 'shopping' };
const AUTO_APPLY_MAX = 6;       // a bigger batch waits for one tap on "Apply all"
const ERR = {
  ai_not_configured: 'The assistant isn’t switched on yet. It needs an AI key adding on the server.',
  provider_busy: 'The AI service is busy right now. Please try again in a minute.',
  provider_error: 'The AI service had a problem. Nothing was used from your allowance. Please try again.',
  unauthorised: 'Please sign in again to use the assistant.',
  too_long: 'That message is a bit long. Keep it under 1,000 characters.',
};
// Suggested prompts. `fill` puts the start of a sentence in the box instead of sending straight away.
const STARTERS = [
  { label: 'Plan my day', text: 'Plan my day around my appointments.' },
  { label: 'What’s coming up?', text: 'What’s coming up in the next few days?' },
  { label: 'Add an event', fill: 'Add an appointment ' },
  { label: 'Organise my tasks', text: 'Help me organise my tasks. What should I do first?' },
  { label: 'Create a shopping list', fill: 'Add to my shopping list: ' },
];

export function initAssistant(DM) {
  const { Store, Account, UI, confirmDialog, CATEGORIES, PRIORITY_LABEL } = DM;
  const { $, esc, icon, plural, todayStr, parseDate, isValidDate, isValidTime, cleanText, safeLS, nowISO } = helpers(DM);
  const ui = {
    mode: 'loading', consent: null, convId: '', messages: [], busy: false, history: null, showHistory: false, skipped: new Set(), memDone: new Set(),
    userId: '', used: null, limit: null, plan: 'free', error: '', draft: '', stick: true, undo: {}, sheetOpen: false,
  };
  const catLabel = (k) => (CATEGORIES.find((c) => c.key === k) || CATEGORIES[0]).label;

  const doneMap = () => { try { return JSON.parse(safeLS.get(DONE_KEY) || '{}') || {}; } catch (_) { return {}; } };
  const isDone = (msgId, i) => (doneMap()[msgId] || []).includes(i);
  const markDone = (msgId, i) => { const m = doneMap(); m[msgId] = [...new Set([...(m[msgId] || []), i])]; const ids = Object.keys(m); if (ids.length > 200) delete m[ids[0]]; safeLS.set(DONE_KEY, JSON.stringify(m)); };
  const unmarkDone = (msgId, i) => { const m = doneMap(); m[msgId] = (m[msgId] || []).filter((x) => x !== i); safeLS.set(DONE_KEY, JSON.stringify(m)); };
  const dateLabel = (d) => parseDate(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const nl = (s) => esc(s).replace(/\n/g, '<br>');
  const opOf = (p) => p.op || 'add';
  const key = (msgId, i) => `${msgId}:${i}`;

  /* ---------------- server calls ---------------- */
  async function loadConsent() {
    try {
      const { data, error } = await session.client.from('user_preferences').select('ai_consent_at').eq('user_id', session.user.id).maybeSingle();
      if (error) throw error;
      ui.consent = !!(data && data.ai_consent_at);
      ui.mode = 'ready';
    } catch (_) { ui.mode = 'error'; }
    DM.views.renderAll();
  }
  async function grantConsent() {
    const { error } = await session.client.from('user_preferences').update({ ai_consent_at: new Date().toISOString() }).eq('user_id', session.user.id);
    if (error) { UI.toast('Couldn’t save that. Please try again.'); return; }
    ui.consent = true; DM.views.renderAll();
  }
  async function errorCode(err) {
    try { if (err && err.context && typeof err.context.json === 'function') { const j = await err.context.json(); return j; } } catch (_) { /* not JSON */ }
    return {};
  }
  /** The assistant reads the account copy of the planner, so push anything not yet saved first (briefly). */
  async function settleSync() {
    try {
      if (session.sync && session.sync.hasPending && session.sync.hasPending()) {
        await Promise.race([session.sync.sync(), new Promise((r) => setTimeout(r, 4000))]);
      }
    } catch (_) { /* send anyway */ }
  }
  async function send(text) {
    ui.busy = true; ui.error = ''; ui.messages.push({ id: `local-${Date.now()}`, role: 'user', content: text, proposals: null }); ui.stick = true;
    DM.views.renderAll();
    try {
      await settleSync();
      const { data, error } = await session.client.functions.invoke('assistant', { body: { message: text, conversationId: ui.convId || undefined } });
      if (error) {
        const j = await errorCode(error);
        ui.messages.pop();
        ui.draft = text; ui.keepDraft = true;
        if (j.error === 'consent_required') { ui.consent = false; }
        else if (j.error === 'limit_reached') ui.error = `You’ve used today’s ${j.limit} messages. They reset tomorrow.${j.plan === 'free' ? ' Premium allows more.' : ''}`;
        else ui.error = ERR[j.error] || (navigator.onLine ? 'Something went wrong. Please try again.' : 'You’re offline. Reconnect and try again.');
      } else {
        ui.convId = data.conversationId; ui.used = data.used; ui.limit = data.limit; ui.plan = data.plan;
        const msg = { id: data.messageId, role: 'assistant', content: data.reply, proposals: data.proposals && data.proposals.length ? data.proposals : null, memories: Array.isArray(data.memorySuggestions) && data.memorySuggestions.length ? data.memorySuggestions : null };
        ui.messages.push(msg);
        autoApply(msg);
      }
    } catch (_) { ui.messages.pop(); ui.draft = text; ui.keepDraft = true; ui.error = navigator.onLine ? 'Something went wrong. Please try again.' : 'You’re offline. Reconnect and try again.'; }
    ui.busy = false; ui.stick = true; DM.views.renderAll();
  }
  async function loadHistory() {
    ui.history = null; DM.views.renderAll();
    const { data, error } = await session.client.from('ai_conversations').select('id,title,updated_at').order('updated_at', { ascending: false }).limit(30);
    ui.history = error ? [] : data; DM.views.renderAll();
  }
  async function openConversation(id) {
    const { data, error } = await session.client.from('ai_messages').select('id,role,content,proposals,created_at').eq('conversation_id', id).order('created_at', { ascending: true }).limit(200);
    if (error) { UI.toast('Couldn’t open that chat.'); return; }
    ui.convId = id; ui.messages = data; ui.showHistory = false; ui.error = ''; ui.stick = true; DM.views.renderAll();
  }
  async function deleteConversation(id) {
    const yes = await confirmDialog({ title: 'Delete this chat?', message: 'The conversation is permanently removed from your account. Tasks you added from it stay in your planner.', okLabel: 'Delete' });
    if (!yes) return;
    const { error } = await session.client.from('ai_conversations').delete().eq('id', id);
    if (error) { UI.toast('Couldn’t delete that chat.'); return; }
    if (ui.convId === id) { ui.convId = ''; ui.messages = []; }
    await loadHistory();
  }

  /* ---------------- doing what the assistant suggested ---------------- */
  const ok = (v, list, d) => (list.includes(v) ? v : d);
  const fail = (msg) => ({ ok: false, msg });

  /** Run one action. Returns { ok, text, undo? } or { ok:false, msg }. Never throws; checks everything again here. */
  function runAction(p, dateOverride) {
    const op = opOf(p);
    if (op === 'add') return runAdd(p, dateOverride);
    const t = p.target; const col = t && COL[t.kind];
    if (!t || !col) return fail('I couldn’t find that item.');
    const item = Store.get(col, t.id);
    if (!item) return fail('That item isn’t in your planner any more.');
    const label = item.title || item.name || t.title;

    if (op === 'delete') {
      const r = Store.remove(col, t.id);
      if (!r) return fail('That item isn’t in your planner any more.');
      return { ok: true, text: `Deleted “${label}”`, undo: () => Store.restore(col, r.item, r.index) };
    }
    if (op === 'complete') {
      if (col === 'shopping') {
        if (item.checked) return { ok: true, text: `“${label}” was already ticked off` };
        Store.update('shopping', t.id, { checked: true });
        return { ok: true, text: `Ticked off “${label}”`, undo: () => Store.update('shopping', t.id, { checked: false }) };
      }
      if (col === 'tasks') {
        if (item.completed) return { ok: true, text: `“${label}” was already done` };
        const prev = { completed: item.completed, completedOn: item.completedOn, completedAt: item.completedAt };
        Store.update('tasks', t.id, { completed: true, completedOn: todayStr(), completedAt: nowISO() });
        try { DM.fireComplete('tasks', Store.get('tasks', t.id)); } catch (_) { /* hooks are optional */ }
        return { ok: true, text: `Marked “${label}” as done`, undo: () => Store.update('tasks', t.id, prev) };
      }
      if (item.done) return { ok: true, text: `“${label}” was already done` };
      Store.update('reminders', t.id, { done: true });
      try { DM.fireComplete('reminders', Store.get('reminders', t.id)); } catch (_) { /* optional */ }
      return { ok: true, text: `Marked “${label}” as done`, undo: () => Store.update('reminders', t.id, { done: false }) };
    }
    if (op === 'update') {
      const ch = p.changes || {}; const patch = {};
      if (col === 'shopping') {
        const n = cleanText(ch.name || ch.title || '', 60); if (n) patch.name = n;
      } else {
        const title = cleanText(ch.title || '', 120); if (title) patch.title = title;
        const date = dateOverride || ch.date;
        if (date) { if (!isValidDate(date) || date < todayStr()) return fail('Pick a date that isn’t in the past.'); patch.date = date; }
        if (ch.time) { if (!isValidTime(ch.time)) return fail('That time isn’t valid.'); patch.time = ch.time; }
        if (ch.priority && col === 'tasks') patch.priority = ok(ch.priority, ['low', 'medium', 'high', 'urgent'], item.priority);
        if (ch.note && col === 'reminders') patch.note = cleanText(ch.note, 200);
      }
      if (!Object.keys(patch).length) return fail('Nothing to change. Pick a date first.');
      const prev = {}; Object.keys(patch).forEach((k) => { prev[k] = item[k]; });
      Store.update(col, t.id, patch);
      const bits = [];
      if (patch.date) bits.push(`to ${dateLabel(patch.date)}`);
      if (patch.time) bits.push(`at ${patch.time}`);
      if (patch.title) bits.push(`renamed “${patch.title}”`);
      if (patch.name) bits.push(`renamed “${patch.name}”`);
      return { ok: true, text: `Updated “${label}”${bits.length ? ' ' + bits.join(' ') : ''}`, undo: () => Store.update(col, t.id, prev) };
    }
    return fail('I didn’t understand that action.');
  }

  function runAdd(p, dateOverride) {
    if (p.kind === 'shopping') {
      const have = new Set(Store.state.shopping.filter((x) => !x.checked).map((x) => x.name.toLowerCase()));
      const made = [];
      (p.items || []).forEach((n) => {
        const name = cleanText(n, 60);
        if (!name || have.has(name.toLowerCase())) return;
        have.add(name.toLowerCase());
        made.push(Store.add('shopping', { name, checked: false }).id);
      });
      if (!made.length) return { ok: true, text: 'Already on your shopping list' };
      return { ok: true, text: `Added ${plural(made.length, 'item', 'items')} to your shopping list`, undo: () => made.forEach((id) => Store.remove('shopping', id)) };
    }
    const date = dateOverride || p.date;
    if (!isValidDate(date) || date < todayStr()) return fail('Pick a date first.');
    const title = cleanText(p.title, 120); if (!title) return fail('That has no title.');
    const time = p.time && isValidTime(p.time) ? p.time : '';
    const category = ok(p.category, CATEGORIES.map((c) => c.key), 'personal');
    const priority = ok(p.priority, ['low', 'medium', 'high', 'urgent'], 'medium');
    const repeat = ok(p.repeat, ['', 'daily', 'weekly', 'monthly', 'yearly'], '');
    const isTask = p.kind === 'task';
    const col = isTask ? 'tasks' : 'reminders';
    const dupe = Store.state[col].some((x) => x.title.toLowerCase() === title.toLowerCase() && x.date === date && !(x.completed || x.done) && (isTask || x.kind === p.kind));
    if (dupe) return { ok: true, text: 'That’s already in your planner' };
    const item = isTask
      ? Store.add('tasks', { title, priority, category, repeat, date, time, completed: false, completedOn: '', completedAt: '' })
      : Store.add('reminders', { title, kind: ok(p.kind, ['event', 'reminder', 'bill'], 'reminder'), category, repeat, important: !!p.important, date, time, note: cleanText(p.note, 200), done: false });
    return { ok: true, text: `Added “${title}” on ${dateLabel(date)}`, undo: () => Store.remove(col, item.id) };
  }

  /** Run action i of a message and remember the result (for the card and the Undo button). */
  function apply(msgId, i, dateOverride) {
    const m = ui.messages.find((x) => x.id === msgId); const p = m && m.proposals && m.proposals[i];
    if (!p || isDone(msgId, i)) return null;
    let r;
    try { r = runAction(p, dateOverride); } catch (err) { console.warn('[DAYMATE] AI action failed:', err); r = fail('Something went wrong with that one.'); }
    if (r.ok) { markDone(msgId, i); ui.undo[key(msgId, i)] = r.undo || null; ui[`txt:${key(msgId, i)}`] = r.text; }
    else ui[`err:${key(msgId, i)}`] = r.msg;
    return r;
  }
  /** Adds, edits and tick-offs happen immediately (with Undo). Deletes and anything missing a date wait for the person. */
  function autoApply(msg) {
    const props = msg.proposals || [];
    const ready = props.map((p, i) => [p, i]).filter(([p, i]) => opOf(p) !== 'delete' && !p.needs_clarification && !p.ask_date && !isDone(msg.id, i));
    if (!ready.length || ready.length > AUTO_APPLY_MAX) return;
    const undos = []; let n = 0;
    ready.forEach(([, i]) => { const r = apply(msg.id, i); if (r && r.ok) { n += 1; if (r.undo) undos.push([i, r.undo]); } });
    if (n) say(`${plural(n, 'change', 'changes')} made`, undos.length ? { action: { label: 'Undo', fn: () => { undos.reverse().forEach(([i, fn]) => undoOne(msg.id, i, fn)); DM.views.renderAll(); } } } : undefined);
  }
  function undoOne(msgId, i, fn) {
    try { (fn || ui.undo[key(msgId, i)])(); } catch (_) { /* already gone */ }
    delete ui.undo[key(msgId, i)]; unmarkDone(msgId, i);
  }

  /** Kept for the tests and for messages from older chats: add a suggestion the old way. */
  function addProposal(msgId, idx, dateOverride) { const r = apply(msgId, idx, dateOverride); if (r && !r.ok) UI.toast(r.msg); return !!(r && r.ok); }

  /* ---------------- rendering ---------------- */
  function whenLine(t) { return t && t.date ? `${dateLabel(t.date)}${t.time ? ` · ${t.time}` : ''}` : ''; }
  function proposalCard(msgId, p, i) {
    if (ui.skipped.has(key(msgId, i))) return '';
    const op = opOf(p); const done = isDone(msgId, i);
    const needsDate = op === 'add' ? (!p.date && p.kind !== 'shopping') : !!p.ask_date;
    const err = ui[`err:${key(msgId, i)}`];
    const canUndo = done && typeof ui.undo[key(msgId, i)] === 'function';
    const opLabel = { add: KINDS[p.kind] || 'Task', update: 'Change', delete: 'Delete', complete: p.kind === 'shopping' ? 'Tick off' : 'Done' }[op];
    const chipCls = op === 'delete' ? 'pl-chip pl-chip--urgent' : 'pl-chip pl-chip--cat';
    let main = '';
    if (op === 'add' && p.kind === 'shopping') {
      main = `<strong class="ai-prop__title">${icon('basket')} ${esc((p.items && p.items.length ? p.items : [p.title]).join(', '))}</strong>
        <p class="ai-prop__when">Add to your shopping list</p>`;
    } else if (op === 'add') {
      main = `<strong class="ai-prop__title">${p.important ? '★ ' : ''}${esc(p.title)}</strong>
        ${needsDate
    ? `<p class="ai-prop__q">${esc(p.needs_clarification || 'Which day should this be on?')}</p>${done ? '' : `<input class="input ai-prop__date" type="date" min="${todayStr()}" aria-label="Choose a date for ${esc(p.title)}">`}`
    : `<p class="ai-prop__when">${icon('calendar')} ${esc(dateLabel(p.date))}${p.time ? ` · ${esc(p.time)}` : ' · all day'}${p.date_basis ? `<small> (${esc(p.date_basis)})</small>` : ''}</p>`}`;
    } else {
      const t = p.target || {};
      const ch = p.changes || {};
      const lines = [];
      if (ch.date) lines.push(`${icon('calendar')} Move to ${esc(dateLabel(ch.date))}`);
      if (ch.time) lines.push(`${icon('clock')} At ${esc(ch.time)}`);
      if (ch.title || ch.name) lines.push(`Rename to “${esc(ch.title || ch.name)}”`);
      if (ch.priority) lines.push(`Priority: ${esc(PRIORITY_LABEL[ch.priority] || ch.priority)}`);
      if (ch.note) lines.push(`Note: ${esc(ch.note)}`);
      main = `<strong class="ai-prop__title">${esc(t.title || p.title)}</strong>
        ${whenLine(t) ? `<p class="ai-prop__was">Currently ${esc(whenLine(t))}</p>` : ''}
        ${op === 'update' ? `<p class="ai-prop__when">${lines.join('<br>') || ''}</p>` : ''}
        ${op === 'delete' ? `<p class="ai-prop__warn">This will remove it from your planner. You can undo straight afterwards.</p>` : ''}
        ${needsDate ? `<p class="ai-prop__q">${esc(p.needs_clarification || 'Which day?')}</p>${done ? '' : `<input class="input ai-prop__date" type="date" min="${todayStr()}" aria-label="Choose a new date for ${esc(t.title || '')}">`}` : ''}`;
    }
    const verb = { add: 'Add', update: 'Apply', delete: 'Delete', complete: 'Mark done' }[op];
    const status = done
      ? `<p class="ai-prop__ok">${icon('check')} ${esc(ui[`txt:${key(msgId, i)}`] || (op === 'delete' ? 'Deleted' : op === 'add' ? 'Added to your planner' : 'Done'))}${canUndo ? ' <button type="button" class="link-btn" data-action="ai-undo">Undo</button>' : ''}</p>`
      : `${err ? `<p class="ai-prop__warn">${esc(err)}</p>` : ''}<div class="ai-prop__btns"><button type="button" class="btn ${op === 'delete' ? 'btn--danger' : 'btn--primary'}" data-action="ai-add">${verb}</button><button type="button" class="btn btn--ghost" data-action="ai-skip">${op === 'delete' ? 'Keep it' : 'Skip'}</button></div>`;
    return `
      <li class="ai-prop${done ? ' is-done' : ''}${op === 'delete' ? ' is-delete' : ''}" data-msg="${esc(msgId)}" data-i="${i}">
        <div class="ai-prop__top"><span class="${chipCls}">${esc(opLabel)}</span>
          ${op === 'add' && (p.priority === 'urgent' || p.priority === 'high') ? `<span class="pl-chip pl-chip--${esc(p.priority)}">${esc(PRIORITY_LABEL[p.priority])}</span>` : ''}
          ${op === 'add' && p.kind !== 'shopping' ? `<span class="pl-sub">${esc(catLabel(p.category))}${p.repeat ? ` · ${icon('repeat')} ${esc(p.repeat)}` : ''}</span>` : ''}</div>
        ${main}
        ${p.conflict ? `<p class="ai-prop__warn">⚠ ${esc(p.conflict)}</p>` : ''}
        ${status}
      </li>`;
  }
  /** "Remember this?" — nothing is saved until the person taps Save. */
  function memoryCards(m) {
    const list = (m.memories || []).filter((x) => !ui.memDone.has(x.id));
    if (!list.length) return '';
    return `<ul class="ai-props ai-mems">${list.map((x) => `
      <li class="ai-prop ai-mem" data-mem="${esc(x.id)}" data-msg="${esc(m.id)}">
        <div class="ai-prop__head"><span class="pl-sub">${icon('sparkles')} Remember this?</span></div>
        <p class="ai-mem__text">${esc(x.content)}</p>
        <div class="ai-prop__btns"><button type="button" class="btn btn--primary btn--sm" data-action="ai-mem-save">Save</button><button type="button" class="btn btn--ghost btn--sm" data-action="ai-mem-no">No thanks</button></div>
      </li>`).join('')}</ul>`;
  }
  async function resolveMemory(el, save) {
    const li = el.closest('[data-mem]'); if (!li) return;
    const id = li.dataset.mem;
    const m = ui.messages.find((x) => x.id === li.dataset.msg); const x = m && (m.memories || []).find((y) => y.id === id);
    if (!x) return;
    ui.memDone.add(id);
    if (save) { Store.add('memories', { category: x.category, title: '', content: x.content, source: 'ai', sensitive: false }); say('Saved to Memory'); }
    DM.views.renderAll();
    try { await session.client.from('memory_candidates').update({ status: save ? 'approved' : 'rejected' }).eq('id', id); } catch (_) { /* the candidate stays pending; harmless */ }
  }
  function bubble(m) {
    const props = m.proposals || [];
    const pending = props.filter((p, i) => opOf(p) !== 'delete' && !p.needs_clarification && !p.ask_date && !isDone(m.id, i) && !ui.skipped.has(key(m.id, i)));
    return `
      <li class="ai-msg ai-msg--${m.role}">
        <div class="ai-bubble">${nl(m.content)}</div>
        ${props.length ? `<ul class="ai-props">${props.map((p, i) => proposalCard(m.id, p, i)).join('')}</ul>
          ${pending.length > 1 ? `<button type="button" class="link-btn" data-action="ai-add-all" data-msg="${esc(m.id)}">Apply all ${pending.length}</button>` : ''}` : ''}
        ${memoryCards(m)}
      </li>`;
  }

  function consentCard() {
    return `
      <section class="card ai-consent">
        <div class="empty__art">${icon('sparkles')}</div>
        <h2>Before you chat with Daymate AI</h2>
        <p>The assistant works by sending to an AI service (Google Gemini):</p>
        <ul>
          <li>what you type to it,</li>
          <li>your tasks, appointments, reminders and shopping list for the next week (30 days on Premium), plus anything overdue,</li>
          <li>on Premium, the memories you’ve saved, <strong>except any marked Sensitive</strong>.</li>
        </ul>
        <p><strong>Please note:</strong> while DAYMATE uses Google’s free developer tier, Google may use this content to improve its products. Don’t type anything you wouldn’t want a person at Google to read. The assistant can add and change things in your planner for you, always with an Undo, and it asks you to confirm before it deletes anything.</p>
        <p class="fine">You can delete any chat afterwards, and nothing is sent unless you press Send. <a href="privacy.html">Privacy policy</a></p>
        <div class="ai-consent__btns"><button type="button" class="btn btn--primary" data-action="ai-consent">I understand, turn it on</button><a class="btn btn--ghost" href="#/more" data-action="ai-close">Not now</a></div>
      </section>`;
  }
  function historyPanel() {
    if (ui.history === null) return `<p class="fine">Loading chats…</p>`;
    if (!ui.history.length) return `<p class="fine">No saved chats yet.</p>`;
    return `<ul class="ai-hist">${ui.history.map((c) => `<li data-id="${esc(c.id)}"><button type="button" class="ai-hist__open" data-action="ai-open">${esc(c.title || 'Chat')}<small>${esc(new Date(c.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}</small></button><button type="button" class="icon-btn icon-btn--danger" data-action="ai-delete" aria-label="Delete chat: ${esc(c.title || 'Chat')}">${icon('trash')}</button></li>`).join('')}</ul>`;
  }

  /** Draws the chat into `host` (the full-screen view or the floating sheet — only one is ever filled at a time). */
  function render(host) {
    const uid = session.user ? session.user.id : '';
    if (ui.userId !== uid) { Object.assign(ui, { userId: uid, mode: 'loading', consent: null, convId: '', messages: [], history: null, showHistory: false, error: '', draft: '', used: null, limit: null, skipped: new Set(), memDone: new Set(), busy: false, undo: {} }); }
    const prev = $('#aiInput', host); if (prev && !ui.keepDraft) ui.draft = prev.value; ui.keepDraft = false;
    const hadFocus = !!prev && document.activeElement === prev;
    const list = $('#aiMsgs', host); const nearBottom = list ? list.scrollHeight - list.scrollTop - list.clientHeight < 120 : true;
    let body;
    if (!Account.configured || !session.user) {
      body = `<div class="empty"><div class="empty__art">${icon('sparkles')}</div><h3>Sign in to use the assistant</h3><p>The assistant keeps your chats in your account, so it needs you to be signed in.</p><button type="button" class="btn btn--primary" data-action="open-auth" data-mode="signin">Sign in or create an account</button></div>`;
    } else if (ui.mode === 'loading') {
      body = `<p class="fine ai-center">Loading…</p>`;
      if (!ui.loading) { ui.loading = true; loadConsent().finally(() => { ui.loading = false; }); }
    } else if (ui.mode === 'error') {
      body = `<div class="empty"><h3>Couldn’t load</h3><p>Check your connection and try again.</p><button type="button" class="btn btn--primary" data-action="ai-retry">Try again</button></div>`;
    } else if (!ui.consent) {
      body = consentCard();
    } else {
      const left = ui.limit != null ? Math.max(0, ui.limit - ui.used) : null;
      body = `
        <div class="ai-bar">
          <button type="button" class="pl-today" data-action="ai-new">New chat</button>
          <button type="button" class="pl-today" data-action="ai-history" aria-expanded="${ui.showHistory}">History</button>
          <span class="ai-left">${left != null ? `${plural(left, 'message', 'messages')} left today` : ''}</span>
        </div>
        ${ui.showHistory ? `<section class="card">${historyPanel()}</section>` : ''}
        <ul class="ai-msgs" id="aiMsgs" aria-live="polite">
          ${ui.messages.length ? ui.messages.map(bubble).join('') : `
            <li class="ai-hello"><div class="ai-hello__art">${icon('sparkles')}</div><h3>How can I help?</h3>
              <p>Tell me what you need in your own words. I can add and change events, tasks, reminders and your shopping list, and answer questions about your day.</p>
              <div class="ai-starters">${STARTERS.map((s, n) => `<button type="button" class="chip" data-action="ai-starter" data-n="${n}">${esc(s.label)}</button>`).join('')}</div></li>`}
          ${ui.busy ? `<li class="ai-msg ai-msg--assistant"><div class="ai-bubble ai-typing" aria-label="Daymate AI is thinking"><i></i><i></i><i></i></div></li>` : ''}
        </ul>
        ${ui.error ? `<p class="field__error ai-error" role="alert">${esc(ui.error)}</p>` : ''}
        <form class="ai-form" id="aiForm" novalidate>
          <label class="sr-only" for="aiInput">Message Daymate AI</label>
          <textarea class="input" id="aiInput" rows="1" maxlength="1000" placeholder="Ask or tell Daymate AI something…" enterkeyhint="send" ${ui.busy ? 'disabled' : ''}></textarea>
          <button type="submit" class="btn btn--primary ai-send" ${ui.busy ? 'disabled' : ''} aria-label="Send">${icon('send')}</button>
        </form>
        <p class="fine ai-note">${ui.plan === 'premium' ? 'Premium: smarter suggestions use your saved memories.' : 'Free plan: 10 messages a day. Premium allows 100 a day, memory-aware suggestions and a 30-day view.'} AI can make mistakes. Check dates.</p>`;
    }
    host.innerHTML = `<div class="ai">${body}</div>`;
    const input = $('#aiInput', host);
    if (input) { input.value = ui.draft; ui.draft = ''; autosize(input); if ((hadFocus || ui.focusInput) && !ui.busy) { input.focus(); ui.focusInput = false; } }
    const msgs = $('#aiMsgs', host);
    if (msgs && (ui.stick || nearBottom)) { msgs.scrollTop = msgs.scrollHeight; if (ui.stick) { const last = msgs.lastElementChild; if (last && ui.messages.length) last.scrollIntoView({ block: 'nearest' }); ui.stick = false; } }
  }
  const autosize = (el) => { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 120)}px`; };

  /* ---------------- the floating button + sheet ---------------- */
  const fab = document.createElement('button');
  fab.type = 'button'; fab.className = 'ai-fab'; fab.id = 'aiFab'; fab.setAttribute('aria-label', 'Open Daymate AI'); fab.setAttribute('aria-haspopup', 'dialog');
  fab.innerHTML = `<span class="ai-fab__glow" aria-hidden="true"></span>${icon('sparkles')}<span class="ai-fab__label">Ask AI</span>`;
  const sheet = document.createElement('div');
  sheet.className = 'ai-sheet'; sheet.id = 'aiSheet'; sheet.hidden = true;
  sheet.innerHTML = `
    <div class="ai-sheet__scrim" data-action="ai-sheet-close"></div>
    <div class="ai-sheet__panel" role="dialog" aria-modal="true" aria-labelledby="aiSheetTitle">
      <header class="ai-sheet__head">
        <span class="ai-sheet__logo" aria-hidden="true">${icon('sparkles')}</span>
        <div class="ai-sheet__titles"><h2 id="aiSheetTitle">Daymate AI</h2><p>Your planning assistant</p></div>
        <button type="button" class="icon-btn" data-action="ai-sheet-close" aria-label="Minimise Daymate AI">${icon('x')}</button>
      </header>
      <div class="ai-sheet__body" id="aiSheetBody"></div>
    </div>`;
  document.body.append(fab, sheet);
  const sheetBody = sheet.querySelector('#aiSheetBody');
  const panel = sheet.querySelector('.ai-sheet__panel');
  const routeHost = () => document.getElementById('view-assistant');
  const onAssistantRoute = () => DM.route === 'assistant';

  /** On phones, keep the panel exactly the size of what's visible, so the keyboard never covers the message box. */
  function fit() {
    const vv = window.visualViewport;
    if (!ui.sheetOpen) return;
    panel.style.setProperty('--vvh', `${vv ? Math.round(vv.height) : window.innerHeight}px`);
    panel.style.setProperty('--vvt', `${vv ? Math.round(vv.offsetTop) : 0}px`);
  }
  if (window.visualViewport) { window.visualViewport.addEventListener('resize', fit); window.visualViewport.addEventListener('scroll', fit); }

  function openSheet() {
    if (ui.sheetOpen) return;
    if (onAssistantRoute()) return;                  // already on the full-screen version
    ui.sheetOpen = true; ui.focusInput = !matchMedia('(max-width: 699px)').matches; ui.stick = true;
    const r = routeHost(); if (r) r.innerHTML = '';
    sheet.hidden = false; fit();
    document.body.classList.add('ai-open');
    fab.setAttribute('aria-expanded', 'true');
    renderSheet();
    requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add('is-open')));
  }
  function closeSheet() {
    if (!ui.sheetOpen) return;
    ui.sheetOpen = false;
    sheet.classList.remove('is-open'); document.body.classList.remove('ai-open'); fab.setAttribute('aria-expanded', 'false');
    const active = document.activeElement; if (active && sheet.contains(active)) active.blur();
    setTimeout(() => { if (!ui.sheetOpen) { sheet.hidden = true; sheetBody.innerHTML = ''; } }, 280);
    fab.focus({ preventScroll: true });
  }
  function renderSheet() { if (ui.sheetOpen) render(sheetBody); }

  /** The button is shown on the main screens, hidden while another sheet/modal is open or on the full-screen assistant. */
  function syncFab() { fab.hidden = onAssistantRoute() || document.body.classList.contains('is-locked') && !ui.sheetOpen; }
  new MutationObserver(syncFab).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('hashchange', () => { if (onAssistantRoute() && ui.sheetOpen) closeSheet(); setTimeout(syncFab, 0); });

  fab.addEventListener('click', openSheet);
  document.addEventListener('keydown', (e) => {
    if (!ui.sheetOpen) return;
    if (e.key === 'Escape' && !document.body.classList.contains('is-locked')) { e.preventDefault(); closeSheet(); }
    if (e.key === 'Tab') {                         // keep keyboard focus inside the open sheet
      const f = [...sheet.querySelectorAll('button:not([disabled]), a[href], textarea:not([disabled]), input:not([disabled])')].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  // Starting to sign in / reaching another screen from inside the sheet hands over to that screen.
  document.addEventListener('click', (e) => { if (ui.sheetOpen && e.target.closest('#aiSheet [data-action="open-auth"]')) closeSheet(); }, true);

  /* ---------------- events ---------------- */
  document.addEventListener('submit', (e) => {
    if (e.target.id !== 'aiForm') return;
    e.preventDefault();
    const input = $('#aiInput', e.target); const text = input ? input.value.trim() : '';
    if (!text || ui.busy) return;
    input.value = '';
    send(text);
  });
  document.addEventListener('input', (e) => { if (e.target.id === 'aiInput') autosize(e.target); });
  document.addEventListener('keydown', (e) => {
    if (e.target.id === 'aiInput' && e.key === 'Enter' && !e.shiftKey && window.matchMedia('(min-width: 700px)').matches) { e.preventDefault(); e.target.form.requestSubmit(); }
  });
  const ctx = (el) => { const li = el.closest('.ai-prop'); return li ? { msg: li.dataset.msg, i: Number(li.dataset.i), li } : null; };
  const chatVisible = () => ui.sheetOpen || DM.route === 'assistant';
  const say = (text, opts) => { if (!chatVisible()) UI.toast(text, opts); };
  const view = (label) => ({ action: { label, fn: () => { window.location.hash = '#/planner'; } } });
  DM.registerActions({
    'ai-consent': () => grantConsent(),
    'ai-retry': () => { ui.mode = 'loading'; DM.views.renderAll(); },
    'ai-new': () => { ui.convId = ''; ui.messages = []; ui.error = ''; ui.showHistory = false; DM.views.renderAll(); },
    'ai-history': () => { ui.showHistory = !ui.showHistory; if (ui.showHistory) loadHistory(); else DM.views.renderAll(); },
    'ai-open': (el) => { const li = el.closest('[data-id]'); if (li) openConversation(li.dataset.id); },
    'ai-delete': (el) => { const li = el.closest('[data-id]'); if (li) deleteConversation(li.dataset.id); },
    'ai-starter': (el) => {
      if (ui.busy) return;
      const s = STARTERS[Number(el.dataset.n)]; if (!s) return;
      if (s.fill) { ui.draft = s.fill; ui.keepDraft = true; ui.focusInput = true; DM.views.renderAll(); } else send(s.text);
    },
    'ai-mem-save': (el) => resolveMemory(el, true),
    'ai-mem-no': (el) => resolveMemory(el, false),
    'ai-skip': (el) => { const c = ctx(el); if (c) { ui.skipped.add(key(c.msg, c.i)); DM.views.renderAll(); } },
    'ai-undo': (el) => { const c = ctx(el); if (c) { undoOne(c.msg, c.i); say('Undone'); DM.views.renderAll(); } },
    'ai-add': (el) => {
      const c = ctx(el); if (!c) return;
      const dateInput = c.li.querySelector('.ai-prop__date');
      const r = apply(c.msg, c.i, dateInput ? dateInput.value : '');
      if (r && r.ok) say(r.text, view('View'));
      else if (r) say(r.msg);
      DM.views.renderAll();
    },
    'ai-add-all': (el) => {
      const m = ui.messages.find((x) => x.id === el.dataset.msg); if (!m) return;
      let n = 0;
      (m.proposals || []).forEach((p, i) => { if (opOf(p) !== 'delete' && !p.needs_clarification && !p.ask_date && !isDone(m.id, i)) { const r = apply(m.id, i); if (r && r.ok) n += 1; } });
      if (n) say(`${plural(n, 'change', 'changes')} made`, view('View'));
      DM.views.renderAll();
    },
    'ai-close': () => closeSheet(),
    'ai-sheet-close': () => closeSheet(),
    'open-ai': () => openSheet(),
  });
  DM.registerRoute('assistant', { render });
  DM.onRender(() => { syncFab(); if (ui.sheetOpen) renderSheet(); });
  syncFab();
  window.__daymateAssistant = { ui, addProposal, openSheet, closeSheet };    // used by the tests
}

/** Pull the helper functions out of the bridge once, with a safe fallback for nowIso. */
function helpers(DM) {
  const h = DM.helpers;
  return { ...h, nowISO: h.nowISO };
}
