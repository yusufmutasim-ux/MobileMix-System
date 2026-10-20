'use strict';
const { requirePerm, can } = require('../auth');
const { tx } = require('../db');
const { bad, notFound, num, str, round2, audit, getSettings, today } = require('../util');
const { DUE_SQL, installmentsOf, cleanPhone, lateInstallments } = require('../money');
const { PAYMENT_METHODS } = require('./sales');
const { requireOpenShift } = require('./shifts');

const fmt = (v, cur) => `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${cur || 'ج.م'}`;

/** Customers: everything they bought or fixed with us, what they owe, and collecting it. */
module.exports = function customerRoutes(api, db) {
  const view = requirePerm('customers.view');
  const SALES_OF = 'digits(s.customer_phone) = c.phone';

  api.get('/customers', view, (req, res) => {
    const q = String(req.query.q || '').trim();
    const where = [];
    const params = [];
    if (q) {
      where.push('(c.name LIKE ? OR c.phone LIKE ?)');
      params.push(`%${q}%`, `%${cleanPhone(q) || q}%`);
    }
    const rows = db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM sales s WHERE ${SALES_OF}) AS sales_count,
        (SELECT COALESCE(SUM(s.total - s.returned_total), 0) FROM sales s WHERE ${SALES_OF}) AS sales_total,
        (SELECT COUNT(*) FROM repairs r WHERE digits(r.customer_phone) = c.phone) AS repairs_count,
        (SELECT COALESCE(SUM(${DUE_SQL}), 0) FROM sales s WHERE ${SALES_OF}) AS due,
        MAX(COALESCE((SELECT MAX(s.created_at) FROM sales s WHERE ${SALES_OF}), ''),
            COALESCE((SELECT MAX(r.created_at) FROM repairs r WHERE digits(r.customer_phone) = c.phone), '')) AS last_visit
      FROM customers c ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY last_visit DESC, c.id DESC LIMIT 500`).all(...params);
    rows.forEach((r) => { r.due = round2(r.due); r.sales_total = round2(r.sales_total); });
    const late = lateInstallments(db);
    const lateBy = new Map();
    for (const l of late) lateBy.set(l.phone, (lateBy.get(l.phone) || 0) + l.left);
    rows.forEach((r) => { r.late = round2(lateBy.get(r.phone) || 0); });
    const filter = req.query.filter;
    const out = filter === 'owing' ? rows.filter((r) => r.due > 0) : filter === 'late' ? rows.filter((r) => r.late > 0) : rows;
    res.json({
      rows: out,
      totals: { customers: rows.length, owing: rows.filter((r) => r.due > 0).length, due: round2(rows.reduce((s, r) => s + r.due, 0)), late: round2(late.reduce((s, l) => s + l.left, 0)) },
    });
  });

  const readCustomer = (b) => {
    const phone = cleanPhone(b.phone);
    if (phone.length < 8) throw bad('رقم التليفون غير صحيح');
    return { name: str(b.name, 'اسم العميل', { max: 80 }), phone, notes: str(b.notes, 'الملاحظات', { optional: true, max: 500 }) };
  };

  api.post('/customers', view, (req, res) => {
    const f = readCustomer(req.body || {});
    if (db.prepare('SELECT 1 FROM customers WHERE phone = ?').get(f.phone)) throw bad('العميل ده متسجل قبل كده بنفس الرقم');
    const r = db.prepare('INSERT INTO customers (name, phone, notes) VALUES (?, ?, ?)').run(f.name, f.phone, f.notes);
    res.status(201).json(db.prepare('SELECT * FROM customers WHERE id = ?').get(r.lastInsertRowid));
  });

  api.put('/customers/:id', view, (req, res) => {
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
    if (!c) throw notFound('العميل غير موجود');
    const f = readCustomer({ ...c, ...req.body });
    if (f.phone !== c.phone && db.prepare('SELECT 1 FROM customers WHERE phone = ?').get(f.phone)) throw bad('في عميل تاني بنفس الرقم');
    tx(db, () => {
      db.prepare('UPDATE customers SET name = ?, phone = ?, notes = ? WHERE id = ?').run(f.name, f.phone, f.notes, c.id);
      // Keep their old invoices and repairs on the new number
      if (f.phone !== c.phone) {
        db.prepare('UPDATE sales SET customer_phone = ? WHERE digits(customer_phone) = ?').run(f.phone, c.phone);
        db.prepare('UPDATE repairs SET customer_phone = ? WHERE digits(customer_phone) = ?').run(f.phone, c.phone);
      }
    });
    res.json(db.prepare('SELECT * FROM customers WHERE id = ?').get(c.id));
  });

  api.get('/customers/:id', view, (req, res) => {
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
    if (!c) throw notFound('العميل غير موجود');
    c.sales = db.prepare(`
      SELECT s.id, s.invoice_no, s.total, s.returned_total, s.status, s.payment_method, s.created_at, ${DUE_SQL} AS due,
             (SELECT GROUP_CONCAT(name, '، ') FROM sale_items WHERE sale_id = s.id) AS items
      FROM sales s WHERE digits(s.customer_phone) = ? ORDER BY s.id DESC LIMIT 300`).all(c.phone);
    if (!can(req.user, 'sales.view_all')) {
      // Cashiers see the customer's balance, and only their own invoices in detail
      const mine = new Set(db.prepare('SELECT id FROM sales WHERE user_id = ? AND digits(customer_phone) = ?').all(req.user.id, c.phone).map((r) => r.id));
      c.sales.forEach((s) => { if (!mine.has(s.id) && s.due <= 0) s.hidden = true; });
      c.sales = c.sales.filter((s) => !s.hidden);
    }
    c.repairs = can(req.user, 'repairs.view') ? db.prepare(`
      SELECT id, ticket_no, device, problem, status, price, created_at, delivered_at FROM repairs
      WHERE digits(customer_phone) = ? ORDER BY id DESC LIMIT 200`).all(c.phone) : [];
    c.payments = db.prepare(`
      SELECT p.*, s.invoice_no, u.full_name AS user_name FROM sale_payments p JOIN sales s ON s.id = p.sale_id
      LEFT JOIN users u ON u.id = p.user_id WHERE digits(s.customer_phone) = ? ORDER BY p.id DESC LIMIT 200`).all(c.phone);
    c.installments = c.sales.filter((s) => s.due > 0)
      .flatMap((s) => installmentsOf(db, s.id).map((i) => ({ ...i, invoice_no: s.invoice_no })))
      .sort((a, b) => a.due_date.localeCompare(b.due_date));
    c.due = round2(c.sales.reduce((a, s) => a + s.due, 0));
    c.total_bought = round2(c.sales.reduce((a, s) => a + s.total - s.returned_total, 0));
    res.json(c);
  });

  /** One payment from the customer, spread over what they owe — oldest invoice first. */
  api.post('/customers/:id/pay', requirePerm('customers.pay'), (req, res) => {
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
    if (!c) throw notFound('العميل غير موجود');
    requireOpenShift(db, req.user);
    const b = req.body || {};
    const method = PAYMENT_METHODS.includes(b.method) && b.method !== 'installment' ? b.method : 'cash';
    let amount = round2(num(b.amount, 'المبلغ', { min: 0.01 }));
    const note = str(b.note, 'الملاحظة', { optional: true, max: 200 });
    const paidTo = tx(db, () => {
      const owing = db.prepare(`SELECT s.id, s.invoice_no, ${DUE_SQL} AS due FROM sales s
                                WHERE digits(s.customer_phone) = ? AND ${DUE_SQL} > 0 ORDER BY s.id`).all(c.phone);
      const totalDue = round2(owing.reduce((a, s) => a + s.due, 0));
      if (!totalDue) throw bad('العميل مش عليه فلوس');
      if (amount > totalDue + 0.004) throw bad(`كل اللي على العميل ${totalDue} بس`);
      const out = [];
      const add = db.prepare('INSERT INTO sale_payments (sale_id, amount, method, note, user_id) VALUES (?, ?, ?, ?, ?)');
      for (const s of owing) {
        if (amount <= 0.004) break;
        const part = round2(Math.min(amount, s.due));
        add.run(s.id, part, method, note, req.user.id);
        out.push({ invoice_no: s.invoice_no, amount: part });
        amount = round2(amount - part);
      }
      return out;
    });
    const total = round2(paidTo.reduce((a, p) => a + p.amount, 0));
    const left = round2(db.prepare(`SELECT COALESCE(SUM(${DUE_SQL}), 0) AS d FROM sales s WHERE digits(s.customer_phone) = ?`).get(c.phone).d);
    audit(db, req.user.id, 'customer.payment', { customer: c.name, amount: total, method });
    const cur = getSettings(db).currency;
    req.app.locals.notifier.notify({
      type: 'customer_payment', actorId: req.user.id, url: `#/customers/${c.id}`,
      title: `تحصيل — ${fmt(total, cur)}`,
      body: `${req.user.full_name} • ${c.name}${left > 0 ? ` • باقي عليه ${fmt(left, cur)}` : ' • خلّص كل اللي عليه ✅'}`,
    });
    res.status(201).json({ ok: true, paid: total, invoices: paidTo, left });
  });

  api.get('/installments', view, (req, res) => {
    const t = today();
    const soon = new Date(`${t}T12:00:00`);
    soon.setDate(soon.getDate() + 7);
    const until = soon.toISOString().slice(0, 10);
    const sales = db.prepare(`SELECT s.id, s.invoice_no, s.customer_name, s.customer_phone FROM sales s
      WHERE EXISTS (SELECT 1 FROM sale_installments i WHERE i.sale_id = s.id AND i.due_date <= ?) AND ${DUE_SQL} > 0`).all(until);
    const all = sales.flatMap((s) => installmentsOf(db, s.id).filter((i) => i.state !== 'paid' && i.due_date <= until)
      .map((i) => ({ ...i, invoice_no: s.invoice_no, customer_name: s.customer_name, customer_phone: s.customer_phone,
        customer_id: db.prepare('SELECT id FROM customers WHERE phone = ?').get(cleanPhone(s.customer_phone))?.id ?? null })));
    all.sort((a, b) => a.due_date.localeCompare(b.due_date));
    res.json({ late: all.filter((i) => i.state === 'late'), upcoming: all.filter((i) => i.state === 'open') });
  });

};
