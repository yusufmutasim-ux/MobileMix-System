// Small money windows used from several screens (drawer, expenses, home).
import { api, state, can, icon, esc, money, n, modal, toast, busy, formData, confirmBox, fmtDate, COLLECT_METHODS } from './core.js';

export const categories = () => String(state.settings.expense_categories || 'أخرى').split('\n').map((c) => c.trim()).filter(Boolean)
  .filter((c) => (can('payroll') ? true : c !== 'مرتبات' && c !== 'سلفة'));

/** Record an expense. Resolves true when saved. */
export function expenseModal({ beforeClose = false, closingId = null } = {}) {
  if (closingId) beforeClose = true;
  const manager = can('expenses.view');
  return modal({
    title: beforeClose ? 'مصروف اتنسى قبل التقفيل' : 'تسجيل مصروف',
    body: `<form class="form-grid" autocomplete="off" onsubmit="return false">
      <label class="field"><span>المبلغ *</span><input class="input num" type="number" min="0" step="any" name="amount" inputmode="decimal" autofocus></label>
      <label class="field"><span>النوع *</span><select class="input" name="category">${categories().map((c) => `<option>${esc(c)}</option>`).join('')}</select></label>
      <label class="field full"><span>تفاصيل</span><input class="input" name="note" placeholder="مثلاً: فاتورة الكهربا شهر 10"></label>
      ${manager ? `<label class="field full"><span>اتدفع منين؟</span><select class="input" name="source">
          <option value="drawer">من الدرج (كاش النهارده)</option>
          <option value="cash">كاش من فلوس الشهر (مش من الدرج)</option>
          <option value="card">من فلوس الفيزا</option></select></label>` : '<p class="muted small full" style="margin:0">المبلغ هيتخصم من الدرج.</p>'}
      ${beforeClose ? `<p class="note-warn full" style="margin:0">${LATE_HINT}</p>` : ''}
    </form>`,
    foot: `<button class="btn btn-outline" data-close>إلغاء</button><button class="btn btn-primary" data-ok>${icon('check')} حفظ</button>`,
    onMount: (m, close) => {
      const save = (e) => busy(m.querySelector('[data-ok]'), async () => {
        e?.preventDefault?.();
        const f = formData(m.querySelector('form'));
        if (f.source) { f.from_drawer = f.source === 'drawer'; if (!f.from_drawer) f.paid_with = f.source; delete f.source; }
        if (closingId) f.closing_id = closingId; else if (beforeClose) f.before_close = true;
        const r = await api.post('/expenses', f);
        toast(r.closing ? lateToast(r.closing) : 'اتسجل المصروف', 'ok');
        close(true);
      });
      m.querySelector('[data-ok]').addEventListener('click', save);
      m.querySelector('[name=amount]').addEventListener('keydown', (e) => { if (e.key === 'Enter') save(e); });
    },
  });
}

const LATE_HINT = 'هيتسجل على التقفيلة دي، والعجز أو الزيادة بتاعها هيتعدلوا. الدرج الحالي مش هيتأثر.';
const lateToast = (c) => `اتسجل على التقفيلة — ${Math.abs(c.diff) < 0.5 ? 'بقت مظبوطة ✅' : c.diff < 0 ? `العجز بقى ${n(-c.diff)}` : `الزيادة بقت ${n(c.diff)}`}`;

/** Forgot to record something before the drawer was closed: pick what it was. */
export function forgotModal(lastClose) {
  const opts = [
    ['expense', 'expense', 'مصروف', 'كهربا، أكل، مواصلات…', can('expenses.view')],
    ['allowance', 'user', 'يومية موظف', 'اليومية اللي اتصرفت من الدرج', can('expenses.view')],
    ['advance', 'coins', 'سلفة موظف', 'بتتخصم من مرتبه', can('payroll')],
    ['out', 'arrowOut', 'فلوس طلعتها من الدرج', 'سحب من الإيراد', can('drawer.view')],
  ].filter((o) => o[4]);
  return modal({
    title: 'نسيت تسجل حاجة قبل التقفيل؟',
    body: `<p class="muted" style="margin-top:0">هتتسجل على تقفيلة <b>${esc(lastClose || '')}</b> وهيتعدل حسابها.</p>
      <div class="forgot-grid">${opts.map(([k, ic, t, sub]) => `<button type="button" class="forgot-opt" data-k="${k}">${icon(ic)}<b>${t}</b><span class="muted small">${sub}</span></button>`).join('')}</div>`,
    foot: '<button class="btn btn-outline" data-close>إلغاء</button>',
    onMount: (m, close) => m.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', async () => {
      const k = b.dataset.k;
      close(false);
      const ok = k === 'expense' ? await expenseModal({ beforeClose: true })
        : k === 'out' ? await moveModal('out', { beforeClose: true })
        : await staffMoneyModal(k);
      if (ok) document.dispatchEvent(new CustomEvent('mm:drawer-changed'));
    })),
  });
}

/** An employee's daily allowance or advance that was paid before the last drawer closing. */
async function staffMoneyModal(kind, closingId = null) {
  const late = closingId ? { closing_id: closingId } : { before_close: true };
  const t = await api.get('/allowances/today');
  const isAdv = kind === 'advance';
  return modal({
    title: `${isAdv ? 'سلفة' : 'يومية'} اتنست قبل التقفيل`,
    body: `<div class="form-grid">
      <label class="field full"><span>الموظف *</span><select class="input" id="emp">${t.list.map((u) => `<option value="${u.id}" data-amount="${u.amount}">${esc(u.full_name)}</option>`).join('')}</select></label>
      <label class="field full"><span>المبلغ *</span><input class="input input-lg num" type="number" min="0" step="any" id="amount" inputmode="decimal"></label>
      <p class="note-warn full" style="margin:0">${LATE_HINT}</p>
    </div>`,
    foot: `<button class="btn btn-outline" data-close>إلغاء</button><button class="btn btn-primary" data-ok>${icon('check')} حفظ</button>`,
    onMount: (m, close) => {
      const emp = m.querySelector('#emp'), amount = m.querySelector('#amount');
      const fill = () => { if (!isAdv) amount.value = emp.selectedOptions[0]?.dataset.amount || ''; };
      emp.addEventListener('change', fill); fill();
      m.querySelector('[data-ok]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        if (!emp.value) throw new Error('اختار الموظف');
        if (isAdv) await api.post(`/payroll/${emp.value}/advance`, { amount: amount.value, ...late });
        else {
          const r = await api.post('/allowances', { user_id: Number(emp.value), amount: amount.value, ...late });
          if (!r.count) throw new Error('اليومية دي متسجلة على اليوم ده قبل كده');
        }
        toast('اتسجل على التقفيلة ✓', 'ok');
        close(true);
      }));
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
export function drawerBreakdown(d, totalLabel = 'المفروض في الدرج دلوقتي') {
  const rows = Object.entries(PARTS).filter(([k]) => d.parts[k]).map(([k, label]) =>
    `<div class="line-row"><span>${label}</span><b class="num ${d.parts[k] < 0 ? 'neg' : ''}">${d.parts[k] > 0 ? '+' : ''}${n(d.parts[k])}</b></div>`).join('');
  return `<div class="breakdown">
    <div class="line-row"><span>اللي كان في الدرج${d.from ? '' : ' (أول مرة)'}</span><b class="num">${n(d.opening)}</b></div>
    ${rows || '<div class="muted small" style="padding:6px 0">مفيش حركة كاش من آخر تقفيل</div>'}
    <div class="line-row total"><span>${totalLabel}</span><b>${money(d.expected)}</b></div>
    ${d.non_cash && Object.keys(d.non_cash).length ? `<div class="non-cash">
      <div class="muted small">مش في الدرج (اتدفعت من غير كاش):</div>
      ${Object.entries(d.non_cash).map(([k, v]) => `<div class="line-row"><span>${COLLECT_METHODS[k] || k}</span><b class="num">${n(v)}</b></div>`).join('')}
      ${d.sales_total ? `<div class="line-row"><span class="muted">إجمالي المبيعات (كاش + غيره)</span><b class="num muted">${n(d.sales_total)}</b></div>` : ''}
    </div>` : ''}
  </div>`;
}

/** A shop day as people say it: "الأربع 5/11". */
const AR_DAYS = ['الأحد', 'الاتنين', 'التلات', 'الأربع', 'الخميس', 'الجمعة', 'السبت'];
export const dayLabel = (d) => `${AR_DAYS[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${Number(d.slice(8))}/${Number(d.slice(5, 7))}`;

/**
 * Count the drawer and close it. With { day }: close a past day that was forgotten, counting only
 * that day's money (today's sales stay in today's drawer).
 */
export async function closeDrawerModal({ day = null } = {}) {
  let d = await api.get('/drawer' + (day ? `?day=${day}` : ''));
  const days = d.open_days || [];
  return modal({
    title: 'تقفيل الدرج',
    body: `${days.length ? `<label class="field" style="margin-bottom:12px"><span>هتقفل درج يوم</span><select class="input" id="day">
        <option value="">النهارده — لحد دلوقتي</option>
        ${[...days].reverse().map((x) => `<option value="${x}" ${x === day ? 'selected' : ''}>${dayLabel(x)} (اتنسى)</option>`).join('')}</select></label>
        <p class="note-warn small" style="margin:0 0 12px" id="day-hint" ${day ? '' : 'hidden'}>هيتحسب فلوس اليوم ده بس (من آخر تقفيلة لحد آخر اليوم). مبيعات النهارده هتفضل في درج النهارده.</p>` : ''}
      <div id="sum"></div>
      <div class="form-grid" style="margin-top:14px">
        <label class="field"><span id="counted-label">${day ? 'كان في الدرج كام آخر اليوم ده؟' : 'عدّيت كام في الدرج؟'} *</span><input class="input input-lg num" type="number" min="0" step="any" id="counted" inputmode="decimal" autofocus></label>
        <label class="field"><span>هتسيب كام في الدرج للي بعدك؟</span><input class="input input-lg num" type="number" min="0" step="any" id="left" inputmode="decimal" placeholder="= كله"></label>
        ${d.blind ? '' : '<div class="full"><button type="button" class="btn btn-ghost btn-sm" id="exact">اعتبره مظبوط (= المفروض)</button></div>'}
        <div class="full" id="diff"></div>
        <label class="field full"><span>ملاحظة</span><input class="input" id="note" placeholder="اختياري"></label>
      </div>`,
    foot: `<button class="btn btn-outline" data-close>إلغاء</button><button class="btn btn-primary" data-ok>${icon('check')} قفّل الدرج</button>`,
    onMount: (m, close) => {
      const counted = m.querySelector('#counted');
      const daySel = m.querySelector('#day');
      const drawSum = () => {
        m.querySelector('#sum').innerHTML = d.blind
          ? '<p class="muted" style="margin-top:0">عدّ الفلوس اللي في الدرج كلها واكتب المبلغ — السيستم هيقارنه باللي المفروض يكون موجود.</p>'
          : drawerBreakdown(d, daySel?.value ? `المفروض في الدرج آخر يوم ${dayLabel(daySel.value)}` : undefined);
      };
      const show = () => {
        const box = m.querySelector('#diff');
        if (counted.value === '' || d.blind) { box.innerHTML = ''; return; }
        const diff = Number(counted.value) - d.expected;
        box.innerHTML = Math.abs(diff) < 0.5
          ? '<div class="note-ok">✅ الدرج مظبوط</div>'
          : diff < 0 ? `<div class="note-bad">⚠️ عجز ${money(-diff)}</div>` : `<div class="note-warn">زيادة ${money(diff)}</div>`;
      };
      drawSum();
      counted.addEventListener('input', show);
      m.querySelector('#exact')?.addEventListener('click', () => { counted.value = d.expected; show(); });
      daySel?.addEventListener('change', async () => {
        d = await api.get('/drawer' + (daySel.value ? `?day=${daySel.value}` : ''));
        m.querySelector('#day-hint').hidden = !daySel.value;
        m.querySelector('#counted-label').textContent = (daySel.value ? 'كان في الدرج كام آخر اليوم ده؟' : 'عدّيت كام في الدرج؟') + ' *';
        drawSum(); show();
      });
      m.querySelector('[data-ok]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        if (counted.value === '') throw new Error('اكتب المبلغ اللي عدّيته');
        const left = m.querySelector('#left').value;
        const r = await api.post('/drawer/close', { counted: Number(counted.value), left_in_drawer: left === '' ? undefined : Number(left), note: m.querySelector('#note').value, day: daySel?.value || undefined });
        toast(Math.abs(r.diff) < 0.5 ? 'اتقفل الدرج — مظبوط ✅' : r.diff < 0 ? `اتقفل الدرج — عجز ${n(-r.diff)}` : `اتقفل الدرج — زيادة ${n(r.diff)}`, Math.abs(r.diff) < 0.5 ? 'ok' : 'err');
        close(true);
      }));
    },
  });
}

/** Correct a closing (counted, left in the drawer, note), or undo the last one to count it again. */
export function editClosingModal(c, isLast) {
  let parts = {};
  try { parts = JSON.parse(c.details || '{}'); } catch { /* none */ }
  return modal({
    title: 'تعديل التقفيلة',
    body: `${drawerBreakdown({ parts, opening: c.opening, expected: c.expected, from: c.opened_at }, 'كان المفروض في الدرج')}
      <div class="add-to-close">
        <b>نسيت حاجة في اليوم ده؟ ضيفها على التقفيلة</b>
        <div class="add-grid">
          ${can('expenses.view') ? `<button type="button" class="forgot-opt" data-add="expense">${icon('expense')}<b>مصروف</b></button>` : ''}
          ${can('sales.create') ? `<button type="button" class="forgot-opt" data-add="sale">${icon('cart')}<b>بيع اتنسى</b></button>` : ''}
          ${can('expenses.view') ? `<button type="button" class="forgot-opt" data-add="allowance">${icon('user')}<b>يومية موظف</b></button>` : ''}
          ${can('payroll') ? `<button type="button" class="forgot-opt" data-add="advance">${icon('coins')}<b>سلفة</b></button>` : ''}
          <button type="button" class="forgot-opt" data-add="out">${icon('arrowOut')}<b>فلوس طلعت</b></button>
          <button type="button" class="forgot-opt" data-add="in">${icon('arrowIn')}<b>فلوس دخلت</b></button>
        </div>
      </div>
      <div class="close-items" id="items"><div class="muted small">بيحمّل اللي اتسجل في التقفيلة دي…</div></div>
      <div class="form-grid" style="margin-top:14px">
        <label class="field"><span>اتعد كام؟</span><input class="input input-lg num" type="number" min="0" step="any" id="counted" value="${c.counted}"></label>
        <label class="field"><span>اتساب كام في الدرج؟</span><input class="input input-lg num" type="number" min="0" step="any" id="left" value="${c.left_in_drawer}"></label>
        <div class="full"><button type="button" class="btn btn-ghost btn-sm" id="exact">اعتبره مظبوط (= المفروض)</button></div>
        <div class="full" id="diff"></div>
        <label class="field full"><span>ملاحظة</span><input class="input" id="note" value="${esc(c.note || '')}"></label>
        <p class="muted small full" style="margin:0">لو غيّرت "اتساب في الدرج"، الدرج اللي بعدها بيتعدل معاها.</p>
      </div>
`,
    foot: `${isLast ? `<button class="btn btn-ghost" data-undo style="color:var(--danger);margin-inline-end:auto">${icon('undo')} الغي التقفيلة دي</button>` : ''}
      <button class="btn btn-outline" data-close>إلغاء</button><button class="btn btn-primary" data-ok>${icon('check')} حفظ</button>`,
    onMount: (m, close) => {
      const counted = m.querySelector('#counted'), left = m.querySelector('#left');
      const wasAll = Number(c.left_in_drawer) === Number(c.counted);
      const show = () => {
        const diff = Number(counted.value) - c.expected;
        m.querySelector('#diff').innerHTML = counted.value === '' ? '' : Math.abs(diff) < 0.5 ? '<div class="note-ok">✅ مظبوط</div>'
          : diff < 0 ? `<div class="note-bad">⚠️ عجز ${money(-diff)}</div>` : `<div class="note-warn">زيادة ${money(diff)}</div>`;
      };
      // Left everything in the drawer before: keep it that way when the count changes
      counted.addEventListener('input', () => { if (wasAll) left.value = counted.value; show(); });
      m.querySelector('#exact').addEventListener('click', () => { counted.value = c.expected; if (wasAll) left.value = c.expected; show(); });
      show();
      m.querySelector('[data-ok]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        await api.put(`/drawer/closings/${c.id}`, { counted: Number(counted.value), left_in_drawer: left.value === '' ? undefined : Number(left.value), note: m.querySelector('#note').value });
        toast('اتعدلت التقفيلة ✓', 'ok');
        close(true);
      }));
      // Everything that went in / out in this closing, each removable
      api.get(`/drawer/closings/${c.id}/items`).then((it) => {
        const rows = [
          ...it.expenses.map((e) => ({ kind: 'exp', id: e.id, at: e.created_at, amount: -e.amount, payroll: !!e.employee_id,
            text: `${esc(e.category)}${e.employee_name ? ` — ${esc(e.employee_name)}` : ''}${e.note ? ` <span class="muted">(${esc(e.note)})</span>` : ''}` })),
          ...it.moves.map((mv) => ({ kind: 'move', id: mv.id, at: mv.created_at, amount: mv.kind === 'in' ? mv.amount : -mv.amount,
            text: `${mv.kind === 'in' ? 'إيداع' : 'سحب'}${mv.note ? ` <span class="muted">(${esc(mv.note)})</span>` : ''}` })),
        ].sort((a, b) => a.at.localeCompare(b.at));
        m.querySelector('#items').innerHTML = rows.length ? `<b>المصروفات والسحب والإيداع في التقفيلة دي</b>
          ${rows.map((r) => `<div class="line-row"><span>${r.text}<div class="muted small">${fmtDate(r.at)}</div></span>
            <span class="ci-end"><b class="num ${r.amount < 0 ? 'neg' : ''}">${r.amount > 0 ? '+' : ''}${n(r.amount)}</b>
            ${r.payroll && !can('payroll') ? '' : `<button type="button" class="btn btn-ghost btn-sm" data-rm="${r.kind}:${r.id}" title="امسح" style="color:var(--danger)">${icon('trash')}</button>`}</span></div>`).join('')}` : '';
        m.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => {
          const [kind, id] = b.dataset.rm.split(':');
          close(false);
          if (await confirmBox('تمسح دي؟ المفروض في الدرج والعجز بتوع التقفيلة هيتحسبوا من جديد.', { ok: 'امسح', danger: true })) {
            try {
              await api.del(kind === 'exp' ? `/expenses/${id}` : `/drawer/moves/${id}`);
              toast('اتمسح — والتقفيلة اتعدلت', 'ok');
            } catch (e) { toast(e.message, 'err'); }
          }
          document.dispatchEvent(new CustomEvent('mm:drawer-changed', { detail: { reopen: c.id } }));
        }));
      }).catch(() => { m.querySelector('#items').innerHTML = ''; });
      m.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', async () => {
        const k = b.dataset.add;
        if (k === 'sale') { close(false); location.hash = `#/pos?closing=${c.id}`; return; }
        close(false);
        const ok = k === 'expense' ? await expenseModal({ closingId: c.id })
          : k === 'out' || k === 'in' ? await moveModal(k, { closingId: c.id })
          : await staffMoneyModal(k, c.id);
        // Back to the closing, with its new numbers
        document.dispatchEvent(new CustomEvent('mm:drawer-changed', { detail: { reopen: c.id, changed: !!ok } }));
      }));
      m.querySelector('[data-undo]')?.addEventListener('click', async () => {
        if (!(await confirmBox('تلغي التقفيلة دي؟ فلوسها هترجع للدرج المفتوح وتقدر تقفلها تاني من الأول.', { ok: 'الغي', danger: true }))) return;
        await api.del(`/drawer/closings/${c.id}`);
        toast('اتلغت التقفيلة — قفّلها تاني لما تعدّ', 'ok');
        close(true);
      });
    },
  });
}

/** Owner puts money into / takes money out of the drawer. */
export function moveModal(kind, { beforeClose = false, closingId = null } = {}) {
  if (closingId) beforeClose = true;
  return modal({
    title: (kind === 'in' ? 'إيداع في الدرج' : 'سحب من الدرج') + (beforeClose ? ' — اتنسى قبل التقفيل' : ''),
    body: `<div class="form-grid">
      <label class="field full"><span>المبلغ *</span><input class="input input-lg num" type="number" min="0" step="any" id="amount" inputmode="decimal" autofocus></label>
      <label class="field full"><span>ملاحظة</span><input class="input" id="note" placeholder="${kind === 'in' ? 'مثلاً: فكة' : 'مثلاً: المالك خد الإيراد'}"></label>
      ${beforeClose ? `<p class="note-warn full" style="margin:0">${LATE_HINT}</p>` : ''}
    </div>`,
    foot: `<button class="btn btn-outline" data-close>إلغاء</button><button class="btn btn-primary" data-ok>${icon('check')} حفظ</button>`,
    onMount: (m, close) => {
      m.querySelector('[data-ok]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const r = await api.post('/drawer/move', { kind, amount: m.querySelector('#amount').value, note: m.querySelector('#note').value, ...(closingId ? { closing_id: closingId } : { before_close: beforeClose || undefined }) });
        toast(r.closing ? lateToast(r.closing) : 'اتسجل', 'ok');
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
