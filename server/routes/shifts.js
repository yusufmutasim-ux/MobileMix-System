'use strict';
const { requireAuth, requirePerm } = require('../auth');
const { bad, notFound, str, dateRange, audit } = require('../util');

const minutesBetween = (a, b) => Math.max(0, Math.round((new Date(b.replace(' ', 'T')) - new Date(a.replace(' ', 'T'))) / 60000));
const nowLocal = (db) => db.prepare("SELECT datetime('now','localtime') AS t").get().t;
const fmtDuration = (m) => `${Math.floor(m / 60)} س ${m % 60} د`;
const timeOf = (s) => s.slice(11, 16);

/** Attendance: every employee checks in when the shift starts and out when they leave. */
module.exports = function shiftRoutes(api, db) {
  const openShift = (userId) => db.prepare('SELECT * FROM shifts WHERE user_id = ? AND check_out_at IS NULL ORDER BY id DESC LIMIT 1').get(userId);

  api.get('/shifts/me', requireAuth, (req, res) => {
    const s = openShift(req.user.id);
    res.json({ open: s || null, minutes: s ? minutesBetween(s.check_in_at, nowLocal(db)) : 0 });
  });

  api.post('/shifts/check-in', requireAuth, (req, res) => {
    if (openShift(req.user.id)) throw bad('إنت مسجل حضور بالفعل');
    const note = str(req.body?.note, 'الملاحظة', { optional: true, max: 200 });
    const r = db.prepare('INSERT INTO shifts (user_id, note) VALUES (?, ?)').run(req.user.id, note);
    const s = db.prepare('SELECT * FROM shifts WHERE id = ?').get(r.lastInsertRowid);
    req.app.locals.notifier.notify({
      type: 'shift_in', actorId: req.user.id, url: '#/attendance',
      title: `${req.user.full_name} بدأ الشيفت`, body: `تسجيل حضور الساعة ${timeOf(s.check_in_at)}${note ? ` — ${note}` : ''}`,
    });
    res.status(201).json({ open: s, minutes: 0 });
  });

  api.post('/shifts/check-out', requireAuth, (req, res) => {
    const s = openShift(req.user.id);
    if (!s) throw bad('إنت مش مسجل حضور');
    const note = str(req.body?.note, 'الملاحظة', { optional: true, max: 200 });
    const out = nowLocal(db);
    db.prepare('UPDATE shifts SET check_out_at = ?, note = COALESCE(?, note) WHERE id = ?').run(out, note, s.id);
    const mins = minutesBetween(s.check_in_at, out);
    req.app.locals.notifier.notify({
      type: 'shift_out', actorId: req.user.id, url: '#/attendance',
      title: `${req.user.full_name} أنهى الشيفت`, body: `انصراف الساعة ${timeOf(out)} — مدة الشيفت ${fmtDuration(mins)}`,
    });
    res.json({ open: null, minutes: mins });
  });

  // ---------- manager views ----------
  const view = requirePerm('attendance.view');

  api.get('/shifts/now', view, (_req, res) => {
    const now = nowLocal(db);
    const on = db.prepare(`SELECT s.id, s.check_in_at, u.id AS user_id, u.full_name, u.role FROM shifts s JOIN users u ON u.id = s.user_id
                           WHERE s.check_out_at IS NULL ORDER BY s.check_in_at`).all()
      .map((s) => ({ ...s, minutes: minutesBetween(s.check_in_at, now) }));
    const off = db.prepare(`SELECT id, full_name, role FROM users WHERE active = 1
                            AND id NOT IN (SELECT user_id FROM shifts WHERE check_out_at IS NULL) ORDER BY full_name`).all();
    res.json({ on, off });
  });

  api.get('/shifts', view, (req, res) => {
    const { from, to } = dateRange(req.query);
    const userId = req.query.user_id ? Number(req.query.user_id) : null;
    const now = nowLocal(db);
    const rows = db.prepare(`
      SELECT s.*, u.full_name, c.full_name AS closed_by_name FROM shifts s JOIN users u ON u.id = s.user_id
      LEFT JOIN users c ON c.id = s.closed_by
      WHERE date(s.check_in_at) BETWEEN ? AND ? ${userId ? 'AND s.user_id = ?' : ''}
      ORDER BY s.check_in_at DESC LIMIT 2000`).all(...(userId ? [from, to, userId] : [from, to]))
      .map((s) => ({ ...s, minutes: minutesBetween(s.check_in_at, s.check_out_at || now) }));
    const totals = {};
    for (const s of rows) {
      const t = (totals[s.user_id] ||= { user_id: s.user_id, full_name: s.full_name, shifts: 0, minutes: 0, days: new Set() });
      t.shifts++; t.minutes += s.minutes; t.days.add(s.check_in_at.slice(0, 10));
    }
    res.json({
      from, to, shifts: rows,
      by_user: Object.values(totals).map((t) => ({ ...t, days: t.days.size })).sort((a, b) => b.minutes - a.minutes),
    });
  });

  /** A manager ends a shift someone forgot to close. */
  api.post('/shifts/:id/close', view, (req, res) => {
    const s = db.prepare('SELECT * FROM shifts WHERE id = ?').get(req.params.id);
    if (!s) throw notFound('الشيفت غير موجود');
    if (s.check_out_at) throw bad('الشيفت ده مقفول بالفعل');
    const at = req.body?.check_out_at ? String(req.body.check_out_at).replace('T', ' ') : nowLocal(db);
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(at)) throw bad('الوقت غير صحيح');
    const out = at.length === 16 ? `${at}:00` : at;
    if (out < s.check_in_at) throw bad('وقت الانصراف قبل وقت الحضور');
    db.prepare('UPDATE shifts SET check_out_at = ?, closed_by = ? WHERE id = ?').run(out, req.user.id, s.id);
    audit(db, req.user.id, 'shift.close', { id: s.id, user_id: s.user_id, at: out });
    res.json({ ok: true });
  });

  return { openShift };
};

/** When "require_shift" is on, staff must be checked in to sell or receive devices. */
module.exports.requireOpenShift = (db, user) => {
  const on = db.prepare("SELECT value FROM settings WHERE key = 'require_shift'").get()?.value === '1';
  if (!on || user.role === 'admin') return;
  const s = db.prepare('SELECT 1 FROM shifts WHERE user_id = ? AND check_out_at IS NULL').get(user.id);
  if (!s) throw bad('لازم تسجل حضور (بدء الشيفت) الأول');
};
