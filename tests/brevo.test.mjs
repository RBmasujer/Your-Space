// Brevo: the request the send-email function sends, and Brevo errors in plain words.   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBrevoPayload, explainBrevoError, BREVO_URL } from '../supabase/functions/send-email/brevo.js';

const base = { to: 'juan@x.com', subject: 'Unit ₱4.8M – Peñaflor', body: 'Hi Juan!\nPrice: ₱4,800,000', sender: 'cjmasujer.rpmmc@gmail.com', senderName: 'CJ Masujer — RLC Residences' };

test('Brevo payload: one plain-text email with sender name and reply-to', () => {
  assert.equal(BREVO_URL, 'https://api.brevo.com/v3/smtp/email');
  assert.deepEqual(buildBrevoPayload({ ...base, replyTo: 'cjmasujer.rpmmc@gmail.com' }), {
    sender: { email: 'cjmasujer.rpmmc@gmail.com', name: 'CJ Masujer — RLC Residences' },
    to: [{ email: 'juan@x.com' }],
    replyTo: { email: 'cjmasujer.rpmmc@gmail.com' },
    subject: 'Unit ₱4.8M – Peñaflor',
    textContent: 'Hi Juan!\nPrice: ₱4,800,000',
  });
});

test('Brevo payload: no name → no name field; bad reply-to is left out', () => {
  const p = buildBrevoPayload({ ...base, senderName: '', replyTo: 'not an email' });
  assert.deepEqual(p.sender, { email: 'cjmasujer.rpmmc@gmail.com' });
  assert.equal('replyTo' in p, false);
});

test('Brevo payload: sender name loses line breaks and quotes', () => {
  const p = buildBrevoPayload({ ...base, senderName: 'Me\r\nBcc: "x@evil.com"' });
  assert.ok(!/[\r\n"]/.test(p.sender.name));
});

test('Brevo payload refuses bad addresses and multi-line subjects', () => {
  assert.throws(() => buildBrevoPayload({ ...base, to: 'a@b.co\r\nx' }), /invalid address/);
  assert.throws(() => buildBrevoPayload({ ...base, sender: 'nobody' }), /invalid address/);
  assert.throws(() => buildBrevoPayload({ ...base, subject: 'S\nBcc: x' }), /one line/);
});

test('Brevo errors are explained in plain words', () => {
  const ip = { code: 'unauthorized', message: 'We have detected you are using an unrecognised IP address 34.1.2.3. If you performed this action make sure to add the new IP address in this link: https://app.brevo.com/security/authorised_ips' };
  assert.match(explainBrevoError(401, ip), /Authorised IPs/);
  assert.match(explainBrevoError(401, { code: 'unauthorized', message: 'Key not found' }), /BREVO_API_KEY/);
  assert.match(explainBrevoError(400, { code: 'invalid_parameter', message: 'Sender is invalid / inactive' }), /verif/i);
  assert.match(explainBrevoError(403, { code: 'permission_denied', message: 'Unable to send email. Your SMTP account is not yet activated. Please contact us at contact@brevo.com to request activation' }), /activat/i);
  assert.match(explainBrevoError(402, { code: 'not_enough_credits', message: 'Not enough credits' }), /daily/i);
  assert.equal(explainBrevoError(400, { code: 'invalid_parameter', message: 'email is not valid in to' }), 'Brevo: email is not valid in to');
  assert.equal(explainBrevoError(500, null), 'Brevo error 500');
});
