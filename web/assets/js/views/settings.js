// Settings: shortcuts, password, import (CSV/XLSX leads, old app backup), export/backup.
import { sb, must, fetchAll, uid } from '../lib/sb.js';
import { esc, toast, fail, safeUrl, normalizePhone, toCSV, saveBlob, today, manilaISO } from '../lib/util.js';
import { STATUSES } from './leads.js';
import { SHEETJS_URL } from '../config.js';

let root;
export async function render(el) { root = el; await draw(); }

async function draw() {
  const links = must(await sb.from('shortcuts').select('*').order('sort_order'));
  root.innerHTML = `
  <div class="card"><h2>Shortcuts</h2>
    <div class="tbl-wrap"><table class="stack inputs"><thead><tr><th>Label</th><th>URL (https only)</th><th>Category</th><th>Order</th><th></th></tr></thead><tbody id="lk">
      ${links.map(l => `<tr data-id="${esc(l.id)}"><td data-label="Label"><input data-k="label" value="${esc(l.label)}"></td><td data-label="URL"><input data-k="url" value="${esc(l.url)}" style="min-width:260px"></td><td data-label="Category"><input data-k="category" value="${esc(l.category)}" size="8"></td><td data-label="Order"><input data-k="sort_order" type="number" value="${esc(l.sort_order)}" style="width:70px"></td><td class="nowrap acts"><button class="btn sm" data-save>Save</button> <button class="btn danger sm" data-del>✕</button></td></tr>`).join('')}
      <tr data-id=""><td data-label="Label"><input data-k="label" placeholder="New shortcut"></td><td data-label="URL"><input data-k="url" placeholder="https://…" style="min-width:260px"></td><td data-label="Category"><input data-k="category" value="Other" size="8"></td><td data-label="Order"><input data-k="sort_order" type="number" value="${(links.at(-1)?.sort_order || 0) + 10}" style="width:70px"></td><td class="acts"><button class="btn sm" data-save>Add</button></td></tr>
    </tbody></table></div>
    <p class="hint">Messenger is linked instead of Facebook so the team chat opens without the news feed.</p>
  </div>
  <div class="cols">
    <div class="card"><h2>Import leads</h2>
      <p class="small">CSV or Excel with a header row containing <b>Name</b> (and optionally Phone, Email, Address, Income Class, Nationality, Lead Status, Follow-Up / Comments). Works with <i>Leads_List.csv</i> and <i>Leads_Tracker.xlsx</i>. Duplicates (same name + email) are skipped; PH mobile numbers get their missing 0 / +63 back.</p>
      <input type="file" id="imp" accept=".csv,.xlsx"><div id="impres" class="hint"></div>
    </div>
    <div class="card"><h2>Import from the old Your Space app</h2>
      <p class="small">In the old app's browser, open the developer console and run <code>copy(localStorage.ys)</code>, paste into a text file saved as <i>old.json</i>, then choose it here. Imports leads, content calendar, schedule, showcase and quota settings.</p>
      <input type="file" id="old" accept=".json,.txt"><div id="oldres" class="hint"></div>
    </div>
    <div class="card"><h2>Backup & export</h2>
      <p class="small">Download your data any time. Keep a weekly backup — the free plan has no automatic backups.</p>
      <div class="row"><button class="btn ghost" id="xcsv">Leads (CSV)</button><button class="btn ghost" id="xjson">Everything (JSON)</button></div>
    </div>
    <div class="card"><h2>Account</h2>
      <form id="pw" class="row"><label class="grow">New password (min 10 characters)<input name="p" type="password" minlength="10" autocomplete="new-password" required></label><button class="btn" type="submit">Change password</button></form>
      <button class="btn ghost" id="out">Sign out on this device</button>
    </div>
  </div>`;

  root.querySelector('#lk').onclick = async (e) => {
    const tr = e.target.closest('tr'); if (!tr) return;
    const d = Object.fromEntries([...tr.querySelectorAll('[data-k]')].map(i => [i.dataset.k, i.type === 'number' ? +i.value : i.value.trim()]));
    try {
      if (e.target.closest('[data-del]')) { if (!confirm('Delete this shortcut?')) return; must(await sb.from('shortcuts').delete().eq('id', tr.dataset.id)); return draw(); }
      if (!e.target.closest('[data-save]')) return;
      if (!d.label || !safeUrl(d.url) || !/^https:/i.test(d.url)) return toast('Give a label and an https:// link.', 'err');
      if (tr.dataset.id) must(await sb.from('shortcuts').update(d).eq('id', tr.dataset.id)); else must(await sb.from('shortcuts').insert(d));
      toast('Saved.', 'ok'); draw();
    } catch (err) { fail(err); }
  };
  root.querySelector('#imp').onchange = (e) => importLeads(e.target.files[0]).catch(fail);
  root.querySelector('#old').onchange = (e) => importOld(e.target.files[0]).catch(fail);
  root.querySelector('#xcsv').onclick = () => exportCSV().catch(fail);
  root.querySelector('#xjson').onclick = () => exportJSON().catch(fail);
  root.querySelector('#pw').onsubmit = async (e) => { e.preventDefault(); const { error } = await sb.auth.updateUser({ password: e.target.p.value }); toast(error ? error.message : 'Password changed.', error ? 'err' : 'ok'); e.target.reset(); };
  root.querySelector('#out').onclick = () => sb.auth.signOut();
}

// ── Import leads from CSV / XLSX ────────────────────────────────────────────
async function importLeads(file) {
  if (!file) return;
  const out = root.querySelector('#impres'); out.textContent = 'Reading…';
  const X = await import(SHEETJS_URL);
  const wb = file.name.toLowerCase().endsWith('.csv') ? X.read(await file.text(), { type: 'string', raw: true }) : X.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames.find(n => /lead/i.test(n)) || wb.SheetNames[0]];
  const aoa = X.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  const hi = aoa.findIndex(r => r.some(c => /^\s*(full\s*)?name\s*$/i.test(String(c))));
  if (hi < 0) { out.textContent = 'No header row with a “Name” column found.'; return; }
  const H = aoa[hi].map(h => String(h).trim().toLowerCase());
  const col = (...names) => H.findIndex(h => names.some(n => h === n || h.startsWith(n)));
  const c = { name: col('full name', 'name'), phone: col('phone', 'mobile', 'contact'), email: col('email'), address: col('address'), income: col('income'), nat: col('nationality'), status: col('lead status', 'status', 'stage'), notes: col('follow-up', 'comments', 'notes') };
  const existing = new Set((await fetchAll(() => sb.from('leads').select('full_name,email').order('id'))).map(l => `${l.full_name.toLowerCase()}|${(l.email || '').toLowerCase()}`));
  const v = (r, i) => (i >= 0 ? String(r[i] ?? '').trim() : '') || null;
  const rows = [];
  for (const r of aoa.slice(hi + 1)) {
    const name = v(r, c.name); if (!name) continue;
    const email = v(r, c.email);
    const key = `${name.toLowerCase()}|${(email || '').toLowerCase()}`;
    if (existing.has(key)) continue; existing.add(key);
    const st = v(r, c.status); const inc = v(r, c.income);
    rows.push({ full_name: name.slice(0, 200), phone: normalizePhone(v(r, c.phone)) || null, email, address: v(r, c.address), nationality: v(r, c.nat),
      income_class: ['High', 'Mid', 'Low'].includes(inc) ? inc : null, status: STATUSES.includes(st) && st !== 'Closed' ? st : 'New', notes: v(r, c.notes), source: 'Import' });
  }
  if (!rows.length) { out.textContent = 'Nothing new to import (all rows already exist).'; return; }
  if (!confirm(`Import ${rows.length} new lead(s)?`)) { out.textContent = ''; return; }
  for (let i = 0; i < rows.length; i += 500) { out.textContent = `Importing ${i + 1}–${Math.min(i + 500, rows.length)} of ${rows.length}…`; must(await sb.from('leads').insert(rows.slice(i, i + 500))); }
  out.textContent = `Imported ${rows.length} lead(s).`; toast(`Imported ${rows.length} lead(s).`, 'ok');
}

// ── Import the old single-file app's backup ────────────────────────────────
async function importOld(file) {
  if (!file) return;
  const out = root.querySelector('#oldres');
  let S; try { S = JSON.parse(await file.text()); } catch { out.textContent = 'That file is not valid JSON.'; return; }
  if (typeof S === 'string') S = JSON.parse(S);
  if (!S || !Array.isArray(S.leads)) { out.textContent = 'This does not look like an old Your Space backup.'; return; }
  if (!confirm(`Import ${S.leads.length} leads, ${(S.cal || []).length} posts, ${(S.sch || []).length} schedule entries and ${(S.show || []).length} showcase items?`)) return;
  out.textContent = 'Importing…';
  const STMAP = s => STATUSES.includes(s) ? s : 'New';
  const leadRows = S.leads.filter(l => l && l.n).map(l => {
    const closed = l.s === 'Closed' && +l.a > 0;
    return { full_name: String(l.n).slice(0, 200), phone: normalizePhone(l.p) || null, email: l.e || null, income_class: ['High', 'Mid', 'Low'].includes(l.t) ? l.t : null,
      nationality: l.x || null, status: l.s === 'Closed' && !closed ? 'Reserved' : STMAP(l.s || 'New'), quality: l.ql === 'Q' ? 'Qualified' : l.ql === 'N' ? 'Not qualified' : null,
      temperature: l.ht === 'H' ? 'Hot' : l.ht === 'C' ? 'Cold' : null, contract_price: +l.a || null, closed_at: closed ? (l.d || today()) : null, source: 'Old app' };
  });
  const inserted = [];
  for (let i = 0; i < leadRows.length; i += 500) inserted.push(...must(await sb.from('leads').insert(leadRows.slice(i, i + 500)).select('id,full_name')));
  const byName = Object.fromEntries(inserted.map(l => [l.full_name, l.id]));
  const posts = (S.cal || []).filter(p => p && p.tp).map(p => ({ title: String(p.tp).slice(0, 200), caption: p.tp, platforms: (p.pf || ['Facebook']).filter(x => ['Facebook', 'Instagram', 'TikTok'].includes(x)), status: ['Draft', 'Scheduled', 'Posted'].includes(p.st) ? p.st : 'Draft', scheduled_at: p.d ? manilaISO(p.d, p.t || '12:00') : null, asset_url: /^https:/.test(p.u || '') ? p.u : null }));
  if (posts.length) must(await sb.from('content_posts').insert(posts));
  const kinds = ['Manning', 'Training', 'Sync', 'Tripping'];
  const evs = (S.sch || []).filter(e => e && e.d).map(e => ({ kind: kinds.includes(e.ty) ? e.ty : 'Other', title: e.ty === 'Tripping' && e.cl ? `Tripping — ${e.cl}` : (e.ty || 'Schedule'), starts_at: manilaISO(e.d, e.t || '09:00'), lead_id: byName[e.cl] || null, location: e.pl || null, notes: [e.cl && !byName[e.cl] ? `Client: ${e.cl}` : '', e.nt || ''].filter(Boolean).join(' · ') || null }));
  if (evs.length) must(await sb.from('schedule_events').insert(evs));
  const props = (S.show || []).filter(p => p && p.t).map(p => ({ name: p.t, description: p.n || null, link: /^https:/.test(p.u || '') ? p.u : null }));
  if (props.length) must(await sb.from('properties').insert(props));
  if (S.cfg) must(await sb.from('settings').update({ quota_php: +S.cfg.q || 25e6, goal_pct: +S.cfg.g || 150, period_start: S.cfg.qs || undefined, period_end: S.cfg.qe || undefined, email_signature: S.cfg.sig || undefined }).eq('owner_id', uid()));
  out.textContent = `Imported ${inserted.length} leads, ${posts.length} posts, ${evs.length} schedule entries, ${props.length} showcase items.`;
  toast('Old app data imported.', 'ok');
}

// ── Export ──────────────────────────────────────────────────────────────────
async function exportCSV() {
  const L = await fetchAll(() => sb.from('leads').select('*').order('full_name').order('id'));
  const cols = ['full_name', 'phone', 'email', 'address', 'income_class', 'nationality', 'status', 'quality', 'temperature', 'source', 'project', 'unit', 'contract_price', 'closed_at', 'next_follow_up', 'notes', 'created_at'];
  saveBlob(new Blob([toCSV([cols, ...L.map(l => cols.map(k => l[k]))])], { type: 'text/csv' }), `your-space-leads-${today()}.csv`);
}
async function exportJSON() {
  const tables = ['settings', 'leads', 'content_posts', 'schedule_events', 'properties', 'shortcuts', 'email_templates', 'email_log', 'files_metadata'];
  const data = {};
  for (const t of tables) data[t] = await fetchAll(() => sb.from(t).select('*').order(t === 'settings' ? 'owner_id' : 'id'));
  saveBlob(new Blob([JSON.stringify({ exported_at: new Date().toISOString(), ...data }, null, 1)], { type: 'application/json' }), `your-space-backup-${today()}.json`);
  toast('Backup downloaded. (Files themselves stay in Storage — download them from Files.)', 'ok');
}
