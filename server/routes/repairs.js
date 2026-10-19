'use strict';
const { tx } = require('../db');
const { requirePerm, can } = require('../auth');
const { bad, notFound, num, str, round2, pad, audit, getSettings } = require('../util');
const { requireOpenShift } = require('./shifts');
const fmtMoney = (v, cur) => `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${cur || 'ج.م'}`;

/*
 * Maintenance tickets (صيانة).
 * Flow: received → diagnosing → waiting_approval → waiting_parts → repairing → ready / not_repaired → delivered
 * Money: deposits and payments are recorded as they happen (cash flow). The repair's revenue and profit
 * count on the day it is delivered: price − parts used from stock − outside costs.
 */
const STATUSES = ['received', 'diagnosing', 'waiting_approval', 'waiting_parts', 'repairing', 'ready', 'not_repaired', 'delivered'];
const WORK_STATUSES = STATUSES.filter((s) => s !== 'delivered');
const METHODS = ['cash', 'card', 'wallet', 'instapay'];

module.exports = function repairRoutes(api, db) {
  const view = requirePerm('repairs.view');

  const LIST_SQL = `
    SELECT r.id, r.ticket_no, r.customer_name, r.customer_phone, r.device, r.imei, r.problem, r.status, r.outcome,
           r.estimated_cost, r.price, r.expected_at, r.created_at, r.updated_at, r.delivered_at,
           t.full_name AS technician_name,
           COALESCE((SELECT SUM(amount) FROM repair_payments p WHERE p.repair_id = r.id), 0) AS paid
    FROM repairs r LEFT JOIN users t ON t.id = r.technician_id`;

  function getRepair(id) {
    const r = db.prepare('SELECT * FROM repairs WHERE id = ?').get(id);
    if (!r) throw notFound('التذكرة غير موجودة');
    return r;
  }

  function event(repairId, status, note, userId) {
    db.prepare('INSERT INTO repair_events (repair_id, status, note, user_id) VALUES (?, ?, ?, ?)')
      .run(repairId, status ?? null, note ?? null, userId);
    db.prepare("UPDATE repairs SET updated_at = datetime('now','localtime') WHERE id = ?").run(repairId);
  }

  function addPayment(repairId, amount, method, kind, userId) {
    db.prepare('INSERT INTO repair_payments (repair_id, amount, method, kind, user_id) VALUES (?, ?, ?, ?, ?)')
      .run(repairId, round2(amount), METHODS.includes(method) ? method : 'cash', kind, userId);
  }

  const paidOf = (id) => db.prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM repair_payments WHERE repair_id = ?').get(id).s;

  function load(id, user) {
    const r = db.prepare(`SELECT r.*, t.full_name AS technician_name, c.full_name AS created_by_name
      FROM repairs r LEFT JOIN users t ON t.id = r.technician_id LEFT JOIN users c ON c.id = r.created_by
      WHERE r.id = ?`).get(id);
    if (!r) throw notFound('التذكرة غير موجودة');
    r.parts = db.prepare('SELECT id, product_id, name, qty, unit_cost, created_at FROM repair_parts WHERE repair_id = ? ORDER BY id').all(r.id);
    r.payments = db.prepare(`SELECT p.id, p.amount, p.method, p.kind, p.created_at, u.full_name AS user_name
      FROM repair_payments p LEFT JOIN users u ON u.id = p.user_id WHERE p.repair_id = ? ORDER BY p.id`).all(r.id);
    r.events = db.prepare(`SELECT e.id, e.status, e.note, e.created_at, u.full_name AS user_name
      FROM repair_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.repair_id = ? ORDER BY e.id`).all(r.id);
    r.paid = round2(r.payments.reduce((s, p) => s + p.amount, 0));
    r.balance = round2((r.price ?? r.estimated_cost ?? 0) - r.paid);
    if (can(user, 'products.view_cost')) {
      r.parts_cost = round2(r.parts.reduce((s, p) => s + p.unit_cost * p.qty, 0));
      r.profit = r.price != null ? round2(r.price - r.parts_cost - r.extra_cost) : null;
    } else {
      r.parts.forEach((p) => delete p.unit_cost);
      delete r.extra_cost;
    }
    return r;
  }

  const locked = (r) => { if (r.status === 'delivered') throw bad('الجهاز اتسلم للعميل — التذكرة مقفولة'); };

  // ---------- lists ----------
  api.get('/repairs', view, (req, res) => {
    const where = [];
    const params = [];
    const q = String(req.query.q || '').trim();
    if (q) {
      where.push('(r.ticket_no LIKE ? OR r.customer_phone LIKE ? OR r.customer_name LIKE ? OR r.imei LIKE ? OR r.device LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    const status = String(req.query.status || 'open');
    if (status === 'open') where.push("r.status <> 'delivered'");
    else if (STATUSES.includes(status)) { where.push('r.status = ?'); params.push(status); }
    if (req.query.mine === '1') { where.push('r.technician_id = ?'); params.push(req.user.id); }
    const limit = status === 'delivered' || status === 'all' ? 300 : 1000;
    res.json(db.prepare(`${LIST_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY CASE r.status WHEN 'ready' THEN 0 WHEN 'not_repaired' THEN 0 ELSE 1 END, r.id DESC LIMIT ${limit}`).all(...params)
      .map((r) => ({ ...r, paid: round2(r.paid) })));
  });

  api.get('/repairs/summary', view, (_req, res) => {
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM repairs GROUP BY status').all()) counts[r.status] = r.n;
    const overdue = db.prepare(`SELECT COUNT(*) AS n FROM repairs WHERE status NOT IN ('delivered','ready','not_repaired')
                                AND expected_at IS NOT NULL AND expected_at < date('now','localtime')`).get().n;
    res.json({ counts, open: STATUSES.slice(0, -1).reduce((s, k) => s + counts[k], 0), overdue });
  });

  api.get('/repairs/technicians', view, (_req, res) => {
    res.json(db.prepare(`SELECT id, full_name, role FROM users WHERE active = 1 AND role IN ('technician','manager','admin')
                         ORDER BY role = 'technician' DESC, full_name`).all());
  });

  /** Previous tickets of a phone number, to recognise returning customers. */
  api.get('/repairs/customer', view, (req, res) => {
    const phone = String(req.query.phone || '').trim();
    if (phone.length < 6) return res.json({ name: null, history: [] });
    const history = db.prepare(`${LIST_SQL} WHERE r.customer_phone = ? ORDER BY r.id DESC LIMIT 10`).all(phone);
    res.json({ name: history[0]?.customer_name || null, history });
  });

  api.get('/repairs/:id', view, (req, res) => res.json(load(req.params.id, req.user)));

  // ---------- intake ----------
  api.post('/repairs', requirePerm('repairs.create'), (req, res) => {
    const b = req.body || {};
    const settings = getSettings(db);
    requireOpenShift(db, req.user);
    const id = tx(db, () => {
      const f = intakeFields(b);
      const technicianId = num(b.technician_id, 'الفني', { optional: true, int: true });
      const r = db.prepare(`INSERT INTO repairs (customer_name, customer_phone, device, imei, passcode, problem, condition_notes,
          accessories, estimated_cost, expected_at, technician_id, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        f.customer_name, f.customer_phone, f.device, f.imei, f.passcode, f.problem, f.condition_notes,
        f.accessories, f.estimated_cost, f.expected_at, technicianId, f.notes, req.user.id);
      const id = Number(r.lastInsertRowid);
      db.prepare('UPDATE repairs SET ticket_no = ? WHERE id = ?').run(`${settings.repair_prefix || 'R-'}${pad(id, 6)}`, id);
      event(id, 'received', 'استلام الجهاز', req.user.id);
      const deposit = num(b.deposit, 'العربون', { optional: true, min: 0 }) || 0;
      if (deposit > 0) {
        if (!can(req.user, 'repairs.cash')) throw bad('مش مسموحلك تستلم فلوس');
        addPayment(id, deposit, b.deposit_method, 'deposit', req.user.id);
      }
      return id;
    });
    audit(db, req.user.id, 'repair.create', { id });
    const r = load(id, req.user);
    req.app.locals.notifier.notify({
      type: 'repair_in', actorId: req.user.id, url: `#/repairs?open=${id}`,
      title: `استلام جهاز صيانة — ${r.device}`,
      body: `${req.user.full_name} استلم من ${r.customer_name} • ${r.problem}${r.paid ? ` • عربون ${fmtMoney(r.paid, settings.currency)}` : ''} • ${r.ticket_no}`,
    });
    res.status(201).json(r);
  });

  api.put('/repairs/:id', view, (req, res) => {
    const b = req.body || {};
    tx(db, () => {
      const r = getRepair(req.params.id);
      locked(r);
      const sets = [];
      const vals = [];
      const intakeKeys = ['customer_name', 'customer_phone', 'device', 'imei', 'passcode', 'problem', 'condition_notes', 'accessories', 'estimated_cost', 'expected_at', 'notes'];
      if (intakeKeys.some((k) => b[k] !== undefined)) {
        if (!can(req.user, 'repairs.create')) throw bad('ليس لديك صلاحية لتعديل بيانات الاستلام');
        const f = intakeFields({ ...r, ...b });
        for (const k of intakeKeys) if (b[k] !== undefined) { sets.push(`${k} = ?`); vals.push(f[k]); }
      }
      const workKeys = ['diagnosis', 'price', 'extra_cost', 'technician_id', 'warranty_days'];
      if (workKeys.some((k) => b[k] !== undefined)) {
        if (!can(req.user, 'repairs.work')) throw bad('ليس لديك صلاحية لتعديل التشخيص أو السعر');
        if (b.diagnosis !== undefined) { sets.push('diagnosis = ?'); vals.push(str(b.diagnosis, 'التشخيص', { optional: true, max: 1000 })); }
        if (b.price !== undefined) { sets.push('price = ?'); vals.push(num(b.price, 'سعر الصيانة', { optional: true, min: 0 })); }
        if (b.extra_cost !== undefined) {
          if (!can(req.user, 'products.view_cost')) throw bad('ليس لديك صلاحية لتعديل التكاليف');
          sets.push('extra_cost = ?'); vals.push(num(b.extra_cost, 'التكاليف الخارجية', { optional: true, min: 0 }) || 0);
        }
        if (b.technician_id !== undefined) { sets.push('technician_id = ?'); vals.push(num(b.technician_id, 'الفني', { optional: true, int: true })); }
        if (b.warranty_days !== undefined) { sets.push('warranty_days = ?'); vals.push(num(b.warranty_days, 'أيام الضمان', { optional: true, min: 0, int: true }) || 0); }
      }
      if (!sets.length) return;
      db.prepare(`UPDATE repairs SET ${sets.join(', ')}, updated_at = datetime('now','localtime') WHERE id = ?`).run(...vals, r.id);
      const newPrice = db.prepare('SELECT price FROM repairs WHERE id = ?').get(r.id).price;
      if (newPrice !== r.price && newPrice != null) event(r.id, null, `السعر: ${round2(newPrice)}`, req.user.id);
    });
    res.json(load(req.params.id, req.user));
  });

  // ---------- workflow ----------
  api.post('/repairs/:id/status', requirePerm('repairs.work'), (req, res) => {
    const status = String(req.body?.status || '');
    if (!WORK_STATUSES.includes(status)) throw bad('الحالة غير صحيحة');
    const note = str(req.body?.note, 'الملاحظة', { optional: true, max: 500 });
    tx(db, () => {
      const r = getRepair(req.params.id);
      locked(r);
      const outcome = status === 'ready' ? 'repaired' : status === 'not_repaired' ? 'not_repaired' : null;
      db.prepare('UPDATE repairs SET status = ?, outcome = ? WHERE id = ?').run(status, outcome, r.id);
      event(r.id, status, note, req.user.id);
    });
    res.json(load(req.params.id, req.user));
  });

  api.post('/repairs/:id/notes', view, (req, res) => {
    const note = str(req.body?.note, 'الملاحظة', { max: 500 });
    getRepair(req.params.id);
    event(Number(req.params.id), null, note, req.user.id);
    res.json(load(req.params.id, req.user));
  });

  // ---------- parts from stock ----------
  api.post('/repairs/:id/parts', requirePerm('repairs.work'), (req, res) => {
    tx(db, () => {
      const r = getRepair(req.params.id);
      locked(r);
      const p = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(num(req.body?.product_id, 'القطعة', { int: true }));
      if (!p) throw bad('القطعة غير موجودة');
      if (p.has_serial) throw bad('الأجهزة اللي بـ IMEI مينفعش تتصرف كقطع غيار');
      const qty = num(req.body?.qty ?? 1, 'الكمية', { min: 1, int: true });
      if (qty > p.qty) throw bad(`المتاح من "${p.name}" ${p.qty} بس`);
      db.prepare('INSERT INTO repair_parts (repair_id, product_id, name, qty, unit_cost, user_id) VALUES (?, ?, ?, ?, ?, ?)')
        .run(r.id, p.id, p.name, qty, p.cost_price, req.user.id);
      const after = p.qty - qty;
      db.prepare("UPDATE products SET qty = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(after, p.id);
      db.prepare(`INSERT INTO stock_movements (product_id, type, qty_change, qty_after, ref_id, note, user_id)
                  VALUES (?, 'repair', ?, ?, ?, ?, ?)`).run(p.id, -qty, after, r.id, `صيانة ${r.ticket_no}`, req.user.id);
      event(r.id, null, `قطعة غيار: ${p.name} × ${qty}`, req.user.id);
    });
    res.json(load(req.params.id, req.user));
  });

  api.delete('/repairs/:id/parts/:partId', requirePerm('repairs.work'), (req, res) => {
    tx(db, () => {
      const r = getRepair(req.params.id);
      locked(r);
      const part = db.prepare('SELECT * FROM repair_parts WHERE id = ? AND repair_id = ?').get(req.params.partId, r.id);
      if (!part) throw notFound('القطعة غير موجودة');
      db.prepare('DELETE FROM repair_parts WHERE id = ?').run(part.id);
      const { qty } = db.prepare('SELECT qty FROM products WHERE id = ?').get(part.product_id);
      db.prepare('UPDATE products SET qty = ? WHERE id = ?').run(qty + part.qty, part.product_id);
      db.prepare(`INSERT INTO stock_movements (product_id, type, qty_change, qty_after, ref_id, note, user_id)
                  VALUES (?, 'repair', ?, ?, ?, ?, ?)`).run(part.product_id, part.qty, qty + part.qty, r.id, `رجوع قطعة من ${r.ticket_no}`, req.user.id);
      event(r.id, null, `إرجاع قطعة للمخزن: ${part.name} × ${part.qty}`, req.user.id);
    });
    res.json(load(req.params.id, req.user));
  });

  // ---------- money ----------
  api.post('/repairs/:id/payments', requirePerm('repairs.cash'), (req, res) => {
    tx(db, () => {
      const r = getRepair(req.params.id);
      const kind = req.body?.kind === 'refund' ? 'refund' : r.status === 'delivered' ? 'payment' : (req.body?.kind === 'payment' ? 'payment' : 'deposit');
      const amount = num(req.body?.amount, 'المبلغ', { min: 0.01 });
      if (kind === 'refund' && amount > paidOf(r.id) + 0.001) throw bad('المبلغ المرتجع أكبر من المدفوع');
      addPayment(r.id, kind === 'refund' ? -amount : amount, req.body?.method, kind, req.user.id);
      event(r.id, null, `${kind === 'refund' ? 'رد للعميل' : kind === 'deposit' ? 'عربون' : 'دفعة'}: ${round2(amount)}`, req.user.id);
    });
    res.json(load(req.params.id, req.user));
  });

  /** Hand the device back to the customer, collecting what's left. */
  api.post('/repairs/:id/deliver', requirePerm('repairs.cash'), (req, res) => {
    const b = req.body || {};
    tx(db, () => {
      const r = getRepair(req.params.id);
      locked(r);
      if (!['ready', 'not_repaired'].includes(r.status)) throw bad('الجهاز لسه مش جاهز للتسليم');
      if (r.status === 'ready' && r.price == null) throw bad('حدد سعر الصيانة الأول');
      const price = r.price ?? 0;
      const amount = num(b.amount, 'المبلغ', { optional: true, min: 0 }) || 0;
      if (amount > 0) addPayment(r.id, amount, b.method, 'payment', req.user.id);
      const left = round2(price - paidOf(r.id));
      if (left > 0.004 && !b.allow_due) throw bad(`لسه فاضل ${left} على العميل`);
      if (left < -0.004) throw bad(`المدفوع أكتر من السعر بـ ${-left} — سجّل رد للعميل الأول`);
      const warranty = b.warranty_days !== undefined ? num(b.warranty_days, 'أيام الضمان', { optional: true, min: 0, int: true }) || 0 : r.warranty_days;
      db.prepare(`UPDATE repairs SET status = 'delivered', delivered_at = datetime('now','localtime'), warranty_days = ?,
                  outcome = COALESCE(outcome, 'repaired') WHERE id = ?`).run(r.status === 'ready' ? warranty : 0, r.id);
      event(r.id, 'delivered', left > 0.004 ? `اتسلم — متبقي على العميل ${left}` : 'اتسلم للعميل', req.user.id);
      audit(db, req.user.id, 'repair.deliver', { ticket: r.ticket_no, price, due: left > 0 ? left : 0 });
    });
    const r = load(req.params.id, req.user);
    const cur = getSettings(db).currency;
    req.app.locals.notifier.notify({
      type: 'repair_out', actorId: req.user.id, url: `#/repairs?open=${r.id}`,
      title: `تسليم جهاز صيانة — ${r.device}`,
      body: `${req.user.full_name} سلّم لـ ${r.customer_name} • ${r.outcome === 'not_repaired' ? 'من غير تصليح' : `الحساب ${fmtMoney(r.price ?? 0, cur)}`}${r.balance > 0.004 ? ` • آجل ${fmtMoney(r.balance, cur)}` : ''} • ${r.ticket_no}`,
    });
    res.json(r);
  });

  function intakeFields(b) {
    const phone = str(b.customer_phone, 'تليفون العميل', { max: 30 });
    if (!/^[0-9+\s-]{6,}$/.test(phone)) throw bad('رقم التليفون غير صحيح');
    const expected = b.expected_at ? String(b.expected_at) : null;
    if (expected && !/^\d{4}-\d{2}-\d{2}$/.test(expected)) throw bad('تاريخ التسليم غير صحيح');
    return {
      customer_name: str(b.customer_name, 'اسم العميل', { max: 80 }),
      customer_phone: phone.replace(/\s|-/g, ''),
      device: str(b.device, 'الجهاز', { max: 100 }),
      imei: str(b.imei, 'IMEI', { optional: true, max: 40 }),
      passcode: str(b.passcode, 'رمز القفل', { optional: true, max: 60 }),
      problem: str(b.problem, 'العطل', { max: 1000 }),
      condition_notes: str(b.condition_notes, 'حالة الجهاز', { optional: true, max: 500 }),
      accessories: str(b.accessories, 'المستلم مع الجهاز', { optional: true, max: 300 }),
      estimated_cost: num(b.estimated_cost, 'التكلفة المتوقعة', { optional: true, min: 0 }),
      expected_at: expected,
      notes: str(b.notes, 'الملاحظات', { optional: true, max: 1000 }),
    };
  }
};

module.exports.STATUSES = STATUSES;
