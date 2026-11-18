// Email: templates/placeholders, Gmail links, and the raw message sent to the Gmail API.   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fill, buildMessages, checkMessage, gmailLinks, hasPlaceholders, explainSendError } from '../web/assets/js/lib/mail.js';
import { buildMime, encHeader } from '../supabase/functions/send-email/mime.js';

const tpl = { subject: 'Hi {{first_name}}, your LTO computation', body: 'Hi {{ First_Name }}!\nThis is for {{name}}.', signature: 'CJ Masujer\nRLC Residences' };

test('template placeholders are filled per person; plain messages pass through', () => {
  const [a, b] = buildMessages([{ email: 'juan@x.com', name: 'Juan (Johnny) Dela Cruz', lead_id: 'L1' }, { email: 'x@y.com', name: '' }], tpl);
  assert.deepEqual(a, { to: 'juan@x.com', lead_id: 'L1', subject: 'Hi Juan, your LTO computation', body: 'Hi Juan!\nThis is for Juan (Johnny) Dela Cruz.\n\nCJ Masujer\nRLC Residences' });
  assert.equal(b.subject, 'Hi there, your LTO computation');
  assert.equal(b.body.split('\n')[0], 'Hi there!');
  // no template: typed text is sent as is, signature optional
  const [c] = buildMessages([{ email: 'a@b.co', name: 'Ana' }], { subject: 'Viewing on Saturday', body: 'See you at 10 AM.' });
  assert.deepEqual([c.subject, c.body], ['Viewing on Saturday', 'See you at 10 AM.']);
  assert.equal(fill('{{name}}', { name: 'A$&B $\' C' }), 'A$&B $\' C');   // "$" patterns inserted literally
  assert.ok(hasPlaceholders('x', 'Hi {{name}}')); assert.ok(!hasPlaceholders('Hi', 'there'));
});

test('checkMessage catches what the server would reject', () => {
  assert.deepEqual(checkMessage({ subject: 'S', body: 'B', count: 1 }), []);
  assert.equal(checkMessage({ subject: '', body: '', count: 0 }).length, 3);
  assert.match(checkMessage({ subject: 'a\nb', body: 'B', count: 1 })[0], /one line/);
  assert.match(checkMessage({ subject: 'S', body: 'x'.repeat(20001), count: 1 })[0], /longer than 20,000/);
});

test('Open in Gmail: one person gets a personal email, many get BCC batches of 25', () => {
  const one = gmailLinks([{ email: 'juan@x.com', name: 'Juan Dela Cruz' }], { ...tpl, account: 'cj@gmail.com' });
  assert.equal(one.length, 1);
  const u = new URL(one[0].url);
  assert.equal(u.searchParams.get('to'), 'juan@x.com');
  assert.equal(u.searchParams.get('su'), 'Hi Juan, your LTO computation');   // subject placeholders filled too
  assert.match(u.searchParams.get('body'), /^Hi Juan!/);
  assert.equal(u.searchParams.get('authuser'), 'cj@gmail.com');
  assert.equal(u.searchParams.get('bcc'), null);

  const people = Array.from({ length: 60 }, (_, i) => ({ email: `p${i}@x.com`, name: `Person ${i}` }));
  const many = gmailLinks(people, { ...tpl, account: 'cj@gmail.com' });
  assert.deepEqual(many.map(l => l.count), [25, 25, 10]);
  const m = new URL(many[0].url);
  assert.equal(m.searchParams.get('to'), 'cj@gmail.com');
  assert.equal(m.searchParams.get('bcc').split(',').length, 25);
  assert.equal(m.searchParams.get('su'), 'Hi there, your LTO computation');
  assert.ok(!many.some(l => l.tooLong));
  assert.ok(gmailLinks([{ email: 'a@b.co', name: 'A' }], { subject: 'S', body: 'x'.repeat(9000) })[0].tooLong);
});

test('send errors are explained in plain words', () => {
  assert.match(explainSendError(404, { code: 'NOT_FOUND' }), /not deployed/);
  assert.match(explainSendError(501, { error: 'not_configured' }), /Gmail is not connected/);
  assert.match(explainSendError(401, {}), /session expired/);
  assert.match(explainSendError(429, { error: 'Daily limit reached: 400 sent' }), /Daily limit/);
  assert.match(explainSendError(0, null, 'Failed to send a request to the Edge Function'), /not deployed yet.*ALLOWED_ORIGINS/);
});

/** Decode what the Gmail API receives. */
const decode = (raw) => Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
const decodeWord = (h) => h.replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, b) => Buffer.from(b, 'base64').toString('utf8'));

test('raw Gmail message: headers, UTF-8 subject/name, base64 body', () => {
  const raw = buildMime({ to: 'juan@x.com', subject: 'Unit ₱4.8M – Peñaflor', body: 'Hi Juan!\nPrice: ₱4,800,000 ✓', sender: 'cjmasujer.rpmmc@gmail.com', senderName: 'CJ Masujer — RLC Residences' });
  assert.ok(!/[+/=]/.test(raw), 'base64url');
  const msg = decode(raw);
  const [head, body] = msg.split('\r\n\r\n');
  const H = Object.fromEntries(head.split('\r\n').map(l => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 2)]));
  assert.equal(H.To, 'juan@x.com');
  assert.equal(decodeWord(H.Subject), 'Unit ₱4.8M – Peñaflor');
  assert.equal(decodeWord(H.From), 'CJ Masujer — RLC Residences <cjmasujer.rpmmc@gmail.com>');
  assert.equal(H['Content-Type'], 'text/plain; charset="UTF-8"');
  assert.equal(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8'), 'Hi Juan!\r\nPrice: ₱4,800,000 ✓');
  assert.ok(body.split('\r\n').every(l => l.length <= 76), 'body lines wrapped at 76');
  assert.equal(encHeader('Plain subject'), 'Plain subject');
});

test('raw Gmail message refuses header injection', () => {
  assert.throws(() => buildMime({ to: 'a@b.co\r\nBcc: x@evil.com', subject: 'S', body: 'B', sender: 'me@gmail.com' }), /invalid address/);
  assert.throws(() => buildMime({ to: 'a@b.co', subject: 'S\r\nBcc: x@evil.com', body: 'B', sender: 'me@gmail.com' }), /one line/);
  const msg = decode(buildMime({ to: 'a@b.co', subject: 'S', body: 'B', sender: 'me@gmail.com', senderName: 'Me\r\nBcc: x@evil.com' }));
  assert.ok(!/^Bcc:/m.test(msg.split('\r\n\r\n')[0]));
});
