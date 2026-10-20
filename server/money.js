'use strict';
const { round2, today: todayStr } = require('./util');

/*
 * Money rules shared by sales, customers, the drawer and reports.
 *
 * A sale's money:
 *   net       = total − returned_total            (what the customer finally owes for the goods)
 *   received  = MIN(paid, total) + later payments  (paid above the total was change handed back)
 *   refunded  = cash handed back on returns
 *   due       = net − (received − refunded)        (never below zero)
 *
 * Cash in the drawer between two countings:
 *   + what was left in the drawer at the last count
 *   + cash sales (and the cash down payment of credit/installment sales)
 *   + cash collected later from customers
 *   + cash repair payments (refunds are negative)
 *   − cash handed back on returns
 *   − expenses and supplier payments paid from the drawer
 *   ± money the owner put in / took out
 */

const CASH_SALE_METHODS = ['cash', 'installment'];
const IN_CASH = `('${CASH_SALE_METHODS.join("','")}')`;

/** Digits only, so "010 1234-5678" and "01012345678" are the same customer. */
const cleanPhone = (p) => String(p || '').replace(/\D/g, '');

const RECEIVED_SQL = `(MIN(s.paid, s.total) + COALESCE((SELECT SUM(amount) FROM sale_payments WHERE sale_id = s.id), 0))`;
const REFUNDED_SQL = `COALESCE((SELECT SUM(COALESCE(cash_out, amount)) FROM returns WHERE sale_id = s.id), 0)`;
/** Amount still owed on sale `s` (SQL expression). */
const DUE_SQL = `MAX(0, ROUND((s.total - s.returned_total) - (${RECEIVED_SQL} - ${REFUNDED_SQL}), 2))`;

function saleMoney(db, saleId) {
  const r = db.prepare(`SELECT s.total, s.returned_total, ${RECEIVED_SQL} AS received, ${REFUNDED_SQL} AS refunded, ${DUE_SQL} AS due
                        FROM sales s WHERE s.id = ?`).get(saleId);
  if (!r) return null;
  return { net: round2(r.total - r.returned_total), received: round2(r.received), refunded: round2(r.refunded), due: round2(r.due) };
}

/**
 * Installments with how much of each is paid. Payments (down payment excluded) fill the
 * installments in order, so the earliest ones are paid first.
 */
function installmentsOf(db, saleId) {
  const plan = db.prepare('SELECT * FROM sale_installments WHERE sale_id = ? ORDER BY seq').all(saleId);
  if (!plan.length) return [];
  const m = saleMoney(db, saleId);
  const planned = plan.reduce((s, i) => s + i.amount, 0);
  // Whatever is no longer owed (paid or returned) counts against the plan from the first installment
  let covered = Math.max(0, planned - m.due);
  const today = todayStr();
  return plan.map((i) => {
    const paid = Math.min(i.amount, covered);
    covered -= paid;
    const left = round2(i.amount - paid);
    return { ...i, paid: round2(paid), left, state: left <= 0.004 ? 'paid' : i.due_date < today ? 'late' : 'open' };
  });
}

/** Where the last drawer count ended, and what's expected in the drawer now. */
function drawerNow(db) {
  const last = db.prepare('SELECT * FROM drawer_closings ORDER BY id DESC LIMIT 1').get();
  const from = last ? last.closed_at : '0000-00-00 00:00:00';
  const to = db.prepare("SELECT datetime('now','localtime') AS t").get().t;
  const opening = last ? last.left_in_drawer : 0;
  const one = (sql) => round2(db.prepare(sql).get(from, to).v || 0);
  const range = 'created_at > ? AND created_at <= ?';

  const parts = {
    sales: one(`SELECT SUM(MIN(paid, total)) AS v FROM sales WHERE payment_method IN ${IN_CASH} AND ${range}`),
    collections: one(`SELECT SUM(amount) AS v FROM sale_payments WHERE method = 'cash' AND ${range}`),
    repairs: one(`SELECT SUM(amount) AS v FROM repair_payments WHERE method = 'cash' AND ${range}`),
    refunds: -one(`SELECT SUM(COALESCE(r.cash_out, r.amount)) AS v FROM returns r JOIN sales s ON s.id = r.sale_id
                  WHERE s.payment_method IN ${IN_CASH} AND r.created_at > ? AND r.created_at <= ?`),
    expenses: -one(`SELECT SUM(amount) AS v FROM expenses WHERE from_drawer = 1 AND ${range}`),
    suppliers: -one(`SELECT SUM(amount) AS v FROM supplier_payments WHERE from_drawer = 1 AND ${range}`),
    moves_in: one(`SELECT SUM(amount) AS v FROM cash_moves WHERE kind = 'in' AND ${range}`),
    moves_out: -one(`SELECT SUM(amount) AS v FROM cash_moves WHERE kind = 'out' AND ${range}`),
  };
  const expected = round2(opening + Object.values(parts).reduce((a, b) => a + b, 0));
  return { from: last ? from : null, to, opening: round2(opening), parts, expected, last: last || null };
}

/** Save the customer (by phone) the first time they buy or bring a device in; keep their latest name. */
function rememberCustomer(db, name, phone) {
  const p = cleanPhone(phone);
  if (p.length < 6) return null;
  const n = String(name || '').trim();
  const found = db.prepare('SELECT * FROM customers WHERE phone = ?').get(p);
  if (found) {
    if (n && n !== found.name) db.prepare('UPDATE customers SET name = ? WHERE id = ?').run(n, found.id);
    return found.id;
  }
  return Number(db.prepare('INSERT INTO customers (name, phone) VALUES (?, ?)').run(n || 'عميل', p).lastInsertRowid);
}

/** Installments past their date and not fully paid. */
function lateInstallments(db) {
  const t = todayStr();
  const sales = db.prepare(`SELECT s.id, s.invoice_no, s.customer_name, digits(s.customer_phone) AS phone FROM sales s
    WHERE EXISTS (SELECT 1 FROM sale_installments i WHERE i.sale_id = s.id AND i.due_date < ?) AND ${DUE_SQL} > 0`).all(t);
  return sales.flatMap((s) => installmentsOf(db, s.id).filter((i) => i.state === 'late')
    .map((i) => ({ ...i, invoice_no: s.invoice_no, customer_name: s.customer_name, phone: s.phone })));
}

module.exports = { lateInstallments, CASH_SALE_METHODS, IN_CASH, cleanPhone, RECEIVED_SQL, REFUNDED_SQL, DUE_SQL, saleMoney, installmentsOf, drawerNow, rememberCustomer };
