const COLLABORATION_MANAGEMENT_HEADER = 'x-t8-collaboration-management-token';
const EXECUTION_POLICY_PATH = '/api/collaboration/execution-policy';

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

function requestHeaders(input: RequestInfo | URL, init?: RequestInit) {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  const overrides = new Headers(init?.headers);
  overrides.forEach((value, key) => headers.set(key, value));
  return headers;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  return String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
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
    const headers = requestHeaders(input, init);
    const bypass = shouldBypassPublicCollaborationExecutionPolicy({
      requestUrl: parsed.href,
      method: requestMethod(input, init),
      pagePathname: window.location.pathname,
      pageOrigin: window.location.origin,
      projectId: parsed.searchParams.get('projectId'),
      excludeIntentId: parsed.searchParams.get('excludeIntentId'),
      hasManagementAuthority: headers.has(COLLABORATION_MANAGEMENT_HEADER),
      desktopHost: Boolean(window.t8pc) || /\bElectron\//i.test(navigator.userAgent),
    });
    if (!bypass) return originalFetch(input, init);

    return new Response(JSON.stringify({ success: true, data: null }), {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
        'X-Qingchen-Collaboration-Policy': 'not-applicable',
      },
    });
  };
}
