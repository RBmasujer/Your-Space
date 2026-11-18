// Supabase client + small data helpers.
import { SUPABASE_URL, SUPABASE_ANON_KEY, BUCKET } from '../config.js';

export const configured = !SUPABASE_URL.includes('YOUR-PROJECT-REF') && !SUPABASE_ANON_KEY.startsWith('YOUR-');

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    flowType: 'pkce',          // ?code= in the URL instead of #access_token (we use # for routing)
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

let _uid = null;
export function setUid(id) { _uid = id; }
export function uid() { return _uid; }

/** Throw on Supabase error, return data. */
export function must(res) {
  if (res.error) throw res.error;
  return res.data;
}

/** Fetch every row (PostgREST caps responses at 1000 rows). `make` must return a fresh query. */
export async function fetchAll(make, page = 1000) {
  const out = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await make().range(from, from + page - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < page) break;
  }
  return out;
}

// ── Storage ────────────────────────────────────────────────────────────────
const urlCache = new Map(); // path -> { url, exp }

export async function signedUrl(path, { download = false } = {}) {
  if (!path) return '';
  const key = path + (download ? '|dl' : '');
  const hit = urlCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.url;
  const data = must(await sb.storage.from(BUCKET).createSignedUrl(path, 3600, download ? { download: true } : undefined));
  urlCache.set(key, { url: data.signedUrl, exp: Date.now() + 50 * 60 * 1000 });
  return data.signedUrl;
}

export async function signedUrls(paths) {
  const need = [...new Set(paths.filter(p => p && !(urlCache.get(p)?.exp > Date.now())))];
  if (need.length) {
    const data = must(await sb.storage.from(BUCKET).createSignedUrls(need, 3600));
    for (const d of data) if (d.signedUrl) urlCache.set(d.path, { url: d.signedUrl, exp: Date.now() + 50 * 60 * 1000 });
  }
  return Object.fromEntries(paths.filter(Boolean).map(p => [p, urlCache.get(p)?.url || '']));
}

export function forgetUrl(path) { urlCache.delete(path); urlCache.delete(path + '|dl'); }

export async function download(path) {
  const data = must(await sb.storage.from(BUCKET).download(path));
  return data; // Blob
}
