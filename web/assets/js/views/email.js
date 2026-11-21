// Email leads & clients from cjmasujer.rpmmc@gmail.com.
//  • "Send automatically" → Edge Function `send-email` (Brevo or Gmail API, one personal email per person)
//  • "Open in Gmail"      → Gmail compose window, BCC batches of 25 (no setup needed)
// Works with a saved template or a message typed from scratch; {{first_name}} / {{name}} personalise either.
import { sb, must, fetchAll, uid } from '../lib/sb.js';
import { esc, opts, toast, fail, firstEmail, fmtDateTime, EMAIL_RE, copyText } from '../lib/util.js';
import { buildMessages, checkMessage, gmailLinks, hasPlaceholders, explainSendError, batchFailure } from '../lib/mail.js';
import { STATUSES } from './leads.js';
import { SENDER_EMAIL } from '../config.js';

let leads = [], tpls = [], sig = '', root, picked = new Map(); // email -> {lead_id, name}
let autoStatus = null; // result of the send-email setup check: { ok, text, provider, replyTo, limit }

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
    <p class="hint" style="margin:0 0 8px">Pick a template, or leave it on “Choose a template…” and write your own message.</p>
    <label class="fld">Subject<input id="sub" maxlength="200"></label>
    <label class="fld" style="margin-top:8px">Message<textarea id="body" rows="10"></textarea></label>
    <div class="row" style="margin:6px 0 0"><span class="small muted">Insert:</span><button type="button" class="btn ghost sm" data-ph="{{first_name}}">{{first_name}}</button><button type="button" class="btn ghost sm" data-ph="{{name}}">{{name}}</button><span class="small muted">— replaced with each person's name (“there” if unknown)</span></div>
    <label class="fld" style="margin-top:8px">Signature (added to every email)<textarea id="sig" rows="4">${esc(sig)}</textarea></label>
    <details class="tableview" id="pvd" open><summary>Preview</summary><div id="pv" class="mail-pv"></div></details>
  </div>
  <div class="card"><h2>3 · Send</h2>
    <p class="small" id="mstat">${autoStatus ? autoStatus.text : 'Checking automatic sending…'}</p>
    <div class="row">
      <button class="btn" id="auto">Send automatically (${picked.size})</button>
      <button class="btn ghost" id="gm">Open in Gmail instead</button>
    </div>
    <div id="prog"></div>
    <p class="hint" id="mhint">${sendHint()}</p>
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
  $('#tpl').onchange = (e) => { const t = tpls.find(x => x.id === e.target.value); if (t) { $('#sub').value = t.subject; $('#body').value = t.body; preview(); } };
  root.querySelectorAll('[data-ph]').forEach(b => b.onclick = () => {
    const ta = $('#body'), at = ta.selectionStart ?? ta.value.length;
    ta.value = ta.value.slice(0, at) + b.dataset.ph + ta.value.slice(ta.selectionEnd ?? at); ta.focus(); ta.selectionStart = ta.selectionEnd = at + b.dataset.ph.length; preview();
  });
  ['#sub', '#body', '#sig'].forEach(id => $(id).addEventListener('input', preview));
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
  preview();
  if (!autoStatus) checkAuto();
}

/** How "Send automatically" behaves with the provider the function reported. */
function sendHint() {
  const a = autoStatus || {};
  const how = a.provider === 'brevo'
    ? `sends one personal email per person through Brevo. Leads see the name you set with Brevo’s own address; their replies go to ${esc(a.replyTo || SENDER_EMAIL)}. Not shown in Gmail → Sent (see <b>Recently sent</b> below). Limit: ${esc(a.limit ?? 300)} per 24 h (Brevo free plan).`
    : `sends one personal email per person from ${esc(SENDER_EMAIL)} (shows in Gmail → Sent). Limit: ${esc(a.limit ?? 400)} per 24 h to stay inside Gmail's daily cap.`;
  return `<b>Send automatically</b> ${how}
      <b>Open in Gmail</b> opens a compose window with people in BCC (25 per window); you press Send yourself.`;
}

const form = () => ({ subject: root.querySelector('#sub').value.trim(), body: root.querySelector('#body').value.trim(), signature: root.querySelector('#sig').value.trim() });
const recipients = () => [...picked].map(([email, p]) => ({ email, name: p.name, lead_id: p.lead_id }));

/** Shows exactly what the first person will receive. */
function preview() {
  const box = root.querySelector('#pv'); if (!box) return;
  const f = form();
  if (!f.subject && !f.body) { box.innerHTML = '<span class="muted small">Choose a template or start typing to see the email here.</span>'; return; }
  const first = recipients()[0] || { email: 'someone@example.com', name: 'Juan Dela Cruz' };
  const [m] = buildMessages([first], f);
  const many = picked.size > 1 && hasPlaceholders(f.subject, f.body);
  box.innerHTML = `<div class="small muted">To: ${esc(first.name ? `${first.name} <${first.email}>` : first.email)}${picked.size ? '' : ' (example)'}</div>
    <div><b>${esc(m.subject || '(no subject)')}</b></div><div class="mail-pv-body">${esc(m.body)}</div>
    ${many ? '<p class="hint">“Send automatically” fills in each person’s name. “Open in Gmail” with several people sends one BCC email, so names become “there”.</p>' : ''}`;
}

/** Ask the send-email function whether sending is set up, and through which provider (sends nothing). */
async function checkAuto() {
  const set = (ok, text, info = {}) => {
    autoStatus = { ok, text, ...info };
    const el = root?.querySelector('#mstat'); if (el) el.innerHTML = text;
    const h = root?.querySelector('#mhint'); if (h) h.innerHTML = sendHint();
  };
  try {
    const { data, error } = await sb.functions.invoke('send-email', { body: { check: true } });
    if (error) {
      let payload = null; try { payload = await error.context?.json?.(); } catch { /* not JSON */ }
      return set(false, `⚠️ ${esc(explainSendError(error.context?.status, payload, error.message))}`);
    }
    const info = { provider: data.provider || 'gmail', replyTo: data.reply_to, limit: data.daily_limit };
    const via = info.provider === 'brevo' ? `via <b>Brevo</b> · replies go to <b>${esc(data.reply_to)}</b>` : `from <b>${esc(data.sender)}</b>`;
    set(!!data.configured, data.configured
      ? `✅ Automatic sending is ready — ${via} · ${esc(data.sent_24h)} of ${esc(data.daily_limit)} sent in the last 24 h.`
      : `⚠️ ${esc(explainSendError(501, { error: 'not_configured', provider: data.provider }))}`, info);
  } catch (e) { set(false, `⚠️ ${esc(explainSendError(0, null, e.message))}`); }
}

/** Re-render without losing what's typed in subject/body. */
function keep(fn) {
  const q = (id) => root.querySelector(id);
  const v = { sub: q('#sub').value, body: q('#body').value, sig: q('#sig').value, tpl: q('#tpl').value };
  fn();
  q('#sub').value = v.sub; q('#body').value = v.body; q('#sig').value = v.sig;
  if ([...q('#tpl').options].some(o => o.value === v.tpl)) q('#tpl').value = v.tpl;
}

async function sendAuto() {
  const f = form();
  const problems = checkMessage({ ...f, count: picked.size });
  if (problems.length) return toast(problems.join(' '), 'err');
  if (autoStatus && !autoStatus.ok && !confirm('Automatic sending does not look ready (see the note above the buttons). Try anyway?')) return;
  const via = autoStatus?.provider === 'brevo' ? `through Brevo (replies go to ${autoStatus.replyTo || SENDER_EMAIL})` : `from ${SENDER_EMAIL}`;
  if (!confirm(`Send ${picked.size} personal email(s) ${via} now?`)) return;
  const all = buildMessages(recipients(), f);
  const tooLong = all.find(m => m.subject.length > 200 || m.body.length > 20000);
  if (tooLong) return toast(`The email to ${tooLong.to} is too long after adding the name and signature.`, 'err');
  const prog = root.querySelector('#prog'); const btn = root.querySelector('#auto'); btn.disabled = true;
  let sent = 0, failed = 0;
  try {
    for (let i = 0; i < all.length; i += 20) {
      prog.innerHTML = `<div class="progress"><div style="width:${(i / all.length) * 100}%"></div></div><p class="small">Sending ${i + 1}–${Math.min(i + 20, all.length)} of ${all.length}…</p>`;
      const { data, error } = await sb.functions.invoke('send-email', { body: { messages: all.slice(i, i + 20) } });
      if (error) {
        let payload = null; try { payload = await error.context?.json?.(); } catch { /* not JSON */ }
        throw new Error(explainSendError(error.context?.status, payload, error.message) + (sent || failed ? ` (${sent} were already sent before this.)` : ''));
      }
      sent += data.sent; failed += data.failed;
      // Nothing in this batch went out (e.g. a bad Brevo key): stop and say why instead of failing every batch.
      const why = batchFailure(data);
      if (why) throw new Error(why + (sent ? ` (${sent} were already sent before this.)` : ''));
    }
    toast(`Sent ${sent}${failed ? `, ${failed} failed (see Recently sent)` : ''}.`, failed ? 'err' : 'ok');
  } catch (e) { fail(e); }
  finally { btn.disabled = false; prog.innerHTML = sent || failed ? `<p class="small">Done: ${sent} sent, ${failed} failed.</p>` : ''; loadLog(); checkAuto(); }
}

async function openGmail() {
  const f = form();
  const problems = checkMessage({ ...f, count: picked.size });
  if (problems.length) return toast(problems.join(' '), 'err');
  const links = gmailLinks(recipients(), { ...f, account: SENDER_EMAIL });
  const prog = root.querySelector('#prog');
  const long = links.some(l => l.tooLong);
  if (links.length === 1 && !long) { window.open(links[0].url, '_blank', 'noopener'); return; }
  // Pop-up blockers allow one window per click, so give one button per batch.
  prog.innerHTML = `${links.length > 1 ? '<p class="small">One Gmail window per batch of up to 25 people (BCC). Open each one and press Send:</p>' : ''}
    ${long ? '<p class="small due">This message is very long for a Gmail link, so Gmail may cut it off. Use “Copy message” and paste it into Gmail if it looks incomplete.</p>' : ''}
    <div class="row">${links.map((l, i) => `<a class="btn sm" target="_blank" rel="noopener" href="${esc(l.url)}">${links.length > 1 ? `Batch ${i + 1} (${l.count})` : 'Open in Gmail'}</a>`).join('')}
    <button type="button" class="btn ghost sm" data-copymsg>Copy message</button></div>`;
  prog.querySelector('[data-copymsg]').onclick = async () => {
    const [m] = buildMessages([{ email: '', name: picked.size === 1 ? recipients()[0].name : '' }], f);
    toast(await copyText(`${m.subject}\n\n${m.body}`) ? 'Subject and message copied.' : 'Could not copy — select the text and copy it manually.', 'ok');
  };
}

async function loadLog() {
  try {
    const log = must(await sb.from('email_log').select('to_email,subject,status,error,sent_at,created_at').order('created_at', { ascending: false }).limit(50));
    root.querySelector('#log').outerHTML = log.length ? `<div class="tbl-wrap" id="log"><table class="stack"><thead><tr><th>When</th><th>To</th><th>Subject</th><th>Status</th></tr></thead><tbody>
      ${log.map(r => `<tr><td class="nowrap small" data-label="When">${esc(fmtDateTime(r.sent_at || r.created_at))}</td><td data-label="To">${esc(r.to_email)}</td><td data-label="Subject">${esc(r.subject)}</td><td data-label="Status">${r.status === 'sent' ? '<span class="chip ok">sent</span>' : `<span class="chip hot" title="${esc(r.error || '')}">${esc(r.status)}</span>`}</td></tr>`).join('')}
    </tbody></table></div>` : '<div id="log" class="empty">No emails sent from Your Space yet.</div>';
  } catch (e) { fail(e); }
}
