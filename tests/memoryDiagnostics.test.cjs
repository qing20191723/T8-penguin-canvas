'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  SCHEMA,
  authorizeBearer,
  constantTimeTokenEqual,
  createActivityTracker,
  processMemorySnapshot,
  queueSummary,
  requestKind,
  storageStatus,
} = require('../backend/src/services/memoryDiagnostics');

test('memory debug bearer authorization uses an opaque constant-time comparison', () => {
  const token = 'memory-debug-token-abcdefghijklmnopqrstuvwxyz';
  assert.equal(constantTimeTokenEqual(token, token), true);
  assert.equal(constantTimeTokenEqual(`${token}x`, token), false);
  assert.equal(constantTimeTokenEqual('', token), false);
  assert.equal(authorizeBearer({ headers: { authorization: `Bearer ${token}` } }, token), true);
  assert.equal(authorizeBearer({ headers: { authorization: `Basic ${token}` } }, token), false);
});

test('process and storage snapshots contain metrics without filesystem paths', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 't8-memory-status-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const processSnapshot = processMemorySnapshot('test');
  for (const field of ['pid', 'rss', 'heapUsed', 'heapTotal', 'external', 'arrayBuffers', 'uptime', 'v8HeapLimit']) {
    assert.equal(Number.isFinite(processSnapshot[field]), true, field);
  }
  const storage = storageStatus(directory);
  assert.equal(typeof storage.persistentDiskConfigured, 'boolean');
  assert.equal(Object.hasOwn(storage, 'path'), false);
  assert.equal(JSON.stringify(storage).includes(directory), false);
});

test('activity tracker counts request streams and logs only bounded metric data', () => {
  const messages = [];
  const tracker = createActivityTracker('test', {
    logger: { info: (message) => messages.push(message), warn: (message) => messages.push(message) },
  });
  const response = new EventEmitter();
  const request = { method: 'POST', originalUrl: '/api/files/upload?filename=private-name.png' };
  let nextCalled = false;
  tracker.middleware(request, response, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.deepEqual(tracker.snapshot(), { activeRequests: 1, activeUploads: 1, activeDownloads: 0 });
  response.emit('finish');
  assert.deepEqual(tracker.snapshot(), { activeRequests: 0, activeUploads: 0, activeDownloads: 0 });
  assert.equal(messages.every((message) => message.includes(SCHEMA)), true);
  assert.equal(messages.join('\n').includes('private-name.png'), false);
  tracker.close();
});

test('queue summary projects counts without returning queue records', () => {
  const summary = queueSummary({
    previewPipeline: {
      status: () => ({
        active: 2,
        counts: { queued: 3 },
        pending: { recovery: true, completions: 4, reschedules: 5, reruns: 6 },
        privateJob: { prompt: 'must-not-leak' },
      }),
    },
    semanticPipeline: { diagnosticStatus: () => ({ active: 1, queued: 7, downloads: 2, path: 'private' }) },
    runRecoveryManager: { status: () => ({ running: true, pending: 8, ticket: { url: 'private' } }) },
  });
  assert.deepEqual(summary, {
    preview: { active: 2, queued: 3, pending: 16 },
    semantic: { active: 1, queued: 7, downloads: 2 },
    recovery: { active: 1, pending: 8 },
  });
  assert.doesNotMatch(JSON.stringify(summary), /prompt|url|path|private/i);
});

test('request classifier distinguishes upload and download streams', () => {
  assert.equal(requestKind({ method: 'POST', url: '/api/files/upload' }), 'upload');
  assert.equal(requestKind({ method: 'GET', url: '/api/project-assets/a/media' }), 'download');
  assert.equal(requestKind({ method: 'GET', url: '/api/status' }), 'request');
});
