'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  hashPassword, verifyPassword, createSession, requireAuth, requirePerm, PERMISSIONS, SESSION_DAYS,
} = require('../auth');
const { bad, notFound, str, audit, getSettings, today } = require('../util');
const { DEFAULT_SETTINGS } = require('../db');
const { runBackup, listBackups, backupDir } = require('../backup');

/** Same machine or the shop's own network (not coming in through the internet). */
function isLocalAddress(ip = '') {
  const a = ip.replace(/^::ffff:/, '');
  return a === '::1' || a === '127.0.0.1' || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(a);
}

const ROLES = ['admin', 'manager', 'cashier', 'technician'];

module.exports = function adminRoutes(api, db, { dataDir } = {}) {
  // ---------- auth ----------
  // Wrong-password lockout, per username and per address (the system can be reached from the internet)
  const failures = new Map(); // key -> { count, until }
  const isLocked = (key) => (failures.get(key)?.until || 0) > Date.now();
  const fail = (key, max, ms) => {
    const f = failures.get(key);
    const count = (f && f.until <= Date.now() && f.count >= max ? 0 : f?.count || 0) + 1;
    failures.set(key, { count, until: count >= max ? Date.now() + ms : 0 });
  };

  api.post('/auth/login', (req, res) => {
    const username = str(req.body?.username, 'اسم المستخدم').toLowerCase();
    const password = String(req.body?.password || '');
    const ipKey = `ip:${req.ip}`;
    if (isLocked(username) || isLocked(ipKey)) {
      return res.status(429).json({ error: 'محاولات كتير غلط — استنى شوية وجرب تاني' });
    }
    const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
    if (!user || !verifyPassword(password, user.password_hash)) {
      fail(username, 5, 60_000);
      fail(ipKey, 20, 15 * 60_000);
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة السر غلط' });
    }
    failures.delete(username);
    const token = createSession(db, user.id);
    audit(db, user.id, 'login', { ip: req.ip, remote: !isLocalAddress(req.ip) });
    res.setHeader('Set-Cookie', sessionCookie(req, token, SESSION_DAYS * 86400));
    res.json({ user: publicUser(user) });
  });

  api.post('/auth/logout', (req, res) => {
    if (req.sessionToken) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken);
    res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
    res.json({ ok: true });
  });

  /** Sign this user out on every other device (e.g. a lost phone). */
  api.post('/auth/logout-others', requireAuth, (req, res) => {
    const r = db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(req.user.id, req.sessionToken);
    audit(db, req.user.id, 'logout.others', { sessions: r.changes });
    res.json({ ok: true, sessions: r.changes });
  });

  api.get('/auth/me', requireAuth, (req, res) => {
    const perms = PERMISSIONS[req.user.role];
    // Force replacing the factory password before the system is used (it may be reachable online)
    const { password_hash: hash } = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    const mustChange = req.user.username === 'admin' && verifyPassword('admin123', hash);
    res.json({ user: req.user, permissions: perms, settings: getSettings(db), must_change_password: mustChange });
  });

  api.post('/auth/password', requireAuth, (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(String(req.body?.current || ''), user.password_hash)) throw bad('كلمة السر الحالية غلط');
    const next = validPassword(req.body?.password);
    if (next === 'admin123') throw bad('اختار كلمة سر غير الافتراضية');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(user.id, req.sessionToken);
    audit(db, user.id, 'password.change');
    res.json({ ok: true });
  });

  // ---------- users ----------
  const manageUsers = requirePerm('users.manage');

  api.get('/users', manageUsers, (_req, res) => {
    res.json(db.prepare('SELECT id, username, full_name, role, active, created_at FROM users ORDER BY active DESC, id').all());
  });

  // Small list (id + name) used in report filters
  api.get('/users/names', requirePerm('reports.view'), (_req, res) => {
    res.json(db.prepare('SELECT id, full_name FROM users ORDER BY full_name').all());
  });

  api.post('/users', manageUsers, (req, res) => {
    const username = str(req.body?.username, 'اسم المستخدم', { max: 40 }).toLowerCase();
    if (!/^[a-z0-9_.-]+$/.test(username)) throw bad('اسم المستخدم لازم يكون حروف إنجليزي أو أرقام بدون مسافات');
    const fullName = str(req.body?.full_name, 'اسم الموظف', { max: 80 });
    const role = validRole(req.body?.role);
    const password = validPassword(req.body?.password);
    const r = db.prepare('INSERT INTO users (username, full_name, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(username, fullName, hashPassword(password), role);
    audit(db, req.user.id, 'user.create', { id: r.lastInsertRowid, username, role });
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  });

  api.put('/users/:id', manageUsers, (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) throw notFound('المستخدم غير موجود');
    const fullName = req.body.full_name !== undefined ? str(req.body.full_name, 'اسم الموظف', { max: 80 }) : user.full_name;
    const role = req.body.role !== undefined ? validRole(req.body.role) : user.role;
    const active = req.body.active !== undefined ? (req.body.active ? 1 : 0) : user.active;

    if (user.id === req.user.id && (active === 0 || role !== 'admin')) {
      throw bad('مينفعش توقف حسابك أو تشيل صلاحية المدير من نفسك');
    }
    if (user.role === 'admin' && (role !== 'admin' || !active)) {
      const { n } = db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1 AND id <> ?").get(user.id);
      if (n === 0) throw bad('لازم يفضل مدير واحد على الأقل');
    }

    db.prepare('UPDATE users SET full_name = ?, role = ?, active = ? WHERE id = ?').run(fullName, role, active, user.id);
    if (req.body.password) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(validPassword(req.body.password)), user.id);
    }
    if (!active || req.body.password) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    audit(db, req.user.id, 'user.update', { id: user.id, role, active, password_reset: !!req.body.password });
    res.json({ ok: true });
  });

  // ---------- settings ----------
  api.get('/settings', requireAuth, (_req, res) => res.json(getSettings(db)));

  api.put('/settings', requirePerm('settings.manage'), (req, res) => {
    const set = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (req.body?.[key] !== undefined) set.run(key, String(req.body[key]).slice(0, 500));
    }
    audit(db, req.user.id, 'settings.update');
    res.json(getSettings(db));
  });

  // ---------- categories ----------
  api.get('/categories', requireAuth, (_req, res) => {
    res.json(db.prepare(`
      SELECT c.id, c.name, COUNT(p.id) AS products
      FROM categories c LEFT JOIN products p ON p.category_id = c.id AND p.active = 1
      GROUP BY c.id ORDER BY c.name`).all());
  });

  api.post('/categories', requirePerm('products.edit'), (req, res) => {
    const r = db.prepare('INSERT INTO categories (name) VALUES (?)').run(str(req.body?.name, 'اسم القسم', { max: 60 }));
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  });

  api.put('/categories/:id', requirePerm('products.edit'), (req, res) => {
    const r = db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(str(req.body?.name, 'اسم القسم', { max: 60 }), req.params.id);
    if (!r.changes) throw notFound('القسم غير موجود');
    res.json({ ok: true });
  });

  api.delete('/categories/:id', requirePerm('products.edit'), (req, res) => {
    db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // ---------- backup & audit ----------
  api.get('/backup', requirePerm('backup'), (req, res) => {
    const file = path.join(os.tmpdir(), `mobilemix-backup-${Date.now()}.db`);
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    audit(db, req.user.id, 'backup.download');
    res.download(file, `mobilemix-backup-${today()}.db`, () => fs.rm(file, { force: true }, () => {}));
  });

  // ---------- system: remote access info & automatic backups ----------
  api.get('/system', requirePerm('settings.manage'), (req, res) => {
    const addresses = [];
    for (const [name, list] of Object.entries(os.networkInterfaces())) {
      for (const i of list || []) {
        if (i.family !== 'IPv4' || i.internal) continue;
        const tailscale = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(i.address) || /tailscale/i.test(name);
        addresses.push({ name, address: i.address, tailscale });
      }
    }
    const dir = backupDir(db, dataDir);
    res.json({
      port: req.socket.localPort,
      addresses,
      via: { host: req.get('host'), secure: req.secure, remote: !isLocalAddress(req.ip) },
      backups: { dir, list: listBackups(dir).slice(0, 10) },
      sessions: db.prepare(`SELECT u.full_name, COUNT(*) AS n FROM sessions s JOIN users u ON u.id = s.user_id
                            WHERE s.expires_at > datetime('now','localtime') GROUP BY u.id ORDER BY n DESC`).all(),
    });
  });

  api.post('/system/backup-now', requirePerm('backup'), (req, res) => {
    try {
      const r = runBackup(db, dataDir, { force: true });
      audit(db, req.user.id, 'backup.auto', { file: r.file });
      res.json({ ok: true, file: r.file });
    } catch (e) {
      throw bad(`فشل النسخ: ${e.message}`);
    }
  });

  api.get('/audit', requirePerm('audit.view'), (_req, res) => {
    res.json(db.prepare(`
      SELECT a.id, a.action, a.details, a.created_at, u.full_name AS user_name
      FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      ORDER BY a.id DESC LIMIT 300`).all());
  });

  function sessionCookie(req, token, maxAge) {
    // Over HTTPS (remote access through a tunnel) the cookie is marked Secure
    return `mm_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${req.secure ? '; Secure' : ''}`;
  }
  function publicUser(u) {
    return { id: u.id, username: u.username, full_name: u.full_name, role: u.role };
  }
  function validRole(role) {
    if (!ROLES.includes(role)) throw bad('الصلاحية غير صحيحة');
    return role;
  }
  function validPassword(pw) {
    const s = String(pw || '');
    if (s.length < 6) throw bad('كلمة السر لازم تكون 6 حروف على الأقل');
    return s;
  }
};
