'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../server/db');
const { createApp } = require('../server/app');
const { bday, setDayEnd } = require('../server/util');

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


test('bday: after midnight, until the day-end hour, is still the day before', () => {
  setDayEnd(3);
  assert.equal(bday('2026-11-03 01:00:00'), '2026-11-02');
  assert.equal(bday('2026-11-03 02:59:59'), '2026-11-02');
  assert.equal(bday('2026-11-03 03:00:00'), '2026-11-03');
  assert.equal(bday('2026-03-01 00:30:00'), '2026-02-28');
  assert.equal(bday('2026-01-01 00:10:00'), '2025-12-31');
  setDayEnd(0);
  assert.equal(bday('2026-11-03 01:00:00'), '2026-11-03');
});

test('expenses and sales at 1 AM count on the shop day that started', async () => {
  const admin = client();
  await admin.post('/auth/login', { username: 'admin', password: 'admin123' });
  assert.equal((await admin.get('/settings')).data.day_end_hour, '3');
  await admin.put('/settings', { day_end_hour: '3' });
  db.prepare("INSERT INTO expenses (category, amount, from_drawer, user_id, created_at) VALUES ('أكل', 75, 1, 1, '2026-11-03 01:00:00')").run();
  db.prepare("INSERT INTO expenses (category, amount, from_drawer, user_id, created_at) VALUES ('أكل', 25, 1, 1, '2026-11-03 09:00:00')").run();
  let r = (await admin.get('/expenses?from=2026-11-02&to=2026-11-02')).data;
  assert.equal(r.total, 75);
  r = (await admin.get('/expenses?from=2026-11-03&to=2026-11-03')).data;
  assert.equal(r.total, 25);
  // Back to midnight: calendar days
  await admin.put('/settings', { day_end_hour: '0' });
  r = (await admin.get('/expenses?from=2026-11-03&to=2026-11-03')).data;
  assert.equal(r.total, 100);
  await admin.put('/settings', { day_end_hour: '3' });
});
