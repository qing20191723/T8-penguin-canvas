const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ATLAS_MODELS_URL,
  getAtlasModelSchema,
  resetAtlasSchemaCaches,
} = require('./atlasSchema');

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('Atlas schema loader follows only the official model catalog and static schema origin', async () => {
  resetAtlasSchemaCaches();
  const schemaUrl = 'https://static.atlascloud.ai/model/schema/example-image.json';
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url) === ATLAS_MODELS_URL) {
      return jsonResponse({
        data: [
          { model: 'example/image', type: 'Image', schema: schemaUrl, display_console: true },
          { model: 'hidden/model', type: 'Image', schema: schemaUrl, display_console: false },
        ],
      });
    }
    if (String(url) === schemaUrl) {
      return jsonResponse({
        components: {
          schemas: {
            Input: {
              type: 'object',
              required: ['model', 'prompt'],
              properties: { model: { type: 'string' }, prompt: { type: 'string' } },
            },
          },
        },
      });
    }
    throw new Error(`unexpected url ${url}`);
  };

  const first = await getAtlasModelSchema('example/image', { schemaFetchImpl: fetchImpl });
  const second = await getAtlasModelSchema('example/image', { schemaFetchImpl: fetchImpl });
  assert.equal(first.type, 'Image');
  assert.equal(first.schemaUrl, schemaUrl);
  assert.deepEqual(first.input.required, ['model', 'prompt']);
  assert.equal(second, first);
  assert.deepEqual(calls, [ATLAS_MODELS_URL, schemaUrl]);
});

test('Atlas schema loader rejects catalog entries pointing outside the official static origin', async () => {
  resetAtlasSchemaCaches();
  const fetchImpl = async (url) => {
    if (String(url) === ATLAS_MODELS_URL) {
      return jsonResponse({
        data: [{ model: 'example/unsafe', type: 'Image', schema: 'https://evil.example/schema.json', display_console: true }],
      });
    }
    throw new Error('unsafe schema URL must not be fetched');
  };
  await assert.rejects(
    getAtlasModelSchema('example/unsafe', { schemaFetchImpl: fetchImpl }),
    /没有提供 .*的官方 Schema/,
  );
});
