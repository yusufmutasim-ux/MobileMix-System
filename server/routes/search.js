'use strict';
const { requireAuth, requirePerm, can } = require('../auth');
const { round2, today } = require('../util');
const { cleanPhone, DUE_SQL } = require('../money');

/** One search box for everything (products, invoices, repairs, customers, suppliers) + warranty lookup. */
module.exports = function searchRoutes(api, db) {
  api.get('/search', requireAuth, (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 60);
    if (q.length < 2) return res.json({ q, groups: [] });
    const like = `%${q}%`;
    const digits = cleanPhone(q);
    // Phone matching only when the search has enough digits in it
    const phoneLike = digits.length >= 4 ? `%${digits}%` : null;
    const PHONE = (col) => (phoneLike ? `digits(${col}) LIKE ?` : '0');
    const ph = phoneLike ? [phoneLike] : [];
    const groups = [];

    if (can(req.user, 'products.view')) {
      const rows = db.prepare(`
        SELECT p.id, p.name, p.brand, p.qty, p.sell_price FROM products p
        WHERE p.active = 1 AND (p.name LIKE ? OR p.brand LIKE ? OR p.barcode = ?
          OR p.id IN (SELECT product_id FROM serials WHERE serial = ?))
        ORDER BY (p.barcode = ?) DESC, p.name LIMIT 6`).all(like, like, q, q, q);
      if (rows.length) groups.push({ kind: 'products', title: 'المنتجات', items: rows.map((p) => ({ title: p.name, sub: `${p.brand ? `${p.brand} • ` : ''}الكمية ${p.qty} • ${p.sell_price}`, url: `#/products?open=${p.id}` })) });
    }
    if (can(req.user, 'sales.create')) {
      const mine = can(req.user, 'sales.view_all') ? '' : 'AND s.user_id = ?';
      const rows = db.prepare(`
        SELECT s.id, s.invoice_no, s.customer_name, s.total, s.created_at, ${DUE_SQL} AS due FROM sales s
        WHERE (s.invoice_no LIKE ? OR s.customer_name LIKE ? OR ${PHONE('s.customer_phone')}
          OR s.id IN (SELECT sale_id FROM sale_items WHERE serial = ?)) ${mine}
        ORDER BY s.id DESC LIMIT 6`).all(like, like, ...ph, q, ...(mine ? [req.user.id] : []));
      if (rows.length) groups.push({ kind: 'sales', title: 'الفواتير', items: rows.map((s) => ({ title: s.invoice_no, sub: `${s.customer_name || 'عميل'} • ${s.total} • ${s.created_at.slice(0, 10)}${s.due > 0 ? ` • متبقي ${round2(s.due)}` : ''}`, url: `#/sales?open=${s.id}` })) });
    }
    if (can(req.user, 'repairs.view')) {
      const rows = db.prepare(`
        SELECT id, ticket_no, customer_name, device, status FROM repairs
        WHERE ticket_no LIKE ? OR customer_name LIKE ? OR ${PHONE('customer_phone')} OR imei = ? OR device LIKE ?
        ORDER BY id DESC LIMIT 6`).all(like, like, ...ph, q, like);
      if (rows.length) groups.push({ kind: 'repairs', title: 'الصيانة', items: rows.map((r) => ({ title: `${r.ticket_no} — ${r.device}`, sub: r.customer_name, url: `#/repairs?open=${r.id}` })) });
    }
    if (can(req.user, 'customers.view')) {
      const rows = db.prepare(`SELECT id, name, phone FROM customers WHERE name LIKE ? OR ${PHONE('phone')} ORDER BY id DESC LIMIT 6`).all(like, ...ph);
      if (rows.length) groups.push({ kind: 'customers', title: 'العملاء', items: rows.map((c) => ({ title: c.name, sub: c.phone, url: `#/customers/${c.id}` })) });
    }
    if (can(req.user, 'purchases.manage')) {
      const rows = db.prepare(`SELECT id, name, phone FROM suppliers WHERE name LIKE ? OR ${PHONE('phone')} LIMIT 4`).all(like, ...ph);
      if (rows.length) groups.push({ kind: 'suppliers', title: 'الموردين', items: rows.map((s) => ({ title: s.name, sub: s.phone || '', url: `#/purchases?supplier=${s.id}` })) });
    }
    res.json({ q, groups });
  });

  /** Is this phone/item still under warranty? Look up by IMEI / serial or invoice number. */
  api.get('/warranty', requirePerm('sales.create'), (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ q, items: [] });
    const rows = db.prepare(`
      SELECT si.id, si.name, si.serial, si.qty, si.returned_qty, si.warranty_days, si.unit_price,
             s.id AS sale_id, s.invoice_no, s.customer_name, s.customer_phone, s.created_at
      FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE si.serial = ? OR s.invoice_no = ? OR s.invoice_no LIKE ?
      ORDER BY s.id DESC LIMIT 50`).all(q, q, `%${q}`);
    const t = today();
    res.json({
      q,
      items: rows.map((r) => {
        let until = null, state = 'none';
        if (r.warranty_days > 0) {
          const d = new Date(`${r.created_at.slice(0, 10)}T12:00:00`);
          d.setDate(d.getDate() + r.warranty_days);
          until = d.toISOString().slice(0, 10);
          state = until >= t ? 'active' : 'expired';
        }
        if (r.returned_qty >= r.qty) state = 'returned';
        const daysLeft = until ? Math.round((new Date(`${until}T12:00:00`) - new Date(`${t}T12:00:00`)) / 86400000) : null;
        return { ...r, until, state, days_left: daysLeft };
      }),
    });
  });
};
