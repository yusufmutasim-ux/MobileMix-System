'use strict';
const { requirePerm } = require('../auth');
const { bad, str } = require('../util');

module.exports = function notificationRoutes(api, db) {
  const perm = requirePerm('notifications.receive');
  const notifier = () => api.notifier;

  const seenId = (userId) => Number(db.prepare("SELECT value FROM user_prefs WHERE user_id = ? AND key = 'notify_seen'").get(userId)?.value || 0);
  const setPref = (userId, key, value) =>
    db.prepare('INSERT INTO user_prefs (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value')
      .run(userId, key, String(value));

  api.get('/notifications', perm, (req, res) => {
    const types = notifier().prefs(req.user.id);
    const marks = types.map(() => '?').join(',') || "''";
    const rows = db.prepare(`SELECT n.*, u.full_name AS actor_name FROM notifications n LEFT JOIN users u ON u.id = n.actor_id
      WHERE n.type IN (${marks}) AND (n.actor_id IS NULL OR n.actor_id <> ?) ORDER BY n.id DESC LIMIT 50`).all(...types, req.user.id);
    const seen = seenId(req.user.id);
    res.json({ items: rows, unread: rows.filter((r) => r.id > seen).length, seen });
  });

  api.post('/notifications/seen', perm, (req, res) => {
    const last = db.prepare('SELECT MAX(id) AS m FROM notifications').get().m || 0;
    setPref(req.user.id, 'notify_seen', Math.min(Number(req.body?.id) || last, last));
    res.json({ ok: true });
  });

  /** Live updates for open windows. */
  api.get('/notifications/stream', perm, (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n\n');
    const client = { res, user: req.user };
    notifier().clients.add(client);
    const token = req.sessionToken;
    const beat = setInterval(() => {
      // Close the stream if the session was ended (logout, user stopped)
      const ok = db.prepare(`SELECT 1 FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ? AND u.active = 1 AND s.expires_at > datetime('now','localtime')`).get(token);
      if (!ok) return res.end();
      res.write(': ping\n\n');
    }, 25_000);
    req.on('close', () => { clearInterval(beat); notifier().clients.delete(client); });
  });

  // ---------- preferences ----------
  api.get('/notifications/prefs', perm, (req, res) => {
    const n = notifier();
    res.json({
      types: n.TYPES, enabled: n.prefs(req.user.id),
      devices: db.prepare('SELECT id, user_agent, created_at FROM push_subscriptions WHERE user_id = ? ORDER BY id DESC').all(req.user.id),
    });
  });

  api.put('/notifications/prefs', perm, (req, res) => {
    const all = Object.keys(notifier().TYPES);
    const enabled = Array.isArray(req.body?.enabled) ? req.body.enabled.filter((t) => all.includes(t)) : all;
    setPref(req.user.id, 'notify_off', JSON.stringify(all.filter((t) => !enabled.includes(t))));
    res.json({ enabled });
  });

  // ---------- push (phone / computer notifications) ----------
  api.get('/push/key', perm, (_req, res) => res.json({ key: notifier().publicKey }));

  api.post('/push/subscribe', perm, (req, res) => {
    const sub = req.body?.subscription || {};
    const endpoint = str(sub.endpoint, 'endpoint', { max: 1000 });
    if (!/^https:\/\//.test(endpoint)) throw bad('اشتراك غير صحيح');
    const p256dh = str(sub.keys?.p256dh, 'p256dh', { max: 200 });
    const auth = str(sub.keys?.auth, 'auth', { max: 100 });
    db.prepare(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`)
      .run(req.user.id, endpoint, p256dh, auth, String(req.get('user-agent') || '').slice(0, 200));
    res.status(201).json({ ok: true });
  });

  api.post('/push/unsubscribe', perm, (req, res) => {
    db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND (endpoint = ? OR id = ?)')
      .run(req.user.id, String(req.body?.endpoint || ''), Number(req.body?.id) || -1);
    res.json({ ok: true });
  });

  api.post('/push/test', perm, async (req, res) => {
    const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(req.user.id);
    if (!subs.length) throw bad('مفيش أجهزة مفعّل عليها الإشعارات لحسابك');
    const payload = JSON.stringify({ title: 'Mobile Mix ✅', body: 'الإشعارات شغالة على الجهاز ده', url: '#/', tag: 'mm-test' });
    let sent = 0;
    for (const s of subs) {
      try {
        await notifier().sendTo({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        sent++;
      } catch (e) {
        if (e && (e.statusCode === 404 || e.statusCode === 410)) db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
      }
    }
    res.json({ sent, total: subs.length });
  });
};
