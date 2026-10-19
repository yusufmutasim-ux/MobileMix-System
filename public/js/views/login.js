import { api, LOGO, icon, busy, formData } from '../core.js';

export function render(el, { onLogin }) {
  el.innerHTML = `
  <div class="login">
    <div class="login-form">
      <form class="box" autocomplete="on">
        <div class="brand" style="padding:0">${LOGO}<div class="brand-name">Mobile Mix</div></div>
        <h1>أهلاً بيك في <span class="grad">Mobile Mix</span></h1>
        <p class="muted" style="margin:0 0 28px">سجّل دخولك عشان تبدأ شيفتك</p>
        <div class="stack" style="--g:16px">
          <label class="field"><span>اسم المستخدم</span><input class="input input-lg ltr" name="username" autocomplete="username" required autofocus></label>
          <label class="field" style="margin-top:16px"><span>كلمة السر</span><input class="input input-lg ltr" type="password" name="password" autocomplete="current-password" required></label>
        </div>
        <button class="btn btn-primary btn-lg" style="width:100%;margin-top:28px" type="submit">دخول ${icon('logout', '')}</button>
        <p class="error small" style="color:var(--danger);min-height:20px;margin-top:12px"></p>
      </form>
    </div>
    <div class="login-panel">
      <div class="float bg-mint" style="top:12%;right:12%">💰 مبيعات النهارده</div>
      <div class="float bg-peony" style="bottom:14%;left:10%">🏷️ ليبلات بالباركود</div>
      <div class="mock">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <b style="font-weight:500">آخر الفواتير</b><span class="pill pill-info">اليوم</span></div>
        <div class="mock-row"><span class="dot bg-sky"></span><b>iPhone 15 — 128GB</b><span class="pill pill-ok">مكتملة</span></div>
        <div class="mock-row"><span class="dot bg-lavender"></span><b>Samsung A55</b><span class="pill pill-ok">مكتملة</span></div>
        <div class="mock-row"><span class="dot bg-mint"></span><b>شاحن Anker 20W</b><span class="pill pill-warn">مرتجع جزئي</span></div>
        <div class="mock-row"><span class="dot bg-peony"></span><b>جراب + اسكرينة</b><span class="pill pill-ok">مكتملة</span></div>
      </div>
    </div>
  </div>`;

  const form = el.querySelector('form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const err = el.querySelector('.error');
    err.textContent = '';
    busy(form.querySelector('button'), async () => {
      try {
        await api.post('/auth/login', formData(form));
        onLogin();
      } catch (ex) {
        err.textContent = ex.message;
      }
    });
  });
}
