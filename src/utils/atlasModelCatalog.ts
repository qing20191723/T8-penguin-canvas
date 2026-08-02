import type { AtlasCatalogItem } from '../types/canvas';

export type AtlasRecentModelMode =
  | 'image'
  | 'image-edit'
  | 'text-to-video'
  | 'image-to-video'
  | 'reference-to-video'
  | 'llm'
  | 'speech'
  | 'music';

const RECENT_PREFIX = 't8.atlas.recent-model.v1.';

export const ATLAS_RECOMMENDED_MODELS = [
  'bytedance/seedream-v5.0-pro/text-to-image',
  'bytedance/seedream-v5.0-pro/edit',
  'google/nano-banana-pro/text-to-image',
  'google/nano-banana-pro/edit',
  'openai/gpt-image-2/text-to-image',
  'openai/gpt-image-2/edit',
  'alibaba/wan-2.7/text-to-video',
  'alibaba/wan-2.7/image-to-video',
  'alibaba/wan-2.7/reference-to-video',
  'atlascloud/wan-2.7-spicy/reference-to-video',
  'bytedance/seedance-2.0/text-to-video',
  'bytedance/seedance-2.0/image-to-video',
  'moonshotai/kimi-k3',
  'bytedance/seed-audio-1.0',
];

export function atlasModelFamily(id: string) {
  const family = id.split('/')[1] || id;
  return family.replace(/\/(?:text-to-image|image-to-video|reference-to-video|edit)$/, '');
}

export function atlasModelOperation(item: AtlasCatalogItem) {
  const id = item.id.toLowerCase();
  if (item.type.toLowerCase() === 'text') return 'LLM';
  if (/\basr\b|speech-to-text|transcri/.test(id)) return '语音识别';
  if (/music|song/.test(id)) return '音乐';
  if (item.type.toLowerCase() === 'audio') return '语音/音频';
  if (id.includes('reference-to-video')) return '参考生视频';
  if (id.includes('image-to-video')) return '图生视频';
  if (id.includes('text-to-video')) return '文生视频';
  if (/\/edit$|image-to-image|inpaint|outpaint/.test(id)) return '图像编辑';
  if (item.type.toLowerCase() === 'image') return '文生图';
  return item.type;
}

export function fallbackAtlasCatalogItem(
  id: string,
  kind: 'image' | 'video' | 'llm' | 'audio',
): AtlasCatalogItem {
  const type = kind === 'llm' ? 'Text' : `${kind[0].toUpperCase()}${kind.slice(1)}`;
  return {
    id,
    model: id,
    name: id,
    displayName: id,
    type,
    provider: id.split('/')[0] || 'Atlas',
    schema: '',
  };
}

export function rememberAtlasModel(mode: AtlasRecentModelMode, model: string) {
  try { window.localStorage.setItem(`${RECENT_PREFIX}${mode}`, model); } catch { /* local storage can be disabled */ }
}

export function readRememberedAtlasModel(mode: AtlasRecentModelMode) {
  try { return window.localStorage.getItem(`${RECENT_PREFIX}${mode}`) || ''; } catch { return ''; }
}

export function recentModeForAtlasModel(
  item: AtlasCatalogItem,
  fallback: AtlasRecentModelMode,
): AtlasRecentModelMode {
  const operation = atlasModelOperation(item);
  if (operation === '图像编辑') return 'image-edit';
  if (operation === '文生图') return 'image';
  if (operation === '文生视频') return 'text-to-video';
  if (operation === '图生视频') return 'image-to-video';
  if (operation === '参考生视频') return 'reference-to-video';
  if (operation === 'LLM') return 'llm';
  if (operation === '音乐') return 'music';
  if (item.type.toLowerCase() === 'audio') return 'speech';
  return fallback;
}
