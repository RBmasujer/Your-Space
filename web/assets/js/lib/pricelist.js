// Read a developer price list (spreadsheet / PDF / Word table) into units for the Quotation.
// Pure functions — unit-tested in Node (tests/pricelist.test.mjs).
//
//   parsePriceList(tables, { mapping }) → { units, mapping, headers, sheet, warnings }
//   unit = { id, project, tower, floor, unit, type, area, price, discount, net, dues, deposit, rent, status, label }

const str = (v) => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
const lc = (v) => str(v).toLowerCase();

/** "₱ 4,800,000.00", "PHP 4.8M", 4800000 → 4800000 · "-", "", "SOLD" → null */
export function money(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = lc(v).replace(/php|₱|p(?=\s*\d)|\s|,/g, '');
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s); s = s.replace(/[()]/g, '').replace(/%$/, '');
  const m = /^(-?\d+(?:\.\d+)?)(k|m|mn|million)?$/.exec(s);
  if (!m) return null;
  const n = parseFloat(m[1]) * (m[2] === 'k' ? 1e3 : m[2] ? 1e6 : 1);
  return neg ? -n : n;
}

// Column roles, most specific first. Price columns: "net / TCP" beats "list / selling" beats plain "price".
export const ROLES = [
  ['net', 'Net / total contract price', /\b(net|tcp|total\s*contract|discounted|nettcp|net\s*selling)\b/],
  ['price', 'List / selling price', /\b(list|selling|gross|original|total)?\s*(price|amount|cost|value)\b|\btsp\b|\blp\b/],
  ['discount', 'Discount', /discount|less\b|promo|rebate|markdown/],
  ['dues', 'Condo dues / month', /dues|assoc|association|cusa|maintenance|mgmt\s*fee/],
  ['deposit', 'Security deposit', /deposit|security/],
  ['rent', 'Monthly rent (from list)', /monthly|rent|amorti[sz]ation|\blto\b|per\s*month/],
  ['unit', 'Unit no.', /^(unit|unit\s*(no\.?|#|number|code|id|name)|room|rm\.?\s*no|lot|lot\s*no\.?)$|unit\s*(no|#|number|code)/],
  ['type', 'Unit type', /type|layout|config|bed|^br$|model|classification/],
  ['area', 'Floor area (sqm)', /area|sqm|sq\.?\s*m|size|floor\s*area|square/],
  ['floor', 'Floor', /^(floor|flr|level|storey|fl\.?)$|floor\s*(no|level)/],
  ['tower', 'Tower / building', /tower|bldg|building|phase|block|cluster|wing/],
  ['project', 'Project', /project|development|property|condo(minium)?\s*name/],
  ['status', 'Availability', /status|avail|remarks/],
];
const ROLE_KEYS = ROLES.map(r => r[0]);

function roleOf(header, taken) {
  const t = lc(header).replace(/[#*:]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  for (const [k, , re] of ROLES) if (!taken.has(k) && re.test(t)) {
    if (k === 'price' && /dues|deposit|discount|rent|monthly|per\s*sqm|\/\s*sqm|psm/.test(t)) continue;   // "price per sqm" is not the price
    if (k === 'area' && /price|php|₱|rate/.test(t)) continue;                             // "price per sqm" is not the area
    return k;
  }
  return null;
}

/** Guess a header → role mapping. Handles a two-row header (e.g. "UNIT" over "No." / "Type"). */
function guessMapping(rows) {
  let best = null;
  for (let h = 0; h < Math.min(rows.length, 25); h++) {
    for (const span of [1, 2]) {
      const top = rows[h] || [], bottom = span === 2 ? rows[h + 1] || [] : [];
      if (span === 2 && !bottom.some(c => /[a-z]/i.test(str(c)))) continue;
      let carry = '';
      const width = Math.max(top.length, bottom.length);
      const headers = Array.from({ length: width }, (_, i) => {
        if (str(top[i])) carry = str(top[i]); else if (span === 1) carry = '';
        return [span === 2 ? carry : str(top[i]), span === 2 ? str(bottom[i]) : ''].filter(Boolean).join(' ').trim();
      });
      if (headers.filter(x => /[a-z]/i.test(x)).length < 2) continue;
      const taken = new Set(), map = {};
      headers.forEach((x, i) => { const k = roleOf(x, taken); if (k) { taken.add(k); map[k] = i; } });
      const hasPrice = map.price != null || map.net != null;
      const score = Object.keys(map).length + (hasPrice ? 3 : 0) + (map.unit != null || map.type != null ? 2 : 0);
      if (hasPrice && (!best || score > best.score)) best = { score, head: h, start: h + span, headers, map };
    }
  }
  return best;
}

const label = (u) => [u.project, u.tower, u.unit ? `Unit ${u.unit}` : '', u.type, u.area ? `${u.area} sqm` : ''].filter(Boolean).join(' · ');

/** Title / sheet name as the project when there is no Project column. */
function projectFromTitle(rows, head, sheet) {
  for (const r of rows.slice(0, head)) {
    const t = str((r || []).find(c => /[a-z]{3,}/i.test(str(c))) || '');
    if (!t) continue;
    const name = t.replace(/\b(updated\s*|official\s*)?price\s*list\b.*$/i, '').replace(/\bas\s*of\b.*$/i, '').replace(/[\s\-–—|:,]+$/, '').trim();
    if (name.length >= 3) return name.slice(0, 80);
  }
  return /^(sheet\s*\d+|pdf|table\s*\d+)$/i.test(sheet || '') ? '' : str(sheet);
}

export function parsePriceList(tables, { mapping } = {}) {
  const warnings = [];
  let best = null;
  for (const t of tables) {
    const rows = (t.rows || []).filter(Array.isArray);
    const g = mapping && mapping.sheet === t.name
      ? { head: mapping.head ?? 0, start: mapping.start, headers: mapping.headers, map: mapping.map }
      : mapping ? null : guessMapping(rows);
    if (!g) continue;
    const M = g.map, fallbackProject = projectFromTitle(rows, g.head, t.name);
    const units = [];
    let lastProject = '', lastTower = '';
    for (const r of rows.slice(g.start)) {
      const get = (k) => (M[k] != null ? r[M[k]] : null);
      const firstText = lc(r.find(c => str(c)) || '');
      if (/^(sub\s*)?total|^grand\s*total|^note|^prices?\s*(are|subject)|^terms/.test(firstText)) continue;
      const list = money(get('price')), net = money(get('net'));
      const discRaw = get('discount');
      let discount = money(discRaw);
      if (discount != null && /%/.test(str(discRaw)) && (list ?? net)) discount = (list ?? net) * discount / 100;
      if (discount != null && discount < 0) discount = -discount;
      let price = list ?? net, disc = discount ?? 0;
      if (list != null && net != null && discount == null && list > net) disc = list - net;
      if (list == null && net != null) price = net;            // only a TCP column: a discount column (if any) still applies
      if (!(price > 10000)) continue;                         // not a unit row (blank, header repeat, per-sqm rate)
      const unitNo = str(get('unit')), type = str(get('type'));
      if (!unitNo && !type) continue;
      lastProject = str(get('project')) || lastProject; lastTower = str(get('tower')) || lastTower;
      const status = str(get('status'));
      const area = money(get('area'));
      const u = {
        project: lastProject || fallbackProject, tower: lastTower, floor: str(get('floor')), unit: unitNo, type,
        area: area && area < 10000 ? +area.toFixed(2) : null,
        price: +price.toFixed(2), discount: +disc.toFixed(2), net: +(price - disc).toFixed(2),
        dues: money(get('dues')), deposit: money(get('deposit')), rent: money(get('rent')),
        status: /sold|reserved|taken|unavail|n\/?a|hold/i.test(status) ? status : '',
      };
      u.id = [u.project, u.tower, u.floor, u.unit, u.type, u.price].join('|');
      u.label = label(u);
      units.push(u);
    }
    if (units.length && (!best || units.length > best.units.length)) best = { units, mapping: { sheet: t.name, head: g.head, start: g.start, headers: g.headers, map: M }, headers: g.headers, sheet: t.name };
  }
  if (!best) return { units: [], mapping: null, headers: [], sheet: null, warnings: ['No price column with unit rows was found. Use “Fix columns” to choose them.'] };
  const M = best.mapping.map;
  if (M.unit == null && M.type == null) warnings.push('No unit number or unit type column was found.');
  if (M.dues != null && best.units.every(u => u.dues != null && u.dues < 500)) {
    // "dues per sqm" columns: turn the rate into a monthly amount when the area is known
    best.units.forEach(u => { if (u.area) u.dues = +(u.dues * u.area).toFixed(2); });
    warnings.push('Condo dues looked like a per-sqm rate, so they were multiplied by each unit’s floor area.');
  }
  return { ...best, warnings };
}

export const roleLabels = Object.fromEntries(ROLES.map(([k, l]) => [k, l]));
export { ROLE_KEYS };
