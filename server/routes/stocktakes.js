'use strict';
const { tx } = require('../db');
const { requirePerm } = require('../auth');
const { bad, notFound, num, str, audit } = require('../util');

/**
 * Stocktake (جرد):
 *  1. Open: snapshot expected quantities of the selected products.
 *  2. Count: scan barcodes (+1 each) or type counted qty; phones are counted by scanning their IMEI.
 *  3. Apply: differences become stock movements; IMEIs not found are marked "missing".
 * Only counted rows (counted_qty not null) are applied.
 */
module.exports = function stocktakeRoutes(api, db) {
  const perm = requirePerm('stocktake');

  function getOpen(id) {
    const st = db.prepare('SELECT * FROM stocktakes WHERE id = ?').get(id);
    if (!st) throw notFound('الجرد غير موجود');
    if (st.status !== 'open') throw bad('الجرد ده مقفول');
    return st;
  }

  function loadItem(stId, productId) {
    return db.prepare(`
      SELECT i.product_id, i.expected_qty, i.counted_qty, p.name, p.brand, p.barcode, p.has_serial, p.cost_price
      FROM stocktake_items i JOIN products p ON p.id = i.product_id
      WHERE i.stocktake_id = ? AND i.product_id = ?`).get(stId, productId);
  }

  api.get('/stocktakes', perm, (_req, res) => {
    res.json(db.prepare(`
      SELECT st.*, u.full_name AS user_name,
        (SELECT COUNT(*) FROM stocktake_items WHERE stocktake_id = st.id) AS items,
        (SELECT COUNT(*) FROM stocktake_items WHERE stocktake_id = st.id AND counted_qty IS NOT NULL) AS counted,
        (SELECT COUNT(*) FROM stocktake_items WHERE stocktake_id = st.id AND counted_qty IS NOT NULL AND counted_qty <> expected_qty) AS diffs
      FROM stocktakes st JOIN users u ON u.id = st.user_id ORDER BY st.id DESC LIMIT 100`).all());
  });

  api.post('/stocktakes', perm, (req, res) => {
    const categoryId = num(req.body?.category_id, 'القسم', { optional: true, int: true });
    const note = str(req.body?.note, 'الملاحظة', { optional: true, max: 200 });
    const id = tx(db, () => {
      const r = db.prepare('INSERT INTO stocktakes (user_id, note) VALUES (?, ?)').run(req.user.id, note);
      const id = Number(r.lastInsertRowid);
      const sql = `INSERT INTO stocktake_items (stocktake_id, product_id, expected_qty)
                   SELECT ?, id, qty FROM products WHERE active = 1 ${categoryId ? 'AND category_id = ?' : ''}`;
      const info = categoryId ? db.prepare(sql).run(id, categoryId) : db.prepare(sql).run(id);
      if (!info.changes) throw bad('مفيش منتجات في القسم ده');
      return id;
    });
    audit(db, req.user.id, 'stocktake.open', { id });
    res.status(201).json({ id });
  });

  api.get('/stocktakes/:id', perm, (req, res) => {
    const st = db.prepare('SELECT st.*, u.full_name AS user_name FROM stocktakes st JOIN users u ON u.id = st.user_id WHERE st.id = ?')
      .get(req.params.id);
    if (!st) throw notFound('الجرد غير موجود');
    st.items = db.prepare(`
      SELECT i.product_id, i.expected_qty, i.counted_qty, p.name, p.brand, p.barcode, p.has_serial, p.cost_price, c.name AS category_name
      FROM stocktake_items i JOIN products p ON p.id = i.product_id LEFT JOIN categories c ON c.id = p.category_id
      WHERE i.stocktake_id = ? ORDER BY c.name, p.name`).all(st.id);
    const found = db.prepare(`SELECT s.product_id, s.serial FROM stocktake_serials ss JOIN serials s ON s.id = ss.serial_id
                              WHERE ss.stocktake_id = ?`).all(st.id);
    const byProduct = {};
    for (const f of found) (byProduct[f.product_id] ||= []).push(f.serial);
    for (const it of st.items) {
      it.has_serial = !!it.has_serial;
      if (it.has_serial) it.found_serials = byProduct[it.product_id] || [];
    }
    res.json(st);
  });

  /** Scan one code: barcode adds 1, IMEI marks that device as found. */
  api.post('/stocktakes/:id/scan', perm, (req, res) => {
    const code = str(req.body?.code, 'الكود', { max: 60 });
    const out = tx(db, () => {
      const st = getOpen(req.params.id);
      const serial = db.prepare('SELECT * FROM serials WHERE serial = ?').get(code);
      if (serial) {
        if (serial.status !== 'in_stock') throw bad(`الجهاز ${code} متسجل إنه ${serial.status === 'sold' ? 'مباع' : 'مفقود'}`);
        if (!loadItem(st.id, serial.product_id)) throw bad('الجهاز ده مش ضمن الجرد ده');
        const r = db.prepare('INSERT OR IGNORE INTO stocktake_serials (stocktake_id, serial_id) VALUES (?, ?)').run(st.id, serial.id);
        if (!r.changes) throw bad(`الجهاز ${code} اتعد قبل كده`);
        recountSerials(st.id, serial.product_id);
        return { item: loadItem(st.id, serial.product_id), serial: code };
      }
      const p = db.prepare('SELECT * FROM products WHERE barcode = ?').get(code);
      if (!p) throw notFound(`مفيش منتج بالكود ${code}`);
      if (p.has_serial) throw bad(`"${p.name}" بيتعد بالـ IMEI — امسح الـ IMEI بتاع كل جهاز`);
      const r = db.prepare(`UPDATE stocktake_items SET counted_qty = COALESCE(counted_qty, 0) + 1
                            WHERE stocktake_id = ? AND product_id = ?`).run(st.id, p.id);
      if (!r.changes) throw bad(`"${p.name}" مش ضمن الجرد ده`);
      return { item: loadItem(st.id, p.id) };
    });
    res.json(out);
  });

  api.put('/stocktakes/:id/items/:productId', perm, (req, res) => {
    const st = getOpen(req.params.id);
    const item = loadItem(st.id, req.params.productId);
    if (!item) throw notFound('المنتج مش ضمن الجرد');
    const counted = num(req.body?.counted_qty, 'العدد', { optional: true, min: 0, int: true });
    if (item.has_serial) {
      // Phones are counted by IMEI scans; only allow reset or "counted, none found"
      if (counted === null) db.prepare('DELETE FROM stocktake_serials WHERE stocktake_id = ? AND serial_id IN (SELECT id FROM serials WHERE product_id = ?)')
        .run(st.id, item.product_id);
      else if (counted !== 0) throw bad('الموبايلات بتتعد بمسح الـ IMEI');
    }
    db.prepare('UPDATE stocktake_items SET counted_qty = ? WHERE stocktake_id = ? AND product_id = ?').run(counted, st.id, item.product_id);
    if (item.has_serial && counted === 0) {
      db.prepare('DELETE FROM stocktake_serials WHERE stocktake_id = ? AND serial_id IN (SELECT id FROM serials WHERE product_id = ?)')
        .run(st.id, item.product_id);
    }
    res.json({ item: loadItem(st.id, item.product_id) });
  });

  api.post('/stocktakes/:id/apply', perm, (req, res) => {
    const result = tx(db, () => {
      const st = getOpen(req.params.id);
      const items = db.prepare(`SELECT i.*, p.has_serial, p.qty AS current_qty FROM stocktake_items i
                                JOIN products p ON p.id = i.product_id
                                WHERE i.stocktake_id = ? AND i.counted_qty IS NOT NULL`).all(st.id);
      const mv = db.prepare(`INSERT INTO stock_movements (product_id, type, qty_change, qty_after, ref_id, note, user_id)
                             VALUES (?, 'stocktake', ?, ?, ?, ?, ?)`);
      let changed = 0, missing = 0;
      for (const it of items) {
        if (it.has_serial) {
          // Devices received after the count started aren't judged by it
          const lost = db.prepare(`SELECT id, serial FROM serials WHERE product_id = ? AND status = 'in_stock'
                                   AND created_at <= ?
                                   AND id NOT IN (SELECT serial_id FROM stocktake_serials WHERE stocktake_id = ?)`)
            .all(it.product_id, st.created_at, st.id);
          if (!lost.length) continue;
          for (const s of lost) db.prepare("UPDATE serials SET status = 'missing' WHERE id = ?").run(s.id);
          const after = Math.max(0, it.current_qty - lost.length);
          db.prepare('UPDATE products SET qty = ? WHERE id = ?').run(after, it.product_id);
          mv.run(it.product_id, after - it.current_qty, after, st.id,
            `جرد #${st.id} — أجهزة مش موجودة: ${lost.map((s) => s.serial).join('، ')}`, req.user.id);
          missing += lost.length;
          changed++;
        } else {
          // Apply the difference vs. the snapshot, so sales during the count are kept
          const diff = it.counted_qty - it.expected_qty;
          if (!diff) continue;
          const after = Math.max(0, it.current_qty + diff);
          db.prepare('UPDATE products SET qty = ? WHERE id = ?').run(after, it.product_id);
          mv.run(it.product_id, after - it.current_qty, after, st.id, `جرد #${st.id}`, req.user.id);
          changed++;
        }
      }
      db.prepare("UPDATE stocktakes SET status = 'applied', applied_at = datetime('now','localtime') WHERE id = ?").run(st.id);
      audit(db, req.user.id, 'stocktake.apply', { id: st.id, changed, missing });
      return { changed, missing };
    });
    res.json(result);
  });

  api.post('/stocktakes/:id/cancel', perm, (req, res) => {
    const st = getOpen(req.params.id);
    db.prepare("UPDATE stocktakes SET status = 'cancelled' WHERE id = ?").run(st.id);
    res.json({ ok: true });
  });

  function recountSerials(stId, productId) {
    db.prepare(`UPDATE stocktake_items SET counted_qty = (
                  SELECT COUNT(*) FROM stocktake_serials ss JOIN serials s ON s.id = ss.serial_id
                  WHERE ss.stocktake_id = ? AND s.product_id = ?)
                WHERE stocktake_id = ? AND product_id = ?`).run(stId, productId, stId, productId);
  }
};
