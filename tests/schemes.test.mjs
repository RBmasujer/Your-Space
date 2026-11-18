// Payment schemes + computation-sheet reader for the Quotation page.   npm test
// Figures mirror RLC's computation workbook (project names replaced with samples).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLTO, computeInstallment, priceBreakdown, addMonths } from '../web/assets/js/lib/schemes.js';
import { parseCalcSheets } from '../web/assets/js/lib/calcsheets.js';

const r2 = (n) => Math.round(n * 100) / 100;

test('EDATE-style month adding', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-12-18', 11), '2027-11-18');
  assert.equal(addMonths('2026-11-19', 121), '2036-12-19');
});

test('contract price: each discount once, on the unit price; parking added', () => {
  const p = priceBreakdown({ price: 4373100, parking: 800000, discounts: { payment: 0.01, event: 0.02 } });
  assert.deepEqual([r2(p.totalDiscount), r2(p.net)], [131193, 5041907]);
  assert.equal(priceBreakdown({ price: 6700500, discounts: { payment: 0.06 } }).net, 6298470);
});

test('LTO 120 matches the complete RLC sheet (studio, 24 sqm, ₱125/sqm dues)', () => {
  const c = computeLTO({ price: 6665000, area: 24, start: '2026-12-01', lto: { term: 120, advance: 1, security: 2, closingPct: 0.06, duesRate: 125, duesAdvance: 3, dstPct: 0.002 } });
  assert.equal(r2(c.rent), 55541.67);
  assert.deepEqual([r2(c.advDep), r2(c.secDep), c.remainingMonths, r2(c.remaining)], [55541.67, 111083.33, 117, 6498375]);
  assert.deepEqual([c.duesMonthly, c.duesAdv, r2(c.dst), r2(c.moveIn), r2(c.monthlyOutlay), c.closing], [3000, 9000, 13330, 188955, 58541.67, 399900]);
  assert.deepEqual(Object.values(c.totals).map(r2), [6665000, 360000, 413230, 7438230]);
  const s = c.schedule;
  assert.equal(s.length, 122);                                  // month 0 … 121
  assert.deepEqual([s[0].date, r2(s[0].total)], ['2026-12-01', 188955]);
  assert.deepEqual([s[1].lease, s[1].dues], [0, 3000]);         // month 1: covered by the advance
  assert.deepEqual([r2(s[2].total), r2(s[117].total)], [58541.67, 58541.67]);
  assert.deepEqual([r2(s[118].lease), s[118].dues], [55541.67, 0]); // month 118: advance dues applied
  assert.deepEqual([s[119].lease, s[120].lease], [0, 0]);       // 119–120: security deposit
  assert.deepEqual([s[121].date, s[121].fees, s[121].balance], ['2037-01-01', 399900, 0]);
  assert.equal(s.at(-2).balance, 0);                          // fully paid after month 120
});

test('LTO 120 short sheet: 1 advance + 2 deposit, 6% closing', () => {
  const c = computeLTO({ price: 6718700, lto: { term: 120, advance: 1, security: 2, closingPct: 0.06, duesRate: 0, dstPct: 0 } });
  assert.deepEqual([r2(c.rent), r2(c.moveIn), c.closing], [55989.17, 167967.5, 403122]);
});

test('standard: down payment less reservation, monthly installments, 80% retention, 6% closing', () => {
  const c = computeInstallment({ scheme: 'standard', price: 6700500, discounts: { payment: 0.06 }, start: '2026-12-01', inst: { rf: 50000, dpPct: 0.05, dpMonths: 1, tiers: [{ pct: 0.15, months: 24 }], closingPct: 0.06 } });
  assert.deepEqual([c.price.net, r2(c.dp), r2(c.dpNet), r2(c.dpEach)], [6298470, 314923.5, 264923.5, 264923.5]);
  assert.deepEqual([r2(c.tiers[0].amount), r2(c.tiers[0].each), c.tiers[0].from, c.tiers[0].to], [944770.5, 39365.44, '2027-02-01', '2029-01-01']);
  assert.deepEqual([c.retentionPct, r2(c.retention), r2(c.closing)], [0.8, 5038776, 377908.2]);
  const paid = c.schedule.filter(r => !r.fee).reduce((a, r) => a + r.amount, 0);
  assert.equal(r2(paid), 6298470);                           // every peso of the net price is scheduled once
  assert.equal(c.closingDate, '2029-01-01');
  assert.equal(c.retentionDate, '2029-02-01');
});

test('step-up: yearly tiers, last tier can be shorter', () => {
  const c = computeInstallment({ scheme: 'stepup', price: 6966700, discounts: { payment: 0.02 }, start: '2026-12-18', inst: { rf: 50000, dpPct: 0.03, dpMonths: 12, closingPct: 0.06, tiers: [{ pct: 0.0325, months: 12 }, { pct: 0.045, months: 12 }, { pct: 0.0575, months: 12 }, { pct: 0.035, months: 6 }] } });
  assert.equal(c.price.net, 6827366);
  assert.deepEqual([r2(c.dpNet), r2(c.dpEach)], [154820.98, 12901.75]);
  assert.deepEqual(c.tiers.map(t => r2(t.each)), [18490.78, 25602.62, 32714.46, 39826.3]);
  assert.deepEqual(c.tiers.map(t => [t.from, t.to]), [['2028-01-18', '2028-12-18'], ['2029-01-18', '2029-12-18'], ['2030-01-18', '2030-12-18'], ['2031-01-18', '2031-06-18']]);
  assert.deepEqual([r2(c.retentionPct), r2(c.retention), r2(c.closing)], [0.8, 5461892.8, 409641.96]);
  assert.deepEqual(computeInstallment({ price: 1e6, inst: { rf: 50000, dpPct: 0.6, tiers: [{ pct: 0.5, months: 10 }] } }).warnings.length, 1);
});

// ── Reader: synthetic sheets laid out like RLC's ───────────────────────────
const LTO_COMPLETE = [
  ['SAMPLE COMPUTATION [READY FOR OCCUPANCY]'], ['SAMPLE TOWER, SAMPLE ESTATE'], ['Pasig City'], [],
  ['UNIT PARTICULARS', '', '', 'UNIT DETAILS & INPUTS'],
  ['Project Name', '', '', 'SAMPLE TOWER, SAMPLE ESTATE'], ['Floor / Unit Number', '', '', '*09W03'], ['Unit Type', '', '', 'STUDIO'],
  ['Total Area (SQM)', '', '', 24], ['Parking Assignment / Level', '', '', 'None'], ['Parking Price', '', '', 0], [],
  ['TOTAL CONTRACT PRICE (TCP) COMPUTATION', '', '', 'RATE / %', 'UNIT (PHP)', 'TOTAL (PHP)'],
  ['Gross Total Contract Price (GTCP)', '', '', '', 6665000, 6665000],
  ['Less: Payment Scheme Discount', '', '', 0, 0, 0], ['Less: Event Discount (if applicable)', '', '', 0, 0, 0],
  ['NET TOTAL CONTRACT PRICE (NTCP)', '', '', '', 6665000, 6665000], [],
  ['SPECIAL PAYMENT TERMS — LEASE TO OWN (LTO): 100% [120 MONTHS] AT 0% INTEREST'],
  ['Lease Term (Months at 0% Interest)', '', '', 120, 1, 6665000],
  ['Monthly Lease Amortization (Months 1–120)', '', '', '120 Months', 0.00833, 55541.67],
  ['1 Month Advance Deposit (Applied to Month 1)', '', '', '1 Month', 1, 55541.67],
  ['2 Months Security Deposit', '', '', '2 Months', 2, 111083.33],
  ['Closing Fee (Payable on the 121st Month)', '', '', '121st Month', 0.06, 399900],
  ['ASSOCIATION DUES & DOCUMENTARY STAMP TAX (ADDITIONAL MOVE-IN & MONTHLY CHARGES)'],
  ['Association Dues Rate per SQM (Payable to the Condo Corp.)', '', '', '24.00 SQM', 125, 3000],
  ['Advance Association Dues (Must submit 3 months advance)', '', '', '3 Months', 3, 9000],
  ['Documentary Stamp Tax (DST)', '', '', 'On NTCP', 0.002, 13330],
];
const STANDARD_DOUBLE = [
  ['(PROJECT NAME)'], ['Unit Type:', 'Studio'], ['Unit Number:'], ['Area Sqm:', 22], ['Unit Price:', 4373100], [], [], ['Parking Price:'], [],
  ['STANDARD PAYMENT SCHEME'], [], ['OPTION 1 ', '', '', 'UNIT', 'PARKING', 'TOTAL'], ['PRICE', '', '', 4373100, 0],
  ['Less', 0.01, 'Payment scheme disc', 43731], ['NET TCP PRICE', '', '', 4329369, 0, 4329369], [],
  ['Total Contract Price', '', 4329369], ['Discount', 0.01, 43293.69], ['NET Total Contract Price', '', 4286075.31], [],
  ['Downpayment', 0.2, 857215.06, 'DATE'], ['Less: Reservation Fee', '', 50000, 46344], ['Amount (net of RF)', '', 807215.06],
  ['No. of DPs', 27, 29896.85, 46344, '', 47136], [], [], ['Monthly Installment', 0, 0, 'FROM'], ["No. of MA's", 0, '#DIV/0!'], [],
  ['Retention', 0.8, 3428860.25], [], ['Closing Fee (6%)', '', 257164.52],
];
const STEPUP = [
  ['Project Name: ', 'PRJ2'], ['Unit Type:', 'Lot'], ['Unit Number:'], ['Area Sqm:', '55sqm'], [], [], [], [], [], [],
  ['STEP-UP PAYMENT SCHEME'], [], ['', '', '', 'UNIT', 'PARKING', 'TOTAL'], ['Total Contract Price', '', '', 6000000, 0],
  ['Less', 0, 'Payment Scheme Discount', 0], ['NET TCP', '', '', 6000000, 0, 6000000], ['Net TCP', '', 6000000], [],
  ['Downpayment', 0.0225, 135000, 'DATE'], ['Less: Reservation Fee', '', 50000, 46344], ['No. of DPs', 12, 7083.33, 46374, 46709], [],
  ['Monthly Installment', 0.02, 120000], ["No. of MA's", 12, 10000, 46739, 47075], [],
  ['Monthly Installment', 0.0275, 165000], ["No. of MA's", 12, 13750, 47105, 47440], [],
  ['Retention', 0.8, 4800000], [], ['Closing Fee ', 0.06, 360000],
];

test('reader: complete LTO sheet → LTO template with every rate', () => {
  const { templates } = parseCalcSheets([{ name: 'LTO120_Sample_Complete', rows: LTO_COMPLETE }]);
  const [t] = templates;
  assert.deepEqual([t.scheme, t.project, t.unit, t.type, t.area, t.price], ['lto', 'SAMPLE TOWER, SAMPLE ESTATE', '*09W03', 'STUDIO', 24, 6665000]);
  assert.deepEqual(t.lto, { term: 120, advance: 1, security: 2, closingPct: 0.06, duesRate: 125, duesAdvance: 3, dstPct: 0.002 });
  assert.equal(r2(computeLTO({ ...t }).totals.total), 7438230);
  assert.deepEqual(t.warnings, []);
});

test('reader: standard sheet — double discount and #DIV/0! are reported, not copied', () => {
  const [t] = parseCalcSheets([{ name: 'Orig Template', rows: STANDARD_DOUBLE }]).templates;
  assert.equal(t.scheme, 'standard');
  assert.deepEqual([t.price, t.discounts, t.inst.rf, t.inst.dpPct, t.inst.dpMonths, t.inst.tiers], [4373100, { payment: 0.01 }, 50000, 0.2, 27, []]);
  assert.equal(computeInstallment(t).price.net, 4329369);
  const w = t.warnings.join(' | ');
  assert.match(w, /#DIV\/0!/); assert.match(w, /0\.00% over 0 month/); assert.match(w, /net price is ₱4,286,075\.31.*₱4,329,369 is used/);
});

test('reader: step-up sheet, project/sheet-name mismatch, schedule sheets skipped', () => {
  const { templates, notes } = parseCalcSheets([
    { name: 'Special Step-Up PRJ1', rows: STEPUP },
    { name: 'LTO120_Schedule', rows: [['UNIT — PAYMENT & CASH OUTFLOW SCHEDULE'], [], ['Month #', 'Payment Milestone', 'Lease'], [0, 'Move-in', 166625]] },
  ]);
  const [t] = templates;
  assert.deepEqual([t.scheme, t.project, t.area, t.inst.dpPct, t.inst.dpMonths, t.inst.tiers], ['stepup', 'PRJ2', 55, 0.0225, 12, [{ pct: 0.02, months: 12 }, { pct: 0.0275, months: 12 }]]);
  assert.match(t.warnings.join(' '), /Sheet “Special Step-Up PRJ1” says the project is “PRJ2”/);
  assert.match(t.warnings.join(' '), /retention \(80\.00%\) doesn't match.*\(7\.00%\)/);   // only 2 of the tiers in this sample
  assert.equal(templates.length, 1);
  assert.match(notes[0], /payment schedule/);
});
