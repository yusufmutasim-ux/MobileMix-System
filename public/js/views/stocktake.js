import { api, icon, esc, money, fmtDate, modal, toast, toastErr, busy, emptyRow, confirmBox, can, downloadCsv } from '../core.js';

const ST_PILLS = {
  open: '<span class="pill pill-info">مفتوح</span>',
  applied: '<span class="pill pill-ok">متطبق</span>',
  cancelled: '<span class="pill pill-gray">ملغي</span>',
};

export async function render(el, { id, actions }) {
  return id ? detail(el, id, actions) : list(el, actions);
}

async function list(el, actions) {
  actions.innerHTML = `<button class="btn btn-primary" id="new">${icon('plus')} جرد جديد</button>`;
  const rows = await api.get('/stocktakes');
  el.innerHTML = `
    <div class="grid grid-3" style="margin-bottom:24px">
      <div class="kpi bg-periwinkle"><div class="label">${icon('plus')} 1. افتح جرد</div><div class="sub">للمخزن كله أو لقسم واحد. السيستم بيحفظ الكميات المسجلة لحظة الفتح.</div></div>
      <div class="kpi bg-aqua"><div class="label">${icon('barcode')} 2. اعد البضاعة</div><div class="sub">امسح باركود كل قطعة، أو اكتب العدد. الموبايلات بتتعد بمسح الـ IMEI.</div></div>
      <div class="kpi bg-mint"><div class="label">${icon('check')} 3. طبّق الفروقات</div><div class="sub">الزيادة والعجز بيتسجلوا في حركة المخزن، والأجهزة الناقصة بتتعلم "مفقودة".</div></div>
    </div>
    <div class="card">
      <div class="table-wrap"><table class="table">
        <thead><tr><th>#</th><th>التاريخ</th><th>بواسطة</th><th>ملاحظة</th><th>الأصناف</th><th>اتعد</th><th>فروقات</th><th>الحالة</th></tr></thead>
        <tbody>${rows.length ? rows.map((r) => `
          <tr class="click" data-id="${r.id}"><td class="num">${r.id}</td><td class="small">${fmtDate(r.created_at)}</td><td>${esc(r.user_name)}</td>
            <td>${esc(r.note || '')}</td><td class="num">${r.items}</td><td class="num">${r.counted}</td>
            <td>${r.diffs ? `<span class="pill pill-warn num">${r.diffs}</span>` : '<span class="num">0</span>'}</td><td>${ST_PILLS[r.status]}</td></tr>`).join('')
          : emptyRow(8, 'لسه مفيش جرد')}</tbody>
      </table></div>
    </div>`;
  el.querySelector('tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) location.hash = `#/stocktake/${tr.dataset.id}`;
  });
  actions.querySelector('#new').addEventListener('click', async () => {
    const cats = await api.get('/categories');
    const newId = await modal({
      title: 'جرد جديد',
      body: `<div class="form-grid">
        <label class="field full"><span>القسم</span><select class="input" name="category_id"><option value="">المخزن كله</option>
          ${cats.map((c) => `<option value="${c.id}">${esc(c.name)} (${c.products})</option>`).join('')}</select></label>
        <label class="field full"><span>ملاحظة</span><input class="input" name="note" placeholder="مثلاً: جرد آخر الشهر"></label></div>`,
      foot: `<button class="btn btn-outline" data-close>إلغاء</button><button class="btn btn-primary" data-ok>ابدأ الجرد</button>`,
      onMount: (m, close) => m.querySelector('[data-ok]').addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
        const r = await api.post('/stocktakes', {
          category_id: m.querySelector('[name=category_id]').value || null,
          note: m.querySelector('[name=note]').value,
        });
        close(r.id);
      })),
    });
    if (newId) location.hash = `#/stocktake/${newId}`;
  });
}

async function detail(el, id, actions) {
  let st = await api.get('/stocktakes/' + id);
  let filter = 'all';
  const open = st.status === 'open';
  const showCost = can('products.view_cost');

  actions.innerHTML = `
    <a class="btn btn-ghost btn-sm" href="#/stocktake">رجوع</a>
    <button class="btn btn-outline btn-sm" id="csv">${icon('download')} تصدير</button>
    ${open ? `<button class="btn btn-danger btn-sm" id="cancel">إلغاء الجرد</button>
              <button class="btn btn-primary" id="apply">${icon('check')} تطبيق الفروقات</button>` : ''}`;

  el.innerHTML = `
    <div class="grid grid-4" id="kpis" style="margin-bottom:24px"></div>
    ${open ? `<div class="card" style="padding:16px;margin-bottom:24px">
      <div class="search">${icon('barcode')}<input class="input input-lg ltr" id="scan" placeholder="امسح الباركود أو الـ IMEI…" autocomplete="off"></div>
      <div class="scan-hint" id="last">كل مسحة باركود بتزود العدد 1. ممكن كمان تكتب العدد في الجدول.</div>
    </div>` : ''}
    <div class="card">
      <div class="card-head"><h2>جرد #${st.id} ${ST_PILLS[st.status]}</h2>
        <span class="muted small">${fmtDate(st.created_at)} — ${esc(st.user_name)} ${st.note ? `— ${esc(st.note)}` : ''}</span>
        <div class="seg" id="filter"><button data-f="all" class="on">الكل</button><button data-f="pending">لسه</button><button data-f="diff">فروقات</button></div>
      </div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>المنتج</th><th>الباركود</th><th>المسجل</th><th style="width:130px">الفعلي</th><th>الفرق</th>${showCost ? '<th class="end">قيمة الفرق</th>' : ''}</tr></thead>
        <tbody id="rows"></tbody>
      </table></div>
    </div>`;

  const $ = (s) => el.querySelector(s);

  function draw() {
    const items = st.items;
    const counted = items.filter((i) => i.counted_qty !== null);
    const diffs = counted.filter((i) => i.counted_qty !== i.expected_qty);
    const value = diffs.reduce((s, i) => s + (i.counted_qty - i.expected_qty) * (i.cost_price || 0), 0);
    $('#kpis').innerHTML = `
      <div class="kpi bg-periwinkle"><div class="label">الأصناف</div><div class="value">${items.length}</div></div>
      <div class="kpi bg-sky"><div class="label">اتعد</div><div class="value">${counted.length}</div></div>
      <div class="kpi ${diffs.length ? 'bg-peony' : 'bg-mint'}"><div class="label">فيها فروقات</div><div class="value">${diffs.length}</div></div>
      ${showCost ? `<div class="kpi bg-lavender"><div class="label">قيمة الفروقات</div><div class="value">${money(value)}</div></div>` : ''}`;

    const shown = items.filter((i) => filter === 'all' || (filter === 'pending' ? i.counted_qty === null : i.counted_qty !== null && i.counted_qty !== i.expected_qty));
    $('#rows').innerHTML = shown.length ? shown.map((i) => {
      const d = i.counted_qty === null ? null : i.counted_qty - i.expected_qty;
      return `<tr data-p="${i.product_id}">
        <td><b style="font-weight:500">${esc(i.name)}</b> ${i.has_serial ? `<span class="pill pill-info">${icon('phone', '')} IMEI</span>` : ''}
          <div class="muted small">${esc(i.category_name || '')}</div>
          ${i.has_serial && i.found_serials.length ? `<div class="chips" style="margin-top:4px">${i.found_serials.map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</div>` : ''}</td>
        <td class="num small">${esc(i.barcode || '')}</td>
        <td class="num">${i.expected_qty}</td>
        <td>${open ? (i.has_serial
          ? `<span class="num">${i.counted_qty ?? '—'}</span> ${i.counted_qty === null ? '<button class="btn btn-ghost btn-sm" data-zero>مفيش</button>' : '<button class="btn btn-ghost btn-sm" data-reset>تصفير</button>'}`
          : `<input class="input num" type="number" min="0" data-count value="${i.counted_qty ?? ''}" placeholder="—" style="min-height:36px;padding:6px 10px">`)
          : `<span class="num">${i.counted_qty ?? '—'}</span>`}</td>
        <td>${d === null ? '<span class="muted">—</span>' : d === 0 ? '<span class="pill pill-ok">مظبوط</span>' : `<span class="pill ${d < 0 ? 'pill-bad' : 'pill-warn'} num">${d > 0 ? '+' : ''}${d}</span>`}</td>
        ${showCost ? `<td class="end">${d ? money(d * (i.cost_price || 0)) : ''}</td>` : ''}
      </tr>`;
    }).join('') : emptyRow(6, 'مفيش أصناف هنا');
  }

  function update(item) {
    const i = st.items.find((x) => x.product_id === item.product_id);
    if (!i) return;
    i.counted_qty = item.counted_qty;
  }

  $('#filter').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    filter = b.dataset.f;
    $('#filter').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    draw();
  });

  if (open) {
    const scan = $('#scan');
    scan.focus();
    scan.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || !scan.value.trim()) return;
      const code = scan.value.trim();
      scan.value = '';
      try {
        const r = await api.post(`/stocktakes/${id}/scan`, { code });
        if (r.serial) st = await api.get('/stocktakes/' + id);
        else update(r.item);
        $('#last').innerHTML = `${icon('check', '')} <b style="color:var(--ink)">${esc(r.item.name)}</b> — العدد دلوقتي <b class="num">${r.item.counted_qty}</b>`;
        draw();
      } catch (err) {
        toastErr(err);
        $('#last').innerHTML = `<span style="color:var(--danger)">${esc(err.message)}</span>`;
      }
    });

    $('#rows').addEventListener('change', async (e) => {
      const inp = e.target.closest('[data-count]');
      if (!inp) return;
      const pid = inp.closest('tr').dataset.p;
      try {
        const r = await api.put(`/stocktakes/${id}/items/${pid}`, { counted_qty: inp.value === '' ? null : Number(inp.value) });
        update(r.item);
        draw();
      } catch (err) { toastErr(err); }
    });
    $('#rows').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-zero],[data-reset]');
      if (!b) return;
      const pid = b.closest('tr').dataset.p;
      try {
        await api.put(`/stocktakes/${id}/items/${pid}`, { counted_qty: b.hasAttribute('data-zero') ? 0 : null });
        st = await api.get('/stocktakes/' + id);
        draw();
      } catch (err) { toastErr(err); }
    });

    actions.querySelector('#apply').addEventListener('click', async () => {
      const pending = st.items.filter((i) => i.counted_qty === null).length;
      const ok = await confirmBox(`هيتم تعديل المخزن حسب العدد الفعلي.${pending ? `<br><b>${pending} صنف لسه متعدوش</b> — دول مش هيتغيروا.` : ''}<br>متأكد؟`, { ok: 'تطبيق' });
      if (!ok) return;
      try {
        const r = await api.post(`/stocktakes/${id}/apply`);
        toast(`تم التطبيق — ${r.changed} صنف اتعدل${r.missing ? `، ${r.missing} جهاز مفقود` : ''}`, 'ok');
        location.reload();
      } catch (err) { toastErr(err); }
    });
    actions.querySelector('#cancel').addEventListener('click', async () => {
      if (!(await confirmBox('إلغاء الجرد ده؟ مفيش حاجة هتتغير في المخزن.', { danger: true, ok: 'إلغاء الجرد' }))) return;
      await api.post(`/stocktakes/${id}/cancel`).catch(toastErr);
      location.hash = '#/stocktake';
    });
  }

  actions.querySelector('#csv').addEventListener('click', () => downloadCsv(`stocktake-${id}.csv`,
    ['المنتج', 'الباركود', 'المسجل', 'الفعلي', 'الفرق'],
    st.items.map((i) => [i.name, i.barcode, i.expected_qty, i.counted_qty ?? '', i.counted_qty === null ? '' : i.counted_qty - i.expected_qty])));

  draw();
}
