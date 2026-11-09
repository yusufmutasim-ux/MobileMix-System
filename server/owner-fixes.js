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
  {
    // InstaPay goes away: what was paid by InstaPay is cash. The "فيزا 850" line in the sheet was the Visa balance,
    // not an expense. Days 1–8 are brought back to the book (the InstaPay money is now part of the cash).
    id: '2026-11-no-instapay',
    run(db, adminId) {
      instapayToCash(db);
      db.prepare("DELETE FROM expenses WHERE note = 'فيزا' AND amount = 850 AND paid_with = 'card' AND from_drawer = 0").run();
      const book = FIXES.find((x) => x.id === '2026-11-month-1-8').days;
      dropAdjustments(db, Object.keys(book));
      reconcileDays(db, book, adminId);
    },
  },
  {
    // 3,825 of the Visa money was withdrawn and went to the rent; 875 Visa is left
    id: '2026-11-rent-from-visa',
    run(db, adminId) {
      const rent = db.prepare("SELECT * FROM expenses WHERE note = 'تكملة إيجار' AND amount = 13500 AND from_drawer = 0").get();
      if (rent) db.prepare('UPDATE expenses SET amount = 9675 WHERE id = ?').run(rent.id);
      db.prepare(`INSERT INTO expenses (category, amount, from_drawer, paid_with, note, user_id, period, created_at)
                  VALUES ('إيجار', 3825, 0, 'card', 'تكملة إيجار (اتسحبت من الفيزا)', ?, '2026-11', ?)`)
        .run(adminId, rent?.created_at || '2026-11-09 12:00:00');
    },
  },
  {
    // The owner counted the month's money (today included): 1,100 cash in hand and 875 still on the Visa machine
    id: '2026-11-counted-1100-875',
    run(db, adminId) { matchMonthMoney(db, adminId, { from: '2026-11-01', cash: 1100, card: 875 }); },
  },
  {
    // The owner's final word on the month: days 1–8 brought in 16,750 in all (cash and Visa together) and the
    // month's expenses are 16,350; everything else is just the days' own money (today's included).
    id: '2026-11-book-total',
    run(db, adminId) {
      // Undo the "counted 1,100 / 875" adjustment
      for (const m of db.prepare("SELECT * FROM cash_moves WHERE note LIKE 'تعديل — الكاش اللي معايا%'").all()) {
        db.prepare('DELETE FROM cash_moves WHERE id = ?').run(m.id);
        adjustClosing(db, m.created_at, -m.amount, 'moves_in');
      }
      db.prepare("DELETE FROM expenses WHERE note LIKE 'تعديل — الكاش اللي معايا%' OR note LIKE 'تعديل — الفيزا على الماكينة%'").run();
      // Each day's book figure is cash + Visa: the cash part is the book minus that day's Visa
      const book = FIXES.find((x) => x.id === '2026-11-month-1-8').days;
      dropAdjustments(db, Object.keys(book));
      const cardOf = (day) => Number(db.prepare(`SELECT SUM(a) AS v FROM (SELECT MIN(paid, total) AS a FROM sales WHERE payment_method = 'card' AND bday(created_at) = ?
          UNION ALL SELECT amount FROM sale_payments WHERE method = 'card' AND bday(created_at) = ?
          UNION ALL SELECT amount FROM repair_payments WHERE method = 'card' AND bday(created_at) = ?)`).get(day, day, day).v || 0);
      reconcileDays(db, Object.fromEntries(Object.entries(book).map(([d, t]) => [d, round2(t - cardOf(d))])), adminId);
      // The sheet's expenses come to 16,350: the 850 line is one of them (paid in cash)
      if (!db.prepare("SELECT 1 FROM expenses WHERE note = 'فيزا' AND amount = 850").get()) {
        db.prepare(`INSERT INTO expenses (category, amount, from_drawer, paid_with, note, user_id, period, created_at)
                    VALUES ('أخرى', 850, 0, 'cash', 'فيزا', ?, '2026-11', '2026-11-09 12:00:00')`).run(adminId);
      }
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

/** Bring each shop day's cash to the owner's figure with a "تعديل" cash entry (and recount the closing it falls in). */
function reconcileDays(db, days, adminId, report = []) {
  for (const [day, target] of Object.entries(days)) {
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
      .run(kind, Math.abs(diff), `تعديل — حسب الدفتر ${target}`, adminId, at);
    adjustClosing(db, at, diff, kind === 'in' ? 'moves_in' : 'moves_out');
    report.push({ day, system: have, book: target, diff });
  }
  return report;
}

/** Remove the "تعديل" entries of these days (their closings are recounted back). */
function dropAdjustments(db, days) {
  for (const day of days) {
    for (const m of db.prepare("SELECT * FROM cash_moves WHERE note LIKE 'تعديل — حسب الدفتر%' AND bday(created_at) = ?").all(day)) {
      db.prepare('DELETE FROM cash_moves WHERE id = ?').run(m.id);
      adjustClosing(db, m.created_at, m.kind === 'in' ? -m.amount : m.amount, m.kind === 'in' ? 'moves_in' : 'moves_out');
    }
  }
}

/** Everything paid by InstaPay becomes cash (the drawer and any closing it fell in follow). */
function instapayToCash(db) {
  for (const s of db.prepare("SELECT * FROM sales WHERE payment_method = 'instapay'").all()) {
    adjustClosing(db, s.created_at, Math.min(s.paid, s.total), 'sales');
    for (const r of db.prepare('SELECT * FROM returns WHERE sale_id = ?').all(s.id)) adjustClosing(db, r.created_at, -(r.cash_out ?? r.amount), 'refunds');
    db.prepare("UPDATE sales SET payment_method = 'cash' WHERE id = ?").run(s.id);
  }
  for (const p of db.prepare("SELECT * FROM sale_payments WHERE method = 'instapay'").all()) {
    adjustClosing(db, p.created_at, p.amount, 'collections');
    db.prepare("UPDATE sale_payments SET method = 'cash' WHERE id = ?").run(p.id);
  }
  for (const p of db.prepare("SELECT * FROM repair_payments WHERE method = 'instapay'").all()) {
    adjustClosing(db, p.created_at, p.amount, 'repairs');
    db.prepare("UPDATE repair_payments SET method = 'cash' WHERE id = ?").run(p.id);
  }
  db.prepare("UPDATE expenses SET paid_with = 'cash' WHERE paid_with = 'instapay'").run();
}

/**
 * Make the report's "money with you" equal what the owner counted, from `from` up to today: the difference
 * is added as "تعديل" (an expense from the month's money if there's less than the system says,
 * cash put in if there's more; for Visa, an adjustment out of the Visa money).
 */
function matchMonthMoney(db, adminId, { from, cash, card }) {
  const { today } = require('./util');
  const to = today();
  const one = (sql, ...a) => Number(db.prepare(sql).get(...a).v || 0);
  const days = db.prepare(`SELECT DISTINCT d FROM (SELECT bday(created_at) AS d FROM sales UNION SELECT bday(created_at) FROM sale_payments
      UNION SELECT bday(created_at) FROM repair_payments UNION SELECT bday(created_at) FROM expenses UNION SELECT bday(created_at) FROM cash_moves)
      WHERE d BETWEEN ? AND ?`).all(from, to).map((r) => r.d);
  const adjust = (day) => one("SELECT SUM(CASE WHEN kind = 'in' THEN amount ELSE -amount END) AS v FROM cash_moves WHERE note LIKE 'تعديل%' AND bday(created_at) = ?", day);
  const cashIn = round2(days.reduce((a, d) => a + dayCash(db, d) + adjust(d), 0));
  const cashOut = one("SELECT SUM(amount) AS v FROM expenses WHERE from_drawer = 0 AND COALESCE(paid_with, 'cash') = 'cash' AND bday(created_at) BETWEEN ? AND ?", from, to);
  const cardIn = one(`SELECT SUM(a) AS v FROM (SELECT MIN(paid, total) AS a FROM sales WHERE payment_method = 'card' AND bday(created_at) BETWEEN ? AND ?
      UNION ALL SELECT amount FROM sale_payments WHERE method = 'card' AND bday(created_at) BETWEEN ? AND ?
      UNION ALL SELECT amount FROM repair_payments WHERE method = 'card' AND bday(created_at) BETWEEN ? AND ?)`, from, to, from, to, from, to);
  const cardOut = one("SELECT SUM(amount) AS v FROM expenses WHERE from_drawer = 0 AND paid_with = 'card' AND bday(created_at) BETWEEN ? AND ?", from, to);
  const at = db.prepare("SELECT datetime('now','localtime') AS t").get().t;
  const out = { cash_system: round2(cashIn - cashOut), card_system: round2(cardIn - cardOut) };
  const cashDiff = round2(out.cash_system - cash);
  if (cashDiff > 0.5) {
    db.prepare(`INSERT INTO expenses (category, amount, from_drawer, paid_with, note, user_id, period, created_at)
                VALUES ('تعديل', ?, 0, 'cash', ?, ?, ?, ?)`).run(cashDiff, `تعديل — الكاش اللي معايا ${cash}`, adminId, at.slice(0, 7), at);
  } else if (cashDiff < -0.5) {
    db.prepare('INSERT INTO cash_moves (kind, amount, note, user_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('in', -cashDiff, `تعديل — الكاش اللي معايا ${cash}`, adminId, at);
  }
  const cardDiff = round2(out.card_system - card);
  if (Math.abs(cardDiff) > 0.5) {
    // More on the books than on the machine: out of the Visa money; less: a negative entry brings it up
    db.prepare(`INSERT INTO expenses (category, amount, from_drawer, paid_with, note, user_id, period, created_at)
                VALUES ('تعديل', ?, 0, 'card', ?, ?, ?, ?)`).run(cardDiff, `تعديل — الفيزا على الماكينة ${card}`, adminId, at.slice(0, 7), at);
  }
  return { ...out, cash_diff: cashDiff, card_diff: cardDiff };
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
      reconcileDays(db, f.days || {}, admin.id, report);
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

module.exports = { applyOwnerFixes, dayCash, reconcileDays, instapayToCash, matchMonthMoney, FIXES };
