'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { requirePerm } = require('../auth');
const { bad, notFound, num, str, round2, pad, audit, getSettings } = require('../util');
const { tx } = require('../db');
const { requireOpenShift } = require('./shifts');
const paymob = require('../paymob');
const { saleMoney } = require('../money');

/** The 27 governorates, for shipping prices. */
const GOVERNORATES = ['القاهرة', 'الجيزة', 'الإسكندرية', 'القليوبية', 'الشرقية', 'الدقهلية', 'الغربية', 'المنوفية', 'البحيرة',
  'كفر الشيخ', 'دمياط', 'بورسعيد', 'الإسماعيلية', 'السويس', 'الفيوم', 'بني سويف', 'المنيا', 'أسيوط', 'سوهاج', 'قنا',
  'الأقصر', 'أسوان', 'البحر الأحمر', 'الوادي الجديد', 'مطروح', 'شمال سيناء', 'جنوب سيناء'];

const STATUS_AR = { new: 'جديد', confirmed: 'اتأكد', shipped: 'اتشحن', delivered: 'اتسلّم', cancelled: 'اتلغى' };
const PAY_AR = { cod: 'كاش عند الاستلام', transfer: 'تحويل', card: 'فيزا' };
const DELIVERY_AR = { ship: 'شحن', local: 'توصيل', pickup: 'استلام من المحل' };

/**
 * The online store. Public part (no login): products, ordering, following an order, card payment callbacks.
 * Staff part: the orders list; confirming an order turns it into a sale (stock leaves then),
 * delivering a cash-on-delivery order records the money, cancelling puts the stock back.
 */
module.exports = function storeRoutes(api, db, { dataDir }) {
  const manage = requirePerm('orders.manage');
  const uploads = path.join(dataDir, 'uploads');
  const proofs = path.join(dataDir, 'private', 'proofs');

  const on = (v) => v === '1' || v === 1 || v === true;
  const fees = (st) => { try { return JSON.parse(st.store_ship_fees || '{}'); } catch { return {}; } };
  const shipFees = (st) => Object.fromEntries(Object.entries(fees(st)).filter(([g, f]) => GOVERNORATES.includes(g) && f !== '' && f !== null && Number(f) >= 0).map(([g, f]) => [g, Number(f)]));

  // What the store shows: active, priced, not an IMEI device, and (auto) not hidden / (manual) ticked
  const visible = (st) => `p.active = 1 AND p.has_serial = 0 AND p.sell_price > 0
    AND ${st.store_products === 'manual' ? 'p.online_show = 1' : 'p.online_hidden = 0'}
    ${on(st.store_show_out) ? '' : 'AND p.qty > 0'}`;
  const productOut = (p) => ({
    id: p.id, name: p.name, brand: p.brand, category_id: p.category_id, category: p.category_name, price: p.sell_price,
    in_stock: p.qty > 0, left: p.qty > 0 && p.qty <= 3 ? p.qty : null, image: p.image ? `/uploads/${p.image}` : null, description: p.description || '',
  });
  const SELECT = 'SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id';

  /** Save an uploaded picture (data URL) under uploads/<dir>; returns its path inside uploads. */
  function savePicture(dataUrl, dir, name) {
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!m || m[2].length > 4_000_000) throw bad('ابعت صورة (JPG أو PNG) أصغر من 3 ميجا');
    fs.mkdirSync(path.join(uploads, dir), { recursive: true });
    const file = `${dir}/${name}-${Date.now().toString(36)}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
    fs.writeFileSync(path.join(uploads, file), Buffer.from(m[2], 'base64'));
    return file;
  }
  const dropPicture = (file) => { if (file) fs.rm(path.join(uploads, file), { force: true }, () => {}); };
  const pictureUrl = (file) => (file ? `/uploads/${file}` : null);

  function openStore() {
    const st = getSettings(db);
    if (!on(st.store_enabled)) throw notFound('المتجر مقفول دلوقتي');
    return st;
  }

  // ---------------- public ----------------
  api.get('/store/info', (_req, res) => {
    const st = getSettings(db);
    const card = on(st.store_pay_card) && paymob.config(db).ready;
    const cats = on(st.store_enabled) ? db.prepare(`SELECT c.id, c.name, c.image, COUNT(*) AS n FROM products p JOIN categories c ON c.id = p.category_id
      WHERE ${visible(st)} GROUP BY c.id ORDER BY c.name`).all().map((c) => ({ ...c, image: pictureUrl(c.image) })) : [];
    const banners = db.prepare('SELECT id, kind, image, link FROM store_banners ORDER BY kind, sort, id').all().map((b) => ({ ...b, image: pictureUrl(b.image) }));
    res.json({
      enabled: on(st.store_enabled),
      title: st.store_title || st.shop_name || 'Mobile Mix',
      about: st.store_about || '', whatsapp: st.store_whatsapp || '', phone: st.shop_phone || '', address: st.shop_address || '',
      currency: st.currency || 'ج.م', min_order: Number(st.store_min_order) || 0,
      payments: {
        cod: on(st.store_pay_cod),
        transfer: on(st.store_pay_transfer) ? { info: st.store_transfer_info || '' } : null,
        card,
      },
      delivery: {
        ship: on(st.store_ship) ? shipFees(st) : null,
        local: on(st.store_local) ? { area: st.store_local_area || '', fee: Number(st.store_local_fee) || 0 } : null,
        pickup: on(st.store_pickup) ? { address: st.shop_address || '' } : null,
      },
      categories: cats,
      strip: st.store_strip || '', strip_color: st.store_strip_color || '#141414',
      slides: banners.filter((b) => b.kind === 'slide'), sides: banners.filter((b) => b.kind === 'side').slice(0, 2),
    });
  });

  /** The store's front page: newest arrivals, then a row per section. */
  api.get('/store/home', (_req, res) => {
    const st = openStore();
    const order = 'ORDER BY (p.qty > 0) DESC, (p.image IS NOT NULL) DESC, p.id DESC';
    const latest = db.prepare(`${SELECT} WHERE ${visible(st)} ${order} LIMIT 12`).all().map(productOut);
    const cats = db.prepare(`SELECT c.id, c.name FROM products p JOIN categories c ON c.id = p.category_id WHERE ${visible(st)}
      GROUP BY c.id ORDER BY COUNT(*) DESC`).all();
    const sections = cats.map((c) => ({
      id: c.id, name: c.name,
      products: db.prepare(`${SELECT} WHERE ${visible(st)} AND p.category_id = ? ${order} LIMIT 12`).all(c.id).map(productOut),
    }));
    res.json({ latest, sections });
  });

  api.get('/store/products', (req, res) => {
    const st = openStore();
    const where = [visible(st)];
    const params = [];
    if (req.query.cat) { where.push('p.category_id = ?'); params.push(Number(req.query.cat)); }
    const q = String(req.query.q || '').trim();
    if (q) { where.push('(p.name LIKE ? OR p.brand LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
    if (req.query.brand) { where.push('p.brand = ? COLLATE NOCASE'); params.push(String(req.query.brand)); }
    const sort = { price_asc: 'p.sell_price ASC', price_desc: 'p.sell_price DESC', new: 'p.id DESC' }[req.query.sort] || '(p.image IS NOT NULL) DESC, p.updated_at DESC';
    const rows = db.prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY (p.qty > 0) DESC, ${sort} LIMIT 400`).all(...params);
    res.json(rows.map(productOut));
  });

  api.get('/store/products/:id', (req, res) => {
    const st = openStore();
    const p = db.prepare(`${SELECT} WHERE p.id = ? AND ${visible(st)}`).get(Number(req.params.id));
    if (!p) throw notFound('المنتج ده مش موجود');
    res.json(productOut(p));
  });

  // A few orders per hour from one address, so nobody floods the shop with fake orders
  const recent = new Map();
  function rateLimit(ip) {
    const now = Date.now();
    const list = (recent.get(ip) || []).filter((t) => now - t < 3600_000);
    if (list.length >= 8) throw bad('طلبات كتير من نفس الجهاز — كلمنا على الواتساب');
    list.push(now);
    recent.set(ip, list);
  }

  api.post('/store/orders', async (req, res) => {
    const st = openStore();
    const b = req.body || {};
    const name = str(b.name, 'الاسم', { max: 80 });
    const phone = String(b.phone || '').replace(/\D/g, '');
    if (phone.length < 10 || phone.length > 13) throw bad('اكتب رقم موبايل صحيح');
    if (!Array.isArray(b.items) || !b.items.length) throw bad('السلة فاضية');
    if (b.items.length > 50) throw bad('عدد المنتجات كبير');

    // Delivery
    const delivery = ['ship', 'local', 'pickup'].includes(b.delivery) ? b.delivery : null;
    let fee = 0, governorate = null, address = null;
    if (delivery === 'ship' && on(st.store_ship)) {
      governorate = String(b.governorate || '');
      const list = shipFees(st);
      if (!(governorate in list)) throw bad('مش بنشحن للمحافظة دي');
      fee = list[governorate];
      address = str(b.address, 'العنوان', { max: 300 });
    } else if (delivery === 'local' && on(st.store_local)) {
      fee = Number(st.store_local_fee) || 0;
      address = str(b.address, 'العنوان', { max: 300 });
    } else if (delivery === 'pickup' && on(st.store_pickup)) {
      fee = 0;
    } else throw bad('اختار طريقة الاستلام');

    // Payment
    const payment = b.payment;
    const allowed = { cod: on(st.store_pay_cod), transfer: on(st.store_pay_transfer), card: on(st.store_pay_card) && paymob.config(db).ready };
    if (!allowed[payment]) throw bad('اختار طريقة الدفع');

    rateLimit(req.ip);
    const orderId = tx(db, () => {
      const lines = [];
      const seen = new Map();
      for (const raw of b.items) {
        const id = num(raw.id, 'المنتج', { int: true });
        seen.set(id, (seen.get(id) || 0) + num(raw.qty, 'الكمية', { int: true, min: 1 }));
      }
      for (const [id, qty] of seen) {
        const p = db.prepare(`${SELECT} WHERE p.id = ? AND ${visible(st)}`).get(id);
        if (!p) throw bad('في منتج في السلة مبقاش متاح — حدّث الصفحة');
        if (qty > p.qty) throw bad(p.qty > 0 ? `المتاح من "${p.name}" ${p.qty} بس` : `"${p.name}" نفد`);
        if (qty > 20) throw bad(`الكمية من "${p.name}" كبيرة — كلمنا على الواتساب`);
        lines.push({ p, qty, total: round2(p.sell_price * qty) });
      }
      const subtotal = round2(lines.reduce((s, l) => s + l.total, 0));
      const min = Number(st.store_min_order) || 0;
      if (subtotal < min) throw bad(`أقل طلب ${min} ${st.currency || 'ج.م'}`);
      const token = crypto.randomBytes(16).toString('hex');
      const r = db.prepare(`INSERT INTO online_orders (token, customer_name, phone, governorate, address, notes, delivery, delivery_fee, subtotal, total, payment, ip)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(token, name, phone, governorate, address,
        str(b.notes, 'الملاحظات', { optional: true, max: 300 }), delivery, fee, subtotal, round2(subtotal + fee), payment, req.ip || null);
      const id = Number(r.lastInsertRowid);
      db.prepare('UPDATE online_orders SET order_no = ? WHERE id = ?').run(`W-${pad(id, 6)}`, id);
      const add = db.prepare('INSERT INTO online_order_items (order_id, product_id, name, qty, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?)');
      for (const l of lines) add.run(id, l.p.id, l.p.name, l.qty, l.p.sell_price, l.total);
      return id;
    });
    const order = db.prepare('SELECT * FROM online_orders WHERE id = ?').get(orderId);

    if (payment === 'card') {
      try {
        const { url, paymobOrderId } = await paymob.startPayment(db, order);
        db.prepare('UPDATE online_orders SET paymob_order_id = ? WHERE id = ?').run(paymobOrderId, orderId);
        return res.status(201).json({ token: order.token, order_no: order.order_no, pay_url: url });
      } catch (e) {
        console.error(e.message);
        db.prepare("UPDATE online_orders SET pay_status = 'failed' WHERE id = ?").run(orderId);
        return res.status(201).json({ token: order.token, order_no: order.order_no, pay_error: 'الدفع بالفيزا مش متاح دلوقتي — تقدر تكلمنا أو تختار طريقة دفع تانية' });
      }
    }
    notifyNew(req, order);
    res.status(201).json({ token: order.token, order_no: order.order_no });
  });

  function notifyNew(req, order, extra = '') {
    const cur = getSettings(db).currency || 'ج.م';
    req.app.locals.notifier.notify({
      type: 'online_order', url: `#/orders?open=${order.id}`,
      title: `طلب جديد من الموقع — ${round2(order.total)} ${cur}`,
      body: `${order.customer_name} • ${DELIVERY_AR[order.delivery]}${order.governorate ? ` ${order.governorate}` : ''} • ${PAY_AR[order.payment]}${extra}`,
    });
  }

  const publicOrder = (o) => {
    const st = getSettings(db);
    return {
      order_no: o.order_no, status: o.status, status_ar: STATUS_AR[o.status], pay_status: o.pay_status, payment: o.payment,
      delivery: o.delivery, governorate: o.governorate, address: o.address, delivery_fee: o.delivery_fee, subtotal: o.subtotal, total: o.total,
      created_at: o.created_at, cancel_reason: o.status === 'cancelled' ? o.cancel_reason : null,
      items: db.prepare('SELECT name, qty, unit_price, line_total FROM online_order_items WHERE order_id = ?').all(o.id),
      transfer_info: o.payment === 'transfer' ? st.store_transfer_info || '' : '', has_proof: !!o.transfer_proof,
      whatsapp: st.store_whatsapp || '', currency: st.currency || 'ج.م', title: st.store_title || st.shop_name || '',
    };
  };
  const byToken = (t) => {
    const o = /^[a-f0-9]{32}$/.test(String(t)) && db.prepare('SELECT * FROM online_orders WHERE token = ?').get(t);
    if (!o) throw notFound('الطلب ده مش موجود');
    return o;
  };

  api.get('/store/orders/:token', (req, res) => res.json(publicOrder(byToken(req.params.token))));

  /** The customer uploads a picture of their transfer; staff check it. */
  api.post('/store/orders/:token/proof', (req, res) => {
    const o = byToken(req.params.token);
    if (o.payment !== 'transfer' || o.status === 'cancelled') throw bad('الطلب ده مش محتاج إثبات تحويل');
    if (o.pay_status === 'paid') throw bad('التحويل اتأكد بالفعل');
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.image || ''));
    if (!m || m[2].length > 2_500_000) throw bad('ابعت صورة التحويل (JPG أو PNG)');
    fs.mkdirSync(proofs, { recursive: true });
    const file = `${o.token}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
    fs.writeFileSync(path.join(proofs, file), Buffer.from(m[2], 'base64'));
    db.prepare("UPDATE online_orders SET transfer_proof = ?, pay_status = 'review', updated_at = datetime('now','localtime') WHERE id = ?").run(file, o.id);
    const first = !o.transfer_proof;
    if (first) notifyNew(req, o, ' • العميل بعت صورة التحويل');
    res.json(publicOrder(byToken(o.token)));
  });

  /** Paymob tells us how a card payment went (POST, signed), then sends the customer back (GET, signed). */
  async function paymobResult(req, res) {
    const isGet = req.method === 'GET';
    const src = isGet ? req.query : req.body?.obj || {};
    const v = paymob.verify(db, src, req.query.hmac, { fromQuery: isGet });
    const o = v.paymobOrderId && db.prepare('SELECT * FROM online_orders WHERE paymob_order_id = ?').get(v.paymobOrderId);
    if (v.ok && o && o.pay_status !== 'paid') {
      const paid = v.success && v.amountCents === Math.round(o.total * 100);
      db.prepare("UPDATE online_orders SET pay_status = ?, paymob_txn_id = ?, updated_at = datetime('now','localtime') WHERE id = ?")
        .run(paid ? 'paid' : 'failed', v.txnId || null, o.id);
      if (paid) notifyNew(req, o, ' • مدفوع ✓');
    }
    if (isGet) return res.redirect(o ? `/shop/#/order/${o.token}` : '/shop/');
    res.json({ ok: true });
  }
  api.post('/store/paymob/callback', paymobResult);
  api.get('/store/paymob/callback', paymobResult);

  // ---------------- staff: the orders ----------------
  api.get('/orders/counts', manage, (_req, res) => {
    res.json(db.prepare("SELECT COUNT(*) AS new FROM online_orders WHERE status = 'new' AND NOT (payment = 'card' AND pay_status <> 'paid')").get());
  });

  api.get('/orders', manage, (req, res) => {
    const where = [];
    const params = [];
    if (req.query.status && STATUS_AR[req.query.status]) { where.push('o.status = ?'); params.push(req.query.status); }
    const q = String(req.query.q || '').trim();
    if (q) { where.push('(o.order_no LIKE ? OR o.customer_name LIKE ? OR o.phone LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q.replace(/\D/g, '') || q}%`); }
    res.json(db.prepare(`SELECT o.*, (SELECT SUM(qty) FROM online_order_items WHERE order_id = o.id) AS units
      FROM online_orders o ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.id DESC LIMIT 500`).all(...params));
  });

  const loadOrder = (id) => {
    const o = db.prepare('SELECT o.*, u.full_name AS handled_name, s.invoice_no FROM online_orders o LEFT JOIN users u ON u.id = o.handled_by LEFT JOIN sales s ON s.id = o.sale_id WHERE o.id = ?').get(Number(id));
    if (!o) throw notFound('الطلب غير موجود');
    o.items = db.prepare('SELECT i.*, p.qty AS stock FROM online_order_items i LEFT JOIN products p ON p.id = i.product_id WHERE i.order_id = ?').all(o.id);
    o.proof_url = o.transfer_proof ? `/api/orders/${o.id}/proof` : null;
    delete o.token;
    delete o.ip;
    return o;
  };
  api.get('/orders/:id', manage, (req, res) => res.json(loadOrder(req.params.id)));

  api.get('/orders/:id/proof', manage, (req, res) => {
    const o = db.prepare('SELECT transfer_proof FROM online_orders WHERE id = ?').get(Number(req.params.id));
    if (!o?.transfer_proof) throw notFound('مفيش صورة');
    res.sendFile(path.join(proofs, path.basename(o.transfer_proof)));
  });

  const SALE_METHOD = { cod: 'cash', transfer: 'instapay', card: 'card' };
  const collect = (o, user, note) => {
    // Whatever is still owed on the order's sale is now paid
    if (!o.sale_id) return;
    const { due } = saleMoney(db, o.sale_id);
    if (due > 0.004) {
      db.prepare('INSERT INTO sale_payments (sale_id, amount, method, note, user_id) VALUES (?, ?, ?, ?, ?)')
        .run(o.sale_id, round2(due), SALE_METHOD[o.payment], note, user.id);
    }
  };

  /** Move an order along: confirmed → shipped → delivered, or cancelled. */
  api.post('/orders/:id/status', manage, (req, res) => {
    const o = db.prepare('SELECT * FROM online_orders WHERE id = ?').get(Number(req.params.id));
    if (!o) throw notFound('الطلب غير موجود');
    const to = req.body?.status;
    const NEXT = { new: ['confirmed', 'cancelled'], confirmed: ['shipped', 'delivered', 'cancelled'], shipped: ['delivered', 'cancelled'] };
    if (!(NEXT[o.status] || []).includes(to)) throw bad(`الطلب حالته "${STATUS_AR[o.status]}" — مينفعش يبقى "${STATUS_AR[to] || to}"`);
    const user = req.user;
    const st = getSettings(db);

    if (to === 'confirmed') {
      if (o.payment === 'card' && o.pay_status !== 'paid') throw bad('الطلب ده بالفيزا والدفع لسه متمّش');
      requireOpenShift(db, user);
      // The order becomes a sale: stock leaves now, the money shows as owed until it's paid
      const items = db.prepare('SELECT product_id, qty, unit_price FROM online_order_items WHERE order_id = ?').all(o.id);
      if (items.some((i) => !i.product_id)) throw bad('في منتج في الطلب اتمسح من السيستم');
      const saleId = api.sales.insertSale(user, {
        items: items.map((i) => ({ product_id: i.product_id, qty: i.qty, unit_price: i.unit_price })),
        discount: 0, paid: o.pay_status === 'paid' ? o.subtotal : 0,
        customer_name: o.customer_name, customer_phone: o.phone, notes: `طلب أونلاين ${o.order_no}`,
      }, { paymentMethod: SALE_METHOD[o.payment], settings: st });
      db.prepare("UPDATE online_orders SET status = 'confirmed', sale_id = ?, handled_by = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(saleId, user.id, o.id);
    } else if (to === 'shipped') {
      db.prepare("UPDATE online_orders SET status = 'shipped', handled_by = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(user.id, o.id);
    } else if (to === 'delivered') {
      tx(db, () => {
        collect(o, user, `تحصيل طلب أونلاين ${o.order_no}`);
        db.prepare("UPDATE online_orders SET status = 'delivered', pay_status = 'paid', handled_by = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(user.id, o.id);
      });
    } else if (to === 'cancelled') {
      const reason = str(req.body?.reason, 'سبب الإلغاء', { optional: true, max: 200 });
      if (o.sale_id) {
        // Stock goes back
        const items = db.prepare('SELECT id AS sale_item_id, qty - returned_qty AS qty FROM sale_items WHERE sale_id = ? AND qty > returned_qty').all(o.sale_id);
        if (items.length) api.sales.returnItems(user, o.sale_id, items, `إلغاء طلب أونلاين ${o.order_no}${reason ? ` — ${reason}` : ''}`);
      }
      db.prepare("UPDATE online_orders SET status = 'cancelled', cancel_reason = ?, handled_by = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(reason, user.id, o.id);
    }
    audit(db, user.id, 'order.status', { order: o.order_no, to });
    res.json(loadOrder(o.id));
  });

  /** A transfer checked against the bank / wallet (or a mistake undone). */
  api.post('/orders/:id/paid', manage, (req, res) => {
    const o = db.prepare('SELECT * FROM online_orders WHERE id = ?').get(Number(req.params.id));
    if (!o) throw notFound('الطلب غير موجود');
    if (o.status === 'cancelled') throw bad('الطلب ده اتلغى');
    if (o.payment === 'card') throw bad('دفع الفيزا بيتأكد لوحده من Paymob');
    const paid = req.body?.paid !== false;
    tx(db, () => {
      if (paid) collect(o, req.user, `تحويل طلب أونلاين ${o.order_no}`);
      db.prepare("UPDATE online_orders SET pay_status = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(paid ? 'paid' : 'failed', o.id);
    });
    audit(db, req.user.id, 'order.paid', { order: o.order_no, paid });
    res.json(loadOrder(o.id));
  });

  // ---------------- store settings that aren't plain settings ----------------
  api.get('/store/admin', requirePerm('settings.manage'), (_req, res) => {
    const c = paymob.config(db);
    // Keys are never sent back whole
    const mask = (v) => (v ? `${'•'.repeat(6)}${String(v).slice(-4)}` : '');
    res.json({
      governorates: GOVERNORATES,
      paymob: { ready: c.ready, api_key: mask(c.paymob_api_key), integration_id: c.paymob_integration_id, iframe_id: c.paymob_iframe_id, hmac: mask(c.paymob_hmac) },
    });
  });
  api.put('/store/paymob', requirePerm('settings.manage'), (req, res) => {
    paymob.saveConfig(db, req.body || {});
    audit(db, req.user.id, 'store.paymob');
    res.json({ ready: paymob.config(db).ready });
  });

  // ---------------- store look: banners and category pictures ----------------
  const look = requirePerm('settings.manage');
  const bannersOut = () => db.prepare('SELECT * FROM store_banners ORDER BY kind, sort, id').all().map((b) => ({ ...b, image: pictureUrl(b.image) }));
  api.get('/store/banners', look, (_req, res) => res.json(bannersOut()));
  api.post('/store/banners', look, (req, res) => {
    const kind = req.body?.kind === 'side' ? 'side' : 'slide';
    const count = db.prepare('SELECT COUNT(*) AS n FROM store_banners WHERE kind = ?').get(kind).n;
    if (kind === 'side' && count >= 2) throw bad('البانرات الجانبية اتنين بس — امسح واحد الأول');
    if (count >= 10) throw bad('كفاية 10 صور في السلايدر');
    const file = savePicture(req.body?.image, 'banners', kind);
    db.prepare('INSERT INTO store_banners (kind, image, link, sort) VALUES (?, ?, ?, ?)')
      .run(kind, file, str(req.body?.link, 'اللينك', { optional: true, max: 300 }), count);
    res.status(201).json(bannersOut());
  });
  api.put('/store/banners/:id', look, (req, res) => {
    const b = db.prepare('SELECT * FROM store_banners WHERE id = ?').get(Number(req.params.id));
    if (!b) throw notFound('البانر مش موجود');
    if (req.body?.link !== undefined) db.prepare('UPDATE store_banners SET link = ? WHERE id = ?').run(str(req.body.link, 'اللينك', { optional: true, max: 300 }), b.id);
    if (req.body?.move) {
      // Swap places with the one before / after it
      const list = db.prepare('SELECT id FROM store_banners WHERE kind = ? ORDER BY sort, id').all(b.kind).map((x) => x.id);
      const i = list.indexOf(b.id), j = i + (req.body.move === 'up' ? -1 : 1);
      if (j >= 0 && j < list.length) [list[i], list[j]] = [list[j], list[i]];
      list.forEach((id, k) => db.prepare('UPDATE store_banners SET sort = ? WHERE id = ?').run(k, id));
    }
    res.json(bannersOut());
  });
  api.delete('/store/banners/:id', look, (req, res) => {
    const b = db.prepare('SELECT * FROM store_banners WHERE id = ?').get(Number(req.params.id));
    if (!b) throw notFound('البانر مش موجود');
    db.prepare('DELETE FROM store_banners WHERE id = ?').run(b.id);
    dropPicture(b.image);
    res.json(bannersOut());
  });
  api.post('/categories/:id/image', requirePerm('products.edit'), (req, res) => {
    const c = db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(req.params.id));
    if (!c) throw notFound('القسم غير موجود');
    const file = savePicture(req.body?.image, 'categories', String(c.id));
    dropPicture(c.image);
    db.prepare('UPDATE categories SET image = ? WHERE id = ?').run(file, c.id);
    res.json({ image: pictureUrl(file) });
  });
  api.delete('/categories/:id/image', requirePerm('products.edit'), (req, res) => {
    const c = db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(req.params.id));
    if (!c) throw notFound('القسم غير موجود');
    dropPicture(c.image);
    db.prepare('UPDATE categories SET image = NULL WHERE id = ?').run(c.id);
    res.json({ ok: true });
  });

  // ---------------- product pictures ----------------
  api.post('/products/:id/image', requirePerm('products.edit'), (req, res) => {
    const p = db.prepare('SELECT id, image FROM products WHERE id = ?').get(Number(req.params.id));
    if (!p) throw notFound('المنتج غير موجود');
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.image || ''));
    if (!m || m[2].length > 2_500_000) throw bad('ابعت صورة (JPG أو PNG) أصغر من 2 ميجا');
    fs.mkdirSync(path.join(uploads, 'products'), { recursive: true });
    const file = `products/${p.id}-${Date.now().toString(36)}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
    fs.writeFileSync(path.join(uploads, file), Buffer.from(m[2], 'base64'));
    if (p.image) fs.rm(path.join(uploads, p.image), { force: true }, () => {});
    db.prepare("UPDATE products SET image = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(file, p.id);
    res.json({ image: `/uploads/${file}` });
  });
  api.delete('/products/:id/image', requirePerm('products.edit'), (req, res) => {
    const p = db.prepare('SELECT id, image FROM products WHERE id = ?').get(Number(req.params.id));
    if (!p) throw notFound('المنتج غير موجود');
    if (p.image) fs.rm(path.join(uploads, p.image), { force: true }, () => {});
    db.prepare('UPDATE products SET image = NULL WHERE id = ?').run(p.id);
    res.json({ ok: true });
  });
};

module.exports.GOVERNORATES = GOVERNORATES;
