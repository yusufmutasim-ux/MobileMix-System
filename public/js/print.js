// Invoice and price-label printing. Everything is rendered into #print-root and printed with the browser.
import { esc, n, state, fmtDate, PAY_NAMES } from './core.js';

export const LABEL_SIZES = {
  '38x25': { w: 38, h: 25, name: '38 × 25 مم' },
  '40x30': { w: 40, h: 30, name: '40 × 30 مم' },
  '50x25': { w: 50, h: 25, name: '50 × 25 مم' },
  '58x40': { w: 58, h: 40, name: '58 × 40 مم' },
  a4: { w: 70, h: 37, name: 'ورقة A4 (24 ليبل)', sheet: true },
};

/** Draw a Code128 barcode (scalable SVG) with its digits printed underneath as normal text. */
export function barcodeSvg(value, { heightMm = 8, text = true, fontSize = 10 } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  try {
    window.JsBarcode(svg, String(value), { format: 'CODE128', width: 2, height: 60, margin: 0, displayValue: false, background: 'transparent' });
  } catch {
    return '';
  }
  const w = svg.getAttribute('width').replace('px', '');
  const h = svg.getAttribute('height').replace('px', '');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', `${heightMm}mm`);
  svg.setAttribute('class', 'bc');
  const digits = text ? `<div class="bc-text" style="font-size:${fontSize}px">${esc(value)}</div>` : '';
  return svg.outerHTML + digits;
}

function setPage(css) {
  let st = document.getElementById('page-style');
  if (!st) { st = document.createElement('style'); st.id = 'page-style'; document.head.append(st); }
  st.textContent = css;
}

async function doPrint(html, pageCss) {
  const root = document.getElementById('print-root');
  root.innerHTML = html;
  setPage(pageCss);
  try { await document.fonts.ready; } catch { /* ignore */ }
  await new Promise((r) => setTimeout(r, 60));
  window.print();
  setTimeout(() => { root.innerHTML = ''; }, 500);
}

// ---------------- Invoice ----------------
export function invoiceHtml(sale, size = state.settings.invoice_size || '80mm') {
  const s = state.settings;
  const a4 = size === 'a4';
  const cur = esc(s.currency || 'ج.م');
  const rows = sale.items.map((i) => `
    <tr>
      <td>${esc(i.name)}${i.serial ? `<br><span class="imei">IMEI: ${esc(i.serial)}</span>` : ''}
        ${i.returned_qty ? `<br><small>(مرتجع ${i.returned_qty})</small>` : ''}</td>
      <td class="e">${i.qty}</td>
      ${a4 ? `<td class="e">${n(i.unit_price)}</td>` : ''}
      <td class="e">${n(i.line_total)}</td>
    </tr>`).join('');

  const head = a4
    ? `<div class="head">
         <div><div class="shop">${esc(s.shop_name)}</div>${s.shop_address ? `<div>${esc(s.shop_address)}</div>` : ''}${s.shop_phone ? `<div>ت: ${esc(s.shop_phone)}</div>` : ''}</div>
         <div style="text-align:end"><div style="font-size:1.4em;font-weight:700">فاتورة بيع</div>
           <div>رقم: <b>${esc(sale.invoice_no)}</b></div><div>${fmtDate(sale.created_at)}</div></div>
       </div><hr>`
    : `<div class="c"><div class="shop">${esc(s.shop_name)}</div>
         ${s.shop_address ? `<div>${esc(s.shop_address)}</div>` : ''}${s.shop_phone ? `<div>ت: ${esc(s.shop_phone)}</div>` : ''}</div>
       <hr><div>فاتورة رقم: <b>${esc(sale.invoice_no)}</b></div><div>${fmtDate(sale.created_at)}</div>`;

  return `<div class="inv ${a4 ? 'inv-a4' : 'inv-80'}">
    ${head}
    <div>الكاشير: ${esc(sale.user_name)}</div>
    ${sale.customer_name || sale.customer_phone ? `<div>العميل: ${esc(sale.customer_name || '')} ${sale.customer_phone ? `— ${esc(sale.customer_phone)}` : ''}</div>` : ''}
    <hr>
    <table>
      <thead><tr><th>الصنف</th><th class="e">ك</th>${a4 ? '<th class="e">السعر</th>' : ''}<th class="e">الإجمالي</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <hr>
    <table>
      <tr><td>المجموع</td><td class="e">${n(sale.subtotal)} ${cur}</td></tr>
      ${sale.discount ? `<tr><td>الخصم</td><td class="e">- ${n(sale.discount)} ${cur}</td></tr>` : ''}
      <tr class="tot"><td>الإجمالي</td><td class="e">${n(sale.total)} ${cur}</td></tr>
      <tr><td>طريقة الدفع</td><td class="e">${esc(PAY_NAMES[sale.payment_method] || sale.payment_method)}</td></tr>
      ${sale.paid > sale.total ? `<tr><td>المدفوع</td><td class="e">${n(sale.paid)} ${cur}</td></tr><tr><td>الباقي للعميل</td><td class="e">${n(sale.paid - sale.total)} ${cur}</td></tr>` : ''}
      ${sale.paid < sale.total ? `<tr><td>المدفوع</td><td class="e">${n(sale.paid)} ${cur}</td></tr><tr><td><b>المتبقي على العميل</b></td><td class="e"><b>${n(sale.total - sale.paid)} ${cur}</b></td></tr>` : ''}
      ${sale.returned_total ? `<tr><td>مرتجعات</td><td class="e">- ${n(sale.returned_total)} ${cur}</td></tr>` : ''}
    </table>
    ${sale.notes ? `<hr><div>ملاحظات: ${esc(sale.notes)}</div>` : ''}
    <hr>
    <div class="c" style="margin:2mm auto;max-width:${a4 ? '70mm' : '60mm'}">${barcodeSvg(sale.invoice_no, { heightMm: 10 })}</div>
    ${s.invoice_footer ? `<div class="c">${esc(s.invoice_footer)}</div>` : ''}
  </div>`;
}

export function printInvoice(sale, size) {
  size = size || state.settings.invoice_size || '80mm';
  const page = size === 'a4' ? '@page { size: A4; margin: 10mm; }' : '@page { size: 80mm auto; margin: 0; }';
  return doPrint(invoiceHtml(sale, size), page);
}

// ---------------- Labels ----------------
export function labelHtml(p, sizeKey) {
  const sz = LABEL_SIZES[sizeKey] || LABEL_SIZES['38x25'];
  const small = sz.h <= 25;
  const nameSize = small ? 7.5 : 9;
  const priceSize = small ? 11 : sz.h >= 37 ? 16 : 13;
  const bcH = small ? 7 : sz.h >= 37 ? 12 : 9;
  return `<div class="label" style="width:${sz.w}mm;height:${sz.h}mm">
    <div class="l-shop">${esc(state.settings.shop_name || '')}</div>
    <div class="l-name" style="font-size:${nameSize}px">${esc(p.name)}</div>
    <div class="l-price" style="font-size:${priceSize}px">${n(p.sell_price)} ${esc(state.settings.currency || '')}</div>
    <div style="width:100%">${p.barcode ? barcodeSvg(p.barcode, { heightMm: bcH, fontSize: small ? 7 : 8 }) : ''}</div>
  </div>`;
}

/** items: [{ product, copies }] */
export function printLabels(items, sizeKey) {
  const sz = LABEL_SIZES[sizeKey] || LABEL_SIZES['38x25'];
  const labels = [];
  for (const { product, copies } of items) for (let i = 0; i < copies; i++) labels.push(labelHtml(product, sizeKey));
  if (sz.sheet) {
    return doPrint(`<div class="label-sheet">${labels.join('')}</div>`, '@page { size: A4; margin: 0; } .label-sheet { padding: 0 0 0 0; }');
  }
  return doPrint(labels.join(''), `@page { size: ${sz.w}mm ${sz.h}mm; margin: 0; }`);
}

// ---------------- Repairs ----------------
export const REPAIR_STATUS = {
  received: 'تم الاستلام', diagnosing: 'تحت الفحص', waiting_approval: 'مستني موافقة العميل', waiting_parts: 'مستني قطع غيار',
  repairing: 'جاري التصليح', ready: 'جاهز للتسليم', not_repaired: 'متصلحش — جاهز يترجع', delivered: 'اتسلم',
};

function addDays(dateStr, days) {
  const d = new Date(dateStr.replace(' ', 'T'));
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** kind: 'intake' (إيصال استلام) or 'delivery' (إيصال تسليم) */
export function repairReceiptHtml(r, kind = 'intake', size = state.settings.invoice_size || '80mm') {
  const s = state.settings;
  const a4 = size === 'a4';
  const cur = esc(s.currency || 'ج.م');
  const row = (label, value) => (value === null || value === undefined || value === '' ? '' : `<tr><td>${label}</td><td class="e">${value}</td></tr>`);
  const delivery = kind === 'delivery';
  const price = r.price ?? null;
  return `<div class="inv ${a4 ? 'inv-a4' : 'inv-80'}">
    <div class="c"><div class="shop">${esc(s.shop_name)}</div>
      ${s.shop_address ? `<div>${esc(s.shop_address)}</div>` : ''}${s.shop_phone ? `<div>ت: ${esc(s.shop_phone)}</div>` : ''}
      <div style="font-weight:700;font-size:1.2em;margin-top:2mm">${delivery ? 'إيصال تسليم جهاز' : 'إيصال استلام جهاز للصيانة'}</div></div>
    <hr>
    <table>
      ${row('رقم التذكرة', `<b>${esc(r.ticket_no)}</b>`)}
      ${row('تاريخ الاستلام', fmtDate(r.created_at))}
      ${delivery ? row('تاريخ التسليم', fmtDate(r.delivered_at)) : row('التسليم المتوقع', r.expected_at ? fmtDate(r.expected_at, false) : '')}
      ${row('العميل', esc(r.customer_name))}
      ${row('التليفون', `<span class="imei">${esc(r.customer_phone)}</span>`)}
      ${row('الجهاز', esc(r.device))}
      ${row('IMEI', r.imei ? `<span class="imei">${esc(r.imei)}</span>` : '')}
    </table>
    <hr>
    <div><b>العطل:</b> ${esc(r.problem)}</div>
    ${r.condition_notes ? `<div><b>حالة الجهاز:</b> ${esc(r.condition_notes)}</div>` : ''}
    ${r.accessories ? `<div><b>مستلم مع الجهاز:</b> ${esc(r.accessories)}</div>` : '<div><b>مستلم مع الجهاز:</b> الجهاز فقط</div>'}
    ${delivery && r.diagnosis ? `<div><b>اللي اتعمل:</b> ${esc(r.diagnosis)}</div>` : ''}
    ${delivery && r.parts?.length ? `<div><b>قطع الغيار:</b> ${r.parts.map((p) => `${esc(p.name)}${p.qty > 1 ? ` × ${p.qty}` : ''}`).join('، ')}</div>` : ''}
    <hr>
    <table>
      ${delivery || price != null ? row(delivery ? 'الحساب' : 'السعر', price != null ? `${n(price)} ${cur}` : '') : row('التكلفة المتوقعة', r.estimated_cost != null ? `${n(r.estimated_cost)} ${cur}` : 'بعد الفحص')}
      ${row('المدفوع', `${n(r.paid)} ${cur}`)}
      ${(price ?? r.estimated_cost) != null && r.balance > 0.004 ? `<tr class="tot"><td>${delivery ? 'متبقي على العميل' : 'الباقي عند الاستلام'}</td><td class="e">${n(r.balance)} ${cur}</td></tr>` : ''}
      ${delivery && r.outcome === 'repaired' && r.warranty_days ? row('الضمان', `${r.warranty_days} يوم — لحد ${addDays(r.delivered_at, r.warranty_days)}`) : ''}
      ${delivery && r.outcome === 'not_repaired' ? row('النتيجة', 'الجهاز اترجع بدون تصليح') : ''}
    </table>
    <hr>
    <div class="c" style="margin:2mm auto;max-width:${a4 ? '70mm' : '60mm'}">${barcodeSvg(r.ticket_no, { heightMm: 10 })}</div>
    ${!delivery && s.repair_terms ? `<div style="font-size:.85em">${esc(s.repair_terms)}</div>` : ''}
    ${!delivery ? '<div style="margin-top:6mm">توقيع العميل: ..............................</div><div class="c" style="margin-top:2mm">برجاء الاحتفاظ بالإيصال لاستلام الجهاز</div>' : ''}
    ${delivery && s.invoice_footer ? `<div class="c">${esc(s.invoice_footer)}</div>` : ''}
  </div>`;
}

export function printRepairReceipt(r, kind, size) {
  size = size || state.settings.invoice_size || '80mm';
  const page = size === 'a4' ? '@page { size: A4; margin: 10mm; }' : '@page { size: 80mm auto; margin: 0; }';
  return doPrint(repairReceiptHtml(r, kind, size), page);
}

/** Sticker that goes on the device itself, so it never gets mixed up on the bench. */
export function repairStickerHtml(r, sizeKey = state.settings.label_size || '38x25') {
  const sz = LABEL_SIZES[sizeKey] && !LABEL_SIZES[sizeKey].sheet ? LABEL_SIZES[sizeKey] : LABEL_SIZES['38x25'];
  const small = sz.h <= 25;
  return `<div class="label" style="width:${sz.w}mm;height:${sz.h}mm;align-items:stretch">
    <div style="display:flex;justify-content:space-between;font-size:${small ? 7.5 : 9}px;font-weight:700">
      <span>${esc(r.ticket_no)}</span><span class="num">${fmtDate(r.created_at, false)}</span></div>
    <div class="l-name" style="font-size:${small ? 7.5 : 9}px">${esc(r.customer_name)} — <span class="num">${esc(r.customer_phone)}</span></div>
    <div class="l-name" style="font-size:${small ? 7 : 8.5}px;-webkit-line-clamp:1">${esc(r.device)}: ${esc(r.problem)}</div>
    <div style="width:100%">${barcodeSvg(r.ticket_no, { heightMm: small ? 6 : 9, text: false })}</div>
  </div>`;
}

export function printRepairSticker(r, sizeKey) {
  sizeKey = LABEL_SIZES[sizeKey] && !LABEL_SIZES[sizeKey].sheet ? sizeKey : (LABEL_SIZES[state.settings.label_size]?.sheet ? '38x25' : state.settings.label_size || '38x25');
  const sz = LABEL_SIZES[sizeKey];
  return doPrint(repairStickerHtml(r, sizeKey), `@page { size: ${sz.w}mm ${sz.h}mm; margin: 0; }`);
}
