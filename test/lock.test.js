'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../server/db');
const { createApp } = require('../server/app');

let server, base;
const pushed = [];
before(async () => {
  server = createApp(open(':memory:'), { pushSender: async (_s, p) => { pushed.push(JSON.parse(p)); } }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

function client() {
  let cookie = '';
  const call = async (method, p, body) => {
    const res = await fetch(base + p, {
      method, headers: { 'content-type': 'application/json', cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), put: (p, b) => call('PUT', p, b ?? {}),
    login: (u, pw) => call('POST', '/auth/login', { username: u, password: pw }) };
}

const admin = client();
const cashier = client();
const SHOP = { lat: 30.0444, lng: 31.2357 };
const tick = () => new Promise((r) => setTimeout(r, 50));

test('setup', async () => {
  await admin.login('admin', 'admin123');
  await admin.post('/users', { username: 'karim', full_name: 'كريم', role: 'cashier', password: '123456' });
  await cashier.login('karim', '123456');
  await admin.post('/push/subscribe', { subscription: { endpoint: 'https://push.example/owner', keys: { p256dh: 'k', auth: 'a' } } });
});

test('locked until check in: the server refuses everything else', async () => {
  await admin.put('/settings', { require_shift: '2' });
  for (const p of ['/products', '/sales', '/dashboard', '/repairs', '/categories']) {
    const r = await cashier.get(p);
    assert.equal(r.status, 403, p);
    assert.equal(r.data.code, 'SHIFT_REQUIRED');
  }
  // What the lock screen needs still works
  assert.equal((await cashier.get('/auth/me')).status, 200);
  assert.equal((await cashier.get('/settings')).status, 200);
  assert.equal((await cashier.get('/shifts/me')).status, 200);
  assert.equal((await cashier.put('/settings', { shop_name: 'x' })).status, 403); // never writable anyway
  // The owner is never locked
  assert.equal((await admin.get('/products')).status, 200);

  assert.equal((await cashier.post('/shifts/check-in')).status, 201);
  assert.equal((await cashier.get('/products')).status, 200);
  await cashier.post('/shifts/check-out');
  assert.equal((await cashier.get('/products')).status, 403); // locked again after leaving
});

test('check in from outside the shop alerts the owner (once per 10 minutes)', async () => {
  await admin.put('/settings', { attendance_zone: '1', shop_lat: String(SHOP.lat), shop_lng: String(SHOP.lng), zone_radius: '100' });
  const before = pushed.length;
  let r = await cashier.post('/shifts/check-in', { lat: SHOP.lat + 0.03, lng: SHOP.lng, accuracy: 10 }); // ~3.3 km
  assert.equal(r.status, 400);
  await tick();
  assert.equal(pushed.length, before + 1);
  assert.match(pushed.at(-1).title, /كريم حاول يسجل حضور من برة المحل/);
  assert.match(pushed.at(-1).body, /3\.3 كم/);

  // Trying again right away is still refused but doesn't spam the owner
  r = await cashier.post('/shifts/check-in', { lat: SHOP.lat + 0.03, lng: SHOP.lng, accuracy: 10 });
  assert.equal(r.status, 400);
  await tick();
  assert.equal(pushed.length, before + 1);

  const n = await admin.get('/notifications');
  assert.equal(n.data.items[0].type, 'shift_denied');

  // Every attempt is listed on the attendance page
  const list = await admin.get('/shifts');
  assert.equal(list.data.denied.length, 2);
  assert.equal(list.data.denied[0].kind, 'in');
  assert.ok(list.data.denied[0].distance > 3000);
  assert.match(list.data.denied[0].reason, /بعيد/);
});

test('people who saved notification choices before still get the new alert, and can turn it off', async () => {
  // Older saved format (list of enabled types, without the new one)
  await admin.put('/notifications/prefs', { enabled: ['sale', 'shift_in', 'shift_denied'] });
  let prefs = await admin.get('/notifications/prefs');
  assert.ok(prefs.data.enabled.includes('shift_denied'));
  await admin.put('/notifications/prefs', { enabled: ['sale'] });
  prefs = await admin.get('/notifications/prefs');
  assert.deepEqual(prefs.data.enabled, ['sale']);
});
