// Chart.js wrappers. One series per chart; reference lines (quota/goal) are
// direct-labeled annotations, not extra series. Colors come from CSS variables
// so light/dark mode both work. Every chart has a "Show as table" fallback.
import { esc } from './util.js';

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const live = new Set();
export function destroyCharts() { for (const c of live) c.destroy(); live.clear(); }
/** True when the current screen has charts (they read colors when drawn, so a theme switch needs a redraw). */
export const hasCharts = () => live.size > 0;

/** Horizontal reference lines with direct labels: refs = [{ value, label, color, dash }] */
const refLines = {
  id: 'refLines',
  afterDatasetsDraw(chart, _args, opts) {
    const refs = opts?.refs || [];
    if (!refs.length) return;
    const { ctx, chartArea: a, scales: { y } } = chart;
    ctx.save();
    for (const r of refs) {
      const py = y.getPixelForValue(r.value);
      if (py < a.top - 1 || py > a.bottom + 1) continue;
      ctx.strokeStyle = r.color; ctx.lineWidth = 2; ctx.setLineDash(r.dash || [6, 4]);
      ctx.beginPath(); ctx.moveTo(a.left, py); ctx.lineTo(a.right, py); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = css('--tx'); ctx.font = '600 11px system-ui';
      ctx.textAlign = 'right'; ctx.fillText(r.label, a.right - 4, py - 5);
    }
    ctx.restore();
  },
};

function base(fmtY) {
  const tx = css('--mu'), grid = css('--bd');
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (c) => ` ${fmtY(c.parsed.y ?? c.parsed.x)}` } },
    },
    scales: {
      x: { ticks: { color: tx }, grid: { display: false }, border: { color: grid } },
      y: { beginAtZero: true, ticks: { color: tx, callback: (v) => fmtY(v) }, grid: { color: grid }, border: { display: false } },
    },
  };
}

function tableView(labels, values, fmt, head) {
  return `<details class="tableview"><summary>Show as table</summary><div class="tbl-wrap"><table><thead><tr><th>${esc(head[0])}</th><th class="num">${esc(head[1])}</th></tr></thead><tbody>${labels.map((l, i) => `<tr><td>${esc(l)}</td><td class="num">${esc(fmt(values[i]))}</td></tr>`).join('')}</tbody></table></div></details>`;
}

/** Line chart (e.g. cumulative sales) with optional reference lines. */
export function lineChart(box, { labels, values, fmt, refs = [], head = ['Month', 'Value'] }) {
  box.innerHTML = `<div class="chart-box"><canvas></canvas></div>${tableView(labels, values, fmt, head)}`;
  const o = base(fmt);
  const maxRef = Math.max(0, ...refs.map(r => r.value));
  o.scales.y.suggestedMax = maxRef * 1.08;
  o.plugins.refLines = { refs };
  const c = new window.Chart(box.querySelector('canvas'), {
    type: 'line',
    data: { labels, datasets: [{ data: values, borderColor: css('--series'), backgroundColor: css('--series'), borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, tension: 0, spanGaps: false }] },
    options: o, plugins: [refLines],
  });
  live.add(c); return c;
}

/** Vertical or horizontal bar chart, single series. */
export function barChart(box, { labels, values, fmt, horizontal = false, head = ['Label', 'Value'], colors }) {
  box.innerHTML = `<div class="chart-box" style="height:${horizontal ? Math.max(180, labels.length * 34 + 40) : 300}px"><canvas></canvas></div>${tableView(labels, values, fmt, head)}`;
  const o = base(fmt);
  if (horizontal) {
    o.indexAxis = 'y';
    [o.scales.x, o.scales.y] = [o.scales.y, o.scales.x];
    o.scales.x.ticks.callback = (v) => fmt(v);
    o.scales.y.ticks.callback = function (v) { return this.getLabelForValue(v); };
    o.plugins.tooltip.callbacks.label = (c) => ` ${fmt(c.parsed.x)}`;
  }
  const c = new window.Chart(box.querySelector('canvas'), {
    type: 'bar',
    data: { labels, datasets: [{ data: values, backgroundColor: colors || css('--series'), borderRadius: 4, borderSkipped: 'start', maxBarThickness: 36, borderWidth: 0 }] },
    options: o,
  });
  live.add(c); return c;
}
