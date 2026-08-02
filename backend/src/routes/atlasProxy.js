/**
 * Atlas Cloud API proxy.
 *
 * Public routes:
 *   GET  /api/proxy/atlas/models
 *   GET  /api/proxy/atlas/schema?model=...
 *   POST /api/proxy/atlas/image
 *   POST /api/proxy/atlas/video
 *   POST /api/proxy/atlas/audio
 *   GET  /api/proxy/atlas/poll/:predictionId
 *
 * The Atlas API key is injected by the backend through ATLASCLOUD_API_KEY and
 * is never returned to the browser.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const config = require('../config');
const settingsRouter = require('./settings');
const { normalizeAdvancedProviders } = require('../providers/registry');
const { getAtlasModelCapability } = require('../providers/atlasSchema');

const router = express.Router();

// Atlas 内置代理严格锁定官方域名；其他兼容服务必须走唯一的“自定义 API”入口。
const ATLAS_API_ROOT = 'https://api.atlascloud.ai/api/v1';
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
  const envKey = String(process.env.ATLASCLOUD_API_KEY || '').trim();
  if (envKey) return envKey;
  try {
    const settings = settingsRouter.loadSettings({ persistMigrations: false });
    const atlas = normalizeAdvancedProviders(settings?.advancedProviders)
      .find((provider) => provider.id === 'atlas' && provider.protocol === 'atlas');
    const savedKey = String(atlas?.apiKey || '').trim();
    if (savedKey) return savedKey;
    return String(settings?.zhenzhenSd2ApiKey || settings?.zhenzhenApiKey || settings?.llmApiKey || '').trim();
  } catch {
    return '';
  }
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
    throw new AtlasHttpError('Atlas Cloud API Key 未配置。请设置 ATLASCLOUD_API_KEY，或在“API Key 设置”中保存 Atlas Cloud API Key', 503);
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
  const values = [
    data?.outputs, data?.output, data?.urls, data?.url,
    data?.image_urls, data?.image_url, data?.imageUrls, data?.imageUrl,
    data?.video_urls, data?.video_url, data?.videoUrls, data?.videoUrl,
    data?.audio_urls, data?.audio_url, data?.audioUrls, data?.audioUrl,
    data?.download_url, data?.downloadUrl,
  ];
  const outputs = [];
  for (const value of values) {
    for (const item of Array.isArray(value) ? value : [value]) {
      const url = typeof item === 'string' ? item.trim() : '';
      if (url && !outputs.includes(url)) outputs.push(url);
    }
  }
  return outputs;
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
    categories: Array.isArray(model?.categories) ? model.categories : [],
    schema: model?.schema || null,
    readme: model?.readme || null,
  };
}

const CATALOG_SCHEMA = 't8-atlas-model-catalog-v1';
const CATALOG_FALLBACK_MODELS = [
  ['bytedance/seedream-v5.0-pro/text-to-image', 'Seedream v5.0 Pro Text-to-Image', 'Image', 'BYTEDANCE'],
  ['bytedance/seedream-v5.0-pro/edit', 'Seedream v5.0 Pro Edit', 'Image', 'BYTEDANCE'],
  ['google/nano-banana-pro/text-to-image', 'Nano Banana Pro Text-to-Image', 'Image', 'GOOGLE'],
  ['google/nano-banana-pro/edit', 'Nano Banana Pro Edit', 'Image', 'GOOGLE'],
  ['openai/gpt-image-2/text-to-image', 'GPT Image 2 Text-to-Image', 'Image', 'OPENAI'],
  ['openai/gpt-image-2/edit', 'GPT Image 2 Edit', 'Image', 'OPENAI'],
  ['alibaba/wan-2.7/text-to-video', 'Wan 2.7 Text-to-Video', 'Video', 'ALIBABA'],
  ['alibaba/wan-2.7/image-to-video', 'Wan 2.7 Image-to-Video', 'Video', 'ALIBABA'],
  ['atlascloud/wan-2.7-spicy/reference-to-video', 'Wan 2.7 Spicy Reference-to-Video', 'Video', 'ATLASCLOUD'],
  ['bytedance/seedance-2.0/image-to-video', 'Seedance 2.0 Image-to-Video', 'Video', 'BYTEDANCE'],
  ['moonshotai/kimi-k3', 'Kimi K3', 'Text', 'MOONSHOTAI'],
  ['bytedance/seed-audio-1.0', 'Seed Audio 1.0', 'Audio', 'BYTEDANCE'],
  ['bytedance/seed-asr-2.0', 'Seed ASR 2.0', 'Audio', 'BYTEDANCE'],
].map(([id, name, type, provider]) => ({
  id,
  model: id,
  name,
  displayName: name,
  type,
  provider,
  description: '',
  pricing: null,
  tags: [],
  categories: [],
  schema: `https://static.atlascloud.ai/model/schema/${id.replaceAll('/', '-')}.json`,
  readme: null,
}));

function isOfficialAtlasSchema(value) {
  try {
    const url = new URL(String(value || ''));
    return url.origin === 'https://static.atlascloud.ai'
      && url.pathname.startsWith('/model/schema/')
      && url.pathname.endsWith('.json');
  } catch {
    return false;
  }
}

function catalogDigest(items) {
  const canonical = items
    .map((item) => ({ id: item.id, type: item.type, schema: item.schema }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex')}`;
}

function catalogEnvelope(items, source, fetchedAt = new Date().toISOString()) {
  const accepted = items.filter((item) => item.id && isOfficialAtlasSchema(item.schema));
  const grouped = { Image: [], Video: [], Audio: [], Text: [], Other: [] };
  for (const model of accepted) {
    if (Object.prototype.hasOwnProperty.call(grouped, model.type)) grouped[model.type].push(model);
    else grouped.Other.push(model);
  }
  return {
    success: true,
    schema: CATALOG_SCHEMA,
    version: 1,
    catalogDigest: catalogDigest(accepted),
    fetchedAt,
    source,
    models: grouped,
    items: accepted,
    total: accepted.length,
  };
}

function writeCatalogCache(envelope) {
  const file = config.ATLAS_CATALOG_CACHE_FILE;
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temporary = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    const handle = fs.openSync(temporary, 'wx', 0o600);
    try {
      fs.writeFileSync(handle, `${JSON.stringify(envelope)}\n`, { encoding: 'utf8' });
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    fs.renameSync(temporary, file);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch (_) {}
    throw error;
  }
}

function readCatalogCache() {
  try {
    const cached = JSON.parse(fs.readFileSync(config.ATLAS_CATALOG_CACHE_FILE, 'utf8'));
    if (cached?.schema !== CATALOG_SCHEMA || !Array.isArray(cached?.items) || !cached.items.length) return null;
    return catalogEnvelope(cached.items, 'cache', cached.fetchedAt);
  } catch {
    return null;
  }
}

router.get('/models', async (_req, res) => {
  try {
    const payload = await atlasRequest('/models', { requireAuth: false });
    const rawModels = Array.isArray(payload?.data)
      ? payload.data
      : (Array.isArray(payload) ? payload : []);
    const models = rawModels
      .filter((model) => model?.display_console !== false && isOfficialAtlasSchema(model?.schema))
      .map(normalizeModel)
      .filter((model) => model.id && model.schema);
    if (!models.length) throw new AtlasHttpError('Atlas 官方模型目录没有可用 Schema', 502);
    const envelope = catalogEnvelope(models, 'live');
    try { writeCatalogCache(envelope); } catch (_) {
      console.warn('[atlas/models] catalog cache write failed');
    }
    return res.json(envelope);
  } catch (error) {
    const cached = readCatalogCache();
    if (cached) return res.json(cached);
    return res.json(catalogEnvelope(CATALOG_FALLBACK_MODELS, 'fallback'));
  }
});

router.get('/schema', async (req, res) => {
  const model = String(req.query.model || '').trim();
  if (!model || model.length > 300 || /[\x00-\x1f\x7f]/.test(model)) {
    return res.status(400).json({
      success: false,
      code: 'atlas_model_invalid',
      error: 'Atlas model 参数无效',
    });
  }
  try {
    return res.json(await getAtlasModelCapability(model));
  } catch (error) {
    const message = String(error?.message || 'Atlas 官方模型 Schema 不可用');
    const statusCode = /不存在模型|没有提供/.test(message) ? 404 : 502;
    return res.status(statusCode).json({
      success: false,
      code: statusCode === 404 ? 'atlas_schema_unavailable' : 'atlas_schema_fetch_failed',
      error: message,
    });
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

    const data = isPlainObject(payload?.data)
      ? payload.data
      : (isPlainObject(payload) ? payload : {});
    const predictionId = String(
      data.id || data.prediction_id || data.predictionId || data.task_id || data.taskId || '',
    ).trim();
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
router.post('/audio', (req, res) => submitGeneration(req, res, '/model/generateAudio', 'audio'));

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
module.exports._test = {
  CATALOG_FALLBACK_MODELS,
  CATALOG_SCHEMA,
  catalogDigest,
  catalogEnvelope,
  getAtlasApiKey,
  isOfficialAtlasSchema,
  normalizeOutputs,
  readCatalogCache,
  writeCatalogCache,
};
