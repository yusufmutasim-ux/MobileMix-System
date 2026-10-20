// Shared helpers for all screens.

export const state = { user: null, permissions: [], settings: {}, mustChangePassword: false };

export function can(perm) {
  return state.permissions.includes('*') || state.permissions.includes(perm);
}

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new Error('مفيش اتصال بالسيستم — اتأكد من النت أو الواي فاي وجرب تاني');
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (res.status === 401 && path !== '/auth/login' && path !== '/auth/me') {
    location.hash = '#/login';
    location.reload();
  }
  if (res.status === 403 && data?.code === 'SHIFT_REQUIRED' && !document.querySelector('.lock-screen')) {
    location.reload();
  }
  if (!res.ok) throw new Error(data?.error || 'حصل خطأ، حاول تاني');
  return data;
}
api.get = (p) => api(p);
api.post = (p, body = {}) => api(p, { method: 'POST', body });
api.put = (p, body = {}) => api(p, { method: 'PUT', body });
api.del = (p) => api(p, { method: 'DELETE' });

/** Escape text for safe insertion into HTML templates. */
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
export const n = (v) => nf.format(Number(v) || 0);
export const money = (v) => `<span class="num">${n(v)}</span> <span class="muted small">${esc(state.settings.currency || 'ج.م')}</span>`;
export const moneyText = (v) => `${n(v)} ${state.settings.currency || 'ج.م'}`;

export function todayStr(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function fmtDate(s, withTime = true) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T'));
  const date = d.toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'short', year: 'numeric' });
  if (!withTime) return date;
  return `${date} — ${d.toLocaleTimeString('ar-EG-u-nu-latn', { hour: 'numeric', minute: '2-digit' })}`;
}

export const ROLE_NAMES = { admin: 'مدير', manager: 'مشرف', cashier: 'كاشير', technician: 'فني صيانة' };
export const PAY_NAMES = { cash: 'كاش', card: 'فيزا', wallet: 'محفظة', instapay: 'InstaPay', installment: 'تقسيط' };
export const STATUS_PILLS = {
  completed: '<span class="pill pill-ok">مكتملة</span>',
  partial_return: '<span class="pill pill-warn">مرتجع جزئي</span>',
  returned: '<span class="pill pill-bad">مرتجعة</span>',
};

// ---------- icons (24px stroke) ----------
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-6h4v6"/>',
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.6 12.2a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.5L22 7H6"/>',
  receipt: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="m9 13 2 2 4-4"/>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="8" cy="8" r="1.5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4"/><path d="M10 17 5 12l5-5M5 12h11"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  print: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  barcode: '<path d="M3 5v14M7 5v14M10 5v14M14 5v14M17 5v14M21 5v14"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>',
  alert: '<path d="M12 3 2 21h20z"/><path d="M12 10v5M12 18v.01"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M16 15h2"/>',
  trend: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
  whatsapp: '<path d="M3.5 20.5 5 16a8.5 8.5 0 1 1 3.2 3.1z"/><path d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.5-2-1-1 .8a5 5 0 0 1-2.6-2.6l.8-1-1-2z"/>',
  callphone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/>',
};
export const icon = (name, cls = '') =>
  `<svg class="${cls}" width="1.15em" height="1.15em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;

/** Brand mark (phone + arrows) and the full Mobile Mix Services logo, for light and dark themes. */
export const LOGO = '<img class="brand-mark" src="/brand/mark.svg" alt="Mobile Mix">';
export const LOGO_FULL = (h = 46) =>
  `<img class="brand-logo on-light" src="/brand/logo-dark-text.svg" alt="Mobile Mix Services" style="height:${h}px">` +
  `<img class="brand-logo on-dark" src="/brand/logo.svg" alt="Mobile Mix Services" style="height:${h}px">`;

// ---------- light / dark theme ----------
export function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}
export function setTheme(mode) {
  try { localStorage.setItem('mm_theme', mode); } catch { /* ignore */ }
  const dark = mode === 'dark' || (mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b0b0b' : '#efefef');
}

// ---------- toast ----------
export function toast(msg, type = '') {
  let box = document.querySelector('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.append(box); }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  box.append(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 220);
  }, type === 'err' ? 5000 : 3000);
}
export const toastErr = (e) => toast(e?.message || String(e), 'err');

// ---------- modal ----------
/**
 * Opens a modal. `onMount(el, close)` wires events. Returns a promise resolved with the value passed to close().
 */
export function modal({ title, body, foot = '', wide = false, onMount, locked = false }) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head"><h3>${title}</h3>${locked ? '' : `<button class="btn btn-ghost btn-icon" data-close>${icon('x')}</button>`}</div>
      <div class="modal-body">${body}</div>
      ${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div>`;
    let closed = false;
    const close = (v) => {
      if (closed) return;
      closed = true;
      // Slide out softly, then remove (it can't be clicked while leaving)
      if (back.contains(document.activeElement)) document.activeElement.blur();
      back.classList.add('closing');
      setTimeout(() => back.remove(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('hashchange', onNav);
      resolve(v);
    };
    // Moving to another page closes any open window
    const onNav = () => { if (!locked) close(null); };
    window.addEventListener('hashchange', onNav);
    const onKey = (e) => { if (e.key === 'Escape' && !locked) close(null); };
    back.addEventListener('mousedown', (e) => { if (e.target === back && !locked) close(null); });
    back.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => close(null)));
    document.addEventListener('keydown', onKey);
    document.body.append(back);
    onMount?.(back.querySelector('.modal'), close);
    const first = back.querySelector('[autofocus], .modal-body input:not([type=checkbox]), .modal-body select');
    first?.focus();
  });
}

export function confirmBox(message, { ok = 'تأكيد', danger = false } = {}) {
  return modal({
    title: 'تأكيد',
    body: `<p style="margin:0 0 8px">${message}</p>`,
    foot: `<button class="btn btn-outline" data-close>إلغاء</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${ok}</button>`,
    onMount: (el, close) => el.querySelector('[data-ok]').addEventListener('click', () => close(true)),
  });
}

/** Read named inputs of a container into an object. */
export function formData(el) {
  const out = {};
  el.querySelectorAll('[name]').forEach((i) => {
    out[i.name] = i.type === 'checkbox' ? i.checked : i.value;
  });
  return out;
}

/** Run an async action with the button disabled. */
export async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (e) { toastErr(e); return undefined; } finally { if (btn) btn.disabled = false; }
}

export const emptyRow = (cols, text = 'مفيش بيانات') => `<tr><td colspan="${cols}" class="empty">${text}</td></tr>`;

/** Download rows as a CSV that Excel opens correctly with Arabic. */
export function downloadCsv(filename, headers, rows) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [headers, ...rows].map((r) => r.map(q).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Debounce helper for search boxes. */
export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/** WhatsApp link for an Egyptian (or international) number with a ready message. */
export function waLink(phone, text) {
  let p = String(phone || '').replace(/[^0-9+]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  else if (p.startsWith('00')) p = p.slice(2);
  else if (/^01\d{9}$/.test(p)) p = '2' + p;
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}
