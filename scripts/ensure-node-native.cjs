'use strict';

const { spawnSync } = require('node:child_process');

function clearBetterSqliteCache() {
  try {
    const resolved = require.resolve('better-sqlite3');
    delete require.cache[resolved];
  } catch {
    // Ignore resolution errors here; the verification step will report them.
  }
}

function verifyBetterSqlite() {
  clearBetterSqliteCache();
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.prepare('select 1 as ok').get();
  db.close();
}

try {
  verifyBetterSqlite();
  console.log('[prestart] better-sqlite3 is compatible with Node.js', process.versions.node);
  process.exit(0);
} catch (initialError) {
  const isRender = String(process.env.RENDER || '').toLowerCase() === 'true';
  const isWebDeploy = isRender || process.env.T8_WEB_DEPLOY === '1';

  if (!isWebDeploy) {
    console.error('[prestart] better-sqlite3 native binding check failed.');
    console.error(initialError);
    process.exit(1);
  }

  console.warn('[prestart] Incompatible cached better-sqlite3 binding detected; rebuilding for Node.js.');
  console.warn(initialError && initialError.message ? initialError.message : initialError);

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const rebuild = spawnSync(npmCommand, ['rebuild', 'better-sqlite3'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      npm_config_runtime: 'node',
      npm_config_target: process.versions.node,
      npm_config_disturl: 'https://nodejs.org/download/release',
    },
  });

  if (rebuild.error || rebuild.status !== 0) {
    console.error('[prestart] Failed to rebuild better-sqlite3 for Node.js.');
    if (rebuild.error) console.error(rebuild.error);
    process.exit(rebuild.status || 1);
  }

  try {
    verifyBetterSqlite();
    console.log('[prestart] better-sqlite3 was rebuilt successfully for Node.js', process.versions.node);
    process.exit(0);
  } catch (finalError) {
    console.error('[prestart] better-sqlite3 remains incompatible after rebuild.');
    console.error(finalError);
    process.exit(1);
  }
}
