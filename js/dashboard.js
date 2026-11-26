/* ==========================================================================
   DAYMATE — Home dashboard extras
   Adds the three things the Home screen was missing, using the same Store as everything else:
     • "Ask Daymate AI" bar (opens the floating assistant)
     • Today's schedule (a timeline of what's on today, with "next up")
     • Shopping list overview
   ========================================================================== */
export function initDashboard(DM) {
  const { Store } = DM;
  const { $, esc, icon, todayStr, nowHM, plural, kindIcon, kindLabel } = DM.helpers;
  const home = document.getElementById('view-home');
  const quick = home && home.querySelector('.quick');
  const myDay = home && home.querySelector('[aria-labelledby="myDayHeading"]');
  const upcoming = home && home.querySelector('#upcomingList') && home.querySelector('#upcomingList').closest('section');
  if (!home || !quick || !myDay || !upcoming) return;

  const ask = document.createElement('button');
  ask.type = 'button'; ask.className = 'askbar'; ask.dataset.action = 'open-ai';
  ask.innerHTML = `<span class="askbar__icon">${icon('sparkles')}</span><span class="askbar__text">Ask Daymate AI…<small>“Plan my day” · “Add dentist Friday 2pm” · “Add milk to my list”</small></span><span class="askbar__go">${icon('chevron')}</span>`;
  quick.after(ask);

  const sched = document.createElement('section');
  sched.className = 'section'; sched.setAttribute('aria-labelledby', 'schedHeading');
  ask.after(sched);

  const shop = document.createElement('section');
  shop.className = 'section'; shop.setAttribute('aria-labelledby', 'shopHeading');
  upcoming.after(shop);

  const fmt = (t) => t || 'All day';
  function todays() {
    const today = todayStr();
    const out = [];
    Store.state.reminders.forEach((r) => { if (r.date === today) out.push({ type: r.kind, title: r.title, time: r.time, done: !!r.done }); });
    Store.state.tasks.forEach((t) => { if (t.date === today && t.time) out.push({ type: 'task', title: t.title, time: t.time, done: !!t.completed }); });
    out.sort((a, b) => (a.time || '').localeCompare(b.time || '') || a.title.localeCompare(b.title));
    return out;
  }

  function renderSchedule() {
    const items = todays();
    const now = nowHM();
    const nextIdx = items.findIndex((i) => !i.done && i.time && i.time >= now);
    const body = items.length
      ? `<ol class="timeline">${items.slice(0, 6).map((i, n) => `
          <li class="timeline__item${i.done ? ' is-done' : ''}${n === nextIdx ? ' is-next' : ''}">
            <span class="timeline__time">${esc(fmt(i.time))}</span>
            <span class="timeline__dot" aria-hidden="true"></span>
            <span class="timeline__card"><span class="timeline__ico">${icon(i.type === 'task' ? 'list' : kindIcon(i.type))}</span>
              <span class="timeline__txt"><strong>${esc(i.title)}</strong><small>${i.type === 'task' ? 'Task' : esc(kindLabel(i.type))}${n === nextIdx ? ' · Next up' : ''}</small></span></span>
          </li>`).join('')}</ol>${items.length > 6 ? `<a class="link-btn" href="#/planner">${plural(items.length - 6, 'more', 'more')} today</a>` : ''}`
      : `<div class="card mini-empty"><span class="mini-empty__ico">${icon('calendar-check')}</span><div><strong>Nothing scheduled today</strong><p>Enjoy the space, or ask Daymate AI to help plan your day.</p></div></div>`;
    sched.innerHTML = `<div class="section__head"><h2 id="schedHeading">Today’s schedule</h2><a class="chip-btn" href="#/planner">${icon('calendar')}Planner</a></div>${body}`;
  }

  function renderShopping() {
    const all = Store.state.shopping;
    const left = all.filter((i) => !i.checked);
    const done = all.length - left.length;
    const pct = all.length ? Math.round((done / all.length) * 100) : 0;
    const body = left.length
      ? `<ul class="shopmini">${left.slice(0, 4).map((i) => `<li>${icon('basket')}<span>${esc(i.name)}</span></li>`).join('')}</ul>
         ${left.length > 4 ? `<p class="shopmini__more">+ ${plural(left.length - 4, 'more item', 'more items')}</p>` : ''}
         <div class="shopmini__bar" role="img" aria-label="${pct}% ticked off"><i style="width:${pct}%"></i></div>`
      : `<p class="shopmini__empty">${all.length ? 'Everything’s ticked off. Nice.' : 'Your list is empty. Say “add milk and bread to my shopping list” to Daymate AI.'}</p>`;
    shop.innerHTML = `<div class="section__head"><h2 id="shopHeading">Shopping list</h2><button type="button" class="chip-btn" data-action="open-shopping">${icon('basket')}${left.length ? plural(left.length, 'to buy', 'to buy') : 'Open'}</button></div>
      <button type="button" class="card shopmini__card" data-action="open-shopping" aria-label="Open shopping list">${body}</button>`;
  }

  const draw = () => { renderSchedule(); renderShopping(); };
  DM.onRender(draw);
  draw();
  setInterval(() => { if (!document.hidden) renderSchedule(); }, 60000);      // keeps "next up" current
}
