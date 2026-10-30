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

-- Brands to pick from when adding a product (so "Samsung" isn't typed five different ways)
CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
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

-- ---------- attendance (حضور وانصراف) ----------
CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  check_in_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  check_out_at TEXT,
  note TEXT,
  closed_by INTEGER REFERENCES users(id),
  -- where the check in / out happened: 'gps' (inside the shop zone), 'wifi' (shop network), 'none' (zone off)
  in_method TEXT, in_lat REAL, in_lng REAL, in_accuracy REAL, in_distance REAL,
  out_method TEXT, out_lat REAL, out_lng REAL, out_accuracy REAL, out_distance REAL
);
CREATE INDEX IF NOT EXISTS idx_shifts_user ON shifts(user_id, check_in_at);

-- ---------- notifications ----------
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  url TEXT,
  actor_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Phones / browsers that receive push notifications
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS user_prefs (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (user_id, key)
);

-- Server-only values (never sent to the browser), e.g. push keys
CREATE TABLE IF NOT EXISTS secrets (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- ---------- money: expenses & the cash drawer ----------
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL,
  amount REAL NOT NULL,
  from_drawer INTEGER NOT NULL DEFAULT 1,   -- paid in cash out of the shop drawer
  note TEXT,
  employee_id INTEGER REFERENCES users(id), -- salaries / advances
  period TEXT,                              -- salary month (YYYY-MM)
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(created_at);

-- Money the owner puts into or takes out of the drawer
CREATE TABLE IF NOT EXISTS cash_moves (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('in','out')),
  amount REAL NOT NULL,
  note TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Counting the drawer: what should be there vs what was counted
CREATE TABLE IF NOT EXISTS drawer_closings (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  opened_at TEXT,
  closed_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  opening REAL NOT NULL DEFAULT 0,
  expected REAL NOT NULL,
  counted REAL NOT NULL,
  diff REAL NOT NULL,
  left_in_drawer REAL NOT NULL DEFAULT 0,
  details TEXT,
  note TEXT
);

-- ---------- suppliers & purchases ----------
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY,
  purchase_no TEXT UNIQUE,
  supplier_id INTEGER REFERENCES suppliers(id),
  ref_no TEXT,                -- the supplier's own invoice number
  user_id INTEGER REFERENCES users(id),
  total REAL NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases(supplier_id);

CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  name TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_cost REAL NOT NULL,
  line_total REAL NOT NULL,
  serials TEXT
);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id INTEGER PRIMARY KEY,
  supplier_id INTEGER REFERENCES suppliers(id),  -- empty: goods bought for cash without a saved supplier
  purchase_id INTEGER REFERENCES purchases(id),
  amount REAL NOT NULL,
  from_drawer INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_supplier_payments ON supplier_payments(supplier_id);

-- ---------- customers, credit sales & installments ----------
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,  -- digits only
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Money collected later on a sale that wasn't fully paid
CREATE TABLE IF NOT EXISTS sale_payments (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  amount REAL NOT NULL,
  method TEXT NOT NULL DEFAULT 'cash',
  note TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_sale_payments ON sale_payments(sale_id);

CREATE TABLE IF NOT EXISTS sale_installments (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  amount REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_installments_sale ON sale_installments(sale_id);

-- ---------- the online store ----------
CREATE TABLE IF NOT EXISTS online_orders (
  id INTEGER PRIMARY KEY,
  order_no TEXT UNIQUE,
  token TEXT NOT NULL UNIQUE,              -- the customer's private link to follow the order
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  governorate TEXT,
  address TEXT,
  notes TEXT,
  delivery TEXT NOT NULL CHECK (delivery IN ('ship','local','pickup')),
  delivery_fee REAL NOT NULL DEFAULT 0,
  subtotal REAL NOT NULL,
  total REAL NOT NULL,
  payment TEXT NOT NULL CHECK (payment IN ('cod','transfer','card')),
  pay_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (pay_status IN ('unpaid','review','paid','failed')),
  transfer_proof TEXT,                     -- picture of the transfer the customer uploaded
  paymob_order_id TEXT,
  paymob_txn_id TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','confirmed','shipped','delivered','cancelled')),
  sale_id INTEGER REFERENCES sales(id) ON DELETE SET NULL,
  handled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  cancel_reason TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
-- Store look: slider pictures, the two side banners
CREATE TABLE IF NOT EXISTS store_banners (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('slide','side')),
  image TEXT NOT NULL,
  link TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_online_orders_status ON online_orders(status, created_at);
CREATE TABLE IF NOT EXISTS online_order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES online_orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  line_total REAL NOT NULL
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
  repair_prefix: 'R-',
  repair_terms: 'المحل غير مسؤول عن الجهاز بعد 30 يوم من إبلاغ العميل بجاهزيته. المحل غير مسؤول عن البيانات أو الشريحة أو كارت الميموري. الضمان على العطل اللي اتصلح بس.',
  backup_dir: '',
  backup_keep: '30',
  require_shift: '0',
  attendance_zone: '0',
  shop_lat: '',
  shop_lng: '',
  zone_radius: '100',
  shop_networks: '',
  expense_categories: 'إيجار\nكهربا ومياه\nنت وتليفون\nمرتبات\nسلفة\nأكل ومشروبات\nمواصلات\nصيانة المحل\nأخرى',
  daily_summary: '1',
  daily_summary_time: '23:00',
  // ---------- online store ----------
  store_enabled: '0',
  store_title: '',
  store_about: '',
  store_whatsapp: '',
  store_products: 'auto',          // auto: everything with a price and stock / manual: only what's ticked
  store_show_out: '1',             // show sold-out items (marked "نفد")
  store_pay_cod: '1',
  store_pay_transfer: '0',
  store_transfer_info: '',
  store_pay_card: '0',
  store_ship: '1',
  store_ship_fees: '{}',           // {"القاهرة": 60, ...}; a governorate without a fee isn't offered
  store_local: '0',
  store_local_area: '',
  store_local_fee: '0',
  store_pickup: '1',
  store_min_order: '0',
  store_domain: '',
  store_free_ship: '0',           // orders above this ship free (0 = off)
  store_strip: '',                 // offers line across the top of the store
  store_strip_color: '#141414',
  installment_reminders: '1',
  late_grace: '10',        // minutes after the shift start before someone counts as late
  absence_alert: '1',      // tell the owner when someone hasn't checked in after their shift started
};

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  // digits('010 1234-5678') = '01012345678' — to match phone numbers however they were typed
  db.function('digits', { deterministic: true }, (v) => String(v ?? '').replace(/\D/g, ''));
  upgrade(db);
  db.exec(SCHEMA);
  addMissingColumns(db);

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
  backfillCustomers(db);
  backfillBrands(db);
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
/** Columns added in later versions to tables that already exist in older databases. */
function addMissingColumns(db) {
  const wanted = {
    shifts: ['in_method TEXT', 'in_lat REAL', 'in_lng REAL', 'in_accuracy REAL', 'in_distance REAL',
      'out_method TEXT', 'out_lat REAL', 'out_lng REAL', 'out_accuracy REAL', 'out_distance REAL',
      'late_minutes INTEGER', 'early_minutes INTEGER'],
    returns: ['cash_out REAL'],                       // cash handed back (old rows: the whole amount)
    // Sales made with no internet: the device's own id for the sale (so it's never saved twice) and when it really happened
    sales: ['client_ref TEXT', 'offline_at TEXT'],
    categories: ['image TEXT'],                       // picture for the store's category circles
    products: ['warranty_days INTEGER NOT NULL DEFAULT 0',
      // Online store: picture, description, and whether it shows (hidden in auto mode / chosen in manual mode)
      'image TEXT', 'description TEXT', 'online_hidden INTEGER NOT NULL DEFAULT 0', 'online_show INTEGER NOT NULL DEFAULT 0',
      'compare_price REAL'],                           // price before discount, shown crossed out in the store
    sale_items: ['warranty_days INTEGER NOT NULL DEFAULT 0'],
    users: ['salary REAL NOT NULL DEFAULT 0', 'commission_pct REAL NOT NULL DEFAULT 0',
      // Work schedule: from / to (HH:MM) and the week days they work (0 = Sunday … 6 = Saturday)
      'shift_start TEXT', 'shift_end TEXT', "work_days TEXT NOT NULL DEFAULT '0123456'"],
  };
  for (const [table, cols] of Object.entries(wanted)) {
    const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const c of cols) if (!have.has(c.split(' ')[0])) db.exec(`ALTER TABLE ${table} ADD COLUMN ${c}`);
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_client_ref ON sales(client_ref) WHERE client_ref IS NOT NULL');
}

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

/** Customers list started in a later version: fill it once from earlier sales and repairs. */
function backfillCustomers(db) {
  if (db.prepare("SELECT value FROM settings WHERE key = 'customers_backfilled'").get()) return;
  db.exec(`
    INSERT OR IGNORE INTO customers (name, phone, created_at)
    SELECT name, phone, first FROM (
      SELECT COALESCE(NULLIF(TRIM(customer_name), ''), 'عميل') AS name, digits(customer_phone) AS phone, MIN(created_at) AS first
      FROM (SELECT customer_name, customer_phone, created_at FROM sales WHERE customer_phone IS NOT NULL
            UNION ALL SELECT customer_name, customer_phone, created_at FROM repairs)
      WHERE length(digits(customer_phone)) >= 6 GROUP BY digits(customer_phone)
    )`);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('customers_backfilled', '1')").run();
}

/** Every brand already used on a product is in the brands list (runs on every start; cheap and safe). */
function backfillBrands(db) {
  if (!db.prepare('PRAGMA table_info(products)').all().some((c) => c.name === 'brand')) return;
  db.exec(`INSERT OR IGNORE INTO brands (name)
           SELECT DISTINCT TRIM(brand) FROM products WHERE brand IS NOT NULL AND TRIM(brand) <> ''`);
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
