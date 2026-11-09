'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../server/db');
const { createApp } = require('../server/app');

let server, base, db;
before(async () => {
  db = open(':memory:'); server = createApp(db).listen(0);
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


test('month reconciliation: each day brought to the owner\'s figure with a "تعديل" entry', async () => {
  const { applyOwnerFixes, dayCash } = require('../server/owner-fixes');
  const admin = client();
  await admin.post('/auth/login', { username: 'admin', password: 'admin123' });
  const ins = (sql, ...a) => db.prepare(sql).run(...a);
  // Day 1: cash sale 1,000 and a card sale 500 (not cash); 50 expense from the drawer → 950 in the system
  ins("INSERT INTO sales (user_id, subtotal, total, paid, payment_method, created_at) VALUES (1, 1000, 1000, 1000, 'cash', '2026-11-01 14:00:00')");
  ins("INSERT INTO sales (user_id, subtotal, total, paid, payment_method, created_at) VALUES (1, 500, 500, 500, 'card', '2026-11-01 15:00:00')");
  ins("INSERT INTO expenses (category, amount, from_drawer, user_id, created_at) VALUES ('أكل', 50, 1, 1, '2026-11-01 16:00:00')");
  // Day 2: a sale at 1 AM counts on day 2 (shop day ends at 3 AM): 2,000
  ins("INSERT INTO sales (user_id, subtotal, total, paid, payment_method, created_at) VALUES (1, 2000, 2000, 2000, 'cash', '2026-11-03 01:00:00')");
  // Day 2 was closed: expected 2,000, counted 1,900
  ins("INSERT INTO drawer_closings (user_id, opened_at, closed_at, opening, expected, counted, diff, left_in_drawer) VALUES (1, '2026-11-02 03:00:00', '2026-11-03 01:30:00', 0, 2000, 1900, -100, 0)");
  assert.equal(dayCash(db, '2026-11-01'), 950);
  assert.equal(dayCash(db, '2026-11-02'), 2000);
  const report = applyOwnerFixes(db, [{ id: 't1', days: { '2026-11-01': 1200, '2026-11-02': 1900, '2026-11-03': 0 },
    expenses: [{ category: 'إيجار', amount: 8050, note: 'تكملة إيجار', at: '2026-11-08 12:00:00' }] }]);
  assert.deepEqual(report.map((r) => [r.day, r.diff]), [['2026-11-01', 250], ['2026-11-02', -100]]);
  const moves = db.prepare("SELECT kind, amount, bday(created_at) AS d, created_at FROM cash_moves ORDER BY id").all().map((m) => ({ ...m }));
  assert.deepEqual(moves.map(({ created_at, ...m }) => m), [{ kind: 'in', amount: 250, d: '2026-11-01' }, { kind: 'out', amount: 100, d: '2026-11-02' }]);
  assert.equal(moves[1].created_at, '2026-11-03 01:29:59'); // just before that day's closing
  // The closing that day 2 fell in is now exact
  const c = db.prepare('SELECT expected, diff FROM drawer_closings').get();
  assert.equal(c.expected, 1900);
  assert.equal(c.diff, 0);
  // The month expense is outside the drawer
  const e = db.prepare("SELECT from_drawer, amount FROM expenses WHERE note = 'تكملة إيجار'").get();
  assert.equal(e.from_drawer, 0);
  // Runs once
  assert.deepEqual(applyOwnerFixes(db, [{ id: 't1', days: { '2026-11-01': 5 } }]), []);
});

test('report: cash left after month expenses, and the Visa money kept apart', async () => {
  const admin = client();
  await admin.post('/auth/login', { username: 'admin', password: 'admin123' });
  const ins = (sql, ...a) => db.prepare(sql).run(...a);
  ins("INSERT INTO sales (user_id, subtotal, total, paid, payment_method, created_at) VALUES (1, 3000, 3000, 3000, 'card', '2026-11-20 14:00:00')");
  ins("INSERT INTO sales (user_id, subtotal, total, paid, payment_method, created_at) VALUES (1, 5000, 5000, 5000, 'cash', '2026-11-20 15:00:00')");
  // Month expenses through the API: one from the month's cash, one from the Visa money
  const a = await admin.post('/expenses', { category: 'إيجار', amount: 1000, from_drawer: false, paid_with: 'cash' });
  assert.equal(a.status, 201);
  const e = await admin.post('/expenses', { category: 'أخرى', amount: 850, from_drawer: false, paid_with: 'card' });
  assert.equal(e.data.paid_with, 'card');
  db.prepare("UPDATE expenses SET created_at = '2026-11-20 16:00:00' WHERE id IN (?, ?)").run(a.data.id, e.data.id);
  const r = (await admin.get('/reports/finance?from=2026-11-20&to=2026-11-20')).data.money_left;
  assert.equal(r.cash, 4000);
  assert.equal(r.card, 2150);
  assert.equal(r.card_out, 850);
});
