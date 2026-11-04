'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../server/db');
const { createApp } = require('../server/app');

let server, base;
before(async () => {
  server = createApp(open(':memory:')).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());
function client() {
  let cookie = '';
  const call = async (method, p, body) => {
    const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), put: (p, b) => call('PUT', p, b ?? {}), del: (p) => call('DELETE', p) };
}


const tick = () => new Promise((r) => setTimeout(r, 1100));

test('deleting an invoice puts stock back and takes its money out', async () => {
  const admin = client();
  await admin.post('/auth/login', { username: 'admin', password: 'admin123' });
  const p = (await admin.post('/products', { name: 'Cable', sell_price: 100, initial_qty: 10 })).data;
  const s1 = (await admin.post('/sales', { items: [{ product_id: p.id, qty: 3 }], payment_method: 'cash', paid: 300 })).data;
  const s2 = (await admin.post('/sales', { items: [{ product_id: p.id, qty: 2 }], payment_method: 'cash', paid: 200 })).data;
  const sid = s1.id ?? s1.sale?.id;
  // Return 1 of the first sale, then close the drawer counting exactly
  const full = (await admin.get(`/sales/${sid}`)).data;
  await admin.post(`/sales/${sid}/return`, { items: [{ sale_item_id: full.items[0].id, qty: 1 }] });
  assert.equal((await admin.get(`/products/${p.id}`)).data.qty, 6);
  const expected = (await admin.get('/drawer')).data.expected; // 300 + 200 − 100
  assert.equal(expected, 400);
  await admin.post('/drawer/close', { counted: 400 });
  await tick();

  // Staff can't delete
  await admin.post('/users', { username: 'cc', full_name: 'كاشير', role: 'cashier', password: '123456' });
  const c = client(); await c.post('/auth/login', { username: 'cc', password: '123456' });
  assert.equal((await c.del(`/sales/${sid}`)).status, 403);

  const r = await admin.del(`/sales/${sid}?reason=${encodeURIComponent('غلط')}`);
  assert.equal(r.status, 200);
  assert.equal((await admin.get(`/sales/${sid}`)).status, 404);
  // The 2 still out come back (the returned one was back already)
  assert.equal((await admin.get(`/products/${p.id}`)).data.qty, 8);
  // That closing now expected 200 → counted 400 shows 200 extra; the open drawer is untouched
  const d = (await admin.get('/drawer')).data;
  assert.equal(d.closings[0].expected, 200);
  assert.equal(d.closings[0].diff, 200);
  assert.equal(d.expected, 400);
  assert.ok(s2);
});
