import {
  api, state, can, icon, esc, money, n, fmtDate, modal, toast, toastErr, busy, debounce, todayStr,
  emptyRow, waLink, moneyText, PAY_NAMES,
} from '../core.js';
import { REPAIR_STATUS, printRepairReceipt, printRepairSticker } from '../print.js';

const FLOW = ['received', 'diagnosing', 'waiting_approval', 'waiting_parts', 'repairing', 'ready', 'not_repaired'];
const PROBLEMS = ['شاشة مكسورة', 'تغيير بطارية', 'سوكت شحن', 'مش بيشحن', 'سوفت وير / فلاشة', 'وقع في مية', 'سماعة', 'مايك', 'كاميرا', 'زرار', 'مش بيفتح', 'شبكة', 'فك قفل / حساب'];
const ACCESSORIES = ['شاحن', 'جراب', 'شريحة', 'كارت ميموري', 'علبة', 'سماعة'];
const DEVICES = ['iPhone 11', 'iPhone 12', 'iPhone 13', 'iPhone 14', 'iPhone 15', 'Samsung A14', 'Samsung A15', 'Samsung A54', 'Samsung A55',
  'Samsung S23', 'Samsung S24', 'Xiaomi Redmi Note 12', 'Xiaomi Redmi Note 13', 'OPPO A78', 'OPPO Reno', 'Realme C55', 'Infinix Hot 40', 'Vivo Y36', 'Honor X8'];
const METHODS = { cash: 'كاش', card: 'فيزا', wallet: 'محفظة', instapay: 'InstaPay' };

export const statusPill = (s) => `<span class="pill st-${s}">${REPAIR_STATUS[s] || s}</span>`;

export async function render(el, { query, actions }) {
  let status = 'open';
  let rows = [];

  actions.innerHTML = can('repairs.create') ? `<button class="btn btn-primary" id="new">${icon('plus')} استلام جهاز</button>` : '';

  el.innerHTML = `
    <div class="grid grid-4" id="kpis" style="margin-bottom:24px"></div>
    <div class="card">
      <div class="toolbar">
        <div class="search">${icon('search')}<input class="input" id="q" placeholder="رقم التذكرة، تليفون، اسم العميل، الجهاز أو IMEI…" autocomplete="off"></div>
        ${state.user.role === 'technician' ? '<label class="check"><input type="checkbox" id="mine"> أجهزتي بس</label>' : ''}
      </div>
      <div class="seg" id="tabs" style="margin-bottom:16px"></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>التذكرة</th><th>العميل</th><th>الجهاز والعطل</th><th>الفني</th><th>الحالة</th><th>التسليم</th><th class="end">الحساب</th></tr></thead>
        <tbody id="rows"></tbody>
      </table></div>
    </div>`;

  const $ = (s) => el.querySelector(s);

  async function loadSummary() {
    const sm = await api.get('/repairs/summary');
    const c = sm.counts;
    $('#kpis').innerHTML = `
      <div class="kpi bg-periwinkle"><div class="label">${icon('wrench')} أجهزة في الصيانة</div><div class="value">${sm.open}</div></div>
      <div class="kpi bg-sky"><div class="label">${icon('history')} شغالين عليها</div><div class="value">${c.diagnosing + c.repairing}</div>
        <div class="sub">مستني موافقة: ${c.waiting_approval} — قطع غيار: ${c.waiting_parts}</div></div>
      <div class="kpi bg-mint"><div class="label">${icon('check')} جاهزة للتسليم</div><div class="value">${c.ready + c.not_repaired}</div></div>
      <div class="kpi ${sm.overdue ? 'bg-peony' : 'bg-lavender'}"><div class="label">${icon('alert')} متأخرة عن ميعادها</div><div class="value">${sm.overdue}</div></div>`;
    const tabs = [['open', `المفتوحة (${sm.open})`], ...FLOW.map((s) => [s, `${REPAIR_STATUS[s]} (${c[s]})`]), ['delivered', 'اتسلمت'], ['all', 'الكل']];
    $('#tabs').innerHTML = tabs.map(([k, v]) => `<button data-s="${k}" class="${k === status ? 'on' : ''}">${v}</button>`).join('');
  }

  async function load() {
    const p = new URLSearchParams({ status });
    if ($('#q').value.trim()) { p.set('q', $('#q').value.trim()); p.set('status', 'all'); }
    if ($('#mine')?.checked) p.set('mine', '1');
    rows = await api.get('/repairs?' + p);
    const today = todayStr();
    $('#rows').innerHTML = rows.length ? rows.map((r) => {
      const due = (r.price ?? r.estimated_cost ?? 0) - r.paid;
      const late = r.expected_at && r.expected_at < today && !['ready', 'not_repaired', 'delivered'].includes(r.status);
      return `<tr class="click" data-id="${r.id}">
        <td><b class="num" style="font-weight:500">${esc(r.ticket_no)}</b><div class="muted small">${fmtDate(r.created_at, false)}</div></td>
        <td>${esc(r.customer_name)}<div class="muted small num">${esc(r.customer_phone)}</div></td>
        <td><b style="font-weight:500">${esc(r.device)}</b><div class="muted small" style="max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.problem)}</div></td>
        <td class="small">${esc(r.technician_name || '—')}</td>
        <td>${statusPill(r.status)}</td>
        <td class="small ${late ? 'overdue' : ''}">${r.status === 'delivered' ? fmtDate(r.delivered_at, false) : r.expected_at ? fmtDate(r.expected_at, false) : '—'}${late ? ' (متأخر)' : ''}</td>
        <td class="end">${r.price != null ? money(r.price) : r.estimated_cost != null ? `<span class="muted">~${n(r.estimated_cost)}</span>` : '—'}
          ${r.paid ? `<div class="small muted">مدفوع ${n(r.paid)}</div>` : ''}
          ${due > 0.004 && r.status === 'delivered' ? `<div class="small overdue">متبقي ${n(due)}</div>` : ''}</td>
      </tr>`;
    }).join('') : emptyRow(7, status === 'open' ? 'مفيش أجهزة في الصيانة دلوقتي' : 'مفيش تذاكر');
  }

  const reload = () => Promise.all([loadSummary(), load()]).catch(toastErr);

  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    status = b.dataset.s;
    $('#q').value = '';
    reload();
  });
  $('#q').addEventListener('input', debounce(() => load().catch(toastErr), 250));
  $('#mine')?.addEventListener('change', () => load().catch(toastErr));
  $('#rows').addEventListener('click', async (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    await openRepair(tr.dataset.id);
    reload();
  });
  actions.querySelector('#new')?.addEventListener('click', async () => {
    const r = await intakeForm();
    if (r) { reload(); await afterIntake(r); }
  });

  await reload();
  if (query.get('open')) { await openRepair(query.get('open')); reload(); }
  if (query.get('new') && can('repairs.create')) {
    const r = await intakeForm();
    if (r) { reload(); await afterIntake(r); }
  }
}

// ---------------- intake ----------------
async function intakeForm() {
  const techs = await api.get('/repairs/technicians');
  const nextDays = (d) => todayStr(d);
  return modal({
    title: 'استلام جهاز للصيانة',
    wide: true,
    body: `<form class="form-grid" autocomplete="off" onsubmit="return false">
      <label class="field"><span>تليفون العميل *</span><input class="input ltr" name="customer_phone" inputmode="tel" autofocus></label>
      <label class="field"><span>اسم العميل *</span><input class="input" name="customer_name"></label>
      <div class="full small" id="history"></div>
      <label class="field"><span>الجهاز *</span><input class="input" name="device" list="dev-list" placeholder="مثلاً iPhone 13 Pro"><datalist id="dev-list">${DEVICES.map((d) => `<option value="${d}">`).join('')}</datalist></label>
      <label class="field"><span>IMEI / سيريال</span><input class="input ltr" name="imei"></label>
      <div class="field full"><span>العطل *</span>
        <div class="toggle-chips" id="problems">${PROBLEMS.map((p) => `<button type="button" data-v="${p}">${p}</button>`).join('')}</div>
        <textarea class="input" name="problem" rows="2" placeholder="وصف العطل زي ما العميل قاله"></textarea></div>
      <div class="field full"><span>مستلم مع الجهاز</span>
        <div class="toggle-chips" id="acc">${ACCESSORIES.map((p) => `<button type="button" data-v="${p}">${p}</button>`).join('')}</div></div>
      <label class="field full"><span>حالة الجهاز وقت الاستلام</span><input class="input" name="condition_notes" placeholder="خدوش، ضهر مكسور، الشاشة فيها خط…"></label>
      <label class="field"><span>رمز القفل / الباسورد</span><input class="input ltr" name="passcode" placeholder="اختياري — عشان الفني يختبر الجهاز"></label>
      <label class="field"><span>الفني</span><select class="input" name="technician_id"><option value="">— بعدين —</option>
        ${techs.map((t) => `<option value="${t.id}">${esc(t.full_name)}</option>`).join('')}</select></label>
      <label class="field"><span>التكلفة المتوقعة</span><input class="input num" type="number" min="0" step="any" name="estimated_cost" placeholder="بعد الفحص"></label>
      <label class="field"><span>ميعاد التسليم المتوقع</span><input class="input num" type="date" name="expected_at" value="${nextDays(2)}"></label>
      ${can('repairs.cash') ? `
        <label class="field"><span>عربون</span><input class="input num" type="number" min="0" step="any" name="deposit" value="0"></label>
        <label class="field"><span>طريقة الدفع</span><select class="input" name="deposit_method">${Object.entries(METHODS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>` : ''}
      <label class="field full"><span>ملاحظات داخلية</span><input class="input" name="notes"></label>
    </form>`,
    foot: `<button class="btn btn-outline" data-close>إلغاء</button><button class="btn btn-primary" data-ok>${icon('check')} استلام وطباعة الإيصال</button>`,
    onMount: (m, close) => {
      const f = m.querySelector('form');
      const field = (name) => f.querySelector(`[name=${name}]`);
      // Chips append to the text so the cashier can still type details
      m.querySelector('#problems').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        b.classList.toggle('on');
        const parts = field('problem').value.split('،').map((x) => x.trim()).filter(Boolean);
        const v = b.dataset.v;
        const next = b.classList.contains('on') ? [...parts, v] : parts.filter((x) => x !== v);
        field('problem').value = next.join('، ');
      });
      m.querySelector('#acc').addEventListener('click', (e) => e.target.closest('button')?.classList.toggle('on'));
      field('customer_phone').addEventListener('input', debounce(async () => {
        const phone = field('customer_phone').value.replace(/\D/g, '');
        if (phone.length < 10) { m.querySelector('#history').innerHTML = ''; return; }
        const h = await api.get('/repairs/customer?phone=' + phone).catch(() => null);
        if (!h?.history.length) { m.querySelector('#history').innerHTML = ''; return; }
        if (!field('customer_name').value) field('customer_name').value = h.name;
        m.querySelector('#history').innerHTML = `<span class="pill pill-info">عميل قديم</span> ${h.history.length} تذكرة قبل كده: ${h.history.slice(0, 3)
          .map((x) => `${esc(x.device)} (${REPAIR_STATUS[x.status]})`).join('، ')}`;
      }, 350));
      m.querySelector('[data-ok]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const body = Object.fromEntries([...f.querySelectorAll('[name]')].map((i) => [i.name, i.value]));
        body.accessories = [...m.querySelectorAll('#acc .on')].map((b) => b.dataset.v).join('، ');
        if (!body.technician_id) delete body.technician_id;
        const r = await api.post('/repairs', body);
        toast(`تم الاستلام — تذكرة ${r.ticket_no}`, 'ok');
        close(r);
      }));
    },
  });
}

function afterIntake(r) {
  return modal({
    title: 'تم استلام الجهاز',
    body: `<div class="success-hero"><div class="ic">${icon('check')}</div>
      <div class="muted">رقم التذكرة</div><div style="font-size:32px;font-weight:300" class="num">${esc(r.ticket_no)}</div>
      <p class="muted small">اطبع إيصال للعميل، واستيكر يتلزق على الجهاز.</p></div>`,
    foot: `<a class="btn btn-outline" target="_blank" rel="noopener" href="${waLink(r.customer_phone, waMessage(r))}">${icon('whatsapp')} واتساب</a>
      <button class="btn btn-outline" data-sticker>${icon('tag')} استيكر الجهاز</button>
      <button class="btn btn-primary" data-receipt>${icon('print')} إيصال العميل</button>`,
    onMount: (m) => {
      m.querySelector('[data-receipt]').addEventListener('click', () => printRepairReceipt(r, 'intake'));
      m.querySelector('[data-sticker]').addEventListener('click', () => printRepairSticker(r));
    },
  });
}

// ---------------- WhatsApp messages ----------------
function waMessage(r) {
  const shop = state.settings.shop_name || 'Mobile Mix';
  const hi = `أهلاً ${r.customer_name} 👋\n`;
  const t = `\nرقم التذكرة: ${r.ticket_no}\n${shop}${state.settings.shop_phone ? ` — ${state.settings.shop_phone}` : ''}`;
  switch (r.status) {
    case 'waiting_approval':
      return `${hi}فحصنا جهازك ${r.device}${r.diagnosis ? `، والمطلوب: ${r.diagnosis}` : ''}.${r.price != null ? `\nالتكلفة: ${moneyText(r.price)}` : ''}\nمحتاجين موافقتك عشان نبدأ التصليح.${t}`;
    case 'waiting_parts':
      return `${hi}جهازك ${r.device} مستني قطعة غيار، وهنبلغك أول ما توصل ونخلّصه.${t}`;
    case 'ready':
      return `${hi}جهازك ${r.device} جاهز للاستلام ✅${r.balance > 0.004 ? `\nالمطلوب: ${moneyText(r.balance)}` : ''}\nمتنساش الإيصال.${t}`;
    case 'not_repaired':
      return `${hi}للأسف جهازك ${r.device} مينفعش يتصلح${r.diagnosis ? ` (${r.diagnosis})` : ''}. تقدر تعدي تستلمه في أي وقت.${t}`;
    case 'delivered':
      return `${hi}شكراً إنك اخترت ${shop} 🙏${r.warranty_days && r.outcome === 'repaired' ? `\nالصيانة عليها ضمان ${r.warranty_days} يوم.` : ''}${t}`;
    default:
      return `${hi}استلمنا جهازك ${r.device} للصيانة، وهنبلغك أول ما يجهز.${t}`;
  }
}

// ---------------- ticket details ----------------
export async function openRepair(id) {
  let r;
  try { r = await api.get('/repairs/' + id); } catch (e) { return toastErr(e); }
  const techs = can('repairs.work') ? await api.get('/repairs/technicians') : [];
  const showCost = can('products.view_cost');

  return modal({
    title: `<span id="rp-title"></span>`,
    wide: true,
    body: '<div id="rp"></div>',
    foot: '<div id="rp-foot" class="btn-row" style="width:100%"></div>',
    onMount: (m) => {
      const $ = (s) => m.querySelector(s);

      const act = (fn) => async (e) => {
        const btn = e?.currentTarget;
        await busy(btn, async () => { r = await fn(); draw(); });
      };

      function draw() {
        const open = r.status !== 'delivered';
        const target = r.price ?? r.estimated_cost;
        $('#rp-title').innerHTML = `صيانة <span class="num">${esc(r.ticket_no)}</span> ${statusPill(r.status)}`;
        $('#rp').innerHTML = `
          <div class="info-grid">
            <div><div class="k">العميل</div><div class="v">${esc(r.customer_name)}</div>
              <div class="num small"><a href="tel:${esc(r.customer_phone)}">${esc(r.customer_phone)}</a></div></div>
            <div><div class="k">الجهاز</div><div class="v">${esc(r.device)}</div>${r.imei ? `<div class="num small muted">${esc(r.imei)}</div>` : ''}</div>
            <div><div class="k">رمز القفل</div><div class="v">${r.passcode ? `<span id="pc" class="num">••••</span> <button class="btn btn-ghost btn-sm" id="show-pc">${icon('eye')}</button>` : '—'}</div></div>
            <div style="grid-column:span 2"><div class="k">العطل</div><div class="v">${esc(r.problem)}</div></div>
            <div><div class="k">مستلم مع الجهاز</div><div class="v">${esc(r.accessories || 'الجهاز فقط')}</div></div>
            ${r.condition_notes ? `<div style="grid-column:span 2"><div class="k">حالة الجهاز</div><div class="v">${esc(r.condition_notes)}</div></div>` : ''}
            <div><div class="k">الاستلام</div><div class="v small">${fmtDate(r.created_at)}<br><span class="muted">${esc(r.created_by_name || '')}</span></div></div>
            <div><div class="k">${r.status === 'delivered' ? 'اتسلم' : 'التسليم المتوقع'}</div><div class="v small">${r.status === 'delivered' ? fmtDate(r.delivered_at) : r.expected_at ? fmtDate(r.expected_at, false) : '—'}</div></div>
            ${r.notes ? `<div style="grid-column:1/-1"><div class="k">ملاحظات داخلية</div><div class="v">${esc(r.notes)}</div></div>` : ''}
          </div>

          ${open && can('repairs.work') ? `
            <div class="section-title">${icon('history', '')} غيّر الحالة</div>
            <div class="status-actions">${FLOW.filter((s) => s !== r.status).map((s) => `<button class="btn btn-sm btn-outline" data-status="${s}">${REPAIR_STATUS[s]}</button>`).join('')}</div>
            <input class="input" id="st-note" placeholder="ملاحظة مع تغيير الحالة (اختياري)" style="margin-top:8px">` : ''}

          <div class="section-title">${icon('wrench', '')} الشغل</div>
          ${open && can('repairs.work') ? `
            <div class="form-grid" id="work">
              <label class="field full"><span>التشخيص / اللي اتعمل</span><textarea class="input" name="diagnosis" rows="2">${esc(r.diagnosis || '')}</textarea></label>
              <label class="field"><span>سعر الصيانة للعميل</span><input class="input num" type="number" min="0" step="any" name="price" value="${r.price ?? ''}" placeholder="${r.estimated_cost != null ? `متوقع ${r.estimated_cost}` : ''}"></label>
              <label class="field"><span>الفني</span><select class="input" name="technician_id"><option value="">—</option>
                ${techs.map((t) => `<option value="${t.id}" ${t.id === r.technician_id ? 'selected' : ''}>${esc(t.full_name)}</option>`).join('')}</select></label>
              <label class="field"><span>الضمان (أيام)</span><input class="input num" type="number" min="0" name="warranty_days" value="${r.warranty_days || 0}"></label>
              ${showCost ? `<label class="field"><span>تكاليف خارجية (قطع من برة / ورشة)</span><input class="input num" type="number" min="0" step="any" name="extra_cost" value="${r.extra_cost || 0}"></label>` : ''}
              <div class="full"><button class="btn btn-primary btn-sm" id="save-work">${icon('check')} حفظ</button></div>
            </div>` : `
            <div class="info-grid">
              <div style="grid-column:span 2"><div class="k">التشخيص</div><div class="v">${esc(r.diagnosis || '—')}</div></div>
              <div><div class="k">الفني</div><div class="v">${esc(r.technician_name || '—')}</div></div>
              ${r.warranty_days ? `<div><div class="k">الضمان</div><div class="v">${r.warranty_days} يوم</div></div>` : ''}
            </div>`}

          <div class="section-title">${icon('box', '')} قطع غيار من المخزن</div>
          ${r.parts.length ? `<table class="table"><tbody>${r.parts.map((p) => `<tr>
              <td>${esc(p.name)}</td><td class="num">× ${p.qty}</td>${showCost ? `<td>${money(p.unit_cost * p.qty)}</td>` : ''}
              <td class="end">${open && can('repairs.work') ? `<button class="btn btn-ghost btn-sm" data-del-part="${p.id}" title="رجّعها المخزن">${icon('undo')}</button>` : ''}</td></tr>`).join('')}</tbody></table>`
            : '<p class="muted small" style="margin:0">مفيش قطع اتصرفت من المخزن</p>'}
          ${open && can('repairs.work') ? `
            <div style="display:flex;gap:8px;margin-top:8px;position:relative">
              <div class="search" style="flex:1">${icon('search')}<input class="input" id="part-q" placeholder="دور على قطعة غيار بالاسم أو الباركود…" autocomplete="off"></div>
              <input class="input num" id="part-qty" type="number" min="1" value="1" style="width:80px">
            </div>
            <div id="part-results"></div>` : ''}

          <div class="section-title">${icon('wallet', '')} الحساب</div>
          <div class="money-box">
            <div><div class="k">${r.price != null ? 'السعر' : 'التكلفة المتوقعة'}</div><div class="v">${target != null ? money(target) : '—'}</div></div>
            <div><div class="k">المدفوع</div><div class="v">${money(r.paid)}</div></div>
            <div style="${r.balance > 0.004 ? 'background:var(--warn-wash)' : ''}"><div class="k">المتبقي</div><div class="v">${money(Math.max(0, r.balance))}</div></div>
          </div>
          ${showCost && r.price != null ? `<p class="small muted" style="margin:8px 0 0">تكلفة القطع ${n(r.parts_cost)} + تكاليف خارجية ${n(r.extra_cost)} — <b style="color:var(--ink)">الربح ${n(r.profit)}</b></p>` : ''}
          ${r.payments.length ? `<table class="table" style="margin-top:8px"><tbody>${r.payments.map((p) => `<tr>
            <td class="small">${fmtDate(p.created_at)}</td><td>${p.kind === 'deposit' ? 'عربون' : p.kind === 'refund' ? 'رد للعميل' : 'دفعة'}</td>
            <td class="small">${PAY_NAMES[p.method] || p.method}</td><td class="small">${esc(p.user_name || '')}</td><td class="end">${money(p.amount)}</td></tr>`).join('')}</tbody></table>` : ''}
          ${can('repairs.cash') && (open || r.balance > 0.004) ? `
            <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
              <input class="input num" id="pay-amount" type="number" min="0" step="any" placeholder="المبلغ" style="width:140px">
              <select class="input" id="pay-method" style="width:auto">${Object.entries(METHODS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
              <button class="btn btn-outline btn-sm" data-pay="${open ? 'deposit' : 'payment'}">${icon('plus')} ${open ? 'عربون / دفعة' : 'تحصيل المتبقي'}</button>
              ${r.paid > 0 ? '<button class="btn btn-ghost btn-sm" data-pay="refund">رد فلوس للعميل</button>' : ''}
            </div>` : ''}

          <div class="section-title">${icon('history', '')} سجل التذكرة</div>
          <div class="timeline">${r.events.map((e) => `<div class="ev">${e.status ? statusPill(e.status) : ''} ${esc(e.note || '')}
            <div class="t">${fmtDate(e.created_at)} — ${esc(e.user_name || '')}</div></div>`).join('')}</div>
          <div style="display:flex;gap:8px;margin-top:6px"><input class="input" id="note" placeholder="ضيف ملاحظة (مثلاً: العميل اتصل)"><button class="btn btn-outline btn-sm" id="add-note">إضافة</button></div>`;

        const canDeliver = can('repairs.cash') && ['ready', 'not_repaired'].includes(r.status);
        $('#rp-foot').innerHTML = `
          <a class="btn btn-outline" target="_blank" rel="noopener" href="${waLink(r.customer_phone, waMessage(r))}">${icon('whatsapp')} واتساب</a>
          <button class="btn btn-ghost" data-print="sticker">${icon('tag')} استيكر</button>
          <button class="btn btn-ghost" data-print="intake">${icon('print')} إيصال الاستلام</button>
          ${r.status === 'delivered' ? `<button class="btn btn-ghost" data-print="delivery">${icon('print')} إيصال التسليم</button>` : ''}
          <span style="flex:1"></span>
          ${canDeliver ? `<button class="btn btn-primary" id="deliver">${icon('check')} تسليم للعميل</button>` : ''}`;
        wire();
      }

      function wire() {
        $('#show-pc')?.addEventListener('click', () => { $('#pc').textContent = r.passcode; });
        m.querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', act(() =>
          api.post(`/repairs/${r.id}/status`, { status: b.dataset.status, note: $('#st-note').value }))));
        $('#save-work')?.addEventListener('click', act(() => {
          const body = Object.fromEntries([...$('#work').querySelectorAll('[name]')].map((i) => [i.name, i.value === '' ? null : i.value]));
          return api.put('/repairs/' + r.id, body).then((x) => { toast('تم الحفظ', 'ok'); return x; });
        }));
        m.querySelectorAll('[data-del-part]').forEach((b) => b.addEventListener('click', act(() =>
          api.del(`/repairs/${r.id}/parts/${b.dataset.delPart}`))));
        const pq = $('#part-q');
        if (pq) {
          const search = debounce(async () => {
            const q = pq.value.trim();
            if (!q) { $('#part-results').innerHTML = ''; return; }
            const items = (await api.get('/products?limit=6&q=' + encodeURIComponent(q))).filter((p) => !p.has_serial);
            $('#part-results').innerHTML = items.map((p) => `<button class="pcard" data-part="${p.id}" style="width:100%;flex-direction:row;align-items:center;margin-top:6px;padding:8px 12px">
              <span style="flex:1;font-weight:500">${esc(p.name)}</span><span class="pill ${p.qty > 0 ? 'pill-gray' : 'pill-bad'} num">${p.qty}</span></button>`).join('')
              || '<p class="muted small">مفيش قطعة بالاسم ده</p>';
            $('#part-results').querySelectorAll('[data-part]').forEach((b) => b.addEventListener('click', act(() =>
              api.post(`/repairs/${r.id}/parts`, { product_id: Number(b.dataset.part), qty: Number($('#part-qty').value) || 1 }))));
          }, 250);
          pq.addEventListener('input', search);
        }
        m.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', act(() =>
          api.post(`/repairs/${r.id}/payments`, { amount: $('#pay-amount').value, method: $('#pay-method').value, kind: b.dataset.pay }))));
        $('#add-note').addEventListener('click', act(() => api.post(`/repairs/${r.id}/notes`, { note: $('#note').value })));
        m.querySelectorAll('[data-print]').forEach((b) => b.addEventListener('click', () => {
          if (b.dataset.print === 'sticker') printRepairSticker(r);
          else printRepairReceipt(r, b.dataset.print);
        }));
        $('#deliver')?.addEventListener('click', async () => {
          const done = await deliverForm(r);
          if (done) { r = done; draw(); }
        });
      }

      draw();
    },
  });
}

function deliverForm(r) {
  const price = r.price ?? 0;
  const left = Math.max(0, price - r.paid);
  return modal({
    title: `تسليم ${esc(r.device)} — <span class="num">${esc(r.ticket_no)}</span>`,
    body: `
      ${r.status === 'not_repaired' ? '<p class="pill pill-bad" style="font-size:14px">الجهاز هيترجع من غير تصليح</p>' : ''}
      <div class="money-box" style="margin-bottom:16px">
        <div><div class="k">الحساب</div><div class="v">${money(price)}</div></div>
        <div><div class="k">مدفوع قبل كده</div><div class="v">${money(r.paid)}</div></div>
        <div style="background:var(--mint)"><div class="k">المطلوب دلوقتي</div><div class="v">${money(left)}</div></div>
      </div>
      <div class="form-grid">
        <label class="field"><span>المبلغ المستلم</span><input class="input num input-lg" type="number" min="0" step="any" id="amount" value="${left}" autofocus></label>
        <label class="field"><span>طريقة الدفع</span><select class="input input-lg" id="method">${Object.entries(METHODS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        ${r.status === 'ready' ? `<label class="field"><span>الضمان (أيام)</span><input class="input num" type="number" min="0" id="warranty" value="${r.warranty_days || 0}"></label>` : ''}
        <label class="check full"><input type="checkbox" id="due"> العميل هيدفع الباقي بعدين (آجل)</label>
      </div>
      <p class="muted small">اتأكد إن العميل معاه الإيصال، وإن الجهاز شغال قدامه.</p>`,
    foot: `<button class="btn btn-outline" data-close>إلغاء</button><button class="btn btn-primary" data-ok>${icon('check')} تسليم وطباعة</button>`,
    onMount: (m, close) => m.querySelector('[data-ok]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const done = await api.post(`/repairs/${r.id}/deliver`, {
        amount: m.querySelector('#amount').value,
        method: m.querySelector('#method').value,
        warranty_days: m.querySelector('#warranty')?.value,
        allow_due: m.querySelector('#due').checked,
      });
      toast('تم التسليم', 'ok');
      printRepairReceipt(done, 'delivery');
      close(done);
    })),
  });
}
