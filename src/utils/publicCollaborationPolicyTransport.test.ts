import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldBypassPublicCollaborationExecutionPolicy } from './publicCollaborationPolicyTransport';

const base = {
  requestUrl: 'https://qingchen-atlascloud-canvas.onrender.com/api/collaboration/execution-policy?projectId=project-local',
  method: 'GET',
  pagePathname: '/',
  pageOrigin: 'https://qingchen-atlascloud-canvas.onrender.com',
  projectId: 'project-local',
  excludeIntentId: null,
  hasManagementAuthority: false,
  desktopHost: false,
};

test('ordinary public project-local canvas run bypasses collaboration management policy', () => {
  assert.equal(shouldBypassPublicCollaborationExecutionPolicy(base), true);
});

test('remote collaboration and privileged management requests remain protected', () => {
  assert.equal(shouldBypassPublicCollaborationExecutionPolicy({ ...base, pagePathname: '/collab/room' }), false);
  assert.equal(shouldBypassPublicCollaborationExecutionPolicy({ ...base, excludeIntentId: 'intent-1' }), false);
  assert.equal(shouldBypassPublicCollaborationExecutionPolicy({ ...base, hasManagementAuthority: true }), false);
  assert.equal(shouldBypassPublicCollaborationExecutionPolicy({ ...base, desktopHost: true }), false);
});

test('unrelated, cross-origin and non-GET requests are never intercepted', () => {
  assert.equal(shouldBypassPublicCollaborationExecutionPolicy({
    ...base,
    requestUrl: 'https://qingchen-atlascloud-canvas.onrender.com/api/proxy/atlas/image',
  }), false);
  assert.equal(shouldBypassPublicCollaborationExecutionPolicy({
    ...base,
    requestUrl: 'https://example.com/api/collaboration/execution-policy?projectId=project-local',
  }), false);
  assert.equal(shouldBypassPublicCollaborationExecutionPolicy({ ...base, method: 'PUT' }), false);
  assert.equal(shouldBypassPublicCollaborationExecutionPolicy({ ...base, projectId: 'another-project' }), false);
});
