/* ==========================================================================
   DAYMATE — Memory (foundations)

   What exists today: memories the person types in themselves — add, view,
   edit, delete, search, organise by category, mark as sensitive.
   What does NOT exist yet: any AI. There is no automatic collection. The
   "pause automatic collection" switch is saved (default: paused) so the choice
   is already respected the day an AI engine is connected.

   Architecture for later (see SETUP.md → "Future AI memory"):
     • `memories.source` = 'manual' | 'ai'
     • `memory_candidates` table: a future server function proposes candidates,
       the person approves or rejects each one; only approved ones become memories.
     • Retrieval will be a server function reading `memories` (full-text index
       already exists) behind the `ai-memory` Premium entitlement.
   ========================================================================== */
export function initMemory(DM) {
  const { Store, UI, Modal, Entitlements, helpers, MEMORY_CATEGORIES } = DM;
  const { $, $$, esc, icon, plural, cleanText, cleanMultiline, emptyState } = helpers;
  const ui = { query: '', category: 'all', revealed: new Set() };
  const cat = (k) => MEMORY_CATEGORIES.find((c) => c.key === k) || MEMORY_CATEGORIES[MEMORY_CATEGORIES.length - 1];

  const matches = (m) => {
    if (ui.category !== 'all' && m.category !== ui.category) return false;
    const q = ui.query.trim().toLowerCase();
    if (!q) return true;
    return `${m.title} ${m.content} ${cat(m.category).label}`.toLowerCase().includes(q);
  };

  function card(m) {
    const c = cat(m.category);
    const hidden = m.sensitive && !ui.revealed.has(m.id);
    return `
      <li class="mem" data-id="${esc(m.id)}">
        <span class="mem__icon">${icon(c.icon)}</span>
        <div class="mem__body">
          <p class="mem__cat">${esc(c.label)}${m.sensitive ? ` · ${icon('lock')} Sensitive` : ''}</p>
          ${m.title ? `<p class="mem__title">${esc(m.title)}</p>` : ''}
          ${hidden
            ? `<button type="button" class="mem__reveal" data-action="reveal-memory">Tap to show</button>`
            : `<p class="mem__text">${esc(m.content)}</p>`}
        </div>
        <div class="mem__btns">
          <button type="button" class="icon-btn" data-action="edit-memory" aria-label="Edit memory${m.title ? `: ${esc(m.title)}` : ''}">${icon('pencil')}</button>
          <button type="button" class="icon-btn icon-btn--danger" data-action="delete-memory" aria-label="Delete memory${m.title ? `: ${esc(m.title)}` : ''}">${icon('trash')}</button>
        </div>
      </li>`;
  }

  function render(host) {
    const all = Store.state.memories;
    const paused = Store.state.settings.memoryPaused !== false;
    const shown = all.filter(matches).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const counts = Object.fromEntries(MEMORY_CATEGORIES.map((c) => [c.key, all.filter((m) => m.category === c.key).length]));

    let list;
    if (!all.length) {
      list = `
        <div class="empty">
          <div class="empty__art">${icon('sparkles')}</div>
          <h3>Nothing remembered yet</h3>
          <p>Add the little things you’d like DAYMATE to keep hold of. Try one of these to start:</p>
          <div class="chips chips--center">
            ${[['meal_preferences', 'Favourite meals'], ['household', 'Bin day & wifi'], ['important_dates', 'Birthdays'], ['daily_routines', 'Morning routine']]
              .map(([k, l]) => `<button type="button" class="chip" data-action="add-memory" data-category="${k}">${esc(l)}</button>`).join('')}
          </div>
          <button type="button" class="btn btn--primary" data-action="add-memory">Add a memory</button>
        </div>`;
    } else if (!shown.length) {
      list = emptyState({ iconName: 'sliders', title: 'No matches', text: ui.query ? `Nothing matches “${ui.query}”.` : 'No memories in this category yet.' });
    } else {
      list = `<ul class="mems">${shown.map(card).join('')}</ul>`;
    }

    host.innerHTML = `
      <div class="preview-wrap">
        <section class="card memhead">
          <div class="memhead__top">
            <span class="hero__icon">${icon('sparkles')}</span>
            <div><h2>${plural(all.length, 'memory', 'memories')}</h2><p>${DM.Account.user ? 'Saved to your account.' : 'Saved on this device. Sign in to back them up.'}</p></div>
          </div>
          <label class="switch">
            <span class="switch__text"><strong>Pause automatic memory collection</strong>
              <small>${paused ? 'Paused.' : 'Not paused.'} When it’s not paused, Premium members get “Remember this?” suggestions in Daymate AI chats. Nothing is saved until you tap Save, and you can delete any memory here.</small></span>
            <input type="checkbox" class="switch__input" data-memory-pause ${paused ? 'checked' : ''} aria-label="Pause automatic memory collection">
            <i class="switch__ui" aria-hidden="true"></i>
          </label>
        </section>

        <div class="searchbar">
          ${icon('search')}
          <input id="memSearch" class="searchbar__input" type="search" placeholder="Search memories" value="${esc(ui.query)}" autocomplete="off" aria-label="Search memories">
          <button type="button" class="btn btn--primary btn--sm" data-action="add-memory">${icon('plus')}Add</button>
        </div>

        <div class="catbar" role="tablist" aria-label="Memory categories">
          <button type="button" role="tab" class="chip${ui.category === 'all' ? ' is-on' : ''}" aria-selected="${ui.category === 'all'}" data-action="memory-category" data-category="all">All ${all.length}</button>
          ${MEMORY_CATEGORIES.map((c) => `<button type="button" role="tab" class="chip${ui.category === c.key ? ' is-on' : ''}" aria-selected="${ui.category === c.key}" data-action="memory-category" data-category="${c.key}">${esc(c.label)}${counts[c.key] ? ` ${counts[c.key]}` : ''}</button>`).join('')}
        </div>

        ${list}

        <h3 class="group-title">With Premium</h3>
        <ul class="features">
          <li><button type="button" class="feature feature--premium" data-action="open-premium" data-feature="ai-memory"><span class="feature__icon">${icon('sparkles')}</span><span class="feature__text"><strong>AI-powered memory</strong><small>Daymate AI suggests memories for your approval and uses them in its answers.</small></span><span class="feature__side"><span class="badge badge--premium">${icon('lock')}Premium</span></span></button></li>
        </ul>
        <p class="fine">Memories are private to your account. DAYMATE never collects sensitive details on its own. Anything you mark as sensitive stays hidden until you tap it.</p>
      </div>`;

    const search = $('#memSearch', host);
    if (search) {
      search.addEventListener('input', () => {
        ui.query = search.value;
        const pos = search.selectionStart;
        render(host);
        const again = $('#memSearch', host); again.focus(); again.setSelectionRange(pos, pos);
      });
    }
    const pause = $('[data-memory-pause]', host);
    if (pause) pause.addEventListener('change', () => { Store.setSettings({ memoryPaused: pause.checked }); UI.toast(pause.checked ? 'Automatic collection paused' : 'On. Daymate AI may suggest memories. You approve each one.'); });
  }

  /* ---- add / edit sheet ---- */
  function openSheet(id, presetCategory) {
    const m = id ? Store.get('memories', id) : null;
    const form = $('#memoryForm');
    form.dataset.id = m ? m.id : '';
    $('#memorySheetTitle').textContent = m ? 'Edit memory' : 'New memory';
    $('#memorySave').textContent = m ? 'Save changes' : 'Save memory';
    $('#memoryCategory').innerHTML = MEMORY_CATEGORIES.map((c) => `<option value="${c.key}">${esc(c.label)}</option>`).join('');
    $('#memoryCategory').value = m ? m.category : (presetCategory || (ui.category !== 'all' ? ui.category : 'personal_preferences'));
    $('#memoryTitle').value = m ? m.title : '';
    $('#memoryContent').value = m ? m.content : '';
    $('#memorySensitive').checked = m ? m.sensitive : false;
    $('#memoryContentError').textContent = '';
    $('#memoryContent').classList.remove('is-invalid');
    $('#memoryDelete').hidden = !m;
    const hint = cat($('#memoryCategory').value).hint;
    $('#memoryCatHint').textContent = hint;
    Modal.open('m-memory', { focus: m ? null : '#memoryContent' });
  }

  function save(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const content = cleanMultiline($('#memoryContent').value, 1000);
    if (!content) { $('#memoryContent').classList.add('is-invalid'); $('#memoryContentError').textContent = 'Write something for DAYMATE to remember.'; $('#memoryContent').focus(); return; }
    const category = MEMORY_CATEGORIES.some((c) => c.key === $('#memoryCategory').value) ? $('#memoryCategory').value : 'conversation_info';
    const fields = { category, title: cleanText($('#memoryTitle').value, 80), content, sensitive: $('#memorySensitive').checked };
    if (form.dataset.id) Store.update('memories', form.dataset.id, fields);
    else Store.add('memories', { ...fields, source: 'manual' });     // only manual entries exist today
    Modal.close('m-memory');
    UI.toast(form.dataset.id ? 'Memory updated' : 'Memory saved');
  }

  function remove(id) {
    const r = Store.remove('memories', id);
    if (r) UI.toast('Memory deleted', { action: { label: 'Undo', fn: () => Store.restore('memories', r.item, r.index) } });
  }

  const idOf = (el) => { const h = el.closest('[data-id]'); return h ? h.dataset.id : ''; };
  DM.registerRoute('memory', { render });
  DM.registerActions({
    'add-memory': (el) => openSheet('', el.dataset && el.dataset.category),
    'edit-memory': (el) => { const id = idOf(el); if (id) openSheet(id); },
    'delete-memory': (el) => { const id = idOf(el); if (id) remove(id); },
    'delete-memory-sheet': () => { const id = $('#memoryForm').dataset.id; Modal.close('m-memory'); if (id) remove(id); },
    'reveal-memory': (el) => { const id = idOf(el); if (id) { ui.revealed.add(id); DM.views.renderAll(); } },
    'memory-category': (el) => { ui.category = el.dataset.category; DM.views.renderAll(); },
  });
  $('#memoryForm').addEventListener('submit', save);
  $('#memoryCategory').addEventListener('change', (e) => { $('#memoryCatHint').textContent = cat(e.target.value).hint; });
  $('#memoryContent').addEventListener('input', (e) => { e.target.classList.remove('is-invalid'); $('#memoryContentError').textContent = ''; });
}
