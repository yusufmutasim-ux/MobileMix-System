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
