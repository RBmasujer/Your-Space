// Compatibility shim — keep this file.
// Copies of the app opened before "LTO Calculator" was renamed "Quotation" still have the old
// menu in memory and load this file when it is tapped. Instead of an error, refresh the app's
// files past the browser cache and open the new Quotation page.
export async function render(el) {
  el.innerHTML = '<div class="card"><h2>Updating Your Space…</h2><p class="muted">The LTO Calculator is now called <b>Quotation</b>. Loading the latest version…</p></div>';
  const urls = performance.getEntriesByType('resource').map(r => r.name)
    .filter(u => u.startsWith(location.origin) && /\.(m?js|css)(\?|$)/.test(u));
  urls.push(new URL('../main.js', import.meta.url).href, new URL('./quotation.js', import.meta.url).href, location.origin + location.pathname);
  await Promise.all(urls.map(u => fetch(u, { cache: 'reload' }).catch(() => {})));
  history.replaceState(null, '', `${location.pathname}#/quotation${location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?')) : ''}`);
  location.reload();
}
