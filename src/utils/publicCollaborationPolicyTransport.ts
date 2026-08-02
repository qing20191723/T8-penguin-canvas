import {
  ATLAS_ONLY_BLOCKED_API_PREFIXES,
  ATLAS_ONLY_RUNTIME,
} from '../config/atlasOnlyRuntime';

const COLLABORATION_MANAGEMENT_HEADER = 'x-t8-collaboration-management-token';
const EXECUTION_POLICY_PATH = '/api/collaboration/execution-policy';
const BACKEND_READY_CACHE_MS = 10_000;
const BACKEND_READY_ATTEMPTS = 8;
const CANVAS_RECOVERY_ATTEMPTS = 4;
const CANVAS_RECOVERY_DELAY_MS = 250;
const EXACT_SNAPSHOT_ERROR_RE = /(?:精确画布快照|exact canvas snapshot|persistent owner|持久\s*owner)/i;
const CANVAS_SNAPSHOT_FIELDS = [
  'nodes',
  'edges',
  'viewport',
  'nextNodeSerialId',
  'creativeDesk',
  'farmCanvas',
] as const;

let backendReadyUntil = 0;
let backendReadyProbe: Promise<boolean> | null = null;

interface JsonRecord {
  [key: string]: unknown;
}

interface RememberedCanvasSave {
  digest: string;
}

const latestCanvasSaveById = new Map<string, RememberedCanvasSave>();

export interface PublicCollaborationPolicyRequestContext {
  requestUrl: string;
  method?: string;
  pagePathname: string;
  pageOrigin: string;
  projectId?: string | null;
  excludeIntentId?: string | null;
  hasManagementAuthority: boolean;
  desktopHost: boolean;
}

export interface AtlasOnlyRequestContext {
  requestUrl: string;
  pageOrigin: string;
  desktopHost: boolean;
}

/**
 * Public web canvas runs are local owner actions, not collaboration-management
 * actions. They must not be blocked by the unfinished host-management endpoint.
 * Remote RunIntent, /collab and Electron requests retain the protected policy path.
 */
export function shouldBypassPublicCollaborationExecutionPolicy(
  context: PublicCollaborationPolicyRequestContext,
) {
  if (String(context.method || 'GET').toUpperCase() !== 'GET') return false;
  if (context.desktopHost || context.hasManagementAuthority) return false;
  if (context.pagePathname.startsWith('/collab')) return false;
  if (String(context.excludeIntentId || '').trim()) return false;
  if (String(context.projectId || '').trim() !== 'project-local') return false;

  let requestUrl: URL;
  try {
    requestUrl = new URL(context.requestUrl, context.pageOrigin);
  } catch {
    return false;
  }
  return requestUrl.origin === context.pageOrigin
    && requestUrl.pathname.replace(/\/+$/, '') === EXECUTION_POLICY_PATH;
}

export function atlasOnlyBlockedApiPath(context: AtlasOnlyRequestContext): string | null {
  if (context.desktopHost) return null;
  if (!ATLAS_ONLY_RUNTIME) {
    try {
      const hostname = new URL(context.pageOrigin).hostname.toLowerCase();
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return null;
    } catch {
      return null;
    }
  }
  let requestUrl: URL;
  try {
    requestUrl = new URL(context.requestUrl, context.pageOrigin);
  } catch {
    return null;
  }
  if (requestUrl.origin !== context.pageOrigin) return null;
  const pathname = requestUrl.pathname.replace(/\/+$/, '') || '/';
  return ATLAS_ONLY_BLOCKED_API_PREFIXES.find((prefix) => (
    pathname === prefix || pathname.startsWith(`${prefix}/`)
  )) || null;
}

export function isAtlasExecutionRequest(
  requestUrl: string,
  method: string,
  pageOrigin: string,
  desktopHost = false,
) {
  if (desktopHost || String(method || 'GET').toUpperCase() !== 'POST') return false;
  let parsed: URL;
  try {
    parsed = new URL(requestUrl, pageOrigin);
  } catch {
    return false;
  }
  if (parsed.origin !== pageOrigin) return false;
  const pathname = parsed.pathname.replace(/\/+$/, '');
  return /^\/api\/proxy\/external\/(?:image|video|chat)$/.test(pathname)
    || /^\/api\/proxy\/atlas\/(?:image|video)$/.test(pathname)
    || pathname === '/api/proxy/image';
}

export function canvasMutationId(
  requestUrl: string,
  method: string,
  pageOrigin: string,
  desktopHost = false,
): string | null {
  if (desktopHost || String(method || 'GET').toUpperCase() !== 'PUT') return null;
  let parsed: URL;
  try {
    parsed = new URL(requestUrl, pageOrigin);
  } catch {
    return null;
  }
  if (parsed.origin !== pageOrigin) return null;
  const match = parsed.pathname.match(/^\/api\/canvas\/([^/]+)\/?$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function isProjectRunCreateRequest(
  requestUrl: string,
  method: string,
  pageOrigin: string,
  desktopHost = false,
) {
  if (desktopHost || String(method || 'GET').toUpperCase() !== 'POST') return false;
  try {
    const parsed = new URL(requestUrl, pageOrigin);
    return parsed.origin === pageOrigin && parsed.pathname.replace(/\/+$/, '') === '/api/project-runs';
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function canonicalJson(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'object') return null;
  if (seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => canonicalJson(item, seen));
  const record = value as JsonRecord;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, canonicalJson(record[key], seen)]),
  );
}

function canvasSnapshotProjection(value: unknown): JsonRecord | null {
  const raw = isRecord(value) && isRecord(value.data) ? value.data : value;
  if (!isRecord(raw)) return null;
  const projection: JsonRecord = {};
  for (const field of CANVAS_SNAPSHOT_FIELDS) {
    projection[field] = raw[field] ?? (field === 'nodes' || field === 'edges' ? [] : null);
  }
  return projection;
}

export function canvasSnapshotDigest(value: unknown): string {
  const projection = canvasSnapshotProjection(value);
  return projection ? JSON.stringify(canonicalJson(projection)) : '';
}

export function equivalentCanvasSnapshot(authoritative: unknown, candidate: unknown) {
  const authoritativeDigest = canvasSnapshotDigest(authoritative);
  return Boolean(authoritativeDigest) && authoritativeDigest === canvasSnapshotDigest(candidate);
}

export function isExactCanvasSnapshotRunError(payload: unknown) {
  if (!isRecord(payload)) return false;
  const code = String(payload.code || '').trim();
  const message = String(payload.error || payload.message || '').trim();
  return EXACT_SNAPSHOT_ERROR_RE.test(`${code} ${message}`);
}

function requestHeaders(input: RequestInfo | URL, init?: RequestInit) {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  const overrides = new Headers(init?.headers);
  overrides.forEach((value, key) => headers.set(key, value));
  return headers;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  return String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
}

function jsonResponse(payload: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}

function externalApplicationResponse(pathname: string) {
  if (pathname.endsWith('/pending')) {
    return jsonResponse({ success: true, data: { messages: [] } }, 200, {
      'X-Qingchen-Atlas-Only': 'external-poller-disabled',
    });
  }
  return jsonResponse({
    success: false,
    code: 'atlas_only_runtime',
    error: '清尘无限画布仅启用 Atlas Cloud；该外部应用接口已禁用。',
  }, 404, {
    'X-Qingchen-Atlas-Only': 'external-application-disabled',
  });
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    const text = await response.clone().text();
    return text.trim() ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

async function requestJsonBody(input: RequestInfo | URL, init?: RequestInit): Promise<JsonRecord | null> {
  const body = init?.body;
  if (typeof body === 'string') {
    try {
      const value = JSON.parse(body);
      return isRecord(value) ? value : null;
    } catch {
      return null;
    }
  }
  if (input instanceof Request) {
    try {
      const text = await input.clone().text();
      if (!text.trim()) return null;
      const value = JSON.parse(text);
      return isRecord(value) ? value : null;
    } catch {
      return null;
    }
  }
  return null;
}

function jsonReplayInit(input: RequestInfo | URL, init: RequestInit | undefined, payload: JsonRecord): RequestInit {
  const headers = requestHeaders(input, init);
  headers.set('Content-Type', 'application/json');
  const base: RequestInit = input instanceof Request
    ? {
        cache: input.cache,
        credentials: input.credentials,
        integrity: input.integrity,
        keepalive: input.keepalive,
        mode: input.mode,
        redirect: input.redirect,
        referrer: input.referrer,
        referrerPolicy: input.referrerPolicy,
        signal: input.signal,
      }
    : { ...init };
  return {
    ...base,
    ...init,
    method: requestMethod(input, init),
    headers,
    body: JSON.stringify(payload),
  };
}

function rememberCanvasSave(canvasId: string, payload: JsonRecord) {
  const digest = canvasSnapshotDigest(payload);
  if (!digest) return;
  latestCanvasSaveById.set(canvasId, { digest });
}

async function fetchAuthoritativeCanvas(
  originalFetch: typeof globalThis.fetch,
  canvasId: string,
): Promise<{ payload: JsonRecord; document: JsonRecord; revision: number } | null> {
  try {
    const response = await originalFetch(`/api/canvas/${encodeURIComponent(canvasId)}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const payload = await responseJson(response);
    if (!isRecord(payload) || !isRecord(payload.data)) return null;
    const revision = Number(payload.data.revision);
    if (!Number.isSafeInteger(revision) || revision < 1) return null;
    return { payload, document: payload.data, revision };
  } catch {
    return null;
  }
}

async function recoverEquivalentCanvasSave(
  originalFetch: typeof globalThis.fetch,
  canvasId: string,
  attemptedPayload: JsonRecord,
): Promise<Response | null> {
  for (let attempt = 0; attempt < CANVAS_RECOVERY_ATTEMPTS; attempt += 1) {
    const authoritative = await fetchAuthoritativeCanvas(originalFetch, canvasId);
    if (authoritative) {
      const latest = latestCanvasSaveById.get(canvasId);
      const authoritativeDigest = canvasSnapshotDigest(authoritative.payload);
      const equivalentAttempt = authoritativeDigest === canvasSnapshotDigest(attemptedPayload);
      const equivalentLatest = Boolean(latest) && latest!.digest === authoritativeDigest;
      if (equivalentAttempt || equivalentLatest) {
        return jsonResponse({
          success: true,
          data: {
            revision: authoritative.revision,
            updatedAt: Number(authoritative.document.updatedAt) || Date.now(),
            recoveredEquivalentSnapshot: true,
          },
        }, 200, {
          'X-Qingchen-Canvas-Recovery': equivalentAttempt
            ? 'authoritative-snapshot-equivalent'
            : 'latest-browser-snapshot-equivalent',
        });
      }
    }
    if (attempt < CANVAS_RECOVERY_ATTEMPTS - 1) await sleep(CANVAS_RECOVERY_DELAY_MS * (attempt + 1));
  }
  return null;
}

async function recoverProjectRunCreation(
  originalFetch: typeof globalThis.fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  runPayload: JsonRecord,
  failure: Response,
): Promise<Response | null> {
  const failurePayload = await responseJson(failure);
  if (!isExactCanvasSnapshotRunError(failurePayload)) return null;
  const canvasId = String(runPayload.canvasId || '').trim();
  if (!canvasId) return null;
  const latest = latestCanvasSaveById.get(canvasId);
  if (!latest) return null;

  const authoritative = await fetchAuthoritativeCanvas(originalFetch, canvasId);
  if (!authoritative || latest.digest !== canvasSnapshotDigest(authoritative.payload)) return null;

  const retryPayload: JsonRecord = {
    ...runPayload,
    canvasRevision: authoritative.revision,
  };
  const retry = await originalFetch(
    input instanceof Request ? input.url : String(input),
    jsonReplayInit(input, init, retryPayload),
  );
  if (retry.ok) {
    const responseHeaders = new Headers(retry.headers);
    responseHeaders.set('X-Qingchen-Run-Recovery', 'verified-authoritative-snapshot');
    return new Response(retry.body, {
      status: retry.status,
      statusText: retry.statusText,
      headers: responseHeaders,
    });
  }
  return retry;
}

async function probeBackendReady(originalFetch: typeof globalThis.fetch) {
  if (Date.now() < backendReadyUntil) return true;
  if (backendReadyProbe) return backendReadyProbe;

  backendReadyProbe = (async () => {
    for (let attempt = 0; attempt < BACKEND_READY_ATTEMPTS; attempt += 1) {
      try {
        const response = await originalFetch('/api/status', {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        const contentType = response.headers.get('content-type') || '';
        const text = await response.text();
        if (response.ok && contentType.includes('application/json')) {
          const payload = JSON.parse(text || '{}');
          const ready = payload?.backendReady === true
            || payload?.phase === 'ready'
            || (payload?.ok === true && payload?.backendReady !== false);
          if (ready) {
            backendReadyUntil = Date.now() + BACKEND_READY_CACHE_MS;
            return true;
          }
        }
      } catch {
        // Render may briefly reset the public proxy while switching deployments.
      }
      if (attempt < BACKEND_READY_ATTEMPTS - 1) {
        await sleep(Math.min(600 + attempt * 250, 2_000));
      }
    }
    return false;
  })().finally(() => {
    backendReadyProbe = null;
  });

  return backendReadyProbe;
}

async function normalizeAtlasExecutionResponse(response: Response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return response;

  let text = '';
  try {
    text = await response.clone().text();
  } catch {
    text = '';
  }
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed);
      const headers = new Headers(response.headers);
      headers.set('Content-Type', 'application/json; charset=utf-8');
      return new Response(trimmed, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch {
      // Fall through to the normalized gateway error below.
    }
  }

  const preview = trimmed.replace(/\s+/g, ' ').slice(0, 120);
  return jsonResponse({
    success: false,
    code: 'backend_non_json_response',
    error: '清尘无限画布后端在请求期间发生冷启动或部署切换，请稍候后重试。',
    transportStatus: response.status,
    responsePreview: preview || undefined,
  }, response.status >= 400 ? response.status : 502, {
    'X-Qingchen-Backend': 'non-json-normalized',
  });
}

let installed = false;

export function installPublicCollaborationPolicyTransport() {
  if (installed || typeof window === 'undefined' || typeof globalThis.fetch !== 'function') return;
  installed = true;
  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = input instanceof Request ? input.url : String(input);
    let parsed: URL;
    try {
      parsed = new URL(rawUrl, window.location.origin);
    } catch {
      return originalFetch(input, init);
    }
    const method = requestMethod(input, init);
    const desktopHost = Boolean(window.t8pc) || /\bElectron\//i.test(navigator.userAgent);
    const blockedPrefix = atlasOnlyBlockedApiPath({
      requestUrl: parsed.href,
      pageOrigin: window.location.origin,
      desktopHost,
    });
    if (blockedPrefix) return externalApplicationResponse(parsed.pathname.replace(/\/+$/, ''));

    const headers = requestHeaders(input, init);
    const bypass = shouldBypassPublicCollaborationExecutionPolicy({
      requestUrl: parsed.href,
      method,
      pagePathname: window.location.pathname,
      pageOrigin: window.location.origin,
      projectId: parsed.searchParams.get('projectId'),
      excludeIntentId: parsed.searchParams.get('excludeIntentId'),
      hasManagementAuthority: headers.has(COLLABORATION_MANAGEMENT_HEADER),
      desktopHost,
    });
    if (bypass) {
      return jsonResponse({ success: true, data: null }, 200, {
        'X-Qingchen-Collaboration-Policy': 'not-applicable',
      });
    }

    const atlasExecution = isAtlasExecutionRequest(
      parsed.href,
      method,
      window.location.origin,
      desktopHost,
    );
    if (atlasExecution && !(await probeBackendReady(originalFetch))) {
      return jsonResponse({
        success: false,
        code: 'backend_starting',
        error: '清尘无限画布后端仍在启动，请稍候后重新运行。',
        recoverable: true,
        retryAfterMs: 2_000,
      }, 503, {
        'Retry-After': '2',
        'X-Qingchen-Backend': 'not-ready',
      });
    }

    const canvasId = canvasMutationId(parsed.href, method, window.location.origin, desktopHost);
    const projectRunCreate = isProjectRunCreateRequest(parsed.href, method, window.location.origin, desktopHost);
    const requestPayload = canvasId || projectRunCreate ? await requestJsonBody(input, init) : null;

    if (canvasId && requestPayload) rememberCanvasSave(canvasId, requestPayload);

    let response = await originalFetch(input, init);

    if (canvasId && requestPayload && !response.ok && response.status === 409) {
      const recovered = await recoverEquivalentCanvasSave(originalFetch, canvasId, requestPayload);
      if (recovered) response = recovered;
    }

    if (projectRunCreate && requestPayload && !response.ok) {
      const recovered = await recoverProjectRunCreation(originalFetch, input, init, requestPayload, response);
      if (recovered) response = recovered;
    }

    return atlasExecution ? normalizeAtlasExecutionResponse(response) : response;
  };
}
