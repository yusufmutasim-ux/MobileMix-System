'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../server/db');
const { createApp } = require('../server/app');

let server, base, db;
before(async () => {
  db = open(':memory:');
  // Some days had Visa as well as cash: the book's figure is both together
  db.prepare("INSERT INTO sales (user_id, subtotal, total, paid, payment_method, created_at) VALUES (1, 500, 500, 500, 'card', '2026-11-03 13:00:00')").run();
  db.prepare("INSERT INTO sales (user_id, subtotal, total, paid, payment_method, created_at) VALUES (1, 200, 200, 200, 'cash', '2026-11-03 14:00:00')").run();
  db.prepare("INSERT INTO sales (user_id, subtotal, total, paid, payment_method, created_at) VALUES (1, 300, 300, 300, 'instapay', '2026-11-05 14:00:00')").run();
  require('../server/owner-fixes').applyOwnerFixes(db);
  server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

test('month reset: days 1–8 are the book, 850 of it on the Visa machine; 400 cash + 850 Visa left', async () => {
  const res = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const r = await (await fetch(base + '/reports/finance?from=2026-11-01&to=2026-11-09', { headers: { cookie } })).json();
  const sum = (k) => r.simple_days.reduce((a, d) => a + d[k], 0);
  // The system's own invoices of those days are gone; the book is what counts
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sales WHERE bday(created_at) BETWEEN '2026-11-01' AND '2026-11-08'").get().n, 0);
  assert.equal(sum('sales'), 16750);
  assert.equal(sum('card'), 850);
  assert.equal(sum('cash'), 15900);
  assert.equal(sum('expenses'), 15500);
  assert.equal(r.money_left.cash, 400);
  assert.equal(r.money_left.card, 850);
  assert.equal(r.money_left.total, 1250);
  // No leftover adjustments
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM cash_moves WHERE note LIKE 'تعديل%'").get().n, 0);
});
