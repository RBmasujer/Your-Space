// Brevo transactional email: request body + plain-word errors.
// Plain JS with no Deno APIs, so Node unit tests can check it (tests/brevo.test.mjs).
import { EMAIL_RE } from './mime.js';

export const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

/**
 * JSON body for one plain-text email. `to` / `sender` must pass EMAIL_RE; subject must be one line.
 * An invalid replyTo is left out rather than sent (Brevo would reject the whole email).
 */
export function buildBrevoPayload({ to, subject, body, sender, senderName = '', replyTo = '' }) {
  if (!EMAIL_RE.test(to) || !EMAIL_RE.test(sender)) throw new Error('invalid address');
  if (/[\r\n]/.test(subject)) throw new Error('subject must be one line');
  const name = String(senderName || '').replace(/[\r\n"]+/g, ' ').trim();
  return {
    sender: name ? { email: sender, name } : { email: sender },
    to: [{ email: to }],
    ...(EMAIL_RE.test(replyTo || '') ? { replyTo: { email: replyTo } } : {}),
    subject,
    textContent: String(body),
  };
}

/** Turn a Brevo API error into a sentence CJ can act on (README → Brevo sending). */
export function explainBrevoError(status, payload) {
  const msg = String(payload?.message ?? '');
  if (/unrecogni[sz]ed IP/i.test(msg)) return 'Brevo blocked the request because Supabase’s IP address is unknown to it. In Brevo open Security → Authorised IPs and deactivate the blocking (README step 6b).';
  if (status === 401 || payload?.code === 'unauthorized') return 'Brevo did not accept the API key (wrong, deleted or expired). Create a new key in Brevo and update the BREVO_API_KEY secret in Supabase (README step 6b).';
  if (/not (yet )?activated/i.test(msg)) return 'Your Brevo account cannot send emails yet: Brevo has not activated it. Finish the account profile in Brevo or contact Brevo support to activate it.';
  if (/sender/i.test(msg) && /(invalid|not valid|inactive|verif)/i.test(msg)) return 'Brevo does not accept the sender address. In Brevo open Senders, Domains & Dedicated IPs → Senders and verify the address saved in BREVO_SENDER (README step 6b).';
  if (status === 402 || /credit/i.test(msg)) return 'Brevo’s daily free sending limit is used up. Try again tomorrow.';
  return msg ? `Brevo: ${msg}` : `Brevo error ${status}`;
}
