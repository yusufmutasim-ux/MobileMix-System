import { api, state, icon, esc, fmtDate, modal, toast, busy, formData, ROLE_NAMES } from '../core.js';

const ROLE_INFO = {
  admin: 'كل الصلاحيات: الموظفين، الإعدادات، النسخ الاحتياطي',
  manager: 'المنتجات والأسعار، الجرد، المرتجعات، التقارير وكل الفواتير',
  cashier: 'البيع وطباعة الفواتير والليبلات — بيشوف فواتيره بس ومن غير سعر الشراء',
};
const ROLE_BG = { admin: 'bg-lavender', manager: 'bg-sky', cashier: 'bg-mint' };

export async function render(el, { actions }) {
  actions.innerHTML = `<button class="btn btn-primary" id="add">${icon('plus')} موظف جديد</button>`;

  async function load() {
    const users = await api.get('/users');
    el.innerHTML = `
      <div class="grid grid-3" style="margin-bottom:24px">
        ${Object.entries(ROLE_INFO).map(([k, v]) => `<div class="kpi ${ROLE_BG[k]}" style="min-height:0"><div class="label">${ROLE_NAMES[k]}</div><div class="sub" style="margin-top:6px">${v}</div></div>`).join('')}
      </div>
      <div class="card"><div class="table-wrap"><table class="table">
        <thead><tr><th>الموظف</th><th>اسم الدخول</th><th>الصلاحية</th><th>الحالة</th><th>تاريخ الإضافة</th><th></th></tr></thead>
        <tbody>${users.map((u) => `
          <tr data-id="${u.id}" style="${u.active ? '' : 'opacity:.55'}">
            <td><div style="display:flex;align-items:center;gap:10px"><span class="avatar">${esc(u.full_name.trim()[0] || '?')}</span><b style="font-weight:500">${esc(u.full_name)}</b>
              ${u.id === state.user.id ? '<span class="pill pill-info">أنت</span>' : ''}</div></td>
            <td class="num">${esc(u.username)}</td>
            <td><span class="pill ${u.role === 'admin' ? 'pill-info' : 'pill-gray'}">${ROLE_NAMES[u.role]}</span></td>
            <td>${u.active ? '<span class="pill pill-ok">نشط</span>' : '<span class="pill pill-bad">موقوف</span>'}</td>
            <td class="small">${fmtDate(u.created_at, false)}</td>
            <td class="end"><button class="btn btn-ghost btn-sm" data-edit>${icon('edit')} تعديل</button></td>
          </tr>`).join('')}</tbody>
      </table></div></div>`;
    el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', async () => {
      const u = users.find((x) => x.id === Number(b.closest('tr').dataset.id));
      if (await userForm(u)) load();
    }));
  }

  actions.querySelector('#add').addEventListener('click', async () => { if (await userForm()) load(); });
  await load();
}

function userForm(u = null) {
  const isNew = !u;
  return modal({
    title: isNew ? 'موظف جديد' : `تعديل — ${esc(u.full_name)}`,
    body: `<form class="form-grid" autocomplete="off" onsubmit="return false">
      <label class="field full"><span>اسم الموظف *</span><input class="input" name="full_name" value="${esc(u?.full_name || '')}"></label>
      ${isNew ? '<label class="field"><span>اسم الدخول (إنجليزي) *</span><input class="input ltr" name="username" autocomplete="off"></label>' : ''}
      <label class="field ${isNew ? '' : 'full'}"><span>الصلاحية</span><select class="input" name="role">
        ${Object.entries(ROLE_NAMES).map(([k, v]) => `<option value="${k}" ${(u?.role || 'cashier') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="field full"><span>${isNew ? 'كلمة السر *' : 'كلمة سر جديدة (سيبها فاضية لو مش هتغيرها)'}</span><input class="input ltr" type="password" name="password" autocomplete="new-password"></label>
      ${!isNew ? `<label class="check full"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> الحساب نشط</label>` : ''}
      <p class="muted small full" id="role-info" style="margin:0"></p>
    </form>`,
    foot: `<button class="btn btn-outline" data-close>إلغاء</button><button class="btn btn-primary" data-ok>${icon('check')} حفظ</button>`,
    onMount: (m, close) => {
      const role = m.querySelector('[name=role]');
      const info = () => { m.querySelector('#role-info').textContent = ROLE_INFO[role.value]; };
      role.addEventListener('change', info);
      info();
      m.querySelector('[data-ok]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const f = formData(m.querySelector('form'));
        if (isNew) await api.post('/users', f);
        else {
          if (!f.password) delete f.password;
          await api.put('/users/' + u.id, f);
        }
        toast('تم الحفظ', 'ok');
        close(true);
      }));
    },
  });
}
