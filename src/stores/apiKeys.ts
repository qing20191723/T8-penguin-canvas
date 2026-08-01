import { create } from 'zustand';
import type { ApiSettings } from '../types/canvas';
import * as api from '../services/api';

// 主 Key 的固定 base URL
export const FIXED_ZHENZHEN_BASE = 'https://ai.t8star.org';
// 沿用历史字段名，实际承载清尘平价 AI 小屋的 LLM / 视频 / 图片 / 音频接口。
export const FIXED_ZHENZHEN_SD2_BASE = 'https://api.seedance.nz';
export const RH_BASE = 'https://www.runninghub.cn';
export const RH_INTL_BASE = 'https://www.runninghub.ai';


const ATLAS_PREFERRED_IMAGE_MODELS = [
  'bytedance/seedream-v5.0-pro/text-to-image',
  'bytedance/seedream-v5.0-pro/edit',
];
const ATLAS_PREFERRED_VIDEO_MODELS = [
  'kwaivgi/kling-v3.0-std/text-to-video',
  'atlascloud/wan-2.7-spicy/image-to-video',
  'atlascloud/wan-2.7-spicy/reference-to-video',
  'alibaba/wan-2.7/reference-to-video',
  'alibaba/wan-2.7/video-edit',
];

type AtlasCatalogKind = 'image' | 'video' | 'chat' | 'other';

function uniqueAtlasModelIds(values: unknown[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    const id = String(
      typeof value === 'string'
        ? value
        : value && typeof value === 'object'
          ? (value as any).id || (value as any).model
          : '',
    ).trim();
    if (!id || id.length > 300 || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

function atlasCatalogKind(model: any): AtlasCatalogKind {
  const type = String(model?.type || '').toLowerCase();
  const tags = (Array.isArray(model?.tags) ? model.tags : [])
    .map((item: unknown) => String(item || '').toLowerCase())
    .join(' ');
  const text = `${type} ${tags}`;
  if (/image|text-to-image|image-to-image|inpaint|outpaint/.test(text)) return 'image';
  if (/video|text-to-video|image-to-video|video-to-video/.test(text)) return 'video';
  if (/\b(text|llm|chat|language|embedding)\b|text-to-text|vision-language/.test(text)) return 'chat';
  return 'other';
}

async function hydrateAtlasCatalog(settings: ApiSettings): Promise<ApiSettings> {
  const providers = (Array.isArray(settings.advancedProviders) ? settings.advancedProviders : [])
    .filter((provider) => provider?.protocol === 'atlas');
  const atlasIndex = providers.findIndex((provider) => provider?.protocol === 'atlas');
  if (atlasIndex < 0) return { ...settings, advancedProviders: providers };

  try {
    const response = await fetch('/api/proxy/atlas/models', { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok || payload?.success === false) throw new Error(payload?.error || `HTTP ${response.status}`);
    const items = Array.isArray(payload?.items)
      ? payload.items
      : Object.values(payload?.models || {}).flatMap((value) => Array.isArray(value) ? value : []);
    const byKind = { image: [] as any[], video: [] as any[], chat: [] as any[] };
    for (const model of items) {
      const kind = atlasCatalogKind(model);
      if (kind !== 'other') byKind[kind].push(model);
    }

    const current = providers[atlasIndex];
    const imageModels = uniqueAtlasModelIds([
      ...ATLAS_PREFERRED_IMAGE_MODELS,
      ...byKind.image,
      ...(current.imageModels || []),
    ]);
    const videoModels = uniqueAtlasModelIds([
      ...ATLAS_PREFERRED_VIDEO_MODELS,
      ...byKind.video,
      ...(current.videoModels || []),
    ]);
    const chatModels = uniqueAtlasModelIds([
      ...byKind.chat,
      ...(current.chatModels || []),
    ]);
    const defaults = { ...(current.defaults || {}) };
    defaults.imageModel = imageModels.includes(String(defaults.imageModel || ''))
      ? defaults.imageModel
      : ATLAS_PREFERRED_IMAGE_MODELS[0];
    defaults.videoModel = videoModels.includes(String(defaults.videoModel || ''))
      ? defaults.videoModel
      : ATLAS_PREFERRED_VIDEO_MODELS[0];
    if (chatModels.length) {
      defaults.chatModel = chatModels.includes(String(defaults.chatModel || ''))
        ? defaults.chatModel
        : chatModels[0];
    }
    providers[atlasIndex] = {
      ...current,
      imageModels,
      videoModels,
      chatModels,
      defaults,
    };
    return { ...settings, advancedProviders: providers };
  } catch (error) {
    console.warn('[atlas] 动态模型目录加载失败，保留内置回退模型', error);
    return { ...settings, advancedProviders: providers };
  }
}

async function normalizedLoadedSettings(data: Partial<ApiSettings>): Promise<ApiSettings> {
  const settings: ApiSettings = {
    ...DEFAULT,
    ...data,
    zhenzhenBaseUrl: FIXED_ZHENZHEN_BASE,
    zhenzhenSd2BaseUrl: FIXED_ZHENZHEN_SD2_BASE,
    rhBaseUrl: RH_BASE,
    rhIntlBaseUrl: RH_INTL_BASE,
    llmBaseUrl: FIXED_ZHENZHEN_BASE,
  };
  return hydrateAtlasCatalog(settings);
}

interface ApiKeysState {
  settings: ApiSettings;
  loading: boolean;
  error: string | null;
  loaded: boolean;

  load: () => Promise<void>;
  save: (patch: Partial<ApiSettings>) => Promise<void>;
}

const DEFAULT: ApiSettings = {
  zhenzhenApiKey: '',
  zhenzhenBaseUrl: FIXED_ZHENZHEN_BASE,
  zhenzhenSd2ApiKey: '',
  zhenzhenSd2BaseUrl: FIXED_ZHENZHEN_SD2_BASE,
  rhApiKey: '',
  rhBaseUrl: RH_BASE,
  rhIntlApiKey: '',
  rhIntlBaseUrl: RH_INTL_BASE,
  llmApiKey: '',
  llmBaseUrl: FIXED_ZHENZHEN_BASE,
  // 分类独立 Key（留空时 fallback 到 zhenzhenApiKey）
  gptImageApiKey: '',
  nanoBananaApiKey: '',
  mjApiKey: '',
  veoApiKey: '',
  soraApiKey: '',
  grokApiKey: '',
  seedanceApiKey: '',
  sunoApiKey: '',
  // 路径默认值由后端按平台计算并通过 /api/settings 返回，前端不硬编码 D 盘。
  fileSavePath: '',
  canvasAutoSavePath: '',
  resourceLibraryPath: '',
  themeTemplatePath: '',
  eagleApiBase: '',
  advancedProviders: [],
  advancedProviderSummary: {
    enabledCount: 0,
    configuredKeyCount: 0,
    comfyuiConfigured: false,
    jimengConfigured: false,
  },
  cloudUploadTargets: [],
  cloudUploadSummary: {
    totalCount: 0,
    enabledCount: 0,
    configuredCount: 0,
    supportedUploadCount: 0,
    defaultTargetId: '',
    defaultLabel: '',
  },
  taskCompletionSound: { mode: 'default', url: '' },
  preferences: { theme: 'dark', language: 'zh-CN' },
};

export const useApiKeysStore = create<ApiKeysState>((set) => ({
  settings: DEFAULT,
  loading: false,
  error: null,
  loaded: false,

  async load() {
    set({ loading: true, error: null });
    try {
      const data = await api.getSettings();
      const settings = await normalizedLoadedSettings(data);
      set({ settings, loading: false, loaded: true });
    } catch (e: any) {
      set({ loading: false, error: e?.message || '加载设置失败' });
    }
  },

  async save(patch) {
    set({ loading: true, error: null });
    try {
      await api.updateSettings(patch);
      // 重新拉取(后端会返回脱敏后的 Key)
      const data = await api.getSettings();
      const settings = await normalizedLoadedSettings(data);
      set({ settings, loading: false });
    } catch (e: any) {
      set({ loading: false, error: e?.message || '保存失败' });
    }
  },
}));
