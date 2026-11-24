/* ==========================================================================
   DAYMATE — AI assistant screen

   • Needs an account (the AI runs on the server, never in the browser — the
     provider key is a server secret) and the person's one-time agreement.
   • The assistant only SUGGESTS. Nothing reaches the planner until the person
     taps Add on a suggestion, and anything without a clear date asks for one.
   • Chats are saved to the account (Settings → delete any time).
   ========================================================================== */
import { session } from './session.js';

const DONE_KEY = 'daymate:aiDone';
const KINDS = { task: 'Task', event: 'Appointment', reminder: 'Reminder', bill: 'Bill' };
const ERR = {
  ai_not_configured: 'The assistant isn’t switched on yet. It needs an AI key adding on the server.',
  provider_busy: 'The AI service is busy right now. Please try again in a minute.',
  provider_error: 'The AI service had a problem. Nothing was used from your allowance. Please try again.',
  unauthorised: 'Please sign in again to use the assistant.',
  too_long: 'That message is a bit long. Keep it under 1,000 characters.',
};

export function initAssistant(DM) {
  const { Store, Account, UI, Modal, helpers, confirmDialog, CATEGORIES, PRIORITY_LABEL } = DM;
  const { $, esc, icon, plural, todayStr, parseDate, isValidDate, isValidTime, cleanText, safeLS } = helpers;
  const ui = { mode: 'loading', consent: null, convId: '', messages: [], busy: false, history: null, showHistory: false, skipped: new Set(), userId: '', used: null, limit: null, plan: 'free', error: '', draft: '', stick: true };
  const catLabel = (k) => (CATEGORIES.find((c) => c.key === k) || CATEGORIES[0]).label;

  const doneMap = () => { try { return JSON.parse(safeLS.get(DONE_KEY) || '{}') || {}; } catch (_) { return {}; } };
  const isDone = (msgId, i) => (doneMap()[msgId] || []).includes(i);
  const markDone = (msgId, i) => { const m = doneMap(); m[msgId] = [...new Set([...(m[msgId] || []), i])]; const ids = Object.keys(m); if (ids.length > 200) delete m[ids[0]]; safeLS.set(DONE_KEY, JSON.stringify(m)); };
  const dateLabel = (d) => parseDate(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const nl = (s) => esc(s).replace(/\n/g, '<br>');

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
  async function send(text) {
    ui.busy = true; ui.error = ''; ui.messages.push({ id: `local-${Date.now()}`, role: 'user', content: text, proposals: null }); ui.stick = true;
    DM.views.renderAll();
    try {
      const { data, error } = await session.client.functions.invoke('assistant', { body: { message: text, conversationId: ui.convId || undefined } });
      if (error) {
        const j = await errorCode(error);
        ui.messages.pop();
        ui.draft = text; ui.keepDraft = true;
        if (j.error === 'consent_required') { ui.consent = false; }
        else if (j.error === 'limit_reached') ui.error = `You’ve used today’s ${j.limit} messages. They reset tomorrow.${j.plan === 'free' ? ' Premium will allow more.' : ''}`;
        else ui.error = ERR[j.error] || (navigator.onLine ? 'Something went wrong. Please try again.' : 'You’re offline. Reconnect and try again.');
      } else {
        ui.convId = data.conversationId; ui.used = data.used; ui.limit = data.limit; ui.plan = data.plan;
        ui.messages.push({ id: data.messageId, role: 'assistant', content: data.reply, proposals: data.proposals && data.proposals.length ? data.proposals : null });
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

  /* ---------------- adding suggestions to the planner ---------------- */
  const ok = (v, list, d) => (list.includes(v) ? v : d);
  function addProposal(msgId, idx, dateOverride) {
    const m = ui.messages.find((x) => x.id === msgId); const p = m && m.proposals && m.proposals[idx];
    if (!p || isDone(msgId, idx)) return false;
    const date = dateOverride || p.date;
    if (!isValidDate(date) || date < todayStr()) { UI.toast('Pick a date first.'); return false; }
    const title = cleanText(p.title, 120); if (!title) return false;
    const time = p.time && isValidTime(p.time) ? p.time : '';
    const category = ok(p.category, CATEGORIES.map((c) => c.key), 'personal');
    const priority = ok(p.priority, ['low', 'medium', 'high', 'urgent'], 'medium');
    const repeat = ok(p.repeat, ['', 'daily', 'weekly', 'monthly', 'yearly'], '');
    const dupe = (kind) => (kind === 'task' ? Store.state.tasks : Store.state.reminders).some((x) => x.title.toLowerCase() === title.toLowerCase() && x.date === date && !(x.completed || x.done));
    if (dupe(p.kind)) { markDone(msgId, idx); UI.toast('That’s already in your planner.'); return true; }
    if (p.kind === 'task') Store.add('tasks', { title, priority, category, repeat, date, time, completed: false, completedOn: '', completedAt: '' });
    else Store.add('reminders', { title, kind: ok(p.kind, ['event', 'reminder', 'bill'], 'reminder'), category, repeat, important: !!p.important, date, time, note: cleanText(p.note, 200), done: false });
    markDone(msgId, idx);
    return true;
  }

  /* ---------------- rendering ---------------- */
  function proposalCard(msgId, p, i) {
    if (ui.skipped.has(`${msgId}:${i}`)) return '';
    const done = isDone(msgId, i);
    const needsDate = !p.date;
    return `
      <li class="ai-prop${done ? ' is-done' : ''}" data-msg="${esc(msgId)}" data-i="${i}">
        <div class="ai-prop__top"><span class="pl-chip pl-chip--cat">${esc(KINDS[p.kind] || 'Task')}</span>
          ${p.priority === 'urgent' || p.priority === 'high' ? `<span class="pl-chip pl-chip--${esc(p.priority)}">${esc(PRIORITY_LABEL[p.priority])}</span>` : ''}
          <span class="pl-sub">${esc(catLabel(p.category))}${p.repeat ? ` · ${icon('repeat')} ${esc(p.repeat)}` : ''}</span></div>
        <strong class="ai-prop__title">${p.important ? '★ ' : ''}${esc(p.title)}</strong>
        ${needsDate
          ? `<p class="ai-prop__q">${esc(p.needs_clarification || 'Which day should this be on?')}</p>
             ${done ? '' : `<input class="input ai-prop__date" type="date" min="${todayStr()}" aria-label="Choose a date for ${esc(p.title)}">`}`
          : `<p class="ai-prop__when">${icon('calendar')} ${esc(dateLabel(p.date))}${p.time ? ` · ${esc(p.time)}` : ' · all day'}${p.date_basis ? `<small> (${esc(p.date_basis)})</small>` : ''}</p>`}
        ${p.conflict ? `<p class="ai-prop__warn">⚠ ${esc(p.conflict)}</p>` : ''}
        ${done ? `<p class="ai-prop__ok">${icon('check')} Added to your planner</p>`
          : `<div class="ai-prop__btns"><button type="button" class="btn btn--primary" data-action="ai-add">Add</button><button type="button" class="btn btn--ghost" data-action="ai-skip">Skip</button></div>`}
      </li>`;
  }
  function bubble(m) {
    const props = m.proposals || [];
    const pending = props.filter((p, i) => p.date && !isDone(m.id, i));
    return `
      <li class="ai-msg ai-msg--${m.role}">
        <div class="ai-bubble">${nl(m.content)}</div>
        ${props.length ? `<ul class="ai-props">${props.map((p, i) => proposalCard(m.id, p, i)).join('')}</ul>
          ${pending.length > 1 ? `<button type="button" class="link-btn" data-action="ai-add-all" data-msg="${esc(m.id)}">Add all ${pending.length} with dates</button>` : ''}` : ''}
      </li>`;
  }
  const STARTERS = ['What’s on today?', 'Help me plan my week', 'I need to go shopping tomorrow, pay my electricity bill Friday and remember my son’s school appointment next Tuesday.', 'What should I do first?'];

  function consentCard() {
    return `
      <section class="card ai-consent">
        <div class="empty__art">${icon('sparkles')}</div>
        <h2>Before you chat with DAYMATE</h2>
        <p>The assistant works by sending to an AI service (Google Gemini):</p>
        <ul>
          <li>what you type to it,</li>
          <li>your tasks, appointments and reminders for the next week (30 days on Premium), plus anything overdue,</li>
          <li>on Premium, the memories you’ve saved, <strong>except any marked Sensitive</strong>.</li>
        </ul>
        <p><strong>Please note:</strong> while DAYMATE uses Google’s free developer tier, Google may use this content to improve its products. Don’t type anything you wouldn’t want a person at Google to read. DAYMATE never lets the AI change your planner by itself. You approve every suggestion.</p>
        <p class="fine">You can delete any chat afterwards, and nothing is sent unless you press Send. <a href="privacy.html">Privacy policy</a></p>
        <div class="ai-consent__btns"><button type="button" class="btn btn--primary" data-action="ai-consent">I understand, turn it on</button><a class="btn btn--ghost" href="#/more">Not now</a></div>
      </section>`;
  }
  function historyPanel() {
    if (ui.history === null) return `<p class="fine">Loading chats…</p>`;
    if (!ui.history.length) return `<p class="fine">No saved chats yet.</p>`;
    return `<ul class="ai-hist">${ui.history.map((c) => `<li data-id="${esc(c.id)}"><button type="button" class="ai-hist__open" data-action="ai-open">${esc(c.title || 'Chat')}<small>${esc(new Date(c.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}</small></button><button type="button" class="icon-btn icon-btn--danger" data-action="ai-delete" aria-label="Delete chat: ${esc(c.title || 'Chat')}">${icon('trash')}</button></li>`).join('')}</ul>`;
  }

  function render(host) {
    const uid = session.user ? session.user.id : '';
    if (ui.userId !== uid) { Object.assign(ui, { userId: uid, mode: 'loading', consent: null, convId: '', messages: [], history: null, showHistory: false, error: '', draft: '', used: null, limit: null, skipped: new Set(), busy: false }); }
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
            <li class="ai-hello"><div class="empty__art">${icon('sparkles')}</div><h3>Ask DAYMATE</h3>
              <p>Tell me what’s on your mind in your own words. I’ll suggest tasks, reminders and appointments, and you choose what to add.</p>
              <div class="ai-starters">${STARTERS.map((s) => `<button type="button" class="chip" data-action="ai-starter" data-text="${esc(s)}">${esc(s.length > 60 ? 'Shopping, bill and school appointment' : s)}</button>`).join('')}</div></li>`}
          ${ui.busy ? `<li class="ai-msg ai-msg--assistant"><div class="ai-bubble ai-typing" aria-label="DAYMATE is thinking"><i></i><i></i><i></i></div></li>` : ''}
        </ul>
        ${ui.error ? `<p class="field__error ai-error" role="alert">${esc(ui.error)}</p>` : ''}
        <form class="ai-form" id="aiForm" novalidate>
          <label class="sr-only" for="aiInput">Message DAYMATE</label>
          <textarea class="input" id="aiInput" rows="2" maxlength="1000" placeholder="Ask or tell DAYMATE something…" ${ui.busy ? 'disabled' : ''}></textarea>
          <button type="submit" class="btn btn--primary ai-send" ${ui.busy ? 'disabled' : ''} aria-label="Send">${icon('send')}</button>
        </form>
        <p class="fine">${ui.plan === 'premium' ? 'Premium: smarter suggestions use your saved memories.' : 'Free plan: 10 messages a day. Premium (not available to buy yet) will add memory-aware suggestions and a 30-day view.'} AI can make mistakes. Check dates before adding.</p>`;
    }
    host.innerHTML = `<div class="ai">${body}</div>`;
    const input = $('#aiInput', host);
    if (input) { input.value = ui.draft; ui.draft = ''; if (hadFocus && !ui.busy) input.focus(); }
    const msgs = $('#aiMsgs', host);
    if (msgs && (ui.stick || nearBottom)) { msgs.scrollTop = msgs.scrollHeight; if (ui.stick) { const last = msgs.lastElementChild; if (last && ui.messages.length) last.scrollIntoView({ block: 'nearest' }); ui.stick = false; } }
  }

  /* ---------------- events ---------------- */
  document.addEventListener('submit', (e) => {
    if (e.target.id !== 'aiForm') return;
    e.preventDefault();
    const input = $('#aiInput'); const text = input ? input.value.trim() : '';
    if (!text || ui.busy) return;
    input.value = '';
    send(text);
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.id === 'aiInput' && e.key === 'Enter' && !e.shiftKey && window.matchMedia('(min-width: 700px)').matches) { e.preventDefault(); $('#aiForm').requestSubmit(); }
  });
  const ctx = (el) => { const li = el.closest('.ai-prop'); return li ? { msg: li.dataset.msg, i: Number(li.dataset.i), li } : null; };
  DM.registerActions({
    'ai-consent': () => grantConsent(),
    'ai-retry': () => { ui.mode = 'loading'; DM.views.renderAll(); },
    'ai-new': () => { ui.convId = ''; ui.messages = []; ui.error = ''; ui.showHistory = false; DM.views.renderAll(); },
    'ai-history': () => { ui.showHistory = !ui.showHistory; if (ui.showHistory) loadHistory(); else DM.views.renderAll(); },
    'ai-open': (el) => { const li = el.closest('[data-id]'); if (li) openConversation(li.dataset.id); },
    'ai-delete': (el) => { const li = el.closest('[data-id]'); if (li) deleteConversation(li.dataset.id); },
    'ai-starter': (el) => { if (!ui.busy) send(el.dataset.text); },
    'ai-skip': (el) => { const c = ctx(el); if (c) { ui.skipped.add(`${c.msg}:${c.i}`); DM.views.renderAll(); } },
    'ai-add': (el) => {
      const c = ctx(el); if (!c) return;
      const dateInput = c.li.querySelector('.ai-prop__date');
      if (addProposal(c.msg, c.i, dateInput ? dateInput.value : '')) { UI.toast('Added to your planner', { action: { label: 'View', fn: () => { window.location.hash = '#/planner'; } } }); DM.views.renderAll(); }
    },
    'ai-add-all': (el) => {
      const m = ui.messages.find((x) => x.id === el.dataset.msg); if (!m) return;
      let n = 0; (m.proposals || []).forEach((p, i) => { if (p.date && !isDone(m.id, i) && addProposal(m.id, i)) n += 1; });
      if (n) UI.toast(`${plural(n, 'item', 'items')} added to your planner`, { action: { label: 'View', fn: () => { window.location.hash = '#/planner'; } } });
      DM.views.renderAll();
    },
  });
  DM.registerRoute('assistant', { render });
  window.__daymateAssistant = { ui, addProposal };    // used by the tests
}
