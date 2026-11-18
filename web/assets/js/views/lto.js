// Lease-to-Own 120 calculator + printable quotation (ported from the original app).
import { sb, must, fetchAll } from '../lib/sb.js';
import { esc, money, fmtDate, today, saveBlob, $ } from '../lib/util.js';

let leads = [], sig = '';

export async function render(el, params) {
  [leads, sig] = await Promise.all([
    fetchAll(() => sb.from('leads').select('id,full_name,phone,project,unit').order('full_name').order('id')),
    sb.from('settings').select('email_signature').maybeSingle().then(r => must(r)?.email_signature || ''),
  ]);
  const pre = params.lead ? leads.find(l => l.id === params.lead) : null;
  el.innerHTML = `
  <div class="card"><h2>LTO 120 calculator</h2>
    <form id="lf" class="form-grid">
      <label class="fld">Client<input name="client" list="cl" value="${esc(pre?.full_name || '')}" autocomplete="off"></label>
      <datalist id="cl">${leads.map(l => `<option value="${esc(l.full_name)}">`).join('')}</datalist>
      <label class="fld">Unit / project<input name="unit" value="${esc([pre?.unit, pre?.project].filter(Boolean).join(' · '))}"></label>
      <label class="fld">Total unit price ₱<input name="price" type="number" min="0" step="1000" value="6000000"></label>
      <label class="fld">Discounts / adjustments ₱<input name="disc" type="number" min="0" step="1000" value="0"></label>
      <label class="fld">Lease term (months)<input name="term" type="number" min="1" max="360" value="120"></label>
      <label class="fld">Condo dues ₱/month<input name="dues" type="number" min="0" value="0"></label>
      <label class="fld">Security deposit ₱<input name="dep" type="number" min="0" value="0"></label>
      <label class="fld">Lease start<input name="start" type="date" value=""></label>
    </form>
    <div class="row" style="margin-top:10px"><button class="btn" id="print">Print / Save as PDF</button><button class="btn ghost" id="dl">Download quotation (.html)</button></div>
    <p class="hint">Sample price shown — enter the real figures from the RLC price list.</p>
  </div>
  <div class="card"><div id="qv"></div></div>`;
  const f = $('#lf', el);
  const calc = () => {
    const n = k => +f.elements[k].value || 0;
    const net = Math.max(0, n('price') - n('disc')), term = Math.min(360, Math.max(1, Math.round(n('term')) || 120)), rent = net / term; // 1–360 months: a typo like 99999 must not freeze the tab
    return { client: f.client.value.trim() || 'Valued Client', unit: f.unit.value.trim(), price: n('price'), disc: n('disc'), net, term, rent, dues: n('dues'), dep: n('dep'), start: f.start.value };
  };
  const draw = () => { const h = quoteHTML(calc()); $('#qv', el).innerHTML = h; document.getElementById('print-area').innerHTML = h; };
  f.oninput = draw;
  f.client.onchange = () => { const l = leads.find(x => x.full_name === f.client.value); if (l && !f.unit.value) f.unit.value = [l.unit, l.project].filter(Boolean).join(' · '); draw(); };
  $('#print', el).onclick = () => print();
  $('#dl', el).onclick = () => {
    const c = calc();
    const css = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules].map(r => r.cssText).filter(t => t.includes('.quote')); } catch { return []; } }).join('\n');
    saveBlob(new Blob([`<!doctype html><meta charset="utf-8"><title>LTO 120 Quotation — ${esc(c.client)}</title><style>${css}</style>${quoteHTML(c)}`], { type: 'text/html' }), `LTO120_Quotation_${c.client.replace(/\W+/g, '_')}.html`);
  };
  draw();
}

function quoteHTML(c) {
  const years = Math.ceil(c.term / 12);
  const rows = Array.from({ length: years }, (_, i) => { const mths = Math.min((i + 1) * 12, c.term); return `<tr><td>Year ${i + 1}</td><td>${mths}</td><td>${money(c.rent * mths)}</td><td>${money(c.net - c.rent * mths)}</td></tr>`; }).join('');
  let end = '';
  if (c.start) { const d = new Date(`${c.start}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + c.term); d.setUTCDate(d.getUTCDate() - 1); end = d.toISOString().slice(0, 10); }
  return `<div class="quote">
    <div class="qh"><h1>Your Space</h1><div>Lease-to-Own ${c.term} · Sample Computation · RLC Residences</div></div>
    <p><b>Prepared for:</b> ${esc(c.client)}<br><b>Unit:</b> ${esc(c.unit || '—')}<br><b>Date:</b> ${esc(fmtDate(today()))}${c.start ? `<br><b>Lease:</b> ${esc(fmtDate(c.start))} to ${esc(fmtDate(end))}` : ''}</p>
    <table class="zebra" style="width:100%;border-collapse:collapse">
      <tr><td>Total unit price</td><td class="num">${money(c.price)}</td></tr>
      <tr><td>Less: discounts / adjustments</td><td class="num">${money(c.disc)}</td></tr>
      <tr><td><b>Net Total Contract Price</b></td><td class="num"><b>${money(c.net)}</b></td></tr>
      <tr><td><b>Fixed monthly rent</b> (÷ ${c.term} months)</td><td class="num big">${money(c.rent)}</td></tr>
      <tr><td>Annual rent</td><td class="num">${money(c.rent * 12)}</td></tr>
      <tr><td>Monthly condo dues (not credited)</td><td class="num">${c.dues ? money(c.dues) : 'As per project'}</td></tr>
      <tr><td>Monthly outlay incl. condo dues</td><td class="num">${money(c.rent + c.dues)}</td></tr>
      <tr><td>Security deposit</td><td class="num">${c.dep ? money(c.dep) : 'As per RLC price list'}</td></tr>
      <tr><td>Reservation fee</td><td class="num">None</td></tr>
    </table>
    <h3>Rent credited toward your home</h3>
    <table style="width:100%;border-collapse:collapse"><tr style="background:#1b6fb5;color:#fff"><th style="color:#fff">Year</th><th style="color:#fff">Months paid</th><th style="color:#fff">Total credited</th><th style="color:#fff">Balance</th></tr>${rows}</table>
    <ul><li>${Math.round(c.term / 12)}-year (${c.term}-month) lease with a fixed monthly rent.</li><li>Your full monthly rent is credited toward the purchase of your home.</li>
      <li>Booking and move-in: applicable rent, security deposit, condo dues and post-dated checks. No reservation fee.</li><li>Rent excludes condo dues, which are not credited.</li></ul>
    <p style="white-space:pre-line">${esc(sig)}</p>
    <p style="font-size:11px;color:#667">Sample computation for discussion only, not a contract or offer. Final figures, requirements and availability are per RLC's price list and terms.</p>
  </div>`;
}
