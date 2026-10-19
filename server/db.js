'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { hashPassword } = require('./auth');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','manager','cashier')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  barcode TEXT UNIQUE,
  cost_price REAL NOT NULL DEFAULT 0,
  sell_price REAL NOT NULL DEFAULT 0,
  qty INTEGER NOT NULL DEFAULT 0,
  min_qty INTEGER NOT NULL DEFAULT 0,
  has_serial INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);

-- IMEI / serial numbers for phones (one row per physical unit)
CREATE TABLE IF NOT EXISTS serials (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  serial TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'in_stock' CHECK (status IN ('in_stock','sold','missing')),
  cost_price REAL,
  sale_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_serials_product ON serials(product_id, status);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY,
  invoice_no TEXT UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  customer_name TEXT,
  customer_phone TEXT,
  subtotal REAL NOT NULL,
  discount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL,
  paid REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  returned_total REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','partial_return','returned')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at);

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  name TEXT NOT NULL,
  serial TEXT,
  qty INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  unit_cost REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL,
  returned_qty INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);

CREATE TABLE IF NOT EXISTS returns (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount REAL NOT NULL,
  cost REAL NOT NULL DEFAULT 0,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('purchase','sale','return','adjust','stocktake')),
  qty_change INTEGER NOT NULL,
  qty_after INTEGER NOT NULL,
  ref_id INTEGER,
  note TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_movements_product ON stock_movements(product_id, created_at);

CREATE TABLE IF NOT EXISTS stocktakes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','applied','cancelled')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  applied_at TEXT
);

CREATE TABLE IF NOT EXISTS stocktake_items (
  stocktake_id INTEGER NOT NULL REFERENCES stocktakes(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  expected_qty INTEGER NOT NULL,
  counted_qty INTEGER,
  PRIMARY KEY (stocktake_id, product_id)
);

CREATE TABLE IF NOT EXISTS stocktake_serials (
  stocktake_id INTEGER NOT NULL REFERENCES stocktakes(id) ON DELETE CASCADE,
  serial_id INTEGER NOT NULL REFERENCES serials(id) ON DELETE CASCADE,
  PRIMARY KEY (stocktake_id, serial_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`;

const DEFAULT_SETTINGS = {
  shop_name: 'Mobile Mix',
  shop_address: '',
  shop_phone: '',
  currency: 'ج.م',
  invoice_prefix: 'MM-',
  invoice_footer: 'شكراً لزيارتكم — البضاعة المباعة تُستبدل خلال 14 يوم بالفاتورة',
  invoice_size: '80mm',
  label_size: '38x25',
  cashier_max_discount: '5',
};

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);

  const setDefault = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) setDefault.run(k, v);

  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (n === 0) {
    db.prepare('INSERT INTO users (username, full_name, password_hash, role) VALUES (?, ?, ?, ?)')
      .run('admin', 'المدير', hashPassword('admin123'), 'admin');
    const addCat = db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)');
    for (const c of ['موبايلات', 'إكسسوارات', 'شواحن وكابلات', 'سماعات', 'جرابات وإسكرينات', 'قطع غيار'])
      addCat.run(c);
  }
  return db;
}

/** Run fn inside a transaction; rolls back on throw. */
function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { open, tx, DEFAULT_SETTINGS };
