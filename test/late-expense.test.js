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


const tick = () => new Promise((r) => setTimeout(r, 1100));

test('recording something forgotten before the last drawer closing', async () => {
  const admin = client();
  await admin.post('/auth/login', { username: 'admin', password: 'admin123' });

  // No closing yet
  assert.equal((await admin.post('/expenses', { category: 'أخرى', amount: 10, before_close: true })).status, 400);

  // Drawer had 0 expected; counted 0 → closed. Then put 1000 in, and close counting 700 (300 short)
  await admin.post('/drawer/close', { counted: 0 });
  await tick(); await tick();
  await admin.post('/drawer/move', { kind: 'in', amount: 1000 });
  await tick();
  let c = (await admin.post('/drawer/close', { counted: 700 })).data;
  assert.equal(c.diff, -300);
  const now0 = (await admin.get('/drawer')).data.expected;
  assert.equal(now0, 700);
  await tick();

  // Forgot a 200 expense → that closing is now 100 short; the current drawer doesn't change
  let r = (await admin.post('/expenses', { category: 'أخرى', amount: 200, note: 'أكل', before_close: true })).data;
  assert.equal(r.closing.diff, -100);
  assert.equal((await admin.get('/drawer')).data.expected, 700);

  // And 100 the owner took out → exact
  r = (await admin.post('/drawer/move', { kind: 'out', amount: 100, before_close: true })).data;
  assert.equal(r.closing.diff, 0);
  assert.equal(r.closing.expected, 700);
  assert.equal((await admin.get('/drawer')).data.expected, 700);

  // An employee's allowance and advance, forgotten too
  const ali = (await admin.post('/users', { username: 'ali', full_name: 'علي', role: 'cashier', password: '123456' })).data;
  r = (await admin.post('/allowances', { user_id: ali.id, amount: 50, before_close: true })).data;
  assert.equal(r.count, 1);
  assert.equal((await admin.post('/allowances', { user_id: ali.id, before_close: true })).data.count, 0); // once per day
  assert.equal((await admin.post(`/payroll/${ali.id}/advance`, { amount: 30, before_close: true })).status, 201);
  let last = (await admin.get('/drawer')).data.closings[0];
  assert.equal(last.diff, 80);
  assert.equal((await admin.get('/drawer')).data.expected, 700);

  // Deleting the forgotten expense puts it back on that closing
  const exp = (await admin.get('/expenses')).data.rows.find((e) => e.note === 'أكل');
  await admin.del(`/expenses/${exp.id}`);
  last = (await admin.get('/drawer')).data.closings[0];
  assert.equal(last.diff, -120);

  // Normal expenses still go to the open drawer
  await admin.post('/expenses', { category: 'أخرى', amount: 20 });
  assert.equal((await admin.get('/drawer')).data.expected, 680);
  assert.equal((await admin.get('/drawer')).data.closings[0].diff, -120);
});
