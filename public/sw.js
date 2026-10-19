// Mobile Mix service worker.
// The data always lives on the shop PC, so API calls are never cached.
// App files are fetched fresh when possible and kept as a fallback, so the app opens fast
// and shows a clear "can't reach the shop" page instead of a browser error.
const VERSION = 'mm-v2';
const SHELL = [
  '/', '/offline.html', '/css/app.css', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png',
  '/js/app.js', '/js/core.js', '/js/print.js',
  '/js/views/login.js', '/js/views/dashboard.js', '/js/views/pos.js', '/js/views/sales.js', '/js/views/products.js',
  '/js/views/stocktake.js', '/js/views/labels.js', '/js/views/reports.js', '/js/views/users.js', '/js/views/settings.js',
  '/js/views/repairs.js', '/vendor/JsBarcode.all.min.js',
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
