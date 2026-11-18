// Read RLC "computation sheets" (one unit per sheet, label → value layout, like
// Price Calculator.xlsx) into Quotation templates. Pure — unit-tested in Node.
//
//   parseCalcSheets(tables) → { templates: [...], notes: [...] }
//   template = { id, sheet, scheme, project, unit, type, area, parking, price, discounts, lto?, inst?,
//                fileNet, label, warnings }
import { money } from './pricelist.js';
import { computeLTO, computeInstallment, SCHEMES } from './schemes.js';

const str = (v) => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
const isErr = (v) => typeof v === 'string' && /^#(DIV\/0!|REF!|VALUE!|N\/A|NAME\?|NUM!|NULL!)/.test(v.trim());
const numOf = (v) => (typeof v === 'number' ? v : isErr(v) ? null : money(String(v ?? '').replace(/sq\.?\s*m\.?|sqm/gi, '')));

function sheetApi(rows) {
  const find = (re, from = 0) => { for (let r = from; r < rows.length; r++) if ((rows[r] || []).some(c => typeof c === 'string' && re.test(str(c)))) return r; return -1; };
  const findAll = (re) => rows.map((row, r) => ((row || []).some(c => typeof c === 'string' && re.test(str(c))) ? r : -1)).filter(r => r >= 0);
  const labelCol = (r, re) => (rows[r] || []).findIndex(c => typeof c === 'string' && re.test(str(c)));
  /** First non-empty cell to the right of the label. */
  const valueAfter = (re) => { const r = find(re); if (r < 0) return ''; const row = rows[r]; for (let c = labelCol(r, re) + 1; c < row.length; c++) if (str(row[c])) return row[c]; return ''; };
  const nums = (r) => (r < 0 ? [] : (rows[r] || []).map(numOf).filter(n => n != null));
  const rate = (r) => { const n = nums(r).find(x => x > 0 && x < 1); if (n != null) return n; const m = /(\d+(?:\.\d+)?)\s*%/.exec((rows[r] || []).map(str).join(' ')); return m ? +m[1] / 100 : 0; };
  const count = (r) => nums(r).find(x => Number.isInteger(x) && x >= 1 && x <= 600) ?? 0;
  return { find, findAll, valueAfter, nums, rate, count, text: rows.flat().map(str).join(' \n ') };
}

const codeFromSheet = (name) => str(name).replace(/^(special\s*)?step-?up\s*/i, '').replace(/^(lto\s*120[_\s]*|with\s*formula[_\s]*|orig(inal)?\s*template)/i, '').replace(/_?complete$/i, '').trim();

function parseSheet(name, rows) {
  const S = sheetApi(rows), warnings = [];
  const text = S.text;
  const errs = rows.flat().filter(isErr);
  if (errs.length) warnings.push(`The sheet shows ${[...new Set(errs)].join(', ')} — that part was skipped.`);

  // ── Scheme ──
  let scheme = null;
  if (/down\s*payment|downpayment/i.test(text)) scheme = /step-?up/i.test(text) ? 'stepup' : 'standard';
  else if (S.find(/lease term|^no\.? of ma'?s/i) >= 0 && /lease|lto|ma's|deposit/i.test(text)) scheme = 'lto';
  if (!scheme) return null;

  // ── Unit ──
  const placeholder = (v) => /^\(.*\)$/.test(str(v)) ? '' : str(v);
  const code = codeFromSheet(name);
  let project = placeholder(S.valueAfter(/^project name:?$/i));
  if (!project) {
    const title = rows.slice(0, 4).map(r => str((r || []).find(c => typeof c === 'string' && /[a-z]{3,}/i.test(c))))
      .find(t => t && t.length >= 6 && !/:$/.test(t) && !/sample computation|price list|^\(/i.test(t));
    project = code || title || '';
  }
  if (code && project && !project.toUpperCase().includes(code.toUpperCase()) && /^[A-Z0-9, ]{3,}$/i.test(code) && !/^LTO120$/i.test(code)) warnings.push(`Sheet “${name}” says the project is “${project}” — check which project it is for.`);
  const unit = str(S.valueAfter(/^(floor\s*\/\s*)?unit number:?$|^unit no\.?:?$/i));
  const type = str(S.valueAfter(/^unit type:?$/i));
  const area = numOf(S.valueAfter(/^(total\s*)?area(\s*\(sqm\))?\s*(sqm)?:?$/i)) || null;
  const parking = numOf(S.valueAfter(/^parking price:?$/i)) || 0;
  if (!unit) warnings.push('No unit number in this sheet — type it in the quotation.');

  // ── Price + discounts ──
  // first price row that actually holds an amount (skips headings like "TOTAL CONTRACT PRICE (TCP) COMPUTATION")
  const priceRow = S.findAll(/^(gross total contract price|total contract price|price)\b/i).find(r => S.nums(r).some(n => n >= 100000)) ?? -1;
  let price = S.nums(priceRow).find(n => n >= 100000) ?? null;
  if (price == null) price = numOf(S.valueAfter(/^unit price:?$/i));
  if (!(price > 0)) return null;
  const DISC = { payment: /payment scheme disc/i, event: /event disc/i, loyalty: /loyalty disc/i, special: /special.*disc/i, other: /^(less:?\s*)?other disc/i, employee: /employee disc/i };
  const discounts = {};
  for (const [k, re] of Object.entries(DISC)) { const r = S.find(re); if (r >= 0) { const v = S.rate(r); if (v) discounts[k] = v; } }
  const netRows = S.findAll(/^net (total contract price|tcp)( price)?( 2)?\s*(\(ntcp\))?$/i);
  const netRow = netRows.filter(r => S.nums(r).some(n => n >= 100000)).at(-1);
  const fileNet = netRow != null ? S.nums(netRow).filter(n => n >= 100000).at(-1) : null;
  const grossRow = S.find(/^gross total contract price/i);
  const fileGross = grossRow >= 0 ? S.nums(grossRow).filter(n => n >= 100000).at(-1) : null;
  if (parking && fileGross != null && Math.abs(fileGross - (price + parking)) > 1) warnings.push(`The sheet's gross price (₱${fileGross.toLocaleString('en-PH')}) leaves out the ₱${parking.toLocaleString('en-PH')} parking — it is added here.`);

  const t = { id: name, sheet: name, scheme, project, unit, type, area, parking, price, discounts, fileNet, warnings };

  // ── Scheme details ──
  if (scheme === 'lto') {
    const termRow = S.find(/lease term/i) >= 0 ? S.find(/lease term/i) : S.find(/^no\.? of ma'?s/i);
    const lto = { term: S.count(termRow) || 120 };
    const initial = rows[S.find(/initial payment/i)]?.map(str).join(' ') || '';
    const advRow = S.find(/month\s*advance\s*deposit|advance deposit/i), secRow = S.find(/security deposit/i);
    const monthsIn = (r, re) => { const m = re.exec((rows[r] || []).map(str).join(' ')); return m ? +m[1] : null; };
    lto.advance = (advRow >= 0 ? monthsIn(advRow, /(\d+)\s*months?\s*advance/i) : null) ?? (+(/(\d+)\s*months?\s*advance/i.exec(initial) || [])[1] || 1);
    lto.security = (secRow >= 0 ? monthsIn(secRow, /(\d+)\s*months?\s*security/i) : null) ?? (+(/(\d+)\s*months?\s*deposit/i.exec(initial) || [])[1] || 2);
    const cf = S.find(/closing fee/i); lto.closingPct = cf >= 0 ? S.rate(cf) || 0.06 : 0.06;
    const dr = S.find(/dues rate|association dues.*per\s*sqm/i);
    // that row also holds the area ("24.00 SQM") and the monthly amount — the rate is the smallest other number
    lto.duesRate = dr >= 0 ? Math.min(...S.nums(dr).filter(n => n > 1 && !(area && Math.abs(n - area) < 0.01))) : 0;
    if (!Number.isFinite(lto.duesRate)) lto.duesRate = 0;
    const da = S.find(/advance association dues/i);
    lto.duesAdvance = da >= 0 ? (monthsIn(da, /(\d+)\s*months?/i) ?? S.count(da)) : 3;
    // skip section headings like "ASSOCIATION DUES & DOCUMENTARY STAMP TAX (…)" — take the first row with a rate
    lto.dstPct = S.findAll(/documentary stamp|\bdst\b/i).map(S.rate).find(x => x > 0) || 0;
    if (!lto.duesRate) warnings.push('No association dues in this sheet — add the rate per sqm if the project charges them.');
    if (!lto.dstPct) warnings.push('No documentary stamp tax (DST) in this sheet.');
    t.lto = lto;
  } else {
    const inst = { rf: 0, dpPct: 0, dpMonths: 1, tiers: [], closingPct: 0.06 };
    const rfRow = S.find(/reservation fee/i); inst.rf = S.nums(rfRow).find(n => n >= 1000) ?? 0;
    const dpRow = S.find(/^down\s*payment|^downpayment/i); inst.dpPct = S.rate(dpRow);
    inst.dpMonths = S.count(S.find(/^no\.? of dps?/i)) || 1;
    for (const r of S.findAll(/^monthly installment/i)) {
      const pct = S.rate(r), nRow = S.find(/^no\.? of ma'?s/i, r + 1), months = S.count(nRow);
      if (pct > 0 && months > 0) inst.tiers.push({ pct, months });
      else if (pct > 0 || months > 0 || S.nums(r).length) warnings.push(`A monthly installment row with ${(pct * 100).toFixed(2)}% over ${months} month(s) was skipped.`);
    }
    const cf = S.find(/closing fee/i); if (cf >= 0) inst.closingPct = S.rate(cf) || 0.06;
    if (scheme === 'stepup' && inst.tiers.length < 2) scheme = t.scheme = 'standard';
    t.inst = inst;
    const retRow = S.find(/^retention/i), fileRet = retRow >= 0 ? S.rate(retRow) : null;
    const paid = inst.dpPct + inst.tiers.reduce((a, x) => a + x.pct, 0);
    if (fileRet != null && fileRet > 0 && Math.abs(1 - paid - fileRet) > 0.0001) warnings.push(`The sheet's retention (${(fileRet * 100).toFixed(2)}%) doesn't match down payment + installments (${(paid * 100).toFixed(2)}%).`);
  }

  // Compare our net price with the sheet's (catches a discount applied twice or one left out).
  const ours = (scheme === 'lto' ? computeLTO(t) : computeInstallment(t)).price.net;
  if (fileNet != null && Math.abs(fileNet - ours) > 1) {
    warnings.push(`The sheet's net price is ₱${fileNet.toLocaleString('en-PH', { maximumFractionDigits: 2 })}, but the unit price less its discounts${parking ? ' plus parking' : ''} is ₱${ours.toLocaleString('en-PH', { maximumFractionDigits: 2 })}. The sheet likely applies a discount twice or skips one — ₱${ours.toLocaleString('en-PH', { maximumFractionDigits: 2 })} is used.`);
  }
  t.label = [t.project || name, t.unit, t.type, t.area ? `${t.area} sqm` : '', SCHEMES[t.scheme]].filter(Boolean).join(' · ');
  return t;
}

export function parseCalcSheets(tables) {
  const templates = [], notes = [];
  for (const tb of tables || []) {
    const rows = (tb.rows || []).filter(Array.isArray);
    if (!rows.length) continue;
    let t = null;
    try { t = parseSheet(tb.name, rows); } catch (e) { notes.push(`${tb.name}: could not be read (${e.message}).`); continue; }
    if (t) templates.push(t);
    else if (rows.some(r => (r || []).some(c => /month\s*#|payment schedule|cash outflow/i.test(str(c))))) notes.push(`“${tb.name}” is a payment schedule — Your Space builds this itself from the quotation.`);
  }
  return { templates, notes };
}
