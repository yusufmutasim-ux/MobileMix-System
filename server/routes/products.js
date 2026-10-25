'use strict';
const stock = require('../stock');
const { tx } = require('../db');
const { requirePerm, can } = require('../auth');
const { bad, notFound, num, str, round2, pad, audit } = require('../util');

/** Internal barcode for products that don't come with one (Code128-friendly, numeric). */
const autoBarcode = (id) => `2000${pad(id, 8)}`;

module.exports = function productRoutes(api, db) {
  const view = requirePerm('products.view');
  const edit = requirePerm('products.edit');
  const stockEdit = requirePerm('stock.edit');

  const SELECT = `
    SELECT p.*, c.name AS category_name
    FROM products p LEFT JOIN categories c ON c.id = p.category_id`;

  const strip = (req) => (p) => {
    if (!p) return p;
    if (!can(req.user, 'products.view_cost')) delete p.cost_price;
    p.has_serial = !!p.has_serial;
    p.active = !!p.active;
    return p;
  };

  function getProduct(id) {
    const p = db.prepare(`${SELECT} WHERE p.id = ?`).get(id);
    if (!p) throw notFound('المنتج غير موجود');
    return p;
  }

  const addMovement = (productId, type, change, qtyAfter, refId, note, userId) =>
    stock.addMovement(db, productId, type, change, qtyAfter, refId, note, userId);
  const cleanSerials = stock.cleanSerials;
  const receiveStock = (product, opts, userId) => stock.receiveStock(db, product, opts, userId);

  function readFields(body, existing = {}) {
    const has = (k) => body[k] !== undefined;
    const f = {
      name: has('name') ? str(body.name, 'اسم المنتج', { max: 120 }) : existing.name,
      brand: has('brand') ? str(body.brand, 'الماركة', { optional: true, max: 60 }) : existing.brand ?? null,
      category_id: has('category_id') ? num(body.category_id, 'القسم', { optional: true, int: true }) : existing.category_id ?? null,
      barcode: has('barcode') ? str(body.barcode, 'الباركود', { optional: true, max: 40 }) : existing.barcode ?? null,
      cost_price: has('cost_price') ? num(body.cost_price, 'سعر الشراء', { min: 0, optional: true }) ?? 0 : existing.cost_price ?? 0,
      sell_price: has('sell_price') ? num(body.sell_price, 'سعر البيع', { min: 0 }) : existing.sell_price,
      min_qty: has('min_qty') ? num(body.min_qty, 'حد الطلب', { min: 0, int: true, optional: true }) ?? 0 : existing.min_qty ?? 0,
      notes: has('notes') ? str(body.notes, 'الملاحظات', { optional: true, max: 500 }) : existing.notes ?? null,
      warranty_days: has('warranty_days') ? num(body.warranty_days, 'مدة الضمان', { min: 0, int: true, optional: true }) ?? 0 : existing.warranty_days ?? 0,
    };
    if (f.brand) {
      // Brands come from the list, written exactly as saved there
      const b = db.prepare('SELECT name FROM brands WHERE name = ? COLLATE NOCASE').get(f.brand);
      if (!b) throw bad(`البراند "${f.brand}" مش في القايمة — ضيفه من "البراندات" الأول`);
      f.brand = b.name;
    }
    if (f.sell_price == null) throw bad('سعر البيع مطلوب');
    if (f.name == null) throw bad('اسم المنتج مطلوب');
    return f;
  }

  // ---------- list / search ----------
  api.get('/products', view, (req, res) => {
    const where = [];
    const params = [];
    if (req.query.inactive !== '1') where.push('p.active = 1');
    if (req.query.category_id) { where.push('p.category_id = ?'); params.push(Number(req.query.category_id)); }
    if (req.query.low === '1') where.push('p.qty <= p.min_qty');
    if (req.query.brand) { where.push('p.brand = ? COLLATE NOCASE'); params.push(String(req.query.brand)); }
    const q = String(req.query.q || '').trim();
    if (q) {
      where.push(`(p.name LIKE ? OR p.brand LIKE ? OR p.barcode = ?
                  OR p.id IN (SELECT product_id FROM serials WHERE serial = ?))`);
      params.push(`%${q}%`, `%${q}%`, q, q);
    }
    const limit = Math.min(Number(req.query.limit) || 500, 2000);
    const rows = db.prepare(`${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY p.name LIMIT ${limit}`).all(...params);
    res.json(rows.map(strip(req)));
  });

  /** Scanner lookup: exact barcode, or an in-stock IMEI. */
  api.get('/products/lookup', view, (req, res) => {
    const code = String(req.query.code || '').trim();
    if (!code) throw bad('اكتب الباركود');
    let p = db.prepare(`${SELECT} WHERE p.barcode = ? AND p.active = 1`).get(code);
    let serial = null;
    if (!p) {
      const s = db.prepare("SELECT * FROM serials WHERE serial = ?").get(code);
      if (s) {
        if (s.status !== 'in_stock') throw bad(`الجهاز ده (${code}) مش في المخزن — حالته: ${s.status === 'sold' ? 'مباع' : 'مفقود'}`);
        p = db.prepare(`${SELECT} WHERE p.id = ?`).get(s.product_id);
        serial = s.serial;
      }
    }
    if (!p) throw notFound('مفيش منتج بالكود ده');
    res.json({ product: strip(req)(p), serial });
  });

  /** Everything the till needs to keep selling with no internet: products, their in-stock IMEIs, categories. */
  api.get('/pos/catalog', view, requirePerm('sales.create'), (req, res) => {
    const products = db.prepare(`${SELECT} WHERE p.active = 1 ORDER BY p.name`).all().map(strip(req));
    const serials = {};
    for (const s of db.prepare("SELECT product_id, serial FROM serials WHERE status = 'in_stock' ORDER BY id").all()) {
      (serials[s.product_id] ||= []).push(s.serial);
    }
    const categories = db.prepare('SELECT id, name FROM categories ORDER BY name').all();
    res.json({ at: new Date().toISOString(), products, serials, categories });
  });

  api.get('/products/:id', view, (req, res) => {
    const p = getProduct(req.params.id);
    if (p.has_serial) {
      p.serials = db.prepare("SELECT id, serial, cost_price, created_at FROM serials WHERE product_id = ? AND status = 'in_stock' ORDER BY id")
        .all(p.id);
      if (!can(req.user, 'products.view_cost')) p.serials.forEach((s) => delete s.cost_price);
    }
    res.json(strip(req)(p));
  });

  api.get('/products/:id/movements', requirePerm('stock.edit'), (req, res) => {
    res.json(db.prepare(`
      SELECT m.*, u.full_name AS user_name FROM stock_movements m
      LEFT JOIN users u ON u.id = m.user_id
      WHERE m.product_id = ? ORDER BY m.id DESC LIMIT 200`).all(req.params.id));
  });

  // ---------- create / update ----------
  api.post('/products', edit, (req, res) => {
    const f = readFields(req.body || {});
    const hasSerial = req.body.has_serial ? 1 : 0;
    const initialQty = num(req.body.initial_qty, 'الكمية', { optional: true, min: 0, int: true }) || 0;
    const serials = cleanSerials(req.body.serials);

    const id = tx(db, () => {
      const r = db.prepare(`INSERT INTO products (name, brand, category_id, barcode, cost_price, sell_price, min_qty, has_serial, notes, warranty_days)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(f.name, f.brand, f.category_id, f.barcode, f.cost_price, f.sell_price, f.min_qty, hasSerial, f.notes, f.warranty_days);
      const id = Number(r.lastInsertRowid);
      if (!f.barcode) db.prepare('UPDATE products SET barcode = ? WHERE id = ?').run(autoBarcode(id), id);
      const product = getProduct(id);
      if (hasSerial ? serials.length : initialQty > 0) {
        receiveStock(product, { qty: initialQty, cost: null, serials, note: 'رصيد أول المدة' }, req.user.id);
      }
      audit(db, req.user.id, 'product.create', { id, name: f.name });
      return id;
    });
    res.status(201).json(strip(req)(getProduct(id)));
  });

  api.put('/products/:id', edit, (req, res) => {
    const existing = getProduct(req.params.id);
    const f = readFields(req.body || {}, existing);
    const barcode = f.barcode || autoBarcode(existing.id);
    const active = req.body.active !== undefined ? (req.body.active ? 1 : 0) : existing.active;
    db.prepare(`UPDATE products SET name=?, brand=?, category_id=?, barcode=?, cost_price=?, sell_price=?, min_qty=?, notes=?, active=?,
                warranty_days=?, updated_at = datetime('now','localtime') WHERE id = ?`)
      .run(f.name, f.brand, f.category_id, barcode, f.cost_price, f.sell_price, f.min_qty, f.notes, active, f.warranty_days, existing.id);
    if (existing.sell_price !== f.sell_price) {
      audit(db, req.user.id, 'product.price', { id: existing.id, from: existing.sell_price, to: f.sell_price });
    }
    res.json(strip(req)(getProduct(existing.id)));
  });

  api.delete('/products/:id', edit, (req, res) => {
    const r = db.prepare("UPDATE products SET active = 0, updated_at = datetime('now','localtime') WHERE id = ?").run(req.params.id);
    if (!r.changes) throw notFound('المنتج غير موجود');
    audit(db, req.user.id, 'product.deactivate', { id: Number(req.params.id) });
    res.json({ ok: true });
  });

  // ---------- stock ----------
  api.post('/products/:id/stock', stockEdit, (req, res) => {
    const body = req.body || {};
    const qty = tx(db, () => {
      const p = getProduct(req.params.id);
      return receiveStock(p, {
        qty: num(body.qty, 'الكمية', { optional: true, min: 1, int: true }) || 0,
        cost: num(body.cost_price, 'سعر الشراء', { optional: true, min: 0 }),
        serials: cleanSerials(body.serials),
        note: str(body.note, 'الملاحظة', { optional: true, max: 200 }) || 'إضافة بضاعة',
      }, req.user.id);
    });
    res.json({ qty });
  });

  /** Manual correction for quantity-tracked products. */
  api.post('/products/:id/adjust', stockEdit, (req, res) => {
    const qty = tx(db, () => {
      const p = getProduct(req.params.id);
      if (p.has_serial) throw bad('المنتجات اللي بـ IMEI بتتعدل من قائمة الأجهزة');
      const newQty = num(req.body?.qty, 'الكمية الجديدة', { min: 0, int: true });
      const note = str(req.body?.note, 'سبب التعديل', { max: 200 });
      if (newQty === p.qty) return newQty;
      db.prepare("UPDATE products SET qty = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(newQty, p.id);
      addMovement(p.id, 'adjust', newQty - p.qty, newQty, null, note, req.user.id);
      return newQty;
    });
    res.json({ qty });
  });

  /** Remove an in-stock serial (entered by mistake / damaged / lost). */
  api.delete('/serials/:id', stockEdit, (req, res) => {
    const note = str(req.body?.note ?? req.query.note, 'السبب', { optional: true, max: 200 }) || 'حذف جهاز من المخزن';
    tx(db, () => {
      const s = db.prepare('SELECT * FROM serials WHERE id = ?').get(req.params.id);
      if (!s) throw notFound('الجهاز غير موجود');
      if (s.status !== 'in_stock') throw bad('الجهاز ده مش في المخزن');
      db.prepare('DELETE FROM serials WHERE id = ?').run(s.id);
      const p = getProduct(s.product_id);
      const newQty = Math.max(0, p.qty - 1);
      db.prepare('UPDATE products SET qty = ? WHERE id = ?').run(newQty, p.id);
      addMovement(p.id, 'adjust', -1, newQty, null, `${note} (${s.serial})`, req.user.id);
    });
    res.json({ ok: true });
  });

  return { addMovement };
};

module.exports.autoBarcode = autoBarcode;
