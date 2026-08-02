'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('external Provider video output streams to an atomic validated file and completion manifest', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't8-external-stream-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const totalBytes = 16 * 1024 * 1024;
  const server = await listen(http.createServer((_req, res) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'video/mp4');
    res.write(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom'), Buffer.alloc(48)]));
    let written = 60;
    const write = () => {
      while (written < totalBytes) {
        const size = Math.min(64 * 1024, totalBytes - written);
        written += size;
        if (!res.write(Buffer.alloc(size, 0x61))) return res.once('drain', write);
      }
      res.end();
    };
    write();
  }));
  t.after(() => server.close());

  const config = require('../backend/src/config');
  const previousOutput = config.OUTPUT_DIR;
  const previousDefaults = {
    DEFAULT_LOCAL_SAVE_DIR: config.DEFAULT_LOCAL_SAVE_DIR,
    DEFAULT_CANVAS_AUTO_SAVE_DIR: config.DEFAULT_CANVAS_AUTO_SAVE_DIR,
    DEFAULT_RESOURCE_LIBRARY_DIR: config.DEFAULT_RESOURCE_LIBRARY_DIR,
    DEFAULT_THEME_TEMPLATE_DIR: config.DEFAULT_THEME_TEMPLATE_DIR,
  };
  config.OUTPUT_DIR = path.join(root, 'output');
  config.DEFAULT_LOCAL_SAVE_DIR = path.join(root, 'save');
  config.DEFAULT_CANVAS_AUTO_SAVE_DIR = path.join(root, 'canvas');
  config.DEFAULT_RESOURCE_LIBRARY_DIR = path.join(root, 'resources');
  config.DEFAULT_THEME_TEMPLATE_DIR = path.join(root, 'themes');
  t.after(() => {
    config.OUTPUT_DIR = previousOutput;
    Object.assign(config, previousDefaults);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const {
    outputSaveFailure,
    persistDataMediaOutput,
    persistRemoteMediaOutput,
  } = require('../backend/src/routes/externalProviders')._test;

  const originalConcat = Buffer.concat;
  Buffer.concat = function guardedConcat(items, length) {
    const inferred = length == null ? items.reduce((sum, item) => sum + item.length, 0) : length;
    if (inferred > 1024 * 1024) throw new Error('media-sized Buffer.concat is forbidden');
    return originalConcat.call(Buffer, items, length);
  };
  let url;
  try {
    url = await persistRemoteMediaOutput(`${base}/unknown-length`, 'video', {
      trustedLocalOrigins: new Set([base]),
    });
  } finally {
    Buffer.concat = originalConcat;
  }

  assert.match(url, /^\/files\/output\/external_.*\.mp4$/);
  const target = path.join(config.OUTPUT_DIR, path.basename(url));
  assert.equal(fs.statSync(target).size, totalBytes);
  const manifest = JSON.parse(fs.readFileSync(`${target}.complete.json`, 'utf8'));
  assert.equal(manifest.schema, 't8-media-download-complete-v1');
  assert.equal(manifest.byteSize, totalBytes);
  assert.equal(manifest.kind, 'video');
  assert.match(manifest.sha256, /^[a-f0-9]{64}$/);

  const embedded = Buffer.alloc(4 * 1024 * 1024, 0x62);
  Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(embedded, 0);
  const dataUrl = `data:image/png;base64,${embedded.toString('base64')}`;
  const originalFrom = Buffer.from;
  Buffer.from = function guardedFrom(value, ...args) {
    if (typeof value === 'string' && value.length > 1024 * 1024) {
      throw new Error('media-sized base64 decode is forbidden');
    }
    return originalFrom.call(Buffer, value, ...args);
  };
  let embeddedUrl;
  try {
    embeddedUrl = await persistDataMediaOutput(dataUrl, 'image');
  } finally {
    Buffer.from = originalFrom;
  }
  assert.match(embeddedUrl, /^\/files\/output\/external_.*\.png$/);
  const embeddedTarget = path.join(config.OUTPUT_DIR, path.basename(embeddedUrl));
  assert.equal(fs.statSync(embeddedTarget).size, embedded.length);
  assert.equal(JSON.parse(fs.readFileSync(`${embeddedTarget}.complete.json`, 'utf8')).byteSize, embedded.length);

  const originalStatfs = fs.statfsSync;
  fs.statfsSync = () => ({ bavail: 0, bsize: 4096 });
  try {
    await assert.rejects(
      persistRemoteMediaOutput(`${base}/disk-full`, 'video', { trustedLocalOrigins: new Set([base]) }),
      (error) => error?.code === 'ENOSPC',
    );
  } finally {
    fs.statfsSync = originalStatfs;
  }
  assert.equal(outputSaveFailure({ code: 'ENOSPC' }).code, 'output_disk_full');
  assert.equal(fs.readdirSync(config.OUTPUT_DIR).some((name) => name.endsWith('.part')), false);
});
