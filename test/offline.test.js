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

let cookie = '';
async function call(method, path, body) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return { status: res.status, data: await res.json().catch(() => null) };
}

test('sales made with no internet: saved once, kept even past the stock count, IMEI clashes refused', async () => {
  await call('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  const cable = (await call('POST', '/products', { name: 'كابل', sell_price: 100, cost_price: 40, initial_qty: 2 })).data;
  const phone = (await call('POST', '/products', { name: 'تليفون', sell_price: 5000, has_serial: true, serials: ['111111111111111'] })).data;

  // The till's list has the products and their in-stock IMEIs
  const cat = (await call('GET', '/pos/catalog')).data;
  assert.ok(cat.products.some((p) => p.id === cable.id));
  assert.deepEqual(cat.serials[phone.id], ['111111111111111']);

  // Same sale sent twice (lost answer / retry) is saved once
  const body = { client_ref: 'dev-abc-1', items: [{ product_id: cable.id, qty: 1 }] };
  const a = await call('POST', '/sales', body);
  assert.equal(a.status, 201);
  const b = await call('POST', '/sales', body);
  assert.equal(b.status, 200);
  assert.equal(b.data.id, a.data.id);
  assert.equal((await call('GET', `/products/${cable.id}`)).data.qty, 1);

  // Online, selling more than in stock is refused…
  assert.equal((await call('POST', '/sales', { items: [{ product_id: cable.id, qty: 3 }] })).status, 400);
  // …but a sale that already happened offline is kept; the count goes under zero
  const off = await call('POST', '/sales', { client_ref: 'dev-abc-2', offline_at: '2026-10-25 13:05:00', items: [{ product_id: cable.id, qty: 3 }] });
  assert.equal(off.status, 201, JSON.stringify(off.data));
  assert.equal(off.data.offline_at, '2026-10-25 13:05:00');
  assert.equal((await call('GET', `/products/${cable.id}`)).data.qty, -2);

  // A device already sold elsewhere can't be sold again, offline or not
  assert.equal((await call('POST', '/sales', { items: [{ product_id: phone.id, serial: '111111111111111' }] })).status, 201);
  const clash = await call('POST', '/sales', { client_ref: 'dev-abc-3', offline_at: '2026-10-25 13:10:00', items: [{ product_id: phone.id, serial: '111111111111111' }] });
  assert.equal(clash.status, 400);
  assert.equal((await call('GET', '/pos/catalog')).data.serials[phone.id], undefined);
});

test('scanning a label: invisible characters and a leading 0 still find the product, a miss says what was read', async () => {
  const p = (await call('POST', '/products', { name: 'Label test', sell_price: 10, initial_qty: 1 })).data;
  for (const code of [p.barcode, `0${p.barcode}`, `\u001d${p.barcode} `]) {
    const r = await call('GET', '/products/lookup?code=' + encodeURIComponent(code));
    assert.equal(r.data.product?.id, p.id, code);
  }
  const miss = await call('GET', '/products/lookup?code=12345678');
  assert.equal(miss.status, 404);
  assert.match(miss.data.error, /12345678/);
});
