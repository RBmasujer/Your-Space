// Build the raw RFC 5322 message the Gmail API expects (base64url).
// Plain JS with no Deno APIs, so Node unit tests can check it (tests/mail.test.mjs).

const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const b64utf8 = (s) => b64(new TextEncoder().encode(s));
const b64url = (s) => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** RFC 2047 encoded-word so ₱, ñ, emoji etc. survive in headers. */
export const encHeader = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64utf8(s)}?=`);

export const EMAIL_RE = /^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$/;

/**
 * to / sender must already be validated with EMAIL_RE (no CR/LF possible);
 * subject must be one line. Body is plain text (UTF-8, base64).
 */
export function buildMime({ to, subject, body, sender, senderName = '' }) {
  if (!EMAIL_RE.test(to) || !EMAIL_RE.test(sender)) throw new Error('invalid address');
  if (/[\r\n]/.test(subject)) throw new Error('subject must be one line');
  const from = senderName ? `${encHeader(senderName.replace(/[\r\n"]/g, ''))} <${sender}>` : sender;
  const bodyB64 = b64utf8(String(body).replace(/\r?\n/g, '\r\n')).replace(/.{76}/g, '$&\r\n');
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
