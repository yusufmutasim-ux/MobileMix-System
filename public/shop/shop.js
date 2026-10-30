// The shop's online store (public). Products and prices come live from the shop's system.
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const CART = 'mm_shop_cart';
const MINE = 'mm_shop_orders';
let info = null;

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const money = (v) => `${nf.format(Number(v) || 0)} <small>${esc(info?.currency || 'ج.م')}</small>`;
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch('/api' + path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  } catch { throw new Error('مفيش اتصال — اتأكد من النت وجرب تاني'); }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || 'حصل خطأ، جرب تاني');
  return data;
}

function toast(msg, ok = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast ${ok ? 'ok' : ''}`;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, 3200);
}

// ---------- cart ----------
const cart = () => read(CART, []);
function setCart(c) {
  write(CART, c);
  const n = c.reduce((s, l) => s + l.qty, 0);
  const b = $('#cart-count');
  b.textContent = n;
  b.hidden = !n;
}
function addToCart(p, qty = 1) {
  const c = cart();
  const line = c.find((l) => l.id === p.id);
  if (line) line.qty += qty; else c.push({ id: p.id, qty });
  setCart(c);
  toast('اتضاف للسلة ✓', true);
}

const ICONS = {
  phone: '<path d="M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M11 18h2"/>',
  back: '<path d="M9 6l6 6-6 6"/>',
  wa: '<path d="M3.5 20.5 5 16a8.5 8.5 0 1 1 3.2 3.1z"/><path d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.5-2-1-1 .8a5 5 0 0 1-2.6-2.6l.8-1-1-2z"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
};
const svg = (n, s = 20) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]}</svg>`;
const pic = (p, cls = '') => p.image
  ? `<img class="${cls}" src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">`
  : `<div class="${cls} noimg"><span>${esc((p.brand || p.name).slice(0, 2))}</span></div>`;
const waLink = (text) => {
  let n = String(info?.whatsapp || '').replace(/\D/g, '');
  if (n.startsWith('0')) n = '2' + n;
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : '';
};

// ---------- pages ----------
const card = (p) => `
    <article class="card ${p.in_stock ? '' : 'out'}">
      <a href="#/p/${p.id}" class="card-pic">${pic(p)}${p.in_stock ? (p.left ? `<em class="tag warn">باقي ${p.left}</em>` : '') : '<em class="tag">نفد</em>'}</a>
      ${p.brand ? `<span class="card-brand">${esc(p.brand)}</span>` : ''}
      <a href="#/p/${p.id}" class="card-name">${esc(p.name)}</a>
      <div class="card-row"><b class="price">${money(p.price)}</b>
        ${p.in_stock ? `<button class="add" data-id="${p.id}" aria-label="أضف للسلة">+</button>` : ''}</div>
    </article>`;
const onAdd = (el) => el.addEventListener('click', (e) => {
  const b = e.target.closest('.add');
  if (b) addToCart({ id: Number(b.dataset.id) });
});
const linkAttrs = (link) => {
  const l = String(link || '').trim();
  if (!l) return '';
  if (/^https?:\/\//.test(l)) return `href="${esc(l)}" target="_blank" rel="noopener"`;
  return `href="${esc(l.startsWith('#') ? l : `#/${l.replace(/^\/+/, '')}`)}"`;
};

/** Front page: slider + side banners, category circles, newest, then a row per section. */
async function home() {
  const slides = info.slides.length ? info.slides : null;
  view.innerHTML = `
    <section class="hero ${info.sides.length ? 'with-sides' : ''}">
      <div class="slider" id="slider">
        <div class="slides">${slides
          ? slides.map((b) => `<a class="slide" ${linkAttrs(b.link)}><img src="${esc(b.image)}" alt=""></a>`).join('')
          : `<div class="slide default"><div><span class="kicker">${esc(info.title)}</span><h1>${esc(info.about || 'كل اللي موبايلك محتاجه')}</h1>
              <p>شواحن، كابلات، سماعات وإكسسوارات أصلية — اطلب ويوصلك لحد البيت</p><a class="btn lime" href="#/list">تسوّق دلوقتي</a></div>
              <img src="/brand/mark.svg" alt="" class="default-mark"></div>`}</div>
        ${slides && slides.length > 1 ? `<div class="dots">${slides.map((_, i) => `<button data-i="${i}" aria-label="${i + 1}"></button>`).join('')}</div>` : ''}
      </div>
      ${info.sides.length ? `<div class="sides">${info.sides.map((b) => `<a class="side" ${linkAttrs(b.link)}><img src="${esc(b.image)}" alt=""></a>`).join('')}</div>` : ''}
    </section>
    ${info.categories.length ? `<section class="circles">${info.categories.map((c) => `
      <a href="#/list?cat=${c.id}" class="circle"><span class="ring">${c.image ? `<img src="${esc(c.image)}" alt="">` : `<b>${esc(c.name.slice(0, 1))}</b>`}</span><span>${esc(c.name)}</span></a>`).join('')}</section>` : ''}
    <div id="rows"><div class="loading"><span></span><span></span><span></span></div></div>`;
  startSlider($('#slider'));
  const data = await api('/store/home');
  const row = (title, list, more) => list.length ? `
    <section class="row">
      <div class="row-head"><h2>${esc(title)}</h2><a href="${more}">عرض الكل ‹</a></div>
      <div class="hscroll">${list.map(card).join('')}</div>
    </section>` : '';
  $('#rows').innerHTML = row('وصل حديثاً', data.latest, '#/list?sort=new')
    + data.sections.map((s) => row(s.name, s.products, `#/list?cat=${s.id}`)).join('')
    || '<div class="empty big">لسه مفيش منتجات</div>';
  onAdd($('#rows'));
}

function startSlider(el) {
  const track = el.querySelector('.slides');
  const n = track.children.length;
  if (n < 2) return;
  let i = 0, timer = null, x0 = null;
  const go = (k) => {
    i = (k + n) % n;
    track.style.transform = `translateX(${i * 100}%)`; // the page is right-to-left: next slide comes from the left
    el.querySelectorAll('.dots button').forEach((d, j) => d.classList.toggle('on', j === i));
  };
  const auto = () => { clearInterval(timer); timer = setInterval(() => { if (!document.hidden && el.isConnected) go(i + 1); else if (!el.isConnected) clearInterval(timer); }, 5000); };
  el.querySelector('.dots').addEventListener('click', (e) => { const d = e.target.closest('button'); if (d) { go(Number(d.dataset.i)); auto(); } });
  track.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  track.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 40) { go(i + (dx > 0 ? 1 : -1)); auto(); }
    x0 = null;
  });
  go(0);
  auto();
}

/** A section, a search, or everything: with brand chips and sorting. */
async function list(query) {
  const q = query.get('q') || '';
  const cat = query.get('cat') || '';
  const brand = query.get('brand') || '';
  const sort = query.get('sort') || '';
  const catName = info.categories.find((c) => String(c.id) === cat)?.name;
  const title = q ? `نتايج "${q}"` : catName || (sort === 'new' ? 'وصل حديثاً' : 'كل المنتجات');
  const params = (extra) => `#/list?${new URLSearchParams(Object.fromEntries(Object.entries({ q, cat, brand, sort, ...extra }).filter(([, v]) => v)))}`;
  view.innerHTML = `<div class="list-head"><h1 class="page-title">${esc(title)}</h1>
    <select id="sort" aria-label="ترتيب"><option value="">الأنسب</option><option value="new" ${sort === 'new' ? 'selected' : ''}>الأحدث</option>
      <option value="price_asc" ${sort === 'price_asc' ? 'selected' : ''}>السعر: من الأقل</option><option value="price_desc" ${sort === 'price_desc' ? 'selected' : ''}>السعر: من الأعلى</option></select></div>
    <nav class="chips" id="brands"></nav>
    <div class="grid" id="grid"><div class="loading"><span></span><span></span><span></span></div></div>`;
  $('#sort').addEventListener('change', (e) => { location.hash = params({ sort: e.target.value }); });
  const all = await api(`/store/products?${new URLSearchParams(Object.fromEntries(Object.entries({ q, cat, sort }).filter(([, v]) => v)))}`);
  const brands = [...new Set(all.map((p) => p.brand).filter(Boolean))].sort();
  if (brands.length > 1) {
    $('#brands').innerHTML = `<a href="${params({ brand: '' })}" class="${brand ? '' : 'on'}">كل البراندات</a>${brands.map((b) => `<a href="${params({ brand: b })}" class="${b === brand ? 'on' : ''}">${esc(b)}</a>`).join('')}`;
  }
  const shown = brand ? all.filter((p) => p.brand === brand) : all;
  $('#grid').innerHTML = shown.length ? shown.map(card).join('') : `<div class="empty">${q ? 'مفيش نتايج — جرب كلمة تانية' : 'مفيش منتجات هنا لسه'}</div>`;
  onAdd($('#grid'));
}

/** Orders made from this phone. */
async function mine() {
  const tokens = read(MINE, []);
  view.innerHTML = '<h1 class="page-title">طلباتي</h1><div class="lines" id="mine"></div>';
  if (!tokens.length) { $('#mine').innerHTML = '<div class="empty">لسه مطلبتش من الجهاز ده</div>'; return; }
  const orders = (await Promise.all(tokens.map((t) => api(`/store/orders/${t}`).then((o) => ({ ...o, token: t })).catch(() => null)))).filter(Boolean);
  $('#mine').innerHTML = orders.map((o) => `<a class="line" href="#/order/${o.token}"><div class="line-info"><b dir="ltr" style="text-align:right">${esc(o.order_no)}</b>
    <span>${o.items.length} منتج • ${esc(o.created_at.slice(0, 10))}</span></div><div class="mine-end"><b>${money(o.total)}</b><span class="state ${o.status}">${esc(o.status_ar)}</span></div></a>`).join('');
}

async function product(id) {
  const p = await api(`/store/products/${id}`);
  document.title = `${p.name} — ${info.title}`;
  view.innerHTML = `
    <a class="back" href="javascript:history.back()">${svg('back', 18)} رجوع</a>
    <section class="product">
      ${pic(p, 'big')}
      <div class="product-info">
        ${p.brand ? `<span class="muted">${esc(p.brand)}</span>` : ''}
        <h1 dir="auto">${esc(p.name)}</h1>
        <div class="price big-price">${money(p.price)}</div>
        ${p.in_stock ? `${p.left ? `<p class="warn-text">فاضل ${p.left} بس</p>` : '<p class="ok-text">متاح</p>'}
          <div class="qty-row"><div class="qty"><button data-d="1">+</button><input id="qty" value="1" inputmode="numeric"><button data-d="-1">−</button></div>
          <button class="btn primary" id="add">أضف للسلة</button></div>` : '<p class="warn-text">نفد — ابعتلنا على الواتساب نبلغك أول ما ييجي</p>'}
        ${p.description ? `<p class="desc" dir="auto">${esc(p.description).replace(/\n/g, '<br>')}</p>` : ''}
        ${waLink('') ? `<a class="btn ghost" target="_blank" rel="noopener" href="${waLink(`عايز أسأل عن: ${p.name}`)}">${svg('wa')} اسأل على الواتساب</a>` : ''}
      </div>
    </section>`;
  const qty = $('#qty');
  view.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => { qty.value = Math.max(1, (parseInt(qty.value, 10) || 1) + Number(b.dataset.d)); }));
  $('#add')?.addEventListener('click', () => addToCart(p, Math.max(1, parseInt(qty.value, 10) || 1)));
}

/** The cart lines with live prices (anything no longer sold is dropped). */
async function cartLines() {
  const c = cart();
  if (!c.length) return [];
  const list = await api('/store/products');
  const by = new Map(list.map((p) => [p.id, p]));
  const lines = c.filter((l) => by.get(l.id)?.in_stock).map((l) => ({ ...by.get(l.id), qty: l.qty }));
  if (lines.length !== c.length) setCart(lines.map((l) => ({ id: l.id, qty: l.qty })));
  return lines;
}

async function cartPage() {
  const lines = await cartLines();
  if (!lines.length) { view.innerHTML = `<div class="empty big">السلة فاضية<br><a class="btn primary" href="#/">تسوّق</a></div>`; return; }
  const sub = lines.reduce((s, l) => s + l.price * l.qty, 0);
  view.innerHTML = `
    <h1 class="page-title">السلة</h1>
    <div class="lines">${lines.map((l) => `
      <div class="line" data-id="${l.id}">
        ${pic(l, 'thumb')}
        <div class="line-info"><b dir="auto">${esc(l.name)}</b><span>${money(l.price)}</span></div>
        <div class="qty small"><button data-d="1">+</button><span>${l.qty}</span><button data-d="-1">−</button></div>
      </div>`).join('')}</div>
    <div class="sum"><span>المجموع</span><b>${money(sub)}</b></div>
    ${info.min_order > sub ? `<p class="warn-text">أقل طلب ${money(info.min_order)}</p>` : ''}
    <a class="btn primary wide ${info.min_order > sub ? 'disabled' : ''}" href="#/checkout">إتمام الطلب</a>`;
  view.querySelector('.lines').addEventListener('click', (e) => {
    const b = e.target.closest('[data-d]');
    if (!b) return;
    const id = Number(b.closest('.line').dataset.id);
    const c = cart().map((l) => (l.id === id ? { ...l, qty: l.qty + Number(b.dataset.d) } : l)).filter((l) => l.qty > 0);
    setCart(c);
    cartPage();
  });
}

async function checkout() {
  const lines = await cartLines();
  if (!lines.length) { location.hash = '#/cart'; return; }
  const sub = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const d = info.delivery;
  const p = info.payments;
  const saved = read('mm_shop_me', {});
  const opts = [
    d.ship && Object.keys(d.ship).length ? ['ship', 'شحن لحد البيت', 'لكل المحافظات اللي بنشحنلها'] : null,
    d.local ? ['local', 'توصيل', `${d.local.area ? `${esc(d.local.area)} — ` : ''}${d.local.fee ? money(d.local.fee) : 'مجاناً'}`] : null,
    d.pickup ? ['pickup', 'استلام من المحل', d.pickup.address ? esc(d.pickup.address) : 'مجاناً'] : null,
  ].filter(Boolean);
  const pays = [
    p.cod ? ['cod', 'كاش عند الاستلام', 'تدفع لما الطلب يوصلك'] : null,
    p.transfer ? ['transfer', 'تحويل (InstaPay / محفظة)', 'هتلاقي بيانات التحويل بعد الطلب'] : null,
    p.card ? ['card', 'فيزا / ماستركارد', 'دفع آمن أونلاين'] : null,
  ].filter(Boolean);
  view.innerHTML = `
    <h1 class="page-title">إتمام الطلب</h1>
    <form id="co" class="form">
      <label><span>الاسم</span><input name="name" required value="${esc(saved.name || '')}" autocomplete="name"></label>
      <label><span>رقم الموبايل</span><input name="phone" required inputmode="tel" dir="ltr" value="${esc(saved.phone || '')}" autocomplete="tel"></label>
      <fieldset><legend>الاستلام</legend>${opts.map(([v, t, s], i) => `<label class="choice"><input type="radio" name="delivery" value="${v}" ${i === 0 ? 'checked' : ''}><span><b>${t}</b><small>${s}</small></span></label>`).join('')}</fieldset>
      <label id="gov-f"><span>المحافظة</span><select name="governorate">${Object.entries(d.ship || {}).map(([g, f]) => `<option value="${esc(g)}" ${saved.governorate === g ? 'selected' : ''}>${esc(g)} — شحن ${nf.format(f)}</option>`).join('')}</select></label>
      <label id="addr-f"><span>العنوان بالتفصيل</span><textarea name="address" rows="2" autocomplete="street-address">${esc(saved.address || '')}</textarea></label>
      <fieldset><legend>الدفع</legend>${pays.map(([v, t, s], i) => `<label class="choice"><input type="radio" name="payment" value="${v}" ${i === 0 ? 'checked' : ''}><span><b>${t}</b><small>${s}</small></span></label>`).join('')}</fieldset>
      <label><span>ملاحظات (اختياري)</span><input name="notes"></label>
      <div class="totals">
        <div><span>المنتجات</span><span>${money(sub)}</span></div>
        <div><span>التوصيل</span><span id="fee"></span></div>
        <div class="grand"><span>الإجمالي</span><b id="total"></b></div>
      </div>
      <button class="btn primary wide" id="send">تأكيد الطلب</button>
    </form>`;
  const f = $('#co');
  const feeNow = () => {
    const del = f.delivery.value;
    if (del === 'ship') return d.ship[f.governorate.value] ?? 0;
    if (del === 'local') return d.local.fee;
    return 0;
  };
  const draw = () => {
    const del = f.delivery.value;
    $('#gov-f').hidden = del !== 'ship';
    $('#addr-f').hidden = del === 'pickup';
    const fee = feeNow();
    $('#fee').innerHTML = fee ? money(fee) : 'مجاناً';
    $('#total').innerHTML = money(sub + fee);
  };
  f.addEventListener('change', draw);
  draw();
  if (!pays.length || !opts.length) $('#send').disabled = true;
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#send');
    btn.disabled = true;
    btn.textContent = 'بيتبعت…';
    const body = {
      name: f.name.value, phone: f.phone.value, notes: f.notes.value,
      delivery: f.delivery.value, governorate: f.governorate.value, address: f.address.value, payment: f.payment.value,
      items: cart().map((l) => ({ id: l.id, qty: l.qty })),
    };
    try {
      const r = await api('/store/orders', { method: 'POST', body });
      write('mm_shop_me', { name: body.name, phone: body.phone, governorate: body.governorate, address: body.address });
      write(MINE, [r.token, ...read(MINE, [])].slice(0, 20));
      setCart([]);
      if (r.pay_url) { location.href = r.pay_url; return; }
      if (r.pay_error) toast(r.pay_error);
      location.hash = `#/order/${r.token}?new=1`;
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
      btn.textContent = 'تأكيد الطلب';
    }
  });
}

const STEPS = [['new', 'اتبعت'], ['confirmed', 'اتأكد'], ['shipped', 'في الطريق'], ['delivered', 'وصل']];
async function orderPage(token, query) {
  const o = await api(`/store/orders/${token}`);
  const pickup = o.delivery === 'pickup';
  const steps = pickup ? STEPS.filter(([s]) => s !== 'shipped') : STEPS;
  const cur = steps.findIndex(([s]) => s === o.status);
  view.innerHTML = `
    ${query.get('new') ? `<div class="done">${svg('check', 28)}<h1>طلبك وصلنا</h1><p>هنكلمك على رقمك نأكد الطلب. احتفظ باللينك ده عشان تتابع طلبك.</p></div>` : ''}
    <h1 class="page-title">طلب رقم <span dir="ltr">${esc(o.order_no)}</span></h1>
    ${o.status === 'cancelled' ? `<div class="note bad">الطلب اتلغى${o.cancel_reason ? ` — ${esc(o.cancel_reason)}` : ''}</div>` : `
      <ol class="steps">${steps.map(([s, t], i) => `<li class="${i <= cur ? 'on' : ''}">${t}</li>`).join('')}</ol>`}
    ${o.payment === 'card' && o.pay_status !== 'paid' && o.status !== 'cancelled' ? `<div class="note bad">${o.pay_status === 'failed' ? 'الدفع بالفيزا متمّش.' : 'لسه مستنيين تأكيد الدفع.'} ${waLink('') ? 'كلمنا على الواتساب نكمّل الطلب.' : ''}</div>` : ''}
    ${o.payment === 'transfer' && o.status !== 'cancelled' && o.pay_status !== 'paid' ? `
      <div class="note">
        <b>حوّل ${money(o.total)}</b>${o.transfer_info ? `<pre dir="auto">${esc(o.transfer_info)}</pre>` : ''}
        ${o.pay_status === 'review' ? '<p class="ok-text">صورة التحويل وصلتنا ✓ هنراجعها ونأكدلك.</p>' : '<p>بعد ما تحوّل، ارفع صورة التحويل هنا:</p>'}
        <label class="btn ghost file">${o.has_proof ? 'غيّر صورة التحويل' : 'ارفع صورة التحويل'}<input type="file" accept="image/*" id="proof"></label>
      </div>` : ''}
    ${o.payment === 'transfer' && o.pay_status === 'paid' ? '<div class="note ok">التحويل اتأكد ✓</div>' : ''}
    <div class="lines">${o.items.map((i) => `<div class="line"><div class="line-info"><b dir="auto">${esc(i.name)}</b><span>${i.qty} × ${money(i.unit_price)}</span></div><b>${money(i.line_total)}</b></div>`).join('')}</div>
    <div class="totals">
      <div><span>المنتجات</span><span>${money(o.subtotal)}</span></div>
      <div><span>${pickup ? 'استلام من المحل' : `التوصيل${o.governorate ? ` — ${esc(o.governorate)}` : ''}`}</span><span>${o.delivery_fee ? money(o.delivery_fee) : 'مجاناً'}</span></div>
      <div class="grand"><span>الإجمالي</span><b>${money(o.total)}</b></div>
    </div>
    ${waLink('') ? `<a class="btn ghost wide" target="_blank" rel="noopener" href="${waLink(`بخصوص طلبي رقم ${o.order_no}`)}">${svg('wa')} كلمنا على الواتساب</a>` : ''}
    <a class="btn wide plain" href="#/">كمّل تسوّق</a>`;
  $('#proof')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      toast('بيترفع…', true);
      await api(`/store/orders/${token}/proof`, { method: 'POST', body: { image: await shrink(file) } });
      toast('صورة التحويل وصلتنا ✓', true);
      orderPage(token, new URLSearchParams());
    } catch (err) { toast(err.message); }
  });
}

async function shrink(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = url; });
    const k = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82);
  } finally { URL.revokeObjectURL(url); }
}

async function route() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  const query = new URLSearchParams(qs);
  const parts = path.split('/').filter(Boolean);
  document.title = info?.title || 'المتجر';
  window.scrollTo(0, 0);
  $('#toast').hidden = true;
  const curCat = query.get('cat');
  document.querySelectorAll('#catbar a').forEach((x) => x.classList.toggle('on', curCat ? x.dataset.cat === curCat : x.getAttribute('href') === `#/${parts.join('/')}${parts[0] === 'list' && query.get('sort') === 'new' ? '?sort=new' : ''}` || (!parts.length && x.getAttribute('href') === '#/')));
  try {
    if (!info.enabled && parts[0] !== 'order') { view.innerHTML = '<div class="empty big">المتجر مقفول دلوقتي — ارجعلنا قريب</div>'; return; }
    if (parts[0] === 'p') await product(parts[1]);
    else if (parts[0] === 'cart') await cartPage();
    else if (parts[0] === 'checkout') await checkout();
    else if (parts[0] === 'order') await orderPage(parts[1], query);
    else if (parts[0] === 'list') await list(query);
    else if (parts[0] === 'mine') await mine();
    else await home();
  } catch (e) {
    view.innerHTML = `<div class="empty big">${esc(e.message)}<br><a class="btn primary" href="#/">الرئيسية</a></div>`;
  }
}

(async () => {
  try { info = await api('/store/info'); } catch (e) { view.innerHTML = `<div class="empty big">${esc(e.message)}</div>`; return; }
  $('#title').textContent = info.title;
  if (info.strip) { const st = $('#strip'); st.textContent = info.strip; st.style.background = info.strip_color || '#141414'; st.hidden = false; }
  $('#catbar').innerHTML = `<a href="#/">الرئيسية</a><a href="#/list?sort=new">وصل حديثاً</a>${info.categories.map((c) => `<a href="#/list?cat=${c.id}" data-cat="${c.id}">${esc(c.name)}</a>`).join('')}`;
  $('#top-search').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = e.target.q.value.trim();
    location.hash = v ? `#/list?q=${encodeURIComponent(v)}` : '#/list';
    e.target.q.blur();
  });
  setCart(cart());
  $('#foot').innerHTML = `<div class="wrap foot-in">
    <div><b>${esc(info.title)}</b>${info.about ? `<p>${esc(info.about)}</p>` : ''}</div>
    <div class="foot-links">
      ${info.address ? `<span>📍 ${esc(info.address)}</span>` : ''}
      ${info.phone ? `<a href="tel:${esc(info.phone)}" dir="ltr">📞 ${esc(info.phone)}</a>` : ''}
      ${waLink('') ? `<a target="_blank" rel="noopener" href="${waLink('')}">${svg('wa', 16)} واتساب</a>` : ''}
      <a href="#/mine">طلباتي</a>
    </div></div>`;
  window.addEventListener('hashchange', route);
  route();
})();
