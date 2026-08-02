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

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function safeValue(value, depth = 0) {
  if (depth > 4) return undefined;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return value.slice(0, 2_000);
  if (Array.isArray(value)) {
    const items = value.slice(0, 100).map((item) => safeValue(item, depth + 1));
    return items.every((item) => item !== undefined) ? items : undefined;
  }
  return undefined;
}

function schemaType(schema) {
  const explicit = String(schema?.type || '').trim().toLowerCase();
  if (['string', 'number', 'integer', 'boolean', 'array', 'object'].includes(explicit)) return explicit;
  if (schema?.properties) return 'object';
  if (schema?.items) return 'array';
  const variants = Array.isArray(schema?.oneOf) ? schema.oneOf : [];
  const variantType = variants.map(schemaType).find(Boolean);
  return variantType || 'string';
}

function fieldEnum(schema) {
  const direct = Array.isArray(schema?.enum) ? schema.enum : [];
  const variants = Array.isArray(schema?.oneOf) ? schema.oneOf : [];
  const alternatives = variants.flatMap((variant) => (
    variant?.const !== undefined ? [variant.const] : (Array.isArray(variant?.enum) ? variant.enum : [])
  ));
  const values = [...direct, ...alternatives].map((item) => safeValue(item)).filter((item) => item !== undefined);
  return [...new Map(values.map((item) => [canonicalJson(item), item])).values()].slice(0, 100);
}

function sanitizeItems(schema, depth) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema) || depth > 3) return undefined;
  const result = { type: schemaType(schema) };
  const values = fieldEnum(schema);
  if (values.length) result.enum = values;
  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
  const properties = schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
    ? schema.properties
    : null;
  if (properties) {
    result.fields = Object.entries(properties).slice(0, 100)
      .map(([name, rule]) => sanitizeField(name, rule, required.has(name), depth + 1));
  }
  return result;
}

function sanitizeField(name, schema, required, depth = 0) {
  const rule = schema && typeof schema === 'object' && !Array.isArray(schema) ? schema : {};
  const field = {
    name: String(name).slice(0, 200),
    type: schemaType(rule),
    required: Boolean(required),
  };
  const defaultValue = safeValue(rule.default);
  if (defaultValue !== undefined) field.default = defaultValue;
  const values = fieldEnum(rule);
  if (values.length) field.enum = values;
  const minimum = Number(rule.minimum ?? rule.minLength ?? rule.minItems);
  const maximum = Number(rule.maximum ?? rule.maxLength ?? rule.maxItems);
  if (Number.isFinite(minimum)) field.min = minimum;
  if (Number.isFinite(maximum)) field.max = maximum;
  if (field.type === 'array') {
    const items = sanitizeItems(rule.items, depth + 1);
    if (items) field.items = items;
  }
  return field;
}

function atlasKind(value) {
  const type = String(value || '').trim().toLowerCase();
  if (type === 'image') return 'image';
  if (type === 'video') return 'video';
  if (type === 'audio') return 'audio';
  if (type === 'text') return 'text';
  return 'other';
}

function atlasOperation(model, kind) {
  const id = String(model || '').toLowerCase();
  const suffix = id.split('/').pop() || '';
  if (kind === 'audio') {
    if (/\basr\b|speech-to-text|transcri/.test(id)) return 'speech-to-text';
    if (/music|song/.test(id)) return 'text-to-music';
    return 'text-to-speech';
  }
  if (kind === 'text') return 'chat';
  if (kind === 'image' && /edit|image-to-image|inpaint|outpaint/.test(id)) return 'image-edit';
  if (kind === 'image') return 'text-to-image';
  if (kind === 'video' && suffix) return suffix;
  return kind;
}

function sanitizeModes(input) {
  return (Array.isArray(input?.oneOf) ? input.oneOf : []).slice(0, 30).map((branch, index) => ({
    id: `mode-${index + 1}`,
    title: String(branch?.title || branch?.description || `模式 ${index + 1}`).slice(0, 200),
    required: (Array.isArray(branch?.required) ? branch.required : []).map(String).slice(0, 100),
  }));
}

function sanitizeAtlasModelCapability(schema) {
  const input = schema?.input && typeof schema.input === 'object' && !Array.isArray(schema.input)
    ? schema.input
    : {};
  const required = new Set(Array.isArray(input.required) ? input.required.map(String) : []);
  const properties = input.properties && typeof input.properties === 'object' && !Array.isArray(input.properties)
    ? input.properties
    : {};
  const kind = atlasKind(schema?.type);
  const capability = {
    schema: 't8-atlas-model-capability-v1',
    model: cleanModelId(schema?.model),
    kind,
    operation: atlasOperation(schema?.model, kind),
    modes: sanitizeModes(input),
    fields: Object.entries(properties).slice(0, 200)
      .map(([name, rule]) => sanitizeField(name, rule, required.has(name))),
  };
  const digest = crypto.createHash('sha256').update(canonicalJson(capability)).digest('hex');
  return { ...capability, schemaDigest: `sha256:${digest}` };
}

async function getAtlasModelCapability(modelId, options = {}) {
  return sanitizeAtlasModelCapability(await getAtlasModelSchema(modelId, options));
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
  getAtlasModelCapability,
  getAtlasModelSchema,
  resetAtlasSchemaCaches,
  sanitizeAtlasModelCapability,
};
const crypto = require('crypto');
