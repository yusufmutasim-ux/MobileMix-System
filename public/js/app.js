import { api, state, can, icon, esc, LOGO, ROLE_NAMES, toastErr, modal, busy, toast } from './core.js';

const NAV = [
  { path: '/', title: 'الرئيسية', icon: 'home', view: 'dashboard' },
  { path: '/pos', title: 'نقطة البيع', short: 'البيع', icon: 'cart', view: 'pos', perm: 'sales.create' },
  { path: '/sales', title: 'الفواتير', icon: 'receipt', view: 'sales', perm: 'sales.create' },
  { path: '/repairs', title: 'الصيانة', icon: 'wrench', view: 'repairs', perm: 'repairs.view' },
  { sep: 'المخزن' },
  { path: '/products', title: 'المنتجات', icon: 'box', view: 'products', perm: 'products.view' },
  { path: '/stocktake', title: 'الجرد', icon: 'clipboard', view: 'stocktake', perm: 'stocktake' },
  { path: '/labels', title: 'ليبلات الأسعار', icon: 'tag', view: 'labels', perm: 'labels.print' },
  { sep: 'الإدارة' },
  { path: '/reports', title: 'التقارير', icon: 'chart', view: 'reports', perm: 'reports.view' },
  { path: '/users', title: 'الموظفين', icon: 'users', view: 'users', perm: 'users.manage' },
  { path: '/settings', title: 'الإعدادات', icon: 'settings', view: 'settings' },
];

let cleanup = null;

async function boot() {
  try {
    const me = await api.get('/auth/me');
    Object.assign(state, { user: me.user, permissions: me.permissions, settings: me.settings, mustChangePassword: me.must_change_password, hosting: me.hosting || {} });
  } catch {
    state.user = null;
  }
  window.addEventListener('hashchange', route);
  await route();
  if (state.user && state.mustChangePassword) forcePasswordChange();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

/** The factory password can't stay — the system may be reachable from the internet. */
function forcePasswordChange() {
  modal({
    title: 'غيّر كلمة السر الأول 🔒',
    body: `<p class="muted" style="margin-top:0">إنت داخل بكلمة السر الافتراضية <b class="num">admin123</b>. لازم تغيرها قبل ما تستخدم السيستم،
      خصوصاً إنه ممكن يتفتح من برة المحل.</p>
      <div class="form-grid">
        <label class="field full"><span>كلمة السر الجديدة (6 حروف أو أكتر)</span><input class="input ltr" type="password" id="np" autocomplete="new-password" autofocus></label>
        <label class="field full"><span>اكتبها تاني</span><input class="input ltr" type="password" id="np2" autocomplete="new-password"></label>
      </div>`,
    foot: '<button class="btn btn-primary" data-ok>حفظ</button>',
    locked: true,
    onMount: (m, close) => {
      m.querySelector('[data-ok]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const a = m.querySelector('#np').value;
        if (a !== m.querySelector('#np2').value) throw new Error('الكلمتين مش زي بعض');
        await api.post('/auth/password', { current: 'admin123', password: a });
        state.mustChangePassword = false;
        toast('تم تغيير كلمة السر', 'ok');
        close(true);
      }));
    },
  });
}

function parse() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  return { path: '/' + (parts[0] || ''), id: parts[1], query: new URLSearchParams(query) };
}

async function route() {
  const r = parse();
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }

  if (!state.user) {
    const { render } = await import('./views/login.js');
    document.getElementById('app').innerHTML = '<div id="view"></div>';
    render(document.getElementById('view'), { onLogin: () => { location.hash = '#/'; location.reload(); } });
    return;
  }
  if (r.path === '/login') { location.hash = '#/'; return; }

  const item = NAV.find((n) => n.path === r.path && (!n.perm || can(n.perm)));
  if (!item) { location.hash = '#/'; return; }
  if (!document.querySelector('.shell')) shell();

  document.querySelectorAll('.nav a, .tabbar a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + item.path));
  document.querySelector('.sidebar').classList.remove('open');
  document.getElementById('page-title').textContent = item.title;
  document.title = `${item.title} — ${state.settings.shop_name || 'Mobile Mix'}`;
  const actions = document.getElementById('page-actions');
  actions.innerHTML = '';
  // Each visit gets its own container, so late async work from the previous page can't touch the new one
  const el = document.createElement('div');
  el.innerHTML = '<div class="empty">جاري التحميل…</div>';
  document.getElementById('view').replaceChildren(el);
  try {
    const mod = await import(`./views/${item.view}.js`);
    el.innerHTML = '';
    cleanup = (await mod.render(el, { id: r.id, query: r.query, actions })) || null;
  } catch (e) {
    toastErr(e);
    el.innerHTML = `<div class="card empty">${icon('alert')}${esc(e.message)}</div>`;
  }
  window.scrollTo(0, 0);
}

function shell() {
  const u = state.user;
  const links = NAV.filter((n) => n.sep || !n.perm || can(n.perm));
  // Drop section titles that have no links under them
  const visible = links.filter((n, i) => !n.sep || (links[i + 1] && !links[i + 1].sep));
  document.getElementById('app').innerHTML = `
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">${LOGO}<div class="brand-name">${esc(state.settings.shop_name || 'Mobile Mix')}<small>نظام المبيعات والمخزن</small></div></div>
      <nav class="nav">
        ${visible.map((n) => n.sep ? `<div class="nav-sep">${n.sep}</div>` : `<a href="#${n.path}">${icon(n.icon)}<span>${n.title}</span></a>`).join('')}
      </nav>
      <div class="side-user">
        <div class="avatar">${esc(u.full_name.trim()[0] || '?')}</div>
        <div class="who"><b>${esc(u.full_name)}</b><span class="muted small">${ROLE_NAMES[u.role]}</span></div>
        <button class="btn btn-ghost btn-icon" id="logout" title="تسجيل خروج">${icon('logout')}</button>
      </div>
    </aside>
    <main class="main">
      <header class="topbar">
        <button class="btn btn-ghost btn-icon menu-btn" id="menu">${icon('menu')}</button>
        <h1 id="page-title"></h1>
        <div class="btn-row" id="page-actions"></div>
      </header>
      ${state.hosting?.cloud && !state.hosting.persistent && can('settings.manage') ? `
        <div class="content" style="padding-bottom:0"><div class="card" style="background:var(--danger-wash);box-shadow:none;padding:16px 20px">
          <b>⚠️ البيانات مش محفوظة بشكل دائم!</b> السيستم شغال على Railway من غير Volume، فأي تحديث أو إعادة تشغيل هيمسح كل البيانات.
          ضيف Volume للخدمة من Railway (الخطوات في الإعدادات).</div></div>` : ''}
      <section class="content" id="view"></section>
    </main>
    <div class="scrim" id="scrim"></div>
    <nav class="tabbar" id="tabbar">
      ${tabs().map((n) => `<a href="#${n.path}">${icon(n.icon)}<span>${n.short || n.title}</span></a>`).join('')}
      <button id="more">${icon('menu')}<span>المزيد</span></button>
    </nav>
  </div>`;
  document.getElementById('logout').addEventListener('click', async () => {
    await api.post('/auth/logout').catch(() => {});
    location.hash = '#/';
    location.reload();
  });
  const toggleMenu = () => document.querySelector('.sidebar').classList.toggle('open');
  document.getElementById('menu').addEventListener('click', toggleMenu);
  document.getElementById('more').addEventListener('click', toggleMenu);
  document.getElementById('scrim').addEventListener('click', toggleMenu);
}

/** The 4 most-used screens this person can open, for the phone's bottom bar. */
function tabs() {
  const order = ['/', '/pos', '/repairs', '/sales', '/products', '/reports'];
  return order.map((p) => NAV.find((n) => n.path === p && (!n.perm || can(n.perm)))).filter(Boolean).slice(0, 4);
}

/**
 * On phones, wide tables are shown as cards: each cell gets its column title as a label.
 * Runs on every change so all screens and windows get it without extra code.
 */
function cardify(root = document) {
  for (const table of root.querySelectorAll('table.table')) {
    const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    if (heads.length < 4) continue;
    table.classList.add('cardify');
    for (const tr of table.querySelectorAll('tbody tr, tfoot tr')) {
      let col = 0;
      for (const td of tr.children) {
        const label = heads[col] || '';
        if (label && !td.hasAttribute('colspan')) td.dataset.label = label;
        else td.removeAttribute('data-label');
        if (!label && td.querySelector('button, a.btn')) td.classList.add('cell-actions');
        if (!td.textContent.trim() && !td.querySelector('button, a, input, select, svg, img')) td.classList.add('cell-empty');
        col += Number(td.getAttribute('colspan')) || 1;
      }
    }
  }
}
let cardifyQueued = false;
new MutationObserver(() => {
  if (cardifyQueued) return;
  cardifyQueued = true;
  requestAnimationFrame(() => { cardifyQueued = false; cardify(); });
}).observe(document.body, { childList: true, subtree: true });

boot();
