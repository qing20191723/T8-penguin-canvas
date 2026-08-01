'use strict';

const { spawnSync } = require('node:child_process');

if (process.env.GITHUB_HEAD_REF === 'fix/atlas-video-schema-clean-ui') {
  require('../.github/inspect-current-ui.cjs');
}

const isRender = String(process.env.RENDER || '').toLowerCase() === 'true';
const isWebDeploy = isRender || process.env.T8_WEB_DEPLOY === '1';

if (isWebDeploy) {
  console.log('[postinstall] Web deployment detected; preserving Node.js native module ABI.');
  console.log('[postinstall] Skipping electron-builder install-app-deps.');
  process.exit(0);
}

const command = process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder';
const result = spawnSync(command, ['install-app-deps'], {
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error('[postinstall] Failed to launch electron-builder:', result.error);
  process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
