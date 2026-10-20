'use strict';
const os = require('node:os');
const path = require('node:path');
const hosting = require('./hosting');
const dbFile = hosting.dbFile();
const dataDir = path.dirname(dbFile);
const db = require('./db').open(dbFile);
const { createApp } = require('./app');
const { scheduleBackups } = require('./backup');
const { startScheduler } = require('./scheduler');

const PORT = Number(process.env.PORT) || 3000;
const app = createApp(db, { dataDir });
app.listen(PORT, '0.0.0.0', () => {
  console.log('\n  Mobile Mix شغّال ✅');
  console.log(`  على الجهاز ده:   http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      const remote = i.address.startsWith('100.') ? '  (Tailscale — من برة المحل)' : '';
      console.log(`  من أجهزة الشبكة: http://${i.address}:${PORT}${remote}`);
    }
  }
  if (hosting.cloud) {
    console.log(`  ☁️  شغال على السحابة — قاعدة البيانات: ${dbFile}`);
    if (!hosting.persistent) {
      console.log('  ⚠️  مفيش Volume! البيانات هتتمسح مع كل تحديث. ضيف Volume للخدمة من Railway.');
    }
  }
  console.log('');
  scheduleBackups(db, dataDir);
  startScheduler(db, app.locals.notifier);
});
