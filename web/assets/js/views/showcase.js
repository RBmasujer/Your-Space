// Project showcase: properties with photo, price and link.
import { sb, must, signedUrls } from '../lib/sb.js';
import { esc, modal, toast, fail, money, safeUrl, formData } from '../lib/util.js';
import { uploadFile } from '../lib/files.js';

let root;
export async function render(el) { root = el; await load(); }

async function load() {
  const props = must(await sb.from('properties').select('*, files_metadata(storage_path)').order('created_at', { ascending: false }));
  const urls = await signedUrls(props.map(p => p.files_metadata?.storage_path).filter(Boolean));
  root.innerHTML = `<div class="card"><h2>Project showcase <span class="sp"></span><button class="btn" data-new>+ Add property</button></h2>
    ${props.length ? `<div class="gallery">${props.map(p => `
      <div class="item">${p.files_metadata ? `<img src="${esc(urls[p.files_metadata.storage_path])}" alt="${esc(p.name)}" loading="lazy">` : ''}
        <div class="body"><b>${esc(p.name)}</b><br><span class="muted">${esc(p.location || '')}</span>
          ${p.price_from ? `<div>From <b>${esc(money(p.price_from))}</b></div>` : ''}
          ${p.description ? `<p class="small">${esc(p.description)}</p>` : ''}
          <div class="row" style="margin:6px 0 0">${safeUrl(p.link) ? `<a class="btn ghost sm" target="_blank" rel="noopener noreferrer" href="${esc(safeUrl(p.link))}">Link ↗</a>` : ''}
            <button class="btn ghost sm" data-edit="${esc(p.id)}">Edit</button></div></div></div>`).join('')}</div>`
    : '<div class="empty">No properties yet. Add the projects you promote, with a photo, starting price and a link.</div>'}
    <p class="hint">Gmail can't attach files automatically — put a Drive or project link in the property so you can paste it into emails.</p></div>`;
  root.querySelector('[data-new]').onclick = () => edit({});
  root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => edit(props.find(p => p.id === b.dataset.edit)));
}

function edit(p) {
  const isNew = !p.id;
  const m = modal(`<h2>${isNew ? 'Add property' : esc(p.name)}<span class="sp"></span><button class="btn ghost sm" data-close>✕</button></h2>
    <form id="sf" class="form-grid">
      <label class="fld wide">Project / unit *<input name="name" required value="${esc(p.name)}"></label>
      <label class="fld">Location<input name="location" value="${esc(p.location)}"></label>
      <label class="fld">Price from ₱<input name="price_from" type="number" min="0" step="1000" value="${esc(p.price_from)}"></label>
      <label class="fld wide">Link (brochure, Drive, website)<input name="link" type="url" value="${esc(p.link)}"></label>
      <label class="fld wide">Description<textarea name="description" rows="4">${esc(p.description)}</textarea></label>
      <label class="fld wide">Photo<input name="photo" type="file" accept="image/*"></label>
    </form>
    <div class="foot">${isNew ? '' : '<span class="left"><button class="btn danger" data-del>Delete</button></span>'}<button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Save</button></div>`);
  const f = m.el.querySelector('#sf');
  m.el.querySelector('[data-save]').onclick = async (ev) => {
    if (!f.reportValidity()) return;
    const d = formData(f); delete d.photo;
    d.link = safeUrl(d.link) || null;
    ev.target.disabled = true;
    try {
      const file = f.photo.files[0];
      if (file) d.image_file_id = (await uploadFile(file, { folder: 'showcase', tags: ['showcase'] })).id;
      if (isNew) must(await sb.from('properties').insert(d)); else must(await sb.from('properties').update(d).eq('id', p.id));
      m.close(); toast('Saved.', 'ok'); load();
    } catch (e) { fail(e); ev.target.disabled = false; }
  };
  m.el.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!confirm('Delete this property? (The photo stays in Files.)')) return;
    try { must(await sb.from('properties').delete().eq('id', p.id)); m.close(); load(); } catch (e) { fail(e); }
  });
}
