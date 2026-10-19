// Shift button (check in / out), notification bell, live updates and phone notifications.
import { api, state, can, icon, esc, modal, toast, toastErr, busy, fmtDate } from './core.js';

const TYPE_ICON = { shift_denied: 'alert', sale: 'cart', sale_return: 'undo', repair_in: 'wrench', repair_out: 'check', shift_in: 'logout', shift_out: 'logout' };
const TYPE_BG = { shift_denied: 'bg-peony', sale: 'bg-mint', sale_return: 'bg-peony', repair_in: 'bg-periwinkle', repair_out: 'bg-sky', shift_in: 'bg-aqua', shift_out: 'bg-lavender' };

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
    const s2 = await startShiftFlow(box.querySelector('button'));
    if (s2) { shift = s2; draw(); }
  }
  async function checkOut() {
    const zone = await zoneOn();
    const ok = await modal({
      title: 'إنهاء الشيفت',
      body: `<p style="margin-top:0">بدأت الساعة <b class="num">${shift.check_in_at.slice(11, 16)}</b>. متأكد إنك عايز تسجل انصراف؟</p>
        <label class="field"><span>ملاحظة (اختياري)</span><input class="input" id="out-note" placeholder="مثلاً: سلمت الدرج للمسائي"></label>
        ${zone ? `<div class="card bg-aqua" style="box-shadow:none;padding:12px 14px;margin-top:12px" id="loc-status">
          الانصراف لازم يكون من جوه المحل — لو الموبايل سألك عن الموقع دوس <b>سماح / Allow</b>.</div>` : '<div id="loc-status"></div>'}`,
      foot: '<button class="btn btn-outline" data-close>لأ</button><button class="btn btn-primary" data-ok>تسجيل انصراف</button>',
      onMount: (m, close) => m.querySelector('[data-ok]').addEventListener('click', (e) => runShift(e.currentTarget, m.querySelector('#loc-status'), async (extra) => {
        const r = await api.post('/shifts/check-out', { note: m.querySelector('#out-note').value, ...extra });
        toast(`تم الانصراف — مدة الشيفت ${Math.floor(r.minutes / 60)} س ${r.minutes % 60} د`, 'ok');
        close(true);
        // Locked mode: back to the "start your shift" screen
        if (state.settings.require_shift === '2' && state.user.role !== 'admin') setTimeout(() => location.reload(), 900);
      }), zone),
    });
    if (ok) { shift = null; draw(); }
  }
  // expose for the dashboard banner
  window.mmCheckIn = checkIn;
}

export const currentShift = () => shift;

/** Check in (with the shop-zone location step when it's on). Returns the new shift, or null if cancelled. */
export async function startShiftFlow(btn) {
  if (!(await zoneOn())) {
    let s = null;
    await busy(btn, async () => {
      s = (await api.post('/shifts/check-in')).open;
      const ownerExempt = state.user.role === 'admin' && state.settings.attendance_zone === '1';
      toast(ownerExempt
        ? 'تم تسجيل الحضور — إنت كمدير مستثنى من شرط الموقع، الموظفين هم اللي هيتطلب منهم الموقع 📍'
        : 'تم تسجيل الحضور — شيفت موفق 💪', 'ok');
    });
    return s;
  }
  return modal({
    title: 'تسجيل حضور',
    body: `<p style="margin-top:0">عشان نتأكد إنك <b>جوه المحل</b>، السيستم محتاج يعرف موقعك.</p>
      <div class="card bg-aqua" style="box-shadow:none;padding:12px 14px" id="loc-status">
        لما تدوس "سجّل حضوري"، الموبايل هيسألك: <b>"السماح للموقع بمعرفة موقعك؟"</b> ← دوس <b>سماح / Allow</b>.</div>`,
    foot: '<button class="btn btn-outline" data-close>إلغاء</button><button class="btn btn-primary" data-ok>📍 سجّل حضوري</button>',
    onMount: (m, close) => m.querySelector('[data-ok]').addEventListener('click', (e) => runShift(e.currentTarget, m.querySelector('#loc-status'), async (extra) => {
      const s = (await api.post('/shifts/check-in', extra)).open;
      toast(`تم تسجيل الحضور${s.in_method === 'gps' ? ' من المحل 📍' : s.in_method === 'wifi' ? ' من شبكة المحل 📶' : ''} — شيفت موفق 💪`, 'ok');
      close(s);
    })),
  });
}

// ---------------- shop zone (location) ----------------
const isIOSDevice = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isAndroid = () => /android/i.test(navigator.userAgent);
const inAppBrowser = () => /FBAN|FBAV|Instagram|WhatsApp|Line\/|Snapchat|TikTok/i.test(navigator.userAgent);

/** Is the "inside the shop only" rule on for this person? (fresh from the server) */
export async function zoneOn() {
  const st = await api.get('/settings').catch(() => state.settings);
  state.settings = { ...state.settings, ...st };
  return st.attendance_zone === '1' && state.user.role !== 'admin';
}

/** 'granted' | 'prompt' | 'denied' | 'unknown' */
export async function locationPermission() {
  try { return (await navigator.permissions.query({ name: 'geolocation' })).state; } catch { return 'unknown'; }
}

/** Phone location, as { lat, lng, accuracy } in meters. Errors carry .denied when permission is off. */
export function getPosition() {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext || !navigator.geolocation) {
      reject(Object.assign(new Error('تحديد الموقع محتاج رابط آمن (https) — افتح السيستم من رابط Railway'), { insecure: true }));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      (e) => reject(Object.assign(new Error(e.code === 1
        ? 'الموقع مقفول للسيستم ده'
        : 'مقدرناش نحدد موقعك — اتأكد إن الموقع (GPS) شغال في الموبايل'), { denied: e.code === 1 })),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });
}

/** Step-by-step instructions for turning location on, for this kind of phone. */
export function locationHelp(err) {
  const steps = [];
  if (inAppBrowser()) {
    steps.push('إنت فاتح السيستم من جوه واتساب/فيسبوك — افتح الرابط في <b>Chrome</b> أو <b>Safari</b> (⋮ ← فتح في المتصفح).');
  }
  if (err?.insecure) {
    steps.push('افتح السيستم من رابط Railway اللي بيبدأ بـ <bdi dir="ltr">https://</bdi>.');
  } else if (isIOSDevice()) {
    steps.push('افتح <b>الإعدادات (Settings)</b> ← <b>الخصوصية والأمان</b> ← <b>خدمات الموقع (Location Services)</b> ← شغّلها.');
    steps.push('في نفس الصفحة انزل لـ <b>Safari Websites</b> (أو اسم المتصفح اللي بتستخدمه) ← اختار <b>أثناء الاستخدام (While Using)</b>.');
    steps.push('ارجع للسيستم في Safari ← دوس <b>aA</b> جنب الرابط ← <b>إعدادات الموقع (Website Settings)</b> ← <b>الموقع (Location)</b> ← <b>سماح (Allow)</b>.');
  } else if (isAndroid()) {
    steps.push('اسحب شريط الإشعارات من فوق وشغّل <b>الموقع (Location)</b>.');
    steps.push('في Chrome دوس على العلامة اللي جنب الرابط (🔒 أو ⚙️) ← <b>الأذونات (Permissions)</b> ← <b>الموقع</b> ← <b>سماح (Allow)</b>.');
    steps.push('لو مش لاقيها: Chrome ← <b>⋮</b> ← <b>الإعدادات</b> ← <b>إعدادات المواقع</b> ← <b>الموقع</b> ← شيل السيستم من قائمة <b>المحظور</b>.');
  } else {
    steps.push('دوس على العلامة اللي جنب الرابط فوق (🔒) ← <b>الموقع (Location)</b> ← <b>سماح (Allow)</b>، وبعدين جرب تاني.');
  }
  return `<b>${err?.denied ? '⚠️ الموقع مقفول للسيستم — فعّله كده:' : '⚠️ ' + esc(err?.message || 'مقدرناش نحدد موقعك') + ':'}</b>
    <ol style="margin:8px 0 0;padding-inline-start:20px;line-height:1.9">${steps.map((x) => `<li>${x}</li>`).join('')}</ol>
    <div class="small" style="margin-top:8px">💡 لو إنت على واي فاي المحل وعندك مشكلة في الموقع، اطلب من المدير يسجّل "إنترنت المحل" من الإعدادات.</div>`;
}

/**
 * Check in / out with the shop-zone check: read the location (the phone asks for permission),
 * send it, and if it fails explain exactly what to do inside the window instead of a passing toast.
 */
async function runShift(btn, statusEl, send, zone = true) {
  btn.disabled = true;
  try {
    let extra = {};
    let locErr = null;
    if (zone && (await zoneOn())) {
      statusEl.className = 'card bg-aqua';
      statusEl.style.cssText = 'box-shadow:none;padding:12px 14px;margin-top:12px';
      statusEl.innerHTML = '📍 بنحدد موقعك… لو ظهرلك سؤال عن الموقع دوس <b>سماح / Allow</b>.';
      try { extra = await getPosition(); } catch (e) { locErr = e; }
    }
    try {
      await send(extra);
    } catch (e) {
      if (locErr && /موقع|GPS|بعيد/.test(e.message)) {
        statusEl.className = 'card bg-peony';
        statusEl.innerHTML = locationHelp(locErr) + '<div style="margin-top:10px"><b>بعد ما تفعّله دوس الزرار تاني.</b></div>';
      } else {
        statusEl.className = 'card bg-peony';
        statusEl.style.cssText = 'box-shadow:none;padding:12px 14px;margin-top:12px';
        statusEl.innerHTML = `⚠️ ${esc(e.message)}`;
      }
    }
  } finally {
    btn.disabled = false;
  }
}

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

