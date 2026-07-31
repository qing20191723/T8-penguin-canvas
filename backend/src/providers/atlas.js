const fs = require('fs');
const path = require('path');
const { resolveMediaRef } = require('./mediaResolver');
const { providerIdempotencyHeadersLike } = require('../services/providerSubmissionContext');

const DEFAULT_BASE_URL = 'https://api.atlascloud.ai/api/v1';
const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 3000;
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

  const params = {
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

  try {
    const refs = await resolveAtlasMediaList(provider, [
      ...(Array.isArray(input.images) ? input.images : []),
      ...(input.image ? [input.image] : []),
      ...(input.image_url ? [input.image_url] : []),
    ], options);
    if (refs.length && params.image == null && params.image_url == null && params.images == null) {
      params.image = refs.length === 1 ? refs[0] : refs;
    }
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
