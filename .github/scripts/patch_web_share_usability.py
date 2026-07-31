from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


# App: auto-create the first canvas, prefer Atlas for generic image/video nodes,
# hide upstream promotional links, and apply the Qingchen visible brand.
app_path = "src/App.tsx"
app = read(app_path)
app = replace_once(
    app,
    "import { useApiKeysStore } from './stores/apiKeys';\n",
    "import { useApiKeysStore } from './stores/apiKeys';\nimport { useCanvasStore } from './stores/canvas';\n",
    "App canvas-store import",
)
app = replace_once(
    app,
    "  const { load: loadSettings } = useApiKeysStore();\n",
    "  const { load: loadSettings, settings: apiSettings } = useApiKeysStore();\n"
    "  const activeCanvasId = useCanvasStore((state) => state.activeId);\n"
    "  const canvasCount = useCanvasStore((state) => state.canvases.length);\n"
    "  const createCanvas = useCanvasStore((state) => state.createCanvas);\n",
    "App store selectors",
)
app = replace_once(
    app,
    "  const addNodeRef = useRef<AddNodeFn | null>(null);\n",
    "  const addNodeRef = useRef<AddNodeFn | null>(null);\n"
    "  const pendingSidebarNodeRef = useRef<{ type: NodeType; options?: Parameters<AddNodeFn>[1] } | null>(null);\n",
    "App pending node ref",
)
app = replace_once(
    app,
    "  const handleAddNode = (type: NodeType) => {\n"
    "    addNodeRef.current?.(type);\n"
    "  };\n",
    "  const atlasProvider = useMemo(\n"
    "    () => (apiSettings.advancedProviders || []).find(\n"
    "      (provider) => provider.enabled && provider.protocol === 'atlas',\n"
    "    ) || null,\n"
    "    [apiSettings.advancedProviders],\n"
    "  );\n\n"
    "  const buildSidebarNodeOptions = useCallback((type: NodeType): Parameters<AddNodeFn>[1] | undefined => {\n"
    "    if (!atlasProvider || (type !== 'image' && type !== 'video')) return undefined;\n"
    "    const models = type === 'image' ? atlasProvider.imageModels : atlasProvider.videoModels;\n"
    "    const defaultModel = type === 'image'\n"
    "      ? atlasProvider.defaults?.imageModel\n"
    "      : atlasProvider.defaults?.videoModel;\n"
    "    const providerModel = String(defaultModel || models?.[0] || '').trim();\n"
    "    return {\n"
    "      data: {\n"
    "        providerSource: 'atlas',\n"
    "        providerId: atlasProvider.id,\n"
    "        providerModel,\n"
    "      },\n"
    "    };\n"
    "  }, [atlasProvider]);\n\n"
    "  const handleAddNode = useCallback(async (type: NodeType) => {\n"
    "    const options = buildSidebarNodeOptions(type);\n"
    "    if (activeCanvasId) {\n"
    "      addNodeRef.current?.(type, options);\n"
    "      return;\n"
    "    }\n\n"
    "    pendingSidebarNodeRef.current = { type, options };\n"
    "    const created = await createCanvas(`画布 ${canvasCount + 1}`);\n"
    "    if (!created) pendingSidebarNodeRef.current = null;\n"
    "  }, [activeCanvasId, buildSidebarNodeOptions, canvasCount, createCanvas]);\n\n"
    "  useEffect(() => {\n"
    "    if (!activeCanvasId || !pendingSidebarNodeRef.current) return;\n"
    "    const pending = pendingSidebarNodeRef.current;\n"
    "    pendingSidebarNodeRef.current = null;\n"
    "    let secondFrame = 0;\n"
    "    const firstFrame = window.requestAnimationFrame(() => {\n"
    "      secondFrame = window.requestAnimationFrame(() => {\n"
    "        addNodeRef.current?.(pending.type, pending.options);\n"
    "      });\n"
    "    });\n"
    "    return () => {\n"
    "      window.cancelAnimationFrame(firstFrame);\n"
    "      if (secondFrame) window.cancelAnimationFrame(secondFrame);\n"
    "    };\n"
    "  }, [activeCanvasId]);\n",
    "App add-node behavior",
)

for ref_name in [
    "cloudWrapRef",
    "videoWrapRef",
    "zhaotutuWrapRef",
    "apiAcquisitionWrapRef",
    "canvasTutorialWrapRef",
    "zhenWrapRef",
    "appWrapRef",
    "aixWrapRef",
]:
    app = replace_once(
        app,
        f'<div ref={{{ref_name}}} className="relative">',
        f'<div ref={{{ref_name}}} className="relative hidden" aria-hidden="true">',
        f"hide promotion {ref_name}",
    )

app = app.replace("贞贞的无限画布", "清尘无限画布")
app = app.replace("企鹅共创版", "Atlas Cloud")
app = app.replace("T8公司AIX产品", "清尘 AI 产品")
app = app.replace("T8 教程合集", "清尘教程合集")
app = app.replace("T8 系列", "清尘系列")
app = app.replace("T8老师", "清尘")
write(app_path, app)

# Sidebar visible branding and clearer click affordance.
sidebar_path = "src/components/Sidebar.tsx"
sidebar = read(sidebar_path)
sidebar = replace_once(
    sidebar,
    "        onClick={() => onAddNode(n.type)}\n        title={n.description}\n",
    "        onClick={() => onAddNode(n.type)}\n        title={`${n.description}（单击添加到当前画布）`}\n",
    "Sidebar node click title",
)
sidebar = sidebar.replace("T8 · v{__APP_VERSION__}", "清尘 · v{__APP_VERSION__}")
sidebar = sidebar.replace("T8-penguin-canvas · v{__APP_VERSION__}", "清尘无限画布 · v{__APP_VERSION__}")
write(sidebar_path, sidebar)

# Empty canvas branding.
canvas_path = "src/components/Canvas.tsx"
canvas = read(canvas_path)
canvas = canvas.replace("🐧 贞贞的无限画布（企鹅共创版）", "清尘无限画布（Atlas Cloud）")
canvas = canvas.replace("贞贞的无限画布", "清尘无限画布")
canvas = canvas.replace("企鹅共创版", "Atlas Cloud")
write(canvas_path, canvas)

# Browser title.
index_path = "index.html"
index_html = read(index_path)
index_html = replace_once(
    index_html,
    "<title>贞贞的无限画布（企鹅共创版）</title>",
    "<title>清尘无限画布 · Atlas Cloud</title>",
    "index title",
)
write(index_path, index_html)

# Render startup diagnostics visible to visitors.
render_path = "backend/src/renderServer.js"
render_server = read(render_path)
render_server = render_server.replace("T8 无限画布正在启动", "清尘无限画布正在启动")
render_server = render_server.replace("T8 后端启动失败", "清尘画布后端启动失败")
render_server = render_server.replace("T8 完整后端正在启动，请稍候重试。", "清尘画布后端正在启动，请稍候重试。")
render_server = render_server.replace("完整 T8 后端", "完整清尘画布后端")
write(render_path, render_server)

# Source-level regression assertions.
assert "providerSource: 'atlas'" in app
assert "pendingSidebarNodeRef" in app
assert "清尘无限画布" in app
assert "贞贞的无限画布" not in app
for ref_name in [
    "cloudWrapRef",
    "videoWrapRef",
    "zhaotutuWrapRef",
    "apiAcquisitionWrapRef",
    "canvasTutorialWrapRef",
    "zhenWrapRef",
    "appWrapRef",
    "aixWrapRef",
]:
    assert f'ref={{{ref_name}}} className="relative hidden"' in app
assert "清尘 · v{__APP_VERSION__}" in sidebar
assert "清尘无限画布（Atlas Cloud）" in canvas
assert "<title>清尘无限画布 · Atlas Cloud</title>" in index_html
print("web share usability and branding patch applied")
