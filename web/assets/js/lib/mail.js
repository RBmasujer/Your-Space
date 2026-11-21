// Email helpers shared by the Email screen (pure — unit-tested in Node).
import { firstName } from './util.js';

export const GMAIL_BATCH = 25;          // people per Gmail compose window (BCC)
export const MAX_BODY = 20000;          // same limit as the send-email function
export const MAX_SUBJECT = 200;
const MAX_GMAIL_URL = 7500;             // longer compose links can be refused by Gmail

const PH = /\{\{\s*(first_name|name)\s*\}\}/gi;
export const hasPlaceholders = (...texts) => texts.some(t => new RegExp(PH.source, 'i').test(t || ''));

/** Replace {{first_name}} / {{name}}. A function replacer, so "$&" in a name is inserted literally. */
export const fill = (text, person = {}) => String(text || '').replace(PH, (_, key) => (key.toLowerCase() === 'first_name' ? firstName(person.name) : person.name) || 'there');

/** One finished message per recipient: personalised subject + body + signature. */
export function buildMessages(recipients, { subject, body, signature = '' }) {
  const sig = String(signature || '').trim();
  return recipients.map(({ email, name = '', lead_id = null }) => ({
    to: email, lead_id,
    subject: fill(subject, { name }).replace(/[\r\n]+/g, ' ').trim(),
    body: fill(body, { name }).trim() + (sig ? `\n\n${sig}` : ''),
  }));
}

/** Problems to fix before sending (empty array = OK). */
export function checkMessage({ subject, body, count }) {
  const out = [];
  if (!count) out.push('Add at least one recipient.');
  if (!String(subject || '').trim()) out.push('Write a subject.');
  if (!String(body || '').trim()) out.push('Write a message.');
  if (/[\r\n]/.test(subject || '')) out.push('The subject must be one line.');
  if (String(subject || '').length > MAX_SUBJECT) out.push(`The subject is longer than ${MAX_SUBJECT} characters.`);
  if (String(body || '').length > MAX_BODY) out.push(`The message is longer than ${MAX_BODY.toLocaleString('en-PH')} characters.`);
  return out;
}

/** Gmail compose link (opens Gmail in the browser, signed in as `account`). */
export function gmailComposeUrl({ to = '', bcc = [], subject = '', body = '', account = '' }) {
  const q = new URLSearchParams({ view: 'cm', fs: '1', to, su: subject, body });
  if (bcc.length) q.set('bcc', bcc.join(','));
  if (account) q.set('authuser', account);
  return `https://mail.google.com/mail/?${q}`;
}

/**
 * Compose links for "Open in Gmail".
 * 1 person  → one personal email (placeholders filled with their name).
 * many      → windows of up to 25 people in BCC, addressed to yourself; placeholders become "there".
 */
export function gmailLinks(recipients, { subject, body, signature = '', account = '' }) {
  if (recipients.length === 1) {
    const [m] = buildMessages(recipients, { subject, body, signature });
    return [{ url: gmailComposeUrl({ to: m.to, subject: m.subject, body: m.body, account }), count: 1, tooLong: false }].map(markLong);
  }
  const [m] = buildMessages([{ email: '', name: '' }], { subject, body, signature });
  const out = [];
  for (let i = 0; i < recipients.length; i += GMAIL_BATCH) {
    const bcc = recipients.slice(i, i + GMAIL_BATCH).map(r => r.email);
    out.push(markLong({ url: gmailComposeUrl({ to: account, bcc, subject: m.subject, body: m.body, account }), count: bcc.length }));
  }
  return out;
}
const markLong = (l) => ({ ...l, tooLong: l.url.length > MAX_GMAIL_URL });

/** Turn a send-email failure into a sentence a person can act on. */
export function explainSendError(status, payload, fallback = '') {
  const code = payload?.error || payload?.code || '';
  if (status === 404 || code === 'NOT_FOUND') return 'Automatic sending is not deployed yet (the send-email function is missing in Supabase — README step 5). Use “Open in Gmail” meanwhile.';
  if ((code === 'not_configured' || status === 501) && payload?.provider === 'brevo') return 'Automatic sending uses Brevo, but the sender is not set: add the BREVO_SENDER secret in Supabase (README step 6b). Use “Open in Gmail” meanwhile.';
  if (code === 'not_configured' || status === 501) return 'Automatic sending is deployed but Gmail is not connected yet (README step 6, Gmail secrets). Use “Open in Gmail” meanwhile.';
  if (status === 401) return 'Your session expired — sign out and sign in again, then retry.';
  if (status === 403) return 'This account is not allowed to send emails from Your Space.';
  if (status === 429) return payload?.error || 'Daily sending limit reached. Try again tomorrow.';
  if (status === 502 && /invalid_grant/i.test(code)) return 'Gmail permission was revoked or expired. Create a new refresh token (README step 6) and update GMAIL_REFRESH_TOKEN.';
  if (payload?.error) return String(payload.error);
  // A function that isn't deployed fails the browser's CORS pre-check too, so this case can't be told apart.
  if (/Failed to send a request|Failed to fetch|NetworkError/i.test(fallback)) return 'Automatic sending is not available: the send-email function could not be reached. Most likely it is not deployed yet (README step 5); otherwise check ALLOWED_ORIGINS (step 5a) and your connection. Use “Open in Gmail” meanwhile.';
  return fallback || 'Sending failed.';
}

/** When a whole batch failed (e.g. a bad Brevo key), the reason to show; null when anything was sent. */
export function batchFailure(data) {
  if (!data || data.sent > 0 || !data.failed) return null;
  return (data.results || []).find(r => !r.ok && r.error)?.error || 'Sending failed.';
}
