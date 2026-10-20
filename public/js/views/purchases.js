import { api, icon, esc, money, n, fmtDate, modal, toast, toastErr, busy, debounce, emptyRow, todayStr, formData } from '../core.js';
import { RANGES, RANGE_NAMES } from './sales.js';

/** Purchases (stock in from suppliers) and what we owe each supplier. */
export async function render(el, { query, actions }) {
  let tab = query.get('supplier') ? 'suppliers' : 'purchases';
  let [from, to] = RANGES.month();
  actions.innerHTML = `<button class="btn btn-outline" id="sup">${icon('truck')} مورد جديد</button>
    <button class="btn btn-primary" id="new">${icon('plus')} فاتورة شراء</button>`;
  el.innerHTML = `
    <div class="seg" id="tabs" style="margin-bottom:16px">
      <button data-t="purchases">فواتير الشراء</button><button data-t="suppliers">الموردين</button>
    </div>
    <div id="body"></div>`;
  const $ = (s) => el.querySelector(s);

  async function show() {
    $('#tabs').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
    if (tab === 'purchases') return purchasesTab();
    return suppliersTab();
  }

  async function purchasesTab() {
    $('#body').innerHTML = `<div class="card">
      <div class="toolbar">
        <div class="seg" id="range">${Object.entries(RANGE_NAMES).map(([k, v]) => `<button data-r="${k}" class="${k === 'month' ? 'on' : ''}">${v}</button>`).join('')}</div>
        <input class="input num" type="date" id="from" value="${from}"> <input class="input num" type="date" id="to" value="${to}">
      </div>
      <div id="sum" style="margin-bottom:14px"></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>الفاتورة</th><th>التاريخ</th><th>المورد</th><th>القطع</th><th>المدفوع</th><th class="end">الإجمالي</th></tr></thead>
        <tbody id="rows"></tbody></table></div></div>`;
    const load = async () => {
      const d = await api.get(`/purchases?from=${from}&to=${to}`);
      const unpaid = d.rows.reduce((a, r) => a + Math.max(0, r.total - r.paid), 0);
      $('#sum').innerHTML = `<div class="grid grid-3">
        <div class="kpi bg-mint" style="min-height:0"><div class="label">${icon('truck')} مشتريات الفترة</div><div class="value">${money(d.total)}</div></div>
        <div class="kpi" style="min-height:0"><div class="label">عدد الفواتير</div><div class="value">${d.rows.length}</div></div>
        <div class="kpi ${unpaid > 0 ? 'bg-lavender' : ''}" style="min-height:0"><div class="label">لسه ماتدفعش منها</div><div class="value">${money(unpaid)}</div></div></div>`;
      $('#rows').innerHTML = d.rows.length ? d.rows.map((r) => `<tr class="click" data-id="${r.id}">
        <td class="num"><b style="font-weight:500">${esc(r.purchase_no)}</b>${r.ref_no ? `<div class="muted small">فاتورة المورد ${esc(r.ref_no)}</div>` : ''}</td>
        <td class="small">${fmtDate(r.created_at)}</td><td>${esc(r.supplier_name || 'كاش — من غير مورد')}</td>
        <td class="num">${r.units || 0}</td>
        <td>${r.paid >= r.total - 0.004 ? '<span class="pill pill-ok">مدفوعة</span>' : `<span class="pill pill-warn">متبقي ${n(r.total - r.paid)}</span>`}</td>
        <td class="end">${money(r.total)}</td></tr>`).join('') : emptyRow(6, 'مفيش فواتير شراء في الفترة دي');
    };
    $('#rows').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) openPurchase(tr.dataset.id); });
    $('#range').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      [from, to] = RANGES[b.dataset.r]();
      $('#from').value = from; $('#to').value = to;
      $('#range').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      load().catch(toastErr);
    });
    const onDate = () => { from = $('#from').value || todayStr(); to = $('#to').value || from; $('#range').querySelectorAll('button').forEach((x) => x.classList.remove('on')); load().catch(toastErr); };
    $('#from').addEventListener('change', onDate);
    $('#to').addEventListener('change', onDate);
    await load();
  }

  async function suppliersTab() {
    const list = await api.get('/suppliers');
    const owed = list.reduce((a, s) => a + Math.max(0, s.balance), 0);
    $('#body').innerHTML = `
      <div class="grid grid-2" style="margin-bottom:16px">
        <div class="kpi ${owed > 0 ? 'bg-lavender' : 'bg-mint'}" style="min-height:0"><div class="label">${icon('wallet')} علينا للموردين</div><div class="value">${money(owed)}</div></div>
        <div class="kpi" style="min-height:0"><div class="label">${icon('truck')} الموردين</div><div class="value">${list.length}</div></div>
      </div>
      <div class="card"><div class="table-wrap"><table class="table">
        <thead><tr><th>المورد</th><th>التليفون</th><th>فواتير</th><th>آخر شراء</th><th class="end">علينا</th></tr></thead>
        <tbody id="srows">${list.length ? list.map((s) => `<tr class="click" data-id="${s.id}" style="${s.active ? '' : 'opacity:.55'}">
          <td><b style="font-weight:500">${esc(s.name)}</b>${s.notes ? `<div class="muted small">${esc(s.notes)}</div>` : ''}</td>
          <td class="num">${esc(s.phone || '')}</td><td class="num">${s.purchases}</td>
          <td class="small">${s.last_purchase ? fmtDate(s.last_purchase, false) : '—'}</td>
          <td class="end">${s.balance > 0.004 ? `<b style="color:var(--danger)">${money(s.balance)}</b>` : '<span class="pill pill-ok">خالص</span>'}</td></tr>`).join('') : emptyRow(5, 'لسه مفيش موردين')}</tbody>
      </table></div></div>`;
    $('#srows').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) openSupplier(tr.dataset.id, show); });
  }

  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { tab = b.dataset.t; show().catch(toastErr); } });
  actions.querySelector('#sup').addEventListener('click', async () => { if (await supplierForm()) { tab = 'suppliers'; show(); } });
  actions.querySelector('#new').addEventListener('click', async () => { if (await purchaseForm()) { tab = 'purchases'; show(); } });
  await show();
  if (query.get('supplier')) openSupplier(query.get('supplier'), show);
  if (query.get('new')) purchaseForm().then((ok) => { if (ok) { tab = 'purchases'; show(); } });
}

function supplierForm(s = null) {
  return modal({
    title: s ? 'تعديل المورد' : 'مورد جديد',
    body: `<form class="form-grid" autocomplete="off" onsubmit="return false">
      <label class="field"><span>اسم المورد *</span><input class="input" name="name" value="${esc(s?.name || '')}" autofocus></label>
      <label class="field"><span>التليفون</span><input class="input ltr" name="phone" inputmode="tel" value="${esc(s?.phone || '')}"></label>
      <label class="field full"><span>ملاحظات</span><input class="input" name="notes" value="${esc(s?.notes || '')}"></label>
      ${s ? `<label class="check full"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}> مورد شغال</label>` : ''}
    </form>`,
    foot: `<button class="btn btn-outline" data-close>إلغاء</button><button class="btn btn-primary" data-ok>${icon('check')} حفظ</button>`,
    onMount: (m, close) => m.querySelector('[data-ok]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const f = formData(m.querySelector('form'));
      const r = s ? await api.put('/suppliers/' + s.id, f) : await api.post('/suppliers', f);
      toast('تم الحفظ', 'ok');
      close(r);
    })),
  });
}

async function openSupplier(id, onChange) {
  let s;
  try { s = await api.get('/suppliers/' + id); } catch (e) { return toastErr(e); }
  const done = await modal({
    title: `${icon('truck')} ${esc(s.name)}`,
    wide: true,
    body: `
      <div class="grid grid-2" style="gap:12px;margin-bottom:14px">
        <div class="kpi ${s.balance > 0.004 ? 'bg-lavender' : 'bg-mint'}" style="min-height:0"><div class="label">علينا للمورد</div><div class="value">${money(s.balance)}</div></div>
        <div><div class="muted small">التليفون</div><div class="num">${esc(s.phone || '—')}</div>${s.notes ? `<div class="small" style="margin-top:6px">${esc(s.notes)}</div>` : ''}</div>
      </div>
      <h4 style="margin:8px 0">فواتير الشراء</h4>
      <div class="table-wrap"><table class="table"><thead><tr><th>الفاتورة</th><th>التاريخ</th><th>الإجمالي</th><th class="end">المدفوع معاها</th></tr></thead>
        <tbody>${s.purchases.length ? s.purchases.map((p) => `<tr><td class="num">${esc(p.purchase_no)}</td><td class="small">${fmtDate(p.created_at)}</td><td>${money(p.total)}</td><td class="end">${money(p.paid)}</td></tr>`).join('') : emptyRow(4)}</tbody></table></div>
      <h4 style="margin:16px 0 8px">الدفعات</h4>
      <div class="table-wrap"><table class="table"><thead><tr><th>التاريخ</th><th>ملاحظة</th><th>من الدرج</th><th class="end">المبلغ</th></tr></thead>
        <tbody>${s.payments.length ? s.payments.map((p) => `<tr><td class="small">${fmtDate(p.created_at)}</td><td class="small">${esc(p.note || '')}</td><td>${p.from_drawer ? 'أيوه' : 'لأ'}</td><td class="end">${money(p.amount)}</td></tr>`).join('') : emptyRow(4)}</tbody></table></div>`,
    foot: `<button class="btn btn-outline" data-edit>${icon('edit')} تعديل</button><span style="flex:1"></span>
      ${s.balance > 0.004 ? `<button class="btn btn-primary" data-pay>${icon('wallet')} دفع للمورد</button>` : ''}`,
    onMount: (m, close) => {
      m.querySelector('[data-edit]').addEventListener('click', async () => { close(null); if (await supplierForm(s)) onChange?.(); });
      m.querySelector('[data-pay]')?.addEventListener('click', async () => { close(null); if (await supplierPay(s)) { onChange?.(); openSupplier(id, onChange); } });
    },
  });
  return done;
}

function supplierPay(s) {
  return modal({
    title: `دفع لـ ${esc(s.name)}`,
    body: `<div class="form-grid">
      <label class="field"><span>المبلغ *</span><input class="input input-lg num" type="number" min="0" step="any" id="amount" value="${s.balance}" autofocus></label>
      <label class="field"><span>ملاحظة</span><input class="input" id="note"></label>
      <label class="check full"><input type="checkbox" id="drawer" checked> اتدفع كاش من الدرج</label>
    </div>`,
    foot: `<button class="btn btn-outline" data-close>إلغاء</button><button class="btn btn-primary" data-ok>${icon('check')} حفظ</button>`,
    onMount: (m, close) => m.querySelector('[data-ok]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      await api.post(`/suppliers/${s.id}/payments`, { amount: m.querySelector('#amount').value, note: m.querySelector('#note').value, from_drawer: m.querySelector('#drawer').checked });
      toast('اتسجل الدفع', 'ok');
      close(true);
    })),
  });
}

async function openPurchase(id) {
  let p;
  try { p = await api.get('/purchases/' + id); } catch (e) { return toastErr(e); }
  return modal({
    title: `فاتورة شراء <span class="num">${esc(p.purchase_no)}</span>`,
    wide: true,
    body: `<div class="grid grid-3" style="gap:12px;margin-bottom:14px">
        <div><div class="muted small">التاريخ</div>${fmtDate(p.created_at)}</div>
        <div><div class="muted small">المورد</div>${esc(p.supplier_name || 'كاش — من غير مورد')}${p.ref_no ? `<div class="small muted">فاتورته: ${esc(p.ref_no)}</div>` : ''}</div>
        <div><div class="muted small">سجّلها</div>${esc(p.user_name || '')}</div></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>الصنف</th><th>الكمية</th><th>سعر الشراء</th><th class="end">الإجمالي</th></tr></thead>
        <tbody>${p.items.map((i) => `<tr><td>${esc(i.name)}${i.serials.length ? `<div class="muted small num">${i.serials.map(esc).join(' • ')}</div>` : ''}</td>
          <td class="num">${i.qty}</td><td>${money(i.unit_cost)}</td><td class="end">${money(i.line_total)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="3">الإجمالي</td><td class="end">${money(p.total)}</td></tr>
          <tr><td colspan="3">المدفوع معاها</td><td class="end">${money(p.paid)}</td></tr></tfoot></table></div>
      ${p.notes ? `<p><span class="muted">ملاحظات:</span> ${esc(p.notes)}</p>` : ''}`,
    foot: '<button class="btn btn-outline" data-close>قفل</button>',
  });
}

/** New purchase invoice: pick products, quantities (or IMEIs) and costs. Stock goes up on save. */
async function purchaseForm() {
  const suppliers = (await api.get('/suppliers')).filter((s) => s.active);
  const lines = [];
  return modal({
    title: 'فاتورة شراء جديدة',
    wide: true,
    body: `
      <div class="form-grid" style="margin-bottom:12px">
        <label class="field"><span>المورد</span><select class="input" id="supplier"><option value="">كاش — من غير مورد</option>
          ${suppliers.map((s) => `<option value="${s.id}">${esc(s.name)}${s.balance > 0.004 ? ` (علينا ${n(s.balance)})` : ''}</option>`).join('')}</select></label>
        <label class="field"><span>رقم فاتورة المورد</span><input class="input ltr" id="ref"></label>
      </div>
      <div class="search" style="position:relative">${icon('search')}<input class="input" id="pq" placeholder="دوّر على المنتج بالاسم أو الباركود…" autocomplete="off">
        <div class="suggest hidden" id="suggest"></div></div>
      <div id="lines" style="margin-top:12px"></div>
      <div class="form-grid" style="margin-top:12px">
        <label class="field"><span>المدفوع دلوقتي</span><input class="input num" type="number" min="0" step="any" id="paid" placeholder="= الإجمالي"></label>
        <label class="field"><span>ملاحظات</span><input class="input" id="notes"></label>
        <label class="check full"><input type="checkbox" id="drawer" checked> المدفوع اتدفع كاش من الدرج</label>
        <div class="full purchase-total" id="total"></div>
      </div>`,
    foot: `<button class="btn btn-outline" data-close>إلغاء</button><button class="btn btn-primary" data-ok>${icon('check')} حفظ ودخول المخزن</button>`,
    onMount: (m, close) => {
      const $ = (s) => m.querySelector(s);
      const draw = () => {
        $('#lines').innerHTML = lines.length ? lines.map((l, i) => `
          <div class="pline" data-i="${i}">
            <div class="pline-head"><b>${esc(l.name)}</b><button class="btn btn-ghost btn-icon btn-sm" data-del>${icon('x')}</button></div>
            <div class="form-grid" style="gap:8px">
              ${l.has_serial
                ? `<label class="field full"><span>IMEI / سيريال — كل واحد في سطر (${l.serials.split('\\n').filter((x) => x.trim()).length} جهاز)</span><textarea class="input num" rows="2" data-f="serials">${esc(l.serials)}</textarea></label>`
                : `<label class="field"><span>الكمية</span><input class="input num" type="number" min="1" data-f="qty" value="${l.qty}"></label>`}
              <label class="field"><span>سعر الشراء للقطعة</span><input class="input num" type="number" min="0" step="any" data-f="unit_cost" value="${l.unit_cost}"></label>
              <label class="field"><span>سعر البيع (اختياري)</span><input class="input num" type="number" min="0" step="any" data-f="sell_price" placeholder="${l.current_sell}" value="${l.sell_price}"></label>
            </div>
          </div>`).join('') : '<div class="empty small">دوّر على المنتجات وضيفها</div>';
        const units = (l) => (l.has_serial ? l.serials.split('\n').filter((x) => x.trim()).length : Number(l.qty) || 0);
        const total = lines.reduce((a, l) => a + units(l) * (Number(l.unit_cost) || 0), 0);
        $('#total').innerHTML = `الإجمالي: <b>${money(total)}</b>`;
      };
      const add = (p) => {
        if (lines.some((l) => l.product_id === p.id && !p.has_serial)) return toast('المنتج ده موجود في الفاتورة', 'err');
        lines.push({ product_id: p.id, name: p.name, has_serial: !!p.has_serial, qty: 1, serials: '', unit_cost: p.cost_price ?? '', sell_price: '', current_sell: p.sell_price });
        $('#pq').value = '';
        $('#suggest').classList.add('hidden');
        draw();
      };
      let found = [];
      $('#pq').addEventListener('input', debounce(async () => {
        const q = $('#pq').value.trim();
        if (!q) { $('#suggest').classList.add('hidden'); return; }
        found = await api.get('/products?limit=8&q=' + encodeURIComponent(q)).catch(() => []);
        $('#suggest').innerHTML = found.length ? found.map((p, i) => `<button type="button" data-i="${i}">${esc(p.name)} <span class="muted small">— عندك ${p.qty}</span></button>`).join('') : '<div class="muted small" style="padding:10px">مفيش منتج بالاسم ده — ضيفه من صفحة المنتجات الأول</div>';
        $('#suggest').classList.remove('hidden');
      }, 250));
      $('#pq').addEventListener('keydown', (e) => { if (e.key === 'Enter' && found[0]) { e.preventDefault(); add(found[0]); } });
      $('#suggest').addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (b) add(found[Number(b.dataset.i)]); });
      $('#lines').addEventListener('input', (e) => {
        const f = e.target.dataset.f;
        if (!f) return;
        lines[Number(e.target.closest('.pline').dataset.i)][f] = e.target.value;
        if (f === 'serials') {
          const box = e.target.closest('.field').querySelector('span');
          box.textContent = `IMEI / سيريال — كل واحد في سطر (${e.target.value.split('\n').filter((x) => x.trim()).length} جهاز)`;
        }
        const units = (l) => (l.has_serial ? l.serials.split('\n').filter((x) => x.trim()).length : Number(l.qty) || 0);
        $('#total').innerHTML = `الإجمالي: <b>${money(lines.reduce((a, l) => a + units(l) * (Number(l.unit_cost) || 0), 0))}</b>`;
      });
      $('#lines').addEventListener('click', (e) => {
        if (!e.target.closest('[data-del]')) return;
        lines.splice(Number(e.target.closest('.pline').dataset.i), 1);
        draw();
      });
      m.querySelector('[data-ok]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        if (!lines.length) throw new Error('ضيف منتجات للفاتورة');
        const p = await api.post('/purchases', {
          supplier_id: $('#supplier').value || null,
          ref_no: $('#ref').value,
          notes: $('#notes').value,
          paid: $('#paid').value === '' ? undefined : Number($('#paid').value),
          paid_from_drawer: $('#drawer').checked,
          items: lines.map((l) => ({
            product_id: l.product_id, qty: Number(l.qty) || 0, unit_cost: l.unit_cost,
            sell_price: l.sell_price === '' ? null : l.sell_price,
            serials: l.has_serial ? l.serials.split('\n').map((x) => x.trim()).filter(Boolean) : undefined,
          })),
        });
        toast(`اتسجلت ${p.purchase_no} والمخزن زاد`, 'ok');
        close(true);
      }));
      draw();
      setTimeout(() => $('#pq').focus(), 50);
    },
  });
}
