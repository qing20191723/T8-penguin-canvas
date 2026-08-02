import type { AtlasCapabilityField, AtlasModelCapability } from '../services/api';

const fields = (items: AtlasCapabilityField[]) => items;

export function verifiedAtlasFallbackCapability(
  model: string,
  kind: 'image' | 'video' | 'audio' | 'text',
): AtlasModelCapability | null {
  const common = {
    schema: 't8-atlas-model-capability-v1' as const,
    model,
    kind,
    schemaDigest: `fallback:${model}`,
  };
  if (/^google\/nano-banana-pro\/(?:text-to-image|edit)/.test(model)) {
    return {
      ...common,
      kind: 'image',
      fields: fields([
        { name: 'aspect_ratio', type: 'string', required: false, enum: ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] },
        { name: 'resolution', type: 'string', required: false, default: '1k', enum: ['1k', '2k', '4k'] },
        { name: 'output_format', type: 'string', required: false, default: 'default', enum: ['default', 'png', 'jpeg'] },
      ]),
    };
  }
  if (model === 'bytedance/seed-audio-1.0') {
    return {
      ...common,
      kind: 'audio',
      fields: fields([
        { name: 'format', type: 'string', required: false, default: 'mp3', enum: ['mp3', 'wav', 'pcm', 'ogg_opus'] },
        { name: 'sample_rate', type: 'integer', required: false, default: 24000, enum: [8000, 16000, 24000, 32000, 44100, 48000] },
        { name: 'pitch_rate', type: 'integer', required: false, default: 0, min: -12, max: 12 },
        { name: 'speech_rate', type: 'integer', required: false, default: 0, min: -50, max: 100 },
        { name: 'loudness_rate', type: 'integer', required: false, default: 0, min: -50, max: 100 },
      ]),
    };
  }
  if (model === 'bytedance/seed-asr-2.0') {
    return {
      ...common,
      kind: 'audio',
      fields: fields([
        { name: 'format', type: 'string', required: false, default: 'mp3', enum: ['mp3', 'wav', 'ogg', 'raw'] },
        { name: 'language', type: 'string', required: false },
        { name: 'enable_itn', type: 'boolean', required: false, default: true },
        { name: 'enable_punc', type: 'boolean', required: false, default: false },
        { name: 'enable_speaker_info', type: 'boolean', required: false, default: false },
      ]),
    };
  }
  if (/^bytedance\/seedream-v5\.0-pro\/(?:text-to-image|edit)$/.test(model)) {
    return {
      ...common,
      kind: 'image',
      fields: fields([
        { name: 'size', type: 'string', required: false, default: '2048*2048', enum: ['2048*2048', '2304*1728', '1728*2304', '2720*1530', '1530*2720', '2496*1664', '1664*2496', '1024*1024', '1536*1536', '1776*1328', '1328*1776', '2048*1152', '1152*2048'] },
        { name: 'output_format', type: 'string', required: false, default: 'jpeg', enum: ['jpeg', 'png'] },
        { name: 'thinking', type: 'string', required: false, default: 'enabled', enum: ['enabled', 'disabled'] },
      ]),
    };
  }
  if (/^kwaivgi\/kling-v3\.0-(?:4k|pro|std|turbo)\/(?:text-to-video|image-to-video)$/.test(model)) {
    return {
      ...common,
      fields: fields([
        { name: 'duration', type: 'integer', required: false, default: 5, min: 3, max: 15 },
        { name: 'aspect_ratio', type: 'string', required: false, default: '16:9', enum: ['16:9', '9:16', '1:1'] },
        { name: 'cfg_scale', type: 'number', required: false, default: 0.5, min: 0, max: 1 },
        { name: 'sound', type: 'boolean', required: false, default: true },
      ]),
    };
  }
  if (model === 'atlascloud/wan-2.7-spicy/reference-to-video') {
    return {
      ...common,
      fields: fields([
        { name: 'duration', type: 'integer', required: false, default: 5, min: 2, max: 15 },
        { name: 'resolution', type: 'string', required: false, default: '720P', enum: ['720P', '1080P', '1080P-SR', '1440P-SR'] },
        { name: 'aspect_ratio', type: 'string', required: false, default: 'auto', enum: ['auto', '16:9', '9:16', '4:3', '3:4', '1:1'] },
      ]),
    };
  }
  if (model === 'alibaba/wan-2.7/reference-to-video') {
    return {
      ...common,
      fields: fields([
        { name: 'resolution', type: 'string', required: false, default: '1080P', enum: ['720P', '1080P'] },
        { name: 'ratio', type: 'string', required: false, default: '16:9', enum: ['16:9', '9:16', '1:1', '4:3', '3:4'] },
        { name: 'duration', type: 'integer', required: false, default: 5, min: 2, max: 10 },
        { name: 'seed', type: 'integer', required: false, default: -1, min: -1, max: 2147483647 },
      ]),
    };
  }
  return null;
}

export const ATLAS_NODE_MANAGED_FIELDS = new Set([
  'model', 'prompt', 'text', 'negative_prompt',
  'image', 'images', 'reference_images', 'end_image',
  'video', 'videos', 'audio', 'audio_url', 'audios', 'references', 'reference_voice',
  'enable_base64_output', 'enable_sync_mode',
]);
