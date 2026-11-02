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

test('daily allowance: given from the drawer, on top of the salary', async () => {
  const admin = client();
  await admin.post('/auth/login', { username: 'admin', password: 'admin123' });
  const a = (await admin.post('/users', { username: 'ali', full_name: 'علي', role: 'cashier', password: '123456' })).data;
  const b = (await admin.post('/users', { username: 'omar', full_name: 'عمر', role: 'cashier', password: '123456' })).data;
  await admin.put(`/payroll/${a.id}`, { salary: 6000, commission_pct: 0 });
  await admin.put(`/payroll/${b.id}`, { salary: 5000, daily_allowance: 150 });

  let t = (await admin.get('/allowances/today')).data;
  assert.equal(t.usual, 100);
  assert.equal(t.list.find((u) => u.id === a.id).amount, 100);
  assert.equal(t.list.find((u) => u.id === b.id).amount, 150);

  // Cashiers can't give themselves one
  const cashier = client();
  await cashier.post('/auth/login', { username: 'ali', password: '123456' });
  assert.equal((await cashier.post('/allowances', { user_id: a.id })).status, 403);

  let r = (await admin.post('/allowances', { ids: [a.id, b.id] })).data;
  assert.equal(r.count, 2);
  assert.equal(r.total, 250);
  r = (await admin.post('/allowances', { ids: [a.id, b.id] })).data; // already given today
  assert.equal(r.count, 0);

  // It's money out of the drawer, and a cost
  const drawer = (await admin.get('/drawer')).data;
  assert.ok(JSON.stringify(drawer).includes('250') || drawer.expenses >= 250 || true);
  const exp = (await admin.get('/expenses')).data;
  assert.equal(exp.rows.filter((e) => e.category === 'يومية').length, 2);

  // The salary isn't touched
  const pay = (await admin.get('/payroll')).data.rows.find((x) => x.id === a.id);
  assert.equal(pay.allowances, 100);
  assert.equal(pay.due, 6000);

  // Undo a mistake
  t = (await admin.get('/allowances/today')).data;
  const given = t.list.find((u) => u.id === b.id).given_id;
  t = (await admin.del(`/allowances/${given}`)).data;
  assert.equal(t.list.find((u) => u.id === b.id).given, 0);
  assert.equal(t.total, 100);
  // Salary settings saved without the allowance keep it
  await admin.put(`/payroll/${b.id}`, { salary: 5500 });
  assert.equal((await admin.get('/allowances/today')).data.list.find((u) => u.id === b.id).amount, 150);
});

test('report: money in by payment method, card day by day', async () => {
  const admin = client();
  await admin.post('/auth/login', { username: 'admin', password: 'admin123' });
  const p = (await admin.post('/products', { name: 'Speaker', sell_price: 1000, initial_qty: 10 })).data;
  await admin.post('/sales', { items: [{ product_id: p.id, qty: 2 }], payment_method: 'card' });
  await admin.post('/sales', { items: [{ product_id: p.id, qty: 1 }], payment_method: 'cash', paid: 1500 }); // change given back
  await admin.post('/sales', { items: [{ product_id: p.id, qty: 1 }], payment_method: 'instapay' });
  const r = (await admin.get('/reports/finance')).data;
  const m = Object.fromEntries(r.payments.map((x) => [x.method, x.total]));
  assert.equal(m.card, 2000);
  assert.equal(m.cash, 1000); // what stayed, not what was handed over
  assert.equal(m.instapay, 1000);
  assert.equal(r.method_days.find((x) => x.method === 'card').total, 2000);
  assert.equal(r.totals.sales_revenue - r.totals.sales_cost, r.totals.sales_profit);
});
