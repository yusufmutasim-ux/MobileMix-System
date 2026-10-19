'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../server/db');
const { createApp } = require('../server/app');

let server, base;
const pushed = []; // what would have gone to phones
let failNext = null;

before(async () => {
  const pushSender = async (sub, payload) => {
    if (failNext) { const e = failNext; failNext = null; throw e; }
    pushed.push({ endpoint: sub.endpoint, ...JSON.parse(payload) });
  };
  server = createApp(open(':memory:'), { pushSender }).listen(0);
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
  return {
    cookie: () => cookie,
    get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), put: (p, b) => call('PUT', p, b ?? {}),
    login: (u, pw) => call('POST', '/auth/login', { username: u, password: pw }),
  };
}

const admin = client();
const manager = client();
const cashier = client();
const tick = () => new Promise((r) => setTimeout(r, 50));
const s = {};

test('setup', async () => {
  await admin.login('admin', 'admin123');
  await admin.post('/users', { username: 'mona', full_name: 'منى', role: 'manager', password: '123456' });
  await admin.post('/users', { username: 'karim', full_name: 'كريم', role: 'cashier', password: '123456' });
  await manager.login('mona', '123456');
  await cashier.login('karim', '123456');
  s.product = (await admin.post('/products', { name: 'شاحن', sell_price: 300, initial_qty: 10 })).data;
  // Admin's phone registers for push
  const sub = { endpoint: 'https://push.example/admin-phone', keys: { p256dh: 'BKey', auth: 'AuthKey' } };
  assert.equal((await admin.post('/push/subscribe', { subscription: sub })).status, 201);
  assert.match((await admin.get('/push/key')).data.key, /^[A-Za-z0-9_-]{80,}$/);
  // Cashiers don't receive notifications
  assert.equal((await cashier.get('/notifications')).status, 403);
  assert.equal((await cashier.post('/push/subscribe', { subscription: sub })).status, 403);
});

test('check in / out notifies the owner (bell + phone)', async () => {
  let r = await cashier.post('/shifts/check-in', { note: 'وصلت' });
  assert.equal(r.status, 201);
  assert.equal((await cashier.post('/shifts/check-in')).status, 400); // already in
  assert.ok((await cashier.get('/shifts/me')).data.open);
  await tick();

  const n = await admin.get('/notifications');
  assert.equal(n.data.items[0].type, 'shift_in');
  assert.match(n.data.items[0].title, /كريم بدأ الشيفت/);
  assert.equal(n.data.unread, 1);
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].endpoint, 'https://push.example/admin-phone');
  assert.match(pushed[0].title, /كريم/);

  await admin.post('/notifications/seen');
  assert.equal((await admin.get('/notifications')).data.unread, 0);

  const now = await manager.get('/shifts/now');
  assert.equal(now.data.on[0].full_name, 'كريم');
  assert.equal((await cashier.get('/shifts/now')).status, 403);
});

test('sales and repairs notify live (stream) and by push; never the person who did it', async () => {
  // Admin keeps a window open
  const ctrl = new AbortController();
  const stream = await fetch(base + '/notifications/stream', { headers: { cookie: admin.cookie() }, signal: ctrl.signal });
  assert.equal(stream.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  const reader = stream.body.getReader();
  let text = '';
  const readUntil = async (re) => {
    while (!re.test(text)) text += new TextDecoder().decode((await reader.read()).value);
  };

  const sale = await cashier.post('/sales', { items: [{ product_id: s.product.id, qty: 2 }] });
  assert.equal(sale.status, 201);
  await readUntil(/عملية بيع/);
  assert.match(text, /event: notification/);
  assert.match(text, /600 ج\.م/);
  ctrl.abort();

  await cashier.post('/repairs', { customer_name: 'أحمد', customer_phone: '01011112222', device: 'iPhone 12', problem: 'شاشة', deposit: 200 });
  await tick();
  const types = (await admin.get('/notifications')).data.items.map((i) => i.type);
  assert.deepEqual(types.slice(0, 2), ['repair_in', 'sale']);
  assert.ok(pushed.some((p) => p.type === 'repair_in' && /أحمد/.test(p.body) && /200/.test(p.body)));

  // The admin's own sale doesn't notify the admin, but does notify the manager
  const before = pushed.length;
  await admin.post('/sales', { items: [{ product_id: s.product.id, qty: 1 }] });
  await tick();
  assert.equal(pushed.length, before);
  assert.equal((await manager.get('/notifications')).data.items[0].type, 'sale');
});

test('each manager chooses what to be notified about', async () => {
  const prefs = await manager.get('/notifications/prefs');
  assert.ok(prefs.data.types.sale);
  await manager.put('/notifications/prefs', { enabled: ['shift_in', 'shift_out'] });
  await cashier.post('/sales', { items: [{ product_id: s.product.id, qty: 1 }] });
  await tick();
  assert.notEqual((await manager.get('/notifications')).data.items[0]?.type, 'sale');
});

test('dead phone subscriptions are removed', async () => {
  failNext = Object.assign(new Error('gone'), { statusCode: 410 });
  await cashier.post('/sales', { items: [{ product_id: s.product.id, qty: 1 }] });
  await tick();
  assert.equal((await admin.get('/notifications/prefs')).data.devices.length, 0);
  assert.equal((await admin.post('/push/test')).status, 400);
});

test('attendance report, closing a forgotten shift, and the "must check in" rule', async () => {
  let r = await cashier.post('/shifts/check-out');
  assert.equal(r.status, 200);
  assert.equal((await manager.get('/notifications')).data.items[0].type, 'shift_out');
  assert.equal((await cashier.post('/shifts/check-out')).status, 400);

  // Must be checked in to sell when the shop turns the rule on
  await admin.put('/settings', { require_shift: '1' });
  r = await cashier.post('/sales', { items: [{ product_id: s.product.id, qty: 1 }] });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /تسجل حضور/);
  assert.equal((await cashier.post('/repairs', { customer_name: 'x', customer_phone: '01011112222', device: 'y', problem: 'z' })).status, 400);
  await cashier.post('/shifts/check-in');
  assert.equal((await cashier.post('/sales', { items: [{ product_id: s.product.id, qty: 1 }] })).status, 201);
  await admin.put('/settings', { require_shift: '0' });

  // Manager closes the shift the cashier forgot
  const list = await manager.get('/shifts');
  const open = list.data.shifts.find((x) => !x.check_out_at);
  assert.ok(open);
  assert.equal((await manager.post(`/shifts/${open.id}/close`, { check_out_at: '2000-01-01 10:00' })).status, 400); // before check-in
  assert.equal((await manager.post(`/shifts/${open.id}/close`)).status, 200);
  const after = await manager.get('/shifts');
  assert.equal(after.data.by_user[0].full_name, 'كريم');
  assert.equal(after.data.by_user[0].shifts, 2);
  assert.ok(after.data.shifts.every((x) => x.check_out_at));
  assert.equal((await cashier.get('/shifts')).status, 403);
});
