/* ==========================================================================
   DAYMATE — Shopping list upgrade (Stage 5)
   Aisle grouping, quantities ("2 litres of milk"), auto-categorising, inline editing,
   and a sort switch. Plugs into the existing list sheet through DM.setShoppingUI; if this
   module ever fails to load, the plain list in app.js keeps working.
   ========================================================================== */
import { SHOP_CATEGORIES, groupItems, parseItem, catLabel, describe } from './shopping-logic.js';
import { getPref, setPref } from './prefs.js';

export function initShopping(DM) {
  const { Store, UI } = DM;
  const { $, esc, icon, cleanText } = DM.helpers;
  const form = $('#shoppingForm'), input = $('#shoppingInput'), list = $('#shoppingList');
  if (!form || !input || !list) return;

  let editing = '';
  const seen = new Set();
  const sortMode = () => (getPref('shopSort') === 'added' ? 'added' : 'aisle');

  /* hint line + sort switch, added to the existing sheet */
  const hint = document.createElement('p');
  hint.className = 'shop__hint'; hint.id = 'shoppingHint'; hint.setAttribute('aria-live', 'polite');
  hint.textContent = 'Try “2 litres of milk” or “500g mince” — Daymate sorts it into the right aisle.';
  form.after(hint);
  const seg = document.createElement('div');
  seg.className = 'seg shop__sort'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Sort the list');
  seg.innerHTML = `<button type="button" data-action="shop-sort" data-mode="aisle">By aisle</button><button type="button" data-action="shop-sort" data-mode="added">As added</button>`;
  hint.after(seg);
  const syncSeg = () => seg.querySelectorAll('button').forEach((b) => { const on = b.dataset.mode === sortMode(); b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); });
  syncSeg();

  /* live preview while typing */
  input.addEventListener('input', () => {
    const t = cleanText(input.value, 80);
    if (!t) { hint.textContent = 'Try “2 litres of milk” or “500g mince” — Daymate sorts it into the right aisle.'; return; }
    const p = parseItem(t);
    hint.textContent = `Adding ${describe(p)} · ${catLabel(p.category)}`;
  });

  const catSelect = (sel) => `<select class="input shop__sel" data-f="category" aria-label="Aisle">${SHOP_CATEGORIES.map((c) => `<option value="${c.key}"${c.key === sel ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</select>`;

  function row(i) {
    const isNew = !seen.has(i.id); seen.add(i.id);
    if (i.id === editing) {
      return `<li class="shop__item is-editing" data-id="${esc(i.id)}">
        <div class="shop__edit">
          <input class="input" data-f="name" type="text" maxlength="80" value="${esc(i.name)}" aria-label="Item name">
          <div class="shop__edit2"><input class="input" data-f="quantity" type="text" maxlength="30" value="${esc(i.quantity || '')}" placeholder="Qty (e.g. 2)" aria-label="Quantity">${catSelect(i.category)}</div>
          <div class="shop__edit3"><button type="button" class="btn btn--ghost" data-action="cancel-shop-edit">Cancel</button><button type="button" class="btn btn--primary" data-action="save-shop-edit">Save</button></div>
        </div></li>`;
    }
    const q = i.quantity ? `<span class="shop__qty">${esc(i.quantity)}</span>` : '';
    return `<li class="shop__item${i.checked ? ' is-checked' : ''}${isNew ? ' is-new' : ''}" data-id="${esc(i.id)}">
      <button type="button" class="check" role="checkbox" aria-checked="${i.checked}" data-action="toggle-shop" aria-label="${i.checked ? 'Untick' : 'Tick off'}: ${esc(i.name)}">${icon('check')}</button>
      <button type="button" class="shop__main" data-action="edit-shop" aria-label="Edit ${esc(i.name)}"><span class="shop__name">${esc(i.name)}</span>${q}</button>
      <button type="button" class="icon-btn icon-btn--danger" data-action="delete-shop" aria-label="Remove ${esc(i.name)}">${icon('trash')}</button>
    </li>`;
  }

  function listHtml(items) {
    return groupItems(items, sortMode()).map((g) => {
      const head = g.label ? `<li class="shop__head" ${g.color ? `style="--dot:${g.color}"` : ''}><h3>${esc(g.label)}<span>${g.items.length}</span></h3></li>` : '';
      return head + g.items.map(row).join('');
    }).join('');
  }

  function add(e) {
    const text = cleanText(input.value, 80);
    if (!text) return false;                           // empty: let app.js do its shake
    const p = parseItem(text);
    if (!p.name) return false;
    if (Store.state.shopping.some((i) => !i.checked && i.name.toLowerCase() === p.name.toLowerCase())) {
      UI.toast(`“${p.name}” is already on your list`);
      input.select();
      return true;
    }
    Store.add('shopping', { name: p.name, quantity: p.quantity, category: p.category, checked: false });
    input.value = '';
    hint.textContent = `Added ${describe(p)} · ${catLabel(p.category)}`;
    input.focus();
    return true;
  }
  DM.setShoppingUI({ list: listHtml, add });

  function saveEdit(li) {
    const id = li && li.dataset.id; const item = id && Store.get('shopping', id);
    if (!item) { editing = ''; return DM.views.renderAll(); }
    const name = cleanText(li.querySelector('[data-f=name]').value, 80);
    if (!name) { const n = li.querySelector('[data-f=name]'); n.classList.add('is-invalid'); n.focus(); return; }
    const quantity = cleanText(li.querySelector('[data-f=quantity]').value, 30);
    const category = li.querySelector('[data-f=category]').value;
    editing = '';
    Store.update('shopping', id, { name, quantity, category });
    DM.views.renderAll();
  }

  DM.registerActions({
    'edit-shop': (el) => { const li = el.closest('[data-id]'); editing = li ? li.dataset.id : ''; DM.views.renderAll(); const n = list.querySelector('.is-editing [data-f=name]'); if (n) n.focus(); },
    'cancel-shop-edit': () => { editing = ''; DM.views.renderAll(); },
    'save-shop-edit': (el) => saveEdit(el.closest('[data-id]')),
    'shop-sort': (el) => { setPref('shopSort', el.dataset.mode === 'added' ? 'added' : 'aisle'); syncSeg(); DM.views.renderAll(); },
  });
  list.addEventListener('keydown', (e) => {
    if (!editing) return;
    if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); saveEdit(e.target.closest('[data-id]')); }
    if (e.key === 'Escape') { e.stopPropagation(); editing = ''; DM.views.renderAll(); }
  });
  const m = $('#m-shopping');
  if (m) new MutationObserver(() => { if (m.hidden) editing = ''; }).observe(m, { attributes: true, attributeFilter: ['hidden'] });
}
