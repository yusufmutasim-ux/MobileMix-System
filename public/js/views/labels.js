import { api, state, icon, esc, money, toast, toastErr, debounce } from '../core.js';
import { LABEL_SIZES, labelHtml, printLabels } from '../print.js';

const QUEUE_KEY = 'mm_label_queue';

export async function render(el, { query, actions }) {
  let queue = load(); // [{ product, copies }]
  let size = state.settings.label_size || '38x25';
  const cats = await api.get('/categories');

  // Saved queue may hold old prices — refresh them
  const fresh = await Promise.all(queue.map((q) => api.get('/products/' + q.product.id).catch(() => null)));
  queue = queue.map((q, i) => (fresh[i] ? { ...q, product: fresh[i] } : null)).filter(Boolean);

  if (query.get('add')) {
    try {
      const p = await api.get('/products/' + query.get('add'));
      if (!queue.some((q) => q.product.id === p.id)) queue.push({ product: p, copies: 1 });
      history.replaceState(null, '', '#/labels');
    } catch (e) { toastErr(e); }
  }

  actions.innerHTML = `<button class="btn btn-primary" id="print">${icon('print')} طباعة</button>`;

  el.innerHTML = `
    <div class="grid grid-2" style="align-items:start">
      <div class="card">
        <div class="card-head"><h2>اختار المنتجات</h2></div>
        <div class="search">${icon('search')}<input class="input" id="q" placeholder="امسح الباركود أو اكتب اسم المنتج…" autocomplete="off"></div>
        <div id="results" style="margin-top:8px"></div>
        <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
          <select class="input" id="cat" style="flex:1;min-width:160px"><option value="">— ضيف قسم كامل —</option>${cats.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
          <button class="btn btn-outline" id="add-cat">${icon('plus')} إضافة القسم</button>
        </div>
        <label class="check" style="margin-top:12px"><input type="checkbox" id="by-stock"> عدد النسخ = الكمية في المخزن</label>
      </div>
      <div class="card">
        <div class="card-head"><h2>قائمة الطباعة</h2>
          <select class="input" id="size" style="width:auto">${Object.entries(LABEL_SIZES).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')}</select>
          <button class="btn btn-ghost btn-sm" id="clear">${icon('trash')}</button></div>
        <div id="queue"></div>
        <p class="muted small" id="total" style="margin-bottom:0"></p>
      </div>
    </div>
    <div class="card" style="margin-top:24px">
      <div class="card-head"><h2>معاينة</h2><span class="muted small">الحجم الحقيقي تقريباً</span></div>
      <div class="label-preview" id="preview"></div>
    </div>`;

  const $ = (s) => el.querySelector(s);
  $('#size').value = size;

  function add(p) {
    const copies = $('#by-stock').checked ? Math.max(1, p.qty) : 1;
    const ex = queue.find((q) => q.product.id === p.id);
    if (ex) ex.copies += 1; else queue.push({ product: p, copies });
    draw();
  }

  function draw() {
    save(queue);
    $('#queue').innerHTML = queue.length ? `<table class="table"><tbody>${queue.map((q, i) => `
      <tr data-i="${i}"><td><b style="font-weight:500">${esc(q.product.name)}</b><div class="muted small">${money(q.product.sell_price)}</div></td>
        <td style="width:110px"><input class="input num" type="number" min="1" max="500" value="${q.copies}" data-copies style="min-height:36px;padding:6px 10px"></td>
        <td style="width:40px"><button class="btn btn-ghost btn-icon" data-del>${icon('x')}</button></td></tr>`).join('')}</tbody></table>`
      : `<div class="empty">${icon('tag')}ضيف منتجات عشان تطبع ليبلاتها</div>`;
    const total = queue.reduce((s, q) => s + q.copies, 0);
    $('#total').textContent = total ? `إجمالي ${total} ليبل` : '';
    $('#preview').innerHTML = queue.slice(0, 6).map((q) => labelHtml(q.product, size)).join('') || '<span class="muted">—</span>';
    actions.querySelector('#print').disabled = !total;
  }

  async function search() {
    const q = $('#q').value.trim();
    if (!q) { $('#results').innerHTML = ''; return; }
    const rows = await api.get('/products?limit=8&q=' + encodeURIComponent(q));
    $('#results').innerHTML = rows.map((p) => `
      <button class="pcard" style="width:100%;flex-direction:row;align-items:center;margin-top:6px;padding:10px 14px" data-id="${p.id}">
        <span style="flex:1;font-weight:500">${esc(p.name)}</span><span class="num muted small">${esc(p.barcode || '')}</span><span>${money(p.sell_price)}</span>
      </button>`).join('') || '<p class="muted small">مفيش نتائج</p>';
    $('#results').querySelectorAll('[data-id]').forEach((b) =>
      b.addEventListener('click', () => { add(rows.find((r) => r.id === Number(b.dataset.id))); $('#q').value = ''; $('#results').innerHTML = ''; $('#q').focus(); }));
  }

  $('#q').addEventListener('input', debounce(() => search().catch(toastErr), 250));
  $('#q').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !$('#q').value.trim()) return;
    try {
      const r = await api.get('/products/lookup?code=' + encodeURIComponent($('#q').value.trim()));
      add(r.product);
      $('#q').value = ''; $('#results').innerHTML = '';
    } catch { /* not a barcode — the list is shown */ }
  });
  $('#add-cat').addEventListener('click', async () => {
    if (!$('#cat').value) return;
    const rows = await api.get('/products?category_id=' + $('#cat').value).catch(toastErr);
    (rows || []).forEach(add);
    toast(`اتضاف ${rows?.length || 0} منتج`);
  });
  $('#queue').addEventListener('click', (e) => {
    if (!e.target.closest('[data-del]')) return;
    queue.splice(Number(e.target.closest('tr').dataset.i), 1);
    draw();
  });
  $('#queue').addEventListener('change', (e) => {
    const inp = e.target.closest('[data-copies]');
    if (!inp) return;
    queue[Number(inp.closest('tr').dataset.i)].copies = Math.max(1, Math.min(500, parseInt(inp.value, 10) || 1));
    draw();
  });
  $('#size').addEventListener('change', () => { size = $('#size').value; draw(); });
  $('#clear').addEventListener('click', () => { queue = []; draw(); });
  actions.querySelector('#print').addEventListener('click', () => printLabels(queue, size));

  draw();
  $('#q').focus();
}

function load() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY)) || []; } catch { return []; }
}
function save(q) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch { /* ignore */ }
}
