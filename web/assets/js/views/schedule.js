// Manning & Tripping calendar: duty schedule + client trippings (site visits).
import { sb, must, fetchAll } from '../lib/sb.js';
import { esc, opts, modal, toast, fail, today, addDays, manilaISO, ymd, hm, fmtDateTime } from '../lib/util.js';
import { renderMonth, monthRange } from '../lib/calendar.js';

const KINDS = ['Manning', 'Tripping', 'Training', 'Sync', 'Other'];
const STATUS = ['Planned', 'Done', 'Cancelled'];
let Y, M, events = [], leads = [], root;

export async function render(el, params) {
  root = el;
  if (Y == null) { const [y, m] = today().split('-').map(Number); Y = y; M = m - 1; }
  leads = await fetchAll(() => sb.from('leads').select('id,full_name,status').order('full_name').order('id'));
  await load();
  if (params.lead) {
    const l = leads.find(x => x.id === params.lead);
    if (l) edit({ kind: 'Tripping', lead_id: l.id, title: `Tripping — ${l.full_name}`, _date: addDays(today(), 1), _time: '10:00', status: 'Planned' });
  }
}

async function load() {
  const { start, end } = monthRange(Y, M);
  events = must(await sb.from('schedule_events').select('*, leads(full_name)').gte('starts_at', manilaISO(start)).lt('starts_at', manilaISO(addDays(end, 1))).order('starts_at'));
  const t = today();
  const upcoming = must(await sb.from('schedule_events').select('*, leads(full_name)').gte('starts_at', manilaISO(t)).lt('starts_at', manilaISO(addDays(t, 15))).neq('status', 'Cancelled').order('starts_at'));
  draw(upcoming);
}

function draw(upcoming) {
  root.innerHTML = `
  <div class="card"><h2>Manning & tripping schedule <span class="sp"></span>
      <button class="btn" data-new="Manning">+ Manning</button><button class="btn" data-new="Tripping">+ Tripping</button></h2>
    <div id="cal"></div>
    <p class="hint">Light chip = Manning duty · red = Tripping with a client · blue = Training / Sync. Tap a day to add, tap an entry to edit or reschedule.</p>
  </div>
  <div class="card"><h2>Next 14 days</h2>
    ${upcoming.length ? `<div class="tbl-wrap"><table class="stack"><thead><tr><th>When</th><th>Type</th><th>Details</th><th>Status</th></tr></thead><tbody>
      ${upcoming.map(e => `<tr class="clickable" data-id="${esc(e.id)}"><td class="nowrap" data-label="When">${esc(e.all_day ? ymd(e.starts_at) + ' (all day)' : fmtDateTime(e.starts_at))}</td><td data-label="Type"><span class="chip">${esc(e.kind)}</span></td><td data-label="Details">${esc(e.title)}${e.leads ? ` · <b>${esc(e.leads.full_name)}</b>` : ''}${e.location ? ` <span class="muted">@ ${esc(e.location)}</span>` : ''}</td><td data-label="Status">${esc(e.status)}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">Nothing in the next two weeks.</div>'}
  </div>`;
  renderMonth(root.querySelector('#cal'), {
    y: Y, m: M,
    events: events.map(e => ({ id: e.id, date: ymd(e.starts_at), sort: e.all_day ? '00:00' : hm(e.starts_at), cls: `t-${e.kind} st-${e.status}`, label: `${e.all_day ? '' : hm(e.starts_at) + ' '}${e.kind === 'Tripping' && e.leads ? '🚗 ' + e.leads.full_name : e.title}`, title: `${e.kind}: ${e.title}${e.location ? ' @ ' + e.location : ''}` })),
    onDay: (d) => edit({ kind: 'Manning', _date: d, _time: '09:00', status: 'Planned' }),
    onEvent: (id) => edit(events.find(e => e.id === id)),
    onNav: (y, m) => { Y = y; M = m; load().catch(fail); },
    addLabel: 'Add',
  });
  root.querySelectorAll('[data-new]').forEach(b => b.onclick = () => edit({ kind: b.dataset.new, _date: today(), _time: b.dataset.new === 'Manning' ? '09:00' : '10:00', status: 'Planned' }));
  root.querySelectorAll('tr[data-id]').forEach(r => r.onclick = async () => {
    const e = events.find(x => x.id === r.dataset.id) || must(await sb.from('schedule_events').select('*').eq('id', r.dataset.id).single());
    edit(e);
  });
}

function edit(e) {
  const isNew = !e.id;
  const date = e._date ?? ymd(e.starts_at);
  const time = e._time ?? hm(e.starts_at);
  const endTime = e.ends_at ? hm(e.ends_at) : '';
  const leadName = leads.find(l => l.id === e.lead_id)?.full_name || '';
  const m = modal(`
    <h2>${isNew ? 'Add to schedule' : 'Edit schedule'}<span class="sp"></span><button class="btn ghost sm" data-close>✕</button></h2>
    <form id="ef" class="form-grid">
      <label class="fld">Type<select name="kind">${opts(KINDS, e.kind)}</select></label>
      <label class="fld">Status<select name="status">${opts(STATUS, e.status || 'Planned')}</select></label>
      <label class="fld wide">Title *<input name="title" required maxlength="200" value="${esc(e.title || e.kind || '')}"></label>
      <label class="fld">Date<input name="date" type="date" required value="${esc(date)}"></label>
      <label class="fld">Start<input name="start" type="time" value="${esc(time)}"></label>
      <label class="fld">End<input name="end" type="time" value="${esc(endTime)}"></label>
      <label class="fld"><span><input type="checkbox" name="all_day" ${e.all_day ? 'checked' : ''}> All day</span></label>
      <label class="fld wide">Client (for trippings)<input name="lead" list="leadlist" value="${esc(leadName)}" placeholder="Start typing a lead's name…" autocomplete="off"></label>
      <datalist id="leadlist">${leads.slice(0, 3000).map(l => `<option value="${esc(l.full_name)}">`).join('')}</datalist>
      <label class="fld wide">Location (booth, showroom, project site)<input name="location" value="${esc(e.location)}"></label>
      <label class="fld wide">Notes<textarea name="notes" rows="3">${esc(e.notes)}</textarea></label>
    </form>
    <div class="foot">${isNew ? '' : '<span class="left"><button class="btn danger" data-del>Delete</button></span>'}
      <button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Save</button></div>`);
  const f = m.el.querySelector('#ef');
  f.kind.onchange = () => { if (!f.elements.title.value || KINDS.includes(f.elements.title.value)) f.elements.title.value = f.kind.value; };
  f.lead.onchange = () => { if (f.kind.value === 'Tripping' && f.lead.value && (/^Tripping/.test(f.elements.title.value) || KINDS.includes(f.elements.title.value))) f.elements.title.value = `Tripping — ${f.lead.value}`; };
  m.el.querySelector('[data-save]').onclick = async () => {
    if (!f.reportValidity()) return;
    const typed = f.lead.value.trim();
    const lead = typed ? leads.find(l => l.full_name === typed) : null;
    if (typed && !lead) return toast('Pick the client from the list (or add them in Leads first).', 'err');
    const allDay = f.all_day.checked;
    const d = {
      kind: f.kind.value, status: f.status.value, title: f.elements.title.value.trim(), all_day: allDay,
      starts_at: manilaISO(f.date.value, allDay ? '00:00' : (f.start.value || '09:00')),
      ends_at: !allDay && f.end.value ? manilaISO(f.date.value, f.end.value) : null,
      lead_id: lead?.id || null, location: f.location.value.trim() || null, notes: f.notes.value.trim() || null,
    };
    if (d.ends_at && d.ends_at < d.starts_at) return toast('End time is before the start.', 'err');
    try {
      if (isNew) must(await sb.from('schedule_events').insert(d)); else must(await sb.from('schedule_events').update(d).eq('id', e.id));
      if (lead && d.kind === 'Tripping' && ['New', 'Contacted', 'Follow-Up'].includes(lead.status) && confirm(`Move ${lead.full_name} to “Site Visit” in the leads tracker?`)) {
        must(await sb.from('leads').update({ status: 'Site Visit' }).eq('id', lead.id)); lead.status = 'Site Visit';
      }
      m.close(); toast('Saved.', 'ok'); load();
    } catch (err) { fail(err); }
  };
  m.el.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!confirm('Delete this entry?')) return;
    try { must(await sb.from('schedule_events').delete().eq('id', e.id)); m.close(); load(); } catch (err) { fail(err); }
  });
}
