// Light / dark theme. Loaded as a normal (blocking) script in <head> so the saved
// theme is applied before the first paint — no white flash in dark mode.
// No saved choice = follow the phone/computer setting.
(function () {
  // Clickjacking guard: GitHub Pages can't send X-Frame-Options and <meta> CSP ignores
  // frame-ancestors, so refuse to show the app inside someone else's frame.
  if (window.top !== window.self) {
    document.documentElement.style.display = 'none';
    try { window.top.location.replace(window.self.location.href); } catch (e) { /* cross-origin sandbox: stay hidden */ }
    return;
  }
  var KEY = 'ys-theme';
  var root = document.documentElement;
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  function saved() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function effective() { var s = saved(); return s === 'light' || s === 'dark' ? s : (mq.matches ? 'dark' : 'light'); }
  function apply() {
    var t = effective();
    root.setAttribute('data-theme', t);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#0c1a2b' : '#1b6fb5');
    document.dispatchEvent(new CustomEvent('themechange', { detail: t }));
  }
  window.ysTheme = {
    get: effective,
    pref: function () { var s = saved(); return s === 'light' || s === 'dark' ? s : ''; }, // '' = follow device
    set: function (t) {
      try { if (t === 'light' || t === 'dark') localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); } catch (e) { /* private mode */ }
      apply();
    },
    toggle: function () { this.set(effective() === 'dark' ? 'light' : 'dark'); },
  };
  mq.addEventListener('change', function () { if (!saved()) apply(); });
  apply();

  // Right after a deploy, GitHub Pages' 10-minute cache can hand the browser a new main.js
  // with an old lib/*.js ("does not provide an export named …") and the app never starts.
  // Re-fetch every script/stylesheet past the cache once, then reload.
  window.addEventListener('error', function (e) {
    var msg = String((e && e.message) || '');
    if (!/does not provide an export|Importing a module script failed|Failed to fetch dynamically imported module/i.test(msg)) return;
    var tried = false;
    try { tried = sessionStorage.getItem('ys-refetched') === '1'; sessionStorage.setItem('ys-refetched', '1'); } catch (x) { /* ignore */ }
    var app = document.getElementById('app');
    if (tried) {
      if (app) app.innerHTML = '<div class="boot">Your Space was just updated. Please close this tab and open it again (or wait a few minutes).</div>';
      return;
    }
    if (app) app.innerHTML = '<div class="boot">Updating Your Space…</div>';
    var urls = performance.getEntriesByType('resource').map(function (r) { return r.name; })
      .filter(function (u) { return u.indexOf(location.origin) === 0 && /\.(m?js|css)(\?|$)/.test(u); });
    urls.push(location.origin + location.pathname);
    Promise.all(urls.map(function (u) { return fetch(u, { cache: 'reload' }).catch(function () {}); }))
      .then(function () { location.reload(); });
  });
  // A successful start clears the one-retry guard.
  window.addEventListener('load', function () { setTimeout(function () { try { if (document.querySelector('header.top, .login')) sessionStorage.removeItem('ys-refetched'); } catch (x) { /* ignore */ } }, 3000); });
})();
