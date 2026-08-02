const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function freeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

test('desktop Atlas backend starts without loading collaboration gateways or agents', async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 't8-desktop-atlas-startup-'));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const port = await freeLoopbackPort();
  const source = `
    const runtime = require('./backend/src/server');
    (async () => {
      await runtime.serverStartPromise;
      const response = await fetch('http://127.0.0.1:${port}/api/status');
      const status = await response.json();
      if (status.runtime !== 'desktop-atlas') throw new Error('unexpected runtime: ' + status.runtime);
      if (status.storage?.persistence !== 'local-user-data') throw new Error('unexpected storage status');
      const loaded = Object.keys(require.cache).map((value) => value.replaceAll('\\\\', '/'));
      for (const suffix of [
        '/collaboration/gateway.js',
        '/routes/collaboration.js',
        '/routes/agentControl.js',
        '/routes/creatorAgent.js',
      ]) {
        if (loaded.some((value) => value.endsWith(suffix))) throw new Error('disabled module loaded: ' + suffix);
      }
      process.stdout.write(JSON.stringify({ runtime: status.runtime, status: response.status }));
      await runtime.gracefulShutdown('TEST');
    })().catch(async (error) => {
      process.stderr.write(String(error?.stack || error));
      try { await runtime.gracefulShutdown('TEST'); } catch (_) {}
      process.exitCode = 1;
    });
  `;
  const child = spawn(process.execPath, ['-e', source], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      T8_DESKTOP_ATLAS_RUNTIME: '1',
      T8PC_DEV_DATA_ROOT: dataRoot,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exitCode = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('desktop Atlas startup timed out'));
    }, 30_000);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
  assert.equal(exitCode, 0, stderr || stdout);
  assert.match(stdout, /"runtime":"desktop-atlas"/);
});
