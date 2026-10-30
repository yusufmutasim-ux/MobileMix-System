'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../server/db');
const { applyStockBatches, BATCHES } = require('../server/stock-batches');

test('entered goods: added once, brands first, existing products left alone', () => {
  const db = open(':memory:');
  db.prepare("INSERT INTO products (name, sell_price, qty) VALUES ('SENDEM M35 6A Type-C Cable', 120, 1)").run();
  applyStockBatches(db);
  applyStockBatches(db); // second start: nothing doubled
  const all = BATCHES[0].products;
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM products').get().n, all.length);
  assert.equal(db.prepare("SELECT qty FROM products WHERE name = 'SENDEM M35 6A Type-C Cable'").get().qty, 1);
  const plug = db.prepare("SELECT * FROM products WHERE name = 'iLock Slim Plug Adapter UK 13A'").get();
  assert.equal(plug.qty, 15);
  assert.equal(plug.brand, 'iLock');
  assert.match(plug.barcode, /^2000\d{8}$/);
  assert.deepEqual(db.prepare('SELECT name FROM brands ORDER BY name').all().map((b) => b.name), ['iLock', 'SENDEM']);
});
