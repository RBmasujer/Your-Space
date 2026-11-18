// Profile photo + Google account helpers (shared by the header and Settings).
// Photo priority: a photo uploaded in Settings → the linked Google account's photo → initials placeholder.
import { sb, signedUrl } from './sb.js';
import { esc } from './util.js';
import { OWNER_NAME } from '../config.js';

export const googleIdentity = (user) => (user?.identities || []).find(i => i.provider === 'google') || null;

export function displayName(user) {
  const g = googleIdentity(user)?.identity_data || {};
  return user?.user_metadata?.display_name || g.full_name || g.name || OWNER_NAME;
}

export function initials(name) {
  const parts = String(name || '').replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts.at(-1)[0] : '')).toUpperCase();
}

/** URL of the photo to show, or '' for the placeholder. */
export async function photoUrl(user) {
  const path = user?.user_metadata?.avatar_path;
  if (path) { try { return await signedUrl(path); } catch { /* fall through to Google / placeholder */ } }
  const g = googleIdentity(user)?.identity_data || {};
  const u = g.avatar_url || g.picture || '';
  return /^https:\/\/[^/]+\.googleusercontent\.com\//.test(u) ? u : '';
}

const PERSON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="8.2" r="4.2"/><path d="M3.5 21c.9-4.3 4.2-6.8 8.5-6.8s7.6 2.5 8.5 6.8z"/></svg>';

/** Placeholder markup: initials when we know a name, a person silhouette otherwise. */
export function placeholder(name) {
  const i = initials(name);
  return i ? `<span aria-hidden="true">${esc(i)}</span>` : PERSON;
}

/** Fill an .avatar element. Falls back to the placeholder if the image fails to load. */
export async function paintAvatar(el, user) {
  if (!el) return;
  const name = displayName(user);
  el.innerHTML = placeholder(name);
  el.title = name;
  const url = await photoUrl(user);
  if (!url) return;
  const img = new Image();
  img.alt = ''; img.referrerPolicy = 'no-referrer'; // Google photos refuse requests with a referrer
  img.onload = () => el.replaceChildren(img);
  img.src = url;
}

/** Repaint every avatar on the page (header + Settings) with the latest user data. */
export async function refreshAvatars() {
  const { data: { user } } = await sb.auth.getUser();
  document.querySelectorAll('[data-avatar]').forEach(el => paintAvatar(el, user));
  return user;
}

export const GOOGLE_LOGO = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

/** Where Google should send the browser back to (this page, no hash/query). */
export const returnUrl = () => location.origin + location.pathname;

/** Is the Google provider switched on in Supabase? (public endpoint, cached) */
let _providers;
export async function googleEnabled() {
  if (_providers === undefined) {
    try {
      const { SUPABASE_URL, SUPABASE_ANON_KEY } = await import('../config.js');
      const r = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_ANON_KEY } });
      _providers = r.ok ? (await r.json()).external || {} : {};
    } catch { _providers = {}; }
  }
  return !!_providers.google;
}
