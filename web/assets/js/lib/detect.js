// Recognise what an uploaded file contains and turn it into records for the app.
// Pure functions (no database, no DOM) so everything here is unit-tested.
//
//   analyze({ tables, text, fileName, ownerName, today })
//     tables: [{ name, rows: [[cell, …], …] }]   (spreadsheet sheets, Word tables, PDF lines)
//     → { kind: 'schedule'|'leads'|'posts'|null, records, overview, summary, warnings }

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const WEEKDAY_RE = /^(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?$/i;
const OFF_RE = /^(off|rd|r\.d\.|rest\s*day|day\s*off|leave|vl|sl|on\s*leave|holiday|absent|none|n\/a|na|-+|x|—|–)$/i;
const pad = (n) => String(n).padStart(2, '0');
const ymdOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const validYmd = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };
const monthNum = (s) => MONTHS.indexOf(String(s).slice(0, 3).toLowerCase()) + 1;
const str = (v) => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
const lc = (v) => str(v).toLowerCase();

// ── Context: which month/year is this file about? ──────────────────────────
export function findMonthYear(text) {
  const s = String(text || '');
  let m = new RegExp(`\\b${MONTH_RE}\\.?[\\s,'-]*(20\\d{2})\\b`, 'i').exec(s);
  if (m) return { month: monthNum(m[1]), year: +m[2] };
  m = /(?<!\d)(20\d{2})[-/._](0?[1-9]|1[0-2])(?!\d)(?![-/.]\d)/.exec(s);
  if (m) return { month: +m[2], year: +m[1] };
  m = /\b(0?[1-9]|1[0-2])[-/._](20\d{2})\b/.exec(s);
  if (m) return { month: +m[1], year: +m[2] };
  m = new RegExp(`\\b${MONTH_RE}\\b`, 'i').exec(s);
  if (m) return { month: monthNum(m[1]), year: null };
  return null;
}

/** Year for a date written without one: the file's year, else the nearest sensible year. */
function guessYear(month, day, ctx) {
  if (ctx?.year) return ctx.year;
  const [ty, tm] = ctx.today.split('-').map(Number);
  if (month < tm - 6) return ty + 1;           // e.g. "Jan 5" seen in November → next January
  if (month > tm + 6) return ty - 1;
  return ty;
}

// ── Dates ──────────────────────────────────────────────────────────────────
/** Excel serial date → 'YYYY-MM-DD' (+ time when there is a fraction). */
function fromSerial(n) {
  const ms = Math.round((n - 25569) * 86400000);
  const d = new Date(ms);
  const frac = n - Math.floor(n);
  return { date: d.toISOString().slice(0, 10), time: frac > 1e-6 ? `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : null };
}

/**
 * Parse a date at the START of a value. Returns { date, rest, time? } or null.
 * Handles Excel serials, 2026-12-01, 12/1/2026, 1/12 (d/m if >12), Dec 1 2026, 1 December, "Mon, Dec 1".
 */
export function parseDate(v, ctx) {
  if (v instanceof Date && !isNaN(v)) return { date: v.toISOString().slice(0, 10), rest: '' };
  if (typeof v === 'number') return v > 20000 && v < 80000 ? { ...fromSerial(v), rest: '' } : null;
  let s = str(v).replace(/^(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?,?\s+(?=\S)/i, '').replace(/^\(\s*\w+\s*\)\s*/, '');
  if (!s) return null;
  let m;
  const done = (y, mo, d, len) => {
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
    y = y == null ? guessYear(mo, d, ctx) : (y < 100 ? 2000 + y : y);
    if (!validYmd(y, mo, d)) return null;
    let rest = s.slice(len).replace(/^\s*(\((sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?\)|,?\s*(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?\b)/i, '');
    return { date: ymdOf(y, mo, d), rest: rest.replace(/^[\s,:;|–—-]+/, '').trim() };
  };
  if ((m = /^(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s]\d|\b)/.exec(s))) return done(+m[1], +m[2], +m[3], m[0].replace(/[T\s]\d$/, '').length);
  if ((m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?(?![\d:])/.exec(s))) {
    let a = +m[1], b = +m[2];
    const [mo, d] = a > 12 && b <= 12 ? [b, a] : [a, b];          // PH uses month/day; 25/12 must be day/month
    return done(m[3] ? +m[3] : null, mo, d, m[0].length);
  }
  if ((m = new RegExp(`^${MONTH_RE}\\.?[\\s-]*(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s*(20\\d{2}|'\\d{2}))?`, 'i').exec(s))) {
    return done(m[3] ? +m[3].replace("'", '') : null, monthNum(m[1]), +m[2], m[0].length);
  }
  if ((m = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?[\\s-]*(?:of\\s+)?${MONTH_RE}\\.?(?:,?\\s*(20\\d{2}))?\\b`, 'i').exec(s))) {
    return done(m[3] ? +m[3] : null, monthNum(m[2]), +m[1], m[0].length);
  }
  return null;
}

// ── Times ──────────────────────────────────────────────────────────────────
const MER = '(a\\.?m\\.?|p\\.?m\\.?|a|p)?';
const to24 = (h, min, mer) => {
  h = +h; min = +(min || 0);
  if (mer) { const pm = /^p/i.test(mer); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
  return h <= 23 && min <= 59 ? `${pad(h)}:${pad(min)}` : null;
};
/** Find a time or time range anywhere in a value. → { start, end, rest } (rest = text without the time). */
export function parseTimes(v) {
  if (typeof v === 'number' && v > 0 && v < 1) { const mins = Math.round(v * 1440); return { start: `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`, end: null, rest: '' }; }
  const s = str(v);
  let m = new RegExp(`(\\d{1,2})(?:[:.](\\d{2}))?\\s*${MER}\\s*(?:-|–|—|to|until|till)\\s*(\\d{1,2})(?:[:.](\\d{2}))?\\s*${MER}(?![\\w])`, 'i').exec(s);
  if (m && (m[2] || m[3] || m[5] || m[6])) {
    let [, h1, n1, a1, h2, n2, a2] = m;
    if (!a1 && a2) { const p2 = /^p/i.test(a2); a1 = (+h1 % 12) > (+h2 % 12) && p2 ? 'am' : a2; }
    if (!a1 && !a2 && +h1 <= 12 && +h2 <= 12 && +h2 < +h1) { a1 = 'am'; a2 = 'pm'; }   // "10:00-7:00" = 10 AM to 7 PM
    const start = to24(h1, n1, a1), end = to24(h2, n2, a2);
    if (start) return { start, end, rest: (s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim() };
  }
  m = new RegExp(`(?<![\\d/.-])(\\d{1,2})(?:[:.](\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?)(?![\\w])`, 'i').exec(s) || /(?<![\d/.-])([01]?\d|2[0-3]):([0-5]\d)(?![\d/])/.exec(s);
  if (m) { const start = to24(m[1], m[2], m[3]); if (start) return { start, end: null, rest: (s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim() }; }
  return { start: null, end: null, rest: s };
}

// ── Schedule kind from text ─────────────────────────────────────────────────
export function eventKind(text, fallback = 'Manning') {
  const t = lc(text);
  if (/trip|site\s*visit|viewing|unit\s*tour|tour\b|showing/.test(t)) return 'Tripping';
  if (/train|seminar|orientation|workshop|briefing|webinar|course/.test(t)) return 'Training';
  if (/\bsync\b|meeting|huddle|\bcall\b|conference|1[\s-]?on[\s-]?1|coaching/.test(t)) return 'Sync';
  if (/manning|duty|booth|mall|showroom|kiosk|\bstand\b|roadshow|open\s*house|on\s*site|office|shift|post\b/.test(t)) return 'Manning';
  return fallback;
}

// ── Header roles ───────────────────────────────────────────────────────────
const ROLE = {
  date: /^(date|day|dates|sched(ule)?(\s*date)?|when|duty\s*date|date\s*of\s*\w+)$|(^|\s)date(\s|$)/,
  start: /^(start|from|time\s*in|in|start\s*time|begin)$/,
  end: /^(end|until|to|time\s*out|out|end\s*time|finish)$/,
  time: /time|hours?|shift|schedule\s*time/,
  type: /activity|type|duty|assignment|task|event|purpose|category|kind|schedule$/,
  title: /title|subject|agenda|description|details|what/,
  location: /location|venue|site|booth|place|branch|mall|area|project|station|address|where/,
  client: /client|lead|buyer|customer|guest|prospect/,
  person: /^(name|agent|staff|employee|seller|personnel|sales\s*(agent|person)|property\s*specialist)$/,
  notes: /notes?|remarks?|comments?/,
  // leads
  fullname: /^(full\s*)?name$|^(client|lead|buyer|customer)('?s)?\s*name$|^name\s*of/,
  phone: /phone|mobile|cell|contact\s*(no|number|#)?|tel|viber/,
  email: /e-?mail/,
  income: /income/, nationality: /nationality|citizenship/, status: /status|stage/, source: /source|channel/,
  // posts
  caption: /caption|copy|post\s*text|content|message|body/,
  platform: /platform|channel|social|network|page/,
  topic: /topic|title|post$|headline|theme/,
};
function roles(header) {
  const r = {};
  header.forEach((h, i) => {
    const t = lc(h).replace(/[#:*()]/g, '').trim();
    if (!t) return;
    for (const [k, re] of Object.entries(ROLE)) if (r[k] == null && re.test(t)) r[k] = i;
  });
  return r;
}
function findHeader(rows) {
  let best = -1, score = 0;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cells = rows[i] || [];
    const text = cells.filter(c => typeof c === 'string' && /[a-z]/i.test(c) && c.length <= 40 && !parseDate(c, { today: '2026-01-01' }));
    const n = Object.keys(roles(cells)).length;
    if (text.length >= 2 && n >= 2 && n * 10 + text.length > score) { best = i; score = n * 10 + text.length; }
  }
  return best;
}

// ── Detectors ──────────────────────────────────────────────────────────────
function scheduleList(rows, ctx) {
  const h = findHeader(rows); if (h < 0) return null;
  const R = roles(rows[h]); if (R.date == null) return null;
  const owner = ownerMatcher(ctx.ownerName);
  const persons = R.person != null ? new Set(rows.slice(h + 1).map(r => lc(r[R.person])).filter(Boolean)) : null;
  const onlyOwner = persons && persons.size > 1 && [...persons].some(owner);
  const recs = [], skipped = []; let dated = 0, total = 0;
  for (const row of rows.slice(h + 1)) {
    if (!row || !row.some(c => str(c))) continue;
    total++;
    const d = parseDate(row[R.date], ctx); if (!d) continue;
    dated++;
    if (onlyOwner && !owner(lc(row[R.person]))) continue;
    const get = (k) => (R[k] != null ? str(row[R[k]]) : '');
    const timeSrc = R.start != null ? row[R.start] : R.time != null ? row[R.time] : d.rest || '';
    const offText = [get('time'), get('type'), get('title'), d.rest].find(x => OFF_RE.test(x));
    if (offText !== undefined || /^(rest\s*day|day\s*off|off)$/i.test(get('type'))) { skipped.push(d.date); continue; }
    let t = parseTimes(timeSrc);
    if (R.end != null) { const e = parseTimes(row[R.end]); if (e.start) t = { ...t, end: e.start }; }
    if (!t.start && d.time) t = { start: d.time, end: null };
    const typeText = get('type'), title = get('title'), loc = get('location'), client = get('client');
    const kindText = [typeText, title, loc, R.time != null ? '' : t.rest].join(' ');
    const kind = eventKind(kindText, typeText ? 'Other' : 'Manning');
    const generic = /^(manning|duty|on\s*duty|booth\s*duty|shift|work)$/i.test(typeText);
    const label = title || (generic && loc ? `${typeText} — ${loc}` : '') || (kind === 'Tripping' && client && (!typeText || /^trip/i.test(typeText)) ? `Tripping — ${client}` : '') || typeText || loc || kind;
    recs.push({
      date: d.date, start: t.start, end: t.end, kind, title: label.slice(0, 200),
      location: loc || null, client: client || null,
      notes: [get('notes'), onlyOwner || !persons ? '' : get('person') && `For: ${get('person')}`].filter(Boolean).join(' · ') || null,
    });
  }
  if (!total || dated / total < 0.4) return null;
  return { recs, skipped, layout: 'list' };
}

const ownerMatcher = (name) => {
  const parts = lc(name).split(/\s+/).filter(p => p.length >= 2);
  const last = parts.at(-1), first = parts[0];
  return (s) => !!s && ((last && s.includes(last)) || (first && new RegExp(`(^|\\W)${first}(\\W|$)`).test(s)));
};

/** Roster: one header row whose cells are dates (or day numbers 1–31 with a known month). */
function scheduleMatrix(rows, ctx) {
  for (let h = 0; h < Math.min(rows.length, 20); h++) {
    const head = rows[h] || [];
    let cols = head.map((c, i) => [i, parseDate(c, ctx)]).filter(([, d]) => d && !d.rest);
    if (cols.length < 3 && ctx.month) {
      const nums = head.map((c, i) => [i, typeof c === 'number' ? c : /^\d{1,2}$/.test(str(c)) ? +str(c) : null]).filter(([, n]) => n >= 1 && n <= 31);
      if (nums.length >= 5 && nums.every(([, n], k) => k === 0 || n > nums[k - 1][1])) {
        const y = ctx.year || guessYear(ctx.month, 1, ctx);
        cols = nums.filter(([, n]) => validYmd(y, ctx.month, n)).map(([i, n]) => [i, { date: ymdOf(y, ctx.month, n) }]);
      }
    }
    if (cols.length < 3) continue;
    const first = cols[0][0];
    const data = rows.slice(h + 1).filter(r => r && cols.some(([i]) => str(r[i])));
    if (!data.length) continue;
    const owner = ownerMatcher(ctx.ownerName);
    const label = (r) => str(r.slice(0, first).filter(c => str(c)).join(' '));
    const ownerRows = data.filter(r => owner(lc(label(r))));
    const recs = [], skipped = [];
    const add = (date, value, where) => {
      const v = str(value); if (!v) return;
      if (OFF_RE.test(v)) { skipped.push(date); return; }
      const t = parseTimes(value);
      const text = t.rest || '';
      const kind = eventKind(`${text} ${where || ''}`, 'Manning');
      const loc = where || (text && !/^(manning|duty|on\s*duty|work|shift)$/i.test(text) ? text : null);
      recs.push({ date, start: t.start, end: t.end, kind, title: (loc && kind === 'Manning' ? `Manning — ${loc}` : text || kind).slice(0, 200), location: loc, client: null, notes: null });
    };
    if (ownerRows.length) for (const r of ownerRows) for (const [i, d] of cols) add(d.date, r[i]);
    else if (data.some(r => cols.some(([i]) => owner(lc(r[i]))))) {
      for (const r of data) for (const [i, d] of cols) if (owner(lc(r[i]))) add(d.date, 'Manning', label(r) || null);
    } else for (const r of data) for (const [i, d] of cols) {
      const who = label(r);
      if (data.length === 1 || !who) add(d.date, r[i]);
      else { const v = str(r[i]); if (v && !OFF_RE.test(v)) { add(d.date, r[i]); recs.at(-1).notes = `For: ${who}`; } else if (v) skipped.push(d.date); }
    }
    return { recs, skipped, layout: 'roster' };
  }
  return null;
}

/** Month calendar: a row of weekday names, then cells holding a day number and that day's text. */
function scheduleCalendar(rows, ctx) {
  const h = rows.findIndex((r, i) => i < 20 && (r || []).filter(c => WEEKDAY_RE.test(str(c))).length >= 5);
  if (h < 0) return null;
  const warnings = [];
  let { month, year } = ctx;
  if (!month) {
    const [ty, tm, td] = ctx.today.split('-').map(Number);
    month = td > 20 ? (tm % 12) + 1 : tm; year = td > 20 && tm === 12 ? ty + 1 : ty;
    warnings.push(`The month isn't written in the file, so ${MONTHS[month - 1].toUpperCase()} ${year} was assumed. Put the month and year in the title (e.g. "December 2026") to be sure.`);
  }
  year = year || guessYear(month, 1, ctx);
  const dayCols = rows[h].map((c, i) => (WEEKDAY_RE.test(str(c)) ? i : -1)).filter(i => i >= 0);
  const content = new Map(); const cur = {}; let seenOne = false, maxSeen = 0;
  for (const r of rows.slice(h + 1)) {
    if (!r) continue;
    const nums = dayCols.map(i => { const m = /^\s*(\d{1,2})\b\s*([\s\S]*)$/.exec(typeof r[i] === 'number' ? String(r[i]) : String(r[i] ?? '')); return m ? [i, +m[1], m[2]] : null; }).filter(Boolean);
    if (nums.length >= 3 || (nums.length && nums.every(([, n]) => n <= 31) && nums.length === dayCols.filter(i => str(r[i])).length && nums.length >= 1 && dayCols.every(i => !str(r[i]) || /^\s*\d{1,2}\b/.test(String(r[i]))))) {
      for (const [i, n, rest] of nums) {
        let ok = true;
        if (!seenOne) { if (n === 1) seenOne = true; else if (n > 7) ok = false; }    // leading days of the previous month
        else if (n < 15 && maxSeen >= 22) ok = false;                                   // trailing days of the next month
        if (ok) maxSeen = Math.max(maxSeen, n);
        cur[i] = ok && validYmd(year, month, n) ? n : null;
        if (cur[i] && str(rest)) content.set(cur[i], [...(content.get(cur[i]) || []), rest]);
      }
      for (const i of dayCols) if (!nums.some(([j]) => j === i)) cur[i] = null;
    } else {
      for (const i of dayCols) if (cur[i] && str(r[i])) content.set(cur[i], [...(content.get(cur[i]) || []), String(r[i])]);
    }
  }
  const recs = [], skipped = [];
  for (const [d, parts] of [...content].sort((a, b) => a[0] - b[0])) {
    const date = ymdOf(year, month, d);
    for (const piece of parts.join('\n').split(/\n|;|•/).map(str).filter(Boolean)) {
      if (OFF_RE.test(piece) || /^(rest\s*day|day\s*off)\b/i.test(piece)) { skipped.push(date); continue; }
      const t = parseTimes(piece); const text = t.rest || '';
      const kind = eventKind(text, 'Manning');
      const loc = kind === 'Manning' && text && !/^(manning|duty)$/i.test(text) ? text.replace(/^(manning|duty)\s*[-:@—–]?\s*/i, '') || null : null;
      recs.push({ date, start: t.start, end: t.end, kind, title: (loc ? `Manning — ${loc}` : text || kind).slice(0, 200), location: loc, client: null, notes: null });
    }
  }
  return { recs, skipped, layout: 'calendar', warnings };
}

/** Plain text lines that start with a date ("Dec 3 – Tripping with Maria Santos, 2 PM"). */
function scheduleLines(lines, ctx) {
  const recs = [], skipped = []; let n = 0;
  for (const line of lines) {
    const d = parseDate(line, ctx); if (!d) continue;
    n++;
    if (!d.rest || OFF_RE.test(d.rest) || /^(rest\s*day|day\s*off)\b/i.test(d.rest)) { if (d.rest) skipped.push(d.date); continue; }
    const t = parseTimes(d.rest); const text = t.rest.replace(/^[\s,:;|–—-]+|[\s,;|–—-]+$/g, '');
    const kind = eventKind(text, 'Manning');
    const client = kind === 'Tripping' ? (/\bwith\s+([A-Z][\w.'-]+(?:\s+[A-Z][\w.'-]+){0,3})/.exec(text) || [])[1] || null : null;
    const loc = (/\b(?:at|@)\s+([^,;()]+?)(?:\s*[,;(]|$)/i.exec(text) || [])[1] || null;
    recs.push({ date: d.date, start: t.start, end: t.end, kind, title: (text || kind).slice(0, 200), location: loc, client, notes: null });
  }
  return n >= 2 ? { recs, skipped, layout: 'lines' } : null;
}

const STAGES = ['New', 'Contacted', 'Follow-Up', 'Site Visit', 'Reserved', 'Closed', 'Cancelled', 'Not Interested'];
function leadsTable(rows) {
  const h = findHeader(rows); if (h < 0) return null;
  const R = roles(rows[h]);
  const nameCol = R.fullname ?? (R.client != null && /name/.test(lc(rows[h][R.client])) ? R.client : null);
  if (nameCol == null || (R.phone == null && R.email == null)) return null;
  // a dated activity list (e.g. trippings with clients' numbers) is a schedule, not a leads list
  if (R.date != null && R.email == null && (R.time != null || R.type != null || R.location != null)) return null;
  const recs = [];
  for (const r of rows.slice(h + 1)) {
    const name = str(r?.[nameCol]); if (!name || name.length > 200) continue;
    const g = (k) => (R[k] != null ? str(r[R[k]]) || null : null);
    const st = STAGES.find(s => lc(s) === lc(g('status')));
    const inc = ['High', 'Mid', 'Low'].find(c => lc(c) === lc(g('income')));
    recs.push({ full_name: name, phone: g('phone'), email: g('email'), address: g('location'), nationality: g('nationality'), income_class: inc || null, status: st && st !== 'Closed' ? st : 'New', source: g('source') || 'Import', notes: g('notes') });
  }
  return recs.length ? { recs } : null;
}

const PLATFORM = [['Facebook', /fb|facebook|meta/i], ['Instagram', /ig|insta/i], ['TikTok', /tiktok|tik\s*tok/i]];
function postsTable(rows, ctx) {
  const h = findHeader(rows); if (h < 0) return null;
  const R = roles(rows[h]);
  if (R.caption == null && R.platform == null) return null;   // a "Title" column alone is not a content plan
  if (R.phone != null || R.email != null) return null;
  const recs = [];
  for (const r of rows.slice(h + 1)) {
    const g = (k) => (R[k] != null ? str(r?.[R[k]]) : '');
    const caption = R.caption != null ? String(r?.[R.caption] ?? '').trim() : '';
    const title = g('topic') || caption.split(/\n/)[0].slice(0, 80);
    if (!title) continue;
    const d = R.date != null ? parseDate(r[R.date], ctx) : null;
    const t = parseTimes(R.time != null ? r[R.time] : d?.rest || '');
    const pf = PLATFORM.filter(([, re]) => re.test(g('platform'))).map(([p]) => p);
    const st = ['Draft', 'Scheduled', 'Posted', 'Cancelled'].find(s => lc(s) === lc(g('status')));
    recs.push({ title: title.slice(0, 200), caption: caption || null, platforms: pf.length ? pf : ['Facebook'], date: d?.date || null, time: t.start || (d?.time ?? null), status: st || (d ? 'Scheduled' : 'Draft'), notes: g('notes') || null });
  }
  return recs.length ? { recs } : null;
}

// ── Overview helpers ───────────────────────────────────────────────────────
function textFacts(text, ctx) {
  const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) || []).length;
  const amounts = [...text.matchAll(/(?:₱|PHP|Php|P)\s?([\d,]+(?:\.\d{1,2})?)\b/g)].map(m => +m[1].replace(/,/g, '')).filter(n => n >= 100);
  const dates = [];
  for (const m of text.matchAll(new RegExp(`\\b(${MONTH_RE}\\.?\\s*\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s*20\\d{2})?|\\d{1,2}/\\d{1,2}/\\d{2,4}|20\\d{2}-\\d{2}-\\d{2})`, 'gi'))) { const d = parseDate(m[1], ctx); if (d) dates.push(d.date); }
  dates.sort();
  return {
    words, amounts: amounts.length ? { count: amounts.length, total: amounts.reduce((a, b) => a + b, 0), max: Math.max(...amounts) } : null,
    emails: new Set((text.match(/[^\s@<>(),;:]+@[^\s@<>(),;:]+\.[a-z]{2,}/gi) || []).map(e => e.toLowerCase())).size,
    phones: new Set((text.match(/(?:\+?63|0)9\d{2}[\s-]?\d{3}[\s-]?\d{4}/g) || []).map(p => p.replace(/\D/g, '').slice(-10))).size,
    dateRange: dates.length ? [dates[0], dates.at(-1)] : null,
  };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtD = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** Main entry. */
export function analyze({ tables = [], text = '', fileName = '', ownerName = '', today, kindHint }) {
  const head = [fileName.replace(/[_.-]+/g, ' '), ...tables.map(t => t.name), ...tables.flatMap(t => t.rows.slice(0, 6).flat().filter(c => typeof c === 'string')), text.slice(0, 2000)].join(' \n ');
  const my = findMonthYear(head);
  const ctx = { today, ownerName, month: my?.month || null, year: my?.year || null };
  const warnings = [];

  let found = null;
  for (const t of tables) {
    const rows = t.rows.filter(r => Array.isArray(r));
    const tries = [
      () => { const r = leadsTable(rows); return r && { kind: 'leads', ...r }; },
      () => { const r = postsTable(rows, ctx); return r && { kind: 'posts', ...r }; },
      () => { const r = scheduleList(rows, ctx); return r && { kind: 'schedule', ...r }; },
      () => { const r = scheduleCalendar(rows, ctx); return r && { kind: 'schedule', ...r }; },   // before rosters: a week row looks like day columns
      () => { const r = scheduleMatrix(rows, ctx); return r && { kind: 'schedule', ...r }; },
    ];
    for (const tr of tries) {
      const r = tr();
      if (r && r.recs.length && (!found || r.recs.length > found.recs.length)) { found = { ...r, sheet: t.name }; break; }
    }
  }
  if (!found && text) {
    const r = scheduleLines(text.split(/\n/), ctx);
    if (r && r.recs.length) found = { kind: 'schedule', ...r };
  }
  if (found?.warnings) warnings.push(...found.warnings);

  // Overview
  const facts = textFacts([text, ...tables.flatMap(t => t.rows.slice(0, 500).map(r => r.map(str).join(' ')))].join('\n'), ctx);
  const overview = {
    kind: found?.kind || null, layout: found?.layout || null, sheet: found?.sheet || null,
    count: found?.recs.length || 0,
    tables: tables.map(t => ({ name: t.name, rows: t.rows.length, columns: Math.max(0, ...t.rows.slice(0, 200).map(r => r.length)) })),
    words: facts.words, amounts: facts.amounts, emails: facts.emails, phones: facts.phones,
    preview: (text ? text.split(/\n/) : tables[0]?.rows.map(r => r.map(str).filter(Boolean).join(' · ')) || []).map(str).filter(Boolean).slice(0, 6).map(l => l.slice(0, 160)),
    month: my ? { ...my } : null,
  };
  if (found?.kind === 'schedule') {
    const dates = found.recs.map(r => r.date).sort();
    overview.range = dates.length ? [dates[0], dates.at(-1)] : null;
    overview.byKind = found.recs.reduce((a, r) => ((a[r.kind] = (a[r.kind] || 0) + 1), a), {});
    overview.skipped = found.skipped?.length || 0;
  } else if (found?.kind === 'posts') {
    const dates = found.recs.map(r => r.date).filter(Boolean).sort();
    overview.range = dates.length ? [dates[0], dates.at(-1)] : null;
  } else overview.range = facts.dateRange;

  let summary;
  if (found?.kind === 'schedule') summary = `Schedule: ${found.recs.length} entr${found.recs.length === 1 ? 'y' : 'ies'}${overview.range ? `, ${fmtD(overview.range[0])} – ${fmtD(overview.range[1])}` : ''} (${Object.entries(overview.byKind).map(([k, n]) => `${n} ${k}`).join(', ')})${overview.skipped ? ` · ${overview.skipped} day(s) off` : ''}`;
  else if (found?.kind === 'leads') summary = `Leads list: ${found.recs.length} people`;
  else if (found?.kind === 'posts') summary = `Content plan: ${found.recs.length} post(s)${overview.range ? `, ${fmtD(overview.range[0])} – ${fmtD(overview.range[1])}` : ''}`;
  else {
    const bits = [];
    if (tables.length && !text) bits.push(`${tables.length} sheet(s), ${tables.reduce((a, t) => a + t.rows.length, 0)} rows`);
    if (facts.words && text) bits.push(`${facts.words.toLocaleString('en-PH')} words`);
    if (facts.amounts) bits.push(`${facts.amounts.count} peso amount(s), largest ₱${facts.amounts.max.toLocaleString('en-PH')}`);
    if (facts.dateRange) bits.push(`dates ${fmtD(facts.dateRange[0])} – ${fmtD(facts.dateRange[1])}`);
    if (facts.emails || facts.phones) bits.push(`${facts.emails} email(s), ${facts.phones} phone number(s)`);
    summary = bits.length ? cap(bits.join(' · ')) : 'No text found.';
  }
  return { kind: found?.kind || null, records: found?.recs || [], overview, summary, warnings, ctx };
}
