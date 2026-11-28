/* ==========================================================================
   DAYMATE — Household (Stage 6)
   Notes, key dates and chores, stored in the existing `household_info` table and kept local-first
   like everything else. Everything here belongs to the signed-in user only; nothing is shared.
   ========================================================================== */
import { CHORE_EVERY, DATE_REPEATS, LIMITS, choreStatus, completeChore, dateInfo, everyLabel, overview, sortChores, sortDates, whenLabel, normalise } from './household-logic.js';

const STARTERS = {
  chore: [['Take the bins out', 'weekly'], ['Change the bedding', 'weekly'], ['Clean the bathroom', 'weekly'], ['Hoover downstairs', 'weekly']],
  date: [['Car MOT', 'yearly'], ['Car tax', 'yearly'], ['Boiler service', 'yearly'], ['Birthday', 'yearly']],
  note: [['Bin day', ''], ['Wifi', ''], ['Meter readings', ''], ['Handy numbers', '']],
};
const COPY = {
  chore: { one: 'chore', title: 'Chore', ph: 'e.g. Take the bins out', dateLabel: 'Next due (optional)', repLabel: 'How often', textLabel: 'Details (optional)', textHint: '' },
  date: { one: 'date', title: 'Key date', ph: 'e.g. Car MOT', dateLabel: 'Date', repLabel: 'Repeat', textLabel: 'Details (optional)', textHint: '' },
  note: { one: 'note', title: 'Note', ph: 'e.g. Wifi', dateLabel: '', repLabel: '', textLabel: 'Note', textHint: 'Anything you want to find quickly. Keep passwords somewhere safe: this is saved to your account.' },
};

export function initHousehold(DM) {
  const { Store, UI, Modal } = DM;
  const { $, esc, icon, cleanText, cleanMultiline, todayStr, longDate, plural, isValidDate } = DM.helpers;
  const form = $('#hhForm');
  if (!form) return;
  let sheet = null;                                   // { kind, id }

  const items = (kind) => Store.state.household.filter((i) => i.kind === kind);
  const shoppingLeft = () => Store.state.shopping.filter((i) => !i.checked).length;

  /* ---------------------------- screen ---------------------------- */
  const dateText = (d) => {
    try { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); } catch (_) { return d; }
  };

  const shortDate = (d) => { try { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); } catch (_) { return d; } };

  function choreRow(c, today) {
    const st = choreStatus(c, today);
    const label = st.state === 'done' ? 'Done' : st.state === 'anytime' ? '' : whenLabel(st.days);
    const meta = [c.every ? everyLabel(c.every) : '', c.lastDone ? `Last done ${shortDate(c.lastDone)}` : ''].filter(Boolean).join(' · ');
    return `<li class="hh-row hh-row--${st.state}" data-id="${esc(c.id)}">
      <button type="button" class="check${st.state === 'done' ? ' is-on' : ''}" role="checkbox" aria-checked="${st.state === 'done'}" data-action="hh-done" aria-label="${st.state === 'done' ? 'Reopen' : 'Mark done'}: ${esc(c.title)}">${icon('check')}</button>
      <button type="button" class="hh-row__main" data-action="hh-edit" aria-label="Edit ${esc(c.title)}">
        <span class="hh-row__title">${esc(c.title)}</span>
        ${meta ? `<span class="hh-row__meta">${esc(meta)}</span>` : ''}
      </button>
      ${label ? `<span class="hh-badge hh-badge--${st.state}">${esc(label)}</span>` : ''}
    </li>`;
  }
  function dateRow(d, today) {
    const info = dateInfo(d, today);
    const label = info.next ? whenLabel(info.days) : 'Passed';
    return `<li class="hh-row hh-row--${info.state}" data-id="${esc(d.id)}">
      <span class="hh-date" aria-hidden="true">${icon('calendar')}</span>
      <button type="button" class="hh-row__main" data-action="hh-edit" aria-label="Edit ${esc(d.title)}">
        <span class="hh-row__title">${esc(d.title)}</span>
        <span class="hh-row__meta">${esc(dateText(info.next || d.date))}${d.repeat ? ` · ${d.repeat === 'yearly' ? 'every year' : 'every month'}` : ''}</span>
      </button>
      <span class="hh-badge hh-badge--${info.state === 'past' ? 'done' : info.state}">${esc(label)}</span>
    </li>`;
  }
  function noteCard(n) {
    return `<li class="hh-note" data-id="${esc(n.id)}"><button type="button" class="hh-note__btn" data-action="hh-edit" aria-label="Edit ${esc(n.title)}">
      <strong>${esc(n.title)}</strong>${n.text ? `<span>${esc(n.text)}</span>` : '<span class="hh-note__empty">Tap to add details</span>'}
    </button></li>`;
  }
  const starters = (kind) => `<div class="hh-starters" aria-label="Quick starts">${STARTERS[kind].map(([t, r]) => `<button type="button" class="chip" data-action="hh-new" data-kind="${kind}" data-title="${esc(t)}" data-repeat="${r}">${esc(t)}</button>`).join('')}</div>`;
  const section = (kind, heading, body, count) => `<section class="section hh-sec" aria-labelledby="hh-h-${kind}">
      <div class="section__head"><h2 id="hh-h-${kind}">${heading}${count ? `<span class="hh-count">${count}</span>` : ''}</h2><button type="button" class="chip-btn" data-action="hh-new" data-kind="${kind}">${icon('plus')}Add</button></div>${body}</section>`;

  function chip(n, label, cls = '') { return `<div class="sumchip ${cls}"><strong>${n}</strong><small>${esc(label)}</small></div>`; }

  function render(host) {
    const today = todayStr();
    const all = Store.state.household;
    const o = overview(all, today, shoppingLeft());
    const chores = sortChores(items('chore'), today), dates = sortDates(items('date'), today), notes = items('note').sort((a, b) => a.title.localeCompare(b.title));
    let headline;
    if (o.empty) headline = 'Start with one thing: a chore, a date you mustn’t forget, or a note you’re always hunting for.';
    else if (o.overdue) headline = `${plural(o.overdue, 'chore is', 'chores are')} overdue.`;
    else if (o.dueToday) headline = `${plural(o.dueToday, 'chore', 'chores')} to do today.`;
    else if (o.open) headline = 'Nothing’s overdue. Nice and steady.';
    else if (o.doneChores) headline = 'Every chore is done. Enjoy the quiet.';
    else headline = 'Your home at a glance.';
    const next = o.nextDate ? `<button type="button" class="hh-next" data-action="hh-edit" data-id="${esc(o.nextDate.d.id)}">${icon('calendar')}<span><small>Next key date</small><strong>${esc(o.nextDate.d.title)}</strong> · ${esc(whenLabel(o.nextDate.info.days).toLowerCase())}</span></button>` : '';
    host.innerHTML = `<div class="hh">
      <section class="card hh-over" aria-label="Household overview">
        <div class="hh-over__top"><span class="hh-over__ico">${icon('sofa')}</span><div><h2>Your home</h2><p>${esc(headline)}</p></div></div>
        <div class="sumrow hh-sum">
          ${chip(o.overdue + o.dueToday, 'Chores due', o.overdue ? 'is-alert' : '')}${chip(o.datesSoon, 'Dates in 14 days')}${chip(o.notes, 'Notes')}
        </div>
        ${next}
        <button type="button" class="hh-shop" data-action="open-shopping">${icon('basket')}<span>Shopping list</span><em>${shoppingLeft() ? `${shoppingLeft()} to buy` : 'Nothing to buy'}</em>${icon('chevron')}</button>
      </section>
      ${section('chore', 'Chores', chores.length ? `<ul class="hh-list">${chores.map((c) => choreRow(c, today)).join('')}</ul>` : `<div class="card hh-empty"><p>Recurring jobs that never slip through the cracks.</p>${starters('chore')}</div>`, chores.length)}
      ${section('date', 'Key dates', dates.length ? `<ul class="hh-list">${dates.map((d) => dateRow(d, today)).join('')}</ul>` : `<div class="card hh-empty"><p>MOTs, renewals, birthdays: get a heads-up before they sneak up.</p>${starters('date')}</div>`, dates.length)}
      ${section('note', 'Home notes', notes.length ? `<ul class="hh-notes">${notes.map(noteCard).join('')}</ul>` : `<div class="card hh-empty"><p>Bin days, meter readings, who to ring when the boiler dies.</p>${starters('note')}</div>`, notes.length)}
      <h3 class="group-title">With Premium</h3>
      <ul class="features">${['meal-planning', 'household-advanced'].map((f) => { const x = DM.FEATURES[f]; return `<li><button type="button" class="feature feature--premium" data-action="open-premium" data-feature="${f}"><span class="feature__icon">${icon(x.icon)}</span><span class="feature__text"><strong>${esc(x.title)}</strong><small>${esc(x.text)}</small></span><span class="feature__side"><span class="badge badge--premium">${icon('lock')}Premium · Soon</span>${icon('chevron', 'feature__chev')}</span></button></li>`; }).join('')}</ul>
    </div>`;
  }
  DM.registerRoute('household', { render });

  /* ---------------------------- sheet ---------------------------- */
  const fields = { title: $('#hhTitle'), date: $('#hhDate'), repeat: $('#hhRepeat'), text: $('#hhText') };
  const setErr = (id, msg) => { $(id).textContent = msg || ''; };

  function openSheet(kind, { id = '', title = '', repeat = '' } = {}) {
    const cur = id ? Store.get('household', id) : null;
    if (id && !cur) return;
    kind = cur ? cur.kind : kind;
    sheet = { kind, id };
    const c = COPY[kind];
    $('#hhSheetTitle').textContent = cur ? `Edit ${c.one}` : `New ${c.one}`;
    $('#hhTitleLabel').textContent = c.title; fields.title.placeholder = c.ph;
    $('#hhDateField').hidden = kind === 'note'; $('#hhRepeatField').hidden = kind === 'note';
    $('#hhDateLabel').textContent = c.dateLabel; $('#hhRepeatLabel').textContent = c.repLabel;
    $('#hhTextLabel').textContent = c.textLabel; $('#hhTextHint').textContent = c.textHint; $('#hhTextHint').hidden = !c.textHint;
    fields.text.maxLength = kind === 'note' ? LIMITS.value : 300; fields.text.rows = kind === 'note' ? 6 : 3;
    fields.repeat.innerHTML = (kind === 'chore' ? CHORE_EVERY : DATE_REPEATS).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('');
    fields.title.value = cur ? cur.title : title;
    fields.date.value = cur ? (cur.date || cur.due || '') : (kind === 'date' ? '' : '');
    fields.repeat.value = cur ? (cur.repeat || cur.every || '') : repeat;
    fields.text.value = cur ? cur.text : '';
    setErr('#hhTitleError'); setErr('#hhDateError');
    $('#hhDelete').hidden = !cur; $('#hhSave').textContent = cur ? 'Save' : `Add ${c.one}`;
    Modal.open('m-household', { focus: title && !cur ? '#hhDate' : '#hhTitle' });
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!sheet) return;
    const kind = sheet.kind;
    const title = cleanText(fields.title.value, LIMITS.title);
    const text = cleanMultiline(fields.text.value, kind === 'note' ? LIMITS.value : 300);
    setErr('#hhTitleError'); setErr('#hhDateError');
    if (!title) { setErr('#hhTitleError', `Give your ${COPY[kind].one} a name.`); fields.title.focus(); return; }
    const date = fields.date.value;
    let rec;
    if (kind === 'note') rec = { kind, title, text };
    else if (kind === 'date') {
      if (!isValidDate(date)) { setErr('#hhDateError', 'Pick a date.'); fields.date.focus(); return; }
      rec = { kind, title, text, date, repeat: fields.repeat.value };
    } else {
      if (date && !isValidDate(date)) { setErr('#hhDateError', 'That date doesn’t look right.'); fields.date.focus(); return; }
      const every = fields.repeat.value;
      const prev = sheet.id ? Store.get('household', sheet.id) : null;
      rec = { kind, title, text, every, due: date || (every && !prev ? todayStr() : (prev && prev.due && every ? prev.due : '')), lastDone: prev ? prev.lastDone : '', done: prev && !every ? !!prev.done : false };
    }
    const clean = normalise(rec);
    if (!clean) { setErr('#hhTitleError', 'Something’s missing. Check the details.'); return; }
    if (sheet.id) Store.update('household', sheet.id, clean); else Store.add('household', clean);
    Modal.close('m-household');
    UI.toast(sheet.id ? 'Saved' : `${COPY[kind].title} added`);
    sheet = null;
  });

  DM.registerActions({
    'hh-new': (el) => openSheet(el.dataset.kind || 'chore', { title: el.dataset.title || '', repeat: el.dataset.repeat || '' }),
    'hh-edit': (el) => { const id = el.dataset.id || (el.closest('[data-id]') || {}).dataset.id; if (id) openSheet('', { id }); },
    'hh-delete': () => {
      if (!sheet || !sheet.id) return;
      const r = Store.remove('household', sheet.id);
      Modal.close('m-household'); sheet = null;
      if (r) UI.toast(`Deleted “${r.item.title}”`, { action: { label: 'Undo', fn: () => Store.restore('household', r.item, r.index) } });
    },
    'hh-done': (el) => {
      const li = el.closest('[data-id]'); const c = li && Store.get('household', li.dataset.id);
      if (!c || c.kind !== 'chore') return;
      const today = todayStr();
      if (c.done) { Store.update('household', c.id, { done: false }); return; }
      const before = { done: c.done, lastDone: c.lastDone, due: c.due };
      Store.update('household', c.id, completeChore(c, today));
      UI.toast(c.every ? `Done. Next: ${whenLabel(Math.round((Date.parse(`${Store.get('household', c.id).due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000)).toLowerCase()}` : `“${c.title}” done`, { action: { label: 'Undo', fn: () => Store.update('household', c.id, before) } });
    },
  });
}
