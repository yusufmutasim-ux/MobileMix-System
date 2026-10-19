import { api, state, can, icon, esc, fmtDate, toast, busy, formData, emptyRow } from '../core.js';
import { LABEL_SIZES } from '../print.js';
import { pushSupported, pushHint, subscribePush, unsubscribePush } from '../live.js';

const AUDIT_NAMES = {
  login: 'تسجيل دخول', 'password.change': 'تغيير كلمة السر', 'user.create': 'إضافة موظف', 'user.update': 'تعديل موظف',
  'settings.update': 'تعديل الإعدادات', 'backup.download': 'نسخة احتياطية', 'product.create': 'إضافة منتج',
  'product.price': 'تغيير سعر', 'product.deactivate': 'إيقاف منتج', 'sale.return': 'مرتجع',
  'stocktake.open': 'فتح جرد', 'stocktake.apply': 'تطبيق جرد', 'repair.create': 'استلام صيانة', 'repair.deliver': 'تسليم صيانة', 'logout.others': 'خروج من الأجهزة التانية', 'shift.close': 'إنهاء شيفت موظف', 'backup.auto': 'نسخة احتياطية',
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
          <label class="field full"><span>الحضور والانصراف</span><select class="input" name="require_shift">
            <option value="0" ${s.require_shift !== '1' ? 'selected' : ''}>اختياري — الموظف يسجل حضور لو حب</option>
            <option value="1" ${s.require_shift === '1' ? 'selected' : ''}>إجباري — مينفعش يبيع أو يستلم جهاز من غير ما يسجل حضور</option></select></label>
          <label class="field"><span>بادئة تذكرة الصيانة</span><input class="input ltr" name="repair_prefix" value="${esc(s.repair_prefix)}"></label>
          <div></div>
          <label class="field full"><span>شروط الصيانة (بتتطبع على إيصال الاستلام)</span><textarea class="input" name="repair_terms" rows="3">${esc(s.repair_terms)}</textarea></label>
          <div class="full"><button class="btn btn-primary" id="save-shop">${icon('check')} حفظ الإعدادات</button></div>
        </form>
      </div>` : ''}

      <div class="stack">
        ${can('notifications.receive') ? '<div class="card" id="notif-card"><div class="empty">…</div></div>' : ''}
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
        <div class="card">
          <div class="card-head"><h2>${icon('logout', '')} الأجهزة المتصلة</h2></div>
          <p class="muted" style="margin-top:0">لو موبايلك ضاع أو دخلت من جهاز مش بتاعك، اقفل حسابك على كل الأجهزة التانية.</p>
          <button class="btn btn-outline" id="logout-others">تسجيل خروج من كل الأجهزة التانية</button>
        </div>
      </div>
    </div>
    ${admin ? `<div class="card" style="margin-top:24px" id="remote"><div class="empty">…</div></div>` : ''}
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
  loadNotif().catch(toastErrLocal);

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
