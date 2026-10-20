import {
  api, can, state, icon, esc, money, n, fmtDate, modal, toast, toastErr, busy, debounce, emptyRow, waLink, formData,
  STATUS_PILLS, PAY_NAMES, COLLECT_METHODS,
} from '../core.js';
import { openSale } from './sales.js';
import { payModal } from '../money-ui.js';

const INST_PILL = {
  paid: '<span class="pill pill-ok">اتدفع</span>',
  late: '<span class="pill pill-bad">متأخر</span>',
  open: '<span class="pill pill-gray">لسه</span>',
};

/** Customers: who they are, what they bought / fixed, what they owe, and collecting it. */
export async function render(el, { id, query, actions }) {
  if (id) return profile(el, Number(id), actions);
  let filter = query.get('filter') || '';
  actions.innerHTML = `<button class="btn btn-primary" id="add">${icon('plus')} عميل جديد</button>`;
  el.innerHTML = `
    <div id="sum" style="margin-bottom:16px"></div>
    <div class="card">
      <div class="toolbar">
        <div class="search">${icon('search')}<input class="input" id="q" placeholder="اسم العميل أو رقمه…"></div>
        <div class="seg" id="filter">
          <button data-f="" class="${!filter ? 'on' : ''}">الكل</button>
          <button data-f="owing" class="${filter === 'owing' ? 'on' : ''}">عليهم فلوس</button>
          <button data-f="late" class="${filter === 'late' ? 'on' : ''}">أقساط متأخرة</button>
        </div>
      </div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>العميل</th><th>التليفون</th><th>مشترياته</th><th>صيانة</th><th>آخر زيارة</th><th class="end">عليه</th></tr></thead>
        <tbody id="rows"></tbody>
      </table></div>
    </div>`;
  const $ = (s) => el.querySelector(s);

  async function load() {
    const p = new URLSearchParams();
    if ($('#q').value.trim()) p.set('q', $('#q').value.trim());
    if (filter) p.set('filter', filter);
    const d = await api.get('/customers?' + p);
    $('#sum').innerHTML = `<div class="grid grid-3">
      <div class="kpi" style="min-height:0"><div class="label">${icon('users')} العملاء</div><div class="value">${d.totals.customers}</div></div>
      <div class="kpi bg-lavender" style="min-height:0"><div class="label">${icon('wallet')} فلوس برة عند العملاء</div><div class="value">${money(d.totals.due)}</div><div class="sub">${d.totals.owing} عميل</div></div>
      <div class="kpi ${d.totals.late > 0 ? 'bg-peony' : ''}" style="min-height:0"><div class="label">${icon('alert')} أقساط متأخرة</div><div class="value">${money(d.totals.late)}</div></div>
    </div>`;
    $('#rows').innerHTML = d.rows.length ? d.rows.map((c) => `
      <tr class="click" data-id="${c.id}">
        <td><div style="display:flex;align-items:center;gap:10px"><span class="avatar">${esc(c.name.trim()[0] || '?')}</span><b style="font-weight:500">${esc(c.name)}</b></div></td>
        <td class="num">${esc(c.phone)}</td>
        <td>${c.sales_count ? `${c.sales_count} فاتورة • ${money(c.sales_total)}` : '<span class="muted">—</span>'}</td>
        <td>${c.repairs_count || '<span class="muted">—</span>'}</td>
        <td class="small">${c.last_visit ? fmtDate(c.last_visit, false) : '—'}</td>
        <td class="end">${c.due > 0 ? `<b style="color:var(--danger)">${money(c.due)}</b>${c.late > 0 ? '<div><span class="pill pill-bad">قسط متأخر</span></div>' : ''}` : '<span class="pill pill-ok">مفيش</span>'}</td>
      </tr>`).join('') : emptyRow(6, filter ? 'مفيش عملاء هنا 👌' : 'لسه مفيش عملاء — بيتسجلوا لوحدهم لما تكتب تليفون العميل في البيع أو الصيانة');
  }

  $('#rows').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) location.hash = `#/customers/${tr.dataset.id}`;
  });
  $('#q').addEventListener('input', debounce(() => load().catch(toastErr), 300));
  $('#filter').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    filter = b.dataset.f;
    $('#filter').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    load().catch(toastErr);
  });
  actions.querySelector('#add').addEventListener('click', async () => {
    const c = await customerForm();
    if (c) location.hash = `#/customers/${c.id}`;
  });
  await load();
}

function customerForm(c = null) {
  return modal({
    title: c ? 'تعديل بيانات العميل' : 'عميل جديد',
    body: `<form class="form-grid" autocomplete="off" onsubmit="return false">
      <label class="field"><span>الاسم *</span><input class="input" name="name" value="${esc(c?.name || '')}" autofocus></label>
      <label class="field"><span>التليفون *</span><input class="input ltr" name="phone" inputmode="tel" value="${esc(c?.phone || '')}"></label>
      <label class="field full"><span>ملاحظات</span><input class="input" name="notes" value="${esc(c?.notes || '')}" placeholder="مثلاً: العنوان، الشغل، الضامن…"></label>
    </form>`,
    foot: `<button class="btn btn-outline" data-close>إلغاء</button><button class="btn btn-primary" data-ok>${icon('check')} حفظ</button>`,
    onMount: (m, close) => m.querySelector('[data-ok]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const f = formData(m.querySelector('form'));
      const saved = c ? await api.put('/customers/' + c.id, f) : await api.post('/customers', f);
      toast('تم الحفظ', 'ok');
      close(saved);
    })),
  });
}

async function profile(el, id, actions) {
  const c = await api.get('/customers/' + id);
  const shop = state.settings.shop_name || 'Mobile Mix';
  const next = c.installments.find((i) => i.state !== 'paid');
  const late = c.installments.filter((i) => i.state === 'late');
  const reminder = `أهلاً ${c.name} 👋\nمعاك ${shop}.\n${c.due > 0
    ? `حابين نفكّرك إن المتبقي عليك ${n(c.due)} ${state.settings.currency || 'ج.م'}.${late.length ? `\nعندك ${late.length} قسط متأخر بإجمالي ${n(late.reduce((a, i) => a + i.left, 0))}.` : next ? `\nالقسط الجاي ${n(next.left)} يوم ${next.due_date}.` : ''}`
    : 'شكراً لتعاملك معانا 🙏'}`;

  actions.innerHTML = `
    <a class="btn btn-ghost" href="#/customers">${icon('undo')} العملاء</a>
    <button class="btn btn-outline" id="edit">${icon('edit')} تعديل</button>
    ${c.due > 0 && can('customers.pay') ? `<button class="btn btn-primary" id="pay">${icon('wallet')} تحصيل</button>` : ''}`;

  el.innerHTML = `
    <div class="card customer-head">
      <span class="avatar avatar-lg">${esc(c.name.trim()[0] || '?')}</span>
      <div style="flex:1;min-width:0">
        <h2 style="margin:0">${esc(c.name)}</h2>
        <div class="muted num">${esc(c.phone)}</div>
        ${c.notes ? `<div class="small" style="margin-top:4px">${esc(c.notes)}</div>` : ''}
      </div>
      <div class="btn-row">
        <a class="btn btn-outline btn-sm" href="tel:${esc(c.phone)}">${icon('callphone')} اتصال</a>
        <a class="btn btn-outline btn-sm" target="_blank" rel="noopener" href="${waLink(c.phone, reminder)}">${icon('whatsapp')} ${c.due > 0 ? 'تذكير واتساب' : 'واتساب'}</a>
      </div>
    </div>
    <div class="grid grid-3" style="margin:16px 0">
      <div class="kpi" style="min-height:0"><div class="label">${icon('cart')} اشترى بـ</div><div class="value">${money(c.total_bought)}</div><div class="sub">${c.sales.length} فاتورة</div></div>
      <div class="kpi ${c.due > 0 ? 'bg-lavender' : 'bg-mint'}" style="min-height:0"><div class="label">${icon('wallet')} المتبقي عليه</div><div class="value">${money(c.due)}</div>
        ${next ? `<div class="sub">القسط الجاي: ${n(next.left)} — ${esc(next.due_date)}</div>` : ''}</div>
      <div class="kpi ${late.length ? 'bg-peony' : ''}" style="min-height:0"><div class="label">${icon('alert')} أقساط متأخرة</div><div class="value">${late.length}</div>
        ${late.length ? `<div class="sub">${money(late.reduce((a, i) => a + i.left, 0))}</div>` : ''}</div>
    </div>
    ${c.installments.length ? `<div class="card" style="margin-bottom:16px">
      <div class="card-head"><h2>${icon('calendar')} الأقساط</h2></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>الفاتورة</th><th>القسط</th><th>الميعاد</th><th>المبلغ</th><th>المدفوع</th><th class="end">الحالة</th></tr></thead>
        <tbody>${c.installments.map((i) => `<tr>
          <td class="num">${esc(i.invoice_no)}</td><td class="num">${i.seq}</td><td class="num">${esc(i.due_date)}</td>
          <td>${money(i.amount)}</td><td>${money(i.paid)}</td><td class="end">${INST_PILL[i.state]}</td></tr>`).join('')}</tbody>
      </table></div></div>` : ''}
    <div class="card" style="margin-bottom:16px">
      <div class="card-head"><h2>${icon('receipt')} الفواتير</h2></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>الفاتورة</th><th>التاريخ</th><th>الأصناف</th><th>الدفع</th><th>الحالة</th><th>الإجمالي</th><th class="end">متبقي</th></tr></thead>
        <tbody id="sales">${c.sales.length ? c.sales.map((s) => `<tr class="click" data-sale="${s.id}">
          <td class="num"><b style="font-weight:500">${esc(s.invoice_no)}</b></td><td class="small">${fmtDate(s.created_at)}</td>
          <td class="small">${esc(s.items || '')}</td><td>${PAY_NAMES[s.payment_method] || ''}</td><td>${STATUS_PILLS[s.status]}</td>
          <td>${money(s.total - s.returned_total)}</td><td class="end">${s.due > 0 ? `<b style="color:var(--danger)">${money(s.due)}</b>` : '—'}</td></tr>`).join('') : emptyRow(7, 'مفيش فواتير')}</tbody>
      </table></div></div>
    ${c.payments.length ? `<div class="card" style="margin-bottom:16px">
      <div class="card-head"><h2>${icon('wallet')} المدفوعات</h2></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>التاريخ</th><th>الفاتورة</th><th>الطريقة</th><th>استلمها</th><th class="end">المبلغ</th></tr></thead>
        <tbody>${c.payments.map((p) => `<tr><td class="small">${fmtDate(p.created_at)}</td><td class="num">${esc(p.invoice_no)}</td>
          <td>${COLLECT_METHODS[p.method] || p.method}</td><td class="small">${esc(p.user_name || '')}</td><td class="end">${money(p.amount)}</td></tr>`).join('')}</tbody>
      </table></div></div>` : ''}
    ${c.repairs.length ? `<div class="card">
      <div class="card-head"><h2>${icon('wrench')} أجهزة الصيانة</h2></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>التذكرة</th><th>الجهاز</th><th>العطل</th><th>الاستلام</th><th class="end">السعر</th></tr></thead>
        <tbody>${c.repairs.map((r) => `<tr class="click" data-repair="${r.id}"><td class="num">${esc(r.ticket_no)}</td><td>${esc(r.device)}</td>
          <td class="small">${esc(r.problem)}</td><td class="small">${fmtDate(r.created_at, false)}</td><td class="end">${r.price != null ? money(r.price) : '—'}</td></tr>`).join('')}</tbody>
      </table></div></div>` : ''}`;

  el.querySelector('#sales').addEventListener('click', (e) => {
    const tr = e.target.closest('[data-sale]');
    if (tr) openSale(tr.dataset.sale, () => profile(el, id, actions));
  });
  el.querySelectorAll('[data-repair]').forEach((tr) => tr.addEventListener('click', () => { location.hash = `#/repairs?open=${tr.dataset.repair}`; }));
  actions.querySelector('#edit').addEventListener('click', async () => { if (await customerForm(c)) profile(el, id, actions); });
  actions.querySelector('#pay')?.addEventListener('click', async () => {
    if (await payModal({ title: `تحصيل من ${esc(c.name)}`, due: c.due, suggest: late.length ? late.reduce((a, i) => a + i.left, 0) : next?.left, url: `/customers/${c.id}/pay` })) {
      profile(el, id, actions);
    }
  });
}
