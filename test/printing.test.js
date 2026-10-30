'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../server/db');
const { createApp } = require('../server/app');

let server, base, cookie = '';
before(async () => {
  server = createApp(open(':memory:')).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());
async function call(method, path, body) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return { status: res.status, data: await res.json().catch(() => null) };
}

test('printing from a phone: the computer gets the job live, and only once', async () => {
  await call('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  assert.equal((await call('GET', '/print-jobs/status')).data.online, false);
  assert.equal((await call('POST', '/print-jobs', { kind: 'nope', args: [1] })).status, 400);

  // Sent while no computer is listening: delivered when it connects
  const early = await call('POST', '/print-jobs', { kind: 'invoice', args: [{ invoice_no: 'MM-1' }, null] });
  assert.equal(early.status, 201);

  const ctrl = new AbortController();
  const stream = await fetch(base + '/print-jobs/stream?name=PC', { headers: { cookie }, signal: ctrl.signal });
  const reader = stream.body.getReader();
  let text = '';
  const until = async (re) => { while (!re.test(text)) text += new TextDecoder().decode((await reader.read()).value); };
  await until(/MM-1/);
  assert.equal((await call('GET', '/print-jobs/status')).data.online, true);

  await call('POST', '/print-jobs', { kind: 'labels', args: [[{ product: { name: 'x' }, copies: 1 }], '38x25'] });
  await until(/"kind":"labels"/);

  assert.equal((await call('POST', `/print-jobs/${early.data.id}/take`)).data.ok, true);
  assert.equal((await call('POST', `/print-jobs/${early.data.id}/take`)).data.ok, false); // a second computer skips it
  ctrl.abort();
});
