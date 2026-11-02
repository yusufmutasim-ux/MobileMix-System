import { api, state, can, icon, esc, money, n, fmtDate, STATUS_PILLS, PAY_NAMES, emptyRow, moneyText, modal, toast } from '../core.js';
import { currentShift, zoneOn, locationPermission, getPosition, locationHelp } from '../live.js';

export async function render(el, { actions }) {
  const d = await api.get('/dashboard');
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'صباح الخير' : 'مساء الخير';

  const cur = esc(state.settings.currency || 'ج.م');
  const methods = d.today.by_method || {};
  const METHOD_STYLE = { cash: 'm-cash', card: 'm-card', instapay: 'm-insta', wallet: 'm-wallet', installment: 'm-inst' };
  const order = ['cash', 'card', 'instapay', 'wallet', 'installment'];
  const shown = order.filter((m) => methods[m] || ['cash', 'card', 'instapay'].includes(m));

  // 1) Today's sales, split by how they were paid
  const hero = can('sales.create') ? `
    <div class="card dash-hero">
      <div class="dash-hero-top">
        <div><span class="muted">${icon('wallet')} مبيعات النهارده</span>
          <div class="dash-big">${n(d.today.total)} <small>${cur}</small></div>
          <span class="muted small">${d.today.invoices} فاتورة${d.today.returns ? ` • مرتجعات ${n(d.today.returns)}` : ''}</span></div>
        ${can('sales.create') ? `<a class="btn btn-primary" href="#/pos">${icon('plus')} بيع جديد</a>` : ''}
      </div>
      <div class="dash-methods">${shown.map((m) => {
        const v = methods[m] || { total: 0, count: 0 };
        return `<a href="#/sales?method=${m}" class="dm ${METHOD_STYLE[m]}"><span>${PAY_NAMES[m]}</span><b>${n(v.total)}</b><small>${v.count} فاتورة</small></a>`;
      }).join('')}</div>
      ${methods.card || methods.instapay || methods.wallet ? '<p class="muted small" style="margin:10px 0 0">الفيزا وInstaPay والمحفظة مش في الدرج — في البنك / الحساب.</p>' : ''}
    </div>` : '';

  // 2) Drawer and profit
  const side = [];
  // The drawer: what's in it, when it was last closed, and closing it in one tap
  if (d.drawer !== undefined || can('drawer.close')) {
    const lc = d.last_close;
    const closedToday = lc && lc.at.slice(0, 10) === new Date().toLocaleDateString('en-CA');
    side.push(`<div class="kpi drawer-kpi">
      <div class="label">${icon('drawer')} الدرج</div>
      ${d.drawer !== undefined ? `<div class="value">${n(d.drawer)} <small>${cur}</small></div>` : ''}
      <div class="sub">${lc ? `آخر تقفيلة: ${closedToday ? 'النهارده' : esc(fmtDate(lc.at, false))} ${esc(lc.at.slice(11, 16))}${lc.by ? ` — ${esc(lc.by)}` : ''}${lc.diff ? ` <b style="color:${lc.diff < 0 ? 'var(--danger)' : 'inherit'}">(${lc.diff > 0 ? '+' : ''}${n(lc.diff)})</b>` : ''}` : 'لسه متقفلش قبل كده'}
        ${d.expenses_today ? `<br>مصاريف النهارده ${n(d.expenses_today)}` : ''}</div>
      <div class="drawer-acts">${can('drawer.close') ? `<a class="btn btn-primary btn-sm" href="#/drawer?close=1">${icon('check')} قفّل الدرج</a>` : ''}
        ${d.drawer !== undefined ? `<a class="btn btn-ghost btn-sm" href="#/drawer">التفاصيل</a>` : ''}</div>
    </div>`);
  }
  if (d.today.profit !== undefined) side.push(`<a href="#/reports" class="kpi bg-lavender" style="color:inherit"><div class="label">${icon('trend')} ربح النهارده</div>
      <div class="value">${n(d.today.profit)} <small>${cur}</small></div>${d.today.net !== undefined ? `<div class="sub">بعد المصاريف ${n(d.today.net)}</div>` : ''}</a>`);

  // 3) Only what needs attention
  const alerts = [
    d.credit?.late > 0 && `<a href="#/customers?filter=late" class="alert-pill bad">${icon('user')} أقساط متأخرة ${n(d.credit.late)} — ${d.credit.late_count} عميل</a>`,
    d.repairs?.ready > 0 && `<a href="#/repairs" class="alert-pill">${icon('wrench')} ${d.repairs.ready} جهاز جاهز للتسليم</a>`,
    d.low_stock > 0 && state.user.role !== 'technician' && `<a href="#/products?low=1" class="alert-pill warn">${icon('alert')} ${d.low_stock} صنف ناقص</a>`,
    d.credit?.due > 0 && !(d.credit.late > 0) && `<a href="#/customers?filter=owing" class="alert-pill">${icon('user')} عند العملاء ${n(d.credit.due)}</a>`,
    d.repairs && !d.repairs.ready && d.repairs.open > 0 && `<a href="#/repairs" class="alert-pill">${icon('wrench')} ${d.repairs.open} جهاز في الصيانة</a>`,
  ].filter(Boolean);

  // 4) Four quick actions
  const quick = [
    can('repairs.create') && `<a href="#/repairs?new=1" class="bg-aqua">${icon('wrench')}استلام صيانة</a>`,
    can('expenses.create') && `<a href="#/expenses?new=1" class="bg-peony">${icon('expense')}مصروف</a>`,
    can('products.edit') && `<a href="#/products?new=1" class="bg-sky">${icon('box')}إضافة منتج</a>`,
    can('purchases.manage') && `<a href="#/purchases?new=1" class="bg-mint">${icon('truck')}شراء بضاعة</a>`,
    can('labels.print') && `<a href="#/labels" class="bg-sky">${icon('tag')}ليبلات</a>`,
    !can('reports.view') && can('sales.create') && `<a href="#/sales" class="bg-lavender">${icon('receipt')}فواتيري</a>`,
  ].filter(Boolean).slice(0, 4).join('');

  el.innerHTML = `
    <div class="card bg-peony hidden" id="loc-banner" style="box-shadow:none;margin-bottom:12px;padding:16px 20px">
      <div class="shift-banner"><span style="flex:1;min-width:200px">📍 <b>الحضور لازم يكون من جوه المحل.</b> فعّل الموقع مرة واحدة عشان تقدر تسجل حضور وانصراف.</span>
      <button class="btn btn-primary btn-sm" id="loc-allow">📍 فعّل الموقع</button></div>
    </div>
    <div class="card bg-aqua hidden" id="shift-banner" style="box-shadow:none;margin-bottom:16px;padding:14px 18px">
      <div class="shift-banner"><span style="flex:1;min-width:200px">${icon('clock', '')} <b>إنت مش مسجل حضور.</b>${state.settings.require_shift === '1' && state.user.role !== 'admin' ? ' لازم تسجل حضور قبل البيع.' : ''}</span>
      <button class="btn btn-primary btn-sm" id="banner-in">${icon('logout')} بدء الشيفت</button></div>
    </div>
    <p class="dash-hello">${greet}، <b>${esc(state.user.full_name.split(' ')[0])}</b> 👋 <span class="muted">${new Date().toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' })}</span></p>
    <div class="dash-top ${side.length ? '' : 'solo'}">${hero}${side.length ? `<div class="dash-side">${side.join('')}</div>` : ''}</div>
    ${alerts.length ? `<div class="dash-alerts"><span class="muted small">محتاج انتباهك:</span>${alerts.join('')}</div>` : ''}
    ${quick ? `<div class="quick dash-quick">${quick}</div>` : ''}
    ${can('expenses.view') ? '<div class="card allow-card" id="allowances"></div>' : ''}
    ${can('sales.create') ? `<div class="card" style="margin-top:16px">
        <div class="card-head"><h2>آخر الفواتير</h2><a href="#/sales" class="btn btn-ghost btn-sm">عرض الكل</a></div>
        <div class="table-wrap"><table class="table"><tbody>
          ${d.recent.length ? d.recent.slice(0, 5).map((s) => `
            <tr class="click" data-id="${s.id}">
              <td><b class="num" style="font-weight:500">${esc(s.invoice_no)}</b><div class="muted small">${fmtDate(s.created_at)}</div></td>
              <td class="small">${esc(s.user_name)}<div class="muted">${PAY_NAMES[s.payment_method] || ''}</div></td>
              <td class="end">${money(s.total)}</td>
            </tr>`).join('') : emptyRow(3, 'لسه مفيش فواتير')}
        </tbody></table></div>
      </div>` : ''}`;

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
  // On a computer that isn't using the installed app yet: offer it once in a while
  const offer = () => {
    if (el.querySelector('.install-banner') || matchMedia('(display-mode: standalone)').matches || matchMedia('(pointer: coarse)').matches) return;
    try { if (Number(localStorage.getItem('mm_install_later') || 0) > Date.now()) return; } catch { /* ignore */ }
    el.insertAdjacentHTML('afterbegin', `<div class="card install-banner"><span>${icon('download')}</span><div><b>ثبّت Mobile Mix كأبلكيشن على الكمبيوتر</b>
      <small class="muted">يفتح من أيقونة على سطح المكتب في نافذة لوحده، وأسرع، ويشتغل من غير نت</small></div>
      <button class="btn btn-primary btn-sm" data-i="go">ثبّت</button><button class="btn btn-ghost btn-sm" data-i="later">بعدين</button></div>`);
    const bn = el.querySelector('.install-banner');
    bn.querySelector('[data-i=go]').addEventListener('click', () => import('../app.js').then((m) => m.installApp()));
    bn.querySelector('[data-i=later]').addEventListener('click', () => { try { localStorage.setItem('mm_install_later', String(Date.now() + 7 * 864e5)); } catch { /* ignore */ } bn.remove(); });
  };
  document.addEventListener('mm:installable', offer, { once: true });
  if (window.matchMedia && !matchMedia('(display-mode: standalone)').matches) setTimeout(() => { if (document.querySelector('[data-act="install"]:not(.hidden)')) offer(); }, 300);
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
  let open = false;
  const draw = (d) => {
    const came = d.list.filter((u) => u.came_at && !u.given);
    const waiting = came.length ? came : d.list.filter((u) => !u.given);
    const givenN = d.list.filter((u) => u.given).length;
    if (!d.list.length) { box.remove(); return; }
    box.innerHTML = `
      <div class="allow-sum">
        <button type="button" class="allow-toggle" aria-expanded="${open}">${icon('coins')}<span><b>يومية الموظفين</b>
          <small class="muted">${givenN ? `اتصرف لـ ${givenN} من ${d.list.length} — ${n(d.total)} ${cur}` : `لسه متصرفتش النهارده (${d.list.length} موظف)`}</small></span>
          <svg class="chev ${open ? 'up' : ''}" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></button>
        ${waiting.length ? `<button class="btn btn-primary btn-sm" id="give-all">اصرف ${waiting.length > 1 ? (came.length ? `للي حضروا (${came.length})` : `للكل (${waiting.length})`) : `لـ ${esc(waiting[0].full_name.split(' ')[0])}`}</button>` : `<span class="pill pill-ok">${icon('check')} اتصرف للكل</span>`}
      </div>
      <div class="allow-body ${open ? '' : 'hidden'}">
      ${d.list.length ? `<div class="allow-list">${d.list.map((u) => `
        <div class="allow-row ${u.given ? 'done' : ''}" data-id="${u.id}">
          <span class="avatar">${esc(u.full_name.trim()[0] || '?')}</span>
          <div class="allow-who"><b>${esc(u.full_name)}</b><span class="small muted">${u.came_at ? `حضر ${esc(u.came_at.slice(11, 16))}` : 'لسه مسجلش حضور'}</span></div>
          ${u.given ? `<span class="allow-given">${icon('check')} اتصرف ${n(u.given)}</span>
            <button class="btn btn-ghost btn-icon btn-sm" data-undo="${u.given_id}" title="إلغاء (غلطة)">${icon('x')}</button>`
            : `<button class="btn btn-primary btn-sm" data-give="${u.id}">اصرف ${n(u.amount)} ${cur}</button>`}
        </div>`).join('')}</div>
`
        : ''}
      <p class="muted small" style="margin:10px 0 0">بتتخصم من الدرج وبتتسجل على كل موظف، بعيد عن المرتب. المعتادة ${n(d.usual)} ${cur}${can('settings.manage') ? ' — <a href="#" id="allow-edit">غيّرها</a>' : ''}.</p>
      </div>`;
    box.querySelector('.allow-toggle').addEventListener('click', () => { open = !open; draw(d); });
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
