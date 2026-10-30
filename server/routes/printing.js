'use strict';
const { requireAuth } = require('../auth');
const { bad } = require('../util');

/**
 * Printing from a phone on the shop computer's printer.
 * The computer that has the printer opens the system as "the printing device" and keeps a live connection here;
 * a phone sends what it wants printed (the invoice / labels data, not a page), and the computer prints it
 * with its own copy of the app. A job goes to one computer only (the first that takes it).
 */
const KINDS = ['invoice', 'labels', 'repair_receipt', 'repair_sticker'];
const KEEP_MINUTES = 30; // a computer that opens later still prints what was sent in the last half hour

module.exports = function printingRoutes(api, db) {
  db.exec(`CREATE TABLE IF NOT EXISTS print_jobs (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    args TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    done_at TEXT
  )`);
  const stations = new Set(); // { res, user, name }

  const jobOut = (j) => ({ id: j.id, kind: j.kind, args: JSON.parse(j.args), from: j.from_name || '', created_at: j.created_at });
  const pending = () => db.prepare(`SELECT j.*, u.full_name AS from_name FROM print_jobs j LEFT JOIN users u ON u.id = j.user_id
    WHERE j.status = 'pending' AND j.created_at > datetime('now','localtime','-${KEEP_MINUTES} minutes') ORDER BY j.id`).all();
  const status = () => ({ online: stations.size > 0, names: [...new Set([...stations].map((s) => s.name))] });

  api.get('/print-jobs/status', requireAuth, (_req, res) => res.json(status()));

  api.post('/print-jobs', requireAuth, (req, res) => {
    const { kind, args } = req.body || {};
    if (!KINDS.includes(kind)) throw bad('نوع طباعة مش معروف');
    if (!Array.isArray(args) || !args.length) throw bad('مفيش حاجة تتطبع');
    db.prepare("DELETE FROM print_jobs WHERE created_at < datetime('now','localtime','-1 day')").run();
    const id = Number(db.prepare('INSERT INTO print_jobs (kind, args, user_id) VALUES (?, ?, ?)').run(kind, JSON.stringify(args), req.user.id).lastInsertRowid);
    const job = jobOut({ ...db.prepare('SELECT * FROM print_jobs WHERE id = ?').get(id), from_name: req.user.full_name });
    for (const s of stations) s.res.write(`event: job\ndata: ${JSON.stringify(job)}\n\n`);
    res.status(201).json({ id, ...status() });
  });

  /** The first computer to take a job prints it; the others skip it. */
  api.post('/print-jobs/:id/take', requireAuth, (req, res) => {
    const r = db.prepare("UPDATE print_jobs SET status = 'done', done_at = datetime('now','localtime') WHERE id = ? AND status = 'pending'").run(Number(req.params.id));
    res.json({ ok: r.changes === 1 });
  });

  api.get('/print-jobs/stream', requireAuth, (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 4000\n\n');
    const station = { res, user: req.user, name: String(req.query.name || '').slice(0, 40) || req.user.full_name };
    stations.add(station);
    for (const j of pending()) res.write(`event: job\ndata: ${JSON.stringify(jobOut(j))}\n\n`);
    const token = req.sessionToken;
    const beat = setInterval(() => {
      const ok = db.prepare(`SELECT 1 FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ? AND u.active = 1 AND s.expires_at > datetime('now','localtime')`).get(token);
      if (!ok) return res.end();
      res.write(': ping\n\n');
    }, 25_000);
    req.on('close', () => { clearInterval(beat); stations.delete(station); });
  });
};
