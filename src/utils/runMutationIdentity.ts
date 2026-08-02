import type { RuntimeMutationIdentity, RuntimeOwnedFields } from './runInputMutation';

interface RuntimeOwnershipEntry {
  identity: RuntimeMutationIdentity;
  fields: Record<string, { present: boolean; value?: unknown }>;
}

const activeIdentities = new Map<string, RuntimeMutationIdentity>();
const runtimeOwnership = new Map<string, RuntimeOwnershipEntry>();

function sameIdentity(left: RuntimeMutationIdentity | null | undefined, right: RuntimeMutationIdentity | null | undefined) {
  return Boolean(left && right
    && left.runId === right.runId
    && left.nodeId === right.nodeId
    && left.attemptId === right.attemptId
    && left.executionToken === right.executionToken);
}

export function registerRunMutationIdentity(identity: RuntimeMutationIdentity) {
  const frozen = Object.freeze({ ...identity });
  activeIdentities.set(identity.nodeId, frozen);
  runtimeOwnership.delete(identity.nodeId);
  return () => {
    if (!sameIdentity(activeIdentities.get(identity.nodeId), frozen)) return;
    activeIdentities.delete(identity.nodeId);
  };
}

export function getRunMutationIdentity(nodeId: string) {
  return activeIdentities.get(nodeId) || null;
}

export function isActiveRunMutationIdentity(identity: RuntimeMutationIdentity) {
  return sameIdentity(activeIdentities.get(identity.nodeId), identity);
}

export function recordRuntimeOwnedPatch(
  identity: RuntimeMutationIdentity,
  previousData: Record<string, unknown>,
  patch: Record<string, unknown>,
) {
  if (!isActiveRunMutationIdentity(identity)) return false;
  let entry = runtimeOwnership.get(identity.nodeId);
  if (!entry || !sameIdentity(entry.identity, identity)) {
    entry = { identity: { ...identity }, fields: {} };
    runtimeOwnership.set(identity.nodeId, entry);
  }
  for (const key of Object.keys(patch)) {
    if (Object.prototype.hasOwnProperty.call(entry.fields, key)) continue;
    entry.fields[key] = Object.prototype.hasOwnProperty.call(previousData, key)
      ? { present: true, value: previousData[key] }
      : { present: false };
  }
  return true;
}

export function clearRuntimeOwnedInputFields(nodeId: string, keys: string[]) {
  const entry = runtimeOwnership.get(nodeId);
  if (!entry) return;
  for (const key of keys) delete entry.fields[key];
  if (Object.keys(entry.fields).length === 0) runtimeOwnership.delete(nodeId);
}

export function captureRuntimeOwnedFields(): RuntimeOwnedFields {
  return Object.fromEntries([...runtimeOwnership.entries()].map(([nodeId, entry]) => [
    nodeId,
    Object.fromEntries(Object.entries(entry.fields).map(([key, value]) => [key, { ...value }])),
  ]));
}

export function clearRunMutationOwnership(runId: string) {
  for (const [nodeId, entry] of runtimeOwnership) {
    if (entry.identity.runId === runId) runtimeOwnership.delete(nodeId);
  }
}

export function resetRunMutationIdentityForTests() {
  activeIdentities.clear();
  runtimeOwnership.clear();
}
