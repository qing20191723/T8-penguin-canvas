'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PROVIDER_SUBMISSION_HEADER,
  providerSubmissionContextMiddleware,
  providerIdempotencyHeadersLike,
} = require('./providerSubmissionContext');

test('stable browser submission identity is forwarded as the provider Idempotency-Key', async () => {
  const submissionKey = 'live-smoke.seedream-v5.20260802';
  const req = {
    get(name) {
      return String(name).toLowerCase() === PROVIDER_SUBMISSION_HEADER
        ? submissionKey
        : '';
    },
  };

  await new Promise((resolve, reject) => {
    providerSubmissionContextMiddleware(req, null, () => {
      setImmediate(() => {
        try {
          const headers = providerIdempotencyHeadersLike({ Accept: 'application/json' }, 'POST');
          assert.equal(headers['Idempotency-Key'], submissionKey);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  });
});

test('invalid or absent browser submission identity is never forwarded', () => {
  const req = { get: () => 'short' };
  providerSubmissionContextMiddleware(req, null, () => {
    const headers = providerIdempotencyHeadersLike({ Accept: 'application/json' }, 'POST');
    assert.equal(headers['Idempotency-Key'], undefined);
  });
});
