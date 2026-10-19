'use strict';
const crypto = require('node:crypto');

const SESSION_DAYS = 7;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(pw, stored) {
  const [algo, saltHex, hashHex] = String(stored).split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

/**
 * What each role may do. Admin can do everything.
 *  - manager: everything except users, settings and backups
 *  - cashier: sell, print, see products (without cost), own sales; receive & hand over repairs
 *  - technician: repairs work (diagnosis, status, parts, price) and looking up parts
 */
const PERMISSIONS = {
  admin: ['*'],
  manager: [
    'sales.create', 'sales.view_all', 'sales.return',
    'products.view', 'products.edit', 'products.view_cost',
    'stock.edit', 'stocktake', 'labels.print', 'reports.view',
    'repairs.view', 'repairs.create', 'repairs.work', 'repairs.cash',
    'attendance.view', 'notifications.receive',
  ],
  cashier: ['sales.create', 'products.view', 'labels.print', 'repairs.view', 'repairs.create', 'repairs.cash'],
  technician: ['products.view', 'repairs.view', 'repairs.create', 'repairs.work'],
};

function can(user, perm) {
  if (!user) return false;
  const list = PERMISSIONS[user.role] || [];
  return list.includes('*') || list.includes(perm);
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now','localtime', '+${SESSION_DAYS} days'))`
  ).run(token, userId);
  db.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now','localtime')`).run();
  return token;
}

function sessionMiddleware(db) {
  const find = db.prepare(`
    SELECT u.id, u.username, u.full_name, u.role
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > datetime('now','localtime') AND u.active = 1`);
  return (req, _res, next) => {
    const token = parseCookies(req.headers.cookie).mm_session;
    req.user = token ? find.get(token) || null : null;
    req.sessionToken = token;
    next();
  };
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'سجّل الدخول أولاً' });
  next();
}

function requirePerm(perm) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'سجّل الدخول أولاً' });
    if (!can(req.user, perm)) return res.status(403).json({ error: 'ليس لديك صلاحية لهذه العملية' });
    next();
  };
}

module.exports = {
  hashPassword, verifyPassword, createSession, sessionMiddleware,
  requireAuth, requirePerm, can, PERMISSIONS, SESSION_DAYS,
};
