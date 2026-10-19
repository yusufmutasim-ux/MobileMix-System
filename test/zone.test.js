'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { open } = require('../server/db');
const { createApp } = require('../server/app');
const { haversine } = require('../server/routes/shifts');

let server, base;
before(async () => {
  server = createApp(open(':memory:'), { pushSender: async () => {} }).listen(0);
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
const SHOP = { lat: 30.0444, lng: 31.2357 }; // Tahrir, Cairo
const near = { lat: SHOP.lat + 0.00045, lng: SHOP.lng, accuracy: 15 }; // ~50 m
const far = { lat: SHOP.lat + 0.018, lng: SHOP.lng, accuracy: 10 }; // ~2 km

test('distance math', () => {
  const d = haversine(SHOP.lat, SHOP.lng, near.lat, near.lng);
  assert.ok(d > 45 && d < 55, String(d));
});

test('setup: shop location and zone on', async () => {
  await admin.login('admin', 'admin123');
  await admin.post('/users', { username: 'karim', full_name: 'كريم', role: 'cashier', password: '123456' });
  await cashier.login('karim', '123456');
  // Zone on but shop location not set yet
  await admin.put('/settings', { attendance_zone: '1' });
  let r = await cashier.post('/shifts/check-in', near);
  assert.equal(r.status, 400);
  assert.match(r.data.error, /محددش موقع المحل/);
  await admin.put('/settings', { shop_lat: String(SHOP.lat), shop_lng: String(SHOP.lng), zone_radius: '100' });
});

test('check in only inside the shop zone', async () => {
  let r = await cashier.post('/shifts/check-in');
  assert.equal(r.status, 400);
  assert.match(r.data.error, /GPS/);

  r = await cashier.post('/shifts/check-in', far);
  assert.equal(r.status, 400);
  assert.match(r.data.error, /بعيد عن المحل بحوالي 2\.0 كم/);

  r = await cashier.post('/shifts/check-in', { ...near, accuracy: 900 });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /مش دقيق/);

  r = await cashier.post('/shifts/check-in', near);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.open.in_method, 'gps');
  assert.ok(r.data.open.in_distance >= 45 && r.data.open.in_distance <= 55);

  // Leaving from home doesn't work either
  r = await cashier.post('/shifts/check-out', far);
  assert.equal(r.status, 400);
  r = await cashier.post('/shifts/check-out', near);
  assert.equal(r.status, 200);

  const notes = await admin.get('/notifications');
  assert.match(notes.data.items.find((n) => n.type === 'shift_in').body, /📍 من المحل \(\d+ م\)/);
  const list = await admin.get('/shifts');
  assert.equal(list.data.shifts[0].out_method, 'gps');
});

test('GPS inaccuracy gives some slack, up to the radius', async () => {
  // 150 m away with 60 m accuracy → allowed (150 − 60 ≤ 100)
  const r = await cashier.post('/shifts/check-in', { lat: SHOP.lat + 0.00135, lng: SHOP.lng, accuracy: 60 });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  await cashier.post('/shifts/check-out', near);
});

test('the shop internet connection counts as inside the shop (for PCs without GPS)', async () => {
  const reg = await admin.post('/shifts/zone/network');
  assert.equal(reg.status, 200);
  assert.ok(reg.data.here);
  assert.equal((await cashier.post('/shifts/zone/network')).status, 403);

  const r = await cashier.post('/shifts/check-in'); // no GPS at all
  assert.equal(r.status, 201);
  assert.equal(r.data.open.in_method, 'wifi');
  await cashier.post('/shifts/check-out');

  const rem = await admin.post('/shifts/zone/network', { remove: reg.data.ip });
  assert.deepEqual(rem.data.saved, []);
  assert.equal((await cashier.post('/shifts/check-in')).status, 400);
});

test('the owner can check in from anywhere; zone off means no checks', async () => {
  assert.equal((await admin.post('/shifts/check-in', far)).status, 201);
  await admin.put('/settings', { attendance_zone: '0' });
  const r = await cashier.post('/shifts/check-in', far);
  assert.equal(r.status, 201);
  assert.equal(r.data.open.in_method, 'none');
  assert.ok(r.data.open.in_distance > 1900); // still recorded for the manager
});

test('existing attendance tables get the new location columns', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mm-')), 'old.db');
  const d = new DatabaseSync(file);
  d.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, full_name TEXT NOT NULL,
            password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('admin','manager','cashier','technician')),
            active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
          CREATE TABLE shifts (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
            check_in_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), check_out_at TEXT, note TEXT, closed_by INTEGER);
          INSERT INTO users (username, full_name, password_hash, role) VALUES ('admin', 'A', 'x', 'admin');
          INSERT INTO shifts (user_id) VALUES (1);`);
  d.close();
  const db = open(file);
  const cols = db.prepare('PRAGMA table_info(shifts)').all().map((c) => c.name);
  assert.ok(cols.includes('in_method') && cols.includes('out_distance'));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM shifts').get().n, 1);
  db.close();
});

test('location test tells anyone why check in would pass or fail', async () => {
  const t = client();
  await t.login('karim', '123456');
  let r = await t.post('/shifts/zone/test', { lat: 30.0624, lng: 31.2357, accuracy: 10 });
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, false);
  assert.ok(r.data.distance > 1900);
  assert.match(r.data.error, /بعيد/);
  r = await t.post('/shifts/zone/test', { lat: 30.04462, lng: 31.2357, accuracy: 10 });
  assert.equal(r.data.ok, true);
  assert.equal(r.data.method, 'gps');
  r = await t.post('/shifts/zone/test', {});
  assert.equal(r.data.ok, false);
  assert.match(r.data.error, /GPS/);
});
