// Upload helpers: every stored file gets a row in files_metadata.
import { sb, must, uid, forgetUrl } from './sb.js';
import { BUCKET } from '../config.js';
import { safeName } from './util.js';

export const MAX_BYTES = 50 * 1024 * 1024; // Supabase Free per-file limit

// Kind + content type are decided from the file EXTENSION, not from the browser.
// Browsers often report '' for .docx/.xlsx (Windows without Office installed),
// 'application/vnd.ms-excel' for .csv, or nothing at all for phone photos — the
// storage bucket only accepts an allow-list of types, so a wrong/empty type made
// the upload fail with "mime type … is not supported".
const EXT = {
  docx: ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  doc: ['other', 'application/msword'],
  pdf: ['pdf', 'application/pdf'],
  xlsx: ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  xls: ['xls', 'application/vnd.ms-excel'],
  csv: ['csv', 'text/csv'],
  jpg: ['image', 'image/jpeg'], jpeg: ['image', 'image/jpeg'], jfif: ['image', 'image/jpeg'],
  png: ['image', 'image/png'], gif: ['image', 'image/gif'], webp: ['image', 'image/webp'],
  heic: ['image', 'image/heic'], heif: ['image', 'image/heif'], avif: ['image', 'image/avif'], bmp: ['image', 'image/bmp'],
  mp4: ['video', 'video/mp4'], m4v: ['video', 'video/mp4'], mov: ['video', 'video/quicktime'], webm: ['video', 'video/webm'],
};
// Fallback when a photo has no extension (some phone pickers): trust the browser type.
const BY_TYPE = {
  'image/jpeg': 'image/jpeg', 'image/jpg': 'image/jpeg', 'image/pjpeg': 'image/jpeg', 'image/png': 'image/png',
  'image/gif': 'image/gif', 'image/webp': 'image/webp', 'image/heic': 'image/heic', 'image/heif': 'image/heif',
  'image/avif': 'image/avif', 'image/bmp': 'image/bmp', 'video/mp4': 'video/mp4', 'video/quicktime': 'video/quicktime',
  'video/webm': 'video/webm', 'application/pdf': 'application/pdf',
};

/** What the file input `accept` attribute should allow. */
export const ACCEPT = '.pdf,.docx,.doc,.xlsx,.xls,.csv,image/*,.heic,.heif,video/mp4,video/quicktime,video/webm';
export const ACCEPT_IMAGES = 'image/*,.heic,.heif';

const ext = (name) => (/\.([a-z0-9]+)$/i.exec(name || '') || [])[1]?.toLowerCase() || '';

/** → { kind, mime } or null when the file type is not supported. */
export function typeOf(file) {
  const hit = EXT[ext(file.name)];
  if (hit) return { kind: hit[0], mime: hit[1] };
  const t = BY_TYPE[(file.type || '').toLowerCase()];
  if (t) return { kind: t === 'application/pdf' ? 'pdf' : t.split('/')[0], mime: t };
  return null;
}
export const kindOf = (file) => typeOf(file)?.kind || 'other';
export const isSheet = (kind) => kind === 'xlsx' || kind === 'xls' || kind === 'csv';

const newId = () => crypto.randomUUID?.() ??
  // crypto.randomUUID only exists on https/localhost; e.g. testing on a phone over http://192.168.x.x
  ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));

/** Re-wrap the bytes with the right content type. supabase-js ignores the `contentType`
 *  option for File/Blob bodies and sends the Blob's own type instead. */
const typed = (blob, mime) => (blob.type === mime ? blob : new Blob([blob], { type: mime }));

function storageError(e, name, mime) {
  const m = e?.message || String(e);
  if (/mime type|invalid_mime_type|not supported/i.test(m)) {
    return new Error(`${name}: the storage bucket does not accept ${mime} yet. Run supabase/migrations/20261118000003_uploads.sql in the Supabase SQL Editor.`);
  }
  if (/exceeded the maximum allowed size|Payload too large|413/i.test(m)) return new Error(`${name} is larger than 50 MB.`);
  if (/Bucket not found/i.test(m)) return new Error('The "workspace" storage bucket is missing. Run supabase/migrations/20261118000001_schema.sql.');
  return e;
}

/**
 * Upload a File/Blob and create its files_metadata row.
 * folder: docs | sheets | images | content | showcase
 */
export async function uploadFile(file, { folder = 'docs', tags = [], name } = {}) {
  const fileName = name || file.name;
  if (file.size > MAX_BYTES) throw new Error(`${fileName} is larger than 50 MB (Supabase Free limit).`);
  const t = typeOf({ name: fileName, type: file.type });
  if (!t) throw new Error(`${fileName}: only PDF, Word (.docx/.doc), spreadsheets (.xlsx/.xls/.csv), images and short videos can be uploaded.`);
  const path = `${uid()}/${folder}/${newId()}-${safeName(fileName)}`;
  const up = await sb.storage.from(BUCKET).upload(path, typed(file, t.mime), { contentType: t.mime, upsert: false, cacheControl: '3600' });
  if (up.error) throw storageError(up.error, fileName, t.mime);
  try {
    return must(await sb.from('files_metadata').insert({
      file_name: fileName, file_type: t.kind, mime_type: t.mime,
      storage_path: path, size_bytes: file.size, tags,
      processing_status: isSheet(t.kind) ? 'pending' : 'skipped',
    }).select().single());
  } catch (e) {
    await sb.storage.from(BUCKET).remove([path]); // don't leave orphans
    if (/invalid input value for enum/i.test(e?.message || '')) throw new Error(`${fileName}: the database does not know "${t.kind}" files yet. Run supabase/migrations/20261118000003_uploads.sql in the Supabase SQL Editor.`);
    throw e;
  }
}

/** Overwrite an existing stored file with new contents (edit & save). */
export async function replaceFile(row, blob) {
  if (blob.size > MAX_BYTES) throw new Error('Edited file is larger than 50 MB.');
  const mime = row.mime_type || blob.type;
  const up = await sb.storage.from(BUCKET).update(row.storage_path, typed(blob, mime), { contentType: mime, upsert: true, cacheControl: '0' });
  if (up.error) throw storageError(up.error, row.file_name, mime);
  forgetUrl(row.storage_path);
  return must(await sb.from('files_metadata').update({
    size_bytes: blob.size, last_modified: new Date().toISOString(), mime_type: mime,
    ...(isSheet(row.file_type) ? { processing_status: 'pending', processing_error: null } : {}),
  }).eq('id', row.id).select().single());
}

export async function deleteFile(row) {
  must(await sb.storage.from(BUCKET).remove([row.storage_path]));
  must(await sb.from('files_metadata').delete().eq('id', row.id));
  forgetUrl(row.storage_path);
}

/** Profile photo: stored at <uid>/avatar/…, path kept in the user's auth metadata (no Files row). */
export async function uploadAvatar(file) {
  const t = typeOf(file);
  if (!t || t.kind !== 'image') throw new Error('Choose a photo (JPG, PNG, WebP or GIF).');
  if (file.size > 5 * 1024 * 1024) throw new Error('Profile photo must be 5 MB or smaller.');
  const path = `${uid()}/avatar/${newId()}-${safeName(file.name)}`;
  const up = await sb.storage.from(BUCKET).upload(path, typed(file, t.mime), { contentType: t.mime, upsert: false, cacheControl: '3600' });
  if (up.error) throw storageError(up.error, file.name, t.mime);
  return path;
}

/** Ask the Edge Function to extract spreadsheet metrics (works even without the DB webhook). */
export async function processSheet(fileId) {
  const { data, error } = await sb.functions.invoke('process-spreadsheet', { body: { file_id: fileId } });
  if (error) throw error;
  return data;
}
