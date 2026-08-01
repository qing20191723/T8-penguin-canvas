import { create } from 'zustand';
import type { AdvancedProviderConfig, ApiSettings } from '../types/canvas';
import * as api from '../services/api';

/** Atlas Cloud 官方接口根地址。 */
export const ATLAS_GENERATION_BASE_URL = 'https://api.atlascloud.ai/api/v1';
export const ATLAS_CHAT_BASE_URL = 'https://api.atlascloud.ai/v1';

/**
 * 历史导出名仅为兼容旧代码与旧设置文件；它们现在统一指向 Atlas Cloud，
 * 前端不再展示原有平台入口。
 */
export const FIXED_ZHENZHEN_BASE = ATLAS_GENERATION_BASE_URL;
export const FIXED_ZHENZHEN_SD2_BASE = ATLAS_GENERATION_BASE_URL;
export const RH_BASE = '';
export const RH_INTL_BASE = '';

const ATLAS_FALLBACK_IMAGE_MODELS = [
  'bytedance/seedream-v5.0-pro/text-to-image',
  'bytedance/seedream-v5.0-pro/edit',
];
const ATLAS_FALLBACK_CHAT_MODELS = ['moonshotai/kimi-k3'];
const ATLAS_FALLBACK_VIDEO_MODELS = [
  'kwaivgi/kling-v3.0-std/text-to-video',
  'kwaivgi/kling-v3.0-std/image-to-video',
  'atlascloud/wan-2.7-spicy/image-to-video',
  'atlascloud/wan-2.7-spicy/reference-to-video',
  'alibaba/wan-2.7/reference-to-video',
  'alibaba/wan-2.7/video-edit',
];

type AtlasCatalogKind = 'image' | 'video' | 'chat' | 'other';

function uniqueModelIds(values: unknown[]): string[] {
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
  const type = String(model?.type || '').trim().toLowerCase();
  if (type === 'image') return 'image';
  if (type === 'video') return 'video';
  if (type === 'text') return 'chat';

  const categories = Array.isArray(model?.categories) ? model.categories : [];
  const tags = Array.isArray(model?.tags) ? model.tags : [];
  const text = [...categories, ...tags]
    .map((item) => String(item || '').toLowerCase())
    .join(' ');
  if (/image|text-to-image|image-to-image|inpaint|outpaint/.test(text)) return 'image';
  if (/video|text-to-video|image-to-video|video-to-video|reference-to-video/.test(text)) return 'video';
  if (/\b(text|llm|chat|language|embedding)\b|text-to-text|vision-language/.test(text)) return 'chat';
  return 'other';
}

function ensureAtlasAndCustomProviders(settings: { advancedProviders?: AdvancedProviderConfig[] }): AdvancedProviderConfig[] {
  const source = Array.isArray(settings.advancedProviders) ? settings.advancedProviders : [];
  const atlasSource = source.find((provider) => provider?.protocol === 'atlas' || provider?.id === 'atlas');
  const customSource = source.find((provider) => (
    provider?.id === 'custom-api'
    || (provider?.protocol === 'openai-compatible' && provider?.id !== 'atlas')
  ));

  const atlas: AdvancedProviderConfig = {
  ...(atlasSource || {}),
  id: 'atlas',
  label: 'Atlas Cloud',
  protocol: 'atlas',
  baseUrl: ATLAS_GENERATION_BASE_URL,
  enabled: true,
  imageModels: Array.isArray(atlasSource?.imageModels) && atlasSource.imageModels.length
    ? atlasSource.imageModels
    : ATLAS_FALLBACK_IMAGE_MODELS,
  videoModels: Array.isArray(atlasSource?.videoModels) && atlasSource.videoModels.length
    ? atlasSource.videoModels
    : ATLAS_FALLBACK_VIDEO_MODELS,
  chatModels: Array.isArray(atlasSource?.chatModels) && atlasSource.chatModels.length
    ? atlasSource.chatModels
    : ATLAS_FALLBACK_CHAT_MODELS,
  defaults: {
    imageModel: ATLAS_FALLBACK_IMAGE_MODELS[0],
    videoModel: ATLAS_FALLBACK_VIDEO_MODELS[0],
    chatModel: ATLAS_FALLBACK_CHAT_MODELS[0],
    pollIntervalMs: 3000,
    ...(atlasSource?.defaults || {}),
  },
};

const custom: AdvancedProviderConfig = {
  ...(customSource || {}),
  id: 'custom-api',
  label: customSource?.label || '自定义 API',
  protocol: 'openai-compatible',
  baseUrl: customSource?.baseUrl || '',
  enabled: customSource?.enabled === true,
  imageModels: Array.isArray(customSource?.imageModels) ? customSource.imageModels : [],
  videoModels: Array.isArray(customSource?.videoModels) ? customSource.videoModels : [],
  chatModels: Array.isArray(customSource?.chatModels) ? customSource.chatModels : [],
  defaults: { ...(customSource?.defaults || {}) },
};

return [atlas, custom];
}

function selectDefault(models: string[], preferred: string[], current: unknown): string {
  const requested = String(current || '').trim();
  if (requested && models.includes(requested)) return requested;
  return preferred.find((model) => models.includes(model)) || models[0] || '';
}

async function hydrateAtlasCatalog(settings: ApiSettings): Promise<ApiSettings> {
  const providers = ensureAtlasAndCustomProviders(settings);
  const atlasIndex = providers.findIndex((provider) => provider.id === 'atlas');
  if (atlasIndex < 0) return { ...settings, advancedProviders: providers };

  try {
    const response = await fetch('/api/proxy/atlas/models', { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok || payload?.success === false) {
      throw new Error(payload?.error || `HTTP ${response.status}`);
    }
    const items = Array.isArray(payload?.items)
      ? payload.items
      : Object.values(payload?.models || {}).flatMap((value) => (Array.isArray(value) ? value : []));
    if (!items.length) throw new Error('Atlas 模型目录为空');

    const byKind = { image: [] as any[], video: [] as any[], chat: [] as any[] };
    for (const model of items) {
      const kind = atlasCatalogKind(model);
      if (kind !== 'other') byKind[kind].push(model);
    }

    const current = providers[atlasIndex];
    // 模型列表以 Atlas 当前公共目录为唯一来源；只有目录请求失败时才使用内置回退。
    const imageModels = uniqueModelIds(byKind.image);
    const videoModels = uniqueModelIds(byKind.video);
    const chatModels = uniqueModelIds(byKind.chat);
    if (!imageModels.length && !videoModels.length && !chatModels.length) {
      throw new Error('Atlas 模型目录没有可识别模型');
    }

    const defaults = { ...(current.defaults || {}) };
    defaults.imageModel = selectDefault(
      imageModels,
      ATLAS_FALLBACK_IMAGE_MODELS,
      defaults.imageModel,
    );
    defaults.videoModel = selectDefault(
      videoModels,
      ATLAS_FALLBACK_VIDEO_MODELS,
      defaults.videoModel,
    );
    defaults.chatModel = selectDefault(chatModels, ATLAS_FALLBACK_CHAT_MODELS, defaults.chatModel);

    providers[atlasIndex] = {
      ...current,
      id: 'atlas',
      label: 'Atlas Cloud',
      protocol: 'atlas',
      baseUrl: ATLAS_GENERATION_BASE_URL,
      enabled: true,
      imageModels,
      videoModels,
      chatModels,
      defaults,
    };
    return { ...settings, advancedProviders: providers };
  } catch (error) {
    console.warn('[atlas] 当前模型目录加载失败，使用官方已核对的少量回退模型', error);
    const current = providers[atlasIndex];
    const imageModels = uniqueModelIds(ATLAS_FALLBACK_IMAGE_MODELS);
    const videoModels = uniqueModelIds(ATLAS_FALLBACK_VIDEO_MODELS);
    const chatModels = uniqueModelIds(ATLAS_FALLBACK_CHAT_MODELS);
    providers[atlasIndex] = {
      ...current,
      imageModels,
      videoModels,
      chatModels,
      defaults: {
        ...(current.defaults || {}),
        imageModel: selectDefault(imageModels, ATLAS_FALLBACK_IMAGE_MODELS, current.defaults?.imageModel),
        videoModel: selectDefault(videoModels, ATLAS_FALLBACK_VIDEO_MODELS, current.defaults?.videoModel),
        chatModel: selectDefault(chatModels, ATLAS_FALLBACK_CHAT_MODELS, current.defaults?.chatModel),
      },
    };
    return { ...settings, advancedProviders: providers };
  }
}

async function normalizedLoadedSettings(data: Partial<ApiSettings>): Promise<ApiSettings> {
  const settings: ApiSettings = {
    ...DEFAULT,
    ...data,
    // 历史字段保留给旧画布/旧设置兼容，但全部锁定到 Atlas 官方地址。
    zhenzhenBaseUrl: ATLAS_GENERATION_BASE_URL,
    zhenzhenSd2BaseUrl: ATLAS_GENERATION_BASE_URL,
    rhBaseUrl: '',
    rhIntlBaseUrl: '',
    llmBaseUrl: ATLAS_CHAT_BASE_URL,
  };
  settings.advancedProviders = ensureAtlasAndCustomProviders(settings);
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
  // 历史 Key 字段不再用于公共 UI；保留仅为旧设置迁移。
  zhenzhenApiKey: '',
  zhenzhenBaseUrl: ATLAS_GENERATION_BASE_URL,
  zhenzhenSd2ApiKey: '',
  zhenzhenSd2BaseUrl: ATLAS_GENERATION_BASE_URL,
  rhApiKey: '',
  rhBaseUrl: '',
  rhIntlApiKey: '',
  rhIntlBaseUrl: '',
  llmApiKey: '',
  llmBaseUrl: ATLAS_CHAT_BASE_URL,
  gptImageApiKey: '',
  nanoBananaApiKey: '',
  mjApiKey: '',
  veoApiKey: '',
  soraApiKey: '',
  grokApiKey: '',
  seedanceApiKey: '',
  sunoApiKey: '',
  fileSavePath: '',
  canvasAutoSavePath: '',
  resourceLibraryPath: '',
  themeTemplatePath: '',
  eagleApiBase: '',
  advancedProviders: ensureAtlasAndCustomProviders({ advancedProviders: [] }),
  advancedProviderSummary: {
    enabledCount: 1,
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
      const data = await api.getSettings();
      const settings = await normalizedLoadedSettings(data);
      set({ settings, loading: false });
    } catch (e: any) {
      set({ loading: false, error: e?.message || '保存失败' });
    }
  },
}));
