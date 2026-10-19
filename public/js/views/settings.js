import { api, state, can, icon, esc, fmtDate, toast, busy, formData, emptyRow } from '../core.js';
import { LABEL_SIZES } from '../print.js';

const AUDIT_NAMES = {
  login: 'تسجيل دخول', 'password.change': 'تغيير كلمة السر', 'user.create': 'إضافة موظف', 'user.update': 'تعديل موظف',
  'settings.update': 'تعديل الإعدادات', 'backup.download': 'نسخة احتياطية', 'product.create': 'إضافة منتج',
  'product.price': 'تغيير سعر', 'product.deactivate': 'إيقاف منتج', 'sale.return': 'مرتجع',
  'stocktake.open': 'فتح جرد', 'stocktake.apply': 'تطبيق جرد',
};

export async function render(el) {
  const admin = can('settings.manage');
  const s = state.settings;

  el.innerHTML = `
    <div class="grid ${admin ? 'grid-2' : ''}" style="align-items:start">
      ${admin ? `
      <div class="card">
        <div class="card-head"><h2>بيانات المحل والفاتورة</h2></div>
        <form class="form-grid" id="shop" onsubmit="return false">
          <label class="field full"><span>اسم المحل</span><input class="input" name="shop_name" value="${esc(s.shop_name)}"></label>
          <label class="field full"><span>العنوان</span><input class="input" name="shop_address" value="${esc(s.shop_address)}"></label>
          <label class="field"><span>التليفون</span><input class="input ltr" name="shop_phone" value="${esc(s.shop_phone)}"></label>
          <label class="field"><span>العملة</span><input class="input" name="currency" value="${esc(s.currency)}"></label>
          <label class="field"><span>بادئة رقم الفاتورة</span><input class="input ltr" name="invoice_prefix" value="${esc(s.invoice_prefix)}"></label>
          <label class="field"><span>مقاس الفاتورة الافتراضي</span><select class="input" name="invoice_size">
            <option value="80mm" ${s.invoice_size === '80mm' ? 'selected' : ''}>طابعة كاشير 80 مم</option>
            <option value="a4" ${s.invoice_size === 'a4' ? 'selected' : ''}>ورقة A4</option></select></label>
          <label class="field full"><span>رسالة آخر الفاتورة (سياسة الاستبدال)</span><textarea class="input" name="invoice_footer" rows="2">${esc(s.invoice_footer)}</textarea></label>
          <label class="field"><span>مقاس الليبل الافتراضي</span><select class="input" name="label_size">
            ${Object.entries(LABEL_SIZES).map(([k, v]) => `<option value="${k}" ${s.label_size === k ? 'selected' : ''}>${v.name}</option>`).join('')}</select></label>
          <label class="field"><span>أقصى خصم للكاشير %</span><input class="input num" type="number" min="0" max="100" name="cashier_max_discount" value="${esc(s.cashier_max_discount)}"></label>
          <div class="full"><button class="btn btn-primary" id="save-shop">${icon('check')} حفظ الإعدادات</button></div>
        </form>
      </div>` : ''}

      <div class="stack">
        <div class="card">
          <div class="card-head"><h2>${icon('key', '')} تغيير كلمة السر</h2></div>
          <form class="form-grid" id="pw" onsubmit="return false">
            <label class="field full"><span>كلمة السر الحالية</span><input class="input ltr" type="password" name="current" autocomplete="current-password"></label>
            <label class="field"><span>الجديدة</span><input class="input ltr" type="password" name="password" autocomplete="new-password"></label>
            <label class="field"><span>تأكيد الجديدة</span><input class="input ltr" type="password" name="confirm" autocomplete="new-password"></label>
            <div class="full"><button class="btn btn-outline" id="save-pw">تغيير</button></div>
          </form>
        </div>
        ${can('backup') ? `
        <div class="card bg-periwinkle" style="box-shadow:none">
          <div class="card-head"><h2>${icon('download', '')} نسخة احتياطية</h2></div>
          <p style="margin-top:0">نزّل نسخة من قاعدة البيانات كلها (منتجات، فواتير، موظفين). <b>يُفضل كل يوم</b> على فلاشة أو Google Drive.</p>
          <a class="btn btn-primary" href="/api/backup" download>${icon('download')} تحميل نسخة الآن</a>
        </div>` : ''}
      </div>
    </div>
    ${can('audit.view') ? `
    <div class="card" style="margin-top:24px">
      <div class="card-head"><h2>${icon('history', '')} سجل العمليات</h2><span class="muted small">آخر 300 عملية</span></div>
      <div class="table-wrap" style="max-height:420px;overflow:auto"><table class="table">
        <thead><tr><th>الوقت</th><th>الموظف</th><th>العملية</th><th>تفاصيل</th></tr></thead><tbody id="audit"></tbody></table></div>
    </div>` : ''}`;

  el.querySelector('#save-shop')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
    state.settings = await api.put('/settings', formData(el.querySelector('#shop')));
    document.querySelector('.brand-name').firstChild.textContent = state.settings.shop_name;
    toast('تم حفظ الإعدادات', 'ok');
  }));

  el.querySelector('#save-pw').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const f = formData(el.querySelector('#pw'));
    if (f.password !== f.confirm) throw new Error('التأكيد مش مطابق لكلمة السر الجديدة');
    await api.post('/auth/password', { current: f.current, password: f.password });
    el.querySelector('#pw').reset();
    toast('تم تغيير كلمة السر', 'ok');
  }));

  if (can('audit.view')) {
    const rows = await api.get('/audit');
    el.querySelector('#audit').innerHTML = rows.length ? rows.map((r) => `<tr>
      <td class="small">${fmtDate(r.created_at)}</td><td>${esc(r.user_name || '')}</td>
      <td>${AUDIT_NAMES[r.action] || esc(r.action)}</td><td class="small muted num" style="direction:ltr;text-align:right">${esc(describe(r))}</td></tr>`).join('') : emptyRow(4);
  }
}

function describe(r) {
  if (!r.details) return '';
  try {
    const d = JSON.parse(r.details);
    if (r.action === 'product.price') return `#${d.id}: ${d.from} → ${d.to}`;
    return Object.entries(d).map(([k, v]) => `${k}: ${v}`).join(' · ');
  } catch { return r.details; }
}
