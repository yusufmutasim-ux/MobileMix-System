import { api, state, can, icon, esc, money, n, fmtDate, STATUS_PILLS, PAY_NAMES, emptyRow, moneyText } from '../core.js';

export async function render(el, { actions }) {
  if (can('sales.create')) actions.innerHTML = `<a class="btn btn-primary" href="#/pos">${icon('plus')} بيع جديد</a>`;
  const d = await api.get('/dashboard');
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'صباح الخير' : 'مساء الخير';

  const kpis = can('sales.create') ? [
    `<div class="kpi bg-mint"><div class="label">${icon('wallet')} مبيعات النهارده</div><div class="value">${n(d.today.total)} <small>${esc(state.settings.currency)}</small></div></div>`,
    `<div class="kpi bg-sky"><div class="label">${icon('receipt')} عدد الفواتير</div><div class="value">${d.today.invoices}</div></div>`,
  ] : [];
  if (d.today.profit !== undefined) {
    kpis.push(`<div class="kpi bg-lavender"><div class="label">${icon('trend')} ربح النهارده</div><div class="value">${n(d.today.profit)} <small>${esc(state.settings.currency)}</small></div>
      ${d.today.returns ? `<div class="sub">مرتجعات: ${moneyText(d.today.returns)}</div>` : ''}</div>`);
  }
  if (d.repairs) {
    kpis.push(`<a href="#/repairs" class="kpi bg-periwinkle" style="color:inherit"><div class="label">${icon('wrench')} أجهزة في الصيانة</div>
      <div class="value">${d.repairs.open} <small>${d.repairs.ready ? `${d.repairs.ready} جاهز للتسليم` : ''}</small></div>
      <div class="sub">استلام النهارده: ${d.repairs.received_today}${d.repairs.cash_today !== undefined ? ` — تحصيل: ${n(d.repairs.cash_today)}` : ''}</div></a>`);
  }
  if (d.low_stock !== undefined && state.user.role !== 'technician') {
    kpis.push(`<a href="#/products?low=1" class="kpi ${d.low_stock ? 'bg-peony' : 'bg-white'}" style="color:inherit">
      <div class="label">${icon('alert')} نواقص المخزن</div><div class="value">${d.low_stock} <small>من ${d.products} صنف</small></div></a>`);
  }

  const quick = [
    can('sales.create') && `<a href="#/pos" class="bg-periwinkle">${icon('cart')}بيع جديد</a>`,
    can('repairs.create') && `<a href="#/repairs?new=1" class="bg-aqua">${icon('wrench')}استلام جهاز صيانة</a>`,
    can('products.edit') && `<a href="#/products?new=1" class="bg-sky">${icon('box')}إضافة منتج</a>`,
    can('labels.print') && `<a href="#/labels" class="bg-mint">${icon('tag')}طباعة ليبلات</a>`,
    can('reports.view') && `<a href="#/reports" class="bg-lavender">${icon('chart')}التقارير</a>`,
    !can('reports.view') && can('sales.create') && `<a href="#/sales" class="bg-lavender">${icon('receipt')}فواتيري</a>`,
  ].filter(Boolean).slice(0, 4).join('');

  el.innerHTML = `
    <p class="muted" style="margin:0 0 20px;font-size:17px">${greet}، <b style="color:var(--ink);font-weight:500">${esc(state.user.full_name)}</b> 👋</p>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr))">${kpis.join('')}</div>
    <div class="quick" style="margin-top:24px">${quick}</div>
    <div class="grid ${d.week ? 'grid-2' : ''} ${d.recent.length || can('sales.create') ? '' : 'hidden'}" style="margin-top:24px">
      ${d.week ? `<div class="card"><div class="card-head"><h2>مبيعات آخر 7 أيام</h2></div>${weekChart(d.week)}</div>` : ''}
      <div class="card">
        <div class="card-head"><h2>آخر الفواتير</h2><a href="#/sales" class="btn btn-ghost btn-sm">عرض الكل</a></div>
        <div class="table-wrap"><table class="table"><tbody>
          ${d.recent.length ? d.recent.map((s) => `
            <tr class="click" data-id="${s.id}">
              <td><b class="num" style="font-weight:500">${esc(s.invoice_no)}</b><div class="muted small">${fmtDate(s.created_at)}</div></td>
              <td class="small">${esc(s.user_name)}<div class="muted">${PAY_NAMES[s.payment_method] || ''}</div></td>
              <td>${STATUS_PILLS[s.status]}</td>
              <td class="end">${money(s.total)}</td>
            </tr>`).join('') : emptyRow(4, 'لسه مفيش فواتير')}
        </tbody></table></div>
      </div>
    </div>`;

  el.querySelectorAll('tr[data-id]').forEach((tr) =>
    tr.addEventListener('click', () => { location.hash = `#/sales?open=${tr.dataset.id}`; }));
}

function weekChart(week) {
  const days = [];
  const map = Object.fromEntries(week.map((w) => [w.day, w.total]));
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    days.push({ key: local, label: d.toLocaleDateString('ar-EG', { weekday: 'short' }), total: map[local] ?? map[key] ?? 0 });
  }
  const max = Math.max(...days.map((d) => d.total), 1);
  return `
    <div class="bars" role="img" aria-label="مبيعات آخر 7 أيام">
      ${days.map((d) => `<div class="bar-col"><div class="tip">${d.label}: ${n(d.total)}</div>
        <div class="bar" style="height:${Math.max(1, (d.total / max) * 100)}%"></div></div>`).join('')}
    </div>
    <div class="bar-labels">${days.map((d) => `<span>${d.label}</span>`).join('')}</div>`;
}
