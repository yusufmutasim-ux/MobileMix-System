'use strict';
/**
 * Corrections the owner asked for, from their own books. Each runs once on start (remembered in settings).
 *
 * Month reconciliation: for each shop day, the cash the day brought in (cash sales and collections, minus
 * cash refunds and what was paid from the drawer) is made equal to the owner's figure by adding a cash
 * entry called "تعديل" on that day; a drawer closing that day falls in is recounted. Month expenses paid
 * outside the drawer are added too.
 */
const { IN_CASH, adjustClosing } = require('./money');
const { shopDayEnd } = require('./util');

const FIXES = [
  {
    // The owner doesn't use customers / installments, purchases or stocktake: hide them (Settings → الأقسام brings them back)
    id: '2026-11-simple-modules',
    settings: { hidden_modules: 'customers,purchases,stocktake' },
  },
  {
    id: '2026-11-month-1-8',
    // الكاش في الدرج آخر كل يوم (from the owner's sheet)
    days: {
      '2026-11-01': 1200, '2026-11-02': 3050, '2026-11-03': 1150, '2026-11-04': 850,
      '2026-11-05': 3400, '2026-11-06': 1700, '2026-11-07': 3150, '2026-11-08': 2250,
    },
    // Paid from the month's money, not from the drawer
    expenses: [
      { category: 'إيجار', amount: 8050, note: 'تكملة إيجار', at: '2026-11-08 12:00:00' },
      { category: 'أخرى', amount: 300, note: 'محمد عزت', at: '2026-11-08 12:00:00' },
    ],
  },
  {
    // The month's expenses as in the owner's sheet: the rent is 13,500 (not 8,050) plus 1,100; the Visa one
    // was paid from the card money (it stays out of the cash); the rest from the month's cash
    id: '2026-11-month-expenses-2',
    run(db, adminId) {
      const rent = db.prepare("SELECT id FROM expenses WHERE note = 'تكملة إيجار' AND amount = 8050 AND from_drawer = 0").get();
      if (rent) db.prepare('UPDATE expenses SET amount = 13500 WHERE id = ?').run(rent.id);
      const add = db.prepare(`INSERT INTO expenses (category, amount, from_drawer, paid_with, note, user_id, period, created_at)
                              VALUES (?, ?, 0, ?, ?, ?, '2026-11', '2026-11-09 12:00:00')`);
      if (!rent) add.run('إيجار', 13500, 'cash', 'تكملة إيجار', adminId);
      if (!db.prepare("SELECT 1 FROM expenses WHERE note = 'محمد عزت' AND amount = 300").get()) add.run('أخرى', 300, 'cash', 'محمد عزت', adminId);
      add.run('إيجار', 1100, 'cash', 'تكمله ايجار', adminId);
      add.run('أخرى', 600, 'cash', 'وصلات vidvie', adminId);
      add.run('أخرى', 850, 'card', 'فيزا', adminId);
    },
  },
];

const round2 = (v) => Math.round(v * 100) / 100;

/** The cash a shop day brought in, net of what was paid out of the drawer (cash put in / taken out left aside). */
function dayCash(db, day) {
  const one = (sql, ...a) => Number(db.prepare(sql).get(...a).v || 0);
  return round2(
    one(`SELECT SUM(MIN(paid, total)) AS v FROM sales WHERE payment_method IN ${IN_CASH} AND bday(created_at) = ?`, day)
    + one("SELECT SUM(amount) AS v FROM sale_payments WHERE method = 'cash' AND bday(created_at) = ?", day)
    + one("SELECT SUM(amount) AS v FROM repair_payments WHERE method = 'cash' AND bday(created_at) = ?", day)
    - one(`SELECT SUM(COALESCE(r.cash_out, r.amount)) AS v FROM returns r JOIN sales s ON s.id = r.sale_id
           WHERE s.payment_method IN ${IN_CASH} AND bday(r.created_at) = ?`, day)
    - one('SELECT SUM(amount) AS v FROM expenses WHERE from_drawer = 1 AND bday(created_at) = ?', day)
    - one('SELECT SUM(amount) AS v FROM supplier_payments WHERE from_drawer = 1 AND bday(created_at) = ?', day),
  );
}

function applyOwnerFixes(db, fixes = FIXES) {
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
  if (!admin) return [];
  const report = [];
  for (const f of fixes) {
    const flag = `fix_${f.id}`;
    if (db.prepare('SELECT 1 FROM settings WHERE key = ?').get(flag)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const [day, target] of Object.entries(f.days || {})) {
        const have = dayCash(db, day);
        const diff = round2(target - have);
        if (Math.abs(diff) < 0.5) continue;
        // Just before that day's own drawer closing if it was closed that day, else late that day
        const close = db.prepare(`SELECT closed_at, opened_at FROM drawer_closings WHERE bday(closed_at) = ? AND closed_at <= ?
                                  ORDER BY closed_at DESC LIMIT 1`).get(day, shopDayEnd(day));
        let at = `${day} 23:59:00`;
        if (close) {
          const before = db.prepare("SELECT datetime(?, '-1 second') AS t").get(close.closed_at).t;
          if (!close.opened_at || before > close.opened_at) at = before;
        }
        const kind = diff > 0 ? 'in' : 'out';
        db.prepare('INSERT INTO cash_moves (kind, amount, note, user_id, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(kind, Math.abs(diff), `تعديل — حسب الدفتر ${target}`, admin.id, at);
        adjustClosing(db, at, diff, kind === 'in' ? 'moves_in' : 'moves_out');
        report.push({ day, system: have, book: target, diff });
      }
      if (f.run) f.run(db, admin.id);
      for (const [k, v] of Object.entries(f.settings || {})) {
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v);
      }
      for (const e of f.expenses || []) {
        db.prepare('INSERT INTO expenses (category, amount, from_drawer, note, user_id, period, created_at) VALUES (?, ?, 0, ?, ?, ?, ?)')
          .run(e.category, e.amount, e.note, admin.id, e.at.slice(0, 7), e.at);
      }
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(flag, JSON.stringify({ at: new Date().toISOString(), report }));
      db.prepare('INSERT INTO audit_log (user_id, action, details) VALUES (?, ?, ?)').run(admin.id, 'owner.fix', JSON.stringify({ id: f.id, report }));
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      console.error(`owner fix ${f.id} failed:`, e.message);
    }
  }
  return report;
}

module.exports = { applyOwnerFixes, dayCash, FIXES };
