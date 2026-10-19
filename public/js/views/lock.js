// What staff see before checking in, when the owner locked the system until check in.
import { api, state, LOGO, icon, esc } from '../core.js';
import { startShiftFlow, getPosition, locationHelp, zoneOn } from '../live.js';

export async function render(el) {
  const hour = new Date().getHours();
  el.innerHTML = `
  <div class="lock-screen">
    <div class="lock-box">
      <div class="brand" style="padding:0;justify-content:center">${LOGO}<div class="brand-name">${esc(state.settings.shop_name || 'Mobile Mix')}</div></div>
      <h1>${hour < 12 ? 'صباح الخير' : 'مساء الخير'}، <span class="grad">${esc(state.user.full_name)}</span></h1>
      <p class="muted">سجّل حضورك عشان تبدأ الشيفت وتفتح السيستم.</p>
      <button class="btn btn-primary btn-lg" id="lock-in" style="width:100%">${icon('logout')} بدء الشيفت</button>
      <div id="lock-zone" class="small muted" style="margin-top:14px"></div>
      <button class="btn btn-ghost btn-sm" id="lock-out" style="margin-top:18px">تسجيل خروج</button>
    </div>
  </div>`;

  if (await zoneOn().catch(() => false)) {
    el.querySelector('#lock-zone').innerHTML = `📍 الحضور لازم يكون من جوه المحل — الموبايل هيطلب يعرف موقعك، دوس <b>سماح / Allow</b>.
      <br><button class="btn btn-ghost btn-sm" id="lock-test">اختبر موقعي</button><div id="lock-test-out" style="margin-top:8px"></div>`;
    el.querySelector('#lock-test').addEventListener('click', async () => {
      const out = el.querySelector('#lock-test-out');
      out.textContent = '📍 بنحدد موقعك…';
      let pos = null, err = null;
      try { pos = await getPosition(); } catch (e) { err = e; }
      const t = await api.post('/shifts/zone/test', pos || {}).catch((e) => ({ ok: false, error: e.message }));
      out.innerHTML = t.ok
        ? `<div class="card bg-mint" style="box-shadow:none;padding:10px 12px">✅ إنت جوه المحل${t.distance != null ? ` (<span class="num">${t.distance}</span> متر)` : ''} — تقدر تبدأ الشيفت.</div>`
        : `<div class="card bg-peony" style="box-shadow:none;padding:10px 12px;text-align:start">❌ ${esc(t.error)}${err ? `<div style="margin-top:8px">${locationHelp(err)}</div>` : ''}</div>`;
    });
  }

  el.querySelector('#lock-in').addEventListener('click', async (e) => {
    const s = await startShiftFlow(e.currentTarget);
    if (s) setTimeout(() => location.reload(), 700);
  });
  el.querySelector('#lock-out').addEventListener('click', async () => {
    await api.post('/auth/logout').catch(() => {});
    location.hash = '#/';
    location.reload();
  });
}
