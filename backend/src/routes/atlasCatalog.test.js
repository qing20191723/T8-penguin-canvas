const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../config');
const atlasProxy = require('./atlasProxy');

const {
  CATALOG_FALLBACK_MODELS,
  catalogEnvelope,
  isOfficialAtlasSchema,
  normalizeOutputs,
  readCatalogCache,
  writeCatalogCache,
} = atlasProxy._test;

test('Atlas proxy recognizes audio output URL variants', () => {
  assert.deepEqual(normalizeOutputs({
    audio_url: 'https://example.com/voice.mp3',
    audioUrls: ['https://example.com/music.wav', 'https://example.com/voice.mp3'],
  }), [
    'https://example.com/voice.mp3',
    'https://example.com/music.wav',
  ]);
});

test('Atlas catalog accepts public official-schema models and preserves exact dynamic count', () => {
  const items = [
    { id: 'vendor/image', type: 'Image', schema: 'https://static.atlascloud.ai/model/schema/vendor-image.json' },
    { id: 'vendor/video', type: 'Video', schema: 'https://static.atlascloud.ai/model/schema/vendor-video.json' },
    { id: 'vendor/audio', type: 'Audio', schema: 'https://static.atlascloud.ai/model/schema/vendor-audio.json' },
    { id: 'vendor/text', type: 'Text', schema: 'https://static.atlascloud.ai/model/schema/vendor-text.json' },
    { id: 'unsafe/model', type: 'Image', schema: 'https://evil.example/schema.json' },
  ];
  const envelope = catalogEnvelope(items, 'live', '2026-08-02T00:00:00.000Z');
  assert.equal(envelope.total, 4);
  assert.equal(envelope.models.Image.length, 1);
  assert.equal(envelope.models.Video.length, 1);
  assert.equal(envelope.models.Audio.length, 1);
  assert.equal(envelope.models.Text.length, 1);
  assert.match(envelope.catalogDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(isOfficialAtlasSchema('https://static.atlascloud.ai/model/schema/a.json'), true);
  assert.equal(isOfficialAtlasSchema('https://static.atlascloud.ai.evil.example/model/schema/a.json'), false);
});

test('Atlas catalog cache round-trips as cache source and fallback remains fixture-sized', () => {
  const original = config.ATLAS_CATALOG_CACHE_FILE;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 't8-atlas-catalog-'));
  config.ATLAS_CATALOG_CACHE_FILE = path.join(temp, 'catalog.json');
  try {
    const live = catalogEnvelope(CATALOG_FALLBACK_MODELS, 'live', '2026-08-02T01:02:03.000Z');
    writeCatalogCache(live);
    const cached = readCatalogCache();
    assert.equal(cached.source, 'cache');
    assert.equal(cached.fetchedAt, live.fetchedAt);
    assert.equal(cached.total, CATALOG_FALLBACK_MODELS.length);
    assert.equal(cached.catalogDigest, live.catalogDigest);
  } finally {
    config.ATLAS_CATALOG_CACHE_FILE = original;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
