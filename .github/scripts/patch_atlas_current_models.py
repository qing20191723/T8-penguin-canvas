from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


OLD_IMAGE = "seedream/seedream-v5.0-lite-text-to-image"
OLD_IMAGE_2 = "qwen-image/qwen-image-text-to-image-plus"
OLD_VIDEO = "kling-video/kling-v3.0-standard-text-to-video"
IMAGE_T2I = "bytedance/seedream-v5.0-lite"
IMAGE_EDIT = "bytedance/seedream-v5.0-lite/edit"
VIDEO_T2V = "kwaivgi/kling-v3.0-std/text-to-video"
VIDEO_I2V = "kwaivgi/kling-v3.0-std/image-to-video"

# Backend provider registry: current defaults plus migration of already-saved legacy settings.
registry_path = "backend/src/providers/registry.js"
registry = read(registry_path)
registry = registry.replace(
    f"const DEFAULT_ATLAS_IMAGE_MODELS = [\n  '{OLD_IMAGE}',\n  '{OLD_IMAGE_2}',\n];",
    f"const DEFAULT_ATLAS_IMAGE_MODELS = [\n  '{IMAGE_T2I}',\n  '{IMAGE_EDIT}',\n];",
)
registry = registry.replace(
    f"const DEFAULT_ATLAS_VIDEO_MODELS = [\n  '{OLD_VIDEO}',\n];",
    f"const DEFAULT_ATLAS_VIDEO_MODELS = [\n  '{VIDEO_T2V}',\n  '{VIDEO_I2V}',\n];",
)
registry = replace_once(
    registry,
    "const DEFAULT_JIMENG_IMAGE_MODELS = [",
    "const LEGACY_ATLAS_MODEL_IDS = new Map([\n"
    f"  ['{OLD_IMAGE}', '{IMAGE_T2I}'],\n"
    f"  ['{OLD_IMAGE_2}', '{IMAGE_T2I}'],\n"
    f"  ['{OLD_VIDEO}', '{VIDEO_T2V}'],\n"
    "]);\n\n"
    "const DEFAULT_JIMENG_IMAGE_MODELS = [",
    "Atlas legacy model map",
)
registry = replace_once(
    registry,
    "  if (!baseUrl && protocol === 'agnes') baseUrl = DEFAULT_AGNES_BASE_URL;\n",
    "  if (!baseUrl && protocol === 'agnes') baseUrl = DEFAULT_AGNES_BASE_URL;\n"
    "  if (!baseUrl && protocol === 'atlas') baseUrl = DEFAULT_ATLAS_BASE_URL;\n",
    "Atlas base URL fallback",
)
registry = replace_once(
    registry,
    "function normalizeModelscopeLoraStrength(value, fallback = 0.8) {",
    "function migrateAtlasModelId(value) {\n"
    "  const model = String(value || '').trim();\n"
    "  return LEGACY_ATLAS_MODEL_IDS.get(model) || model;\n"
    "}\n\n"
    "function migrateAtlasModelList(values, defaults) {\n"
    "  const migrated = normalizeModelList(values).map(migrateAtlasModelId);\n"
    "  return mergeModelLists(defaults, migrated)\n"
    "    .filter((model) => !LEGACY_ATLAS_MODEL_IDS.has(model));\n"
    "}\n\n"
    "function normalizeModelscopeLoraStrength(value, fallback = 0.8) {",
    "Atlas model migration helpers",
)
registry = replace_once(
    registry,
    "  return provider;\n}\n\nfunction normalizeAdvancedProviders",
    "  if (id === 'atlas' && protocol === 'atlas') {\n"
    "    provider.imageModels = migrateAtlasModelList(provider.imageModels, DEFAULT_ATLAS_IMAGE_MODELS);\n"
    "    provider.videoModels = migrateAtlasModelList(provider.videoModels, DEFAULT_ATLAS_VIDEO_MODELS);\n"
    "    const atlasDefaults = provider.defaults || {};\n"
    "    const imageModel = migrateAtlasModelId(atlasDefaults.imageModel);\n"
    "    const videoModel = migrateAtlasModelId(atlasDefaults.videoModel);\n"
    "    provider.defaults = {\n"
    "      ...atlasDefaults,\n"
    "      imageModel: provider.imageModels.includes(imageModel) ? imageModel : DEFAULT_ATLAS_IMAGE_MODELS[0],\n"
    "      videoModel: provider.videoModels.includes(videoModel) ? videoModel : DEFAULT_ATLAS_VIDEO_MODELS[0],\n"
    "      pollIntervalMs: normalizeNumber(atlasDefaults.pollIntervalMs, 3000, 1000, 30000),\n"
    "    };\n"
    "  }\n\n"
    "  return provider;\n}\n\nfunction normalizeAdvancedProviders",
    "Atlas provider normalization",
)
assert "const LEGACY_ATLAS_MODEL_IDS = new Map" in registry
write(registry_path, registry)

# Frontend fallbacks shown by ImageNode / VideoNode.
frontend_path = "src/utils/advancedProviders.ts"
frontend = read(frontend_path)
frontend = frontend.replace(OLD_IMAGE, IMAGE_T2I)
frontend = frontend.replace(OLD_IMAGE_2, IMAGE_EDIT)
frontend = frontend.replace(OLD_VIDEO, VIDEO_T2V)
frontend = frontend.replace(
    f"atlas: ['{VIDEO_T2V}'],",
    f"atlas: ['{VIDEO_T2V}', '{VIDEO_I2V}'],",
)
assert OLD_IMAGE not in frontend
assert OLD_IMAGE_2 not in frontend
assert OLD_VIDEO not in frontend
write(frontend_path, frontend)

# Atlas adapter: normalize current model schemas while keeping all generic nodes unchanged.
atlas_path = "backend/src/providers/atlas.js"
atlas = read(atlas_path)
atlas = replace_once(
    atlas,
    "const DEFAULT_POLL_INTERVAL_MS = 3000;\n",
    "const DEFAULT_POLL_INTERVAL_MS = 3000;\n"
    f"const SEEDREAM_V5_T2I_MODEL = '{IMAGE_T2I}';\n"
    f"const SEEDREAM_V5_EDIT_MODEL = '{IMAGE_EDIT}';\n"
    f"const KLING_V3_T2V_MODEL = '{VIDEO_T2V}';\n"
    f"const KLING_V3_I2V_MODEL = '{VIDEO_I2V}';\n"
    "const SEEDREAM_V5_SIZES = [\n"
    "  '2048*2048', '2304*1728', '1728*2304', '2848*1600', '1600*2848',\n"
    "  '2496*1664', '1664*2496', '3136*1344', '3072*3072', '3456*2592',\n"
    "  '2592*3456', '4096*2304', '2304*4096', '2496*3744', '3744*2496', '4704*2016',\n"
    "];\n",
    "Atlas current model constants",
)
atlas = replace_once(
    atlas,
    "function firstDefined(...values) {\n  return values.find((value) => value !== undefined && value !== null && value !== '');\n}\n",
    "function firstDefined(...values) {\n  return values.find((value) => value !== undefined && value !== null && value !== '');\n}\n\n"
    "function dimensions(value) {\n"
    "  const match = String(value || '').trim().match(/^(\\d{2,5})\\s*[xX×*]\\s*(\\d{2,5})$/);\n"
    "  if (!match) return null;\n"
    "  const width = Number(match[1]);\n"
    "  const height = Number(match[2]);\n"
    "  return width > 0 && height > 0 ? { width, height } : null;\n"
    "}\n\n"
    "function ratioNumber(value) {\n"
    "  const match = String(value || '').trim().match(/^(\\d+(?:\\.\\d+)?)\\s*:\\s*(\\d+(?:\\.\\d+)?)$/);\n"
    "  if (!match) return 0;\n"
    "  const left = Number(match[1]);\n"
    "  const right = Number(match[2]);\n"
    "  return left > 0 && right > 0 ? left / right : 0;\n"
    "}\n\n"
    "function nearestSeedreamV5Size(sizeValue, ratioValue) {\n"
    "  const normalized = String(sizeValue || '').trim().replace(/[xX×]/g, '*');\n"
    "  if (SEEDREAM_V5_SIZES.includes(normalized)) return normalized;\n"
    "  const parsed = dimensions(sizeValue);\n"
    "  const targetRatio = parsed ? parsed.width / parsed.height : ratioNumber(ratioValue);\n"
    "  if (!targetRatio) return '2048*2048';\n"
    "  return SEEDREAM_V5_SIZES.reduce((best, candidate) => {\n"
    "    const current = dimensions(candidate);\n"
    "    const bestSize = dimensions(best);\n"
    "    const currentDistance = Math.abs(Math.log((current.width / current.height) / targetRatio));\n"
    "    const bestDistance = Math.abs(Math.log((bestSize.width / bestSize.height) / targetRatio));\n"
    "    return currentDistance < bestDistance ? candidate : best;\n"
    "  }, '2048*2048');\n"
    "}\n\n"
    "function normalizeSeedreamV5Params(params, input, refs, model) {\n"
    "  const size = nearestSeedreamV5Size(\n"
    "    firstDefined(params.size, params.image_size, input.size, input.image_size, input.imageSize),\n"
    "    firstDefined(params.aspect_ratio, params.ratio, input.aspect_ratio, input.aspectRatio, input.ratio),\n"
    "  );\n"
    "  const format = String(firstDefined(params.output_format, input.output_format, 'jpeg')).toLowerCase();\n"
    "  const normalized = {\n"
    "    prompt: String(firstDefined(params.prompt, input.prompt, '')).trim(),\n"
    "    size,\n"
    "    output_format: format === 'png' ? 'png' : 'jpeg',\n"
    "    enable_base64_output: false,\n"
    "  };\n"
    "  if (model === SEEDREAM_V5_EDIT_MODEL) normalized.images = refs.slice(0, 14);\n"
    "  return normalized;\n"
    "}\n\n"
    "function normalizeKlingV3Params(params, input, refs, model) {\n"
    "  const durationRaw = Number(firstDefined(params.duration, input.duration, input.seconds, 5));\n"
    "  const duration = Math.max(3, Math.min(15, Math.round(Number.isFinite(durationRaw) ? durationRaw : 5)));\n"
    "  const ratio = String(firstDefined(params.aspect_ratio, params.ratio, input.aspect_ratio, input.aspectRatio, input.ratio, '16:9'));\n"
    "  const normalized = {\n"
    "    prompt: String(firstDefined(params.prompt, input.prompt, '')).trim(),\n"
    "    negative_prompt: String(firstDefined(params.negative_prompt, input.negativePrompt, input.negative, '')).trim(),\n"
    "    duration,\n"
    "    aspect_ratio: ['16:9', '9:16', '1:1'].includes(ratio) ? ratio : '16:9',\n"
    "    cfg_scale: Math.max(0, Math.min(1, Number(firstDefined(params.cfg_scale, 0.5)) || 0.5)),\n"
    "    sound: typeof params.sound === 'boolean' ? params.sound : true,\n"
    "    multi_shot: params.multi_shot === true,\n"
    "  };\n"
    "  if (normalized.multi_shot && ['customize', 'intelligence'].includes(params.shot_type)) {\n"
    "    normalized.shot_type = params.shot_type;\n"
    "    if (params.shot_type === 'customize' && Array.isArray(params.multi_prompt)) normalized.multi_prompt = params.multi_prompt;\n"
    "  }\n"
    "  if (model === KLING_V3_I2V_MODEL) {\n"
    "    normalized.image = refs[0];\n"
    "    if (refs[1]) normalized.end_image = refs[1];\n"
    "    const resolution = String(firstDefined(params.resolution, input.resolution, '')).toUpperCase();\n"
    "    if (['720P', '1080P'].includes(resolution)) normalized.resolution = resolution;\n"
    "  }\n"
    "  return normalized;\n"
    "}\n",
    "Atlas model-specific parameter normalization",
)
atlas = replace_once(
    atlas,
    "  const params = {\n    ...safeParams(provider.defaults?.params),\n    ...safeParams(input.providerParams),\n  };",
    "  let params = {\n    ...safeParams(provider.defaults?.params),\n    ...safeParams(input.providerParams),\n  };",
    "mutable Atlas params",
)
old_refs = """  try {
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
"""
new_refs = """  let refs = [];
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
"""
atlas = replace_once(atlas, old_refs, new_refs, "Atlas reference and schema routing")
assert OLD_IMAGE not in atlas
assert OLD_VIDEO not in atlas
write(atlas_path, atlas)

# Permanent regression tests using mocked Atlas responses; no credits consumed.
test_path = Path("backend/src/providers/atlas.test.js")
test_path.write_text(r'''const test = require('node:test');
const assert = require('node:assert/strict');
const atlas = require('./atlas');

const provider = {
  id: 'atlas',
  protocol: 'atlas',
  baseUrl: 'https://api.atlascloud.ai/api/v1',
  apiKey: 'test-key',
  imageModels: ['bytedance/seedream-v5.0-lite', 'bytedance/seedream-v5.0-lite/edit'],
  videoModels: ['kwaivgi/kling-v3.0-std/text-to-video', 'kwaivgi/kling-v3.0-std/image-to-video'],
  defaults: {
    imageModel: 'bytedance/seedream-v5.0-lite',
    videoModel: 'kwaivgi/kling-v3.0-std/text-to-video',
    pollIntervalMs: 1000,
  },
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'test-request' },
  });
}

function generationFetch(assertSubmit, outputUrl) {
  return async (url, init = {}) => {
    if (String(url).includes('/model/prediction/')) {
      return jsonResponse({ code: 200, data: { status: 'completed', outputs: [outputUrl] } });
    }
    const body = JSON.parse(init.body);
    assertSubmit(String(url), body);
    return jsonResponse({ code: 200, data: { id: 'prediction-test', status: 'processing' } });
  };
}

test('Seedream v5 text-to-image uses the current model and schema', async () => {
  const result = await atlas.generateImage(provider, {
    model: 'bytedance/seedream-v5.0-lite',
    prompt: 'a white circle',
    size: '1024x1024',
    n: 1,
    providerParams: { image_size: '1024x1024', aspect_ratio: '1:1' },
  }, {
    fetchImpl: generationFetch((url, body) => {
      assert.match(url, /\/model\/generateImage$/);
      assert.equal(body.model, 'bytedance/seedream-v5.0-lite');
      assert.equal(body.size, '2048*2048');
      assert.equal(body.output_format, 'jpeg');
      assert.equal(body.enable_base64_output, false);
      assert.ok(!('image_size' in body));
      assert.ok(!('aspect_ratio' in body));
      assert.ok(!('n' in body));
    }, 'https://example.com/output.jpg'),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.imageUrls, ['https://example.com/output.jpg']);
});

test('Seedream v5 switches to edit when ImageNode supplies references', async () => {
  const result = await atlas.generateImage(provider, {
    model: 'bytedance/seedream-v5.0-lite',
    prompt: 'turn it blue',
    images: ['https://example.com/input.png'],
    size: '1536x1024',
  }, {
    fetchImpl: generationFetch((_url, body) => {
      assert.equal(body.model, 'bytedance/seedream-v5.0-lite/edit');
      assert.deepEqual(body.images, ['https://example.com/input.png']);
      assert.equal(body.size, '2496*1664');
      assert.ok(!('image' in body));
    }, 'https://example.com/edited.png'),
  });
  assert.equal(result.ok, true);
});

test('Kling v3 text-to-video uses the current Atlas model ID', async () => {
  const result = await atlas.generateVideo(provider, {
    model: 'kwaivgi/kling-v3.0-std/text-to-video',
    prompt: 'a calm ocean',
    duration: 5,
    aspect_ratio: '16:9',
  }, {
    fetchImpl: generationFetch((url, body) => {
      assert.match(url, /\/model\/generateVideo$/);
      assert.equal(body.model, 'kwaivgi/kling-v3.0-std/text-to-video');
      assert.equal(body.duration, 5);
      assert.equal(body.aspect_ratio, '16:9');
      assert.equal(body.sound, true);
    }, 'https://example.com/output.mp4'),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.videoUrls, ['https://example.com/output.mp4']);
});

test('Kling v3 switches to image-to-video for a reference image', async () => {
  const result = await atlas.generateVideo(provider, {
    model: 'kwaivgi/kling-v3.0-std/text-to-video',
    prompt: 'slow camera push',
    images: ['https://example.com/start.png'],
    duration: 5,
  }, {
    fetchImpl: generationFetch((_url, body) => {
      assert.equal(body.model, 'kwaivgi/kling-v3.0-std/image-to-video');
      assert.equal(body.image, 'https://example.com/start.png');
    }, 'https://example.com/i2v.mp4'),
  });
  assert.equal(result.ok, true);
});
''', encoding="utf-8")

for path in [frontend_path, atlas_path]:
    text = read(path)
    if OLD_IMAGE in text or OLD_IMAGE_2 in text or OLD_VIDEO in text:
        raise RuntimeError(f"legacy Atlas model remains in {path}")

print("Atlas current model IDs, schema normalization, migrations, and tests applied")
