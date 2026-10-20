'use strict';
const { getSettings, today, round2 } = require('./util');
const { drawerNow, lateInstallments } = require('./money');

const fmt = (v, cur) => `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${cur || 'ج.م'}`;
const NET = 'si.line_total * (CASE WHEN s.subtotal > 0 THEN s.total / s.subtotal ELSE 0 END)';

/** The day in numbers, for the owner's phone. */
function daySummary(db, day = today()) {
  const sales = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS t FROM sales WHERE date(created_at) = ?').get(day);
  const profit = db.prepare(`SELECT COALESCE(SUM(${NET} - si.unit_cost * si.qty), 0) AS p FROM sale_items si JOIN sales s ON s.id = si.sale_id
                             WHERE date(s.created_at) = ?`).get(day).p;
  const rets = db.prepare('SELECT COALESCE(SUM(amount), 0) AS a, COALESCE(SUM(cost), 0) AS c FROM returns WHERE date(created_at) = ?').get(day);
  const PARTS = '(SELECT COALESCE(SUM(qty * unit_cost), 0) FROM repair_parts WHERE repair_id = r.id)';
  const rep = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(COALESCE(r.price, 0) - ${PARTS} - r.extra_cost), 0) AS p FROM repairs r
                          WHERE r.status = 'delivered' AND date(r.delivered_at) = ?`).get(day);
  const received = db.prepare('SELECT COUNT(*) AS n FROM repairs WHERE date(created_at) = ?').get(day).n;
  const expenses = db.prepare('SELECT COALESCE(SUM(amount), 0) AS t FROM expenses WHERE date(created_at) = ?').get(day).t;
  const collected = db.prepare('SELECT COALESCE(SUM(amount), 0) AS t FROM sale_payments WHERE date(created_at) = ?').get(day).t;
  const gross = profit - (rets.a - rets.c) + rep.p;
  return {
    day, invoices: sales.n, sales: round2(sales.t - rets.a), profit: round2(gross), repairs_delivered: rep.n, repairs_received: received,
    expenses: round2(expenses), net: round2(gross - expenses), collected: round2(collected), drawer: drawerNow(db).expected,
  };
}

/**
 * Once a minute: at the chosen hour send the day's summary; at 10 in the morning remind
 * about late installments. Each is sent once a day (remembered in settings).
 */
function startScheduler(db, notifier, { every = 60_000 } = {}) {
  const mark = (k) => db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(k, today());
  const tick = () => {
    try {
      const st = getSettings(db);
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const cur = st.currency;
      if (st.daily_summary === '1' && hhmm >= (st.daily_summary_time || '23:00') && st.last_daily_summary !== today()) {
        mark('last_daily_summary');
        const s = daySummary(db);
        notifier.notify({
          type: 'daily_summary', url: '#/reports?tab=finance',
          title: `ملخص اليوم — صافي ${fmt(s.net, cur)}`,
          body: `مبيعات ${fmt(s.sales, cur)} (${s.invoices} فاتورة) • ربح ${fmt(s.profit, cur)} • مصاريف ${fmt(s.expenses, cur)}`
            + `${s.repairs_delivered ? ` • ${s.repairs_delivered} جهاز صيانة اتسلم` : ''} • في الدرج ${fmt(s.drawer, cur)}`,
        });
      }
      if (st.installment_reminders === '1' && hhmm >= '10:00' && st.last_installment_reminder !== today()) {
        mark('last_installment_reminder');
        const late = lateInstallments(db);
        if (late.length) {
          const people = new Set(late.map((i) => i.phone)).size;
          notifier.notify({
            type: 'installments_due', url: '#/customers?filter=late',
            title: `أقساط متأخرة — ${fmt(late.reduce((a, i) => a + i.left, 0), cur)}`,
            body: `${people} عميل عليهم أقساط عدّى ميعادها — افتح العملاء وابعتلهم تذكير واتساب`,
          });
        }
      }
    } catch (e) {
      console.error('  ⚠️ scheduler:', e.message);
    }
  };
  tick();
  return setInterval(tick, every).unref();
}

module.exports = { startScheduler, daySummary };
