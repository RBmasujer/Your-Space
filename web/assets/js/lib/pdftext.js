// Built-in PDF text reader (no library). Reads the text of normal "digital" PDFs —
// Word/Excel/Google Docs "Save as PDF", browser prints, most generated reports —
// and rebuilds lines and table cells from the text positions.
// Not supported: scanned images (no text inside), password-protected files.
//
//   const { pages, error } = await pdfText(uint8Array)
//   pages = [{ lines: [{ text, cells: [..] }] }]

import { W_REG, W_BOLD } from './pdf.js';

// ── Low-level parsing ───────────────────────────────────────────────────────
const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);
const CP1252 = { 128: 8364, 130: 8218, 131: 402, 132: 8222, 133: 8230, 134: 8224, 135: 8225, 136: 710, 137: 8240, 138: 352, 139: 8249, 140: 338, 142: 381, 145: 8216, 146: 8217, 147: 8220, 148: 8221, 149: 8226, 150: 8211, 151: 8212, 152: 732, 153: 8482, 154: 353, 155: 8250, 156: 339, 158: 382, 159: 376 };
const latin = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return s; };

class Ref { constructor(n, g) { this.n = n; this.g = g; } }
class Name { constructor(v) { this.v = v; } }
class Op { constructor(v) { this.v = v; } }

/** Tokenizer/parser over a latin-1 string (each char = one byte). */
class Lexer {
  constructor(s, pos = 0) { this.s = s; this.p = pos; }
  ws() {
    const s = this.s;
    for (;;) {
      const c = s.charCodeAt(this.p);
      if (WS.has(c)) this.p++;
      else if (c === 37) { while (this.p < s.length && s[this.p] !== '\n' && s[this.p] !== '\r') this.p++; }
      else return;
    }
  }
  value(allowOps = false) {
    this.ws();
    const s = this.s, c = s[this.p];
    if (this.p >= s.length) return undefined;
    if (c === '<' && s[this.p + 1] === '<') {
      this.p += 2; const d = {};
      for (;;) {
        this.ws();
        if (s[this.p] === '>' && s[this.p + 1] === '>') { this.p += 2; return d; }
        if (this.p >= s.length) return d;
        const k = this.value();
        if (!(k instanceof Name)) { this.p++; continue; }
        d[k.v] = this.value();
      }
    }
    if (c === '<') {
      const end = s.indexOf('>', this.p); const hex = s.slice(this.p + 1, end < 0 ? s.length : end).replace(/[^0-9a-f]/gi, '');
      this.p = end < 0 ? s.length : end + 1;
      let out = ''; for (let i = 0; i < hex.length; i += 2) out += String.fromCharCode(parseInt((hex.slice(i, i + 2) + '0').slice(0, 2), 16));
      return out;
    }
    if (c === '(') return this.literal();
    if (c === '[') {
      this.p++; const a = [];
      for (;;) { this.ws(); if (s[this.p] === ']' || this.p >= s.length) { this.p++; return a; } const v = this.value(allowOps); if (v === undefined) return a; a.push(v); }
    }
    if (c === '/') {
      let e = this.p + 1; while (e < s.length && !WS.has(s.charCodeAt(e)) && !DELIM.has(s.charCodeAt(e))) e++;
      const v = s.slice(this.p + 1, e).replace(/#([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
      this.p = e; return new Name(v);
    }
    if (c === ']' || c === '>' || c === ')' || c === '{' || c === '}') { this.p++; return allowOps ? new Op(c) : null; }
    let e = this.p; while (e < s.length && !WS.has(s.charCodeAt(e)) && !DELIM.has(s.charCodeAt(e))) e++;
    if (e === this.p) e++;
    const tok = s.slice(this.p, e); this.p = e;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) {
      if (!allowOps && /^\d+$/.test(tok)) {             // "n g R" reference?
        const save = this.p; const m = /^\s+(\d+)\s+R(?![^\s/<>[\]()%])/.exec(s.slice(this.p, this.p + 24));
        if (m) { this.p += m[0].length; return new Ref(+tok, +m[1]); }
        this.p = save;
      }
      return parseFloat(tok);
    }
    if (tok === 'true') return true;
    if (tok === 'false') return false;
    if (tok === 'null') return null;
    return allowOps ? new Op(tok) : tok;
  }
  literal() {
    const s = this.s; let depth = 0, out = ''; this.p++;
    while (this.p < s.length) {
      const c = s[this.p++];
      if (c === '\\') {
        const n = s[this.p++];
        const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
        if (n in map) out += map[n];
        else if (n >= '0' && n <= '7') { let o = n; while (o.length < 3 && s[this.p] >= '0' && s[this.p] <= '7') o += s[this.p++]; out += String.fromCharCode(parseInt(o, 8) & 255); }
        else if (n === '\r') { if (s[this.p] === '\n') this.p++; }
        else if (n !== '\n') out += n;
      } else if (c === '(') { depth++; out += c; }
      else if (c === ')') { if (depth-- === 0) return out; out += c; }
      else out += c;
    }
    return out;
  }
}

async function inflate(u8) {
  // Read chunk by chunk so a stream with trailing junk still yields what was decoded.
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  writer.write(u8).catch(() => {}); writer.close().catch(() => {});
  const reader = ds.readable.getReader(); const parts = []; let len = 0;
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; parts.push(value); len += value.length; } } catch { /* keep partial output */ }
  const out = new Uint8Array(len); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function a85(s) {
  s = s.replace(/\s/g, '').replace(/^<~/, '').replace(/~>.*$/, '');
  const out = []; let tuple = [];
  for (const ch of s) {
    if (ch === 'z' && !tuple.length) { out.push(0, 0, 0, 0); continue; }
    tuple.push(ch.charCodeAt(0) - 33);
    if (tuple.length === 5) { let v = tuple.reduce((a, d) => a * 85 + d, 0); out.push(v >>> 24 & 255, v >>> 16 & 255, v >>> 8 & 255, v & 255); tuple = []; }
  }
  if (tuple.length) { const n = tuple.length; while (tuple.length < 5) tuple.push(84); const v = tuple.reduce((a, d) => a * 85 + d, 0); for (let i = 0; i < n - 1; i++) out.push(v >>> (24 - 8 * i) & 255); }
  return new Uint8Array(out);
}

class Doc {
  constructor(u8) {
    this.u8 = u8; this.s = latin(u8); this.offsets = new Map(); this.cache = new Map(); this.extra = new Map();
    const re = /(\d+)\s+(\d+)\s+obj\b/g; let m;
    while ((m = re.exec(this.s))) this.offsets.set(+m[1], m.index + m[0].length); // later definitions win (incremental updates)
  }
  get(v) { let guard = 0; while (v instanceof Ref && guard++ < 20) v = this.obj(v.n); return v; }
  obj(n) {
    if (this.cache.has(n)) return this.cache.get(n);
    let val = null;
    if (this.offsets.has(n)) {
      const lx = new Lexer(this.s, this.offsets.get(n));
      val = lx.value();
      lx.ws();
      if (val && typeof val === 'object' && this.s.startsWith('stream', lx.p)) {
        let st = lx.p + 6; if (this.s[st] === '\r') st++; if (this.s[st] === '\n') st++;
        let len = this.get(val.Length);
        if (typeof len !== 'number' || this.s.slice(st + len, st + len + 12).indexOf('endstream') < 0) {
          const e = this.s.indexOf('endstream', st); len = (e < 0 ? this.s.length : e) - st;
          while (len > 0 && (this.s[st + len - 1] === '\n' || this.s[st + len - 1] === '\r')) len--;
        }
        val = { dict: val, raw: this.u8.subarray(st, st + len), stream: true };
      }
    } else if (this.extra.has(n)) val = this.extra.get(n);
    this.cache.set(n, val);
    return val;
  }
  async data(stream) {
    if (!stream?.stream) return null;
    if (stream.decoded) return stream.decoded;
    let f = this.get(stream.dict.Filter), d = stream.raw;
    f = Array.isArray(f) ? f.map(x => this.get(x)) : f ? [f] : [];
    for (const x of f) {
      const n = x instanceof Name ? x.v : '';
      if (n === 'FlateDecode' || n === 'Fl') d = await inflate(d);
      else if (n === 'ASCIIHexDecode' || n === 'AHx') { const h = latin(d).replace(/[^0-9a-f]/gi, ''); d = Uint8Array.from(h.match(/../g) || [], x2 => parseInt(x2, 16)); }
      else if (n === 'ASCII85Decode' || n === 'A85') d = a85(latin(d));
      else return null; // images (DCT, JBIG2…) — not text
    }
    return (stream.decoded = d);
  }
  async loadObjectStreams() {
    for (const n of this.offsets.keys()) {
      const o = this.obj(n);
      if (!o?.stream || this.get(o.dict.Type)?.v !== 'ObjStm') continue;
      const d = await this.data(o); if (!d) continue;
      const s = latin(d), N = this.get(o.dict.N) || 0, first = this.get(o.dict.First) || 0;
      const head = s.slice(0, first).trim().split(/\s+/).map(Number);
      for (let i = 0; i < N; i++) {
        const num = head[2 * i], off = head[2 * i + 1];
        if (!this.offsets.has(num) && !this.extra.has(num)) this.extra.set(num, new Lexer(s, first + off).value());
      }
    }
  }
}

// ── Fonts: byte codes → Unicode text + widths ───────────────────────────────
const GLYPH = { space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%', ampersand: '&', quotesingle: "'", quoteright: '’', quoteleft: '‘', parenleft: '(', parenright: ')', asterisk: '*', plus: '+', comma: ',', hyphen: '-', minus: '-', period: '.', slash: '/', zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', colon: ':', semicolon: ';', less: '<', equal: '=', greater: '>', question: '?', at: '@', bracketleft: '[', backslash: '\\', bracketright: ']', underscore: '_', braceleft: '{', bar: '|', braceright: '}', asciitilde: '~', bullet: '•', endash: '–', emdash: '—', quotedblleft: '“', quotedblright: '”', ellipsis: '…', ntilde: 'ñ', Ntilde: 'Ñ', eacute: 'é', fi: 'fi', fl: 'fl', nbspace: ' ', peso: '₱' };
const glyphToChar = (g) => GLYPH[g] ?? (/^[A-Za-z]$/.test(g) ? g : /^uni([0-9A-F]{4})/i.test(g) ? String.fromCharCode(parseInt(g.slice(3, 7), 16)) : /^u([0-9A-F]{4,6})$/i.test(g) ? String.fromCodePoint(parseInt(g.slice(1), 16)) : '');
const utf16 = (bin) => { let o = ''; for (let i = 0; i + 1 < bin.length; i += 2) o += String.fromCharCode(bin.charCodeAt(i) << 8 | bin.charCodeAt(i + 1)); return o; };

function parseCMap(s) {
  const map = new Map(); let bytes = 1;
  const cs = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(s);
  if (cs) { const h = /<([0-9a-f]+)>/i.exec(cs[1]); if (h) bytes = Math.max(1, h[1].length / 2); }
  const hex = (h) => h.replace(/\s/g, '');
  const str = (h) => { h = hex(h); let o = ''; for (let i = 0; i < h.length; i += 4) o += String.fromCharCode(parseInt(h.slice(i, i + 4).padEnd(4, '0'), 16)); return o; };
  for (const blk of s.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const m of blk[1].matchAll(/<([0-9a-f\s]+)>\s*<([0-9a-f\s]*)>/gi)) map.set(parseInt(hex(m[1]), 16), str(m[2]));
  for (const blk of s.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of blk[1].matchAll(/<([0-9a-f\s]+)>\s*<([0-9a-f\s]+)>\s*(<[0-9a-f\s]*>|\[[^\]]*\])/gi)) {
      const lo = parseInt(hex(m[1]), 16), hi = Math.min(parseInt(hex(m[2]), 16), lo + 65535);
      if (m[3][0] === '[') { const items = [...m[3].matchAll(/<([0-9a-f\s]*)>/gi)]; for (let c = lo; c <= hi && c - lo < items.length; c++) map.set(c, str(items[c - lo][1])); }
      else { const base = hex(m[3].slice(1, -1)); const head = base.slice(0, -4), last = parseInt(base.slice(-4) || '0', 16); for (let c = lo; c <= hi; c++) map.set(c, str(head) + String.fromCharCode(last + c - lo)); }
    }
  }
  return { map, bytes };
}

async function loadFont(doc, fd) {
  fd = doc.get(fd) || {};
  const sub = doc.get(fd.Subtype)?.v;
  const f = { twoByte: sub === 'Type0', widths: new Map(), dw: 1000, scale: 1, toU: null, enc: null };
  const tu = doc.get(fd.ToUnicode);
  if (tu?.stream) { const d = await doc.data(tu); if (d) { const c = parseCMap(latin(d)); f.toU = c.map; if (sub !== 'Type0') f.twoByte = c.bytes === 2; } }
  if (sub === 'Type0') {
    const desc = doc.get(doc.get(fd.DescendantFonts)?.[0]) || {};
    f.dw = doc.get(desc.DW) ?? 1000;
    const W = doc.get(desc.W) || [];
    for (let i = 0; i < W.length;) {
      const a = doc.get(W[i]), b = doc.get(W[i + 1]);
      if (Array.isArray(b)) { b.forEach((w, k) => f.widths.set(a + k, doc.get(w))); i += 2; }
      else { const w = doc.get(W[i + 2]); for (let c = a; c <= b && c - a < 65536; c++) f.widths.set(c, w); i += 3; }
    }
  } else {
    const first = doc.get(fd.FirstChar) ?? 0, W = doc.get(fd.Widths) || [];
    W.forEach((w, k) => f.widths.set(first + k, doc.get(w)));
    f.dw = 500;
    if (!W.length) { // the standard 14 fonts may omit /Widths: use built-in metrics
      const base = doc.get(fd.BaseFont)?.v || '';
      if (/Courier/i.test(base)) f.dw = 600;
      else { const t = /Bold/i.test(base) ? W_BOLD : W_REG, k = /Times/i.test(base) ? 0.92 : 1; t.forEach((w, i) => f.widths.set(32 + i, w * k)); }
    }
    if (sub === 'Type3') { const fm = doc.get(fd.FontMatrix); f.scale = Array.isArray(fm) ? (doc.get(fm[0]) || 0.001) * 1000 : 1; }
    const enc = doc.get(fd.Encoding);
    if (enc && !(enc instanceof Name)) {
      const diff = doc.get(enc.Differences) || []; let code = 0; f.enc = new Map();
      for (const x of diff) { const v = doc.get(x); if (typeof v === 'number') code = v; else if (v instanceof Name) f.enc.set(code++, glyphToChar(v.v)); }
    }
  }
  return f;
}

function decodeText(f, bin) {
  const out = []; // [{ ch, w }]
  const step = f.twoByte ? 2 : 1;
  for (let i = 0; i < bin.length; i += step) {
    const code = step === 2 ? (bin.charCodeAt(i) << 8 | (bin.charCodeAt(i + 1) || 0)) : bin.charCodeAt(i);
    let ch = f.toU?.get(code);
    if (ch == null && f.enc?.has(code)) ch = f.enc.get(code);
    if (ch == null) ch = step === 2 ? '' : String.fromCharCode(CP1252[code] || code);
    out.push({ ch, code, w: (f.widths.get(code) ?? f.dw) * f.scale });
  }
  return out;
}

// ── Content streams → positioned text ───────────────────────────────────────
const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];

async function runContent(doc, data, resources, ctm0, items, depth = 0) {
  if (!data || depth > 6) return;
  resources = doc.get(resources) || {};
  const fontDict = doc.get(resources.Font) || {}, xobjs = doc.get(resources.XObject) || {};
  const fonts = new Map();
  const lx = new Lexer(latin(data));
  let st = { ctm: ctm0, font: null, size: 10, Tc: 0, Tw: 0, Tz: 1, TL: 0 };
  const stack = []; let tm = [1, 0, 0, 1, 0, 0], tlm = tm; let ops = [];
  const show = (bin) => {
    if (!st.font) return;
    const glyphs = decodeText(st.font, bin);
    let text = '', adv = 0;
    const trm = mul([st.size * st.Tz, 0, 0, st.size, 0, 0], mul(tm, st.ctm));
    for (const g of glyphs) {
      text += g.ch;
      adv += ((g.w / 1000) * st.size + st.Tc + (g.ch === ' ' && !st.font.twoByte ? st.Tw : 0)) * st.Tz;
    }
    const scale = Math.hypot(tm[0], tm[1]) * Math.hypot(st.ctm[0], st.ctm[1]) || 1;
    if (text.trim()) items.push({ x: trm[4], y: trm[5], w: adv * scale, size: Math.abs(Math.hypot(trm[2], trm[3])) || st.size, text });
    tm = mul([1, 0, 0, 1, adv, 0], tm);
  };
  for (;;) {
    const t = lx.value(true);
    if (t === undefined) break;
    if (!(t instanceof Op)) { ops.push(t); continue; }
    const o = t.v, a = ops; ops = [];
    switch (o) {
      case 'q': stack.push({ ...st }); break;
      case 'Q': if (stack.length) st = stack.pop(); break;
      case 'cm': if (a.length >= 6) st.ctm = mul(a.slice(-6), st.ctm); break;
      case 'BT': tm = tlm = [1, 0, 0, 1, 0, 0]; break;
      case 'Tf': {
        const nm = a[a.length - 2]?.v; st.size = a[a.length - 1] ?? st.size;
        if (!fonts.has(nm)) fonts.set(nm, await loadFont(doc, fontDict[nm]));
        st.font = fonts.get(nm); break;
      }
      case 'Tc': st.Tc = a[0] ?? 0; break;
      case 'Tw': st.Tw = a[0] ?? 0; break;
      case 'Tz': st.Tz = (a[0] ?? 100) / 100; break;
      case 'TL': st.TL = a[0] ?? 0; break;
      case 'Td': tm = tlm = mul([1, 0, 0, 1, a[0] || 0, a[1] || 0], tlm); break;
      case 'TD': st.TL = -(a[1] || 0); tm = tlm = mul([1, 0, 0, 1, a[0] || 0, a[1] || 0], tlm); break;
      case 'Tm': if (a.length >= 6) tm = tlm = a.slice(-6); break;
      case 'T*': tm = tlm = mul([1, 0, 0, 1, 0, -st.TL], tlm); break;
      case 'Tj': if (typeof a[0] === 'string') show(a[0]); break;
      case "'": tm = tlm = mul([1, 0, 0, 1, 0, -st.TL], tlm); if (typeof a[0] === 'string') show(a[0]); break;
      case '"': st.Tw = a[0] || 0; st.Tc = a[1] || 0; tm = tlm = mul([1, 0, 0, 1, 0, -st.TL], tlm); if (typeof a[2] === 'string') show(a[2]); break;
      case 'TJ':
        for (const e of (Array.isArray(a[0]) ? a[0] : [])) {
          if (typeof e === 'string') show(e);
          else if (typeof e === 'number') tm = mul([1, 0, 0, 1, (-e / 1000) * st.size * st.Tz, 0], tm);
        }
        break;
      case 'Do': {
        const x = doc.get(xobjs[a[0]?.v]);
        if (x?.stream && doc.get(x.dict.Subtype)?.v === 'Form') {
          const m = doc.get(x.dict.Matrix); const mx = Array.isArray(m) && m.length === 6 ? m.map(v => doc.get(v)) : [1, 0, 0, 1, 0, 0];
          await runContent(doc, await doc.data(x), x.dict.Resources || resources, mul(mx, st.ctm), items, depth + 1);
        }
        break;
      }
      case 'ID': { // inline image: skip binary data up to "EI"
        const m = /\sEI(?=[\s]|$)/.exec(lx.s.slice(lx.p)); lx.p = m ? lx.p + m.index + 3 : lx.s.length; break;
      }
      default: break;
    }
  }
}

/** Group positioned text into lines, split lines into segments at visible gaps,
 *  then line segments up under a table's header row so each becomes a cell. */
export function toLines(items) {
  const rows = [];
  for (const it of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const tol = Math.max(1.5, it.size * 0.45);
    const row = rows.find(r => Math.abs(r.y - it.y) <= tol);
    if (row) row.items.push(it); else rows.push({ y: it.y, items: [it] });
  }
  rows.sort((a, b) => b.y - a.y);
  const lines = rows.map(r => {
    const segs = []; let cur = null, end = null;
    for (const it of r.items.sort((a, b) => a.x - b.x)) {
      const gap = end == null ? 0 : it.x - end;
      if (!cur || gap > Math.max(it.size * 0.6, 3)) { cur = { x: it.x, end: it.x + it.w, text: it.text }; segs.push(cur); }
      else cur.text += (gap > it.size * 0.15 && !/\s$/.test(cur.text) && !/^\s/.test(it.text) ? ' ' : '') + it.text;
      end = Math.max(end ?? -Infinity, it.x + it.w); cur.end = end;
    }
    for (const g of segs) g.text = g.text.replace(/\s+/g, ' ').trim();
    return segs.filter(g => g.text);
  }).filter(l => l.length);
  return tableize(lines);
}

const looksHeader = (segs) => segs.length >= 3 && segs.every(g => /[a-z]/i.test(g.text) && !/\d{3,}|\d+[/:]\d+/.test(g.text) && g.text.length <= 40);

export function tableize(lines) {
  const out = lines.map(segs => ({ text: segs.map(g => g.text).join('  '), cells: segs.map(g => g.text) }));
  for (let h = 0; h < lines.length; h++) {
    if (!looksHeader(lines[h])) continue;
    // table block: rows after the header, until a new header or text that starts well left of it
    let e = h + 1;
    while (e < lines.length && !looksHeader(lines[e]) && !(lines[e].length === 1 && lines[e][0].x < lines[h][0].x - 20)) e++;
    const block = lines.slice(h + 1, e).filter(l => l.length >= 2);
    if (!block.length) continue;
    // Column starts = where data cells start (left-aligned), plus header cells over empty columns.
    const xs = block.flat().map(g => g.x).sort((a, b) => a - b), starts = [];
    for (const x of xs) { const c = starts.at(-1); if (c && x - c.max <= 6) { c.max = x; c.n++; } else starts.push({ min: x, max: x, n: 1 }); }
    let cols = starts.filter(c => c.n >= Math.max(1, Math.ceil(block.length * 0.2))).map(c => c.min);
    for (const g of lines[h]) if (!cols.some(x => x >= g.x - 6 && x <= g.end + 6) && !cols.some((x, i) => x <= g.x && (cols[i + 1] ?? Infinity) > g.end)) cols.push(g.x);
    cols.sort((a, b) => a - b);
    const place = (segs) => {
      const cells = cols.map(() => '');
      for (const g of segs) { let k = 0; for (let i = 0; i < cols.length; i++) if (g.x >= cols[i] - 6) k = i; cells[k] = cells[k] ? `${cells[k]} ${g.text}` : g.text; }
      return { text: cells.filter(Boolean).join('  '), cells };
    };
    out[h] = place(lines[h]);
    for (let i = h + 1; i < e; i++) if (lines[i].length >= 2) out[i] = place(lines[i]);
    h = e - 1;
  }
  return out;
}

export async function pdfText(u8, { maxPages = 200 } = {}) {
  if (!(u8 instanceof Uint8Array)) u8 = new Uint8Array(u8);
  const doc = new Doc(u8);
  if (!doc.s.startsWith('%PDF')) return { pages: [], error: 'not_pdf' };
  if (/\/Encrypt\s*(\d+\s+\d+\s+R|<<)/.test(doc.s)) return { pages: [], error: 'encrypted' };
  await doc.loadObjectStreams();
  // Page order: follow the page tree from the catalog; fall back to object order.
  const pages = [];
  const roots = [...doc.s.matchAll(/\/Root\s+(\d+)\s+\d+\s+R/g)];
  const walk = (node, inherited, seen = new Set()) => {
    node = doc.get(node); if (!node || seen.has(node) || pages.length >= maxPages) return; seen.add(node);
    const res = node.Resources ?? inherited;
    if (doc.get(node.Type)?.v === 'Pages' || node.Kids) for (const k of doc.get(node.Kids) || []) walk(k, res, seen);
    else pages.push({ node, res });
  };
  if (roots.length) walk(doc.get(doc.obj(+roots.at(-1)[1]))?.Pages, null);
  if (!pages.length) for (const n of [...doc.offsets.keys(), ...doc.extra.keys()].sort((a, b) => a - b)) { const o = doc.obj(n); if (o && !o.stream && doc.get(o.Type)?.v === 'Page') pages.push({ node: o, res: o.Resources }); if (pages.length >= maxPages) break; }

  const out = [];
  for (const { node, res } of pages) {
    let contents = doc.get(node.Contents); contents = Array.isArray(contents) ? contents : contents ? [contents] : [];
    const parts = [];
    for (const c of contents) { const d = await doc.data(doc.get(c)); if (d) parts.push(latin(d)); }
    const items = [];
    const joined = parts.join('\n');
    const u = new Uint8Array(joined.length); for (let i = 0; i < joined.length; i++) u[i] = joined.charCodeAt(i);
    try { await runContent(doc, u, res, [1, 0, 0, 1, 0, 0], items); } catch { /* keep what was read */ }
    out.push({ lines: toLines(items) });
  }
  const chars = out.reduce((a, p) => a + p.lines.reduce((b, l) => b + l.text.length, 0), 0);
  return { pages: out, error: !pages.length ? 'no_pages' : chars === 0 ? 'no_text' : null };
}
