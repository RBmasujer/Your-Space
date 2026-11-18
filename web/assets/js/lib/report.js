// "Download progress report (PDF)" dialog: pick a period + commission rate, fetch, build, save.
import { sb, must, fetchAll, uid } from './sb.js';
import { esc, modal, toast, fail, today, addDays, saveBlob, fmtDate } from './util.js';
import { loadQuota } from './goal.js';
import { buildProgressReport, dayRange } from './report-pdf.js';
import { OWNER_NAME, TZ } from '../config.js';

const RATE_KEY = 'ys-commission-pct';
const STAGES = ['New', 'Contacted', 'Follow-Up', 'Site Visit', 'Reserved', 'Closed', 'Cancelled', 'Not Interested'];

function periods(q) {
  const t = today(), [y, m] = t.split('-').map(Number);
  const first = (yy, mm) => `${yy}-${String(mm).padStart(2, '0')}-01`;
  const last = (yy, mm) => addDays(first(mm === 12 ? yy + 1 : yy, mm === 12 ? 1 : mm + 1), -1);
  const pm = m === 1 ? [y - 1, 12] : [y, m - 1];
  const list = [];
  if (q) list.push(['contract', 'Contract period', q.period_start, q.period_end]);
  list.push(['month', 'This month', first(y, m), last(y, m)]);
  list.push(['last', 'Last month', first(...pm), last(...pm)]);
  const qs = Math.floor((m - 1) / 3) * 3 + 1;
  list.push(['quarter', 'This quarter', first(y, qs), last(y, qs + 2)]);
  list.push(['ytd', 'Year to date', `${y}-01-01`, t]);
  list.push(['custom', 'Custom dates…', first(y, m), t]);
  return list;
}

/** Commission rate: saved in settings.commission_pct (migration 4); falls back to this device. */
async function loadRate() {
  try {
    const row = must(await sb.from('settings').select('*').maybeSingle());
    if (row && row.commission_pct != null) return +row.commission_pct;
  } catch { /* fall through */ }
  try { const v = localStorage.getItem(RATE_KEY); return v === null || v === '' ? null : +v; } catch { return null; }
}
async function saveRate(rate) {
  try { localStorage.setItem(RATE_KEY, rate == null ? '' : String(rate)); } catch { /* private mode */ }
  const { error } = await sb.from('settings').update({ commission_pct: rate }).eq('owner_id', uid());
  return !error; // false = column missing (migration 4 not run) → kept on this device only
}

export async function openReportDialog() {
  const [q, rate] = await Promise.all([loadQuota().catch(() => null), loadRate()]);
  const P = periods(q);
  const m = modal(`
    <h2>📄 Progress report (PDF)<span class="sp"></span><button class="btn ghost sm" data-close aria-label="Close">✕</button></h2>
    <form id="rf" class="form-grid">
      <label class="fld wide">Period<select name="period">${P.map(([k, label, f, t]) => `<option value="${k}">${esc(label)}${k === 'custom' ? '' : ` · ${esc(fmtDate(f))} – ${esc(fmtDate(t))}`}</option>`).join('')}</select></label>
      <label class="fld" data-custom hidden>From<input name="from" type="date" value="${esc(P.at(-1)[2])}"></label>
      <label class="fld" data-custom hidden>To<input name="to" type="date" value="${esc(P.at(-1)[3])}"></label>
      <label class="fld">Commission rate % (for earnings)<input name="rate" type="number" min="0" max="100" step="0.01" inputmode="decimal" placeholder="e.g. 3" value="${rate == null ? '' : esc(rate)}"></label>
      <label class="fld"><span><input type="checkbox" name="names" checked> Include client names</span></label>
    </form>
    <p class="hint">The report lists <b>sales</b> (closed deals), <b>completed leads</b> and <b>total earnings</b> (contract price × your commission rate) for the period, plus quota progress, a monthly chart and the pipeline. Untick client names before sharing it outside RLC.</p>
    <div class="foot"><button class="btn ghost" data-close>Cancel</button><button class="btn" data-go>⬇ Download PDF</button></div>`);
  const f = m.el.querySelector('#rf');
  const custom = () => m.el.querySelectorAll('[data-custom]').forEach(el => { el.hidden = f.period.value !== 'custom'; });
  f.period.onchange = custom;
  m.el.querySelector('[data-go]').onclick = async (ev) => {
    const p = P.find(x => x[0] === f.period.value);
    const from = p[0] === 'custom' ? f.from.value : p[2], to = p[0] === 'custom' ? f.to.value : p[3];
    if (!from || !to || to < from) return toast('Pick a valid date range (To must be on or after From).', 'err');
    const r = f.rate.value.trim() === '' ? null : +f.rate.value;
    if (r != null && !(r >= 0 && r <= 100)) return toast('Commission rate must be between 0 and 100.', 'err');
    const btn = ev.currentTarget; btn.disabled = true; btn.textContent = 'Preparing…';
    try {
      if (r !== rate && !(await saveRate(r))) toast('Commission rate saved on this device only. Run migration 20261118000004_fixes.sql to keep it everywhere.');
      const blob = await makeReport({ from, to, periodLabel: p[0] === 'custom' ? 'Custom period' : p[1], ratePct: r, includeNames: f.names.checked, quota: q });
      saveBlob(blob, `Your-Space-Progress-Report_${from}_to_${to}.pdf`);
      toast('Progress report downloaded.', 'ok'); m.close();
    } catch (e) { fail(e); btn.disabled = false; btn.textContent = '⬇ Download PDF'; }
  };
}

async function makeReport({ from, to, periodLabel, ratePct, includeNames, quota }) {
  const [start, endEx] = dayRange(from, to);
  const [closed, reservedRows, funnel, newLeads] = await Promise.all([
    fetchAll(() => sb.from('leads').select('id,full_name,project,unit,contract_price,closed_at')
      .eq('status', 'Closed').gte('closed_at', from).lte('closed_at', to).order('closed_at').order('id')),
    fetchAll(() => sb.from('leads').select('id,contract_price').eq('status', 'Reserved').order('id')),
    sb.from('v_lead_funnel').select('*').then(must),
    sb.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', start).lt('created_at', endEx).then(r => { if (r.error) throw r.error; return r.count || 0; }),
  ]);
  const counts = Object.fromEntries(funnel.map(x => [x.status, +x.leads]));
  const generatedAt = new Date().toLocaleString('en-PH', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' (Manila)';
  const pdf = buildProgressReport({
    owner: OWNER_NAME, role: 'Property Specialist · RLC Residences', from, to, periodLabel, generatedAt, ratePct, includeNames,
    closed, reserved: { count: reservedRows.length, sum: reservedRows.reduce((a, l) => a + (+l.contract_price || 0), 0) },
    newLeads, stages: STAGES.map(s => ({ status: s, leads: counts[s] || 0 })), quota,
  });
  return pdf.toBlob();
}
