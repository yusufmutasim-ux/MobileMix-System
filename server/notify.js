'use strict';
const webpush = require('web-push');
const { can } = require('./auth');

/** Kinds of events the owner can be notified about. */
const TYPES = {
  sale: 'عملية بيع',
  sale_return: 'مرتجع',
  repair_in: 'استلام جهاز صيانة',
  repair_out: 'تسليم جهاز صيانة',
  shift_in: 'تسجيل حضور',
  shift_out: 'تسجيل انصراف',
  shift_denied: 'محاولة حضور/انصراف من برة المحل',
  expense: 'مصروف من الدرج',
  drawer_close: 'تقفيل الدرج',
  customer_payment: 'تحصيل من عميل (آجل / قسط)',
  purchase: 'فاتورة شراء بضاعة',
  installments_due: 'أقساط متأخرة (تذكير الصبح)',
  daily_summary: 'ملخص اليوم (آخر اليوم)',
  shift_missing: 'موظف شيفته بدأ ولسه مسجلش حضور',
};

// Types added after people already saved their choices: on for them unless they turn it off
const ADDED_LATER = ['shift_denied', 'expense', 'drawer_close', 'customer_payment', 'purchase', 'installments_due', 'daily_summary', 'shift_missing'];

/**
 * Sends each event to managers/admins three ways:
 *  - saved in the notifications list (bell icon),
 *  - live to every open window (Server-Sent Events),
 *  - as a push notification to registered phones/computers, even when the app is closed.
 */
function createNotifier(db, { send } = {}) {
  const secret = (k) => db.prepare('SELECT value FROM secrets WHERE key = ?').get(k)?.value;
  let publicKey = process.env.VAPID_PUBLIC_KEY || secret('vapid_public');
  let privateKey = process.env.VAPID_PRIVATE_KEY || secret('vapid_private');
  if (!publicKey || !privateKey) {
    ({ publicKey, privateKey } = webpush.generateVAPIDKeys());
    const put = db.prepare('INSERT OR REPLACE INTO secrets (key, value) VALUES (?, ?)');
    put.run('vapid_public', publicKey);
    put.run('vapid_private', privateKey);
  }
  const subject = process.env.VAPID_SUBJECT || 'mailto:owner@mobilemix.app';
  const sendPush = send || ((sub, payload) =>
    webpush.sendNotification(sub, payload, { TTL: 6 * 3600, vapidDetails: { subject, publicKey, privateKey } }));

  const clients = new Set(); // { res, user }

  function prefs(userId) {
    const all = Object.keys(TYPES);
    const get = (k) => db.prepare('SELECT value FROM user_prefs WHERE user_id = ? AND key = ?').get(userId, k)?.value;
    try {
      const off = get('notify_off');
      if (off) return all.filter((t) => !JSON.parse(off).includes(t));
      const legacy = get('notify_types'); // older format: the list of enabled types
      if (legacy) return [...new Set([...JSON.parse(legacy), ...ADDED_LATER])].filter((t) => all.includes(t));
    } catch { /* fall through */ }
    return all;
  }

  const wants = (user, n) => user.id !== n.actor_id && can(user, 'notifications.receive') && prefs(user.id).includes(n.type);

  function recipients(n) {
    return db.prepare('SELECT id, username, full_name, role FROM users WHERE active = 1').all().filter((u) => wants(u, n));
  }

  function notify({ type, title, body, url, actorId }) {
    if (!TYPES[type]) throw new Error(`unknown notification type ${type}`);
    const r = db.prepare('INSERT INTO notifications (type, title, body, url, actor_id) VALUES (?, ?, ?, ?, ?)')
      .run(type, title, body ?? null, url ?? null, actorId ?? null);
    const n = db.prepare('SELECT * FROM notifications WHERE id = ?').get(r.lastInsertRowid);

    for (const c of clients) {
      if (wants(c.user, n)) c.res.write(`event: notification\ndata: ${JSON.stringify(n)}\n\n`);
    }

    const users = recipients(n);
    if (users.length) {
      const subs = db.prepare(`SELECT * FROM push_subscriptions WHERE user_id IN (${users.map(() => '?').join(',')})`)
        .all(...users.map((u) => u.id));
      const payload = JSON.stringify({ id: n.id, type, title, body, url, tag: `mm-${type}-${n.id}` });
      for (const s of subs) {
        Promise.resolve()
          .then(() => sendPush({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload))
          .catch((e) => {
            // The browser removed this subscription (app uninstalled / permission revoked)
            if (e && (e.statusCode === 404 || e.statusCode === 410)) db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
          });
      }
    }
    return n;
  }

  return { notify, clients, prefs, publicKey, TYPES, sendTo: sendPush };
}

module.exports = { createNotifier, TYPES };
