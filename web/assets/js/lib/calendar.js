// Month grid shared by the Content calendar and the Manning & Tripping calendar.
// Desktop: full grid with event chips. Phone: compact grid with dots + an
// agenda list for the selected day (event text is unreadable in 50px cells).
import { esc, today, monthLabel, isMobile, fmtDate } from './util.js';

/** Visible range for a month view (6 weeks starting Sunday), as Manila 'YYYY-MM-DD'. */
export function monthRange(y, m) {
  const first = new Date(Date.UTC(y, m, 1));
  const start = new Date(first); start.setUTCDate(1 - first.getUTCDay());
  const end = new Date(start); end.setUTCDate(start.getUTCDate() + 41);
  const f = d => d.toISOString().slice(0, 10);
  return { start: f(start), end: f(end) };
}

const selected = new WeakMap(); // container -> selected 'YYYY-MM-DD' (phone mode)

/**
 * Render a month grid.
 * events: [{ id, date:'YYYY-MM-DD', sort:'HH:MM', label, cls, title }]
 * Clicks: day → onDay(date) ; event → onEvent(id) ; arrows → onNav(y, m)
 * addLabel: text for the phone "add" button (e.g. "Add post")
 */
export function renderMonth(el, { y, m, events, onDay, onEvent, onNav, addLabel = 'Add' }) {
  const mobile = isMobile();
  const { start } = monthRange(y, m);
  const t = today();
  const byDay = {};
  for (const e of events) (byDay[e.date] ||= []).push(e);
  Object.values(byDay).forEach(l => l.sort((a, b) => (a.sort || '').localeCompare(b.sort || '')));

  const inMonth = (k) => +k.slice(5, 7) - 1 === m && +k.slice(0, 4) === y;
  let sel = selected.get(el);
  if (!sel || !inMonth(sel)) sel = inMonth(t) ? t : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  selected.set(el, sel);

  const dows = mobile ? ['S', 'M', 'T', 'W', 'T', 'F', 'S'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let cells = dows.map(d => `<div class="dow">${d}</div>`).join('');
  const d0 = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < 42; i++) {
    const d = new Date(d0); d.setUTCDate(d0.getUTCDate() + i);
    const k = d.toISOString().slice(0, 10);
    const out = d.getUTCMonth() !== m;
    const list = byDay[k] || [];
    const inner = mobile
      ? `<span class="dots">${list.slice(0, 3).map(e => `<i class="dot ${esc(e.cls || '')}"></i>`).join('')}${list.length > 3 ? `<b>+${list.length - 3}</b>` : ''}</span>`
      : list.map(e => `<button type="button" class="ev ${esc(e.cls || '')}" data-ev="${esc(e.id)}" title="${esc(e.title || e.label)}">${esc(e.label)}</button>`).join('');
    cells += `<div class="day ${out ? 'out' : ''} ${k === t ? 'today' : ''} ${mobile && k === sel ? 'sel' : ''}" data-day="${k}" role="button" tabindex="0" aria-label="${esc(fmtDate(k))}${list.length ? `, ${list.length} item(s)` : ''}"><span class="n">${d.getUTCDate()}</span>${inner}</div>`;
  }

  const agenda = mobile ? `
    <div class="agenda">
      <div class="agenda-head"><b>${esc(fmtDate(sel))}</b><button type="button" class="btn sm" data-add="${sel}">+ ${esc(addLabel)}</button></div>
      ${(byDay[sel] || []).map(e => `<button type="button" class="ev ag ${esc(e.cls || '')}" data-ev="${esc(e.id)}">${esc(e.label)}</button>`).join('') || '<div class="muted small">Nothing on this day.</div>'}
    </div>` : '';

  el.innerHTML = `<div class="cal-head">
      <button class="btn ghost sm" data-nav="-1" aria-label="Previous month">‹</button>
      <b>${esc(monthLabel(y, m))}</b>
      <button class="btn ghost sm" data-nav="1" aria-label="Next month">›</button>
      <button class="btn ghost sm" data-nav="0">Today</button>
    </div><div class="cal ${mobile ? 'compact' : ''}">${cells}</div>${agenda}`;

  el.onclick = (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      const n = +nav.dataset.nav;
      if (n === 0) { const [ty, tm] = t.split('-').map(Number); selected.set(el, t); return onNav(ty, tm - 1); }
      const d = new Date(Date.UTC(y, m + n, 1)); return onNav(d.getUTCFullYear(), d.getUTCMonth());
    }
    const ev = e.target.closest('[data-ev]');
    if (ev) { e.stopPropagation(); return onEvent(ev.dataset.ev); }
    const add = e.target.closest('[data-add]');
    if (add) return onDay(add.dataset.add);
    const day = e.target.closest('[data-day]');
    if (!day) return;
    if (mobile) {
      const k = day.dataset.day;
      if (!inMonth(k)) { const [yy, mm] = k.split('-').map(Number); selected.set(el, k); return onNav(yy, mm - 1); }
      selected.set(el, k);
      return renderMonth(el, { y, m, events, onDay, onEvent, onNav, addLabel });
    }
    onDay(day.dataset.day);
  };
  el.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset.day) { e.preventDefault(); e.target.click(); } };
}
