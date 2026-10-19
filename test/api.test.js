'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../server/db');
const { createApp } = require('../server/app');

let server, base;

before(async () => {
  const db = open(':memory:');
  server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

/** Tiny client that keeps its own session cookie. */
function client() {
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  };
  return {
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b ?? {}),
    put: (p, b) => call('PUT', p, b ?? {}),
    del: (p) => call('DELETE', p),
    login: (username, password) => call('POST', '/auth/login', { username, password }),
  };
}

const admin = client();
const cashier = client();
const state = {};

test('health check', async () => {
  const r = await fetch(base + '/health');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
});

test('login and permissions', async () => {
  assert.equal((await admin.get('/auth/me')).status, 401);
  assert.equal((await admin.login('admin', 'wrong')).status, 401);
  const r = await admin.login('admin', 'admin123');
  assert.equal(r.status, 200);
  assert.equal(r.data.user.role, 'admin');
  const me = await admin.get('/auth/me');
  assert.equal(me.data.settings.shop_name, 'Mobile Mix');
  assert.equal(me.data.must_change_password, true); // factory password must be replaced

  // Through an HTTPS tunnel the session cookie is marked Secure
  const viaTunnel = await fetch(base + '/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  assert.match(viaTunnel.headers.get('set-cookie'), /; Secure/);

  assert.equal((await admin.post('/users', { username: 'sara', full_name: 'سارة', role: 'cashier', password: '123' })).status, 400);
  const u = await admin.post('/users', { username: 'sara', full_name: 'سارة', role: 'cashier', password: '123456' });
  assert.equal(u.status, 201);
  state.cashierId = u.data.id;
  assert.equal((await cashier.login('sara', '123456')).status, 200);
  assert.equal((await cashier.get('/users')).status, 403);
  assert.equal((await cashier.get('/reports/sales')).status, 403);
  assert.equal((await cashier.post('/products', { name: 'x', sell_price: 1 })).status, 403);
});

test('products, stock and serials', async () => {
  const cats = (await admin.get('/categories')).data;
  const phones = cats.find((c) => c.name === 'موبايلات');
  const acc = cats.find((c) => c.name === 'إكسسوارات');

  const cable = await admin.post('/products', {
    name: 'كابل Type-C', category_id: acc.id, cost_price: 40, sell_price: 100, min_qty: 3, initial_qty: 10,
  });
  assert.equal(cable.status, 201);
  assert.equal(cable.data.qty, 10);
  assert.match(cable.data.barcode, /^2000\d{8}$/);
  state.cable = cable.data;

  const phone = await admin.post('/products', {
    name: 'Samsung A15', brand: 'Samsung', category_id: phones.id, cost_price: 6000, sell_price: 7000,
    has_serial: true, serials: ['350000000000001', '350000000000002'],
  });
  assert.equal(phone.status, 201);
  assert.equal(phone.data.qty, 2);
  state.phone = phone.data;

  // Duplicate IMEI is rejected
  const dup = await admin.post(`/products/${phone.data.id}/stock`, { serials: ['350000000000001'] });
  assert.equal(dup.status, 409);

  // Weighted average cost
  const add = await admin.post(`/products/${cable.data.id}/stock`, { qty: 10, cost_price: 60 });
  assert.equal(add.data.qty, 20);
  assert.equal((await admin.get(`/products/${cable.data.id}`)).data.cost_price, 50);

  // Cashier never sees cost
  const seen = await cashier.get(`/products/${cable.data.id}`);
  assert.equal(seen.data.cost_price, undefined);

  // Lookup by IMEI
  const look = await cashier.get('/products/lookup?code=350000000000002');
  assert.equal(look.data.product.id, phone.data.id);
  assert.equal(look.data.serial, '350000000000002');
});

test('sales: stock, IMEI, discount limits', async () => {
  const { cable, phone } = state;
  // Not enough stock
  let r = await cashier.post('/sales', { items: [{ product_id: cable.id, qty: 50 }] });
  assert.equal(r.status, 400);
  // Phone needs IMEI
  r = await cashier.post('/sales', { items: [{ product_id: phone.id }] });
  assert.equal(r.status, 400);
  // Cashier max discount is 5%
  r = await cashier.post('/sales', { items: [{ product_id: phone.id, serial: '350000000000001' }], discount: 1000 });
  assert.equal(r.status, 400);

  r = await cashier.post('/sales', {
    items: [{ product_id: phone.id, serial: '350000000000001' }, { product_id: cable.id, qty: 2 }],
    discount: 200, payment_method: 'cash', customer_name: 'أحمد', customer_phone: '01000000000',
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.subtotal, 7200);
  assert.equal(r.data.total, 7000);
  assert.equal(r.data.invoice_no, 'MM-000001');
  assert.equal(r.data.items[0].unit_cost, undefined);
  state.sale = r.data;

  // Same IMEI can't be sold twice
  r = await cashier.post('/sales', { items: [{ product_id: phone.id, serial: '350000000000001' }] });
  assert.equal(r.status, 400);

  const p = (await admin.get(`/products/${phone.id}`)).data;
  assert.equal(p.qty, 1);
  assert.equal(p.serials.length, 1);
  assert.equal((await admin.get(`/products/${cable.id}`)).data.qty, 18);

  // Cashier sees own sale; search by IMEI works
  const list = await cashier.get('/sales?q=350000000000001');
  assert.equal(list.data.length, 1);
});

test('reports compute profit', async () => {
  const r = await admin.get('/reports/sales');
  assert.equal(r.status, 200);
  // revenue 7000, cost 6000 + 2*50 = 6100
  assert.equal(r.data.totals.gross, 7000);
  assert.equal(r.data.totals.profit, 900);
  assert.equal(r.data.by_user[0].full_name, 'سارة');
  assert.equal(r.data.by_user[0].profit, 900);
  const inv = await admin.get('/reports/inventory');
  assert.equal(inv.data.totals.qty, 19);
  const dash = await admin.get('/dashboard');
  assert.equal(dash.data.today.total, 7000);
  assert.equal(dash.data.today.profit, 900);
});

test('returns restock and reverse profit', async () => {
  const { sale, phone } = state;
  assert.equal((await cashier.post(`/sales/${sale.id}/return`, { items: [] })).status, 403);
  const phoneItem = sale.items.find((i) => i.serial);
  const r = await admin.post(`/sales/${sale.id}/return`, { items: [{ sale_item_id: phoneItem.id }], reason: 'عيب صناعة' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.status, 'partial_return');
  // 7000 × (7000/7200) = 6805.56
  assert.equal(r.data.returned_total, 6805.56);
  assert.equal((await admin.get(`/products/${phone.id}`)).data.qty, 2);
  // Returning again fails
  assert.equal((await admin.post(`/sales/${sale.id}/return`, { items: [{ sale_item_id: phoneItem.id }] })).status, 400);

  const rep = (await admin.get('/reports/sales')).data.totals;
  assert.equal(rep.returns, 6805.56);
  // remaining: cables 200 - 194.44 discount share = 194.44 revenue, cost 100 → 94.44
  assert.equal(rep.profit, 94.44);
});

test('stocktake: scan, count, apply', async () => {
  const { cable, phone } = state;
  const st = await admin.post('/stocktakes', {});
  assert.equal(st.status, 201);
  const id = st.data.id;

  for (let i = 0; i < 3; i++) await admin.post(`/stocktakes/${id}/scan`, { code: cable.barcode });
  await admin.put(`/stocktakes/${id}/items/${cable.id}`, { counted_qty: 15 });
  let r = await admin.post(`/stocktakes/${id}/scan`, { code: '350000000000002' });
  assert.equal(r.data.item.counted_qty, 1);
  r = await admin.post(`/stocktakes/${id}/scan`, { code: '350000000000002' });
  assert.equal(r.status, 400); // already counted
  r = await admin.post(`/stocktakes/${id}/scan`, { code: phone.barcode });
  assert.equal(r.status, 400); // phones counted by IMEI

  r = await admin.post(`/stocktakes/${id}/apply`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { changed: 2, missing: 1 });
  assert.equal((await admin.get(`/products/${cable.id}`)).data.qty, 15);
  const p = (await admin.get(`/products/${phone.id}`)).data;
  assert.equal(p.qty, 1);
  assert.deepEqual(p.serials.map((s) => s.serial), ['350000000000002']);
});

test('user admin safety', async () => {
  const me = (await admin.get('/auth/me')).data.user;
  assert.equal((await admin.put(`/users/${me.id}`, { active: false })).status, 400);
  assert.equal((await admin.put(`/users/${state.cashierId}`, { active: false })).status, 200);
  assert.equal((await cashier.get('/auth/me')).status, 401);
});

test('remote safety: lockout by address and logout of other devices', async () => {
  // 20 wrong passwords from one address lock it out, even across different usernames
  for (let i = 0; i < 20; i++) {
    await fetch(base + '/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
      body: JSON.stringify({ username: `nobody${i}`, password: 'x' }),
    });
  }
  const locked = await fetch(base + '/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  assert.equal(locked.status, 429);

  const other = client();
  await other.login('admin', 'admin123');
  assert.equal((await other.get('/auth/me')).status, 200);
  const r = await admin.post('/auth/logout-others');
  assert.ok(r.data.sessions >= 1);
  assert.equal((await other.get('/auth/me')).status, 401);
  assert.equal((await admin.get('/auth/me')).status, 200);

  // Can't keep the factory password
  assert.equal((await admin.post('/auth/password', { current: 'admin123', password: 'admin123' })).status, 400);
  assert.equal((await admin.post('/auth/password', { current: 'admin123', password: 'Shop@2026' })).status, 200);
  assert.equal((await admin.get('/auth/me')).data.must_change_password, false);
});
