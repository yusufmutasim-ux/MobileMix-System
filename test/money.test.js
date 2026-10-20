'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../server/db');
const { createApp } = require('../server/app');
const { daySummary, startScheduler } = require('../server/scheduler');

let server, base, db;
const sent = [];

before(async () => {
  db = open(':memory:');
  const app = createApp(db);
  const notify = app.locals.notifier.notify;
  app.locals.notifier.notify = (n) => { sent.push(n); return notify(n); };
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

function client() {
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), put: (p, b) => call('PUT', p, b ?? {}), del: (p) => call('DELETE', p),
    login: (u, pw) => call('POST', '/auth/login', { username: u, password: pw }) };
}

const admin = client();
const cashier = client();
const s = {};
const monthNow = () => new Date().toISOString().slice(0, 7);
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

test('setup: staff and products', async () => {
  await admin.login('admin', 'admin123');
  const u = await admin.post('/users', { username: 'mona', full_name: 'منى', role: 'cashier', password: '123456' });
  s.cashierId = u.data.id;
  assert.equal((await cashier.login('mona', '123456')).status, 200);
  s.case = (await admin.post('/products', { name: 'جراب', sell_price: 100, cost_price: 40, initial_qty: 10, warranty_days: 0 })).data;
  s.phone = (await admin.post('/products', { name: 'Galaxy A15', sell_price: 7000, cost_price: 6000, has_serial: true, warranty_days: 365 })).data;
  assert.equal(s.phone.warranty_days, 365);
});

test('purchases: supplier, stock in with average cost, what we owe', async () => {
  assert.equal((await cashier.get('/suppliers')).status, 403);
  const sup = await admin.post('/suppliers', { name: 'المصري للإكسسوار', phone: '0100 000 0000' });
  assert.equal(sup.status, 201);
  s.sup = sup.data;
  // Remaining money needs a supplier
  let r = await admin.post('/purchases', { items: [{ product_id: s.case.id, qty: 10, unit_cost: 50 }], paid: 0 });
  assert.equal(r.status, 400);
  // Phones need one IMEI per unit
  r = await admin.post('/purchases', { supplier_id: s.sup.id, items: [{ product_id: s.phone.id, unit_cost: 6100 }] });
  assert.equal(r.status, 400);
  r = await admin.post('/purchases', {
    supplier_id: s.sup.id, ref_no: 'INV-77', paid: 3000, paid_from_drawer: false,
    items: [{ product_id: s.case.id, qty: 10, unit_cost: 50, sell_price: 120 },
      { product_id: s.phone.id, unit_cost: 6100, serials: ['359000000000001', '359000000000002'] }],
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.total, 10 * 50 + 2 * 6100);
  assert.equal(r.data.paid, 3000);
  assert.match(r.data.purchase_no, /^P-0+1$/);
  const caseNow = (await admin.get(`/products/${s.case.id}`)).data;
  assert.equal(caseNow.qty, 20);
  assert.equal(caseNow.cost_price, 45); // (10×40 + 10×50) / 20
  assert.equal(caseNow.sell_price, 120);
  assert.equal((await admin.get(`/products/${s.phone.id}`)).data.qty, 2);

  let sup2 = (await admin.get(`/suppliers/${s.sup.id}`)).data;
  assert.equal(sup2.balance, 12700 - 3000);
  r = await admin.post(`/suppliers/${s.sup.id}/payments`, { amount: 700, from_drawer: false });
  assert.equal(r.data.balance, 9000);
  sup2 = (await admin.get('/suppliers')).data.find((x) => x.id === s.sup.id);
  assert.equal(sup2.balance, 9000);
});

test('credit sale needs a customer, installments split what is owed', async () => {
  let r = await cashier.post('/sales', { items: [{ product_id: s.phone.id, serial: '359000000000001' }], paid: 1000 });
  assert.equal(r.status, 400); // no customer
  r = await cashier.post('/sales', {
    items: [{ product_id: s.phone.id, serial: '359000000000001' }], paid: 1000, payment_method: 'installment',
    customer_name: 'أحمد علي', customer_phone: '010-1111-2222',
    installments: { count: 3, every: 'month', first_date: inDays(-40) },
  });
  assert.equal(r.status, 400); // first installment in the past
  r = await cashier.post('/sales', {
    items: [{ product_id: s.phone.id, serial: '359000000000001' }], paid: 1000, payment_method: 'installment',
    customer_name: 'أحمد علي', customer_phone: '010-1111-2222',
    installments: { count: 3, every: 'month', first_date: inDays(0) },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  s.credit = r.data;
  assert.equal(r.data.due, 6000);
  assert.equal(r.data.installments.length, 3);
  assert.equal(r.data.installments.reduce((a, i) => a + i.amount, 0), 6000);
  assert.equal(r.data.items[0].warranty_days, 365);
  assert.ok(r.data.items[0].warranty_until > inDays(360));

  // The customer was saved (digits only)
  const list = (await cashier.get('/customers?q=أحمد')).data;
  assert.equal(list.rows.length, 1);
  assert.equal(list.rows[0].phone, '01011112222');
  assert.equal(list.rows[0].due, 6000);
  s.customer = list.rows[0];

  // Make the first installment late, then check the reminders
  db.prepare("UPDATE sale_installments SET due_date = date('now','localtime','-3 days') WHERE sale_id = ? AND seq = 1").run(s.credit.id);
  const inst = (await cashier.get('/installments')).data;
  assert.equal(inst.late.length, 1);
  assert.equal(inst.late[0].left, 2000);
  assert.equal((await cashier.get('/customers?filter=late')).data.rows.length, 1);
});

test('collecting: on one invoice, or spread over everything the customer owes', async () => {
  // A second unpaid invoice for the same customer (same number typed differently)
  let r = await cashier.post('/sales', { items: [{ product_id: s.case.id, qty: 2 }], paid: 0, customer_name: 'أحمد', customer_phone: '01011112222' });
  assert.equal(r.status, 201);
  s.credit2 = r.data;
  assert.equal(r.data.due, 240);

  r = await cashier.post(`/sales/${s.credit.id}/payments`, { amount: 9999 });
  assert.equal(r.status, 400); // more than owed
  r = await cashier.post(`/sales/${s.credit.id}/payments`, { amount: 1500, method: 'cash' });
  assert.equal(r.status, 201);
  assert.equal(r.data.due, 4500);
  assert.equal(r.data.installments[0].state, 'late'); // 1500 of 2000
  assert.equal(r.data.installments[0].left, 500);

  r = await cashier.post(`/customers/${s.customer.id}/pay`, { amount: 600 });
  assert.equal(r.status, 201);
  // Oldest invoice first: 500 → first invoice... all 600 go to the phone invoice (older)
  assert.deepEqual(r.data.invoices.map((i) => i.amount), [600]);
  assert.equal(r.data.left, 4500 - 600 + 240);
  const c = (await cashier.get(`/customers/${s.customer.id}`)).data;
  assert.equal(c.due, 4140);
  assert.equal(c.installments.find((i) => i.seq === 1).state, 'paid');
  assert.equal((await cashier.get('/installments')).data.late.length, 0);
  assert.ok(sent.some((n) => n.type === 'customer_payment'));
});

test('returns on a credit sale reduce what is owed before handing back cash', async () => {
  // Invoice 2: 240 owed, nothing paid → returning one case (120) hands back nothing
  let r = await admin.post(`/sales/${s.credit2.id}/return`, { items: [{ sale_item_id: s.credit2.items[0].id, qty: 1 }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.due, 120);
  assert.equal(r.data.returns[0].cash_out, 0);
  // Normal cash sale: the full amount goes back
  const cash = (await cashier.post('/sales', { items: [{ product_id: s.case.id, qty: 1 }] })).data;
  r = await admin.post(`/sales/${cash.id}/return`, { items: [{ sale_item_id: cash.items[0].id, qty: 1 }] });
  assert.equal(r.data.returns[0].cash_out, 120);
  assert.equal(r.data.due, 0);
});

test('expenses and counting the drawer', async () => {
  let r = await cashier.post('/expenses', { category: 'أكل ومشروبات', amount: 85, note: 'غدا' });
  assert.equal(r.status, 201);
  assert.equal(r.data.from_drawer, 1);
  // Staff can't record salaries
  r = await cashier.post('/expenses', { category: 'مرتبات', amount: 100, employee_id: s.cashierId });
  assert.equal(r.status, 400);
  r = await admin.post('/expenses', { category: 'إيجار', amount: 5000, from_drawer: false });
  assert.equal(r.data.from_drawer, 0);
  const mine = (await cashier.get('/expenses')).data;
  assert.equal(mine.rows.length, 1); // only their own
  const all = (await admin.get('/expenses')).data;
  assert.equal(all.total, 5085);

  const blind = (await cashier.get('/drawer')).data;
  assert.equal(blind.blind, true); // staff count blind
  assert.equal(blind.expected, undefined);
  const d = (await admin.get('/drawer')).data;
  // Cash in: phone down payment 1000 + collections 2100 + cash sale 120 − refund 120 − expense 85
  assert.equal(d.parts.sales, 1000 + 120);
  assert.equal(d.parts.collections, 2100);
  assert.equal(d.parts.refunds, -120);
  assert.equal(d.parts.expenses, -85);
  assert.equal(d.expected, 1000 + 120 + 2100 - 120 - 85);

  assert.equal((await cashier.post('/drawer/move', { kind: 'out', amount: 10 })).status, 403);
  await admin.post('/drawer/move', { kind: 'out', amount: 1000, note: 'سحب المالك' });
  r = await cashier.post('/drawer/close', { counted: 1985, left_in_drawer: 500 });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.expected, 2015);
  assert.equal(r.data.diff, -30);
  assert.ok(sent.some((n) => n.type === 'drawer_close' && /عجز/.test(n.title)));
  // Next count starts from what was left
  const d2 = (await admin.get('/drawer')).data;
  assert.equal(d2.opening, 500);
  assert.equal(d2.expected, 500);
  assert.equal(d2.closings.length, 1);
});

test('finance report and home screen', async () => {
  const f = (await admin.get('/reports/finance')).data;
  assert.equal(f.totals.expenses, 5085);
  assert.equal(f.totals.receivable, 4140 - 120);
  assert.equal(f.totals.payable, 9000);
  assert.equal(f.totals.net_profit, f.totals.sales_profit + f.totals.repairs_profit - 5085);
  const dash = (await admin.get('/dashboard')).data;
  assert.equal(dash.expenses_today, 5085);
  assert.equal(dash.credit.due, 4020);
  assert.equal(typeof dash.drawer, 'number');
  const sum = daySummary(db);
  assert.equal(sum.expenses, 5085);
});

test('payroll: salary + commission − advances − paid', async () => {
  assert.equal((await cashier.get('/payroll')).status, 403);
  await admin.put(`/payroll/${s.cashierId}`, { salary: 4000, commission_pct: 1 });
  await admin.post(`/payroll/${s.cashierId}/advance`, { amount: 500 });
  let p = (await admin.get(`/payroll?month=${monthNow()}`)).data;
  let row = p.rows.find((r) => r.id === s.cashierId);
  // Mona sold: phone 7000 + cases 240 + case 120 − returns 120 − 120
  assert.equal(row.sales, 7000 + 240 + 120 - 240);
  assert.equal(row.commission, 71.2);
  assert.equal(row.advances, 500);
  assert.equal(row.due, 4000 + 71.2 - 500);
  await admin.post(`/payroll/${s.cashierId}/pay`, { amount: row.due, month: monthNow() });
  p = (await admin.get(`/payroll?month=${monthNow()}`)).data;
  row = p.rows.find((r) => r.id === s.cashierId);
  assert.equal(row.due, 0);
  assert.equal(row.paid, 3571.2);
});

test('search everything and warranty lookup', async () => {
  // A sale without a phone must not match a name search
  await cashier.post('/sales', { items: [{ product_id: s.case.id, qty: 1 }] });
  let r = (await cashier.get('/search?q=أحمد')).data;
  assert.ok(r.groups.find((g) => g.kind === 'sales').items.every((i) => /أحمد/.test(i.sub)));
  assert.ok(r.groups.find((g) => g.kind === 'customers'));
  assert.ok(r.groups.find((g) => g.kind === 'sales'));
  assert.ok(!r.groups.find((g) => g.kind === 'suppliers')); // cashier can't see suppliers
  r = (await admin.get('/search?q=359000000000002')).data;
  assert.ok(r.groups.find((g) => g.kind === 'products'));
  r = (await cashier.get('/warranty?q=359000000000001')).data;
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].state, 'active');
  assert.ok(r.items[0].days_left >= 364);
});

test('scheduler sends the day summary once a day', async () => {
  db.prepare("UPDATE settings SET value = '00:00' WHERE key = 'daily_summary_time'").run();
  const before = sent.length;
  const t = startScheduler(db, { notify: (n) => sent.push(n) }, { every: 10 });
  await new Promise((r) => setTimeout(r, 60));
  clearInterval(t);
  const summaries = sent.slice(before).filter((n) => n.type === 'daily_summary');
  assert.equal(summaries.length, 1);
  assert.match(summaries[0].title, /ملخص اليوم/);
});

test('start over clears the new money parts too', async () => {
  const counts = (await admin.get('/system/data-counts')).data;
  assert.ok(counts.money > 0 && counts.purchases > 0 && counts.customers > 0);
});
