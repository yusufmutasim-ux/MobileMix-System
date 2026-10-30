// The shop's online store (public). Products, prices and stock come live from the shop's system.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const view = $('#view');
const CART = 'mm_shop_cart';
const MINE = 'mm_shop_orders';
let info = null;
let catalog = null; // all store products, for the cart and suggestions

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
  toast.t = setTimeout(() => { t.hidden = true; }, 2800);
}

// ---------- icons ----------
const I = {
  back: '<path d="M9 6l6 6-6 6"/>',
  wa: '<path d="M3.5 20.5 5 16a8.5 8.5 0 1 1 3.2 3.1z"/><path d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.5-2-1-1 .8a5 5 0 0 1-2.6-2.6l.8-1-1-2z"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  truck: '<path d="M2 6h11v10H2z"/><path d="M13 9h4l4 4v3h-8"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 10v.01M18 14v.01"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  store: '<path d="M4 9h16l-1-5H5z"/><path d="M5 9v11h14V9"/><path d="M10 20v-5h4v5"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  cable: '<path d="M7 3v5M11 3v5"/><rect x="5" y="8" width="8" height="5" rx="1"/><path d="M9 13v3a4 4 0 0 0 4 4h3a3 3 0 0 0 3-3V7"/><rect x="17" y="3" width="4" height="4" rx="1"/>',
  charger: '<rect x="6" y="7" width="12" height="13" rx="3"/><path d="M9 7V3M15 7V3"/><path d="m12.5 11-2 3h3l-2 3"/>',
  headphones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="2" y="14" width="5" height="7" rx="2"/><rect x="17" y="14" width="5" height="7" rx="2"/>',
  speaker: '<rect x="5" y="2" width="14" height="20" rx="3"/><circle cx="12" cy="14" r="4"/><circle cx="12" cy="6.5" r="1"/>',
  battery: '<rect x="3" y="7" width="16" height="10" rx="2"/><path d="M21 11v2"/><path d="m11.5 9-2 3h3l-2 3"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>',
  watch: '<rect x="6" y="6" width="12" height="12" rx="3"/><path d="M9 6l1-4h4l1 4M9 18l1 4h4l1-4"/>',
  case: '<rect x="6" y="2" width="12" height="20" rx="3"/><circle cx="9.5" cy="5.5" r="1"/>',
  plug: '<path d="M9 2v6M15 2v6"/><path d="M6 8h12v4a6 6 0 0 1-12 0z"/><path d="M12 18v4"/>',
  light: '<circle cx="12" cy="10" r="6"/><path d="M9 20h6M10 16h4"/>',
  car: '<path d="M5 17h14l-1.5-6.5a2 2 0 0 0-2-1.5h-7a2 2 0 0 0-2 1.5z"/><circle cx="7.5" cy="17" r="1.8"/><circle cx="16.5" cy="17" r="1.8"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  fire: '<path d="M12 22a7 7 0 0 0 7-7c0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-3 3-5 5-5 8a7 7 0 0 0 7 7z"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  new: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
};
const svg = (n, s = 20, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n] || I.box}</svg>`;

/** A fitting icon for a product or section from its name (when there's no picture). */
function kindOf(text) {
  const t = String(text || '').toLowerCase();
  if (/power ?bank|باور|mah/.test(t)) return 'battery';
  if (/car|عربي|سيار/.test(t)) return 'car';
  if (/speaker|سبيكر|go ?\d|clip|charge \d/.test(t)) return 'speaker';
  if (/head|ear|buds|سماع|airpods|neckband|tune|jr3/.test(t)) return 'headphones';
  if (/cable|كابل|aux|data/.test(t)) return 'cable';
  if (/charger|adapter|شاحن|شواحن|plug|gan|wall/.test(t)) return t.includes('plug adapter') ? 'plug' : 'charger';
  if (/watch|ساع/.test(t)) return 'watch';
  if (/case|cover|جراب|اسكرين|screen/.test(t)) return 'case';
  if (/light|led|إضاء|اضاء/.test(t)) return 'light';
  if (/holder|bracket|stand|حامل/.test(t)) return 'phone';
  if (/موبايل|phone|iphone|samsung/.test(t)) return 'phone';
  return 'box';
}
const pic = (p, cls = '') => p.image
  ? `<img class="${cls}" src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" decoding="async">`
  : `<div class="${cls} noimg k-${kindOf(`${p.name} ${p.category || ''}`)}">${svg(kindOf(`${p.name} ${p.category || ''}`), 44)}${p.brand ? `<span>${esc(p.brand)}</span>` : ''}</div>`;
const waLink = (text) => {
  let n = String(info?.whatsapp || '').replace(/\D/g, '');
  if (n.startsWith('0')) n = '2' + n;
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : '';
};
const skeleton = (n = 8) => `<div class="grid">${'<div class="card sk"><div class="card-pic"></div><i></i><i></i><i class="short"></i></div>'.repeat(n)}</div>`;

// ---------- cart ----------
const cart = () => read(CART, []);
function setCart(c) {
  write(CART, c);
  const n = c.reduce((s, l) => s + l.qty, 0);
  $$('.count').forEach((b) => { b.textContent = n; b.hidden = !n; });
  $$('.card .qty-mini').forEach((el) => drawMini(el));
}
async function loadCatalog(force = false) {
  if (!catalog || force) catalog = await api('/store/products');
  return catalog;
}
function addToCart(id, qty = 1, { open = false } = {}) {
  const c = cart();
  const line = c.find((l) => l.id === id);
  const p = catalog?.find((x) => x.id === id);
  if (line) line.qty += qty; else c.push({ id, qty });
  setCart(c);
  if (open) openCart(); else toast(`اتضاف للسلة ✓${p ? ` — ${p.name}` : ''}`, true);
}
function changeQty(id, d) {
  const c = cart().map((l) => (l.id === id ? { ...l, qty: l.qty + d } : l)).filter((l) => l.qty > 0);
  setCart(c);
}
/** The cart lines with live prices (anything no longer sold drops out). */
async function cartLines() {
  const c = cart();
  if (!c.length) return [];
  const list = await loadCatalog(true);
  const by = new Map(list.map((p) => [p.id, p]));
  const lines = c.filter((l) => by.get(l.id)?.in_stock).map((l) => ({ ...by.get(l.id), qty: l.qty }));
  if (lines.length !== c.length) setCart(lines.map((l) => ({ id: l.id, qty: l.qty })));
  return lines;
}
function freeShipBar(sub) {
  if (!info.free_ship) return '';
  const left = info.free_ship - sub;
  const pct = Math.min(100, Math.round((sub / info.free_ship) * 100));
  return `<div class="freeship ${left <= 0 ? 'done' : ''}">${svg('truck', 18)}
    <span>${left > 0 ? `فاضلك ${money(left)} وتاخد <b>شحن مجاني</b>` : '<b>مبروك! الشحن عليك مجاني</b>'}</span>
    <div class="bar"><i style="width:${pct}%"></i></div></div>`;
}
async function drawCart(target, { page = false } = {}) {
  const lines = await cartLines();
  if (!lines.length) {
    target.innerHTML = `<div class="empty-cart">${svg('box', 56)}<b>السلة فاضية</b><span>اختار اللي يعجبك وارجع هنا</span><a class="btn primary" href="#/" data-close-cart>تسوّق دلوقتي</a></div>`;
    return;
  }
  const sub = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const short = info.min_order > sub;
  target.innerHTML = `
    ${freeShipBar(sub)}
    <div class="cart-lines">${lines.map((l) => `
      <div class="cline" data-id="${l.id}">
        <a href="#/p/${l.id}" class="cline-pic" data-close-cart>${pic(l)}</a>
        <div class="cline-info"><a href="#/p/${l.id}" data-close-cart dir="auto">${esc(l.name)}</a><b>${money(l.price)}</b>
          <div class="stepper sm"><button data-d="1" aria-label="زوّد">+</button><span>${l.qty}</span><button data-d="-1" aria-label="قلّل">${l.qty > 1 ? '−' : svg('trash', 14)}</button></div></div>
      </div>`).join('')}</div>
    <div class="cart-foot">
      <div class="row-sum"><span>المجموع</span><b>${money(sub)}</b></div>
      <p class="hint">${info.free_ship && sub >= info.free_ship ? 'التوصيل مجاني ✓' : 'التوصيل بيتحسب في الخطوة الجاية حسب مكانك'}</p>
      ${short ? `<p class="warn-text">أقل طلب ${money(info.min_order)}</p>` : ''}
      <a class="btn primary wide ${short ? 'disabled' : ''}" href="#/checkout" data-close-cart>إتمام الطلب ←</a>
      ${page ? '' : '<button type="button" class="btn plain wide" data-close-cart>كمّل تسوّق</button>'}
    </div>`;
  target.querySelectorAll('.cline [data-d]').forEach((b) => b.addEventListener('click', () => {
    changeQty(Number(b.closest('.cline').dataset.id), Number(b.dataset.d));
    drawCart(target, { page });
  }));
}
function openCart() {
  const d = $('#drawer');
  $('#drawer-back').hidden = false;
  requestAnimationFrame(() => { d.classList.add('open'); $('#drawer-back').classList.add('on'); });
  d.setAttribute('aria-hidden', 'false');
  document.body.classList.add('locked');
  $('#drawer-body').innerHTML = '<div class="loading"><span></span><span></span><span></span></div>';
  drawCart($('#drawer-body')).catch((e) => toast(e.message));
}
function closeCart() {
  const d = $('#drawer');
  d.classList.remove('open');
  $('#drawer-back').classList.remove('on');
  d.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('locked');
  setTimeout(() => { if (!d.classList.contains('open')) $('#drawer-back').hidden = true; }, 250);
}

// ---------- product cards ----------
function drawMini(el) {
  const id = Number(el.dataset.id);
  const line = cart().find((l) => l.id === id);
  el.innerHTML = line
    ? `<div class="stepper sm"><button data-d="1" aria-label="زوّد">+</button><span>${line.qty}</span><button data-d="-1" aria-label="قلّل">−</button></div>`
    : `<button class="add" aria-label="أضف للسلة">${svg('plus', 16)}<span>أضف</span></button>`;
}
const card = (p) => `
  <article class="card ${p.in_stock ? '' : 'out'}">
    <a href="#/p/${p.id}" class="card-pic">${pic(p)}
      <span class="badges">${p.off ? `<em class="b-off" dir="ltr">-${p.off}%</em>` : ''}${!p.in_stock ? '<em class="b-out">نفد</em>' : p.left ? `<em class="b-left">باقي ${p.left}</em>` : ''}</span></a>
    <div class="card-body">
      ${p.brand ? `<span class="card-brand">${esc(p.brand)}</span>` : ''}
      <a href="#/p/${p.id}" class="card-name" title="${esc(p.name)}">${esc(p.name)}</a>
      <div class="card-price"><b>${money(p.price)}</b>${p.old_price ? `<s>${nf.format(p.old_price)}</s>` : ''}</div>
      ${p.in_stock ? `<div class="qty-mini" data-id="${p.id}"></div>` : '<span class="soon">هيرجع قريب</span>'}
    </div>
  </article>`;
function wireCards(root) {
  root.querySelectorAll('.qty-mini').forEach(drawMini);
  root.addEventListener('click', (e) => {
    const mini = e.target.closest('.qty-mini');
    if (!mini) return;
    const id = Number(mini.dataset.id);
    if (e.target.closest('.add')) addToCart(id);
    const d = e.target.closest('[data-d]');
    if (d) changeQty(id, Number(d.dataset.d));
  });
}
const row = (title, list, more, icon = '', note = '') => list.length ? `
  <section class="row">
    <div class="sec-head"><h2>${icon ? svg(icon, 22, 'h-ic') : ''}${esc(title)}</h2>${note ? `<span class="sec-note">${note}</span>` : ''}${more ? `<a href="${more}" class="more">عرض الكل <span aria-hidden="true">‹</span></a>` : ''}</div>
    <div class="hscroll">${list.map(card).join('')}</div>
  </section>` : '';

const linkAttrs = (link) => {
  const l = String(link || '').trim();
  if (!l) return '';
  if (/^https?:\/\//.test(l)) return `href="${esc(l)}" target="_blank" rel="noopener"`;
  return `href="${esc(l.startsWith('#') ? l : `#/${l.replace(/^\/+/, '')}`)}"`;
};
const catTile = (c, cls = 'circle') => `<a href="#/list?cat=${c.id}" class="${cls}">
  <span class="ring">${c.image ? `<img src="${esc(c.image)}" alt="" loading="lazy">` : svg(kindOf(c.name), 34)}</span><span class="c-name">${esc(c.name)}</span>${cls === 'tile' ? `<small>${c.n} منتج</small>` : ''}</a>`;

/** Why buy here: built from what the shop actually offers. */
function trustItems() {
  const out = [];
  if (info.delivery.ship) out.push(['truck', info.free_ship ? `شحن مجاني فوق ${nf.format(info.free_ship)}` : 'شحن لكل مصر', 'بيوصلك لحد البيت']);
  else if (info.delivery.local) out.push(['truck', 'توصيل سريع', info.delivery.local.area || 'في منطقتنا']);
  if (info.payments.cod) out.push(['cash', 'الدفع عند الاستلام', 'افحص وادفع']);
  else if (info.payments.card) out.push(['card', 'دفع آمن', 'فيزا وماستركارد']);
  out.push(['shield', 'منتجات أصلية', 'بضمان المحل']);
  if (info.whatsapp) out.push(['chat', 'دعم على الواتساب', 'بنرد بسرعة']);
  else if (info.delivery.pickup) out.push(['store', 'استلام من المحل', 'من غير مصاريف']);
  return out.slice(0, 4);
}

// ---------- pages ----------
async function home() {
  const slides = info.slides.length ? info.slides : null;
  view.innerHTML = `
    <section class="hero ${info.sides.length ? 'with-sides' : ''}">
      <div class="slider" id="slider">
        <div class="slides">${slides
          ? slides.map((b) => `<a class="slide" ${linkAttrs(b.link)}><img src="${esc(b.image)}" alt=""></a>`).join('')
          : `<div class="slide default"><div><span class="kicker">${esc(info.title)}</span><h1>${esc(info.about || 'كل اللي موبايلك محتاجه في مكان واحد')}</h1>
              <p>شواحن، كابلات، سماعات وإكسسوارات أصلية — اطلب ويوصلك لحد البيت</p><a class="btn lime" href="#/list">تسوّق دلوقتي</a></div>
              <div class="default-art">${svg('headphones', 90)}${svg('charger', 70)}${svg('cable', 60)}</div></div>`}</div>
        ${slides && slides.length > 1 ? `<div class="dots">${slides.map((_, i) => `<button data-i="${i}" aria-label="${i + 1}"></button>`).join('')}</div>` : ''}
      </div>
      ${info.sides.length ? `<div class="sides">${info.sides.map((b) => `<a class="side" ${linkAttrs(b.link)}><img src="${esc(b.image)}" alt=""></a>`).join('')}</div>` : ''}
    </section>
    <section class="trust">${trustItems().map(([ic, t, s]) => `<div>${svg(ic, 26)}<span><b>${t}</b><small>${s}</small></span></div>`).join('')}</section>
    ${info.categories.length ? `<section class="row"><div class="sec-head"><h2>تسوّق بالقسم</h2><a href="#/cats" class="more">كل الأقسام <span aria-hidden="true">‹</span></a></div>
      <div class="circles">${info.categories.map((c) => catTile(c)).join('')}</div></section>` : ''}
    <div id="rows">${skeleton(4)}</div>`;
  startSlider($('#slider'));
  const data = await api('/store/home');
  const sections = data.sections.map((s) => row(s.name, s.products.slice(0, 12), `#/list?cat=${s.id}`, kindOf(s.name)));
  // Promotions between sections: the side banners again on phones, a help box, brands
  const help = waLink('') ? `<section class="help-box">${svg('chat', 34)}<div><b>محتار تختار إيه؟</b><span>ابعتلنا موديل موبايلك ونقولك المناسب ليه</span></div>
    <a class="btn lime" target="_blank" rel="noopener" href="${waLink('محتاج مساعدة أختار إكسسوار لموبايلي')}">${svg('wa', 18)} كلمنا واتساب</a></section>` : '';
  const brands = data.brands.length > 2 ? `<section class="row"><div class="sec-head"><h2>تسوّق بالبراند</h2></div>
    <div class="brands">${data.brands.map((b) => `<a href="#/list?brand=${encodeURIComponent(b.name)}" class="brand-tile"><b>${esc(b.name)}</b><small>${b.n} منتج</small></a>`).join('')}</div></section>` : '';
  $('#rows').innerHTML = [
    row('عروض وخصومات', data.deals, '#/list?deals=1', 'fire', 'لفترة محدودة'),
    row('الأكثر مبيعاً', data.best, '', 'star'),
    sections[0] || '', help, ...sections.slice(1, 3), brands, ...sections.slice(3),
    row('وصل حديثاً', data.latest, '#/list?sort=new', 'new'),
  ].join('') || '<div class="empty big">لسه مفيش منتجات</div>';
  wireCards($('#rows'));
}

function startSlider(el) {
  const track = el.querySelector('.slides');
  const n = track.children.length;
  if (n < 2) return;
  let i = 0, timer = null, x0 = null;
  const go = (k) => {
    i = (k + n) % n;
    track.style.transform = `translateX(${i * 100}%)`;
    el.querySelectorAll('.dots button').forEach((d, j) => d.classList.toggle('on', j === i));
  };
  const auto = () => { clearInterval(timer); timer = setInterval(() => { if (!el.isConnected) return clearInterval(timer); if (!document.hidden) go(i + 1); }, 5000); };
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

function cats() {
  view.innerHTML = `<nav class="crumbs"><a href="#/">الرئيسية</a><span>الأقسام</span></nav>
    <h1 class="page-title">كل الأقسام</h1>
    <div class="tiles">${info.categories.map((c) => catTile(c, 'tile')).join('') || '<div class="empty">مفيش أقسام لسه</div>'}</div>`;
}

/** A section, a search, offers, or everything: with brand chips, sorting and "in stock only". */
async function list(query) {
  const q = query.get('q') || '';
  const cat = query.get('cat') || '';
  const brand = query.get('brand') || '';
  const sort = query.get('sort') || '';
  const deals = query.get('deals') === '1';
  const stock = query.get('stock') === '1';
  const catName = info.categories.find((c) => String(c.id) === cat)?.name;
  const title = q ? `نتايج البحث عن "${q}"` : deals ? 'عروض وخصومات' : catName || brand || (sort === 'new' ? 'وصل حديثاً' : 'كل المنتجات');
  const params = (extra) => `#/list?${new URLSearchParams(Object.fromEntries(Object.entries({ q, cat, brand, sort, deals: deals ? '1' : '', stock: stock ? '1' : '', ...extra }).filter(([, v]) => v)))}`;
  view.innerHTML = `<nav class="crumbs"><a href="#/">الرئيسية</a>${catName ? `<a href="#/cats">الأقسام</a>` : ''}<span>${esc(title)}</span></nav>
    <div class="list-head"><div><h1 class="page-title">${esc(title)}</h1><span class="muted" id="count"></span></div>
      <div class="list-tools">
        <label class="switch"><input type="checkbox" id="stock" ${stock ? 'checked' : ''}><span>المتاح بس</span></label>
        <select id="sort" aria-label="ترتيب"><option value="">الأنسب</option><option value="new" ${sort === 'new' ? 'selected' : ''}>الأحدث</option>
          <option value="price_asc" ${sort === 'price_asc' ? 'selected' : ''}>السعر: من الأقل</option><option value="price_desc" ${sort === 'price_desc' ? 'selected' : ''}>السعر: من الأعلى</option></select></div></div>
    <nav class="chips" id="chips"></nav>
    <div id="grid">${skeleton(8)}</div>`;
  $('#sort').addEventListener('change', (e) => { location.hash = params({ sort: e.target.value }); });
  $('#stock').addEventListener('change', (e) => { location.hash = params({ stock: e.target.checked ? '1' : '' }); });
  const all = await api(`/store/products?${new URLSearchParams(Object.fromEntries(Object.entries({ q, cat, sort, deals: deals ? '1' : '' }).filter(([, v]) => v)))}`);
  const brands = [...new Set(all.map((p) => p.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const chips = [];
  if (!cat && info.categories.length > 1 && !q) chips.push(...info.categories.map((c) => `<a href="#/list?cat=${c.id}">${esc(c.name)}</a>`));
  if (brands.length > 1) chips.push(`<a href="${params({ brand: '' })}" class="${brand ? '' : 'on'}">كل البراندات</a>`, ...brands.map((b) => `<a href="${params({ brand: b })}" class="${b === brand ? 'on' : ''}">${esc(b)}</a>`));
  $('#chips').innerHTML = chips.join('');
  let shown = brand ? all.filter((p) => p.brand?.toLowerCase() === brand.toLowerCase()) : all;
  if (stock) shown = shown.filter((p) => p.in_stock);
  $('#count').textContent = `${shown.length} منتج`;
  $('#grid').innerHTML = shown.length ? `<div class="grid">${shown.map(card).join('')}</div>`
    : `<div class="empty big">${svg('box', 48)}<span>${q ? 'مفيش نتايج — جرب كلمة تانية أو اسألنا على الواتساب' : 'مفيش منتجات هنا لسه'}</span>${waLink('') ? `<a class="btn ghost" target="_blank" rel="noopener" href="${waLink(`بدوّر على: ${q || title}`)}">${svg('wa', 18)} اسألنا</a>` : ''}</div>`;
  wireCards($('#grid'));
}

async function product(id) {
  view.innerHTML = '<div class="loading"><span></span><span></span><span></span></div>';
  const p = await api(`/store/products/${id}`);
  document.title = `${p.name} — ${info.title}`;
  const perks = [
    info.delivery.ship || info.delivery.local ? ['truck', info.free_ship ? `توصيل مجاني للطلبات فوق ${nf.format(info.free_ship)}` : 'توصيل لحد البيت'] : null,
    info.payments.cod ? ['cash', 'ادفع لما الطلب يوصلك'] : null,
    ['shield', p.warranty_days ? `ضمان ${p.warranty_days} يوم من المحل` : 'منتج أصلي 100%'],
    info.delivery.pickup ? ['store', 'أو استلمه من المحل'] : null,
  ].filter(Boolean);
  view.innerHTML = `
    <nav class="crumbs"><a href="#/">الرئيسية</a>${p.category_id ? `<a href="#/list?cat=${p.category_id}">${esc(p.category || '')}</a>` : ''}<span dir="auto">${esc(p.name)}</span></nav>
    <section class="product">
      <div class="gallery">${pic(p, 'big')}${p.off ? `<em class="b-off big-badge" dir="ltr">-${p.off}%</em>` : ''}</div>
      <div class="product-info">
        ${p.brand ? `<a class="p-brand" href="#/list?brand=${encodeURIComponent(p.brand)}">${esc(p.brand)}</a>` : ''}
        <h1 dir="auto">${esc(p.name)}</h1>
        <div class="p-price"><b>${money(p.price)}</b>${p.old_price ? `<s>${money(p.old_price)}</s><em class="save">وفّر ${money(p.old_price - p.price)}</em>` : ''}</div>
        ${p.in_stock ? `<p class="stock ok">${svg('check', 16)} ${p.left ? `متاح — فاضل ${p.left} بس` : 'متاح'}</p>` : '<p class="stock bad">نفد — هيرجع قريب</p>'}
        ${p.in_stock ? `<div class="buy">
            <div class="stepper"><button data-d="1" aria-label="زوّد">+</button><input id="qty" value="1" inputmode="numeric" aria-label="الكمية"><button data-d="-1" aria-label="قلّل">−</button></div>
            <button class="btn primary" id="add">${svg('box', 18)} أضف للسلة</button>
          </div>
          <button class="btn lime wide" id="buy-now">اشتري دلوقتي</button>` : (waLink('') ? `<a class="btn ghost wide" target="_blank" rel="noopener" href="${waLink(`بلغوني لما يرجع: ${p.name}`)}">${svg('wa')} بلّغني لما يرجع</a>` : '')}
        <ul class="perks">${perks.map(([ic, t]) => `<li>${svg(ic, 20)}<span>${t}</span></li>`).join('')}</ul>
        ${p.description ? `<div class="desc"><h3>عن المنتج</h3><p dir="auto">${esc(p.description).replace(/\n/g, '<br>')}</p></div>` : ''}
        ${waLink('') ? `<a class="ask" target="_blank" rel="noopener" href="${waLink(`عايز أسأل عن: ${p.name}`)}">${svg('wa', 18)} عندك سؤال؟ اسألنا على الواتساب</a>` : ''}
      </div>
    </section>
    ${row('ممكن يعجبك كمان', p.related || [], p.category_id ? `#/list?cat=${p.category_id}` : '', 'star')}
    ${p.in_stock ? `<div class="sticky-buy"><div><b>${money(p.price)}</b><small dir="auto">${esc(p.name)}</small></div><button class="btn primary" id="add2">أضف للسلة</button></div>` : ''}`;
  const qty = $('#qty');
  const n = () => Math.max(1, parseInt(qty?.value, 10) || 1);
  view.querySelectorAll('.buy [data-d]').forEach((b) => b.addEventListener('click', () => { qty.value = Math.max(1, n() + Number(b.dataset.d)); }));
  $('#add')?.addEventListener('click', () => addToCart(p.id, n(), { open: true }));
  $('#add2')?.addEventListener('click', () => addToCart(p.id, n(), { open: true }));
  $('#buy-now')?.addEventListener('click', () => { addToCart(p.id, n()); location.hash = '#/checkout'; });
  wireCards(view);
}

async function cartPage() {
  view.innerHTML = `<nav class="crumbs"><a href="#/">الرئيسية</a><span>السلة</span></nav><h1 class="page-title">سلة المشتريات</h1><div class="cart-page" id="cart-page"></div>`;
  await drawCart($('#cart-page'), { page: true });
}

async function checkout() {
  const lines = await cartLines();
  if (!lines.length) { location.hash = '#/'; return; }
  const sub = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const d = info.delivery;
  const p = info.payments;
  const free = info.free_ship && sub >= info.free_ship;
  const saved = read('mm_shop_me', {});
  const opts = [
    d.ship && Object.keys(d.ship).length ? ['ship', 'truck', 'شحن لحد البيت', free ? 'مجاني ✓' : 'لكل المحافظات — السعر حسب محافظتك'] : null,
    d.local ? ['local', 'truck', 'توصيل سريع', `${d.local.area ? `${esc(d.local.area)} — ` : ''}${free || !d.local.fee ? 'مجاناً' : money(d.local.fee)}`] : null,
    d.pickup ? ['pickup', 'store', 'استلام من المحل', d.pickup.address ? esc(d.pickup.address) : 'مجاناً'] : null,
  ].filter(Boolean);
  const pays = [
    p.cod ? ['cod', 'cash', 'كاش عند الاستلام', 'تدفع لما الطلب يوصلك'] : null,
    p.transfer ? ['transfer', 'tag', 'تحويل InstaPay / محفظة', 'بيانات التحويل بتظهرلك بعد الطلب'] : null,
    p.card ? ['card', 'card', 'فيزا / ماستركارد', 'دفع آمن أونلاين'] : null,
  ].filter(Boolean);
  const choice = (name, [v, ic, t, s], i) => `<label class="choice"><input type="radio" name="${name}" value="${v}" ${i === 0 ? 'checked' : ''}>${svg(ic, 22)}<span><b>${t}</b><small>${s}</small></span></label>`;
  view.innerHTML = `
    <ol class="flow"><li class="done">السلة</li><li class="on">بياناتك</li><li>التأكيد</li></ol>
    <form id="co" class="checkout" novalidate>
      <div class="co-main">
        <section class="panel"><h2><span class="num-step">1</span> بياناتك</h2>
          <div class="two">
            <label class="fld"><span>الاسم بالكامل</span><input name="name" required value="${esc(saved.name || '')}" autocomplete="name"></label>
            <label class="fld"><span>رقم الموبايل</span><input name="phone" required inputmode="tel" dir="ltr" value="${esc(saved.phone || '')}" autocomplete="tel" placeholder="01xxxxxxxxx"></label>
          </div></section>
        <section class="panel"><h2><span class="num-step">2</span> هتستلم إزاي؟</h2>
          <div class="choices">${opts.map((o, i) => choice('delivery', o, i)).join('')}</div>
          <div class="two" id="addr-box">
            <label class="fld" id="gov-f"><span>المحافظة</span><select name="governorate">${Object.entries(d.ship || {}).map(([g, f]) => `<option value="${esc(g)}" ${saved.governorate === g ? 'selected' : ''}>${esc(g)} — ${free ? 'مجاني' : `شحن ${nf.format(f)}`}</option>`).join('')}</select></label>
            <label class="fld full" id="addr-f"><span>العنوان بالتفصيل</span><textarea name="address" rows="2" autocomplete="street-address" placeholder="المنطقة، الشارع، رقم العمارة، الدور">${esc(saved.address || '')}</textarea></label>
          </div></section>
        <section class="panel"><h2><span class="num-step">3</span> هتدفع إزاي؟</h2>
          <div class="choices">${pays.map((o, i) => choice('payment', o, i)).join('')}</div>
          <label class="fld"><span>ملاحظات (اختياري)</span><input name="notes" placeholder="مثلاً: كلمني قبل ما تيجي"></label></section>
      </div>
      <aside class="co-side panel">
        <h2>ملخص الطلب</h2>
        <div class="mini-lines">${lines.map((l) => `<div>${pic(l, 'mini-pic')}<span dir="auto">${esc(l.name)}<small>× ${l.qty}</small></span><b>${money(l.price * l.qty)}</b></div>`).join('')}</div>
        <div class="totals">
          <div><span>المنتجات</span><span>${money(sub)}</span></div>
          <div><span>التوصيل</span><span id="fee"></span></div>
          <div class="grand"><span>الإجمالي</span><b id="total"></b></div>
        </div>
        <button class="btn primary wide big" id="send">تأكيد الطلب</button>
        <p class="hint">${svg('shield', 16)} بياناتك بتستخدم للتوصيل بس</p>
      </aside>
    </form>`;
  const f = $('#co');
  const feeNow = () => {
    if (free) return 0;
    const del = f.delivery.value;
    if (del === 'ship') return d.ship[f.governorate.value] ?? 0;
    if (del === 'local') return d.local.fee;
    return 0;
  };
  const draw = () => {
    const del = f.delivery.value;
    $('#gov-f').hidden = del !== 'ship';
    $('#addr-f').hidden = del === 'pickup';
    $('#addr-box').hidden = del === 'pickup';
    const fee = feeNow();
    $('#fee').innerHTML = fee ? money(fee) : '<span class="free">مجاناً</span>';
    $('#total').innerHTML = money(sub + fee);
  };
  f.addEventListener('change', draw);
  draw();
  if (!pays.length || !opts.length) $('#send').disabled = true;
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    // Friendly checks before sending
    const bad = (el, msg) => { el.closest('.fld')?.classList.add('err'); el.focus(); toast(msg); return true; };
    $$('.fld.err', f).forEach((x) => x.classList.remove('err'));
    if (!f.name.value.trim()) return bad(f.name, 'اكتب اسمك');
    if (f.phone.value.replace(/\D/g, '').length < 10) return bad(f.phone, 'اكتب رقم موبايل صحيح');
    if (f.delivery.value !== 'pickup' && !f.address.value.trim()) return bad(f.address, 'اكتب العنوان');
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
  const steps = pickup ? STEPS.filter(([s]) => s !== 'shipped').map(([s, t]) => [s, s === 'delivered' ? 'استلمته' : t]) : STEPS;
  const cur = steps.findIndex(([s]) => s === o.status);
  view.innerHTML = `
    ${query.get('new') ? `<div class="done-box">${svg('check', 34)}<h1>طلبك وصلنا</h1><p>هنكلمك على رقمك نأكد الطلب. احتفظ باللينك ده عشان تتابع طلبك — وكمان هتلاقيه في "طلباتي".</p></div>` : ''}
    <div class="order-head"><h1 class="page-title">طلب رقم <span dir="ltr">${esc(o.order_no)}</span></h1><span class="muted">${esc(o.created_at.slice(0, 16))}</span></div>
    ${o.status === 'cancelled' ? `<div class="note bad">الطلب اتلغى${o.cancel_reason ? ` — ${esc(o.cancel_reason)}` : ''}</div>` : `
      <ol class="track">${steps.map(([, t], i) => `<li class="${i < cur ? 'done' : i === cur ? 'now' : ''}"><i>${i <= cur ? svg('check', 14) : i + 1}</i><span>${t}</span></li>`).join('')}</ol>`}
    ${o.payment === 'card' && o.pay_status !== 'paid' && o.status !== 'cancelled' ? `<div class="note bad">${o.pay_status === 'failed' ? 'الدفع بالفيزا متمّش.' : 'لسه مستنيين تأكيد الدفع.'} ${waLink('') ? 'كلمنا على الواتساب نكمّل الطلب.' : ''}</div>` : ''}
    ${o.payment === 'transfer' && o.status !== 'cancelled' && o.pay_status !== 'paid' ? `
      <div class="note">
        <b>حوّل ${money(o.total)}</b>${o.transfer_info ? `<pre dir="auto">${esc(o.transfer_info)}</pre>` : ''}
        ${o.pay_status === 'review' ? '<p class="ok-text">صورة التحويل وصلتنا ✓ هنراجعها ونأكدلك.</p>' : '<p>بعد ما تحوّل، ارفع صورة التحويل هنا:</p>'}
        <label class="btn ghost file">${o.has_proof ? 'غيّر صورة التحويل' : 'ارفع صورة التحويل'}<input type="file" accept="image/*" id="proof"></label>
      </div>` : ''}
    ${o.payment === 'transfer' && o.pay_status === 'paid' ? '<div class="note ok">التحويل اتأكد ✓</div>' : ''}
    <div class="panel">
      <div class="cart-lines">${o.items.map((i) => `<div class="oline"><span dir="auto">${esc(i.name)}</span><small>${i.qty} × ${money(i.unit_price)}</small><b>${money(i.line_total)}</b></div>`).join('')}</div>
      <div class="totals">
        <div><span>المنتجات</span><span>${money(o.subtotal)}</span></div>
        <div><span>${pickup ? 'استلام من المحل' : `التوصيل${o.governorate ? ` — ${esc(o.governorate)}` : ''}`}</span><span>${o.delivery_fee ? money(o.delivery_fee) : '<span class="free">مجاناً</span>'}</span></div>
        <div class="grand"><span>الإجمالي</span><b>${money(o.total)}</b></div>
      </div>
    </div>
    <div class="order-actions">
      ${waLink('') ? `<a class="btn ghost" target="_blank" rel="noopener" href="${waLink(`بخصوص طلبي رقم ${o.order_no}`)}">${svg('wa')} كلمنا على الواتساب</a>` : ''}
      <a class="btn primary" href="#/">كمّل تسوّق</a></div>`;
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

/** Orders made from this phone. */
async function mine() {
  const tokens = read(MINE, []);
  view.innerHTML = '<nav class="crumbs"><a href="#/">الرئيسية</a><span>طلباتي</span></nav><h1 class="page-title">طلباتي</h1><div class="mine" id="mine"><div class="loading"><span></span><span></span><span></span></div></div>';
  if (!tokens.length) { $('#mine').innerHTML = `<div class="empty big">${svg('box', 48)}<span>لسه مطلبتش من الجهاز ده</span><a class="btn primary" href="#/">تسوّق دلوقتي</a></div>`; return; }
  const orders = (await Promise.all(tokens.map((t) => api(`/store/orders/${t}`).then((o) => ({ ...o, token: t })).catch(() => null)))).filter(Boolean);
  $('#mine').innerHTML = orders.map((o) => `<a class="mine-row" href="#/order/${o.token}"><div><b dir="ltr">${esc(o.order_no)}</b>
    <small>${o.items.length} منتج • ${esc(o.created_at.slice(0, 10))}</small></div><div class="mine-end"><b>${money(o.total)}</b><span class="state ${o.status}">${esc(o.status_ar)}</span></div></a>`).join('');
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

// ---------- search with suggestions ----------
function initSearch() {
  const form = $('#top-search');
  const input = form.q;
  const box = $('#suggest');
  let t = null;
  const hide = () => { box.hidden = true; };
  input.addEventListener('input', () => {
    clearTimeout(t);
    const q = input.value.trim();
    if (q.length < 2) return hide();
    t = setTimeout(async () => {
      const list = await api(`/store/products?q=${encodeURIComponent(q)}&limit=6`).catch(() => []);
      if (input.value.trim() !== q) return;
      box.innerHTML = list.length ? list.map((p) => `<a href="#/p/${p.id}">${pic(p, 'sg-pic')}<span dir="auto">${esc(p.name)}</span><b>${money(p.price)}</b></a>`).join('')
        + `<a href="#/list?q=${encodeURIComponent(q)}" class="sg-all">كل النتايج لـ "${esc(q)}" ‹</a>` : '<div class="sg-none">مفيش نتايج</div>';
      box.hidden = false;
    }, 220);
  });
  box.addEventListener('click', () => { hide(); input.value = ''; input.blur(); });
  document.addEventListener('click', (e) => { if (!form.contains(e.target)) hide(); });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input.value.trim();
    hide();
    location.hash = v ? `#/list?q=${encodeURIComponent(v)}` : '#/list';
    input.blur();
  });
}

// ---------- routing ----------
async function route() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  const query = new URLSearchParams(qs);
  const parts = path.split('/').filter(Boolean);
  document.title = info?.title || 'المتجر';
  window.scrollTo(0, 0);
  $('#toast').hidden = true;
  closeCart();
  // Highlight where we are
  const curCat = query.get('cat');
  $$('#catbar a').forEach((x) => x.classList.toggle('on', curCat ? x.dataset.cat === curCat : (!parts.length && x.dataset.home === '1') || (query.get('deals') && x.dataset.deals === '1')));
  const tab = !parts.length ? 'home' : parts[0] === 'cats' ? 'cats' : query.get('deals') ? 'deals' : parts[0] === 'mine' || parts[0] === 'order' ? 'mine' : '';
  $$('#bottom-nav [data-tab]').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  document.body.dataset.page = parts[0] || 'home';
  try {
    if (!info.enabled && parts[0] !== 'order') { view.innerHTML = `<div class="empty big">${svg('store', 52)}<span>المتجر مقفول دلوقتي — ارجعلنا قريب</span></div>`; return; }
    if (parts[0] === 'p') await product(parts[1]);
    else if (parts[0] === 'cart') await cartPage();
    else if (parts[0] === 'checkout') await checkout();
    else if (parts[0] === 'order') await orderPage(parts[1], query);
    else if (parts[0] === 'list') await list(query);
    else if (parts[0] === 'cats') cats();
    else if (parts[0] === 'mine') await mine();
    else await home();
  } catch (e) {
    view.innerHTML = `<div class="empty big">${esc(e.message)}<a class="btn primary" href="#/">الرئيسية</a></div>`;
  }
}

(async () => {
  view.innerHTML = skeleton(8);
  try { info = await api('/store/info'); } catch (e) { view.innerHTML = `<div class="empty big">${esc(e.message)}</div>`; return; }
  $('#title').textContent = info.title;
  if (info.strip) { const st = $('#strip'); st.textContent = info.strip; st.style.background = info.strip_color || '#141414'; st.hidden = false; }
  $('#catbar').innerHTML = `<a href="#/" data-home="1">الرئيسية</a>${info.categories.map((c) => `<a href="#/list?cat=${c.id}" data-cat="${c.id}">${svg(kindOf(c.name), 16)}${esc(c.name)}</a>`).join('')}<a href="#/list?deals=1" data-deals="1" class="hot">${svg('fire', 16)}العروض</a>`;
  const wa = waLink('');
  if (wa) { const f = $('#wa-float'); f.href = wa; f.hidden = false; }
  initSearch();
  $$('[data-open-cart]').forEach((b) => b.addEventListener('click', openCart));
  $('#drawer-x').addEventListener('click', closeCart);
  $('#drawer-back').addEventListener('click', closeCart);
  $('#drawer').addEventListener('click', (e) => { if (e.target.closest('[data-close-cart]')) closeCart(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCart(); });
  const pays = [info.payments.cod && 'كاش عند الاستلام', info.payments.transfer && 'InstaPay / محافظ', info.payments.card && 'فيزا / ماستركارد'].filter(Boolean);
  $('#foot').innerHTML = `<div class="wrap foot-grid">
    <div class="foot-about"><div class="brand light"><img class="logo" src="/brand/mark.svg" alt=""><b>${esc(info.title)}</b></div>
      <p>${esc(info.about || 'إكسسوارات موبايل أصلية: شواحن، كابلات، سماعات وباور بانك — بضمان المحل.')}</p></div>
    <div><h4>الأقسام</h4>${info.categories.slice(0, 6).map((c) => `<a href="#/list?cat=${c.id}">${esc(c.name)}</a>`).join('')}<a href="#/list?deals=1">العروض</a></div>
    <div><h4>خدمة العملاء</h4><a href="#/mine">طلباتي وتتبع الطلب</a>${wa ? `<a target="_blank" rel="noopener" href="${wa}">كلمنا واتساب</a>` : ''}<a href="#/cart">السلة</a></div>
    <div><h4>تواصل معانا</h4>${info.address ? `<span>${esc(info.address)}</span>` : ''}${info.phone ? `<a href="tel:${esc(info.phone)}" dir="ltr">${esc(info.phone)}</a>` : ''}
      ${info.whatsapp ? `<a target="_blank" rel="noopener" href="${wa}" dir="ltr">${esc(info.whatsapp)}</a>` : ''}</div>
  </div>
  <div class="wrap foot-bottom"><span>© ${new Date().getFullYear()} ${esc(info.title)}</span><span class="pays">${pays.map((x) => `<em>${x}</em>`).join('')}</span></div>`;
  setCart(cart());
  loadCatalog().catch(() => {});
  window.addEventListener('hashchange', route);
  route();
})();
