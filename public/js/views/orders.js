import { api, icon, esc, money, n, fmtDate, modal, toast, toastErr, busy, confirmBox, emptyRow, debounce, waLink, state } from '../core.js';

/** Orders from the online store: confirm (stock leaves), ship, deliver (money in), or cancel (stock back). */
export const ORDER_STATUS = {
  new: ['جديد', 'pill-info'], confirmed: ['اتأكد', 'pill-warn'], shipped: ['اتشحن', 'pill-gray'], delivered: ['اتسلّم', 'pill-ok'], cancelled: ['اتلغى', 'pill-bad'],
};
const PAY = { cod: 'كاش عند الاستلام', transfer: 'تحويل', card: 'فيزا' };
const PAY_STATE = { unpaid: ['لسه', 'pill-gray'], review: ['محتاج مراجعة', 'pill-warn'], paid: ['مدفوع', 'pill-ok'], failed: ['متمّش', 'pill-bad'] };
const DELIVERY = { ship: 'شحن', local: 'توصيل', pickup: 'استلام من المحل' };
const pill = ([t, c]) => `<span class="pill ${c}">${t}</span>`;

export async function render(el, { query, actions }) {
  let status = query.get('status') ?? 'new';
  const storeOn = state.settings.store_enabled === '1';
  actions.innerHTML = `<a class="btn btn-outline btn-sm" href="/shop/" target="_blank" rel="noopener">${icon('eye')} افتح الموقع</a>`;
  el.innerHTML = `
    ${storeOn ? '' : `<div class="card bg-aqua" style="box-shadow:none;margin-bottom:16px">${icon('alert')} الموقع مقفول دلوقتي — افتحه من <a href="#/settings?tab=store"><b>الإعدادات ← المتجر الأونلاين</b></a>.</div>`}
    <div class="card">
      <div class="toolbar">
        <div class="seg" id="st">${[['new', 'الجديدة'], ['confirmed', 'اتأكدت'], ['shipped', 'اتشحنت'], ['delivered', 'اتسلّمت'], ['cancelled', 'اتلغت'], ['', 'الكل']]
          .map(([k, v]) => `<button data-s="${k}" class="${k === status ? 'on' : ''}">${v}</button>`).join('')}</div>
        <div class="search">${icon('search')}<input class="input" id="q" placeholder="رقم الطلب، الاسم أو الموبايل…"></div>
      </div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>الطلب</th><th>العميل</th><th>الاستلام</th><th>الدفع</th><th>الحالة</th><th class="end">الإجمالي</th></tr></thead>
        <tbody id="rows"></tbody></table></div>
    </div>`;
  const $ = (s) => el.querySelector(s);

  async function load() {
    const p = new URLSearchParams();
    if (status) p.set('status', status);
    if ($('#q').value.trim()) p.set('q', $('#q').value.trim());
    const rows = await api.get('/orders?' + p);
    $('#rows').innerHTML = rows.length ? rows.map((o) => `<tr data-id="${o.id}" class="clickable">
      <td><b class="num">${esc(o.order_no)}</b><div class="muted small">${fmtDate(o.created_at)}</div></td>
      <td>${esc(o.customer_name)}<div class="muted small num" dir="ltr">${esc(o.phone)}</div></td>
      <td>${DELIVERY[o.delivery]}${o.governorate ? `<div class="muted small">${esc(o.governorate)}</div>` : ''}</td>
      <td>${o.payment === 'transfer' ? (o.transfer_via === 'wallet' ? 'محفظة' : 'InstaPay') : PAY[o.payment]}<div>${o.payment === 'cod' && o.pay_status === 'unpaid' ? '' : pill(PAY_STATE[o.pay_status])}</div></td>
      <td>${pill(ORDER_STATUS[o.status])}</td>
      <td class="end"><b>${money(o.total)}</b><div class="muted small">${o.units} قطعة</div></td></tr>`).join('')
      : emptyRow(6, status === 'new' ? 'مفيش طلبات جديدة' : 'مفيش طلبات');
  }
  $('#st').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    status = b.dataset.s;
    $('#st').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    load().catch(toastErr);
  });
  $('#q').addEventListener('input', debounce(() => load().catch(toastErr), 300));
  $('#rows').addEventListener('click', async (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    await orderModal(Number(tr.dataset.id));
    load().catch(toastErr);
  });
  // A new order while the page is open
  const onNote = (e) => { if (e.detail?.type === 'online_order') load().catch(() => {}); };
  document.addEventListener('mm:notification', onNote);
  await load();
  if (query.get('open')) { await orderModal(Number(query.get('open'))); load().catch(toastErr); }
  return () => document.removeEventListener('mm:notification', onNote);
}

export async function orderModal(id) {
  let o = await api.get('/orders/' + id);
  return modal({
    title: `طلب <span class="num" dir="ltr">${esc(o.order_no)}</span>`,
    wide: true,
    body: '<div id="ord"></div>',
    foot: '<div class="btn-row" id="ord-actions" style="width:100%;justify-content:flex-end"></div>',
    onMount: (m, close) => {
      const draw = () => {
        const proof = o.proof_url ? `<a href="${o.proof_url}" target="_blank" rel="noopener"><img src="${o.proof_url}" alt="صورة التحويل" class="proof-img"></a>` : '';
        m.querySelector('#ord').innerHTML = `
          <div class="ord-head">${pill(ORDER_STATUS[o.status])} ${o.payment !== 'cod' || o.pay_status !== 'unpaid' ? pill(PAY_STATE[o.pay_status]) : ''}
            <span class="muted small">${fmtDate(o.created_at)}${o.handled_name ? ` • آخر تعديل: ${esc(o.handled_name)}` : ''}</span></div>
          <div class="grid grid-2" style="gap:14px;margin-top:12px">
            <div class="card" style="box-shadow:none;background:var(--t-gray-bg)">
              <b>${esc(o.customer_name)}</b>
              <div class="num" dir="ltr" style="text-align:right">${esc(o.phone)}</div>
              <div class="btn-row" style="margin-top:8px">
                <a class="btn btn-outline btn-sm" href="tel:${esc(o.phone)}">${icon('callphone')} اتصال</a>
                <a class="btn btn-outline btn-sm" target="_blank" rel="noopener" href="${waLink(o.phone, `أهلاً ${o.customer_name}، بخصوص طلبك رقم ${o.order_no} من ${state.settings.store_title || state.settings.shop_name || ''}`)}">${icon('whatsapp')} واتساب</a></div>
            </div>
            <div class="card" style="box-shadow:none;background:var(--t-gray-bg)">
              <b>${DELIVERY[o.delivery]}${o.governorate ? ` — ${esc(o.governorate)}` : ''}</b>
              ${o.address ? `<div>${esc(o.address)}</div>` : ''}
              <div class="muted small">الدفع: ${o.payment === 'transfer' ? (o.transfer_via === 'wallet' ? 'محفظة' : 'InstaPay') : PAY[o.payment]}</div>
              ${o.notes ? `<div class="small" style="margin-top:6px">📝 ${esc(o.notes)}</div>` : ''}
            </div>
          </div>
          ${proof ? `<div style="margin-top:14px"><div class="muted small">صورة التحويل اللي العميل بعتها:</div>${proof}</div>` : ''}
          ${o.payment === 'transfer' && !o.proof_url && o.pay_status !== 'paid' && o.status !== 'cancelled' ? '<p class="muted small">العميل لسه مبعتش صورة التحويل.</p>' : ''}
          ${o.payment === 'card' && o.pay_status !== 'paid' ? '<p class="small" style="color:var(--danger)">الدفع بالفيزا لسه متمّش — متأكدش الطلب غير لما يتدفع أو تتفق معاه على طريقة تانية.</p>' : ''}
          <div class="table-wrap" style="margin-top:14px"><table class="table">
            <thead><tr><th>المنتج</th><th>الكمية</th><th>السعر</th><th class="end">الإجمالي</th></tr></thead>
            <tbody>${o.items.map((i) => `<tr><td dir="auto">${esc(i.name)}${o.status === 'new' && i.stock != null && i.stock < i.qty ? `<div class="small" style="color:var(--danger)">المتاح ${i.stock} بس</div>` : ''}</td>
              <td class="num">${i.qty}</td><td>${money(i.unit_price)}</td><td class="end">${money(i.line_total)}</td></tr>`).join('')}</tbody>
            <tfoot>
              <tr><td colspan="3">المنتجات</td><td class="end">${money(o.subtotal)}</td></tr>
              ${o.discount ? `<tr><td colspan="3">خصم${o.coupon ? ` (كود <b class="ltr">${esc(o.coupon)}</b>)` : ''}</td><td class="end" style="color:var(--danger)">- ${money(o.discount)}</td></tr>` : ''}
              <tr><td colspan="3">التوصيل</td><td class="end">${o.delivery_fee ? money(o.delivery_fee) : 'مجاناً'}</td></tr>
              <tr><td colspan="3"><b>الإجمالي</b></td><td class="end"><b>${money(o.total)}</b></td></tr>
            </tfoot></table></div>
          ${o.sale_id ? `<p class="small">اتعملت فاتورة <a href="#/sales?open=${o.sale_id}"><b class="num">${esc(o.invoice_no)}</b></a> — المخزن اتخصم منه.</p>` : ''}
          ${o.status === 'cancelled' && o.cancel_reason ? `<p class="small">سبب الإلغاء: ${esc(o.cancel_reason)}</p>` : ''}`;
        const acts = [];
        if (o.status === 'new') acts.push(`<button class="btn btn-primary" data-to="confirmed">${icon('check')} تأكيد الطلب</button>`);
        if (o.status === 'confirmed' && o.delivery !== 'pickup') acts.push(`<button class="btn btn-outline" data-to="shipped">${icon('truck')} اتشحن</button>`);
        if (['confirmed', 'shipped'].includes(o.status)) acts.push(`<button class="btn btn-primary" data-to="delivered">${icon('check')} ${o.pay_status === 'paid' ? 'اتسلّم' : 'اتسلّم واتحصّل'}</button>`);
        if (o.payment === 'transfer' && o.pay_status !== 'paid' && o.status !== 'cancelled') acts.push(`<button class="btn btn-outline" data-paid>${icon('check')} التحويل وصل</button>`);
        if (['new', 'confirmed', 'shipped'].includes(o.status)) acts.push(`<button class="btn btn-ghost" data-to="cancelled" style="color:var(--danger)">إلغاء الطلب</button>`);
        m.closest('.modal').querySelector('#ord-actions').innerHTML = acts.join('') || '<button class="btn btn-outline" data-close-x>قفل</button>';
      };
      draw();
      m.closest('.modal').querySelector('#ord-actions').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.hasAttribute('data-close-x')) return close(true);
        busy(b, async () => {
          if (b.hasAttribute('data-paid')) {
            o = await api.post(`/orders/${o.id}/paid`, {});
            toast('اتسجل إن التحويل وصل', 'ok');
          } else {
            const to = b.dataset.to;
            let reason;
            if (to === 'cancelled') {
              if (!(await confirmBox(`تلغي الطلب ${o.order_no}؟${o.sale_id ? ' المنتجات هترجع المخزن.' : ''}`, { ok: 'إلغاء الطلب', danger: true }))) return;
              reason = prompt('سبب الإلغاء (اختياري) — العميل هيشوفه:') || '';
            }
            o = await api.post(`/orders/${o.id}/status`, { status: to, reason });
            toast({ confirmed: 'اتأكد الطلب واتعملت فاتورة', shipped: 'اتسجل إنه اتشحن', delivered: 'اتسلّم ✓', cancelled: 'اتلغى الطلب' }[to], 'ok');
          }
          draw();
        });
      });
    },
  });
}
