from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)

app_path = Path('src/App.tsx')
app = app_path.read_text(encoding='utf-8')

app = replace_once(
    app,
    "  const pendingSidebarNodeRef = useRef<{ type: NodeType; options?: Parameters<AddNodeFn>[1] } | null>(null);\n",
    "",
    'remove stale pending node ref',
)

old_block = '''  const handleAddNode = useCallback(async (type: NodeType) => {
    const options = buildSidebarNodeOptions(type);
    if (activeCanvasId) {
      addNodeRef.current?.(type, options);
      return;
    }

    pendingSidebarNodeRef.current = { type, options };
    const created = await createCanvas(`画布 ${canvasCount + 1}`);
    if (!created) pendingSidebarNodeRef.current = null;
  }, [activeCanvasId, buildSidebarNodeOptions, canvasCount, createCanvas]);

  useEffect(() => {
    if (!activeCanvasId || !pendingSidebarNodeRef.current) return;
    const pending = pendingSidebarNodeRef.current;
    pendingSidebarNodeRef.current = null;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        addNodeRef.current?.(pending.type, pending.options);
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [activeCanvasId]);
'''
new_block = '''  const waitForAddNodeHandler = useCallback(async (timeoutMs = 10000): Promise<AddNodeFn | null> => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (addNodeRef.current) return addNodeRef.current;
      await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
    }
    return null;
  }, []);

  const handleAddNode = useCallback(async (type: NodeType) => {
    const options = buildSidebarNodeOptions(type);
    let canvasId = activeCanvasId;

    if (!canvasId) {
      const created = await createCanvas(`画布 ${canvasCount + 1}`);
      if (!created) {
        const message = useCanvasStore.getState().error || '创建画布失败，请刷新页面后重试。';
        console.error('[canvas] sidebar node click could not create a canvas:', message);
        window.alert(message);
        return;
      }
      canvasId = created.id;
    }

    const addNode = await waitForAddNodeHandler();
    if (!addNode) {
      const message = `画布 ${canvasId} 尚未完成加载，请稍后再试。`;
      console.error('[canvas] sidebar node click timed out waiting for Canvas handler:', { type, canvasId });
      window.alert(message);
      return;
    }

    try {
      addNode(type, options);
    } catch (error) {
      console.error('[canvas] sidebar node insertion failed:', { type, canvasId, error });
      window.alert(error instanceof Error ? error.message : '节点添加失败，请稍后重试。');
    }
  }, [activeCanvasId, buildSidebarNodeOptions, canvasCount, createCanvas, waitForAddNodeHandler]);
'''
app = replace_once(app, old_block, new_block, 'replace sidebar node insertion flow')
app_path.write_text(app, encoding='utf-8')

sidebar_path = Path('src/components/Sidebar.tsx')
sidebar = sidebar_path.read_text(encoding='utf-8')
sidebar = replace_once(
    sidebar,
    "import { useEffect, useMemo, useState } from 'react';",
    "import { useEffect, useMemo, useRef, useState } from 'react';",
    'add Sidebar useRef import',
)
sidebar = replace_once(
    sidebar,
    "  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);\n",
    "  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);\n  const canvasListInitializedRef = useRef(false);\n  const autoCreateStartedRef = useRef(false);\n",
    'add canvas initialization refs',
)
old_load = '''  useEffect(() => {
    loadCanvases();
  }, [loadCanvases]);
'''
new_load = '''  useEffect(() => {
    let mounted = true;
    void loadCanvases().finally(() => {
      if (mounted) canvasListInitializedRef.current = true;
    });
    return () => {
      mounted = false;
    };
  }, [loadCanvases]);

  useEffect(() => {
    if (!canvasListInitializedRef.current || canvasLoading || canvases.length > 0 || activeId || autoCreateStartedRef.current) return;
    autoCreateStartedRef.current = true;
    void createCanvas('画布 1').then((created) => {
      if (!created) autoCreateStartedRef.current = false;
    });
  }, [activeId, canvasLoading, canvases.length, createCanvas]);
'''
sidebar = replace_once(sidebar, old_load, new_load, 'auto-create first canvas after list initialization')
sidebar = replace_once(
    sidebar,
    "      <button\n        key={n.type}\n        onClick={() => onAddNode(n.type)}",
    "      <button\n        type=\"button\"\n        key={n.type}\n        onClick={() => void onAddNode(n.type)}",
    'make sidebar node button explicit and async-safe',
)
sidebar_path.write_text(sidebar, encoding='utf-8')

registry_path = Path('src/config/nodeRegistry.ts')
registry = registry_path.read_text(encoding='utf-8')
registry = replace_once(
    registry,
    "  rh: { label: 'RH', nodes: NODE_REGISTRY.filter((n) => n.category === 'rh' && !n.hidden) },\n",
    "",
    'remove RH sidebar group',
)
registry_path.write_text(registry, encoding='utf-8')

# Static assertions against accidental regressions.
assert 'pendingSidebarNodeRef' not in app
assert 'waitForAddNodeHandler' in app
assert "createCanvas('画布 1')" in sidebar
assert "rh: { label: 'RH'" not in registry
