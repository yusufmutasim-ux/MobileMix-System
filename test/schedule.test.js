'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../server/db');
const { createApp } = require('../server/app');
const { lateMinutes, earlyMinutes, missingNow } = require('../server/schedule');

let server, base, db;
before(async () => {
  db = open(':memory:');
  server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

function client() {
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), put: (p, b) => call('PUT', p, b ?? {}),
    login: (u, pw) => call('POST', '/auth/login', { username: u, password: pw }) };
}

// 2026-10-21 is a Wednesday (getDay 3)
const WED = '2026-10-21';
const user = (start, end, days = '0123456') => ({ shift_start: start, shift_end: end, work_days: days });

test('late and early minutes, with the grace period', () => {
  // default grace: 10 minutes
  assert.equal(lateMinutes(db, user('10:00', '18:00'), `${WED} 10:08:00`), 0);
  assert.equal(lateMinutes(db, user('10:00', '18:00'), `${WED} 10:25:00`), 25);
  assert.equal(lateMinutes(db, user('10:00', '18:00'), `${WED} 09:40:00`), 0); // early is fine
  assert.equal(earlyMinutes(db, user('10:00', '18:00'), `${WED} 10:00:00`, `${WED} 17:55:00`), 0);
  assert.equal(earlyMinutes(db, user('10:00', '18:00'), `${WED} 10:00:00`, `${WED} 17:00:00`), 60);
  // No schedule, or a day off: nothing to judge
  assert.equal(lateMinutes(db, {}, `${WED} 13:00:00`), null);
  assert.equal(lateMinutes(db, user('10:00', '18:00', '0124'), `${WED} 13:00:00`), null);
});

test('overnight shift (18:00 – 02:00)', () => {
  assert.equal(lateMinutes(db, user('18:00', '02:00'), `${WED} 18:30:00`), 30);
  assert.equal(earlyMinutes(db, user('18:00', '02:00'), `${WED} 18:00:00`, '2026-10-22 01:58:00'), 0);
  assert.equal(earlyMinutes(db, user('18:00', '02:00'), `${WED} 18:00:00`, '2026-10-22 00:30:00'), 90);
});

test('who should be here and isn\'t', () => {
  const id = Number(db.prepare("INSERT INTO users (username, full_name, password_hash, role, shift_start, shift_end, work_days) VALUES ('w1', 'وليد', 'x', 'cashier', '10:00', '18:00', '0123456')").run().lastInsertRowid);
  assert.equal(missingNow(db, `${WED} 10:05:00`).length, 0); // within grace
  assert.deepEqual(missingNow(db, `${WED} 10:30:00`).map((u) => u.id), [id]);
  assert.equal(missingNow(db, `${WED} 18:30:00`).length, 0); // shift over
  db.prepare("INSERT INTO shifts (user_id, check_in_at) VALUES (?, ?)").run(id, `${WED} 10:31:00`);
  assert.equal(missingNow(db, `${WED} 11:00:00`).length, 0); // came
  db.prepare("UPDATE users SET active = 0 WHERE id = ?").run(id);
});

test('API: set a schedule, check-in is marked late, payroll counts it', async () => {
  const admin = client();
  await admin.login('admin', 'admin123');
  const u = (await admin.post('/users', { username: 'sami', full_name: 'سامي', role: 'cashier', password: '123456' })).data;
  assert.equal((await admin.put(`/users/${u.id}/schedule`, { shift_start: '10:00' })).status, 400); // needs both
  assert.equal((await admin.put(`/users/${u.id}/schedule`, { shift_start: '25:00', shift_end: '18:00' })).status, 400);
  // A shift that started 40 minutes ago, every day
  const now = db.prepare("SELECT strftime('%H:%M', 'now', 'localtime', '-40 minutes') AS a, strftime('%H:%M', 'now', 'localtime', '+4 hours') AS b, strftime('%H', 'now', 'localtime') AS h").get();
  const r = await admin.put(`/users/${u.id}/schedule`, { shift_start: now.a, shift_end: now.b, work_days: '0123456' });
  assert.equal(r.status, 200);
  assert.equal(r.data.shift_start, now.a);
  const list = (await admin.get('/users')).data;
  assert.equal(list.find((x) => x.id === u.id).shift_start, now.a);
  if (Number(now.h) < 1) return; // the shift would have started yesterday: skip the live part near midnight

  assert.ok((await admin.get('/shifts/now')).data.missing.some((m) => m.id === u.id));
  const sami = client();
  await sami.login('sami', '123456');
  await sami.post('/shifts/check-in', {});
  const shifts = (await admin.get('/shifts')).data;
  const mine = shifts.shifts.find((s) => s.user_id === u.id);
  assert.ok(mine.late_minutes >= 39 && mine.late_minutes <= 41, `late ${mine.late_minutes}`);
  assert.equal(shifts.by_user.find((x) => x.user_id === u.id).late_count, 1);
  assert.ok(!(await admin.get('/shifts/now')).data.missing.some((m) => m.id === u.id));
  const pay = (await admin.get('/payroll')).data.rows.find((x) => x.id === u.id);
  assert.equal(pay.late_count, 1);
});
