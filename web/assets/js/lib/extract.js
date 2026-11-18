// Read an uploaded file into plain tables + text for detect.js.
// Spreadsheets: SheetJS · Word: Mammoth (already bundled) · PDF: built-in reader (pdftext.js)
import { pdfText } from './pdftext.js';
import { loadScript } from './util.js';
import { SHEETJS_URL } from '../config.js';

const MAX_PDF = 20 * 1024 * 1024;
let XLSX = null;

export const readable = (kind) => ['xlsx', 'xls', 'csv', 'docx', 'pdf'].includes(kind);

/** → { tables: [{ name, rows }], text, pages?, error? } */
export async function readFile(blob, kind) {
  if (kind === 'xlsx' || kind === 'xls' || kind === 'csv') {
    XLSX ||= await import(SHEETJS_URL);
    const wb = kind === 'csv'
      ? XLSX.read(await blob.text(), { type: 'string', raw: true })          // keep phone numbers as text
      : XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array', sheetRows: 5001 });
    const tables = wb.SheetNames.slice(0, 12).map(name => ({
      name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '', blankrows: false }),
    }));
    return { tables, text: '' };
  }
  if (kind === 'docx') {
    await loadScript('assets/vendor/mammoth.browser.min.js');
    const buf = await blob.arrayBuffer();
    const [html, raw] = await Promise.all([
      window.mammoth.convertToHtml({ arrayBuffer: buf }),
      window.mammoth.extractRawText({ arrayBuffer: buf.slice(0) }),
    ]);
    // DOMParser documents are inert (no scripts run, nothing loads).
    const doc = new DOMParser().parseFromString(html.value, 'text/html');
    const cellText = (td) => [...td.querySelectorAll('p')].map(p => p.textContent.trim()).filter(Boolean).join('\n') || td.textContent.trim();
    const tables = [...doc.querySelectorAll('table')].map((t, i) => ({
      name: `Table ${i + 1}`,
      rows: [...t.querySelectorAll('tr')].map(tr => [...tr.children].flatMap(td => { const v = cellText(td); return Array(Math.min(+td.getAttribute('colspan') || 1, 31)).fill(v).map((x, k) => (k ? '' : x)); })),
    }));
    const text = raw.value.replace(/\n{3,}/g, '\n\n').trim();
    return { tables, text };
  }
  if (kind === 'pdf') {
    if (blob.size > MAX_PDF) return { tables: [], text: '', error: 'This PDF is over 20 MB, so it is stored but not read.' };
    const r = await pdfText(new Uint8Array(await blob.arrayBuffer()));
    if (r.error === 'encrypted') return { tables: [], text: '', error: 'This PDF is password-protected, so its text cannot be read.' };
    if (r.error === 'no_text') return { tables: [], text: '', error: 'This PDF has no text inside (it is probably a scanned image or photo), so nothing could be read.' };
    if (r.error) return { tables: [], text: '', error: 'This file could not be read as a PDF.' };
    const lines = r.pages.flatMap(p => p.lines);
    return { tables: [{ name: 'PDF', rows: lines.map(l => l.cells) }], text: lines.map(l => l.text).join('\n'), pages: r.pages.length };
  }
  return { tables: [], text: '' };
}
