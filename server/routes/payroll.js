'use strict';
const { requirePerm } = require('../auth');
const { bad, notFound, num, str, round2, audit, today, getSettings } = require('../util');
const { absences } = require('../schedule');

const monthOf = (v) => (/^\d{4}-\d{2}$/.test(String(v || '')) ? String(v) : today().slice(0, 7));

/**
 * Salaries: for each employee and month — days and hours from attendance, commission on their
 * sales, minus advances (سلف) and what was already paid. Payments are saved as expenses.
 */
module.exports = function payrollRoutes(api, db) {
  const perm = requirePerm('payroll');

  function sheet(month) {
    const st = getSettings(db);
    const auto = st.auto_deduct !== '0';
    const absDays = Math.max(0, Number(st.absence_deduct_days) || 0), lateDays = Math.max(0, Number(st.late_deduct_days) || 0);
    const last = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
    const users = db.prepare("SELECT id, full_name, role, active, salary, commission_pct, daily_allowance, shift_start, shift_end, work_days, schedule_since, created_at, deleted_at FROM users WHERE role <> 'admin' OR salary > 0 ORDER BY active DESC, full_name").all();
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
      const allowances = sum('يومية'); // on top of the salary: shown, not taken off it
      const late = db.prepare(`SELECT COUNT(DISTINCT date(check_in_at)) AS n, COALESCE(SUM(late_minutes), 0) AS m FROM shifts
        WHERE user_id = ? AND check_in_at LIKE ? AND late_minutes > 0
          AND date(check_in_at) NOT IN (SELECT day FROM attendance_excuses WHERE user_id = ?)`).get(u.id, like, u.id);
      const absent = absences(db, u, `${month}-01`, `${month}-${String(last).padStart(2, '0')}`);
      // Automatic deductions: a day's pay = monthly salary / 30
      const rate = (u.salary || 0) / 30;
      const deduction = auto ? round2(rate * (absent.length * absDays + late.n * lateDays)) : 0;
      const due = round2((u.salary || 0) + commission - advances - paid - deduction);
      delete u.shift_start; delete u.shift_end; delete u.work_days; delete u.schedule_since; delete u.created_at;
      return { ...u, days: att.days, hours: round2(att.minutes / 60), late_count: late.n, late_minutes: late.m, absent_count: absent.length, absent_days: absent,
        deduction, sales, commission, advances, paid, allowances, due };
    }).filter((r) => !r.deleted_at || r.days || r.sales || r.advances || r.paid || r.allowances); // removed employees: only months they had activity
  }

  api.get('/payroll', perm, (req, res) => {
    const month = monthOf(req.query.month);
    const rows = sheet(month);
    const t = (k) => round2(rows.reduce((a, r) => a + (r[k] || 0), 0));
    res.json({ month, rows, totals: { salary: t('salary'), commission: t('commission'), advances: t('advances'), paid: t('paid'), allowances: t('allowances'), deduction: t('deduction'), due: t('due') } });
  });

  /** A month's attendance for one person: absent and late days, each can be excused. */
  api.get('/payroll/:userId/attendance', perm, (req, res) => {
    const month = monthOf(req.query.month);
    const row = sheet(month).find((r) => r.id === Number(req.params.userId));
    if (!row) throw notFound('الموظف غير موجود');
    const late = db.prepare(`SELECT date(check_in_at) AS day, MAX(late_minutes) AS minutes FROM shifts WHERE user_id = ? AND check_in_at LIKE ? AND late_minutes > 0 GROUP BY day ORDER BY day`)
      .all(row.id, `${month}%`);
    const excused = db.prepare('SELECT day, note FROM attendance_excuses WHERE user_id = ? AND day LIKE ? ORDER BY day').all(row.id, `${month}%`);
    res.json({ month, row, late, excused });
  });

  api.post('/payroll/:userId/excuse', perm, (req, res) => {
    const u = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.userId);
    if (!u) throw notFound('الموظف غير موجود');
    const day = String(req.body?.day || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw bad('اليوم غلط');
    if (req.body?.excused === false) db.prepare('DELETE FROM attendance_excuses WHERE user_id = ? AND day = ?').run(u.id, day);
    else db.prepare('INSERT OR REPLACE INTO attendance_excuses (user_id, day, note, by_user) VALUES (?, ?, ?, ?)').run(u.id, day, str(req.body?.note, 'السبب', { optional: true, max: 120 }), req.user.id);
    audit(db, req.user.id, 'payroll.excuse', { user: u.id, day, excused: req.body?.excused !== false });
    res.json({ ok: true });
  });

  api.put('/payroll/:userId', perm, (req, res) => {
    const u = db.prepare('SELECT id, daily_allowance FROM users WHERE id = ?').get(req.params.userId);
    if (!u) throw notFound('الموظف غير موجود');
    const b = req.body || {};
    const salary = round2(num(b.salary, 'المرتب', { min: 0, optional: true }) || 0);
    const pct = round2(num(b.commission_pct, 'نسبة العمولة', { min: 0, optional: true }) || 0);
    if (pct > 50) throw bad('نسبة العمولة كبيرة جداً');
    // Not sent: keep it; empty: back to the shop's usual amount
    const daily = b.daily_allowance === undefined ? u.daily_allowance
      : b.daily_allowance === '' || b.daily_allowance === null ? null : round2(num(b.daily_allowance, 'اليومية', { min: 0 }));
    db.prepare('UPDATE users SET salary = ?, commission_pct = ?, daily_allowance = ? WHERE id = ?').run(salary, pct, daily, u.id);
    audit(db, req.user.id, 'payroll.settings', { user: u.id, salary, commission_pct: pct });
    res.json({ ok: true });
  });

  // ---------- daily allowance (يومية): on top of the salary, paid from the drawer ----------
  const allowancePerm = requirePerm('expenses.view'); // owner and managers
  const usual = () => Number(db.prepare("SELECT value FROM settings WHERE key = 'daily_allowance'").get()?.value) || 0;
  function todayList() {
    const day = today();
    return db.prepare("SELECT id, full_name, role, daily_allowance FROM users WHERE active = 1 AND deleted_at IS NULL AND role <> 'admin' ORDER BY full_name").all().map((u) => {
      const given = db.prepare("SELECT id, amount FROM expenses WHERE employee_id = ? AND category = 'يومية' AND date(created_at) = ? ORDER BY id DESC").all(u.id, day);
      const came = db.prepare('SELECT MIN(check_in_at) AS t FROM shifts WHERE user_id = ? AND date(check_in_at) = ?').get(u.id, day).t;
      return { id: u.id, full_name: u.full_name, role: u.role, amount: u.daily_allowance ?? usual(),
        given: round2(given.reduce((a, g) => a + g.amount, 0)), given_id: given[0]?.id || null, came_at: came };
    });
  }
  api.get('/allowances/today', allowancePerm, (_req, res) => {
    const list = todayList();
    res.json({ usual: usual(), list, total: round2(list.reduce((a, u) => a + u.given, 0)) });
  });
  /** Give today's allowance to one or more employees (skips anyone who already got it today). */
  api.post('/allowances', allowancePerm, (req, res) => {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : [req.body?.user_id]).map(Number).filter(Boolean);
    if (!ids.length) throw bad('اختار الموظف');
    const list = todayList();
    const month = today().slice(0, 7);
    let count = 0, total = 0;
    for (const id of ids) {
      const u = list.find((x) => x.id === id);
      if (!u) throw notFound('الموظف غير موجود');
      if (u.given > 0) continue;
      const amount = round2(ids.length === 1 && req.body?.amount !== undefined ? num(req.body.amount, 'المبلغ', { min: 0.01 }) : u.amount);
      if (!(amount > 0)) continue;
      db.prepare("INSERT INTO expenses (category, amount, from_drawer, note, employee_id, period, user_id) VALUES ('يومية', ?, 1, ?, ?, ?, ?)")
        .run(amount, `يومية ${u.full_name}`, u.id, month, req.user.id);
      count++; total += amount;
    }
    audit(db, req.user.id, 'payroll.allowance', { ids, count, total });
    const after = todayList();
    res.status(201).json({ count, total: round2(total), usual: usual(), list: after, day_total: round2(after.reduce((a, u) => a + u.given, 0)) });
  });
  /** Undo today's allowance (a mistake). */
  api.delete('/allowances/:expenseId', allowancePerm, (req, res) => {
    const e = db.prepare("SELECT * FROM expenses WHERE id = ? AND category = 'يومية'").get(Number(req.params.expenseId));
    if (!e) throw notFound('اليومية دي مش موجودة');
    if (e.created_at.slice(0, 10) !== today()) throw bad('تقدر تلغي يومية النهارده بس — القديمة من صفحة المصروفات');
    db.prepare('DELETE FROM expenses WHERE id = ?').run(e.id);
    audit(db, req.user.id, 'payroll.allowance_undo', { expense: e.id });
    const list = todayList();
    res.json({ usual: usual(), list, total: round2(list.reduce((a, u) => a + u.given, 0)) });
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
