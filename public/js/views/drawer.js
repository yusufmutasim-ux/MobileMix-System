import { api, can, icon, esc, money, n, fmtDate, emptyRow } from '../core.js';
import { drawerBreakdown, closeDrawerModal, expenseModal, moveModal } from '../money-ui.js';

/** The cash drawer: what should be in it now, closing (counting) it, and the history. */
export async function render(el, { query, actions }) {
  const manager = can('drawer.view');
  actions.innerHTML = `
    <button class="btn btn-primary" id="close">${icon('check')} قفّل الدرج</button>
    ${can('expenses.create') ? `<button class="btn btn-outline" id="exp">${icon('expense')} مصروف</button>` : ''}
    ${manager ? `<button class="btn btn-outline" id="in">${icon('arrowIn')} إيداع</button><button class="btn btn-outline" id="out">${icon('arrowOut')} سحب</button>` : ''}`;

  async function load() {
    const d = await api.get('/drawer');
    if (d.blind) {
      el.innerHTML = `<div class="card drawer-hero" style="max-width:560px">
        <h2 style="margin-top:0">${icon('drawer')} تقفيل الدرج</h2>
        <p class="muted">في آخر الشيفت: عدّ الفلوس اللي في الدرج، ودوس "قفّل الدرج" واكتب المبلغ. السيستم بيقارنه باللي المفروض يكون موجود ويبلّغ المدير.</p>
        <div class="muted small">${d.from ? `آخر تقفيل: ${fmtDate(d.from)}` : 'لسه ماتقفلش الدرج قبل كده'}</div>
      </div>`;
      return;
    }
    el.innerHTML = `
      <div class="grid grid-2" style="align-items:start">
        <div class="card drawer-hero">
          <div class="muted small">المفروض في الدرج دلوقتي</div>
          <div class="hero-amount">${money(d.expected)}</div>
          <div class="muted small">${d.from ? `من آخر تقفيل: ${fmtDate(d.from)}` : 'لسه ماتقفلش الدرج قبل كده'}</div>
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
        <div class="card-head"><h2>التقفيلات السابقة</h2></div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>التاريخ</th><th>الموظف</th><th>المفروض</th><th>اتعد</th><th>الفرق</th><th>اتساب في الدرج</th><th>ملاحظة</th></tr></thead>
          <tbody>${d.closings.length ? d.closings.map((c) => `<tr>
            <td class="small">${fmtDate(c.closed_at)}</td><td>${esc(c.user_name || '')}</td>
            <td>${money(c.expected)}</td><td>${money(c.counted)}</td>
            <td>${Math.abs(c.diff) < 0.5 ? '<span class="pill pill-ok">مظبوط</span>' : c.diff < 0 ? `<span class="pill pill-bad">عجز ${n(-c.diff)}</span>` : `<span class="pill pill-warn">زيادة ${n(c.diff)}</span>`}</td>
            <td>${money(c.left_in_drawer)}</td><td class="small">${esc(c.note || '')}</td></tr>`).join('') : emptyRow(7, 'لسه مفيش تقفيلات')}</tbody>
        </table></div>
      </div>` : ''}`;
  }

  actions.querySelector('#close').addEventListener('click', async () => { if (await closeDrawerModal()) load(); });
  actions.querySelector('#exp')?.addEventListener('click', async () => { if (await expenseModal()) load(); });
  actions.querySelector('#in')?.addEventListener('click', async () => { if (await moveModal('in')) load(); });
  actions.querySelector('#out')?.addEventListener('click', async () => { if (await moveModal('out')) load(); });
  await load();
  if (query.get('close')) closeDrawerModal().then((ok) => ok && load());
}
