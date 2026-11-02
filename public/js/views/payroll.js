import { api, state, icon, esc, money, n, modal, toast, toastErr, busy, emptyRow, ROLE_NAMES, todayStr } from '../core.js';

/** Salaries per month: attendance, commission, advances, what's left to pay. */
export async function render(el) {
  let month = todayStr().slice(0, 7);
  el.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <label class="field" style="flex-direction:row;align-items:center;gap:10px"><span>الشهر</span><input class="input num" type="month" id="month" value="${month}"></label>
        <span class="muted small" style="flex:1">المرتب + العمولة − الخصم (غياب وتأخير) − السلف − اللي اتصرف = الباقي له</span>
      </div>
      <div id="sum" style="margin-bottom:14px"></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>الموظف</th><th>أيام الحضور</th><th>الساعات</th><th>المرتب</th><th title="غياب وتأخير — بيتخصم لوحده">الخصم</th><th>مبيعاته</th><th>العمولة</th><th>السلف</th><th>اتصرف</th><th>الباقي له</th><th title="بتتصرف كل يوم وبعيد عن المرتب">اليوميات</th><th></th></tr></thead>
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
      <div class="kpi" style="min-height:0"><div class="label">سلف + اتصرف</div><div class="value">${money(t.advances + t.paid)}</div>${t.deduction ? `<div class="sub">خصومات غياب وتأخير: ${money(t.deduction)}</div>` : ''}</div>
      <div class="kpi bg-lavender" style="min-height:0"><div class="label">الباقي للموظفين</div><div class="value">${money(t.due)}</div></div></div>
      ${t.allowances ? `<p class="muted small" style="margin:10px 0 0">اليوميات اللي اتصرفت الشهر ده: <b>${money(t.allowances)}</b> — بعيد عن المرتبات.</p>` : ''}`;
    $('#rows').innerHTML = data.rows.length ? data.rows.map((r) => `<tr data-id="${r.id}" style="${r.active ? '' : 'opacity:.55'}">
      <td><b style="font-weight:500">${esc(r.full_name)}</b><div class="muted small">${ROLE_NAMES[r.role] || ''}${r.commission_pct ? ` • عمولة ${r.commission_pct}%` : ''}</div></td>
      <td class="num">${r.days}${r.absent_count || r.late_count ? `<div class="small"><a href="#" data-att="${r.id}" class="att-link">${r.absent_count ? `<span style="color:var(--danger)">غياب ${r.absent_count}</span>` : ''}${r.absent_count && r.late_count ? ' • ' : ''}${r.late_count ? `<span style="color:var(--t-yellow-fg)">تأخير ${r.late_count}</span>` : ''}</a></div>` : ''}</td><td class="num">${n(r.hours)}</td>
      <td>${r.salary ? money(r.salary) : '<span class="muted small">مش متحدد</span>'}</td>
      <td>${r.deduction ? `<a href="#" data-att="${r.id}" style="color:var(--danger)">- ${money(r.deduction)}</a>` : '<span class="muted small">—</span>'}</td>
      <td>${money(r.sales)}</td><td>${money(r.commission)}</td><td>${money(r.advances)}</td><td>${money(r.paid)}</td>
      <td><b style="${r.due > 0 ? 'color:var(--danger)' : ''}">${money(r.due)}</b></td>
      <td>${r.allowances ? money(r.allowances) : '<span class="muted small">—</span>'}<div class="muted small">${r.daily_allowance != null ? `يوميته ${n(r.daily_allowance)}` : ''}</div></td>
      <td class="end" style="white-space:nowrap">
        <button class="btn btn-ghost btn-sm" data-a="set" title="المرتب والعمولة">${icon('settings')}</button>
        <button class="btn btn-outline btn-sm" data-a="advance">سلفة</button>
        <button class="btn btn-primary btn-sm" data-a="pay" ${r.due > 0 ? '' : 'disabled'}>صرف</button></td>
    </tr>`).join('') : emptyRow(12, 'ضيف موظفين الأول');
  }

  $('#rows').addEventListener('click', async (e) => {
    const att = e.target.closest('[data-att]');
    if (att) { e.preventDefault(); await attendanceModal(Number(att.dataset.att), month); load().catch(toastErr); return; }
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
      <label class="field"><span>اليومية (بعيد عن المرتب)</span><input class="input num" type="number" min="0" step="any" id="daily" value="${r.daily_allowance ?? ''}" placeholder="المعتادة ${esc(state.settings.daily_allowance || '100')}"></label>
      <p class="muted small full" style="margin:0">العمولة بتتحسب على صافي مبيعاته في الشهر (بعد الخصم والمرتجعات).</p>
    </div>`,
    foot: `<button class="btn btn-outline" data-close>إلغاء</button><button class="btn btn-primary" data-ok>${icon('check')} حفظ</button>`,
    onMount: (m, close) => m.querySelector('[data-ok]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      await api.put('/payroll/' + r.id, { salary: m.querySelector('#salary').value, commission_pct: m.querySelector('#pct').value, daily_allowance: m.querySelector('#daily').value });
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

/** Absent and late days for one person this month — each can be excused (no deduction). */
async function attendanceModal(id, month) {
  const fmt = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });
  return modal({
    title: 'الغياب والتأخير',
    body: '<div id="att-body"><div class="empty loading"><span></span><span></span><span></span></div></div>',
    foot: '<button class="btn btn-primary" data-close>تمام</button>',
    onMount: (m) => {
      const draw = async () => {
        const d = await api.get(`/payroll/${id}/attendance?month=${month}`);
        const r = d.row;
        const rate = (r.salary || 0) / 30;
        const st = state.settings;
        const lateSet = new Set(d.excused.map((x) => x.day));
        const line = (day, kind, extra, excused) => `<div class="att-row ${excused ? 'ok' : ''}"><span><b>${fmt(day)}</b><small>${kind}${extra ? ` — ${extra}` : ''}</small></span>
          <button class="btn btn-sm ${excused ? 'btn-ghost' : 'btn-outline'}" data-day="${day}" data-ex="${excused ? '0' : '1'}">${excused ? 'إلغاء الإعفاء' : 'اعفي'}</button></div>`;
        m.querySelector('#att-body').innerHTML = `
          <p style="margin-top:0"><b>${esc(r.full_name)}</b> — الخصم الشهر ده: <b style="color:var(--danger)">${money(r.deduction)}</b></p>
          <p class="muted small" style="margin-top:-6px">يوم الغياب = ${n(rate * (Number(st.absence_deduct_days) || 1))}، يوم التأخير (بعد ${esc(st.late_grace || '15')} دقيقة سماح) = ${n(rate * (Number(st.late_deduct_days) || 0.25))} — على أساس المرتب ÷ 30.</p>
          <div class="att-list">
            ${r.absent_days.map((day) => line(day, 'غياب', '', false)).join('')}
            ${d.late.filter((x) => !lateSet.has(x.day)).map((x) => line(x.day, 'تأخير', `${x.minutes} دقيقة`, false)).join('')}
            ${d.excused.map((x) => line(x.day, 'معفي', esc(x.note || ''), true)).join('')}
            ${!r.absent_days.length && !d.late.length && !d.excused.length ? '<div class="empty">مفيش غياب ولا تأخير الشهر ده 👌</div>' : ''}
          </div>`;
        m.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => busy(b, async () => {
          await api.post(`/payroll/${id}/excuse`, { day: b.dataset.day, excused: b.dataset.ex === '1' });
          await draw();
        })));
      };
      draw().catch(toastErr);
    },
  });
}
