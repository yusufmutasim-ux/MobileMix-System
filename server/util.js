'use strict';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const bad = (msg) => new HttpError(400, msg);
const notFound = (msg = 'غير موجود') => new HttpError(404, msg);

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function num(value, label, { min = -Infinity, int = false, optional = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return null;
    throw bad(`${label} مطلوب`);
  }
  const n = Number(value);
  if (!Number.isFinite(n)) throw bad(`${label} غير صحيح`);
  if (int && !Number.isInteger(n)) throw bad(`${label} لازم يكون رقم صحيح`);
  if (n < min) throw bad(`${label} لازم يكون ${min} أو أكثر`);
  return n;
}

function str(value, label, { optional = false, max = 200 } = {}) {
  const s = value === undefined || value === null ? '' : String(value).trim();
  if (!s) {
    if (optional) return null;
    throw bad(`${label} مطلوب`);
  }
  if (s.length > max) throw bad(`${label} طويل جداً`);
  return s;
}

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Read ?from=&to= (YYYY-MM-DD), defaulting to today. */
function dateRange(query) {
  const from = isDate(query.from) ? query.from : today();
  const to = isDate(query.to) ? query.to : from;
  return from <= to ? { from, to } : { from: to, to: from };
}

const pad = (n, len) => String(n).padStart(len, '0');

function audit(db, userId, action, details) {
  db.prepare('INSERT INTO audit_log (user_id, action, details) VALUES (?, ?, ?)')
    .run(userId ?? null, action, details == null ? null : JSON.stringify(details));
}

function getSettings(db) {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}

module.exports = { HttpError, bad, notFound, round2, num, str, dateRange, today, pad, audit, getSettings };
