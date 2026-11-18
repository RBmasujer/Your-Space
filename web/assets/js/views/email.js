// Email leads & clients from cjmasujer.rpmmc@gmail.com.
//  • "Send automatically" → Edge Function `send-email` (Gmail API, one personal email per person)
//  • "Open in Gmail"      → Gmail compose window, BCC batches of 25 (no setup needed)
import { sb, must, fetchAll, uid } from '../lib/sb.js';
import { esc, opts, toast, fail, firstEmail, firstName, fmtDateTime, EMAIL_RE } from '../lib/util.js';
import { STATUSES } from './leads.js';
import { SENDER_EMAIL } from '../config.js';

let leads = [], tpls = [], sig = '', root, picked = new Map(); // email -> {lead_id, name}

export async function render(el, params) {
  root = el;
  [leads, tpls, sig] = await Promise.all([
    fetchAll(() => sb.from('leads').select('id,full_name,email,status,income_class,temperature,quality').order('full_name').order('id')),
    sb.from('email_templates').select('*').order('sort_order').then(must),
    sb.from('settings').select('email_signature').maybeSingle().then(r => must(r)?.email_signature || ''),
  ]);
  picked = new Map();
  if (params.lead) { const l = leads.find(x => x.id === params.lead); if (l) add(l); }
  if (params.from === 'leads') {
    try { JSON.parse(sessionStorage.getItem('ys_email_ids') || '[]').forEach(id => { const l = leads.find(x => x.id === id); if (l) add(l); }); } catch { /* ignore */ }
    sessionStorage.removeItem('ys_email_ids');
  }
  draw();
}

function add(l) { const e = firstEmail(l.email); if (e && EMAIL_RE.test(e)) picked.set(e, { lead_id: l.id, name: l.full_name }); }

function draw() {
  root.innerHTML = `
  <div class="card"><h2>1 · Recipients <span class="chip">${picked.size} selected</span></h2>
    <div class="row">
      <label>Add a group<select id="grp">${opts([['all', 'All leads with email'], ...STATUSES.map(s => [`s:${s}`, `Stage: ${s}`]), ...['High', 'Mid', 'Low'].map(c => [`c:${c}`, `${c} income`]), ['t:Hot', 'Hot leads'], ['q:Qualified', 'Qualified leads']], '', { blank: 'Choose…' })}</select></label>
      <label class="grow">Or add one person<input id="one" list="ll" placeholder="Lead name or any email address" autocomplete="off"></label>
      <datalist id="ll">${leads.filter(l => firstEmail(l.email)).map(l => `<option value="${esc(l.full_name)}">`).join('')}</datalist>
      <button class="btn ghost" id="addone">Add</button><button class="btn ghost" id="clr">Clear all</button>
    </div>
    <div class="chips" style="max-height:160px;overflow:auto">${[...picked].map(([e, p]) => `<span class="chip">${esc(p.name || e)} &lt;${esc(e)}&gt; <button class="btn ghost sm" data-rm="${esc(e)}" aria-label="Remove" style="min-height:0;padding:0 4px">✕</button></span>`).join('') || '<span class="muted">Nobody selected yet.</span>'}</div>
  </div>
  <div class="card"><h2>2 · Message</h2>
    <div class="row"><label>Template<select id="tpl">${opts(tpls.map(t => [t.id, t.name]), '', { blank: 'Choose a template…' })}</select></label>
      <button class="btn ghost sm" id="savetpl">Save as template</button><button class="btn ghost sm" id="deltpl">Delete template</button></div>
    <label class="fld">Subject<input id="sub" maxlength="200"></label>
    <label class="fld" style="margin-top:8px">Message — use {{first_name}} or {{name}} to personalize<textarea id="body" rows="10"></textarea></label>
    <label class="fld" style="margin-top:8px">Signature (added to every email)<textarea id="sig" rows="4">${esc(sig)}</textarea></label>
  </div>
  <div class="card"><h2>3 · Send</h2>
    <div class="row">
      <button class="btn" id="auto">Send automatically (${picked.size})</button>
      <button class="btn ghost" id="gm">Open in Gmail instead</button>
    </div>
    <div id="prog"></div>
    <p class="hint"><b>Send automatically</b> sends one personal email per person from ${esc(SENDER_EMAIL)} (shows in Gmail → Sent). Limit: 400 per 24 h to stay inside Gmail's daily cap.
      <b>Open in Gmail</b> opens a compose window with people in BCC (25 per window); you press Send yourself.</p>
  </div>
  <div class="card"><h2>Recently sent</h2><div id="log" class="empty">Loading…</div></div>`;

  const $ = s => root.querySelector(s);
  $('#grp').onchange = (e) => {
    const v = e.target.value; if (!v) return;
    const [k, x] = v.split(':');
    leads.filter(l => v === 'all' || (k === 's' && l.status === x) || (k === 'c' && l.income_class === x) || (k === 't' && l.temperature === x) || (k === 'q' && l.quality === x)).forEach(add);
    keep(draw);
  };
  $('#addone').onclick = () => {
    const v = $('#one').value.trim(); if (!v) return;
    const l = leads.find(x => x.full_name === v);
    if (l) { if (!firstEmail(l.email)) return toast(`${l.full_name} has no valid email.`, 'err'); add(l); }
    else if (EMAIL_RE.test(v)) picked.set(v.toLowerCase(), { lead_id: null, name: '' });
    else return toast('Not a lead name or a valid email.', 'err');
    keep(draw);
  };
  $('#clr').onclick = () => { picked.clear(); keep(draw); };
  root.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { picked.delete(b.dataset.rm); keep(draw); });
  $('#tpl').onchange = (e) => { const t = tpls.find(x => x.id === e.target.value); if (t) { $('#sub').value = t.subject; $('#body').value = t.body; } };
  $('#savetpl').onclick = async () => {
    const name = prompt('Template name'); if (!name) return;
    if (!$('#sub').value.trim() || !$('#body').value.trim()) return toast('Write a subject and message first.', 'err');
    try { must(await sb.from('email_templates').upsert({ owner_id: uid(), name, subject: $('#sub').value.trim(), body: $('#body').value }, { onConflict: 'owner_id,name' })); tpls = must(await sb.from('email_templates').select('*').order('sort_order')); toast('Template saved.', 'ok'); keep(draw); } catch (e) { fail(e); }
  };
  $('#deltpl').onclick = async () => {
    const id = $('#tpl').value; if (!id) return toast('Choose a template first.', 'err');
    if (!confirm('Delete this template?')) return;
    try { must(await sb.from('email_templates').delete().eq('id', id)); tpls = tpls.filter(t => t.id !== id); keep(draw); } catch (e) { fail(e); }
  };
  $('#sig').onchange = async (e) => { try { sig = e.target.value; must(await sb.from('settings').update({ email_signature: sig }).eq('owner_id', uid())); toast('Signature saved.', 'ok'); } catch (err) { fail(err); } };
  $('#auto').onclick = sendAuto;
  $('#gm').onclick = openGmail;
  loadLog();
}

/** Re-render without losing what's typed in subject/body. */
function keep(fn) {
  const q = (id) => root.querySelector(id);
  const v = { sub: q('#sub').value, body: q('#body').value, sig: q('#sig').value, tpl: q('#tpl').value };
  fn();
  q('#sub').value = v.sub; q('#body').value = v.body; q('#sig').value = v.sig;
  if ([...q('#tpl').options].some(o => o.value === v.tpl)) q('#tpl').value = v.tpl;
}

// Function replacers: a name containing "$&" or "$'" must be inserted literally, not as a replacement pattern.
const fill = (txt, p) => txt.replace(/\{\{\s*first_name\s*\}\}/gi, () => firstName(p.name) || 'there').replace(/\{\{\s*name\s*\}\}/gi, () => p.name || 'there');

async function sendAuto() {
  const sub = root.querySelector('#sub').value.trim(), body = root.querySelector('#body').value.trim(), s = root.querySelector('#sig').value.trim();
  if (!picked.size) return toast('Add recipients first.', 'err');
  if (!sub || !body) return toast('Write a subject and a message.', 'err');
  if (/[\r\n]/.test(sub)) return toast('Subject must be one line.', 'err');
  if (!confirm(`Send ${picked.size} personal email(s) from ${SENDER_EMAIL} now?`)) return;
  const all = [...picked].map(([to, p]) => ({ to, lead_id: p.lead_id, subject: fill(sub, p), body: fill(body, p) + (s ? `\n\n${s}` : '') }));
  const prog = root.querySelector('#prog'); const btn = root.querySelector('#auto'); btn.disabled = true;
  let sent = 0, failed = 0;
  try {
    for (let i = 0; i < all.length; i += 20) {
      prog.innerHTML = `<div class="progress"><div style="width:${(i / all.length) * 100}%"></div></div><p class="small">Sending ${i + 1}–${Math.min(i + 20, all.length)} of ${all.length}…</p>`;
      const { data, error } = await sb.functions.invoke('send-email', { body: { messages: all.slice(i, i + 20) } });
      if (error) {
        let msg = error.message;
        try { const j = await error.context?.json?.(); msg = j?.error || msg; } catch { /* ignore */ }
        if (/not_configured/.test(msg)) msg = 'Automatic sending is not set up yet (see README, “Gmail sending”). Use “Open in Gmail” meanwhile.';
        throw new Error(msg);
      }
      sent += data.sent; failed += data.failed;
    }
    toast(`Sent ${sent}${failed ? `, ${failed} failed (see log)` : ''}.`, failed ? 'err' : 'ok');
  } catch (e) { fail(e); }
  finally { btn.disabled = false; prog.innerHTML = sent || failed ? `<p class="small">Done: ${sent} sent, ${failed} failed.</p>` : ''; loadLog(); }
}

function openGmail() {
  const sub = root.querySelector('#sub').value.trim(), body = root.querySelector('#body').value.trim(), s = root.querySelector('#sig').value.trim();
  if (!picked.size) return toast('Add recipients first.', 'err');
  const emails = [...picked.keys()];
  const generic = fill(body, { name: '' }) + (s ? `\n\n${s}` : '');
  const url = (bcc) => 'https://mail.google.com/mail/?' + new URLSearchParams({ view: 'cm', fs: '1', authuser: SENDER_EMAIL, to: emails.length === 1 ? emails[0] : SENDER_EMAIL, bcc: emails.length === 1 ? '' : bcc.join(','), su: sub, body: generic });
  const batches = []; for (let i = 0; i < emails.length; i += 25) batches.push(emails.slice(i, i + 25));
  if (batches.length === 1) return window.open(url(batches[0]), '_blank', 'noopener');
  const prog = root.querySelector('#prog');
  prog.innerHTML = `<p class="small">Pop-up blockers allow one window per click, so open each batch:</p><div class="row">${batches.map((b, i) => `<a class="btn sm" target="_blank" rel="noopener" href="${esc(url(b))}">Batch ${i + 1} (${b.length})</a>`).join('')}</div>`;
}

async function loadLog() {
  try {
    const log = must(await sb.from('email_log').select('to_email,subject,status,error,sent_at,created_at').order('created_at', { ascending: false }).limit(50));
    root.querySelector('#log').outerHTML = log.length ? `<div class="tbl-wrap" id="log"><table class="stack"><thead><tr><th>When</th><th>To</th><th>Subject</th><th>Status</th></tr></thead><tbody>
      ${log.map(r => `<tr><td class="nowrap small" data-label="When">${esc(fmtDateTime(r.sent_at || r.created_at))}</td><td data-label="To">${esc(r.to_email)}</td><td data-label="Subject">${esc(r.subject)}</td><td data-label="Status">${r.status === 'sent' ? '<span class="chip ok">sent</span>' : `<span class="chip hot" title="${esc(r.error || '')}">${esc(r.status)}</span>`}</td></tr>`).join('')}
    </tbody></table></div>` : '<div id="log" class="empty">No emails sent from Your Space yet.</div>';
  } catch (e) { fail(e); }
}
