const fs = require('fs');
const path = require('path');
const { resolveMediaRef } = require('./mediaResolver');
const { providerIdempotencyHeadersLike } = require('../services/providerSubmissionContext');
const openaiCompatible = require('./openaiCompatible');
const { getAtlasModelSchema } = require('./atlasSchema');

const DEFAULT_BASE_URL = 'https://api.atlascloud.ai/api/v1';
const DEFAULT_CHAT_BASE_URL = 'https://api.atlascloud.ai/v1';
const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 3000;
const SEEDREAM_V5_T2I_MODEL = 'bytedance/seedream-v5.0-pro/text-to-image';
const SEEDREAM_V5_EDIT_MODEL = 'bytedance/seedream-v5.0-pro/edit';
const KLING_V3_T2V_MODEL = 'kwaivgi/kling-v3.0-std/text-to-video';
const KLING_V3_I2V_MODEL = 'kwaivgi/kling-v3.0-std/image-to-video';
const WAN_27_SPICY_I2V_MODEL = 'atlascloud/wan-2.7-spicy/image-to-video';
const WAN_27_SPICY_REFERENCE_MODEL = 'atlascloud/wan-2.7-spicy/reference-to-video';
const WAN_27_REFERENCE_MODEL = 'alibaba/wan-2.7/reference-to-video';
const WAN_27_VIDEO_EDIT_MODEL = 'alibaba/wan-2.7/video-edit';
const SEEDREAM_V5_SIZES = [
  '2048*2048', '2304*1728', '1728*2304', '2720*1530', '1530*2720',
  '2496*1664', '1664*2496', '1024*1024', '1536*1536', '1776*1328',
  '1328*1776', '2048*1152', '1152*2048',
];
const WAN_RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4']);
const WAN_SPICY_NEGATIVE_PROMPT = 'camera cut, shot change, scene change, transition, jump cut, rapid editing, montage, multi-shot, multiple camera angles, perspective shift';
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
      error: 'Atlas Cloud API Key 未配置。Render 可设置 ATLASCLOUD_API_KEY，也可在“API Key 设置”中填写 Atlas Cloud API Key。',
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
  return payload?.code == null || ['0', '200'].includes(String(payload.code));
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

function outputText(payload) {
  const data = taskData(payload);
  for (const value of [
    data?.text,
    data?.transcript,
    data?.transcription,
    data?.output_text,
    data?.outputText,
    typeof data?.result === 'string' ? data.result : '',
    data?.result?.text,
  ]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
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

function schemaProperties(inputSchema) {
  return inputSchema?.properties && typeof inputSchema.properties === 'object' && !Array.isArray(inputSchema.properties)
    ? inputSchema.properties
    : {};
}

function schemaRequired(inputSchema, params) {
  const required = new Set(Array.isArray(inputSchema?.required) ? inputSchema.required : []);
  const conditions = Array.isArray(inputSchema?.allOf) ? inputSchema.allOf : [];
  for (const condition of conditions) {
    const expected = condition?.if?.properties;
    if (!expected || typeof expected !== 'object') continue;
    const matches = Object.entries(expected).every(([key, rule]) => {
      if (!rule || typeof rule !== 'object') return true;
      if (Object.prototype.hasOwnProperty.call(rule, 'const')) return params[key] === rule.const;
      if (Array.isArray(rule.enum)) return rule.enum.includes(params[key]);
      return true;
    });
    const branch = matches ? condition?.then : condition?.else;
    for (const key of Array.isArray(branch?.required) ? branch.required : []) required.add(key);
  }
  return [...required];
}

function hasSchemaProperty(properties, key) {
  return Object.prototype.hasOwnProperty.call(properties, key);
}

function clampNumber(value, rule, integer = false) {
  let number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  if (integer) number = Math.round(number);
  if (Number.isFinite(Number(rule?.minimum))) number = Math.max(Number(rule.minimum), number);
  if (Number.isFinite(Number(rule?.maximum))) number = Math.min(Number(rule.maximum), number);
  return number;
}

function coerceSchemaValue(value, rule, key) {
  if (value === undefined || value === null || value === '') return undefined;
  const type = String(rule?.type || '').trim();
  let next = value;
  if (type === 'integer') next = clampNumber(value, rule, true);
  else if (type === 'number') next = clampNumber(value, rule, false);
  else if (type === 'boolean') {
    if (typeof value === 'boolean') next = value;
    else if (['true', '1', 'yes', 'on'].includes(String(value).trim().toLowerCase())) next = true;
    else if (['false', '0', 'no', 'off'].includes(String(value).trim().toLowerCase())) next = false;
    else return undefined;
  } else if (type === 'string') next = String(value);
  else if (type === 'array') {
    next = Array.isArray(value) ? value : [value];
    const maxItems = Number(rule?.maxItems);
    if (Number.isFinite(maxItems) && maxItems >= 0) next = next.slice(0, maxItems);
  } else if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  }
  if (Array.isArray(rule?.enum) && !rule.enum.includes(next)) {
    const exact = rule.enum.find((item) => String(item).toLowerCase() === String(next).toLowerCase());
    if (exact !== undefined) next = exact;
    else if (rule.default !== undefined) next = rule.default;
    else throw new Error(`Atlas 参数 ${key} 不支持值 ${String(value)}；允许值：${rule.enum.join(', ')}`);
  }
  return next;
}

function assignSchemaValue(target, properties, key, value, { overwrite = false } = {}) {
  if (!hasSchemaProperty(properties, key)) return false;
  if (!overwrite && target[key] !== undefined && target[key] !== null && target[key] !== '') return true;
  const next = coerceSchemaValue(value, properties[key], key);
  if (next === undefined) return false;
  target[key] = next;
  return true;
}

function appendViduSubjectBindings(prompt, count) {
  const base = String(prompt || '').trim();
  const missing = [];
  for (let index = 1; index <= count; index += 1) {
    const token = `@subject${index}`;
    if (!base.includes(token)) missing.push(token);
  }
  if (!missing.length) return base;
  return [base, `Keep ${missing.join(', ')} visually consistent throughout the video.`]
    .filter(Boolean)
    .join('\n\n');
}

function schemaValuePresent(value) {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function schemaRuleMatches(rule, values) {
  if (!rule || typeof rule !== 'object') return true;
  if (Array.isArray(rule.required) && !rule.required.every((key) => schemaValuePresent(values[key]))) return false;
  if (rule.properties && typeof rule.properties === 'object') {
    for (const [key, condition] of Object.entries(rule.properties)) {
      if (!condition || typeof condition !== 'object') continue;
      const value = values[key];
      if (Object.prototype.hasOwnProperty.call(condition, 'const') && value !== condition.const) return false;
      if (Array.isArray(condition.enum) && !condition.enum.includes(value)) return false;
    }
  }
  if (Array.isArray(rule.allOf) && !rule.allOf.every((item) => schemaRuleMatches(item, values))) return false;
  if (Array.isArray(rule.anyOf) && !rule.anyOf.some((item) => schemaRuleMatches(item, values))) return false;
  if (Array.isArray(rule.oneOf) && rule.oneOf.filter((item) => schemaRuleMatches(item, values)).length !== 1) return false;
  if (rule.not && schemaRuleMatches(rule.not, values)) return false;
  return true;
}

function forbiddenKeysFromSchemaRule(rule, out = new Set()) {
  if (!rule || typeof rule !== 'object') return out;
  for (const key of Array.isArray(rule.required) ? rule.required : []) out.add(key);
  for (const key of ['allOf', 'anyOf', 'oneOf']) {
    for (const item of Array.isArray(rule[key]) ? rule[key] : []) forbiddenKeysFromSchemaRule(item, out);
  }
  return out;
}

function applySchemaOneOf(inputSchema, mapped, initialParams, refs, videoRefs, audioRefs) {
  const branches = Array.isArray(inputSchema?.oneOf) ? inputSchema.oneOf : [];
  if (!branches.length) return [];
  const explicitlyProvided = (key) => schemaValuePresent(initialParams?.[key]);
  const explicitVideo = ['video', 'video_url', 'videos', 'video_clips', 'reference_videos'].some(explicitlyProvided);
  const explicitImage = ['image', 'image_url', 'images', 'image_urls', 'reference_images', 'reference_image_urls'].some(explicitlyProvided);
  const preferredPrimary = explicitVideo
    ? 'video'
    : explicitImage
      ? 'image'
      : videoRefs.length
        ? 'video'
        : refs.length
          ? 'image'
          : '';

  const candidates = branches
    .map((branch, index) => {
      const required = Array.isArray(branch?.required) ? branch.required : [];
      const missing = required.filter((key) => !schemaValuePresent(mapped[key]));
      if (missing.length) return null;
      let score = required.length * 100 - index;
      for (const key of required) if (explicitlyProvided(key)) score += 10_000;
      if (preferredPrimary && required.includes(preferredPrimary)) score += 5_000;
      if (required.includes('last_image') && refs[1]) score += 700;
      if (required.includes('end_image') && refs[1]) score += 700;
      if (required.includes('audio') && audioRefs[0]) score += 500;
      return { branch, index, required, score };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score);

  if (!candidates.length) {
    const modes = branches.map((branch) => {
      const title = String(branch?.title || '').trim();
      const required = Array.isArray(branch?.required) ? branch.required.join(' + ') : '';
      return title ? `${title}（${required || '无额外必填项'}）` : required;
    }).filter(Boolean);
    throw new Error(`Atlas 模型没有满足官方 Schema oneOf 输入模式。可用模式：${modes.join('；')}`);
  }

  const selected = candidates[0];
  for (const key of forbiddenKeysFromSchemaRule(selected.branch?.not)) delete mapped[key];
  for (const key of selected.required) {
    if (!schemaValuePresent(mapped[key])) {
      throw new Error(`Atlas 模型当前输入模式缺少必填参数：${key}。请连接对应素材，或在“模型专用参数 JSON”中填写该字段。`);
    }
  }

  const matched = branches.filter((branch) => schemaRuleMatches(branch, mapped));
  if (matched.length !== 1) {
    throw new Error('Atlas 模型输入无法唯一匹配官方 Schema oneOf 模式，请检查图像、视频、音频素材是否互相冲突。');
  }
  return selected.required;
}

function buildSchemaMappedParams(inputSchema, initialParams, input, refs, videoRefs, audioRefs) {
  const properties = schemaProperties(inputSchema);
  const mapped = {};
  for (const [key, value] of Object.entries(initialParams || {})) {
    if (!hasSchemaProperty(properties, key) || key === 'model') continue;
    const next = coerceSchemaValue(value, properties[key], key);
    if (next !== undefined) mapped[key] = next;
  }

  const prompt = firstDefined(initialParams?.prompt, input.prompt, '');
  const negativePrompt = firstDefined(initialParams?.negative_prompt, input.negativePrompt, input.negative, '');
  assignSchemaValue(mapped, properties, 'prompt', prompt);
  assignSchemaValue(mapped, properties, 'negative_prompt', negativePrompt);
  assignSchemaValue(mapped, properties, 'text', firstDefined(initialParams?.text, input.text, input.prompt, ''));

  const size = firstDefined(initialParams?.size, initialParams?.image_size, input.size, input.image_size, input.imageSize);
  assignSchemaValue(mapped, properties, 'size', size);
  assignSchemaValue(mapped, properties, 'image_size', size);
  const ratio = firstDefined(initialParams?.aspect_ratio, initialParams?.ratio, input.aspect_ratio, input.aspectRatio, input.ratio);
  assignSchemaValue(mapped, properties, 'aspect_ratio', ratio);
  assignSchemaValue(mapped, properties, 'ratio', ratio);
  assignSchemaValue(mapped, properties, 'resolution', firstDefined(initialParams?.resolution, input.resolution));
  assignSchemaValue(mapped, properties, 'duration', firstDefined(initialParams?.duration, input.duration, input.seconds));
  assignSchemaValue(mapped, properties, 'seed', firstDefined(initialParams?.seed, input.seed));
  assignSchemaValue(mapped, properties, 'n', firstDefined(initialParams?.n, input.n));
  assignSchemaValue(mapped, properties, 'num_images', firstDefined(initialParams?.num_images, input.n));

  const imageRule = properties.images || properties.image_urls || properties.reference_images || properties.reference_image_urls;
  const imageMax = Number(imageRule?.maxItems);
  const mappedImages = Number.isFinite(imageMax) ? refs.slice(0, imageMax) : refs;
  assignSchemaValue(mapped, properties, 'images', mappedImages);
  assignSchemaValue(mapped, properties, 'image_urls', mappedImages);
  assignSchemaValue(mapped, properties, 'reference_images', mappedImages);
  assignSchemaValue(mapped, properties, 'reference_image_urls', mappedImages);
  assignSchemaValue(mapped, properties, 'references', mappedImages);
  assignSchemaValue(mapped, properties, 'image', refs[0]);
  assignSchemaValue(mapped, properties, 'image_url', refs[0]);
  assignSchemaValue(mapped, properties, 'end_image', refs[1]);
  assignSchemaValue(mapped, properties, 'last_image', refs[1]);
  if (hasSchemaProperty(properties, 'Image')) assignSchemaValue(mapped, properties, 'Image', refs[1]);

  const videoRule = properties.videos || properties.video_clips || properties.reference_videos;
  const videoMax = Number(videoRule?.maxItems);
  const mappedVideos = Number.isFinite(videoMax) ? videoRefs.slice(0, videoMax) : videoRefs;
  assignSchemaValue(mapped, properties, 'videos', mappedVideos);
  assignSchemaValue(mapped, properties, 'video_clips', mappedVideos);
  assignSchemaValue(mapped, properties, 'reference_videos', mappedVideos);
  assignSchemaValue(mapped, properties, 'video', videoRefs[0]);
  assignSchemaValue(mapped, properties, 'video_url', videoRefs[0]);

  const audioRule = properties.audios || properties.reference_audios;
  const audioMax = Number(audioRule?.maxItems);
  const mappedAudios = Number.isFinite(audioMax) ? audioRefs.slice(0, audioMax) : audioRefs;
  assignSchemaValue(mapped, properties, 'audios', mappedAudios);
  assignSchemaValue(mapped, properties, 'reference_audios', mappedAudios);
  assignSchemaValue(mapped, properties, 'audio', audioRefs[0]);
  assignSchemaValue(mapped, properties, 'audio_url', audioRefs[0]);

  if (hasSchemaProperty(properties, 'refers') && mapped.refers == null) {
    const refers = [
      ...refs.map((url) => ({ url, type: 'image' })),
      ...videoRefs.map((url) => ({ url, type: 'video' })),
      ...audioRefs.map((url) => ({ url, type: 'audio' })),
    ];
    assignSchemaValue(mapped, properties, 'refers', refers);
  }

  if (hasSchemaProperty(properties, 'subjects') && mapped.subjects == null && refs.length) {
    const maxItems = Number(properties.subjects?.maxItems);
    const subjectImages = Number.isFinite(maxItems) ? refs.slice(0, maxItems) : refs;
    const subjects = subjectImages.map((url, index) => ({ id: `subject${index + 1}`, images: [url] }));
    assignSchemaValue(mapped, properties, 'subjects', subjects);
    if (hasSchemaProperty(properties, 'prompt')) mapped.prompt = appendViduSubjectBindings(mapped.prompt || prompt, subjects.length);
  }

  const oneOfRequired = applySchemaOneOf(inputSchema, mapped, initialParams, refs, videoRefs, audioRefs);
  for (const key of [...new Set([...schemaRequired(inputSchema, mapped), ...oneOfRequired])]) {
    if (key === 'model') continue;
    if (mapped[key] !== undefined && mapped[key] !== null && mapped[key] !== '') continue;
    const rule = properties[key];
    if (rule?.default !== undefined) {
      mapped[key] = rule.default;
      continue;
    }
    throw new Error(`Atlas 模型缺少官方 Schema 必填参数：${key}。请在“模型专用参数 JSON”中填写该字段。`);
  }
  return mapped;
}

async function normalizeDynamicAtlasParams(model, kind, params, input, refs, videoRefs, audioRefs, options = {}) {
  const schema = await getAtlasModelSchema(model, options);
  const expectedType = String(schema.type || '').toLowerCase();
  if (expectedType && expectedType !== kind) {
    throw new Error(`Atlas 模型 ${model} 的类型为 ${schema.type}，不能在${kind === 'image' ? '图像' : '视频'}节点中调用。`);
  }
  return buildSchemaMappedParams(schema.input, params, input, refs, videoRefs, audioRefs);
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
  if (model === SEEDREAM_V5_EDIT_MODEL) {
    if (!refs.length) throw new Error('Seedream v5 Pro 图片编辑至少需要一张参考图。');
    normalized.images = refs.slice(0, 10);
  }
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
    if (!refs[0]) throw new Error('Kling v3 图生视频需要一张首帧图。');
    normalized.image = refs[0];
    if (refs[1]) normalized.end_image = refs[1];
    const requestedResolution = String(firstDefined(params.resolution, input.resolution, '')).toUpperCase();
    const resolution = requestedResolution === '1080P'
      ? '1080P-SR'
      : requestedResolution === '1440P'
        ? '1440P-SR'
        : requestedResolution;
    if (['720P', '1080P-SR', '1440P-SR'].includes(resolution)) normalized.resolution = resolution;
  }
  return normalized;
}

function integerBetween(value, fallback, min, max) {
  const number = Number(value);
  const normalized = Number.isFinite(number) ? Math.round(number) : fallback;
  return Math.max(min, Math.min(max, normalized));
}

function wanResolution(value, fallback, allowed) {
  const normalized = String(value || fallback).toUpperCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function wanRatio(value, fallback = '16:9') {
  const normalized = String(value || fallback);
  return WAN_RATIOS.has(normalized) ? normalized : fallback;
}

function normalizeWanSpicyParams(params, input, refs) {
  if (!refs[0]) throw new Error('Wan 2.7 Spicy 图生视频需要一张首帧图。');
  return {
    prompt: String(firstDefined(params.prompt, input.prompt, '')).trim(),
    image: refs[0],
    negative_prompt: String(firstDefined(params.negative_prompt, input.negativePrompt, input.negative, WAN_SPICY_NEGATIVE_PROMPT)).trim(),
    resolution: wanResolution(firstDefined(params.resolution, input.resolution), '720P', ['720P', '1080P', '1080P-SR', '1440P-SR']),
    duration: integerBetween(firstDefined(params.duration, input.duration, input.seconds), 5, 2, 15),
    seed: integerBetween(firstDefined(params.seed, input.seed), -1, -1, 2147483647),
  };
}

function appendPromptBindings(prompt, bindings) {
  const base = String(prompt || '').trim();
  const missing = bindings.filter(({ token }) => !base.includes(token));
  if (!missing.length) return base;
  const bindingText = missing.map(({ token, label }) => `${token} is ${label}`).join('. ');
  return [base, `${bindingText}. Keep every referenced subject visually consistent throughout the video.`]
    .filter(Boolean)
    .join('\n\n');
}

function atlasImageMentionPrompt(prompt, imageCount) {
  let base = String(prompt || '').trim();
  const missing = [];
  for (let index = 1; index <= imageCount; index += 1) {
    const token = `@image${index}`;
    const attached = new RegExp(`[\\p{L}\\p{N}_-]+${token}\\b`, 'iu');
    if (attached.test(base)) continue;
    const bare = new RegExp(`(^|[\\s([{,;:])${token}\\b`, 'giu');
    if (bare.test(base)) {
      base = base.replace(bare, `$1subject${index}${token}`);
      continue;
    }
    missing.push(`subject${index}${token}`);
  }
  if (!missing.length) return base;
  return [base, `Use ${missing.join(', ')} as ordered reference subjects and keep them visually consistent.`]
    .filter(Boolean)
    .join('\n\n');
}

function characterReferencePrompt(prompt, referenceCount) {
  const base = String(prompt || '').trim();
  const missing = [];
  for (let index = 1; index <= referenceCount; index += 1) {
    const token = `character${index}`;
    if (!new RegExp(`\\b${token}\\b`, 'i').test(base)) {
      missing.push(`${token} corresponds to reference material ${index}`);
    }
  }
  if (!missing.length) return base;
  return [base, `${missing.join('. ')}. Preserve each character's identity consistently.`]
    .filter(Boolean)
    .join('\n\n');
}

function normalizeWanSpicyReferenceParams(params, input, refs) {
  if (!refs.length) throw new Error('Wan 2.7 Spicy 参考生视频至少需要一张参考图。');
  const referenceImages = refs.slice(0, 4);
  const requestedRatio = String(firstDefined(
    params.aspect_ratio,
    params.ratio,
    input.aspect_ratio,
    input.aspectRatio,
    input.ratio,
    'auto',
  ));
  return {
    reference_images: referenceImages,
    prompt: atlasImageMentionPrompt(firstDefined(params.prompt, input.prompt, ''), referenceImages.length),
    duration: integerBetween(firstDefined(params.duration, input.duration, input.seconds), 5, 2, 15),
    resolution: wanResolution(
      firstDefined(params.resolution, input.resolution),
      '720P',
      ['720P', '1080P', '1080P-SR', '1440P-SR'],
    ),
    aspect_ratio: ['auto', '16:9', '9:16', '4:3', '3:4', '1:1'].includes(requestedRatio)
      ? requestedRatio
      : 'auto',
  };
}

function normalizeWanReferenceParams(params, input, refs, videoRefs, audioRefs) {
  if (!refs.length && !videoRefs.length) throw new Error('Wan 2.7 参考生视频至少需要一张参考图或一个参考视频。');
  const images = refs.slice(0, 4);
  const videos = videoRefs.slice(0, 3);
  return {
    prompt: characterReferencePrompt(
      firstDefined(params.prompt, input.prompt, ''),
      Math.min(5, images.length + videos.length),
    ),
    negative_prompt: String(firstDefined(params.negative_prompt, input.negativePrompt, input.negative, '')).trim(),
    ...(images.length ? { images } : {}),
    ...(videos.length ? { videos } : {}),
    ...(audioRefs[0] ? { audio: audioRefs[0] } : {}),
    resolution: wanResolution(firstDefined(params.resolution, input.resolution), '1080P', ['720P', '1080P']),
    ratio: wanRatio(firstDefined(params.ratio, params.aspect_ratio, input.ratio, input.aspect_ratio, input.aspectRatio)),
    duration: integerBetween(firstDefined(params.duration, input.duration, input.seconds), 5, 2, 10),
    prompt_extend: params.prompt_extend === true,
    seed: integerBetween(firstDefined(params.seed, input.seed), -1, -1, 2147483647),
  };
}

function normalizeWanVideoEditParams(params, input, refs, videoRefs) {
  if (!videoRefs[0]) throw new Error('Wan 2.7 Video Edit 需要一个待编辑视频。');
  const durationValue = Number(firstDefined(params.duration, input.duration, input.seconds, 0));
  const duration = durationValue === 0 ? 0 : integerBetween(durationValue, 5, 2, 10);
  const ratioValue = firstDefined(params.ratio, params.aspect_ratio, input.ratio, input.aspect_ratio, input.aspectRatio);
  return {
    prompt: String(firstDefined(params.prompt, input.prompt, '')).trim(),
    negative_prompt: String(firstDefined(params.negative_prompt, input.negativePrompt, input.negative, '')).trim(),
    video: videoRefs[0],
    ...(refs.length ? { images: refs.slice(0, 3) } : {}),
    resolution: wanResolution(firstDefined(params.resolution, input.resolution), '1080P', ['720P', '1080P']),
    ...(ratioValue ? { ratio: wanRatio(ratioValue) } : {}),
    duration,
    prompt_extend: params.prompt_extend !== false,
    seed: integerBetween(firstDefined(params.seed, input.seed), -1, -1, 2147483647),
  };
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
  const url = String(payload?.data?.download_url || payload?.data?.url || payload?.download_url || payload?.url || '').trim();
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
    return {
      ok: true,
      payload,
      taskId: taskId(payload),
      urls: uniqueUrls(payload),
      text: outputText(payload),
      ...trace,
    };
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
      const text = outputText(payload);
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
      if (urls.length || text || SUCCESS_STATUSES.has(status)) {
        if (!urls.length && !text) {
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
        return { ok: true, urls, text, raw: payload, ...trace };
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
      kind === 'image'
        ? provider.imageModels
        : kind === 'video'
          ? provider.videoModels
          : provider.audioModels,
      kind === 'image'
        ? provider.defaults?.imageModel
        : kind === 'video'
          ? provider.defaults?.videoModel
          : provider.defaults?.audioModel,
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
  let videoRefs = [];
  let audioRefs = [];
  try {
    refs = await resolveAtlasMediaList(provider, [
      ...(Array.isArray(input.images) ? input.images : []),
      ...(input.image ? [input.image] : []),
      ...(input.image_url ? [input.image_url] : []),
    ], options);
    videoRefs = await resolveAtlasMediaList(provider, [
      ...(Array.isArray(input.videos) ? input.videos : []),
      ...(input.video ? [input.video] : []),
      ...(input.video_url ? [input.video_url] : []),
    ], options);
    audioRefs = await resolveAtlasMediaList(provider, [
      ...(Array.isArray(input.audios) ? input.audios : []),
      ...(input.audio ? [input.audio] : []),
      ...(input.audio_url ? [input.audio_url] : []),
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

  if (kind === 'audio' && Array.isArray(params.references)) {
    try {
      const references = [];
      for (const raw of params.references.slice(0, 20)) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const reference = { ...raw };
        for (const key of ['audio_url', 'image_url']) {
          if (reference[key]) reference[key] = await resolveAtlasMedia(provider, reference[key], options);
        }
        references.push(reference);
      }
      params.references = references;
    } catch (error) {
      return {
        ok: false,
        code: 'invalid_reference',
        providerId: provider.id,
        protocol: provider.protocol,
        model,
        error: error?.message || 'Atlas 音频参考素材解析失败。',
      };
    }
  }

  try {
    if (model === SEEDREAM_V5_T2I_MODEL && refs.length) {
      throw new Error(`Atlas 模型 ${model} 是文生图模式，不能接收参考图。请主动切换到 ${SEEDREAM_V5_EDIT_MODEL}；系统不会自动更换收费模型。`);
    }
    if (model === KLING_V3_T2V_MODEL && refs.length) {
      throw new Error(`Atlas 模型 ${model} 是文生视频模式，不能接收首帧图。请主动切换到 ${KLING_V3_I2V_MODEL}；系统不会自动更换收费模型。`);
    }
    if (model === WAN_27_SPICY_I2V_MODEL && refs.length > 1) {
      throw new Error(`Atlas 模型 ${model} 只接收一张首帧图。多张参考图请主动切换到 ${WAN_27_SPICY_REFERENCE_MODEL}；系统不会自动更换收费模型。`);
    }
    if (model === SEEDREAM_V5_T2I_MODEL || model === SEEDREAM_V5_EDIT_MODEL) {
      params = normalizeSeedreamV5Params(params, input, refs, model);
    } else if (model === KLING_V3_T2V_MODEL || model === KLING_V3_I2V_MODEL) {
      params = normalizeKlingV3Params(params, input, refs, model);
    } else if (model === WAN_27_SPICY_I2V_MODEL) {
      params = normalizeWanSpicyParams(params, input, refs);
    } else if (model === WAN_27_SPICY_REFERENCE_MODEL || /^atlascloud\/.*reference-to-video$/i.test(model)) {
      params = normalizeWanSpicyReferenceParams(params, input, refs);
    } else if (model === WAN_27_REFERENCE_MODEL) {
      params = normalizeWanReferenceParams(params, input, refs, videoRefs, audioRefs);
    } else if (model === WAN_27_VIDEO_EDIT_MODEL) {
      params = normalizeWanVideoEditParams(params, input, refs, videoRefs, audioRefs);
    } else {
      params = await normalizeDynamicAtlasParams(
        model,
        kind,
        params,
        input,
        refs,
        videoRefs,
        audioRefs,
        options,
      );
    }
  } catch (error) {
    return {
      ok: false,
      code: 'invalid_model_parameters',
      providerId: provider.id,
      protocol: provider.protocol,
      model,
      error: error?.message || 'Atlas 模型参数无效。',
    };
  }

  const endpoint = kind === 'image'
    ? '/model/generateImage'
    : kind === 'video'
      ? '/model/generateVideo'
      : '/model/generateAudio';
  const submitted = await submit(provider, endpoint, model, params, options);
  if (!submitted.ok) return submitted;
  if (submitted.urls.length || submitted.text) {
    return {
      ok: true,
      providerId: provider.id,
      protocol: provider.protocol,
      model,
      taskId: submitted.taskId || undefined,
      ...(kind === 'image'
        ? { imageUrls: submitted.urls }
        : kind === 'video'
          ? { videoUrls: submitted.urls }
          : { audioUrls: submitted.urls, text: submitted.text || '' }),
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
    ...(kind === 'image'
      ? { imageUrls: polled.urls }
      : kind === 'video'
        ? { videoUrls: polled.urls }
        : { audioUrls: polled.urls, text: polled.text || '' }),
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

async function generateChat(provider, input, options = {}) {
  const validation = validateProvider(provider);
  if (!validation.ok) return validation;
  return openaiCompatible.generateChat({
    ...provider,
    apiKey: validation.key,
    baseUrl: DEFAULT_CHAT_BASE_URL,
  }, input, options);
}

module.exports = {
  generateChat,
  generateImage: (provider, input, options) => runGeneration(provider, input, options, 'image'),
  generateVideo: (provider, input, options) => runGeneration(provider, input, options, 'video'),
  generateAudio: (provider, input, options) => runGeneration(provider, input, options, 'audio'),
  testProvider,
};
