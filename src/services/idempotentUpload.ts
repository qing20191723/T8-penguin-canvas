const uploadKeys = new WeakMap<Blob, string>();

export const MAX_UPLOAD_ATTEMPTS = 3;

function randomUploadKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `upload:${crypto.randomUUID()}`;
  }
  const entropy = typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function'
    ? Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16).padStart(8, '0')).join('')
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  return `upload:${entropy}`;
}

export function idempotencyKeyForUpload(file: Blob): string {
  const existing = uploadKeys.get(file);
  if (existing) return existing;
  const created = randomUploadKey();
  uploadKeys.set(file, created);
  return created;
}

export function recoverableUploadResponse(status: number, payload: unknown): boolean {
  if (status !== 503 || !payload || typeof payload !== 'object') return false;
  const value = payload as { recoverable?: unknown; code?: unknown };
  return value.recoverable === true
    && (value.code === 'backend_starting' || value.code === 'backend_proxy_unavailable');
}

export function uploadRetryAfterMs(value: string | null, now = Date.now()): number {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const absolute = Date.parse(value);
  return Number.isFinite(absolute) ? Math.max(0, absolute - now) : 0;
}

export async function waitForUploadRetry(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('附件上传已取消', 'AbortError');
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(finish, Math.max(0, milliseconds));
    const abort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      reject(new DOMException('附件上传已取消', 'AbortError'));
    };
    function finish() {
      signal?.removeEventListener('abort', abort);
      resolve();
    }
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export async function idempotentUploadFetch(
  url: string,
  body: FormData,
  file: Blob,
  options: { signal?: AbortSignal } = {},
): Promise<Response> {
  const idempotencyKey = idempotencyKeyForUpload(file);
  for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt += 1) {
    // Fetch transport failures are intentionally not retried: the server may
    // already have committed the request and no explicit recovery signal exists.
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body,
      signal: options.signal,
    });
    if (attempt >= MAX_UPLOAD_ATTEMPTS || response.status !== 503) return response;
    const payload = await response.clone().json().catch(() => null);
    if (!recoverableUploadResponse(response.status, payload)) return response;
    await waitForUploadRetry(uploadRetryAfterMs(response.headers.get('Retry-After')), options.signal);
  }
  throw new Error('附件上传重试状态异常');
}
