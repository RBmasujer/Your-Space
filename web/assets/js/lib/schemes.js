// RLC payment schemes for the Quotation page — pure math, unit-tested in Node.
// Reproduces RLC's computation sheets (Price Calculator.xlsx) with their known
// spreadsheet mistakes corrected: every discount is applied once, to the unit price;
// parking is added to the contract price; "Special / Other / Employee" discounts count.
//
//   quote = { scheme: 'lto'|'standard'|'stepup', price, parking, area, discounts: { payment, event, … } (fractions),
//             start: 'YYYY-MM-DD', lto: {…}, inst: {…} }

export const SCHEMES = { lto: 'Lease-to-Own (LTO)', standard: 'Standard payment', stepup: 'Step-up payment' };
export const DISCOUNTS = [
  ['payment', 'Payment scheme discount'], ['event', 'Event discount'], ['loyalty', 'Loyalty discount'],
  ['special', 'Special discount'], ['other', 'Other discount'], ['employee', 'Employee discount'],
];
export const LTO_DEFAULTS = { term: 120, advance: 1, security: 2, closingPct: 0.06, duesRate: 0, duesAdvance: 3, dstPct: 0.002 };
export const INST_DEFAULTS = { rf: 50000, dpPct: 0.2, dpMonths: 1, tiers: [], closingPct: 0.06 };

const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const int = (v, lo, hi, d) => Math.min(hi, Math.max(lo, Math.round(num(v, d))));

/** Add calendar months like Excel's EDATE (Jan 31 + 1 month = Feb 28). */
export function addMonths(ymd, n) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}

/** Contract price: unit price − discounts (each a % of the unit price) + parking. */
export function priceBreakdown(q) {
  const unit = num(q.price), parking = num(q.parking);
  const discounts = DISCOUNTS.map(([key, label]) => ({ key, label, rate: num(q.discounts?.[key]), amount: unit * num(q.discounts?.[key]) })).filter(d => d.rate);
  const totalDiscount = discounts.reduce((a, d) => a + d.amount, 0);
  return { unit, parking, gross: unit + parking, discounts, totalDiscount, discountRate: unit ? totalDiscount / unit : 0, net: Math.max(0, unit - totalDiscount + parking) };
}

/** Lease-to-Own (RLC LTO 120 structure). */
export function computeLTO(q) {
  const p = priceBreakdown(q);
  const L = { ...LTO_DEFAULTS, ...(q.lto || {}) };
  const term = int(L.term, 1, 360, 120);
  const advance = int(L.advance, 0, term, 1);
  const security = int(L.security, 0, term - advance, 2);
  const duesAdvance = int(L.duesAdvance, 0, term, 3);
  const rent = p.net / term;
  const duesMonthly = num(q.area) * num(L.duesRate);
  const advDep = rent * advance, secDep = rent * security, duesAdv = duesMonthly * duesAdvance;
  const dst = p.net * num(L.dstPct), closing = p.net * num(L.closingPct);
  const moveIn = advDep + secDep + duesAdv + dst;
  const start = q.start;
  const rows = [];
  let bal = p.net - advDep - secDep;
  rows.push({ m: 0, date: start, desc: `Move-in: ${advance} mo. advance + ${security} mo. security deposit${duesAdv ? ` + ${duesAdvance} mo. advance assoc. dues` : ''}${dst ? ' + DST' : ''}`, lease: advDep + secDep, dues: duesAdv, fees: dst, balance: bal });
  for (let m = 1; m <= term; m++) {
    const byAdvance = m <= advance, bySecurity = m > term - security;
    const lease = byAdvance || bySecurity ? 0 : rent;
    const dues = m <= term - duesAdvance ? duesMonthly : 0;
    bal = Math.max(0, bal - lease);
    const desc = byAdvance ? 'Lease covered by advance deposit' : bySecurity ? 'Lease covered by security deposit' : 'Monthly lease';
    rows.push({ m, date: start && addMonths(start, m), desc: desc + (duesMonthly && !dues ? ' (advance assoc. dues applied)' : duesMonthly ? ' + assoc. dues' : ''), lease, dues, fees: 0, balance: bal });
  }
  rows.push({ m: term + 1, date: start && addMonths(start, term + 1), desc: `Turnover & closing fee (${+(num(L.closingPct) * 100).toFixed(2)}% of net price)`, lease: 0, dues: 0, fees: closing, balance: 0 });
  rows.forEach(r => { r.total = r.lease + r.dues + r.fees; });
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  return {
    scheme: 'lto', price: p, term, advance, security, duesAdvance, rent, duesMonthly, duesRate: num(L.duesRate),
    advDep, secDep, remainingMonths: term - advance - security, remaining: rent * (term - advance - security),
    duesAdv, duesPaidMonths: term - duesAdvance, dst, dstPct: num(L.dstPct), closing, closingPct: num(L.closingPct),
    moveIn, monthlyOutlay: rent + duesMonthly,
    totals: { lease: sum('lease'), dues: sum('dues'), fees: sum('fees'), total: sum('total') },
    schedule: rows,
  };
}

/** Standard / Step-up: down payment (less reservation fee) → installment tiers → retention → closing fee. */
export function computeInstallment(q) {
  const p = priceBreakdown(q);
  const I = { ...INST_DEFAULTS, ...(q.inst || {}) };
  const net = p.net, start = q.start;
  const rf = Math.max(0, num(I.rf));
  const dpPct = Math.max(0, num(I.dpPct)), dpMonths = int(I.dpMonths, 1, 120, 1);
  const dp = net * dpPct, dpNet = dp - rf, dpEach = dpNet / dpMonths;
  const warnings = [];
  if (dpNet < 0) warnings.push('The reservation fee is larger than the down payment.');
  const rows = [];
  let paid = 0, cursor = 0;            // cursor = months after the reservation date
  const pay = (desc, amount, months) => {
    const from = cursor + 1;
    for (let i = 1; i <= months; i++) { cursor++; paid += amount; rows.push({ date: start && addMonths(start, cursor), desc: `${desc} ${i} of ${months}`, amount, balance: Math.max(0, net - paid) }); }
    return { from: start && addMonths(start, from), to: start && addMonths(start, cursor) };
  };
  paid += rf;
  rows.push({ date: start, desc: 'Reservation fee', amount: rf, balance: Math.max(0, net - paid) });
  const dpDates = dpPct ? pay('Down payment', dpEach, dpMonths) : null;
  const tiers = (I.tiers || []).map(t => ({ pct: Math.max(0, num(t.pct)), months: int(t.months, 0, 360, 0) })).filter(t => t.pct > 0 && t.months > 0)
    .map((t, i) => { const amount = net * t.pct, each = amount / t.months; return { ...t, amount, each, ...pay(`Installment${(I.tiers || []).length > 1 ? ` (step ${i + 1})` : ''}`, each, t.months) }; });
  const paidPct = dpPct + tiers.reduce((a, t) => a + t.pct, 0);
  if (paidPct > 1.0001) warnings.push(`Down payment and installments add up to ${(paidPct * 100).toFixed(2)}% — more than 100%.`);
  const retentionPct = Math.max(0, 1 - paidPct), retention = net * retentionPct;
  const lastDate = start && cursor ? addMonths(start, cursor) : start;
  const closingPct = num(I.closingPct), closing = net * closingPct;
  if (closing) rows.push({ date: lastDate, desc: `Closing fee (${+(closingPct * 100).toFixed(2)}% of net price)`, amount: closing, balance: Math.max(0, net - paid), fee: true });
  if (retention) { cursor++; paid += retention; rows.push({ date: start && addMonths(start, cursor), desc: `Retention / balance (${+(retentionPct * 100).toFixed(2)}%) — bank or in-house financing`, amount: retention, balance: 0 }); }
  return {
    scheme: q.scheme === 'stepup' ? 'stepup' : 'standard', price: p, rf, dpPct, dp, dpNet, dpEach, dpMonths, dpDates, tiers,
    retentionPct, retention, retentionDate: rows.at(-1)?.date, closingPct, closing, closingDate: lastDate,
    total: net + closing, schedule: rows, warnings,
  };
}

export const compute = (q) => (q.scheme === 'lto' ? computeLTO(q) : computeInstallment(q));
