import {
  api, can, icon, esc, money, n, fmtDate, modal, toast, toastErr, busy, debounce, formData, emptyRow,
  confirmBox, downloadCsv,
} from '../core.js';

const MOVE_NAMES = { purchase: 'إضافة', sale: 'بيع', return: 'مرتجع', adjust: 'تعديل', stocktake: 'جرد' };

export async function render(el, { query, actions }) {
  let cats = await api.get('/categories');
  let rows = [];
  const showCost = can('products.view_cost');
  const edit = can('products.edit');

  actions.innerHTML = `
    <button class="btn btn-outline btn-sm" id="csv">${icon('download')} تصدير</button>
    ${edit ? `<button class="btn btn-outline btn-sm" id="cats-btn">${icon('layers')} الأقسام</button>
              <button class="btn btn-primary" id="add">${icon('plus')} منتج جديد</button>` : ''}`;

  el.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <div class="search">${icon('search')}<input class="input" id="q" placeholder="اسم، ماركة، باركود أو IMEI…"></div>
        <select class="input" id="cat"><option value="">كل الأقسام</option></select>
        <label class="check"><input type="checkbox" id="low" ${query.get('low') ? 'checked' : ''}> النواقص بس</label>
        ${edit ? '<label class="check"><input type="checkbox" id="inactive"> إظهار الموقوف</label>' : ''}
      </div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>المنتج</th><th>القسم</th><th>الباركود</th>${showCost ? '<th>الشراء</th>' : ''}<th>البيع</th><th>الكمية</th><th></th></tr></thead>
        <tbody id="rows"></tbody>
      </table></div>
      <p class="muted small" id="count" style="margin:12px 0 0"></p>
    </div>`;

  const $ = (s) => el.querySelector(s);
  const fillCats = () => {
    const v = $('#cat').value;
    $('#cat').innerHTML = `<option value="">كل الأقسام</option>${cats.map((c) => `<option value="${c.id}">${esc(c.name)} (${c.products})</option>`).join('')}`;
    $('#cat').value = v;
  };
  fillCats();

  async function load() {
    const p = new URLSearchParams();
    if ($('#q').value.trim()) p.set('q', $('#q').value.trim());
    if ($('#cat').value) p.set('category_id', $('#cat').value);
    if ($('#low').checked) p.set('low', '1');
    if ($('#inactive')?.checked) p.set('inactive', '1');
    rows = await api.get('/products?' + p);
    $('#rows').innerHTML = rows.length ? rows.map((r) => `
      <tr class="click" data-id="${r.id}" style="${r.active ? '' : 'opacity:.5'}">
        <td><b style="font-weight:500">${esc(r.name)}</b> ${r.has_serial ? `<span class="pill pill-info">${icon('phone', '')} IMEI</span>` : ''}
            ${r.active ? '' : '<span class="pill pill-gray">موقوف</span>'}<div class="muted small">${esc(r.brand || '')}</div></td>
        <td>${esc(r.category_name || '—')}</td>
        <td class="num small">${esc(r.barcode || '')}</td>
        ${showCost ? `<td>${money(r.cost_price)}</td>` : ''}
        <td><b style="font-weight:500">${money(r.sell_price)}</b></td>
        <td><span class="pill ${r.qty <= 0 ? 'pill-bad' : r.qty <= r.min_qty ? 'pill-warn' : 'pill-ok'} num">${r.qty}</span></td>
        <td class="end" style="white-space:nowrap">
          ${can('stock.edit') ? `<button class="btn btn-ghost btn-sm" data-a="stock" title="إضافة بضاعة">${icon('plus')}</button>` : ''}
          ${can('labels.print') ? `<a class="btn btn-ghost btn-sm" href="#/labels?add=${r.id}" title="طباعة ليبل">${icon('tag')}</a>` : ''}
          ${edit ? `<button class="btn btn-ghost btn-sm" data-a="edit" title="تعديل">${icon('edit')}</button>` : ''}
        </td>
      </tr>`).join('') : emptyRow(7, 'مفيش منتجات');
    const units = rows.reduce((s, r) => s + r.qty, 0);
    $('#count').innerHTML = `${rows.length} صنف — ${n(units)} قطعة${showCost ? ` — قيمة بسعر الشراء: ${money(rows.reduce((s, r) => s + r.qty * r.cost_price, 0))}` : ''}`;
  }
  const reload = () => load().catch(toastErr);

  $('#rows').addEventListener('click', async (e) => {
    if (e.target.closest('a')) return;
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const id = Number(tr.dataset.id);
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'edit') { if (await productForm(cats, rows.find((r) => r.id === id))) reload(); }
    else if (a === 'stock') { if (await stockForm(await api.get('/products/' + id))) reload(); }
    else { await productDetails(id, cats); reload(); }
  });
  $('#q').addEventListener('input', debounce(reload, 250));
  ['#cat', '#low', '#inactive'].forEach((s) => $(s)?.addEventListener('change', reload));
  actions.querySelector('#add')?.addEventListener('click', async () => { if (await productForm(cats)) reload(); });
  actions.querySelector('#cats-btn')?.addEventListener('click', async () => {
    await categoriesModal();
    cats = await api.get('/categories');
    fillCats();
    reload();
  });
  actions.querySelector('#csv').addEventListener('click', () => downloadCsv('products.csv',
    ['المنتج', 'الماركة', 'القسم', 'الباركود', ...(showCost ? ['سعر الشراء'] : []), 'سعر البيع', 'الكمية', 'حد الطلب'],
    rows.map((r) => [r.name, r.brand, r.category_name, r.barcode, ...(showCost ? [r.cost_price] : []), r.sell_price, r.qty, r.min_qty])));

  await load();
  if (query.get('new') && edit) { if (await productForm(cats)) reload(); }
}

// ---------------- forms ----------------
function productForm(cats, p = null) {
  const isNew = !p;
  return modal({
    title: isNew ? 'منتج جديد' : `تعديل — ${esc(p.name)}`,
    body: `<form class="form-grid" autocomplete="off">
      <label class="field full"><span>اسم المنتج *</span><input class="input" name="name" value="${esc(p?.name || '')}" required></label>
      <label class="field"><span>الماركة</span><input class="input" name="brand" value="${esc(p?.brand || '')}" list="brands"></label>
      <label class="field"><span>القسم</span><select class="input" name="category_id"><option value="">—</option>
        ${cats.map((c) => `<option value="${c.id}" ${p?.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      ${can('products.view_cost') ? `<label class="field"><span>سعر الشراء</span><input class="input num" type="number" step="any" min="0" name="cost_price" value="${p?.cost_price ?? ''}"></label>` : ''}
      <label class="field"><span>سعر البيع *</span><input class="input num" type="number" step="any" min="0" name="sell_price" value="${p?.sell_price ?? ''}" required></label>
      <label class="field"><span>الباركود</span><input class="input ltr" name="barcode" value="${esc(p?.barcode || '')}" placeholder="سيبه فاضي ويتعمل تلقائي"></label>
      <label class="field"><span>حد الطلب (تنبيه النواقص)</span><input class="input num" type="number" min="0" name="min_qty" value="${p?.min_qty ?? 1}"></label>
      ${isNew ? `
        <label class="check full"><input type="checkbox" name="has_serial" id="hs"> جهاز بـ IMEI / سيريال (كل قطعة ليها رقم)</label>
        <label class="field full" id="qty-f"><span>الكمية الموجودة دلوقتي</span><input class="input num" type="number" min="0" name="initial_qty" value="0"></label>
        <label class="field full hidden" id="ser-f"><span>أرقام الـ IMEI (رقم في كل سطر — ممكن تمسحهم بالاسكانر)</span><textarea class="input ltr" name="serials" rows="4"></textarea></label>` : ''}
      <label class="field full"><span>ملاحظات</span><input class="input" name="notes" value="${esc(p?.notes || '')}"></label>
      ${!isNew ? `<label class="check full"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> المنتج نشط (يظهر في البيع)</label>` : ''}
    </form>`,
    foot: `<button class="btn btn-outline" data-close>إلغاء</button><button class="btn btn-primary" data-ok>${icon('check')} حفظ</button>`,
    onMount: (m, close) => {
      const hs = m.querySelector('#hs');
      hs?.addEventListener('change', () => {
        m.querySelector('#qty-f').classList.toggle('hidden', hs.checked);
        m.querySelector('#ser-f').classList.toggle('hidden', !hs.checked);
      });
      // Scanner sends Enter after each code: keep it inside the textarea
      m.querySelector('form').addEventListener('submit', (e) => e.preventDefault());
      m.querySelector('[data-ok]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const f = formData(m.querySelector('form'));
        const body = { ...f, category_id: f.category_id || null };
        if (isNew) {
          body.serials = (f.serials || '').split(/\s+/).filter(Boolean);
          if (!body.has_serial) delete body.serials;
          await api.post('/products', body);
          toast('تم إضافة المنتج', 'ok');
        } else {
          await api.put('/products/' + p.id, body);
          toast('تم الحفظ', 'ok');
        }
        close(true);
      }));
    },
  });
}

function stockForm(p) {
  return modal({
    title: `إضافة بضاعة — ${esc(p.name)}`,
    body: `<div class="form-grid">
      ${p.has_serial
        ? '<label class="field full"><span>أرقام الـ IMEI (رقم في كل سطر)</span><textarea class="input ltr" name="serials" rows="5" autofocus></textarea></label>'
        : '<label class="field"><span>الكمية *</span><input class="input num" type="number" min="1" name="qty" autofocus></label>'}
      ${can('products.view_cost') ? `<label class="field"><span>سعر الشراء للقطعة</span><input class="input num" type="number" min="0" step="any" name="cost_price" placeholder="${p.cost_price}"></label>` : ''}
      <label class="field full"><span>ملاحظة (المورد / رقم الفاتورة)</span><input class="input" name="note"></label>
    </div>
    <p class="muted small">الكمية الحالية: <b class="num">${p.qty}</b>. لو دخلت سعر شراء جديد، بيتحسب متوسط التكلفة تلقائي.</p>`,
    foot: `<button class="btn btn-outline" data-close>إلغاء</button><button class="btn btn-primary" data-ok>${icon('plus')} إضافة للمخزن</button>`,
    onMount: (m, close) => {
      m.querySelector('[data-ok]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const f = formData(m.querySelector('.modal-body'));
        const body = { qty: f.qty, cost_price: f.cost_price || undefined, note: f.note };
        if (p.has_serial) body.serials = (f.serials || '').split(/\s+/).filter(Boolean);
        const r = await api.post(`/products/${p.id}/stock`, body);
        toast(`تمت الإضافة — الكمية دلوقتي ${r.qty}`, 'ok');
        close(true);
      }));
    },
  });
}

function adjustForm(p) {
  return modal({
    title: `تعديل الكمية — ${esc(p.name)}`,
    body: `<div class="form-grid">
      <label class="field"><span>الكمية الصحيحة</span><input class="input num" type="number" min="0" name="qty" value="${p.qty}" autofocus></label>
      <label class="field"><span>السبب *</span><input class="input" name="note" placeholder="تالف، هدية، تصحيح…"></label></div>`,
    foot: `<button class="btn btn-outline" data-close>إلغاء</button><button class="btn btn-primary" data-ok>حفظ</button>`,
    onMount: (m, close) => m.querySelector('[data-ok]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      await api.post(`/products/${p.id}/adjust`, formData(m.querySelector('.modal-body')));
      toast('تم التعديل', 'ok');
      close(true);
    })),
  });
}

async function productDetails(id, cats) {
  const p = await api.get('/products/' + id);
  const moves = can('stock.edit') ? await api.get(`/products/${id}/movements`) : [];
  const again = await modal({
    title: esc(p.name),
    wide: true,
    body: `
      <div class="grid grid-4" style="gap:12px">
        <div class="kpi bg-sky" style="min-height:0;padding:16px"><div class="label">الكمية</div><div class="value">${p.qty}</div></div>
        <div class="kpi bg-mint" style="min-height:0;padding:16px"><div class="label">سعر البيع</div><div class="value">${n(p.sell_price)}</div></div>
        ${p.cost_price !== undefined ? `<div class="kpi bg-lavender" style="min-height:0;padding:16px"><div class="label">متوسط التكلفة</div><div class="value">${n(p.cost_price)}</div></div>` : ''}
        <div class="kpi bg-periwinkle" style="min-height:0;padding:16px"><div class="label">الباركود</div><div class="value" style="font-size:16px">${esc(p.barcode || '')}</div></div>
      </div>
      ${p.has_serial ? `<h4 style="margin:20px 0 8px">الأجهزة في المخزن (${p.serials.length})</h4>
        <div class="chips">${p.serials.map((s) => `<span class="chip">${esc(s.serial)}${can('stock.edit') ? `<button data-del-serial="${s.id}" title="حذف">×</button>` : ''}</span>`).join('') || '<span class="muted">مفيش</span>'}</div>` : ''}
      ${moves.length ? `<h4 style="margin:20px 0 8px">حركة الصنف</h4>
        <div class="table-wrap" style="max-height:280px;overflow:auto"><table class="table">
          <thead><tr><th>التاريخ</th><th>النوع</th><th>الكمية</th><th>بعدها</th><th>ملاحظة</th><th>الموظف</th></tr></thead>
          <tbody>${moves.map((m) => `<tr><td class="small">${fmtDate(m.created_at)}</td><td>${MOVE_NAMES[m.type]}</td>
            <td class="num" style="color:${m.qty_change < 0 ? 'var(--danger)' : 'var(--ok)'}">${m.qty_change > 0 ? '+' : ''}${m.qty_change}</td>
            <td class="num">${m.qty_after}</td><td class="small">${esc(m.note || '')}</td><td class="small">${esc(m.user_name || '')}</td></tr>`).join('')}</tbody>
        </table></div>` : ''}`,
    foot: `
      ${can('products.edit') ? `<button class="btn btn-ghost" data-a="deactivate" style="color:var(--danger)">${icon('trash')} إيقاف المنتج</button><span style="flex:1"></span>` : ''}
      ${can('labels.print') ? `<a class="btn btn-outline" href="#/labels?add=${p.id}">${icon('tag')} ليبل</a>` : ''}
      ${can('stock.edit') && !p.has_serial ? `<button class="btn btn-outline" data-a="adjust">تعديل الكمية</button>` : ''}
      ${can('products.edit') ? `<button class="btn btn-outline" data-a="edit">${icon('edit')} تعديل</button>` : ''}
      ${can('stock.edit') ? `<button class="btn btn-primary" data-a="stock">${icon('plus')} إضافة بضاعة</button>` : ''}`,
    onMount: (m, close) => {
      m.querySelector('a[href^="#/labels"]')?.addEventListener('click', () => close(null));
      m.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', async () => {
        const a = b.dataset.a;
        close(null);
        let changed = false;
        if (a === 'edit') changed = await productForm(cats, p);
        if (a === 'stock') changed = await stockForm(p);
        if (a === 'adjust') changed = await adjustForm(p);
        if (a === 'deactivate' && await confirmBox(`إيقاف "${esc(p.name)}"؟ مش هيظهر في البيع، والتقارير القديمة بتفضل زي ما هي.`, { danger: true, ok: 'إيقاف' })) {
          await api.del('/products/' + p.id).catch(toastErr);
          changed = true;
        }
        if (changed) await productDetails(id, cats);
      }));
      m.querySelectorAll('[data-del-serial]').forEach((b) => b.addEventListener('click', async () => {
        const reason = prompt('سبب حذف الجهاز من المخزن؟', 'تالف');
        if (reason === null) return;
        try {
          await api(`/serials/${b.dataset.delSerial}`, { method: 'DELETE', body: { note: reason } });
          b.parentElement.remove();
          toast('تم الحذف', 'ok');
        } catch (e) { toastErr(e); }
      }));
    },
  });
  return again;
}

function categoriesModal() {
  const draw = (cats) => cats.map((c) => `
    <div style="display:flex;gap:8px;align-items:center;padding:6px 0" data-id="${c.id}">
      <input class="input" value="${esc(c.name)}" data-name>
      <span class="pill pill-gray" style="flex-shrink:0">${c.products} منتج</span>
      <button class="btn btn-ghost btn-icon" data-save title="حفظ">${icon('check')}</button>
      <button class="btn btn-ghost btn-icon" data-del title="حذف">${icon('trash')}</button>
    </div>`).join('');
  return modal({
    title: 'الأقسام',
    body: `<div id="list"></div>
      <div style="display:flex;gap:8px;margin-top:12px"><input class="input" id="new" placeholder="قسم جديد"><button class="btn btn-primary" id="add">${icon('plus')} إضافة</button></div>`,
    onMount: async (m) => {
      const refresh = async () => { m.querySelector('#list').innerHTML = draw(await api.get('/categories')); };
      await refresh();
      m.querySelector('#add').addEventListener('click', async () => {
        try { await api.post('/categories', { name: m.querySelector('#new').value }); m.querySelector('#new').value = ''; await refresh(); } catch (e) { toastErr(e); }
      });
      m.querySelector('#list').addEventListener('click', async (e) => {
        const row = e.target.closest('[data-id]');
        if (!row) return;
        try {
          if (e.target.closest('[data-save]')) { await api.put('/categories/' + row.dataset.id, { name: row.querySelector('[data-name]').value }); toast('تم الحفظ', 'ok'); }
          if (e.target.closest('[data-del]')) { await api.del('/categories/' + row.dataset.id); await refresh(); }
        } catch (err) { toastErr(err); }
      });
    },
  });
}
