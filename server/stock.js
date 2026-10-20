'use strict';
const { bad, round2 } = require('./util');

function addMovement(db, productId, type, change, qtyAfter, refId, note, userId) {
  db.prepare(`INSERT INTO stock_movements (product_id, type, qty_change, qty_after, ref_id, note, user_id)
              VALUES (?, ?, ?, ?, ?, ?, ?)`).run(productId, type, change, qtyAfter, refId ?? null, note ?? null, userId);
}

/** Unique, trimmed IMEI / serial numbers. */
function cleanSerials(list) {
  if (!Array.isArray(list)) return [];
  const out = [...new Set(list.map((s) => String(s).trim()).filter(Boolean))];
  for (const s of out) if (s.length > 40) throw bad(`رقم سيريال طويل جداً: ${s}`);
  return out;
}

/**
 * Add stock (purchase / opening balance). Updates the average cost. Must run inside a transaction.
 * Phones with IMEI: one unit per serial number.
 */
function receiveStock(db, product, { qty, cost, serials = [], note, refId = null }, userId) {
  if (product.has_serial) {
    if (!serials.length) throw bad(`لازم تدخل رقم IMEI / سيريال لكل جهاز من "${product.name}"`);
    qty = serials.length;
    const ins = db.prepare('INSERT INTO serials (product_id, serial, cost_price) VALUES (?, ?, ?)');
    for (const s of serials) ins.run(product.id, s, cost ?? product.cost_price);
  }
  if (!(qty > 0)) throw bad('الكمية لازم تكون أكبر من صفر');
  const current = db.prepare('SELECT qty, cost_price FROM products WHERE id = ?').get(product.id);
  const newQty = current.qty + qty;
  let newCost = current.cost_price;
  if (cost != null) {
    newCost = current.qty > 0 ? round2((current.qty * current.cost_price + qty * cost) / newQty) : cost;
  }
  db.prepare("UPDATE products SET qty = ?, cost_price = ?, updated_at = datetime('now','localtime') WHERE id = ?")
    .run(newQty, newCost, product.id);
  addMovement(db, product.id, 'purchase', qty, newQty, refId, note, userId);
  return newQty;
}

module.exports = { addMovement, cleanSerials, receiveStock };
