// Pure metrics extraction — no I/O, so it can be unit-tested in Node and run in Deno.
// Input: [{ name, rows: any[][] }]  (rows = sheet_to_json(ws, { header: 1, raw: true }))

const MAX_COLS = 40;
const MAX_CATS = 12;

function isBlank(v) { return v == null || (typeof v === 'string' && v.trim() === ''); }

/** Parse "₱1,234.50", "1 234", "12%" → number; phone-like strings (leading 0, 10+ digits) are NOT numbers. */
export function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || /^0\d/.test(s) || /^\+/.test(s)) return null;
  const c = s.replace(/[₱$,\s]/g, '').replace(/^PHP/i, '');
  if (!/^-?\d+(\.\d+)?%?$/.test(c)) return null;
  const digits = c.replace(/\D/g, '');
  if (digits.length >= 10 && !c.includes('.')) return null; // phone / ID numbers
  return c.endsWith('%') ? parseFloat(c) / 100 : parseFloat(c);
}

/** Header = first of the top 15 rows with ≥2 text cells and mostly text (skips title rows). */
export function findHeader(rows) {
  let best = -1, bestScore = 0;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const r = rows[i] || [];
    const filled = r.filter(v => !isBlank(v));
    const text = filled.filter(v => typeof v === 'string' && toNumber(v) == null);
    if (filled.length >= 2 && text.length / filled.length >= 0.7 && text.length > bestScore) { best = i; bestScore = text.length; }
    if (bestScore >= 3 && best >= 0 && i > best) break;
  }
  return best;
}

export function sheetMetrics(name, rows) {
  const h = findHeader(rows);
  const header = h >= 0 ? rows[h] : [];
  const data = rows.slice(h + 1).filter(r => r && r.some(v => !isBlank(v)));
  const width = Math.min(MAX_COLS, Math.max(header.length, ...data.slice(0, 200).map(r => r.length), 0));
  const columns = [];
  for (let c = 0; c < width; c++) {
    const label = isBlank(header[c]) ? `Column ${c + 1}` : String(header[c]).trim().slice(0, 80);
    const vals = data.map(r => r[c]).filter(v => !isBlank(v));
    if (!vals.length) continue;
    const col = { name: label, filled: vals.length, fill_rate: +(vals.length / (data.length || 1)).toFixed(3) };
    const nums = vals.map(toNumber).filter(v => v != null);
    if (nums.length >= Math.max(1, vals.length * 0.6)) {
      let sum = 0, min = Infinity, max = -Infinity;
      for (const n of nums) { sum += n; if (n < min) min = n; if (n > max) max = n; }
      col.numeric = { count: nums.length, sum: +sum.toFixed(2), avg: +(sum / nums.length).toFixed(2), min, max };
    } else {
      const counts = new Map();
      for (const v of vals) { const k = String(v).trim().slice(0, 60); counts.set(k, (counts.get(k) || 0) + 1); }
      col.distinct = counts.size;
      if (counts.size <= MAX_CATS && vals.length >= 3 && counts.size < vals.length) col.categories = [...counts].sort((a, b) => b[1] - a[1]);
    }
    columns.push(col);
  }
  return { name, header_row: h + 1, rows: data.length, columns };
}

export function computeMetrics(sheets) {
  const out = { generated_at: new Date().toISOString(), sheet_count: sheets.length, total_rows: 0, sheets: [] };
  for (const s of sheets.slice(0, 15)) {
    const m = sheetMetrics(s.name, s.rows);
    out.total_rows += m.rows;
    out.sheets.push(m);
  }
  return out;
}

/** One-paragraph human summary for the files list. */
export function summarize(m) {
  const parts = [];
  for (const s of m.sheets.filter(x => x.rows > 0).slice(0, 4)) {
    const bits = [`${s.name}: ${s.rows.toLocaleString('en-PH')} rows`];
    const money = s.columns.filter(c => c.numeric && !/%|percent|rate/i.test(c.name) && /price|amount|php|₱|sales|total|cost|value/i.test(c.name)).slice(0, 2);
    for (const c of money) bits.push(`${c.name} total ${c.numeric.sum.toLocaleString('en-PH')}`);
    const cat = s.columns.filter(c => c.categories && /status|stage|class|type|platform/i.test(c.name)).slice(0, 2);
    for (const c of cat) bits.push(`${c.name}: ${c.categories.slice(0, 4).map(([k, n]) => `${k} ${n}`).join(', ')}`);
    parts.push(bits.join(' · '));
  }
  return parts.join(' | ').slice(0, 1000) || 'No data rows found.';
}
