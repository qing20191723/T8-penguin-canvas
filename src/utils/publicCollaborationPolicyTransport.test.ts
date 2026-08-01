import assert from 'node:assert/strict';
import test from 'node:test';
import {
  atlasOnlyBlockedApiPath,
  canvasMutationId,
  canvasSnapshotDigest,
  equivalentCanvasSnapshot,
  isAtlasExecutionRequest,
  isExactCanvasSnapshotRunError,
  isProjectRunCreateRequest,
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

test('only the exact public canvas PUT route is treated as a canvas snapshot mutation', () => {
  assert.equal(canvasMutationId(`${origin}/api/canvas/canvas-123?allowEmpty=1`, 'PUT', origin), 'canvas-123');
  assert.equal(canvasMutationId(`${origin}/api/canvas/canvas%20name`, 'PUT', origin), 'canvas name');
  assert.equal(canvasMutationId(`${origin}/api/canvas/canvas-123/operations`, 'POST', origin), null);
  assert.equal(canvasMutationId(`${origin}/api/canvas/canvas-123`, 'GET', origin), null);
  assert.equal(canvasMutationId('https://example.com/api/canvas/canvas-123', 'PUT', origin), null);
  assert.equal(canvasMutationId(`${origin}/api/canvas/canvas-123`, 'PUT', origin, true), null);
});

test('project run recovery is scoped to same-origin POST /api/project-runs', () => {
  assert.equal(isProjectRunCreateRequest(`${origin}/api/project-runs`, 'POST', origin), true);
  assert.equal(isProjectRunCreateRequest(`${origin}/api/project-runs/run-1`, 'POST', origin), false);
  assert.equal(isProjectRunCreateRequest(`${origin}/api/project-runs`, 'GET', origin), false);
  assert.equal(isProjectRunCreateRequest('https://example.com/api/project-runs', 'POST', origin), false);
  assert.equal(isProjectRunCreateRequest(`${origin}/api/project-runs`, 'POST', origin, true), false);
});

test('canvas snapshot digest ignores revision metadata but includes the execution document', () => {
  const candidate = {
    baseRevision: 12,
    nodes: [{ id: 'image-1', data: { status: 'success', resultUrl: '/files/output/a.jpg' } }],
    edges: [],
    viewport: { x: 10, y: 20, zoom: 1 },
    nextNodeSerialId: 2,
    creativeDesk: { items: [] },
    farmCanvas: { day: 1 },
  };
  const authoritative = {
    success: true,
    data: {
      schema: 't8-canvas-document',
      revision: 13,
      updatedAt: Date.now(),
      farmCanvas: { day: 1 },
      nodes: [{ data: { resultUrl: '/files/output/a.jpg', status: 'success' }, id: 'image-1' }],
      nextNodeSerialId: 2,
      viewport: { zoom: 1, y: 20, x: 10 },
      creativeDesk: { items: [] },
      edges: [],
    },
  };
  assert.ok(canvasSnapshotDigest(candidate));
  assert.equal(equivalentCanvasSnapshot(authoritative, candidate), true);
  assert.equal(equivalentCanvasSnapshot(authoritative, {
    ...candidate,
    nodes: [{ id: 'image-1', data: { status: 'success', resultUrl: '/files/output/b.jpg' } }],
  }), false);
});

test('only exact snapshot ownership errors are eligible for verified run retry', () => {
  assert.equal(isExactCanvasSnapshotRunError({
    code: 'run_canvas_revision_invalid',
    error: '新的持久 owner 必须绑定可验证的精确画布快照',
  }), true);
  assert.equal(isExactCanvasSnapshotRunError({ error: 'persistent owner requires an exact canvas snapshot' }), true);
  assert.equal(isExactCanvasSnapshotRunError({ code: 'provider_failed', error: 'Atlas 请求失败' }), false);
  assert.equal(isExactCanvasSnapshotRunError(null), false);
});
