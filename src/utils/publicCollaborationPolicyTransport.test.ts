import assert from 'node:assert/strict';
import test from 'node:test';
import {
  atlasOnlyBlockedApiPath,
  isAtlasExecutionRequest,
  shouldBypassPublicCollaborationExecutionPolicy,
} from './publicCollaborationPolicyTransport';

const origin = 'https://qingchen-atlascloud-canvas.onrender.com';
const base = {
  requestUrl: `${origin}/api/collaboration/execution-policy?projectId=project-local`,
  method: 'GET',
  pagePathname: '/',
  pageOrigin: origin,
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

test('unrelated, cross-origin and non-GET collaboration requests are never intercepted', () => {
  assert.equal(shouldBypassPublicCollaborationExecutionPolicy({
    ...base,
    requestUrl: `${origin}/api/proxy/atlas/image`,
  }), false);
  assert.equal(shouldBypassPublicCollaborationExecutionPolicy({
    ...base,
    requestUrl: 'https://example.com/api/collaboration/execution-policy?projectId=project-local',
  }), false);
  assert.equal(shouldBypassPublicCollaborationExecutionPolicy({ ...base, method: 'PUT' }), false);
  assert.equal(shouldBypassPublicCollaborationExecutionPolicy({ ...base, projectId: 'another-project' }), false);
});

test('legacy external application bridge traffic is blocked in public web runtime', () => {
  for (const pathname of [
    '/api/vibex-bridge/pending?limit=12',
    '/api/photoshop-bridge/pending?limit=12',
    '/api/grok-oauth/status',
    '/api/codex-cli/status',
    '/api/settings/rh-tools/export',
  ]) {
    assert.ok(atlasOnlyBlockedApiPath({
      requestUrl: `${origin}${pathname}`,
      pageOrigin: origin,
      desktopHost: false,
    }));
  }
});

test('Atlas provider gateway, custom provider gateway and Electron remain available', () => {
  for (const pathname of [
    '/api/proxy/atlas/models',
    '/api/proxy/atlas/image',
    '/api/proxy/external/image',
    '/api/proxy/external/video',
  ]) {
    assert.equal(atlasOnlyBlockedApiPath({
      requestUrl: `${origin}${pathname}`,
      pageOrigin: origin,
      desktopHost: false,
    }), null);
  }
  assert.equal(atlasOnlyBlockedApiPath({
    requestUrl: `${origin}/api/vibex-bridge/pending`,
    pageOrigin: origin,
    desktopHost: true,
  }), null);
});

test('only same-origin POST generation requests require the Render readiness guard', () => {
  for (const pathname of [
    '/api/proxy/external/image',
    '/api/proxy/external/video',
    '/api/proxy/external/chat',
    '/api/proxy/atlas/image',
    '/api/proxy/atlas/video',
    '/api/proxy/image',
  ]) {
    assert.equal(isAtlasExecutionRequest(`${origin}${pathname}`, 'POST', origin, false), true);
  }
  assert.equal(isAtlasExecutionRequest(`${origin}/api/proxy/atlas/models`, 'GET', origin, false), false);
  assert.equal(isAtlasExecutionRequest(`${origin}/api/proxy/external/image`, 'GET', origin, false), false);
  assert.equal(isAtlasExecutionRequest('https://example.com/api/proxy/external/image', 'POST', origin, false), false);
  assert.equal(isAtlasExecutionRequest(`${origin}/api/proxy/external/image`, 'POST', origin, true), false);
});
