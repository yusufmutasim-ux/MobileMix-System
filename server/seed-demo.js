'use strict';
// Fills an EMPTY database with sample products, staff and a few sales so you can try the system.
// Usage: npm run demo-data
const path = require('node:path');
const { open, tx } = require('./db');
const { hashPassword } = require('./auth');

const db = open(process.env.MM_DB || path.join(__dirname, '..', 'data', 'mobilemix.db'));
if (db.prepare('SELECT COUNT(*) n FROM products').get().n > 0) {
  console.log('قاعدة البيانات فيها منتجات بالفعل — مش هضيف بيانات تجريبية.');
  process.exit(0);
}

const cat = (name) => db.prepare('SELECT id FROM categories WHERE name = ?').get(name)?.id ?? null;
const imei = () => '35' + String(Math.floor(Math.random() * 1e13)).padStart(13, '0');

const PRODUCTS = [
  ['iPhone 15 128GB', 'Apple', 'موبايلات', 38500, 41999, 0, 3, true],
  ['iPhone 13 128GB', 'Apple', 'موبايلات', 25500, 27999, 0, 2, true],
  ['Samsung Galaxy A55 256GB', 'Samsung', 'موبايلات', 17800, 19499, 0, 4, true],
  ['Samsung Galaxy A15 128GB', 'Samsung', 'موبايلات', 6900, 7699, 0, 5, true],
  ['Xiaomi Redmi Note 13', 'Xiaomi', 'موبايلات', 8600, 9499, 0, 4, true],
  ['OPPO A78', 'OPPO', 'موبايلات', 9100, 9999, 0, 2, true],
  ['شاحن Anker 20W Type-C', 'Anker', 'شواحن وكابلات', 420, 650, 4, 18],
  ['كابل Type-C إلى Lightning', 'Anker', 'شواحن وكابلات', 180, 300, 5, 25],
  ['كابل Type-C سريع 1م', 'Baseus', 'شواحن وكابلات', 90, 175, 5, 40],
  ['سماعة AirPods Pro 2', 'Apple', 'سماعات', 9200, 10500, 1, 3],
  ['سماعة JBL Tune 510BT', 'JBL', 'سماعات', 1500, 1950, 2, 6],
  ['سماعة سلك Samsung', 'Samsung', 'سماعات', 120, 220, 5, 3],
  ['جراب iPhone 15 سيليكون', '', 'جرابات وإسكرينات', 60, 150, 10, 35],
  ['اسكرينة 9D iPhone 15', '', 'جرابات وإسكرينات', 25, 100, 10, 60],
  ['جراب Samsung A55 شفاف', '', 'جرابات وإسكرينات', 45, 120, 10, 8],
  ['باور بانك Anker 10000mAh', 'Anker', 'إكسسوارات', 900, 1250, 2, 7],
  ['حامل موبايل للعربية', 'Baseus', 'إكسسوارات', 150, 275, 3, 12],
  ['كارت ميموري 64GB', 'SanDisk', 'إكسسوارات', 210, 320, 4, 0],
];

tx(db, () => {
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get().id;
  const addUser = db.prepare('INSERT OR IGNORE INTO users (username, full_name, password_hash, role) VALUES (?, ?, ?, ?)');
  addUser.run('mona', 'منى (مشرفة)', hashPassword('123456'), 'manager');
  addUser.run('karim', 'كريم (كاشير)', hashPassword('123456'), 'cashier');
  const cashier = db.prepare("SELECT id FROM users WHERE username = 'karim'").get().id;

  const insP = db.prepare(`INSERT INTO products (name, brand, category_id, cost_price, sell_price, min_qty, qty, has_serial)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const insS = db.prepare('INSERT INTO serials (product_id, serial, cost_price) VALUES (?, ?, ?)');
  const mv = db.prepare(`INSERT INTO stock_movements (product_id, type, qty_change, qty_after, note, user_id)
                         VALUES (?, 'purchase', ?, ?, 'رصيد أول المدة', ?)`);
  const ids = [];
  for (const [name, brand, c, cost, price, min, qty, serial] of PRODUCTS) {
    const id = Number(insP.run(name, brand || null, cat(c), cost, price, min, qty, serial ? 1 : 0).lastInsertRowid);
    db.prepare('UPDATE products SET barcode = ? WHERE id = ?').run(`2000${String(id).padStart(8, '0')}`, id);
    if (serial) for (let i = 0; i < qty; i++) insS.run(id, imei(), cost);
    if (qty) mv.run(id, qty, qty, admin);
    ids.push(id);
  }

  // A few sales today so the dashboard isn't empty
  const sell = (userId, lines, method) => {
    const sub = lines.reduce((s, l) => s + l.price * l.qty, 0);
    const sid = Number(db.prepare(`INSERT INTO sales (user_id, subtotal, total, paid, payment_method) VALUES (?, ?, ?, ?, ?)`)
      .run(userId, sub, sub, sub, method).lastInsertRowid);
    db.prepare('UPDATE sales SET invoice_no = ? WHERE id = ?').run(`MM-${String(sid).padStart(6, '0')}`, sid);
    for (const l of lines) {
      const p = db.prepare('SELECT * FROM products WHERE id = ?').get(l.id);
      let serial = null;
      if (p.has_serial) {
        serial = db.prepare("SELECT serial FROM serials WHERE product_id = ? AND status = 'in_stock' LIMIT 1").get(p.id).serial;
        db.prepare("UPDATE serials SET status = 'sold', sale_id = ? WHERE serial = ?").run(sid, serial);
      }
      db.prepare(`INSERT INTO sale_items (sale_id, product_id, name, serial, qty, unit_price, unit_cost, line_total)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(sid, p.id, p.name, serial, l.qty, l.price, p.cost_price, l.price * l.qty);
      db.prepare('UPDATE products SET qty = qty - ? WHERE id = ?').run(l.qty, p.id);
      db.prepare(`INSERT INTO stock_movements (product_id, type, qty_change, qty_after, ref_id, user_id)
                  VALUES (?, 'sale', ?, ?, ?, ?)`).run(p.id, -l.qty, p.qty - l.qty, sid, userId);
    }
  };
  sell(cashier, [{ id: ids[3], qty: 1, price: 7699 }, { id: ids[14], qty: 1, price: 120 }], 'cash');
  sell(cashier, [{ id: ids[6], qty: 2, price: 650 }, { id: ids[8], qty: 1, price: 175 }], 'wallet');
  sell(admin, [{ id: ids[0], qty: 1, price: 41999 }, { id: ids[12], qty: 1, price: 150 }, { id: ids[13], qty: 1, price: 100 }], 'card');
});

console.log('✅ تم إضافة بيانات تجريبية: 18 منتج + موظفين (mona / karim — كلمة السر 123456)');
