import { api, state, icon, esc, money, n, fmtDate, toastErr, emptyRow, PAY_NAMES, todayStr } from '../core.js';
import { RANGES, RANGE_NAMES } from './sales.js';
import { REPAIR_STATUS } from '../print.js';

const MOVE_NAMES = { purchase: 'إضافة بضاعة', sale: 'بيع', return: 'مرتجع', adjust: 'تعديل يدوي', stocktake: 'جرد' };

export async function render(el, { query, actions }) {
  let tab = ['finance', 'sales', 'inventory', 'repairs', 'movements'].includes(query.get('tab')) ? query.get('tab') : 'finance';
  let [from, to] = RANGES.month();
  let last = null; // data for CSV export
  const users = await api.get('/users/names');

  actions.innerHTML = `<button class="btn btn-primary btn-sm" id="pdf">${icon('download')} تحميل PDF</button>`;

  el.innerHTML = `
    <div class="toolbar">
      <div class="seg" id="tabs">${Object.entries({ finance: 'الملخص', sales: 'المبيعات', inventory: 'المخزن', repairs: 'الصيانة', movements: 'حركة المخزن' })
        .map(([k, v]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${v}</button>`).join('')}</div>
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
    if (tab === 'finance') {
      $('#mtype').classList.add('hidden');
      last = await api.get(`/reports/finance?from=${from}&to=${to}`);
      $('#out').innerHTML = financeReport(last, from, to);
      return;
    }
    if (tab === 'repairs') {
      last = await api.get(`/reports/repairs?from=${from}&to=${to}`);
      $('#out').innerHTML = repairsReport(last);
      $('#mtype').classList.add('hidden');
      return;
    }
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

  // PDF: the report on A4 pages, with the shop's name and the period (the phone / computer saves it as PDF)
  const TAB_NAMES = { finance: 'ملخص الحسابات', sales: 'تقرير المبيعات', inventory: 'تقرير المخزن', repairs: 'تقرير الصيانة', movements: 'حركة المخزن' };
  actions.querySelector('#pdf').addEventListener('click', async () => {
    if (!last) return;
    const body = $('#out').cloneNode(true);
    body.querySelectorAll('details').forEach((d) => d.setAttribute('open', ''));
    body.querySelectorAll('a').forEach((x) => x.removeAttribute('href'));
    body.querySelectorAll('table.cardify').forEach((t) => t.classList.remove('cardify'));
    const fmt = (x) => new Date(`${x}T12:00:00`).toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });
    const period = tab === 'inventory' ? `حتى ${fmt(todayStr())}` : from === to ? fmt(from) : `من ${fmt(from)} إلى ${fmt(to)}`;
    const root = document.getElementById('print-root');
    root.innerHTML = `<div class="rep-print">
      <div class="rp-head"><div><b>${esc(state.settings.shop_name || 'Mobile Mix')}</b>${state.settings.shop_address ? `<span>${esc(state.settings.shop_address)}</span>` : ''}</div>
        <div class="rp-title"><b>${TAB_NAMES[tab]}</b><span>${esc(period)}</span></div></div>
      ${body.innerHTML}
      <div class="rp-foot">اتطبع ${new Date().toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' })} — ${esc(state.user.full_name)}</div></div>`;
    let st = document.getElementById('page-style');
    if (!st) { st = document.createElement('style'); st.id = 'page-style'; document.head.append(st); }
    st.textContent = '@page { size: A4; margin: 12mm; }';
    const old = document.title;
    document.title = `${TAB_NAMES[tab]} ${from}${from !== to ? ` - ${to}` : ''}`; // the PDF's file name
    try { await document.fonts.ready; } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 80));
    window.print();
    setTimeout(() => { root.innerHTML = ''; document.title = old; }, 800);
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

function repairsReport(d) {
  const t = d.totals;
  const cur = esc(state.settings.currency);
  return `
    <div class="grid grid-4">
      ${kpi('bg-mint', 'إيراد الصيانة', `${n(t.revenue)} <small>${cur}</small>`, `${t.delivered} جهاز اتسلم — ${t.repaired} اتصلح`)}
      ${kpi('bg-lavender', 'ربح الصيانة', `${n(t.profit)} <small>${cur}</small>`, `قطع غيار ${n(t.parts_cost)} — خارجي ${n(t.extra_cost)}`)}
      ${kpi('bg-sky', 'الفلوس اللي دخلت', `${n(t.cash_in)} <small>${cur}</small>`, `عربون محجوز على أجهزة مفتوحة: ${n(t.deposits_held)}`)}
      ${kpi(t.dues ? 'bg-peony' : 'bg-periwinkle', 'فلوس آجلة على العملاء', `${n(t.dues)} <small>${cur}</small>`, `استلام في الفترة: ${t.received} جهاز`)}
    </div>
    <p class="muted small" style="margin:12px 4px 0">الإيراد والربح بيتحسبوا يوم تسليم الجهاز. "الفلوس اللي دخلت" = العربون والدفعات اللي اتحصلت فعلاً في الفترة.</p>
    <div class="grid grid-2" style="margin-top:24px">
      <div class="card"><div class="card-head"><h2>أداء الفنيين</h2></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>الفني</th><th>اتسلم</th><th>اتصلح</th><th>الإيراد</th><th class="end">الربح</th></tr></thead>
        <tbody>${d.by_technician.map((x) => `<tr><td>${esc(x.full_name)}</td><td class="num">${x.delivered}</td><td class="num">${x.repaired}</td><td>${money(x.revenue)}</td><td class="end">${money(x.profit)}</td></tr>`).join('') || emptyRow(5)}</tbody></table></div>
      </div>
      <div class="card"><div class="card-head"><h2>التحصيل حسب طريقة الدفع</h2></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>الطريقة</th><th>عمليات</th><th class="end">المبلغ</th></tr></thead>
        <tbody>${d.cash.map((c) => `<tr><td>${PAY_NAMES[c.method] || esc(c.method)}</td><td class="num">${c.count}</td><td class="end">${money(c.total)}</td></tr>`).join('') || emptyRow(3)}</tbody></table></div>
      </div>
    </div>
    <div class="grid grid-2" style="margin-top:24px">
      <div class="card"><div class="card-head"><h2>الأجهزة المفتوحة دلوقتي</h2></div>
        <div class="table-wrap"><table class="table"><tbody>${d.open.map((o) => `<tr><td><span class="pill st-${o.status}">${REPAIR_STATUS[o.status]}</span></td><td class="end num">${o.n}</td></tr>`).join('') || emptyRow(2, 'مفيش أجهزة مفتوحة')}</tbody></table></div>
      </div>
      <div class="card"><div class="card-head"><h2>آجل على العملاء</h2></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>التذكرة</th><th>العميل</th><th>الجهاز</th><th class="end">المتبقي</th></tr></thead>
        <tbody>${d.dues.map((x) => `<tr class="click" onclick="location.hash='#/repairs?open=${x.id}'"><td class="num">${esc(x.ticket_no)}</td><td>${esc(x.customer_name)}<div class="muted small num">${esc(x.customer_phone)}</div></td><td>${esc(x.device)}</td><td class="end">${money(x.due)}</td></tr>`).join('') || emptyRow(4, 'مفيش فلوس آجلة 👌')}</tbody></table></div>
      </div>
    </div>`;
}

/** The summary: what came in and how (to match the card machine), and an income statement. */
const METHOD_COLORS = { cash: '#8aa324', card: '#2b3a9e', instapay: '#7b2ff7', wallet: '#e5383b', installment: '#d4a20c' };
function financeReport(d, from, to) {
  const t = d.totals;
  const cur = esc(state.settings.currency || 'ج.م');
  const fmtDay = (x) => new Date(`${x}T12:00:00`).toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'short', day: 'numeric', month: 'short' });
  const period = from === to ? fmtDay(from) : `${fmtDay(from)} — ${fmtDay(to)}`;
  const inTotal = d.payments.reduce((a, p) => a + p.total, 0);
  const card = d.payments.find((p) => p.method === 'card') || { total: 0, count: 0 };
  const cardDays = d.method_days.filter((x) => x.method === 'card');
  const others = d.method_days.filter((x) => x.method !== 'card');
  const row = (label, value, cls = '', sub = '') => `<div class="st-row ${cls}"><span>${label}${sub ? `<small>${sub}</small>` : ''}</span><b>${value}</b></div>`;
  const m = (v) => `${n(v)} <small>${cur}</small>`;
  const neg = (v) => `(${n(v)}) <small>${cur}</small>`;
  return `
    <div class="card rep-head">
      <div class="rep-period">${icon('calendar')} ${esc(period)}</div>
      <div class="rep-big">
        <div><span>المبيعات</span><b>${m(t.sales_revenue + t.repairs_revenue)}</b><small>بعد المرتجعات، شامل الصيانة</small></div>
        <div class="${t.net_profit < 0 ? 'bad' : 'good'}"><span>صافي الربح</span><b>${m(t.net_profit)}</b><small>بعد كل المصاريف</small></div>
        <div><span>المصاريف</span><b>${m(t.expenses)}</b><small>${d.expenses.length} نوع</small></div>
      </div>
    </div>

    <div class="grid grid-2 rep-grid">
      <div class="card">
        <div class="card-head"><h2>${icon('wallet')} الفلوس دخلت إزاي</h2><span class="muted small">مبيعات + تحصيل + صيانة</span></div>
        <div class="visa-box">
          <div><span>${icon('card')} الفيزا — طابقها مع الماكينة</span><b>${m(card.total)}</b><small>${card.count} عملية</small></div>
          ${cardDays.length > 1 ? `<details><summary>يوم بيوم (${cardDays.length} يوم)</summary>
            <div class="day-list">${cardDays.map((x) => `<div><span>${esc(fmtDay(x.day))}</span><small>${x.count} عملية</small><b>${n(x.total)}</b></div>`).join('')}</div></details>` : ''}
        </div>
        <div class="pay-rows">${d.payments.length ? d.payments.map((p) => `
          <div class="pay-row">
            <i style="background:${METHOD_COLORS[p.method] || '#999'}"></i>
            <span>${PAY_NAMES[p.method] || esc(p.method)}<small>${p.count} عملية</small></span>
            <div class="pay-bar"><em style="width:${inTotal ? Math.max(2, (p.total / inTotal) * 100) : 0}%;background:${METHOD_COLORS[p.method] || '#999'}"></em></div>
            <b>${n(p.total)}</b>
          </div>`).join('') : '<div class="empty">مفيش فلوس دخلت في الفترة دي</div>'}
          ${d.payments.length ? `<div class="pay-row total"><i></i><span>الإجمالي</span><div></div><b>${n(inTotal)} <small>${cur}</small></b></div>` : ''}
        </div>
        ${t.refunds ? `<p class="muted small" style="margin:10px 0 0">اترجع للعملاء كاش في المرتجعات: ${n(t.refunds)} ${cur}</p>` : ''}
        ${others.length ? `<details class="more-days"><summary>InstaPay والمحافظ يوم بيوم</summary>
          <div class="day-list">${others.map((x) => `<div><span>${esc(fmtDay(x.day))} — ${PAY_NAMES[x.method] || esc(x.method)}</span><small>${x.count} عملية</small><b>${n(x.total)}</b></div>`).join('')}</div></details>` : ''}
      </div>

      <div class="card statement">
        <div class="card-head"><h2>${icon('receipt')} قائمة الدخل</h2></div>
        ${row('المبيعات', m(t.sales_revenue), '', 'بعد المرتجعات')}
        ${row('تكلفة البضاعة المباعة', neg(t.sales_cost), 'minus')}
        ${row('مجمل ربح المبيعات', m(t.sales_profit), 'sub-total')}
        ${t.repairs_revenue || t.repairs_profit ? row('ربح الصيانة', m(t.repairs_profit), 'plus', `من إيراد ${n(t.repairs_revenue)}`) : ''}
        ${row('المصاريف', neg(t.expenses), 'minus')}
        ${d.expenses.length ? `<div class="st-sub">${d.expenses.map((e) => `<div><span>${esc(e.category)}</span><b>${n(e.total)}</b></div>`).join('')}</div>` : ''}
        ${row('صافي الربح', m(t.net_profit), `grand ${t.net_profit < 0 ? 'bad' : ''}`)}
      </div>
    </div>

    <div class="card stat-strip">
      <a href="#/customers?filter=owing"><span>${icon('user')} عند العملاء</span><b>${n(t.receivable)}</b><small>${t.receivable_count} فاتورة${t.late_installments > 0 ? ` • متأخر ${n(t.late_installments)}` : ''}</small></a>
      <a href="#/purchases"><span>${icon('truck')} علينا للموردين</span><b>${n(t.payable)}</b><small>${t.payable_count} مورد</small></a>
      <a href="#/purchases"><span>${icon('box')} اشترينا بضاعة</span><b>${n(t.purchases)}</b><small>${t.purchases_count} فاتورة</small></a>
      <div><span>${icon('wallet')} اتحصّل آجل</span><b>${n(t.collected)}</b><small>من العملاء</small></div>
    </div>

    ${d.by_day.length > 1 ? `<details class="card days-card"><summary><h2>${icon('chart')} يوم بيوم</h2><span class="muted small">${d.by_day.length} يوم</span></summary>
      <div class="table-wrap"><table class="table"><thead><tr><th>اليوم</th><th>الربح</th><th>المصاريف</th><th class="end">الصافي</th></tr></thead>
      <tbody>${d.by_day.slice().reverse().map((x) => `<tr><td>${esc(fmtDay(x.day))}</td><td>${money(x.profit)}</td><td>${money(x.expenses)}</td>
        <td class="end"><b style="${x.net < 0 ? 'color:var(--danger)' : ''}">${money(x.net)}</b></td></tr>`).join('')}</tbody></table></div></details>` : ''}`;
}
