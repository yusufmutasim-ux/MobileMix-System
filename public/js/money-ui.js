// Small money windows used from several screens (drawer, expenses, home).
import { api, state, can, icon, esc, money, n, modal, toast, busy, formData, COLLECT_METHODS } from './core.js';

export const categories = () => String(state.settings.expense_categories || 'أخرى').split('\n').map((c) => c.trim()).filter(Boolean)
  .filter((c) => (can('payroll') ? true : c !== 'مرتبات' && c !== 'سلفة'));

/** Record an expense. Resolves true when saved. */
export function expenseModal() {
  const manager = can('expenses.view');
  return modal({
    title: 'تسجيل مصروف',
    body: `<form class="form-grid" autocomplete="off" onsubmit="return false">
      <label class="field"><span>المبلغ *</span><input class="input num" type="number" min="0" step="any" name="amount" inputmode="decimal" autofocus></label>
      <label class="field"><span>النوع *</span><select class="input" name="category">${categories().map((c) => `<option>${esc(c)}</option>`).join('')}</select></label>
      <label class="field full"><span>تفاصيل</span><input class="input" name="note" placeholder="مثلاً: فاتورة الكهربا شهر 10"></label>
      ${manager ? `<label class="check full"><input type="checkbox" name="from_drawer" checked> اتدفع كاش من الدرج</label>` : '<p class="muted small full" style="margin:0">المبلغ هيتخصم من الدرج.</p>'}
    </form>`,
    foot: `<button class="btn btn-outline" data-close>إلغاء</button><button class="btn btn-primary" data-ok>${icon('check')} حفظ</button>`,
    onMount: (m, close) => {
      const save = (e) => busy(m.querySelector('[data-ok]'), async () => {
        e?.preventDefault?.();
        const f = formData(m.querySelector('form'));
        await api.post('/expenses', f);
        toast('اتسجل المصروف', 'ok');
        close(true);
      });
      m.querySelector('[data-ok]').addEventListener('click', save);
      m.querySelector('[name=amount]').addEventListener('keydown', (e) => { if (e.key === 'Enter') save(e); });
    },
  });
}

const PARTS = {
  sales: 'مبيعات كاش (ومقدمات التقسيط)',
  collections: 'تحصيل من العملاء',
  repairs: 'فلوس الصيانة',
  refunds: 'مرتجعات اترجعت كاش',
  expenses: 'مصروفات من الدرج',
  suppliers: 'دفع للموردين من الدرج',
  moves_in: 'إيداع في الدرج',
  moves_out: 'سحب من الدرج',
};

/** What should be in the drawer, line by line. */
export function drawerBreakdown(d) {
  const rows = Object.entries(PARTS).filter(([k]) => d.parts[k]).map(([k, label]) =>
    `<div class="line-row"><span>${label}</span><b class="num ${d.parts[k] < 0 ? 'neg' : ''}">${d.parts[k] > 0 ? '+' : ''}${n(d.parts[k])}</b></div>`).join('');
  return `<div class="breakdown">
    <div class="line-row"><span>اللي كان في الدرج${d.from ? '' : ' (أول مرة)'}</span><b class="num">${n(d.opening)}</b></div>
    ${rows || '<div class="muted small" style="padding:6px 0">مفيش حركة كاش من آخر تقفيل</div>'}
    <div class="line-row total"><span>المفروض في الدرج دلوقتي</span><b>${money(d.expected)}</b></div>
  </div>`;
}

/** Count the drawer and close it. */
export async function closeDrawerModal() {
  const d = await api.get('/drawer');
  return modal({
    title: 'تقفيل الدرج',
    body: `${d.blind ? '<p class="muted" style="margin-top:0">عدّ الفلوس اللي في الدرج كلها واكتب المبلغ — السيستم هيقارنه باللي المفروض يكون موجود.</p>' : drawerBreakdown(d)}
      <div class="form-grid" style="margin-top:14px">
        <label class="field"><span>عدّيت كام في الدرج؟ *</span><input class="input input-lg num" type="number" min="0" step="any" id="counted" inputmode="decimal" autofocus></label>
        <label class="field"><span>هتسيب كام في الدرج للي بعدك؟</span><input class="input input-lg num" type="number" min="0" step="any" id="left" inputmode="decimal" placeholder="= كله"></label>
        <div class="full" id="diff"></div>
        <label class="field full"><span>ملاحظة</span><input class="input" id="note" placeholder="اختياري"></label>
      </div>`,
    foot: `<button class="btn btn-outline" data-close>إلغاء</button><button class="btn btn-primary" data-ok>${icon('check')} قفّل الدرج</button>`,
    onMount: (m, close) => {
      const counted = m.querySelector('#counted');
      const show = () => {
        const box = m.querySelector('#diff');
        if (counted.value === '' || d.blind) { box.innerHTML = ''; return; }
        const diff = Number(counted.value) - d.expected;
        box.innerHTML = Math.abs(diff) < 0.5
          ? '<div class="note-ok">✅ الدرج مظبوط</div>'
          : diff < 0 ? `<div class="note-bad">⚠️ عجز ${money(-diff)}</div>` : `<div class="note-warn">زيادة ${money(diff)}</div>`;
      };
      counted.addEventListener('input', show);
      m.querySelector('[data-ok]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        if (counted.value === '') throw new Error('اكتب المبلغ اللي عدّيته');
        const left = m.querySelector('#left').value;
        const r = await api.post('/drawer/close', { counted: Number(counted.value), left_in_drawer: left === '' ? undefined : Number(left), note: m.querySelector('#note').value });
        toast(Math.abs(r.diff) < 0.5 ? 'اتقفل الدرج — مظبوط ✅' : r.diff < 0 ? `اتقفل الدرج — عجز ${n(-r.diff)}` : `اتقفل الدرج — زيادة ${n(r.diff)}`, Math.abs(r.diff) < 0.5 ? 'ok' : 'err');
        close(true);
      }));
    },
  });
}

/** Owner puts money into / takes money out of the drawer. */
export function moveModal(kind) {
  return modal({
    title: kind === 'in' ? 'إيداع في الدرج' : 'سحب من الدرج',
    body: `<div class="form-grid">
      <label class="field full"><span>المبلغ *</span><input class="input input-lg num" type="number" min="0" step="any" id="amount" inputmode="decimal" autofocus></label>
      <label class="field full"><span>ملاحظة</span><input class="input" id="note" placeholder="${kind === 'in' ? 'مثلاً: فكة' : 'مثلاً: المالك خد الإيراد'}"></label>
    </div>`,
    foot: `<button class="btn btn-outline" data-close>إلغاء</button><button class="btn btn-primary" data-ok>${icon('check')} حفظ</button>`,
    onMount: (m, close) => {
      m.querySelector('[data-ok]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        await api.post('/drawer/move', { kind, amount: m.querySelector('#amount').value, note: m.querySelector('#note').value });
        toast('اتسجل', 'ok');
        close(true);
      }));
    },
  });
}

/** Take money from a customer (on one invoice or spread over everything they owe). */
export function payModal({ title, due, suggest, url }) {
  return modal({
    title,
    body: `<div class="form-grid">
      <div class="full kpi bg-lavender" style="min-height:0"><div class="label">المتبقي</div><div class="value">${money(due)}</div></div>
      <label class="field"><span>المبلغ *</span><input class="input input-lg num" type="number" min="0" step="any" id="amount" inputmode="decimal" value="${suggest ? Number(suggest.toFixed(2)) : ''}" autofocus></label>
      <label class="field"><span>طريقة الدفع</span><select class="input" id="method">${Object.entries(COLLECT_METHODS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <div class="full btn-row"><button type="button" class="btn btn-ghost btn-sm" id="all">ادفع كله (${n(due)})</button></div>
      <label class="field full"><span>ملاحظة</span><input class="input" id="note" placeholder="اختياري"></label>
    </div>`,
    foot: `<button class="btn btn-outline" data-close>إلغاء</button><button class="btn btn-primary" data-ok>${icon('check')} استلام</button>`,
    onMount: (m, close) => {
      m.querySelector('#all').addEventListener('click', () => { m.querySelector('#amount').value = due; });
      m.querySelector('[data-ok]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        await api.post(url, { amount: m.querySelector('#amount').value, method: m.querySelector('#method').value, note: m.querySelector('#note').value });
        toast('اتسجل التحصيل', 'ok');
        close(true);
      }));
    },
  });
}
