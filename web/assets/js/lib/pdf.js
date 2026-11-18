// Tiny dependency-free PDF writer (text, lines, rectangles, multiple pages).
// Uses the 14 standard PDF fonts (Helvetica / Helvetica-Bold) with WinAnsi encoding,
// so no font files are embedded and every PDF reader can open the result.
// Coordinates are in points (1/72 inch) from the TOP-LEFT corner; text y = baseline.

// Advance widths (per 1000 em) for ASCII 32–126 from the Adobe AFM files.
const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
// Unicode → WinAnsi (0x80–0x9F block); 0xA0–0xFF map 1:1 to Latin-1.
const WIN = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8A, '‹': 0x8B, 'Œ': 0x8C, 'Ž': 0x8E,
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9A, '›': 0x9B, 'œ': 0x9C, 'ž': 0x9E, 'Ÿ': 0x9F };
const W_HIGH = { 0x85: 1000, 0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333, 0x95: 350, 0x96: 556, 0x97: 1000, 0x99: 1000, 0xB7: 278 };

/** Convert any JS string to WinAnsi byte codes (0–255). Unknown characters become '?'. */
export function winAnsi(str) {
  const out = [];
  for (const ch of String(str ?? '').replace(/₱/g, 'PHP ').replace(/[\r\n\t]+/g, ' ')) {
    const c = ch.codePointAt(0);
    if (c >= 32 && c < 127) out.push(c);
    else if (c >= 0xA0 && c <= 0xFF) out.push(c);
    else if (WIN[ch]) out.push(WIN[ch]);
    else {
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (base && base.codePointAt(0) < 127) out.push(base.codePointAt(0)); else out.push(63);
    }
  }
  return out;
}

const charW = (c, bold) => (c >= 32 && c < 127 ? (bold ? W_BOLD : W_REG)[c - 32] : W_HIGH[c] ?? 556);
/** Width of a string in points. */
export const textWidth = (str, size, bold = false) => winAnsi(str).reduce((a, c) => a + charW(c, bold), 0) * size / 1000;

const num = (n) => (Math.round(n * 100) / 100).toString();
function rgb(color) {
  if (Array.isArray(color)) return color.map(num).join(' ');
  const h = String(color || '#000').replace('#', '');
  const v = h.length === 3 ? h.split('').map(x => x + x).join('') : h;
  return [0, 2, 4].map(i => num(parseInt(v.slice(i, i + 2), 16) / 255)).join(' ');
}
const pdfString = (codes) => '(' + codes.map(c => (c === 40 || c === 41 || c === 92 ? '\\' + String.fromCharCode(c) : String.fromCharCode(c))).join('') + ')';

export class PDF {
  constructor({ width = 595.28, height = 841.89, title = 'Document', author = '' } = {}) {
    Object.assign(this, { W: width, H: height, title, author, pages: [], cur: null });
    this.addPage();
  }
  addPage() { this.cur = []; this.pages.push(this.cur); return this.pages.length - 1; }
  setPage(i) { this.cur = this.pages[i]; }
  get pageCount() { return this.pages.length; }

  /** Shorten a string with "..." so it fits maxWidth. */
  fit(str, size, bold, maxWidth) {
    let s = String(str ?? '');
    if (!maxWidth || textWidth(s, size, bold) <= maxWidth) return s;
    while (s && textWidth(s + '...', size, bold) > maxWidth) s = s.slice(0, -1);
    return s.trimEnd() + '...';
  }
  /** Word-wrap into lines no wider than maxWidth. */
  wrap(str, size, bold, maxWidth) {
    const lines = []; let line = '';
    for (const word of String(str ?? '').split(/\s+/).filter(Boolean)) {
      const next = line ? line + ' ' + word : word;
      if (textWidth(next, size, bold) <= maxWidth) line = next;
      else { if (line) lines.push(line); line = this.fit(word, size, bold, maxWidth); }
    }
    if (line) lines.push(line);
    return lines;
  }

  text(str, x, y, { size = 10, bold = false, color = '#000', align = 'left', maxWidth } = {}) {
    const s = this.fit(str, size, bold, maxWidth);
    const w = textWidth(s, size, bold);
    const px = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    this.cur.push(`BT /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${rgb(color)} rg 1 0 0 1 ${num(px)} ${num(this.H - y)} Tm ${pdfString(winAnsi(s))} Tj ET`);
    return w;
  }
  rect(x, y, w, h, { fill, stroke, lineWidth = 0.75 } = {}) {
    const ops = [];
    if (fill) ops.push(`${rgb(fill)} rg`);
    if (stroke) ops.push(`${rgb(stroke)} RG ${num(lineWidth)} w`);
    ops.push(`${num(x)} ${num(this.H - y - h)} ${num(w)} ${num(h)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
    this.cur.push(ops.join(' '));
  }
  line(x1, y1, x2, y2, { color = '#000', width = 0.75, dash } = {}) {
    this.cur.push(`${rgb(color)} RG ${num(width)} w ${dash ? `[${dash.join(' ')}] 0 d` : '[] 0 d'} ${num(x1)} ${num(this.H - y1)} m ${num(x2)} ${num(this.H - y2)} l S [] 0 d`);
  }

  /** Serialize to bytes. */
  toBytes() {
    const objs = [];              // index i → object number i+1
    const add = (body) => { objs.push(body); return objs.length; };
    const catalog = add(null), pagesObj = add(null);
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = this.pages.map(ops => {
      const stream = ops.join('\n');
      const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      return add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${num(this.W)} ${num(this.H)}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`);
    });
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
    objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    const stamp = `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
    const info = add(`<< /Title ${pdfString(winAnsi(this.title))} /Author ${pdfString(winAnsi(this.author))} /Producer (Your Space) /CreationDate (${stamp}) >>`);

    // Every character is one byte (all text was mapped to WinAnsi), so string length = byte offset.
    let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets = objs.map((body, i) => { const at = out.length; out += `${i + 1} 0 obj\n${body}\nendobj\n`; return at; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xFF;
    return bytes;
  }
  toBlob() { return new Blob([this.toBytes()], { type: 'application/pdf' }); }
}
