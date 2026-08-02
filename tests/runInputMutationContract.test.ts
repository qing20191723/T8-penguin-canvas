import test from 'node:test';
import assert from 'node:assert/strict';

import {
  advanceMutationEpochs,
  compareRunInputSnapshots,
  createRunInputFingerprint,
  isRuntimeOnlyNodePatch,
  runtimeMutationProvenance,
  type MutationEpochs,
  type RunInputSnapshot,
} from '../src/utils/runInputMutation.ts';
import {
  captureRuntimeOwnedFields,
  clearRunMutationOwnership,
  clearRuntimeOwnedInputFields,
  recordRuntimeOwnedPatch,
  registerRunMutationIdentity,
  resetRunMutationIdentityForTests,
} from '../src/utils/runMutationIdentity.ts';

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
  assert.equal(isRuntimeOnlyNodePatch({ status: 'success', videoUrl: '/out.mp4', lastPrompt: 'frozen' }), true);
  assert.equal(isRuntimeOnlyNodePatch({ prompt: 'user edit' }), false);
  assert.equal(isRuntimeOnlyNodePatch({ status: 'idle', model: 'changed-by-user' }), false);
});

test('runtime classification fails closed when a status patch also changes execution input', () => {
  assert.equal(isRuntimeOnlyNodePatch({ status: 'running', progress: 20 }), true);
  assert.equal(isRuntimeOnlyNodePatch({ status: 'running', prompt: 'new prompt' }), false);
  assert.equal(isRuntimeOnlyNodePatch({ taskStatus: 'running', providerModel: 'other-model' }), false);
  assert.equal(isRuntimeOnlyNodePatch({ status: 'running', unknownConfiguration: true }), false);
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

test('runtime ownership is attempt isolated and input writes revoke field exemptions', () => {
  resetRunMutationIdentityForTests();
  const first = { runId: 'run-1', nodeId: 'target', attemptId: 'attempt-1', executionToken: 'token-1' };
  const releaseFirst = registerRunMutationIdentity(first);
  assert.equal(recordRuntimeOwnedPatch(first, { videoUrl: '/old.mp4' }, { videoUrl: '/new.mp4', status: 'success' }), true);
  assert.deepEqual(captureRuntimeOwnedFields().target.videoUrl, { present: true, value: '/old.mp4' });

  const second = { ...first, attemptId: 'attempt-2', executionToken: 'token-2' };
  const releaseSecond = registerRunMutationIdentity(second);
  assert.equal(recordRuntimeOwnedPatch(first, { videoUrl: '/new.mp4' }, { videoUrl: '/late.mp4' }), false);
  assert.equal(recordRuntimeOwnedPatch(second, { videoUrl: '/new.mp4' }, { videoUrl: '/second.mp4' }), true);
  releaseFirst();
  assert.deepEqual(captureRuntimeOwnedFields().target.videoUrl, { present: true, value: '/new.mp4' });
  const beforeOutput = nodes.map((node) => node.id === 'target'
    ? { ...node, data: { ...node.data, videoUrl: '/new.mp4' } }
    : node);
  const afterOutput = beforeOutput.map((node) => node.id === 'target'
    ? { ...node, data: { ...node.data, videoUrl: '/second.mp4', status: 'success' } }
    : node);
  assert.equal(
    createRunInputFingerprint({ nodes: beforeOutput, edges, targetNodeIds: ['target'] }),
    createRunInputFingerprint({
      nodes: afterOutput,
      edges,
      targetNodeIds: ['target'],
      runtimeOwnedFields: captureRuntimeOwnedFields(),
    }),
  );
  clearRuntimeOwnedInputFields('target', ['videoUrl']);
  assert.equal(captureRuntimeOwnedFields().target, undefined);
  assert.notEqual(fingerprint(beforeOutput), fingerprint(afterOutput));
  releaseSecond();
  const nodeA = { runId: 'run-a', nodeId: 'node-a', attemptId: 'attempt-a', executionToken: 'token-a' };
  const nodeB = { runId: 'run-b', nodeId: 'node-b', attemptId: 'attempt-b', executionToken: 'token-b' };
  registerRunMutationIdentity(nodeA);
  registerRunMutationIdentity(nodeB);
  recordRuntimeOwnedPatch(nodeA, {}, { output: 'a' });
  recordRuntimeOwnedPatch(nodeB, {}, { output: 'b' });
  clearRunMutationOwnership('run-a');
  assert.equal(captureRuntimeOwnedFields()['node-a'], undefined);
  assert.deepEqual(captureRuntimeOwnedFields()['node-b'].output, { present: false });
  resetRunMutationIdentityForTests();
});

test('runtime-only originals stay excluded after ownership restoration', () => {
  const runtimeNodes = nodes.map((node) => node.id === 'target'
    ? { ...node, data: { ...node.data, status: 'idle' } }
    : node);
  const baseline = fingerprint(runtimeNodes);
  const runtimeFingerprint = createRunInputFingerprint({
    nodes: runtimeNodes.map((node) => node.id === 'target'
      ? { ...node, data: { ...node.data, status: 'running' } }
      : node),
    edges,
    targetNodeIds: ['target'],
    runtimeOwnedFields: { target: { status: { present: true, value: 'idle' } } },
  });
  assert.equal(runtimeFingerprint, baseline);
});
