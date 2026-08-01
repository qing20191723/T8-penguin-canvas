from pathlib import Path

path = Path('src/components/Sidebar.tsx')
text = path.read_text(encoding='utf-8')
text = text.replace("import { useEffect, useMemo, useRef, useState } from 'react';", "import { useEffect, useMemo, useRef, useState } from 'react';", 1)
old = "  const canvasListInitializedRef = useRef(false);\n  const autoCreateStartedRef = useRef(false);\n"
new = "  const [canvasListInitialized, setCanvasListInitialized] = useState(false);\n  const autoCreateStartedRef = useRef(false);\n"
if text.count(old) != 1:
    raise RuntimeError(f'initialization declaration match count: {text.count(old)}')
text = text.replace(old, new, 1)
old = "      if (mounted) canvasListInitializedRef.current = true;\n"
new = "      if (mounted) setCanvasListInitialized(true);\n"
if text.count(old) != 1:
    raise RuntimeError(f'initialization completion match count: {text.count(old)}')
text = text.replace(old, new, 1)
old = "    if (!canvasListInitializedRef.current || canvasLoading || canvases.length > 0 || activeId || autoCreateStartedRef.current) return;\n"
new = "    if (!canvasListInitialized || canvasLoading || canvases.length > 0 || activeId || autoCreateStartedRef.current) return;\n"
if text.count(old) != 1:
    raise RuntimeError(f'initialization guard match count: {text.count(old)}')
text = text.replace(old, new, 1)
old = "  }, [activeId, canvasLoading, canvases.length, createCanvas]);\n"
new = "  }, [activeId, canvasListInitialized, canvasLoading, canvases.length, createCanvas]);\n"
if text.count(old) != 1:
    raise RuntimeError(f'initialization dependency match count: {text.count(old)}')
text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')
