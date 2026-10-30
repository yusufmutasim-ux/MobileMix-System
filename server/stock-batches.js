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
  {
    id: '2026-10-30-joyroom',
    brands: ['JOYROOM', 'ACEFAST'],
    products: [
      { name: 'JOYROOM 10000mAh 22.5W Mini Digital Display Power Bank', brand: 'JOYROOM', cat: 'إكسسوارات', qty: 2 },
      { name: 'JOYROOM Lightning Male to USB Female OTG Adapter', brand: 'JOYROOM', cat: 'إكسسوارات', qty: 8 },
      { name: 'JOYROOM 60W Type-C to Type-C Cable (White)', brand: 'JOYROOM', cat: 'شواحن وكابلات', qty: 1 },
      { name: 'JOYROOM 3-in-1 Charging Cable 3.5A 1.2m (Type-C/Lightning/Micro)', brand: 'JOYROOM', cat: 'شواحن وكابلات', qty: 1 },
      { name: 'JOYROOM 60W Type-C to Type-C Braided Cable 1.2m (Blue)', brand: 'JOYROOM', cat: 'شواحن وكابلات', qty: 1 },
      { name: 'JOYROOM 60W Type-C to Type-C Braided Cable 1.2m (Black)', brand: 'JOYROOM', cat: 'شواحن وكابلات', qty: 1 },
      { name: 'JOYROOM PD 20W Mini Fast Charger Kit (Type-C to Type-C)', brand: 'JOYROOM', cat: 'شواحن وكابلات', qty: 3 },
      { name: 'JOYROOM PD 20W Fast Charger Kit (Type-C to Lightning)', brand: 'JOYROOM', cat: 'شواحن وكابلات', qty: 4 },
      { name: 'ACEFAST Universal Capacitive Stylus Pen', brand: 'ACEFAST', cat: 'إكسسوارات', qty: 2 },
      { name: 'JOYROOM 20W Dual-Port (2C) Charger', brand: 'JOYROOM', cat: 'شواحن وكابلات', qty: 2 },
    ],
  },
  {
    id: '2026-10-30-acefast',
    brands: ['ACEFAST'],
    products: [
      { name: 'ACEFAST C6-11 3-in-1 Charging Cable with Apple Watch Charger', brand: 'ACEFAST', cat: 'شواحن وكابلات', qty: 2 },
      { name: 'ACEFAST 5000mAh 20W Magnetic Wireless Power Bank', brand: 'ACEFAST', cat: 'إكسسوارات', qty: 1 },
      { name: 'ACEFAST C26-02 2.4A USB-A Charging Cable', brand: 'ACEFAST', cat: 'شواحن وكابلات', qty: 1 },
      { name: 'ACEFAST C22-04 3A USB-A to Type-C Cable', brand: 'ACEFAST', cat: 'شواحن وكابلات', qty: 2 },
    ],
  },
  {
    id: '2026-10-30-apple-jbl',
    brands: ['Apple', 'JBL', 'Belkin'],
    products: [
      { name: 'JBL GO 2 Portable Bluetooth Speaker (Blue)', brand: 'JBL', cat: 'سماعات', qty: 2 },
      { name: 'JBL GO 3 Portable Bluetooth Speaker (Black)', brand: 'JBL', cat: 'سماعات', qty: 1 },
      { name: 'Apple Lightning to Headphone Jack Adapter', brand: 'Apple', cat: 'إكسسوارات', qty: 2 },
      { name: 'Apple USB-C to Headphone Jack Adapter', brand: 'Apple', cat: 'إكسسوارات', qty: 1 },
      { name: 'Apple USB-C to Type-C and Lightning 60W Charge Cable', brand: 'Apple', cat: 'شواحن وكابلات', qty: 2 },
      { name: 'Apple EarPods (Lightning Connector)', brand: 'Apple', cat: 'سماعات', qty: 2 },
      { name: 'Apple 20W USB-C Power Adapter (EU 2-Pin)', brand: 'Apple', cat: 'شواحن وكابلات', qty: 5 },
      { name: 'Apple 20W USB-C Power Adapter (UK 3-Pin)', brand: 'Apple', cat: 'شواحن وكابلات', qty: 2 },
      { name: 'Belkin BoostCharge 45W USB-C Wall Charger for iPhone', brand: 'Belkin', cat: 'شواحن وكابلات', qty: 1 },
      { name: 'Apple 20W USB-C Power Adapter (US Flat Pin)', brand: 'Apple', cat: 'شواحن وكابلات', qty: 5 },
    ],
  },
  {
    id: '2026-10-30-anker-momax',
    brands: ['Anker', 'Momax', 'mophie', 'Belkin'],
    products: [
      { name: 'mophie essentials 20W USB-C PD Wall Adapter', brand: 'mophie', cat: 'شواحن وكابلات', qty: 5 },
      { name: 'Belkin BoostCharge Compact 20W USB-C Wall Charger', brand: 'Belkin', cat: 'شواحن وكابلات', qty: 2 },
      { name: 'Momax ONEPLUG 30W GaN USB-C Charger', brand: 'Momax', cat: 'شواحن وكابلات', qty: 4 },
      { name: 'Momax 1-Charge 20W USB-C Charger', brand: 'Momax', cat: 'شواحن وكابلات', qty: 1 },
      { name: 'Anker Zolo 10000mAh 22.5W Power Bank (Built-in USB-C Cable)', brand: 'Anker', cat: 'إكسسوارات', qty: 1 },
      { name: 'Anker OTG Lightning Male to USB 3.0 Adapter', brand: 'Anker', cat: 'إكسسوارات', qty: 3 },
      { name: 'Anker 60W USB-C to USB-C Braided Cable 3.3ft', brand: 'Anker', cat: 'شواحن وكابلات', qty: 3 },
      { name: 'Anker USB-A to USB-C Braided Cable 6ft', brand: 'Anker', cat: 'شواحن وكابلات', qty: 1 },
      { name: 'Anker 20W USB-C Charger', brand: 'Anker', cat: 'شواحن وكابلات', qty: 2 },
      { name: 'Anker 100W USB-C to USB-C Braided Cable 3.3ft', brand: 'Anker', cat: 'شواحن وكابلات', qty: 2 },
    ],
  },
  {
    id: '2026-10-30-vidvie',
    brands: ['VIDVIE'],
    products: [
      { name: 'VIDVIE HC1520 Mini Magnetic Phone Car Holder', brand: 'VIDVIE', cat: 'إكسسوارات', qty: 3 },
      { name: 'VIDVIE AL1129 Lanyard Type-C OTG Adapter', brand: 'VIDVIE', cat: 'إكسسوارات', qty: 2 },
      { name: 'VIDVIE Type-C to 3.5mm Aux Cable', brand: 'VIDVIE', cat: 'شواحن وكابلات', qty: 2 },
      { name: 'VIDVIE 30W Transparent Type-C & USB Fast Car Charger', brand: 'VIDVIE', cat: 'شواحن وكابلات', qty: 3 },
      { name: 'VIDVIE 3-in-1 Braided Aux Cable (3.5mm/Lightning/Type-C)', brand: 'VIDVIE', cat: 'شواحن وكابلات', qty: 1 },
      { name: 'VIDVIE Lightning to 3.5mm Aux Cable', brand: 'VIDVIE', cat: 'شواحن وكابلات', qty: 2 },
      { name: 'VIDVIE Pure Music 3.5mm Stereo Aux Cable', brand: 'VIDVIE', cat: 'شواحن وكابلات', qty: 5 },
      { name: 'VIDVIE 65W Multifunctional 2-in-2 Data Cable', brand: 'VIDVIE', cat: 'شواحن وكابلات', qty: 2 },
    ],
  },
  {
    id: '2026-10-30-vidvie-2',
    brands: ['VIDVIE'],
    products: [
      { name: 'VIDVIE HS662 Half In-Ear Wired Headset', brand: 'VIDVIE', cat: 'سماعات', qty: 6 },
      { name: 'VIDVIE In-ear Headset (3.5mm)', brand: 'VIDVIE', cat: 'سماعات', qty: 5 },
      { name: 'VIDVIE In-ear Headset (Type-C)', brand: 'VIDVIE', cat: 'سماعات', qty: 5 },
      { name: 'VIDVIE Semi-In-Ear Wired Headset (Type-C)', brand: 'VIDVIE', cat: 'سماعات', qty: 4 },
      { name: 'VIDVIE 3A USB to Type-C Data Cable', brand: 'VIDVIE', cat: 'شواحن وكابلات', qty: 6 },
      { name: 'VIDVIE 3A USB to Micro (V8) Data Cable', brand: 'VIDVIE', cat: 'شواحن وكابلات', qty: 7 },
      { name: 'VIDVIE 60W Type-C to Type-C Data Cable', brand: 'VIDVIE', cat: 'شواحن وكابلات', qty: 5 },
      { name: 'VIDVIE 3A USB to Lightning Data Cable', brand: 'VIDVIE', cat: 'شواحن وكابلات', qty: 4 },
      { name: 'VIDVIE 66W Type-C to Type-C Data Cable', brand: 'VIDVIE', cat: 'شواحن وكابلات', qty: 2 },
    ],
  },
  {
    id: '2026-10-30-audio-lights',
    brands: ['VIDVIE', 'PLOXAMA', 'soundcore', 'inkax', 'XO', 'JBL'],
    products: [
      { name: 'VIDVIE 33W Dual-Port (Type-C + USB) Fast Charger', brand: 'VIDVIE', cat: 'شواحن وكابلات', qty: 3 },
      { name: 'PLOXAMA U160 LED Light 2000mAh', brand: 'PLOXAMA', cat: 'إكسسوارات', qty: 1 },
      { name: 'PLOXAMA U160 PRO RGB LED Light 2000mAh', brand: 'PLOXAMA', cat: 'إكسسوارات', qty: 1 },
      { name: 'PLOXAMA U80 PRO RGB Light', brand: 'PLOXAMA', cat: 'إكسسوارات', qty: 1 },
      { name: 'soundcore Life U2 Neckband Wireless Earphones', brand: 'soundcore', cat: 'سماعات', qty: 1 },
      { name: 'inkax ANC Wireless Earbuds', brand: 'inkax', cat: 'سماعات', qty: 1 },
      { name: 'JBL GO 4 Portable Bluetooth Speaker (Camo)', brand: 'JBL', cat: 'سماعات', qty: 1 },
      { name: 'soundcore R50i NC Wireless Earbuds', brand: 'soundcore', cat: 'سماعات', qty: 2 },
      { name: 'XO GE-07 Gaming Headset', brand: 'XO', cat: 'سماعات', qty: 2 },
      { name: 'JBL Clip 5 Portable Bluetooth Speaker (Black)', brand: 'JBL', cat: 'سماعات', qty: 2 },
      { name: 'JBL JR310BT Kids Wireless Headphones (Blue)', brand: 'JBL', cat: 'سماعات', qty: 2 },
      { name: 'JBL Tune 520BT Wireless Headphones (Purple)', brand: 'JBL', cat: 'سماعات', qty: 1 },
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
