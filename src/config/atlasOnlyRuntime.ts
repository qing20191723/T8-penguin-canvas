import type { NodeType } from '../types/canvas';

/**
 * This fork is intentionally an Atlas Cloud canvas. Legacy integrations remain
 * readable for old documents, but they are not selectable or allowed to start
 * background traffic in the public web runtime.
 */
export const ATLAS_ONLY_RUNTIME = typeof __T8_ATLAS_ONLY_RUNTIME__ === 'boolean'
  ? __T8_ATLAS_ONLY_RUNTIME__
  : String(import.meta.env?.VITE_T8_ATLAS_ONLY_RUNTIME || '') === '1';

/**
 * Windows/Electron profile. This is deliberately separate from the public
 * Render profile: it keeps local canvas and media tooling while removing
 * collaboration, agents and legacy cloud-provider surfaces.
 */
export const DESKTOP_ATLAS_RUNTIME = typeof __T8_DESKTOP_ATLAS_RUNTIME__ === 'boolean'
  ? __T8_DESKTOP_ATLAS_RUNTIME__
  : String(import.meta.env?.VITE_T8_DESKTOP_ATLAS_RUNTIME || '') === '1';

export const ATLAS_LIGHTWEIGHT_RUNTIME = ATLAS_ONLY_RUNTIME || DESKTOP_ATLAS_RUNTIME;

export const ATLAS_RUNTIME_CREDENTIAL_MARKER = '****server';

export const ATLAS_ONLY_HIDDEN_NODE_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
  'video',
  'runninghub',
  'runninghub-wallet',
  'rh-config',
  'rh-tools',
  'rh-toolbox',
  'rh-toolbox-maker',
  'vibex',
  'fal-toolbox',
  'fal-toolbox-maker',
  'grok-oauth-agent',
  'codex-cli-agent',
  'codex-image-conjure',
  'comfyui-store',
  'comfyui-app-maker',
  'feishu-bitable-input',
  'feishu-bitable-output',
  'topaz-image-upscale',
  'topaz-video-upscale',
  'aggregate-parser',
  'remove-ai-watermark',
]);

export const DESKTOP_ATLAS_HIDDEN_NODE_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
  'seedance',
  'feishu-bitable-input',
  'feishu-bitable-output',
  'runninghub',
  'runninghub-wallet',
  'rh-config',
  'rh-tools',
  'rh-toolbox',
  'rh-toolbox-maker',
  'vibex',
  'fal-toolbox',
  'fal-toolbox-maker',
  'grok-oauth-agent',
  'codex-cli-agent',
  'codex-image-conjure',
  'comfyui-store',
  'comfyui-app-maker',
  'topaz-image-upscale',
  'topaz-video-upscale',
  'remove-ai-watermark',
]);

export const RUNTIME_HIDDEN_NODE_TYPES: ReadonlySet<NodeType> = DESKTOP_ATLAS_RUNTIME
  ? DESKTOP_ATLAS_HIDDEN_NODE_TYPES
  : ATLAS_ONLY_HIDDEN_NODE_TYPES;

export const ATLAS_ONLY_BLOCKED_API_PREFIXES = [
  '/api/vibex-bridge',
  '/api/photoshop-bridge',
  '/api/grok-oauth',
  '/api/codex-cli',
  '/api/figma',
  '/api/eagle',
  '/api/feishu-bitable',
  '/api/parsehub',
  '/api/topaz',
  '/api/settings/rh-tools',
] as const;

export const DESKTOP_ATLAS_BLOCKED_API_PREFIXES = [
  '/api/agent-control',
  '/api/canvas-agent',
  '/api/creator-agent',
  '/api/collaboration',
  '/api/collab',
  '/api/proxy/runninghub',
  '/api/vibex-bridge',
  '/api/grok-oauth',
  '/api/codex-cli',
  '/api/figma',
  '/api/eagle',
  '/api/feishu-bitable',
  '/api/parsehub',
  '/api/topaz',
  '/api/ai-watermark',
  '/api/cloud-uploads',
  '/api/settings/rh-tools',
] as const;

export const RUNTIME_BLOCKED_API_PREFIXES: readonly string[] = DESKTOP_ATLAS_RUNTIME
  ? DESKTOP_ATLAS_BLOCKED_API_PREFIXES
  : ATLAS_ONLY_BLOCKED_API_PREFIXES;
