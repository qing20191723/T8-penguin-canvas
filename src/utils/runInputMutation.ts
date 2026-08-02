export interface MutationEpochs {
  inputMutationEpoch: number;
  runtimeMutationEpoch: number;
}

export interface RuntimeMutationIdentity {
  runId: string;
  nodeId: string;
  attemptId: string;
  executionToken: string;
}

export type MutationProvenance =
  | { kind: 'input'; source?: string }
  | { kind: 'runtime'; identity: RuntimeMutationIdentity };

export interface RunInputSnapshot extends MutationEpochs {
  projectId: string;
  canvasId: string;
  revision: number;
  fingerprint: string;
}

export interface RuntimeOwnedValue {
  present: boolean;
  value?: unknown;
}

export type RuntimeOwnedFields = Record<string, Record<string, RuntimeOwnedValue>>;

const RUNTIME_ONLY_DATA_KEYS = new Set([
  'status', 'taskStatus', 'progress', 'error', 'runError', 'logs', 'log',
  'isRunning', 'isPolling', 'pollingTimer', 'lastRunAt', 'lastRunStatus', 'lastRunError',
  'createdAt', 'updatedAt', 'requestId', 'taskId', 'httpStatus', 'transportHttpStatus',
  'upstreamHttpStatus', 'usage', 'providerSubmission', 'pendingProviderAction',
]);
const RUNTIME_PATCH_DATA_KEYS = new Set([
  ...RUNTIME_ONLY_DATA_KEYS,
  'result', 'results', 'output', 'outputs',
  'imageUrl', 'imageUrls', 'videoUrl', 'videoUrls', 'audioUrl', 'audioUrls', 'modelUrl', 'modelUrls',
  'remoteImageUrls', 'remoteVideoUrls', 'remoteAudioUrls', 'generatedImages',
  'history', 'reply', 'consumedTexts', 'lastPrompt',
]);
const RUNTIME_OUTPUT_KEY = /(?:url|urls|result|results|output|outputs|reply|history|usage|trace|track|tracks|caption|captions|summary|metadata|lastPrompt|consumedTexts|generatedImages)$/i;
const HIGH_RISK_INPUT_PATCH_KEYS = new Set([
  'prompt', 'negativePrompt', 'model', 'apiModel', 'provider', 'providerId', 'providerModel', 'providerSource', 'providerParams',
  'duration', 'resolution', 'ratio', 'aspectRatio', 'size', 'sizeLevel', 'seed',
  'referenceImages', 'referenceVideos', 'referenceAudios',
  'localRefImages', 'localRefVideos', 'localRefAudios',
  'materialOrder', 'excludedMaterialIds',
]);

function requiredIdentityField(value: unknown, field: keyof RuntimeMutationIdentity) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`runtime mutation requires ${field}`);
  return text;
}

export function inputMutationProvenance(source = 'unspecified'): MutationProvenance {
  return { kind: 'input', source: String(source || 'unspecified') };
}

export function runtimeMutationProvenance(identity: RuntimeMutationIdentity): MutationProvenance {
  return {
    kind: 'runtime',
    identity: {
      runId: requiredIdentityField(identity?.runId, 'runId'),
      nodeId: requiredIdentityField(identity?.nodeId, 'nodeId'),
      attemptId: requiredIdentityField(identity?.attemptId, 'attemptId'),
      executionToken: requiredIdentityField(identity?.executionToken, 'executionToken'),
    },
  };
}

export function advanceMutationEpochs(
  current: MutationEpochs,
  provenance: MutationProvenance = inputMutationProvenance(),
): MutationEpochs {
  if (provenance.kind === 'runtime') {
    runtimeMutationProvenance(provenance.identity);
    return {
      inputMutationEpoch: current.inputMutationEpoch,
      runtimeMutationEpoch: current.runtimeMutationEpoch + 1,
    };
  }
  return {
    inputMutationEpoch: current.inputMutationEpoch + 1,
    runtimeMutationEpoch: current.runtimeMutationEpoch,
  };
}

function canonical(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (Array.isArray(value)) return value.map((entry) => canonical(entry, seen) ?? null);
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) throw new Error('Run input cannot contain cyclic values');
  seen.add(value);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const normalized = canonical((value as Record<string, unknown>)[key], seen);
    if (normalized !== undefined) out[key] = normalized;
  }
  seen.delete(value);
  return out;
}

function fingerprintNodeData(
  nodeId: string,
  value: unknown,
  runtimeOwnedFields: RuntimeOwnedFields | undefined,
) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const restored = { ...source };
  for (const [key, original] of Object.entries(runtimeOwnedFields?.[nodeId] || {})) {
    if (original.present) restored[key] = original.value;
    else delete restored[key];
  }
  for (const key of RUNTIME_ONLY_DATA_KEYS) delete restored[key];
  return canonical(restored);
}

export function createRunInputFingerprint(input: {
  nodes: Array<{ id: string; type?: unknown; data?: unknown }>;
  edges: Array<{ id?: string; source: string; target: string; sourceHandle?: unknown; targetHandle?: unknown }>;
  targetNodeIds: string[];
  runtimeOwnedFields?: RuntimeOwnedFields;
}) {
  const nodeById = new Map(input.nodes.map((node) => [String(node.id), node]));
  const incoming = new Map<string, typeof input.edges>();
  for (const edge of input.edges) {
    const target = String(edge.target || '');
    if (!target) continue;
    const list = incoming.get(target) || [];
    list.push(edge);
    incoming.set(target, list);
  }
  const slice = new Set(input.targetNodeIds.map(String).filter(Boolean));
  const queue = [...slice];
  while (queue.length > 0) {
    const target = queue.pop()!;
    for (const edge of incoming.get(target) || []) {
      const source = String(edge.source || '');
      if (!source || slice.has(source)) continue;
      slice.add(source);
      queue.push(source);
    }
  }
  const nodeDescriptors = [...slice].sort().map((id) => {
    const node = nodeById.get(id);
    return node
      ? { id, type: String(node.type || ''), data: fingerprintNodeData(id, node.data, input.runtimeOwnedFields) }
      : { id, missing: true };
  });
  const edgeDescriptors = input.edges
    .filter((edge) => slice.has(String(edge.source)) && slice.has(String(edge.target)))
    .map((edge) => ({
      id: String(edge.id || ''),
      source: String(edge.source),
      target: String(edge.target),
      sourceHandle: edge.sourceHandle == null ? null : String(edge.sourceHandle),
      targetHandle: edge.targetHandle == null ? null : String(edge.targetHandle),
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const serialized = JSON.stringify(canonical({
    schema: 't8-run-input-fingerprint-v1',
    targetNodeIds: [...new Set(input.targetNodeIds.map(String).filter(Boolean))].sort(),
    nodes: nodeDescriptors,
    edges: edgeDescriptors,
  }));
  return `sha256:${sha256Hex(new TextEncoder().encode(serialized))}`;
}

export function compareRunInputSnapshots(expected: RunInputSnapshot, current: RunInputSnapshot | null) {
  if (!current
    || current.projectId !== expected.projectId
    || current.canvasId !== expected.canvasId) {
    return { sameInput: false, code: 'RUN_INPUT_CHANGED' as const };
  }
  if (current.revision === expected.revision
    && current.inputMutationEpoch === expected.inputMutationEpoch) {
    return { sameInput: true, code: 'RUN_INPUT_UNCHANGED' as const };
  }
  if (current.fingerprint && current.fingerprint === expected.fingerprint) {
    return { sameInput: true, code: 'RUN_INPUT_EQUIVALENT' as const };
  }
  return { sameInput: false, code: 'RUN_INPUT_CHANGED' as const };
}

export function isRuntimeOnlyNodePatch(patch: Record<string, unknown>) {
  const keys = Object.keys(patch || {});
  if (keys.length === 0 || keys.some((key) => HIGH_RISK_INPUT_PATCH_KEYS.has(key))) return false;
  const hasRuntimeMarker = keys.some((key) => RUNTIME_ONLY_DATA_KEYS.has(key));
  if (!hasRuntimeMarker) return false;
  return keys.every((key) => RUNTIME_PATCH_DATA_KEYS.has(key) || RUNTIME_OUTPUT_KEY.test(key));
}
import { sha256Hex } from './incrementalSha256';
