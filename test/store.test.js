'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { open } = require('../server/db');
const { createApp } = require('../server/app');
const { signedString } = require('../server/paymob');

let server, base, db;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-store-'));
before(async () => {
  db = open(':memory:');
  server = createApp(db, { dataDir }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

const realFetch = globalThis.fetch;
function client() {
  let cookie = '';
  const call = async (method, p, body) => {
    const res = await realFetch(base + p, { method, redirect: 'manual', headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null), headers: res.headers };
  };
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), put: (p, b) => call('PUT', p, b ?? {}) };
}
const admin = client();
const shopper = client(); // not logged in

test('online store: what shows, ordering, confirming, delivering, cancelling', async () => {
  await admin.post('/auth/login', { username: 'admin', password: 'admin123' });
  assert.equal((await shopper.get('/store/products')).status, 404); // closed until switched on

  const cats = (await admin.get('/categories')).data;
  const acc = cats.find((c) => c.name === 'إكسسوارات');
  const mk = async (b) => (await admin.post('/products', { category_id: acc.id, ...b })).data;
  const cable = await mk({ name: 'Cable', sell_price: 100, initial_qty: 5, description: 'Fast' });
  const noPrice = await mk({ name: 'No price yet', sell_price: 0, initial_qty: 5 });
  const hidden = await mk({ name: 'Hidden one', sell_price: 50, initial_qty: 5, online_hidden: 1 });
  const phone = await mk({ name: 'Phone', sell_price: 9000, has_serial: true, serials: ['356111111111111'] });
  const out = await mk({ name: 'Sold out', sell_price: 70, initial_qty: 0 });

  await admin.put('/settings', { store_enabled: '1', store_ship: '1', store_ship_fees: JSON.stringify({ 'القاهرة': 50, 'الجيزة': '' }), store_pickup: '1', store_pay_cod: '1', store_pay_transfer: '1', store_transfer_info: 'InstaPay: shop@instapay' });
  const info = (await shopper.get('/store/info')).data;
  assert.equal(info.enabled, true);
  assert.deepEqual(info.delivery.ship, { 'القاهرة': 50 }); // a governorate without a price isn't offered
  assert.equal(info.payments.card, false); // no Paymob keys yet

  let list = (await shopper.get('/store/products')).data;
  const names = list.map((p) => p.name);
  assert.ok(names.includes('Cable') && names.includes('Sold out'));
  assert.ok(!names.includes('No price yet') && !names.includes('Hidden one') && !names.includes('Phone'));
  assert.equal(list.find((p) => p.name === 'Cable').cost_price, undefined);
  assert.equal(list.find((p) => p.name === 'Sold out').in_stock, false);
  // Manual mode: only the ticked ones
  await admin.put('/settings', { store_products: 'manual' });
  assert.equal((await shopper.get('/store/products')).data.length, 0);
  await admin.put(`/products/${cable.id}`, { online_show: 1 });
  assert.deepEqual((await shopper.get('/store/products')).data.map((p) => p.name), ['Cable']);
  await admin.put('/settings', { store_products: 'auto' });

  // Bad orders
  const order = (b) => shopper.post('/store/orders', { name: 'Mona', phone: '01012345678', items: [{ id: cable.id, qty: 2 }], delivery: 'ship', governorate: 'القاهرة', address: 'Nasr City', payment: 'cod', ...b });
  assert.equal((await order({ governorate: 'الجيزة' })).status, 400);
  assert.equal((await order({ payment: 'card' })).status, 400);
  assert.equal((await order({ items: [{ id: cable.id, qty: 9 }] })).status, 400);
  assert.equal((await order({ items: [{ id: noPrice.id, qty: 1 }] })).status, 400);
  assert.equal((await order({ phone: '123' })).status, 400);

  // A cash-on-delivery order
  let r = await order({});
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.match(r.data.order_no, /^W-\d{6}$/);
  const track = (await shopper.get(`/store/orders/${r.data.token}`)).data;
  assert.equal(track.total, 250);
  assert.equal(track.status, 'new');
  assert.equal((await admin.get('/orders/counts')).data.new, 1);
  const id = (await admin.get('/orders')).data[0].id;
  assert.equal((await shopper.get(`/orders/${id}`)).status, 401); // staff only

  // Confirm: becomes a sale, stock leaves, owed until delivered
  let o = (await admin.post(`/orders/${id}/status`, { status: 'confirmed' })).data;
  assert.equal(o.status, 'confirmed');
  assert.ok(o.sale_id);
  assert.equal((await admin.get(`/products/${cable.id}`)).data.qty, 3);
  let sale = (await admin.get(`/sales/${o.sale_id}`)).data;
  assert.equal(sale.total, 200);
  assert.equal(sale.due, 200);
  assert.equal((await admin.post(`/orders/${id}/status`, { status: 'new' })).status, 400);
  o = (await admin.post(`/orders/${id}/status`, { status: 'delivered' })).data;
  assert.equal(o.pay_status, 'paid');
  sale = (await admin.get(`/sales/${o.sale_id}`)).data;
  assert.equal(sale.due, 0);
  assert.equal((await shopper.get(`/store/orders/${r.data.token}`)).data.status, 'delivered');

  // Transfer: customer sends the picture, staff confirm it; then the order is cancelled and stock comes back
  r = await order({ payment: 'transfer', delivery: 'pickup', items: [{ id: cable.id, qty: 1 }] });
  assert.equal(r.status, 201);
  const pic = 'data:image/png;base64,' + Buffer.from('png').toString('base64');
  const tr = (await shopper.post(`/store/orders/${r.data.token}/proof`, { image: pic })).data;
  assert.equal(tr.pay_status, 'review');
  assert.equal(tr.transfer_info, 'InstaPay: shop@instapay');
  const id2 = (await admin.get('/orders?status=new')).data[0].id;
  const proof = await realFetch(`${base}/orders/${id2}/proof`, { headers: { cookie: '' } });
  assert.equal(proof.status, 401); // the picture isn't public
  await admin.post(`/orders/${id2}/status`, { status: 'confirmed' });
  o = (await admin.post(`/orders/${id2}/paid`, {})).data;
  assert.equal(o.pay_status, 'paid');
  assert.equal((await admin.get(`/sales/${o.sale_id}`)).data.due, 0);
  assert.equal((await admin.get(`/products/${cable.id}`)).data.qty, 2);
  o = (await admin.post(`/orders/${id2}/status`, { status: 'cancelled', reason: 'customer changed mind' })).data;
  assert.equal(o.status, 'cancelled');
  assert.equal((await admin.get(`/products/${cable.id}`)).data.qty, 3);
});

test('card payments through Paymob: signed result marks the order paid, a forged one is ignored', async () => {
  await admin.put('/store/paymob', { paymob_api_key: 'KEY', paymob_integration_id: '123', paymob_iframe_id: '456', paymob_hmac: 'SECRET' });
  const st = (await admin.get('/store/admin')).data;
  assert.equal(st.paymob.ready, true);
  assert.ok(!JSON.stringify(st).includes('SECRET')); // keys never come back whole
  await admin.put('/settings', { store_pay_card: '1' });
  assert.equal((await shopper.get('/store/info')).data.payments.card, true);

  // Paymob itself is stood in for
  globalThis.fetch = async (url, opts) => {
    if (!String(url).startsWith('https://accept.paymob.com')) return realFetch(url, opts);
    const answer = url.endsWith('/auth/tokens') ? { token: 'T' } : url.endsWith('/ecommerce/orders') ? { id: 777 } : { token: 'PAYKEY' };
    return new Response(JSON.stringify(answer), { status: 201, headers: { 'content-type': 'application/json' } });
  };
  const p = (await shopper.get('/store/products')).data.find((x) => x.name === 'Cable');
  const r = await shopper.post('/store/orders', { name: 'Ali', phone: '01112345678', items: [{ id: p.id, qty: 1 }], delivery: 'pickup', payment: 'card' });
  globalThis.fetch = realFetch;
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.match(r.data.pay_url, /iframes\/456\?payment_token=PAYKEY/);
  assert.equal((await admin.get('/orders/counts')).data.new, 0); // not counted until paid

  const obj = { id: 9001, pending: false, amount_cents: 10000, success: true, is_auth: false, is_capture: false, is_standalone_payment: true,
    is_voided: false, is_refunded: false, is_3d_secure: true, integration_id: 123, has_parent_transaction: false, error_occured: false,
    created_at: '2026-10-31T10:00:00', currency: 'EGP', owner: 1, order: { id: 777 }, source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' } };
  const good = crypto.createHmac('sha512', 'SECRET').update(signedString(obj, false)).digest('hex');
  // Forged: wrong signature
  await shopper.post('/store/paymob/callback?hmac=' + 'a'.repeat(128), { type: 'TRANSACTION', obj });
  let track = (await shopper.get(`/store/orders/${r.data.token}`)).data;
  assert.equal(track.pay_status, 'unpaid');
  await shopper.post('/store/paymob/callback?hmac=' + good, { type: 'TRANSACTION', obj });
  track = (await shopper.get(`/store/orders/${r.data.token}`)).data;
  assert.equal(track.pay_status, 'paid');
  assert.equal((await admin.get('/orders/counts')).data.new, 1);

  // Customer comes back from Paymob's page
  const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(obj).filter(([, v]) => typeof v !== 'object')), order: '777',
    'source_data.pan': '2346', 'source_data.sub_type': 'MasterCard', 'source_data.type': 'card' });
  q.set('hmac', crypto.createHmac('sha512', 'SECRET').update(signedString(Object.fromEntries(q), true)).digest('hex'));
  const back = await shopper.get('/store/paymob/callback?' + q);
  assert.equal(back.status, 302);
  assert.match(back.headers.get('location'), new RegExp(`/shop/#/order/${r.data.token}`));
});

test('product pictures are saved and served', async () => {
  const p = (await admin.get('/products?q=Cable')).data[0];
  const jpg = 'data:image/jpeg;base64,' + Buffer.from('jpegdata').toString('base64');
  const r = await admin.post(`/products/${p.id}/image`, { image: jpg });
  assert.match(r.data.image, /^\/uploads\/products\//);
  const file = await realFetch(base.replace('/api', '') + r.data.image);
  assert.equal(file.status, 200);
  assert.equal((await shopper.get(`/store/products/${p.id}`)).data.image, r.data.image);
});

test('store look: banners, category pictures and the front page', async () => {
  const jpg = 'data:image/jpeg;base64,' + Buffer.from('jpegdata').toString('base64');
  let list = (await admin.post('/store/banners', { kind: 'slide', image: jpg, link: '#/?cat=1' })).data;
  list = (await admin.post('/store/banners', { kind: 'slide', image: jpg })).data;
  await admin.post('/store/banners', { kind: 'side', image: jpg });
  await admin.post('/store/banners', { kind: 'side', image: jpg });
  assert.equal((await admin.post('/store/banners', { kind: 'side', image: jpg })).status, 400); // two side banners only
  const second = list.filter((b) => b.kind === 'slide')[1];
  list = (await admin.put(`/store/banners/${second.id}`, { move: 'up' })).data;
  assert.equal(list.filter((b) => b.kind === 'slide')[0].id, second.id);
  assert.equal((await shopper.post('/store/banners', { kind: 'slide', image: jpg })).status, 401);

  const cat = (await admin.get('/categories')).data.find((c) => c.name === 'إكسسوارات');
  const pic = (await admin.post(`/categories/${cat.id}/image`, { image: jpg })).data;
  await admin.put('/settings', { store_strip: 'خصم 10% على الشواحن' });
  const info = (await shopper.get('/store/info')).data;
  assert.equal(info.slides.length, 2);
  assert.equal(info.sides.length, 2);
  assert.equal(info.strip, 'خصم 10% على الشواحن');
  assert.equal(info.categories.find((c) => c.id === cat.id).image, pic.image);
  const home = (await shopper.get('/store/home')).data;
  assert.ok(home.latest.length >= 1);
  assert.ok(home.sections.some((s) => s.id === cat.id && s.products.length));
  const cheap = (await shopper.get('/store/products?sort=price_asc')).data;
  assert.ok(cheap.every((p, i) => i === 0 || !p.in_stock || !cheap[i - 1].in_stock || cheap[i - 1].price <= p.price));
});
