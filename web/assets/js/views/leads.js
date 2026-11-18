// Leads tracker: funnel board, filters, bulk updates, add/edit. Feeds the quota tracker.
import { sb, must, fetchAll } from '../lib/sb.js';
import { esc, opts, modal, toast, fail, formData, today, fmtDate, firstEmail, hasPhone, normalizePhone, money, debounce, isMobile } from '../lib/util.js';

export const STATUSES = ['New', 'Contacted', 'Follow-Up', 'Site Visit', 'Reserved', 'Closed', 'Cancelled', 'Not Interested'];
const CLASSES = ['High', 'Mid', 'Low'];
let L = [];                 // all leads
let sel = new Set();        // selected ids
const F = { q: '', status: '', income: '', temp: '', quality: '', contact: '', view: null, limit: 100, filtersOpen: false, bulkOpen: false };
const viewMode = () => F.view || (isMobile() ? 'cards' : 'board');
const telOf = (p) => String(p || '').replace(/[^\d+]/g, '');
let root;

export async function render(el, params) {
  root = el;
  L = await fetchAll(() => sb.from('leads').select('*').order('created_at', { ascending: false }).order('id'));
  draw();
  if (params.open) { const l = L.find(x => x.id === params.open); if (l) edit(l); else toast('That lead no longer exists.', 'err'); }
  if (params.new) edit({ status: 'New' });
}
export function destroy() { sel = new Set(); }

function filtered() {
  const q = F.q.toLowerCase();
  return L.filter(l =>
    (!q || `${l.full_name} ${l.phone || ''} ${l.email || ''} ${l.project || ''} ${l.notes || ''}`.toLowerCase().includes(q)) &&
    (!F.status || l.status === F.status) &&
    (!F.income || l.income_class === F.income) &&
    (!F.temp || (F.temp === 'none' ? !l.temperature : l.temperature === F.temp)) &&
    (!F.quality || (F.quality === 'none' ? !l.quality : l.quality === F.quality)) &&
    (!F.contact || (F.contact === 'email' ? !!firstEmail(l.email) : F.contact === 'phone' ? hasPhone(l.phone) : F.contact === 'both' ? (!!firstEmail(l.email) && hasPhone(l.phone)) : (!firstEmail(l.email) && !hasPhone(l.phone)))));
}

function leadBtn(l) {
  const t = today();
  const due = l.next_follow_up && l.next_follow_up <= t && !['Closed', 'Not Interested', 'Cancelled'].includes(l.status);
  return `<div class="lead"><input type="checkbox" data-sel="${esc(l.id)}" ${sel.has(l.id) ? 'checked' : ''} aria-label="Select ${esc(l.full_name)}">
    <button type="button" data-open="${esc(l.id)}" class="${esc(l.income_class || '')} ${l.quality === 'Not qualified' ? 'nq' : ''}">
      ${l.temperature === 'Hot' ? '🔥 ' : l.temperature === 'Cold' ? '❄️ ' : ''}${esc(l.full_name)}${l.quality === 'Qualified' ? ' ✓' : ''}
      ${l.status === 'Closed' && l.contract_price ? `<br><span class="muted">${esc(money(l.contract_price))}</span>` : ''}
      ${due ? `<br><span class="due">Follow up ${esc(fmtDate(l.next_follow_up))}</span>` : ''}
    </button></div>`;
}

function leadCard(l) {
  const t = today();
  const due = l.next_follow_up && l.next_follow_up <= t && !['Closed', 'Not Interested', 'Cancelled'].includes(l.status);
  const tel = hasPhone(l.phone) ? telOf(l.phone) : '';
  return `<div class="lcard ${esc(l.income_class || '')} ${l.quality === 'Not qualified' ? 'nq' : ''}">
    <input type="checkbox" data-sel="${esc(l.id)}" ${sel.has(l.id) ? 'checked' : ''} aria-label="Select ${esc(l.full_name)}">
    <button type="button" class="lmain" data-open="${esc(l.id)}">
      <b>${l.temperature === 'Hot' ? '🔥 ' : l.temperature === 'Cold' ? '❄️ ' : ''}${esc(l.full_name)}${l.quality === 'Qualified' ? ' ✓' : ''}</b>
      <span class="chips"><span class="chip">${esc(l.status)}</span>${l.income_class ? `<span class="chip">${esc(l.income_class)}</span>` : ''}${l.status === 'Closed' && l.contract_price ? `<span class="chip ok">${esc(money(l.contract_price))}</span>` : ''}</span>
      ${l.phone || l.project ? `<span class="muted small">${esc([l.phone, l.project].filter(Boolean).join(' · '))}</span>` : ''}
      ${due ? `<span class="due small">Follow up ${esc(fmtDate(l.next_follow_up))}</span>` : ''}
    </button>
    <div class="lact">
      ${tel ? `<a class="ic" href="tel:${esc(tel)}" aria-label="Call ${esc(l.full_name)}">📞</a><a class="ic" href="sms:${esc(tel)}" aria-label="Text ${esc(l.full_name)}">💬</a>` : ''}
      ${firstEmail(l.email) ? `<a class="ic" href="#/email?lead=${esc(l.id)}" aria-label="Email ${esc(l.full_name)}">✉️</a>` : ''}
    </div>
  </div>`;
}

function draw() {
  const list = filtered();
  const withEmail = list.filter(l => firstEmail(l.email)).length;
  const mode = viewMode();
  let body;
  if (mode === 'board') {
    body = `<div class="board">${STATUSES.map(st => { const m = list.filter(l => l.status === st); return `<div class="col" data-s="${esc(st)}"><h3>${esc(st)} · ${m.length}</h3><div class="list">${m.slice(0, 400).map(leadBtn).join('')}${m.length > 400 ? `<div class="muted small">+${m.length - 400} more — narrow the filters</div>` : ''}</div></div>`; }).join('')}</div>`;
  } else if (mode === 'table') {
    body = `<div class="tbl-wrap"><table><thead><tr><th></th><th>Name</th><th>Stage</th><th>Class</th><th>Phone</th><th>Email</th><th>Follow-up</th><th class="num">Price</th></tr></thead><tbody>
        ${list.slice(0, 1000).map(l => `<tr class="clickable" data-open="${esc(l.id)}"><td><input type="checkbox" data-sel="${esc(l.id)}" ${sel.has(l.id) ? 'checked' : ''}></td><td>${esc(l.full_name)}</td><td>${esc(l.status)}</td><td>${esc(l.income_class || '')}</td><td class="nowrap">${esc(l.phone || '')}</td><td>${esc(l.email || '')}</td><td class="nowrap">${esc(fmtDate(l.next_follow_up))}</td><td class="num">${l.contract_price ? esc(money(l.contract_price)) : ''}</td></tr>`).join('')}
      </tbody></table></div>`;
  } else {
    // stage counts use the list without the stage filter
    const keep = F.status; F.status = ''; const base = filtered(); F.status = keep;
    body = `<div class="stage-chips" role="tablist">${[['', `All · ${base.length}`], ...STATUSES.map(st => [st, `${st} · ${base.filter(l => l.status === st).length}`])].map(([v, t]) => `<button type="button" class="chip ${F.status === v ? 'on' : ''}" data-stage="${esc(v)}">${esc(t)}</button>`).join('')}</div>
      <div class="lcards">${list.slice(0, F.limit).map(leadCard).join('') || '<div class="empty">No leads match.</div>'}</div>
      ${list.length > F.limit ? `<button class="btn ghost" style="width:100%;margin-top:8px" data-act="more">Show more (${list.length - F.limit} left)</button>` : ''}`;
  }
  const nf = ['status', 'income', 'temp', 'quality', 'contact'].filter(k => F[k]).length + (F.q ? 1 : 0);
  const next = isMobile() ? (mode === 'cards' ? 'board' : 'cards') : (mode === 'board' ? 'table' : mode === 'table' ? 'cards' : 'board');
  const label = { board: 'Board view', table: 'Table view', cards: 'List view' }[next];

  root.innerHTML = `
  <div class="card"><h2>Leads · ${list.length} of ${L.length} <span class="sp"></span>
      <button class="btn" data-act="new">+ Add lead</button>
      <button class="btn ghost" data-act="view">${label}</button></h2>
    <label class="search"><span class="sr">Search</span><input id="fq" type="search" value="${esc(F.q)}" placeholder="🔎 Search name, phone, email, notes…"></label>
    <details class="fold" data-fold="filtersOpen" ${F.filtersOpen || !isMobile() ? 'open' : ''}><summary>Filters${nf ? ` <span class="chip on">${nf}</span>` : ''}</summary>
    <div class="row">
      <label>Stage<select data-f="status">${opts(STATUSES, F.status, { blank: 'All' })}</select></label>
      <label>Class<select data-f="income">${opts(CLASSES, F.income, { blank: 'All' })}</select></label>
      <label>Hot / cold<select data-f="temp">${opts([['Hot', 'Hot'], ['Cold', 'Cold'], ['none', 'Not rated']], F.temp, { blank: 'All' })}</select></label>
      <label>Qualified?<select data-f="quality">${opts([['Qualified', 'Qualified'], ['Not qualified', 'Not qualified'], ['none', 'Not reviewed']], F.quality, { blank: 'All' })}</select></label>
      <label>Contact<select data-f="contact">${opts([['email', 'Has email'], ['phone', 'Has phone'], ['both', 'Has both'], ['none', 'No email or phone']], F.contact, { blank: 'All' })}</select></label>
      <button class="btn ghost" data-act="clear">Clear</button>
    </div></details>
    <details class="fold" data-fold="bulkOpen" ${F.bulkOpen || !isMobile() ? 'open' : ''}><summary>Select & bulk actions${sel.size ? ` <span class="chip on">${sel.size}</span>` : ''}</summary>
    <div class="row bulk">
      <b><span id="selc">${sel.size}</span> selected</b>
      <button class="btn ghost sm" data-act="selall">Select all shown (${list.length})</button>
      <button class="btn ghost sm" data-act="selnone">Clear selection</button>
      <label>Set<select id="bulkv">
        <optgroup label="Stage">${STATUSES.filter(s => s !== 'Closed').map(s => `<option value="status:${esc(s)}">${esc(s)}</option>`).join('')}</optgroup>
        <optgroup label="Lead quality"><option value="quality:Qualified">Qualified</option><option value="quality:Not qualified">Not qualified</option><option value="quality:">Clear qualified</option>
        <option value="temperature:Hot">Hot</option><option value="temperature:Cold">Cold</option><option value="temperature:">Clear hot/cold</option></optgroup>
      </select></label>
      <button class="btn sm" data-act="bulk">Apply to selected</button>
      <button class="btn ghost sm" data-act="email">Email selected</button>
      <button class="btn danger sm" data-act="bulkdel">Delete selected</button>
    </div></details>
    <p class="hint">${list.length} shown · ${withEmail} with email · ${list.filter(l => hasPhone(l.phone)).length} with phone · ${list.filter(l => l.temperature === 'Hot').length} hot · ${list.filter(l => l.quality === 'Qualified').length} qualified.
      <span class="legend">Green edge = High income · 🔥 hot · ❄️ cold · ✓ qualified · faded = not qualified. To mark a lead <b>Closed</b>, open it and enter the contract price — the quota tracker updates automatically.</span></p>
    ${body}
  </div>`;

  root.querySelector('#fq').oninput = debounce(e => { F.q = e.target.value; draw(); const i = root.querySelector('#fq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 200);
  root.querySelectorAll('[data-f]').forEach(s => s.onchange = () => { F[s.dataset.f] = s.value; draw(); });
  root.onclick = onClick;
  root.querySelectorAll('details[data-fold]').forEach(d => d.addEventListener('toggle', () => { F[d.dataset.fold] = d.open; }));
  root.onchange = (e) => {
    const cb = e.target.closest('[data-sel]');
    if (cb) { cb.checked ? sel.add(cb.dataset.sel) : sel.delete(cb.dataset.sel); root.querySelector('#selc').textContent = sel.size; }
  };
}

async function onClick(e) {
  if (e.target.closest('[data-sel]') || e.target.closest('.lact a')) return;
  const stage = e.target.closest('[data-stage]');
  if (stage) { F.status = stage.dataset.stage; F.limit = 100; draw(); return; }
  const open = e.target.closest('[data-open]');
  if (open) { const l = L.find(x => x.id === open.dataset.open); return l ? edit(l) : toast('That lead no longer exists.', 'err'); }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  const ids = [...sel];
  try {
    if (act === 'new') edit({ status: 'New', income_class: 'Mid' });
    else if (act === 'view') { const m = viewMode(); F.view = isMobile() ? (m === 'cards' ? 'board' : 'cards') : (m === 'board' ? 'table' : m === 'table' ? 'cards' : 'board'); draw(); }
    else if (act === 'more') { F.limit += 100; draw(); }
    else if (act === 'clear') { Object.assign(F, { q: '', status: '', income: '', temp: '', quality: '', contact: '' }); draw(); }
    else if (act === 'selall') { filtered().forEach(l => sel.add(l.id)); draw(); }
    else if (act === 'selnone') { sel.clear(); draw(); }
    else if (act === 'email') {
      if (!ids.length) return toast('Select leads first.', 'err');
      sessionStorage.setItem('ys_email_ids', JSON.stringify(ids));
      location.hash = '#/email?from=leads';
    } else if (act === 'bulk') {
      if (!ids.length) return toast('Select leads first.', 'err');
      const [field, val] = root.querySelector('#bulkv').value.split(/:(.*)/s);
      if (!confirm(`Update ${ids.length} lead(s): ${field} → ${val || '(clear)'}?`)) return;
      for (let i = 0; i < ids.length; i += 200) must(await sb.from('leads').update({ [field]: val || null }).in('id', ids.slice(i, i + 200)));
      L.forEach(l => { if (sel.has(l.id)) l[field] = val || null; });
      if (field === 'status') L.forEach(l => { if (sel.has(l.id) && !['Closed', 'Cancelled'].includes(val)) l.closed_at = null; });
      sel.clear(); toast(`Updated ${ids.length} lead(s).`, 'ok'); draw();
    } else if (act === 'bulkdel') {
      if (!ids.length) return toast('Select leads first.', 'err');
      if (!confirm(`Permanently delete ${ids.length} lead(s)? This cannot be undone.`)) return;
      for (let i = 0; i < ids.length; i += 200) must(await sb.from('leads').delete().in('id', ids.slice(i, i + 200)));
      L = L.filter(l => !sel.has(l.id)); sel.clear(); toast('Deleted.', 'ok'); draw();
    }
  } catch (err) { fail(err); }
}

function edit(l) {
  const isNew = !l.id;
  const m = modal(`
    <h2>${isNew ? 'Add lead' : esc(l.full_name)}<span class="sp"></span><button class="btn ghost sm" data-close>✕</button></h2>
    ${isNew ? '' : `<div class="quick">
      ${hasPhone(l.phone) ? `<a class="btn ghost" href="tel:${esc(telOf(l.phone))}">📞 Call</a><a class="btn ghost" href="sms:${esc(telOf(l.phone))}">💬 Text</a>` : ''}
      ${firstEmail(l.email) ? `<a class="btn ghost" href="#/email?lead=${esc(l.id)}" data-close>✉️ Email</a>` : ''}
      <a class="btn ghost" href="#/schedule?lead=${esc(l.id)}" data-close>🚗 Tripping</a>
      <a class="btn ghost" href="#/lto?lead=${esc(l.id)}" data-close>🧮 LTO quote</a>
    </div>`}
    <form id="lf" class="form-grid">
      <label class="fld wide">Full name *<input name="full_name" required maxlength="200" value="${esc(l.full_name)}"></label>
      <label class="fld">Phone<input name="phone" value="${esc(l.phone)}" inputmode="tel"></label>
      <label class="fld">Email<input name="email" value="${esc(l.email)}" inputmode="email"></label>
      <label class="fld">Address<input name="address" value="${esc(l.address)}"></label>
      <label class="fld">Nationality<input name="nationality" value="${esc(l.nationality)}"></label>
      <label class="fld">Income class<select name="income_class">${opts(CLASSES, l.income_class, { blank: '—' })}</select></label>
      <label class="fld">Stage<select name="status" id="st">${opts(STATUSES, l.status || 'New')}</select></label>
      <label class="fld">Qualified?<select name="quality">${opts(['Qualified', 'Not qualified'], l.quality, { blank: 'Not reviewed' })}</select></label>
      <label class="fld">Hot / cold<select name="temperature">${opts(['Hot', 'Cold'], l.temperature, { blank: 'Not rated' })}</select></label>
      <label class="fld">Source<input name="source" value="${esc(l.source)}" placeholder="FB, IG, TikTok, referral…" list="srcs"></label>
      <datalist id="srcs"><option>Facebook</option><option>Instagram</option><option>TikTok</option><option>Referral</option><option>Walk-in</option><option>Salesforce</option></datalist>
      <label class="fld">Project of interest<input name="project" value="${esc(l.project)}"></label>
      <label class="fld">Unit<input name="unit" value="${esc(l.unit)}"></label>
      <label class="fld">Contract price ₱ ${'<b id="pr-req" style="color:var(--red)"></b>'}<input name="contract_price" type="number" min="0" step="0.01" value="${esc(l.contract_price)}"></label>
      <label class="fld">Closed on<input name="closed_at" type="date" value="${esc(l.closed_at)}"></label>
      <label class="fld">Next follow-up<input name="next_follow_up" type="date" value="${esc(l.next_follow_up)}"></label>
      <label class="fld wide">Notes / follow-up comments<textarea name="notes" rows="4">${esc(l.notes)}</textarea></label>
    </form>
    <div class="foot">
      ${isNew ? '' : '<span class="left"><button class="btn danger" data-del>Delete</button></span>'}
      <button class="btn ghost" data-close>Cancel</button>
      <button class="btn" data-save>${isNew ? 'Add lead' : 'Save'}</button>
    </div>`);
  const f = m.el.querySelector('#lf');
  const st = f.querySelector('#st');
  const req = () => { m.el.querySelector('#pr-req').textContent = st.value === 'Closed' ? '(required)' : ''; };
  st.onchange = () => { req(); if (st.value === 'Closed' && !f.closed_at.value) f.closed_at.value = today(); };
  req();
  m.el.querySelector('[data-save]').onclick = async () => {
    if (!f.reportValidity()) return;
    const d = formData(f);
    if (d.phone) d.phone = normalizePhone(d.phone);
    if (d.status === 'Closed' && (d.contract_price == null || d.contract_price <= 0)) return toast('Enter the contract price for a Closed deal.', 'err');
    if (d.status !== 'Closed' && d.status !== 'Cancelled') d.closed_at = null;
    try {
      const saved = isNew ? must(await sb.from('leads').insert(d).select().single())
        : must(await sb.from('leads').update(d).eq('id', l.id).select().single());
      if (isNew) L.unshift(saved); else L[L.findIndex(x => x.id === l.id)] = saved;
      toast(isNew ? 'Lead added.' : 'Saved.', 'ok'); m.close(); draw();
    } catch (e) { fail(e); }
  };
  m.el.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!confirm(`Delete ${l.full_name}? This cannot be undone.`)) return;
    try { must(await sb.from('leads').delete().eq('id', l.id)); L = L.filter(x => x.id !== l.id); m.close(); draw(); toast('Deleted.', 'ok'); } catch (e) { fail(e); }
  });
}
