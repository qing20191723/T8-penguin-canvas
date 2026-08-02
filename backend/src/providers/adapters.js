const openaiCompatible = require('./openaiCompatible');
const modelscope = require('./modelscope');
const volcengine = require('./volcengine');
const agnes = require('./agnes');
const comfyui = require('./comfyui');
const jimengCli = require('./jimengCli');
const atlas = require('./atlas');

const ADAPTERS = {
  'openai-compatible': openaiCompatible,
  modelscope,
  volcengine,
  agnes,
  comfyui,
  'jimeng-cli': jimengCli,
  atlas,
};

const ATLAS_LLM_TIMEOUT_MS = 10 * 60 * 1000;
const COMMON_IMAGE_RATIOS = [
  '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9', '9:21', '5:4', '4:5',
];

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function cleanProtocol(value) {
  return String(value || '').trim();
}

function dimensionsFromSize(value) {
  const match = String(value || '').trim().match(/^(\d{2,5})\s*[xX×*]\s*(\d{2,5})$/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}

function ratioNumber(value) {
  const match = String(value || '').trim().match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (!match) return 0;
  const left = Number(match[1]);
  const right = Number(match[2]);
  return left > 0 && right > 0 ? left / right : 0;
}

function nearestAspectRatioFromSize(sizeValue) {
  const dimensions = dimensionsFromSize(sizeValue);
  if (!dimensions) return '';
  const target = dimensions.width / dimensions.height;
  let best = COMMON_IMAGE_RATIOS[0];
  let bestDistance = Infinity;
  for (const ratio of COMMON_IMAGE_RATIOS) {
    const current = ratioNumber(ratio);
    const distance = Math.abs(Math.log(target / current));
    if (distance < bestDistance) {
      best = ratio;
      bestDistance = distance;
    }
  }
  return best;
}

function imageResolutionFromSize(sizeValue) {
  const raw = String(sizeValue || '').trim().toLowerCase();
  if (['1k', '2k', '4k'].includes(raw)) return raw;
  const dimensions = dimensionsFromSize(raw);
  if (!dimensions) return '';
  const longest = Math.max(dimensions.width, dimensions.height);
  if (longest >= 4096) return '4k';
  if (longest >= 2048) return '2k';
  return '1k';
}

function videoResolutionForAtlas(model, value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const modelId = String(model || '').toLowerCase();
  if (/^(bytedance\/seedance|xai\/grok-imagine-video|google\/(?:veo|gemini-omni-flash)|vidu\/)/.test(modelId)) {
    return raw.toLowerCase();
  }
  return raw;
}

function atlasChatOptions(provider, options = {}) {
  if (cleanProtocol(provider?.protocol) !== 'atlas') return options;
  const requested = Number(options.timeoutMs || provider?.defaults?.chatTimeoutMs || provider?.defaults?.timeoutMs);
  const timeoutMs = Number.isFinite(requested) && requested > 0
    ? Math.max(requested, ATLAS_LLM_TIMEOUT_MS)
    : ATLAS_LLM_TIMEOUT_MS;
  return { ...options, timeoutMs };
}

function normalizeAtlasInput(provider, input = {}, kind) {
  if (cleanProtocol(provider?.protocol) !== 'atlas') return input;
  const model = String(
    input.providerModel
    || input.model
    || (kind === 'image' ? provider?.defaults?.imageModel : provider?.defaults?.videoModel)
    || '',
  ).trim();
  const next = { ...input };

  if (kind === 'image') {
    const size = firstDefined(input.image_size, input.imageSize, input.size, input.providerParams?.image_size, input.providerParams?.size);
    const inferredResolution = imageResolutionFromSize(size);
    if (inferredResolution && next.resolution == null) next.resolution = inferredResolution;

    const currentRatio = firstDefined(input.aspect_ratio, input.aspectRatio, input.ratio, input.providerParams?.aspect_ratio, input.providerParams?.ratio);
    const inferredRatio = nearestAspectRatioFromSize(size);
    if (!currentRatio && inferredRatio) next.aspect_ratio = inferredRatio;

    return next;
  }

  if (kind === 'video') {
    const resolution = firstDefined(input.resolution, input.providerParams?.resolution);
    const normalizedResolution = videoResolutionForAtlas(model, resolution);
    if (normalizedResolution && next.resolution == null) next.resolution = normalizedResolution;
    return next;
  }

  return next;
}

function getAdapterForProtocol(protocol) {
  return ADAPTERS[cleanProtocol(protocol)] || null;
}

async function testProviderConnection(provider, options = {}) {
  const adapter = getAdapterForProtocol(provider?.protocol);
  if (!adapter) {
    return {
      ok: false,
      code: 'unsupported_protocol',
      providerId: provider?.id || '',
      protocol: provider?.protocol || '',
      error: '不支持的扩展平台协议。',
    };
  }
  return adapter.testProvider(provider, options);
}

async function generateImageWithProvider(provider, input = {}, options = {}) {
  const adapter = getAdapterForProtocol(provider?.protocol);
  if (!adapter?.generateImage) {
    return {
      ok: false,
      code: 'unsupported_image_generation',
      providerId: provider?.id || '',
      protocol: provider?.protocol || '',
      error: '该扩展平台暂不支持图像生成。',
    };
  }
  return adapter.generateImage(provider, normalizeAtlasInput(provider, input, 'image'), options);
}

async function generateChatWithProvider(provider, input = {}, options = {}) {
  const adapter = getAdapterForProtocol(provider?.protocol);
  if (!adapter?.generateChat) {
    return {
      ok: false,
      code: 'unsupported_llm_generation',
      providerId: provider?.id || '',
      protocol: provider?.protocol || '',
      error: '该扩展平台暂不支持 LLM 调用。',
    };
  }
  return adapter.generateChat(provider, input, atlasChatOptions(provider, options));
}

async function generateVideoWithProvider(provider, input = {}, options = {}) {
  const adapter = getAdapterForProtocol(provider?.protocol);
  if (!adapter?.generateVideo) {
    return {
      ok: false,
      code: 'unsupported_video_generation',
      providerId: provider?.id || '',
      protocol: provider?.protocol || '',
      error: '该扩展平台暂不支持视频生成。',
    };
  }
  return adapter.generateVideo(provider, normalizeAtlasInput(provider, input, 'video'), options);
}

async function generateAudioWithProvider(provider, input = {}, options = {}) {
  const adapter = getAdapterForProtocol(provider?.protocol);
  if (!adapter?.generateAudio) {
    return {
      ok: false,
      code: 'unsupported_audio_generation',
      providerId: provider?.id || '',
      protocol: provider?.protocol || '',
      error: '该扩展平台暂不支持音频生成或识别。',
    };
  }
  return adapter.generateAudio(provider, input, options);
}

module.exports = {
  generateAudioWithProvider,
  generateChatWithProvider,
  generateImageWithProvider,
  generateVideoWithProvider,
  getAdapterForProtocol,
  testProviderConnection,
};
