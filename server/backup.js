'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { getSettings, today } = require('./util');

/**
 * Automatic daily backups. One file per day in `backup_dir` (setting) or data/backups,
 * keeping the newest `backup_keep` files. Point backup_dir at a Google Drive / OneDrive
 * folder on the shop PC and every backup is also stored online.
 */
function backupDir(db, dataDir) {
  const custom = (getSettings(db).backup_dir || '').trim();
  return custom || path.join(dataDir, 'backups');
}

function listBackups(dir) {
  try {
    return fs.readdirSync(dir)
      .filter((f) => /^mobilemix-\d{4}-\d{2}-\d{2}\.db$/.test(f))
      .map((f) => {
        const st = fs.statSync(path.join(dir, f));
        return { file: f, size: st.size, at: st.mtime.toISOString() };
      })
      .sort((a, b) => b.file.localeCompare(a.file));
  } catch {
    return [];
  }
}

function runBackup(db, dataDir, { force = false } = {}) {
  const dir = backupDir(db, dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `mobilemix-${today()}.db`);
  if (fs.existsSync(file) && !force) return { file, skipped: true };
  const tmp = `${file}.tmp`;
  fs.rmSync(tmp, { force: true });
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  fs.renameSync(tmp, file);
  const keep = Math.max(1, Number(getSettings(db).backup_keep) || 30);
  for (const old of listBackups(dir).slice(keep)) fs.rmSync(path.join(dir, old.file), { force: true });
  return { file, skipped: false };
}

function scheduleBackups(db, dataDir) {
  const tick = () => {
    try {
      const r = runBackup(db, dataDir);
      if (!r.skipped) console.log(`  💾 نسخة احتياطية: ${r.file}`);
    } catch (e) {
      console.error('  ⚠️ فشل النسخ الاحتياطي:', e.message);
    }
  };
  tick();
  return setInterval(tick, 60 * 60 * 1000).unref();
}

module.exports = { runBackup, listBackups, backupDir, scheduleBackups };
