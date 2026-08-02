import { create } from 'zustand';
import type { AdvancedProviderConfig, ApiSettings, AtlasCatalogMetadata } from '../types/canvas';
import * as api from '../services/api';
import { ATLAS_RUNTIME_CREDENTIAL_MARKER } from '../config/atlasOnlyRuntime';

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
  'alibaba/wan-2.7/text-to-video',
  'alibaba/wan-2.7/image-to-video',
  'alibaba/wan-2.7/reference-to-video',
  'atlascloud/wan-2.7-spicy/image-to-video',
  'atlascloud/wan-2.7-spicy/reference-to-video',
  'bytedance/seedance-2.0/text-to-video',
  'bytedance/seedance-2.0/image-to-video',
  'bytedance/seedance-2.0/reference-to-video',
];
const ATLAS_FALLBACK_AUDIO_MODELS = ['bytedance/seed-audio-1.0', 'bytedance/seed-asr-2.0'];

type AtlasCatalogKind = 'image' | 'video' | 'chat' | 'audio' | 'other';

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
  if (type === 'audio') return 'audio';

  const categories = Array.isArray(model?.categories) ? model.categories : [];
  const tags = Array.isArray(model?.tags) ? model.tags : [];
  const text = [...categories, ...tags]
    .map((item) => String(item || '').toLowerCase())
    .join(' ');
  if (/image|text-to-image|image-to-image|inpaint|outpaint/.test(text)) return 'image';
  if (/video|text-to-video|image-to-video|video-to-video|reference-to-video/.test(text)) return 'video';
  if (/\b(text|llm|chat|language|embedding)\b|text-to-text|vision-language/.test(text)) return 'chat';
  if (/audio|speech|music|tts|asr|transcri/.test(text)) return 'audio';
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
    audioModels: Array.isArray(atlasSource?.audioModels) && atlasSource.audioModels.length
      ? atlasSource.audioModels
      : ATLAS_FALLBACK_AUDIO_MODELS,
    defaults: {
      imageModel: ATLAS_FALLBACK_IMAGE_MODELS[0],
      videoModel: ATLAS_FALLBACK_VIDEO_MODELS[0],
      chatModel: ATLAS_FALLBACK_CHAT_MODELS[0],
      audioModel: ATLAS_FALLBACK_AUDIO_MODELS[0],
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
    audioModels: Array.isArray(customSource?.audioModels) ? customSource.audioModels : [],
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

    const byKind = { image: [] as any[], video: [] as any[], chat: [] as any[], audio: [] as any[] };
    for (const model of items) {
      const kind = atlasCatalogKind(model);
      if (kind !== 'other') byKind[kind].push(model);
    }

    const current = providers[atlasIndex];
    const imageModels = uniqueModelIds(byKind.image);
    const videoModels = uniqueModelIds(byKind.video);
    const chatModels = uniqueModelIds(byKind.chat);
    const audioModels = uniqueModelIds(byKind.audio);
    if (!imageModels.length && !videoModels.length && !chatModels.length && !audioModels.length) {
      throw new Error('Atlas 模型目录没有可识别模型');
    }

    const defaults = { ...(current.defaults || {}) };
    defaults.imageModel = selectDefault(imageModels, ATLAS_FALLBACK_IMAGE_MODELS, defaults.imageModel);
    defaults.videoModel = selectDefault(videoModels, ATLAS_FALLBACK_VIDEO_MODELS, defaults.videoModel);
    defaults.chatModel = selectDefault(chatModels, ATLAS_FALLBACK_CHAT_MODELS, defaults.chatModel);
    defaults.audioModel = selectDefault(audioModels, ATLAS_FALLBACK_AUDIO_MODELS, defaults.audioModel);

    const atlasCatalog: AtlasCatalogMetadata = {
      schema: 't8-atlas-model-catalog-v1',
      version: Number(payload?.version) || 1,
      catalogDigest: String(payload?.catalogDigest || ''),
      fetchedAt: String(payload?.fetchedAt || ''),
      source: ['live', 'cache', 'fallback'].includes(payload?.source) ? payload.source : 'fallback',
      total: Number(payload?.total) || items.length,
      items,
    };

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
      audioModels,
      atlasCatalog,
      defaults,
    };
    return { ...settings, advancedProviders: providers };
  } catch (error) {
    console.warn('[atlas] 当前模型目录加载失败，使用官方已核对的少量回退模型', error);
    const current = providers[atlasIndex];
    const imageModels = uniqueModelIds(ATLAS_FALLBACK_IMAGE_MODELS);
    const videoModels = uniqueModelIds(ATLAS_FALLBACK_VIDEO_MODELS);
    const chatModels = uniqueModelIds(ATLAS_FALLBACK_CHAT_MODELS);
    const audioModels = uniqueModelIds(ATLAS_FALLBACK_AUDIO_MODELS);
    providers[atlasIndex] = {
      ...current,
      imageModels,
      videoModels,
      chatModels,
      audioModels,
      atlasCatalog: {
        schema: 't8-atlas-model-catalog-v1',
        version: 1,
        catalogDigest: '',
        fetchedAt: '',
        source: 'fallback',
        total: imageModels.length + videoModels.length + chatModels.length + audioModels.length,
        items: [],
      },
      defaults: {
        ...(current.defaults || {}),
        imageModel: selectDefault(imageModels, ATLAS_FALLBACK_IMAGE_MODELS, current.defaults?.imageModel),
        videoModel: selectDefault(videoModels, ATLAS_FALLBACK_VIDEO_MODELS, current.defaults?.videoModel),
        chatModel: selectDefault(chatModels, ATLAS_FALLBACK_CHAT_MODELS, current.defaults?.chatModel),
        audioModel: selectDefault(audioModels, ATLAS_FALLBACK_AUDIO_MODELS, current.defaults?.audioModel),
      },
    };
    return { ...settings, advancedProviders: providers };
  }
}

/**
 * Atlas credentials are backend-owned in the Render deployment. The browser
 * must not receive the secret, but legacy preflight still checks historical
 * client fields. These in-memory markers tell preflight to defer credential
 * validation to the Atlas backend adapter; they are never included in saves.
 */
function markBackendManagedAtlasCredential(settings: ApiSettings): ApiSettings {
  const marker = ATLAS_RUNTIME_CREDENTIAL_MARKER;
  return {
    ...settings,
    zhenzhenApiKey: settings.zhenzhenApiKey || marker,
    zhenzhenSd2ApiKey: settings.zhenzhenSd2ApiKey || marker,
    llmApiKey: settings.llmApiKey || marker,
    gptImageApiKey: settings.gptImageApiKey || marker,
    nanoBananaApiKey: settings.nanoBananaApiKey || marker,
    mjApiKey: settings.mjApiKey || marker,
    veoApiKey: settings.veoApiKey || marker,
    soraApiKey: settings.soraApiKey || marker,
    grokApiKey: settings.grokApiKey || marker,
    seedanceApiKey: settings.seedanceApiKey || marker,
    sunoApiKey: settings.sunoApiKey || marker,
  };
}

async function normalizedLoadedSettings(data: Partial<ApiSettings>): Promise<ApiSettings> {
  const settings: ApiSettings = {
    ...DEFAULT,
    ...data,
    zhenzhenBaseUrl: ATLAS_GENERATION_BASE_URL,
    zhenzhenSd2BaseUrl: ATLAS_GENERATION_BASE_URL,
    rhBaseUrl: '',
    rhIntlBaseUrl: '',
    llmBaseUrl: ATLAS_CHAT_BASE_URL,
  };
  settings.advancedProviders = ensureAtlasAndCustomProviders(settings);
  return markBackendManagedAtlasCredential(await hydrateAtlasCatalog(settings));
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
    } catch (error: any) {
      set({ loading: false, error: error?.message || '加载设置失败' });
    }
  },

  async save(patch) {
    set({ loading: true, error: null });
    try {
      await api.updateSettings(patch);
      const data = await api.getSettings();
      const settings = await normalizedLoadedSettings(data);
      set({ settings, loading: false, loaded: true });
    } catch (error: any) {
      set({ loading: false, error: error?.message || '保存失败' });
    }
  },
}));
