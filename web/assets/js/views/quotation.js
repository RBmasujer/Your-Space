// Quotation: Lease-to-Own 120 computation + printable quotation.
// A developer price list (spreadsheet, PDF or Word table) can be uploaded here or in Files;
// picking a unit fills in its price, discount, condo dues and deposit.
import { sb, must, fetchAll } from '../lib/sb.js';
import { esc, money, fmtDate, fmtDateTime, today, saveBlob, $, modal, toast, fail, int } from '../lib/util.js';
import { uploadFile, typeOf } from '../lib/files.js';
import { processFile, savePricing } from '../lib/apply.js';
import { readFile } from '../lib/extract.js';
import { download } from '../lib/sb.js';
import { parsePriceList, ROLES } from '../lib/pricelist.js';

const PICK_KEY = 'ys-pricelist';
let leads = [], sig = '', lists = [], current = null, root, params = {};
const F = { project: '', type: '', q: '', hideSold: true };

export async function render(el, p) {
  root = el; params = p || {};
  [leads, sig, lists] = await Promise.all([
    fetchAll(() => sb.from('leads').select('id,full_name,phone,project,unit').order('full_name').order('id')),
    sb.from('settings').select('email_signature').maybeSingle().then(r => must(r)?.email_signature || ''),
    loadLists(),
  ]);
  let saved = null; try { saved = localStorage.getItem(PICK_KEY); } catch { /* ignore */ }
  current = lists.find(l => l.id === saved) || lists[0] || null;
  draw();
}

async function loadLists() {
  const rows = must(await sb.from('files_metadata').select('id,file_name,file_type,storage_path,last_modified,metrics,summary,tags').not('metrics->pricing', 'is', null).order('last_modified', { ascending: false }).limit(50));
  return rows.filter(r => r.metrics?.pricing?.units?.length);
}

// ── Page ───────────────────────────────────────────────────────────────────
function draw() {
  const pre = params.lead ? leads.find(l => l.id === params.lead) : null;
  root.innerHTML = `
  <div class="card"><h2>Price list<span class="sp"></span>
      <label class="btn sm" style="display:inline-flex">⬆ Upload price list<input id="plup" type="file" hidden accept=".xlsx,.xls,.csv,.pdf,.docx"></label></h2>
    <div id="plbox"></div>
  </div>
  <div class="card"><h2>Quotation · Lease-to-Own 120</h2>
    <form id="lf" class="form-grid">
      <label class="fld">Client<input name="client" list="cl" value="${esc(pre?.full_name || '')}" autocomplete="off"></label>
      <datalist id="cl">${leads.map(l => `<option value="${esc(l.full_name)}">`).join('')}</datalist>
      <label class="fld">Unit / project<input name="unit" value="${esc([pre?.unit, pre?.project].filter(Boolean).join(' · '))}"></label>
      <label class="fld">Total unit price ₱<input name="price" type="number" min="0" step="1000" value="6000000"></label>
      <label class="fld">Discounts / adjustments ₱<input name="disc" type="number" min="0" step="1000" value="0"></label>
      <label class="fld">Lease term (months)<input name="term" type="number" min="1" max="360" value="120"></label>
      <label class="fld">Condo dues ₱/month<input name="dues" type="number" min="0" value="0"></label>
      <label class="fld">Security deposit ₱<input name="dep" type="number" min="0" value="0"></label>
      <label class="fld">Lease start<input name="start" type="date" value=""></label>
      <input type="hidden" name="utype"><input type="hidden" name="uarea"><input type="hidden" name="src">
    </form>
    <p class="small" id="rentnote"></p>
    <div class="row" style="margin-top:10px"><button class="btn" id="print">Print / Save as PDF</button><button class="btn ghost" id="dl">Download quotation (.html)</button></div>
    <p class="hint" id="samplehint">Sample price shown — pick a unit from the price list above, or type the figures from the RLC price list.</p>
  </div>
  <div class="card"><div id="qv"></div></div>`;

  const f = $('#lf', root);
  const calc = () => {
    const n = k => +f.elements[k].value || 0;
    const net = Math.max(0, n('price') - n('disc')), term = Math.min(360, Math.max(1, Math.round(n('term')) || 120)), rent = net / term; // 1–360 months: a typo like 99999 must not freeze the tab
    return { client: f.client.value.trim() || 'Valued Client', unit: f.unit.value.trim(), price: n('price'), disc: n('disc'), net, term, rent, dues: n('dues'), dep: n('dep'), start: f.start.value,
      utype: f.utype.value, uarea: f.uarea.value, src: f.src.value };
  };
  const paint = () => {
    const c = calc(); const h = quoteHTML(c);
    $('#qv', root).innerHTML = h; document.getElementById('print-area').innerHTML = h;
    const u = selectedUnit();
    $('#rentnote', root).innerHTML = u?.rent && Math.abs(u.rent - c.rent) > Math.max(1, c.rent * 0.01)
      ? `ℹ️ The price list shows a monthly rent of <b>${esc(money(u.rent))}</b>; this quotation computes <b>${esc(money(c.rent))}</b> (net price ÷ ${c.term} months). Check which one RLC wants quoted.` : '';
  };
  f.oninput = paint;
  f.client.onchange = () => { const l = leads.find(x => x.full_name === f.client.value); if (l && !f.unit.value) f.unit.value = [l.unit, l.project].filter(Boolean).join(' · '); paint(); };
  $('#print', root).onclick = () => print();
  $('#dl', root).onclick = () => {
    const c = calc();
    const css = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules].map(r => r.cssText).filter(t => t.includes('.quote')); } catch { return []; } }).join('\n');
    saveBlob(new Blob([`<!doctype html><meta charset="utf-8"><title>Quotation — ${esc(c.client)}</title><style>${css}</style>${quoteHTML(c)}`], { type: 'text/html' }), `Quotation_${c.client.replace(/\W+/g, '_')}.html`);
  };
  $('#plup', root).onchange = (e) => { const file = e.target.files[0]; e.target.value = ''; if (file) uploadList(file); };
  root._fill = (u) => {
    f.unit.value = u.label; f.price.value = Math.round(u.price * 100) / 100; f.disc.value = Math.round((u.discount || 0) * 100) / 100;
    if (u.dues != null) f.dues.value = Math.round(u.dues * 100) / 100;
    if (u.deposit != null) f.dep.value = Math.round(u.deposit * 100) / 100;
    f.utype.value = u.type || ''; f.uarea.value = u.area || ''; f.src.value = current ? `${current.file_name} (${fmtDate(current.last_modified)})` : '';
    $('#samplehint', root).hidden = true;
    paint();
  };
  root._paint = paint;
  drawList();
  paint();
  // From a lead: pre-select the matching unit when the price list has it.
  if (pre?.unit && current) {
    const want = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const u = current.metrics.pricing.units.find(x => want(x.unit) === want(pre.unit) && (!pre.project || want(x.project).includes(want(pre.project)) || want(pre.project).includes(want(x.project))));
    if (u) { $('#plunit', root).value = u.id; root._fill(u); }
  }
}

function units() { return current?.metrics?.pricing?.units || []; }
function selectedUnit() { const id = root.querySelector('#plunit')?.value; return units().find(u => u.id === id) || null; }

function drawList() {
  const box = $('#plbox', root);
  if (!current) {
    box.innerHTML = `<p class="small">No price list yet. Upload the developer's price list (<b>Excel, CSV, PDF or Word table</b>) and pick a unit — its price, discount, condo dues and deposit are filled in for you.</p>
      <p class="hint">Price lists uploaded in <b>Files</b> appear here too.</p>`;
    return;
  }
  const P = current.metrics.pricing, all = P.units;
  const projects = [...new Set(all.map(u => u.project).filter(Boolean))].sort();
  const types = [...new Set(all.map(u => u.type).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const q = F.q.toLowerCase();
  const shown = all.filter(u => (!F.project || u.project === F.project) && (!F.type || u.type === F.type) && (!F.hideSold || !u.status) && (!q || u.label.toLowerCase().includes(q) || String(u.floor).toLowerCase() === q));
  const cols = Object.entries(P.mapping?.map || {}).map(([k, i]) => `${ROLES.find(r => r[0] === k)?.[1] || k}: “${P.mapping.headers[i] || '?'}”`).join(' · ');
  const sold = all.filter(u => u.status).length;
  box.innerHTML = `
    <div class="row">
      ${lists.length > 1 ? `<label class="grow">Price list<select id="plsel">${lists.map(l => `<option value="${esc(l.id)}" ${l.id === current.id ? 'selected' : ''}>${esc(l.file_name)} · ${int(l.metrics.pricing.units.length)} units · ${esc(fmtDate(l.last_modified))}</option>`).join('')}</select></label>`
        : `<div class="grow small"><b>${esc(current.file_name)}</b> · ${int(all.length)} units · uploaded ${esc(fmtDateTime(current.last_modified))}</div>`}
      <button class="btn ghost sm" type="button" id="plfix">Fix columns</button>
    </div>
    <div class="row">
      ${projects.length > 1 ? `<label>Project<select id="plp"><option value="">All</option>${projects.map(p => `<option ${F.project === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>` : ''}
      ${types.length > 1 ? `<label>Type<select id="plt"><option value="">All</option>${types.map(t => `<option ${F.type === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>` : ''}
      <label class="grow">Search<input id="plq" value="${esc(F.q)}" placeholder="Unit no., tower, type…"></label>
      ${sold ? `<label class="small" style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="plsold" ${F.hideSold ? 'checked' : ''}> Hide ${int(sold)} sold / reserved</label>` : ''}
    </div>
    <label class="fld">Unit (${int(shown.length)} shown)<select id="plunit"><option value="">— Choose a unit to fill in the quotation —</option>
      ${shown.slice(0, 1500).map(u => `<option value="${esc(u.id)}">${esc(u.label)} — ${esc(money(u.net))}${u.discount ? ` (list ${esc(money(u.price))})` : ''}${u.status ? ` · ${esc(u.status)}` : ''}</option>`).join('')}</select></label>
    <p class="hint">Columns used — ${esc(cols)}. ${(P.warnings || []).map(esc).join(' ')}</p>`;
  const rerender = () => { const keep = root.querySelector('#plunit').value; drawList(); const s = root.querySelector('#plunit'); if ([...s.options].some(o => o.value === keep)) s.value = keep; };
  box.querySelector('#plsel')?.addEventListener('change', (e) => { current = lists.find(l => l.id === e.target.value); try { localStorage.setItem(PICK_KEY, current.id); } catch { /* ignore */ } Object.assign(F, { project: '', type: '', q: '' }); drawList(); });
  box.querySelector('#plp')?.addEventListener('change', (e) => { F.project = e.target.value; rerender(); });
  box.querySelector('#plt')?.addEventListener('change', (e) => { F.type = e.target.value; rerender(); });
  box.querySelector('#plsold')?.addEventListener('change', (e) => { F.hideSold = e.target.checked; rerender(); });
  let t; box.querySelector('#plq').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { F.q = e.target.value; rerender(); const i = root.querySelector('#plq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
  box.querySelector('#plunit').onchange = () => { const u = selectedUnit(); if (u) root._fill(u); };
  box.querySelector('#plfix').onclick = () => fixColumns().catch(fail);
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
    if (current) { try { localStorage.setItem(PICK_KEY, current.id); } catch { /* ignore */ } toast(`Price list read: ${current.metrics.pricing.units.length} units.`, 'ok'); }
    else {
      toast('The file was saved, but no units with prices were found. Use “Fix columns” to choose them.', 'err');
      current = { ...res.row, metrics: { ...res.row.metrics, pricing: { units: [], mapping: null, warnings: [] } } };
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
function quoteHTML(c) {
  const years = Math.ceil(c.term / 12);
  const rows = Array.from({ length: years }, (_, i) => { const mths = Math.min((i + 1) * 12, c.term); return `<tr><td>Year ${i + 1}</td><td>${mths}</td><td>${money(c.rent * mths)}</td><td>${money(c.net - c.rent * mths)}</td></tr>`; }).join('');
  let end = '';
  if (c.start) { const d = new Date(`${c.start}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + c.term); d.setUTCDate(d.getUTCDate() - 1); end = d.toISOString().slice(0, 10); }
  return `<div class="quote">
    <div class="qh"><h1>Quotation</h1><div>Lease-to-Own ${c.term} · Sample Computation · RLC Residences</div></div>
    <p><b>Prepared for:</b> ${esc(c.client)}<br><b>Unit:</b> ${esc(c.unit || '—')}${c.utype ? `<br><b>Unit type:</b> ${esc(c.utype)}` : ''}${c.uarea ? `<br><b>Floor area:</b> ${esc(c.uarea)} sqm` : ''}<br><b>Date:</b> ${esc(fmtDate(today()))}${c.start ? `<br><b>Lease:</b> ${esc(fmtDate(c.start))} to ${esc(fmtDate(end))}` : ''}</p>
    <table class="zebra" style="width:100%;border-collapse:collapse">
      <tr><td>Total unit price</td><td class="num">${money(c.price)}</td></tr>
      <tr><td>Less: discounts / adjustments</td><td class="num">${money(c.disc)}</td></tr>
      <tr><td><b>Net Total Contract Price</b></td><td class="num"><b>${money(c.net)}</b></td></tr>
      <tr><td><b>Fixed monthly rent</b> (÷ ${c.term} months)</td><td class="num big">${money(c.rent)}</td></tr>
      <tr><td>Annual rent</td><td class="num">${money(c.rent * 12)}</td></tr>
      <tr><td>Monthly condo dues (not credited)</td><td class="num">${c.dues ? money(c.dues) : 'As per project'}</td></tr>
      <tr><td>Monthly outlay incl. condo dues</td><td class="num">${money(c.rent + c.dues)}</td></tr>
      <tr><td>Security deposit</td><td class="num">${c.dep ? money(c.dep) : 'As per RLC price list'}</td></tr>
      <tr><td>Reservation fee</td><td class="num">None</td></tr>
    </table>
    <h3>Rent credited toward your home</h3>
    <table style="width:100%;border-collapse:collapse"><tr style="background:#1b6fb5;color:#fff"><th style="color:#fff">Year</th><th style="color:#fff">Months paid</th><th style="color:#fff">Total credited</th><th style="color:#fff">Balance</th></tr>${rows}</table>
    <ul><li>${Math.round(c.term / 12)}-year (${c.term}-month) lease with a fixed monthly rent.</li><li>Your full monthly rent is credited toward the purchase of your home.</li>
      <li>Booking and move-in: applicable rent, security deposit, condo dues and post-dated checks. No reservation fee.</li><li>Rent excludes condo dues, which are not credited.</li></ul>
    <p style="white-space:pre-line">${esc(sig)}</p>
    <p style="font-size:11px;color:#667">Sample computation for discussion only, not a contract or offer. Final figures, requirements and availability are per RLC's price list and terms.${c.src ? ` Prices from: ${esc(c.src)}.` : ''}</p>
  </div>`;
}
