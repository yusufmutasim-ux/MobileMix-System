import { api, state, can, icon, esc, money, n, fmtDate, STATUS_PILLS, PAY_NAMES, emptyRow, moneyText, modal, toast } from '../core.js';
import { currentShift, zoneOn, locationPermission, getPosition, locationHelp } from '../live.js';

export async function render(el, { actions }) {
  if (can('sales.create')) actions.innerHTML = `<a class="btn btn-primary" href="#/pos">${icon('plus')} بيع جديد</a>`;
  const d = await api.get('/dashboard');
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'صباح الخير' : 'مساء الخير';

  const methods = d.today.by_method || {};
  const byMethod = Object.entries(methods).sort((a, b) => b[1].total - a[1].total);
  const card = methods.card || { total: 0, count: 0 };
  const insta = methods.instapay || { total: 0, count: 0 };
  const kpis = can('sales.create') ? [
    `<div class="kpi bg-mint"><div class="label">${icon('wallet')} مبيعات النهارده</div><div class="value">${n(d.today.total)} <small>${esc(state.settings.currency)}</small></div>
      ${byMethod.length > 1 ? `<div class="sub">${byMethod.map(([m, v]) => `${PAY_NAMES[m] || m}: <b>${n(v.total)}</b>`).join(' • ')}</div>` : ''}</div>`,
    `<a href="#/sales?method=card" class="kpi visa-kpi" style="color:inherit"><div class="label">${icon('card')} مبيعات الفيزا</div>
      <div class="value">${n(card.total)} <small>${esc(state.settings.currency)}</small></div><div class="sub">${card.count ? `${card.count} فاتورة — مش في الدرج، في البنك` : 'مفيش النهارده'}</div></a>`,
    `<a href="#/sales?method=instapay" class="kpi insta-kpi" style="color:inherit"><div class="label">${icon('wallet')} مبيعات InstaPay</div>
      <div class="value">${n(insta.total)} <small>${esc(state.settings.currency)}</small></div><div class="sub">${insta.count ? `${insta.count} فاتورة — مش في الدرج، في الحساب` : 'مفيش النهارده'}</div></a>`,
    `<div class="kpi bg-sky"><div class="label">${icon('receipt')} عدد الفواتير</div><div class="value">${d.today.invoices}</div></div>`,
  ] : [];
  if (d.today.profit !== undefined) {
    kpis.push(`<div class="kpi bg-lavender"><div class="label">${icon('trend')} ربح النهارده</div><div class="value">${n(d.today.profit)} <small>${esc(state.settings.currency)}</small></div>
      ${d.today.net !== undefined ? `<div class="sub">بعد المصاريف: <b>${moneyText(d.today.net)}</b></div>` : d.today.returns ? `<div class="sub">مرتجعات: ${moneyText(d.today.returns)}</div>` : ''}</div>`);
  }
  if (d.drawer !== undefined) {
    kpis.push(`<a href="#/drawer" class="kpi" style="color:inherit"><div class="label">${icon('drawer')} في الدرج دلوقتي</div>
      <div class="value">${n(d.drawer)} <small>${esc(state.settings.currency)}</small></div>
      ${d.expenses_today ? `<div class="sub">مصاريف النهارده: ${moneyText(d.expenses_today)}</div>` : ''}</a>`);
  }
  if (d.credit && (d.credit.due > 0 || d.credit.late > 0)) {
    kpis.push(`<a href="#/customers?filter=${d.credit.late > 0 ? 'late' : 'owing'}" class="kpi ${d.credit.late > 0 ? 'bg-peony' : ''}" style="color:inherit">
      <div class="label">${icon('user')} فلوس عند العملاء</div><div class="value">${n(d.credit.due)} <small>${esc(state.settings.currency)}</small></div>
      ${d.credit.late > 0 ? `<div class="sub">⚠️ أقساط متأخرة ${moneyText(d.credit.late)} — ${d.credit.late_count} عميل</div>` : ''}</a>`);
  }
  if (d.repairs) {
    kpis.push(`<a href="#/repairs" class="kpi bg-periwinkle" style="color:inherit"><div class="label">${icon('wrench')} أجهزة في الصيانة</div>
      <div class="value">${d.repairs.open} <small>${d.repairs.ready ? `${d.repairs.ready} جاهز للتسليم` : ''}</small></div>
      <div class="sub">استلام النهارده: ${d.repairs.received_today}${d.repairs.cash_today !== undefined ? ` — تحصيل: ${n(d.repairs.cash_today)}` : ''}</div></a>`);
  }
  if (d.low_stock !== undefined && state.user.role !== 'technician') {
    kpis.push(`<a href="#/products?low=1" class="kpi ${d.low_stock ? 'bg-peony' : 'bg-white'}" style="color:inherit">
      <div class="label">${icon('alert')} نواقص المخزن</div><div class="value">${d.low_stock} <small>من ${d.products} صنف</small></div></a>`);
  }

  const quick = [
    can('sales.create') && `<a href="#/pos" class="bg-periwinkle">${icon('cart')}بيع جديد</a>`,
    can('repairs.create') && `<a href="#/repairs?new=1" class="bg-aqua">${icon('wrench')}استلام جهاز صيانة</a>`,
    can('products.edit') && `<a href="#/products?new=1" class="bg-sky">${icon('box')}إضافة منتج</a>`,
    can('labels.print') && `<a href="#/labels" class="bg-mint">${icon('tag')}طباعة ليبلات</a>`,
    can('expenses.create') && `<a href="#/expenses?new=1">${icon('expense')}مصروف</a>`,
    can('drawer.close') && `<a href="#/drawer?close=1">${icon('drawer')}تقفيل الدرج</a>`,
    can('purchases.manage') && `<a href="#/purchases?new=1">${icon('truck')}شراء بضاعة</a>`,
    can('reports.view') && `<a href="#/reports" class="bg-lavender">${icon('chart')}التقارير</a>`,
    !can('reports.view') && can('sales.create') && `<a href="#/sales" class="bg-lavender">${icon('receipt')}فواتيري</a>`,
  ].filter(Boolean).slice(0, 8).join('');

  el.innerHTML = `
    <div class="card bg-peony hidden" id="loc-banner" style="box-shadow:none;margin-bottom:12px;padding:16px 20px">
      <div class="shift-banner"><span style="flex:1;min-width:200px">📍 <b>الحضور لازم يكون من جوه المحل.</b> فعّل الموقع مرة واحدة عشان تقدر تسجل حضور وانصراف.</span>
      <button class="btn btn-primary btn-sm" id="loc-allow">📍 فعّل الموقع</button></div>
    </div>
    <div class="card bg-aqua hidden" id="shift-banner" style="box-shadow:none;margin-bottom:20px;padding:16px 20px">
      <div class="shift-banner"><span style="flex:1;min-width:200px">${icon('clock', '')} <b>إنت مش مسجل حضور.</b> ابدأ الشيفت عشان يتسجل وقت وصولك${state.settings.require_shift === '1' && state.user.role !== 'admin' ? ' — <b>لازم تسجل حضور قبل البيع أو استلام الأجهزة</b>' : ''}.</span>
      <button class="btn btn-primary btn-sm" id="banner-in">${icon('logout')} بدء الشيفت</button></div>
    </div>
    <div class="hello"><h2>${greet}، ${esc(state.user.full_name.split(' ')[0])} 👋</h2>
      <p class="muted">${new Date().toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' })} — يوم موفق في ${esc(state.settings.shop_name || 'Mobile Mix')}</p></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr))">${kpis.join('')}</div>
    <div class="quick" style="margin-top:24px">${quick}</div>
    ${can('expenses.view') ? '<div class="card allow-card" id="allowances" style="margin-top:24px"><div class="empty loading"><span></span><span></span><span></span></div></div>' : ''}
    <div class="grid ${d.week ? 'grid-2' : ''} ${d.recent.length || can('sales.create') ? '' : 'hidden'}" style="margin-top:24px">
      ${d.week ? `<div class="card"><div class="card-head"><h2>مبيعات آخر 7 أيام</h2></div>${weekChart(d.week)}</div>` : ''}
      <div class="card">
        <div class="card-head"><h2>آخر الفواتير</h2><a href="#/sales" class="btn btn-ghost btn-sm">عرض الكل</a></div>
        <div class="table-wrap"><table class="table"><tbody>
          ${d.recent.length ? d.recent.map((s) => `
            <tr class="click" data-id="${s.id}">
              <td><b class="num" style="font-weight:500">${esc(s.invoice_no)}</b><div class="muted small">${fmtDate(s.created_at)}</div></td>
              <td class="small">${esc(s.user_name)}<div class="muted">${PAY_NAMES[s.payment_method] || ''}</div></td>
              <td>${STATUS_PILLS[s.status]}</td>
              <td class="end">${money(s.total)}</td>
            </tr>`).join('') : emptyRow(4, 'لسه مفيش فواتير')}
        </tbody></table></div>
      </div>
    </div>`;

  el.querySelectorAll('tr[data-id]').forEach((tr) =>
    tr.addEventListener('click', () => { location.hash = `#/sales?open=${tr.dataset.id}`; }));

  // "Start your shift" reminder (hidden once checked in)
  const banner = el.querySelector('#shift-banner');
  const showBanner = (shift) => banner.classList.toggle('hidden', !!shift || state.user.role === 'admin');
  const onShift = (e) => showBanner(e.detail);
  document.addEventListener('mm:shift', onShift);
  if (document.getElementById('shift-btn')) showBanner(currentShift());
  el.querySelector('#banner-in').addEventListener('click', () => window.mmCheckIn?.());

  // Location must be allowed when check in is limited to the shop
  const locBanner = el.querySelector('#loc-banner');
  (async () => {
    if (!(await zoneOn())) return;
    if ((await locationPermission()) !== 'granted') locBanner.classList.remove('hidden');
  })().catch(() => {});
  el.querySelector('#loc-allow').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await getPosition();
      locBanner.classList.add('hidden');
      toast('تمام — الموقع متفعّل ✅ تقدر تسجل حضور', 'ok');
    } catch (err) {
      modal({ title: 'تفعيل الموقع', body: `<div class="card bg-peony" style="box-shadow:none;padding:14px 16px">${locationHelp(err)}</div>`,
        foot: '<button class="btn btn-primary" data-close>تمام</button>' });
    } finally {
      btn.disabled = false;
    }
  });
  allowances(el.querySelector('#allowances'));
  return () => document.removeEventListener('mm:shift', onShift);
}

function weekChart(week) {
  const days = [];
  const map = Object.fromEntries(week.map((w) => [w.day, w.total]));
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    days.push({ key: local, label: d.toLocaleDateString('ar-EG', { weekday: 'short' }), total: map[local] ?? map[key] ?? 0 });
  }
  const max = Math.max(...days.map((d) => d.total), 1);
  return `
    <div class="bars" role="img" aria-label="مبيعات آخر 7 أيام">
      ${days.map((d) => `<div class="bar-col"><div class="tip">${d.label}: ${n(d.total)}</div>
        <div class="bar" style="height:${Math.max(1, (d.total / max) * 100)}%"></div></div>`).join('')}
    </div>
    <div class="bar-labels">${days.map((d) => `<span>${d.label}</span>`).join('')}</div>`;
}

/** Daily allowance (يومية): on top of the salary, given from the drawer — one tap per employee. */
async function allowances(box) {
  if (!box) return;
  const cur = esc(state.settings.currency || 'ج.م');
  const draw = (d) => {
    const came = d.list.filter((u) => u.came_at && !u.given);
    const waiting = came.length ? came : d.list.filter((u) => !u.given);
    box.innerHTML = `
      <div class="card-head"><h2>${icon('coins')} يومية الموظفين — النهارده</h2>
        <span class="muted small">بتتخصم من الدرج وبتتسجل على كل موظف، بعيد عن المرتب</span>
        ${d.total ? `<span class="pill pill-ok">اتصرف ${n(d.total)} ${cur}</span>` : ''}</div>
      ${d.list.length ? `<div class="allow-list">${d.list.map((u) => `
        <div class="allow-row ${u.given ? 'done' : ''}" data-id="${u.id}">
          <span class="avatar">${esc(u.full_name.trim()[0] || '?')}</span>
          <div class="allow-who"><b>${esc(u.full_name)}</b><span class="small muted">${u.came_at ? `حضر ${esc(u.came_at.slice(11, 16))}` : 'لسه مسجلش حضور'}</span></div>
          ${u.given ? `<span class="allow-given">${icon('check')} اتصرف ${n(u.given)}</span>
            <button class="btn btn-ghost btn-icon btn-sm" data-undo="${u.given_id}" title="إلغاء (غلطة)">${icon('x')}</button>`
            : `<button class="btn btn-primary btn-sm" data-give="${u.id}">اصرف ${n(u.amount)} ${cur}</button>`}
        </div>`).join('')}</div>
        ${waiting.length > 1 ? `<button class="btn btn-outline" id="give-all" style="margin-top:12px;width:100%">${icon('coins')} اصرف ${came.length ? `للي حضروا (${came.length})` : `للكل (${waiting.length})`} — ${n(waiting.reduce((a, u) => a + u.amount, 0))} ${cur}</button>` : ''}`
        : '<div class="empty">ضيف الموظفين الأول من صفحة الموظفين</div>'}
      <p class="muted small" style="margin:10px 0 0">اليومية المعتادة ${n(d.usual)} ${cur}${can('settings.manage') ? ' — <a href="#" id="allow-edit">غيّرها</a>' : ''}. لو موظف ليه مبلغ مختلف، غيّره من صفحة المرتبات.</p>`;
    box.querySelectorAll('[data-give]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try { const r = await api.post('/allowances', { user_id: Number(b.dataset.give) }); toast(`اتصرفت يومية ${n(r.total)}`, 'ok'); draw({ ...r, total: r.day_total }); }
      catch (e) { toast(e.message, 'err'); b.disabled = false; }
    }));
    box.querySelectorAll('[data-undo]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('تلغي اليومية دي؟ الفلوس هترجع للدرج.')) return;
      try { draw(await api.del('/allowances/' + b.dataset.undo)); toast('اتلغت', 'ok'); } catch (e) { toast(e.message, 'err'); }
    }));
    box.querySelector('#give-all')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try { const r = await api.post('/allowances', { ids: waiting.map((u) => u.id) }); toast(`اتصرفت يومية ${r.count} موظف — ${n(r.total)} ${state.settings.currency || 'ج.م'}`, 'ok'); draw({ ...r, total: r.day_total }); }
      catch (er) { toast(er.message, 'err'); }
    });
    box.querySelector('#allow-edit')?.addEventListener('click', async (e) => {
      e.preventDefault();
      const v = prompt('اليومية المعتادة لكل موظف:', d.usual);
      if (v === null || v.trim() === '' || !(Number(v) >= 0)) return;
      try { state.settings = await api.put('/settings', { daily_allowance: String(Number(v)) }); draw(await api.get('/allowances/today')); } catch (er) { toast(er.message, 'err'); }
    });
  };
  try { draw(await api.get('/allowances/today')); } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
