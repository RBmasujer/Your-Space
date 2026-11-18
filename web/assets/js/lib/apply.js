// Put what detect.js found into the app — and take it back out (Undo).
//
// Re-uploading an updated schedule REPLACES what earlier uploads imported for the same
// dates, so a new monthly schedule never leaves old or duplicate entries behind.
// Entries typed in by hand, and imported entries edited afterwards, are never removed.
// What each file added/replaced is kept in files_metadata.metrics.applied for Undo.
import { sb, must, fetchAll } from './sb.js';
import { manilaISO, addDays, normalizePhone, firstEmail, today } from './util.js';
import { readFile, readable } from './extract.js';
import { analyze } from './detect.js';
import { parsePriceList } from './pricelist.js';
import { download } from './sb.js';
import { OWNER_NAME } from '../config.js';

const LABEL = { schedule_events: 'schedule entr', content_posts: 'post', leads: 'lead' };
export const plural = (table, n) => `${n} ${LABEL[table]}${table === 'schedule_events' ? (n === 1 ? 'y' : 'ies') : n === 1 ? '' : 's'}`;
const lc = (s) => String(s || '').trim().toLowerCase();
// Inserts get identical created_at / updated_at; any later change moves updated_at (trigger).
const unedited = (r) => !r.updated_at || !r.created_at || Math.abs(new Date(r.updated_at) - new Date(r.created_at)) < 1000;
const chunks = (a, n = 300) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const byDate = (d) => [manilaISO(d), manilaISO(addDays(d, 1))];

/** Ids imported by every file so far, for one table. */
async function importedIds(table) {
  const rows = must(await sb.from('files_metadata').select('id,metrics').not('metrics->applied', 'is', null).limit(1000));
  return new Set(rows.flatMap(r => (r.metrics?.applied?.table === table ? r.metrics.applied.inserted || [] : [])));
}

async function insertAll(table, rows) {
  const ids = [];
  for (const part of chunks(rows)) ids.push(...must(await sb.from(table).insert(part).select('id')).map(r => r.id));
  return ids;
}
async function deleteIds(table, ids) { for (const part of chunks(ids)) must(await sb.from(table).delete().in('id', part)); }

// ── Schedule ───────────────────────────────────────────────────────────────
async function applySchedule(records) {
  const dates = records.map(r => r.date).sort();
  const [from, to] = [dates[0], dates.at(-1)];
  const leads = await fetchAll(() => sb.from('leads').select('id,full_name').order('id'));
  const leadByName = new Map(leads.map(l => [lc(l.full_name), l.id]));
  const rows = records.map(r => {
    const leadId = r.client ? leadByName.get(lc(r.client)) || null : null;
    const end = r.start && r.end && r.end > r.start ? manilaISO(r.date, r.end) : null;
    return {
      kind: r.kind, title: r.title || r.kind, status: 'Planned', all_day: !r.start,
      starts_at: manilaISO(r.date, r.start || '00:00'), ends_at: end, location: r.location || null, lead_id: leadId,
      notes: [r.notes, r.client && !leadId ? `Client: ${r.client}` : ''].filter(Boolean).join(' · ') || null,
    };
  });
  const prev = await importedIds('schedule_events');
  const existing = must(await sb.from('schedule_events').select('*').gte('starts_at', byDate(from)[0]).lt('starts_at', byDate(to)[1]));
  const replace = existing.filter(e => prev.has(e.id) && unedited(e));
  const keep = existing.filter(e => !replace.includes(e));
  const key = (e) => `${new Date(e.starts_at).getTime()}|${lc(e.title)}`;
  const kept = new Set(keep.map(key));
  const fresh = []; const seen = new Set(); let skipped = 0;
  for (const r of rows) { const k = key(r); if (kept.has(k) || seen.has(k)) { skipped++; continue; } seen.add(k); fresh.push(r); }
  if (replace.length) await deleteIds('schedule_events', replace.map(e => e.id));
  let inserted;
  try { inserted = await insertAll('schedule_events', fresh); }
  catch (e) { if (replace.length) await sb.from('schedule_events').insert(replace.map(({ leads: _l, ...r }) => r)); throw e; } // put the old ones back
  return { table: 'schedule_events', inserted, replaced: replace.map(({ leads: _l, ...r }) => r), skipped, range: [from, to] };
}

// ── Content posts ──────────────────────────────────────────────────────────
async function applyPosts(records) {
  const rows = records.map(r => ({
    title: r.title, caption: r.caption, platforms: r.platforms, status: r.status === 'Scheduled' && !r.date ? 'Draft' : r.status,
    scheduled_at: r.date ? manilaISO(r.date, r.time || '12:00') : null, notes: r.notes,
  }));
  const dates = records.map(r => r.date).filter(Boolean).sort();
  const prev = await importedIds('content_posts');
  let existing = [];
  if (dates.length) existing = must(await sb.from('content_posts').select('*').gte('scheduled_at', byDate(dates[0])[0]).lt('scheduled_at', byDate(dates.at(-1))[1]));
  existing.push(...must(await sb.from('content_posts').select('*').is('scheduled_at', null)));
  const replace = existing.filter(p => prev.has(p.id) && unedited(p) && (p.scheduled_at || rows.some(r => !r.scheduled_at && lc(r.title) === lc(p.title))));
  const keep = existing.filter(p => !replace.includes(p));
  const key = (p) => `${p.scheduled_at ? new Date(p.scheduled_at).getTime() : 'draft'}|${lc(p.title)}`;
  const kept = new Set(keep.map(key)); const fresh = []; let skipped = 0;
  for (const r of rows) { if (kept.has(key(r))) { skipped++; continue; } kept.add(key(r)); fresh.push(r); }
  if (replace.length) await deleteIds('content_posts', replace.map(p => p.id));
  let inserted;
  try { inserted = await insertAll('content_posts', fresh); }
  catch (e) { if (replace.length) await sb.from('content_posts').insert(replace); throw e; }
  return { table: 'content_posts', inserted, replaced: replace, skipped, range: dates.length ? [dates[0], dates.at(-1)] : null };
}

// ── Leads (add new people only; existing leads are never changed) ──────────
async function applyLeads(records) {
  const existing = await fetchAll(() => sb.from('leads').select('full_name,email,phone').order('id'));
  const keys = new Set(existing.flatMap(l => [`${lc(l.full_name)}|${firstEmail(l.email)}`, `${lc(l.full_name)}|${normalizePhone(l.phone)}`]));
  const fresh = []; let skipped = 0;
  for (const r of records) {
    const phone = normalizePhone(r.phone) || null;
    const k1 = `${lc(r.full_name)}|${firstEmail(r.email)}`, k2 = `${lc(r.full_name)}|${phone || ''}`;
    if (keys.has(k1) || (phone && keys.has(k2))) { skipped++; continue; }
    keys.add(k1); if (phone) keys.add(k2);
    fresh.push({ ...r, phone });
  }
  return { table: 'leads', inserted: await insertAll('leads', fresh), replaced: [], skipped };
}

/**
 * Read a stored file, recognise it, apply it, and save the overview on its files_metadata row.
 * → { row, result, applied, error }
 */
export async function processFile(row, blob, { apply = true, pricing: wantPricing = false } = {}) {
  if (!readable(row.file_type)) return { row };
  blob ||= await download(row.storage_path);
  let read;
  try { read = await readFile(blob, row.file_type); } catch (e) { read = { tables: [], text: '', error: `Could not read this file: ${e.message || e}` }; }
  const result = analyze({ ...read, fileName: row.file_name, ownerName: OWNER_NAME, today: today() });
  if (read.error) { result.summary = read.error; result.warnings.push(read.error); }
  // A developer price list (units + prices) → available on the Quotation page.
  let pricing = null;
  if ((wantPricing || !result.kind || row.metrics?.pricing) && read.tables.length) {
    // Columns chosen by hand with "Fix columns" are kept when the file is read again.
    const saved = row.metrics?.pricing?.mapping ? parsePriceList(read.tables, { mapping: row.metrics.pricing.mapping }) : null;
    const p = saved?.units.length ? saved : parsePriceList(read.tables);
    if (p.units.length >= (wantPricing || row.metrics?.pricing ? 1 : 3)) pricing = p;
  }
  return applyResult(row, result, { apply: apply && !pricing, pages: read.pages, pricing });
}

const pricingRecord = (p) => ({ units: p.units, mapping: p.mapping, warnings: p.warnings, at: new Date().toISOString() });
const pricingSummary = (p) => {
  const projects = [...new Set(p.units.map(u => u.project).filter(Boolean))];
  const prices = p.units.map(u => u.net).sort((a, b) => a - b);
  const php = (n) => `₱${Math.round(n).toLocaleString('en-PH')}`;
  return `Price list: ${p.units.length} unit(s)${projects.length ? ` · ${projects.slice(0, 3).join(', ')}${projects.length > 3 ? '…' : ''}` : ''} · ${php(prices[0])} – ${php(prices.at(-1))} · use it in Quotation`;
};

/** Save a price list chosen with "Fix columns" on the Quotation page. */
export async function savePricing(row, parsed) {
  const metrics = { ...(row.metrics || {}), pricing: pricingRecord(parsed) };
  return must(await sb.from('files_metadata').update({ metrics, summary: pricingSummary(parsed).slice(0, 1000) }).eq('id', row.id).select().single());
}

/** Apply an analyze() result and save the overview + import record on the file's row. */
export async function applyResult(row, result, { apply = true, pages = null, pricing = null } = {}) {
  let applied = null, error = null;
  if (apply && result.records.length) {
    try {
      applied = result.kind === 'schedule' ? await applySchedule(result.records)
        : result.kind === 'posts' ? await applyPosts(result.records)
        : result.kind === 'leads' ? await applyLeads(result.records) : null;
      if (applied) applied.at = new Date().toISOString();
    } catch (e) { error = e; }
  }
  const metrics = { ...(row.metrics || {}), overview: { ...result.overview, pages, warnings: result.warnings }, applied: applied || null, pricing: pricing ? pricingRecord(pricing) : null };
  if (pricing) result.summary = pricingSummary(pricing);
  const summary = (result.summary + (applied ? ` · added ${plural(applied.table, applied.inserted.length)}${applied.replaced.length ? `, replaced ${applied.replaced.length} from an older upload` : ''}` : '')).slice(0, 1000);
  const saved = must(await sb.from('files_metadata').update({ summary, metrics }).eq('id', row.id).select().single());
  return { row: saved, result, applied, error };
}

/** Remove what a file added and put back what it replaced. */
export async function undoApply(row) {
  const a = row.metrics?.applied;
  if (!a) return { row, removed: 0, restored: 0, kept: 0 };
  let ids = a.inserted || [], kept = 0;
  if (ids.length && a.table === 'leads') {           // never delete a lead that was edited since the import
    const now = must(await sb.from('leads').select('id,created_at,updated_at').in('id', ids.slice(0, 1000)));
    const keepIds = new Set(now.filter(l => !unedited(l)).map(l => l.id));
    kept = keepIds.size; ids = ids.filter(id => !keepIds.has(id));
  }
  if (ids.length) await deleteIds(a.table, ids);
  if (a.replaced?.length) for (const part of chunks(a.replaced)) must(await sb.from(a.table).upsert(part, { onConflict: 'id', ignoreDuplicates: true }));
  const metrics = { ...row.metrics, applied: null, undone: { table: a.table, at: new Date().toISOString(), removed: ids.length } };
  const saved = must(await sb.from('files_metadata').update({ metrics, summary: `${(row.summary || '').replace(/ · added .*$/, '')} · import undone` }).eq('id', row.id).select().single());
  return { row: saved, removed: ids.length, restored: a.replaced?.length || 0, kept };
}
