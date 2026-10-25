'use strict';
const { tx } = require('../db');
const { requirePerm, can } = require('../auth');
const { bad, notFound, num, str, round2, pad, audit, getSettings, dateRange } = require('../util');
const { requireOpenShift } = require('./shifts');
const { saleMoney, installmentsOf, rememberCustomer, DUE_SQL } = require('../money');
const { today } = require('../util');

const PAY_AR = { cash: 'كاش', card: 'فيزا', wallet: 'محفظة', instapay: 'InstaPay', installment: 'تقسيط' };
const fmtMoney = (v, cur) => `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${cur || 'ج.م'}`;

const PAYMENT_METHODS = ['cash', 'card', 'wallet', 'instapay', 'installment'];

module.exports = function salesRoutes(api, db) {
  const sell = requirePerm('sales.create');

  const movement = db.prepare(`INSERT INTO stock_movements (product_id, type, qty_change, qty_after, ref_id, note, user_id)
                               VALUES (?, ?, ?, ?, ?, ?, ?)`);

  // ---------- create sale ----------
  api.post('/sales', sell, (req, res) => {
    const body = req.body || {};
    if (!Array.isArray(body.items) || body.items.length === 0) throw bad('الفاتورة فاضية — ضيف منتجات');
    if (body.items.length > 200) throw bad('عدد الأصناف كبير جداً');
    const paymentMethod = PAYMENT_METHODS.includes(body.payment_method) ? body.payment_method : 'cash';
    // Every checkout carries the device's own id for it: if the same sale arrives twice
    // (the answer got lost, or it was waiting with no internet) it's saved once.
    const clientRef = body.client_ref ? str(body.client_ref, 'رقم العملية', { max: 64 }) : null;
    if (clientRef) {
      const same = db.prepare('SELECT id FROM sales WHERE client_ref = ?').get(clientRef);
      if (same) return res.json(loadSale(same.id, req.user));
    }
    // When it was sold, for a sale made with no internet (shown on the invoice; the money counts from when it arrives)
    const offlineAt = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(body.offline_at || '')) ? body.offline_at : null;
    const settings = getSettings(db);
    requireOpenShift(db, req.user);

    const saleId = tx(db, () => {
      const lines = [];
      const usedSerials = new Set();
      let listTotal = 0; // at the product's official price

      for (const [i, raw] of body.items.entries()) {
        const label = `الصنف رقم ${i + 1}`;
        const p = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(num(raw.product_id, label, { int: true }));
        if (!p) throw bad(`${label}: المنتج غير موجود`);
        const unitPrice = raw.unit_price === undefined || raw.unit_price === null || raw.unit_price === ''
          ? p.sell_price : num(raw.unit_price, `سعر ${p.name}`, { min: 0 });

        let qty, serial = null, unitCost = p.cost_price;
        if (p.has_serial) {
          serial = str(raw.serial, `IMEI ${p.name}`, { max: 40 });
          if (usedSerials.has(serial)) throw bad(`الـ IMEI ${serial} متكرر في الفاتورة`);
          usedSerials.add(serial);
          const s = db.prepare('SELECT * FROM serials WHERE serial = ? AND product_id = ?').get(serial, p.id);
          if (!s) throw bad(`الـ IMEI ${serial} مش متسجل على ${p.name}`);
          if (s.status !== 'in_stock') throw bad(`الجهاز ${serial} مش في المخزن`);
          qty = 1;
          if (s.cost_price != null) unitCost = s.cost_price;
        } else {
          qty = num(raw.qty, `كمية ${p.name}`, { min: 1, int: true });
        }
        listTotal += p.sell_price * qty;
        lines.push({ p, qty, serial, unitPrice: round2(unitPrice), unitCost, lineTotal: round2(unitPrice * qty) });
      }

      // Same product may appear on several lines — check total stock per product
      const need = new Map();
      for (const l of lines) need.set(l.p.id, (need.get(l.p.id) || 0) + l.qty);
      // A sale made with no internet already happened (the goods left the shop), so it isn't refused
      // for stock: the count goes under zero and shows up for a stock check instead.
      if (!offlineAt) {
        for (const l of lines) {
          if (need.get(l.p.id) > l.p.qty) throw bad(`الكمية المتاحة من "${l.p.name}" هي ${l.p.qty} بس`);
        }
      }

      const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
      const discount = round2(num(body.discount, 'الخصم', { optional: true, min: 0 }) || 0);
      if (discount > subtotal) throw bad('الخصم أكبر من إجمالي الفاتورة');
      const total = round2(subtotal - discount);

      if (!can(req.user, 'sales.view_all')) {
        const maxPct = Number(settings.cashier_max_discount) || 0;
        const givenAway = listTotal - total;
        if (givenAway > (listTotal * maxPct) / 100 + 0.01) {
          throw bad(`أقصى خصم مسموح للكاشير ${maxPct}% — اطلب من المدير`);
        }
      }

      const paid = round2(num(body.paid, 'المدفوع', { optional: true, min: 0 }) ?? total);
      const due = round2(total - Math.min(paid, total));
      const customerName = str(body.customer_name, 'اسم العميل', { optional: true, max: 80 });
      const customerPhone = str(body.customer_phone, 'تليفون العميل', { optional: true, max: 30 });
      if (due > 0.004 && (!customerName || String(customerPhone || '').replace(/\D/g, '').length < 8)) {
        throw bad('في فلوس متبقية على العميل — لازم تكتب اسمه وتليفونه عشان تتسجل عليه');
      }
      const plan = due > 0.004 ? installmentPlan(body.installments, due, offlineAt ? offlineAt.slice(0, 10) : today()) : [];
      const r = db.prepare(`INSERT INTO sales (user_id, customer_name, customer_phone, subtotal, discount, total, paid, payment_method, notes, client_ref, offline_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        req.user.id,
        customerName,
        customerPhone,
        subtotal, discount, total, paid, paymentMethod,
        str(body.notes, 'الملاحظات', { optional: true, max: 300 }),
        clientRef, offlineAt,
      );
      const saleId = Number(r.lastInsertRowid);
      const invoiceNo = `${settings.invoice_prefix || ''}${pad(saleId, 6)}`;
      db.prepare('UPDATE sales SET invoice_no = ? WHERE id = ?').run(invoiceNo, saleId);

      const addItem = db.prepare(`INSERT INTO sale_items (sale_id, product_id, name, serial, qty, unit_price, unit_cost, line_total, warranty_days)
                                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const l of lines) {
        addItem.run(saleId, l.p.id, l.p.name, l.serial, l.qty, l.unitPrice, l.unitCost, l.lineTotal, l.p.warranty_days || 0);
        const { qty: current } = db.prepare('SELECT qty FROM products WHERE id = ?').get(l.p.id);
        const after = current - l.qty;
        db.prepare("UPDATE products SET qty = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(after, l.p.id);
        if (l.serial) db.prepare("UPDATE serials SET status = 'sold', sale_id = ? WHERE serial = ?").run(saleId, l.serial);
        movement.run(l.p.id, 'sale', -l.qty, after, saleId, invoiceNo, req.user.id);
      }
      const addInst = db.prepare('INSERT INTO sale_installments (sale_id, seq, due_date, amount) VALUES (?, ?, ?, ?)');
      plan.forEach((p, i) => addInst.run(saleId, i + 1, p.due_date, p.amount));
      if (customerPhone) rememberCustomer(db, customerName, customerPhone);
      return saleId;
    });

    const sale = loadSale(saleId, req.user);
    const names = sale.items.map((i) => i.name);
    req.app.locals.notifier.notify({
      type: 'sale', actorId: req.user.id, url: `#/sales?open=${sale.id}`,
      title: `عملية بيع — ${fmtMoney(sale.total, settings.currency)}`,
      body: `${req.user.full_name} • ${names.slice(0, 2).join('، ')}${names.length > 2 ? ` +${names.length - 2}` : ''} • ${PAY_AR[sale.payment_method] || sale.payment_method}${offlineAt ? ` • اتباعت من غير نت الساعة ${offlineAt.slice(11, 16)}` : ''}`,
    });
    res.status(201).json(sale);
  });

  // ---------- list / view ----------
  api.get('/sales', sell, (req, res) => {
    const where = [];
    const params = [];
    const q = String(req.query.q || '').trim();
    if (q) {
      // Searching by invoice / phone / IMEI ignores the date filter
      where.push(`(s.invoice_no LIKE ? OR s.customer_phone LIKE ? OR s.customer_name LIKE ?
                  OR s.id IN (SELECT sale_id FROM sale_items WHERE serial = ?))`);
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, q);
    } else {
      const { from, to } = dateRange(req.query);
      where.push('date(s.created_at) BETWEEN ? AND ?');
      params.push(from, to);
    }
    if (!can(req.user, 'sales.view_all')) {
      where.push('s.user_id = ?');
      params.push(req.user.id);
    } else if (req.query.user_id) {
      where.push('s.user_id = ?');
      params.push(Number(req.query.user_id));
    }
    const rows = db.prepare(`
      SELECT s.id, s.invoice_no, s.customer_name, s.customer_phone, s.total, s.returned_total, s.payment_method,
             s.status, s.created_at, u.full_name AS user_name, ${DUE_SQL} AS due,
             (SELECT SUM(qty) FROM sale_items WHERE sale_id = s.id) AS items_count
      FROM sales s JOIN users u ON u.id = s.user_id
      WHERE ${where.join(' AND ')}
      ORDER BY s.id DESC LIMIT 1000`).all(...params);
    res.json(rows);
  });

  api.get('/sales/:id', sell, (req, res) => res.json(loadSale(req.params.id, req.user)));

  // ---------- returns ----------
  api.post('/sales/:id/return', requirePerm('sales.return'), (req, res) => {
    const body = req.body || {};
    if (!Array.isArray(body.items) || !body.items.length) throw bad('اختار الأصناف المرتجعة');
    const reason = str(body.reason, 'سبب المرتجع', { optional: true, max: 200 });

    tx(db, () => {
      const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(req.params.id);
      if (!sale) throw notFound('الفاتورة غير موجودة');
      // Invoice-level discount is spread over the items proportionally
      const ratio = sale.subtotal > 0 ? sale.total / sale.subtotal : 0;
      let amount = 0, cost = 0;
      const touched = [];

      for (const raw of body.items) {
        const item = db.prepare('SELECT * FROM sale_items WHERE id = ? AND sale_id = ?').get(raw.sale_item_id, sale.id);
        if (!item) throw bad('صنف غير موجود في الفاتورة');
        const qty = item.serial ? 1 : num(raw.qty, `كمية مرتجع ${item.name}`, { min: 1, int: true });
        if (item.returned_qty + qty > item.qty) throw bad(`"${item.name}" مرتجع بالكامل أو الكمية أكبر من المباع`);
        db.prepare('UPDATE sale_items SET returned_qty = returned_qty + ? WHERE id = ?').run(qty, item.id);
        amount += item.unit_price * qty * ratio;
        cost += item.unit_cost * qty;
        touched.push({ item, qty });
      }
      amount = round2(amount);
      // What's still owed is reduced first; cash is handed back only for what the customer paid beyond the new total
      const before = saleMoney(db, sale.id);
      const kept = before.received - before.refunded;
      const cashOut = round2(Math.max(0, kept - (before.net - amount)) - Math.max(0, kept - before.net));

      const r = db.prepare('INSERT INTO returns (sale_id, user_id, amount, cost, reason, cash_out) VALUES (?, ?, ?, ?, ?, ?)')
        .run(sale.id, req.user.id, amount, round2(cost), reason, cashOut);
      const returnId = Number(r.lastInsertRowid);

      for (const { item, qty } of touched) {
        const { qty: current } = db.prepare('SELECT qty FROM products WHERE id = ?').get(item.product_id);
        const after = current + qty;
        db.prepare("UPDATE products SET qty = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(after, item.product_id);
        if (item.serial) db.prepare("UPDATE serials SET status = 'in_stock', sale_id = NULL WHERE serial = ?").run(item.serial);
        movement.run(item.product_id, 'return', qty, after, returnId, `مرتجع ${sale.invoice_no}`, req.user.id);
      }

      const left = db.prepare('SELECT SUM(qty - returned_qty) AS n FROM sale_items WHERE sale_id = ?').get(sale.id).n;
      db.prepare('UPDATE sales SET returned_total = returned_total + ?, status = ? WHERE id = ?')
        .run(amount, left > 0 ? 'partial_return' : 'returned', sale.id);
      audit(db, req.user.id, 'sale.return', { sale: sale.invoice_no, amount });
    });

    const sale = loadSale(req.params.id, req.user);
    const last = sale.returns[sale.returns.length - 1];
    req.app.locals.notifier.notify({
      type: 'sale_return', actorId: req.user.id, url: `#/sales?open=${sale.id}`,
      title: `مرتجع — ${fmtMoney(last?.amount || 0, getSettings(db).currency)}`,
      body: `${req.user.full_name} • فاتورة ${sale.invoice_no}${last?.reason ? ` • ${last.reason}` : ''}`,
    });
    res.json(sale);
  });

  // ---------- collecting money later on a credit / installment sale ----------
  api.post('/sales/:id/payments', requirePerm('customers.pay'), (req, res) => {
    const b = req.body || {};
    const method = PAYMENT_METHODS.includes(b.method) && b.method !== 'installment' ? b.method : 'cash';
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(req.params.id);
    if (!sale) throw notFound('الفاتورة غير موجودة');
    requireOpenShift(db, req.user);
    const amount = round2(num(b.amount, 'المبلغ', { min: 0.01 }));
    tx(db, () => {
      const { due } = saleMoney(db, sale.id);
      if (due <= 0.004) throw bad('الفاتورة دي مدفوعة بالكامل');
      if (amount > due + 0.004) throw bad(`المتبقي على الفاتورة ${due} بس`);
      db.prepare('INSERT INTO sale_payments (sale_id, amount, method, note, user_id) VALUES (?, ?, ?, ?, ?)')
        .run(sale.id, amount, method, str(b.note, 'الملاحظة', { optional: true, max: 200 }), req.user.id);
    });
    audit(db, req.user.id, 'sale.payment', { sale: sale.invoice_no, amount, method });
    const after = loadSale(sale.id, req.user);
    req.app.locals.notifier.notify({
      type: 'customer_payment', actorId: req.user.id, url: `#/sales?open=${sale.id}`,
      title: `تحصيل — ${fmtMoney(amount, getSettings(db).currency)}`,
      body: `${req.user.full_name} • ${sale.customer_name || ''} • فاتورة ${sale.invoice_no}${after.due > 0 ? ` • باقي ${fmtMoney(after.due, getSettings(db).currency)}` : ' • خلصت ✅'}`,
    });
    res.status(201).json(after);
  });

  /** Split what's owed into equal installments: { count, every: 'month' | 'week' | days, first_date }. */
  function installmentPlan(raw, due, soldOn = today()) {
    if (!raw || !raw.count) return [];
    const count = num(raw.count, 'عدد الأقساط', { min: 1, int: true });
    if (count > 60) throw bad('عدد الأقساط كبير جداً');
    const first = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.first_date || '')) ? raw.first_date : null;
    if (!first) throw bad('حدد ميعاد أول قسط');
    if (first < soldOn) throw bad('ميعاد أول قسط عدّى');
    const every = raw.every === 'week' ? 'week' : 'month';
    const each = Math.floor((due / count) * 100) / 100;
    const out = [];
    for (let i = 0; i < count; i++) {
      const d = new Date(`${first}T12:00:00`);
      if (every === 'week') d.setDate(d.getDate() + 7 * i);
      else {
        const day = d.getDate();
        d.setDate(1);
        d.setMonth(d.getMonth() + i);
        d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
      }
      const amount = i === count - 1 ? round2(due - each * (count - 1)) : each;
      out.push({ due_date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, amount });
    }
    return out;
  }

  function loadSale(id, user) {
    const sale = db.prepare(`SELECT s.*, u.full_name AS user_name FROM sales s JOIN users u ON u.id = s.user_id WHERE s.id = ?`).get(id);
    if (!sale) throw notFound('الفاتورة غير موجودة');
    if (!can(user, 'sales.view_all') && sale.user_id !== user.id) throw notFound('الفاتورة غير موجودة');
    sale.items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id').all(sale.id);
    sale.returns = db.prepare(`SELECT r.id, r.amount, r.cash_out, r.reason, r.created_at, u.full_name AS user_name
                               FROM returns r JOIN users u ON u.id = r.user_id WHERE r.sale_id = ? ORDER BY r.id`).all(sale.id);
    if (!can(user, 'products.view_cost')) sale.items.forEach((i) => delete i.unit_cost);
    Object.assign(sale, saleMoney(db, sale.id));
    sale.payments = db.prepare(`SELECT p.*, u.full_name AS user_name FROM sale_payments p LEFT JOIN users u ON u.id = p.user_id
                                WHERE p.sale_id = ? ORDER BY p.id`).all(sale.id);
    sale.installments = installmentsOf(db, sale.id);
    const day = sale.created_at.slice(0, 10);
    sale.items.forEach((i) => {
      if (i.warranty_days > 0) {
        const d = new Date(`${day}T12:00:00`);
        d.setDate(d.getDate() + i.warranty_days);
        i.warranty_until = d.toISOString().slice(0, 10);
      }
    });
    return sale;
  }
};

module.exports.PAYMENT_METHODS = PAYMENT_METHODS;
