'use strict';
/**
 * Goods the owner asked to have entered for them. Each batch runs once on start (remembered in settings),
 * adds its brands to the list, and adds each product with its quantity — a product whose name is
 * already there is left alone, so nothing is ever doubled.
 * Prices start at 0: the owner sets them from the products page.
 */
const BATCHES = [
  {
    id: '2026-10-30-accessories',
    brands: ['SENDEM', 'iLock'],
    products: [
      { name: 'Desktop Bracket ZM-0113H (4.7"-13")', cat: 'إكسسوارات', qty: 2 },
      { name: 'iLock Slim Plug Adapter UK 13A', brand: 'iLock', cat: 'إكسسوارات', qty: 15 },
      { name: 'SENDEM M64A 100W Micro USB Cable 1m', brand: 'SENDEM', cat: 'شواحن وكابلات', qty: 4 },
      { name: 'M73 Wireless Audio Receiver Adapter', cat: 'إكسسوارات', qty: 3 },
      { name: 'SENDEM M35 6A Lightning Cable', brand: 'SENDEM', cat: 'شواحن وكابلات', qty: 3 },
      { name: 'SENDEM M35 6A Type-C Cable', brand: 'SENDEM', cat: 'شواحن وكابلات', qty: 5 },
      { name: 'SENDEM OG02 3.1A Single USB Travel Charger (Micro)', brand: 'SENDEM', cat: 'شواحن وكابلات', qty: 3 },
      { name: 'SENDEM OG02 3.1A Single USB Charger Kit', brand: 'SENDEM', cat: 'شواحن وكابلات', qty: 5 },
      { name: 'SENDEM OG39 18W Fast Charger Kit', brand: 'SENDEM', cat: 'شواحن وكابلات', qty: 2 },
      { name: 'SENDEM OG02 3.1A Single USB Travel Charger (Type-C)', brand: 'SENDEM', cat: 'شواحن وكابلات', qty: 2 },
    ],
  },
];

function applyStockBatches(db, batches = BATCHES) {
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
  if (!admin) return;
  for (const b of batches) {
    const flag = `batch_${b.id}`;
    if (db.prepare('SELECT 1 FROM settings WHERE key = ?').get(flag)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      const addBrand = db.prepare('INSERT OR IGNORE INTO brands (name) VALUES (?)');
      for (const name of b.brands || []) addBrand.run(name);
      for (const p of b.products) {
        if (db.prepare('SELECT 1 FROM products WHERE name = ? COLLATE NOCASE').get(p.name)) continue;
        const brand = p.brand ? db.prepare('SELECT name FROM brands WHERE name = ? COLLATE NOCASE').get(p.brand)?.name : null;
        const cat = db.prepare('SELECT id FROM categories WHERE name = ?').get(p.cat)?.id ?? null;
        const id = Number(db.prepare('INSERT INTO products (name, brand, category_id, qty, cost_price, sell_price) VALUES (?, ?, ?, ?, 0, 0)')
          .run(p.name, brand, cat, p.qty).lastInsertRowid);
        db.prepare('UPDATE products SET barcode = ? WHERE id = ?').run(`2000${String(id).padStart(8, '0')}`, id);
        db.prepare("INSERT INTO stock_movements (product_id, type, qty_change, qty_after, note, user_id) VALUES (?, 'purchase', ?, ?, 'إدخال بضاعة', ?)")
          .run(id, p.qty, p.qty, admin.id);
      }
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(flag, new Date().toISOString());
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      console.error(`stock batch ${b.id} failed:`, e.message);
    }
  }
}

module.exports = { applyStockBatches, BATCHES };
