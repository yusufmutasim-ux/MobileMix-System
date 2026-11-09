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

test('month: days 1–8 bring 16,750 in all, expenses 16,350 → 400 left before the next days', async () => {
  let cookie = '';
  const res = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  cookie = res.headers.get('set-cookie').split(';')[0];
  const r = await (await fetch(base + '/reports/finance?from=2026-11-01&to=2026-11-09', { headers: { cookie } })).json();
  const days = r.simple_days.filter((d) => d.day <= '2026-11-08');
  assert.equal(days.reduce((a, d) => a + d.cash_net + d.card, 0), 16750);
  assert.equal(days.find((d) => d.day === '2026-11-03').cash_net + days.find((d) => d.day === '2026-11-03').card, 1150);
  assert.equal(r.money_left.spent, 16350);
  assert.equal(r.money_left.total, 400);
});
