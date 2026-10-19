'use strict';
const path = require('node:path');

/**
 * Where the system runs:
 *  - shop PC (default): data in ./data, reached directly or through a tunnel on the same PC
 *  - Railway (cloud): data must live on a Railway Volume, requests come through Railway's proxy
 */
const cloud = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID || process.env.MM_CLOUD);
const volume = process.env.RAILWAY_VOLUME_MOUNT_PATH || '';

function dbFile() {
  if (process.env.MM_DB) return process.env.MM_DB;
  if (volume) return path.join(volume, 'mobilemix.db');
  return path.join(__dirname, '..', 'data', 'mobilemix.db');
}

/** Data survives restarts/redeploys? Always on a PC; on the cloud only on a volume. */
const persistent = !cloud || !!volume || !!process.env.MM_DB;

function trustProxy() {
  const v = process.env.TRUST_PROXY;
  if (v !== undefined && v !== '') return /^\d+$/.test(v) ? Number(v) : v === 'true' ? true : v;
  return cloud ? 1 : 'loopback';
}

module.exports = { cloud, volume, persistent, dbFile, trustProxy };
