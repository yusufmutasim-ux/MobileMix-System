'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { open } = require('../server/db');
const { createApp } = require('../server/app');

let server, base, cookie = '';
before(async () => {
  server = createApp(open(':memory:')).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());
async function call(method, p, body) {
  const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return { status: res.status, data: await res.json().catch(() => null) };
}

test('selling something not in the system yet, then adding it', async () => {
  await call('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  const cable = (await call('POST', '/products', { name: 'Cable', sell_price: 100, initial_qty: 3 })).data;
  assert.equal((await call('POST', '/sales', { items: [{ custom: true, name: '', unit_price: 50, qty: 1 }] })).status, 400);
  const r = await call('POST', '/sales', { items: [{ product_id: cable.id, qty: 1 }, { custom: true, name: 'Glass protector iPhone 15', unit_price: 150, qty: 2, cost: 40 }] });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.total, 400);
  const line = r.data.items.find((i) => !i.product_id);
  assert.equal(line.name, 'Glass protector iPhone 15');
  assert.equal(line.unit_cost, 40);
  assert.equal((await call('GET', `/products/${cable.id}`)).data.qty, 2);
  await call('POST', '/sales', { items: [{ custom: true, name: 'glass protector iphone 15 ', unit_price: 150, qty: 1 }] });

  // Returned: no stock to put back, the money side still works
  const back = await call('POST', `/sales/${r.data.id}/return`, { items: [{ sale_item_id: line.id, qty: 1 }] });
  assert.equal(back.status, 200, JSON.stringify(back.data));

  let list = (await call('GET', '/products/unlisted')).data;
  assert.equal(list.length, 1); // same name, any case/spaces
  assert.equal(list[0].qty, 2);
  assert.equal(list[0].sales, 2);
  const rep = await call('GET', '/reports/sales');
  assert.equal(rep.status, 200);
  assert.ok(JSON.stringify(rep.data).includes('منتجات لسه مش متسجلة'));

  // Added as a product: earlier sales now count under it
  const glass = (await call('POST', '/products', { name: 'Glass protector iPhone 15', sell_price: 150, initial_qty: 10 })).data;
  const link = (await call('POST', '/products/unlisted/link', { name: list[0].name, product_id: glass.id })).data;
  assert.equal(link.linked, 2);
  list = (await call('GET', '/products/unlisted')).data;
  assert.equal(list.length, 0);
  assert.equal((await call('GET', `/products/${glass.id}`)).data.qty, 10); // stock untouched
});

test('an older database lets sale items have no product after the update', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-up-'));
  const file = path.join(dir, 'old.db');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE sale_items (id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL, product_id INTEGER NOT NULL, name TEXT NOT NULL, serial TEXT,
    qty INTEGER NOT NULL, unit_price REAL NOT NULL, unit_cost REAL NOT NULL DEFAULT 0, line_total REAL NOT NULL, returned_qty INTEGER NOT NULL DEFAULT 0)`);
  old.exec("INSERT INTO sale_items (sale_id, product_id, name, qty, unit_price, line_total) VALUES (1, 1, 'x', 1, 5, 5)");
  old.close();
  const db = open(file);
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'sale_items'").get().sql;
  assert.ok(!sql.includes('product_id INTEGER NOT NULL'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sale_items').get().n, 1);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
