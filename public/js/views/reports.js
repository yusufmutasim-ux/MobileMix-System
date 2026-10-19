import { api, state, icon, esc, money, n, fmtDate, toastErr, emptyRow, downloadCsv, PAY_NAMES } from '../core.js';
import { RANGES, RANGE_NAMES } from './sales.js';

const MOVE_NAMES = { purchase: 'إضافة بضاعة', sale: 'بيع', return: 'مرتجع', adjust: 'تعديل يدوي', stocktake: 'جرد' };

export async function render(el, { actions }) {
  let tab = 'sales';
  let [from, to] = RANGES.month();
  let last = null; // data for CSV export
  const users = await api.get('/users/names');

  actions.innerHTML = `<button class="btn btn-outline btn-sm" id="csv">${icon('download')} تصدير Excel</button>`;

  el.innerHTML = `
    <div class="toolbar">
      <div class="seg" id="tabs"><button data-t="sales" class="on">المبيعات والأرباح</button><button data-t="inventory">المخزن</button><button data-t="movements">حركة المخزن</button></div>
      <span style="flex:1"></span>
      <div class="seg" id="range">${Object.entries(RANGE_NAMES).map(([k, v]) => `<button data-r="${k}" class="${k === 'month' ? 'on' : ''}">${v}</button>`).join('')}</div>
      <input class="input num" type="date" id="from" value="${from}"><input class="input num" type="date" id="to" value="${to}">
      <select class="input" id="user"><option value="">كل الموظفين</option>${users.map((u) => `<option value="${u.id}">${esc(u.full_name)}</option>`).join('')}</select>
      <select class="input hidden" id="mtype"><option value="">كل الحركات</option>${Object.entries(MOVE_NAMES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
    </div>
    <div id="out"></div>`;

  const $ = (s) => el.querySelector(s);

  async function load() {
    const isInv = tab === 'inventory';
    ['#range', '#from', '#to'].forEach((s) => $(s).classList.toggle('hidden', isInv));
    $('#user').classList.toggle('hidden', tab !== 'sales');
    $('#mtype').classList.toggle('hidden', tab !== 'movements');
    $('#out').innerHTML = '<div class="empty">جاري التحميل…</div>';
    if (tab === 'sales') {
      const p = new URLSearchParams({ from, to });
      if ($('#user').value) p.set('user_id', $('#user').value);
      last = await api.get('/reports/sales?' + p);
      $('#out').innerHTML = salesReport(last);
    } else if (tab === 'inventory') {
      last = await api.get('/reports/inventory');
      $('#out').innerHTML = inventoryReport(last);
    } else {
      const p = new URLSearchParams({ from, to });
      if ($('#mtype').value) p.set('type', $('#mtype').value);
      last = await api.get('/reports/movements?' + p);
      $('#out').innerHTML = movementsReport(last);
    }
  }
  const reload = () => load().catch(toastErr);

  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    tab = b.dataset.t;
    $('#tabs').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    reload();
  });
  $('#range').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    [from, to] = RANGES[b.dataset.r]();
    $('#from').value = from; $('#to').value = to;
    $('#range').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    reload();
  });
  const onDate = () => {
    from = $('#from').value; to = $('#to').value || from;
    $('#range').querySelectorAll('button').forEach((x) => x.classList.remove('on'));
    reload();
  };
  $('#from').addEventListener('change', onDate);
  $('#to').addEventListener('change', onDate);
  $('#user').addEventListener('change', reload);
  $('#mtype').addEventListener('change', reload);

  actions.querySelector('#csv').addEventListener('click', () => {
    if (!last) return;
    if (tab === 'sales') {
      downloadCsv(`sales-report-${from}-${to}.csv`, ['اليوم', 'عدد الفواتير', 'المبيعات', 'الربح'],
        last.by_day.map((d) => [d.day, d.invoices, d.total, d.profit]));
    } else if (tab === 'inventory') {
      downloadCsv('inventory-report.csv', ['القسم', 'الأصناف', 'القطع', 'القيمة بسعر الشراء', 'القيمة بسعر البيع'],
        last.by_category.map((c) => [c.category, c.products, c.qty, c.cost_value, c.sell_value]));
    } else {
      downloadCsv(`movements-${from}-${to}.csv`, ['التاريخ', 'المنتج', 'النوع', 'الكمية', 'بعدها', 'ملاحظة', 'الموظف'],
        last.map((m) => [m.created_at, m.product_name, MOVE_NAMES[m.type], m.qty_change, m.qty_after, m.note, m.user_name]));
    }
  });

  await load();
}

const kpi = (cls, label, value, sub = '') =>
  `<div class="kpi ${cls}"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;

const bar = (v, max) => `<div class="hbar"><i style="width:${max > 0 ? Math.max(2, (v / max) * 100) : 0}%"></i></div>`;

function salesReport(d) {
  const t = d.totals;
  const margin = t.net > 0 ? Math.round((t.profit / t.net) * 100) : 0;
  const maxDay = Math.max(...d.by_day.map((x) => x.total), 1);
  const maxProd = Math.max(...d.top_products.map((x) => x.revenue), 1);
  const cur = esc(state.settings.currency);
  return `
    <div class="grid grid-4">
      ${kpi('bg-mint', 'صافي المبيعات', `${n(t.net)} <small>${cur}</small>`, `${t.invoices} فاتورة — ${t.units} قطعة`)}
      ${kpi('bg-lavender', 'صافي الربح', `${n(t.profit)} <small>${cur}</small>`, `هامش ${margin}%`)}
      ${kpi('bg-sky', 'متوسط الفاتورة', `${n(t.avg_invoice)} <small>${cur}</small>`, `خصومات: ${n(t.discounts)}`)}
      ${kpi(t.returns ? 'bg-peony' : 'bg-periwinkle', 'المرتجعات', `${n(t.returns)} <small>${cur}</small>`, `${t.returns_count} عملية مرتجع`)}
    </div>

    <div class="card" style="margin-top:24px">
      <div class="card-head"><h2>المبيعات يوم بيوم</h2></div>
      ${d.by_day.length ? `
        <div class="bars" style="height:200px">${d.by_day.map((x) => `<div class="bar-col"><div class="tip">${x.day}: ${n(x.total)} — ربح ${n(x.profit)}</div>
          <div class="bar" style="height:${Math.max(1, (x.total / maxDay) * 100)}%"></div></div>`).join('')}</div>
        <div class="bar-labels">${d.by_day.map((x) => `<span class="num">${d.by_day.length > 16 ? x.day.slice(8) : x.day.slice(5)}</span>`).join('')}</div>` : '<div class="empty">مفيش مبيعات في الفترة دي</div>'}
    </div>

    <div class="grid grid-2" style="margin-top:24px">
      <div class="card"><div class="card-head"><h2>أداء الموظفين</h2></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>الموظف</th><th>فواتير</th><th>المبيعات</th><th class="end">الربح</th></tr></thead>
        <tbody>${d.by_user.length ? d.by_user.map((u) => `<tr><td>${esc(u.full_name)}</td><td class="num">${u.invoices}</td><td>${money(u.total)}</td><td class="end">${money(u.profit)}</td></tr>`).join('') : emptyRow(4)}</tbody></table></div>
      </div>
      <div class="card"><div class="card-head"><h2>طرق الدفع</h2></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>الطريقة</th><th>فواتير</th><th class="end">المبلغ</th></tr></thead>
        <tbody>${d.by_payment.length ? d.by_payment.map((p) => `<tr><td>${PAY_NAMES[p.method] || esc(p.method)}</td><td class="num">${p.invoices}</td><td class="end">${money(p.total)}</td></tr>`).join('') : emptyRow(3)}</tbody></table></div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:24px">
      <div class="card"><div class="card-head"><h2>الأكثر مبيعاً</h2></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>المنتج</th><th>الكمية</th><th>المبيعات</th><th></th><th class="end">الربح</th></tr></thead>
        <tbody>${d.top_products.length ? d.top_products.map((p) => `<tr><td>${esc(p.name)}</td><td class="num">${p.qty}</td><td>${money(p.revenue)}</td><td style="width:80px">${bar(p.revenue, maxProd)}</td><td class="end">${money(p.profit)}</td></tr>`).join('') : emptyRow(5)}</tbody></table></div>
      </div>
      <div class="card"><div class="card-head"><h2>حسب القسم</h2></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>القسم</th><th>الكمية</th><th>المبيعات</th><th class="end">الربح</th></tr></thead>
        <tbody>${d.by_category.length ? d.by_category.map((c) => `<tr><td>${esc(c.category)}</td><td class="num">${c.qty}</td><td>${money(c.revenue)}</td><td class="end">${money(c.profit)}</td></tr>`).join('') : emptyRow(4)}</tbody></table></div>
      </div>
    </div>`;
}

function inventoryReport(d) {
  const t = d.totals;
  const cur = esc(state.settings.currency);
  return `
    <div class="grid grid-4">
      ${kpi('bg-periwinkle', 'عدد الأصناف', n(t.products))}
      ${kpi('bg-sky', 'عدد القطع', n(t.qty))}
      ${kpi('bg-lavender', 'القيمة بسعر الشراء', `${n(t.cost_value)} <small>${cur}</small>`)}
      ${kpi('bg-mint', 'القيمة بسعر البيع', `${n(t.sell_value)} <small>${cur}</small>`, `ربح متوقع: ${n(t.sell_value - t.cost_value)}`)}
    </div>
    <div class="card" style="margin-top:24px"><div class="card-head"><h2>المخزن حسب القسم</h2></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>القسم</th><th>الأصناف</th><th>القطع</th><th>بسعر الشراء</th><th class="end">بسعر البيع</th></tr></thead>
      <tbody>${d.by_category.map((c) => `<tr><td>${esc(c.category)}</td><td class="num">${c.products}</td><td class="num">${c.qty || 0}</td><td>${money(c.cost_value)}</td><td class="end">${money(c.sell_value)}</td></tr>`).join('') || emptyRow(5)}</tbody></table></div>
    </div>
    <div class="grid grid-2" style="margin-top:24px">
      <div class="card"><div class="card-head"><h2>${icon('alert', '')} النواقص (${d.low_stock.length})</h2></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>المنتج</th><th>القسم</th><th>الموجود</th><th>حد الطلب</th></tr></thead>
        <tbody>${d.low_stock.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.category_name || '')}</td><td><span class="pill ${p.qty <= 0 ? 'pill-bad' : 'pill-warn'} num">${p.qty}</span></td><td class="num">${p.min_qty}</td></tr>`).join('') || emptyRow(4, 'مفيش نواقص 👌')}</tbody></table></div>
      </div>
      <div class="card"><div class="card-head"><h2>بضاعة راكدة (مباعتش من 60 يوم)</h2></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>المنتج</th><th>الكمية</th><th>القيمة</th><th>آخر بيع</th></tr></thead>
        <tbody>${d.stale.map((p) => `<tr><td>${esc(p.name)}</td><td class="num">${p.qty}</td><td>${money(p.cost_value)}</td><td class="small">${p.last_sold ? fmtDate(p.last_sold, false) : 'لم يُباع'}</td></tr>`).join('') || emptyRow(4)}</tbody></table></div>
      </div>
    </div>`;
}

function movementsReport(rows) {
  return `<div class="card"><div class="table-wrap"><table class="table">
    <thead><tr><th>التاريخ</th><th>المنتج</th><th>النوع</th><th>الكمية</th><th>بعدها</th><th>ملاحظة</th><th>الموظف</th></tr></thead>
    <tbody>${rows.map((m) => `<tr><td class="small">${fmtDate(m.created_at)}</td><td>${esc(m.product_name)}</td><td>${MOVE_NAMES[m.type]}</td>
      <td class="num" style="color:${m.qty_change < 0 ? 'var(--danger)' : 'var(--ok)'}">${m.qty_change > 0 ? '+' : ''}${m.qty_change}</td>
      <td class="num">${m.qty_after}</td><td class="small">${esc(m.note || '')}</td><td class="small">${esc(m.user_name || '')}</td></tr>`).join('') || emptyRow(7, 'مفيش حركات في الفترة دي')}</tbody>
  </table></div></div>`;
}
