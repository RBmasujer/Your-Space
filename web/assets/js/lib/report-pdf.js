// Progress report → PDF. Pure layout code: takes plain data, returns a PDF object.
// (Kept free of database/DOM calls so it can be unit-tested in Node.)
import { PDF } from './pdf.js';
import { fmtDate, addDays } from './util.js';

const C = { navy: '#1b6fb5', blue: '#2f9be8', red: '#e5383b', ok: '#1a8a5f', tx: '#17324d', mu: '#5f7a94', bd: '#d6e6f4', zebra: '#eef5fc', white: '#ffffff' };
const M = 40;                    // page margin
const nf2 = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 0 });
export const php = (n) => `PHP ${nf2.format(+n || 0)}`;
export const phpWhole = (n) => `PHP ${nf0.format(Math.round(+n || 0))}`;
export function phpShort(n) {
  const v = +n || 0, a = Math.abs(v);
  if (a >= 1e9) return `PHP ${(v / 1e9).toFixed(2).replace(/\.?0+$/, '')}B`;
  if (a >= 1e6) return `PHP ${(v / 1e6).toFixed(2).replace(/\.?0+$/, '')}M`;
  if (a >= 1e3) return `PHP ${(v / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return `PHP ${nf0.format(v)}`;
}
const monthKey = (d) => String(d).slice(0, 7);
const monthName = (k) => new Date(`${k}-01T00:00:00Z`).toLocaleString('en-PH', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Calendar months touched by [from, to] as 'YYYY-MM' (max 36). */
export function monthsBetween(from, to) {
  const out = [];
  const d = new Date(`${monthKey(from)}-01T00:00:00Z`), end = monthKey(to);
  while (out.length < 36) { const k = d.toISOString().slice(0, 7); if (k > end) break; out.push(k); d.setUTCMonth(d.getUTCMonth() + 1); }
  return out;
}

/** All the numbers the report shows (exported for tests). */
export function summarize({ closed, ratePct, from, to }) {
  const rate = ratePct == null || ratePct === '' || !(+ratePct >= 0) ? null : +ratePct;
  const earn = (p) => (rate == null ? null : (+p || 0) * rate / 100);
  const totalSales = closed.reduce((a, l) => a + (+l.contract_price || 0), 0);
  const months = monthsBetween(from, to).map(k => {
    const rows = closed.filter(l => monthKey(l.closed_at) === k);
    const sales = rows.reduce((a, l) => a + (+l.contract_price || 0), 0);
    return { key: k, label: monthName(k), deals: rows.length, sales, earnings: earn(sales) };
  });
  let run = 0; months.forEach(m => { run += m.sales; m.cumulative = run; });
  return { rate, totalSales, deals: closed.length, earnings: earn(totalSales), avgDeal: closed.length ? totalSales / closed.length : 0, months, earn };
}

/**
 * data: { owner, role, from, to, periodLabel, generatedAt, ratePct, includeNames,
 *         closed: [{ closed_at, full_name, project, unit, contract_price }],
 *         reserved: { count, sum }, newLeads, stages: [{ status, leads }], quota }
 */
export function buildProgressReport(data) {
  const s = summarize(data);
  const pdf = new PDF({ title: `Progress report ${data.from} to ${data.to}`, author: data.owner });
  const W = pdf.W, H = pdf.H, CW = W - 2 * M, BOTTOM = H - 54;
  let y = 0;

  const header = (first) => {
    if (first) {
      pdf.rect(0, 0, W, 82, { fill: C.navy });
      pdf.rect(0, 82, W, 4, { fill: C.red });
      pdf.text('Progress Report', M, 40, { size: 22, bold: true, color: C.white });
      pdf.text(`${data.owner} · ${data.role}`, M, 60, { size: 10, color: C.white, maxWidth: CW - 170 });
      pdf.text('Your Space', W - M, 40, { size: 13, bold: true, color: C.white, align: 'right' });
      pdf.text(`Generated ${data.generatedAt}`, W - M, 60, { size: 8.5, color: C.white, align: 'right' });
      y = 112;
    } else {
      pdf.text(`Progress report · ${fmtDate(data.from)} – ${fmtDate(data.to)} (continued)`, M, 34, { size: 9, color: C.mu });
      pdf.line(M, 42, W - M, 42, { color: C.bd });
      y = 62;
    }
  };
  const ensure = (h) => { if (y + h > BOTTOM) { pdf.addPage(); header(false); return true; } return false; };
  const section = (title, need = 60) => {
    ensure(need + 26);
    pdf.text(title, M, y, { size: 13, bold: true, color: C.tx });
    pdf.line(M, y + 6, W - M, y + 6, { color: C.bd, width: 1 });
    y += 22;
  };

  /** Table with repeated header row on page breaks. cols: [{ label, w, align, get, bold }] */
  const table = (cols, rows, { totals } = {}) => {
    const RH = 18, size = 8.8;
    const head = () => {
      pdf.rect(M, y, CW, RH, { fill: C.navy });
      let x = M;
      for (const c of cols) { pdf.text(c.label, c.align === 'right' ? x + c.w - 6 : x + 6, y + 12.2, { size: 8.5, bold: true, color: C.white, align: c.align === 'right' ? 'right' : 'left', maxWidth: c.w - 10 }); x += c.w; }
      y += RH;
    };
    ensure(RH * 2); head();
    rows.forEach((r, i) => {
      if (ensure(RH)) head();
      if (i % 2 === 0) pdf.rect(M, y, CW, RH, { fill: C.zebra });
      let x = M;
      for (const c of cols) { pdf.text(c.get(r, i), c.align === 'right' ? x + c.w - 6 : x + 6, y + 12.2, { size, color: C.tx, align: c.align === 'right' ? 'right' : 'left', maxWidth: c.w - 10, bold: !!c.bold }); x += c.w; }
      y += RH;
    });
    if (totals) {
      if (ensure(RH + 2)) head();
      pdf.line(M, y, W - M, y, { color: C.tx, width: 1 });
      let x = M;
      for (const c of cols) { const v = totals[c.key] ?? ''; if (v !== '') pdf.text(v, c.align === 'right' ? x + c.w - 6 : x + 6, y + 12.6, { size: 9, bold: true, color: C.tx, align: c.align === 'right' ? 'right' : 'left', maxWidth: c.w - 10 }); x += c.w; }
      y += RH + 2;
    }
    y += 22;
  };

  // ── Page 1: period + KPI cards ────────────────────────────────────────────
  header(true);
  pdf.text(`Report period: ${fmtDate(data.from)} – ${fmtDate(data.to)}`, M, y, { size: 11.5, bold: true, color: C.tx });
  pdf.text(data.periodLabel || '', W - M, y, { size: 9, color: C.mu, align: 'right' });
  y += 16;

  const cards = [
    ['TOTAL SALES', phpWhole(s.totalSales), 'Closed deals in this period', C.navy],
    ['COMPLETED LEADS', String(s.deals), s.deals === 1 ? 'deal closed' : 'deals closed', C.blue],
    ['TOTAL EARNINGS', s.earnings == null ? 'Not set' : phpWhole(s.earnings), s.rate == null ? 'Set a commission rate' : `Commission at ${s.rate}%`, C.ok],
    ['AVERAGE DEAL', phpWhole(s.avgDeal), 'Contract price per deal', C.red],
  ];
  const gap = 10, cw = (CW - gap * 3) / 4, ch = 66;
  cards.forEach(([label, value, sub, color], i) => {
    const x = M + i * (cw + gap);
    pdf.rect(x, y, cw, ch, { fill: C.zebra });
    pdf.rect(x, y, 4, ch, { fill: color });
    pdf.text(label, x + 12, y + 17, { size: 7.5, bold: true, color: C.mu, maxWidth: cw - 16 });
    pdf.text(value, x + 12, y + 38, { size: 13, bold: true, color: C.tx, maxWidth: cw - 16 });
    pdf.text(sub, x + 12, y + 54, { size: 7.5, color: C.mu, maxWidth: cw - 16 });
  });
  y += ch + 26;

  // ── Contract quota progress (from the database view) ──────────────────────
  const q = data.quota;
  if (q && +q.quota_php > 0) {
    section('Contract quota progress', 70);
    const sales = +q.sales_php || 0, quota = +q.quota_php, goal = +q.goal_php || quota;
    const max = Math.max(goal, sales) * 1.04 || 1, X = (v) => M + Math.min(1, v / max) * CW;
    pdf.text(`${fmtDate(q.period_start)} – ${fmtDate(q.period_end)}`, M, y, { size: 9, color: C.mu });
    y += 18;
    pdf.rect(M, y, CW, 16, { fill: C.zebra });
    pdf.rect(M, y, Math.max(2, X(sales) - M), 16, { fill: sales >= goal ? C.ok : C.navy });
    pdf.line(X(quota), y - 5, X(quota), y + 21, { color: C.tx, width: 1.5 });
    pdf.line(X(goal), y - 5, X(goal), y + 21, { color: C.red, width: 2 });
    pdf.text(`Quota ${phpShort(quota)}`, X(quota), y + 32, { size: 8, color: C.tx, align: X(quota) > W - 120 ? 'right' : 'center' });
    pdf.text(`Goal ${+q.goal_pct}% · ${phpShort(goal)}`, X(goal), y - 9, { size: 8, bold: true, color: C.red, align: X(goal) > W - 120 ? 'right' : 'center' });
    y += 48;
    const rows = [
      ['Closed sales (contract period)', phpWhole(sales)],
      ['Progress', `${(+q.pct_of_quota || 0).toFixed(1)}% of quota · ${(+q.pct_of_goal || 0).toFixed(1)}% of goal`],
      ['Still needed', `${phpWhole(q.remaining_quota_php)} to quota · ${phpWhole(q.remaining_goal_php)} to goal`],
      ['Days left in contract period', String(q.days_left ?? '')],
    ];
    rows.forEach(([k, v]) => { pdf.text(k, M, y, { size: 9.5, color: C.mu }); pdf.text(v, W - M, y, { size: 9.5, bold: true, color: C.tx, align: 'right' }); y += 15; });
    y += 12;
  }

  // ── Sales by month: chart + table ─────────────────────────────────────────
  section('Sales by month', 170);
  const ms = s.months;
  if (ms.length && ms.length <= 18) {
    const chH = 120, top = y + 8, base = top + chH, peak = Math.max(...ms.map(m => m.sales), 1);
    const slot = CW / ms.length, bw = Math.min(42, slot * 0.6);
    pdf.line(M, base, W - M, base, { color: C.mu });
    ms.forEach((m, i) => {
      const cx = M + slot * i + slot / 2, h = (m.sales / peak) * (chH - 16);
      if (m.sales > 0) {
        pdf.rect(cx - bw / 2, base - h, bw, h, { fill: C.navy });
        pdf.text(phpShort(m.sales), cx, base - h - 4, { size: 7, bold: true, color: C.tx, align: 'center' });
      }
      pdf.text(m.label.replace(/ \d{2}(\d{2})$/, " '$1"), cx, base + 12, { size: 7.5, color: C.mu, align: 'center', maxWidth: slot - 2 });
    });
    y = base + 28;
  }
  table([
    { label: 'Month', w: 120, get: m => m.label, key: 'label' },
    { label: 'Deals', w: 60, align: 'right', get: m => String(m.deals), key: 'deals' },
    { label: 'Sales', w: 115, align: 'right', get: m => php(m.sales), key: 'sales' },
    { label: s.rate == null ? 'Earnings' : `Earnings (${s.rate}%)`, w: 105, align: 'right', get: m => (m.earnings == null ? '—' : php(m.earnings)), key: 'earnings' },
    { label: 'Cumulative sales', w: CW - 400, align: 'right', get: m => php(m.cumulative) },
  ], ms, { totals: { label: 'Total', deals: String(s.deals), sales: php(s.totalSales), earnings: s.earnings == null ? '—' : php(s.earnings) } });

  // ── Completed leads (closed deals) ────────────────────────────────────────
  section(`Completed leads · ${s.deals} closed deal${s.deals === 1 ? '' : 's'}`, 60);
  if (!data.closed.length) {
    pdf.text('No deals were closed in this period.', M, y + 4, { size: 10, color: C.mu }); y += 26;
  } else {
    const named = data.includeNames !== false;
    const cols = [
      { label: '#', w: 22, align: 'right', get: (l, i) => String(i + 1) },
      { label: 'Date closed', w: 70, get: l => fmtDate(l.closed_at), key: 'date' },
      ...(named ? [{ label: 'Client', w: 112, get: l => l.full_name || '' }] : []),
      { label: 'Project / unit', w: named ? 135 : 247, get: l => [l.project, l.unit].filter(Boolean).join(' · ') || '—' },
      { label: 'Contract price', w: 92, align: 'right', get: l => php(l.contract_price), key: 'price' },
      { label: 'Earnings', w: 84, align: 'right', get: l => { const e = s.earn(l.contract_price); return e == null ? '—' : php(e); }, key: 'earnings' },
    ];
    table(cols, data.closed, { totals: { date: 'Total', price: php(s.totalSales), earnings: s.earnings == null ? '—' : php(s.earnings) } });
  }

  // ── Pipeline snapshot ─────────────────────────────────────────────────────
  section('Pipeline snapshot', 90);
  const facts = [
    ['New leads added in this period', String(data.newLeads ?? 0)],
    ['Reserved (not yet counted as sales)', `${data.reserved?.count ?? 0} · ${phpWhole(data.reserved?.sum)}`],
    ...((data.stages || []).filter(x => +x.leads > 0).map(x => [`Leads at stage "${x.status}" (today)`, String(x.leads)])),
  ];
  facts.forEach(([k, v]) => { ensure(15); pdf.text(k, M, y, { size: 9.5, color: C.mu }); pdf.text(v, W - M, y, { size: 9.5, bold: true, color: C.tx, align: 'right' }); y += 15; });
  y += 10;

  // ── Notes ─────────────────────────────────────────────────────────────────
  const notes = [
    'Sales = contract price of leads with Stage "Closed" and a closed date inside the report period. Reserved and cancelled deals are not counted.',
    s.rate == null
      ? 'Earnings are not shown because no commission rate was entered.'
      : `Earnings are estimated as contract price × ${s.rate}% commission. Actual commission, taxes and release dates follow RLC's commission schedule.`,
  ];
  for (const n of notes) for (const ln of pdf.wrap(n, 8, false, CW)) { ensure(12); pdf.text(ln, M, y, { size: 8, color: C.mu }); y += 11; }

  // ── Footer on every page ──────────────────────────────────────────────────
  const total = pdf.pageCount;
  for (let i = 0; i < total; i++) {
    pdf.setPage(i);
    pdf.line(M, H - 36, W - M, H - 36, { color: C.bd });
    pdf.text(`Your Space · ${data.owner} · Confidential${data.includeNames !== false ? ' — contains client information' : ''}`, M, H - 22, { size: 7.5, color: C.mu, maxWidth: CW - 80 });
    pdf.text(`Page ${i + 1} of ${total}`, W - M, H - 22, { size: 7.5, color: C.mu, align: 'right' });
  }
  return pdf;
}

/** Inclusive Manila-date range → [startISO, endExclusiveISO) for timestamp columns. */
export const dayRange = (from, to) => [`${from}T00:00:00+08:00`, `${addDays(to, 1)}T00:00:00+08:00`];
