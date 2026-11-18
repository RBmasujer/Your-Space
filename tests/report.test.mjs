// PDF writer + progress report tests.   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDF, winAnsi, textWidth } from '../web/assets/js/lib/pdf.js';
import { buildProgressReport, summarize, monthsBetween, php, phpShort } from '../web/assets/js/lib/report-pdf.js';

const latin1 = (bytes) => Array.from(bytes, b => String.fromCharCode(b)).join('');

/** Checks the cross-reference table points exactly at each "N 0 obj". */
function assertValidPdf(bytes) {
  const s = latin1(bytes);
  assert.ok(s.startsWith('%PDF-1.4\n'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
  const startxref = +/startxref\n(\d+)\n%%EOF\s*$/.exec(s)[1];
  assert.equal(s.slice(startxref, startxref + 4), 'xref');
  const [, count] = /xref\n0 (\d+)\n/.exec(s.slice(startxref)).map(Number);
  const entries = s.slice(startxref).split('\n').slice(3, 3 + count - 1);
  entries.forEach((e, i) => {
    const off = +e.slice(0, 10);
    assert.equal(s.slice(off, off + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`, `object ${i + 1} offset`);
  });
  for (const m of s.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const start = m.index + m[0].length;
    assert.equal(s.slice(start + +m[1], start + +m[1] + 10), '\nendstream', 'stream length');
  }
  return s;
}

test('text is mapped to WinAnsi and PDF-escaped', () => {
  assert.deepEqual(winAnsi('Año ₱5 “ok” – é'), [...'Año PHP 5 '].map(c => c.charCodeAt(0)).concat([0x93, 111, 107, 0x94, 32, 0x96, 32, 0xE9]));
  assert.equal(winAnsi('日')[0], 63); // unsupported → '?'
  const p = new PDF(); p.text('a (b) \\ c', 10, 10);
  assert.match(p.pages[0][0], /\(a \\\(b\\\) \\\\ c\) Tj/);
});

test('text width and fitting use real Helvetica metrics', () => {
  assert.equal(textWidth('0000', 10), 22.24);
  const p = new PDF();
  const s = p.fit('A very long client name that will not fit', 10, false, 80);
  assert.ok(s.endsWith('...') && textWidth(s, 10) <= 80);
});

test('a multi-page document has a valid xref table', () => {
  const p = new PDF({ title: 'T (1)' });
  p.text('Page 1', 40, 40); p.addPage(); p.text('Page 2 ñ', 40, 40); p.rect(10, 10, 50, 20, { fill: '#1b6fb5', stroke: '#000' }); p.line(0, 0, 100, 100, { dash: [3, 2] });
  const s = assertValidPdf(p.toBytes());
  assert.match(s, /\/Count 2/);
});

test('summary: sales, completed leads, earnings, months', () => {
  const closed = [
    { closed_at: '2026-11-05', contract_price: 5000000 },
    { closed_at: '2026-11-20', contract_price: '3000000.50' },
    { closed_at: '2027-01-10', contract_price: 4000000 },
  ];
  const s = summarize({ closed, ratePct: 3, from: '2026-11-01', to: '2027-02-28' });
  assert.equal(s.deals, 3);
  assert.equal(s.totalSales, 12000000.5);
  assert.equal(s.earnings, 360000.015);
  assert.deepEqual(s.months.map(m => [m.key, m.deals, m.sales]), [['2026-11', 2, 8000000.5], ['2026-12', 0, 0], ['2027-01', 1, 4000000], ['2027-02', 0, 0]]);
  assert.equal(s.months.at(-1).cumulative, 12000000.5);
  assert.equal(summarize({ closed, ratePct: null, from: '2026-11-01', to: '2026-11-30' }).earnings, null);
  assert.equal(summarize({ closed: [], ratePct: 3, from: '2026-11-01', to: '2026-11-30' }).avgDeal, 0);
  assert.equal(monthsBetween('2020-01-01', '2030-01-01').length, 36); // capped
});

test('money formats', () => {
  assert.equal(php(1234567.5), 'PHP 1,234,567.50');
  assert.equal(phpShort(25000000), 'PHP 25M');
  assert.equal(phpShort(37500000), 'PHP 37.5M');
  assert.equal(phpShort(950), 'PHP 950');
});

test('full progress report builds a valid multi-page PDF', () => {
  const closed = Array.from({ length: 60 }, (_, i) => ({
    closed_at: `2026-${String(11 + (i % 2)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
    full_name: `Client (${i}) Peñaflor \\ test`, project: 'Sierra Valley Gardens', unit: `Tower ${i % 3}`, contract_price: 4500000 + i * 1000,
  }));
  const pdf = buildProgressReport({
    owner: 'CJ Masujer', role: 'Property Specialist · RLC Residences', from: '2026-11-01', to: '2027-02-28', periodLabel: 'Contract period',
    generatedAt: 'Nov 18, 2026', ratePct: 3, includeNames: true, closed, reserved: { count: 2, sum: 9000000 }, newLeads: 41,
    stages: [{ status: 'New', leads: 30 }, { status: 'Closed', leads: 60 }],
    quota: { quota_php: 25000000, goal_php: 37500000, goal_pct: 150, sales_php: 271770000, pct_of_quota: 1087, pct_of_goal: 724, remaining_quota_php: 0, remaining_goal_php: 0, days_left: 102, period_start: '2026-11-01', period_end: '2027-02-28' },
  });
  assert.ok(pdf.pageCount >= 3, `pages: ${pdf.pageCount}`);
  const s = assertValidPdf(pdf.toBytes());
  for (const want of ['Progress Report', 'TOTAL SALES', 'COMPLETED LEADS', 'TOTAL EARNINGS', 'Sales by month', 'Completed leads', `Page 1 of ${pdf.pageCount}`, 'Commission at 3%']) assert.ok(s.includes(want), want);
  assert.ok(s.includes('Client \\(0\\) Pe\xF1aflor \\\\ test'), 'names escaped + ñ encoded');
  // names can be left out for sharing
  const anon = latin1(buildProgressReport({ owner: 'CJ', role: 'x', from: '2026-11-01', to: '2026-11-30', generatedAt: '', ratePct: null, includeNames: false, closed: closed.slice(0, 3), reserved: {}, newLeads: 0, stages: [], quota: null }).toBytes());
  assert.ok(!anon.includes('Pe\xF1aflor'));
  assert.ok(anon.includes('Not set'));
});
