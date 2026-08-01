'use strict';

/**
 * Render public Web entry point.
 *
 * This process opens Render's public port first, serves the built frontend,
 * then starts the full Qingchen Canvas backend as an internal child process
 * and proxies API/media requests to it. Render can therefore mark the service
 * reachable immediately instead of waiting for SQLite and recovery work.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');

process.env.T8_WEB_DEPLOY = '1';
process.env.T8_FIGMA_BRIDGE_AUTOSTART = '0';

const PUBLIC_HOST = '0.0.0.0';
const PUBLIC_PORT = Math.max(1, Number.parseInt(process.env.PORT || '10000', 10) || 10000);
const INTERNAL_HOST = '127.0.0.1';
const INTERNAL_PORT = PUBLIC_PORT >= 65534 ? 18766 : PUBLIC_PORT + 1;
const repositoryRoot = path.resolve(__dirname, '..', '..');

function resolveFrontendDist() {
  const configuredDist = String(process.env.T8PC_FRONTEND_DIST || '').trim();
  const candidates = [];
  if (configuredDist) {
    if (path.isAbsolute(configuredDist)) {
      candidates.push(configuredDist);
    } else {
      candidates.push(path.resolve(process.cwd(), configuredDist));
      candidates.push(path.resolve(__dirname, '..', configuredDist));
      candidates.push(path.resolve(repositoryRoot, configuredDist));
    }
  }
  candidates.push(path.join(repositoryRoot, 'dist'));
  const unique = [...new Set(candidates.map((candidate) => path.normalize(candidate)))];
  const found = unique.find((candidate) => fs.existsSync(path.join(candidate, 'index.html')));
  if (!found) {
    throw new Error(`[render] frontend build not found; checked: ${unique.join(', ')}`);
  }
  return found;
}

const frontendDist = resolveFrontendDist();
const publicApp = express();
let phase = 'public-listening';
let backendReady = false;
let backendError = '';
let backendChild = null;
let shuttingDown = false;

function publicStatus() {
  return {
    success: true,
    service: 'qingchen-atlas-canvas',
    phase,
    backendReady,
    publicAddress: `http://${PUBLIC_HOST}:${PUBLIC_PORT}`,
    internalAddress: `http://${INTERNAL_HOST}:${INTERNAL_PORT}`,
    commit: String(process.env.RENDER_GIT_COMMIT || '').trim() || undefined,
    error: backendError || undefined,
    uptimeSeconds: Math.round(process.uptime()),
  };
}

publicApp.get('/api/status', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(publicStatus());
});

function proxyToBackend(req, res) {
  const forwardedHeaders = {
    ...req.headers,
    host: `${INTERNAL_HOST}:${INTERNAL_PORT}`,
    'x-forwarded-host': req.headers.host || '',
    'x-forwarded-proto': String(req.headers['x-forwarded-proto'] || 'https'),
    'x-forwarded-for': String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || ''),
  };
  delete forwardedHeaders.connection;

  const proxyRequest = http.request({
    hostname: INTERNAL_HOST,
    port: INTERNAL_PORT,
    method: req.method,
    path: req.originalUrl || req.url,
    headers: forwardedHeaders,
  }, (proxyResponse) => {
    res.statusCode = proxyResponse.statusCode || 502;
    for (const [name, value] of Object.entries(proxyResponse.headers)) {
      if (value !== undefined) res.setHeader(name, value);
    }
    proxyResponse.pipe(res);
  });

  proxyRequest.on('error', (error) => {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    res.status(502).json({
      success: false,
      code: 'backend_proxy_unavailable',
      error: backendError || error.message || '清尘无限画布后端暂不可用',
      phase,
    });
  });
  req.on('aborted', () => proxyRequest.destroy());
  req.pipe(proxyRequest);
}

publicApp.use((req, res, next) => {
  const pathname = String(req.path || req.url || '').split('?')[0];
  const backendPath = /^\/(?:api|files|input|output)(?:\/|$)/.test(pathname);
  if (!backendPath) return next();
  if (!backendReady) {
    res.setHeader('Retry-After', '2');
    return res.status(503).json({
      success: false,
      code: phase === 'failed' ? 'backend_start_failed' : 'backend_starting',
      error: backendError || '清尘无限画布后端正在启动，请稍候重试。',
      phase,
    });
  }
  return proxyToBackend(req, res);
});

publicApp.use(express.static(frontendDist, {
  index: false,
  setHeaders(res, filePath) {
    if (path.basename(filePath) === 'index.html') {
      res.setHeader('Cache-Control', 'no-cache');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
  },
}));

function loadingPage() {
  const failed = phase === 'failed';
  const title = failed ? '清尘无限画布后端启动失败' : '正在启动清尘无限画布';
  const detail = failed
    ? '公网网页已经上线，但完整后端没有成功加载。请检查 Render 日志中的后端子进程信息。'
    : 'Render 已开放公网端口，正在加载清尘无限画布后端与 Atlas 能力。页面会在准备完成后自动刷新。';
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
html,body{height:100%;margin:0;background:#0b0d12;color:#eef2ff;font-family:Inter,system-ui,sans-serif}main{height:100%;display:grid;place-items:center}.card{width:min(620px,calc(100% - 40px));padding:32px;border:1px solid #293044;border-radius:18px;background:#111520;box-shadow:0 24px 80px #0008}h1{margin:0 0 12px;font-size:26px}p{margin:0;color:#aeb8d0;line-height:1.7}.bar{height:4px;margin-top:26px;overflow:hidden;border-radius:9px;background:#242b3b}.bar:after{content:"";display:block;width:35%;height:100%;background:#8b5cf6;animation:move 1.2s infinite ease-in-out}@keyframes move{from{transform:translateX(-110%)}to{transform:translateX(320%)}}code{display:block;margin-top:20px;color:#9ca3af}</style></head>
<body><main><section class="card"><h1>${title}</h1><p>${detail}</p>${failed ? '' : '<div class="bar"></div>'}<code id="state">phase: ${phase}</code></section></main>
<script>
const el=document.getElementById('state');
async function check(){try{const r=await fetch('/api/status',{cache:'no-store'});const s=await r.json();el.textContent='phase: '+s.phase;if(s.phase==='ready') location.reload();}catch(e){el.textContent='waiting for Render...';}}
setInterval(check,1500);check();
</script></body></html>`;
}

publicApp.get(/^\/(?!api\/|files\/|input\/|output\/).*/, (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!backendReady) return res.status(200).type('html').send(loadingPage());
  return res.sendFile(path.join(frontendDist, 'index.html'));
});

function internalBackendIsReady() {
  return new Promise((resolve) => {
    const request = http.get({
      hostname: INTERNAL_HOST,
      port: INTERNAL_PORT,
      path: '/api/status',
      timeout: 1500,
    }, (response) => {
      response.resume();
      resolve(Boolean(response.statusCode && response.statusCode < 500));
    });
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
    request.on('error', () => resolve(false));
  });
}

async function waitForInternalBackend(child) {
  while (!shuttingDown && child.exitCode === null && child.signalCode === null) {
    if (await internalBackendIsReady()) {
      backendReady = true;
      phase = 'ready';
      console.log(`[render] 清尘无限画布后端已就绪：http://${INTERNAL_HOST}:${INTERNAL_PORT}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

function startFullBackend() {
  phase = 'starting-backend';
  console.log('正在启动清尘无限画布');
  console.log(`[render] 内部后端地址：http://${INTERNAL_HOST}:${INTERNAL_PORT}`);
  backendChild = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      HOST: INTERNAL_HOST,
      PORT: String(INTERNAL_PORT),
      T8_WEB_DEPLOY: '1',
      T8_FIGMA_BRIDGE_AUTOSTART: '0',
    },
    stdio: 'inherit',
  });

  backendChild.once('error', (error) => {
    backendReady = false;
    phase = 'failed';
    backendError = error.message || String(error);
    console.error('[render] 清尘无限画布后端启动失败：', backendError);
  });
  backendChild.once('exit', (code, signal) => {
    backendReady = false;
    if (!shuttingDown) {
      phase = 'failed';
      backendError = `清尘无限画布后端已退出（code=${code ?? 'null'}, signal=${signal || 'none'}）`;
      console.error(`[render] ${backendError}`);
    }
  });
  void waitForInternalBackend(backendChild);
}

const publicServer = publicApp.listen(PUBLIC_PORT, PUBLIC_HOST, () => {
  console.log(`[render] 公网引导服务已监听：http://${PUBLIC_HOST}:${PUBLIC_PORT}`);
  console.log(`[render] 前端目录：${frontendDist}`);
  setImmediate(startFullBackend);
});

publicServer.on('error', (error) => {
  console.error('[render] 公网服务启动失败：', error);
  process.exitCode = 1;
});

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  phase = 'stopping';
  console.log(`[render] 收到 ${signal}，正在停止公网和内部服务`);
  if (backendChild && backendChild.exitCode === null) backendChild.kill(signal);
  publicServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 8000).unref();
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
