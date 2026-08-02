const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const ATLAS_ONLY_RUNTIME = String(process.env.T8_ATLAS_ONLY_RUNTIME || '') === '1';
const startFigmaBridgeOnAppStart = ATLAS_ONLY_RUNTIME
  ? () => undefined
  : require('./utils/figmaBridge').startFigmaBridgeOnAppStart;
const { getRunRecoveryManager } = require('./services/runRecovery');
const { closeProjectDatabase, getProjectDatabase } = require('./services/projectDatabase');
const { peekAssetRuntime } = require('./services/lazyAssetRuntime');
const { maintainRunRetention } = require('./services/runRetentionMaintenance');
const { DEFAULT_PROJECT_ID } = require('./collaboration/protocol');
const {
  SCHEMA: MEMORY_SCHEMA,
  authorizeBearer,
  boundedToken,
  createActivityTracker,
  processMemorySnapshot,
  queueSummary,
  storageStatus,
} = require('./services/memoryDiagnostics');
const registerAgentControlInstance = ATLAS_ONLY_RUNTIME
  ? () => null
  : require('./services/agentControlRegistry').registerAgentControlInstance;

const app = express();
const backendMemoryActivity = createActivityTracker('backend');
const memoryDebugToken = boundedToken(process.env.T8_MEMORY_DEBUG_TOKEN);
const memoryInternalToken = boundedToken(process.env.T8_MEMORY_INTERNAL_TOKEN);
delete process.env.T8_MEMORY_INTERNAL_TOKEN;
app.use(backendMemoryActivity.middleware);

function atlasOnlyDisabledRouter(feature) {
  const router = express.Router();
  router.use((_req, res) => res.status(404).json({
    success: false,
    code: 'atlas_only_runtime_disabled',
    feature,
    error: '该桌面能力未在 Atlas Web 轻量运行时启用',
  }));
  return router;
}

const agentControlRouter = ATLAS_ONLY_RUNTIME
  ? Object.assign(atlasOnlyDisabledRouter('agent-control'), {
    AGENT_CONTROL_REQUEST_LIMIT: 64 * 1024,
    AGENT_CONTROL_HTTP_SCHEMA: 't8-agent-control-http-v1',
  })
  : require('./routes/agentControl');
const canvasAgentToolsRouter = ATLAS_ONLY_RUNTIME
  ? atlasOnlyDisabledRouter('canvas-agent')
  : require('./routes/canvasAgentTools');
const creatorAgentRouter = ATLAS_ONLY_RUNTIME
  ? Object.assign(atlasOnlyDisabledRouter('creator-agent'), {
    CREATOR_AGENT_REQUEST_LIMIT: 1024 * 1024,
    CREATOR_AGENT_HTTP_SCHEMA: 't8-creator-agent-http-v1',
  })
  : require('./routes/creatorAgent');

// Node's http.Server considers a request closed as soon as its socket is
// destroyed, but an async Express handler can keep running afterwards. Track
// returned handler promises separately so ProjectDatabase is never closed
// underneath application work during a bounded shutdown.
const HTTP_REQUEST_LIFECYCLE = Symbol('t8-http-request-lifecycle');
const activeApplicationRequests = new Set();
const applicationRequestDrainWaiters = new Set();
const wrappedApplicationHandlers = new WeakMap();
const wrappedApplicationRouters = new WeakSet();

function applicationRequestStatus() {
  let pendingHandlers = 0;
  for (const state of activeApplicationRequests) pendingHandlers += state.pendingHandlers;
  return {
    activeRequests: activeApplicationRequests.size,
    pendingHandlers,
  };
}

function resolveApplicationRequestDrainWaiters() {
  if (activeApplicationRequests.size !== 0) return;
  for (const waiter of applicationRequestDrainWaiters) {
    clearTimeout(waiter.timer);
    waiter.resolve({ drained: true, ...applicationRequestStatus() });
  }
  applicationRequestDrainWaiters.clear();
}

function settleApplicationRequest(state) {
  if (state.settled || !state.trackingArmed || !state.responseTerminal || state.pendingHandlers !== 0) return;
  state.settled = true;
  activeApplicationRequests.delete(state);
  resolveApplicationRequestDrainWaiters();
}

function applicationRequestLifecycle(req, res, next) {
  const state = {
    pendingHandlers: 0,
    responseTerminal: false,
    responseFinished: false,
    responseEndInvoked: false,
    responseEndWaiters: new Set(),
    trackingArmed: false,
    settled: false,
  };
  req[HTTP_REQUEST_LIFECYCLE] = state;
  activeApplicationRequests.add(state);
  res.locals = res.locals || {};
  res.locals.trackApplicationTask = (task) => trackApplicationTask(req, res, task);
  const originalEnd = res.end;
  res.end = function trackedResponseEnd(...args) {
    state.responseEndInvoked = true;
    try {
      return originalEnd.apply(this, args);
    } finally {
      for (const release of state.responseEndWaiters) release();
      state.responseEndWaiters.clear();
    }
  };
  const markResponseTerminal = () => {
    state.responseTerminal = true;
    settleApplicationRequest(state);
  };
  res.once('finish', () => {
    state.responseFinished = true;
    markResponseTerminal();
  });
  res.once('close', markResponseTerminal);
  queueMicrotask(() => {
    state.trackingArmed = true;
    settleApplicationRequest(state);
  });
  next();
}

function trackApplicationTask(req, res, task) {
  if (!task || typeof task.then !== 'function') return task;
  const lease = acquireApplicationHandlerLease(req, res);
  if (!lease) return task;
  Promise.resolve(task).then(lease.release, lease.release);
  return task;
}

function acquireApplicationHandlerLease(req, res) {
  const state = req?.[HTTP_REQUEST_LIFECYCLE];
  if (!state) return null;
  // A late callback should not normally observe a settled state because its
  // upstream invocation owns a lease. Re-open defensively so a malformed
  // extension cannot silently disappear from request accounting.
  if (state.settled) {
    state.settled = false;
    activeApplicationRequests.add(state);
  }
  state.pendingHandlers += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    state.responseEndWaiters.delete(release);
    res.removeListener('finish', release);
    state.pendingHandlers = Math.max(0, state.pendingHandlers - 1);
    settleApplicationRequest(state);
  };
  const waitForResponseEnd = (allowEndInvocation = true) => {
    if (state.responseFinished || res.writableFinished) {
      release();
      return;
    }
    res.once('finish', release);
    if (allowEndInvocation) {
      if (state.responseEndInvoked || res.writableEnded) {
        release();
        return;
      }
      state.responseEndWaiters.add(release);
    }
    // Deliberately do not release on a premature socket close. A callback-style
    // middleware can still call next() or res.end() afterwards; retaining the
    // lease is what keeps ProjectDatabase open across that detached work.
  };
  return { release, waitForResponseEnd };
}

function invokeApplicationHandler(handler, receiver, error, req, res, next) {
  const lease = acquireApplicationHandlerLease(req, res);
  if (!lease) {
    return error === undefined
      ? handler.call(receiver, req, res, next)
      : handler.call(receiver, error, req, res, next);
  }
  let invocationReturned = false;
  let returnedPromise = false;
  let nextCalled = false;
  const trackedNext = (...args) => {
    nextCalled = true;
    try {
      return next(...args);
    } finally {
      // next() dispatches downstream synchronously. Release only after those
      // handlers acquired their own leases, and keep this lease when the
      // current handler also returned a Promise that may continue afterwards.
      if (invocationReturned && !returnedPromise) lease.release();
    }
  };
  let result;
  try {
    result = error === undefined
      ? handler.call(receiver, req, res, trackedNext)
      : handler.call(receiver, error, req, res, trackedNext);
  } catch (caught) {
    invocationReturned = true;
    try {
      return trackedNext(caught);
    } finally {
      lease.release();
    }
  }
  invocationReturned = true;
  returnedPromise = Boolean(result && typeof result.then === 'function');
  if (returnedPromise) {
    Promise.resolve(result).then(
      () => lease.release(),
      (caught) => {
        try {
          trackedNext(caught);
        } finally {
          lease.release();
        }
      },
    );
  } else if (nextCalled) {
    lease.release();
  } else {
    // A next-capable callback middleware owns the dispatch lease until it calls
    // next() or a response finishes normally. A forced socket close may invoke
    // response internals, but must not be mistaken for completion of that
    // still-scheduled callback.
    lease.waitForResponseEnd();
  }
  return result;
}

function wrapApplicationHandler(handler) {
  if (typeof handler !== 'function') return handler;
  if (handler.stack && Array.isArray(handler.stack)) {
    wrapApplicationRouter(handler);
    return handler;
  }
  const existing = wrappedApplicationHandlers.get(handler);
  if (existing) return existing;
  let wrapped;
  if (handler.length === 4) {
    wrapped = function trackedErrorHandler(error, req, res, next) {
      return invokeApplicationHandler(handler, this, error, req, res, next);
    };
  } else {
    wrapped = function trackedRequestHandler(req, res, next) {
      return invokeApplicationHandler(handler, this, undefined, req, res, next);
    };
  }
  wrappedApplicationHandlers.set(handler, wrapped);
  wrappedApplicationHandlers.set(wrapped, wrapped);
  return wrapped;
}

function wrapApplicationLayer(layer) {
  if (!layer || typeof layer !== 'object') return;
  if (layer.route?.stack && Array.isArray(layer.route.stack)) {
    layer.route.stack.forEach(wrapApplicationLayer);
    return;
  }
  if (layer.handle?.stack && Array.isArray(layer.handle.stack)) {
    wrapApplicationRouter(layer.handle);
    return;
  }
  if (typeof layer.handle === 'function') layer.handle = wrapApplicationHandler(layer.handle);
}

function wrapApplicationRouter(router) {
  if (!router || wrappedApplicationRouters.has(router)) return router;
  wrappedApplicationRouters.add(router);
  if (Array.isArray(router.stack)) router.stack.forEach(wrapApplicationLayer);
  return router;
}

function wrapRegistrationArgument(value) {
  if (Array.isArray(value)) return value.map(wrapRegistrationArgument);
  if (typeof value === 'function') return wrapApplicationHandler(value);
  return value;
}

// Register the lifecycle middleware before decorating app registration. Every
// router mounted below is traversed once, while routes added later (including
// local extensions) are wrapped at registration time as well.
app.use(applicationRequestLifecycle);
for (const method of ['use', 'all', 'get', 'post', 'put', 'patch', 'delete', 'options', 'head']) {
  const register = app[method].bind(app);
  app[method] = (...args) => register(...args.map(wrapRegistrationArgument));
}

function waitForApplicationRequests(timeoutMs = null) {
  if (activeApplicationRequests.size === 0) {
    return Promise.resolve({ drained: true, ...applicationRequestStatus() });
  }
  const hasTimeout = timeoutMs !== null && timeoutMs !== undefined;
  const requestedTimeout = hasTimeout ? Number(timeoutMs) : Number.NaN;
  if (hasTimeout && Number.isFinite(requestedTimeout) && requestedTimeout <= 0) {
    return Promise.resolve({ drained: false, ...applicationRequestStatus() });
  }
  return new Promise((resolve) => {
    const waiter = { resolve, timer: null };
    if (hasTimeout && Number.isFinite(requestedTimeout)) {
      waiter.timer = setTimeout(() => {
        applicationRequestDrainWaiters.delete(waiter);
        resolve({ drained: false, ...applicationRequestStatus() });
      }, requestedTimeout);
    }
    applicationRequestDrainWaiters.add(waiter);
  });
}

// ========== 中间件 ==========
const LOCAL_ORIGIN_RE = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i;
const UXP_ORIGIN_RE = /^uxp:\/\//i;
const PUBLIC_ALLOWED_ORIGINS = new Set(
  String(process.env.T8_PUBLIC_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);
function isTrustedLocalOrigin(origin) {
  const value = String(origin || '').trim();
  return LOCAL_ORIGIN_RE.test(value) || UXP_ORIGIN_RE.test(value) || PUBLIC_ALLOWED_ORIGINS.has(value);
}
function firstForwardedValue(value) {
  return String(value || '').split(',')[0].trim();
}
function isSameRequestOrigin(req, origin) {
  const value = String(origin || '').trim();
  if (!value) return false;
  let parsed;
  try {
    parsed = new URL(value);
  } catch (_) {
    return false;
  }
  const forwardedHost = firstForwardedValue(req.get('x-forwarded-host') || req.get('host')).toLowerCase();
  const forwardedProto = firstForwardedValue(req.get('x-forwarded-proto') || req.protocol)
    .replace(/:$/, '')
    .toLowerCase();
  if (!forwardedHost || !forwardedProto) return false;
  return parsed.host.toLowerCase() === forwardedHost
    && parsed.protocol.replace(/:$/, '').toLowerCase() === forwardedProto;
}
function isTrustedRequestOrigin(req, origin) {
  return isTrustedLocalOrigin(origin) || isSameRequestOrigin(req, origin);
}
function isLocalCanvasSyncPath(req) {
  const pathname = String(req?.originalUrl || req?.url || req?.path || '')
    .split('?')[0]
    .replace(/\/+$/, '');
  return /^\/api\/canvas\/[^/]+\/sync$/.test(pathname);
}
app.use((req, res, next) => {
  if (isLocalCanvasSyncPath(req)) res.set('Cache-Control', 'no-store');
  next();
});
app.use(cors({
  origin(origin, cb) {
    cb(null, !origin || isTrustedLocalOrigin(origin));
  },
  credentials: true,
}));
app.use((req, res, next) => {
  const origin = String(req.get('origin') || '').trim();
  const trustedOrigin = Boolean(origin && isTrustedRequestOrigin(req, origin));
  const fetchSite = String(req.get('sec-fetch-site') || '').trim().toLowerCase();
  if ((origin && !trustedOrigin) || (fetchSite === 'cross-site' && !trustedOrigin)) {
    return res.status(403).json({
      success: false,
      code: 'origin_forbidden',
      error: '请求来源未获后端授权',
    });
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  return next();
});
const canvasAgentJsonParser = express.json({ limit: '64kb', strict: true });
const creatorAgentJsonParser = express.json({ limit: '1mb', strict: true });
const agentControlJsonParser = express.json({ limit: '64kb', strict: true });
app.use('/api/agent-control/v1', (req, res, next) => {
  const contentLength = Number(req.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > agentControlRouter.AGENT_CONTROL_REQUEST_LIMIT) {
    return res.status(413).json({
      schema: agentControlRouter.AGENT_CONTROL_HTTP_SCHEMA,
      ok: false,
      code: 'AGENT_CONTROL_REQUEST_TOO_LARGE',
      message: 'Agent Control 请求超过 64 KiB',
    });
  }
  return agentControlJsonParser(req, res, (error) => {
    if (!error) return next();
    const tooLarge = error?.type === 'entity.too.large';
    return res.status(tooLarge ? 413 : 400).json({
      schema: agentControlRouter.AGENT_CONTROL_HTTP_SCHEMA,
      ok: false,
      code: tooLarge ? 'AGENT_CONTROL_REQUEST_TOO_LARGE' : 'AGENT_CONTROL_REQUEST_INVALID',
      message: tooLarge ? 'Agent Control 请求超过 64 KiB' : 'Agent Control JSON 格式无效',
    });
  });
}, agentControlRouter);
app.use('/api/canvas-agent', (req, res, next) => {
  const contentLength = Number(req.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > 64 * 1024) {
    return res.status(413).json({ success: false, code: 'agent_request_too_large', error: 'Agent 工具请求超过 64 KiB' });
  }
  return canvasAgentJsonParser(req, res, (error) => {
    if (!error) return next();
    const tooLarge = error?.type === 'entity.too.large';
    return res.status(tooLarge ? 413 : 400).json({
      success: false,
      code: tooLarge ? 'agent_request_too_large' : 'agent_request_invalid',
      error: tooLarge ? 'Agent 工具请求超过 64 KiB' : 'Agent 工具请求格式无效',
    });
  });
}, canvasAgentToolsRouter);
app.use('/api/creator-agent/v1', (req, res, next) => {
  const contentLength = Number(req.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > creatorAgentRouter.CREATOR_AGENT_REQUEST_LIMIT) {
    return res.status(413).json({
      schema: creatorAgentRouter.CREATOR_AGENT_HTTP_SCHEMA,
      ok: false,
      code: 'CREATOR_AGENT_REQUEST_TOO_LARGE',
      message: '创作 Agent 请求超过 1 MiB，请把大文件作为附件上传，不要嵌入对话正文',
    });
  }
  return creatorAgentJsonParser(req, res, (error) => {
    if (!error) return next();
    const tooLarge = error?.type === 'entity.too.large';
    return res.status(tooLarge ? 413 : 400).json({
      schema: creatorAgentRouter.CREATOR_AGENT_HTTP_SCHEMA,
      ok: false,
      code: tooLarge ? 'CREATOR_AGENT_REQUEST_TOO_LARGE' : 'CREATOR_AGENT_REQUEST_INVALID',
      message: tooLarge
        ? '创作 Agent 请求超过 1 MiB，请把大文件作为附件上传'
        : '创作 Agent JSON 格式无效',
    });
  });
}, creatorAgentRouter);
const webBodyLimits = process.env.T8_WEB_DEPLOY === '1' || process.env.RENDER === 'true';
function tightenedBodyLimit(envName, defaultBytes) {
  const configured = Math.trunc(Number(process.env[envName]));
  return Number.isSafeInteger(configured) && configured > 0
    ? Math.min(configured, defaultBytes)
    : defaultBytes;
}
const genericJsonParser = express.json({
  limit: webBodyLimits ? tightenedBodyLimit('T8_WEB_JSON_MAX_BYTES', 2 * 1024 * 1024) : '120mb',
});
const documentJsonParser = express.json({
  limit: webBodyLimits ? tightenedBodyLimit('T8_WEB_DOCUMENT_JSON_MAX_BYTES', 32 * 1024 * 1024) : '120mb',
});
app.use((req, res, next) => {
  const pathname = String(req.originalUrl || req.url || '').split('?')[0];
  if (/^\/api\/(?:files|photoshop-bridge)\/upload-base64$/.test(pathname)) return next();
  const parser = /^\/api\/(?:canvas|project-runs|subflows)(?:\/|$)/.test(pathname)
    ? documentJsonParser
    : genericJsonParser;
  return parser(req, res, (error) => {
    if (!error) return next();
    const tooLarge = error?.type === 'entity.too.large';
    return res.status(tooLarge ? 413 : 400).json({
      success: false,
      code: tooLarge ? 'request_too_large' : 'invalid_json',
      error: tooLarge ? '请求体超过允许大小' : 'JSON 请求体无效',
    });
  });
});
app.use(express.urlencoded({
  extended: true,
  limit: webBodyLimits ? tightenedBodyLimit('T8_WEB_FORM_MAX_BYTES', 2 * 1024 * 1024) : '120mb',
}));

// 简易访问日志
app.use((req, _res, next) => {
  const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  console.log(`[${t}] ${req.method} ${req.path}`);
  next();
});

// ========== 目录初始化 ==========
[
  config.DATA_DIR,
  config.INPUT_DIR,
  config.OUTPUT_DIR,
  config.THUMBNAILS_DIR,
].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ========== 静态资源托管 ==========
const ACTIVE_USER_MEDIA_EXTENSIONS = new Set([
  '.html', '.htm', '.xhtml', '.svg', '.svgz', '.js', '.mjs', '.cjs',
  '.css', '.xml', '.xsl', '.xslt', '.hta', '.vbs',
]);

function guardUserMediaStatic(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  let pathname = String(req.path || '');
  try {
    for (let pass = 0; pass < 2; pass += 1) {
      const decoded = decodeURIComponent(pathname);
      if (decoded === pathname) break;
      pathname = decoded;
    }
  } catch (_) {
    return res.status(400).end();
  }
  if (ACTIVE_USER_MEDIA_EXTENSIONS.has(path.extname(pathname).toLowerCase())) {
    return res.status(404).end();
  }
  return next();
}

const userMediaStaticOptions = {
  dotfiles: 'deny',
  // User-controlled media roots must never turn a nested index.html into an
  // executable directory landing page whose request URL has no active suffix.
  index: false,
  setHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
  },
};

function mountUserMediaStatic(prefix, directory) {
  app.use(prefix, guardUserMediaStatic, express.static(directory, userMediaStaticOptions));
}

mountUserMediaStatic('/files/output', config.OUTPUT_DIR);
mountUserMediaStatic('/files/input', config.INPUT_DIR);
mountUserMediaStatic('/files/thumbnails', config.THUMBNAILS_DIR);
mountUserMediaStatic('/output', config.OUTPUT_DIR);
mountUserMediaStatic('/input', config.INPUT_DIR);

// ========== 健康检查 ==========
app.get('/api/status', (_req, res) => {
  res.json({
    ok: true,
    service: 't8-penguin-canvas-backend',
    version: config.APP_VERSION,
    port: config.PORT,
    instanceId: config.BACKEND_INSTANCE_ID,
    runtime: ATLAS_ONLY_RUNTIME ? 'atlas-only' : 'desktop',
    storage: {
      persistence: process.env.T8_PERSISTENT_DISK_CONFIGURED === '1' ? 'configured' : 'unknown',
    },
    time: new Date().toISOString(),
  });
});

// ========== 业务路由 ==========
const canvasRouter = require('./routes/canvas');
const settingsRouter = require('./routes/settings');
const atlasProxyRouter = require('./routes/atlasProxy');
const filesRouter = require('./routes/files');
const resourcesRouter = require('./routes/resources');
const themesRouter = require('./routes/themes');
const externalProvidersRouter = require('./routes/externalProviders');
const achievementsRouter = require('./routes/achievements');
const webAssetsRouter = require('./routes/webAssets');
const collaborationRouter = require('./routes/collaboration');
const { getCollaborationGateway } = require('./collaboration/gateway');
const projectRunsRouter = require('./routes/projectRuns');
const projectAssetsRouter = require('./routes/projectAssets');
const subflowsRouter = require('./routes/subflows');
const legacyRouter = (feature, modulePath) => ATLAS_ONLY_RUNTIME
  ? atlasOnlyDisabledRouter(feature)
  : require(modulePath);
const proxyRouter = legacyRouter('legacy-provider-proxy', './routes/proxy');
const imageOpsRouter = legacyRouter('image-operations', './routes/imageOps');
const eagleRouter = legacyRouter('eagle', './routes/eagle');
const figmaRouter = legacyRouter('figma', './routes/figma');
const grokOAuthRouter = legacyRouter('grok-oauth', './routes/grokOAuth');
const codexCliRouter = legacyRouter('codex-cli', './routes/codexCli');
const aiWatermarkRouter = legacyRouter('ai-watermark', './routes/aiWatermark');
const cloudUploadsRouter = legacyRouter('cloud-uploads', './routes/cloudUploads');
const parseHubRouter = legacyRouter('parsehub', './routes/parseHub');
const topazRouter = legacyRouter('topaz', './routes/topaz');
const animeTagsRouter = legacyRouter('anime-tags', './routes/animeTags');
const vibexBridgeRouter = legacyRouter('vibex-bridge', './routes/vibexBridge');
const videoOpsRouter = legacyRouter('video-operations', './routes/videoOps');
const batchTagsRouter = legacyRouter('batch-tags', './routes/batchTags');
const photoshopBridgeRouter = legacyRouter('photoshop-bridge', './routes/photoshopBridge');
const feishuBitableRouter = legacyRouter('feishu-bitable', './routes/feishuBitable');
const collaborationGateway = getCollaborationGateway(config);

function isLoopbackMemoryRequest(req) {
  const address = String(req.socket?.remoteAddress || '').toLowerCase();
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function activeRunCount() {
  try {
    const database = projectAssetsRouter.semanticPipeline?.database;
    if (!database?.listRuns) return 0;
    return ['queued', 'running', 'polling']
      .reduce((total, status) => total + database.listRuns({ status, limit: 10_000 }).length, 0);
  } catch (_) {
    return 0;
  }
}

function backendMemoryPayload() {
  const activity = backendMemoryActivity.snapshot();
  const queues = queueSummary({
    previewPipeline: projectAssetsRouter.previewPipeline,
    semanticPipeline: projectAssetsRouter.semanticPipeline,
    runRecoveryManager,
  });
  return {
    schema: MEMORY_SCHEMA,
    commit: String(process.env.RENDER_GIT_COMMIT || '').trim() || undefined,
    phase: 'ready',
    capturedAt: new Date().toISOString(),
    process: processMemorySnapshot('backend'),
    activity: {
      requests: activity.activeRequests,
      runs: activeRunCount(),
      uploads: activity.activeUploads,
      downloads: activity.activeDownloads + queues.semantic.downloads,
    },
    queues,
    storage: storageStatus(config.DATA_DIR),
  };
}

app.get('/api/debug/memory/internal', (req, res) => {
  if (!memoryInternalToken || !isLoopbackMemoryRequest(req)) return res.status(404).end();
  if (!authorizeBearer(req, memoryInternalToken)) return res.status(401).end();
  res.setHeader('Cache-Control', 'no-store');
  return res.json(backendMemoryPayload());
});

// Direct single-process diagnostics for local/desktop investigations. Render's
// public bootstrap owns the same external route and composes both processes.
app.get('/api/debug/memory', (req, res) => {
  if (!memoryDebugToken) return res.status(404).end();
  if (!authorizeBearer(req, memoryDebugToken)) return res.status(401).end();
  const backend = backendMemoryPayload();
  res.setHeader('Cache-Control', 'no-store');
  return res.json({
    schema: MEMORY_SCHEMA,
    commit: backend.commit,
    phase: backend.phase,
    capturedAt: backend.capturedAt,
    bootstrap: null,
    backend,
    totalRss: backend.process.rss,
  });
});

app.use('/api/canvas', canvasRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/proxy/atlas', atlasProxyRouter);
app.use('/api/proxy/external', externalProvidersRouter);
app.use('/api/proxy', proxyRouter);
app.use('/api/files', filesRouter);
app.use('/api/image', imageOpsRouter);
app.use('/api/resources', resourcesRouter);
app.use('/api/themes', themesRouter);
app.use('/api/eagle', eagleRouter);
app.use('/api/figma', figmaRouter);
app.use('/api/grok-oauth', grokOAuthRouter);
app.use('/api/codex-cli', codexCliRouter);
app.use('/api/ai-watermark', aiWatermarkRouter);
app.use('/api/cloud-uploads', cloudUploadsRouter);
app.use('/api/parsehub', parseHubRouter);
app.use('/api/achievements', achievementsRouter);
app.use('/api/topaz', topazRouter);
app.use('/api/anime-tags', animeTagsRouter);
app.use('/api/vibex-bridge', vibexBridgeRouter);
app.use('/api/video-ops', videoOpsRouter);
app.use('/api/batch-tags', batchTagsRouter);
app.use('/api/photoshop-bridge', photoshopBridgeRouter);
app.use('/api/feishu-bitable', feishuBitableRouter);
app.use('/api/web-assets', webAssetsRouter);
app.use('/api/collaboration', collaborationRouter);
app.use('/api/project-runs', projectRunsRouter);
app.use('/api/project-assets', projectAssetsRouter);
app.use('/api/subflows', subflowsRouter);
if (!ATLAS_ONLY_RUNTIME) {
  const { registerLocalExtensions } = require('./extensions/localExtensions');
  const localHooks = require('./extensions/runtimeHooks');
  registerLocalExtensions(app, { config, express, logger: console, hooks: localHooks });
}

// ========== 前端静态资源(仅打包模式) ==========
// 开发模式下不启用,避免与 Vite dev server 打架。
if (config.IS_PACKAGED && config.FRONTEND_DIST && fs.existsSync(config.FRONTEND_DIST)) {
  app.use(express.static(config.FRONTEND_DIST));
  // SPA 兑底: 除了 /api/* 与 /files/* 外,其他路由返回 index.html(允许前端路由)
  app.get(/^\/(?!api\/|files\/|input\/|output\/).*/, (_req, res) => {
    res.sendFile(path.join(config.FRONTEND_DIST, 'index.html'));
  });
}

// ========== 启动 ==========
const PORT = config.PORT;
const HOST = config.HOST;

let shutdownStarted = false;
let semanticPipelineClosed = false;
let previewPipelineShutdownPromise = null;
let runRecoveryShutdownPromise = null;
let videoOperationsShutdownPromise = null;
let collaborationGatewayShutdownPromise = null;
let projectDatabaseClosePromise = null;
let runtimeStorageClosePromise = null;
let deferredRuntimeStorageClosePromise = null;
let httpServerClosePromise = null;
let gracefulShutdownPromise = null;
let startupRunRecoveryPromise = null;
let startupSemanticModelRefreshPromise = null;
let runRetentionMaintenanceTimer = null;
let agentControlRegistration = null;
let serverStartOutcome = null;
let resolveServerStart;
const serverStartPromise = new Promise((resolve) => { resolveServerStart = resolve; });
let serverClosedOutcome = false;
let resolveServerClosed;
const serverClosedPromise = new Promise((resolve) => { resolveServerClosed = resolve; });
const runRecoveryManager = getRunRecoveryManager({});

function settleServerStart(state, error = null) {
  if (serverStartOutcome) return serverStartOutcome;
  serverStartOutcome = { state, error };
  resolveServerStart(serverStartOutcome);
  return serverStartOutcome;
}

function settleServerClosed() {
  if (serverClosedOutcome) return;
  serverClosedOutcome = true;
  resolveServerClosed();
}

const server = app.listen(PORT, HOST, () => {
  settleServerStart('listening');
  // A signal can arrive after listen() was requested but before this callback.
  // In that window startup side effects must not outlive the shutdown lifecycle.
  if (shutdownStarted) return;
  try {
    agentControlRegistration = registerAgentControlInstance(config);
  } catch (error) {
    console.warn('[agent-control] instance discovery registration failed:', error?.message || error);
  }
  console.log('==================================================');
  console.log('🐧 T8-penguin-canvas 后端服务');
  console.log('==================================================');
  console.log(`🚀 服务器启动成功!`);
  console.log(`   地址: http://${HOST}:${PORT}`);
  console.log(`   环境: ${config.NODE_ENV}`);
  console.log(`   数据目录: ${config.DATA_DIR}`);
  console.log(`   输出目录: ${config.OUTPUT_DIR}`);
  console.log('   Figma Bridge: 自动启动中（如需禁用可设置 T8_FIGMA_BRIDGE_AUTOSTART=0）');
  console.log('   按 Ctrl+C 停止服务器...');
  console.log('--------------------------------------------------');
  backendMemoryActivity.log('backend.listening', { phase: 'http-ready' });
  startFigmaBridgeOnAppStart(console);
  if (!ATLAS_ONLY_RUNTIME) setImmediate(() => {
    if (shutdownStarted) return;
    startupSemanticModelRefreshPromise = Promise.resolve()
      .then(() => projectAssetsRouter.semanticPipeline.refreshModelStates())
      .catch((error) => {
        console.warn('[asset-semantic] startup model refresh failed:', error?.code || 'unknown_error');
      });
  });
  setImmediate(() => {
    if (shutdownStarted) return;
    backendMemoryActivity.log('run-recovery.start', { phase: 'run-recovery' });
    startupRunRecoveryPromise = runRecoveryManager.recoverPendingRuns()
      .then((result) => {
        if (result.recovered || result.failed || result.interrupted) console.log('[run-recovery] startup result', result);
        try {
          const maintenance = maintainRunRetention(getProjectDatabase(config), DEFAULT_PROJECT_ID, { force: true });
          if (!maintenance.skipped && maintenance.result?.deletedRuns) {
            console.log('[run-retention] startup prune', {
              deletedRuns: maintenance.result.deletedRuns,
              protectedRuns: maintenance.result.protectedRuns,
            });
          }
        } catch (error) {
          console.warn('[run-retention] startup prune failed:', error?.message || error);
        }
        if (!shutdownStarted && !runRetentionMaintenanceTimer) {
          runRetentionMaintenanceTimer = setInterval(() => {
            if (shutdownStarted) return;
            try {
              maintainRunRetention(getProjectDatabase(config), DEFAULT_PROJECT_ID);
            } catch (error) {
              console.warn('[run-retention] pressure maintenance failed:', error?.message || error);
            }
          }, 6 * 60 * 60 * 1000);
          runRetentionMaintenanceTimer.unref?.();
        }
        backendMemoryActivity.log('run-recovery.end', { phase: 'ready' });
      })
      .catch((error) => {
        backendMemoryActivity.log('run-recovery.error', { phase: 'ready', errorCode: String(error?.code || 'run_recovery_failed').slice(0, 80) });
        console.warn('[run-recovery] startup failed:', error?.message || error);
      });
  });
});
server.once('error', (error) => {
  const start = settleServerStart('error', error);
  // A failed listen has no later close event. A runtime server error after a
  // successful listen does, so never forge the transport-closed barrier there.
  if (start.state === 'error') settleServerClosed();
  console.warn('[backend] listen failed:', error?.message || error);
  setImmediate(() => {
    gracefulShutdown('LISTEN_ERROR').catch((shutdownError) => {
      console.warn('[backend] listen failure cleanup failed:', shutdownError?.message || shutdownError);
    });
  });
});
server.once('close', () => {
  settleServerStart('closed');
  settleServerClosed();
});

function closeSemanticPipeline() {
  if (semanticPipelineClosed) return;
  semanticPipelineClosed = true;
  try {
    peekAssetRuntime().semanticPipeline?.close?.();
  } catch (error) {
    console.warn('[asset-semantic] shutdown failed:', error?.message || error);
  }
}

function closeProjectDatabaseLifecycle() {
  if (!projectDatabaseClosePromise) {
    projectDatabaseClosePromise = closeProjectDatabase().catch((error) => {
      console.warn('[project-db] graceful shutdown failed:', error?.message || error);
      throw error;
    });
  }
  return projectDatabaseClosePromise;
}

function shutdownPreviewPipelineLifecycle() {
  if (!previewPipelineShutdownPromise) {
    const pipeline = peekAssetRuntime().previewPipeline;
    try {
      previewPipelineShutdownPromise = typeof pipeline?.shutdown === 'function'
        ? Promise.resolve(pipeline.shutdown())
        : Promise.resolve(pipeline?.close?.());
    } catch (error) {
      previewPipelineShutdownPromise = Promise.reject(error);
    }
    previewPipelineShutdownPromise = previewPipelineShutdownPromise.then((result) => {
      if (result?.forced) console.warn('[asset-preview] shutdown deadline reached; running jobs remain durable for recovery');
      return result;
    }).catch((error) => {
      console.warn('[asset-preview] graceful shutdown failed:', error?.message || error);
      throw error;
    });
  }
  return previewPipelineShutdownPromise;
}

function shutdownRunRecoveryLifecycle() {
  if (!runRecoveryShutdownPromise) {
    try {
      runRecoveryShutdownPromise = typeof runRecoveryManager?.shutdown === 'function'
        ? Promise.resolve(runRecoveryManager.shutdown({ timeoutMs: 5_000 }))
        : Promise.resolve(startupRunRecoveryPromise);
    } catch (error) {
      runRecoveryShutdownPromise = Promise.reject(error);
    }
    runRecoveryShutdownPromise = runRecoveryShutdownPromise.then((result) => {
      if (result?.forced) console.warn('[run-recovery] shutdown deadline reached; deferred work remains durable');
      return result;
    }).catch((error) => {
      console.warn('[run-recovery] graceful shutdown failed:', error?.message || error);
      throw error;
    });
  }
  return runRecoveryShutdownPromise;
}

function shutdownVideoOperationsLifecycle() {
  if (!videoOperationsShutdownPromise) {
    try {
      videoOperationsShutdownPromise = typeof videoOpsRouter?.shutdownLifecycle === 'function'
        ? Promise.resolve(videoOpsRouter.shutdownLifecycle({ timeoutMs: 5_000 }))
        : Promise.resolve({ tasks: { drained: true, activeTasks: 0 }, forced: false });
    } catch (error) {
      videoOperationsShutdownPromise = Promise.reject(error);
    }
    videoOperationsShutdownPromise = videoOperationsShutdownPromise.then((result) => {
      if (result?.forced) console.warn('[video-ops] shutdown deadline reached; active tasks remain fenced by request lifecycle');
      return result;
    }).catch((error) => {
      console.warn('[video-ops] graceful shutdown failed:', error?.message || error);
      throw error;
    });
  }
  return videoOperationsShutdownPromise;
}

function shutdownCollaborationGatewayLifecycle() {
  if (!collaborationGatewayShutdownPromise) {
    try {
      collaborationGatewayShutdownPromise = typeof collaborationGateway?.shutdown === 'function'
        ? Promise.resolve(collaborationGateway.shutdown())
        : Promise.resolve(collaborationGateway?.stop?.());
    } catch (error) {
      collaborationGatewayShutdownPromise = Promise.reject(error);
    }
    collaborationGatewayShutdownPromise = collaborationGatewayShutdownPromise.catch((error) => {
      console.warn('[collaboration-gateway] graceful shutdown failed:', error?.message || error);
      throw error;
    });
  }
  return collaborationGatewayShutdownPromise;
}

function closeRuntimeStorageLifecycle() {
  if (!runtimeStorageClosePromise) {
    runtimeStorageClosePromise = (async () => {
      // Both workers may own database writes across async provider/renderer
      // boundaries. The collaboration listener is a third database writer and
      // must enter its terminal lifecycle before ProjectDatabase is closed.
      await Promise.resolve(startupSemanticModelRefreshPromise);
      await shutdownRunRecoveryLifecycle();
      await shutdownPreviewPipelineLifecycle();
      await shutdownVideoOperationsLifecycle();
      await shutdownCollaborationGatewayLifecycle();
      await videoOpsRouter.waitForShutdownDrain?.();
      await collaborationGateway.waitForApplicationRequests?.();
      await closeProjectDatabaseLifecycle();
    })();
  }
  return runtimeStorageClosePromise;
}

function closeHttpServerLifecycle() {
  if (!httpServerClosePromise) {
    httpServerClosePromise = (async () => {
      const start = await serverStartPromise;
      if (start.state !== 'listening') {
        await serverClosedPromise;
        const requests = await waitForApplicationRequests(0);
        return { serverClosed: true, forced: false, ...requests };
      }
      const shutdownTimeoutMs = Math.max(
        100,
        Math.min(120_000, Number(config.HTTP_SHUTDOWN_TIMEOUT_MS) || 5_000),
      );
      const deadline = Date.now() + shutdownTimeoutMs;
      let forced = false;
      // Arm the deadline even when another owner already called server.close().
      // In that state server.listening is false while active sockets may still
      // keep the close event pending forever.
      const forceClose = setTimeout(() => {
        forced = true;
        server.closeAllConnections?.();
      }, shutdownTimeoutMs);
      try {
        if (server.listening) {
          try {
            server.close((error) => {
              if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
                console.warn('[backend] HTTP close callback failed:', error?.message || error);
              }
            });
          } catch (error) {
            if (error?.code !== 'ERR_SERVER_NOT_RUNNING') throw error;
          }
        }
        await serverClosedPromise;
        const requests = await waitForApplicationRequests(Math.max(0, deadline - Date.now()));
        return { serverClosed: true, forced, ...requests };
      } finally {
        clearTimeout(forceClose);
      }
    })();
  }
  return httpServerClosePromise;
}

function deferRuntimeStorageCloseUntilRequestsDrain() {
  if (!deferredRuntimeStorageClosePromise) {
    deferredRuntimeStorageClosePromise = (async () => {
      await serverClosedPromise;
      await Promise.all([
        waitForApplicationRequests(),
        collaborationGateway.waitForApplicationRequests?.(),
        videoOpsRouter.waitForShutdownDrain?.(),
      ]);
      await closeRuntimeStorageLifecycle();
      return { drained: true };
    })().catch((error) => {
      console.warn('[backend] deferred storage shutdown failed:', error?.message || error);
      throw error;
    });
    deferredRuntimeStorageClosePromise.catch(() => {});
  }
  return deferredRuntimeStorageClosePromise;
}

function waitForRuntimeStorageCloseLifecycle() {
  return runtimeStorageClosePromise
    || deferredRuntimeStorageClosePromise
    || Promise.resolve(null);
}

function gracefulShutdown(signal) {
  if (shutdownStarted) return gracefulShutdownPromise || projectDatabaseClosePromise || Promise.resolve();
  shutdownStarted = true;
  if (runRetentionMaintenanceTimer) {
    clearInterval(runRetentionMaintenanceTimer);
    runRetentionMaintenanceTimer = null;
  }
  try {
    agentControlRegistration?.stop?.();
  } catch (error) {
    console.warn('[agent-control] instance discovery cleanup failed:', error?.message || error);
  }
  closeSemanticPipeline();
  // Stop accepting new preview work/claims as soon as shutdown begins. The
  // database itself remains open until the HTTP server has drained as well.
  const previewShutdown = shutdownPreviewPipelineLifecycle();
  previewShutdown.catch(() => {});
  const recoveryShutdown = shutdownRunRecoveryLifecycle();
  recoveryShutdown.catch(() => {});
  const videoShutdown = shutdownVideoOperationsLifecycle();
  videoShutdown.catch(() => {});
  const collaborationShutdown = shutdownCollaborationGatewayLifecycle();
  collaborationShutdown.catch(() => {});
  if (signal === 'SIGINT') process.exitCode = 130;
  else if (signal === 'SIGTERM') process.exitCode = 143;
  gracefulShutdownPromise = (async () => {
    const http = await closeHttpServerLifecycle();
    await recoveryShutdown;
    await previewShutdown;
    const videoOperations = await videoShutdown;
    const collaboration = await collaborationShutdown;
    // A main HTTP management request can enqueue a gateway-owned cancellation
    // after the initial gateway stop outcome was captured. Recheck only after
    // the main transport lifecycle has reached its bounded outcome; when it is
    // drained, no request remains that can add another gateway task.
    const collaborationRequests = await collaborationGateway.waitForApplicationRequests?.(0)
      || collaboration?.applicationRequests
      || { drained: true };
    const collaborationOutcome = {
      ...collaboration,
      applicationRequests: collaborationRequests,
    };
    const collaborationDrained = collaborationRequests.drained !== false;
    const videoOperationTasks = await videoOpsRouter.waitForShutdownDrain?.(0)
      || videoOperations?.tasks
      || { drained: true, activeTasks: 0 };
    const videoOperationsOutcome = {
      ...videoOperations,
      tasks: videoOperationTasks,
    };
    const videoOperationsDrained = videoOperationTasks.drained !== false;
    if (http.drained && collaborationDrained && videoOperationsDrained) {
      await closeRuntimeStorageLifecycle();
      return {
        http,
        collaboration: collaborationOutcome,
        videoOperations: videoOperationsOutcome,
        storageClosed: true,
        storageDeferred: false,
      };
    }
    // closeAllConnections() only severs transport. Returned async Express
    // handlers remain application work and may still need the database. Keep
    // storage open, resolve the bounded shutdown, and close it as soon as the
    // tracked handler promises settle.
    deferRuntimeStorageCloseUntilRequestsDrain();
    return {
      http,
      collaboration: collaborationOutcome,
      videoOperations: videoOperationsOutcome,
      storageClosed: false,
      storageDeferred: true,
    };
  })();
  return gracefulShutdownPromise;
}

function handleShutdownSignal(signal) {
  gracefulShutdown(signal).catch((error) => {
    console.warn('[backend] runtime shutdown failed:', error?.message || error);
  });
}

process.once('SIGINT', () => handleShutdownSignal('SIGINT'));
process.once('SIGTERM', () => handleShutdownSignal('SIGTERM'));
process.once('exit', closeSemanticPipeline);
process.once('exit', () => {
  backendMemoryActivity.close();
  try { agentControlRegistration?.stop?.(); } catch (_) {}
});

module.exports = {
  app,
  server,
  gracefulShutdown,
  closeSemanticPipeline,
  shutdownPreviewPipelineLifecycle,
  shutdownRunRecoveryLifecycle,
  shutdownVideoOperationsLifecycle,
  shutdownCollaborationGatewayLifecycle,
  serverStartPromise,
  applicationRequestStatus,
  waitForApplicationRequests,
  waitForRuntimeStorageCloseLifecycle,
  agentControlAuthService: require('./services/agentControlAuth').agentControlAuthService,
  agentControlApprovalService: require('./services/agentControlApprovals').agentControlApprovalService,
};
