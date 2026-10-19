'use strict';
const path = require('node:path');
const express = require('express');
const { sessionMiddleware } = require('./auth');
const { HttpError } = require('./util');

function createApp(db, { dataDir = path.join(__dirname, '..', 'data') } = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Remote access goes through a tunnel on this PC (Tailscale / Cloudflare), which connects from localhost
  app.set('trust proxy', 'loopback');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.use(sessionMiddleware(db));

  const api = express.Router();
  require('./routes/admin')(api, db, { dataDir });
  require('./routes/products')(api, db);
  require('./routes/sales')(api, db);
  require('./routes/stocktakes')(api, db);
  require('./routes/repairs')(api, db);
  require('./routes/reports')(api, db);
  api.use((_req, res) => res.status(404).json({ error: 'غير موجود' }));
  app.use('/api', api);

  const root = path.join(__dirname, '..');
  app.use('/fonts/plex', express.static(path.join(root, 'node_modules/@fontsource/ibm-plex-sans-arabic/files'), { maxAge: '30d' }));
  app.use('/fonts/poppins', express.static(path.join(root, 'node_modules/@fontsource/poppins/files'), { maxAge: '30d' }));
  app.use('/vendor', express.static(path.join(root, 'node_modules/jsbarcode/dist'), { maxAge: '30d' }));
  app.use(express.static(path.join(root, 'public'), {
    // Always revalidate app files so updates show up right away (the service worker keeps an offline copy)
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'بيانات غير صحيحة' });
    if (err && /UNIQUE constraint failed: products\.barcode/.test(err.message))
      return res.status(409).json({ error: 'الباركود ده مستخدم لمنتج تاني' });
    if (err && /UNIQUE constraint failed: serials\.serial/.test(err.message))
      return res.status(409).json({ error: 'رقم الـ IMEI / السيريال ده متسجل قبل كده' });
    if (err && /UNIQUE constraint failed/.test(err.message))
      return res.status(409).json({ error: 'القيمة دي موجودة بالفعل' });
    console.error(err);
    res.status(500).json({ error: 'حصل خطأ في السيرفر' });
  });

  return app;
}

module.exports = { createApp };
