// Allow-list HTML sanitizer for converted Word documents (Mammoth output).
// Anything not listed is dropped: unknown elements are unwrapped (text kept),
// dangerous ones are removed with their content, and only a few attributes survive.

const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'FRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'BASE', 'FORM', 'INPUT', 'BUTTON',
  'SELECT', 'TEXTAREA', 'OPTION', 'SVG', 'MATH', 'TEMPLATE', 'NOSCRIPT', 'AUDIO', 'VIDEO', 'SOURCE', 'TRACK', 'CANVAS', 'DIALOG', 'PORTAL']);
const KEEP = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'SUP', 'SUB', 'A', 'IMG', 'UL', 'OL', 'LI',
  'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'BR', 'BLOCKQUOTE', 'SPAN', 'DIV', 'PRE', 'CODE', 'HR']);
const ATTRS = { A: ['href'], IMG: ['src', 'alt', 'width', 'height'], TD: ['colspan', 'rowspan'], TH: ['colspan', 'rowspan'], OL: ['start'] };

const okHref = (v) => /^(https?:|mailto:)/i.test(v);           // no "#…": a hash link would navigate the app's router
const okSrc = (v) => /^data:image\/(png|jpe?g|gif|bmp|webp);base64,[a-z0-9+/=\s]+$/i.test(v);

function clean(node) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 3) continue;                         // text
    if (child.nodeType !== 1) { child.remove(); continue; }    // comments, processing instructions
    const tag = child.tagName.toUpperCase();
    if (DROP.has(tag)) { child.remove(); continue; }
    clean(child);
    if (!KEEP.has(tag)) { child.replaceWith(...child.childNodes); continue; }
    const allowed = ATTRS[tag] || [];
    for (const a of [...child.attributes]) {
      const v = a.value.trim();
      const keep = allowed.includes(a.name) &&
        (a.name === 'href' ? okHref(v) : a.name === 'src' ? okSrc(v) : /^[\w .%-]{0,200}$/.test(v));
      if (!keep) child.removeAttribute(a.name);
    }
    if (tag === 'A' && child.hasAttribute('href')) { child.setAttribute('target', '_blank'); child.setAttribute('rel', 'noopener noreferrer'); }
  }
}

/** Returns a detached <div> holding only safe nodes. */
export function sanitizeHTML(html) {
  const doc = new DOMParser().parseFromString(`<!doctype html><body><div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  clean(root);
  return root;
}
