import { api, state, can, icon, esc, fmtDate, toast, busy, formData, emptyRow, modal } from '../core.js';
import { LABEL_SIZES, printSettings } from '../print.js';
import { pushSupported, pushHint, subscribePush, unsubscribePush, getPosition, locationPermission, locationHelp } from '../live.js';

const AUDIT_NAMES = {
  login: 'تسجيل دخول', 'password.change': 'تغيير كلمة السر', 'user.create': 'إضافة موظف', 'user.update': 'تعديل موظف',
  'settings.update': 'تعديل الإعدادات', 'backup.download': 'نسخة احتياطية', 'product.create': 'إضافة منتج',
  'product.price': 'تغيير سعر', 'product.deactivate': 'إيقاف منتج', 'sale.return': 'مرتجع',
  'stocktake.open': 'فتح جرد', 'stocktake.apply': 'تطبيق جرد', 'repair.create': 'استلام صيانة', 'repair.deliver': 'تسليم صيانة', 'logout.others': 'خروج من الأجهزة التانية', 'shift.close': 'إنهاء شيفت موظف', 'zone.network': 'تسجيل إنترنت المحل', 'shift.denied': 'محاولة حضور مرفوضة', 'data.reset': 'مسح البيانات', 'data.restore': 'استرجاع نسخة', 'backup.auto': 'نسخة احتياطية',
};

export async function render(el, { query } = {}) {
  const admin = can('settings.manage');
  const s = state.settings;

  const sel = (name, value, opts) => `<select class="input" name="${name}">${opts.map(([v, t]) => `<option value="${v}" ${value === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
  const saveBtn = `<div class="full"><button class="btn btn-primary save-settings">${icon('check')} حفظ</button></div>`;

  // Each section: id, menu label, icon, one-line description, and its content (empty = hidden for this user)
  const SECTIONS = [
    { id: 'shop', label: 'المحل والفواتير', icon: 'home', desc: 'اسم المحل وبياناته، والفاتورة والليبل', html: admin ? `
      <div class="card">
        <div class="card-head"><h2>${icon('home')} بيانات المحل</h2></div>
        <form class="form-grid settings-form" onsubmit="return false">
          <label class="field full"><span>اسم المحل</span><input class="input" name="shop_name" value="${esc(s.shop_name)}"></label>
          <label class="field full"><span>العنوان</span><input class="input" name="shop_address" value="${esc(s.shop_address)}"></label>
          <label class="field"><span>التليفون</span><input class="input ltr" name="shop_phone" value="${esc(s.shop_phone)}"></label>
          <label class="field"><span>العملة</span><input class="input" name="currency" value="${esc(s.currency)}"></label>
          ${saveBtn}
        </form>
      </div>
      <div class="card">
        <div class="card-head"><h2>${icon('receipt')} الفاتورة والليبل</h2></div>
        <form class="form-grid settings-form" onsubmit="return false">
          <label class="field"><span>بادئة رقم الفاتورة</span><input class="input ltr" name="invoice_prefix" value="${esc(s.invoice_prefix)}"></label>
          <label class="field"><span>مقاس الفاتورة</span>${sel('invoice_size', s.invoice_size, [['80mm', 'طابعة كاشير 80 مم'], ['a4', 'ورقة A4']])}</label>
          <label class="field full"><span>رسالة آخر الفاتورة (سياسة الاستبدال)</span><textarea class="input" name="invoice_footer" rows="2">${esc(s.invoice_footer)}</textarea></label>
          <label class="field"><span>مقاس الليبل</span><select class="input" name="label_size">
            ${Object.entries(LABEL_SIZES).map(([k, v]) => `<option value="${k}" ${s.label_size === k ? 'selected' : ''}>${v.name}</option>`).join('')}</select></label>
          <div></div>
          ${saveBtn}
        </form>
      </div>` : '' },

    { id: 'sales', label: 'البيع والصيانة', icon: 'cart', desc: 'الخصم، تذاكر الصيانة، وأنواع المصروفات', html: admin ? `
      <div class="card">
        <div class="card-head"><h2>${icon('cart')} البيع</h2></div>
        <form class="form-grid settings-form" onsubmit="return false">
          <label class="field"><span>أقصى خصم للكاشير %</span><input class="input num" type="number" min="0" max="100" name="cashier_max_discount" value="${esc(s.cashier_max_discount)}"></label>
          <p class="muted small" style="margin:0;align-self:end">الكاشير مش هيقدر يدّي خصم أكبر من كده من غير المدير.</p>
          ${saveBtn}
        </form>
      </div>
      <div class="card">
        <div class="card-head"><h2>${icon('wrench')} الصيانة</h2></div>
        <form class="form-grid settings-form" onsubmit="return false">
          <label class="field"><span>بادئة تذكرة الصيانة</span><input class="input ltr" name="repair_prefix" value="${esc(s.repair_prefix)}"></label>
          <div></div>
          <label class="field full"><span>شروط الصيانة (بتتطبع على إيصال الاستلام)</span><textarea class="input" name="repair_terms" rows="3">${esc(s.repair_terms)}</textarea></label>
          ${saveBtn}
        </form>
      </div>
      <div class="card">
        <div class="card-head"><h2>${icon('expense')} أنواع المصروفات</h2></div>
        <form class="form-grid settings-form" onsubmit="return false">
          <label class="field full"><span>كل نوع في سطر</span><textarea class="input" name="expense_categories" rows="6">${esc(s.expense_categories || '')}</textarea></label>
          ${saveBtn}
        </form>
      </div>` : '' },

    { id: 'staff', label: 'الموظفين والحضور', icon: 'clock', desc: 'مواعيد الشيفتات، قواعد الحضور، وموقع المحل', html: `
      ${admin ? `<div class="card">
        <div class="card-head"><h2>${icon('clock')} تسجيل الحضور</h2></div>
        <form class="form-grid settings-form" onsubmit="return false">
          <label class="field full"><span>الحضور والانصراف</span>${sel('require_shift', ['1', '2'].includes(s.require_shift) ? s.require_shift : '0', [
            ['0', 'اختياري — الموظف يسجل حضور لو حب'],
            ['1', 'إجباري للبيع — مينفعش يبيع أو يستلم جهاز من غير حضور'],
            ['2', 'إجباري لكل حاجة — السيستم مقفول للموظف لحد ما يسجل حضور']])}</label>
          ${saveBtn}
        </form>
      </div>` : ''}
      ${can('users.manage') ? '<div class="card" id="sched-card"><div class="empty">…</div></div>' : ''}
      ${admin ? '<div class="card" id="zone-card"><div class="empty">…</div></div>' : ''}
      <div class="card" id="loc-test">
        <div class="card-head"><h2>📍 اختبار الموقع</h2></div>
        <p class="muted" style="margin-top:0">اعرف الموبايل ده هيقدر يسجل حضور من المحل ولا لأ، وليه.</p>
        <button class="btn btn-outline" id="loc-test-btn">📍 اختبر موقعي</button>
        <div id="loc-test-out" style="margin-top:12px"></div>
      </div>` },

    { id: 'notify', label: 'الإشعارات', icon: 'bell', desc: 'إشعارات الموبايل، ملخص اليوم، وتذكير الأقساط', html: `
      ${can('notifications.receive') ? '<div class="card" id="notif-card"><div class="empty">…</div></div>' : ''}
      ${admin ? `<div class="card">
        <div class="card-head"><h2>${icon('calendar')} تذكيرات تلقائية</h2></div>
        <form class="form-grid settings-form" onsubmit="return false">
          <label class="field"><span>ملخص اليوم على الموبايل</span>${sel('daily_summary', s.daily_summary === '0' ? '0' : '1', [['1', 'يتبعت كل يوم'], ['0', 'مقفول']])}</label>
          <label class="field"><span>الساعة كام؟</span><input class="input num" type="time" name="daily_summary_time" value="${esc(s.daily_summary_time || '23:00')}"></label>
          <label class="field full"><span>تذكير الأقساط المتأخرة (الساعة 10 الصبح)</span>${sel('installment_reminders', s.installment_reminders === '0' ? '0' : '1', [['1', 'شغال'], ['0', 'مقفول']])}</label>
          ${saveBtn}
        </form>
      </div>` : ''}` },

    { id: 'print', label: 'الطباعة', icon: 'print', desc: 'الطباعة من الموبايل على طابعة الكمبيوتر', html: '<div class="card" id="print-card"><div class="empty">…</div></div>' },
    { id: 'account', label: 'حسابي', icon: 'key', desc: 'كلمة السر والأجهزة المتصلة', html: `
      <div class="card">
        <div class="card-head"><h2>${icon('key', '')} تغيير كلمة السر</h2></div>
        <form class="form-grid" id="pw" onsubmit="return false">
          <label class="field full"><span>كلمة السر الحالية</span><input class="input ltr" type="password" name="current" autocomplete="current-password"></label>
          <label class="field"><span>الجديدة</span><input class="input ltr" type="password" name="password" autocomplete="new-password"></label>
          <label class="field"><span>تأكيد الجديدة</span><input class="input ltr" type="password" name="confirm" autocomplete="new-password"></label>
          <div class="full"><button class="btn btn-primary" id="save-pw">${icon('check')} تغيير</button></div>
        </form>
      </div>
      <div class="card">
        <div class="card-head"><h2>${icon('logout', '')} الأجهزة المتصلة</h2></div>
        <p class="muted" style="margin-top:0">لو موبايلك ضاع أو دخلت من جهاز مش بتاعك، اقفل حسابك على كل الأجهزة التانية.</p>
        <button class="btn btn-outline" id="logout-others">تسجيل خروج من كل الأجهزة التانية</button>
      </div>` },

    { id: 'data', label: 'النسخ الاحتياطي والبيانات', icon: 'download', desc: 'النسخ التلقائية، الاسترجاع، الدخول من برة، والبدء من جديد', html: `
      ${can('backup') ? `
      <div class="card">
        <div class="card-head"><h2>${icon('download', '')} النسخ الاحتياطي</h2></div>
        <p style="margin-top:0">السيستم بياخد <b>نسخة تلقائية كل يوم</b>. لو حطيت فولدر Google Drive أو OneDrive اللي على جهاز المحل، النسخ بتتحفظ أونلاين كمان.</p>
        <div id="backups" class="small muted" style="margin-bottom:12px">…</div>
        ${admin ? `<form class="form-grid" id="bk" onsubmit="return false" style="margin-bottom:12px">
          <label class="field full"><span>فولدر النسخ (سيبه فاضي = data/backups)</span><input class="input ltr" name="backup_dir" value="${esc(s.backup_dir)}" placeholder="C:\\Users\\Shop\\Google Drive\\MobileMix"></label>
          <label class="field"><span>عدد النسخ اللي تفضل</span><input class="input num" type="number" min="1" name="backup_keep" value="${esc(s.backup_keep)}"></label>
          <div class="field" style="justify-content:flex-end"><button class="btn btn-outline" id="save-bk">حفظ</button></div>
        </form>` : ''}
        <div class="btn-row">
          <button class="btn btn-outline" id="backup-now">${icon('check')} نسخة دلوقتي</button>
          <a class="btn btn-primary" href="/api/backup" download>${icon('download')} تحميل نسخة على الجهاز ده</a>
        </div>
      </div>` : ''}
      ${admin ? '<div class="card" id="remote"><div class="empty">…</div></div>' : ''}
      ${can('data.reset') ? `
      <div class="card" id="danger-card" style="border:1px solid var(--danger-wash)">
        <div class="card-head"><h2>🧹 البدء من جديد</h2></div>
        <p style="margin-top:0">خلصت تجربة؟ امسح البيانات الوهمية (منتجات، فواتير، صيانة، حضور…) وابدأ على نضيف.
          <b>الموظفين وإعدادات المحل مش بيتمسحوا</b>، والسيستم بياخد نسخة احتياطية قبل المسح عشان تقدر ترجّعها.</p>
        <button class="btn btn-danger" id="reset-btn">🧹 مسح البيانات والبدء من جديد</button>
        <div class="section-title">💾 النسخ الاحتياطية (تقدر ترجّع أي واحدة)</div>
        <div id="backup-list"><div class="muted small">…</div></div>
      </div>` : ''}` },

    { id: 'log', label: 'سجل العمليات', icon: 'history', desc: 'مين عمل إيه وإمتى', html: can('audit.view') ? `
      <div class="card">
        <div class="card-head"><h2>${icon('history', '')} سجل العمليات</h2><span class="muted small">آخر 300 عملية</span></div>
        <div class="table-wrap" style="max-height:620px;overflow:auto"><table class="table">
          <thead><tr><th>الوقت</th><th>الموظف</th><th>العملية</th><th>تفاصيل</th></tr></thead><tbody id="audit"></tbody></table></div>
      </div>` : '' },
  ].filter((x) => x.html.replace(/\s/g, ''));

  let tab = query?.get('tab');
  try { tab ||= localStorage.getItem('mm_settings_tab'); } catch { /* ignore */ }
  if (!SECTIONS.some((x) => x.id === tab)) tab = SECTIONS[0].id;

  el.innerHTML = `
    <div class="settings-layout">
      <nav class="settings-nav" aria-label="أقسام الإعدادات">
        ${SECTIONS.map((x) => `<button type="button" data-tab="${x.id}" class="${x.id === tab ? 'on' : ''}">${icon(x.icon)}<span><b>${x.label}</b><small>${x.desc}</small></span></button>`).join('')}
      </nav>
      <div class="settings-panes">
        ${SECTIONS.map((x) => `<section class="settings-pane ${x.id === tab ? '' : 'hidden'}" data-pane="${x.id}">
          <div class="pane-head"><h2>${x.label}</h2><p class="muted">${x.desc}</p></div>
          ${x.html}
        </section>`).join('')}
      </div>
    </div>`;

  const showTab = (id) => {
    tab = id;
    el.querySelectorAll('.settings-nav [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === id));
    el.querySelectorAll('.settings-pane').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== id));
    try { localStorage.setItem('mm_settings_tab', id); } catch { /* ignore */ }
    history.replaceState(null, '', `#/settings?tab=${id}`);
    el.querySelector(`.settings-nav [data-tab="${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    if (matchMedia('(max-width: 860px)').matches) window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  el.querySelector('.settings-nav').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });

  // Every small settings form saves just its own fields
  el.querySelectorAll('.settings-form .save-settings').forEach((btn) => btn.addEventListener('click', (e) => busy(e.currentTarget, async () => {
    state.settings = await api.put('/settings', formData(btn.closest('form')));
    const sub = document.querySelector('.brand-sub');
    if (sub) sub.textContent = state.settings.shop_name && state.settings.shop_name !== 'Mobile Mix' ? state.settings.shop_name : 'نظام المبيعات والصيانة';
    toast('تم الحفظ', 'ok');
  })));


  async function loadNotif() {
    const card = el.querySelector('#notif-card');
    if (!card) return;
    const p = await api.get('/notifications/prefs');
    const here = localStorage.getItem('mm_push') === '1' && pushSupported() && Notification.permission === 'granted';
    card.innerHTML = `
      <div class="card-head"><h2>${icon('bell', '')} الإشعارات</h2>${here ? '<span class="pill pill-ok">مفعّلة على الجهاز ده</span>' : ''}</div>
      <p class="muted" style="margin-top:0">ابعتلي إشعار لما:</p>
      <div class="toggle-chips" id="ntypes">${Object.entries(p.types).map(([k, v]) => `<button type="button" data-t="${k}" class="${p.enabled.includes(k) ? 'on' : ''}">${v}</button>`).join('')}</div>
      <div style="margin-top:16px">${here
        ? `<div class="btn-row"><button class="btn btn-outline btn-sm" id="push-test">${icon('bell')} إشعار تجربة</button>
             <button class="btn btn-ghost btn-sm" id="push-off">إيقاف على الجهاز ده</button></div>`
        : `<div class="card bg-periwinkle" style="box-shadow:none;padding:14px 16px">${pushHint()}</div>`}</div>
      <p class="small muted" style="margin-bottom:0">الأجهزة المفعّل عليها: ${p.devices.length}. فعّلها على كل موبايل أو كمبيوتر عايز يوصلك عليه.</p>`;
    card.querySelector('#ntypes').addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      b.classList.toggle('on');
      const enabled = [...card.querySelectorAll('#ntypes .on')].map((x) => x.dataset.t);
      await api.put('/notifications/prefs', { enabled }).catch(toastErrLocal);
    });
    card.querySelector('#enable-push')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
      await subscribePush(true);
      toast('تم تفعيل الإشعارات على الجهاز ده ✅', 'ok');
      loadNotif();
    }));
    card.querySelector('#push-test')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const r = await api.post('/push/test');
      toast(`اتبعت إشعار تجربة لـ ${r.sent} جهاز`, 'ok');
    }));
    card.querySelector('#push-off')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
      await unsubscribePush();
      toast('اتوقفت الإشعارات على الجهاز ده');
      loadNotif();
    }));
  }
  const toastErrLocal = (e) => toast(e.message, 'err');

  // ---------- shop zone for check in / out ----------
  async function loadZone() {
    const card = el.querySelector('#zone-card');
    if (!card) return;
    const st = await api.get('/settings');
    const net = await api.get('/shifts/zone/network').catch(() => ({ ip: '', saved: [], here: false }));
    const hasLoc = st.shop_lat !== '' && st.shop_lng !== '';
    const cloud = state.hosting?.cloud;
    card.innerHTML = `
      <div class="card-head"><h2>${icon('phone', '')} الحضور من المحل بس</h2>
        ${st.attendance_zone === '1' ? '<span class="pill pill-ok">مفعّل</span>' : '<span class="pill pill-gray">مش مفعّل</span>'}</div>
      <p class="muted" style="margin-top:0">لما يتفعّل، الموظف ميقدرش يسجل حضور أو انصراف غير وهو جوه المحل (بالـ GPS بتاع موبايله، أو لو متصل بإنترنت المحل). إنت كمدير مستثنى.</p>
      <p class="small muted" style="margin-top:-6px">ℹ️ الموظف هيظهرله طلب سماح <b>للموقع</b> بس — الواي فاي مالوش طلب، السيستم بيعرف إنه على إنترنت المحل لوحده.</p>
      <div class="form-grid">
        <label class="field full"><span>قفل السيستم</span><select class="input" id="z-lock">
          <option value="0" ${st.require_shift !== '2' ? 'selected' : ''}>الموظف يشوف السيستم عادي</option>
          <option value="2" ${st.require_shift === '2' ? 'selected' : ''}>🔒 السيستم مقفول للموظف لحد ما يسجل حضور</option></select></label>
        <label class="field full"><span>تسجيل الحضور</span><select class="input" id="z-on">
          <option value="0" ${st.attendance_zone !== '1' ? 'selected' : ''}>من أي مكان</option>
          <option value="1" ${st.attendance_zone === '1' ? 'selected' : ''}>من جوه المحل بس</option></select></label>
        <div class="field full"><span>1. موقع المحل</span>
          <div class="btn-row">
            <button class="btn btn-outline btn-sm" id="z-here">📍 حدد موقع المحل من مكاني دلوقتي</button>
            ${hasLoc ? `<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${encodeURIComponent(st.shop_lat)},${encodeURIComponent(st.shop_lng)}">شوفه على الخريطة</a>` : ''}
          </div>
          <span class="small ${hasLoc ? 'muted' : ''}" style="${hasLoc ? '' : 'color:var(--danger)'}">${hasLoc
            ? `متسجل ✓ <bdi class="num">${Number(st.shop_lat).toFixed(5)}, ${Number(st.shop_lng).toFixed(5)}</bdi>`
            : 'لسه متحددش — اعمل كده وإنت واقف جوه المحل بالموبايل'}</span></div>
        <label class="field"><span>2. المسافة المسموحة (متر)</span><input class="input num" type="number" min="20" max="2000" id="z-radius" value="${esc(st.zone_radius || '100')}"></label>
        <div class="field" style="justify-content:flex-end"><span class="small muted">100 متر مناسبة لأغلب المحلات. زودها لو الـ GPS عندكم ضعيف.</span></div>
        <div class="field full"><span>3. إنترنت المحل (للكمبيوترات اللي مفيهاش GPS)</span>
          ${cloud ? `
            <div class="btn-row">${net.here
              ? '<span class="pill pill-ok">الجهاز ده على إنترنت المحل ✓</span>'
              : '<button class="btn btn-outline btn-sm" id="z-net">📶 الإنترنت اللي أنا عليه دلوقتي هو إنترنت المحل</button>'}</div>
            ${net.saved.length ? `<div class="chips" style="margin-top:6px">${net.saved.map((ip) => `<span class="chip">${esc(ip)}<button data-rm="${esc(ip)}" title="شيل">×</button></span>`).join('')}</div>` : ''}
            <span class="small muted">اعمل كده من جهاز متصل بواي فاي المحل. لو شركة النت غيّرت العنوان، اعملها تاني.</span>`
            : '<span class="small muted">السيستم شغال على جهاز المحل، فأي جهاز متصل بواي فاي المحل بيتحسب جوه المحل تلقائي.</span>'}
        </div>
        <div class="full"><button class="btn btn-primary btn-sm" id="z-save">${icon('check')} حفظ</button></div>
      </div>`;

    card.querySelector('#z-here').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const p = await getPosition();
      if (p.accuracy > 100 && !confirm(`دقة الموقع ${p.accuracy} متر بس — الأحسن تجرب جنب الشباك. تحفظه برضو؟`)) return;
      state.settings = await api.put('/settings', { shop_lat: String(p.lat), shop_lng: String(p.lng) });
      toast(`تم حفظ موقع المحل (دقة ${p.accuracy} متر) 📍`, 'ok');
      loadZone();
    }));
    card.querySelector('#z-net')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
      await api.post('/shifts/zone/network');
      toast('تم — الأجهزة اللي على إنترنت المحل هتتحسب جوه المحل', 'ok');
      loadZone();
    }));
    card.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => {
      await api.post('/shifts/zone/network', { remove: b.dataset.rm }).catch(toastErrLocal);
      loadZone();
    }));
    card.querySelector('#z-save').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const on = card.querySelector('#z-on').value;
      if (on === '1' && !hasLoc && !net.saved.length && cloud) throw new Error('حدد موقع المحل الأول (خطوة 1)');
      const lock = card.querySelector('#z-lock').value;
      state.settings = await api.put('/settings', {
        attendance_zone: on, zone_radius: card.querySelector('#z-radius').value,
        ...(lock === '2' || st.require_shift === '2' ? { require_shift: lock } : {}),
      });
      toast('تم الحفظ', 'ok');
      loadZone();
    }));
  }
  loadZone().catch(toastErrLocal);
  loadSchedules().catch(toastErrLocal);
  const pc = el.querySelector('#print-card');
  if (pc) printSettings(pc).catch(toastErrLocal);

  // ---------- shift schedules: from – to and work days for each employee ----------
  async function loadSchedules() {
    const card = el.querySelector('#sched-card');
    if (!card) return;
    const [users, st] = await Promise.all([api.get('/users'), api.get('/settings')]);
    const staff = users.filter((u) => u.active && u.role !== 'admin');
    const DAYS = [['6', 'السبت'], ['0', 'الأحد'], ['1', 'الاتنين'], ['2', 'التلات'], ['3', 'الأربع'], ['4', 'الخميس'], ['5', 'الجمعة']];
    card.innerHTML = `
      <div class="card-head"><h2>${icon('clock')} مواعيد الشيفتات</h2>
        <span class="muted small">السيستم بيعلّم اللي اتأخر أو مشي بدري، ويبلغك لو حد شيفته بدأ ولسه مجاش</span></div>
      <div class="sched-list">${staff.length ? staff.map((u) => `
        <div class="sched-row" data-id="${u.id}">
          <div class="sched-who"><span class="avatar">${esc(u.full_name.trim()[0] || '?')}</span><b>${esc(u.full_name)}</b></div>
          <label class="sched-time"><span>من</span><input class="input num" type="time" data-f="start" value="${esc(u.shift_start || '')}"></label>
          <label class="sched-time"><span>لحد</span><input class="input num" type="time" data-f="end" value="${esc(u.shift_end || '')}"></label>
          <div class="toggle-chips sched-days">${DAYS.map(([d, name]) => `<button type="button" data-d="${d}" class="${String(u.work_days ?? '0123456').includes(d) ? 'on' : ''}">${name}</button>`).join('')}</div>
          <button class="btn btn-outline btn-sm" data-save>${icon('check')} حفظ</button>
        </div>`).join('') : '<div class="empty">ضيف موظفين الأول من صفحة الموظفين</div>'}</div>
      <div class="sched-rules">
        <label class="field"><span>سماحية التأخير (بالدقايق)</span><input class="input num" type="number" min="0" max="120" id="grace" value="${esc(st.late_grace ?? '10')}"></label>
        <label class="field"><span>لو حد شيفته بدأ ومسجلش حضور</span><select class="input" id="absence">
          <option value="1" ${st.absence_alert !== '0' ? 'selected' : ''}>ابعتلي إشعار</option><option value="0" ${st.absence_alert === '0' ? 'selected' : ''}>من غير إشعار</option></select></label>
        <button class="btn btn-outline btn-sm" id="save-rules">${icon('check')} حفظ</button>
        <p class="muted small" style="margin:0;flex-basis:100%">سيب الميعاد فاضي للموظف اللي مالوش شيفت ثابت. الشيفت اللي بيعدّي نص الليل (زي 6 م لحد 2 ص) شغال عادي.</p>
      </div>`;
    card.querySelectorAll('.sched-days').forEach((g) => g.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) b.classList.toggle('on');
    }));
    card.querySelectorAll('[data-save]').forEach((b) => b.addEventListener('click', () => busy(b, async () => {
      const row = b.closest('.sched-row');
      await api.put(`/users/${row.dataset.id}/schedule`, {
        shift_start: row.querySelector('[data-f=start]').value,
        shift_end: row.querySelector('[data-f=end]').value,
        work_days: [...row.querySelectorAll('.sched-days .on')].map((x) => x.dataset.d).join(''),
      });
      toast('اتحفظ الشيفت', 'ok');
    })));
    card.querySelector('#save-rules').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      state.settings = await api.put('/settings', { late_grace: card.querySelector('#grace').value, absence_alert: card.querySelector('#absence').value });
      toast('تم الحفظ', 'ok');
    }));
  }

  // ---------- location test (any employee) ----------
  el.querySelector('#loc-test-btn').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const out = el.querySelector('#loc-test-out');
    const PERM = { granted: '✅ مسموح', prompt: '❔ لسه هيسألك', denied: '⛔ ممنوع', unknown: '❔ مش معروف' };
    const before = await locationPermission();
    out.innerHTML = '<div class="muted">📍 بنحدد موقعك… لو Chrome سألك دوس <b>سماح / Allow</b></div>';
    let pos = null, posErr = null;
    try { pos = await getPosition(); } catch (err) { posErr = err; }
    const after = await locationPermission();
    const t = await api.post('/shifts/zone/test', pos || {});
    const row = (k, v) => `<tr><td class="muted" style="width:45%">${k}</td><td>${v}</td></tr>`;
    out.innerHTML = `
      <table class="table" style="margin:0"><tbody>
        ${row('إذن الموقع في المتصفح', `${PERM[after] || after}${before !== after ? ` <span class="small muted">(كان: ${PERM[before] || before})</span>` : ''}`)}
        ${row('شرط الحضور من المحل', t.zone_on ? 'مفعّل' : '<b>مقفول</b> — الحضور مسموح من أي مكان')}
        ${t.exempt ? row('حسابك', 'مدير — مستثنى من الشرط') : ''}
        ${row('موقع المحل', t.shop_set ? 'متحدد ✓' : '<b style="color:var(--danger)">مش متحدد</b>')}
        ${pos ? row('موقعك', `دقة <b class="num">${pos.accuracy}</b> متر`) : row('موقعك', `<span style="color:var(--danger)">${esc(posErr?.message || 'مش متاح')}</span>`)}
        ${t.distance != null ? row('المسافة من المحل', `<b class="num">${t.distance}</b> متر (المسموح <span class="num">${t.radius}</span>)`) : ''}
        ${t.method === 'wifi' ? row('الشبكة', '📶 متصل بإنترنت المحل') : ''}
      </tbody></table>
      <div class="card ${t.ok ? 'bg-mint' : 'bg-peony'}" style="box-shadow:none;padding:12px 14px;margin-top:10px">
        ${t.ok ? '✅ <b>تمام — تقدر تسجل حضور وانصراف من المكان ده.</b>' : `❌ <b>${esc(t.error)}</b>`}
      </div>
      ${posErr && !t.ok ? `<div class="card bg-periwinkle" style="box-shadow:none;padding:12px 14px;margin-top:10px">${locationHelp(posErr)}</div>` : ''}`;
  }));
  loadNotif().catch(toastErrLocal);

  // ---------- start over / restore ----------
  async function loadBackups() {
    const box = el.querySelector('#backup-list');
    if (!box) return;
    const list = await api.get('/system/backups');
    const KIND = { reset: '<span class="pill pill-warn">قبل المسح</span>', restore: '<span class="pill pill-info">قبل الاسترجاع</span>', daily: '<span class="pill pill-gray">يومية</span>' };
    box.innerHTML = list.length ? `<table class="table backup-table"><tbody>${list.slice(0, 15).map((b) => `<tr>
        <td class="small">${fmtDate(b.at)}</td><td>${KIND[b.kind]}</td><td class="small muted num">${(b.size / 1024 / 1024).toFixed(1)} MB</td>
        <td class="end" style="white-space:nowrap">
          <a class="btn btn-ghost btn-sm" href="/api/system/backups/${encodeURIComponent(b.file)}" download title="تحميل">${icon('download')}</a>
          <button class="btn btn-outline btn-sm" data-restore="${esc(b.file)}" data-at="${esc(b.at)}">↩️ رجّعها</button></td></tr>`).join('')}</tbody></table>`
      : '<div class="muted small">لسه مفيش نسخ</div>';
    box.querySelectorAll('[data-restore]').forEach((btn) => btn.addEventListener('click', () => restoreModal(btn.dataset.restore, btn.dataset.at)));
  }

  function restoreModal(file, at) {
    modal({
      title: '↩️ استرجاع نسخة احتياطية',
      body: `<p style="margin-top:0">كل البيانات هترجع زي ما كانت يوم <b>${fmtDate(at)}</b> (منتجات، فواتير، صيانة، موظفين، إعدادات).</p>
        <p class="small muted">البيانات اللي موجودة دلوقتي هتتحفظ في نسخة الأول، فتقدر ترجعلها لو غيرت رأيك.</p>
        <label class="field"><span>كلمة السر بتاعتك</span><input class="input ltr" type="password" id="rs-pw" autocomplete="current-password"></label>`,
      foot: '<button class="btn btn-outline" data-close>إلغاء</button><button class="btn btn-primary" data-ok>↩️ استرجاع</button>',
      onMount: (m, close) => m.querySelector('[data-ok]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        await api.post('/system/restore', { file, password: m.querySelector('#rs-pw').value });
        close(true);
        toast('تم الاسترجاع ✅', 'ok');
        setTimeout(() => location.reload(), 900);
      })),
    });
  }

  el.querySelector('#reset-btn')?.addEventListener('click', async () => {
    const c = await api.get('/system/data-counts');
    const PARTS = [
      ['sales', 'الفواتير والمرتجعات والأقساط', c.sales, true],
      ['customers', 'العملاء', c.customers, true],
      ['money', 'المصروفات وتقفيلات الدرج', c.money, true],
      ['purchases', 'فواتير الشراء والموردين', c.purchases, true],
      ['repairs', 'تذاكر الصيانة', c.repairs, true],
      ['products', 'المنتجات والمخزن والجرد', c.products, true],
      ['attendance', 'الحضور والانصراف', c.attendance, true],
      ['log', 'الإشعارات وسجل العمليات', c.log, true],
      ['categories', 'الأقسام (موبايلات، إكسسوارات…)', c.categories, false],
    ];
    modal({
      title: '🧹 مسح البيانات والبدء من جديد',
      body: `<p style="margin-top:0">اختار اللي عايز تمسحه:</p>
        <div class="reset-parts">${PARTS.map(([k, label, n, on]) => `
          <label class="check"><input type="checkbox" data-part="${k}" ${on ? 'checked' : ''}> ${label} <span class="muted small">(${n})</span></label>`).join('')}</div>
        <div class="card bg-mint" style="box-shadow:none;padding:10px 14px;margin:12px 0">✅ مش هيتمسح: <b>الموظفين (${c.users})</b>، إعدادات المحل، موقع المحل، والإشعارات المفعّلة على الموبايلات.</div>
        <p class="small muted" style="margin:0 0 12px">💾 هتتاخد نسخة احتياطية تلقائي قبل المسح، وتقدر ترجّعها من نفس الصفحة.</p>
        <label class="field"><span>كلمة السر بتاعتك</span><input class="input ltr" type="password" id="rz-pw" autocomplete="current-password"></label>
        <label class="field" style="margin-top:10px"><span>اكتب كلمة <b>امسح</b> للتأكيد</span><input class="input" id="rz-confirm" autocomplete="off"></label>`,
      foot: '<button class="btn btn-outline" data-close>إلغاء</button><button class="btn btn-danger" data-ok disabled>🧹 امسح</button>',
      onMount: (m, close) => {
        const boxes = () => [...m.querySelectorAll('[data-part]')];
        const get = (k) => m.querySelector(`[data-part="${k}"]`);
        // Products need their sales and repairs gone too; categories need products gone
        const sync = () => {
          if (get('categories').checked) { get('products').checked = true; }
          const prod = get('products').checked;
          for (const k of ['sales', 'repairs', 'purchases']) { if (prod) get(k).checked = true; get(k).disabled = prod; }
          get('products').disabled = get('categories').checked;
          const ready = m.querySelector('#rz-confirm').value.trim() === 'امسح' && m.querySelector('#rz-pw').value && boxes().some((b) => b.checked);
          m.querySelector('[data-ok]').disabled = !ready;
        };
        boxes().forEach((b) => b.addEventListener('change', sync));
        m.querySelector('#rz-confirm').addEventListener('input', sync);
        m.querySelector('#rz-pw').addEventListener('input', sync);
        sync();
        m.querySelector('[data-ok]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
          await api.post('/system/reset', {
            parts: boxes().filter((b) => b.checked).map((b) => b.dataset.part),
            password: m.querySelector('#rz-pw').value,
            confirm: m.querySelector('#rz-confirm').value,
          });
          close(true);
          try { localStorage.removeItem('mm_cart'); localStorage.removeItem('mm_label_queue'); } catch { /* ignore */ }
          toast('تم المسح ✅ — السيستم نضيف وجاهز', 'ok');
          setTimeout(() => location.reload(), 1200);
        }));
      },
    });
  });
  loadBackups().catch(() => {});

  el.querySelector('#logout-others').addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const r = await api.post('/auth/logout-others');
    toast(r.sessions ? `اتقفل ${r.sessions} جهاز` : 'مفيش أجهزة تانية مفتوحة', 'ok');
  }));

  el.querySelector('#save-bk')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
    state.settings = await api.put('/settings', formData(el.querySelector('#bk')));
    await api.post('/system/backup-now');
    toast('تم الحفظ وأخدت نسخة في الفولدر الجديد', 'ok');
    loadSystem();
  }));
  el.querySelector('#backup-now')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
    await api.post('/system/backup-now');
    toast('تم النسخ', 'ok');
    loadSystem();
  }));

  async function loadSystem() {
    if (!admin) {
      if (el.querySelector('#backups')) el.querySelector('#backups').textContent = 'النسخ التلقائي شغال يومياً.';
      return;
    }
    const sys = await api.get('/system').catch(() => null);
    if (!sys) return;
    const b = sys.backups.list;
    el.querySelector('#backups').innerHTML = b.length
      ? `آخر نسخة: <b style="color:var(--ink)">${fmtDate(b[0].at)}</b> — ${b.length} نسخة محفوظة في<br><span class="num" style="direction:ltr;display:inline-block">${esc(sys.backups.dir)}</span>`
      : 'لسه مفيش نسخ تلقائية.';
    el.querySelector('#remote').innerHTML = remoteCard(sys);
  }
  loadSystem();

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

function cloudCard(sys) {
  return `
    <div class="card-head"><h2>${icon('phone', '')} السيستم شغال أونلاين على Railway</h2>
      ${sys.hosting.persistent ? '<span class="pill pill-ok">البيانات محفوظة على Volume ✓</span>' : '<span class="pill pill-bad">مفيش Volume — البيانات هتتمسح!</span>'}</div>
    <div class="grid grid-2" style="align-items:start">
      <div>
        <p style="margin-top:0">تقدر تفتح السيستم من أي مكان بالرابط ده:</p>
        <p><a class="num" href="${location.origin}" style="direction:ltr;display:inline-block;font-size:17px">${location.origin}</a></p>
        <p class="small muted">من الموبايل افتح الرابط واختار "إضافة للشاشة الرئيسية" فيبقى زي الأبلكيشن.</p>
        ${sys.hosting.persistent ? '' : `<div class="card" style="background:var(--danger-wash);box-shadow:none;padding:16px">
          <b>اعمل كده دلوقتي عشان البيانات متتمسحش:</b>
          <ol style="margin:8px 0 0;padding-inline-start:20px;line-height:2">
            <li>افتح المشروع في Railway، واضغط كليك يمين على المساحة الفاضية (أو <bdi dir="ltr"><b>Ctrl+K</b></bdi>) واختار <bdi dir="ltr"><b>Volume</b></bdi></li>
            <li>اختار خدمة Mobile Mix</li>
            <li>خلي الـ Mount Path: <bdi dir="ltr" class="num"><b>/data</b></bdi></li>
          </ol>
          <div class="small" style="margin-top:6px">الخدمة هتعيد التشغيل، وبعدها كل البيانات هتتحفظ بشكل دائم.</div></div>`}
        <p class="small muted">⚠️ لأن السيستم على الإنترنت، المحل محتاج نت عشان يبيع. خلي عندك باقة موبايل احتياطي (هوت سبوت) لو النت قطع.</p>
      </div>
      <div>
        <div class="kpi bg-lavender" style="min-height:0">
          <div class="label">${icon('users')} مين فاتح السيستم دلوقتي</div>
          <div class="small" style="margin-top:8px;line-height:1.9">${sys.sessions.map((x) => `${esc(x.full_name)} — ${x.n} جهاز`).join('<br>') || '—'}</div>
        </div>
        <p class="small muted">💾 النسخ التلقائي بيتحفظ على نفس السيرفر — <b>نزّل نسخة على جهازك كل أسبوع</b> من "تحميل نسخة" فوق، عشان يبقى معاك نسخة برة Railway.</p>
      </div>
    </div>`;
}

function remoteCard(sys) {
  if (sys.hosting?.cloud) return cloudCard(sys);
  const lan = sys.addresses.filter((a) => !a.tailscale);
  const ts = sys.addresses.find((a) => a.tailscale);
  const url = (a) => `http://${a.address}:${sys.port}`;
  const step = (n, done, title, body) => `
    <div style="display:flex;gap:14px;padding:12px 0;border-bottom:1px solid var(--cloud)">
      <span class="avatar" style="${done ? 'background:var(--mint);color:#24521a' : ''}">${done ? '✓' : n}</span>
      <div style="flex:1"><b style="font-weight:500">${title}</b><div class="small muted" style="margin-top:4px;line-height:1.8">${body}</div></div>
    </div>`;
  return `
    <div class="card-head"><h2>${icon('phone', '')} الدخول على السيستم من برة المحل</h2>
      ${sys.via.remote ? '<span class="pill pill-ok">إنت داخل دلوقتي من برة المحل ✓</span>' : ts ? '<span class="pill pill-ok">Tailscale شغال</span>' : '<span class="pill pill-gray">مش متفعل</span>'}</div>
    <div class="grid grid-2" style="align-items:start">
      <div>
        <p style="margin-top:0">السيستم شغال على جهاز المحل، فبيشتغل عادي حتى لو النت قطع. ولما يكون فيه نت، تقدر تفتحه من البيت أو من موبايلك
          عن طريق <b>Tailscale</b> (مجاني وآمن — السيستم مش بيبقى مكشوف على الإنترنت، بس أجهزتك إنت اللي توصله).</p>
        ${step(1, !!ts, 'سطّب Tailscale على جهاز المحل', 'من <span class="num">tailscale.com/download</span> وسجّل دخول بحساب Google. وخلّيه يفتح مع الويندوز.')}
        ${step(2, false, 'سطّبه على موبايلك أو اللابتوب بتاعك', 'نفس الأبلكيشن ونفس الحساب. (ممكن تضيف موبايلات الموظفين اللي عايزهم يدخلوا من برة.)')}
        ${step(3, false, 'افتح السيستم بالعنوان ده', ts
          ? `<a class="num" href="${url(ts)}" style="direction:ltr;display:inline-block;font-size:15px">${url(ts)}</a>`
          : 'العنوان هيظهر هنا أول ما Tailscale يشتغل على جهاز المحل.')}
        ${step(4, sys.via.secure, 'اختياري: رابط آمن https', 'على جهاز المحل افتح Command Prompt واكتب <span class="num" style="direction:ltr;display:inline-block">tailscale serve --bg ' + sys.port + '</span> — هيديك رابط https تقدر تضيف منه السيستم على شاشة الموبايل كأنه أبلكيشن.')}
      </div>
      <div>
        <div class="kpi bg-aqua" style="min-height:0">
          <div class="label">${icon('home')} جوه المحل (نفس الواي فاي)</div>
          <div class="small" style="margin-top:8px;line-height:2">${lan.map((a) => `<a class="num" href="${url(a)}" style="direction:ltr;display:inline-block">${url(a)}</a>`).join('<br>') || '—'}</div>
        </div>
        <div class="kpi bg-lavender" style="min-height:0;margin-top:16px">
          <div class="label">${icon('users')} مين فاتح السيستم دلوقتي</div>
          <div class="small" style="margin-top:8px;line-height:1.9">${sys.sessions.map((x) => `${esc(x.full_name)} — ${x.n} جهاز`).join('<br>') || '—'}</div>
        </div>
        <p class="small muted">🔒 للأمان: كل موظف له كلمة سر، الحساب بيتقفل مؤقتاً بعد محاولات غلط كتير، وتقدر توقف أي موظف من صفحة الموظفين فيخرج من كل الأجهزة فوراً.</p>
      </div>
    </div>`;
}
