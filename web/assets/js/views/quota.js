// Quota & Progress: settings + automatic computation (DB view) + graphs.
import { sb, must, uid } from '../lib/sb.js';
import { esc, money, moneyShort, int, toast, fail, formData, today, fmtDate } from '../lib/util.js';
import { loadQuota, meterHTML, kpisHTML } from '../lib/goal.js';
import { lineChart, barChart, destroyCharts } from '../lib/charts.js';
import { STATUSES } from './leads.js';

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export async function render(el) {
  destroyCharts();
  const [q, monthly, funnel, closed] = await Promise.all([
    loadQuota(),
    sb.from('v_monthly_sales').select('*').order('month').then(must),
    sb.from('v_lead_funnel').select('*').then(must),
    sb.from('leads').select('id,full_name,project,unit,contract_price,closed_at').eq('status', 'Closed').order('closed_at', { ascending: false }).limit(200).then(must),
  ]);
  if (!q) { el.innerHTML = '<div class="card"><h2>Setup needed</h2><p>Run <b>supabase/seed/seed.sql</b> to create the quota settings.</p></div>'; return; }

  // Months in the contract period (Manila calendar months)
  const months = [];
  for (let d = new Date(`${q.period_start.slice(0, 7)}-01T00:00:00Z`); d <= new Date(`${q.period_end}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.toISOString().slice(0, 7));
  const byMonth = Object.fromEntries(monthly.map(r => [String(r.month).slice(0, 7), +r.sales_php]));
  const curMonth = today().slice(0, 7);
  let run = 0;
  const cum = months.map(m => { run += byMonth[m] || 0; return m <= curMonth ? run : null; }); // no future points
  const label = m => new Date(`${m}-01T00:00:00Z`).toLocaleString('en-PH', { month: 'short', year: 'numeric', timeZone: 'UTC' });

  el.innerHTML = `
  <div class="card"><h2>Quota & goal — computed automatically from Closed leads<span class="sp"></span><button class="btn" type="button" data-report>⬇ Progress report (PDF)</button></h2>
    <form id="qs" class="row">
      <label>Quota ₱<input name="quota_php" type="number" min="0" step="1000" value="${esc(q.quota_php)}"></label>
      <label>Goal (% of quota)<input name="goal_pct" type="number" min="1" step="1" value="${esc(q.goal_pct)}"></label>
      <label>Contract start<input name="period_start" type="date" value="${esc(q.period_start)}" required></label>
      <label>Contract end<input name="period_end" type="date" value="${esc(q.period_end)}" required></label>
      <label>Avg. unit price ₱ (optional)<input name="avg_unit_price" type="number" min="0" step="1000" value="${esc(q.avg_unit_price ?? '')}" placeholder="for “deals needed”"></label>
      <button class="btn" type="submit">Save</button>
    </form>
    ${meterHTML(q)}${kpisHTML(q)}
  </div>
  <div class="cols">
    <div class="card"><h2>Cumulative closed sales vs quota & goal</h2><div id="c1"></div></div>
    <div class="card"><h2>Closed sales per month</h2><div id="c2"></div></div>
  </div>
  <div class="cols" style="margin-top:14px">
    <div class="card"><h2>Pipeline — leads per stage</h2><div id="c3"></div></div>
    <div class="card"><h2>Closed deals (${closed.length})</h2>
      ${closed.length ? `<div class="tbl-wrap"><table class="stack"><thead><tr><th>Date</th><th>Client</th><th>Unit / project</th><th class="num">Contract price</th></tr></thead><tbody>
        ${closed.map(c => `<tr class="clickable" data-lead="${esc(c.id)}"><td class="nowrap" data-label="Date">${esc(fmtDate(c.closed_at))}</td><td data-label="Client">${esc(c.full_name)}</td><td data-label="Unit">${esc([c.unit, c.project].filter(Boolean).join(' · ')) || '—'}</td><td class="num" data-label="Price">${esc(money(c.contract_price))}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">No closed deals yet. Open a lead, set Stage = Closed and enter the price.</div>'}
    </div>
  </div>`;

  lineChart(el.querySelector('#c1'), {
    labels: months.map(label), values: cum, fmt: moneyShort, head: ['Month', 'Cumulative sales'],
    refs: [
      { value: +q.quota_php, label: `Quota ${moneyShort(q.quota_php)}`, color: css('--ref') },
      { value: +q.goal_php, label: `Goal ${moneyShort(q.goal_php)}`, color: css('--goal') },
    ],
  });
  barChart(el.querySelector('#c2'), { labels: months.map(label), values: months.map(m => byMonth[m] || 0), fmt: moneyShort, head: ['Month', 'Closed sales'] });
  const counts = Object.fromEntries(funnel.map(r => [r.status, +r.leads]));
  barChart(el.querySelector('#c3'), { labels: STATUSES, values: STATUSES.map(s => counts[s] || 0), fmt: int, horizontal: true, head: ['Stage', 'Leads'] });

  el.querySelector('[data-report]').onclick = () => import('../lib/report.js').then(r => r.openReportDialog()).catch(fail);
  el.querySelectorAll('[data-lead]').forEach(r => r.onclick = () => { location.hash = `#/leads?open=${r.dataset.lead}`; });
  el.querySelector('#qs').onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    if (d.period_end < d.period_start) return toast('Contract end must be after the start.', 'err');
    try { must(await sb.from('settings').update(d).eq('owner_id', uid())); toast('Saved.', 'ok'); render(el); } catch (err) { fail(err); }
  };
}
