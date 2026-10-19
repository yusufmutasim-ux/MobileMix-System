import { api, state, can, icon, esc, fmtDate, modal, toast, toastErr, busy, emptyRow, downloadCsv, ROLE_NAMES } from '../core.js';
import { RANGES, RANGE_NAMES } from './sales.js';

const dur = (m) => `${Math.floor(m / 60)} س ${String(m % 60).padStart(2, '0')} د`;
const time = (s) => (s ? s.slice(11, 16) : '');
const place = (method, dist) => (method === 'gps' ? `<span class="pill pill-ok" title="بالـ GPS">📍 من المحل${dist != null ? ` · ${dist} م` : ''}</span>`
  : method === 'wifi' ? '<span class="pill pill-ok">📶 إنترنت المحل</span>'
  : dist != null ? `<span class="pill ${dist > 300 ? 'pill-warn' : 'pill-gray'}" title="الحضور من أي مكان مسموح">على بعد ${dist > 1000 ? `${(dist / 1000).toFixed(1)} كم` : `${dist} م`}</span>` : '');

export async function render(el, { actions }) {
  let [from, to] = RANGES.week();
  let data = null;
  const users = await api.get('/users/names').catch(() => []);

  actions.innerHTML = `<button class="btn btn-outline btn-sm" id="csv">${icon('download')} تصدير Excel</button>`;

  el.innerHTML = `
    ${can('settings.manage') ? '<div class="card" id="rules"></div>' : ''}
    <div class="card" id="now"></div>
    <div class="card">
      <div class="toolbar">
        <div class="seg" id="range">${Object.entries(RANGE_NAMES).map(([k, v]) => `<button data-r="${k}" class="${k === 'week' ? 'on' : ''}">${v}</button>`).join('')}</div>
        <input class="input num" type="date" id="from" value="${from}"><input class="input num" type="date" id="to" value="${to}">
        <select class="input" id="user"><option value="">كل الموظفين</option>${users.map((u) => `<option value="${u.id}">${esc(u.full_name)}</option>`).join('')}</select>
      </div>
      <div class="grid grid-4" id="totals" style="margin-bottom:16px"></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>الموظف</th><th>اليوم</th><th>الحضور</th><th>الانصراف</th><th>المدة</th><th>ملاحظة</th><th></th></tr></thead>
        <tbody id="rows"></tbody>
      </table></div>
    </div>
    <div class="card hidden" id="denied-card">
      <div class="card-head"><h2>⚠️ محاولات مرفوضة (من برة المحل)</h2><span class="pill pill-bad" id="denied-count"></span></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>الموظف</th><th>الوقت</th><th>النوع</th><th>المسافة</th><th>السبب</th></tr></thead>
        <tbody id="denied"></tbody>
      </table></div>
    </div>`;

  const $ = (s) => el.querySelector(s);

  async function loadNow() {
    const n = await api.get('/shifts/now');
    const st = await api.get('/settings').catch(() => ({}));
    const zoneOn = st.attendance_zone === '1';
    const zoneReady = st.shop_lat !== '' && st.shop_lng !== '' && st.shop_lat != null;
    $('#now').innerHTML = `
      <div class="card-head"><h2>${icon('clock', '')} مين في الشيفت دلوقتي</h2><span class="pill pill-ok">${n.on.length} موجود</span>
        <a href="#/settings" class="pill ${zoneOn && zoneReady ? 'pill-ok' : zoneOn ? 'pill-bad' : 'pill-gray'}">
          ${zoneOn && zoneReady ? '📍 الحضور من المحل بس — مفعّل' : zoneOn ? '⚠️ موقع المحل مش متحدد' : 'الحضور من أي مكان (التحقق من الموقع مقفول)'}</a></div>
      <div class="grid grid-4">
        ${n.on.map((s) => `<div class="kpi bg-mint" style="min-height:0">
            <div class="label"><span class="dot-live"></span> ${esc(s.full_name)}</div>
            <div class="sub" style="margin-top:6px">من الساعة <b class="num">${time(s.check_in_at)}</b> — ${dur(s.minutes)}</div>
            <button class="btn btn-ghost btn-sm" data-close-shift="${s.id}" style="margin-top:6px;align-self:flex-start">إنهاء الشيفت</button>
          </div>`).join('') || '<div class="muted">مفيش حد مسجل حضور دلوقتي</div>'}
      </div>
      ${n.off.length ? `<p class="small muted" style="margin:14px 0 0">مش موجودين: ${n.off.map((u) => `${esc(u.full_name)} <span class="muted">(${ROLE_NAMES[u.role]})</span>`).join('، ')}</p>` : ''}`;
    $('#now').querySelectorAll('[data-close-shift]').forEach((b) => b.addEventListener('click', () => closeShift(b.dataset.closeShift)));
  }

  async function load() {
    const p = new URLSearchParams({ from, to });
    if ($('#user').value) p.set('user_id', $('#user').value);
    data = await api.get('/shifts?' + p);
    $('#totals').innerHTML = data.by_user.map((u) => `
      <div class="kpi bg-periwinkle" style="min-height:0"><div class="label">${esc(u.full_name)}</div>
        <div class="value" style="font-size:22px">${dur(u.minutes)}</div>
        <div class="sub">${u.days} يوم — ${u.shifts} شيفت</div></div>`).join('') || '';
    $('#rows').innerHTML = data.shifts.length ? data.shifts.map((s) => `<tr>
      <td><b style="font-weight:500">${esc(s.full_name)}</b></td>
      <td class="small">${fmtDate(s.check_in_at, false)}</td>
      <td><span class="num">${time(s.check_in_at)}</span> ${place(s.in_method, s.in_distance)}</td>
      <td>${s.check_out_at ? `<span class="num">${time(s.check_out_at)}</span> ${place(s.out_method, s.out_distance)}${s.check_out_at.slice(0, 10) !== s.check_in_at.slice(0, 10) ? ' <span class="small muted">(اليوم التالي)</span>' : ''}` : '<span class="pill pill-ok">لسه في الشيفت</span>'}
        ${s.closed_by_name ? `<div class="small muted">قفله ${esc(s.closed_by_name)}</div>` : ''}</td>
      <td class="num">${dur(s.minutes)}</td>
      <td class="small">${esc(s.note || '')}</td>
      <td class="end">${s.check_out_at ? '' : `<button class="btn btn-ghost btn-sm" data-close-shift="${s.id}">إنهاء</button>`}</td>
    </tr>`).join('') : emptyRow(7, 'مفيش حضور في الفترة دي');
    const den = data.denied || [];
    $('#denied-card').classList.toggle('hidden', !den.length);
    $('#denied-count').textContent = den.length;
    $('#denied').innerHTML = den.map((d) => `<tr>
      <td><b style="font-weight:500">${esc(d.full_name)}</b></td>
      <td class="small">${fmtDate(d.created_at)}</td>
      <td>${d.kind === 'out' ? 'انصراف' : 'حضور'}</td>
      <td class="num">${d.distance != null ? (d.distance > 1000 ? `${(d.distance / 1000).toFixed(1)} كم` : `${d.distance} م`) : '—'}</td>
      <td class="small">${esc(d.reason || '')}</td></tr>`).join('');
    $('#rows').querySelectorAll('[data-close-shift]').forEach((b) => b.addEventListener('click', () => closeShift(b.dataset.closeShift)));
  }

  async function closeShift(id) {
    const done = await modal({
      title: 'إنهاء شيفت نسي يقفله',
      body: `<label class="field"><span>وقت الانصراف</span><input class="input num" type="datetime-local" id="at"></label>
        <p class="small muted">سيبه فاضي = دلوقتي.</p>`,
      foot: '<button class="btn btn-outline" data-close>إلغاء</button><button class="btn btn-primary" data-ok>إنهاء الشيفت</button>',
      onMount: (m, close) => m.querySelector('[data-ok]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const at = m.querySelector('#at').value;
        await api.post(`/shifts/${id}/close`, at ? { check_out_at: at } : {});
        toast('تم إنهاء الشيفت', 'ok');
        close(true);
      })),
    });
    if (done) reload();
  }

  // ---------- the two attendance rules, right where the owner looks ----------
  async function loadRules() {
    const box = $('#rules');
    if (!box) return;
    const st = await api.get('/settings');
    const locked = st.require_shift === '2';
    const zone = st.attendance_zone === '1';
    const shopSet = st.shop_lat !== '' && st.shop_lng !== '';
    box.innerHTML = `
      <div class="card-head"><h2>${icon('settings', '')} قواعد الحضور</h2></div>
      <div class="rules">
        <label class="rule ${locked ? 'on' : ''}">
          <input type="checkbox" id="r-lock" ${locked ? 'checked' : ''}>
          <span class="switch"></span>
          <span><b>🔒 السيستم مقفول لحد ما الموظف يسجل حضور</b>
            <span class="small muted">الموظف مش هيشوف أي قوايم غير شاشة "بدء الشيفت"، ويتقفل تاني بعد الانصراف.</span></span>
        </label>
        <label class="rule ${zone ? 'on' : ''}">
          <input type="checkbox" id="r-zone" ${zone ? 'checked' : ''}>
          <span class="switch"></span>
          <span><b>📍 الحضور والانصراف من جوه المحل بس</b>
            <span class="small muted">${shopSet ? 'موقع المحل متحدد ✓' : '<b style="color:var(--danger)">لازم تحدد موقع المحل الأول</b> — من <a href="#/settings">الإعدادات</a> وإنت جوه المحل.'}</span></span>
        </label>
      </div>
      <p class="small muted" style="margin:10px 0 0">المدير مستثنى من القاعدتين. التغيير بيطبق على الموظفين فوراً.</p>`;
    box.querySelector('#r-lock').addEventListener('change', async (e) => {
      try {
        state.settings = await api.put('/settings', { require_shift: e.target.checked ? '2' : '0' });
        toast(e.target.checked ? '🔒 تم — الموظفين مش هيشوفوا حاجة غير لما يسجلوا حضور' : 'تم إلغاء القفل', 'ok');
      } catch (err) { toastErr(err); }
      loadRules();
    });
    box.querySelector('#r-zone').addEventListener('change', async (e) => {
      if (e.target.checked && !shopSet) {
        e.target.checked = false;
        toast('حدد موقع المحل الأول من الإعدادات (وإنت جوه المحل)', 'err');
        return;
      }
      try {
        state.settings = await api.put('/settings', { attendance_zone: e.target.checked ? '1' : '0' });
        toast(e.target.checked ? '📍 تم — الحضور من جوه المحل بس' : 'الحضور مسموح من أي مكان', 'ok');
      } catch (err) { toastErr(err); }
      loadRules();
    });
  }

  const reload = () => Promise.all([loadRules(), loadNow(), load()]).catch(toastErr);

  $('#range').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    [from, to] = RANGES[b.dataset.r]();
    $('#from').value = from; $('#to').value = to;
    $('#range').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    load().catch(toastErr);
  });
  const onDate = () => {
    from = $('#from').value; to = $('#to').value || from;
    $('#range').querySelectorAll('button').forEach((x) => x.classList.remove('on'));
    load().catch(toastErr);
  };
  $('#from').addEventListener('change', onDate);
  $('#to').addEventListener('change', onDate);
  $('#user').addEventListener('change', () => load().catch(toastErr));
  actions.querySelector('#csv').addEventListener('click', () => data && downloadCsv(`attendance-${from}-${to}.csv`,
    ['الموظف', 'الحضور', 'الانصراف', 'المدة بالدقائق', 'ملاحظة'],
    data.shifts.map((s) => [s.full_name, s.check_in_at, s.check_out_at || '', s.minutes, s.note || ''])));

  // Refresh "who's in now" when someone checks in/out
  const onNote = (e) => { if (/^shift_/.test(e.detail.type)) reload(); };
  document.addEventListener('mm:notification', onNote);

  await reload();
  return () => document.removeEventListener('mm:notification', onNote);
}
