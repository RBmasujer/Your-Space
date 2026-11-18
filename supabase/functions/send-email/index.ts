// Edge Function: send-email
// Sends personal emails from the owner's Gmail account through the Gmail API (HTTPS).
// SMTP is not used because Supabase Edge Functions block outbound ports 25 and 587.
//
// Required secrets (supabase secrets set …):
//   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_SENDER, GMAIL_SENDER_NAME (optional)
//   ALLOWED_ORIGINS (e.g. https://rbmasujer.github.io), DAILY_LIMIT (optional, default 400)
//
// Request:  POST { messages: [{ to, subject, body, lead_id? }] }   (max 20 per call)
// Response: { sent, failed, results: [{ to, ok, error? }] }
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const CLIENT_ID = Deno.env.get('GMAIL_CLIENT_ID') ?? '';
const CLIENT_SECRET = Deno.env.get('GMAIL_CLIENT_SECRET') ?? '';
const REFRESH_TOKEN = Deno.env.get('GMAIL_REFRESH_TOKEN') ?? '';
const SENDER = Deno.env.get('GMAIL_SENDER') ?? '';
const SENDER_NAME = Deno.env.get('GMAIL_SENDER_NAME') ?? '';
const DAILY_LIMIT = Number(Deno.env.get('DAILY_LIMIT') ?? 400);
const MAX_PER_CALL = 20;
const EMAIL_RE = /^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let cached: { token: string; exp: number } | null = null;
async function accessToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: REFRESH_TOKEN, grant_type: 'refresh_token' }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`Google token error: ${j.error_description ?? j.error ?? `HTTP ${res.status}`}. If this says "invalid_grant", create a new refresh token (README → Gmail sending).`);
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return cached.token;
}

const b64 = (bytes: Uint8Array) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const b64utf8 = (s: string) => b64(new TextEncoder().encode(s));
const b64url = (s: string) => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
/** RFC 2047 encoded-word so ₱, ñ, emoji etc. survive in headers. */
const encHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64utf8(s)}?=`);

function buildMime(to: string, subject: string, body: string): string {
  const from = SENDER_NAME ? `${encHeader(SENDER_NAME)} <${SENDER}>` : SENDER;
  const bodyB64 = b64utf8(body.replace(/\r?\n/g, '\r\n')).replace(/.{76}/g, '$&\r\n');
  const mime = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    bodyB64,
  ].join('\r\n');
  return b64url(b64utf8(mime));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);

  // ── Auth: signed-in workspace owner only ────────────────────────────────────
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json(req, { error: 'unauthorized' }, 401);
  const db = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: u, error: ue } = await db.auth.getUser(token);
  if (ue || !u?.user) return json(req, { error: 'unauthorized' }, 401);
  const { data: owner } = await db.rpc('is_app_owner');
  if (owner !== true) return json(req, { error: 'forbidden' }, 403);

  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN || !SENDER) return json(req, { error: 'not_configured' }, 501);

  // ── Validate input ──────────────────────────────────────────────────────────
  let body: any;
  try { body = await req.json(); } catch { return json(req, { error: 'invalid_json' }, 400); }
  const msgs = Array.isArray(body?.messages) ? body.messages : [];
  if (!msgs.length || msgs.length > MAX_PER_CALL) return json(req, { error: `send 1–${MAX_PER_CALL} messages per call` }, 400);
  for (const m of msgs) {
    if (typeof m?.to !== 'string' || !EMAIL_RE.test(m.to.trim())) return json(req, { error: `invalid recipient: ${String(m?.to).slice(0, 80)}` }, 400);
    if (typeof m.subject !== 'string' || !m.subject.trim() || m.subject.length > 200 || /[\r\n]/.test(m.subject)) return json(req, { error: 'subject must be one line, 1–200 characters' }, 400);
    if (typeof m.body !== 'string' || !m.body.trim() || m.body.length > 20000) return json(req, { error: 'body must be 1–20000 characters' }, 400);
    if (m.lead_id != null && (typeof m.lead_id !== 'string' || !UUID_RE.test(m.lead_id))) return json(req, { error: 'invalid lead_id' }, 400);
  }

  // ── Daily cap (Gmail allows ~500/day for personal accounts) ────────────────
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await db.from('email_log').select('id', { count: 'exact', head: true }).eq('status', 'sent').gte('sent_at', since);
  if ((count ?? 0) + msgs.length > DAILY_LIMIT) return json(req, { error: `Daily limit reached: ${count} sent in the last 24 h (limit ${DAILY_LIMIT}). Try again tomorrow.` }, 429);

  // ── Send (3 at a time) and log each result ─────────────────────────────────
  let gtoken: string;
  try { gtoken = await accessToken(); } catch (e) { return json(req, { error: String((e as Error).message) }, 502); }

  const results: { to: string; ok: boolean; error?: string; log_error?: string }[] = [];
  const queue = [...msgs];
  const worker = async () => {
    for (let m = queue.shift(); m; m = queue.shift()) {
      const to = m.to.trim().toLowerCase();
      let ok = false, err: string | null = null, id: string | null = null;
      try {
        const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: { Authorization: `Bearer ${gtoken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw: buildMime(to, m.subject.trim(), m.body) }),
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok) { ok = true; id = j.id ?? null; } else err = j?.error?.message ?? `Gmail error ${r.status}`;
      } catch (e) { err = String((e as Error).message ?? e); }
      // The log is also what the daily cap counts, so a failed write must not be silent.
      const { error: le } = await db.from('email_log').insert({
        lead_id: m.lead_id ?? null, to_email: to, subject: m.subject.trim(), body: m.body,
        status: ok ? 'sent' : 'failed', error: err, provider_message_id: id, sent_at: ok ? new Date().toISOString() : null,
      });
      if (le) console.error('email_log insert failed', le.message);
      results.push({ to, ok, ...(err ? { error: err } : {}), ...(le ? { log_error: le.message } : {}) });
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  const sent = results.filter((r) => r.ok).length;
  return json(req, { sent, failed: results.length - sent, results });
});
