'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  hashPassword, verifyPassword, createSession, requireAuth, requirePerm, PERMISSIONS, SESSION_DAYS,
} = require('../auth');
const { bad, notFound, str, audit, getSettings, today } = require('../util');
const { DEFAULT_SETTINGS } = require('../db');

const ROLES = ['admin', 'manager', 'cashier'];

module.exports = function adminRoutes(api, db) {
  // ---------- auth ----------
  const failures = new Map(); // username -> { count, until }

  api.post('/auth/login', (req, res) => {
    const username = str(req.body?.username, 'اسم المستخدم').toLowerCase();
    const password = String(req.body?.password || '');
    const f = failures.get(username);
    if (f && f.until > Date.now()) {
      return res.status(429).json({ error: 'محاولات كتير غلط — استنى دقيقة وجرب تاني' });
    }
    const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
    if (!user || !verifyPassword(password, user.password_hash)) {
      const count = (f?.count || 0) + 1;
      failures.set(username, { count, until: count >= 5 ? Date.now() + 60_000 : 0 });
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة السر غلط' });
    }
    failures.delete(username);
    const token = createSession(db, user.id);
    audit(db, user.id, 'login');
    res.setHeader('Set-Cookie',
      `mm_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86400}`);
    res.json({ user: publicUser(user) });
  });

  api.post('/auth/logout', (req, res) => {
    if (req.sessionToken) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken);
    res.setHeader('Set-Cookie', 'mm_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    res.json({ ok: true });
  });

  api.get('/auth/me', requireAuth, (req, res) => {
    const perms = PERMISSIONS[req.user.role];
    res.json({ user: req.user, permissions: perms, settings: getSettings(db) });
  });

  api.post('/auth/password', requireAuth, (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(String(req.body?.current || ''), user.password_hash)) throw bad('كلمة السر الحالية غلط');
    const next = validPassword(req.body?.password);
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

  api.get('/audit', requirePerm('audit.view'), (_req, res) => {
    res.json(db.prepare(`
      SELECT a.id, a.action, a.details, a.created_at, u.full_name AS user_name
      FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      ORDER BY a.id DESC LIMIT 300`).all());
  });

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
