const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ATLAS_MODELS_URL,
  getAtlasModelCapability,
  getAtlasModelSchema,
  resetAtlasSchemaCaches,
} = require('./atlasSchema');
const nanoBanana = require('./fixtures/atlas/nano-banana-pro-text-to-image.json');
const seedream = require('./fixtures/atlas/seedream-v5-pro-text-to-image.json');
const kling = require('./fixtures/atlas/kling-v3-4k-text-to-video.json');
const wan = require('./fixtures/atlas/wan-2-7-reference-to-video.json');
const wanSpicy = require('./fixtures/atlas/wan-2-7-spicy-reference-to-video.json');
const seedAudio = require('./fixtures/atlas/seed-audio-1.json');
const seedAsr = require('./fixtures/atlas/seed-asr-2.json');

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

test('public capability keeps official field names, casing, limits and item shapes without leaking raw schema', async () => {
  const fixtures = [
    ['google/nano-banana-pro/text-to-image', 'Image', nanoBanana],
    ['bytedance/seedream-v5.0-pro/text-to-image', 'Image', seedream],
    ['kwaivgi/kling-v3.0-4k/text-to-video', 'Video', kling],
    ['alibaba/wan-2.7/reference-to-video', 'Video', wan],
    ['atlascloud/wan-2.7-spicy/reference-to-video', 'Video', wanSpicy],
    ['bytedance/seed-audio-1.0', 'Audio', seedAudio],
    ['bytedance/seed-asr-2.0', 'Audio', seedAsr],
  ];
  for (const [model, modelType, modelSchema] of fixtures) {
    const capability = await getAtlasModelCapability(model, { modelType, modelSchema });
    assert.equal(capability.schema, 't8-atlas-model-capability-v1');
    assert.equal(capability.model, model);
    assert.match(capability.schemaDigest, /^sha256:[a-f0-9]{64}$/);
    assert.ok(!('input' in capability));
    assert.ok(!('schemaUrl' in capability));
  }

  const nano = await getAtlasModelCapability('google/nano-banana-pro/text-to-image', { modelType: 'Image', modelSchema: nanoBanana });
  assert.deepEqual(nano.fields.find((field) => field.name === 'resolution').enum, ['1k', '2k', '4k']);
  const dream = await getAtlasModelCapability('bytedance/seedream-v5.0-pro/text-to-image', { modelType: 'Image', modelSchema: seedream });
  assert.equal(dream.fields.find((field) => field.name === 'size').default, '2048*2048');
  assert.equal(dream.fields.some((field) => field.name === 'resolution'), false);
  const klingCapability = await getAtlasModelCapability('kwaivgi/kling-v3.0-4k/text-to-video', { modelType: 'Video', modelSchema: kling });
  assert.equal(klingCapability.fields.some((field) => field.name === 'resolution'), false, 'Kling 4K is encoded by model id');
  assert.deepEqual(klingCapability.fields.find((field) => field.name === 'multi_prompt').items.fields.map((field) => [field.name, field.required]), [
    ['prompt', true],
    ['duration', true],
  ]);
  const spicy = await getAtlasModelCapability('atlascloud/wan-2.7-spicy/reference-to-video', { modelType: 'Video', modelSchema: wanSpicy });
  assert.equal(spicy.fields.find((field) => field.name === 'reference_images').min, 1);
  assert.deepEqual(spicy.fields.find((field) => field.name === 'resolution').enum, ['720P', '1080P', '1080P-SR', '1440P-SR']);
  const audio = await getAtlasModelCapability('bytedance/seed-audio-1.0', { modelType: 'Audio', modelSchema: seedAudio });
  assert.equal(audio.kind, 'audio');
  assert.equal(audio.operation, 'text-to-speech');
  assert.equal(audio.fields.find((field) => field.name === 'references').max, 3);
  assert.deepEqual(audio.fields.find((field) => field.name === 'sample_rate').enum, [8000, 16000, 24000, 32000, 44100, 48000]);
  const asr = await getAtlasModelCapability('bytedance/seed-asr-2.0', { modelType: 'Audio', modelSchema: seedAsr });
  assert.equal(asr.operation, 'speech-to-text');
  assert.equal(asr.fields.find((field) => field.name === 'audio_url').required, true);
});

test('public capability exposes sanitized oneOf modes without leaking branch schemas', async () => {
  const capability = await getAtlasModelCapability('example/one-of', {
    modelType: 'Video',
    modelSchema: {
      type: 'object',
      properties: { prompt: { type: 'string' }, image: { type: 'string' }, video: { type: 'string' } },
      oneOf: [
        { title: 'Image mode', required: ['prompt', 'image'], properties: { secret: { const: 'never-expose' } } },
        { title: 'Video mode', required: ['prompt', 'video'] },
      ],
    },
  });
  assert.deepEqual(capability.modes, [
    { id: 'mode-1', title: 'Image mode', required: ['prompt', 'image'] },
    { id: 'mode-2', title: 'Video mode', required: ['prompt', 'video'] },
  ]);
  assert.equal(JSON.stringify(capability).includes('never-expose'), false);
});

test('public capability digest is deterministic and changes with the official input schema', async () => {
  const first = await getAtlasModelCapability('google/nano-banana-pro/text-to-image', { modelType: 'Image', modelSchema: nanoBanana });
  const again = await getAtlasModelCapability('google/nano-banana-pro/text-to-image', { modelType: 'Image', modelSchema: JSON.parse(JSON.stringify(nanoBanana)) });
  const changed = await getAtlasModelCapability('google/nano-banana-pro/text-to-image', {
    modelType: 'Image',
    modelSchema: { ...nanoBanana, properties: { ...nanoBanana.properties, resolution: { type: 'string', enum: ['1k'] } } },
  });
  assert.equal(again.schemaDigest, first.schemaDigest);
  assert.notEqual(changed.schemaDigest, first.schemaDigest);
});
