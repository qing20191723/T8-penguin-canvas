import type { NodeType } from '../types/canvas';

/**
 * This fork is intentionally an Atlas Cloud canvas. Legacy integrations remain
 * readable for old documents, but they are not selectable or allowed to start
 * background traffic in the public web runtime.
 */
export const ATLAS_ONLY_RUNTIME = true;

export const ATLAS_RUNTIME_CREDENTIAL_MARKER = '****server';

export const ATLAS_ONLY_HIDDEN_NODE_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
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
