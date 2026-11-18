// Files: upload, organize (tags), preview, edit in the browser, and monitor spreadsheet metrics.
// Spreadsheets, Word files and PDFs are read on upload: schedules, leads lists and content
// plans are applied to the app automatically (with Undo), and every file gets an overview.
import { sb, must, signedUrl, download } from '../lib/sb.js';
import { esc, modal, toast, fail, bytes, fmtDateTime, fmtDate, loadScript, debounce, int, saveBlob } from '../lib/util.js';
import { processFile, undoApply, plural } from '../lib/apply.js';
import { readable } from '../lib/extract.js';
import { uploadFile, replaceFile, deleteFile, processSheet, kindOf, isSheet, ACCEPT } from '../lib/files.js';
import { SHEETJS_URL } from '../config.js';
import { sanitizeHTML } from '../lib/sanitize.js';

const ICON = { pdf: '📕', docx: '📄', xlsx: '📊', xls: '📊', csv: '📑', image: '🖼️', video: '🎬', other: '📦' };
const FOLDER = { pdf: 'docs', docx: 'docs', other: 'docs', xlsx: 'sheets', xls: 'sheets', csv: 'sheets', image: 'images', video: 'content' };
const TYPES = [['pdf', 'PDF'], ['docx', 'Word'], ['xlsx', 'Excel (.xlsx)'], ['xls', 'Excel (.xls)'], ['csv', 'CSV'], ['image', 'Images'], ['video', 'Videos'], ['other', 'Other']];
let rows = [], root;
let results = [];   // outcome of the latest upload batch, shown under the upload box
const PAGE = { schedule_events: ['#/schedule', 'Manning & Tripping calendar'], content_posts: ['#/content', 'Content calendar'], leads: ['#/leads', 'Leads'] };
const KIND = { schedule: '📅 Schedule', leads: '👥 Leads list', posts: '📣 Content plan' };
const F = { q: '', type: '', tag: '' };
let XLSX = null;
const sheetjs = async () => (XLSX ||= await import(SHEETJS_URL));

export async function render(el) {
  root = el;
  await load();
}

async function load() {
  rows = must(await sb.from('files_metadata').select('*').order('last_modified', { ascending: false }).limit(1000));
  draw();
}

function shown() {
  const q = F.q.toLowerCase();
  return rows.filter(r => (!q || `${r.file_name} ${r.summary || ''} ${(r.tags || []).join(' ')}`.toLowerCase().includes(q)) && (!F.type || r.file_type === F.type) && (!F.tag || (r.tags || []).includes(F.tag)));
}

function statusChip(r) {
  if (!isSheet(r.file_type)) return '';
  const k = { done: 'ok', error: 'hot', pending: 'warn', processing: 'warn' }[r.processing_status] || '';
  return `<span class="chip ${k}" title="${esc(r.processing_error || '')}">${esc(r.processing_status)}</span>`;
}

function draw() {
  const allTags = [...new Set(rows.flatMap(r => r.tags || []))].sort();
  const list = shown();
  const used = rows.reduce((a, r) => a + (+r.size_bytes || 0), 0);
  root.innerHTML = `
  <div class="card"><h2>Upload</h2>
    <div class="drop" id="drop"><span class="desk-only">Drag files here or </span><label class="btn sm" style="display:inline-flex">📎 Choose files<input id="pick" type="file" multiple hidden accept="${ACCEPT}"></label>
      <div class="hint">PDF, Word (.docx, .doc), spreadsheets (.xlsx, .xls, .csv), images (JPG, PNG, WebP, HEIC…) and short videos · up to 50 MB each</div></div>
    <div class="row" style="margin-top:10px"><label class="grow">Tags for new uploads (comma separated)<input id="tags" placeholder="e.g. marketing, cirrus, november"></label></div>
    <p class="hint">📅 Schedules, 👥 leads lists and 📣 content plans inside spreadsheets, Word files and PDFs are <b>added to the app automatically</b>. Re-uploading an updated schedule replaces the entries an older upload added for the same dates (entries you typed or edited yourself are kept).</p>
    <div id="upl">${resultsHTML()}</div>
    <p class="hint">Storage used: ${esc(bytes(used))} of 1 GB (Supabase Free).</p>
  </div>
  <div class="card"><h2>Files · ${list.length}</h2>
    <div class="row">
      <label class="grow">Search<input id="fq" value="${esc(F.q)}" placeholder="Name, tag or summary…"></label>
      <label>Type<select id="ft"><option value="">All</option>${TYPES.map(([t, l]) => `<option value="${t}" ${F.type === t ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Tag<select id="fg"><option value="">All</option>${allTags.map(t => `<option ${F.tag === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
    </div>
    ${list.length ? `<div class="tbl-wrap"><table class="stack files"><thead><tr><th>Name</th><th>Tags</th><th>Summary / metrics</th><th>Modified</th><th class="num">Size</th><th></th></tr></thead><tbody>
      ${list.map(r => `<tr>
        <td data-label="File" class="fname"><button class="btn ghost sm" data-open="${esc(r.id)}">${ICON[r.file_type] || ''} ${esc(r.file_name)}</button></td>
        <td data-label="Tags"><div class="chips">${(r.tags || []).map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div></td>
        <td class="small" data-label="Summary">${statusChip(r)}${r.metrics?.pricing?.units?.length ? ` <a class="chip ok" href="#/quotation">💲 Price list · ${int(r.metrics.pricing.units.length)} units</a>` : ''}${r.metrics?.applied ? ` <span class="chip ok">✓ ${esc(plural(r.metrics.applied.table, r.metrics.applied.inserted.length))} applied</span>` : ''} ${esc((r.summary || '').slice(0, 160))}</td>
        <td class="nowrap small" data-label="Modified">${esc(fmtDateTime(r.last_modified))}</td>
        <td class="num small" data-label="Size">${esc(bytes(r.size_bytes))}</td>
        <td class="nowrap acts" data-label=""><button class="btn ghost sm" data-dl="${esc(r.id)}" title="Download">⬇</button><button class="btn ghost sm" data-info="${esc(r.id)}" title="Details">✎</button></td>
      </tr>`).join('')}</tbody></table></div>` : '<div class="empty">No files yet.</div>'}
  </div>`;

  const drop = root.querySelector('#drop');
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => upload([...e.dataTransfer.files]));
  root.querySelector('#pick').onchange = e => upload([...e.target.files]);
  root.querySelector('#fq').oninput = debounce(e => { F.q = e.target.value; draw(); const i = root.querySelector('#fq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250);
  root.querySelector('#ft').onchange = e => { F.type = e.target.value; draw(); };
  root.querySelector('#fg').onchange = e => { F.tag = e.target.value; draw(); };
  root.onclick = async (e) => {
    const u = e.target.closest('[data-undo]');
    if (u) return undo(rows.find(x => x.id === u.dataset.undo), u);
    if (e.target.closest('[data-clear-results]')) { results = []; return draw(); }
    const b = e.target.closest('[data-open],[data-dl],[data-info]');
    if (!b) return;
    const r = rows.find(x => x.id === (b.dataset.open || b.dataset.dl || b.dataset.info));
    try {
      if (b.dataset.dl) { const a = document.createElement('a'); a.href = await signedUrl(r.storage_path, { download: true }); a.rel = 'noopener'; a.click(); }
      else if (b.dataset.info) details(r);
      else openFile(r);
    } catch (err) { fail(err); }
  };
}

async function upload(files) {
  if (!files.length) return;
  const tags = root.querySelector('#tags').value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean).slice(0, 20);
  const box = root.querySelector('#upl');
  let ok = 0; results = [];
  const step = (i, what, name) => { box.innerHTML = `<p class="small">${what} ${i + 1} of ${files.length}: ${esc(name)}…</p><div class="progress"><div style="width:${(i / files.length) * 100}%"></div></div>`; };
  for (const [i, file] of files.entries()) {
    step(i, 'Uploading', file.name);
    try {
      const kind = kindOf(file);
      let row = await uploadFile(file, { folder: FOLDER[kind] || 'docs', tags });
      ok++;
      if (readable(row.file_type)) {
        step(i, 'Reading', file.name);
        const res = await processFile(row, file);
        row = res.row;
        results.push({ id: row.id, name: row.file_name, kind: res.result?.kind, summary: row.summary, applied: res.applied, error: res.error ? (res.error.message || String(res.error)) : null, warnings: res.result?.warnings || [] });
      }
      if (row.processing_status === 'pending') processSheet(row.id).then(load).catch(() => { /* metrics need the Edge Function; the overview above already works */ });
    } catch (e) { fail(e); }
  }
  const added = results.reduce((a, r) => a + (r.applied?.inserted.length || 0), 0);
  toast(`Uploaded ${ok} of ${files.length} file(s)${added ? ` · ${added} item(s) added to the app` : ''}.`, ok ? 'ok' : 'err');
  await load();
}

function resultsHTML() {
  if (!results.length) return '';
  return `<div class="results"><div class="row" style="justify-content:space-between;align-items:center;margin:10px 0 4px"><b>What was found</b><button class="btn ghost sm" data-clear-results>Hide</button></div>
    ${results.map(r => {
      const a = rows.find(x => x.id === r.id)?.metrics?.applied || r.applied;
      const page = a && PAGE[a.table];
      return `<div class="result ${r.error ? 'bad' : a ? 'good' : ''}">
        <div><b>${esc(r.name)}</b> ${r.kind ? `<span class="chip">${esc(KIND[r.kind])}</span>` : ''}</div>
        <div class="small">${esc(r.summary || '')}</div>
        ${a ? `<div class="small">✓ Added ${esc(plural(a.table, a.inserted.length))}${a.replaced.length ? ` · replaced ${int(a.replaced.length)} from an older upload` : ''}${a.skipped ? ` · ${int(a.skipped)} already there` : ''}${a.range ? ` · ${esc(fmtDate(a.range[0]))} – ${esc(fmtDate(a.range[1]))}` : ''}</div>
          <div class="row" style="margin:6px 0 0"><a class="btn sm" href="${page[0]}">Open ${esc(page[1])}</a><button class="btn ghost sm" data-undo="${esc(r.id)}">↶ Undo</button></div>` : ''}
        ${r.error ? `<div class="small due">Could not add to the app: ${esc(r.error)}</div>` : ''}
        ${r.warnings.map(w => `<div class="small muted">⚠ ${esc(w)}</div>`).join('')}
      </div>`;
    }).join('')}</div>`;
}

async function undo(r, btn) {
  const a = r?.metrics?.applied; if (!a) return;
  const what = plural(a.table, a.inserted.length);
  if (!confirm(`Undo the import from ${r.file_name}?\n\nThis removes the ${what} it added${a.replaced.length ? ` and puts back ${a.replaced.length} entr${a.replaced.length === 1 ? 'y' : 'ies'} it replaced` : ''}. The file itself stays.`)) return;
  if (btn) btn.disabled = true;
  try {
    const res = await undoApply(r);
    toast(`Undone: removed ${res.removed}${res.restored ? `, restored ${res.restored}` : ''}${res.kept ? ` (kept ${res.kept} edited since)` : ''}.`, 'ok');
    await load();
    return res;
  } catch (e) { fail(e); if (btn) btn.disabled = false; }
}

/** Overview panel for the details dialog. */
function overviewHTML(r) {
  const o = r.metrics?.overview || {}, a = r.metrics?.applied;
  if (!r.metrics?.overview && !r.metrics?.pricing) return readable(r.file_type) ? '<p class="hint">This file has not been read yet — use “Read & apply” below.</p>' : '';
  const facts = [];
  if (o.kind) facts.push(`<b>${esc(KIND[o.kind])}</b> · ${int(o.count)} item(s)${o.layout ? ` · ${esc({ list: 'list', roster: 'roster grid', calendar: 'monthly calendar', lines: 'text lines' }[o.layout] || o.layout)} layout` : ''}`);
  if (o.range) facts.push(`Dates: ${esc(fmtDate(o.range[0]))} – ${esc(fmtDate(o.range[1]))}`);
  if (o.byKind) facts.push(Object.entries(o.byKind).map(([k, n]) => `${esc(k)} ${int(n)}`).join(' · ') + (o.skipped ? ` · ${int(o.skipped)} day(s) off skipped` : ''));
  if (o.pages) facts.push(`${int(o.pages)} page(s)`);
  if (o.tables?.length && !o.pages) facts.push(o.tables.slice(0, 6).map(t => `${esc(t.name)}: ${int(t.rows)} rows × ${int(t.columns)} columns`).join(' · '));
  if (o.words) facts.push(`${int(o.words)} words`);
  if (o.amounts) facts.push(`${int(o.amounts.count)} peso amount(s), total ₱${esc(o.amounts.total.toLocaleString('en-PH'))}, largest ₱${esc(o.amounts.max.toLocaleString('en-PH'))}`);
  if (o.emails || o.phones) facts.push(`${int(o.emails)} email address(es) · ${int(o.phones)} phone number(s)`);
  const page = a && PAGE[a.table];
  if (r.metrics?.pricing?.units?.length) facts.unshift(`<b>💲 Price list</b> · ${int(r.metrics.pricing.units.length)} unit(s) · <a href="#/quotation" data-close>Use it in Quotation</a>`);
  return `<h3>Overview</h3><ul class="ov">${facts.map(f => `<li>${f}</li>`).join('')}</ul>
    ${(o.warnings || []).map(w => `<p class="small muted">⚠ ${esc(w)}</p>`).join('')}
    ${a ? `<p class="small">✓ Added ${esc(plural(a.table, a.inserted.length))} on ${esc(fmtDateTime(a.at))}${a.replaced.length ? `, replacing ${int(a.replaced.length)} from an older upload` : ''}${a.skipped ? ` (${int(a.skipped)} already there)` : ''} · <a href="${page[0]}" data-close>Open ${esc(page[1])}</a></p>` : r.metrics?.undone ? `<p class="small muted">Import undone ${esc(fmtDateTime(r.metrics.undone.at))}.</p>` : ''}
    ${o.preview?.length ? `<details class="tableview"><summary>First lines of the file</summary><div class="ov-preview">${o.preview.map(l => `<div>${esc(l)}</div>`).join('')}</div></details>` : ''}`;
}

// ── Details: rename, tags, summary, metrics, delete ────────────────────────
function details(r) {
  const m = modal(`
    <h2>${ICON[r.file_type]} File details<span class="sp"></span><button class="btn ghost sm" data-close>✕</button></h2>
    <div class="form-grid">
      <label class="fld wide">Name<input id="dn" value="${esc(r.file_name)}" maxlength="255"></label>
      <label class="fld wide">Tags (comma separated)<input id="dt" value="${esc((r.tags || []).join(', '))}"></label>
      <label class="fld wide">Summary / note<textarea id="ds" rows="3">${esc(r.summary)}</textarea></label>
    </div>
    ${overviewHTML(r)}
    ${metricsHTML(r)}
    <div class="foot"><span class="left"><button class="btn danger" data-del>Delete file</button>
      ${readable(r.file_type) ? '<button class="btn ghost" data-apply>Read & apply again</button>' : ''}
      ${r.metrics?.applied ? '<button class="btn ghost" data-undo-d>↶ Undo import</button>' : ''}
      ${isSheet(r.file_type) ? '<button class="btn ghost" data-re>Re-run metrics</button>' : ''}</span>
      <button class="btn ghost" data-close>Close</button><button class="btn" data-save>Save</button></div>`, { wide: true });
  m.el.querySelector('[data-save]').onclick = async () => {
    try {
      must(await sb.from('files_metadata').update({
        file_name: m.el.querySelector('#dn').value.trim() || r.file_name,
        tags: m.el.querySelector('#dt').value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean).slice(0, 20),
        summary: m.el.querySelector('#ds').value.trim() || null,
      }).eq('id', r.id));
      m.close(); toast('Saved.', 'ok'); load();
    } catch (e) { fail(e); }
  };
  m.el.querySelector('[data-re]')?.addEventListener('click', async () => {
    try {
      must(await sb.from('files_metadata').update({ processing_status: 'pending', processing_error: null }).eq('id', r.id));
      await processSheet(r.id); toast('Metrics updated.', 'ok'); m.close(); load();
    } catch (e) { fail(e); }
  });
  m.el.querySelector('[data-apply]')?.addEventListener('click', async (ev) => {
    ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Reading…';
    try {
      const res = await processFile(r);
      results = [{ id: r.id, name: r.file_name, kind: res.result?.kind, summary: res.row.summary, applied: res.applied, error: res.error ? (res.error.message || String(res.error)) : null, warnings: res.result?.warnings || [] }];
      toast(res.applied ? `Added ${plural(res.applied.table, res.applied.inserted.length)}.` : 'Overview updated — nothing to add to the app.', 'ok');
      m.close(); await load();
    } catch (e) { fail(e); }
  });
  m.el.querySelector('[data-undo-d]')?.addEventListener('click', async () => { if (await undo(r)) m.close(); });
  m.el.querySelector('[data-del]').onclick = async () => {
    if (!confirm(`Delete ${r.file_name} permanently?`)) return;
    try {
      const a = r.metrics?.applied;
      if (a?.inserted?.length && confirm(`Also remove the ${plural(a.table, a.inserted.length)} this file added to the app?\n\nOK = remove them too · Cancel = keep them`)) await undoApply(r);
      await deleteFile(r); m.close(); toast('Deleted.', 'ok'); load();
    } catch (e) { fail(e); }
  };
}

function metricsHTML(r) {
  const mt = r.metrics || {};
  if (!mt.sheets?.length) return r.processing_error ? `<p class="toast err">${esc(r.processing_error)}</p>` : '';
  return `<h3>Extracted metrics <span class="muted small">(${esc(fmtDateTime(mt.generated_at))})</span></h3>` + mt.sheets.map(s => `
    <div class="card" style="box-shadow:none"><h2>${esc(s.name)} <span class="muted small">${int(s.rows)} rows · ${int(s.columns?.length || 0)} columns</span></h2>
      ${(s.columns || []).filter(c => c.numeric).length ? `<div class="tbl-wrap"><table><thead><tr><th>Numeric column</th><th class="num">Sum</th><th class="num">Average</th><th class="num">Min</th><th class="num">Max</th><th class="num">Count</th></tr></thead><tbody>
        ${s.columns.filter(c => c.numeric).map(c => `<tr><td>${esc(c.name)}</td><td class="num">${esc(int(c.numeric.sum))}</td><td class="num">${esc(int(Math.round(c.numeric.avg)))}</td><td class="num">${esc(int(c.numeric.min))}</td><td class="num">${esc(int(c.numeric.max))}</td><td class="num">${esc(int(c.numeric.count))}</td></tr>`).join('')}
      </tbody></table></div>` : ''}
      ${(s.columns || []).filter(c => c.categories).map(c => `<p class="small"><b>${esc(c.name)}:</b> ${c.categories.map(([k, n]) => `${esc(k)} ${int(n)}`).join(' · ')}</p>`).join('')}
    </div>`).join('');
}

// ── Open: preview + edit ────────────────────────────────────────────────────
async function openFile(r) {
  if (r.file_type === 'image') return imageEditor(r);
  if (r.file_type === 'video') { const u = await signedUrl(r.storage_path); return modal(`<h2>${esc(r.file_name)}<span class="sp"></span><button class="btn ghost sm" data-close>✕</button></h2><video src="${esc(u)}" controls style="width:100%;max-height:70vh"></video>`, { wide: true }); }
  if (r.file_type === 'docx') return docxEditor(r);
  if (r.file_type === 'pdf') return pdfViewer(r);
  if (isSheet(r.file_type)) return sheetEditor(r);
  return downloadOnly(r, 'This file type can be stored here but not previewed in the browser.');
}

function downloadOnly(r, why) {
  const m = modal(`<h2>${ICON[r.file_type] || '📦'} ${esc(r.file_name)}<span class="sp"></span><button class="btn ghost sm" data-close>✕</button></h2>
    <p>${esc(why)}</p><div class="foot"><button class="btn ghost" data-close>Close</button><button class="btn" data-dl>⬇ Download</button></div>`);
  m.el.querySelector('[data-dl]').onclick = async () => {
    try { const a = document.createElement('a'); a.href = await signedUrl(r.storage_path, { download: true }); a.rel = 'noopener'; a.click(); } catch (e) { fail(e); }
  };
}

// PDF: the browser's own viewer in a frame. Phones that can't show PDFs inline get Open/Download buttons.
async function pdfViewer(r) {
  const m = modal(`<h2>📕 ${esc(r.file_name)}<span class="sp"></span><button class="btn ghost sm" data-close>✕</button></h2>
    <div id="px" class="empty">Opening…</div>
    <div class="foot"><button class="btn ghost" data-close>Close</button><a class="btn ghost" data-tab target="_blank" rel="noopener">Open in new tab</a><button class="btn" data-dl>⬇ Download</button></div>`,
  { wide: true, onClose: () => url && URL.revokeObjectURL(url) });
  let url = '';
  try {
    const blob = await download(r.storage_path);
    url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
    const box = m.el.querySelector('#px'); box.className = '';
    box.innerHTML = `<iframe class="pdf-frame" title="${esc(r.file_name)}" src="${esc(url)}"></iframe>`;
    m.el.querySelector('[data-tab]').href = url;
  } catch (e) { m.el.querySelector('#px').textContent = 'Could not open: ' + (e.message || e); }
  m.el.querySelector('[data-dl]').onclick = async () => {
    try { const a = document.createElement('a'); a.href = await signedUrl(r.storage_path, { download: true }); a.rel = 'noopener'; a.click(); } catch (e) { fail(e); }
  };
}

// Spreadsheet editor (SheetJS). Edits cells in place so formulas in other cells survive.
async function sheetEditor(r) {
  const m = modal(`<h2>📊 ${esc(r.file_name)}<span class="sp"></span><button class="btn ghost sm" data-close>✕</button></h2><div id="sx" class="empty">Opening…</div>`, { wide: true });
  try {
    const X = await sheetjs();
    const blob = await download(r.storage_path);
    const wb = r.file_type === 'csv'
      ? X.read(await blob.text(), { type: 'string', raw: true })        // raw: keep phone numbers as text
      : X.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array', cellDates: true });
    let cur = wb.SheetNames[0];
    let dirty = false;
    const MAXR = 1000, MAXC = 50;
    const box = m.el.querySelector('#sx'); box.className = '';
    const paint = () => {
      const ws = wb.Sheets[cur];
      const rng = X.utils.decode_range(ws['!ref'] || 'A1:A1');
      const nr = Math.min(rng.e.r, MAXR - 1), nc = Math.min(rng.e.c, MAXC - 1);
      let head = '<tr><th class="rn">#</th>'; for (let c = 0; c <= nc; c++) head += `<th>${X.utils.encode_col(c)}</th>`; head += '</tr>';
      let body = '';
      for (let rr = 0; rr <= nr; rr++) {
        body += `<tr><th class="rn">${rr + 1}</th>`;
        for (let c = 0; c <= nc; c++) {
          const cell = ws[X.utils.encode_cell({ r: rr, c })];
          const val = cell ? (cell.w ?? (cell.v instanceof Date ? cell.v.toISOString().slice(0, 10) : cell.v)) : '';
          body += `<td><input data-a="${X.utils.encode_cell({ r: rr, c })}" value="${esc(val)}" ${cell?.f ? `title="Formula: =${esc(cell.f)}" readonly style="color:var(--blue)"` : ''}></td>`;
        }
        body += '</tr>';
      }
      box.innerHTML = `
        <div class="row">${wb.SheetNames.length > 1 ? `<label>Sheet<select id="sn">${wb.SheetNames.map(n => `<option ${n === cur ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>` : ''}
          <button class="btn ghost sm" data-addrow>+ Add row</button>
          <span class="muted small">${rng.e.r + 1} rows × ${rng.e.c + 1} cols${rng.e.r >= MAXR || rng.e.c >= MAXC ? ` — showing the first ${MAXR}×${MAXC}; edit the rest in Excel` : ''}. Blue cells are formulas (read-only here).</span></div>
        <div class="sheet-wrap"><table class="sheet"><thead>${head}</thead><tbody>${body}</tbody></table></div>
        <p class="hint">Saving keeps values and formulas. Cell colors/borders are not kept by the browser editor — use “Save as copy” if the original's formatting matters.</p>
        <div class="foot"><span class="left"><button class="btn ghost" data-csv>Download as CSV</button></span>
          <button class="btn ghost" data-close>Close</button><button class="btn ghost" data-copy>Save as copy</button><button class="btn" data-save>Save</button></div>`;
      box.querySelector('#sn')?.addEventListener('change', e => { cur = e.target.value; paint(); });
      box.querySelector('[data-addrow]').onclick = () => { const rg = X.utils.decode_range(ws['!ref'] || 'A1:A1'); rg.e.r++; ws['!ref'] = X.utils.encode_range(rg); paint(); box.querySelector('.sheet-wrap').scrollTop = 1e9; };
      box.querySelector('tbody').addEventListener('change', e => {
        const a = e.target.dataset.a; if (!a) return;
        const raw = e.target.value; const old = ws[a];
        const asNum = raw.trim() !== '' && !/^0\d/.test(raw.trim()) && !isNaN(+raw.replace(/,/g, '')) && (old?.t === 'n' || !old);
        if (raw === '') delete ws[a];
        else ws[a] = asNum ? { t: 'n', v: +raw.replace(/,/g, '') } : { t: 's', v: raw };
        dirty = true;
      });
      const out = () => {
        if (r.file_type === 'csv') return new Blob(['﻿' + X.utils.sheet_to_csv(wb.Sheets[cur])], { type: 'text/csv' });
        const bookType = r.file_type === 'xls' ? 'biff8' : 'xlsx';
        return new Blob([X.write(wb, { type: 'array', bookType, compression: true })], { type: r.mime_type });
      };
      box.querySelector('[data-csv]').onclick = () => saveBlob(new Blob(['﻿' + X.utils.sheet_to_csv(wb.Sheets[cur])], { type: 'text/csv' }), r.file_name.replace(/\.\w+$/, '') + `-${cur}.csv`);
      box.querySelector('[data-save]').onclick = async (ev) => {
        if (!dirty && !confirm('No changes detected. Save anyway?')) return;
        ev.target.disabled = true;
        try {
          let row = await replaceFile(r, out()); dirty = false; m.close();
          // An edited schedule replaces what this file added before.
          const res = await processFile(row).catch(() => null); if (res) row = res.row;
          toast(res?.applied ? `Saved · ${plural(res.applied.table, res.applied.inserted.length)} applied.` : 'Saved.', 'ok');
          processSheet(row.id).then(load).catch(() => load()); load();
        }
        catch (e) { fail(e); ev.target.disabled = false; }
      };
      box.querySelector('[data-copy]').onclick = async () => {
        const name = prompt('Name for the copy', r.file_name.replace(/(\.\w+)$/, ' (edited)$1')); if (!name) return;
        try { const row = await uploadFile(new File([out()], name, { type: r.mime_type }), { folder: 'sheets', tags: r.tags || [] }); processSheet(row.id).then(load).catch(() => load()); toast('Copy saved.', 'ok'); m.close(); }
        catch (e) { fail(e); }
      };
    };
    paint();
  } catch (e) { m.el.querySelector('#sx').textContent = 'Could not open: ' + (e.message || e); }
}

// Word editor: Mammoth → HTML (editable) → docx library → new .docx copy.
async function docxEditor(r) {
  const m = modal(`<h2>📄 ${esc(r.file_name)}<span class="sp"></span><button class="btn ghost sm" data-close>✕</button></h2><div id="dx" class="empty">Opening…</div>`, { wide: true });
  try {
    await loadScript('assets/vendor/mammoth.browser.min.js');
    const blob = await download(r.storage_path);
    const res = await window.mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() });
    const box = m.el.querySelector('#dx'); box.className = '';
    box.innerHTML = `
      <p class="hint">Preview is editable: click into the text to change it. Headings, bold/italic/underline, lists, tables and pictures are kept when saving; page layout, fonts and colors are simplified, so the edit is saved as a <b>new copy</b> and the original stays untouched.</p>
      <div class="doc-edit" contenteditable="true" spellcheck="true"></div>
      <div class="foot"><button class="btn ghost" data-close>Close</button><button class="btn" data-copy>Save as edited copy</button></div>`;
    const ed = box.querySelector('.doc-edit');
    ed.append(...sanitizeHTML(res.value).childNodes);
    box.querySelector('[data-copy]').onclick = async (ev) => {
      const name = prompt('Name for the copy', r.file_name.replace(/\.docx$/i, ' (edited).docx')); if (!name) return;
      ev.target.disabled = true; ev.target.textContent = 'Saving…';
      try {
        const out = await htmlToDocx(ed);
        await uploadFile(new File([out], name.endsWith('.docx') ? name : name + '.docx', { type: r.mime_type }), { folder: 'docs', tags: r.tags || [] });
        toast('Edited copy saved.', 'ok'); m.close(); load();
      } catch (e) { fail(e); ev.target.disabled = false; ev.target.textContent = 'Save as edited copy'; }
    };
  } catch (e) { m.el.querySelector('#dx').textContent = 'Could not open: ' + (e.message || e); }
}

async function htmlToDocx(root) {
  await loadScript('assets/vendor/docx.iife.js');
  const D = window.docx;
  const HEAD = { H1: D.HeadingLevel.HEADING_1, H2: D.HeadingLevel.HEADING_2, H3: D.HeadingLevel.HEADING_3, H4: D.HeadingLevel.HEADING_4, H5: D.HeadingLevel.HEADING_5, H6: D.HeadingLevel.HEADING_6 };
  const imgRun = (img) => {
    const m = /^data:image\/(png|jpe?g|gif|bmp);base64,(.+)$/i.exec(img.getAttribute('src') || '');
    if (!m) return null;
    const bin = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
    const w = Math.min(img.naturalWidth || 400, 600), h = Math.round(w * ((img.naturalHeight || 300) / (img.naturalWidth || 400)));
    return new D.ImageRun({ type: m[1].toLowerCase().replace('jpeg', 'jpg'), data: bin, transformation: { width: w, height: h } });
  };
  const runs = (node, st = {}) => {
    const out = [];
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { if (n.textContent) out.push(new D.TextRun({ text: n.textContent.replace(/\s+/g, ' '), bold: st.b, italics: st.i, underline: st.u ? {} : undefined })); continue; }
      if (n.nodeType !== 1) continue;
      const t = n.tagName;
      if (t === 'BR') out.push(new D.TextRun({ break: 1 }));
      else if (t === 'IMG') { const r = imgRun(n); if (r) out.push(r); }
      else out.push(...runs(n, { b: st.b || t === 'STRONG' || t === 'B', i: st.i || t === 'EM' || t === 'I', u: st.u || t === 'U' || t === 'A' }));
    }
    return out;
  };
  const blocks = (node) => {
    const out = [];
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { if (n.textContent.trim()) out.push(new D.Paragraph({ children: [new D.TextRun(n.textContent)] })); continue; }
      if (n.nodeType !== 1) continue;
      const t = n.tagName;
      if (HEAD[t]) out.push(new D.Paragraph({ heading: HEAD[t], children: runs(n) }));
      else if (t === 'UL' || t === 'OL') [...n.children].forEach((li, i) => out.push(new D.Paragraph({ children: t === 'OL' ? [new D.TextRun(`${i + 1}. `), ...runs(li)] : runs(li), bullet: t === 'UL' ? { level: 0 } : undefined, indent: t === 'OL' ? { left: 360 } : undefined })));
      else if (t === 'TABLE') {
        const trs = [...n.querySelectorAll('tr')];
        if (trs.length) out.push(new D.Table({
          width: { size: 100, type: D.WidthType.PERCENTAGE },
          rows: trs.map(tr => new D.TableRow({ children: [...tr.children].map(td => new D.TableCell({ children: blocks(td).length ? blocks(td) : [new D.Paragraph('')] })) })),
        }));
      } else if (t === 'DIV' || t === 'SECTION' || t === 'BLOCKQUOTE') out.push(...blocks(n));
      else out.push(new D.Paragraph({ children: runs(n) }));
    }
    return out;
  };
  const doc = new D.Document({ sections: [{ children: blocks(root) }] });
  return D.Packer.toBlob(doc);
}

// Image editor: rotate / flip / resize / compress via canvas.
async function imageEditor(r) {
  const blob = await download(r.storage_path);           // same-origin blob → canvas is not tainted
  const url = URL.createObjectURL(blob);
  const img = new Image(); img.src = url;
  try { await img.decode(); } catch {
    URL.revokeObjectURL(url);
    return downloadOnly(r, 'This browser cannot display this photo format (for example HEIC from an iPhone). It is saved safely — download it, or open it in Safari / the Photos app.');
  }
  let rot = 0, flip = false, maxW = img.naturalWidth;
  const m = modal(`
    <h2>🖼️ ${esc(r.file_name)}<span class="sp"></span><button class="btn ghost sm" data-close>✕</button></h2>
    <canvas id="cv" class="preview-img"></canvas>
    <div class="row" style="margin-top:10px">
      <button class="btn ghost sm" data-r="-90">⟲ Rotate left</button><button class="btn ghost sm" data-r="90">⟳ Rotate right</button><button class="btn ghost sm" data-f>⇋ Flip</button>
      <label>Max width (px)<input id="mw" type="number" min="100" max="${img.naturalWidth}" value="${img.naturalWidth}"></label>
      <label>JPEG quality<input id="qq" type="number" min="40" max="100" value="85"></label>
      <span class="muted small">Original ${img.naturalWidth}×${img.naturalHeight} · ${esc(bytes(r.size_bytes))}</span>
    </div>
    <div class="foot"><button class="btn ghost" data-close>Close</button><button class="btn ghost" data-copy>Save as copy</button><button class="btn" data-save>Save (replace)</button></div>`,
  { wide: true, onClose: () => URL.revokeObjectURL(url) });
  const cv = m.el.querySelector('#cv');
  const paint = () => {
    const s = Math.min(1, maxW / img.naturalWidth);
    const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
    const side = rot % 180 !== 0;
    cv.width = side ? h : w; cv.height = side ? w : h;
    const c = cv.getContext('2d'); c.save(); c.translate(cv.width / 2, cv.height / 2); c.rotate(rot * Math.PI / 180); if (flip) c.scale(-1, 1);
    c.drawImage(img, -w / 2, -h / 2, w, h); c.restore();
  };
  paint();
  m.el.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { rot = (rot + +b.dataset.r + 360) % 360; paint(); });
  m.el.querySelector('[data-f]').onclick = () => { flip = !flip; paint(); };
  m.el.querySelector('#mw').onchange = e => { maxW = Math.max(100, Math.min(img.naturalWidth, +e.target.value || img.naturalWidth)); paint(); };
  const type = /png|gif/.test(r.mime_type) ? 'image/png' : /webp/.test(r.mime_type) ? 'image/webp' : 'image/jpeg';
  const out = () => new Promise(res => cv.toBlob(res, type, (+m.el.querySelector('#qq').value || 85) / 100));
  m.el.querySelector('[data-save]').onclick = async () => {
    if (!confirm('Replace the original image?')) return;
    try { const b = await out(); await replaceFile({ ...r, mime_type: type }, b); m.close(); toast('Saved.', 'ok'); load(); } catch (e) { fail(e); }
  };
  m.el.querySelector('[data-copy]').onclick = async () => {
    try { const b = await out(); const ext = type.split('/')[1].replace('jpeg', 'jpg'); await uploadFile(new File([b], r.file_name.replace(/\.\w+$/, '') + ` (edited).${ext}`, { type }), { folder: 'images', tags: r.tags || [] }); m.close(); toast('Copy saved.', 'ok'); load(); } catch (e) { fail(e); }
  };
}
