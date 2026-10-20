import { api, can, state, icon, esc, money, fmtDate, toastErr, confirmBox, toast, emptyRow, downloadCsv, todayStr } from '../core.js';
import { RANGES, RANGE_NAMES } from './sales.js';
import { expenseModal, categories } from '../money-ui.js';

/** Expenses: rent, bills, food, salaries… with totals per kind. */
export async function render(el, { query, actions }) {
  const manager = can('expenses.view');
  let [from, to] = RANGES.month();
  let data = { rows: [], by_category: [], total: 0 };
  actions.innerHTML = `${manager ? `<button class="btn btn-outline btn-sm" id="csv">${icon('download')} تصدير Excel</button>` : ''}
    <button class="btn btn-primary" id="add">${icon('plus')} مصروف جديد</button>`;

  el.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <div class="seg" id="range">${Object.entries(RANGE_NAMES).map(([k, v]) => `<button data-r="${k}" class="${k === 'month' ? 'on' : ''}">${v}</button>`).join('')}</div>
        <input class="input num" type="date" id="from" value="${from}"> <input class="input num" type="date" id="to" value="${to}">
        <select class="input" id="cat"><option value="">كل الأنواع</option>${categories().map((c) => `<option>${esc(c)}</option>`).join('')}</select>
      </div>
      <div id="sum" style="margin-bottom:16px"></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>التاريخ</th><th>النوع</th><th>التفاصيل</th><th>سجّله</th><th>من الدرج</th><th class="end">المبلغ</th><th></th></tr></thead>
        <tbody id="rows"></tbody>
      </table></div>
    </div>`;
  const $ = (s) => el.querySelector(s);

  async function load() {
    const p = new URLSearchParams({ from, to });
    if ($('#cat').value) p.set('category', $('#cat').value);
    data = await api.get('/expenses?' + p);
    $('#sum').innerHTML = `
      <div class="grid grid-3">
        <div class="kpi bg-lavender" style="min-height:0"><div class="label">${icon('expense')} إجمالي المصروفات</div><div class="value">${money(data.total)}</div></div>
        <div class="kpi" style="min-height:0"><div class="label">عدد المصروفات</div><div class="value">${data.rows.length}</div></div>
        <div class="kpi" style="min-height:0"><div class="label">أكبر بند</div><div class="value" style="font-size:20px">${data.by_category[0] ? `${esc(data.by_category[0].category)}` : '—'}</div>
          ${data.by_category[0] ? `<div class="sub">${money(data.by_category[0].total)}</div>` : ''}</div>
      </div>
      ${data.by_category.length > 1 ? `<div class="chips" style="margin-top:12px">${data.by_category.map((c) => `<span class="chip">${esc(c.category)} <b class="num">${money(c.total)}</b></span>`).join('')}</div>` : ''}`;
    const today = todayStr();
    $('#rows').innerHTML = data.rows.length ? data.rows.map((r) => `
      <tr data-id="${r.id}">
        <td class="small">${fmtDate(r.created_at)}</td>
        <td><span class="pill pill-gray">${esc(r.category)}</span></td>
        <td>${esc(r.note || '')}${r.employee_name ? `<div class="muted small">${esc(r.employee_name)}${r.period ? ` — ${esc(r.period)}` : ''}</div>` : ''}</td>
        <td class="small">${esc(r.user_name || '')}</td>
        <td>${r.from_drawer ? '<span class="pill pill-info">من الدرج</span>' : '<span class="muted small">من برة</span>'}</td>
        <td class="end"><b>${money(r.amount)}</b></td>
        <td class="end">${manager || (r.user_id === state.user.id && r.created_at.slice(0, 10) === today)
          ? `<button class="btn btn-ghost btn-sm" data-del title="مسح">${icon('trash')}</button>` : ''}</td>
      </tr>`).join('') : emptyRow(7, 'مفيش مصروفات في الفترة دي');
  }

  $('#rows').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    const row = data.rows.find((r) => r.id === Number(b.closest('tr').dataset.id));
    if (!(await confirmBox(`تمسح مصروف "${esc(row.category)}" بمبلغ ${money(row.amount)}؟`, { ok: 'مسح', danger: true }))) return;
    try { await api.del('/expenses/' + row.id); toast('اتمسح', 'ok'); load(); } catch (err) { toastErr(err); }
  });
  $('#range').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    [from, to] = RANGES[b.dataset.r]();
    $('#from').value = from; $('#to').value = to;
    $('#range').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    load().catch(toastErr);
  });
  const onDate = () => {
    from = $('#from').value || todayStr(); to = $('#to').value || from;
    $('#range').querySelectorAll('button').forEach((x) => x.classList.remove('on'));
    load().catch(toastErr);
  };
  $('#from').addEventListener('change', onDate);
  $('#to').addEventListener('change', onDate);
  $('#cat').addEventListener('change', () => load().catch(toastErr));
  actions.querySelector('#add').addEventListener('click', async () => { if (await expenseModal()) load(); });
  actions.querySelector('#csv')?.addEventListener('click', () => downloadCsv(`expenses-${from}-${to}.csv`,
    ['التاريخ', 'النوع', 'التفاصيل', 'الموظف', 'سجله', 'من الدرج', 'المبلغ'],
    data.rows.map((r) => [r.created_at, r.category, r.note, r.employee_name, r.user_name, r.from_drawer ? 'نعم' : 'لا', r.amount])));
  await load();
  if (query.get('new')) expenseModal().then((ok) => ok && load());
}
