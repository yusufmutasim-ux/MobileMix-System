'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { open } = require('../server/db');
const { createApp } = require('../server/app');

let server, base, dataDir;
before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-reset-'));
  server = createApp(open(path.join(dataDir, 'mobilemix.db')), { dataDir, pushSender: async () => {} }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

function client() {
  let cookie = '';
  const call = async (method, p, body) => {
    const res = await fetch(base + p, {
      method, headers: { 'content-type': 'application/json', cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), put: (p, b) => call('PUT', p, b ?? {}),
    login: (u, pw) => call('POST', '/auth/login', { username: u, password: pw }) };
}

const admin = client();
const cashier = client();
const ALL = ['sales', 'repairs', 'products', 'attendance', 'log'];

test('fill with test data', async () => {
  await admin.login('admin', 'admin123');
  await admin.post('/users', { username: 'karim', full_name: 'كريم', role: 'cashier', password: '123456' });
  await cashier.login('karim', '123456');
  await admin.put('/settings', { shop_name: 'محل التجربة', shop_phone: '0100' });
  const p = (await admin.post('/products', { name: 'منتج وهمي', sell_price: 100, initial_qty: 5 })).data;
  await admin.post('/products', { name: 'موبايل وهمي', sell_price: 5000, has_serial: true, serials: ['111222333444555'] });
  await cashier.post('/shifts/check-in');
  await cashier.post('/sales', { items: [{ product_id: p.id, qty: 2 }] });
  await cashier.post('/repairs', { customer_name: 'عميل', customer_phone: '01000000000', device: 'X', problem: 'Y', deposit: 50 });
  const c = (await admin.get('/system/data-counts')).data;
  assert.ok(c.sales && c.repairs && c.products && c.attendance && c.log);
});

test('only the owner, with password and the confirm word', async () => {
  assert.equal((await cashier.post('/system/reset', { parts: ALL })).status, 403);
  let r = await admin.post('/system/reset', { parts: ALL, password: 'wrong', confirm: 'امسح' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /كلمة السر/);
  r = await admin.post('/system/reset', { parts: ALL, password: 'admin123', confirm: 'نعم' });
  assert.equal(r.status, 400);
  assert.equal((await admin.get('/system/data-counts')).data.products, 2); // nothing touched
});

test('wipes everything except staff and shop settings, after a backup', async () => {
  const r = await admin.post('/system/reset', { parts: ALL, password: 'admin123', confirm: 'امسح' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.backup, /^mobilemix-before-reset-.*\.db$/);
  const c = (await admin.get('/system/data-counts')).data;
  assert.deepEqual([c.sales, c.repairs, c.products, c.attendance], [0, 0, 0, 0]);
  assert.equal(c.users, 2);
  assert.ok(c.categories > 0); // categories kept unless asked
  assert.equal((await admin.get('/settings')).data.shop_name, 'محل التجربة');
  assert.equal((await cashier.get('/auth/me')).status, 200); // staff still logged in

  // Numbering starts over
  const p = (await admin.post('/products', { name: 'منتج حقيقي', sell_price: 10, initial_qty: 1 })).data;
  assert.equal(p.barcode, '200000000001');
  const sale = (await admin.post('/sales', { items: [{ product_id: p.id, qty: 1 }] })).data;
  assert.equal(sale.invoice_no, 'MM-000001');
});

test('the backup taken before the wipe can be restored', async () => {
  const list = (await admin.get('/system/backups')).data;
  const pre = list.find((b) => b.kind === 'reset');
  assert.ok(pre);
  assert.equal((await cashier.get('/system/backups')).status, 403);
  assert.equal((await admin.post('/system/restore', { file: pre.file, password: 'x' })).status, 400);
  assert.equal((await admin.post('/system/restore', { file: '../../etc/passwd', password: 'admin123' })).status, 404);

  const r = await admin.post('/system/restore', { file: pre.file, password: 'admin123' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const names = (await admin.get('/products')).data.map((p) => p.name).sort();
  assert.deepEqual(names, ['منتج وهمي', 'موبايل وهمي']);
  assert.equal((await admin.get('/sales?q=MM-')).data.length, 1);
  assert.equal((await admin.get('/auth/me')).status, 200); // still logged in after restore
  // ...and the data from before the restore was saved too
  assert.ok((await admin.get('/system/backups')).data.some((b) => b.kind === 'restore'));
});

test('categories can be wiped too (with products)', async () => {
  const r = await admin.post('/system/reset', { parts: ['categories'], password: 'admin123', confirm: 'امسح' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.parts.includes('products') && r.data.parts.includes('sales'));
  const c = (await admin.get('/system/data-counts')).data;
  assert.equal(c.categories, 0);
  assert.equal(c.products, 0);
});
