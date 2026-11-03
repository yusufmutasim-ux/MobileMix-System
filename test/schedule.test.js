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

test('absences and lateness come off the salary automatically; excused days don\'t', () => {
  const { absences } = require('../server/schedule');
  const id = Number(db.prepare(`INSERT INTO users (username, full_name, password_hash, role, shift_start, shift_end, work_days, salary, schedule_since, created_at)
    VALUES ('k1', 'كريم', 'x', 'cashier', '10:00', '18:00', '0123456', 3000, '2026-10-01', '2026-09-01 10:00:00')`).run().lastInsertRowid);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  // Came on the 1st and 3rd only, between Oct 1 and Oct 5, looking from Oct 5 evening
  db.prepare("INSERT INTO shifts (user_id, check_in_at) VALUES (?, '2026-10-01 10:05:00'), (?, '2026-10-03 10:40:00')").run(id, id);
  db.prepare("UPDATE shifts SET late_minutes = 40 WHERE user_id = ? AND check_in_at LIKE '2026-10-03%'").run(id);
  const now = new Date('2026-10-05T19:00:00');
  assert.deepEqual(absences(db, u, '2026-10-01', '2026-10-31', now), ['2026-10-02', '2026-10-04', '2026-10-05']);
  // Before the shift ends, today doesn't count yet
  assert.deepEqual(absences(db, u, '2026-10-01', '2026-10-31', new Date('2026-10-05T12:00:00')), ['2026-10-02', '2026-10-04']);
  db.prepare("INSERT INTO attendance_excuses (user_id, day) VALUES (?, '2026-10-04')").run(id);
  assert.deepEqual(absences(db, u, '2026-10-01', '2026-10-31', now), ['2026-10-02', '2026-10-05']);
  // Nothing before the shift was set
  db.prepare("UPDATE users SET schedule_since = '2026-10-03' WHERE id = ?").run(id);
  assert.deepEqual(absences(db, db.prepare('SELECT * FROM users WHERE id = ?').get(id), '2026-10-01', '2026-10-31', now), ['2026-10-05']);
  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(id);
});

test('payroll: deduction = absent days × a day\'s pay + late days × a quarter; grace is 15 minutes', async () => {
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'late_grace'").get().value, '15');
  assert.equal(lateMinutes(db, user('10:00', '18:00'), `${WED} 10:14:00`), 0);
  assert.equal(lateMinutes(db, user('10:00', '18:00'), `${WED} 10:16:00`), 16);
  const admin = client();
  await admin.login('admin', 'admin123');
  const month = new Date().toISOString().slice(0, 7);
  const id = Number(db.prepare(`INSERT INTO users (username, full_name, password_hash, role, shift_start, shift_end, work_days, salary, schedule_since, created_at)
    VALUES ('z1', 'زياد', 'x', 'cashier', '00:00', '00:01', '0123456', 3000, ?, ?)`).run(`${month}-01`, `${month}-01 00:00:00`).lastInsertRowid);
  const row = (await admin.get(`/payroll?month=${month}`)).data.rows.find((r) => r.id === id);
  assert.ok(row.absent_count >= 1);
  assert.equal(row.deduction, Math.round(100 * row.absent_count * 100) / 100); // 3000/30 = 100 a day
  assert.equal(row.due, 3000 - row.deduction);
  // Excuse one day
  await admin.post(`/payroll/${id}/excuse`, { day: row.absent_days[0] });
  const after = (await admin.get(`/payroll?month=${month}`)).data.rows.find((r) => r.id === id);
  assert.equal(after.absent_count, row.absent_count - 1);
  // Switched off
  await admin.put('/settings', { auto_deduct: '0' });
  assert.equal((await admin.get(`/payroll?month=${month}`)).data.rows.find((r) => r.id === id).deduction, 0);
  await admin.put('/settings', { auto_deduct: '1' });
  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(id);
});

test('overnight shift (5 PM – 1 AM) counts on the day it started', () => {
  const { absences } = require('../server/schedule');
  const u = user('17:00', '01:00', '3'); // Wednesdays only
  const THU = '2026-10-22';
  // Checking in very late, after midnight, is still Wednesday's shift
  assert.equal(lateMinutes(db, u, `${THU} 00:20:00`), 440);
  assert.equal(lateMinutes(db, u, `${WED} 17:30:00`), 30);
  // Leaving at 00:50 is within the grace; at 00:00 it's an hour early
  assert.equal(earlyMinutes(db, u, `${WED} 17:00:00`, `${THU} 00:50:00`), 0);
  assert.equal(earlyMinutes(db, u, `${WED} 17:00:00`, `${THU} 00:00:00`), 60);
  // Not checked in: still "missing" at half past midnight (the shift runs till 1)
  const ins = db.prepare("INSERT INTO users (username, full_name, password_hash, role, shift_start, shift_end, work_days, schedule_since, created_at) VALUES (?, ?, '', 'cashier', '17:00', '01:00', '3', ?, '2026-10-01 09:00:00')");
  const id = Number(ins.run('night', 'ليلي', WED).lastInsertRowid);
  assert.ok(missingNow(db, `${THU} 00:30:00`).some((x) => x.id === id));
  assert.ok(!missingNow(db, `${THU} 01:30:00`).some((x) => x.id === id));
  // Absence only once the shift is over (1 AM Thursday), filed on Wednesday
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  assert.deepEqual(absences(db, row, WED, THU, new Date(`${THU}T00:30:00`)), []);
  assert.deepEqual(absences(db, row, WED, THU, new Date(`${THU}T02:00:00`)), [WED]);
  // Came at 17:05 Wednesday: not missing after midnight, not absent
  db.prepare("INSERT INTO shifts (user_id, check_in_at) VALUES (?, ?)").run(id, `${WED} 17:05:00`);
  assert.ok(!missingNow(db, `${THU} 00:30:00`).some((x) => x.id === id));
  assert.deepEqual(absences(db, row, WED, THU, new Date(`${THU}T02:00:00`)), []);
});

test('old shifts are recounted with the shop-day rules', async () => {
  const admin = client();
  await admin.login('admin', 'admin123');
  const id = Number(db.prepare("INSERT INTO users (username, full_name, password_hash, role, shift_start, shift_end, work_days) VALUES ('old', 'قديم', '', 'cashier', '17:00', '01:00', '3')").run().lastInsertRowid);
  // Saved under the old rules: left at 00:50 Thursday marked as leaving early, late after midnight not counted
  const a = Number(db.prepare("INSERT INTO shifts (user_id, check_in_at, check_out_at, late_minutes, early_minutes) VALUES (?, '2026-10-21 17:05:00', '2026-10-22 00:50:00', 0, 999)").run(id).lastInsertRowid);
  const b = Number(db.prepare("INSERT INTO shifts (user_id, check_in_at, check_out_at, late_minutes, early_minutes) VALUES (?, '2026-10-29 00:20:00', '2026-10-29 01:00:00', NULL, NULL)").run(id).lastInsertRowid);
  const r = await admin.post('/attendance/recount', {});
  assert.equal(r.status, 200);
  const get = (x) => db.prepare('SELECT late_minutes, early_minutes FROM shifts WHERE id = ?').get(x);
  assert.deepEqual({ ...get(a) }, { late_minutes: 0, early_minutes: 0 });
  assert.deepEqual({ ...get(b) }, { late_minutes: 440, early_minutes: 0 }); // Wednesday 28th's shift, very late
});
