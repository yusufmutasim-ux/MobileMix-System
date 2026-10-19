import {
  api, can, icon, esc, money, n, fmtDate, modal, toast, toastErr, busy, debounce, todayStr,
  STATUS_PILLS, PAY_NAMES, emptyRow, downloadCsv,
} from '../core.js';
import { printInvoice } from '../print.js';

export const RANGES = {
  today: () => [todayStr(), todayStr()],
  yesterday: () => [todayStr(-1), todayStr(-1)],
  week: () => [todayStr(-6), todayStr()],
  month: () => { const t = todayStr(); return [t.slice(0, 8) + '01', t]; },
};
export const RANGE_NAMES = { today: 'النهارده', yesterday: 'امبارح', week: 'آخر 7 أيام', month: 'الشهر ده' };

export async function render(el, { query, actions }) {
  let [from, to] = RANGES.today();
  let rows = [];
  const users = can('sales.view_all') && can('reports.view') ? await api.get('/users/names') : [];

  actions.innerHTML = `<button class="btn btn-outline btn-sm" id="csv">${icon('download')} تصدير Excel</button>`;

  el.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <div class="search">${icon('search')}<input class="input" id="q" placeholder="رقم الفاتورة، تليفون العميل أو IMEI…"></div>
        <div class="seg" id="range">${Object.entries(RANGE_NAMES).map(([k, v]) => `<button data-r="${k}" class="${k === 'today' ? 'on' : ''}">${v}</button>`).join('')}</div>
        <input class="input num" type="date" id="from" value="${from}"> <input class="input num" type="date" id="to" value="${to}">
        ${users.length ? `<select class="input" id="user"><option value="">كل الموظفين</option>${users.map((u) => `<option value="${u.id}">${esc(u.full_name)}</option>`).join('')}</select>` : ''}
      </div>
      <div class="grid grid-3" id="sum" style="margin-bottom:16px"></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>الفاتورة</th><th>التاريخ</th><th>العميل</th><th>الموظف</th><th>الدفع</th><th>القطع</th><th>الحالة</th><th class="end">الإجمالي</th></tr></thead>
        <tbody id="rows"></tbody>
      </table></div>
    </div>`;

  const $ = (s) => el.querySelector(s);

  async function load() {
    const p = new URLSearchParams();
    const q = $('#q').value.trim();
    if (q) p.set('q', q);
    else { p.set('from', from); p.set('to', to); }
    if ($('#user')?.value) p.set('user_id', $('#user').value);
    rows = await api.get('/sales?' + p);
    const total = rows.reduce((s, r) => s + r.total - r.returned_total, 0);
    $('#sum').innerHTML = `
      <div class="kpi bg-mint" style="min-height:0"><div class="label">صافي المبيعات</div><div class="value">${money(total)}</div></div>
      <div class="kpi bg-sky" style="min-height:0"><div class="label">عدد الفواتير</div><div class="value">${rows.length}</div></div>
      <div class="kpi bg-lavender" style="min-height:0"><div class="label">متوسط الفاتورة</div><div class="value">${money(rows.length ? total / rows.length : 0)}</div></div>`;
    $('#rows').innerHTML = rows.length ? rows.map((r) => `
      <tr class="click" data-id="${r.id}">
        <td><b class="num" style="font-weight:500">${esc(r.invoice_no)}</b></td>
        <td class="small">${fmtDate(r.created_at)}</td>
        <td>${esc(r.customer_name || '')}<div class="muted small num">${esc(r.customer_phone || '')}</div></td>
        <td>${esc(r.user_name)}</td>
        <td>${PAY_NAMES[r.payment_method] || r.payment_method}</td>
        <td class="num">${r.items_count}</td>
        <td>${STATUS_PILLS[r.status]}</td>
        <td class="end">${money(r.total)}${r.returned_total ? `<div class="small" style="color:var(--danger)">- ${n(r.returned_total)}</div>` : ''}</td>
      </tr>`).join('') : emptyRow(8, 'مفيش فواتير في الفترة دي');
  }

  $('#rows').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) openSale(tr.dataset.id, load);
  });
  $('#q').addEventListener('input', debounce(() => load().catch(toastErr), 300));
  $('#range').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    [from, to] = RANGES[b.dataset.r]();
    $('#from').value = from; $('#to').value = to;
    $('#range').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    load().catch(toastErr);
  });
  const onDate = () => {
    from = $('#from').value || todayStr(); to = $('#to').value || from;
    $('#range').querySelectorAll('button').forEach((x) => x.classList.remove('on'));
    load().catch(toastErr);
  };
  $('#from').addEventListener('change', onDate);
  $('#to').addEventListener('change', onDate);
  $('#user')?.addEventListener('change', () => load().catch(toastErr));
  actions.querySelector('#csv').addEventListener('click', () => downloadCsv(`sales-${from}-${to}.csv`,
    ['الفاتورة', 'التاريخ', 'العميل', 'التليفون', 'الموظف', 'الدفع', 'الحالة', 'الإجمالي', 'مرتجع'],
    rows.map((r) => [r.invoice_no, r.created_at, r.customer_name, r.customer_phone, r.user_name, PAY_NAMES[r.payment_method], r.status, r.total, r.returned_total])));

  await load();
  if (query.get('open')) openSale(query.get('open'), load);
}

export async function openSale(id, onChange) {
  let sale;
  try { sale = await api.get('/sales/' + id); } catch (e) { return toastErr(e); }
  const canReturn = can('sales.return') && sale.status !== 'returned';
  await modal({
    title: `فاتورة <span class="num">${esc(sale.invoice_no)}</span> ${STATUS_PILLS[sale.status]}`,
    wide: true,
    body: `
      <div class="grid grid-3" style="gap:12px;margin-bottom:16px">
        <div><div class="muted small">التاريخ</div>${fmtDate(sale.created_at)}</div>
        <div><div class="muted small">الكاشير</div>${esc(sale.user_name)}</div>
        <div><div class="muted small">العميل</div>${esc(sale.customer_name || '—')} <span class="num">${esc(sale.customer_phone || '')}</span></div>
      </div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th class="end">الإجمالي</th></tr></thead>
        <tbody>${sale.items.map((i) => `<tr>
          <td>${esc(i.name)}${i.serial ? `<div class="muted small num">IMEI: ${esc(i.serial)}</div>` : ''}
              ${i.returned_qty ? `<span class="pill pill-bad">مرتجع ${i.returned_qty}</span>` : ''}</td>
          <td class="num">${i.qty}</td><td>${money(i.unit_price)}</td><td class="end">${money(i.line_total)}</td></tr>`).join('')}</tbody>
        <tfoot>
          ${sale.discount ? `<tr><td colspan="3">الخصم</td><td class="end">- ${money(sale.discount)}</td></tr>` : ''}
          <tr><td colspan="3">الإجمالي — ${PAY_NAMES[sale.payment_method] || ''}</td><td class="end">${money(sale.total)}</td></tr>
          ${sale.paid !== sale.total ? `<tr><td colspan="3">المدفوع</td><td class="end">${money(sale.paid)}</td></tr>` : ''}
        </tfoot>
      </table></div>
      ${sale.notes ? `<p><span class="muted">ملاحظات:</span> ${esc(sale.notes)}</p>` : ''}
      ${sale.returns.length ? `<h4 style="margin:16px 0 8px">المرتجعات</h4>
        ${sale.returns.map((r) => `<div class="small" style="padding:4px 0">${fmtDate(r.created_at)} — ${esc(r.user_name)} — <b>${money(r.amount)}</b> ${r.reason ? `(${esc(r.reason)})` : ''}</div>`).join('')}` : ''}`,
    foot: `${canReturn ? `<button class="btn btn-danger" data-return>${icon('undo')} مرتجع</button><span style="flex:1"></span>` : ''}
      <button class="btn btn-outline" data-print="a4">${icon('print')} A4</button>
      <button class="btn btn-primary" data-print="80mm">${icon('print')} طباعة</button>`,
    onMount: (m, close) => {
      m.querySelectorAll('[data-print]').forEach((b) => b.addEventListener('click', () => printInvoice(sale, b.dataset.print)));
      m.querySelector('[data-return]')?.addEventListener('click', async () => {
        close(null);
        if (await returnModal(sale)) { onChange?.(); openSale(id, onChange); }
      });
    },
  });
}

function returnModal(sale) {
  const items = sale.items.filter((i) => i.qty > i.returned_qty);
  return modal({
    title: `مرتجع من فاتورة <span class="num">${esc(sale.invoice_no)}</span>`,
    body: `<p class="muted small" style="margin-top:0">اختار الأصناف اللي راجعة. المبلغ بيتحسب بعد خصم الفاتورة، والبضاعة بترجع المخزن.</p>
      <div class="table-wrap"><table class="table"><tbody>
      ${items.map((i) => `<tr>
        <td><label class="check"><input type="checkbox" data-item="${i.id}"> ${esc(i.name)}</label>${i.serial ? `<div class="muted small num">${esc(i.serial)}</div>` : ''}</td>
        <td style="width:120px">${i.serial ? '' : `<input class="input num" type="number" min="1" max="${i.qty - i.returned_qty}" value="${i.qty - i.returned_qty}" data-qty="${i.id}">`}</td>
        <td class="end">${money(i.unit_price)}</td></tr>`).join('')}
      </tbody></table></div>
      <label class="field" style="margin-top:12px"><span>سبب المرتجع</span><input class="input" id="reason" placeholder="مثلاً: عيب صناعة"></label>`,
    foot: `<button class="btn btn-outline" data-close>إلغاء</button><button class="btn btn-danger" data-ok>${icon('undo')} تأكيد المرتجع</button>`,
    onMount: (m, close) => {
      m.querySelector('[data-ok]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const chosen = [...m.querySelectorAll('[data-item]:checked')].map((c) => ({
          sale_item_id: Number(c.dataset.item),
          qty: Number(m.querySelector(`[data-qty="${c.dataset.item}"]`)?.value || 1),
        }));
        if (!chosen.length) return toast('اختار صنف واحد على الأقل', 'err');
        await api.post(`/sales/${sale.id}/return`, { items: chosen, reason: m.querySelector('#reason').value });
        toast('تم تسجيل المرتجع', 'ok');
        close(true);
      }));
    },
  });
}
