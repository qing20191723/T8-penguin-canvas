import test from 'node:test';
import assert from 'node:assert/strict';

import {
  advanceMutationEpochs,
  compareRunInputSnapshots,
  createRunInputFingerprint,
  runtimeMutationProvenance,
  type MutationEpochs,
  type RunInputSnapshot,
} from '../src/utils/runInputMutation.ts';

const nodes = [
  { id: 'upstream', type: 'image', position: { x: 0, y: 0 }, data: { prompt: 'cat', imageUrls: ['/cat.png'], status: 'idle' } },
  { id: 'target', type: 'video', position: { x: 100, y: 0 }, data: { model: 'wan', providerParams: { size: '4K' }, progress: '0%' } },
  { id: 'unrelated', type: 'llm', position: { x: 500, y: 0 }, data: { prompt: 'ignore me' } },
];
const edges = [{ id: 'edge-1', source: 'upstream', target: 'target', sourceHandle: 'image', targetHandle: 'image' }];

function fingerprint(nextNodes = nodes, nextEdges = edges) {
  return createRunInputFingerprint({ nodes: nextNodes, edges: nextEdges, targetNodeIds: ['target'] });
}

test('mutation epochs default closed to input and explicit runtime requires full attempt identity', () => {
  const initial: MutationEpochs = { inputMutationEpoch: 4, runtimeMutationEpoch: 8 };
  assert.deepEqual(advanceMutationEpochs(initial), { inputMutationEpoch: 5, runtimeMutationEpoch: 8 });
  const runtime = runtimeMutationProvenance({
    runId: 'run-1', nodeId: 'target', attemptId: 'attempt-1', executionToken: 'token-1',
  });
  assert.deepEqual(advanceMutationEpochs(initial, runtime), { inputMutationEpoch: 4, runtimeMutationEpoch: 9 });
  assert.throws(
    () => runtimeMutationProvenance({ runId: 'run-1', nodeId: 'target', attemptId: '', executionToken: 'token-1' }),
    /attempt/i,
  );
});

test('fingerprint covers the target dependency slice but ignores unrelated and runtime-only fields', () => {
  const baseline = fingerprint();
  assert.equal(fingerprint(nodes.map((node) => node.id === 'unrelated' ? { ...node, data: { prompt: 'changed elsewhere' } } : node)), baseline);
  assert.equal(fingerprint(nodes.map((node) => node.id === 'target'
    ? { ...node, position: { x: 900, y: 500 }, selected: true, data: { ...node.data, status: 'running', progress: '80%', error: 'transient', logs: ['poll'] } }
    : node)), baseline);

  for (const changed of [
    nodes.map((node) => node.id === 'upstream' ? { ...node, data: { ...node.data, prompt: 'dog' } } : node),
    nodes.map((node) => node.id === 'upstream' ? { ...node, data: { ...node.data, imageUrls: ['/dog.png'] } } : node),
    nodes.map((node) => node.id === 'target' ? { ...node, data: { ...node.data, model: 'kling' } } : node),
    nodes.map((node) => node.id === 'target' ? { ...node, data: { ...node.data, providerParams: { size: '1080p' } } } : node),
    nodes.filter((node) => node.id !== 'upstream'),
  ]) assert.notEqual(fingerprint(changed), baseline);
  assert.notEqual(fingerprint(nodes, [{ ...edges[0], sourceHandle: 'video' }]), baseline);
});

test('snapshot comparison fast-passes runtime changes and authorizes unrelated input changes only by equal fingerprint', () => {
  const expected: RunInputSnapshot = {
    projectId: 'project-1', canvasId: 'canvas-1', revision: 7,
    inputMutationEpoch: 4, runtimeMutationEpoch: 8, fingerprint: fingerprint(),
  };
  assert.equal(compareRunInputSnapshots(expected, { ...expected, runtimeMutationEpoch: 20 }).sameInput, true);
  assert.equal(compareRunInputSnapshots(expected, { ...expected, revision: 8, inputMutationEpoch: 5 }).sameInput, true);
  const changed = compareRunInputSnapshots(expected, {
    ...expected,
    revision: 8,
    inputMutationEpoch: 5,
    fingerprint: fingerprint(nodes.map((node) => node.id === 'target' ? { ...node, data: { ...node.data, model: 'kling' } } : node)),
  });
  assert.deepEqual(changed, { sameInput: false, code: 'RUN_INPUT_CHANGED' });
  assert.equal(compareRunInputSnapshots(expected, { ...expected, canvasId: 'canvas-2' }).sameInput, false);
});
