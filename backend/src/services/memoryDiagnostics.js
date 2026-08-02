'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const v8 = require('node:v8');

const SCHEMA = 't8-memory-diagnostics-v1';
const HEARTBEAT_MS = 5 * 60 * 1000;
const DEFAULT_HIGH_WATER_BYTES = 410 * 1024 * 1024;

function boundedToken(value) {
  const token = String(value || '').trim();
  return token.length >= 32 && token.length <= 512 ? token : '';
}

function bearerToken(req) {
  const header = String(req?.headers?.authorization || '');
  const match = /^Bearer\s+([^\s]+)$/i.exec(header);
  return boundedToken(match?.[1]);
}

function constantTimeTokenEqual(received, expected) {
  const normalizedReceived = boundedToken(received);
  const normalizedExpected = boundedToken(expected);
  const left = crypto.createHash('sha256').update(normalizedReceived).digest();
  const right = crypto.createHash('sha256').update(normalizedExpected).digest();
  const equal = crypto.timingSafeEqual(left, right);
  return Boolean(normalizedReceived && normalizedExpected && equal);
}

function authorizeBearer(req, expected) {
  return constantTimeTokenEqual(bearerToken(req), expected);
}

function processMemorySnapshot(role) {
  const memory = process.memoryUsage();
  const heap = v8.getHeapStatistics();
  return {
    role,
    pid: process.pid,
    rss: memory.rss,
    heapUsed: memory.heapUsed,
    heapTotal: memory.heapTotal,
    external: memory.external,
    arrayBuffers: memory.arrayBuffers,
    uptime: Math.round(process.uptime()),
    v8HeapLimit: heap.heap_size_limit,
  };
}

function storageStatus(directory) {
  const persistentDiskConfigured = Boolean(
    String(process.env.RENDER_DISK_ID || '').trim()
      || String(process.env.T8_PERSISTENT_STORAGE || '').trim() === '1',
  );
  const status = {
    state: persistentDiskConfigured ? 'configured' : 'unknown',
    persistentDiskConfigured,
  };
  try {
    const stat = fs.statfsSync(directory);
    status.availableBytes = Number(stat.bavail) * Number(stat.bsize);
    status.capacityBytes = Number(stat.blocks) * Number(stat.bsize);
    status.writable = fs.accessSync(directory, fs.constants.W_OK) === undefined;
  } catch (error) {
    status.writable = false;
    status.errorCode = String(error?.code || 'storage_status_unavailable').slice(0, 80);
  }
  return status;
}

function requestKind(req) {
  const method = String(req?.method || '').toUpperCase();
  const pathname = String(req?.originalUrl || req?.url || '').split('?')[0];
  const upload = ['POST', 'PUT', 'PATCH'].includes(method)
    && /(?:upload|import|media|asset)/i.test(pathname);
  const download = ['GET', 'HEAD'].includes(method)
    && /(?:\/files\/|\/input\/|\/output\/|\/media(?:\/|$)|download)/i.test(pathname);
  return upload ? 'upload' : download ? 'download' : 'request';
}

function createActivityTracker(role, options = {}) {
  const logger = options.logger || console;
  const counters = { requests: 0, uploads: 0, downloads: 0 };
  let highWaterBytes = Number(process.env.T8_MEMORY_HIGH_WATER_BYTES || DEFAULT_HIGH_WATER_BYTES);
  if (!Number.isFinite(highWaterBytes) || highWaterBytes < 64 * 1024 * 1024) {
    highWaterBytes = DEFAULT_HIGH_WATER_BYTES;
  }
  let lastHighWaterAt = 0;

  const snapshot = () => ({
    activeRequests: counters.requests,
    activeUploads: counters.uploads,
    activeDownloads: counters.downloads,
  });

  const log = (event, detail = {}) => {
    const processSnapshot = processMemorySnapshot(role);
    logger.info?.(`[memory] ${JSON.stringify({
      schema: SCHEMA,
      event,
      capturedAt: new Date().toISOString(),
      process: processSnapshot,
      activity: snapshot(),
      ...detail,
    })}`);
    const now = Date.now();
    if (processSnapshot.rss >= highWaterBytes && now - lastHighWaterAt >= HEARTBEAT_MS) {
      lastHighWaterAt = now;
      logger.warn?.(`[memory] ${JSON.stringify({
        schema: SCHEMA,
        event: 'high-water',
        capturedAt: new Date(now).toISOString(),
        thresholdBytes: highWaterBytes,
        process: processSnapshot,
        activity: snapshot(),
      })}`);
    }
  };

  const middleware = (req, res, next) => {
    const kind = requestKind(req);
    counters.requests += 1;
    if (kind === 'upload') counters.uploads += 1;
    if (kind === 'download') counters.downloads += 1;
    if (kind !== 'request') log(`${kind}.start`);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      counters.requests = Math.max(0, counters.requests - 1);
      if (kind === 'upload') counters.uploads = Math.max(0, counters.uploads - 1);
      if (kind === 'download') counters.downloads = Math.max(0, counters.downloads - 1);
      if (kind !== 'request') log(`${kind}.end`);
    };
    res.once('finish', release);
    res.once('close', release);
    next();
  };

  const onUncaughtException = (error) => {
    log('process.exception', {
      errorCode: String(error?.code || error?.name || 'uncaught_exception').slice(0, 80),
    });
  };
  process.on('uncaughtExceptionMonitor', onUncaughtException);
  const heartbeat = setInterval(() => log('heartbeat'), HEARTBEAT_MS);
  heartbeat.unref?.();
  return {
    middleware,
    snapshot,
    log,
    close: () => {
      clearInterval(heartbeat);
      process.removeListener('uncaughtExceptionMonitor', onUncaughtException);
    },
  };
}

function queueSummary({ previewPipeline, semanticPipeline, runRecoveryManager } = {}) {
  let preview = { active: 0, queued: 0, pending: 0 };
  let semantic = { active: 0, queued: 0, downloads: 0 };
  let recovery = { active: 0, pending: 0 };
  try {
    const status = previewPipeline?.status?.() || {};
    preview = {
      active: Number(status.active || 0),
      queued: Number(status.counts?.queued || 0),
      pending: Number(status.pending?.completions || 0)
        + Number(status.pending?.reschedules || 0)
        + Number(status.pending?.reruns || 0)
        + (status.pending?.recovery ? 1 : 0),
    };
  } catch (_) {}
  try {
    const status = semanticPipeline?.diagnosticStatus?.() || {};
    semantic = {
      active: Number(status.active || 0),
      queued: Number(status.queued || 0),
      downloads: Number(status.downloads || 0),
    };
  } catch (_) {}
  try {
    const status = runRecoveryManager?.status?.() || {};
    recovery = { active: status.running ? 1 : 0, pending: Number(status.pending || 0) };
  } catch (_) {}
  return { preview, semantic, recovery };
}

module.exports = {
  SCHEMA,
  HEARTBEAT_MS,
  authorizeBearer,
  bearerToken,
  boundedToken,
  constantTimeTokenEqual,
  createActivityTracker,
  processMemorySnapshot,
  queueSummary,
  requestKind,
  storageStatus,
};
