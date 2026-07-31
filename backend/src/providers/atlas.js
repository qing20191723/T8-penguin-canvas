const fs = require('fs');
const path = require('path');
const { resolveMediaRef } = require('./mediaResolver');
const { providerIdempotencyHeadersLike } = require('../services/providerSubmissionContext');

const DEFAULT_BASE_URL = 'https://api.atlascloud.ai/api/v1';
const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 3000;
const SEEDREAM_V5_T2I_MODEL = 'bytedance/seedream-v5.0-lite';
const SEEDREAM_V5_EDIT_MODEL = 'bytedance/seedream-v5.0-lite/edit';
const KLING_V3_T2V_MODEL = 'kwaivgi/kling-v3.0-std/text-to-video';
const KLING_V3_I2V_MODEL = 'kwaivgi/kling-v3.0-std/image-to-video';
const SEEDREAM_V5_SIZES = [
  '2048*2048', '2304*1728', '1728*2304', '2848*1600', '1600*2848',
  '2496*1664', '1664*2496', '3136*1344', '3072*3072', '3456*2592',
  '2592*3456', '4096*2304', '2304*4096', '2496*3744', '3744*2496', '4704*2016',
];
const SUCCESS_STATUSES = new Set(['completed', 'complete', 'success', 'succeeded', 'done', 'finished', 'ready']);
const FAILURE_STATUSES = new Set(['failed', 'failure', 'error', 'errored', 'cancelled', 'canceled', 'rejected', 'expired']);

function cleanBaseUrl(value) {
  const raw = String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  if (!raw) return DEFAULT_BASE_URL;
  if (raw.endsWith('/api/v1')) return raw;
  if (raw.endsWith('/api')) return `${raw}/v1`;
  return `${raw}/api/v1`;
}

function apiKey(provider) {
  return String(process.env.ATLASCLOUD_API_KEY || provider?.apiKey || '').trim();
}

function validateProvider(provider) {
  const key = apiKey(provider);
  if (!key) {
    return {
      ok: false,
      code: 'missing_api_key',
      providerId: provider?.id || 'atlas',
      protocol: 'atlas',
      error: 'Atlas Cloud API Key 未配置。Render 请设置 ATLASCLOUD_API_KEY，本地可在扩展平台中填写。',
    };
  }
  return { ok: true, key, baseUrl: cleanBaseUrl(provider?.baseUrl) };
}

function selectedModel(requested, configured, fallback) {
  const first = Array.isArray(configured) ? configured.find((item) => String(item || '').trim()) : '';
  const model = String(requested || first || fallback || '').trim();
  if (!model) throw new Error('Atlas 模型名称不能为空。');
  if (model.length > 300 || /[\x00-\x1f\x7f]/.test(model)) throw new Error('Atlas 模型名称不合法。');
  return model;
}

function requestHeaders(key, method, contentType = 'application/json') {
  return providerIdempotencyHeadersLike({
    Accept: 'application/json',
    Authorization: `Bearer ${key}`,
    ...(contentType ? { 'Content-Type': contentType } : {}),
  }, method);
}

async function responsePayload(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function responseError(payload, fallback) {
  if (typeof payload === 'string' && payload.trim()) return payload.trim();
  return String(
    payload?.msg || payload?.message || payload?.error?.message || payload?.error || fallback,
  );
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const fetchImpl = options.fetchImpl || fetch;
  const { timeoutMs: _timeoutMs, fetchImpl: _fetchImpl, ...init } = options;
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function requestId(response, payload) {
  return String(
    payload?.request_id || payload?.requestId || response.headers?.get?.('x-request-id') || '',
  ).trim();
}

function codeSucceeded(payload) {
  return payload?.code == null || String(payload.code) === '200';
}

function taskData(payload) {
  return payload?.data && typeof payload.data === 'object' ? payload.data : (payload || {});
}

function taskId(payload) {
  const data = taskData(payload);
  return String(data?.id || data?.prediction_id || data?.predictionId || data?.task_id || data?.taskId || '').trim();
}

function taskStatus(payload) {
  const data = taskData(payload);
  return String(data?.status || payload?.status || 'processing').trim().toLowerCase();
}

function collectOutputUrls(value, out = []) {
  if (!value) return out;
  if (typeof value === 'string') {
    const text = value.trim();
    if (/^(https?:\/\/|data:|\/files\/)/i.test(text)) out.push(text);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectOutputUrls(item, out));
    return out;
  }
  if (typeof value !== 'object') return out;
  for (const key of [
    'output', 'outputs', 'url', 'urls', 'image', 'images', 'image_url', 'image_urls',
    'imageUrl', 'imageUrls', 'video', 'videos', 'video_url', 'video_urls', 'videoUrl',
    'videoUrls', 'download_url', 'downloadUrl', 'result', 'results', 'files', 'data',
  ]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) collectOutputUrls(value[key], out);
  }
  return out;
}

function uniqueUrls(payload) {
  return [...new Set(collectOutputUrls(taskData(payload)))];
}

function safeParams(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const copy = { ...value };
  for (const key of [
    'pollIntervalMs', 'poll_interval_ms', 'timeoutMs', 'timeout_ms', 'customSizeEnabled',
    'modelscopeLoraEnabled', 'modelscopeLoras', 'modelscopeLoraId', 'modelscopeLoraStrength',
  ]) delete copy[key];
  return copy;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function dimensions(value) {
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

function nearestSeedreamV5Size(sizeValue, ratioValue) {
  const normalized = String(sizeValue || '').trim().replace(/[xX×]/g, '*');
  if (SEEDREAM_V5_SIZES.includes(normalized)) return normalized;
  const parsed = dimensions(sizeValue);
  const targetRatio = parsed ? parsed.width / parsed.height : ratioNumber(ratioValue);
  if (!targetRatio) return '2048*2048';
  return SEEDREAM_V5_SIZES.reduce((best, candidate) => {
    const current = dimensions(candidate);
    const bestSize = dimensions(best);
    const currentDistance = Math.abs(Math.log((current.width / current.height) / targetRatio));
    const bestDistance = Math.abs(Math.log((bestSize.width / bestSize.height) / targetRatio));
    return currentDistance < bestDistance ? candidate : best;
  }, '2048*2048');
}

function normalizeSeedreamV5Params(params, input, refs, model) {
  const size = nearestSeedreamV5Size(
    firstDefined(params.size, params.image_size, input.size, input.image_size, input.imageSize),
    firstDefined(params.aspect_ratio, params.ratio, input.aspect_ratio, input.aspectRatio, input.ratio),
  );
  const format = String(firstDefined(params.output_format, input.output_format, 'jpeg')).toLowerCase();
  const normalized = {
    prompt: String(firstDefined(params.prompt, input.prompt, '')).trim(),
    size,
    output_format: format === 'png' ? 'png' : 'jpeg',
    enable_base64_output: false,
  };
  if (model === SEEDREAM_V5_EDIT_MODEL) normalized.images = refs.slice(0, 14);
  return normalized;
}

function normalizeKlingV3Params(params, input, refs, model) {
  const durationRaw = Number(firstDefined(params.duration, input.duration, input.seconds, 5));
  const duration = Math.max(3, Math.min(15, Math.round(Number.isFinite(durationRaw) ? durationRaw : 5)));
  const ratio = String(firstDefined(params.aspect_ratio, params.ratio, input.aspect_ratio, input.aspectRatio, input.ratio, '16:9'));
  const normalized = {
    prompt: String(firstDefined(params.prompt, input.prompt, '')).trim(),
    negative_prompt: String(firstDefined(params.negative_prompt, input.negativePrompt, input.negative, '')).trim(),
    duration,
    aspect_ratio: ['16:9', '9:16', '1:1'].includes(ratio) ? ratio : '16:9',
    cfg_scale: Math.max(0, Math.min(1, Number(firstDefined(params.cfg_scale, 0.5)) || 0.5)),
    sound: typeof params.sound === 'boolean' ? params.sound : true,
    multi_shot: params.multi_shot === true,
  };
  if (normalized.multi_shot && ['customize', 'intelligence'].includes(params.shot_type)) {
    normalized.shot_type = params.shot_type;
    if (params.shot_type === 'customize' && Array.isArray(params.multi_prompt)) normalized.multi_prompt = params.multi_prompt;
  }
  if (model === KLING_V3_I2V_MODEL) {
    normalized.image = refs[0];
    if (refs[1]) normalized.end_image = refs[1];
    const resolution = String(firstDefined(params.resolution, input.resolution, '')).toUpperCase();
    if (['720P', '1080P'].includes(resolution)) normalized.resolution = resolution;
  }
  return normalized;
}

async function uploadDataUrl(provider, dataUrl, filename, options = {}) {
  const validation = validateProvider(provider);
  if (!validation.ok) throw new Error(validation.error);
  const match = String(dataUrl || '').match(/^data:([^;,]+);base64,(.+)$/i);
  if (!match) throw new Error('Atlas 媒体上传数据格式无效。');
  const bytes = Buffer.from(match[2], 'base64');
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: match[1] || 'application/octet-stream' }), filename || 'media.bin');
  const response = await fetchWithTimeout(`${validation.baseUrl}/model/uploadMedia`, {
    method: 'POST',
    headers: requestHeaders(validation.key, 'POST', ''),
    body: form,
    timeoutMs: Math.min(Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS, 5 * 60 * 1000),
    fetchImpl: options.fetchImpl,
  });
  const payload = await responsePayload(response);
  if (!response.ok || !codeSucceeded(payload)) {
    throw new Error(`Atlas 媒体上传失败：${responseError(payload, `HTTP ${response.status}`)}`);
  }
  const url = String(payload?.data?.download_url || payload?.data?.url || '').trim();
  if (!url) throw new Error('Atlas 媒体上传成功但没有返回 download_url。');
  return url;
}

function isPublicRemoteUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    const host = parsed.hostname.toLowerCase();
    return ['http:', 'https:'].includes(parsed.protocol)
      && !['127.0.0.1', 'localhost', '::1'].includes(host);
  } catch {
    return false;
  }
}

async function resolveAtlasMedia(provider, value, options = {}) {
  const text = typeof value === 'string' ? value.trim() : String(value?.url || value?.src || '').trim();
  if (!text) return '';
  if (isPublicRemoteUrl(text)) return text;
  const resolved = await resolveMediaRef(text, { target: 'data-url', baseUrl: options.baseUrl });
  if (resolved.url && isPublicRemoteUrl(resolved.url)) return resolved.url;
  if (resolved.dataUrl) {
    const extension = String(resolved.mime || '').split('/')[1] || 'bin';
    return uploadDataUrl(provider, resolved.dataUrl, `atlas-input.${extension}`, options);
  }
  throw new Error(`无法将媒体提交给 Atlas：${text.slice(0, 120)}`);
}

async function resolveAtlasMediaList(provider, values, options = {}) {
  const out = [];
  for (const value of Array.isArray(values) ? values : []) {
    const url = await resolveAtlasMedia(provider, value, options);
    if (url) out.push(url);
  }
  return out;
}

async function submit(provider, endpoint, model, params, options = {}) {
  const validation = validateProvider(provider);
  if (!validation.ok) return validation;
  try {
    const response = await fetchWithTimeout(`${validation.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: requestHeaders(validation.key, 'POST'),
      body: JSON.stringify({ model, ...params }),
      timeoutMs: Math.min(Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS, 2 * 60 * 1000),
      fetchImpl: options.fetchImpl,
    });
    const payload = await responsePayload(response);
    const trace = {
      requestId: requestId(response, payload) || undefined,
      upstreamHttpStatus: response.status,
    };
    if (!response.ok || !codeSucceeded(payload)) {
      return {
        ok: false,
        code: 'http_error',
        providerId: provider.id,
        protocol: provider.protocol,
        model,
        error: `Atlas 任务提交失败：${responseError(payload, `HTTP ${response.status}`)}`,
        raw: payload,
        ...trace,
      };
    }
    return { ok: true, payload, taskId: taskId(payload), urls: uniqueUrls(payload), ...trace };
  } catch (error) {
    return {
      ok: false,
      code: error?.name === 'AbortError' ? 'timeout' : 'request_failed',
      providerId: provider.id,
      protocol: provider.protocol,
      model,
      error: error?.name === 'AbortError' ? 'Atlas 任务提交超时。' : (error?.message || String(error)),
    };
  }
}

async function poll(provider, id, options = {}) {
  const validation = validateProvider(provider);
  if (!validation.ok) return validation;
  const startedAt = Date.now();
  const timeoutMs = Math.max(10_000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
  const intervalMs = Math.max(1000, Math.min(30_000, Number(options.pollIntervalMs) || DEFAULT_POLL_INTERVAL_MS));
  let pollCount = 0;
  while (Date.now() - startedAt < timeoutMs) {
    if (pollCount > 0) await new Promise((resolve) => setTimeout(resolve, intervalMs));
    pollCount += 1;
    try {
      const response = await fetchWithTimeout(`${validation.baseUrl}/model/prediction/${encodeURIComponent(id)}`, {
        headers: requestHeaders(validation.key, 'GET'),
        timeoutMs: Math.min(DEFAULT_REQUEST_TIMEOUT_MS, Math.max(1000, timeoutMs - (Date.now() - startedAt))),
        fetchImpl: options.fetchImpl,
      });
      const payload = await responsePayload(response);
      const status = taskStatus(payload);
      const urls = uniqueUrls(payload);
      const trace = {
        requestId: requestId(response, payload) || undefined,
        upstreamHttpStatus: response.status,
        pollCount,
      };
      if (!response.ok || !codeSucceeded(payload)) {
        return {
          ok: false,
          code: 'poll_http_error',
          providerId: provider.id,
          protocol: provider.protocol,
          error: `Atlas 任务查询失败：${responseError(payload, `HTTP ${response.status}`)}`,
          raw: payload,
          ...trace,
        };
      }
      if (FAILURE_STATUSES.has(status)) {
        return {
          ok: false,
          code: 'generation_failed',
          providerId: provider.id,
          protocol: provider.protocol,
          error: responseError(taskData(payload), 'Atlas 生成任务失败。'),
          raw: payload,
          ...trace,
        };
      }
      if (urls.length || SUCCESS_STATUSES.has(status)) {
        if (!urls.length) {
          return {
            ok: false,
            code: 'missing_output',
            providerId: provider.id,
            protocol: provider.protocol,
            error: 'Atlas 任务已完成但未返回输出地址。',
            raw: payload,
            ...trace,
          };
        }
        return { ok: true, urls, raw: payload, ...trace };
      }
    } catch (error) {
      if (error?.name === 'AbortError') continue;
      return {
        ok: false,
        code: 'poll_failed',
        providerId: provider.id,
        protocol: provider.protocol,
        error: error?.message || String(error),
        pollCount,
      };
    }
  }
  return {
    ok: false,
    code: 'timeout',
    providerId: provider.id,
    protocol: provider.protocol,
    error: `Atlas 任务轮询超时（${Math.round(timeoutMs / 1000)} 秒）。`,
    pollCount,
  };
}

async function runGeneration(provider, input, options, kind) {
  let model;
  try {
    model = selectedModel(
      input.providerModel || input.model,
      kind === 'image' ? provider.imageModels : provider.videoModels,
      kind === 'image' ? provider.defaults?.imageModel : provider.defaults?.videoModel,
    );
  } catch (error) {
    return {
      ok: false,
      code: 'invalid_model',
      providerId: provider.id,
      protocol: provider.protocol,
      error: error.message,
    };
  }

  let params = {
    ...safeParams(provider.defaults?.params),
    ...safeParams(input.providerParams),
  };
  if (input.prompt && params.prompt == null) params.prompt = String(input.prompt);
  const size = firstDefined(input.image_size, input.imageSize, input.size);
  if (kind === 'image' && size && params.image_size == null && params.size == null) params.image_size = size;
  const ratio = firstDefined(input.aspect_ratio, input.aspectRatio, input.ratio);
  if (ratio && params.aspect_ratio == null && params.ratio == null) params.aspect_ratio = ratio;
  const duration = firstDefined(input.duration, input.seconds);
  if (kind === 'video' && duration && params.duration == null) params.duration = duration;
  if (kind === 'video' && input.resolution && params.resolution == null) params.resolution = input.resolution;
  if (input.seed != null && params.seed == null) params.seed = input.seed;
  if (input.n != null && params.n == null && params.num_images == null) params.n = input.n;

  let refs = [];
  try {
    refs = await resolveAtlasMediaList(provider, [
      ...(Array.isArray(input.images) ? input.images : []),
      ...(input.image ? [input.image] : []),
      ...(input.image_url ? [input.image_url] : []),
    ], options);
  } catch (error) {
    return {
      ok: false,
      code: 'invalid_reference',
      providerId: provider.id,
      protocol: provider.protocol,
      model,
      error: error?.message || 'Atlas 参考媒体解析失败。',
    };
  }

  if (kind === 'image' && refs.length && model === SEEDREAM_V5_T2I_MODEL) model = SEEDREAM_V5_EDIT_MODEL;
  if (kind === 'video' && refs.length && model === KLING_V3_T2V_MODEL) model = KLING_V3_I2V_MODEL;

  if (model === SEEDREAM_V5_T2I_MODEL || model === SEEDREAM_V5_EDIT_MODEL) {
    params = normalizeSeedreamV5Params(params, input, refs, model);
  } else if (model === KLING_V3_T2V_MODEL || model === KLING_V3_I2V_MODEL) {
    params = normalizeKlingV3Params(params, input, refs, model);
  } else if (refs.length && params.image == null && params.image_url == null && params.images == null) {
    params.image = refs.length === 1 ? refs[0] : refs;
  }

  const endpoint = kind === 'image' ? '/model/generateImage' : '/model/generateVideo';
  const submitted = await submit(provider, endpoint, model, params, options);
  if (!submitted.ok) return submitted;
  if (submitted.urls.length) {
    return {
      ok: true,
      providerId: provider.id,
      protocol: provider.protocol,
      model,
      taskId: submitted.taskId || undefined,
      ...(kind === 'image' ? { imageUrls: submitted.urls } : { videoUrls: submitted.urls }),
      raw: submitted.payload,
      requestId: submitted.requestId,
      upstreamHttpStatus: submitted.upstreamHttpStatus,
      pollCount: 0,
    };
  }
  if (!submitted.taskId) {
    return {
      ok: false,
      code: 'missing_task_id',
      providerId: provider.id,
      protocol: provider.protocol,
      model,
      error: 'Atlas API 未返回任务 ID 或同步结果。',
      raw: submitted.payload,
    };
  }

  const polled = await poll(provider, submitted.taskId, {
    ...options,
    pollIntervalMs: input.providerParams?.pollIntervalMs || provider.defaults?.pollIntervalMs,
  });
  if (!polled.ok) return { ...polled, model, taskId: submitted.taskId };
  return {
    ok: true,
    providerId: provider.id,
    protocol: provider.protocol,
    model,
    taskId: submitted.taskId,
    ...(kind === 'image' ? { imageUrls: polled.urls } : { videoUrls: polled.urls }),
    raw: polled.raw,
    requestId: polled.requestId || submitted.requestId,
    upstreamHttpStatus: polled.upstreamHttpStatus,
    pollCount: polled.pollCount,
  };
}

async function testProvider(provider, options = {}) {
  const validation = validateProvider(provider);
  if (!validation.ok) return validation;
  try {
    const response = await fetchWithTimeout(`${validation.baseUrl}/models`, {
      headers: requestHeaders(validation.key, 'GET'),
      timeoutMs: Math.min(Number(options.timeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS),
      fetchImpl: options.fetchImpl,
    });
    const payload = await responsePayload(response);
    if (!response.ok || !codeSucceeded(payload)) {
      return {
        ok: false,
        code: 'http_error',
        providerId: provider.id,
        protocol: provider.protocol,
        error: `Atlas 连接测试失败：${responseError(payload, `HTTP ${response.status}`)}`,
        upstreamHttpStatus: response.status,
        raw: payload,
      };
    }
    const models = Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload) ? payload : []);
    return {
      ok: true,
      code: 'ok',
      providerId: provider.id,
      protocol: provider.protocol,
      message: `Atlas Cloud 连接正常，可读取 ${models.length} 个模型。`,
      modelCount: models.length,
      requestId: requestId(response, payload) || undefined,
      upstreamHttpStatus: response.status,
    };
  } catch (error) {
    return {
      ok: false,
      code: error?.name === 'AbortError' ? 'timeout' : 'request_failed',
      providerId: provider.id,
      protocol: provider.protocol,
      error: error?.name === 'AbortError' ? 'Atlas 连接测试超时。' : (error?.message || String(error)),
    };
  }
}

module.exports = {
  generateImage: (provider, input, options) => runGeneration(provider, input, options, 'image'),
  generateVideo: (provider, input, options) => runGeneration(provider, input, options, 'video'),
  testProvider,
};
