// Quotation: RLC payment schemes — Lease-to-Own (LTO), Standard and Step-up — with a printable
// quotation and payment schedule. A developer price list (units in rows) or RLC computation
// sheets (one unit per sheet, like Price Calculator.xlsx) can be uploaded here or in Files.
import { sb, must, fetchAll } from '../lib/sb.js';
import { esc, money, fmtDate, fmtDateTime, today, saveBlob, $, modal, toast, fail, int } from '../lib/util.js';
import { uploadFile, typeOf } from '../lib/files.js';
import { processFile, savePricing } from '../lib/apply.js';
import { readFile } from '../lib/extract.js';
import { download } from '../lib/sb.js';
import { parsePriceList, ROLES } from '../lib/pricelist.js';
import { compute, SCHEMES, DISCOUNTS, LTO_DEFAULTS, INST_DEFAULTS } from '../lib/schemes.js';

const PICK_KEY = 'ys-pricelist';
let leads = [], sig = '', lists = [], current = null, root, params = {};
const F = { project: '', type: '', q: '', hideSold: true };
const blankQuote = () => ({
  scheme: 'lto', client: '', project: '', unit: '', type: '', area: '', price: 6000000, parking: 0, discounts: {},
  start: today(), lto: { ...LTO_DEFAULTS }, inst: { ...INST_DEFAULTS, dpPct: 0.2, dpMonths: 12, tiers: [{ pct: 0.1, months: 24 }] },
  warnings: [], source: '', schedule: true,
});
let Q = blankQuote();

export async function render(el, p) {
  root = el; params = p || {}; Q = blankQuote();
  [leads, sig, lists] = await Promise.all([
    fetchAll(() => sb.from('leads').select('id,full_name,phone,project,unit').order('full_name').order('id')),
    sb.from('settings').select('email_signature').maybeSingle().then(r => must(r)?.email_signature || ''),
    loadLists(),
  ]);
  let saved = null; try { saved = localStorage.getItem(PICK_KEY); } catch { /* ignore */ }
  current = lists.find(l => l.id === saved) || lists[0] || null;
  const pre = params.lead ? leads.find(l => l.id === params.lead) : null;
  if (pre) Object.assign(Q, { client: pre.full_name, unit: pre.unit || '', project: pre.project || '' });
  draw();
  if (pre?.unit && current) {     // a lead's unit that is in the price list is picked automatically
    const want = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const u = units().find(x => want(x.unit) === want(pre.unit) && (!pre.project || want(x.project).includes(want(pre.project)) || want(pre.project).includes(want(x.project))));
    if (u) { const s = root.querySelector('#plunit'); if (s) s.value = u.id; fillUnit(u); }
  }
}

async function loadLists() {
  const rows = must(await sb.from('files_metadata').select('id,file_name,file_type,storage_path,last_modified,metrics,summary,tags').not('metrics->pricing', 'is', null).order('last_modified', { ascending: false }).limit(50));
  return rows.filter(r => r.metrics?.pricing?.units?.length || r.metrics?.pricing?.templates?.length);
}
const units = () => current?.metrics?.pricing?.units || [];
const templates = () => current?.metrics?.pricing?.templates || [];

// ── Page ───────────────────────────────────────────────────────────────────
const pct = (v) => (v == null || v === '' ? '' : +(v * 100).toFixed(4));
const field = (label, name, value, attrs = '') => `<label class="fld">${label}<input name="${name}" value="${esc(value ?? '')}" ${attrs}></label>`;

function draw() {
  root.innerHTML = `
  <div class="card"><h2>Price list &amp; computation sheets<span class="sp"></span>
      <label class="btn sm" style="display:inline-flex">⬆ Upload<input id="plup" type="file" hidden accept=".xlsx,.xls,.csv,.pdf,.docx"></label></h2>
    <div id="plbox"></div>
  </div>
  <div class="card"><h2>Quotation</h2>
    <div id="qwarn"></div>
    <form id="qf" autocomplete="off"></form>
    <div class="row" style="margin-top:10px"><button class="btn" id="print">Print / Save as PDF</button><button class="btn ghost" id="dl">Download quotation (.html)</button></div>
  </div>
  <div class="card"><div id="qv"></div></div>`;
  $('#print', root).onclick = () => print();
  $('#dl', root).onclick = () => {
    const css = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules].map(r => r.cssText).filter(t => t.includes('.quote')); } catch { return []; } }).join('\n');
    saveBlob(new Blob([`<!doctype html><meta charset="utf-8"><title>Quotation — ${esc(Q.client || 'Client')}</title><style>${css}</style>${quoteHTML(Q, compute(Q))}`], { type: 'text/html' }), `Quotation_${(Q.client || 'Client').replace(/\W+/g, '_')}.html`);
  };
  $('#plup', root).onchange = (e) => { const file = e.target.files[0]; e.target.value = ''; if (file) uploadList(file); };
  drawList();
  drawForm();
}

/** The quotation form. Re-drawn when the scheme or the number of tiers changes; otherwise edited in place. */
function drawForm() {
  const f = $('#qf', root);
  const L = Q.lto, I = Q.inst, lto = Q.scheme === 'lto';
  const anyDisc = DISCOUNTS.some(([k]) => Q.discounts[k]);
  f.innerHTML = `
    <div class="form-grid">
      <label class="fld">Client<input name="client" list="cl" value="${esc(Q.client)}"></label>
      <datalist id="cl">${leads.map(l => `<option value="${esc(l.full_name)}">`).join('')}</datalist>
      <label class="fld">Payment scheme<select name="scheme">${Object.entries(SCHEMES).map(([k, v]) => `<option value="${k}" ${Q.scheme === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
      ${field(lto ? 'Move-in / lease start' : 'Reservation date', 'start', Q.start, 'type="date"')}
      ${field('Project', 'project', Q.project)}
      ${field('Unit no.', 'unit', Q.unit)}
      ${field('Unit type', 'type', Q.type)}
      ${field('Floor area (sqm)', 'area', Q.area, 'type="number" min="0" step="0.01"')}
      ${field('Unit price ₱', 'price', Q.price, 'type="number" min="0" step="1000"')}
      ${field('Parking price ₱', 'parking', Q.parking, 'type="number" min="0" step="1000"')}
    </div>
    <details class="fold" ${anyDisc ? 'open' : ''}><summary>Discounts (% of the unit price)</summary>
      <div class="form-grid">${DISCOUNTS.map(([k, l]) => field(`${esc(l)} %`, `d_${k}`, pct(Q.discounts[k]) || '', 'type="number" min="0" max="100" step="0.01" placeholder="0"')).join('')}</div></details>
    ${lto ? `<h3>Lease-to-Own terms</h3><div class="form-grid">
      ${field('Lease term (months)', 'l_term', L.term, 'type="number" min="1" max="360"')}
      ${field('Advance (months)', 'l_advance', L.advance, 'type="number" min="0" max="12"')}
      ${field('Security deposit (months)', 'l_security', L.security, 'type="number" min="0" max="12"')}
      ${field('Closing fee %', 'l_closing', pct(L.closingPct), 'type="number" min="0" max="100" step="0.01"')}
      ${field('Assoc. dues ₱ per sqm / month', 'l_dues', L.duesRate, 'type="number" min="0" step="0.01"')}
      ${field('Advance assoc. dues (months)', 'l_duesadv', L.duesAdvance, 'type="number" min="0" max="12"')}
      ${field('Documentary stamp tax %', 'l_dst', pct(L.dstPct), 'type="number" min="0" max="10" step="0.01"')}
    </div>` : `<h3>${Q.scheme === 'stepup' ? 'Step-up' : 'Standard'} payment terms</h3><div class="form-grid">
      ${field('Reservation fee ₱', 'i_rf', I.rf, 'type="number" min="0" step="1000"')}
      ${field('Down payment %', 'i_dp', pct(I.dpPct), 'type="number" min="0" max="100" step="0.01"')}
      ${field('Down payment months', 'i_dpm', I.dpMonths, 'type="number" min="1" max="120"')}
      ${field('Closing fee %', 'i_closing', pct(I.closingPct), 'type="number" min="0" max="100" step="0.01"')}
    </div>
    <div class="tiers">${I.tiers.map((t, i) => `<div class="row tier"><b class="small">${Q.scheme === 'stepup' ? `Step ${i + 1}` : 'Monthly installments'}</b>
      ${field('% of net price', `t_pct_${i}`, pct(t.pct), 'type="number" min="0" max="100" step="0.01"')}${field('Months', `t_m_${i}`, t.months, 'type="number" min="1" max="360"')}
      <button type="button" class="btn ghost sm" data-deltier="${i}" aria-label="Remove">✕</button></div>`).join('')}
      <button type="button" class="btn ghost sm" data-addtier>+ ${Q.scheme === 'stepup' ? 'Add a step' : 'Add installments'}</button>
      <p class="hint">Whatever is not covered by the down payment and installments is the retention / balance (bank or in-house financing).</p></div>`}
    <label class="small" style="display:flex;gap:6px;align-items:center;margin-top:8px"><input type="checkbox" name="schedule" ${Q.schedule ? 'checked' : ''}> Include the full payment schedule in the printout</label>`;
  f.oninput = (e) => { read(); if (e.target.name === 'scheme') drawForm(); else paint(); };
  f.onchange = (e) => { if (e.target.name === 'client') { const l = leads.find(x => x.full_name === e.target.value); if (l && !Q.unit) { Q.unit = l.unit || ''; Q.project = Q.project || l.project || ''; drawForm(); return; } } read(); paint(); };
  f.onclick = (e) => {
    if (e.target.closest('[data-addtier]')) { read(); const last = I.tiers.at(-1); I.tiers.push({ pct: last ? last.pct : 0.05, months: last ? last.months : 12 }); drawForm(); }
    const d = e.target.closest('[data-deltier]'); if (d) { read(); I.tiers.splice(+d.dataset.deltier, 1); drawForm(); }
  };
  paint();
}

/** Form → Q */
function read() {
  const f = $('#qf', root); const v = (n) => f.elements[n]?.value ?? ''; const n = (x, d = 0) => (v(x) === '' ? d : +v(x));
  const p = (x) => (v(x) === '' ? 0 : +v(x) / 100);
  Object.assign(Q, { client: v('client').trim(), scheme: v('scheme') || Q.scheme, start: v('start') || today(), project: v('project').trim(), unit: v('unit').trim(), type: v('type').trim(), area: v('area'), price: n('price'), parking: n('parking'), schedule: !!f.elements.schedule?.checked });
  Q.discounts = Object.fromEntries(DISCOUNTS.map(([k]) => [k, p(`d_${k}`)]).filter(([, x]) => x));
  if (f.elements.l_term) Object.assign(Q.lto, { term: n('l_term', 120), advance: n('l_advance', 1), security: n('l_security', 2), closingPct: p('l_closing'), duesRate: n('l_dues'), duesAdvance: n('l_duesadv'), dstPct: p('l_dst') });
  if (f.elements.i_rf) {
    Object.assign(Q.inst, { rf: n('i_rf'), dpPct: p('i_dp'), dpMonths: n('i_dpm', 1), closingPct: p('i_closing') });
    Q.inst.tiers = Q.inst.tiers.map((t, i) => ({ pct: p(`t_pct_${i}`), months: n(`t_m_${i}`) }));
  }
}

function paint() {
  const c = compute(Q);
  const warn = [...(Q.warnings || []), ...(c.warnings || [])];
  $('#qwarn', root).innerHTML = warn.length ? `<div class="qwarn">${Q.source ? `<b>From ${esc(Q.source)}:</b>` : ''}<ul>${warn.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : (Q.source ? `<p class="hint">Filled from ${esc(Q.source)}.</p>` : '');
  const h = quoteHTML(Q, c);
  $('#qv', root).innerHTML = h; document.getElementById('print-area').innerHTML = h;
}

// ── Filling the form from a computation sheet or a price-list unit ─────────
function fillTemplate(t) {
  Q = { ...blankQuote(), client: Q.client, start: Q.start, schedule: Q.schedule,
    scheme: t.scheme, project: t.project || '', unit: t.unit || '', type: t.type || '', area: t.area ?? '', price: t.price, parking: t.parking || 0,
    discounts: { ...(t.discounts || {}) }, warnings: t.warnings || [], source: `“${t.sheet}” in ${current?.file_name || 'the price list'}` };
  if (t.lto) Q.lto = { ...LTO_DEFAULTS, ...t.lto };
  if (t.inst) Q.inst = { ...INST_DEFAULTS, ...t.inst, tiers: t.inst.tiers.map(x => ({ ...x })) };
  drawForm();
}
function fillUnit(u) {
  read();
  Object.assign(Q, { project: u.project || Q.project, unit: u.unit || '', type: u.type || '', area: u.area ?? '', price: u.price, warnings: [], source: `${current?.file_name || 'the price list'}` });
  Q.discounts = u.discount ? { payment: u.discount / u.price } : {};
  if (u.dues && u.area) Q.lto.duesRate = +(u.dues / u.area).toFixed(2);
  drawForm();
}

function drawList() {
  const box = $('#plbox', root);
  if (!current) {
    box.innerHTML = `<p class="small">Upload RLC's <b>computation sheets</b> (one unit per sheet, like “Price Calculator.xlsx”) or a <b>price list</b> (many units in rows) — Excel, CSV, PDF or Word. Then pick a sheet or a unit and the quotation is filled in for you.</p>
      <p class="hint">Files uploaded in <b>Files</b> appear here too. You can also just type the figures below.</p>`;
    return;
  }
  const P = current.metrics.pricing, all = P.units || [], tpls = P.templates || [];
  const header = `<div class="row">
      ${lists.length > 1 ? `<label class="grow">File<select id="plsel">${lists.map(l => `<option value="${esc(l.id)}" ${l.id === current.id ? 'selected' : ''}>${esc(l.file_name)} · ${esc(fmtDate(l.last_modified))}</option>`).join('')}</select></label>`
        : `<div class="grow small"><b>${esc(current.file_name)}</b> · uploaded ${esc(fmtDateTime(current.last_modified))}</div>`}
      ${all.length || !tpls.length ? '<button class="btn ghost sm" type="button" id="plfix">Fix columns</button>' : ''}
    </div>`;
  const tplHTML = tpls.length ? `
    <label class="fld">Computation sheet (${int(tpls.length)})<select id="pltpl"><option value="">— Choose a sheet to fill in the quotation —</option>
      ${tpls.map((t, i) => `<option value="${i}">${esc(t.sheet)} — ${esc(t.label)}${t.warnings?.length ? ' ⚠' : ''}</option>`).join('')}</select></label>
    ${(P.notes || []).map(n => `<p class="hint">${esc(n)}</p>`).join('')}` : '';
  let unitHTML = '';
  if (all.length) {
    const projects = [...new Set(all.map(u => u.project).filter(Boolean))].sort();
    const types = [...new Set(all.map(u => u.type).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    const q = F.q.toLowerCase();
    const shown = all.filter(u => (!F.project || u.project === F.project) && (!F.type || u.type === F.type) && (!F.hideSold || !u.status) && (!q || u.label.toLowerCase().includes(q) || String(u.floor).toLowerCase() === q));
    const cols = Object.entries(P.mapping?.map || {}).map(([k, i]) => `${ROLES.find(r => r[0] === k)?.[1] || k}: “${P.mapping.headers[i] || '?'}”`).join(' · ');
    const sold = all.filter(u => u.status).length;
    unitHTML = `<div class="row">
      ${projects.length > 1 ? `<label>Project<select id="plp"><option value="">All</option>${projects.map(p => `<option ${F.project === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>` : ''}
      ${types.length > 1 ? `<label>Type<select id="plt"><option value="">All</option>${types.map(t => `<option ${F.type === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>` : ''}
      <label class="grow">Search<input id="plq" value="${esc(F.q)}" placeholder="Unit no., tower, type…"></label>
      ${sold ? `<label class="small" style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="plsold" ${F.hideSold ? 'checked' : ''}> Hide ${int(sold)} sold / reserved</label>` : ''}
    </div>
    <label class="fld">Unit (${int(shown.length)} shown)<select id="plunit"><option value="">— Choose a unit to fill in the quotation —</option>
      ${shown.slice(0, 1500).map(u => `<option value="${esc(u.id)}">${esc(u.label)} — ${esc(money(u.net))}${u.discount ? ` (list ${esc(money(u.price))})` : ''}${u.status ? ` · ${esc(u.status)}` : ''}</option>`).join('')}</select></label>
    <p class="hint">Columns used — ${esc(cols)}. ${(P.warnings || []).map(esc).join(' ')}</p>`;
  }
  box.innerHTML = header + tplHTML + unitHTML;
  const rerender = () => { const keep = root.querySelector('#plunit')?.value; drawList(); const s = root.querySelector('#plunit'); if (s && [...s.options].some(o => o.value === keep)) s.value = keep; };
  box.querySelector('#plsel')?.addEventListener('change', (e) => { current = lists.find(l => l.id === e.target.value); try { localStorage.setItem(PICK_KEY, current.id); } catch { /* ignore */ } Object.assign(F, { project: '', type: '', q: '' }); drawList(); });
  box.querySelector('#pltpl')?.addEventListener('change', (e) => { const t = tpls[+e.target.value]; if (e.target.value !== '' && t) fillTemplate(t); });
  box.querySelector('#plp')?.addEventListener('change', (e) => { F.project = e.target.value; rerender(); });
  box.querySelector('#plt')?.addEventListener('change', (e) => { F.type = e.target.value; rerender(); });
  box.querySelector('#plsold')?.addEventListener('change', (e) => { F.hideSold = e.target.checked; rerender(); });
  const qi = box.querySelector('#plq');
  if (qi) { let t; qi.oninput = (e) => { clearTimeout(t); t = setTimeout(() => { F.q = e.target.value; rerender(); const i = root.querySelector('#plq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); }; }
  box.querySelector('#plunit')?.addEventListener('change', (e) => { const u = units().find(x => x.id === e.target.value); if (u) fillUnit(u); });
  box.querySelector('#plfix')?.addEventListener('click', () => fixColumns().catch(fail));
}

async function uploadList(file) {
  const t = typeOf(file);
  if (!t || !['xlsx', 'xls', 'csv', 'pdf', 'docx'].includes(t.kind)) return toast('Upload the price list as Excel (.xlsx/.xls), CSV, PDF or Word (.docx).', 'err');
  const box = $('#plbox', root); box.innerHTML = `<p class="small">Uploading and reading ${esc(file.name)}…</p><div class="progress"><div style="width:40%"></div></div>`;
  try {
    const row = await uploadFile(file, { folder: t.kind === 'pdf' || t.kind === 'docx' ? 'docs' : 'sheets', tags: ['price list'] });
    const res = await processFile(row, file, { pricing: true });
    lists = await loadLists();
    current = lists.find(l => l.id === row.id) || null;
    if (current) {
      try { localStorage.setItem(PICK_KEY, current.id); } catch { /* ignore */ }
      const P = current.metrics.pricing, nt = P.templates?.length || 0, nu = P.units?.length || 0;
      toast(`Read ${[nt && `${nt} computation sheet(s)`, nu && `${nu} unit(s)`].filter(Boolean).join(' and ')}.${nt ? ' Pick a sheet to fill in the quotation.' : ''}`, 'ok');
    } else {
      toast('The file was saved, but no computation sheets or units with prices were found. Use “Fix columns” to choose them.', 'err');
      current = { ...res.row, metrics: { ...res.row.metrics, pricing: { units: [], templates: [], mapping: null, warnings: [] } } };
      drawList(); return fixColumns();
    }
    Object.assign(F, { project: '', type: '', q: '' });
    drawList();
  } catch (e) { fail(e); drawList(); }
}

/** Let the user choose which column is which when a price list has unusual headings. */
async function fixColumns() {
  if (!current) return;
  const read = await readFile(await download(current.storage_path), current.file_type);
  if (!read.tables.length) return toast(read.error || 'No table was found in this file.', 'err');
  const P = current.metrics.pricing || {};
  let sheet = P.mapping?.sheet && read.tables.some(t => t.name === P.mapping.sheet) ? P.mapping.sheet : read.tables[0].name;
  // first row with at least two text cells looks like the headings
  const guessHead = (rows) => Math.max(0, rows.slice(0, 30).findIndex(r => (r || []).filter(c => /[a-z]/i.test(String(c ?? ''))).length >= 2));
  let head = P.mapping?.sheet === sheet && P.mapping.head != null ? P.mapping.head : guessHead(read.tables.find(t => t.name === sheet).rows);
  const m = modal(`<h2>Fix price list columns<span class="sp"></span><button class="btn ghost sm" data-close>✕</button></h2>
    <p class="small">Tell Your Space which column holds what. Only <b>a price column</b> and <b>a unit no. or type column</b> are required.</p>
    <div class="form-grid" id="fx"></div><div id="fxprev" class="hint"></div>
    <div class="foot"><button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Use these columns</button></div>`, { wide: true });
  const box = m.el.querySelector('#fx');
  const rowsOf = () => read.tables.find(t => t.name === sheet).rows;
  const mapping = () => {
    const headers = (rowsOf()[head] || []).map(c => String(c ?? '').trim());
    const map = {};
    box.querySelectorAll('[data-role]').forEach(s => { if (s.value !== '') map[s.dataset.role] = +s.value; });
    return { sheet, head, start: head + 1, headers, map };
  };
  const preview = () => {
    const r = parsePriceList(read.tables, { mapping: mapping() });
    m.el.querySelector('#fxprev').innerHTML = r.units.length ? `✓ ${int(r.units.length)} units found, e.g. ${esc(r.units[0].label)} — ${esc(money(r.units[0].net))}` : '⚠ No units found with these choices yet.';
    return r;
  };
  const paintForm = (keep) => {
    const rows = rowsOf(), headers = (rows[head] || []).map(c => String(c ?? '').trim());
    const opts = (sel) => `<option value="">— not in this list —</option>${headers.map((h, i) => `<option value="${i}" ${sel === i ? 'selected' : ''}>${esc(h || `Column ${i + 1}`)}</option>`).join('')}`;
    box.innerHTML = `
      ${read.tables.length > 1 ? `<label class="fld">Sheet<select id="fxs">${read.tables.map(t => `<option ${t.name === sheet ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>` : ''}
      <label class="fld">Heading row<select id="fxh">${rows.slice(0, 30).map((r, i) => `<option value="${i}" ${i === head ? 'selected' : ''}>Row ${i + 1}: ${esc(r.map(c => String(c ?? '').trim()).filter(Boolean).join(' | ').slice(0, 70))}</option>`).join('')}</select></label>
      ${ROLES.map(([k, label]) => `<label class="fld">${esc(label)}<select data-role="${k}">${opts(keep?.[k] ?? null)}</select></label>`).join('')}`;
    box.querySelector('#fxs')?.addEventListener('change', (e) => { sheet = e.target.value; head = guessHead(rowsOf()); paintForm({}); preview(); });
    box.querySelector('#fxh').onchange = (e) => { head = +e.target.value; paintForm({}); preview(); };
    box.querySelectorAll('[data-role]').forEach(s => s.onchange = preview);
  };
  paintForm(P.mapping?.sheet === sheet ? P.mapping.map : {});
  preview();
  m.el.querySelector('[data-save]').onclick = async () => {
    const r = preview();
    if (!r.units.length) return toast('No units found yet — choose at least a price column and a unit no. or type column.', 'err');
    try {
      await savePricing(current, r);
      lists = await loadLists(); current = lists.find(l => l.id === current.id) || current;
      m.close(); toast(`Using ${r.units.length} units.`, 'ok'); drawList();
    } catch (e) { fail(e); }
  };
}


// ── Printable quotation ────────────────────────────────────────────────────
const P2 = (x) => `${+(x * 100).toFixed(2)}%`;
const D = (d) => (d ? esc(fmtDate(d)) : '—');
const row = (label, value, opts = {}) => `<tr${opts.cls ? ` class="${opts.cls}"` : ''}><td>${label}</td>${opts.mid != null ? `<td class="num">${opts.mid}</td>` : ''}<td class="num">${value}</td></tr>`;

function quoteHTML(q, c) {
  const p = c.price, lto = c.scheme === 'lto';
  const unitLine = [q.unit && `Unit ${esc(q.unit)}`, q.type && esc(q.type), q.area && `${esc(q.area)} sqm`].filter(Boolean).join(' · ') || '—';
  const priceRows = [
    row('Unit price', money(p.unit)),
    p.parking ? row('Parking', money(p.parking)) : '',
    ...p.discounts.map(d => row(`Less: ${esc(d.label)} (${P2(d.rate)})`, `(${money(d.amount)})`)),
    row('<b>Net total contract price</b>', `<b>${money(p.net)}</b>`, { cls: 'strong' }),
  ].join('');
  let terms = '', schedule = '';
  if (lto) {
    const lastPaid = c.term - c.security;
    terms = `
      <h3>Lease-to-Own: ${c.term} months at 0% interest</h3>
      <table class="zebra">
        ${row(`<b>Monthly lease</b> (net price ÷ ${c.term})`, `<b class="big">${money(c.rent)}</b>`)}
        ${row(`${c.advance} month(s) advance deposit — applied to month${c.advance > 1 ? 's' : ''} 1${c.advance > 1 ? `–${c.advance}` : ''}`, money(c.advDep))}
        ${c.security ? row(`${c.security} month(s) security deposit — applied to month${c.security > 1 ? 's' : ''} ${lastPaid + 1}${c.security > 1 ? `–${c.term}` : ''}`, money(c.secDep)) : ''}
        ${row(`Remaining monthly lease (months ${c.advance + 1}–${lastPaid}, ${c.remainingMonths} months)`, money(c.remaining))}
        ${c.closing ? row(`Closing fee (${P2(c.closingPct)} of net price) — month ${c.term + 1}`, money(c.closing)) : ''}
      </table>
      ${c.duesMonthly || c.dst ? `<h3>Association dues &amp; taxes</h3><table class="zebra">
        ${c.duesMonthly ? row(`Association dues (${money(c.duesRate)}/sqm × ${esc(q.area)} sqm) per month — months 1–${c.duesPaidMonths}`, money(c.duesMonthly)) : ''}
        ${c.duesAdv ? row(`Advance association dues (${c.duesAdvance} months)`, money(c.duesAdv)) : ''}
        ${c.dst ? row(`Documentary stamp tax (${P2(c.dstPct)} of net price)`, money(c.dst)) : ''}
      </table>` : ''}
      <h3>Summary of cash outlays</h3><table class="zebra">
        ${row(`<b>Move-in</b> (${[`${c.advance} mo. advance`, c.security && `${c.security} mo. security deposit`, c.duesAdv && `${c.duesAdvance} mo. assoc. dues`, c.dst && 'DST'].filter(Boolean).join(' + ')}) — ${D(q.start)}`, `<b>${money(c.moveIn)}</b>`)}
        ${row(`Monthly outlay — months ${c.advance + 1}–${Math.min(lastPaid, c.duesPaidMonths || lastPaid)}${c.duesMonthly ? ' (lease + assoc. dues)' : ''}`, `<b class="big">${money(c.monthlyOutlay)}</b>`)}
        ${c.closing ? row(`Turnover / closing fee — month ${c.term + 1} (${D(c.schedule.at(-1).date)})`, money(c.closing)) : ''}
        ${row('<b>Grand total over the full term</b>', `<b>${money(c.totals.total)}</b>`, { cls: 'strong' })}
      </table>
      <ul><li>The full monthly lease is credited toward the purchase of the unit; association dues are paid separately and are not credited.</li>
        <li>Move-in requires the advance and security deposits${c.duesAdv ? ', advance association dues' : ''}${c.dst ? ' and documentary stamp tax' : ''}, plus post-dated checks.</li></ul>`;
    if (q.schedule) schedule = `<h3>Payment schedule</h3><table class="sched"><thead><tr><th>Month</th><th>Date</th><th>Description</th><th class="num">Lease</th><th class="num">Assoc. dues</th><th class="num">Fees &amp; taxes</th><th class="num">Total</th><th class="num">Balance</th></tr></thead><tbody>
      ${c.schedule.map(r => `<tr><td>${r.m}</td><td>${D(r.date)}</td><td>${esc(r.desc)}</td><td class="num">${r.lease ? money(r.lease) : '–'}</td><td class="num">${r.dues ? money(r.dues) : '–'}</td><td class="num">${r.fees ? money(r.fees) : '–'}</td><td class="num">${money(r.total)}</td><td class="num">${money(r.balance)}</td></tr>`).join('')}
      <tr class="strong"><td colspan="3">Total</td><td class="num">${money(c.totals.lease)}</td><td class="num">${money(c.totals.dues)}</td><td class="num">${money(c.totals.fees)}</td><td class="num">${money(c.totals.total)}</td><td></td></tr></tbody></table>`;
  } else {
    terms = `
      <h3>${c.scheme === 'stepup' ? 'Step-up payment' : 'Standard payment'} terms</h3>
      <table class="zebra">
        ${row('Reservation fee', money(c.rf), { mid: D(q.start) })}
        ${c.dpPct ? row(`Down payment (${P2(c.dpPct)} of net price)`, money(c.dp)) : ''}
        ${c.dpPct ? row('Less: reservation fee', `(${money(c.rf)})`) : ''}
        ${c.dpPct ? row(`<b>Down payment due</b> — ${c.dpMonths} × <b>${money(c.dpEach)}</b>`, money(c.dpNet), { mid: `${D(c.dpDates?.from)} – ${D(c.dpDates?.to)}` }) : ''}
        ${c.tiers.map((t, i) => row(`${c.tiers.length > 1 ? `Step ${i + 1}: ` : ''}installments (${P2(t.pct)} of net price) — ${t.months} × <b>${money(t.each)}</b>`, money(t.amount), { mid: `${D(t.from)} – ${D(t.to)}` })).join('')}
        ${c.retention ? row(`Retention / balance (${P2(c.retentionPct)}) — bank or in-house financing`, money(c.retention), { mid: D(c.retentionDate) }) : ''}
        ${c.closing ? row(`Closing fee (${P2(c.closingPct)} of net price)`, money(c.closing), { mid: D(c.closingDate) }) : ''}
        ${row('<b>Total (net price + closing fee)</b>', `<b>${money(c.total)}</b>`, { cls: 'strong', mid: '' })}
      </table>`;
    if (q.schedule) schedule = `<h3>Payment schedule</h3><table class="sched"><thead><tr><th>Date</th><th>Description</th><th class="num">Amount</th><th class="num">Balance</th></tr></thead><tbody>
      ${c.schedule.map(r => `<tr><td>${D(r.date)}</td><td>${esc(r.desc)}</td><td class="num">${money(r.amount)}</td><td class="num">${r.fee ? '' : money(r.balance)}</td></tr>`).join('')}</tbody></table>`;
  }
  return `<div class="quote">
    <div class="qh"><h1>Quotation</h1><div>${esc(SCHEMES[c.scheme])} · Sample Computation · RLC Residences</div></div>
    <p><b>Prepared for:</b> ${esc(q.client || 'Valued Client')}<br><b>Project:</b> ${esc(q.project || '—')}<br><b>Unit:</b> ${unitLine}<br><b>Date:</b> ${esc(fmtDate(today()))}</p>
    <h3>Total contract price</h3><table class="zebra">${priceRows}</table>
    ${terms}${schedule}
    <p style="white-space:pre-line">${esc(sig)}</p>
    <p style="font-size:11px;color:#667">Sample computation for discussion only, not a contract or offer. Dates are counted from ${D(q.start)}. Final figures, requirements and availability are per RLC's price list and terms.${q.source ? ` Figures from ${esc(q.source)}.` : ''}</p>
  </div>`;
}
