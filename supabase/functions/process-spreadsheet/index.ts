// Edge Function: process-spreadsheet
// Parses an uploaded .xlsx/.csv, extracts metrics, saves them to files_metadata
// and appends a row to file_metrics_log (monitoring history).
//
// Two ways it is triggered:
//  1. Database Webhook on files_metadata INSERT/UPDATE (header x-webhook-secret = WEBHOOK_SECRET)
//  2. The web app right after an upload: POST { file_id } with the user's JWT
// A row is processed only when its processing_status is 'pending' (atomic claim),
// so both triggers firing for the same upload is harmless.
import * as XLSX from 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { computeMetrics, summarize } from './metrics.js';
import { corsHeaders, json, safeEqual } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET') ?? '';
const BUCKET = 'workspace';
const MAX_BYTES = 5 * 1024 * 1024; // Free plan: 2 s CPU per request — keep parsing small

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json(req, { error: 'invalid_json' }, 400); }

  // ── Who is calling? ───────────────────────────────────────────────────────
  let fileId: string | undefined;
  const hookSecret = req.headers.get('x-webhook-secret');
  if (hookSecret) {
    if (!WEBHOOK_SECRET || !safeEqual(hookSecret, WEBHOOK_SECRET)) return json(req, { error: 'forbidden' }, 403);
    const rec = body?.record;
    if (!rec || body?.table !== 'files_metadata') return json(req, { skipped: 'not a files_metadata event' });
    if (rec.processing_status !== 'pending' || !['xlsx', 'csv'].includes(rec.file_type)) return json(req, { skipped: 'nothing to do' });
    fileId = rec.id;
  } else {
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) return json(req, { error: 'unauthorized' }, 401);
    const user = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
    const { data: u, error: ue } = await user.auth.getUser(token);
    if (ue || !u?.user) return json(req, { error: 'unauthorized' }, 401);
    const { data: owner } = await user.rpc('is_app_owner');
    if (owner !== true) return json(req, { error: 'forbidden' }, 403);
    if (typeof body?.file_id !== 'string') return json(req, { error: 'file_id required' }, 400);
    // RLS proves the caller owns this row
    const { data: row } = await user.from('files_metadata').select('id').eq('id', body.file_id).maybeSingle();
    if (!row) return json(req, { error: 'not_found' }, 404);
    fileId = row.id;
  }

  // ── Atomic claim: only one invocation processes a pending row ──────────────
  const { data: claimed, error: ce } = await admin.from('files_metadata')
    .update({ processing_status: 'processing', processing_error: null })
    .eq('id', fileId!).eq('processing_status', 'pending')
    .select('id, owner_id, file_type, storage_path, size_bytes').maybeSingle();
  if (ce) return json(req, { error: ce.message }, 500);
  if (!claimed) return json(req, { skipped: 'not pending (already processed or in progress)' });

  try {
    if (!['xlsx', 'csv'].includes(claimed.file_type)) {
      await admin.from('files_metadata').update({ processing_status: 'skipped' }).eq('id', claimed.id);
      return json(req, { skipped: 'not a spreadsheet' });
    }
    if ((claimed.size_bytes ?? 0) > MAX_BYTES) throw new Error('File is over 5 MB — too large to analyse on the free plan. It can still be opened and edited.');

    const { data: blob, error: de } = await admin.storage.from(BUCKET).download(claimed.storage_path);
    if (de || !blob) throw new Error(`Download failed: ${de?.message ?? 'unknown'}`);
    if (blob.size > MAX_BYTES) throw new Error('File is over 5 MB — too large to analyse on the free plan.');

    const wb = claimed.file_type === 'csv'
      ? XLSX.read(await blob.text(), { type: 'string', raw: true, dense: true })
      : XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array', dense: true, cellHTML: false, cellFormula: false, sheetRows: 20001 });

    const sheets = wb.SheetNames.slice(0, 15).map((name: string) => ({
      name,
      rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, blankrows: false, defval: null }) as unknown[][],
    }));
    const metrics = computeMetrics(sheets);
    const summary = summarize(metrics);

    const { error: ue2 } = await admin.from('files_metadata')
      .update({ metrics, summary, processing_status: 'done', processing_error: null })
      .eq('id', claimed.id);
    if (ue2) throw ue2;
    await admin.from('file_metrics_log').insert({ owner_id: claimed.owner_id, file_id: claimed.id, metrics });

    return json(req, { ok: true, file_id: claimed.id, summary, total_rows: metrics.total_rows });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 500);
    await admin.from('files_metadata').update({ processing_status: 'error', processing_error: msg }).eq('id', claimed.id);
    return json(req, { error: msg }, 422);
  }
});
