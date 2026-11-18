// Upload helpers: every stored file gets a row in files_metadata.
import { sb, must, uid, forgetUrl } from './sb.js';
import { BUCKET } from '../config.js';
import { safeName } from './util.js';

export const MAX_BYTES = 50 * 1024 * 1024; // Supabase Free per-file limit

const MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
};

export function kindOf(file) {
  const n = (file.name || '').toLowerCase();
  if (n.endsWith('.docx')) return 'docx';
  if (n.endsWith('.xlsx')) return 'xlsx';
  if (n.endsWith('.csv')) return 'csv';
  if ((file.type || '').startsWith('image/')) return 'image';
  if ((file.type || '').startsWith('video/')) return 'video';
  return 'other';
}

export function mimeOf(file, kind = kindOf(file)) {
  // Browsers sometimes report '' or 'application/vnd.ms-excel' for CSV; be explicit.
  return MIME[kind] || file.type || 'application/octet-stream';
}

/**
 * Upload a File/Blob and create its files_metadata row.
 * folder: docs | sheets | images | content | showcase
 */
export async function uploadFile(file, { folder = 'docs', tags = [], name } = {}) {
  if (file.size > MAX_BYTES) throw new Error(`${file.name} is larger than 50 MB (Supabase Free limit).`);
  const kind = kindOf({ name: name || file.name, type: file.type });
  if (kind === 'other') throw new Error('Only .docx, .xlsx, .csv, images and videos can be uploaded.');
  const fileName = name || file.name;
  const path = `${uid()}/${folder}/${crypto.randomUUID()}-${safeName(fileName)}`;
  must(await sb.storage.from(BUCKET).upload(path, file, { contentType: mimeOf({ name: fileName, type: file.type }, kind), upsert: false, cacheControl: '3600' }));
  try {
    return must(await sb.from('files_metadata').insert({
      file_name: fileName, file_type: kind, mime_type: mimeOf({ name: fileName, type: file.type }, kind),
      storage_path: path, size_bytes: file.size, tags,
      processing_status: (kind === 'xlsx' || kind === 'csv') ? 'pending' : 'skipped',
    }).select().single());
  } catch (e) {
    await sb.storage.from(BUCKET).remove([path]); // don't leave orphans
    throw e;
  }
}

/** Overwrite an existing stored file with new contents (edit & save). */
export async function replaceFile(row, blob) {
  if (blob.size > MAX_BYTES) throw new Error('Edited file is larger than 50 MB.');
  must(await sb.storage.from(BUCKET).update(row.storage_path, blob, { contentType: row.mime_type || blob.type, upsert: true, cacheControl: '0' }));
  forgetUrl(row.storage_path);
  const isSheet = row.file_type === 'xlsx' || row.file_type === 'csv';
  return must(await sb.from('files_metadata').update({
    size_bytes: blob.size, last_modified: new Date().toISOString(),
    ...(isSheet ? { processing_status: 'pending', processing_error: null } : {}),
  }).eq('id', row.id).select().single());
}

export async function deleteFile(row) {
  must(await sb.storage.from(BUCKET).remove([row.storage_path]));
  must(await sb.from('files_metadata').delete().eq('id', row.id));
  forgetUrl(row.storage_path);
}

/** Ask the Edge Function to extract spreadsheet metrics (works even without the DB webhook). */
export async function processSheet(fileId) {
  const { data, error } = await sb.functions.invoke('process-spreadsheet', { body: { file_id: fileId } });
  if (error) throw error;
  return data;
}
