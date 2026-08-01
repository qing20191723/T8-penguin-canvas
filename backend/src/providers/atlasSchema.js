const ATLAS_MODELS_URL = 'https://api.atlascloud.ai/api/v1/models';
const ATLAS_STATIC_ORIGIN = 'https://static.atlascloud.ai';
const CATALOG_TTL_MS = 10 * 60 * 1000;
const SCHEMA_TTL_MS = 60 * 60 * 1000;

let catalogCache = { expiresAt: 0, models: new Map() };
const schemaCache = new Map();

function cleanModelId(value) {
  const model = String(value || '').trim();
  if (!model || model.length > 300 || /[\x00-\x1f\x7f]/.test(model)) return '';
  return model;
}

function isAllowedSchemaUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.origin === ATLAS_STATIC_ORIGIN && url.pathname.startsWith('/model/schema/');
  } catch {
    return false;
  }
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Atlas 官方模型 Schema 返回的不是有效 JSON。');
  }
}

async function fetchCatalog(fetchImpl = fetch) {
  const now = Date.now();
  if (catalogCache.expiresAt > now && catalogCache.models.size) return catalogCache.models;
  const response = await fetchImpl(ATLAS_MODELS_URL, {
    headers: { Accept: 'application/json' },
  });
  const payload = await readJson(response);
  if (!response.ok) throw new Error(`Atlas 官方模型目录请求失败：HTTP ${response.status}`);
  const items = Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload) ? payload : []);
  const models = new Map();
  for (const item of items) {
    if (!item || item.display_console === false) continue;
    const model = cleanModelId(item.model || item.id);
    if (!model) continue;
    models.set(model, {
      model,
      type: String(item.type || '').trim(),
      schemaUrl: isAllowedSchemaUrl(item.schema) ? String(item.schema) : '',
      raw: item,
    });
  }
  if (!models.size) throw new Error('Atlas 官方模型目录为空。');
  catalogCache = { expiresAt: now + CATALOG_TTL_MS, models };
  return models;
}

function inputSchemaFromOpenApi(document) {
  const input = document?.components?.schemas?.Input;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Atlas 官方模型 Schema 缺少 components.schemas.Input。');
  }
  return input;
}

async function getAtlasModelSchema(modelId, options = {}) {
  const model = cleanModelId(modelId);
  if (!model) throw new Error('Atlas 模型名称无效。');
  if (options.modelSchema && typeof options.modelSchema === 'object') {
    return { model, type: options.modelType || '', input: options.modelSchema, source: 'injected' };
  }
  const injected = options.modelSchemas?.[model];
  if (injected && typeof injected === 'object') {
    return { model, type: options.modelType || '', input: injected, source: 'injected' };
  }

  const now = Date.now();
  const cached = schemaCache.get(model);
  if (cached && cached.expiresAt > now) return cached.value;

  const fetchImpl = options.schemaFetchImpl || fetch;
  const catalog = await fetchCatalog(fetchImpl);
  const metadata = catalog.get(model);
  if (!metadata) throw new Error(`Atlas 当前公共模型目录中不存在模型：${model}`);
  if (!metadata.schemaUrl) throw new Error(`Atlas 当前模型目录没有提供 ${model} 的官方 Schema。`);

  const response = await fetchImpl(metadata.schemaUrl, { headers: { Accept: 'application/json' } });
  const document = await readJson(response);
  if (!response.ok) {
    throw new Error(`Atlas 官方模型 Schema 请求失败：${model} · HTTP ${response.status}`);
  }
  const value = {
    model,
    type: metadata.type,
    input: inputSchemaFromOpenApi(document),
    schemaUrl: metadata.schemaUrl,
    source: 'atlas-catalog',
  };
  schemaCache.set(model, { expiresAt: now + SCHEMA_TTL_MS, value });
  return value;
}

function resetAtlasSchemaCaches() {
  catalogCache = { expiresAt: 0, models: new Map() };
  schemaCache.clear();
}

module.exports = {
  ATLAS_MODELS_URL,
  getAtlasModelSchema,
  resetAtlasSchemaCaches,
};
