import re
from pathlib import Path

BASELINE = "0eb487960e0e9cb9b9a1dc127d26ef4de7992fe5"


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    Path(path).write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    count = content.count(old)
    if count != 1:
        raise SystemExit(
            f"{path}: expected one exact marker, found {count}: {old[:160]!r}"
        )
    write(path, content.replace(old, new, 1))


# React #310: creatorCanvasContext was declared after the conditional no-canvas
# return, so the component rendered a different number of hooks as activeId changed.
canvas_path = "src/components/Canvas.tsx"
canvas = read(canvas_path)
creator_hook = """  const creatorCanvasContext = useMemo(() => buildCreatorCanvasContext(
    nodes,
    edges,
    getViewport(),
    {
      width: typeof window === 'undefined' ? 1440 : window.innerWidth,
      height: typeof window === 'undefined' ? 900 : window.innerHeight,
    },
  ), [edges, getViewport, nodes, viewportMoving]);

"""
if canvas.count(creator_hook) != 1:
    raise SystemExit("Canvas.tsx: creatorCanvasContext marker changed unexpectedly")
original_hook_index = canvas.index(creator_hook)
early_return_matches = list(
    re.finditer(r"(?m)^[ \t]*if\s*\(\s*!activeId\s*\)\s*\{", canvas)
)
preceding_returns = [match for match in early_return_matches if match.start() < original_hook_index]
if not preceding_returns:
    raise SystemExit("Canvas.tsx: no activeId guard precedes creatorCanvasContext")
target_return = max(preceding_returns, key=lambda match: match.start())
canvas = canvas.replace(creator_hook, "", 1)
insert_at = target_return.start()
canvas = canvas[:insert_at] + creator_hook + canvas[insert_at:]
write(canvas_path, canvas)


# The action-bar X previously only deselected the node. Use React Flow's deletion
# API so the normal Canvas onNodesChange cleanup path removes the node and edges.
replace_once(
    "src/components/NodeActionBar.tsx",
    "在节点右上角外侧出现一条快捷操作栏: 执行 / 中止 / 取消选中",
    "在节点右上角外侧出现一条快捷操作栏: 执行 / 中止 / 删除节点",
)
replace_once(
    "src/components/NodeActionBar.tsx",
    "  const { setNodes } = useReactFlow();",
    "  const { setNodes, deleteElements } = useReactFlow();",
)
replace_once(
    "src/components/NodeActionBar.tsx",
    """  const onClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    setNodes((nds) => nds.map((n) => (n.id === selectedExe.id ? { ...n, selected: false } : n)));
  };
""",
    """  const onClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    void deleteElements({ nodes: [selectedExe] });
  };
""",
)
replace_once(
    "src/components/NodeActionBar.tsx",
    "{/* 取消选中 (关闭操作栏) */}",
    "{/* 删除当前节点 */}",
)
replace_once(
    "src/components/NodeActionBar.tsx",
    'title="取消选中 (隐藏操作栏)"',
    'title="删除当前节点"',
)


# Atlas current API examples use both success code 0 and code 200.
replace_once(
    "backend/src/providers/atlas.js",
    "  return payload?.code == null || String(payload.code) === '200';",
    "  return payload?.code == null || ['0', '200'].includes(String(payload.code));",
)
replace_once(
    "backend/src/routes/atlasProxy.js",
    "  return code === undefined || code === null || String(code) === '200';",
    "  return code === undefined || code === null || ['0', '200'].includes(String(code));",
)

# Atlas upload responses are documented with both data.download_url and a
# top-level url depending on the endpoint response example.
replace_once(
    "backend/src/providers/atlas.js",
    "  const url = String(payload?.data?.download_url || payload?.data?.url || '').trim();",
    "  const url = String(payload?.data?.download_url || payload?.data?.url || payload?.download_url || payload?.url || '').trim();",
)

# Explicit edit / image-to-video schemas require a source image. Reject invalid
# jobs before spending an upstream request.
replace_once(
    "backend/src/providers/atlas.js",
    "  if (model === SEEDREAM_V5_EDIT_MODEL) normalized.images = refs.slice(0, 10);",
    """  if (model === SEEDREAM_V5_EDIT_MODEL) {
    if (!refs.length) throw new Error('Seedream v5 Pro 图片编辑至少需要一张参考图。');
    normalized.images = refs.slice(0, 10);
  }""",
)
replace_once(
    "backend/src/providers/atlas.js",
    """  if (model === KLING_V3_I2V_MODEL) {
    normalized.image = refs[0];
""",
    """  if (model === KLING_V3_I2V_MODEL) {
    if (!refs[0]) throw new Error('Kling v3 图生视频需要一张首帧图。');
    normalized.image = refs[0];
""",
)

# Keep Atlas' official Kling image-to-video model as itself. The legacy migration
# silently replaced the requested model with a different Wan model.
replace_once(
    "backend/src/providers/registry.js",
    "  'kwaivgi/kling-v3.0-std/text-to-video',\n  'atlascloud/wan-2.7-spicy/image-to-video',",
    "  'kwaivgi/kling-v3.0-std/text-to-video',\n  'kwaivgi/kling-v3.0-std/image-to-video',\n  'atlascloud/wan-2.7-spicy/image-to-video',",
)
replace_once(
    "backend/src/providers/registry.js",
    "  ['kwaivgi/kling-v3.0-std/image-to-video', 'atlascloud/wan-2.7-spicy/image-to-video'],\n",
    "",
)
replace_once(
    "src/stores/apiKeys.ts",
    "  'kwaivgi/kling-v3.0-std/text-to-video',\n  'atlascloud/wan-2.7-spicy/image-to-video',",
    "  'kwaivgi/kling-v3.0-std/text-to-video',\n  'kwaivgi/kling-v3.0-std/image-to-video',\n  'atlascloud/wan-2.7-spicy/image-to-video',",
)
replace_once(
    "src/utils/advancedProviders.ts",
    """      'kwaivgi/kling-v3.0-std/text-to-video',
      'atlascloud/wan-2.7-spicy/image-to-video',
      'alibaba/wan-2.7/reference-to-video',
""",
    """      'kwaivgi/kling-v3.0-std/text-to-video',
      'kwaivgi/kling-v3.0-std/image-to-video',
      'atlascloud/wan-2.7-spicy/image-to-video',
      'atlascloud/wan-2.7-spicy/reference-to-video',
      'alibaba/wan-2.7/reference-to-video',
""",
)


# Extend the focused provider fixture and add regression coverage for the exact
# adapter changes above.
tests_path = "backend/src/providers/atlas.test.js"
replace_once(
    tests_path,
    "    'kwaivgi/kling-v3.0-std/text-to-video',\n    'atlascloud/wan-2.7-spicy/image-to-video',",
    "    'kwaivgi/kling-v3.0-std/text-to-video',\n    'kwaivgi/kling-v3.0-std/image-to-video',\n    'atlascloud/wan-2.7-spicy/image-to-video',",
)
tests = read(tests_path)
marker = "test('Wan 2.7 Spicy maps first-frame image-to-video fields', async () => {"
if tests.count(marker) != 1:
    raise SystemExit("atlas.test.js: insertion marker changed unexpectedly")
extra_tests = r'''test('Kling v3 image-to-video preserves the official model and maps start/end frames', async () => {
  const result = await atlas.generateVideo(provider, {
    model: 'kwaivgi/kling-v3.0-std/image-to-video',
    prompt: 'one continuous camera move',
    images: ['https://example.com/start.png', 'https://example.com/end.png'],
    duration: 8,
    resolution: '1080P',
  }, {
    fetchImpl: generationFetch((_url, body) => {
      assert.equal(body.model, 'kwaivgi/kling-v3.0-std/image-to-video');
      assert.equal(body.image, 'https://example.com/start.png');
      assert.equal(body.end_image, 'https://example.com/end.png');
      assert.equal(body.duration, 8);
      assert.equal(body.resolution, '1080P');
    }, 'https://example.com/kling-i2v.mp4'),
  });
  assert.equal(result.ok, true);
});

test('required image schemas fail before submitting without a reference', async () => {
  const seedream = await atlas.generateImage(provider, {
    model: 'bytedance/seedream-v5.0-pro/edit',
    prompt: 'edit this image',
  }, { fetchImpl: async () => { throw new Error('must not submit'); } });
  assert.equal(seedream.ok, false);
  assert.equal(seedream.code, 'invalid_model_parameters');
  assert.match(seedream.error, /至少需要一张参考图/);

  const kling = await atlas.generateVideo(provider, {
    model: 'kwaivgi/kling-v3.0-std/image-to-video',
    prompt: 'animate this image',
  }, { fetchImpl: async () => { throw new Error('must not submit'); } });
  assert.equal(kling.ok, false);
  assert.equal(kling.code, 'invalid_model_parameters');
  assert.match(kling.error, /需要一张首帧图/);
});

test('Atlas accepts code zero and a top-level upload url', async () => {
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  let uploadSeen = false;
  const result = await atlas.generateImage(provider, {
    model: 'bytedance/seedream-v5.0-pro/text-to-image',
    prompt: 'edit the uploaded pixel',
    images: [tinyPng],
  }, {
    fetchImpl: async (url, init = {}) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith('/model/uploadMedia')) {
        uploadSeen = true;
        assert.ok(init.body instanceof FormData);
        return jsonResponse({ code: 0, url: 'https://example.com/uploaded.png' });
      }
      if (requestUrl.includes('/model/prediction/')) {
        return jsonResponse({ code: 0, data: { status: 'completed', outputs: ['https://example.com/edited.png'] } });
      }
      const body = JSON.parse(init.body);
      assert.equal(body.model, 'bytedance/seedream-v5.0-pro/edit');
      assert.deepEqual(body.images, ['https://example.com/uploaded.png']);
      return jsonResponse({ code: 0, data: { id: 'prediction-zero', status: 'processing' } });
    },
  });
  assert.equal(uploadSeen, true);
  assert.equal(result.ok, true);
  assert.deepEqual(result.imageUrls, ['https://example.com/edited.png']);
});

'''
write(tests_path, tests.replace(marker, extra_tests + marker, 1))

print(f"Applied deterministic Atlas/canvas repair from baseline {BASELINE}")
