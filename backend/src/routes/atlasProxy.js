/**
 * Atlas Cloud API proxy.
 *
 * Public routes:
 *   GET  /api/proxy/atlas/models
 *   POST /api/proxy/atlas/image
 *   POST /api/proxy/atlas/video
 *   GET  /api/proxy/atlas/poll/:predictionId
 *
 * The Atlas API key is injected by the backend through ATLASCLOUD_API_KEY and
 * is never returned to the browser.
 */

const express = require('express');

const router = express.Router();

const ATLAS_ORIGIN = String(process.env.ATLAS_BASE_URL || 'https://api.atlascloud.ai')
  .trim()
  .replace(/\/+$/, '');
const ATLAS_API_ROOT = `${ATLAS_ORIGIN}/api/v1`;
const REQUEST_TIMEOUT_MS = Math.max(
  5_000,
  Math.min(180_000, Number(process.env.ATLAS_REQUEST_TIMEOUT_MS) || 60_000),
);
const POST_RATE_LIMIT_WINDOW_MS = 60_000;
const POST_RATE_LIMIT_MAX = Math.max(
  1,
  Math.min(1_000, Number(process.env.ATLAS_POST_RATE_LIMIT_PER_MINUTE) || 20),
);
const ALLOWED_ORIGINS = new Set(
  String(process.env.ATLAS_ALLOWED_ORIGINS || process.env.T8_PUBLIC_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);
const postRateLimitBuckets = new Map();

class AtlasHttpError extends Error {
  constructor(message, statusCode = 502, payload = null) {
    super(message);
    this.name = 'AtlasHttpError';
    this.statusCode = statusCode;
    this.payload = payload;
  }
}

function getAtlasApiKey() {
  return String(process.env.ATLASCLOUD_API_KEY || '').trim();
}

function normalizeRequestOrigin(req) {
  return String(req.get('origin') || '').trim();
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(origin)) return true;
  if (/^uxp:\/\//i.test(origin)) return true;
  return ALLOWED_ORIGINS.has(origin);
}

function clientAddress(req) {
  return String(req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 200);
}

function enforcePostRateLimit(req, res) {
  if (req.method !== 'POST') return true;
  const now = Date.now();
  const key = clientAddress(req);
  const current = postRateLimitBuckets.get(key);
  if (!current || now - current.startedAt >= POST_RATE_LIMIT_WINDOW_MS) {
    postRateLimitBuckets.set(key, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  if (current.count <= POST_RATE_LIMIT_MAX) return true;
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((POST_RATE_LIMIT_WINDOW_MS - (now - current.startedAt)) / 1_000),
  );
  res.set('Retry-After', String(retryAfterSeconds));
  res.status(429).json({
    success: false,
    code: 'atlas_proxy_rate_limited',
    error: `Atlas 生成请求过于频繁，请在 ${retryAfterSeconds} 秒后重试`,
  });
  return false;
}

function pruneRateLimitBuckets() {
  const cutoff = Date.now() - POST_RATE_LIMIT_WINDOW_MS * 2;
  for (const [key, value] of postRateLimitBuckets) {
    if (value.startedAt < cutoff) postRateLimitBuckets.delete(key);
  }
}
const pruneTimer = setInterval(pruneRateLimitBuckets, POST_RATE_LIMIT_WINDOW_MS);
pruneTimer.unref?.();

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  const origin = normalizeRequestOrigin(req);
  const fetchSite = String(req.get('sec-fetch-site') || '').trim().toLowerCase();
  if (!isAllowedOrigin(origin) || (fetchSite === 'cross-site' && !isAllowedOrigin(origin))) {
    return res.status(403).json({
      success: false,
      code: 'atlas_proxy_origin_forbidden',
      error: '当前请求来源未获 Atlas 代理授权',
    });
  }
  if (!enforcePostRateLimit(req, res)) return undefined;
  return next();
});

function errorMessage(payload, fallback) {
  if (typeof payload === 'string' && payload.trim()) return payload.trim();
  return String(
    payload?.msg
      || payload?.message
      || payload?.error?.message
      || payload?.error
      || fallback,
  );
}

async function atlasRequest(pathname, { method = 'GET', body, requireAuth = true } = {}) {
  const apiKey = getAtlasApiKey();
  if (requireAuth && !apiKey) {
    throw new AtlasHttpError('服务端未配置 ATLASCLOUD_API_KEY', 503);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${ATLAS_API_ROOT}${pathname}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(requireAuth ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }

    if (!response.ok) {
      throw new AtlasHttpError(
        errorMessage(payload, `Atlas API 返回 HTTP ${response.status}`),
        response.status,
        payload,
      );
    }
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new AtlasHttpError('Atlas API 请求超时', 504);
    }
    if (error instanceof AtlasHttpError) throw error;
    throw new AtlasHttpError(`无法连接 Atlas API：${error?.message || String(error)}`, 502);
  } finally {
    clearTimeout(timeout);
  }
}

function sendAtlasError(res, error, fallback) {
  const statusCode = Number(error?.statusCode);
  return res.status(Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599 ? statusCode : 500)
    .json({
      success: false,
      code: 'atlas_proxy_error',
      error: error?.message || fallback,
    });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function buildGenerationBody(rawBody) {
  const source = isPlainObject(rawBody) ? rawBody : {};
  const model = String(source.model || '').trim();
  if (!model) {
    throw new AtlasHttpError('缺少 model 参数', 400);
  }

  const hasNestedParams = Object.prototype.hasOwnProperty.call(source, 'params');
  if (hasNestedParams && !isPlainObject(source.params)) {
    throw new AtlasHttpError('params 必须是 JSON 对象', 400);
  }

  const flatParams = { ...source };
  delete flatParams.model;
  delete flatParams.params;
  const params = hasNestedParams ? { ...source.params, ...flatParams } : flatParams;
  for (const key of Object.keys(params)) {
    if (params[key] === undefined) delete params[key];
  }

  return { ...params, model };
}

function atlasCodeSucceeded(payload) {
  const code = payload?.code;
  return code === undefined || code === null || ['0', '200'].includes(String(code));
}

function normalizeOutputs(data) {
  const raw = data?.outputs ?? data?.output;
  if (Array.isArray(raw)) return raw.filter((item) => typeof item === 'string' && item.trim());
  if (typeof raw === 'string' && raw.trim()) return [raw.trim()];
  return [];
}

function normalizeModel(model) {
  const id = String(model?.model || model?.id || '').trim();
  return {
    id,
    model: id,
    name: model?.displayName || model?.name || id,
    displayName: model?.displayName || model?.name || id,
    type: model?.type || '',
    provider: model?.organization || model?.provider || '',
    description: model?.profile || model?.description || '',
    pricing: model?.price || model?.pricing || null,
    tags: Array.isArray(model?.tags) ? model.tags : [],
    schema: model?.schema || null,
    readme: model?.readme || null,
  };
}

router.get('/models', async (_req, res) => {
  try {
    const payload = await atlasRequest('/models', { requireAuth: false });
    const rawModels = Array.isArray(payload?.data)
      ? payload.data
      : (Array.isArray(payload) ? payload : []);
    const models = rawModels
      .filter((model) => model?.display_console !== false)
      .map(normalizeModel)
      .filter((model) => model.id);

    const grouped = { Image: [], Video: [], Audio: [], Text: [], Other: [] };
    for (const model of models) {
      if (Object.prototype.hasOwnProperty.call(grouped, model.type)) grouped[model.type].push(model);
      else grouped.Other.push(model);
    }

    return res.json({
      success: true,
      models: grouped,
      items: models,
      total: models.length,
    });
  } catch (error) {
    return sendAtlasError(res, error, '获取 Atlas 模型列表失败');
  }
});

async function submitGeneration(req, res, endpoint, label) {
  try {
    const body = buildGenerationBody(req.body);
    console.log(`[atlas/${label}] submit`, { model: body.model, paramKeys: Object.keys(body).length - 1 });
    const payload = await atlasRequest(endpoint, { method: 'POST', body });
    if (!atlasCodeSucceeded(payload)) {
      throw new AtlasHttpError(errorMessage(payload, `Atlas ${label}任务提交失败`), 502, payload);
    }

    const data = payload?.data || {};
    const predictionId = String(data.id || '').trim();
    const outputs = normalizeOutputs(data);
    if (!predictionId && outputs.length === 0) {
      throw new AtlasHttpError('Atlas API 未返回 predictionId 或生成结果', 502, payload);
    }

    return res.json({
      success: true,
      predictionId: predictionId || null,
      status: data.status || (outputs.length ? 'completed' : 'processing'),
      outputs,
      data,
    });
  } catch (error) {
    return sendAtlasError(res, error, `Atlas ${label}任务提交失败`);
  }
}

router.post('/image', (req, res) => submitGeneration(req, res, '/model/generateImage', 'image'));
router.post('/video', (req, res) => submitGeneration(req, res, '/model/generateVideo', 'video'));

router.get('/poll/:predictionId', async (req, res) => {
  const predictionId = String(req.params.predictionId || '').trim();
  if (!/^[A-Za-z0-9._:-]{1,256}$/.test(predictionId)) {
    return res.status(400).json({ success: false, error: 'predictionId 格式无效' });
  }

  try {
    const payload = await atlasRequest(`/model/prediction/${encodeURIComponent(predictionId)}`);
    if (!atlasCodeSucceeded(payload)) {
      throw new AtlasHttpError(errorMessage(payload, 'Atlas 任务查询失败'), 502, payload);
    }

    const data = payload?.data || payload || {};
    const status = String(data.status || 'processing').toLowerCase();
    const outputs = normalizeOutputs(data);
    if (status === 'failed' || status === 'error' || status === 'cancelled' || status === 'canceled') {
      return res.json({
        success: false,
        status,
        error: errorMessage(data, 'Atlas 生成任务失败'),
        outputs,
        data,
      });
    }

    const completed = ['completed', 'succeeded', 'success'].includes(status) || outputs.length > 0;
    return res.json({
      success: true,
      status: completed ? 'completed' : status,
      src: outputs[0] || null,
      outputs,
      data,
    });
  } catch (error) {
    return sendAtlasError(res, error, 'Atlas 任务查询失败');
  }
});

module.exports = router;
