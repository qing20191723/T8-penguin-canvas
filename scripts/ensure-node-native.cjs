'use strict';

const { spawnSync } = require('node:child_process');

const VERIFY_CODE = [
  "const Database = require('better-sqlite3');",
  "const db = new Database(':memory:');",
  "db.prepare('select 1 as ok').get();",
  'db.close();',
].join(' ');

function verifyBetterSqliteInChild() {
  return spawnSync(process.execPath, ['-e', VERIFY_CODE], {
    encoding: 'utf8',
    env: process.env,
  });
}

const initialCheck = verifyBetterSqliteInChild();
if (!initialCheck.error && initialCheck.status === 0) {
  console.log('[prestart] better-sqlite3 is compatible with Node.js', process.versions.node);
  process.exit(0);
}

const isRender = String(process.env.RENDER || '').toLowerCase() === 'true';
const isWebDeploy = isRender || process.env.T8_WEB_DEPLOY === '1';
const initialMessage = `${initialCheck.stderr || initialCheck.stdout || initialCheck.error || ''}`.trim();

if (!isWebDeploy) {
  console.error('[prestart] better-sqlite3 native binding check failed.');
  if (initialMessage) console.error(initialMessage);
  process.exit(initialCheck.status || 1);
}

console.warn('[prestart] Incompatible cached better-sqlite3 binding detected; rebuilding for Node.js.');
if (initialMessage) console.warn(initialMessage);

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

const finalCheck = verifyBetterSqliteInChild();
if (!finalCheck.error && finalCheck.status === 0) {
  console.log('[prestart] better-sqlite3 was rebuilt successfully for Node.js', process.versions.node);
  process.exit(0);
}

console.error('[prestart] better-sqlite3 remains incompatible after rebuild.');
const finalMessage = `${finalCheck.stderr || finalCheck.stdout || finalCheck.error || ''}`.trim();
if (finalMessage) console.error(finalMessage);
process.exit(finalCheck.status || 1);
