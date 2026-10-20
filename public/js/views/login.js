import { api, LOGO_FULL, icon, busy, formData } from '../core.js';

export function render(el, { onLogin }) {
  el.innerHTML = `
  <div class="login">
    <div class="login-form">
      <form class="box" autocomplete="on">
        ${LOGO_FULL(54)}
        <h1>أهلاً بيك 👋</h1>
        <p class="muted" style="margin:0 0 26px">سجّل دخولك عشان تبدأ شيفتك</p>
        <label class="field"><span>اسم المستخدم</span><input class="input input-lg ltr" name="username" autocomplete="username" required autofocus></label>
        <label class="field" style="margin-top:16px"><span>كلمة السر</span><input class="input input-lg ltr" type="password" name="password" autocomplete="current-password" required></label>
        <button class="btn btn-primary btn-lg" style="width:100%;margin-top:28px" type="submit">دخول ${icon('logout', '')}</button>
        <p class="error small" style="color:var(--danger);min-height:20px;margin:12px 0 0"></p>
      </form>
    </div>
    <div class="login-panel">
      <img class="panel-logo" src="/brand/logo.svg" alt="Mobile Mix Services">
      <div class="wallet" aria-hidden="true">
        <div class="w-card w-yellow"><div class="w-top"><span>الصيانة</span><span class="num">R-000128</span></div></div>
        <div class="w-card w-lime">
          <div class="w-top"><span>مبيعات النهارده</span><span>📱</span></div>
          <div class="w-amount">48,250 <small>ج.م</small></div>
          <div class="w-bottom"><span>23 فاتورة</span><span class="w-chip">عرض التقارير</span></div>
        </div>
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
