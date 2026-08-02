import schemaManifest from '../../backend/src/shared/canvasNodeSchema.json' with { type: 'json' };
import type { NodeMeta } from '../types/canvas';
import { ATLAS_ONLY_HIDDEN_NODE_TYPES, ATLAS_ONLY_RUNTIME } from './atlasOnlyRuntime';

interface CanvasNodeSchemaManifest {
  schema: 't8-canvas-node-schema-v1';
  version: 1;
  connectionPorts: Record<string, {
    resolver: 'static' | 'upload' | 'material-set' | 'loop' | 'pick-from-set' | 'random-route' | 'subflow' | 'toolbox-param';
    inputs: Array<{ id: string | null; kinds: string[]; required: boolean; minConnections: number; maxConnections: number | null; preferred?: boolean }>;
    outputs: Array<{ id: string | null; kinds: string[]; required: boolean; minConnections: number; maxConnections: number | null; preferred?: boolean }>;
  }>;
  types: Array<NodeMeta & {
    ports: { inputs: string[]; outputs: string[] };
    executable: boolean;
    generatable: boolean;
    generation: {
      allowedDataFields: Record<string, Record<string, unknown>>;
      defaults: Record<string, unknown>;
      connectionPorts?: {
        dynamic: boolean;
        inputs: Array<{ id: string | null; kinds: string[]; required: boolean; minConnections: number; maxConnections: number | null; preferred?: boolean }>;
        outputs: Array<{ id: string | null; kinds: string[]; required: boolean; minConnections: number; maxConnections: number | null; preferred?: boolean }>;
      };
    };
  }>;
}

export const CANVAS_NODE_SCHEMA_MANIFEST = schemaManifest as unknown as CanvasNodeSchemaManifest;

const DEV_NODE_REGISTRY: NodeMeta[] = import.meta.env?.DEV && !ATLAS_ONLY_RUNTIME ? [
  { type: 'rh-toolbox-maker', label: 'RH工具箱制作器', category: 'rh', description: '维护者专用：在画布内制作 RH工具箱 manifest 模板，开发环境可见，用户包不打入', icon: 'FileJson', color: 'emerald' },
  { type: 'fal-toolbox-maker', label: 'FAL应用制作工具', category: 'fal', description: '维护者专用：从 fal.ai API 文档生成 Fal超市 manifest 草稿，开发环境可见，用户包不打入', icon: 'FileJson', color: 'violet' },
] : [];

const nodeDisplayOverride = (item: CanvasNodeSchemaManifest['types'][number]): Pick<NodeMeta, 'label' | 'description'> => {
  if (item.type === 'seedance') {
    return {
      label: '视频',
      description: 'Atlas Cloud 视频生成：Wan 2.7、Seedance、Kling、Grok、Veo 等模型',
    };
  }
  return {
    label: item.label,
    description: item.description,
  };
};

const manifestRegistry: NodeMeta[] = CANVAS_NODE_SCHEMA_MANIFEST.types.map((item) => ({
  type: item.type,
  ...nodeDisplayOverride(item),
  category: item.category,
  icon: item.icon,
  color: item.color,
  ...(item.hidden === true || (ATLAS_ONLY_RUNTIME && ATLAS_ONLY_HIDDEN_NODE_TYPES.has(item.type))
    ? { hidden: true }
    : {}),
}));
const devInsertionIndex = manifestRegistry.findIndex((item) => item.type === 'vibex') + 1;

/**
 * Production metadata still registers hidden legacy node types so old canvas
 * documents can render. Atlas-only mode removes them from every user-addable
 * palette and port candidate list.
 */
export const NODE_REGISTRY: NodeMeta[] = [
  ...manifestRegistry.slice(0, devInsertionIndex),
  ...DEV_NODE_REGISTRY,
  ...manifestRegistry.slice(devInsertionIndex),
];

const visibleByCategory = (category: NodeMeta['category']) => (
  NODE_REGISTRY.filter((node) => node.category === category && !node.hidden)
);

export const NODE_GROUPS: Record<string, { label: string; nodes: NodeMeta[] }> = {
  input: { label: '素材资源', nodes: visibleByCategory('input') },
  core: { label: '核心节点', nodes: visibleByCategory('core') },
  fal: { label: 'FAL工具箱', nodes: visibleByCategory('fal') },
  grok: { label: 'GROK OAuth', nodes: visibleByCategory('grok') },
  codex: { label: 'CODEX CLI', nodes: visibleByCategory('codex') },
  inspiration: { label: '灵感之源', nodes: visibleByCategory('inspiration') },
  comfyui: { label: 'ComfyUI', nodes: visibleByCategory('comfyui') },
  special: { label: '特殊节点', nodes: visibleByCategory('special') },
  utility: { label: '工具节点', nodes: visibleByCategory('utility') },
  auxiliary: { label: '辅助节点', nodes: visibleByCategory('auxiliary') },
  toolbox: { label: '工具箱', nodes: visibleByCategory('toolbox') },
  '3d': { label: '3D', nodes: visibleByCategory('3d') },
};

export function getNodeMeta(type: string): NodeMeta | undefined {
  return NODE_REGISTRY.find((node) => node.type === type);
}
