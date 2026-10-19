'use strict';
const { requireAuth, requirePerm } = require('../auth');
const { bad, notFound, str, dateRange, audit, getSettings } = require('../util');
const hosting = require('../hosting');

/** Distance in meters between two GPS points. */
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const cleanIp = (ip = '') => String(ip).replace(/^::ffff:/, '').trim();

/**
 * Shop zone check for check in / out. Allowed when:
 *  - the zone rule is off, or the user is the admin (owner), or
 *  - the request comes from the shop's own internet connection (Wi-Fi), or
 *  - the phone's GPS position is within the radius around the shop.
 */
function checkZone(db, req, { force = false } = {}) {
  const st = getSettings(db);
  const body = req.body || {};
  const coords = Number.isFinite(Number(body.lat)) && Number.isFinite(Number(body.lng)) && body.lat !== null && body.lat !== ''
    ? { lat: Number(body.lat), lng: Number(body.lng), accuracy: Number(body.accuracy) || null } : null;
  if (coords && (Math.abs(coords.lat) > 90 || Math.abs(coords.lng) > 180)) throw bad('الموقع غير صحيح');
  const out = { method: 'none', lat: coords?.lat ?? null, lng: coords?.lng ?? null, accuracy: coords?.accuracy ?? null, distance: null };

  const shopLat = Number(st.shop_lat), shopLng = Number(st.shop_lng);
  if (coords && st.shop_lat !== '' && st.shop_lng !== '' && Number.isFinite(shopLat) && Number.isFinite(shopLng)) {
    out.distance = Math.round(haversine(coords.lat, coords.lng, shopLat, shopLng));
  }
  if (!force && (st.attendance_zone !== '1' || req.user.role === 'admin')) return out;

  const networks = String(st.shop_networks || '').split(/[\s,]+/).map(cleanIp).filter(Boolean);
  if (networks.includes(cleanIp(req.ip))) return { ...out, method: 'wifi' };
  // System running on the shop PC: a device on the shop's own Wi-Fi is inside the shop
  if (!hosting.cloud && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(cleanIp(req.ip))) return { ...out, method: 'wifi' };

  if (st.shop_lat === '' || st.shop_lng === '') throw bad('المدير لسه محددش موقع المحل — كلّمه يحدده من الإعدادات');
  if (!coords) throw bad('لازم تفتح الموقع (GPS) وتسمح للسيستم يشوفه عشان تسجل من المحل');
  if (coords.accuracy && coords.accuracy > 500) throw bad('الموقع مش دقيق كفاية — شغّل GPS وجرب تاني جنب الشباك أو برة شوية');
  const radius = Math.max(20, Number(st.zone_radius) || 100);
  // Give the benefit of GPS inaccuracy, up to the radius itself
  const slack = Math.min(coords.accuracy || 0, radius);
  if (out.distance - slack > radius) {
    throw bad(`إنت بعيد عن المحل بحوالي ${out.distance > 1000 ? `${(out.distance / 1000).toFixed(1)} كم` : `${out.distance} متر`} — لازم تكون جوه المحل`);
  }
  return { ...out, method: 'gps' };
}

const placeText = (z) => (z.method === 'gps' ? ` • 📍 من المحل (${z.distance} م)` : z.method === 'wifi' ? ' • 📶 من شبكة المحل' : '');

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
    const z = checkZone(db, req);
    const r = db.prepare(`INSERT INTO shifts (user_id, note, in_method, in_lat, in_lng, in_accuracy, in_distance)
                          VALUES (?, ?, ?, ?, ?, ?, ?)`).run(req.user.id, note, z.method, z.lat, z.lng, z.accuracy, z.distance);
    const s = db.prepare('SELECT * FROM shifts WHERE id = ?').get(r.lastInsertRowid);
    req.app.locals.notifier.notify({
      type: 'shift_in', actorId: req.user.id, url: '#/attendance',
      title: `${req.user.full_name} بدأ الشيفت`, body: `تسجيل حضور الساعة ${timeOf(s.check_in_at)}${placeText(z)}${note ? ` — ${note}` : ''}`,
    });
    res.status(201).json({ open: s, minutes: 0 });
  });

  api.post('/shifts/check-out', requireAuth, (req, res) => {
    const s = openShift(req.user.id);
    if (!s) throw bad('إنت مش مسجل حضور');
    const note = str(req.body?.note, 'الملاحظة', { optional: true, max: 200 });
    const z = checkZone(db, req);
    const out = nowLocal(db);
    db.prepare(`UPDATE shifts SET check_out_at = ?, note = COALESCE(?, note),
                out_method = ?, out_lat = ?, out_lng = ?, out_accuracy = ?, out_distance = ? WHERE id = ?`)
      .run(out, note, z.method, z.lat, z.lng, z.accuracy, z.distance, s.id);
    const mins = minutesBetween(s.check_in_at, out);
    req.app.locals.notifier.notify({
      type: 'shift_out', actorId: req.user.id, url: '#/attendance',
      title: `${req.user.full_name} أنهى الشيفت`, body: `انصراف الساعة ${timeOf(out)} — مدة الشيفت ${fmtDuration(mins)}${placeText(z)}`,
    });
    res.json({ open: null, minutes: mins });
  });

  /** Try the zone check without checking in — shows anyone exactly why it would pass or fail. */
  api.post('/shifts/zone/test', requireAuth, (req, res) => {
    const st = getSettings(db);
    const result = {
      zone_on: st.attendance_zone === '1',
      exempt: req.user.role === 'admin',
      shop_set: st.shop_lat !== '' && st.shop_lng !== '',
      radius: Math.max(20, Number(st.zone_radius) || 100),
      ip: cleanIp(req.ip),
    };
    try {
      const z = checkZone(db, req, { force: true });
      Object.assign(result, { ok: true, method: z.method, distance: z.distance });
    } catch (e) {
      Object.assign(result, { ok: false, error: e.message });
    }
    if (result.distance == null && req.body?.lat != null && result.shop_set) {
      result.distance = Math.round(haversine(Number(req.body.lat), Number(req.body.lng), Number(st.shop_lat), Number(st.shop_lng)));
    }
    res.json(result);
  });

  // ---------- shop zone setup (owner) ----------
  /** The address this device reaches the system from — used to register the shop's internet line. */
  api.get('/shifts/zone/network', requirePerm('settings.manage'), (req, res) => {
    const list = String(getSettings(db).shop_networks || '').split(/[\s,]+/).map(cleanIp).filter(Boolean);
    res.json({ ip: cleanIp(req.ip), saved: list, here: list.includes(cleanIp(req.ip)) });
  });

  api.post('/shifts/zone/network', requirePerm('settings.manage'), (req, res) => {
    const ip = cleanIp(req.ip);
    const list = String(getSettings(db).shop_networks || '').split(/[\s,]+/).map(cleanIp).filter(Boolean);
    const next = req.body?.remove ? list.filter((x) => x !== String(req.body.remove)) : [...new Set([...list, ip])];
    db.prepare("INSERT INTO settings (key, value) VALUES ('shop_networks', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(next.join(','));
    audit(db, req.user.id, 'zone.network', { list: next });
    res.json({ ip, saved: next, here: next.includes(ip) });
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
module.exports.haversine = haversine;
module.exports.requireOpenShift = (db, user) => {
  const on = db.prepare("SELECT value FROM settings WHERE key = 'require_shift'").get()?.value === '1';
  if (!on || user.role === 'admin') return;
  const s = db.prepare('SELECT 1 FROM shifts WHERE user_id = ? AND check_out_at IS NULL').get(user.id);
  if (!s) throw bad('لازم تسجل حضور (بدء الشيفت) الأول');
};
