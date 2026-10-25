// Working with no internet.
// - Every page's last answer is kept on the device, so screens still open (with the last data seen).
// - The till keeps the whole product list (with IMEIs) and can keep selling.
// - Sales made with no internet wait here and upload by themselves when it's back.
// Stored in IndexedDB; sales are only ever uploaded by the person who made them.

const DB_NAME = 'mm-offline';
let dbp = null;

function idb() {
  dbp ||= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('kv');
      r.result.createObjectStore('outbox', { keyPath: 'ref' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}

async function run(store, mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

// ---------- last answer of each page ----------
const NO_CACHE = /^\/(version|search|notifications)|[?&]q=/;
export const cacheRead = (path) => run('kv', 'readonly', (s) => s.get('GET ' + path)).catch(() => undefined);
export function cacheWrite(path, data) {
  if (NO_CACHE.test(path) || data === undefined) return;
  run('kv', 'readwrite', (s) => s.put(data, 'GET ' + path)).catch(() => {});
}
/** On logout / login: another person may use this device next. Waiting sales stay. */
export const cacheClear = () => run('kv', 'readwrite', (s) => s.clear()).catch(() => {});

// ---------- online / offline ----------
let offline = false;
let userId = null;
const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));

export const isOffline = () => offline;
export function setOffline(v) {
  if (v === offline) return;
  offline = v;
  emit('mm:net', { offline });
  if (!v) sync();
}

/** Any response from the server, except "the server isn't there" (502/503/504 from the host). */
export const serverDown = (status) => status === 502 || status === 503 || status === 504;

// ---------- the till's product list ----------
const CATALOG = 'GET /pos/catalog';
export const getCatalog = () => run('kv', 'readonly', (s) => s.get(CATALOG)).catch(() => undefined);

/** Take sold items off the saved list, so the till doesn't sell the same IMEI twice before the next refresh. */
export async function takeFromCatalog(items) {
  const c = await getCatalog();
  if (!c) return;
  for (const it of items) {
    const p = c.products.find((x) => x.id === it.product_id);
    if (p) p.qty -= it.qty;
    if (it.serial && c.serials[it.product_id]) c.serials[it.product_id] = c.serials[it.product_id].filter((s) => s !== it.serial);
  }
  await run('kv', 'readwrite', (s) => s.put(c, CATALOG)).catch(() => {});
}

// ---------- sales waiting for the internet ----------
export const newRef = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

export function localStamp(d = new Date()) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export async function queueSale(body, summary) {
  await run('outbox', 'readwrite', (s) => s.put({ ref: body.client_ref, user_id: userId, body, summary, status: 'pending', error: null }));
  emit('mm:outbox');
}

/** This person's waiting sales, oldest first. */
export async function outbox() {
  const all = await run('outbox', 'readonly', (s) => s.getAll()).catch(() => []);
  return (all || []).filter((x) => x.user_id === userId).sort((a, b) => String(a.body.offline_at).localeCompare(String(b.body.offline_at)));
}

export async function dropQueued(ref) {
  await run('outbox', 'readwrite', (s) => s.delete(ref));
  emit('mm:outbox');
}

export async function retryQueued(ref) {
  const all = await outbox();
  const it = all.find((x) => x.ref === ref);
  if (!it) return;
  it.status = 'pending';
  it.error = null;
  await run('outbox', 'readwrite', (s) => s.put(it));
  emit('mm:outbox');
  return sync();
}

let syncing = null;
/** Upload waiting sales one by one. A refused one is kept aside with the reason, for someone to look at. */
export function sync() {
  if (syncing || userId == null) return syncing;
  syncing = (async () => {
    let sent = 0, refused = 0;
    try {
      for (const it of await outbox()) {
        if (it.status !== 'pending') continue;
        let res;
        try {
          res = await fetch('/api/sales', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(it.body), credentials: 'same-origin' });
        } catch {
          setOffline(true);
          break;
        }
        if (serverDown(res.status)) { setOffline(true); break; }
        offline && setOffline(false);
        if (res.ok) {
          await run('outbox', 'readwrite', (s) => s.delete(it.ref));
          sent++;
          continue;
        }
        if (res.status === 401 || res.status >= 500) break; // logged out, or a server hiccup: try again later
        const data = await res.json().catch(() => null);
        it.status = 'failed';
        it.error = data?.error || 'السيستم رفض الفاتورة';
        await run('outbox', 'readwrite', (s) => s.put(it));
        refused++;
      }
    } finally {
      syncing = null;
      emit('mm:outbox', { sent, refused });
    }
  })();
  return syncing;
}

/** Start watching the connection for this person. */
export function initOffline(id) {
  userId = id;
  window.addEventListener('online', () => sync());
  window.addEventListener('offline', () => setOffline(true));
  // While offline (or with sales waiting) check back every 15 seconds
  setInterval(async () => {
    if (!offline && !(await outbox()).some((x) => x.status === 'pending')) return;
    try {
      const r = await fetch('/api/version', { cache: 'no-store' });
      if (!serverDown(r.status)) { setOffline(false); sync(); }
    } catch { setOffline(true); }
  }, 15000);
  sync();
}
