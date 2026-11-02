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

test('removing employees', async () => {
  const admin = client();
  await admin.post('/auth/login', { username: 'admin', password: 'admin123' });
  const me = (await admin.get('/auth/me')).data.user;

  // Can't remove yourself
  assert.equal((await admin.del(`/users/${me.id}`)).status, 400);

  // Someone with no history is erased
  const fresh = (await admin.post('/users', { username: 'temp', full_name: 'مؤقت', role: 'cashier', password: '123456' })).data;
  let r = await admin.del(`/users/${fresh.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.erased, true);

  // Someone with history: off the lists, can't log in, name kept on old records, username free again
  const ali = (await admin.post('/users', { username: 'ali', full_name: 'علي', role: 'cashier', password: '123456' })).data;
  const cashier = client();
  assert.equal((await cashier.post('/auth/login', { username: 'ali', password: '123456' })).status, 200);
  assert.ok((await admin.post('/allowances', { user_id: ali.id })).status < 300);

  r = await admin.del(`/users/${ali.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.erased, false);
  assert.ok(!(await admin.get('/users')).data.some((u) => u.id === ali.id));
  assert.equal((await cashier.get('/auth/me')).status, 401);
  assert.notEqual((await client().post('/auth/login', { username: 'ali', password: '123456' })).status, 200);
  assert.ok(!(await admin.get('/allowances/today')).data.list.some((u) => u.id === ali.id));

  assert.equal((await admin.post('/users', { username: 'ali', full_name: 'علي التاني', role: 'cashier', password: '123456' })).status, 201);
  assert.equal((await admin.del(`/users/${ali.id}`)).status, 404);
});
