// Home: goal progress, today's agenda, follow-ups due, shortcuts, Drive folder.
import { sb, must } from '../lib/sb.js';
import { esc, safeUrl, today, addDays, manilaISO, fmtDateTime, fmtDate, ymd } from '../lib/util.js';
import { loadQuota, meterHTML, kpisHTML } from '../lib/goal.js';
import { DRIVE_FOLDER_ID } from '../config.js';

export async function render(el) {
  const t = today();
  const [q, links, events, posts, due] = await Promise.all([
    loadQuota(),
    sb.from('shortcuts').select('*').order('sort_order').then(must),
    sb.from('schedule_events').select('id,kind,title,starts_at,location,status,lead_id,leads(full_name)')
      .gte('starts_at', manilaISO(t)).lt('starts_at', manilaISO(addDays(t, 8))).neq('status', 'Cancelled').order('starts_at').then(must),
    sb.from('content_posts').select('id,title,platforms,scheduled_at,status')
      .gte('scheduled_at', manilaISO(t)).lt('scheduled_at', manilaISO(addDays(t, 8))).order('scheduled_at').then(must),
    sb.from('leads').select('id,full_name,status,next_follow_up,temperature')
      .lte('next_follow_up', t).not('status', 'in', '("Closed","Not Interested","Cancelled")').order('next_follow_up').limit(12).then(must),
  ]);

  const agenda = events.map(e => `<tr><td class="nowrap" data-label="When">${esc(fmtDateTime(e.starts_at))}</td><td data-label="What"><span class="chip">${esc(e.kind)}</span> ${esc(e.title)}${e.leads ? ` · ${esc(e.leads.full_name)}` : ''}${e.location ? ` <span class="muted">@ ${esc(e.location)}</span>` : ''}</td></tr>`).join('');
  const postRows = posts.map(p => `<tr><td class="nowrap" data-label="When">${esc(fmtDateTime(p.scheduled_at))}</td><td data-label="Post">${esc(p.title)} <span class="muted">${esc((p.platforms || []).join(', '))}</span> <span class="chip">${esc(p.status)}</span></td></tr>`).join('');
  const dueRows = due.map(l => `<tr class="clickable" data-lead="${esc(l.id)}"><td data-label="Lead">${esc(l.full_name)} ${l.temperature === 'Hot' ? '<span class="chip hot">Hot</span>' : ''}</td><td data-label="Stage">${esc(l.status)}</td><td data-label="Due" class="nowrap ${l.next_follow_up < t ? 'muted' : ''}">${esc(fmtDate(l.next_follow_up))}</td></tr>`).join('');
  const linkCards = links.map(l => { const u = safeUrl(l.url); return u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer"><b>${esc(l.label)}</b><span>${esc(l.category)}</span></a>` : ''; }).join('');

  el.innerHTML = `
    <div class="card"><h2>Goal progress <span class="sp"></span><a class="btn ghost sm" href="#/quota">Details & graphs</a></h2>${meterHTML(q)}${kpisHTML(q)}</div>
    <div class="cols">
      <div class="card"><h2>Next 7 days — schedule <span class="sp"></span><a class="btn ghost sm" href="#/schedule">Calendar</a></h2>
        ${agenda ? `<div class="tbl-wrap"><table class="stack"><tbody>${agenda}</tbody></table></div>` : '<div class="empty">Nothing scheduled.</div>'}</div>
      <div class="card"><h2>Follow-ups due <span class="sp"></span><a class="btn ghost sm" href="#/leads">Leads</a></h2>
        ${dueRows ? `<div class="tbl-wrap"><table class="stack"><thead><tr><th>Lead</th><th>Stage</th><th>Due</th></tr></thead><tbody>${dueRows}</tbody></table></div>` : '<div class="empty">No follow-ups due. 🎉</div>'}</div>
      <div class="card"><h2>Posts this week <span class="sp"></span><a class="btn ghost sm" href="#/content">Content calendar</a></h2>
        ${postRows ? `<div class="tbl-wrap"><table class="stack"><tbody>${postRows}</tbody></table></div>` : '<div class="empty">No posts scheduled this week.</div>'}</div>
    </div>
    <div class="card" style="margin-top:14px"><h2>Shortcuts <span class="sp"></span><a class="btn ghost sm" href="#/settings">Edit</a></h2>
      <div class="links">${linkCards || '<div class="muted">No shortcuts yet.</div>'}</div>
      <p class="hint">Facebook, Messenger, Instagram, TikTok, Meta and Salesforce block being shown inside other websites, so each one opens in a new tab.</p></div>
    <div class="card"><h2>Marketing materials (Google Drive) <span class="sp"></span><a class="btn ghost sm" target="_blank" rel="noopener noreferrer" href="https://drive.google.com/drive/folders/${esc(DRIVE_FOLDER_ID)}">Open in Drive</a></h2>
      <iframe class="drive" title="Marketing materials folder" loading="lazy" referrerpolicy="no-referrer" src="https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(DRIVE_FOLDER_ID)}#grid"></iframe></div>
    <p class="hint">Today is ${esc(fmtDate(ymd()))} (Manila).</p>`;

  el.querySelectorAll('[data-lead]').forEach(r => r.onclick = () => { location.hash = `#/leads?open=${r.dataset.lead}`; });
}
