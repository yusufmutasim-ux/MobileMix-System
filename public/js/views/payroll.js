import { api, icon, esc, money, n, modal, toast, toastErr, busy, emptyRow, ROLE_NAMES, todayStr } from '../core.js';

/** Salaries per month: attendance, commission, advances, what's left to pay. */
export async function render(el) {
  let month = todayStr().slice(0, 7);
  el.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <label class="field" style="flex-direction:row;align-items:center;gap:10px"><span>الشهر</span><input class="input num" type="month" id="month" value="${month}"></label>
        <span class="muted small" style="flex:1">المرتب + العمولة على مبيعاته − السلف − اللي اتصرف = الباقي له</span>
      </div>
      <div id="sum" style="margin-bottom:14px"></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>الموظف</th><th>أيام الحضور</th><th>الساعات</th><th>المرتب</th><th>مبيعاته</th><th>العمولة</th><th>السلف</th><th>اتصرف</th><th>الباقي له</th><th></th></tr></thead>
        <tbody id="rows"></tbody></table></div>
    </div>`;
  const $ = (s) => el.querySelector(s);
  let data;

  async function load() {
    data = await api.get('/payroll?month=' + month);
    const t = data.totals;
    $('#sum').innerHTML = `<div class="grid grid-4">
      <div class="kpi" style="min-height:0"><div class="label">المرتبات</div><div class="value">${money(t.salary)}</div></div>
      <div class="kpi bg-mint" style="min-height:0"><div class="label">العمولات</div><div class="value">${money(t.commission)}</div></div>
      <div class="kpi" style="min-height:0"><div class="label">سلف + اتصرف</div><div class="value">${money(t.advances + t.paid)}</div></div>
      <div class="kpi bg-lavender" style="min-height:0"><div class="label">الباقي للموظفين</div><div class="value">${money(t.due)}</div></div></div>`;
    $('#rows').innerHTML = data.rows.length ? data.rows.map((r) => `<tr data-id="${r.id}" style="${r.active ? '' : 'opacity:.55'}">
      <td><b style="font-weight:500">${esc(r.full_name)}</b><div class="muted small">${ROLE_NAMES[r.role] || ''}${r.commission_pct ? ` • عمولة ${r.commission_pct}%` : ''}</div></td>
      <td class="num">${r.days}${r.late_count ? `<div class="small" style="color:var(--t-yellow-fg)">تأخير ${r.late_count}</div>` : ''}</td><td class="num">${n(r.hours)}</td>
      <td>${r.salary ? money(r.salary) : '<span class="muted small">مش متحدد</span>'}</td>
      <td>${money(r.sales)}</td><td>${money(r.commission)}</td><td>${money(r.advances)}</td><td>${money(r.paid)}</td>
      <td><b style="${r.due > 0 ? 'color:var(--danger)' : ''}">${money(r.due)}</b></td>
      <td class="end" style="white-space:nowrap">
        <button class="btn btn-ghost btn-sm" data-a="set" title="المرتب والعمولة">${icon('settings')}</button>
        <button class="btn btn-outline btn-sm" data-a="advance">سلفة</button>
        <button class="btn btn-primary btn-sm" data-a="pay" ${r.due > 0 ? '' : 'disabled'}>صرف</button></td>
    </tr>`).join('') : emptyRow(10, 'ضيف موظفين الأول');
  }

  $('#rows').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-a]');
    if (!b) return;
    const r = data.rows.find((x) => x.id === Number(b.closest('tr').dataset.id));
    const ok = b.dataset.a === 'set' ? await settingsModal(r) : await payModal(r, b.dataset.a, month);
    if (ok) load().catch(toastErr);
  });
  $('#month').addEventListener('change', () => { month = $('#month').value || month; load().catch(toastErr); });
  await load();
}

function settingsModal(r) {
  return modal({
    title: `المرتب والعمولة — ${esc(r.full_name)}`,
    body: `<div class="form-grid">
      <label class="field"><span>المرتب الشهري</span><input class="input num" type="number" min="0" step="any" id="salary" value="${r.salary || ''}" autofocus></label>
      <label class="field"><span>عمولة على مبيعاته (%)</span><input class="input num" type="number" min="0" max="50" step="any" id="pct" value="${r.commission_pct || ''}" placeholder="0"></label>
      <p class="muted small full" style="margin:0">العمولة بتتحسب على صافي مبيعاته في الشهر (بعد الخصم والمرتجعات).</p>
    </div>`,
    foot: `<button class="btn btn-outline" data-close>إلغاء</button><button class="btn btn-primary" data-ok>${icon('check')} حفظ</button>`,
    onMount: (m, close) => m.querySelector('[data-ok]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      await api.put('/payroll/' + r.id, { salary: m.querySelector('#salary').value, commission_pct: m.querySelector('#pct').value });
      toast('تم الحفظ', 'ok');
      close(true);
    })),
  });
}

function payModal(r, kind, month) {
  const isPay = kind === 'pay';
  return modal({
    title: `${isPay ? 'صرف مرتب' : 'سلفة'} — ${esc(r.full_name)}`,
    body: `<div class="form-grid">
      ${isPay ? `<div class="full kpi bg-lavender" style="min-height:0"><div class="label">الباقي له عن ${esc(month)}</div><div class="value">${money(r.due)}</div></div>` : ''}
      <label class="field"><span>المبلغ *</span><input class="input input-lg num" type="number" min="0" step="any" id="amount" value="${isPay ? r.due : ''}" autofocus></label>
      <label class="field"><span>ملاحظة</span><input class="input" id="note"></label>
      <label class="check full"><input type="checkbox" id="drawer" checked> اتدفع كاش من الدرج</label>
      <p class="muted small full" style="margin:0">${isPay ? 'بيتسجل كمصروف "مرتبات".' : 'السلفة بتتخصم من مرتب الشهر ده، وبتتسجل كمصروف "سلفة".'}</p>
    </div>`,
    foot: `<button class="btn btn-outline" data-close>إلغاء</button><button class="btn btn-primary" data-ok>${icon('check')} حفظ</button>`,
    onMount: (m, close) => m.querySelector('[data-ok]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      await api.post(`/payroll/${r.id}/${kind}`, { amount: m.querySelector('#amount').value, note: m.querySelector('#note').value, from_drawer: m.querySelector('#drawer').checked, month });
      toast('اتسجل', 'ok');
      close(true);
    })),
  });
}
