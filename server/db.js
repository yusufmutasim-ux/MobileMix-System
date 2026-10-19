'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { hashPassword, verifyPassword } = require('./auth');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','manager','cashier','technician')),
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
  type TEXT NOT NULL CHECK (type IN ('purchase','sale','return','adjust','stocktake','repair')),
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

-- ---------- maintenance (صيانة) ----------
CREATE TABLE IF NOT EXISTS repairs (
  id INTEGER PRIMARY KEY,
  ticket_no TEXT UNIQUE,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  device TEXT NOT NULL,
  imei TEXT,
  passcode TEXT,
  problem TEXT NOT NULL,
  condition_notes TEXT,
  accessories TEXT,
  diagnosis TEXT,
  estimated_cost REAL,
  price REAL,                       -- final agreed price for the customer
  extra_cost REAL NOT NULL DEFAULT 0, -- costs outside our stock (outside parts, another workshop)
  technician_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN
    ('received','diagnosing','waiting_approval','waiting_parts','repairing','ready','not_repaired','delivered')),
  outcome TEXT CHECK (outcome IN ('repaired','not_repaired')),
  expected_at TEXT,
  warranty_days INTEGER NOT NULL DEFAULT 0,
  delivered_at TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_repairs_status ON repairs(status);
CREATE INDEX IF NOT EXISTS idx_repairs_phone ON repairs(customer_phone);

CREATE TABLE IF NOT EXISTS repair_parts (
  id INTEGER PRIMARY KEY,
  repair_id INTEGER NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  name TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_cost REAL NOT NULL DEFAULT 0,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS repair_payments (
  id INTEGER PRIMARY KEY,
  repair_id INTEGER NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
  amount REAL NOT NULL,             -- negative = refund
  method TEXT NOT NULL DEFAULT 'cash',
  kind TEXT NOT NULL CHECK (kind IN ('deposit','payment','refund')),
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_repair_payments_date ON repair_payments(created_at);

CREATE TABLE IF NOT EXISTS repair_events (
  id INTEGER PRIMARY KEY,
  repair_id INTEGER NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
  status TEXT,
  note TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_repair_events ON repair_events(repair_id);

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
  repair_prefix: 'R-',
  repair_terms: 'المحل غير مسؤول عن الجهاز بعد 30 يوم من إبلاغ العميل بجاهزيته. المحل غير مسؤول عن البيانات أو الشريحة أو كارت الميموري. الضمان على العطل اللي اتصلح بس.',
  backup_dir: '',
  backup_keep: '30',
};

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  upgrade(db);
  db.exec(SCHEMA);

  const setDefault = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) setDefault.run(k, v);

  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (n === 0) {
    // On a public server a known default password is unsafe: use ADMIN_PASSWORD or a random one shown in the logs
    let pw = (process.env.ADMIN_PASSWORD || '').trim();
    if (!pw && require('./hosting').cloud) {
      pw = require('node:crypto').randomBytes(6).toString('base64url');
      console.log(`\n  🔑 أول دخول: اسم المستخدم admin — كلمة السر: ${pw}\n     (غيّرها بعد ما تدخل)\n`);
    }
    db.prepare('INSERT INTO users (username, full_name, password_hash, role) VALUES (?, ?, ?, ?)')
      .run('admin', 'المدير', hashPassword(pw || 'admin123'), 'admin');
    const addCat = db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)');
    for (const c of ['موبايلات', 'إكسسوارات', 'شواحن وكابلات', 'سماعات', 'جرابات وإسكرينات', 'قطع غيار'])
      addCat.run(c);
  }
  applyAdminPassword(db);
  return db;
}

/**
 * ADMIN_PASSWORD (e.g. a Railway variable) sets the admin's password on every start — also when the
 * variable was added after the first deploy — until the admin changes the password inside the system.
 */
function applyAdminPassword(db) {
  // Emergency reset: ADMIN_RESET_PASSWORD always wins (remove the variable after logging in)
  const reset = (process.env.ADMIN_RESET_PASSWORD || '').trim();
  if (reset) {
    const admin = db.prepare("SELECT id, password_hash FROM users WHERE username = 'admin'").get();
    if (admin && !verifyPassword(reset, admin.password_hash)) {
      db.prepare("UPDATE users SET password_hash = ?, active = 1, role = 'admin' WHERE id = ?").run(hashPassword(reset), admin.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(admin.id);
      console.log('  🔑 كلمة سر admin اتغيرت من ADMIN_RESET_PASSWORD — امسح المتغير ده بعد ما تدخل');
    }
    return;
  }
  const pw = (process.env.ADMIN_PASSWORD || '').trim();
  if (!pw) return;
  const admin = db.prepare("SELECT id, password_hash FROM users WHERE username = 'admin'").get();
  if (!admin) return;
  const changedInApp = db.prepare("SELECT 1 FROM audit_log WHERE user_id = ? AND action = 'password.change'").get(admin.id);
  if (changedInApp || verifyPassword(pw, admin.password_hash)) return;
  db.prepare('UPDATE users SET password_hash = ?, active = 1 WHERE id = ?').run(hashPassword(pw), admin.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(admin.id);
  console.log('  🔑 كلمة سر admin اتظبطت من ADMIN_PASSWORD');
}

/**
 * Upgrades databases created by older versions. SQLite can't change a CHECK constraint in place,
 * so tables whose allowed values grew are rebuilt (same columns, data copied as-is).
 */
function upgrade(db) {
  const tableSql = (name) => db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)?.sql;
  const rebuild = [];
  const users = tableSql('users');
  if (users && !users.includes("'technician'")) rebuild.push(['users', "'cashier')", "'cashier','technician')"]);
  const moves = tableSql('stock_movements');
  if (moves && !moves.includes("'repair'")) rebuild.push(['stock_movements', "'stocktake')", "'stocktake','repair')"]);
  if (!rebuild.length) return;

  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [name, from, to] of rebuild) {
      const sql = tableSql(name);
      const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL").all(name);
      const newSql = sql.replace(from, to).replace(/^CREATE TABLE (IF NOT EXISTS )?"?\w+"?/, `CREATE TABLE ${name}__new`);
      db.exec(newSql);
      db.exec(`INSERT INTO ${name}__new SELECT * FROM ${name}`);
      db.exec(`DROP TABLE ${name}`);
      db.exec(`ALTER TABLE ${name}__new RENAME TO ${name}`);
      for (const i of indexes) db.exec(i.sql);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
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
