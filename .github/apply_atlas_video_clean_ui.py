from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text(encoding='utf-8')


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding='utf-8')


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, found {count}: {old[:120]!r}')
    write(path, text.replace(old, new, 1))


# ---------------------------------------------------------------------------
# Atlas video schemas
# ---------------------------------------------------------------------------
atlas_path = 'backend/src/providers/atlas.js'
atlas = read(atlas_path)

atlas = atlas.replace(
    "const WAN_27_SPICY_I2V_MODEL = 'atlascloud/wan-2.7-spicy/image-to-video';\nconst WAN_27_REFERENCE_MODEL = 'alibaba/wan-2.7/reference-to-video';",
    "const WAN_27_SPICY_I2V_MODEL = 'atlascloud/wan-2.7-spicy/image-to-video';\nconst WAN_27_SPICY_REFERENCE_MODEL = 'atlascloud/wan-2.7-spicy/reference-to-video';\nconst WAN_27_REFERENCE_MODEL = 'alibaba/wan-2.7/reference-to-video';",
    1,
)

old_helpers = """function normalizeWanReferenceParams(params, input, refs, videoRefs, audioRefs) {
  if (!refs.length && !videoRefs.length) throw new Error('Wan 2.7 参考生视频至少需要一张参考图或一个参考视频。');
  return {
    prompt: String(firstDefined(params.prompt, input.prompt, '')).trim(),
    negative_prompt: String(firstDefined(params.negative_prompt, input.negativePrompt, input.negative, '')).trim(),
    ...(refs.length ? { images: refs.slice(0, 6) } : {}),
    ...(videoRefs.length ? { videos: videoRefs.slice(0, 3) } : {}),
    ...(audioRefs[0] ? { audio: audioRefs[0] } : {}),
    resolution: wanResolution(firstDefined(params.resolution, input.resolution), '1080P', ['720P', '1080P']),
    ratio: wanRatio(firstDefined(params.ratio, params.aspect_ratio, input.ratio, input.aspect_ratio, input.aspectRatio)),
    duration: integerBetween(firstDefined(params.duration, input.duration, input.seconds), 5, 2, 10),
    prompt_extend: params.prompt_extend !== false,
    seed: integerBetween(firstDefined(params.seed, input.seed), -1, -1, 2147483647),
  };
}
"""
new_helpers = """function appendPromptBindings(prompt, bindings) {
  const base = String(prompt || '').trim();
  const missing = bindings.filter(({ token }) => !base.includes(token));
  if (!missing.length) return base;
  const bindingText = missing.map(({ token, label }) => `${token} is ${label}`).join('. ');
  return [base, `${bindingText}. Keep every referenced subject visually consistent throughout the video.`]
    .filter(Boolean)
    .join('\\n\\n');
}

function attachedSubjectPrompt(prompt, imageCount) {
  return appendPromptBindings(prompt, Array.from({ length: imageCount }, (_, index) => ({
    token: `attached_subject@image${index + 1}`,
    label: `reference subject ${index + 1}`,
  })));
}

function characterReferencePrompt(prompt, referenceCount) {
  const base = String(prompt || '').trim();
  const missing = [];
  for (let index = 1; index <= referenceCount; index += 1) {
    const token = `character${index}`;
    if (!new RegExp(`\\\\b${token}\\\\b`, 'i').test(base)) {
      missing.push(`${token} corresponds to reference material ${index}`);
    }
  }
  if (!missing.length) return base;
  return [base, `${missing.join('. ')}. Preserve each character's identity consistently.`]
    .filter(Boolean)
    .join('\\n\\n');
}

function normalizeWanSpicyReferenceParams(params, input, refs) {
  if (!refs.length) throw new Error('Wan 2.7 Spicy 参考生视频至少需要一张参考图。');
  const images = refs.slice(0, 4);
  return {
    prompt: attachedSubjectPrompt(firstDefined(params.prompt, input.prompt, ''), images.length),
    negative_prompt: String(firstDefined(params.negative_prompt, input.negativePrompt, input.negative, '')).trim(),
    images,
    resolution: wanResolution(firstDefined(params.resolution, input.resolution), '720P', ['720P', '1080P']),
    ratio: wanRatio(firstDefined(params.ratio, params.aspect_ratio, input.ratio, input.aspect_ratio, input.aspectRatio)),
    duration: integerBetween(firstDefined(params.duration, input.duration, input.seconds), 5, 2, 10),
    prompt_extend: false,
    seed: integerBetween(firstDefined(params.seed, input.seed), -1, -1, 2147483647),
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
"""
if atlas.count(old_helpers) != 1:
    raise SystemExit('atlas.js: Wan reference normalizer block mismatch')
atlas = atlas.replace(old_helpers, new_helpers, 1)

atlas = atlas.replace(
    "  if (kind === 'video' && refs.length && model === KLING_V3_T2V_MODEL) model = KLING_V3_I2V_MODEL;",
    "  if (kind === 'video' && refs.length && model === KLING_V3_T2V_MODEL) model = KLING_V3_I2V_MODEL;\n  if (kind === 'video' && refs.length > 1 && model === WAN_27_SPICY_I2V_MODEL) model = WAN_27_SPICY_REFERENCE_MODEL;",
    1,
)

old_route = """    } else if (model === WAN_27_SPICY_I2V_MODEL) {
      params = normalizeWanSpicyParams(params, input, refs);
    } else if (model === WAN_27_REFERENCE_MODEL) {
      params = normalizeWanReferenceParams(params, input, refs, videoRefs, audioRefs);
"""
new_route = """    } else if (model === WAN_27_SPICY_I2V_MODEL) {
      params = normalizeWanSpicyParams(params, input, refs);
    } else if (model === WAN_27_SPICY_REFERENCE_MODEL || /^atlascloud\\/.*reference-to-video$/i.test(model)) {
      params = normalizeWanSpicyReferenceParams(params, input, refs);
    } else if (model === WAN_27_REFERENCE_MODEL) {
      params = normalizeWanReferenceParams(params, input, refs, videoRefs, audioRefs);
"""
if atlas.count(old_route) != 1:
    raise SystemExit('atlas.js: Wan routing block mismatch')
atlas = atlas.replace(old_route, new_route, 1)
write(atlas_path, atlas)

# Preferred dynamic model ordering.
for path in ['backend/src/providers/registry.js', 'src/stores/apiKeys.ts']:
    text = read(path)
    marker = "  'atlascloud/wan-2.7-spicy/image-to-video',\n"
    replacement = marker + "  'atlascloud/wan-2.7-spicy/reference-to-video',\n"
    if text.count(marker) < 1:
        raise SystemExit(f'{path}: spicy model marker missing')
    if 'atlascloud/wan-2.7-spicy/reference-to-video' not in text:
        text = text.replace(marker, replacement, 1)
    write(path, text)

# Add adapter tests for both official Alibaba labels and Atlas attached-subject syntax.
test_path = 'backend/src/providers/atlas.test.js'
tests = read(test_path)
if 'Spicy reference-to-video binds every image' not in tests:
    tests += r'''

test('Spicy reference-to-video binds every image with attached_subject syntax', async () => {
  const result = await atlas.generateVideo({
    ...provider,
    videoModels: [...provider.videoModels, 'atlascloud/wan-2.7-spicy/reference-to-video'],
  }, {
    model: 'atlascloud/wan-2.7-spicy/reference-to-video',
    prompt: 'The subjects walk forward together.',
    images: [
      'https://example.com/subject-1.png',
      'https://example.com/subject-2.png',
      'https://example.com/subject-3.png',
    ],
  }, {
    fetchImpl: generationFetch((_url, body) => {
      assert.equal(body.model, 'atlascloud/wan-2.7-spicy/reference-to-video');
      assert.equal(body.images.length, 3);
      for (let index = 1; index <= 3; index += 1) {
        assert.match(body.prompt, new RegExp(`attached_subject@image${index}`));
      }
      assert.equal(body.prompt_extend, false);
    }, 'https://example.com/spicy-reference.mp4'),
  });
  assert.equal(result.ok, true);
});

test('Alibaba Wan reference-to-video adds ordered character labels', async () => {
  const result = await atlas.generateVideo(provider, {
    model: 'alibaba/wan-2.7/reference-to-video',
    prompt: 'They interact naturally in one continuous shot.',
    images: ['https://example.com/character-a.png', 'https://example.com/character-b.png'],
    videos: ['https://example.com/character-c.mp4'],
  }, {
    fetchImpl: generationFetch((_url, body) => {
      assert.deepEqual(body.images, [
        'https://example.com/character-a.png',
        'https://example.com/character-b.png',
      ]);
      assert.deepEqual(body.videos, ['https://example.com/character-c.mp4']);
      assert.match(body.prompt, /character1/i);
      assert.match(body.prompt, /character2/i);
      assert.match(body.prompt, /character3/i);
      assert.equal(body.prompt_extend, false);
    }, 'https://example.com/alibaba-reference.mp4'),
  });
  assert.equal(result.ok, true);
});
'''
write(test_path, tests)

# ---------------------------------------------------------------------------
# Remove the public floating rail, model advertising modal, placement shelf,
# and creator-agent launcher. Keep logs/terminal and core canvas interactions.
# ---------------------------------------------------------------------------
canvas_path = 'src/components/Canvas.tsx'
canvas = read(canvas_path)

canvas, help_count = re.subn(
    r"\ntype ModelUsageHelpSection = \{.*?\nfunction getReactFlowHandleInfo",
    "\nfunction getReactFlowHandleInfo",
    canvas,
    count=1,
    flags=re.S,
)
if help_count != 1:
    raise SystemExit(f'Canvas.tsx: expected one model-help data block, removed {help_count}')

canvas = canvas.replace(
    "  const [modelHelpOpen, setModelHelpOpen] = useState(false);\n  const [modelHelpTab, setModelHelpTab] = useState<ModelUsageHelpTabId>('budget-house');\n",
    "",
    1,
)
canvas, effect_count = re.subn(
    r"\n  useEffect\(\(\) => \{\n    if \(!modelHelpOpen\) return;.*?\n  \}, \[modelHelpOpen\]\);\n",
    "\n",
    canvas,
    count=1,
    flags=re.S,
)
if effect_count != 1:
    raise SystemExit(f'Canvas.tsx: expected one model-help effect, removed {effect_count}')

canvas, rail_count = re.subn(
    r"\n  const floatingControlRail = \(\n    <>.*?\n    </>\n  \);\n",
    "\n  const floatingControlRail = null;\n",
    canvas,
    count=1,
    flags=re.S,
)
if rail_count != 1:
    raise SystemExit(f'Canvas.tsx: expected one floating control rail, removed {rail_count}')

canvas = canvas.replace(
    "      {loaded && loadedCanvasId === activeId && activeId && activeProjectId && (\n        <CreatorAgentPanel",
    "      {false && loaded && loadedCanvasId === activeId && activeId && activeProjectId && (\n        <CreatorAgentPanel",
    1,
)
canvas = canvas.replace(
    "        {!placementShelfHidden && (\n          <PlacementShelf",
    "        {false && !placementShelfHidden && (\n          <PlacementShelf",
    1,
)

# Replace old public branding and export tags.
canvas = canvas.replace("['T8', '贞贞画布']", "['清尘', '清尘画布']")
canvas = canvas.replace("['T8', '贞贞画布', 'Photoshop']", "['清尘', '清尘画布', 'Photoshop']")
write(canvas_path, canvas)

# Remove Chinese legacy brand/advertising text from source and metadata without
# renaming compatibility field identifiers or API database columns.
text_roots = [Path('src'), Path('backend'), Path('public')]
text_files = []
for root in text_roots:
    if root.exists():
        text_files.extend(path for path in root.rglob('*') if path.is_file() and path.suffix.lower() in {'.ts', '.tsx', '.js', '.cjs', '.mjs', '.json', '.html', '.css', '.md'})
text_files.extend([Path('index.html'), Path('package.json')])
for path in text_files:
    if not path.exists():
        continue
    text = path.read_text(encoding='utf-8')
    text = text.replace('贞贞的无限画布', '清尘无限画布')
    text = text.replace('贞贞画布', '清尘画布')
    text = text.replace('贞贞的平价AI小屋', 'Atlas Cloud')
    text = text.replace('贞贞的平价 AI 小屋', 'Atlas Cloud')
    text = text.replace('贞贞的AI工坊', 'Atlas Cloud')
    text = text.replace('贞贞工坊', 'Atlas Cloud')
    text = text.replace('贞贞', '清尘')
    path.write_text(text, encoding='utf-8')

# Repository/package identity visible to users.
package_path = Path('package.json')
package = package_path.read_text(encoding='utf-8')
package = package.replace('https://github.com/T8mars/T8-penguin-canvas', 'https://github.com/qing20191723/T8-penguin-canvas')
package = package.replace('cn.t8star.penguin-canvas', 'com.qingchen.atlascanvas')
package = package.replace('"productName": "T8-PenguinCanvas"', '"productName": "Qingchen-AtlasCanvas"')
package = package.replace('"shortcutName": "清尘的无限画布"', '"shortcutName": "清尘无限画布"')
package_path.write_text(package, encoding='utf-8')

# Restore normal postinstall and remove one-time inspection artifacts.
postinstall = """'use strict';

const { spawnSync } = require('node:child_process');

const isRender = String(process.env.RENDER || '').toLowerCase() === 'true';
const isWebDeploy = isRender || process.env.T8_WEB_DEPLOY === '1';

if (isWebDeploy) {
  console.log('[postinstall] Web deployment detected; preserving Node.js native module ABI.');
  console.log('[postinstall] Skipping electron-builder install-app-deps.');
  process.exit(0);
}

const command = process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder';
const result = spawnSync(command, ['install-app-deps'], {
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error('[postinstall] Failed to launch electron-builder:', result.error);
  process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
"""
write('scripts/postinstall.cjs', postinstall)
Path('.github/inspect-current-ui.cjs').unlink(missing_ok=True)

# Hard assertions for the public UI.
canvas = read(canvas_path)
for forbidden in [
    'MODEL NOTES',
    '模型注意事项',
    't8-control-rail nodrag nopan',
    'const floatingControlRail = (',
    '{!placementShelfHidden && (',
    '{loaded && loadedCanvasId === activeId && activeId && activeProjectId && (',
]:
    if forbidden in canvas:
        raise SystemExit(f'Canvas.tsx: forbidden public UI remains: {forbidden}')
if 'const floatingControlRail = null;' not in canvas:
    raise SystemExit('Canvas.tsx: floating rail was not disabled')

for path in [Path('src'), Path('backend'), Path('public')]:
    if not path.exists():
        continue
    for file in path.rglob('*'):
        if not file.is_file() or file.suffix.lower() not in {'.ts', '.tsx', '.js', '.cjs', '.mjs', '.json', '.html', '.css', '.md'}:
            continue
        if '贞贞' in file.read_text(encoding='utf-8'):
            raise SystemExit(f'Legacy Chinese branding remains in {file}')

print('Atlas video schemas and clean public UI patch applied successfully.')
