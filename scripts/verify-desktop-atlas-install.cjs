#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FORBIDDEN_PATH_MARKERS = [
  '/agent/', '/skills/', '/zcanvas-cli/', '/runtime-archives/', '/parsehub-', '/figma-bridge/',
  '/photoshop-bridge/', '/collaboration/', '/runninghub/', '/vibex/', '/feishu/', '/comfyui/',
];

function normalize(value) {
  return `/${String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase()}/`;
}

function walkFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(target);
      else if (entry.isFile()) files.push(target);
    }
  }
  return files;
}

function validateInstallTree(appDir, options = {}) {
  const productName = options.productName || 'Qingchen-AtlasCanvas';
  const required = [
    `${productName}.exe`,
    'resources/app.asar',
    'resources/app-update.yml',
    'resources/backend-enc/server.t8c',
    'resources/frontend/index.html',
    'resources/tools/ffmpeg/ffmpeg.exe',
    'resources/tools/ffmpeg/ffprobe.exe',
  ];
  const errors = [];
  for (const relative of required) {
    const target = path.join(appDir, ...relative.split('/'));
    if (!fs.existsSync(target) || !fs.statSync(target).isFile() || fs.statSync(target).size <= 0) {
      errors.push(`missing installed file: ${relative}`);
    }
  }
  const files = fs.existsSync(appDir) ? walkFiles(appDir) : [];
  for (const filename of files) {
    const relative = normalize(path.relative(appDir, filename));
    for (const marker of FORBIDDEN_PATH_MARKERS) {
      if (relative.includes(marker)) errors.push(`disabled resource found in install tree: ${relative}`);
    }
  }
  const updateConfig = path.join(appDir, 'resources', 'app-update.yml');
  if (fs.existsSync(updateConfig)) {
    const text = fs.readFileSync(updateConfig, 'utf8');
    if (!/owner:\s*qing20191723/i.test(text) || !/repo:\s*T8-penguin-canvas/i.test(text)) {
      errors.push('app-update.yml does not target qing20191723/T8-penguin-canvas');
    }
    if (/T8mars/i.test(text)) errors.push('app-update.yml still references upstream T8mars');
  }
  const secret = String(options.secret || '');
  if (secret) {
    const needle = Buffer.from(secret);
    for (const filename of files) {
      if (fs.readFileSync(filename).includes(needle)) errors.push(`secret scan value found in ${path.relative(appDir, filename)}`);
    }
  }
  return { errors, files: files.length };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function main() {
  const appDir = path.resolve(argument('--app-dir') || 'dist_electron/win-unpacked');
  const result = validateInstallTree(appDir, { secret: process.env.T8_SECRET_SCAN_VALUE });
  if (result.errors.length) throw new Error(`[desktop-atlas-install] ${result.errors.join('; ')}`);
  console.log(JSON.stringify({ schema: 't8-desktop-atlas-install-report-v1', appDir, files: result.files }));
}

if (require.main === module) main();

module.exports = { FORBIDDEN_PATH_MARKERS, validateInstallTree, walkFiles };
