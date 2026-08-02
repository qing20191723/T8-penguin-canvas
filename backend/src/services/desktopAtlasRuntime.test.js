const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');

test('desktop Atlas provider registry exposes only Atlas and OpenAI-compatible providers', () => {
  process.env.T8_DESKTOP_ATLAS_RUNTIME = '1';
  delete require.cache[require.resolve('../providers/registry')];
  const registry = require('../providers/registry');
  assert.deepEqual([...registry.SUPPORTED_PROTOCOLS].sort(), ['atlas', 'openai-compatible']);
  assert.deepEqual(registry.DEFAULT_ADVANCED_PROVIDER_IDS, ['atlas', 'custom-api']);
  const normalized = registry.normalizeAdvancedProviders([
    { id: 'atlas', protocol: 'atlas', enabled: true, apiKey: 'atlas-key' },
    { id: 'custom-api', protocol: 'openai-compatible', enabled: true, apiKey: 'custom-key' },
    { id: 'modelscope', protocol: 'modelscope', enabled: true, apiKey: 'legacy-key' },
  ]);
  assert.deepEqual(normalized.map((provider) => provider.id), ['atlas', 'custom-api']);
  delete process.env.T8_DESKTOP_ATLAS_RUNTIME;
  delete require.cache[require.resolve('../providers/registry')];
});

test('desktop Atlas runtime is separate from Render and preserves the universal video node', () => {
  const vite = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
  const electronMain = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'backend/src/server.js'), 'utf8');
  const nodeRegistry = fs.readFileSync(path.join(root, 'src/config/nodeRegistry.ts'), 'utf8');
  const runtime = fs.readFileSync(path.join(root, 'src/config/atlasOnlyRuntime.ts'), 'utf8');
  const renderServer = fs.readFileSync(path.join(root, 'backend/src/renderServer.js'), 'utf8');

  assert.match(electronMain, /process\.env\.T8_DESKTOP_ATLAS_RUNTIME = '1'/);
  assert.match(vite, /__T8_DESKTOP_ATLAS_RUNTIME__/);
  assert.match(server, /runtime: DESKTOP_ATLAS_RUNTIME \? 'desktop-atlas'/);
  assert.match(server, /DESKTOP_LOCAL_FEATURES[\s\S]*?'image-operations'[\s\S]*?'video-operations'/);
  assert.match(server, /DESKTOP_ATLAS_RUNTIME[\s\S]*?atlasRuntimeDisabledRouter\('collaboration'\)/);
  assert.match(runtime, /DESKTOP_ATLAS_HIDDEN_NODE_TYPES[\s\S]*?'seedance'/);
  assert.doesNotMatch(runtime, /DESKTOP_ATLAS_HIDDEN_NODE_TYPES[\s\S]*?'video',/);
  assert.match(nodeRegistry, /DESKTOP_ATLAS_RUNTIME && item\.type === 'video'/);
  assert.match(nodeRegistry, /historical|历史画布兼容节点/);
  assert.doesNotMatch(renderServer, /T8_DESKTOP_ATLAS_RUNTIME/);
});
