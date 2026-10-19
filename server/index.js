'use strict';
const os = require('node:os');
const path = require('node:path');
const db = require('./db').open(process.env.MM_DB || path.join(__dirname, '..', 'data', 'mobilemix.db'));
const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 3000;
createApp(db).listen(PORT, '0.0.0.0', () => {
  console.log('\n  Mobile Mix شغّال ✅');
  console.log(`  على الجهاز ده:   http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) console.log(`  من أجهزة الشبكة: http://${i.address}:${PORT}`);
    }
  }
  console.log('');
});
