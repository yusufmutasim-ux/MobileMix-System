import { api, state, icon, esc, money, modal, toast, toastErr, busy, debounce, PAY_NAMES, moneyText } from '../core.js';
import { printInvoice } from '../print.js';

const CART_KEY = 'mm_cart';

export async function render(el) {
  let cart = load();
  let pay = 'cash';
  let products = [];
  let category = '';

  const cats = await api.get('/categories');

  el.innerHTML = `
  <button class="cart-bar empty" id="cart-toggle"><span><span class="count" id="cart-count">0</span>عرض الفاتورة</span><span id="cart-sum"></span></button>
  <div class="pos">
    <div>
      <div class="card" style="padding:16px">
        <div class="search">${icon('barcode')}<input class="input input-lg" id="scan" placeholder="امسح الباركود / IMEI أو اكتب اسم المنتج…" autocomplete="off"></div>
        <div class="scan-hint">${icon('search', '')} Enter لإضافة المنتج — <span class="num">F9</span> لإتمام البيع</div>
        <div class="seg" style="margin-top:12px" id="cats">
          <button class="on" data-c="">الكل</button>
          ${cats.map((c) => `<button data-c="${c.id}">${esc(c.name)}</button>`).join('')}
        </div>
      </div>
      <div class="products-grid" id="grid" style="margin-top:16px"></div>
    </div>

    <div class="card pos-cart">
      <div class="card-head" style="margin-bottom:4px"><h2>الفاتورة</h2><button class="btn btn-ghost btn-sm" id="clear">${icon('trash')} تفريغ</button>
        <button class="btn btn-ghost btn-icon cart-close" id="cart-close" title="رجوع للمنتجات">${icon('x')}</button></div>
      <div class="lines" id="lines"></div>
      <div class="totals">
        <div class="form-grid" style="gap:10px;margin-bottom:10px">
          <label class="field"><span>خصم (مبلغ)</span><input class="input num" id="discount" type="number" min="0" step="any" value="0"></label>
          <label class="field"><span>المدفوع</span><input class="input num" id="paid" type="number" min="0" step="any" placeholder="= الإجمالي"></label>
        </div>
        <div class="pay-methods" id="pay">
          ${Object.entries(PAY_NAMES).map(([k, v]) => `<button data-p="${k}" class="${k === 'cash' ? 'on' : ''}">${v}</button>`).join('')}
        </div>
        <details style="margin-top:10px">
          <summary class="muted small" style="cursor:pointer">بيانات العميل وملاحظات</summary>
          <div class="form-grid" style="gap:10px;margin-top:10px">
            <label class="field"><span>اسم العميل</span><input class="input" id="cname"></label>
            <label class="field"><span>التليفون</span><input class="input ltr" id="cphone" inputmode="tel"></label>
            <label class="field full"><span>ملاحظات</span><input class="input" id="notes"></label>
          </div>
        </details>
        <div class="row" style="margin-top:12px"><span>المجموع</span><span id="sub"></span></div>
        <div class="row" id="disc-row"><span>الخصم</span><span id="disc"></span></div>
        <div class="row grand"><span>الإجمالي</span><span id="total"></span></div>
        <div class="row" id="change-row"><span id="change-label">الباقي</span><span id="change"></span></div>
        <button class="btn btn-primary btn-lg" style="width:100%;margin-top:8px" id="checkout">${icon('check')} إتمام البيع</button>
      </div>
    </div>
  </div>`;

  const $ = (s) => el.querySelector(s);
  const scan = $('#scan');
  // On phones/tablets don't pop the keyboard up after every tap
  const touch = matchMedia('(pointer: coarse)').matches;
  const focusScan = () => { if (!touch) scan.focus(); };
  const cartEl = el.querySelector('.pos-cart');
  const openCart = (open) => { cartEl.classList.toggle('open', open); document.body.style.overflow = open ? 'hidden' : ''; };
  $('#cart-toggle').addEventListener('click', () => openCart(true));
  $('#cart-close').addEventListener('click', () => openCart(false));

  // ---------- product grid ----------
  async function loadProducts(q = '') {
    const params = new URLSearchParams({ limit: '60' });
    if (q) params.set('q', q);
    if (category) params.set('category_id', category);
    products = await api.get('/products?' + params);
    $('#grid').innerHTML = products.length ? products.map((p) => `
      <button class="pcard ${p.qty <= 0 ? 'out' : ''}" data-id="${p.id}">
        <span class="t">${esc(p.name)}</span>
        <span class="muted small">${esc(p.brand || p.category_name || '')}</span>
        <span style="display:flex;justify-content:space-between;align-items:center;gap:6px">
          <span class="p">${money(p.sell_price)}</span>
          <span class="pill ${p.qty <= 0 ? 'pill-bad' : p.qty <= p.min_qty ? 'pill-warn' : 'pill-gray'}">${p.has_serial ? icon('phone', '') : ''} ${p.qty}</span>
        </span>
      </button>`).join('') : '<div class="card empty" style="grid-column:1/-1">مفيش منتجات مطابقة</div>';
  }

  $('#grid').addEventListener('click', (e) => {
    const b = e.target.closest('.pcard');
    if (!b) return;
    const p = products.find((x) => x.id === Number(b.dataset.id));
    if (p) addProduct(p);
  });

  $('#cats').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    category = b.dataset.c;
    $('#cats').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    loadProducts(scan.value.trim()).catch(toastErr);
  });

  const search = debounce(() => loadProducts(scan.value.trim()).catch(toastErr), 250);
  scan.addEventListener('input', search);
  scan.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = scan.value.trim();
    if (!code) return;
    try {
      const r = await api.get('/products/lookup?code=' + encodeURIComponent(code));
      await addProduct(r.product, r.serial);
      scan.value = '';
      loadProducts().catch(() => {});
    } catch (err) {
      // Not a barcode: if the name search has exactly one hit, take it
      if (products.length === 1) { await addProduct(products[0]); scan.value = ''; loadProducts().catch(() => {}); }
      else toastErr(err);
    }
  });

  // ---------- cart ----------
  async function addProduct(p, serial = null) {
    if (p.has_serial) {
      if (!serial) serial = await pickSerial(p);
      if (!serial) return;
      if (cart.some((l) => l.serial === serial)) return toast('الجهاز ده موجود في الفاتورة بالفعل', 'err');
      cart.push({ product_id: p.id, name: p.name, unit_price: p.sell_price, list_price: p.sell_price, qty: 1, serial, has_serial: true, stock: p.qty });
    } else {
      const line = cart.find((l) => l.product_id === p.id);
      if (p.qty <= (line?.qty || 0)) return toast(`الكمية المتاحة من "${p.name}" هي ${p.qty} بس`, 'err');
      if (line) line.qty++;
      else cart.push({ product_id: p.id, name: p.name, unit_price: p.sell_price, list_price: p.sell_price, qty: 1, has_serial: false, stock: p.qty });
    }
    draw();
    focusScan();
  }

  async function pickSerial(p) {
    const full = await api.get('/products/' + p.id);
    const free = (full.serials || []).filter((s) => !cart.some((l) => l.serial === s.serial));
    if (!free.length) { toast(`مفيش أجهزة متاحة من "${p.name}"`, 'err'); return null; }
    return modal({
      title: `اختار الجهاز — ${esc(p.name)}`,
      body: `<input class="input ltr" placeholder="امسح أو اكتب الـ IMEI" id="imei-q" autofocus style="margin-bottom:10px">
             <div class="serial-list">${free.map((s) => `<button data-s="${esc(s.serial)}">${esc(s.serial)}</button>`).join('')}</div>`,
      onMount: (m, close) => {
        m.querySelector('.serial-list').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) close(b.dataset.s); });
        const q = m.querySelector('#imei-q');
        q.addEventListener('input', () => m.querySelectorAll('.serial-list button').forEach((b) => { b.hidden = !b.dataset.s.includes(q.value.trim()); }));
        q.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return;
          const hit = free.find((s) => s.serial === q.value.trim()) || (free.filter((s) => s.serial.includes(q.value.trim())).length === 1 && free.find((s) => s.serial.includes(q.value.trim())));
          if (hit) close(hit.serial); else toast('الـ IMEI ده مش موجود', 'err');
        });
      },
    });
  }

  function totals() {
    const sub = cart.reduce((s, l) => s + (Number(l.unit_price) || 0) * l.qty, 0);
    const disc = Math.min(Number($('#discount').value) || 0, sub);
    return { sub, disc, total: sub - disc };
  }

  function draw() {
    save(cart);
    $('#lines').innerHTML = cart.length ? cart.map((l, i) => `
      <div class="line" data-i="${i}">
        <div><div class="name">${esc(l.name)}</div>${l.serial ? `<div class="meta num">IMEI: ${esc(l.serial)}</div>` : ''}</div>
        <div style="font-weight:500">${money(l.unit_price * l.qty)}</div>
        <div class="controls">
          ${l.has_serial ? '<span class="muted small">جهاز واحد</span>' : `
            <span class="qty"><button data-a="inc">+</button><input class="num" data-a="qty" value="${l.qty}" inputmode="numeric"><button data-a="dec">−</button></span>`}
          <span class="muted small" style="margin-inline-start:auto">السعر</span>
          <input class="input price-in num" data-a="price" type="number" min="0" step="any" value="${l.unit_price}">
          <button class="btn btn-ghost btn-icon" data-a="del" title="حذف">${icon('x')}</button>
        </div>
      </div>`).join('') : `<div class="empty">${icon('cart')}امسح منتج أو اختاره من القائمة</div>`;

    const t = totals();
    $('#sub').innerHTML = money(t.sub);
    $('#disc').innerHTML = money(t.disc);
    $('#disc-row').classList.toggle('hidden', !t.disc);
    $('#total').innerHTML = money(t.total);
    const paid = $('#paid').value === '' ? t.total : Number($('#paid').value);
    const diff = paid - t.total;
    $('#change-row').classList.toggle('hidden', !cart.length || Math.abs(diff) < 0.005);
    $('#change-label').textContent = diff > 0 ? 'الباقي للعميل' : 'متبقي على العميل';
    $('#change').innerHTML = money(Math.abs(diff));
    $('#checkout').disabled = !cart.length;
    const units = cart.reduce((n, l) => n + l.qty, 0);
    $('#cart-count').textContent = units;
    $('#cart-sum').innerHTML = cart.length ? moneyText(t.total) : '';
    $('#cart-toggle').classList.toggle('empty', !cart.length);
  }

  $('#lines').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-a]');
    if (!b) return;
    const i = Number(b.closest('.line').dataset.i);
    const l = cart[i];
    if (b.dataset.a === 'del') cart.splice(i, 1);
    if (b.dataset.a === 'inc') { if (l.qty < l.stock) l.qty++; else toast(`المتاح ${l.stock} بس`, 'err'); }
    if (b.dataset.a === 'dec') { l.qty--; if (l.qty < 1) cart.splice(i, 1); }
    draw();
  });
  $('#lines').addEventListener('change', (e) => {
    const inp = e.target.closest('input[data-a]');
    if (!inp) return;
    const l = cart[Number(inp.closest('.line').dataset.i)];
    if (inp.dataset.a === 'qty') l.qty = Math.max(1, Math.min(l.stock, parseInt(inp.value, 10) || 1));
    if (inp.dataset.a === 'price') l.unit_price = Math.max(0, Number(inp.value) || 0);
    draw();
  });
  $('#discount').addEventListener('input', draw);
  $('#paid').addEventListener('input', draw);
  $('#pay').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    pay = b.dataset.p;
    $('#pay').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  });
  $('#clear').addEventListener('click', () => { cart = []; $('#discount').value = 0; $('#paid').value = ''; draw(); focusScan(); });

  // ---------- checkout ----------
  async function checkout() {
    if (!cart.length) return;
    const t = totals();
    const body = {
      items: cart.map((l) => ({ product_id: l.product_id, qty: l.qty, unit_price: l.unit_price, serial: l.serial })),
      discount: t.disc,
      paid: $('#paid').value === '' ? undefined : Number($('#paid').value),
      payment_method: pay,
      customer_name: $('#cname').value,
      customer_phone: $('#cphone').value,
      notes: $('#notes').value,
    };
    await busy($('#checkout'), async () => {
      const sale = await api.post('/sales', body);
      cart = [];
      ['#discount', '#paid', '#cname', '#cphone', '#notes'].forEach((s) => { $(s).value = s === '#discount' ? 0 : ''; });
      draw();
      loadProducts().catch(() => {});
      openCart(false);
      await successModal(sale);
      focusScan();
    });
  }
  $('#checkout').addEventListener('click', checkout);

  const onKey = (e) => {
    if (e.key === 'F9') { e.preventDefault(); checkout(); }
  };
  document.addEventListener('keydown', onKey);

  draw();
  await loadProducts();
  focusScan();
  return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
}

function successModal(sale) {
  const change = sale.paid - sale.total;
  return modal({
    title: 'تم البيع',
    body: `<div class="success-hero"><div class="ic">${icon('check')}</div>
      <div class="muted">فاتورة رقم <b class="num" style="color:var(--ink)">${esc(sale.invoice_no)}</b></div>
      <div style="font-size:32px;font-weight:300;margin-top:6px">${money(sale.total)}</div>
      ${change > 0.004 ? `<div class="pill pill-ok" style="font-size:15px;margin-top:8px">الباقي للعميل: ${moneyText(change)}</div>` : ''}
      ${change < -0.004 ? `<div class="pill pill-warn" style="font-size:15px;margin-top:8px">متبقي على العميل: ${moneyText(-change)}</div>` : ''}
    </div>`,
    foot: `<button class="btn btn-outline" data-close>بيع جديد</button>
           <button class="btn btn-outline" data-print="a4">${icon('print')} A4</button>
           <button class="btn btn-primary" data-print="80mm" autofocus>${icon('print')} طباعة الفاتورة</button>`,
    onMount: (m, close) => {
      m.querySelectorAll('[data-print]').forEach((b) => b.addEventListener('click', async () => {
        await printInvoice(sale, b.dataset.print);
        close(true);
      }));
      setTimeout(() => m.querySelector(`[data-print="${state.settings.invoice_size === 'a4' ? 'a4' : '80mm'}"]`)?.focus(), 30);
    },
  });
}

function load() {
  try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch { return []; }
}
function save(cart) {
  try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch { /* ignore */ }
}
