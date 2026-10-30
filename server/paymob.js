'use strict';
const crypto = require('node:crypto');

/**
 * Card payments through Paymob (Accept). The shop owner puts their own keys in Settings → online store.
 * Flow: register the order with Paymob, get a payment key, send the customer to Paymob's card page;
 * Paymob then calls us back (signed with the shop's HMAC secret) with the result.
 */
const BASE = 'https://accept.paymob.com/api';

// Fields Paymob signs, in this order (its documented "transaction processed / response callback" HMAC)
const HMAC_FIELDS = ['amount_cents', 'created_at', 'currency', 'error_occured', 'has_parent_transaction', 'id', 'integration_id',
  'is_3d_secure', 'is_auth', 'is_capture', 'is_refunded', 'is_standalone_payment', 'is_voided', 'order', 'owner', 'pending',
  'source_data.pan', 'source_data.sub_type', 'source_data.type', 'success'];

const KEYS = ['paymob_api_key', 'paymob_integration_id', 'paymob_iframe_id', 'paymob_hmac'];

function config(db) {
  const out = {};
  for (const k of KEYS) out[k] = db.prepare('SELECT value FROM secrets WHERE key = ?').get(k)?.value || '';
  out.ready = KEYS.every((k) => out[k]);
  return out;
}

function saveConfig(db, body) {
  const put = db.prepare('INSERT OR REPLACE INTO secrets (key, value) VALUES (?, ?)');
  for (const k of KEYS) {
    const v = body?.[k];
    // Empty means "keep what's saved"; a single "-" clears it
    if (v === undefined || v === null || String(v).trim() === '') continue;
    if (String(v).trim() === '-') db.prepare('DELETE FROM secrets WHERE key = ?').run(k);
    else put.run(k, String(v).trim().slice(0, 500));
  }
}

async function call(path, body) {
  const res = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Paymob ${path}: ${res.status} ${data.detail || data.message || ''}`.trim());
  return data;
}

/** Returns { url, paymobOrderId } to send the customer to. */
async function startPayment(db, order) {
  const c = config(db);
  if (!c.ready) throw new Error('الدفع بالفيزا مش متظبط');
  const { token } = await call('/auth/tokens', { api_key: c.paymob_api_key });
  const amount = Math.round(order.total * 100);
  const reg = await call('/ecommerce/orders', {
    auth_token: token, delivery_needed: false, amount_cents: amount, currency: 'EGP',
    merchant_order_id: `${order.order_no}-${Date.now().toString(36)}`, items: [],
  });
  const [first, ...rest] = String(order.customer_name).trim().split(/\s+/);
  const key = await call('/acceptance/payment_keys', {
    auth_token: token, amount_cents: amount, expiration: 3600, order_id: reg.id, currency: 'EGP',
    integration_id: Number(c.paymob_integration_id), lock_order_when_paid: true,
    billing_data: {
      first_name: first || 'Customer', last_name: rest.join(' ') || 'NA', phone_number: order.phone, email: 'NA',
      street: order.address || 'NA', city: order.governorate || 'NA', country: 'EG', state: order.governorate || 'NA',
      building: 'NA', floor: 'NA', apartment: 'NA', postal_code: 'NA', shipping_method: 'NA',
    },
  });
  return { url: `https://accept.paymob.com/api/acceptance/iframes/${encodeURIComponent(c.paymob_iframe_id)}?payment_token=${encodeURIComponent(key.token)}`, paymobOrderId: String(reg.id) };
}

const pick = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

/** The signed values, from the POST body's `obj` or the GET query string, as Paymob builds them. */
function signedString(src, fromQuery) {
  return HMAC_FIELDS.map((f) => {
    let v = fromQuery ? src[f] : (f === 'order' ? pick(src, 'order.id') : pick(src, f));
    if (v === undefined || v === null) v = '';
    return typeof v === 'boolean' ? String(v) : String(v);
  }).join('');
}

/** Checks Paymob's signature; returns { ok, paymobOrderId, txnId, success, amountCents } */
function verify(db, src, hmac, { fromQuery = false } = {}) {
  const c = config(db);
  if (!c.paymob_hmac || !hmac) return { ok: false };
  const mine = crypto.createHmac('sha512', c.paymob_hmac).update(signedString(src, fromQuery)).digest('hex');
  const a = Buffer.from(mine), b = Buffer.from(String(hmac).toLowerCase());
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  const val = (k) => (fromQuery ? src[k] : (k === 'order' ? pick(src, 'order.id') : pick(src, k)));
  return {
    ok,
    paymobOrderId: String(val('order') ?? ''),
    txnId: String(val('id') ?? ''),
    success: String(val('success')) === 'true' && String(val('pending')) !== 'true',
    amountCents: Number(val('amount_cents')),
  };
}

module.exports = { config, saveConfig, startPayment, verify, signedString, HMAC_FIELDS };
