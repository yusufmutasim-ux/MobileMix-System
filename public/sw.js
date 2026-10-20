// Mobile Mix service worker.
// The data always lives on the shop PC, so API calls are never cached.
// App files are fetched fresh when possible and kept as a fallback, so the app opens fast
// and shows a clear "can't reach the shop" page instead of a browser error.
const VERSION = 'mm-v25';
const SHELL = [
  '/', '/offline.html', '/css/app.css', '/brand/logo.svg', '/brand/logo-dark-text.svg', '/brand/mark.svg', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png',
  '/js/app.js', '/js/core.js', '/js/print.js',
  '/js/views/login.js', '/js/views/dashboard.js', '/js/views/pos.js', '/js/views/sales.js', '/js/views/products.js',
  '/js/views/stocktake.js', '/js/views/labels.js', '/js/views/reports.js', '/js/views/users.js', '/js/views/settings.js',
  '/js/views/repairs.js', '/js/views/attendance.js', '/js/live.js', '/js/motion.js', '/js/money-ui.js', '/js/search.js', '/js/camera.js',
  '/js/views/customers.js', '/js/views/purchases.js', '/js/views/drawer.js', '/js/views/expenses.js', '/js/views/payroll.js', '/js/views/lock.js', '/vendor/JsBarcode.all.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/offline.html')));
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request)),
  );
});

// ---------- push notifications (sales, repairs, attendance) ----------
self.addEventListener('push', (e) => {
  let n = {};
  try { n = e.data ? e.data.json() : {}; } catch { n = { title: 'Mobile Mix', body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(n.title || 'Mobile Mix', {
    body: n.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: n.tag,
    lang: 'ar',
    dir: 'rtl',
    data: { url: n.url || '#/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL('/' + (e.notification.data?.url || '#/'), self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (new URL(c.url).origin === self.location.origin) {
        c.navigate(target).catch(() => {});
        return c.focus();
      }
    }
    return self.clients.openWindow(target);
  }));
});
