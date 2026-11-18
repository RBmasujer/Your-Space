// Shared helpers: escaping, formatting, Manila dates, toasts, modals.
import { TZ } from '../config.js';

/** Escape for HTML text AND attribute values. Use on every piece of user data. */
export const esc = (s) => String(s ?? '').replace(/[&<>"'`]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));

/** Only allow http(s)/mailto links from user data (blocks javascript: URLs). */
export const safeUrl = (u) => (/^(https?:|mailto:)/i.test(String(u || '').trim()) ? String(u).trim() : '');

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 });
const pesoShort = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', notation: 'compact', maximumFractionDigits: 1 });
export const money = (n) => peso.format(+n || 0);
const pesoWhole = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 });
export const moneyWhole = (n) => pesoWhole.format(Math.round(+n || 0));
export const moneyShort = (n) => pesoShort.format(+n || 0);
export const pct = (n, d = 1) => `${(+n || 0).toFixed(d)}%`;
export const int = (n) => (+n || 0).toLocaleString('en-PH');

// ── Dates (Manila is UTC+8 all year — no daylight saving) ───────────────────
const ymdFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const hmFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** 'YYYY-MM-DD' in Manila for a Date/ISO string (default: now). Fixes the old app's UTC "today" bug. */
export const ymd = (d = new Date()) => ymdFmt.format(new Date(d));
export const today = () => ymd();
/** 'HH:MM' in Manila */
export const hm = (d) => hmFmt.format(new Date(d));
/** Build an ISO timestamp from a Manila date + time. */
export const manilaISO = (date, time = '00:00') => `${date}T${time || '00:00'}:00+08:00`;
export const addDays = (ymdStr, n) => { const d = new Date(`${ymdStr}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 864e5);
export const fmtDate = (s) => s ? new Date(String(s).length === 10 ? `${s}T00:00:00+08:00` : s).toLocaleDateString('en-PH', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric' }) : '';
export const fmtDateTime = (s) => s ? new Date(s).toLocaleString('en-PH', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
export const fmtTime = (s) => s ? new Date(s).toLocaleTimeString('en-PH', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }) : '';
export const monthLabel = (y, m) => new Date(Date.UTC(y, m, 1)).toLocaleString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' });

// ── Device ──
export const MOBILE_Q = '(max-width: 640px)';
export const isMobile = () => window.matchMedia(MOBILE_Q).matches;

// ── Misc ────────────────────────────────────────────────────────────────────
export const EMAIL_RE = /^[^@\s,;/]+@[^@\s,;/]+\.[^@\s,;/]+$/;
/** First valid email in a messy cell like "a@x.com / b@y.com". */
export const firstEmail = (s) => (String(s || '').match(/[^\s,;/]+@[^\s,;/]+\.[^\s,;/]+/) || [''])[0].toLowerCase();
export const firstName = (name) => String(name || '').replace(/\(.*?\)/g, '').trim().split(/\s+/)[0] || '';
export const hasPhone = (p) => /\d{6,}/.test(String(p || '').replace(/\D/g, ''));
/** Normalize PH numbers: 9171234567 → +639171234567, 09171234567 → +639171234567. Leaves others as typed. */
export function normalizePhone(p) {
  const raw = String(p || '').trim();
  const d = raw.replace(/\D/g, '');
  if (/^9\d{9}$/.test(d)) return '+63' + d;
  if (/^09\d{9}$/.test(d)) return '+63' + d.slice(1);
  if (/^639\d{9}$/.test(d)) return '+' + d;
  return raw;
}
export const bytes = (n) => n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;
export const safeName = (n) => String(n || 'file').normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '_').slice(-120) || 'file';
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const opts = (list, sel, { blank } = {}) =>
  (blank != null ? `<option value="">${esc(blank)}</option>` : '') +
  list.map(o => { const [v, t] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(sel ?? '') ? 'selected' : ''}>${esc(t)}</option>`; }).join('');

/** Read a form into an object; empty strings become null. */
export function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') { if (el.dataset.multi) { (o[el.name] ||= []); if (el.checked) o[el.name].push(el.value); } else o[el.name] = el.checked; continue; }
    const v = el.value.trim();
    o[el.name] = v === '' ? null : (el.type === 'number' ? +v : v);
  }
  return o;
}

// ── Toasts ──────────────────────────────────────────────────────────────────
export function toast(msg, kind = '') {
  const box = document.getElementById('toasts');
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), kind === 'err' ? 7000 : 3500);
}
export function errMsg(e) {
  const m = e?.message || String(e);
  if (/row-level security|permission denied/i.test(m)) return 'Not allowed — please sign in again.';
  if (/closed_needs_price/.test(m)) return 'A Closed lead needs a contract price.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Network problem — check your connection and try again.';
  return m;
}
export const fail = (e) => { console.error(e); toast(errMsg(e), 'err'); };

// ── Modal ───────────────────────────────────────────────────────────────────
/** Opens a modal. Returns { el, close }. `onClose` runs once. Esc / backdrop click closes. */
export function modal(html, { wide = false, sheet = false, onClose } = {}) {
  const opener = document.activeElement; // focus goes back here on close (keyboard / screen-reader users)
  const bg = document.createElement('div');
  bg.className = `modal-bg${sheet ? ' sheet' : ''}`;
  bg.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(bg);
  document.body.style.overflow = 'hidden';
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    bg.remove();
    if (!document.querySelector('.modal-bg')) document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    if (opener?.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape' && bg === [...document.querySelectorAll('.modal-bg')].pop()) close(); };
  document.addEventListener('keydown', onKey);
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  bg.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  // On phones, don't auto-focus (it pops the keyboard over the form).
  const first = bg.querySelector('input:not([type=checkbox]):not([type=file]), select, textarea');
  if (!isMobile()) setTimeout(() => first?.focus(), 30);
  return { el: bg.firstElementChild, close };
}

/** Load a classic script once (lazy-load heavy libraries). */
const loaded = new Map();
export function loadScript(src) {
  if (!loaded.has(src)) loaded.set(src, new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => { loaded.delete(src); rej(new Error('Could not load ' + src)); };
    document.head.appendChild(s);
  }));
  return loaded.get(src);
}

/** Copy text; falls back to a hidden textarea where the Clipboard API is missing (http, older browsers). */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
  document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove(); return ok;
}

/** Simple CSV builder. */
export function toCSV(rows) {
  const q = v => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + rows.map(r => r.map(q).join(',')).join('\r\n');
}
export function saveBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
