import {
  api, can, state, icon, esc, money, n, fmtDate, modal, toast, toastErr, busy, debounce, formData, emptyRow,
  confirmBox, downloadCsv,
} from '../core.js';
import { readBox } from '../box-reader.js';

const MOVE_NAMES = { purchase: 'إضافة', sale: 'بيع', return: 'مرتجع', adjust: 'تعديل', stocktake: 'جرد' };

export async function render(el, { query, actions }) {
  let cats = await api.get('/categories');
  let rows = [];
  const showCost = can('products.view_cost');
  const edit = can('products.edit');

  actions.innerHTML = `
    <button class="btn btn-outline btn-sm" id="csv">${icon('download')} تصدير</button>
    ${edit ? `<button class="btn btn-outline btn-sm" id="cats-btn">${icon('layers')} الأقسام</button>
              <button class="btn btn-outline btn-sm" id="brands-btn">${icon('tag')} البراندات</button>
              <label class="btn btn-outline btn-sm photo-add" id="photo-add">${icon('camera')} من صورة
                <input type="file" accept="image/*" multiple id="photo-input" class="visually-hidden-file"></label>
              <button class="btn btn-primary" id="add">${icon('plus')} منتج جديد</button>` : ''}`;

  el.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <div class="search">${icon('search')}<input class="input" id="q" placeholder="اسم، ماركة، باركود أو IMEI…"></div>
        <select class="input" id="cat"><option value="">كل الأقسام</option></select>
        <select class="input" id="brand"><option value="">كل البراندات</option></select>
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
  const fillBrands = async () => {
    const v = $('#brand').value;
    const list = await api.get('/brands');
    $('#brand').innerHTML = `<option value="">كل البراندات</option>${list.map((b) => `<option value="${esc(b.name)}">${esc(b.name)} (${b.products})</option>`).join('')}`;
    $('#brand').value = v;
  };
  await fillBrands();

  async function load() {
    const p = new URLSearchParams();
    if ($('#q').value.trim()) p.set('q', $('#q').value.trim());
    if ($('#cat').value) p.set('category_id', $('#cat').value);
    if ($('#brand').value) p.set('brand', $('#brand').value);
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
  ['#cat', '#brand', '#low', '#inactive'].forEach((s) => $(s)?.addEventListener('change', reload));
  actions.querySelector('#brands-btn')?.addEventListener('click', async () => {
    await brandsModal();
    await fillBrands();
    reload();
  });
  actions.querySelector('#add')?.addEventListener('click', async () => { if (await productForm(cats)) reload(); });
  // A real file field inside the page: iPhones drop the photo when the field isn't part of the page
  actions.querySelector('#photo-input')?.addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = ''; // the same photo can be picked again
    if (files.length && await addFromPhotos(cats, files)) reload();
  });
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
  if (query.get('open')) { await productDetails(Number(query.get('open')), cats); reload(); }
}

// ---------------- forms ----------------
async function productForm(cats, p = null, guess = null) {
  const isNew = !p;
  const brands = await api.get('/brands');
  const current = brands.find((b) => b.name.toLowerCase() === String(p?.brand || guess?.brand || '').toLowerCase());
  // From a photo: a brand that isn't in the list yet is added when the product is saved
  const newBrand = guess?.brand && !current ? guess.brand : '';
  const catId = p?.category_id ?? guess?.category_id;
  return modal({
    title: isNew ? (guess ? 'منتج جديد من صورة' : 'منتج جديد') : `تعديل — ${esc(p.name)}`,
    body: `<form class="form-grid" autocomplete="off">
      ${guess ? `<div class="full ai-guess ${guess.confidence}">
        ${guess.photo ? `<img src="${guess.photo}" alt="">` : ''}
        <div><b>${guess.confidence === 'high' ? '✓ اتعرف من الصورة' : guess.confidence === 'medium' ? 'اتعرف من الصورة — راجع الاسم' : '⚠️ الصورة مش واضحة — راجع كل حاجة'}</b>
          ${guess.notes ? `<div class="small">${esc(guess.notes)}</div>` : ''}
          <div class="small muted">اكتب الكمية والسعر واحفظ.</div></div></div>
        ${guess.lines?.length ? `<div class="full ai-lines"><span class="small muted">الكلام اللي اتقرا من العلبة — دوس على أي سطر يتضاف للاسم:</span>
          <div>${guess.lines.map((l) => `<button type="button" class="ai-line">${esc(l)}</button>`).join('')}</div></div>` : ''}` : ''}
      <label class="field full"><span>اسم المنتج *</span><input class="input" name="name" dir="auto" value="${esc(p?.name || guess?.name || '')}" required></label>
      <label class="field"><span>البراند</span><select class="input" name="brand" id="brand-sel">
        <option value="">— من غير براند —</option>
        ${brands.map((b) => `<option value="${esc(b.name)}" ${current?.id === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
        ${newBrand ? `<option value="__ai:${esc(newBrand)}" selected>${esc(newBrand)} (براند جديد — هيتضاف للقايمة)</option>` : ''}
        <option value="__new">➕ براند جديد…</option></select></label>
      <div class="full hidden" id="new-brand" style="display:flex;gap:8px">
        <input class="input" id="new-brand-name" placeholder="اسم البراند الجديد" style="flex:1">
        <button type="button" class="btn btn-primary" id="new-brand-add">${icon('plus')} إضافة</button>
        <button type="button" class="btn btn-ghost" id="new-brand-cancel">إلغاء</button></div>
      <label class="field"><span>القسم</span><select class="input" name="category_id"><option value="">—</option>
        ${cats.map((c) => `<option value="${c.id}" ${catId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      ${can('products.view_cost') ? `<label class="field"><span>سعر الشراء</span><input class="input num" type="number" step="any" min="0" name="cost_price" value="${p?.cost_price ?? ''}"></label>` : ''}
      <label class="field"><span>سعر البيع *</span><input class="input num" type="number" step="any" min="0" name="sell_price" value="${p?.sell_price ?? ''}" required></label>
      <label class="field"><span>الباركود</span><input class="input ltr" name="barcode" value="${esc(p?.barcode || '')}" placeholder="سيبه فاضي ويتعمل تلقائي"></label>
      <label class="field"><span>حد الطلب (تنبيه النواقص)</span><input class="input num" type="number" min="0" name="min_qty" value="${p?.min_qty ?? 1}"></label>
      <label class="field"><span>الضمان (بالأيام — 0 = من غير)</span><input class="input num" type="number" min="0" name="warranty_days" value="${p?.warranty_days ?? 0}" list="warranty-presets">
        <datalist id="warranty-presets"><option value="7"><option value="14"><option value="30"><option value="90"><option value="180"><option value="365"></datalist></label>
      ${isNew ? `
        <label class="check full"><input type="checkbox" name="has_serial" id="hs"> جهاز بـ IMEI / سيريال (كل قطعة ليها رقم)</label>
        <label class="field full" id="qty-f"><span>الكمية الموجودة دلوقتي</span><input class="input num" type="number" min="0" name="initial_qty" value="0"></label>
        <label class="field full hidden" id="ser-f"><span>أرقام الـ IMEI (رقم في كل سطر — ممكن تمسحهم بالاسكانر)</span><textarea class="input ltr" name="serials" rows="4"></textarea></label>` : ''}
      <label class="field full"><span>ملاحظات</span><input class="input" name="notes" value="${esc(p?.notes || '')}"></label>
      <div class="full store-fields">
        <div class="section-title" style="margin:4px 0 8px">${icon('globe')} المتجر الأونلاين</div>
        <div class="img-pick">
          <div class="img-prev" id="img-prev">${p?.image ? `<img src="/uploads/${esc(p.image)}" alt="">` : guess?.photo ? `<img src="${guess.photo}" alt="">` : icon('camera')}</div>
          <div class="btn-row">
            <label class="btn btn-outline btn-sm photo-add">${icon('camera')} ${p?.image || guess?.photo ? 'غيّر الصورة' : 'صورة المنتج'}<input type="file" accept="image/*" id="img-in" class="visually-hidden-file"></label>
            <button type="button" class="btn btn-ghost btn-sm ${p?.image || guess?.photo ? '' : 'hidden'}" id="img-del">${icon('trash')} شيل الصورة</button>
          </div>
        </div>
        <label class="field full" style="margin-top:10px"><span>وصف يظهر في الموقع (اختياري)</span><textarea class="input" name="description" rows="2" dir="auto">${esc(p?.description || '')}</textarea></label>
        <label class="check full" style="margin-top:8px"><input type="checkbox" name="online" ${(state.settings.store_products === 'manual' ? p?.online_show : !p?.online_hidden) ? 'checked' : ''}> يظهر في المتجر الأونلاين ${state.settings.store_products === 'manual' ? '' : '<span class="muted small">(لو ليه سعر وفيه كمية)</span>'}</label>
      </div>
      ${!isNew ? `<label class="check full"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> المنتج نشط (يظهر في البيع)</label>` : ''}
    </form>`,
    foot: `<button class="btn btn-outline" data-close>إلغاء</button><button class="btn btn-primary" data-ok>${icon('check')} حفظ</button>`,
    onMount: (m, close) => {
      // Product picture: chosen here, uploaded after the product is saved (a box photo is used by default)
      let picture = guess?.photo || null;
      let dropPicture = false;
      m.querySelector('#img-in').addEventListener('change', async (e) => {
        const f = e.target.files[0];
        e.target.value = '';
        if (!f) return;
        picture = await shrink(f);
        dropPicture = false;
        m.querySelector('#img-prev').innerHTML = `<img src="${picture}" alt="">`;
        m.querySelector('#img-del').classList.remove('hidden');
      });
      m.querySelector('#img-del').addEventListener('click', () => {
        picture = null;
        dropPicture = !!p?.image;
        m.querySelector('#img-prev').innerHTML = icon('camera');
        m.querySelector('#img-del').classList.add('hidden');
      });
      m.querySelectorAll('.ai-line').forEach((b) => b.addEventListener('click', () => {
        const inp = m.querySelector('[name=name]');
        inp.value = `${inp.value.trim()} ${b.textContent}`.trim();
        b.classList.add('used');
      }));
      const hs = m.querySelector('#hs');
      hs?.addEventListener('change', () => {
        m.querySelector('#qty-f').classList.toggle('hidden', hs.checked);
        m.querySelector('#ser-f').classList.toggle('hidden', !hs.checked);
      });
      // Brand: pick from the list, or add a new one right here
      const sel = m.querySelector('#brand-sel');
      const box = m.querySelector('#new-brand');
      let prev = sel.value;
      sel.addEventListener('change', () => {
        if (sel.value === '__new') { box.classList.remove('hidden'); m.querySelector('#new-brand-name').focus(); }
        else { prev = sel.value; box.classList.add('hidden'); }
      });
      m.querySelector('#new-brand-cancel').addEventListener('click', () => { sel.value = prev; box.classList.add('hidden'); });
      const addBrand = (e) => busy(e?.currentTarget || null, async () => {
        const b = await api.post('/brands', { name: m.querySelector('#new-brand-name').value });
        if (![...sel.options].some((o) => o.value === b.name)) {
          const o = document.createElement('option'); o.value = b.name; o.textContent = b.name;
          sel.insertBefore(o, sel.querySelector('option[value="__new"]'));
        }
        sel.value = b.name; prev = b.name;
        m.querySelector('#new-brand-name').value = '';
        box.classList.add('hidden');
        toast(`اتضاف البراند ${b.name}`, 'ok');
      });
      m.querySelector('#new-brand-add').addEventListener('click', addBrand);
      m.querySelector('#new-brand-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addBrand(); } });
      // Scanner sends Enter after each code: keep it inside the textarea
      m.querySelector('form').addEventListener('submit', (e) => e.preventDefault());
      m.querySelector('[data-ok]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const f = formData(m.querySelector('form'));
        if (f.brand === '__new') throw new Error('اكتب اسم البراند الجديد ودوس إضافة، أو اختار براند من القايمة');
        if (f.brand?.startsWith('__ai:')) f.brand = (await api.post('/brands', { name: f.brand.slice(5) })).name;
        const body = { ...f, category_id: f.category_id || null };
        if (state.settings.store_products === 'manual') body.online_show = f.online ? 1 : 0;
        else body.online_hidden = f.online ? 0 : 1;
        delete body.online;
        let saved;
        if (isNew) {
          body.serials = (f.serials || '').split(/\s+/).filter(Boolean);
          if (!body.has_serial) delete body.serials;
          saved = await api.post('/products', body);
          toast('تم إضافة المنتج', 'ok');
        } else {
          saved = await api.put('/products/' + p.id, body);
          toast('تم الحفظ', 'ok');
        }
        if (picture && picture.startsWith('data:')) await api.post(`/products/${saved.id}/image`, { image: picture }).catch((e) => toast(`المنتج اتحفظ بس الصورة لأ: ${e.message}`, 'err'));
        else if (dropPicture) await api.del(`/products/${saved.id}/image`).catch(() => {});
        close(true);
      }));
    },
  });
}

// ---------------- adding products from photos of their boxes ----------------
/** Smaller copy of a photo for upload (long side 1568px, JPEG). */
async function shrink(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = url; });
    const k = Math.min(1, 1568 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  } finally { URL.revokeObjectURL(url); }
}

/** Pick or take photos; each box is read, then its product form opens filled in. */
async function addFromPhotos(cats, files) {
  // Free reading on the device by default; Claude (better names) only if the shop added its own key
  const [st, brands] = await Promise.all([
    api.get('/ai/status').catch(() => ({ enabled: false })),
    api.get('/brands').catch(() => []),
  ]);
  let changed = false;
  for (const [i, file] of files.entries()) {
    let photo, guess, closeWait;
    const waiting = modal({
      title: files.length > 1 ? `بيقرا الصورة ${i + 1} من ${files.length}` : 'بيقرا الصورة…',
      body: `<div class="ai-reading"><div class="empty loading"><span></span><span></span><span></span></div><img id="ai-img" alt="">
        <p class="muted small">بيقرا الكلام المكتوب على العلبة…${!st.enabled && i === 0 ? '<br>أول مرة بتاخد شوية عشان بيحمّل القارئ' : ''}</p></div>`,
      locked: true,
      onMount: (m, close) => { closeWait = close; },
    });
    try {
      photo = await shrink(file);
      document.getElementById('ai-img')?.setAttribute('src', photo);
      if (st.enabled) guess = await api.post('/products/from-photo', { image: photo });
      else {
        guess = await readBox(photo, { brands, cats });
        const q = guess.model || guess.name;
        guess.matches = q && guess.model ? (await api.get('/products?limit=3&q=' + encodeURIComponent(q)).catch(() => [])) : [];
      }
    } catch (e) {
      closeWait?.();
      await waiting;
      toastErr(e);
      continue;
    }
    closeWait?.();
    await waiting;
    guess.photo = photo;
    // Already there? Usually that means adding to its quantity
    if (guess.matches?.length) {
      const pick = await modal({
        title: 'المنتج ده شكله موجود',
        body: `<p style="margin-top:0">لقينا منتج قريب من <b>${esc(guess.name)}</b>:</p>
          <div class="ai-matches">${guess.matches.map((x) => `<button type="button" class="ai-match" data-id="${x.id}"><b>${esc(x.name)}</b><span class="muted small">الكمية ${x.qty} • ${money(x.sell_price)}</span><span class="small">زوّد الكمية عليه ←</span></button>`).join('')}</div>`,
        foot: `<button class="btn btn-outline" data-close>تخطي</button><button class="btn btn-primary" data-new>منتج جديد برضه</button>`,
        onMount: (m, close) => {
          m.querySelector('[data-new]').addEventListener('click', () => close('new'));
          m.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => close(Number(b.dataset.id))));
        },
      });
      if (typeof pick === 'number') {
        if (await stockForm(await api.get('/products/' + pick))) changed = true;
        continue;
      }
      if (pick !== 'new') continue;
    }
    if (await productForm(cats, null, guess)) changed = true;
  }
  return changed;
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

/** Manage the brand list: add, rename (products follow), merge duplicates, delete unused. */
function brandsModal() {
  const draw = (list) => list.length ? list.map((b) => `
    <div style="display:flex;gap:8px;align-items:center;padding:6px 0" data-id="${b.id}">
      <input class="input" value="${esc(b.name)}" data-name>
      <span class="pill pill-gray" style="flex-shrink:0">${b.products} منتج</span>
      <button class="btn btn-ghost btn-icon" data-save title="حفظ">${icon('check')}</button>
      <button class="btn btn-ghost btn-icon" data-del title="حذف">${icon('trash')}</button>
    </div>`).join('') : '<div class="empty">لسه مفيش براندات — ضيف أول براند تحت</div>';
  return modal({
    title: 'البراندات',
    body: `<p class="muted small" style="margin-top:0">لو غيّرت اسم براند، كل منتجاته بتتغير معاه. ولو كتبت اسم براند موجود قبل كده، الاتنين بيتدمجوا في براند واحد.</p>
      <div id="list"></div>
      <div style="display:flex;gap:8px;margin-top:12px"><input class="input" id="new" placeholder="براند جديد (مثلاً Samsung)"><button class="btn btn-primary" id="add">${icon('plus')} إضافة</button></div>`,
    onMount: async (m) => {
      const refresh = async () => { m.querySelector('#list').innerHTML = draw(await api.get('/brands')); };
      await refresh();
      const add = async () => {
        try { await api.post('/brands', { name: m.querySelector('#new').value }); m.querySelector('#new').value = ''; await refresh(); } catch (e) { toastErr(e); }
      };
      m.querySelector('#add').addEventListener('click', add);
      m.querySelector('#new').addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
      m.querySelector('#list').addEventListener('click', async (e) => {
        const row = e.target.closest('[data-id]');
        if (!row) return;
        try {
          if (e.target.closest('[data-save]')) {
            const r = await api.put('/brands/' + row.dataset.id, { name: row.querySelector('[data-name]').value });
            toast(r.merged ? 'اتدمجوا في براند واحد' : 'تم الحفظ', 'ok');
            await refresh();
          }
          if (e.target.closest('[data-del]')) { await api.del('/brands/' + row.dataset.id); await refresh(); }
        } catch (err) { toastErr(err); }
      });
    },
  });
}
