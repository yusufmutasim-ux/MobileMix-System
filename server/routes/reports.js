'use strict';
const { requireAuth, requirePerm, can } = require('../auth');
const { round2, dateRange, today } = require('../util');

/*
 * Money rules used everywhere:
 *  - Net revenue of an item = line_total × (sale.total / sale.subtotal)  (invoice discount spread over items)
 *  - Profit = net revenue − unit_cost × qty
 *  - Returns are counted on the day they happen (amount and cost both reversed).
 */
const NET = 'si.line_total * (CASE WHEN s.subtotal > 0 THEN s.total / s.subtotal ELSE 0 END)';

module.exports = function reportRoutes(api, db) {
  api.get('/reports/sales', requirePerm('reports.view'), (req, res) => {
    const { from, to } = dateRange(req.query);
    const userId = req.query.user_id ? Number(req.query.user_id) : null;
    const userSql = userId ? 'AND s.user_id = ?' : '';
    const base = (extra = []) => (userId ? [from, to, userId, ...extra] : [from, to, ...extra]);
    const inRange = `date(s.created_at) BETWEEN ? AND ? ${userSql}`;

    const totals = db.prepare(`
      SELECT COUNT(*) AS invoices, COALESCE(SUM(s.total), 0) AS gross, COALESCE(SUM(s.discount), 0) AS discounts
      FROM sales s WHERE ${inRange}`).get(...base());
    const cost = db.prepare(`
      SELECT COALESCE(SUM(si.unit_cost * si.qty), 0) AS cost, COALESCE(SUM(si.qty), 0) AS units
      FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE ${inRange}`).get(...base());
    const rets = db.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(r.amount), 0) AS amount, COALESCE(SUM(r.cost), 0) AS cost
      FROM returns r ${userId ? 'JOIN sales s ON s.id = r.sale_id' : ''}
      WHERE date(r.created_at) BETWEEN ? AND ? ${userId ? 'AND s.user_id = ?' : ''}`).get(...base());

    const net = totals.gross - rets.amount;
    const profit = net - (cost.cost - rets.cost);

    const byDay = db.prepare(`
      SELECT date(s.created_at) AS day, COUNT(*) AS invoices, SUM(s.total) AS total
      FROM sales s WHERE ${inRange} GROUP BY day ORDER BY day`).all(...base());
    const profitByDay = Object.fromEntries(db.prepare(`
      SELECT date(s.created_at) AS day, SUM(${NET} - si.unit_cost * si.qty) AS profit
      FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE ${inRange} GROUP BY day`).all(...base())
      .map((r) => [r.day, r.profit]));
    byDay.forEach((d) => { d.profit = round2(profitByDay[d.day] || 0); d.total = round2(d.total); });

    const byUser = db.prepare(`
      SELECT u.id, u.full_name, COUNT(*) AS invoices, SUM(s.total) AS total,
        SUM((SELECT SUM(${NET} - si.unit_cost * si.qty) FROM sale_items si WHERE si.sale_id = s.id)) AS profit
      FROM sales s JOIN users u ON u.id = s.user_id WHERE ${inRange}
      GROUP BY u.id ORDER BY total DESC`).all(...base());

    const byPayment = db.prepare(`
      SELECT s.payment_method AS method, COUNT(*) AS invoices, SUM(s.total) AS total
      FROM sales s WHERE ${inRange} GROUP BY s.payment_method ORDER BY total DESC`).all(...base());

    const topProducts = db.prepare(`
      SELECT si.product_id, si.name, SUM(si.qty) AS qty, SUM(${NET}) AS revenue, SUM(${NET} - si.unit_cost * si.qty) AS profit
      FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE ${inRange}
      GROUP BY si.product_id ORDER BY revenue DESC LIMIT 20`).all(...base());

    const byCategory = db.prepare(`
      SELECT COALESCE(c.name, 'بدون قسم') AS category, SUM(si.qty) AS qty, SUM(${NET}) AS revenue,
             SUM(${NET} - si.unit_cost * si.qty) AS profit
      FROM sale_items si JOIN sales s ON s.id = si.sale_id
      JOIN products p ON p.id = si.product_id LEFT JOIN categories c ON c.id = p.category_id
      WHERE ${inRange} GROUP BY c.id ORDER BY revenue DESC`).all(...base());

    const r2 = (rows, keys) => rows.map((r) => { keys.forEach((k) => { r[k] = round2(r[k] || 0); }); return r; });
    res.json({
      from, to,
      totals: {
        invoices: totals.invoices,
        units: cost.units,
        gross: round2(totals.gross),
        discounts: round2(totals.discounts),
        returns: round2(rets.amount),
        returns_count: rets.count,
        net: round2(net),
        cost: round2(cost.cost - rets.cost),
        profit: round2(profit),
        avg_invoice: totals.invoices ? round2(totals.gross / totals.invoices) : 0,
      },
      by_day: byDay,
      by_user: r2(byUser, ['total', 'profit']),
      by_payment: r2(byPayment, ['total']),
      top_products: r2(topProducts, ['revenue', 'profit']),
      by_category: r2(byCategory, ['revenue', 'profit']),
    });
  });

  api.get('/reports/inventory', requirePerm('reports.view'), (_req, res) => {
    const byCategory = db.prepare(`
      SELECT COALESCE(c.name, 'بدون قسم') AS category, COUNT(p.id) AS products, SUM(p.qty) AS qty,
             SUM(p.qty * p.cost_price) AS cost_value, SUM(p.qty * p.sell_price) AS sell_value
      FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.active = 1 GROUP BY c.id ORDER BY cost_value DESC`).all();
    const low = db.prepare(`
      SELECT p.id, p.name, p.brand, p.qty, p.min_qty, c.name AS category_name
      FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.active = 1 AND p.qty <= p.min_qty ORDER BY p.qty, p.name`).all();
    const stale = db.prepare(`
      SELECT p.id, p.name, p.qty, p.qty * p.cost_price AS cost_value,
        (SELECT MAX(s.created_at) FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE si.product_id = p.id) AS last_sold
      FROM products p WHERE p.active = 1 AND p.qty > 0
      AND NOT EXISTS (SELECT 1 FROM sale_items si JOIN sales s ON s.id = si.sale_id
                      WHERE si.product_id = p.id AND s.created_at >= datetime('now','localtime','-60 days'))
      ORDER BY cost_value DESC LIMIT 50`).all();
    const sum = (k) => round2(byCategory.reduce((s, r) => s + (r[k] || 0), 0));
    byCategory.forEach((r) => { r.cost_value = round2(r.cost_value || 0); r.sell_value = round2(r.sell_value || 0); });
    res.json({
      totals: { products: sum('products'), qty: sum('qty'), cost_value: sum('cost_value'), sell_value: sum('sell_value') },
      by_category: byCategory,
      low_stock: low,
      stale: stale.map((r) => ({ ...r, cost_value: round2(r.cost_value) })),
    });
  });

  api.get('/reports/movements', requirePerm('reports.view'), (req, res) => {
    const { from, to } = dateRange(req.query);
    const type = ['purchase', 'sale', 'return', 'adjust', 'stocktake'].includes(req.query.type) ? req.query.type : null;
    res.json(db.prepare(`
      SELECT m.*, p.name AS product_name, u.full_name AS user_name
      FROM stock_movements m JOIN products p ON p.id = m.product_id LEFT JOIN users u ON u.id = m.user_id
      WHERE date(m.created_at) BETWEEN ? AND ? ${type ? 'AND m.type = ?' : ''}
      ORDER BY m.id DESC LIMIT 1000`).all(...(type ? [from, to, type] : [from, to])));
  });

  /** Maintenance: revenue/profit counted on delivery day; cash counted on payment day. */
  api.get('/reports/repairs', requirePerm('reports.view'), (req, res) => {
    const { from, to } = dateRange(req.query);
    const delivered = `r.status = 'delivered' AND date(r.delivered_at) BETWEEN ? AND ?`;
    const PARTS = '(SELECT COALESCE(SUM(qty * unit_cost), 0) FROM repair_parts WHERE repair_id = r.id)';
    const t = db.prepare(`
      SELECT COUNT(*) AS delivered,
             SUM(CASE WHEN r.outcome = 'repaired' THEN 1 ELSE 0 END) AS repaired,
             COALESCE(SUM(r.price), 0) AS revenue,
             COALESCE(SUM(${PARTS}), 0) AS parts_cost,
             COALESCE(SUM(r.extra_cost), 0) AS extra_cost
      FROM repairs r WHERE ${delivered}`).get(from, to);
    const received = db.prepare('SELECT COUNT(*) AS n FROM repairs WHERE date(created_at) BETWEEN ? AND ?').get(from, to).n;
    const cash = db.prepare(`SELECT method, SUM(amount) AS total, COUNT(*) AS count FROM repair_payments
                             WHERE date(created_at) BETWEEN ? AND ? GROUP BY method ORDER BY total DESC`).all(from, to);
    const byTech = db.prepare(`
      SELECT COALESCE(u.full_name, 'بدون فني') AS full_name, COUNT(*) AS delivered,
             SUM(CASE WHEN r.outcome = 'repaired' THEN 1 ELSE 0 END) AS repaired,
             COALESCE(SUM(r.price), 0) AS revenue,
             COALESCE(SUM(COALESCE(r.price, 0) - ${PARTS} - r.extra_cost), 0) AS profit
      FROM repairs r LEFT JOIN users u ON u.id = r.technician_id WHERE ${delivered}
      GROUP BY r.technician_id ORDER BY revenue DESC`).all(from, to);
    const open = db.prepare("SELECT status, COUNT(*) AS n FROM repairs WHERE status <> 'delivered' GROUP BY status").all();
    const dues = db.prepare(`
      SELECT r.id, r.ticket_no, r.customer_name, r.customer_phone, r.device, r.delivered_at,
             COALESCE(r.price, 0) - COALESCE((SELECT SUM(amount) FROM repair_payments WHERE repair_id = r.id), 0) AS due
      FROM repairs r WHERE r.status = 'delivered' AND due > 0.004 ORDER BY r.delivered_at DESC LIMIT 100`).all();
    const deposits = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS s FROM repair_payments p JOIN repairs r ON r.id = p.repair_id
                                 WHERE r.status <> 'delivered'`).get().s;
    res.json({
      from, to,
      totals: {
        received, delivered: t.delivered, repaired: t.repaired || 0,
        revenue: round2(t.revenue), parts_cost: round2(t.parts_cost), extra_cost: round2(t.extra_cost),
        profit: round2(t.revenue - t.parts_cost - t.extra_cost),
        cash_in: round2(cash.reduce((s, c) => s + c.total, 0)),
        deposits_held: round2(deposits),
        dues: round2(dues.reduce((s, d) => s + d.due, 0)),
      },
      cash: cash.map((c) => ({ ...c, total: round2(c.total) })),
      by_technician: byTech.map((x) => ({ ...x, revenue: round2(x.revenue), profit: round2(x.profit) })),
      open,
      dues: dues.map((d) => ({ ...d, due: round2(d.due) })),
    });
  });

  /** Home screen numbers. Cashiers see only their own sales and no profit. */
  api.get('/dashboard', requireAuth, (req, res) => {
    const all = can(req.user, 'sales.view_all');
    const mine = all ? '' : 'AND s.user_id = ?';
    const args = all ? [today()] : [today(), req.user.id];
    const t = db.prepare(`SELECT COUNT(*) AS invoices, COALESCE(SUM(total), 0) AS total FROM sales s
                          WHERE date(s.created_at) = ? ${mine}`).get(...args);
    const out = { today: { invoices: t.invoices, total: round2(t.total) } };
    if (can(req.user, 'reports.view')) {
      const p = db.prepare(`SELECT COALESCE(SUM(${NET} - si.unit_cost * si.qty), 0) AS profit
                            FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE date(s.created_at) = ?`).get(today());
      const r = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS amount, COALESCE(SUM(cost), 0) AS cost
                            FROM returns WHERE date(created_at) = ?`).get(today());
      out.today.returns = round2(r.amount);
      out.today.profit = round2(p.profit - (r.amount - r.cost));
      out.week = db.prepare(`SELECT date(created_at) AS day, SUM(total) AS total FROM sales
                             WHERE date(created_at) >= date('now','localtime','-6 days') GROUP BY day ORDER BY day`).all()
        .map((d) => ({ day: d.day, total: round2(d.total) }));
    }
    if (can(req.user, 'products.view')) {
      out.low_stock = db.prepare('SELECT COUNT(*) AS n FROM products WHERE active = 1 AND qty <= min_qty').get().n;
      out.products = db.prepare('SELECT COUNT(*) AS n FROM products WHERE active = 1').get().n;
    }
    if (can(req.user, 'repairs.view')) {
      const r = db.prepare(`SELECT
          SUM(CASE WHEN status <> 'delivered' THEN 1 ELSE 0 END) AS open,
          SUM(CASE WHEN status IN ('ready','not_repaired') THEN 1 ELSE 0 END) AS ready,
          SUM(CASE WHEN date(created_at) = ? THEN 1 ELSE 0 END) AS received_today
        FROM repairs`).get(today());
      out.repairs = { open: r.open || 0, ready: r.ready || 0, received_today: r.received_today || 0 };
      if (can(req.user, 'repairs.cash')) {
        out.repairs.cash_today = round2(db.prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM repair_payments WHERE date(created_at) = ?').get(today()).s);
      }
    }
    if (!can(req.user, 'sales.create')) {
      out.recent = [];
      return res.json(out);
    }
    out.recent = db.prepare(`
      SELECT s.id, s.invoice_no, s.total, s.status, s.payment_method, s.created_at, s.customer_name, u.full_name AS user_name
      FROM sales s JOIN users u ON u.id = s.user_id WHERE 1 = 1 ${mine} ORDER BY s.id DESC LIMIT 8`)
      .all(...(all ? [] : [req.user.id]));
    res.json(out);
  });
};
