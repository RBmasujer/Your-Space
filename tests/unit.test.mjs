// Unit tests for the pure helpers. No installs needed:
//   npm test        (or: node --test "tests/**/*.test.mjs")
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, safeUrl, normalizePhone, firstEmail, firstName, hasPhone, safeName, addDays, daysBetween, manilaISO, ymd, toCSV, EMAIL_RE } from '../web/assets/js/lib/util.js';
import { toNumber, findHeader, sheetMetrics, summarize, computeMetrics } from '../supabase/functions/process-spreadsheet/metrics.js';

test('esc() neutralises every HTML-significant character', () => {
  assert.equal(esc(`<img src=x onerror="alert('1')">\`&`), '&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt;&#96;&amp;');
  assert.equal(esc(null), '');
  assert.equal(esc(0), '0');
});

test('safeUrl() only allows http(s) and mailto', () => {
  assert.equal(safeUrl('https://rlc.com/x'), 'https://rlc.com/x');
  assert.equal(safeUrl('  mailto:a@b.co '), 'mailto:a@b.co');
  for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,<script>', 'vbscript:x', '//evil.com', '']) assert.equal(safeUrl(bad), '', bad);
});

test('normalizePhone() restores PH mobile numbers', () => {
  assert.equal(normalizePhone('9171234567'), '+639171234567');
  assert.equal(normalizePhone('0917 123 4567'), '+639171234567');
  assert.equal(normalizePhone('639171234567'), '+639171234567');
  assert.equal(normalizePhone('(02) 8123-4567'), '(02) 8123-4567'); // landline left as typed
  assert.equal(normalizePhone(null), '');
});

test('email helpers', () => {
  assert.equal(firstEmail('A@X.com / b@y.com'), 'a@x.com');
  assert.equal(firstEmail('@gmail.com'), '');
  assert.ok(EMAIL_RE.test('cj@rlc.com.ph'));
  assert.ok(!EMAIL_RE.test('a@b'));
  assert.ok(!EMAIL_RE.test('a@b.com,c@d.com'));
  assert.equal(firstName('Juan (Johnny) dela Cruz'), 'Juan');
  assert.ok(hasPhone('+63 917 123 4567'));
  assert.ok(!hasPhone('n/a'));
});

test('safeName() strips path tricks and odd characters', () => {
  assert.equal(safeName('../../etc/passwd'), '....etcpasswd');
  assert.ok(!safeName('a/b\\c.pdf').includes('/'));
  assert.equal(safeName('Résumé final.docx'), 'Resume_final.docx');
  assert.equal(safeName(''), 'file');
  assert.ok(safeName('x'.repeat(500)).length <= 120);
});

test('Manila date helpers', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2027-03-01', -1), '2027-02-28');
  assert.equal(daysBetween('2026-11-01', '2027-02-28'), 119);
  assert.equal(manilaISO('2026-11-18', '09:30'), '2026-11-18T09:30:00+08:00');
  assert.equal(ymd('2026-11-18T17:00:00Z'), '2026-11-19'); // 1 AM next day in Manila
});

test('toCSV() quotes commas, quotes and newlines', () => {
  assert.equal(toCSV([['a', 'b,c', 'd"e', 'f\ng', null]]), '﻿a,"b,c","d""e","f\ng",');
});

test('spreadsheet metrics: numbers vs phone numbers', () => {
  assert.equal(toNumber('₱1,234.50'), 1234.5);
  assert.equal(toNumber('12%'), 0.12);
  assert.equal(toNumber('09171234567'), null);   // phone, leading 0
  assert.equal(toNumber('+639171234567'), null); // phone, leading +
  assert.equal(toNumber('9171234567'), null);    // 10 digits, no decimal → ID/phone
  assert.equal(toNumber('abc'), null);
});

test('spreadsheet metrics: finds the header under title rows and summarises', () => {
  const rows = [
    ['LEADS TRACKER'], [], ['As of Nov'],
    ['Name', 'Status', 'Contract Price', 'Phone'],
    ['A', 'Closed', '₱5,000,000', '09171234567'],
    ['B', 'Closed', 3000000, '09181234567'],
    ['C', 'New', null, '09191234567'],
  ];
  assert.equal(findHeader(rows), 3);
  const m = sheetMetrics('Leads', rows);
  assert.equal(m.rows, 3);
  const price = m.columns.find(c => c.name === 'Contract Price');
  assert.equal(price.numeric.sum, 8000000);
  assert.ok(!m.columns.find(c => c.name === 'Phone').numeric, 'phones must not be summed');
  assert.match(summarize(computeMetrics([{ name: 'Leads', rows }])), /Contract Price total 8,000,000/);
});
