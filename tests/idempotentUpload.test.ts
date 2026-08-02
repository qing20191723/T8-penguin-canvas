import test from 'node:test';
import assert from 'node:assert/strict';

import {
  idempotencyKeyForUpload,
  idempotentUploadFetch,
  recoverableUploadResponse,
  uploadRetryAfterMs,
} from '../src/services/idempotentUpload.ts';

test('upload idempotency key is stable for one file and distinct across files', () => {
  const first = new Blob(['first']);
  const second = new Blob(['second']);
  assert.equal(idempotencyKeyForUpload(first), idempotencyKeyForUpload(first));
  assert.notEqual(idempotencyKeyForUpload(first), idempotencyKeyForUpload(second));
  assert.match(idempotencyKeyForUpload(first), /^upload:[A-Za-z0-9-]{16,}$/);
});

test('upload retries only explicit recoverable bootstrap 503 responses with one key', async () => {
  const originalFetch = globalThis.fetch;
  const seenKeys: string[] = [];
  let calls = 0;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    seenKeys.push(new Headers(init?.headers).get('Idempotency-Key') || '');
    if (calls < 3) {
      return Response.json(
        { code: calls === 1 ? 'backend_starting' : 'backend_proxy_unavailable', recoverable: true },
        { status: 503, headers: { 'Retry-After': '0' } },
      );
    }
    return Response.json({ success: true }, { status: 200 });
  }) as typeof fetch;
  try {
    const file = new Blob(['payload']);
    const response = await idempotentUploadFetch('/api/files/upload', new FormData(), file);
    assert.equal(response.status, 200);
    assert.equal(calls, 3);
    assert.equal(new Set(seenKeys).size, 1);
    assert.match(seenKeys[0], /^upload:/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('upload does not retry conflict, capacity, ambiguous 503, or transport failures', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const response of [
      Response.json({ code: 'idempotency_conflict' }, { status: 409 }),
      Response.json({ code: 'insufficient_storage' }, { status: 507 }),
      Response.json({ code: 'backend_starting', recoverable: false }, { status: 503 }),
      Response.json({ code: 'something_else', recoverable: true }, { status: 503 }),
    ]) {
      let calls = 0;
      globalThis.fetch = (async () => {
        calls += 1;
        return response;
      }) as typeof fetch;
      await idempotentUploadFetch('/api/files/upload', new FormData(), new Blob(['x']));
      assert.equal(calls, 1);
    }

    let transportCalls = 0;
    globalThis.fetch = (async () => {
      transportCalls += 1;
      throw new TypeError('connection reset after request write');
    }) as typeof fetch;
    await assert.rejects(
      idempotentUploadFetch('/api/files/upload', new FormData(), new Blob(['x'])),
      /connection reset/,
    );
    assert.equal(transportCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('recoverability and Retry-After parsing are fail closed', () => {
  assert.equal(recoverableUploadResponse(503, { recoverable: true, code: 'backend_starting' }), true);
  assert.equal(recoverableUploadResponse(502, { recoverable: true, code: 'backend_starting' }), false);
  assert.equal(recoverableUploadResponse(503, { recoverable: true, code: 'unknown' }), false);
  assert.equal(uploadRetryAfterMs('2'), 2000);
  assert.equal(uploadRetryAfterMs('not-a-date'), 0);
});
