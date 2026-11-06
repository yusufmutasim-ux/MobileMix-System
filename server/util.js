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

/*
 * The shop's day ends at `dayEnd` o'clock (0–6). A shop open past midnight keeps counting its sales,
 * expenses and drawer closing on the day that started, until that hour.
 */
let dayEnd = 0;
function setDayEnd(h) { dayEnd = Math.min(6, Math.max(0, Math.floor(Number(h) || 0))); }
const getDayEnd = () => dayEnd;

/** The shop day a 'YYYY-MM-DD HH:MM:SS' (local) time belongs to. */
function bday(ts) {
  if (ts == null) return null;
  const t = String(ts);
  const day = t.slice(0, 10);
  if (!dayEnd || t.length < 13 || Number(t.slice(11, 13)) >= dayEnd) return day;
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** The last second of shop day `day` ('YYYY-MM-DD'): 23:59:59, or the next morning just before the day-end hour. */
function shopDayEnd(day) {
  if (!dayEnd) return `${day} 23:59:59`;
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return `${d.toISOString().slice(0, 10)} ${String(dayEnd - 1).padStart(2, '0')}:59:59`;
}

function today() {
  const d = new Date(Date.now() - dayEnd * 3600e3);
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

/** '17:05' or '2026-11-03 17:05:00' → '5:05 م' (12-hour, as people say it). */
function t12(v) {
  const m = String(v || '').match(/(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!m) return String(v || '');
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'ص' : 'م'}`;
}

function audit(db, userId, action, details) {
  db.prepare('INSERT INTO audit_log (user_id, action, details) VALUES (?, ?, ?)')
    .run(userId ?? null, action, details == null ? null : JSON.stringify(details));
}

function getSettings(db) {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}

module.exports = { HttpError, bad, notFound, round2, num, str, dateRange, today, bday, setDayEnd, getDayEnd, shopDayEnd, t12, pad, audit, getSettings };
