'use strict';
const { requirePerm, can } = require('../auth');
const { tx } = require('../db');
const { bad, notFound, num, str, round2, dateRange, audit, getSettings } = require('../util');
const { drawerNow } = require('../money');

const fmt = (v, cur) => `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${cur || 'ج.م'}`;

/** Expenses, money in/out of the drawer, and counting (closing) the drawer. */
module.exports = function moneyRoutes(api, db) {
  // ---------- expenses ----------
  api.get('/expenses', requirePerm('expenses.create'), (req, res) => {
    const { from, to } = dateRange(req.query);
    const where = ['date(e.created_at) BETWEEN ? AND ?'];
    const params = [from, to];
    if (!can(req.user, 'expenses.view')) { where.push('e.user_id = ?'); params.push(req.user.id); }
    if (req.query.category) { where.push('e.category = ?'); params.push(String(req.query.category)); }
    const rows = db.prepare(`
      SELECT e.*, u.full_name AS user_name, emp.full_name AS employee_name
      FROM expenses e LEFT JOIN users u ON u.id = e.user_id LEFT JOIN users emp ON emp.id = e.employee_id
      WHERE ${where.join(' AND ')} ORDER BY e.id DESC LIMIT 2000`).all(...params);
    const byCategory = {};
    for (const r of rows) byCategory[r.category] = round2((byCategory[r.category] || 0) + r.amount);
    res.json({
      from, to, rows,
      total: round2(rows.reduce((s, r) => s + r.amount, 0)),
      by_category: Object.entries(byCategory).map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total),
    });
  });

  api.post('/expenses', requirePerm('expenses.create'), (req, res) => {
    const b = req.body || {};
    const manager = can(req.user, 'expenses.view');
    const category = str(b.category, 'نوع المصروف', { max: 60 });
    const amount = round2(num(b.amount, 'المبلغ', { min: 0.01 }));
    // Staff can only record cash taken out of the drawer; salaries are the owner's
    const fromDrawer = manager ? (b.from_drawer === false || b.from_drawer === 0 || b.from_drawer === '0' ? 0 : 1) : 1;
    let employeeId = null, period = null;
    if (b.employee_id) {
      if (!can(req.user, 'payroll')) throw bad('المرتبات والسلف للمدير بس');
      employeeId = num(b.employee_id, 'الموظف', { int: true });
      if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(employeeId)) throw bad('الموظف غير موجود');
      period = /^\d{4}-\d{2}$/.test(String(b.period || '')) ? String(b.period) : null;
    }
    const r = db.prepare(`INSERT INTO expenses (category, amount, from_drawer, note, employee_id, period, user_id)
                          VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(category, amount, fromDrawer, str(b.note, 'الملاحظة', { optional: true, max: 300 }), employeeId, period, req.user.id);
    const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get(r.lastInsertRowid);
    audit(db, req.user.id, 'expense.add', { id: row.id, category, amount });
    req.app.locals.notifier.notify({
      type: 'expense', actorId: req.user.id, url: '#/expenses',
      title: `مصروف — ${fmt(amount, getSettings(db).currency)}`,
      body: `${req.user.full_name} • ${category}${row.note ? ` • ${row.note}` : ''}${fromDrawer ? ' • من الدرج' : ''}`,
    });
    res.status(201).json(row);
  });

  api.delete('/expenses/:id', requirePerm('expenses.create'), (req, res) => {
    const e = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
    if (!e) throw notFound('المصروف غير موجود');
    // Staff may undo their own mistake on the same day only
    const today = db.prepare("SELECT date('now','localtime') AS d").get().d;
    if (!can(req.user, 'expenses.view') && (e.user_id !== req.user.id || e.created_at.slice(0, 10) !== today)) {
      throw bad('تقدر تمسح المصروف اللي سجلته النهارده بس — كلّم المدير');
    }
    if (e.employee_id && !can(req.user, 'payroll')) throw bad('المرتبات والسلف للمدير بس');
    db.prepare('DELETE FROM expenses WHERE id = ?').run(e.id);
    audit(db, req.user.id, 'expense.delete', { id: e.id, category: e.category, amount: e.amount });
    res.json({ ok: true });
  });

  // ---------- the drawer ----------
  api.get('/drawer', requirePerm('drawer.close'), (req, res) => {
    const now = drawerNow(db);
    const out = { ...now };
    // Managers see the expected amount, what moved, and the history
    if (can(req.user, 'drawer.view')) {
      out.closings = db.prepare(`SELECT d.*, u.full_name AS user_name FROM drawer_closings d LEFT JOIN users u ON u.id = d.user_id
                                 ORDER BY d.id DESC LIMIT 30`).all();
      const from = now.from || '0000-00-00 00:00:00';
      out.moves = db.prepare(`SELECT m.*, u.full_name AS user_name FROM cash_moves m LEFT JOIN users u ON u.id = m.user_id
                              WHERE m.created_at > ? AND m.created_at <= ? ORDER BY m.id DESC`).all(from, now.to);
      out.expenses = db.prepare(`SELECT e.*, u.full_name AS user_name FROM expenses e LEFT JOIN users u ON u.id = e.user_id
                                 WHERE e.from_drawer = 1 AND e.created_at > ? AND e.created_at <= ? ORDER BY e.id DESC`).all(from, now.to);
      return res.json(out);
    }
    // Staff count the drawer blind: they don't see what should be there until they've counted
    res.json({ blind: true, from: now.from });
  });

  api.post('/drawer/close', requirePerm('drawer.close'), (req, res) => {
    const b = req.body || {};
    const counted = round2(num(b.counted, 'المبلغ اللي في الدرج', { min: 0 }));
    const left = round2(num(b.left_in_drawer ?? counted, 'المبلغ اللي هيفضل في الدرج', { min: 0 }));
    if (left > counted) throw bad('اللي هيفضل في الدرج أكتر من اللي اتعد');
    const note = str(b.note, 'الملاحظة', { optional: true, max: 300 });
    const closing = tx(db, () => {
      const now = drawerNow(db);
      const diff = round2(counted - now.expected);
      const r = db.prepare(`INSERT INTO drawer_closings (user_id, opened_at, closed_at, opening, expected, counted, diff, left_in_drawer, details, note)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(req.user.id, now.from, now.to, now.opening, now.expected, counted, diff, left, JSON.stringify(now.parts), note);
      return db.prepare('SELECT * FROM drawer_closings WHERE id = ?').get(r.lastInsertRowid);
    });
    audit(db, req.user.id, 'drawer.close', { id: closing.id, expected: closing.expected, counted, diff: closing.diff });
    const cur = getSettings(db).currency;
    const state = Math.abs(closing.diff) < 0.5 ? '✅ مظبوط' : closing.diff < 0 ? `⚠️ عجز ${fmt(-closing.diff, cur)}` : `زيادة ${fmt(closing.diff, cur)}`;
    req.app.locals.notifier.notify({
      type: 'drawer_close', actorId: req.user.id, url: '#/drawer',
      title: `تقفيل الدرج — ${state}`,
      body: `${req.user.full_name} • المفروض ${fmt(closing.expected, cur)} • اتعد ${fmt(counted, cur)}${left < counted ? ` • اتشال ${fmt(counted - left, cur)}` : ''}`,
    });
    res.status(201).json(closing);
  });

  api.post('/drawer/move', requirePerm('drawer.view'), (req, res) => {
    const b = req.body || {};
    const kind = b.kind === 'in' ? 'in' : b.kind === 'out' ? 'out' : null;
    if (!kind) throw bad('اختار إيداع ولا سحب');
    const amount = round2(num(b.amount, 'المبلغ', { min: 0.01 }));
    const r = db.prepare('INSERT INTO cash_moves (kind, amount, note, user_id) VALUES (?, ?, ?, ?)')
      .run(kind, amount, str(b.note, 'الملاحظة', { optional: true, max: 200 }), req.user.id);
    audit(db, req.user.id, 'drawer.move', { kind, amount });
    res.status(201).json(db.prepare('SELECT * FROM cash_moves WHERE id = ?').get(r.lastInsertRowid));
  });
};
