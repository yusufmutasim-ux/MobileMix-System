import { api, can, icon, esc, money, n, fmtDate, emptyRow, toast, fmtShopTime } from '../core.js';
import { drawerBreakdown, closeDrawerModal, expenseModal, moveModal, forgotModal, dayLabel, editClosingModal } from '../money-ui.js';

/** The cash drawer: what should be in it now, closing (counting) it, and the history. */
export async function render(el, { query, actions }) {
  const manager = can('drawer.view');
  actions.innerHTML = `
    <button class="btn btn-primary" id="close">${icon('check')} قفّل الدرج</button>
    ${can('expenses.create') ? `<button class="btn btn-outline" id="exp">${icon('expense')} مصروف</button>` : ''}
    ${manager ? `<button class="btn btn-outline" id="forgot-top">${icon('plus')} نسيت حاجة؟</button>` : ''}
    ${manager ? `<button class="btn btn-outline" id="in">${icon('arrowIn')} إيداع</button><button class="btn btn-outline" id="out">${icon('arrowOut')} سحب</button>` : ''}`;

  let lastClose = null;
  // The oldest forgotten day first: each closing covers from the last one to the end of that day
  const bindMissed = (missed) => el.querySelector('#close-missed')?.addEventListener('click', async () => {
    if (await closeDrawerModal({ day: missed[missed.length - 1] })) load();
  });
  const openForgot = () => {
    if (!lastClose) return toast('لسه مفيش تقفيلة درج — سجّلها عادي من زرار "مصروف" أو "سحب" وهتتحسب على الدرج الحالي', 'err');
    forgotModal(fmtShopTime(lastClose));
  };
  async function load() {
    const d = await api.get('/drawer');
    const missed = d.open_days || [];
    const banner = missed.length ? `<div class="card missed-close"><div>${icon('alert')} <b>لسه ماتقفلش درج ${missed.length > 1 ? `${missed.length} أيام` : `يوم ${dayLabel(missed[0])}`}</b>
        <div class="muted small">قفّله دلوقتي عشان فلوس ${missed.length > 1 ? 'الأيام دي' : 'اليوم ده'} ماتتخلطش بفلوس النهارده.</div></div>
        <button class="btn btn-primary btn-sm" id="close-missed">قفّل يوم ${dayLabel(missed[missed.length - 1])}</button></div>` : '';
    if (d.blind) {
      el.innerHTML = banner + `<div class="card drawer-hero" style="max-width:560px">
        <h2 style="margin-top:0">${icon('drawer')} تقفيل الدرج</h2>
        <p class="muted">في آخر الشيفت: عدّ الفلوس اللي في الدرج، ودوس "قفّل الدرج" واكتب المبلغ. السيستم بيقارنه باللي المفروض يكون موجود ويبلّغ المدير.</p>
        <div class="muted small">${d.from ? `آخر تقفيل: ${fmtShopTime(d.from)}` : 'لسه ماتقفلش الدرج قبل كده'}</div>
      </div>`;
      bindMissed(missed);
      return;
    }
    el.innerHTML = banner + `
      <div class="grid grid-2" style="align-items:start">
        <div class="card drawer-hero">
          <div class="muted small">المفروض في الدرج دلوقتي</div>
          <div class="hero-amount">${money(d.expected)}</div>
          <div class="muted small">${d.from ? `من آخر تقفيل: ${fmtShopTime(d.from)}` : 'لسه ماتقفلش الدرج قبل كده'}</div>
          ${drawerBreakdown(d)}
        </div>
        ${manager ? `<div class="card">
          <div class="card-head"><h2>حركة الدرج من آخر تقفيل</h2></div>
          ${[...d.expenses.map((e) => ({ at: e.created_at, text: `مصروف — ${esc(e.category)}${e.note ? ` (${esc(e.note)})` : ''}`, by: e.user_name, amount: -e.amount })),
            ...d.moves.map((m) => ({ at: m.created_at, text: m.kind === 'in' ? `إيداع${m.note ? ` — ${esc(m.note)}` : ''}` : `سحب${m.note ? ` — ${esc(m.note)}` : ''}`, by: m.user_name, amount: m.kind === 'in' ? m.amount : -m.amount }))]
            .sort((a, b) => b.at.localeCompare(a.at))
            .map((x) => `<div class="line-row"><span>${x.text}<div class="muted small">${fmtDate(x.at)} • ${esc(x.by || '')}</div></span><b class="num ${x.amount < 0 ? 'neg' : ''}">${x.amount > 0 ? '+' : ''}${n(x.amount)}</b></div>`).join('')
            || '<div class="empty">مفيش مصروفات أو سحب من آخر تقفيل</div>'}
        </div>` : ''}
      </div>
      ${manager ? `<div class="card" style="margin-top:18px">
        <div class="card-head"><h2>التقفيلات السابقة</h2>${d.closings.length ? `<button class="btn btn-outline btn-sm" id="forgot">${icon('plus')} نسيت حاجة قبل آخر تقفيل؟</button>` : ''}</div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>التاريخ</th><th>الموظف</th><th>المفروض</th><th>اتعد</th><th>الفرق</th><th>اتساب في الدرج</th><th>ملاحظة</th><th></th></tr></thead>
          <tbody>${d.closings.length ? d.closings.map((c) => `<tr>
            <td class="small">${fmtShopTime(c.closed_at)}</td><td>${esc(c.user_name || '')}</td>
            <td>${money(c.expected)}</td><td>${money(c.counted)}</td>
            <td>${Math.abs(c.diff) < 0.5 ? '<span class="pill pill-ok">مظبوط</span>' : c.diff < 0 ? `<span class="pill pill-bad">عجز ${n(-c.diff)}</span>` : `<span class="pill pill-warn">زيادة ${n(c.diff)}</span>`}</td>
            <td>${money(c.left_in_drawer)}</td><td class="small">${esc(c.note || '')}</td>
            <td class="end"><button class="btn btn-ghost btn-sm" data-edit-close="${c.id}">${icon('edit')} تعديل</button></td></tr>`).join('') : emptyRow(8, 'لسه مفيش تقفيلات')}</tbody>
        </table></div>
      </div>` : ''}`;
    lastClose = d.closings[0]?.closed_at || null;
    bindMissed(missed);
    el.querySelector('#forgot')?.addEventListener('click', openForgot);
    el.querySelectorAll('[data-edit-close]').forEach((b) => b.addEventListener('click', async () => {
      const c = d.closings.find((x) => x.id === Number(b.dataset.editClose));
      if (await editClosingModal(c, c.id === d.closings[0].id)) load();
    }));
  }

  actions.querySelector('#close').addEventListener('click', async () => { if (await closeDrawerModal()) load(); });
  actions.querySelector('#exp')?.addEventListener('click', async () => { if (await expenseModal()) load(); });
  actions.querySelector('#forgot-top')?.addEventListener('click', openForgot);
  actions.querySelector('#in')?.addEventListener('click', async () => { if (await moveModal('in')) load(); });
  actions.querySelector('#out')?.addEventListener('click', async () => { if (await moveModal('out')) load(); });
  // After adding something to a closing: reload, then open that closing again with its new numbers
  const onChange = async (e) => {
    await load();
    const id = e?.detail?.reopen;
    if (id) el.querySelector(`[data-edit-close="${id}"]`)?.click();
  };
  document.addEventListener('mm:drawer-changed', onChange);
  await load();
  if (query.get('forgot') && manager) openForgot();
  if (query.get('closing') && manager) setTimeout(() => el.querySelector(`[data-edit-close="${query.get('closing')}"]`)?.click(), 50);
  if (query.get('close')) closeDrawerModal().then((ok) => ok && load());
  return () => document.removeEventListener('mm:drawer-changed', onChange);
}
