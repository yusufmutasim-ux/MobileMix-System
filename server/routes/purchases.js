'use strict';
const { requirePerm } = require('../auth');
const { tx } = require('../db');
const { bad, notFound, num, str, round2, pad, dateRange, audit, getSettings } = require('../util');
const { receiveStock, cleanSerials } = require('../stock');

const fmt = (v, cur) => `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${cur || 'ج.م'}`;
const BALANCE = `(COALESCE((SELECT SUM(total) FROM purchases WHERE supplier_id = s.id), 0)
                 - COALESCE((SELECT SUM(amount) FROM supplier_payments WHERE supplier_id = s.id), 0))`;

/** Suppliers, purchase invoices (stock in with cost) and what we owe each supplier. */
module.exports = function purchaseRoutes(api, db) {
  const perm = requirePerm('purchases.manage');

  // ---------- suppliers ----------
  api.get('/suppliers', perm, (_req, res) => {
    res.json(db.prepare(`
      SELECT s.*, ROUND(${BALANCE}, 2) AS balance,
             (SELECT COUNT(*) FROM purchases WHERE supplier_id = s.id) AS purchases,
             (SELECT MAX(created_at) FROM purchases WHERE supplier_id = s.id) AS last_purchase
      FROM suppliers s ORDER BY s.active DESC, s.name`).all());
  });

  const readSupplier = (b) => ({
    name: str(b.name, 'اسم المورد', { max: 80 }),
    phone: str(b.phone, 'التليفون', { optional: true, max: 30 }),
    notes: str(b.notes, 'الملاحظات', { optional: true, max: 300 }),
  });

  api.post('/suppliers', perm, (req, res) => {
    const f = readSupplier(req.body || {});
    const r = db.prepare('INSERT INTO suppliers (name, phone, notes) VALUES (?, ?, ?)').run(f.name, f.phone, f.notes);
    res.status(201).json(db.prepare('SELECT * FROM suppliers WHERE id = ?').get(r.lastInsertRowid));
  });

  api.put('/suppliers/:id', perm, (req, res) => {
    const s = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
    if (!s) throw notFound('المورد غير موجود');
    const f = readSupplier(req.body || {});
    const active = req.body.active === undefined ? s.active : (req.body.active ? 1 : 0);
    db.prepare('UPDATE suppliers SET name = ?, phone = ?, notes = ?, active = ? WHERE id = ?').run(f.name, f.phone, f.notes, active, s.id);
    res.json(db.prepare('SELECT * FROM suppliers WHERE id = ?').get(s.id));
  });

  api.get('/suppliers/:id', perm, (req, res) => {
    const s = db.prepare(`SELECT s.*, ROUND(${BALANCE}, 2) AS balance FROM suppliers s WHERE s.id = ?`).get(req.params.id);
    if (!s) throw notFound('المورد غير موجود');
    s.purchases = db.prepare(`SELECT p.*, u.full_name AS user_name,
        (SELECT COALESCE(SUM(amount), 0) FROM supplier_payments WHERE purchase_id = p.id) AS paid
      FROM purchases p LEFT JOIN users u ON u.id = p.user_id WHERE p.supplier_id = ? ORDER BY p.id DESC LIMIT 200`).all(s.id);
    s.payments = db.prepare(`SELECT sp.*, u.full_name AS user_name, p.purchase_no FROM supplier_payments sp
      LEFT JOIN users u ON u.id = sp.user_id LEFT JOIN purchases p ON p.id = sp.purchase_id
      WHERE sp.supplier_id = ? ORDER BY sp.id DESC LIMIT 200`).all(s.id);
    res.json(s);
  });

  api.post('/suppliers/:id/payments', perm, (req, res) => {
    const s = db.prepare(`SELECT s.*, ${BALANCE} AS balance FROM suppliers s WHERE s.id = ?`).get(req.params.id);
    if (!s) throw notFound('المورد غير موجود');
    const b = req.body || {};
    const amount = round2(num(b.amount, 'المبلغ', { min: 0.01 }));
    const fromDrawer = b.from_drawer === false || b.from_drawer === 0 || b.from_drawer === '0' ? 0 : 1;
    db.prepare('INSERT INTO supplier_payments (supplier_id, amount, from_drawer, note, user_id) VALUES (?, ?, ?, ?, ?)')
      .run(s.id, amount, fromDrawer, str(b.note, 'الملاحظة', { optional: true, max: 200 }), req.user.id);
    audit(db, req.user.id, 'supplier.payment', { supplier: s.name, amount, from_drawer: fromDrawer });
    res.status(201).json({ ok: true, balance: round2(s.balance - amount) });
  });

  // ---------- purchase invoices ----------
  api.get('/purchases', perm, (req, res) => {
    const { from, to } = dateRange(req.query);
    const where = ['date(p.created_at) BETWEEN ? AND ?'];
    const params = [from, to];
    if (req.query.supplier_id) { where.push('p.supplier_id = ?'); params.push(Number(req.query.supplier_id)); }
    const rows = db.prepare(`
      SELECT p.*, s.name AS supplier_name, u.full_name AS user_name,
             (SELECT COALESCE(SUM(amount), 0) FROM supplier_payments WHERE purchase_id = p.id) AS paid,
             (SELECT SUM(qty) FROM purchase_items WHERE purchase_id = p.id) AS units
      FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id LEFT JOIN users u ON u.id = p.user_id
      WHERE ${where.join(' AND ')} ORDER BY p.id DESC LIMIT 1000`).all(...params);
    res.json({ from, to, rows, total: round2(rows.reduce((a, r) => a + r.total, 0)) });
  });

  api.get('/purchases/:id', perm, (req, res) => res.json(loadPurchase(req.params.id)));

  api.post('/purchases', perm, (req, res) => {
    const b = req.body || {};
    if (!Array.isArray(b.items) || !b.items.length) throw bad('الفاتورة فاضية — ضيف أصناف');
    if (b.items.length > 300) throw bad('عدد الأصناف كبير جداً');
    const supplierId = b.supplier_id ? num(b.supplier_id, 'المورد', { int: true }) : null;
    if (supplierId && !db.prepare('SELECT 1 FROM suppliers WHERE id = ?').get(supplierId)) throw bad('المورد غير موجود');
    const fromDrawer = b.paid_from_drawer === false || b.paid_from_drawer === 0 || b.paid_from_drawer === '0' ? 0 : 1;
    const settings = getSettings(db);

    const id = tx(db, () => {
      const lines = b.items.map((raw, i) => {
        const p = db.prepare('SELECT * FROM products WHERE id = ?').get(num(raw.product_id, `الصنف رقم ${i + 1}`, { int: true }));
        if (!p) throw bad(`الصنف رقم ${i + 1}: المنتج غير موجود`);
        const serials = p.has_serial ? cleanSerials(raw.serials) : [];
        const qty = p.has_serial ? serials.length : num(raw.qty, `كمية ${p.name}`, { min: 1, int: true });
        if (p.has_serial && !qty) throw bad(`لازم تدخل رقم IMEI / سيريال لكل جهاز من "${p.name}"`);
        const unitCost = round2(num(raw.unit_cost, `سعر شراء ${p.name}`, { min: 0 }));
        const sell = raw.sell_price === undefined || raw.sell_price === null || raw.sell_price === '' ? null : round2(num(raw.sell_price, `سعر بيع ${p.name}`, { min: 0 }));
        return { p, qty, serials, unitCost, sell, lineTotal: round2(qty * unitCost) };
      });
      const total = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
      const paid = round2(b.paid === undefined || b.paid === null || b.paid === '' ? total : num(b.paid, 'المدفوع', { min: 0 }));
      if (paid > total + 0.004) throw bad('المدفوع أكبر من إجمالي الفاتورة');
      if (paid < total - 0.004 && !supplierId) throw bad('في فلوس متبقية — اختار المورد عشان تتسجل عليه');

      const r = db.prepare('INSERT INTO purchases (supplier_id, ref_no, user_id, total, notes) VALUES (?, ?, ?, ?, ?)')
        .run(supplierId, str(b.ref_no, 'رقم فاتورة المورد', { optional: true, max: 40 }), req.user.id, total,
          str(b.notes, 'الملاحظات', { optional: true, max: 300 }));
      const id = Number(r.lastInsertRowid);
      const no = `P-${pad(id, 6)}`;
      db.prepare('UPDATE purchases SET purchase_no = ? WHERE id = ?').run(no, id);

      const addItem = db.prepare(`INSERT INTO purchase_items (purchase_id, product_id, name, qty, unit_cost, line_total, serials)
                                  VALUES (?, ?, ?, ?, ?, ?, ?)`);
      for (const l of lines) {
        receiveStock(db, l.p, { qty: l.qty, cost: l.unitCost, serials: l.serials, note: `شراء ${no}`, refId: id }, req.user.id);
        addItem.run(id, l.p.id, l.p.name, l.qty, l.unitCost, l.lineTotal, l.serials.length ? JSON.stringify(l.serials) : null);
        if (l.sell != null && l.sell !== l.p.sell_price) {
          db.prepare("UPDATE products SET sell_price = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(l.sell, l.p.id);
          audit(db, req.user.id, 'product.price', { id: l.p.id, from: l.p.sell_price, to: l.sell, purchase: no });
        }
      }
      if (paid > 0) {
        db.prepare('INSERT INTO supplier_payments (supplier_id, purchase_id, amount, from_drawer, note, user_id) VALUES (?, ?, ?, ?, ?, ?)')
          .run(supplierId, id, paid, fromDrawer, `مع فاتورة ${no}`, req.user.id);
      }
      audit(db, req.user.id, 'purchase.create', { no, total, paid });
      return id;
    });

    const p = loadPurchase(id);
    req.app.locals.notifier.notify({
      type: 'purchase', actorId: req.user.id, url: '#/purchases',
      title: `شراء بضاعة — ${fmt(p.total, settings.currency)}`,
      body: `${req.user.full_name}${p.supplier_name ? ` • ${p.supplier_name}` : ''} • ${p.items.length} صنف${p.total - p.paid > 0.004 ? ` • متبقي ${fmt(p.total - p.paid, settings.currency)}` : ''}`,
    });
    res.status(201).json(p);
  });

  function loadPurchase(id) {
    const p = db.prepare(`SELECT p.*, s.name AS supplier_name, s.phone AS supplier_phone, u.full_name AS user_name,
        (SELECT COALESCE(SUM(amount), 0) FROM supplier_payments WHERE purchase_id = p.id) AS paid
      FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id LEFT JOIN users u ON u.id = p.user_id WHERE p.id = ?`).get(id);
    if (!p) throw notFound('فاتورة الشراء غير موجودة');
    p.items = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ? ORDER BY id').all(p.id)
      .map((i) => ({ ...i, serials: i.serials ? JSON.parse(i.serials) : [] }));
    return p;
  }
};
