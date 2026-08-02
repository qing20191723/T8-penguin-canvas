const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.T8_ATLAS_ONLY_RUNTIME;
const {
  DEFAULT_ADVANCED_PROVIDER_IDS,
  SUPPORTED_PROTOCOLS,
  normalizeAdvancedProviders,
} = require('./registry');

test('desktop registry preserves legacy provider cards and saved settings', () => {
  assert.deepEqual([...SUPPORTED_PROTOCOLS].sort(), [
    'agnes',
    'atlas',
    'comfyui',
    'jimeng-cli',
    'modelscope',
    'openai-compatible',
    'volcengine',
  ]);
  assert.ok(DEFAULT_ADVANCED_PROVIDER_IDS.includes('modelscope'));
  assert.ok(DEFAULT_ADVANCED_PROVIDER_IDS.includes('volcengine'));
  assert.ok(DEFAULT_ADVANCED_PROVIDER_IDS.includes('comfyui'));

  const providers = normalizeAdvancedProviders([
    { id: 'modelscope', protocol: 'modelscope', enabled: true, apiKey: 'desktop-key' },
  ]);
  const modelscope = providers.find((provider) => provider.id === 'modelscope');
  assert.equal(modelscope?.enabled, true);
  assert.equal(modelscope?.apiKey, 'desktop-key');
  assert.equal(modelscope?.imageModels[0], 'Tongyi-MAI/Z-Image-Turbo');
});
