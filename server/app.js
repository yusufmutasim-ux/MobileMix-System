'use strict';
const path = require('node:path');
const express = require('express');
const { sessionMiddleware } = require('./auth');
const { HttpError } = require('./util');
const hosting = require('./hosting');
const { createNotifier } = require('./notify');

// Bump with every release so it's easy to see which version a shop is running
const BUILD = '2026.10.20-design2';

function createApp(db, { dataDir = path.join(__dirname, '..', 'data'), pushSender } = {}) {
  const app = express();
  app.disable('x-powered-by');
  // On a shop PC, remote access comes through a tunnel on localhost; on Railway through its proxy
  app.set('trust proxy', hosting.trustProxy());
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.use(sessionMiddleware(db));

  if (hosting.cloud) {
    app.use((req, res, next) => {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000');
      next();
    });
  }

  const notifier = createNotifier(db, { send: pushSender });
  app.locals.notifier = notifier;

  const api = express.Router();
  api.notifier = notifier;
  api.get('/health', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ ok: true });
  });
  // Which build is running (Railway sets the commit), to check a deploy went through
  const version = `${require('../package.json').version}${process.env.RAILWAY_GIT_COMMIT_SHA ? `-${process.env.RAILWAY_GIT_COMMIT_SHA.slice(0, 7)}` : ''}`;
  api.get('/version', (_req, res) => res.json({ version, build: BUILD }));
  api.use(require('./routes/shifts').shiftLock(db));
  require('./routes/admin')(api, db, { dataDir });
  require('./routes/products')(api, db);
  require('./routes/sales')(api, db);
  require('./routes/stocktakes')(api, db);
  require('./routes/repairs')(api, db);
  require('./routes/reports')(api, db);
  require('./routes/shifts')(api, db);
  require('./routes/notifications')(api, db);
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
