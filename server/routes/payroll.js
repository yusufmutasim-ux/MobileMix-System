'use strict';
const { requirePerm } = require('../auth');
const { bad, notFound, num, str, round2, audit, today } = require('../util');

const monthOf = (v) => (/^\d{4}-\d{2}$/.test(String(v || '')) ? String(v) : today().slice(0, 7));

/**
 * Salaries: for each employee and month — days and hours from attendance, commission on their
 * sales, minus advances (سلف) and what was already paid. Payments are saved as expenses.
 */
module.exports = function payrollRoutes(api, db) {
  const perm = requirePerm('payroll');

  function sheet(month) {
    const users = db.prepare("SELECT id, full_name, role, active, salary, commission_pct FROM users WHERE role <> 'admin' OR salary > 0 ORDER BY active DESC, full_name").all();
    const like = `${month}%`;
    return users.map((u) => {
      const att = db.prepare(`SELECT COUNT(DISTINCT date(check_in_at)) AS days,
          COALESCE(SUM(CASE WHEN check_out_at IS NOT NULL THEN (julianday(check_out_at) - julianday(check_in_at)) * 1440 END), 0) AS minutes
        FROM shifts WHERE user_id = ? AND check_in_at LIKE ?`).get(u.id, like);
      const sold = db.prepare('SELECT COALESCE(SUM(total), 0) AS t FROM sales WHERE user_id = ? AND created_at LIKE ?').get(u.id, like).t;
      const returned = db.prepare(`SELECT COALESCE(SUM(r.amount), 0) AS t FROM returns r JOIN sales s ON s.id = r.sale_id
        WHERE s.user_id = ? AND r.created_at LIKE ?`).get(u.id, like).t;
      const sales = round2(sold - returned);
      const commission = round2((sales * (u.commission_pct || 0)) / 100);
      const sum = (cat) => round2(db.prepare(`SELECT COALESCE(SUM(amount), 0) AS t FROM expenses
        WHERE employee_id = ? AND category = ? AND COALESCE(period, substr(created_at, 1, 7)) = ?`).get(u.id, cat, month).t);
      const advances = sum('سلفة');
      const paid = sum('مرتبات');
      const due = round2((u.salary || 0) + commission - advances - paid);
      return { ...u, days: att.days, hours: round2(att.minutes / 60), sales, commission, advances, paid, due };
    });
  }

  api.get('/payroll', perm, (req, res) => {
    const month = monthOf(req.query.month);
    const rows = sheet(month);
    const t = (k) => round2(rows.reduce((a, r) => a + (r[k] || 0), 0));
    res.json({ month, rows, totals: { salary: t('salary'), commission: t('commission'), advances: t('advances'), paid: t('paid'), due: t('due') } });
  });

  api.put('/payroll/:userId', perm, (req, res) => {
    const u = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.userId);
    if (!u) throw notFound('الموظف غير موجود');
    const b = req.body || {};
    const salary = round2(num(b.salary, 'المرتب', { min: 0, optional: true }) || 0);
    const pct = round2(num(b.commission_pct, 'نسبة العمولة', { min: 0, optional: true }) || 0);
    if (pct > 50) throw bad('نسبة العمولة كبيرة جداً');
    db.prepare('UPDATE users SET salary = ?, commission_pct = ? WHERE id = ?').run(salary, pct, u.id);
    audit(db, req.user.id, 'payroll.settings', { user: u.id, salary, commission_pct: pct });
    res.json({ ok: true });
  });

  /** Pay a salary (or part of it) or give an advance — saved as an expense for that employee and month. */
  api.post('/payroll/:userId/:kind', perm, (req, res) => {
    const kind = req.params.kind === 'pay' ? 'مرتبات' : req.params.kind === 'advance' ? 'سلفة' : null;
    if (!kind) throw notFound();
    const u = db.prepare('SELECT id, full_name FROM users WHERE id = ?').get(req.params.userId);
    if (!u) throw notFound('الموظف غير موجود');
    const b = req.body || {};
    const amount = round2(num(b.amount, 'المبلغ', { min: 0.01 }));
    const month = monthOf(b.month);
    const fromDrawer = b.from_drawer === false || b.from_drawer === 0 || b.from_drawer === '0' ? 0 : 1;
    const note = str(b.note, 'الملاحظة', { optional: true, max: 200 }) || `${kind === 'سلفة' ? 'سلفة' : 'مرتب'} ${u.full_name} — ${month}`;
    db.prepare('INSERT INTO expenses (category, amount, from_drawer, note, employee_id, period, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(kind, amount, fromDrawer, note, u.id, month, req.user.id);
    audit(db, req.user.id, kind === 'سلفة' ? 'payroll.advance' : 'payroll.pay', { user: u.id, amount, month });
    res.status(201).json(sheet(month).find((r) => r.id === u.id) || { ok: true });
  });
};
