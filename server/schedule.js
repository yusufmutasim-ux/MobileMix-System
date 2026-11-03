'use strict';
const { getSettings, bday } = require('./util');

/*
 * Work schedules: each employee can have a shift (from – to) and the week days they work.
 * Used to mark late arrivals / early leaving and to warn the owner when someone
 * hasn't checked in after their shift started. Overnight shifts (e.g. 18:00 – 02:00) work too.
 */

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const minOfDay = (dt) => toMin(dt.slice(11, 16));
const dayOf = (dateStr) => new Date(`${dateStr}T12:00:00`).getDay();
const ms = (ts) => new Date(String(ts).replace(' ', 'T')).getTime();
/** Start and end (ms) of the shift on shop day `day`; the end is the next morning for an overnight shift. */
function shiftWindow(s, day) {
  const base = new Date(`${day}T00:00:00`).getTime();
  const start = base + toMin(s.start) * 60000;
  let end = base + toMin(s.end) * 60000;
  if (toMin(s.end) <= toMin(s.start)) end += 864e5;
  return { start, end };
}

function scheduleOf(user) {
  if (!user || !TIME.test(user.shift_start || '') || !TIME.test(user.shift_end || '')) return null;
  return { start: user.shift_start, end: user.shift_end, days: String(user.work_days ?? '0123456') };
}

const worksOn = (sched, dateStr) => sched.days.includes(String(dayOf(dateStr)));
const grace = (db) => Math.max(0, Number(getSettings(db).late_grace) || 0);

/** Minutes late on check-in (0 = on time / within the grace), or null when there's no schedule that day. */
function lateMinutes(db, user, checkInAt) {
  const s = scheduleOf(user);
  const day = bday(checkInAt);
  if (!s || !worksOn(s, day)) return null;
  const late = Math.round((ms(checkInAt) - shiftWindow(s, day).start) / 60000);
  return late > grace(db) ? late : 0;
}

/** Minutes left early on check-out (0 = stayed till the end), or null without a schedule that day. */
function earlyMinutes(db, user, checkInAt, checkOutAt) {
  const s = scheduleOf(user);
  const day = bday(checkInAt);
  if (!s || !worksOn(s, day)) return null;
  const early = Math.round((shiftWindow(s, day).end - ms(checkOutAt)) / 60000);
  return early > grace(db) ? early : 0;
}

/** People whose shift has started (past the grace) and who haven't checked in this shop day. */
function missingNow(db, now) {
  const today = bday(now);
  const t = ms(now);
  const g = grace(db);
  const users = db.prepare("SELECT id, full_name, role, shift_start, shift_end, work_days FROM users WHERE active = 1 AND role <> 'admin'").all();
  const cameToday = new Set(db.prepare('SELECT DISTINCT user_id FROM shifts WHERE bday(check_in_at) = ? OR check_out_at IS NULL').all(today).map((r) => r.user_id));
  return users.filter((u) => {
    const s = scheduleOf(u);
    if (!s || !worksOn(s, today) || cameToday.has(u.id)) return false;
    const w = shiftWindow(s, today);
    return t >= w.start + g * 60000 && t < w.end;
  }).map((u) => ({ id: u.id, full_name: u.full_name, shift_start: u.shift_start, shift_end: u.shift_end,
    late: Math.round((t - shiftWindow(scheduleOf(u), today).start) / 60000) }));
}

/**
 * Work days in [from, to] the person was due and didn't check in at all (excused days left out).
 * Today only counts once their shift is over. Counting starts from when their shift was set.
 */
function absences(db, user, from, to, now = new Date()) {
  const s = scheduleOf(user);
  if (!s) return [];
  const pad = (x) => String(x).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = bday(`${iso(now)} ${pad(now.getHours())}:${pad(now.getMinutes())}:00`);
  const since = [from, user.schedule_since || today, String(user.created_at || '').slice(0, 10)].sort().pop();
  const came = new Set(db.prepare('SELECT DISTINCT bday(check_in_at) AS d FROM shifts WHERE user_id = ? AND bday(check_in_at) BETWEEN ? AND ?').all(user.id, since, to).map((r) => r.d));
  const excused = new Set(db.prepare('SELECT day FROM attendance_excuses WHERE user_id = ? AND day BETWEEN ? AND ?').all(user.id, since, to).map((r) => r.day));
  const out = [];
  for (let d = new Date(`${since}T12:00:00`); iso(d) <= to; d.setDate(d.getDate() + 1)) {
    const day = iso(d);
    if (day > today) break;
    if (now.getTime() < shiftWindow(s, day).end) continue; // that day's shift isn't over yet
    if (!worksOn(s, day) || came.has(day) || excused.has(day)) continue;
    out.push(day);
  }
  return out;
}

module.exports = { TIME, scheduleOf, worksOn, lateMinutes, earlyMinutes, missingNow, absences };
