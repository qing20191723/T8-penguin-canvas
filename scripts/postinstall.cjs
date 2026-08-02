'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const isRender = String(process.env.RENDER || '').toLowerCase() === 'true';
const isWebDeploy = isRender || process.env.T8_WEB_DEPLOY === '1';

if (isWebDeploy) {
  console.log('[postinstall] Web deployment detected; preserving Node.js native module ABI.');
  console.log('[postinstall] Skipping electron-builder install-app-deps.');
  process.exit(0);
}

let cliPath;
try {
  cliPath = path.join(path.dirname(require.resolve('electron-builder/package.json')), 'cli.js');
} catch (error) {
  console.error('[postinstall] Unable to resolve the local electron-builder CLI:', error);
  process.exit(1);
}

const result = spawnSync(process.execPath, [cliPath, 'install-app-deps'], {
  stdio: 'inherit',
  env: process.env,
  windowsHide: true,
});

if (result.error) {
  console.error('[postinstall] Failed to launch electron-builder:', result.error);
  process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
