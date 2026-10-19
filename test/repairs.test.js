'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
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
    const res = await fetch(base + p, {
      method, headers: { 'content-type': 'application/json', cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return {
    get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), put: (p, b) => call('PUT', p, b ?? {}),
    del: (p) => call('DELETE', p), login: (u, pw) => call('POST', '/auth/login', { username: u, password: pw }),
  };
}

const admin = client();
const cashier = client();
const tech = client();
const s = {};

test('setup staff and a spare part', async () => {
  await admin.login('admin', 'admin123');
  await admin.post('/users', { username: 'cash', full_name: 'كاشير', role: 'cashier', password: '123456' });
  const t = await admin.post('/users', { username: 'tech', full_name: 'الفني', role: 'technician', password: '123456' });
  assert.equal(t.status, 201);
  s.techId = t.data.id;
  await cashier.login('cash', '123456');
  await tech.login('tech', '123456');
  const part = await admin.post('/products', { name: 'شاشة iPhone 11', cost_price: 900, sell_price: 1500, initial_qty: 3 });
  s.part = part.data;
  // Technician can't sell or see reports
  assert.equal((await tech.post('/sales', { items: [] })).status, 403);
  assert.equal((await tech.get('/reports/repairs')).status, 403);
});

test('intake with deposit', async () => {
  const bad = await cashier.post('/repairs', { customer_name: 'محمد', customer_phone: 'abc', device: 'iPhone 11', problem: 'شاشة' });
  assert.equal(bad.status, 400);
  const r = await cashier.post('/repairs', {
    customer_name: 'محمد علي', customer_phone: '0100 123 4567', device: 'iPhone 11', imei: '356000000000001',
    problem: 'شاشة مكسورة', accessories: 'جراب', estimated_cost: 2000, deposit: 500, deposit_method: 'cash',
    technician_id: s.techId,
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.ticket_no, 'R-000001');
  assert.equal(r.data.customer_phone, '01001234567');
  assert.equal(r.data.paid, 500);
  assert.equal(r.data.status, 'received');
  assert.equal(r.data.extra_cost, undefined); // cashier doesn't see costs
  s.r = r.data;

  // Technicians can receive devices but not take money
  const t = await tech.post('/repairs', { customer_name: 'س', customer_phone: '01111111111', device: 'A15', problem: 'شحن', deposit: 100 });
  assert.equal(t.status, 400);

  const hist = await cashier.get('/repairs/customer?phone=01001234567');
  assert.equal(hist.data.name, 'محمد علي');
  assert.equal((await cashier.get('/repairs?q=356000000000001')).data.length, 1);
});

test('technician work: status, parts, price', async () => {
  const id = s.r.id;
  assert.equal((await cashier.post(`/repairs/${id}/status`, { status: 'repairing' })).status, 403);
  let r = await tech.post(`/repairs/${id}/status`, { status: 'diagnosing', note: 'بدأ الفحص' });
  assert.equal(r.data.status, 'diagnosing');
  r = await tech.post(`/repairs/${id}/parts`, { product_id: s.part.id, qty: 5 });
  assert.equal(r.status, 400); // only 3 in stock
  r = await tech.post(`/repairs/${id}/parts`, { product_id: s.part.id, qty: 1 });
  assert.equal(r.status, 200);
  assert.equal(r.data.parts.length, 1);
  assert.equal(r.data.parts[0].unit_cost, undefined); // technician doesn't see cost
  assert.equal((await admin.get(`/products/${s.part.id}`)).data.qty, 2);

  // Remove and re-add returns the part to stock
  r = await tech.del(`/repairs/${id}/parts/${r.data.parts[0].id}`);
  assert.equal((await admin.get(`/products/${s.part.id}`)).data.qty, 3);
  await tech.post(`/repairs/${id}/parts`, { product_id: s.part.id, qty: 1 });

  r = await tech.put(`/repairs/${id}`, { price: 2200, diagnosis: 'تغيير شاشة', warranty_days: 30 });
  assert.equal(r.data.price, 2200);
  assert.equal((await tech.put(`/repairs/${id}`, { extra_cost: 50 })).status, 400); // costs are for managers
  r = await admin.put(`/repairs/${id}`, { extra_cost: 50 });
  assert.equal(r.data.profit, 2200 - 900 - 50);

  // Can't deliver before it's ready
  assert.equal((await cashier.post(`/repairs/${id}/deliver`, { amount: 1700 })).status, 400);
  r = await tech.post(`/repairs/${id}/status`, { status: 'ready' });
  assert.equal(r.data.outcome, 'repaired');
});

test('delivery collects the balance', async () => {
  const id = s.r.id;
  let r = await cashier.post(`/repairs/${id}/deliver`, { amount: 1000 });
  assert.equal(r.status, 400); // 700 still due
  r = await cashier.post(`/repairs/${id}/deliver`, { amount: 1700, method: 'wallet' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.status, 'delivered');
  assert.equal(r.data.balance, 0);
  assert.equal(r.data.warranty_days, 30);
  // Locked after delivery
  assert.equal((await tech.post(`/repairs/${id}/status`, { status: 'repairing' })).status, 400);
  assert.equal((await tech.post(`/repairs/${id}/parts`, { product_id: s.part.id })).status, 400);
});

test('not repaired: device returned, deposit refunded', async () => {
  let r = await cashier.post('/repairs', {
    customer_name: 'سارة', customer_phone: '01222222222', device: 'Samsung A50', problem: 'مياه', deposit: 200,
  });
  const id = r.data.id;
  await tech.post(`/repairs/${id}/status`, { status: 'not_repaired', note: 'البوردة تالفة' });
  assert.equal((await cashier.post(`/repairs/${id}/deliver`)).status, 400); // paid 200 > price 0
  r = await cashier.post(`/repairs/${id}/payments`, { kind: 'refund', amount: 200 });
  assert.equal(r.data.paid, 0);
  r = await cashier.post(`/repairs/${id}/deliver`);
  assert.equal(r.status, 200);
  assert.equal(r.data.outcome, 'not_repaired');
});

test('repairs report and dashboard', async () => {
  const r = await admin.get('/reports/repairs');
  assert.equal(r.status, 200);
  assert.equal(r.data.totals.delivered, 2);
  assert.equal(r.data.totals.repaired, 1);
  assert.equal(r.data.totals.revenue, 2200);
  assert.equal(r.data.totals.profit, 1250);
  assert.equal(r.data.totals.cash_in, 2200); // 500 + 1700 + 200 − 200
  assert.equal(r.data.by_technician[0].full_name, 'الفني');
  const d = await tech.get('/dashboard');
  assert.equal(d.status, 200);
  assert.equal(d.data.repairs.open, 0);
  assert.equal(d.data.recent.length, 0);
});

test('upgrades a database from the first version', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mm-')), 'old.db');
  const old = new DatabaseSync(file);
  old.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, full_name TEXT NOT NULL,
      password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('admin','manager','cashier')),
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
    CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL);
    CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE stock_movements (id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('purchase','sale','return','adjust','stocktake')), qty_change INTEGER NOT NULL,
      qty_after INTEGER NOT NULL, ref_id INTEGER, note TEXT, user_id INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
    CREATE INDEX idx_movements_product ON stock_movements(product_id, created_at);
    INSERT INTO users (username, full_name, password_hash, role) VALUES ('boss', 'Boss', 'x', 'admin');
    INSERT INTO sessions VALUES ('tok', 1, '2999-01-01');
    INSERT INTO products (name) VALUES ('p');
    INSERT INTO stock_movements (product_id, type, qty_change, qty_after) VALUES (1, 'purchase', 5, 5);`);
  old.close();

  const db = open(file);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n, 1);
  db.prepare("INSERT INTO users (username, full_name, password_hash, role) VALUES ('t', 'T', 'x', 'technician')").run();
  db.prepare("INSERT INTO stock_movements (product_id, type, qty_change, qty_after) VALUES (1, 'repair', -1, 4)").run();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM stock_movements').get().n, 2);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'idx_movements_product'").get());
  db.close();
});

test('ADMIN_PASSWORD applies to an existing database until changed in the app', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mm-')), 'pw.db');
  const { verifyPassword } = require('../server/auth');
  const hash = (db) => db.prepare("SELECT password_hash h FROM users WHERE username = 'admin'").get().h;
  const prev = process.env.ADMIN_PASSWORD;
  try {
    delete process.env.ADMIN_PASSWORD;
    open(file).close(); // first deploy without the variable
    process.env.ADMIN_PASSWORD = '  Shop#Pass1 '; // added later (with stray spaces)
    let db = open(file);
    assert.ok(verifyPassword('Shop#Pass1', hash(db)));
    // After the owner changes it in the app, the variable no longer overrides it
    db.prepare("UPDATE users SET password_hash = 'x' WHERE username = 'admin'").run();
    db.prepare("INSERT INTO audit_log (user_id, action) VALUES (1, 'password.change')").run();
    db.close();
    db = open(file);
    assert.equal(hash(db), 'x');
    db.close();
  } finally {
    if (prev === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = prev;
  }
});
