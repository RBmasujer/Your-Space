// Marketing / content calendar: plan, schedule, reschedule posts; attach media.
import { sb, must, signedUrl } from '../lib/sb.js';
import { esc, opts, modal, toast, fail, today, manilaISO, ymd, hm, safeUrl } from '../lib/util.js';
import { renderMonth, monthRange } from '../lib/calendar.js';
import { uploadFile } from '../lib/files.js';

const PLATFORMS = ['Facebook', 'Instagram', 'TikTok', 'Other'];
const STATUS = ['Draft', 'Scheduled', 'Posted', 'Cancelled'];
let Y, M, posts = [], drafts = [], root, links = [];

export async function render(el) {
  root = el;
  if (Y == null) { const [y, m] = today().split('-').map(Number); Y = y; M = m - 1; }
  links = must(await sb.from('shortcuts').select('label,url').or('label.ilike.%meta%,label.ilike.%tiktok%,label.ilike.%instagram%,label.ilike.%page%').order('sort_order'));
  await load();
}

async function load() {
  const { start, end } = monthRange(Y, M);
  [posts, drafts] = await Promise.all([
    sb.from('content_posts').select('*').gte('scheduled_at', manilaISO(start)).lt('scheduled_at', manilaISO(end, '23:59')).order('scheduled_at').then(must),
    sb.from('content_posts').select('*').is('scheduled_at', null).order('created_at', { ascending: false }).then(must),
  ]);
  draw();
}

function draw() {
  root.innerHTML = `
  <div class="card"><h2>Content calendar <span class="sp"></span><button class="btn" data-new>+ New post</button></h2>
    <div id="cal"></div>
    <p class="hint">Tap a day to plan a post (on a phone: tap the day, then “+ Add post”); tap a post to edit or move it to another date. F = Facebook · I = Instagram · T = TikTok.
      Blue = scheduled · red = posted · light = draft. Publishing itself happens in Meta Business Suite / TikTok:</p>
    <div class="chips">${links.map(l => safeUrl(l.url) ? `<a class="btn ghost sm" target="_blank" rel="noopener noreferrer" href="${esc(safeUrl(l.url))}">${esc(l.label)} ↗</a>` : '').join('')}</div>
  </div>
  <div class="card"><h2>Unscheduled drafts (${drafts.length})</h2>
    ${drafts.length ? `<div class="tbl-wrap"><table class="stack"><tbody>${drafts.map(p => `<tr class="clickable" data-id="${esc(p.id)}"><td data-label="Draft">${esc(p.title)}</td><td class="muted" data-label="Platforms">${esc((p.platforms || []).join(', '))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No drafts without a date.</div>'}
  </div>`;
  renderMonth(root.querySelector('#cal'), {
    y: Y, m: M,
    events: posts.map(p => ({ id: p.id, date: ymd(p.scheduled_at), sort: hm(p.scheduled_at), cls: `s-${p.status}`, label: `${hm(p.scheduled_at)} ${(p.platforms || []).map(x => x[0]).join('')} ${p.title}${p.asset_file_id || p.asset_url ? ' 📎' : ''}`, title: `${p.status}: ${p.title}` })),
    onDay: (d) => edit({ status: 'Scheduled', platforms: ['Facebook'], _date: d, _time: '12:00' }),
    onEvent: (id) => edit(posts.find(p => p.id === id)),
    onNav: (y, m) => { Y = y; M = m; load().catch(fail); },
    addLabel: 'Add post',
  });
  root.querySelector('[data-new]').onclick = () => edit({ status: 'Draft', platforms: ['Facebook'], _date: today(), _time: '12:00' });
  root.querySelectorAll('[data-id]').forEach(r => r.onclick = () => edit(drafts.find(p => p.id === r.dataset.id)));
}

async function edit(p) {
  const isNew = !p.id;
  const date = p._date ?? (p.scheduled_at ? ymd(p.scheduled_at) : '');
  const time = p._time ?? (p.scheduled_at ? hm(p.scheduled_at) : '12:00');
  let assetLink = '';
  if (p.asset_file_id) {
    const f = must(await sb.from('files_metadata').select('file_name,storage_path,file_type').eq('id', p.asset_file_id).maybeSingle());
    if (f) assetLink = `<a href="${esc(await signedUrl(f.storage_path))}" target="_blank" rel="noopener">${esc(f.file_name)}</a>`;
  }
  const m = modal(`
    <h2>${isNew ? 'Plan a post' : 'Edit post'}<span class="sp"></span><button class="btn ghost sm" data-close>✕</button></h2>
    <form id="pf" class="form-grid">
      <label class="fld wide">Title / topic *<input name="title" required maxlength="200" value="${esc(p.title)}"></label>
      <div class="fld wide">Platforms<div class="chips">${PLATFORMS.map(x => `<label class="chip"><input type="checkbox" name="platforms" value="${x}" ${(p.platforms || []).includes(x) ? 'checked' : ''}> ${x}</label>`).join('')}</div></div>
      <label class="fld">Date<input name="date" type="date" value="${esc(date)}"></label>
      <label class="fld">Time<input name="time" type="time" value="${esc(time)}"></label>
      <label class="fld">Status<select name="status">${opts(STATUS, p.status)}</select></label>
      <label class="fld wide">Caption<textarea name="caption" rows="6">${esc(p.caption)}</textarea></label>
      <label class="fld">Attach photo / video (≤50 MB)<input name="file" type="file" accept="image/*,video/mp4,video/quicktime,video/webm"></label>
      <div class="fld">Current attachment<div>${assetLink || '<span class="muted">none</span>'}</div></div>
      <label class="fld">…or Drive link to the material<input name="asset_url" type="url" placeholder="https://drive.google.com/…" value="${esc(p.asset_url)}"></label>
      <label class="fld">Live post URL (after posting)<input name="posted_url" type="url" value="${esc(p.posted_url)}"></label>
      <label class="fld wide">Notes<textarea name="notes" rows="2">${esc(p.notes)}</textarea></label>
    </form>
    <div class="foot">
      <span class="left">
        <button class="btn ghost" data-copy>Copy caption</button>
        ${isNew ? '' : '<button class="btn ghost" data-dup>Duplicate</button><button class="btn danger" data-del>Delete</button>'}
      </span>
      <button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Save</button>
    </div>`);
  const f = m.el.querySelector('#pf');
  const collect = () => {
    const platforms = [...f.querySelectorAll('[name=platforms]:checked')].map(x => x.value);
    const d = {
      title: f.elements.title.value.trim(), caption: f.caption.value.trim() || null, platforms, status: f.status.value,
      scheduled_at: f.date.value ? manilaISO(f.date.value, f.time.value) : null,
      asset_url: safeUrl(f.asset_url.value) || null, posted_url: safeUrl(f.posted_url.value) || null, notes: f.notes.value.trim() || null,
    };
    return d;
  };
  m.el.querySelector('[data-copy]').onclick = async () => { await navigator.clipboard.writeText(f.caption.value); toast('Caption copied.', 'ok'); };
  m.el.querySelector('[data-save]').onclick = async (ev) => {
    if (!f.reportValidity()) return;
    const d = collect();
    if (!d.platforms.length) return toast('Pick at least one platform.', 'err');
    if (d.status === 'Scheduled' && !d.scheduled_at) return toast('A scheduled post needs a date.', 'err');
    ev.target.disabled = true;
    try {
      const file = f.file.files[0];
      if (file) { const row = await uploadFile(file, { folder: 'content', tags: ['content'] }); d.asset_file_id = row.id; }
      if (isNew) must(await sb.from('content_posts').insert(d));
      else must(await sb.from('content_posts').update(d).eq('id', p.id));
      m.close(); toast('Saved.', 'ok'); load();
    } catch (e) { fail(e); ev.target.disabled = false; }
  };
  m.el.querySelector('[data-dup]')?.addEventListener('click', async () => {
    try { const d = collect(); d.status = 'Draft'; d.asset_file_id = p.asset_file_id; d.title += ' (copy)'; must(await sb.from('content_posts').insert(d)); m.close(); toast('Duplicated as draft.', 'ok'); load(); } catch (e) { fail(e); }
  });
  m.el.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!confirm('Delete this post?')) return;
    try { must(await sb.from('content_posts').delete().eq('id', p.id)); m.close(); load(); } catch (e) { fail(e); }
  });
}

