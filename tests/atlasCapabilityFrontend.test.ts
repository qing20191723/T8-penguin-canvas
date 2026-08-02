import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifiedAtlasFallbackCapability } from '../src/utils/atlasCapability.ts';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const imageNodeSource = readFileSync(new URL('../src/components/nodes/ImageNode.tsx', import.meta.url), 'utf8');
const videoNodeSource = readFileSync(new URL('../src/components/nodes/VideoNode.tsx', import.meta.url), 'utf8');
const legacyVideoNodeSource = readFileSync(new URL('../src/components/nodes/SeedanceNode.tsx', import.meta.url), 'utf8');
const capabilityFieldsSource = readFileSync(new URL('../src/components/nodes/AtlasCapabilityFields.tsx', import.meta.url), 'utf8');
const atlasRouteSource = readFileSync(new URL('../backend/src/routes/atlasProxy.js', import.meta.url), 'utf8');

test('verified Atlas fallbacks preserve model-specific 4K and size semantics', () => {
  const nano = verifiedAtlasFallbackCapability('google/nano-banana-pro/text-to-image', 'image');
  assert.deepEqual(nano?.fields.find((field) => field.name === 'resolution')?.enum, ['1k', '2k', '4k']);

  const seedream = verifiedAtlasFallbackCapability('bytedance/seedream-v5.0-pro/text-to-image', 'image');
  assert.equal(seedream?.fields.some((field) => field.name === 'resolution'), false);
  assert.equal(seedream?.fields.find((field) => field.name === 'size')?.default, '2048*2048');

  const kling = verifiedAtlasFallbackCapability('kwaivgi/kling-v3.0-4k/text-to-video', 'video');
  assert.equal(kling?.fields.some((field) => field.name === 'resolution'), false, 'Kling 4K stays encoded in its model id');

  const spicy = verifiedAtlasFallbackCapability('atlascloud/wan-2.7-spicy/reference-to-video', 'video');
  assert.deepEqual(spicy?.fields.find((field) => field.name === 'resolution')?.enum, ['720P', '1080P', '1080P-SR', '1440P-SR']);
  assert.equal(verifiedAtlasFallbackCapability('unknown/model', 'video'), null);
});

test('image, video and legacy video nodes render sanitized Atlas capability fields', () => {
  for (const source of [imageNodeSource, videoNodeSource, legacyVideoNodeSource]) {
    assert.match(source, /<AtlasCapabilityFields/);
  }
  assert.match(capabilityFieldsSource, /getAtlasModelCapability/);
  assert.match(capabilityFieldsSource, /目录降级/);
  assert.doesNotMatch(capabilityFieldsSource, /schemaUrl|description|x-ui-component/);
});

test('new sidebar video node keeps the legacy seedance type but initializes Atlas Wan 2.7 Spicy', () => {
  assert.match(appSource, /\['image', 'video', 'seedance', 'llm'\]/);
  assert.match(appSource, /type === 'seedance'[\s\S]*?providerSource: 'atlas'[\s\S]*?providerId: 'atlas'[\s\S]*?providerModel: 'atlascloud\/wan-2\.7-spicy\/reference-to-video'/);
  assert.match(legacyVideoNodeSource, />视频<\/div>/);
});

test('Atlas schema endpoint returns the sanitized capability contract', () => {
  assert.match(atlasRouteSource, /router\.get\('\/schema'/);
  assert.match(atlasRouteSource, /getAtlasModelCapability\(model\)/);
  assert.doesNotMatch(atlasRouteSource, /res\.json\([^\n]*schemaUrl/);
});
