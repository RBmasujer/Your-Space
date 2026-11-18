// Goal meter + KPI tiles, computed by the database view v_quota_progress.
import { sb, must } from './sb.js';
import { esc, money, moneyWhole, moneyShort, pct, int, today, daysBetween } from './util.js';

export async function loadQuota() {
  const rows = must(await sb.from('v_quota_progress').select('*').limit(1));
  return rows[0] || null;
}

/** Progress meter: fill = sales; markers = quota (100%) and goal (e.g. 150%). */
export function meterHTML(q) {
  if (!q) return '<p class="muted">No settings yet — run the seed SQL.</p>';
  const max = Math.max(+q.goal_php, +q.sales_php) * 1.04 || 1;
  const x = v => Math.min(100, (v / max) * 100);
  const done = +q.sales_php >= +q.goal_php;
  return `
  <div class="meter" role="img" aria-label="${esc(`${money(q.sales_php)} closed: ${pct(q.pct_of_quota)} of quota, ${pct(q.pct_of_goal)} of goal`)}">
    <div class="fill ${done ? 'done' : ''}" style="width:${x(+q.sales_php)}%"></div>
    <div class="mark ${x(+q.quota_php) > 70 ? 'edge' : ''}" style="left:${x(+q.quota_php)}%"><span>Quota ${moneyShort(q.quota_php)}</span></div>
    <div class="mark goal ${x(+q.goal_php) > 70 ? 'edge' : ''}" style="left:calc(${x(+q.goal_php)}% - 1px)"><span>Goal ${esc(+q.goal_pct)}% · ${moneyShort(q.goal_php)}</span></div>
  </div>
  <div class="meter-val">${money(q.sales_php)} closed · ${done ? '<span class="chip ok">✓ Goal reached</span>' : +q.sales_php >= +q.quota_php ? '<span class="chip ok">✓ Quota met</span>' : 'In progress'}</div>`;
}

export function kpisHTML(q) {
  if (!q) return '';
  const left = Math.max(0, daysBetween(today(), q.period_end));
  const months = Math.max(left / 30.44, 0.25);
  return `<div class="kpis">
    <div class="kpi"><b>${moneyWhole(q.sales_php)}</b><span>Sales closed (${esc(q.period_start)} → ${esc(q.period_end)})</span></div>
    <div class="kpi"><b>${int(q.deals_closed)}</b><span>Deals closed</span></div>
    <div class="kpi"><b>${pct(q.pct_of_quota)}</b><span>of ${moneyWhole(q.quota_php)} quota</span></div>
    <div class="kpi"><b>${pct(q.pct_of_goal)}</b><span>of ${moneyWhole(q.goal_php)} goal</span></div>
    <div class="kpi"><b>${moneyWhole(q.remaining_quota_php)}</b><span>to reach quota</span></div>
    <div class="kpi"><b>${moneyWhole(q.remaining_goal_php)}</b><span>to reach goal</span></div>
    <div class="kpi"><b>${int(left)}</b><span>days left in period</span></div>
    <div class="kpi"><b>${moneyWhole(q.remaining_goal_php / months)}</b><span>needed per month for goal</span></div>
    <div class="kpi"><b>${moneyWhole(q.reserved_php)}</b><span>${int(q.reserved_count)} reserved (pipeline, not yet counted)</span></div>
    ${q.deals_needed_goal != null ? `<div class="kpi"><b>${int(q.deals_needed_quota)} / ${int(q.deals_needed_goal)}</b><span>deals still needed for quota / goal</span></div>` : ''}
  </div>`;
}
