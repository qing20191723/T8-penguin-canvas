import {
  ATLAS_ONLY_BLOCKED_API_PREFIXES,
  ATLAS_ONLY_RUNTIME,
} from '../config/atlasOnlyRuntime';

const COLLABORATION_MANAGEMENT_HEADER = 'x-t8-collaboration-management-token';
const EXECUTION_POLICY_PATH = '/api/collaboration/execution-policy';
const BACKEND_READY_CACHE_MS = 10_000;
const BACKEND_READY_ATTEMPTS = 8;

let backendReadyUntil = 0;
let backendReadyProbe: Promise<boolean> | null = null;

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
  if (!ATLAS_ONLY_RUNTIME || context.desktopHost) return null;
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

    const response = await originalFetch(input, init);
    return atlasExecution ? normalizeAtlasExecutionResponse(response) : response;
  };
}
