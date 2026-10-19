'use strict';
const os = require('node:os');
const path = require('node:path');
const dbFile = process.env.MM_DB || path.join(__dirname, '..', 'data', 'mobilemix.db');
const dataDir = path.dirname(dbFile);
const db = require('./db').open(dbFile);
const { createApp } = require('./app');
const { scheduleBackups } = require('./backup');

const PORT = Number(process.env.PORT) || 3000;
createApp(db, { dataDir }).listen(PORT, '0.0.0.0', () => {
  console.log('\n  Mobile Mix شغّال ✅');
  console.log(`  على الجهاز ده:   http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      const remote = i.address.startsWith('100.') ? '  (Tailscale — من برة المحل)' : '';
      console.log(`  من أجهزة الشبكة: http://${i.address}:${PORT}${remote}`);
    }
  }
  console.log('');
  scheduleBackups(db, dataDir);
});
