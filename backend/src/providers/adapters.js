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

function getAdapterForProtocol(protocol) {
  return ADAPTERS[String(protocol || '').trim()] || null;
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
  return adapter.generateImage(provider, input, options);
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
  return adapter.generateChat(provider, input, options);
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
  return adapter.generateVideo(provider, input, options);
}

module.exports = {
  generateChatWithProvider,
  generateImageWithProvider,
  generateVideoWithProvider,
  getAdapterForProtocol,
  testProviderConnection,
};
