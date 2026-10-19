// Shift button (check in / out), notification bell, live updates and phone notifications.
import { api, can, icon, esc, modal, toast, toastErr, busy, fmtDate } from './core.js';

const TYPE_ICON = { sale: 'cart', sale_return: 'undo', repair_in: 'wrench', repair_out: 'check', shift_in: 'logout', shift_out: 'logout' };
const TYPE_BG = { sale: 'bg-mint', sale_return: 'bg-peony', repair_in: 'bg-periwinkle', repair_out: 'bg-sky', shift_in: 'bg-aqua', shift_out: 'bg-lavender' };

let unread = 0;
let shift = null; // open shift or null

// ---------------- shift (attendance) ----------------
export async function initShift() {
  const box = document.getElementById('shift-box');
  if (!box) return;
  const draw = () => {
    const since = shift ? shift.check_in_at.slice(11, 16) : '';
    box.innerHTML = shift
      ? `<button class="btn btn-sm shift-on" id="shift-btn" title="إنهاء الشيفت"><span class="dot-live"></span> في الشيفت من <span class="num">${since}</span></button>`
      : `<button class="btn btn-sm btn-outline" id="shift-btn">${icon('logout')} بدء الشيفت</button>`;
    box.querySelector('#shift-btn').addEventListener('click', () => (shift ? checkOut() : checkIn()));
    document.dispatchEvent(new CustomEvent('mm:shift', { detail: shift }));
  };
  try { shift = (await api.get('/shifts/me')).open; } catch { /* ignore */ }
  draw();

  async function checkIn() {
    await busy(box.querySelector('button'), async () => {
      shift = (await api.post('/shifts/check-in')).open;
      toast('تم تسجيل الحضور — شيفت موفق 💪', 'ok');
      draw();
    });
  }
  async function checkOut() {
    const ok = await modal({
      title: 'إنهاء الشيفت',
      body: `<p style="margin-top:0">بدأت الساعة <b class="num">${shift.check_in_at.slice(11, 16)}</b>. متأكد إنك عايز تسجل انصراف؟</p>
        <label class="field"><span>ملاحظة (اختياري)</span><input class="input" id="out-note" placeholder="مثلاً: سلمت الدرج للمسائي"></label>`,
      foot: '<button class="btn btn-outline" data-close>لأ</button><button class="btn btn-primary" data-ok>تسجيل انصراف</button>',
      onMount: (m, close) => m.querySelector('[data-ok]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const r = await api.post('/shifts/check-out', { note: m.querySelector('#out-note').value });
        toast(`تم الانصراف — مدة الشيفت ${Math.floor(r.minutes / 60)} س ${r.minutes % 60} د`, 'ok');
        close(true);
      })),
    });
    if (ok) { shift = null; draw(); }
  }
  // expose for the dashboard banner
  window.mmCheckIn = checkIn;
}

export const currentShift = () => shift;

// ---------------- bell ----------------
export async function initNotifications() {
  if (!can('notifications.receive')) return;
  const bell = document.getElementById('bell');
  bell.classList.remove('hidden');
  bell.addEventListener('click', openPanel);
  try { setUnread((await api.get('/notifications')).unread); } catch { /* ignore */ }
  connect();
  // Keep the phone registration fresh if it was enabled before
  if (pushSupported() && Notification.permission === 'granted') subscribePush(false).catch(() => {});
}

function setUnread(n) {
  unread = Math.max(0, n);
  const b = document.getElementById('bell-count');
  if (!b) return;
  b.textContent = unread > 99 ? '99+' : unread;
  b.classList.toggle('hidden', !unread);
  document.title = document.title.replace(/^\(\d+\+?\) /, '');
  if (unread) document.title = `(${unread}) ${document.title}`;
}

function connect() {
  let es;
  const start = () => {
    es = new EventSource('/api/notifications/stream');
    es.addEventListener('notification', (e) => {
      const n = JSON.parse(e.data);
      setUnread(unread + 1);
      // Window open: show it in the page. Window in the background without phone push: system notification.
      if (document.visibilityState === 'visible') toastNotification(n);
      else if (!pushEnabledHere() && 'Notification' in window && Notification.permission === 'granted') {
        navigator.serviceWorker?.ready.then((reg) => reg.showNotification(n.title, { body: n.body || '', icon: '/icons/icon-192.png', tag: `mm-${n.id}`, data: { url: n.url } }));
      }
      document.dispatchEvent(new CustomEvent('mm:notification', { detail: n }));
    });
  };
  start();
  window.addEventListener('beforeunload', () => es?.close());
}

function toastNotification(n) {
  let box = document.querySelector('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.append(box); }
  const t = document.createElement('a');
  t.className = 'toast toast-note';
  t.href = n.url || '#/';
  t.innerHTML = `<span class="note-ic ${TYPE_BG[n.type] || ''}">${icon(TYPE_ICON[n.type] || 'alert')}</span>
    <span><b>${esc(n.title)}</b><br><span class="small">${esc(n.body || '')}</span></span>`;
  box.append(t);
  setTimeout(() => t.remove(), 7000);
}

async function openPanel() {
  let data;
  try { data = await api.get('/notifications'); } catch (e) { return toastErr(e); }
  const seen = data.seen;
  api.post('/notifications/seen').catch(() => {});
  setUnread(0);
  const needsSetup = pushSupported() && Notification.permission !== 'granted';
  modal({
    title: `${icon('bell', '')} الإشعارات`,
    body: `
      ${needsSetup || !pushSupported() ? `<div class="card bg-periwinkle" style="box-shadow:none;padding:14px 16px;margin-bottom:14px">${pushHint()}</div>` : ''}
      ${data.items.length ? `<div class="notes">${data.items.map((n) => `
        <a class="note ${n.id > seen ? 'new' : ''}" href="${esc(n.url || '#/')}">
          <span class="note-ic ${TYPE_BG[n.type] || ''}">${icon(TYPE_ICON[n.type] || 'alert')}</span>
          <span class="note-txt"><b>${esc(n.title)}</b><span class="small muted">${esc(n.body || '')}</span><span class="small muted">${fmtDate(n.created_at)}</span></span>
        </a>`).join('')}</div>`
        : '<div class="empty">لسه مفيش إشعارات</div>'}`,
    foot: `<a class="btn btn-ghost" href="#/settings">${icon('settings')} إعدادات الإشعارات</a><span style="flex:1"></span><button class="btn btn-outline" data-close>قفل</button>`,
    onMount: (m) => {
      m.querySelector('#enable-push')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
        await subscribePush(true);
        toast('تم تفعيل الإشعارات على الجهاز ده ✅', 'ok');
        e.target.closest('.card')?.remove();
      }));
    },
  });
}

// ---------------- phone / computer push ----------------
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export function pushSupported() {
  return window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}
const pushEnabledHere = () => localStorage.getItem('mm_push') === '1';

export function pushHint() {
  if (isIOS() && !standalone()) {
    return `<b>عشان توصلك إشعارات على الآيفون:</b> افتح السيستم من Safari ← زرار المشاركة ⬆️ ← <b>Add to Home Screen</b>،
      وافتحه من الأيقونة اللي على الشاشة، وبعدين فعّل الإشعارات من هنا.`;
  }
  if (!window.isSecureContext) {
    return 'الإشعارات على الموبايل محتاجة رابط آمن (https). افتح السيستم من رابط Railway أو رابط Tailscale الآمن عشان تفعّلها.';
  }
  if (!pushSupported()) return 'المتصفح ده مش بيدعم الإشعارات — جرب Chrome.';
  if (Notification.permission === 'denied') {
    return 'الإشعارات مقفولة للموقع ده في إعدادات المتصفح. افتح إعدادات الموقع (علامة القفل جنب الرابط) وخلي Notifications = Allow.';
  }
  return `<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><span style="flex:1;min-width:200px">فعّل الإشعارات عشان يوصلك كل بيع وصيانة وحضور على الجهاز ده — حتى لو السيستم مقفول.</span>
    <button class="btn btn-primary btn-sm" id="enable-push">${icon('bell')} تفعيل الإشعارات</button></div>`;
}

export async function subscribePush(ask) {
  if (!pushSupported()) throw new Error('الجهاز ده مش بيدعم الإشعارات');
  if (Notification.permission !== 'granted') {
    if (!ask) return;
    const p = await Notification.requestPermission();
    if (p !== 'granted') throw new Error('لازم توافق على الإشعارات من المتصفح');
  }
  const reg = await navigator.serviceWorker.ready;
  const { key } = await api.get('/push/key');
  let sub = await reg.pushManager.getSubscription();
  const current = sub && btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey || []))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (sub && current && current !== key) { await sub.unsubscribe(); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(key) });
  await api.post('/push/subscribe', { subscription: sub.toJSON() });
  localStorage.setItem('mm_push', '1');
}

export async function unsubscribePush() {
  const reg = await navigator.serviceWorker?.ready;
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe();
  }
  localStorage.removeItem('mm_push');
}

function urlB64(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

