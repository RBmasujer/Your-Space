// App shell: authentication gate, owner check, navigation, hash router.
import { sb, configured, setUid, must } from './lib/sb.js';
import { esc, toast, fail, $, modal, MOBILE_Q, debounce, isMobile } from './lib/util.js';
import { destroyCharts, hasCharts } from './lib/charts.js';
import { OWNER_NAME } from './config.js';
import { paintAvatar, refreshAvatars, googleEnabled, GOOGLE_LOGO, returnUrl } from './lib/profile.js';

const ROUTES = [
  ['home', 'Home', () => import('./views/home.js')],
  ['leads', 'Leads', () => import('./views/leads.js')],
  ['quota', 'Quota & Progress', () => import('./views/quota.js')],
  ['content', 'Content Calendar', () => import('./views/content.js')],
  ['schedule', 'Manning & Tripping', () => import('./views/schedule.js')],
  ['files', 'Files', () => import('./views/files.js')],
  ['showcase', 'Showcase', () => import('./views/showcase.js')],
  ['quotation', 'Quotation', () => import('./views/quotation.js')],
  ['email', 'Email', () => import('./views/email.js')],
  ['settings', 'Settings', () => import('./views/settings.js')],
];
// Phone bottom bar: 4 main screens + "More". Icons are inline SVG (no external files).
const ICONS = {
  home: '<path d="M3 11 12 3l9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  leads: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.9.8 3.1 2.5 3.5 5.2"/>',
  schedule: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="m9 15 2 2 4-4"/>',
  content: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M7.5 14h4M7.5 17h7"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  moon: '<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>`;
// Theme toggle button (theme.js owns the state; this only draws the button).
const isDark = () => window.ysTheme?.get() === 'dark';
const themeBtn = (cls) => `<button type="button" class="${cls}" data-theme-toggle aria-label="${isDark() ? 'Switch to light mode' : 'Switch to dark mode'}" title="${isDark() ? 'Light mode' : 'Dark mode'}">${icon(isDark() ? 'sun' : 'moon')}</button>`;
document.addEventListener('click', (e) => { if (e.target.closest('[data-theme-toggle]')) window.ysTheme?.toggle(); });
document.addEventListener('themechange', () => {
  document.querySelectorAll('[data-theme-toggle]').forEach(b => { b.outerHTML = themeBtn(b.className); });
  // Charts read their colors when drawn — redraw only screens that have charts, so typed
  // but unsaved input elsewhere (email draft, shortcut edits) is never thrown away.
  if (shellReady && hasCharts() && !document.querySelector('.modal-bg')) route();
});
const PRIMARY = [['home', 'Home'], ['leads', 'Leads'], ['schedule', 'Schedule'], ['content', 'Posts']];

const app = document.getElementById('app');
let current = null;       // current view module
let shellReady = false;
let navToken = 0;
let renderedMobile = null; // layout the current screen was drawn for

// ── Routing ─────────────────────────────────────────────────────────────────
export function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  let [name, qs] = raw.split('?');
  if (name === 'lto') name = 'quotation';               // old links / bookmarks to the LTO Calculator
  return { name: ROUTES.some(r => r[0] === name) ? name : 'home', params: Object.fromEntries(new URLSearchParams(qs || '')) };
}
export function go(name, params) {
  const qs = params ? '?' + new URLSearchParams(params) : '';
  location.hash = `#/${name}${qs}`;
}

async function route() {
  if (!shellReady) return;
  const my = ++navToken;
  const { name, params } = parseHash();
  document.querySelectorAll('nav.tabs a, nav.bottom a').forEach(a => a.removeAttribute('aria-current'));
  document.querySelectorAll(`nav.tabs a[data-r="${name}"], nav.bottom a[data-r="${name}"]`).forEach(a => a.setAttribute('aria-current', 'page'));
  const more = document.querySelector('nav.bottom [data-more]');
  if (more) more.toggleAttribute('data-on', !PRIMARY.some(p => p[0] === name));
  document.querySelector(`nav.tabs a[data-r="${name}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center' });
  window.scrollTo(0, 0);
  try { current?.destroy?.(); } catch { /* ignore */ }
  destroyCharts();
  document.getElementById('print-area')?.replaceChildren(); // printing another page must not print an old quotation
  // Each navigation renders into a fresh container. If the user switches tabs
  // while a slow view is still loading, the old view writes into a detached
  // element and can never overwrite the new screen.
  const view = $('#view');
  renderedMobile = isMobile();
  const host = document.createElement('div');
  host.innerHTML = '<div class="empty">Loading…</div>';
  view.replaceChildren(host);
  try {
    const mod = await ROUTES.find(r => r[0] === name)[2]();
    if (my !== navToken) return;          // user navigated again meanwhile
    current = mod;
    document.title = `${ROUTES.find(r => r[0] === name)[1]} · Your Space`;
    await mod.render(host, params);
  } catch (e) {
    if (my !== navToken) return;
    host.innerHTML = `<div class="card"><h2>Something went wrong</h2><p class="muted">${esc(e.message || e)}</p><button class="btn" data-retry>Try again</button></div>`;
    host.querySelector('[data-retry]').onclick = route;
    console.error(e);
  }
}
addEventListener('hashchange', route);

function shell(user) {
  app.innerHTML = `
    <header class="top">
      <div><h1>Your Space</h1><small>${esc(OWNER_NAME)} · Property Specialist · RLC Residences</small></div>
      <div class="sp"></div>
      ${themeBtn('icon-btn')}
      <span class="small who">${esc(user.email)}</span>
      <a class="me" href="#/settings?tab=profile" aria-label="Profile and account"><span class="avatar" data-avatar></span></a>
      <button type="button" id="signout">Sign out</button>
    </header>
    <nav class="tabs" aria-label="Sections">${ROUTES.map(([k, t]) => `<a href="#/${k}" data-r="${k}">${esc(t)}</a>`).join('')}</nav>
    <main id="view"></main>
    <nav class="bottom" aria-label="Main">
      ${PRIMARY.map(([k, t]) => `<a href="#/${k}" data-r="${k}">${icon(k)}<span>${t}</span></a>`).join('')}
      <button type="button" data-more>${icon('more')}<span>More</span></button>
    </nav>
    <div id="print-area"></div>`;
  $('#signout').onclick = async () => { await sb.auth.signOut(); };
  paintAvatar(app.querySelector('[data-avatar]'), user);
  document.querySelector('nav.bottom [data-more]').onclick = openMore;
  shellReady = true;
  route();
}

function openMore() {
  const items = ROUTES.filter(([k]) => !PRIMARY.some(p => p[0] === k));
  const m = modal(`<h2>More<span class="sp"></span><button class="btn ghost sm" data-close aria-label="Close">✕</button></h2>
    <div class="more-list">${items.map(([k, t]) => `<a href="#/${k}" data-close>${esc(t)}<span aria-hidden="true">›</span></a>`).join('')}
      <button type="button" class="danger-link" data-out>Sign out</button></div>`, { sheet: true });
  m.el.querySelector('[data-out]').onclick = () => { m.close(); sb.auth.signOut(); };
}

// Re-draw the current screen only when the layout really switches between phone
// and desktop (e.g. tablet rotation) — never while a form is open, so typed
// input or a chosen file is not lost.
window.matchMedia(MOBILE_Q).addEventListener('change', debounce(() => {
  if (!shellReady || isMobile() === renderedMobile || document.querySelector('.modal-bg')) return;
  route();
}, 200));

// ── Auth screens ────────────────────────────────────────────────────────────
function loginView(msg = '') {
  shellReady = false;
  app.innerHTML = `
  <div class="login"><div class="card">
    <div class="head"><div><h1>Your Space</h1><div class="muted">Sign in to your workspace</div></div>${themeBtn('theme-btn')}</div>
    ${!configured ? '<p class="toast err" style="margin-top:12px">Setup needed: put your Supabase URL and anon key in <b>web/assets/js/config.js</b>.</p>' : ''}
    ${msg ? `<p class="hint">${esc(msg)}</p>` : ''}
    <form id="lf">
      <div id="gbox" hidden><button class="btn google" type="button" id="google" style="width:100%">${GOOGLE_LOGO} Continue with Google</button><div class="or">or use email</div></div>
      <label class="fld">Email<input name="email" type="email" autocomplete="username" required></label>
      <label class="fld">Password<input name="password" type="password" autocomplete="current-password" required minlength="8"></label>
      <button class="btn" type="submit">Sign in</button>
      <button class="btn ghost" type="button" id="forgot">Forgot password?</button>
    </form>
  </div></div>`;
  const f = $('#lf');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = f.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'Signing in…';
    const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
    btn.disabled = false; btn.textContent = 'Sign in';
    if (error) toast(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message, 'err');
  };
  googleEnabled().then(on => { const g = $('#gbox'); if (g) g.hidden = !on; });
  $('#google').onclick = async () => {
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: returnUrl(), queryParams: { prompt: 'select_account' } } });
    if (error) toast(error.message, 'err');
  };
  $('#forgot').onclick = async () => {
    const email = f.email.value.trim();
    if (!email) return toast('Type your email first, then tap “Forgot password?”', 'err');
    const redirectTo = location.origin + location.pathname + '?recovery=1';
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
    toast(error ? error.message : 'If that email is registered, a reset link is on its way.', error ? 'err' : 'ok');
  };
}

function newPasswordView() {
  shellReady = false;
  app.innerHTML = `<div class="login"><div class="card"><h1>Set a new password</h1>
    <form id="pf"><label class="fld">New password (min 10 characters)<input name="p1" type="password" autocomplete="new-password" minlength="10" required></label>
    <label class="fld">Repeat<input name="p2" type="password" autocomplete="new-password" minlength="10" required></label>
    <button class="btn" type="submit">Save password</button></form></div></div>`;
  $('#pf').onsubmit = async (e) => {
    e.preventDefault();
    const { p1, p2 } = e.target;
    if (p1.value !== p2.value) return toast('Passwords do not match.', 'err');
    const { error } = await sb.auth.updateUser({ password: p1.value });
    if (error) return toast(error.message, 'err');
    history.replaceState(null, '', location.pathname + '#/home');
    toast('Password updated.', 'ok');
    boot();
  };
}

function deniedView(email) {
  shellReady = false;
  app.innerHTML = `<div class="login"><div class="card"><h1>Not authorized</h1>
    <p>${esc(email)} can sign in but is not the owner of this workspace.</p>
    <p class="hint">If this is your account, run <b>supabase/seed/seed.sql</b> in the Supabase SQL Editor.</p>
    <button class="btn" id="so">Sign out</button></div></div>`;
  $('#so').onclick = () => sb.auth.signOut();
}

// ── Boot ────────────────────────────────────────────────────────────────────
let lastUser = null;
/** Google sign-in / account-linking errors come back in the URL (?error=… or #error=…). */
function takeAuthError() {
  const q = new URLSearchParams(location.search);
  const h = new URLSearchParams(location.hash.replace(/^#\/?/, ''));
  const desc = q.get('error_description') || h.get('error_description') || q.get('error') || h.get('error');
  if (!desc) return '';
  history.replaceState(null, '', location.pathname + '#/home');
  // Only fixed messages — never echo URL text (a crafted link could show any text here).
  if (/signup|sign.?up|not allowed/i.test(desc)) return 'That Google account is not connected to Your Space. Sign in with your email and password first, then open Settings → Google account → “Connect Google account”.';
  if (/already.*(linked|exists)|identity.*exists/i.test(desc)) return 'That Google account is already connected to a different login.';
  if (/expired|otp/i.test(desc)) return 'That link has expired. Please try again.';
  return 'Sign-in did not finish. Please try again.';
}

async function boot() {
  const authErr = takeAuthError();
  if (authErr) toast(authErr, 'err');
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { lastUser = null; setUid(null); return loginView(authErr); }
  const params = new URLSearchParams(location.search);
  if (params.get('recovery') === '1') return newPasswordView();
  if (lastUser === session.user.id && shellReady) return; // token refresh — nothing to do
  try {
    const owner = must(await sb.rpc('is_app_owner'));
    if (!owner) return deniedView(session.user.email);
  } catch (e) { fail(e); return loginView('Could not reach the database. Check config.js and your connection.'); }
  lastUser = session.user.id;
  setUid(session.user.id);
  shell(session.user);
}

sb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') { lastUser = null; setUid(null); current?.destroy?.(); loginView('Signed out.'); }
  else if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'PASSWORD_RECOVERY') setTimeout(boot, 0);
  else if (event === 'USER_UPDATED' && shellReady) setTimeout(() => refreshAvatars().catch(() => {}), 0);
});

addEventListener('unhandledrejection', (e) => fail(e.reason));
