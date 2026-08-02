'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitFor(url) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return response;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`bootstrap did not listen: ${url}`);
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 4_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

async function startBootstrap(root, token = '') {
  const port = await freePort();
  const frontend = path.join(root, 'frontend');
  const dataRoot = path.join(root, 'data-root');
  fs.mkdirSync(frontend, { recursive: true });
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.writeFileSync(path.join(frontend, 'index.html'), '<!doctype html><title>memory test</title>');
  const env = {
    ...process.env,
    PORT: String(port),
    T8PC_FRONTEND_DIST: frontend,
    T8PC_DEV_DATA_ROOT: dataRoot,
    T8_COLLAB_MANAGEMENT_TOKEN: 'collaboration-management-token-abcdefghijklmnopqrstuvwxyz',
    T8PC_BACKEND_INSTANCE_ID: 'backend-instance-token-abcdefghijklmnopqrstuvwxyz123456',
    T8_FIGMA_BRIDGE_AUTOSTART: '0',
    T8_ATLAS_ONLY_RUNTIME: '0',
  };
  if (token) env.T8_MEMORY_DEBUG_TOKEN = token;
  else delete env.T8_MEMORY_DEBUG_TOKEN;
  const child = spawn(process.execPath, [path.join(process.cwd(), 'backend', 'src', 'renderServer.js')], {
    cwd: process.cwd(),
    env,
    stdio: 'ignore',
    windowsHide: true,
  });
  await waitFor(`http://127.0.0.1:${port}/api/status`);
  return { child, port };
}

test('Render memory diagnostics are undiscoverable by default and protected when enabled', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't8-render-memory-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const disabled = await startBootstrap(path.join(root, 'disabled'));
  t.after(() => stop(disabled.child));
  const disabledResponse = await fetch(`http://127.0.0.1:${disabled.port}/api/debug/memory`);
  assert.equal(disabledResponse.status, 404);
  const publicStatus = await fetch(`http://127.0.0.1:${disabled.port}/api/status`).then((response) => response.json());
  assert.equal(publicStatus.runtime, 'atlas-only');
  assert.deepEqual(publicStatus.storage, { persistence: 'unknown' });
  await stop(disabled.child);

  const token = 'memory-debug-token-abcdefghijklmnopqrstuvwxyz';
  const enabled = await startBootstrap(path.join(root, 'enabled'), token);
  t.after(() => stop(enabled.child));
  const unauthorized = await fetch(`http://127.0.0.1:${enabled.port}/api/debug/memory`);
  assert.equal(unauthorized.status, 401);
  const response = await fetch(`http://127.0.0.1:${enabled.port}/api/debug/memory`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.schema, 't8-memory-diagnostics-v1');
  assert.equal(body.bootstrap.process.role, 'bootstrap');
  assert.equal(Number.isFinite(body.bootstrap.process.rss), true);
  assert.equal(Number.isFinite(body.totalRss), true);
  assert.equal(JSON.stringify(body).includes(token), false);
  assert.doesNotMatch(JSON.stringify(body), /data-root|frontend|renderMemoryDiagnostics/i);
});
