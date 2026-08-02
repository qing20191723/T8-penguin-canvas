import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const canvasSource = readFileSync(new URL('../src/components/Canvas.tsx', import.meta.url), 'utf8');
const runTriggerSource = readFileSync(new URL('../src/hooks/useRunTrigger.ts', import.meta.url), 'utf8');
const updateNodeDataSource = readFileSync(new URL('../src/components/nodes/useUpdateNodeData.ts', import.meta.url), 'utf8');

test('Canvas routes mutations through provenance-aware epochs and provides the dispatcher to nodes', () => {
  assert.match(canvasSource, /const setNodesWithProvenance = useCallback/);
  assert.match(canvasSource, /advanceMutationEpochs\(mutationEpochsRef\.current, provenance\)/);
  assert.match(canvasSource, /setNodesWithProvenance\(action, inputMutationProvenance\('Canvas\.setNodes'\)\)/);
  assert.match(canvasSource, /<CanvasMutationContext\.Provider value=\{canvasMutationDispatcher\}>/);
});

test('durable Attempt creation binds runtime writes and execution cleanup releases the binding', () => {
  const createAttemptAt = runTriggerSource.indexOf('attemptId = attempt.id');
  const registerAt = runTriggerSource.indexOf('registerRunMutationIdentity({');
  assert.ok(createAttemptAt >= 0 && registerAt > createAttemptAt, 'identity must be registered only after a durable Attempt exists');
  assert.match(runTriggerSource, /unregisterMutationIdentity\(\)/);
});

test('node updates fail closed to input unless an active Attempt classifies the patch as runtime', () => {
  assert.match(updateNodeDataSource, /const identity = getRunMutationIdentity\(nodeId\)/);
  assert.match(updateNodeDataSource, /identity && isRuntimeOnlyNodePatch\(patch\)/);
  assert.match(updateNodeDataSource, /: inputMutationProvenance\('useUpdateNodeData'\)/);
});

test('execution rechecks the fingerprint before each provider dispatch and clears only this Run ownership', () => {
  assert.match(canvasSource, /for \(let i = 0; i < order\.length; i\+\+\) \{[\s\S]*?isSameRunPreflightExecutionSnapshot\(persistenceSnapshot, captureExecutionSnapshot\(\)\)[\s\S]*?triggerRun\(/);
  assert.match(canvasSource, /if \(runId\) clearRunMutationOwnership\(runId\)/);
});
