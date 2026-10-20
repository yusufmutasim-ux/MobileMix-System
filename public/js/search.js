// One search box for everything: products, invoices, repairs, customers, suppliers.
// Open with the 🔍 button, Ctrl+K (⌘K on Mac) or "/" .
import { api, icon, esc, debounce } from './core.js';

const KIND_ICON = { products: 'box', sales: 'receipt', repairs: 'wrench', customers: 'user', suppliers: 'truck' };
let openBox = null;

export function openSearch() {
  if (openBox) { openBox.querySelector('input').focus(); return; }
  const back = document.createElement('div');
  back.className = 'modal-back search-back';
  back.innerHTML = `<div class="search-box" role="dialog" aria-label="بحث">
      <div class="search-input">${icon('search')}<input class="input" placeholder="دوّر على منتج، فاتورة، IMEI، عميل، تذكرة صيانة…" autocomplete="off" inputmode="search">
        <kbd class="kbd">Esc</kbd></div>
      <div class="search-results"><div class="search-hint">اكتب حرفين أو أكتر — اسم، رقم تليفون، رقم فاتورة أو IMEI</div></div>
    </div>`;
  document.body.append(back);
  openBox = back;
  const input = back.querySelector('input');
  const out = back.querySelector('.search-results');
  let items = [];
  let active = 0;

  const close = () => {
    if (!openBox) return;
    back.classList.add('closing');
    setTimeout(() => back.remove(), 160);
    openBox = null;
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('hashchange', close);
  };
  const go = (i) => { const it = items[i]; if (it) { close(); location.hash = it.url; } };
  const mark = () => out.querySelectorAll('[data-i]').forEach((a) => a.classList.toggle('on', Number(a.dataset.i) === active));

  let seq = 0;
  const run = debounce(async () => {
    const q = input.value.trim();
    const my = ++seq;
    if (q.length < 2) { out.innerHTML = '<div class="search-hint">اكتب حرفين أو أكتر — اسم، رقم تليفون، رقم فاتورة أو IMEI</div>'; items = []; return; }
    try {
      const r = await api.get('/search?q=' + encodeURIComponent(q));
      if (my !== seq) return; // a newer search already started
      items = r.groups.flatMap((g) => g.items.map((it) => ({ ...it, kind: g.kind })));
      active = 0;
      let i = 0;
      out.innerHTML = r.groups.length ? r.groups.map((g) => `
        <div class="search-group">${esc(g.title)}</div>
        ${g.items.map((it) => `<a href="${esc(it.url)}" data-i="${i++}" class="search-item">
          <span class="si-icon">${icon(KIND_ICON[g.kind] || 'search')}</span>
          <span class="si-text"><b>${esc(it.title)}</b><span class="muted small">${esc(it.sub || '')}</span></span></a>`).join('')}`).join('')
        : `<div class="search-hint">مفيش نتايج لـ "${esc(q)}"</div>`;
      mark();
    } catch { /* offline: keep what's there */ }
  }, 180);

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); active = (active + 1) % items.length; mark(); out.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); active = (active - 1 + items.length) % items.length; mark(); out.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter' && document.activeElement === input) { e.preventDefault(); go(active); }
  }
  input.addEventListener('input', run);
  out.addEventListener('click', (e) => { const a = e.target.closest('[data-i]'); if (a) { e.preventDefault(); go(Number(a.dataset.i)); } });
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('hashchange', close);
  setTimeout(() => input.focus(), 30);
}

/** Keyboard shortcuts for the search box. */
export function initSearchKeys() {
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable;
    if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); openSearch(); }
    else if (e.key === '/' && !typing && !document.querySelector('.modal-back')) { e.preventDefault(); openSearch(); }
  });
}
