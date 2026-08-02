const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const config = require('../backend/src/config');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 't8-upload-receipt-'));
config.DATA_DIR = path.join(temporaryRoot, 'data');
config.INPUT_DIR = path.join(temporaryRoot, 'input');
config.OUTPUT_DIR = path.join(temporaryRoot, 'output');
fs.mkdirSync(config.INPUT_DIR, { recursive: true });

const filesTest = require('../backend/src/routes/files')._test;

test.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('upload receipt is atomic, replayable, and never stores the raw key', async () => {
  const key = 'upload:stable-operation-0001';
  const first = { filename: 'one.png', url: '/files/input/one.png', size: 7 };
  await filesTest.writeUploadReceipt(key, 'sha256:first', first);

  const receipt = await filesTest.readUploadReceipt(key);
  assert.equal(receipt.schema, 't8-upload-receipt-v1');
  assert.equal(receipt.contentHash, 'sha256:first');
  assert.deepEqual(receipt.data, first);
  assert.equal(JSON.stringify(receipt).includes(key), false);
  assert.equal(fs.readdirSync(path.dirname(filesTest.uploadReceiptPath(key))).some((name) => name.endsWith('.part')), false);

  assert.deepEqual(filesTest.resolveUploadReceiptReplay(receipt, 'sha256:first'), {
    ...first,
    duplicate: true,
  });
  assert.throws(
    () => filesTest.resolveUploadReceiptReplay(receipt, 'sha256:different'),
    (error) => error?.status === 409 && error?.code === 'idempotency_conflict',
  );
});

test('upload receipt can atomically refresh provisional metadata', async () => {
  const key = 'upload:stable-operation-0002';
  await filesTest.writeUploadReceipt(key, 'sha256:same', { assetId: null, availability: 'unverified' });
  await filesTest.writeUploadReceipt(key, 'sha256:same', { assetId: 'asset-1', availability: 'available' });
  const receipt = await filesTest.readUploadReceipt(key);
  assert.deepEqual(receipt.data, { assetId: 'asset-1', availability: 'available' });
});

test('invalid upload keys fail with 400 and known impossible sizes fail with 507 semantics', () => {
  assert.throws(
    () => filesTest.uploadIdempotencyKey({ get: () => 'short' }),
    (error) => error?.status === 400 && error?.code === 'invalid_idempotency_key',
  );
  assert.throws(
    () => filesTest.assertUploadDiskSpace({ get: () => String(Number.MAX_SAFE_INTEGER) }),
    (error) => error?.code === 'ENOSPC',
  );
});

test('upload endpoint replays same-key same-file and rejects same-key different-file', async (t) => {
  const indexed = [];
  filesTest.setFilesRouteTestDependencies({
    assetIndexer: {
      async indexFile(filename) {
        indexed.push(filename);
        return { id: `asset-${indexed.length}`, storageMode: 'managed', availability: 'available' };
      },
    },
  });
  const app = express();
  app.use('/api/files', require('../backend/src/routes/files'));
  const server = await listen(app);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/files/upload`;
  const key = 'upload:http-operation-0003';

  async function send(value) {
    const form = new FormData();
    form.append('file', new Blob([value], { type: 'image/png' }), 'fixture.png');
    return fetch(base, { method: 'POST', headers: { 'Idempotency-Key': key }, body: form });
  }

  const first = await send('same bytes').then((response) => response.json());
  const replay = await send('same bytes').then((response) => response.json());
  const conflictResponse = await send('different bytes');
  const conflict = await conflictResponse.json();

  assert.equal(first.success, true);
  assert.equal(replay.success, true);
  assert.equal(replay.data.duplicate, true);
  assert.equal(replay.data.url, first.data.url);
  assert.equal(indexed.length, 1);
  assert.equal(conflictResponse.status, 409);
  assert.equal(conflict.code, 'idempotency_conflict');
  assert.equal(fs.readdirSync(config.INPUT_DIR).length, 1);
});
