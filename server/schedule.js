'use strict';
const { getSettings } = require('./util');

/*
 * Work schedules: each employee can have a shift (from – to) and the week days they work.
 * Used to mark late arrivals / early leaving and to warn the owner when someone
 * hasn't checked in after their shift started. Overnight shifts (e.g. 18:00 – 02:00) work too.
 */

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const minOfDay = (dt) => toMin(dt.slice(11, 16));
const dayOf = (dateStr) => new Date(`${dateStr}T12:00:00`).getDay();

function scheduleOf(user) {
  if (!user || !TIME.test(user.shift_start || '') || !TIME.test(user.shift_end || '')) return null;
  return { start: user.shift_start, end: user.shift_end, days: String(user.work_days ?? '0123456') };
}

const worksOn = (sched, dateStr) => sched.days.includes(String(dayOf(dateStr)));
const grace = (db) => Math.max(0, Number(getSettings(db).late_grace) || 0);

/** Minutes late on check-in (0 = on time / within the grace), or null when there's no schedule that day. */
function lateMinutes(db, user, checkInAt) {
  const s = scheduleOf(user);
  if (!s || !worksOn(s, checkInAt.slice(0, 10))) return null;
  const late = minOfDay(checkInAt) - toMin(s.start);
  return late > grace(db) ? late : 0;
}

/** Minutes left early on check-out (0 = stayed till the end), or null without a schedule that day. */
function earlyMinutes(db, user, checkInAt, checkOutAt) {
  const s = scheduleOf(user);
  if (!s || !worksOn(s, checkInAt.slice(0, 10))) return null;
  const endDay = new Date(`${checkInAt.slice(0, 10)}T00:00:00`);
  if (toMin(s.end) <= toMin(s.start)) endDay.setDate(endDay.getDate() + 1); // ends after midnight
  const end = new Date(endDay.getTime() + toMin(s.end) * 60000);
  const out = new Date(checkOutAt.replace(' ', 'T'));
  const early = Math.round((end - out) / 60000);
  return early > grace(db) ? early : 0;
}

/** People whose shift has started (past the grace) and who haven't checked in today. */
function missingNow(db, now) {
  const today = now.slice(0, 10);
  const nowMin = minOfDay(now);
  const g = grace(db);
  const users = db.prepare("SELECT id, full_name, role, shift_start, shift_end, work_days FROM users WHERE active = 1 AND role <> 'admin'").all();
  const cameToday = new Set(db.prepare('SELECT DISTINCT user_id FROM shifts WHERE date(check_in_at) = ? OR check_out_at IS NULL').all(today).map((r) => r.user_id));
  return users.filter((u) => {
    const s = scheduleOf(u);
    if (!s || !worksOn(s, today) || cameToday.has(u.id)) return false;
    const start = toMin(s.start), end = toMin(s.end);
    const over = end > start ? nowMin >= end : false; // same-day shift already over
    return nowMin >= start + g && !over;
  }).map((u) => ({ id: u.id, full_name: u.full_name, shift_start: u.shift_start, shift_end: u.shift_end, late: nowMin - toMin(u.shift_start) }));
}

module.exports = { TIME, scheduleOf, worksOn, lateMinutes, earlyMinutes, missingNow };
