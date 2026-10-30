import { api, state, can, icon, esc, LOGO_FULL, ROLE_NAMES, toastErr, modal, busy, toast, currentTheme, setTheme, confirmBox, money, fmtDate } from './core.js';
import { enterView, softly } from './motion.js';
import { initShift, initNotifications } from './live.js';
import { openSearch, initSearchKeys } from './search.js';
import { addCameraButton } from './camera.js';
import { startPrintStation } from './print.js';
import { initOffline, isOffline, outbox, sync, dropQueued, retryQueued, cacheClear } from './offline.js';

const NAV = [
  { path: '/', title: 'الرئيسية', icon: 'home', view: 'dashboard' },
  { path: '/pos', title: 'نقطة البيع', short: 'البيع', icon: 'cart', view: 'pos', perm: 'sales.create' },
  { path: '/sales', title: 'الفواتير', icon: 'receipt', view: 'sales', perm: 'sales.create' },
  { path: '/repairs', title: 'الصيانة', icon: 'wrench', view: 'repairs', perm: 'repairs.view' },
  { path: '/customers', title: 'العملاء', icon: 'user', view: 'customers', perm: 'customers.view' },
  { sep: 'المخزن' },
  { path: '/products', title: 'المنتجات', icon: 'box', view: 'products', perm: 'products.view' },
  { path: '/purchases', title: 'المشتريات والموردين', short: 'المشتريات', icon: 'truck', view: 'purchases', perm: 'purchases.manage' },
  { path: '/stocktake', title: 'الجرد', icon: 'clipboard', view: 'stocktake', perm: 'stocktake' },
  { path: '/labels', title: 'ليبلات الأسعار', icon: 'tag', view: 'labels', perm: 'labels.print' },
  { sep: 'الحسابات' },
  { path: '/drawer', title: 'الدرج (الخزنة)', short: 'الدرج', icon: 'drawer', view: 'drawer', perm: 'drawer.close' },
  { path: '/expenses', title: 'المصروفات', icon: 'expense', view: 'expenses', perm: 'expenses.create' },
  { path: '/payroll', title: 'المرتبات', icon: 'coins', view: 'payroll', perm: 'payroll' },
  { sep: 'الإدارة' },
  { path: '/reports', title: 'التقارير', icon: 'chart', view: 'reports', perm: 'reports.view' },
  { path: '/attendance', title: 'الحضور والانصراف', short: 'الحضور', icon: 'clock', view: 'attendance', perm: 'attendance.view' },
  { path: '/users', title: 'الموظفين', icon: 'users', view: 'users', perm: 'users.manage' },
  { path: '/settings', title: 'الإعدادات', icon: 'settings', view: 'settings' },
];

let cleanup = null;

async function boot() {
  try {
    const me = await api.get('/auth/me');
    Object.assign(state, { user: me.user, permissions: me.permissions, settings: me.settings, mustChangePassword: me.must_change_password, hosting: me.hosting || {} });
    initOffline(me.user.id);
  } catch {
    state.user = null;
  }
  window.addEventListener('hashchange', route);
  await route();
  if (state.user && state.mustChangePassword) forcePasswordChange();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((reg) => {
      // An app left open for days still picks up new versions (and the new icon) when it comes back to the front
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    }).catch(() => {});
  }
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
  if (await lockedOut()) {
    const { render } = await import('./views/lock.js');
    document.getElementById('app').innerHTML = '<div id="view"></div>';
    render(document.getElementById('view'));
    return;
  }
  if (!document.querySelector('.shell')) {
    shell();
    initShift();
    initNotifications();
    startPrintStation();
  }

  document.querySelectorAll('.nav a, .tabbar a, .topnav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + item.path));
  document.querySelectorAll('.topnav .dd').forEach((d) => { d.classList.toggle('has-active', !!d.querySelector('a.active')); d.classList.remove('open'); });
  document.querySelector('.sidebar').classList.remove('open');
  document.getElementById('page-title').textContent = item.title;
  document.title = `${item.title} — ${state.settings.shop_name || 'Mobile Mix'}`;
  const actions = document.getElementById('page-actions');
  actions.innerHTML = '';
  // Each visit gets its own container, so late async work from the previous page can't touch the new one
  const el = document.createElement('div');
  el.className = 'page';
  el.innerHTML = '<div class="empty loading" role="status" aria-label="جاري التحميل…"><span></span><span></span><span></span></div>';
  document.getElementById('view').replaceChildren(el);
  enterView(el);
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
    <aside class="sidebar" id="sidebar">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="brand"><div>${LOGO_FULL(48)}${state.settings.shop_name && state.settings.shop_name !== 'Mobile Mix'
        ? `<span class="brand-sub">${esc(state.settings.shop_name)}</span>` : '<span class="brand-sub">نظام المبيعات والصيانة</span>'}</div></div>
      <nav class="nav">
        ${visible.map((n) => n.sep ? `<div class="nav-sep">${n.sep}</div>` : `<a href="#${n.path}">${icon(n.icon)}<span>${n.title}</span></a>`).join('')}
      </nav>
      <div class="side-user">
        <div class="avatar">${esc(u.full_name.trim()[0] || '?')}</div>
        <div class="who"><b>${esc(u.full_name)}</b><span class="muted small">${ROLE_NAMES[u.role]}</span></div>
        <button class="btn btn-ghost btn-icon theme-btn" data-act="theme" title="الوضع الفاتح / الغامق">${icon(currentTheme() === 'dark' ? 'sun' : 'moon')}</button>
        <button class="btn btn-ghost btn-icon" data-act="logout" title="تسجيل خروج">${icon('logout')}</button>
      </div>
      <div class="small muted num app-version" style="padding:8px 4px 0;font-size:11px;text-align:center"></div>
    </aside>
    <main class="main">
      ${topNav(visible, u)}
      <header class="topbar">
        <button class="btn btn-ghost btn-icon menu-btn" id="menu">${icon('menu')}</button>
        <h1 id="page-title"></h1>
        <div class="top-tools">
          <button class="btn btn-ghost btn-icon search-btn" id="search-btn" title="بحث في كل حاجة (Ctrl+K)">${icon('search')}</button>
          <button class="net-box hidden" id="net-box" type="button"></button>
          <div id="shift-box"></div>
          <button class="btn btn-ghost btn-icon bell hidden" id="bell" title="الإشعارات">${icon('bell')}<span class="bell-count hidden" id="bell-count"></span></button>
        </div>
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
  document.querySelectorAll('[data-act="logout"]').forEach((b) => b.addEventListener('click', async () => {
    const waiting = (await outbox()).length;
    if (waiting && !(await confirmBox(`عندك ${waiting} فاتورة لسه مترفعتش. هتفضل متخزنة على الجهاز وهتترفع لما تدخل تاني بنفس الحساب. تخرج برضه؟`, { ok: 'خروج' }))) return;
    await api.post('/auth/logout').catch(() => {});
    await cacheClear();
    location.hash = '#/';
    location.reload();
  }));
  api.get('/version').then((v) => { document.querySelectorAll('.app-version').forEach((x) => { x.textContent = `نسخة ${v.build}`; }); }).catch(() => {});
  initTopNav();
  initNet();
  document.getElementById('search-btn').addEventListener('click', openSearch);
  initSearchKeys();
  document.querySelectorAll('[data-act="theme"]').forEach((b) => b.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    softly(() => {
      setTheme(next);
      document.querySelectorAll('[data-act="theme"]').forEach((x) => {
        x.querySelector('svg').outerHTML = icon(next === 'dark' ? 'sun' : 'moon');
        const label = x.querySelector('.theme-label');
        if (label) label.textContent = next === 'dark' ? 'الوضع الفاتح' : 'الوضع الغامق';
      });
    });
  }));
  const toggleMenu = () => document.querySelector('.sidebar').classList.toggle('open');
  sheetSwipe(document.getElementById('sidebar'));
  // Tapping the page you're already on still closes the menu
  document.querySelectorAll('.sidebar .nav a').forEach((a) => a.addEventListener('click', () => document.querySelector('.sidebar').classList.remove('open')));
  document.getElementById('menu').addEventListener('click', toggleMenu);
  document.getElementById('more').addEventListener('click', toggleMenu);
  document.getElementById('scrim').addEventListener('click', toggleMenu);
}

/**
 * No internet: a badge in the header says so, and how many sales are waiting to upload.
 * Tapping it lists them (with the reason for any the system refused).
 */
function initNet() {
  const box = document.getElementById('net-box');
  const draw = async () => {
    const list = await outbox();
    const waiting = list.filter((x) => x.status === 'pending').length;
    const refused = list.length - waiting;
    const off = isOffline();
    box.className = `net-box${off ? ' off' : refused ? ' warn' : waiting ? ' up' : ' hidden'}`;
    box.title = off ? 'مفيش نت — البيع شغال والفواتير هتترفع لوحدها' : refused ? 'فواتير محتاجة مراجعة' : 'بيرفع الفواتير';
    box.innerHTML = `${icon(off ? 'wifi-off' : refused ? 'alert' : 'upload')}<span class="nb-text">${off ? 'من غير نت' : refused ? 'مراجعة' : 'بيرفع'}</span>${list.length ? `<b class="num">${list.length}</b>` : ''}`;
  };
  document.addEventListener('mm:net', (e) => {
    draw();
    toast(e.detail.offline ? 'النت فصل — تقدر تكمل بيع عادي، والفواتير هتترفع لوحدها أول ما يرجع' : 'النت رجع ✓', e.detail.offline ? 'err' : 'ok');
  });
  document.addEventListener('mm:outbox', (e) => {
    draw();
    if (e.detail?.sent) toast(`اترفعت ${e.detail.sent} فاتورة كانت متسجلة من غير نت ✓`, 'ok');
    if (e.detail?.refused) toast(`في ${e.detail.refused} فاتورة السيستم رفضها — دوس على العلامة اللي فوق تشوف السبب`, 'err');
  });
  box.addEventListener('click', outboxModal);
  draw();
  // The till's product list, so selling keeps working if the internet drops later
  if (can('sales.create')) api.get('/pos/catalog').catch(() => {});
}

async function outboxModal() {
  const rows = async () => {
    const list = await outbox();
    if (!list.length) return `<div class="empty">${icon('check')}كل الفواتير اترفعت</div>`;
    return list.map((x) => `<div class="ob-row ${x.status}" data-ref="${esc(x.ref)}">
      <div class="ob-main"><b>${money(x.summary?.total ?? 0)}</b>
        <span class="muted small">${esc(fmtDate(x.body.offline_at))} • ${esc((x.summary?.names || []).slice(0, 2).join('، '))}${(x.summary?.names?.length || 0) > 2 ? ` +${x.summary.names.length - 2}` : ''}</span>
        ${x.status === 'failed' ? `<span class="small" style="color:var(--danger)">${icon('alert')} ${esc(x.error)}</span>` : '<span class="pill pill-gray">مستنية النت</span>'}</div>
      ${x.status === 'failed' ? `<div class="btn-row"><button class="btn btn-outline btn-sm" data-a="retry">${icon('undo')} جرب تاني</button>
        <button class="btn btn-ghost btn-sm" data-a="drop" style="color:var(--danger)">${icon('trash')} امسح</button></div>` : ''}
    </div>`).join('');
  };
  await modal({
    title: 'فواتير اتعملت من غير نت',
    body: `<p class="muted small" style="margin-top:0">الفواتير دي متخزنة على الجهاز ده وبتترفع لوحدها أول ما النت يرجع. الفاتورة اللي السيستم يرفضها
      (مثلاً جهاز اتباع قبل كده) بتفضل هنا لحد ما تشوفها.</p><div class="ob-list" id="ob-list">${await rows()}</div>`,
    foot: `<button class="btn btn-outline" data-close>قفل</button><button class="btn btn-primary" id="ob-sync">${icon('upload')} ارفع دلوقتي</button>`,
    onMount: (m) => {
      const list = m.querySelector('#ob-list');
      const redraw = async () => { list.innerHTML = await rows(); };
      document.addEventListener('mm:outbox', redraw);
      new MutationObserver((_, o) => { if (!m.isConnected) { document.removeEventListener('mm:outbox', redraw); o.disconnect(); } }).observe(document.body, { childList: true });
      m.querySelector('#ob-sync').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        await sync();
        if (isOffline()) toast('لسه مفيش نت', 'err');
      }));
      list.addEventListener('click', async (e) => {
        const b = e.target.closest('button[data-a]');
        if (!b) return;
        const ref = b.closest('.ob-row').dataset.ref;
        if (b.dataset.a === 'retry') await busy(b, () => retryQueued(ref));
        else if (await confirmBox('تمسح الفاتورة دي من الجهاز؟ مش هتتسجل في السيستم خالص — لو البيعة حصلت فعلاً سجلها تاني من نقطة البيع.', { ok: 'امسح', danger: true })) await dropQueued(ref);
      });
    },
  });
}

/**
 * Computers: navigation runs across the top. Main pages are links; each section
 * (stock, accounts, admin) opens a small menu; the account menu sits at the end.
 */
function topNav(visible, u) {
  const groups = [{ title: null, items: [] }];
  for (const n of visible) {
    if (n.sep) groups.push({ title: n.sep, items: [] });
    else groups[groups.length - 1].items.push(n);
  }
  const link = (n) => `<a href="#${n.path}" title="${n.title}">${icon(n.icon)}<span>${n.short || n.title}</span></a>`;
  return `<nav class="topnav" aria-label="القائمة">
    <a class="tn-brand" href="#/">${LOGO_FULL(34)}</a>
    <div class="tn-links">
      ${groups[0].items.map(link).join('')}
      ${groups.slice(1).filter((g) => g.items.length).map((g) => `
        <div class="dd">
          <button type="button" class="dd-btn">${icon(g.items[0].icon)}<span>${g.title}</span><svg class="chev" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></button>
          <div class="dd-menu">${g.items.map((n) => `<a href="#${n.path}">${icon(n.icon)}<span>${n.title}</span></a>`).join('')}</div>
        </div>`).join('')}
    </div>
    <div class="dd tn-account">
      <button type="button" class="dd-btn"><span class="avatar">${esc(u.full_name.trim()[0] || '?')}</span><span class="tn-name">${esc(u.full_name)}</span><svg class="chev" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></button>
      <div class="dd-menu">
        <div class="dd-head"><b>${esc(u.full_name)}</b><span class="muted small">${ROLE_NAMES[u.role]}</span></div>
        <button type="button" data-act="theme">${icon(currentTheme() === 'dark' ? 'sun' : 'moon')}<span class="theme-label">${currentTheme() === 'dark' ? 'الوضع الفاتح' : 'الوضع الغامق'}</span></button>
        <button type="button" data-act="logout">${icon('logout')}<span>تسجيل خروج</span></button>
        <div class="small muted num app-version dd-foot"></div>
      </div>
    </div>
  </nav>`;
}

function initTopNav() {
  const nav = document.querySelector('.topnav');
  if (!nav) return;
  nav.querySelectorAll('.dd-btn').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const dd = b.closest('.dd');
    const open = !dd.classList.contains('open');
    nav.querySelectorAll('.dd.open').forEach((x) => x.classList.remove('open'));
    dd.classList.toggle('open', open);
  }));
  nav.querySelectorAll('.dd-menu a').forEach((a) => a.addEventListener('click', () => a.closest('.dd').classList.remove('open')));
  document.addEventListener('click', (e) => { if (!e.target.closest('.topnav .dd')) nav.querySelectorAll('.dd.open').forEach((x) => x.classList.remove('open')); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') nav.querySelectorAll('.dd.open').forEach((x) => x.classList.remove('open')); });
}

/** Staff can't see anything until they check in, when the owner turned that on. */
let shiftChecked = null;
async function lockedOut() {
  if (state.user.role === 'admin' || state.settings.require_shift !== '2') return false;
  if (shiftChecked === null) {
    try { shiftChecked = !!(await api.get('/shifts/me')).open; } catch { shiftChecked = false; }
  }
  return !shiftChecked;
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
/** Tabs (segmented buttons): a pill that slides to the chosen tab. */
function segIndicators() {
  document.querySelectorAll('.seg').forEach((seg) => {
    const on = seg.querySelector(':scope > button.on');
    let ind = seg.querySelector(':scope > .seg-ind');
    if (!on || !seg.offsetParent) { if (ind) ind.style.opacity = '0'; return; }
    const first = !ind;
    if (first) {
      ind = document.createElement('span');
      ind.className = 'seg-ind';
      seg.prepend(ind);
      seg.classList.add('has-ind');
      ind.style.transition = 'none'; // first placement: no slide in from nowhere
    }
    ind.style.opacity = '1';
    ind.style.left = `${on.offsetLeft}px`;
    ind.style.width = `${on.offsetWidth}px`;
    if (first) requestAnimationFrame(() => requestAnimationFrame(() => { ind.style.transition = ''; }));
  });
}

/** Each person gets their own colour in the round initial badge. */
const AVATAR_TONES = ['lime', 'blue', 'yellow', 'violet', 'red', 'teal'];
function avatarColors() {
  document.querySelectorAll('.avatar:not([data-tone])').forEach((a) => {
    const t = (a.textContent || '?').trim();
    let h = 0;
    for (const ch of t + (a.closest('tr, .side-user, .customer-head')?.textContent || '').slice(0, 30)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    a.dataset.tone = AVATAR_TONES[h % AVATAR_TONES.length];
  });
}

/** Phones and tablets: a camera button in every box where you scan a barcode or IMEI. */
const touchDevice = matchMedia('(pointer: coarse)').matches;
function cameraButtons() {
  if (!touchDevice) return;
  document.querySelectorAll('.search > input').forEach((i) => {
    if (/باركود|IMEI/i.test(i.placeholder || '')) addCameraButton(i);
  });
}
let cardifyQueued = false;
new MutationObserver(() => {
  if (cardifyQueued) return;
  cardifyQueued = true;
  requestAnimationFrame(() => { cardifyQueued = false; cardify(); cameraButtons(); avatarColors(); segIndicators(); });
}).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
window.addEventListener('resize', () => requestAnimationFrame(segIndicators));

boot();

/** Phones: the menu is a bottom sheet; drag it down to close it. */
function sheetSwipe(sheet) {
  let y0 = null;
  let dy = 0;
  sheet.addEventListener('touchstart', (e) => {
    if (!sheet.classList.contains('open') || matchMedia('(min-width: 861px)').matches) return;
    const nav = sheet.querySelector('.nav');
    if (nav.contains(e.target) && nav.scrollTop > 0) return; // let the list scroll first
    y0 = e.touches[0].clientY;
    dy = 0;
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (y0 === null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    sheet.style.transition = 'none';
    sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  sheet.addEventListener('touchend', () => {
    if (y0 === null) return;
    y0 = null;
    sheet.style.transition = '';
    sheet.style.transform = '';
    if (dy > 90) sheet.classList.remove('open');
  });
}
