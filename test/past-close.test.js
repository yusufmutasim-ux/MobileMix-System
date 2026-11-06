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



test('closing a forgotten day the next day', async () => {
  const admin = client();
  await admin.post('/auth/login', { username: 'admin', password: 'admin123' });
  const { today } = require('../server/util');
  const t = today();
  const back = (n) => { const d = new Date(`${t}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
  const y = back(1), y2 = back(2);
  // Two days nobody closed: 300 two days ago, 500 yesterday (one of them at 1 AM, still yesterday), and 200 today
  db.prepare("INSERT INTO cash_moves (kind, amount, user_id, created_at) VALUES ('in', 300, 1, ?)").run(`${y2} 15:00:00`);
  db.prepare("INSERT INTO cash_moves (kind, amount, user_id, created_at) VALUES ('in', 400, 1, ?)").run(`${y} 15:00:00`);
  db.prepare("INSERT INTO expenses (category, amount, from_drawer, user_id, created_at) VALUES ('أكل', 100, 1, 1, ?)").run(`${y} 20:00:00`);
  db.prepare("INSERT INTO cash_moves (kind, amount, user_id, created_at) VALUES ('in', 200, 1, ?)").run(`${t} 01:30:00`); // after midnight: still yesterday
  await admin.post('/drawer/move', { kind: 'in', amount: 200 }); // today
  let d = (await admin.get('/drawer')).data;
  assert.deepEqual(d.open_days, [y, y2]);
  assert.equal(d.expected, 1000);
  // Today and the future can't be "past days"
  assert.equal((await admin.post('/drawer/close', { counted: 0, day: t })).status, 400);
  // Close two days ago first: only its 300
  d = (await admin.get(`/drawer?day=${y2}`)).data;
  assert.equal(d.expected, 300);
  let c = (await admin.post('/drawer/close', { counted: 300, day: y2 })).data;
  assert.equal(c.diff, 0);
  // Then yesterday: 300 left + 400 − 100 + 200 = 800, counted 780 → 20 short
  c = (await admin.post('/drawer/close', { counted: 780, day: y })).data;
  assert.equal(c.expected, 800);
  assert.equal(c.diff, -20);
  // Today's drawer: what was left yesterday + today's 200
  d = (await admin.get('/drawer')).data;
  assert.deepEqual(d.open_days, []);
  assert.equal(d.expected, 980);
  // Can't close yesterday again
  assert.equal((await admin.post('/drawer/close', { counted: 0, day: y })).status, 400);
});

test('correcting a closing, and undoing the last one', async () => {
  const admin = client();
  await admin.post('/auth/login', { username: 'admin', password: 'admin123' });
  let d = (await admin.get('/drawer')).data;
  const [last, prev] = d.closings; // yesterday (counted 780, 800 expected), two days ago (300)
  // Two days ago actually counted 280 and left 250 in the drawer
  let r = await admin.put(`/drawer/closings/${prev.id}`, { counted: 280, left_in_drawer: 250 });
  assert.equal(r.status, 200);
  assert.equal(r.data.diff, -20);
  // Yesterday's opening follows: 250 instead of 300 → expected 750, counted 780 → 30 extra
  d = (await admin.get('/drawer')).data;
  assert.equal(d.closings[0].opening, 250);
  assert.equal(d.closings[0].expected, 750);
  assert.equal(d.closings[0].diff, 30);
  // Yesterday: counted 750, everything left in the drawer → exact; today's drawer starts from 750
  r = await admin.put(`/drawer/closings/${last.id}`, { counted: 750, left_in_drawer: 750, note: 'اتعدّت تاني' });
  assert.equal(r.data.diff, 0);
  d = (await admin.get('/drawer')).data;
  assert.equal(d.expected, 950);
  // Left more than counted: refused
  assert.equal((await admin.put(`/drawer/closings/${last.id}`, { counted: 100, left_in_drawer: 200 })).status, 400);
  // Only the last closing can be undone; then yesterday is open again
  assert.equal((await admin.del(`/drawer/closings/${prev.id}`)).status, 400);
  assert.equal((await admin.del(`/drawer/closings/${last.id}`)).status, 200);
  d = (await admin.get('/drawer')).data;
  assert.equal(d.open_days.length, 1);
  assert.equal(d.expected, 250 + 400 - 100 + 200 + 200);
});

test('adding a forgotten sale or expense to a chosen closing', async () => {
  const admin = client();
  await admin.post('/auth/login', { username: 'admin', password: 'admin123' });
  await admin.post('/drawer/close', { counted: 950 }); // close everything now
  await new Promise((r) => setTimeout(r, 1100));
  let d = (await admin.get('/drawer')).data;
  const [last, older] = d.closings;
  const before = { last: last.diff, older: older.diff, open: d.expected };
  const p = (await admin.post('/products', { name: 'Charger', sell_price: 150, initial_qty: 4 })).data;
  // A cash sale forgotten on the older closing: that one gets +150, the others don't move
  const s = await admin.post('/sales', { items: [{ product_id: p.id, qty: 1 }], payment_method: 'cash', paid: 150, closing_id: older.id });
  assert.equal(s.status, 201);
  assert.ok(s.data.created_at <= older.closed_at && s.data.created_at > (older.opened_at || ''));
  assert.equal((await admin.get(`/products/${p.id}`)).data.qty, 3);
  // A card sale changes nothing in the drawer
  await admin.post('/sales', { items: [{ product_id: p.id, qty: 1 }], payment_method: 'card', closing_id: older.id });
  // An expense of 40 on the same closing
  await admin.post('/expenses', { category: 'أخرى', amount: 40, closing_id: older.id });
  d = (await admin.get('/drawer')).data;
  const o = d.closings.find((c) => c.id === older.id);
  assert.equal(o.diff, before.older - 150 + 40);
  assert.equal(d.closings.find((c) => c.id === last.id).diff, before.last);
  assert.equal(d.expected, before.open);
  // Staff can't
  await admin.post('/users', { username: 'cs2', full_name: 'كاشير', role: 'cashier', password: '123456' });
  const c = client(); await c.post('/auth/login', { username: 'cs2', password: '123456' });
  assert.equal((await c.post('/sales', { items: [{ product_id: p.id, qty: 1 }], payment_method: 'cash', closing_id: older.id })).status, 400);
});
