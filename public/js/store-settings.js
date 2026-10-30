// Settings → online store: open/close it, what shows, payments, delivery prices, own domain.
import { api, state, icon, esc, toast, busy } from './core.js';

/** A banner picture with its link, order arrows and delete. */
let catOptions = [];
function bannerRows(list) {
  if (!list.length) return '<p class="muted small" style="margin:6px 0">مفيش صور لسه.</p>';
  return list.map((b, i) => `<div class="banner-row" data-id="${b.id}">
    <img src="${esc(b.image)}" alt="">
    <select class="input" data-link>${[['', 'من غير لينك'], ['#/list?sort=new', 'وصل حديثاً'], ['#/list', 'كل المنتجات'], ...catOptions.map((c) => [`#/list?cat=${c.id}`, c.name])]
      .map(([v, t]) => `<option value="${esc(v)}" ${b.link === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
    <div class="btn-row">
      <button type="button" class="btn btn-ghost btn-icon btn-sm" data-move="up" ${i === 0 ? 'disabled' : ''} title="لقدام">↑</button>
      <button type="button" class="btn btn-ghost btn-icon btn-sm" data-move="down" ${i === list.length - 1 ? 'disabled' : ''} title="لورا">↓</button>
      <button type="button" class="btn btn-ghost btn-icon btn-sm" data-del style="color:var(--danger)" title="امسح">${icon('trash')}</button></div>
  </div>`).join('');
}

/** Smaller copy of a picture for upload (long side `max`, JPEG). */
async function shrinkPic(file, max = 1800) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.86);
  } finally { URL.revokeObjectURL(url); }
}

export async function storeSettings(card) {
  const [admin, st, banners, cats] = await Promise.all([api.get('/store/admin'), api.get('/settings'), api.get('/store/banners'), api.get('/categories')]);
  catOptions = cats;
  let fees = {};
  try { fees = JSON.parse(st.store_ship_fees || '{}'); } catch { /* empty */ }
  const yes = (k) => st[k] === '1';
  const link = `${location.origin}/shop/`;
  const callback = `${location.origin}/api/store/paymob/callback`;
  const pm = admin.paymob;
  const tick = (k, label, sub = '') => `<label class="check full"><input type="checkbox" data-k="${k}" ${yes(k) ? 'checked' : ''}> <span><b>${label}</b>${sub ? `<br><span class="muted small">${sub}</span>` : ''}</span></label>`;

  card.innerHTML = `
    <div class="card">
      <div class="card-head"><h2>${icon('globe')} المتجر الأونلاين</h2>
        <span class="pill ${yes('store_enabled') ? 'pill-ok' : 'pill-gray'}">${yes('store_enabled') ? 'مفتوح للناس' : 'مقفول'}</span></div>
      <div class="store-link"><code class="ltr" id="store-url">${esc(link)}</code>
        <button type="button" class="btn btn-outline btn-sm" id="copy-link">نسخ اللينك</button>
        <a class="btn btn-outline btn-sm" href="${esc(link)}" target="_blank" rel="noopener">${icon('eye')} افتح الموقع</a></div>
      <div class="form-grid" style="margin-top:14px">
        ${tick('store_enabled', 'المتجر مفتوح', 'الناس تقدر تشوف المنتجات وتطلب')}
        <label class="field"><span>اسم المتجر</span><input class="input" data-k="store_title" value="${esc(st.store_title || '')}" placeholder="${esc(st.shop_name || 'Mobile Mix')}"></label>
        <label class="field"><span>رقم الواتساب (للعملاء)</span><input class="input ltr" data-k="store_whatsapp" value="${esc(st.store_whatsapp || '')}" placeholder="01xxxxxxxxx" inputmode="tel"></label>
        <label class="field full"><span>جملة تعريف تظهر فوق</span><input class="input" data-k="store_about" value="${esc(st.store_about || '')}" placeholder="إكسسوارات أصلية بضمان — توصيل لكل مصر"></label>
        <label class="field"><span>المنتجات اللي تظهر</span><select class="input" data-k="store_products">
          <option value="auto" ${st.store_products !== 'manual' ? 'selected' : ''}>كل منتج ليه سعر (وتقدر تخفي أي منتج)</option>
          <option value="manual" ${st.store_products === 'manual' ? 'selected' : ''}>اللي أعلّم عليه بس</option></select></label>
        <label class="field"><span>شحن مجاني للطلبات فوق (0 = لأ)</span><input class="input num" type="number" min="0" data-k="store_free_ship" value="${esc(st.store_free_ship || '0')}"></label>
        <label class="field"><span>أقل قيمة للطلب</span><input class="input num" type="number" min="0" data-k="store_min_order" value="${esc(st.store_min_order || '0')}"></label>
        ${tick('store_show_out', 'اعرض المنتجات اللي خلصت', 'بتظهر مكتوب عليها "نفد"')}
        <p class="muted small full" style="margin:0">موبايلات الـ IMEI مش بتظهر في الموقع. صورة المنتج ووصفه من صفحة المنتج نفسه.</p>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>${icon('image')} شكل الموقع</h2><span class="muted small">بتتحفظ على طول</span></div>
      <div class="form-grid">
        <label class="field full"><span>شريط العروض فوق (اختياري)</span><input class="input" data-k="store_strip" value="${esc(st.store_strip || '')}" placeholder="خصم 10% على كل الشواحن لحد آخر الشهر 🔥"></label>
        <label class="field"><span>لون الشريط</span><input class="input" type="color" data-k="store_strip_color" value="${esc(st.store_strip_color || '#141414')}" style="height:44px;padding:4px"></label>
      </div>
      <div class="section-title" style="margin-top:14px">صور السلايدر الكبير <span class="muted small">(أحسن مقاس 1600×700 — بتتقلب لوحدها)</span></div>
      <div class="banner-list">${bannerRows(banners.filter((b) => b.kind === 'slide'))}</div>
      <label class="btn btn-outline btn-sm photo-add">${icon('plus')} صورة للسلايدر<input type="file" accept="image/*" class="visually-hidden-file" data-add="slide"></label>
      <div class="section-title" style="margin-top:14px">البانرين اللي جنب السلايدر <span class="muted small">(على الكمبيوتر جنبه، وعلى الموبايل تحته — أحسن مقاس 800×450)</span></div>
      <div class="banner-list">${bannerRows(banners.filter((b) => b.kind === 'side'))}</div>
      ${banners.filter((b) => b.kind === 'side').length < 2 ? `<label class="btn btn-outline btn-sm photo-add">${icon('plus')} بانر جانبي<input type="file" accept="image/*" class="visually-hidden-file" data-add="side"></label>` : ''}
      <p class="muted small" style="margin:8px 0 0">اللينك: سيبه فاضي، أو اختار قسم يفتح لما العميل يدوس على الصورة.</p>
      <div class="section-title" style="margin-top:14px">صور الأقسام <span class="muted small">(الدواير اللي تحت السلايدر — صورة مربعة)</span></div>
      <div class="cat-pics">${cats.map((c) => `<div class="cat-pic" data-cat="${c.id}">
        <span class="ring-sm">${c.image ? `<img src="/uploads/${esc(c.image)}" alt="">` : esc(c.name.slice(0, 1))}</span><b>${esc(c.name)}</b>
        <label class="btn btn-ghost btn-sm photo-add">${c.image ? 'غيّر' : 'صورة'}<input type="file" accept="image/*" class="visually-hidden-file" data-cat-img="${c.id}"></label>
        ${c.image ? `<button type="button" class="btn btn-ghost btn-sm" data-cat-del="${c.id}" style="color:var(--danger)">شيل</button>` : ''}</div>`).join('')}</div>
    </div>

    <div class="card">
      <div class="card-head"><h2>${icon('wallet')} الدفع</h2></div>
      <div class="form-grid">
        ${tick('store_pay_cod', 'كاش عند الاستلام')}
        ${tick('store_pay_transfer', 'تحويل InstaPay / فودافون كاش', 'العميل يحوّل ويرفع صورة التحويل، وإنت تأكدها من الطلب')}
        <label class="field full"><span>بيانات التحويل اللي تظهر للعميل</span><textarea class="input" rows="3" data-k="store_transfer_info" placeholder="InstaPay: mobilemix@instapay&#10;فودافون كاش: 010xxxxxxxx">${esc(st.store_transfer_info || '')}</textarea></label>
        ${tick('store_pay_card', 'فيزا / ماستركارد (Paymob)', pm.ready ? 'المفاتيح متسجلة ✓' : 'محتاج حساب تاجر على Paymob — حط المفاتيح تحت')}
      </div>
      <details class="paymob-box" ${yes('store_pay_card') && !pm.ready ? 'open' : ''}>
        <summary>مفاتيح Paymob ${pm.ready ? '<span class="pill pill-ok">جاهز</span>' : ''}</summary>
        <ol class="setup-steps small">
          <li>اعمل حساب تاجر على <b class="ltr">accept.paymob.com</b> وكمّل الأوراق لحد ما الحساب يتفعّل.</li>
          <li>من <b>Settings</b> ← <b>Account Info</b> هتلاقي <b>API Key</b> و<b>HMAC</b>.</li>
          <li>من <b>Developers</b> ← <b>Payment Integrations</b> خد <b>Integration ID</b> بتاع الكروت، ومن <b>iframes</b> خد <b>iframe ID</b>.</li>
          <li>في نفس الـ Integration حط اللينك ده في <b>Transaction processed callback</b> و<b>Transaction response callback</b>:
            <div class="copy-row"><code class="ltr" id="cb-url">${esc(callback)}</code><button type="button" class="btn btn-outline btn-sm" id="copy-cb">نسخ</button></div></li>
        </ol>
        <div class="form-grid">
          <label class="field"><span>API Key</span><input class="input ltr" data-pm="paymob_api_key" placeholder="${esc(pm.api_key || 'ZXlK…')}" autocomplete="off"></label>
          <label class="field"><span>HMAC</span><input class="input ltr" data-pm="paymob_hmac" placeholder="${esc(pm.hmac || '')}" autocomplete="off"></label>
          <label class="field"><span>Integration ID</span><input class="input ltr" data-pm="paymob_integration_id" value="${esc(pm.integration_id || '')}" inputmode="numeric"></label>
          <label class="field"><span>iframe ID</span><input class="input ltr" data-pm="paymob_iframe_id" value="${esc(pm.iframe_id || '')}" inputmode="numeric"></label>
          <p class="muted small full" style="margin:0">المفاتيح بتتحفظ على السيرفر ومش بتظهر تاني كاملة. سيب الخانة فاضية عشان تفضل زي ما هي.</p>
          <div class="full"><button type="button" class="btn btn-outline btn-sm" id="save-pm">${icon('check')} حفظ مفاتيح Paymob</button></div>
        </div>
      </details>
    </div>

    <div class="card">
      <div class="card-head"><h2>${icon('truck')} التوصيل</h2></div>
      <div class="form-grid">
        ${tick('store_pickup', 'استلام من المحل', st.shop_address ? `العنوان: ${esc(st.shop_address)}` : 'اكتب عنوان المحل من "المحل والفواتير"')}
        ${tick('store_local', 'توصيل في منطقتي')}
        <label class="field"><span>المنطقة</span><input class="input" data-k="store_local_area" value="${esc(st.store_local_area || '')}" placeholder="مثلاً: مدينة نصر ومصر الجديدة"></label>
        <label class="field"><span>سعر التوصيل</span><input class="input num" type="number" min="0" data-k="store_local_fee" value="${esc(st.store_local_fee || '0')}"></label>
        ${tick('store_ship', 'شحن للمحافظات', 'المحافظة اللي سعرها فاضي مش هتظهر للعميل')}
      </div>
      <div class="ship-tools"><input class="input num" type="number" min="0" id="fee-all" placeholder="سعر واحد للكل"><button type="button" class="btn btn-outline btn-sm" id="fill-all">حطه لكل المحافظات</button>
        <button type="button" class="btn btn-ghost btn-sm" id="clear-all">فضّي الكل</button></div>
      <div class="ship-grid">${admin.governorates.map((g) => `<label><span>${esc(g)}</span><input class="input num" type="number" min="0" data-gov="${esc(g)}" value="${fees[g] ?? ''}" placeholder="—"></label>`).join('')}</div>
    </div>

    <div class="card">
      <div class="card-head"><h2>${icon('globe')} دومين خاص (اختياري)</h2></div>
      <div class="form-grid">
        <label class="field full"><span>الدومين</span><input class="input ltr" data-k="store_domain" value="${esc(st.store_domain || '')}" placeholder="mobilemix.com"></label>
      </div>
      <ol class="setup-steps small">
        <li>اشتري دومين من أي موقع (Namecheap، GoDaddy…).</li>
        <li>في <b>Railway</b>: الخدمة ← <b>Settings</b> ← <b>Networking</b> ← <b>Custom Domain</b>، واكتب الدومين.</li>
        <li>Railway هيديك سجل <b>CNAME</b>: حطه في إعدادات الـ DNS عند الموقع اللي اشتريت منه، واستنى لحد ما يشتغل (من دقايق لساعات).</li>
        <li>اكتب الدومين هنا واحفظ: اللي يفتحه هيروح للمتجر على طول، والسيستم نفسه يفضل على لينك Railway.</li>
      </ol>
    </div>
    <div class="store-save"><button type="button" class="btn btn-primary" id="save-store">${icon('check')} حفظ إعدادات المتجر</button></div>`;

  const $ = (s) => card.querySelector(s);
  // Banners and category pictures save right away
  card.querySelectorAll('[data-add]').forEach((inp) => inp.addEventListener('change', async () => {
    const f = inp.files[0];
    if (!f) return;
    try {
      toast('بيترفع…');
      await api.post('/store/banners', { kind: inp.dataset.add, image: await shrinkPic(f) });
      toast('الصورة اتضافت ✓', 'ok');
      storeSettings(card);
    } catch (e) { toast(e.message, 'err'); }
  }));
  card.querySelectorAll('.banner-row').forEach((row) => {
    const id = row.dataset.id;
    row.querySelector('[data-link]').addEventListener('change', (e) => api.put(`/store/banners/${id}`, { link: e.target.value }).then(() => toast('اتحفظ', 'ok'), (er) => toast(er.message, 'err')));
    row.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => busy(b, async () => { await api.put(`/store/banners/${id}`, { move: b.dataset.move }); storeSettings(card); })));
    row.querySelector('[data-del]').addEventListener('click', (e) => busy(e.currentTarget, async () => { await api.del(`/store/banners/${id}`); storeSettings(card); }));
  });
  card.querySelectorAll('[data-cat-img]').forEach((inp) => inp.addEventListener('change', async () => {
    const f = inp.files[0];
    if (!f) return;
    try { await api.post(`/categories/${inp.dataset.catImg}/image`, { image: await shrinkPic(f, 600) }); toast('اتحفظت ✓', 'ok'); storeSettings(card); } catch (e) { toast(e.message, 'err'); }
  }));
  card.querySelectorAll('[data-cat-del]').forEach((b) => b.addEventListener('click', () => busy(b, async () => { await api.del(`/categories/${b.dataset.catDel}/image`); storeSettings(card); })));
  const copy = (txt) => navigator.clipboard?.writeText(txt).then(() => toast('اتنسخ', 'ok'), () => {});
  $('#copy-link').addEventListener('click', () => copy(link));
  $('#copy-cb').addEventListener('click', () => copy(callback));
  $('#fill-all').addEventListener('click', () => {
    const v = $('#fee-all').value;
    if (v === '') return toast('اكتب السعر الأول', 'err');
    card.querySelectorAll('[data-gov]').forEach((i) => { i.value = v; });
  });
  $('#clear-all').addEventListener('click', () => card.querySelectorAll('[data-gov]').forEach((i) => { i.value = ''; }));

  $('#save-pm').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const body = {};
    card.querySelectorAll('[data-pm]').forEach((i) => { body[i.dataset.pm] = i.value.trim(); });
    const r = await api.put('/store/paymob', body);
    toast(r.ready ? 'مفاتيح Paymob اتحفظت ✓' : 'اتحفظ — لسه في مفاتيح ناقصة', r.ready ? 'ok' : 'err');
    storeSettings(card);
  }));

  $('#save-store').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const body = {};
    card.querySelectorAll('[data-k]').forEach((i) => { body[i.dataset.k] = i.type === 'checkbox' ? (i.checked ? '1' : '0') : i.value.trim(); });
    const list = {};
    card.querySelectorAll('[data-gov]').forEach((i) => { if (i.value !== '') list[i.dataset.gov] = Number(i.value); });
    body.store_ship_fees = JSON.stringify(list);
    if (body.store_enabled === '1' && !['store_pay_cod', 'store_pay_transfer', 'store_pay_card'].some((k) => body[k] === '1')) throw new Error('اختار طريقة دفع واحدة على الأقل');
    if (body.store_enabled === '1' && body.store_ship !== '1' && body.store_local !== '1' && body.store_pickup !== '1') throw new Error('اختار طريقة استلام واحدة على الأقل');
    if (body.store_ship === '1' && !Object.keys(list).length) throw new Error('حط سعر شحن لمحافظة واحدة على الأقل، أو اقفل الشحن');
    state.settings = await api.put('/settings', body);
    toast('إعدادات المتجر اتحفظت ✓', 'ok');
    storeSettings(card);
  }));
}
