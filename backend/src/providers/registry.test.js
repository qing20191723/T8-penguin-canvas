const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_ADVANCED_PROVIDERS,
  SUPPORTED_PROTOCOLS,
  normalizeAdvancedProviders,
} = require('./registry');

test('public provider registry keeps only Atlas Cloud plus one optional custom API', () => {
  const providers = normalizeAdvancedProviders([
    { id: 'modelscope', protocol: 'modelscope', enabled: true, apiKey: 'ms-key' },
    { id: 'volcengine', protocol: 'volcengine', enabled: true, apiKey: 'ark-key' },
    { id: 'atlas', protocol: 'atlas', enabled: false, baseUrl: 'https://wrong.example/v1', apiKey: 'atlas-key', imageModels: ['foreign/model'] },
    { id: 'custom-one', protocol: 'openai-compatible', enabled: true, baseUrl: 'https://first.example/v1', apiKey: 'first' },
    { id: 'custom-two', protocol: 'openai-compatible', enabled: true, baseUrl: 'https://second.example/v1', apiKey: 'second', imageModels: ['custom/image'] },
  ]);

  assert.deepEqual([...SUPPORTED_PROTOCOLS].sort(), ['atlas', 'openai-compatible']);
  assert.deepEqual(providers.map((provider) => provider.id), ['atlas', 'custom-api']);

  const atlas = providers[0];
  assert.equal(atlas.protocol, 'atlas');
  assert.equal(atlas.enabled, true);
  assert.equal(atlas.baseUrl, 'https://api.atlascloud.ai/api/v1');
  assert.equal(atlas.apiKey, 'atlas-key');
  assert.deepEqual(atlas.imageModels, DEFAULT_ADVANCED_PROVIDERS[0].imageModels);
  assert.deepEqual(atlas.videoModels, DEFAULT_ADVANCED_PROVIDERS[0].videoModels);
  assert.deepEqual(atlas.chatModels, DEFAULT_ADVANCED_PROVIDERS[0].chatModels);
  assert.ok(!atlas.imageModels.includes('foreign/model'));

  const custom = providers[1];
  assert.equal(custom.id, 'custom-api');
  assert.equal(custom.protocol, 'openai-compatible');
  assert.equal(custom.baseUrl, 'https://second.example/v1');
  assert.equal(custom.apiKey, 'second');
  assert.deepEqual(custom.imageModels, ['custom/image']);
});

test('legacy-only settings still receive an enabled Atlas provider and a disabled custom slot', () => {
  const providers = normalizeAdvancedProviders([
    { id: 'runninghub', protocol: 'comfyui', enabled: true },
    { id: 'jimeng', protocol: 'jimeng-cli', enabled: true },
  ]);
  assert.equal(providers.length, 2);
  assert.equal(providers[0].id, 'atlas');
  assert.equal(providers[0].enabled, true);
  assert.equal(providers[1].id, 'custom-api');
  assert.equal(providers[1].enabled, false);
});
