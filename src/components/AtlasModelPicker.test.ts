import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATLAS_RECOMMENDED_MODELS,
  atlasModelFamily,
  atlasModelOperation,
  readRememberedAtlasModel,
  rememberAtlasModel,
} from '../utils/atlasModelCatalog.ts';
import type { AtlasCatalogItem } from '../types/canvas';

function item(id: string, type: string): AtlasCatalogItem {
  return { id, model: id, name: id, displayName: id, type, provider: id.split('/')[0], schema: 'https://static.atlascloud.ai/model/schema/test.json' };
}

test('Atlas picker classifies task modes and keeps locked recommendations discoverable', () => {
  assert.equal(atlasModelOperation(item('bytedance/seedream-v5.0-pro/edit', 'Image')), '图像编辑');
  assert.equal(atlasModelOperation(item('alibaba/wan-2.7/text-to-video', 'Video')), '文生视频');
  assert.equal(atlasModelOperation(item('atlascloud/wan-2.7-spicy/reference-to-video', 'Video')), '参考生视频');
  assert.equal(atlasModelOperation(item('bytedance/seed-asr-2.0', 'Audio')), '语音识别');
  assert.equal(atlasModelOperation(item('moonshotai/kimi-k3', 'Text')), 'LLM');
  assert.equal(atlasModelFamily('alibaba/wan-2.7/text-to-video'), 'wan-2.7');
  for (const model of [
    'bytedance/seedream-v5.0-pro/text-to-image',
    'google/nano-banana-pro/edit',
    'openai/gpt-image-2/text-to-image',
    'alibaba/wan-2.7/text-to-video',
    'bytedance/seedance-2.0/image-to-video',
  ]) assert.equal(ATLAS_RECOMMENDED_MODELS.includes(model), true);
});

test('Atlas recent model memory is isolated by task mode', () => {
  const values = new Map<string, string>();
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { setItem: (key: string, value: string) => values.set(key, value), getItem: (key: string) => values.get(key) || null } },
  });
  try {
    rememberAtlasModel('image', 'image/model');
    rememberAtlasModel('image-edit', 'edit/model');
    rememberAtlasModel('reference-to-video', 'video/model');
    assert.equal(readRememberedAtlasModel('image'), 'image/model');
    assert.equal(readRememberedAtlasModel('image-edit'), 'edit/model');
    assert.equal(readRememberedAtlasModel('reference-to-video'), 'video/model');
  } finally {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
  }
});
