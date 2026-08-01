const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const sharp = require('sharp');

if (process.env.GITHUB_WORKFLOW !== 'Verify build') {
  console.log('[live-upload] skipped outside Verify build workflow');
  process.exit(0);
}

const base = 'https://qingchen-atlascloud-canvas.onrender.com';
const origin = base;
const name = `live-upload-autosize-${Date.now()}`;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qingchen-upload-'));
const imagePath = path.join(tempDir, 'portrait-540x960.png');
const configPath = path.join(tempDir, 'config.json');
const resultPath = path.join(tempDir, 'result.json');
let canvasId = '';

async function jsonRequest(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Origin: origin,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(`${init.method || 'GET'} ${url} -> HTTP ${response.status}: ${text.slice(0, 500)}`);
  return data;
}

async function main() {
  const created = await jsonRequest(`${base}/api/canvas`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  canvasId = String(created?.data?.id || '');
  if (!canvasId) throw new Error(`Canvas creation returned no id: ${JSON.stringify(created)}`);

  await sharp({
    create: {
      width: 540,
      height: 960,
      channels: 4,
      background: { r: 30, g: 90, b: 180, alpha: 1 },
    },
  })
    .composite([{
      input: Buffer.from('<svg width="540" height="960"><rect width="540" height="960" fill="#1e5ab4"/><circle cx="270" cy="300" r="150" fill="#f4ead5"/><text x="270" y="650" text-anchor="middle" font-size="58" fill="white">QINGCHEN</text></svg>'),
      top: 0,
      left: 0,
    }])
    .png()
    .toFile(imagePath);

  fs.writeFileSync(configPath, JSON.stringify({ base, origin, name, canvasId, imagePath, resultPath }));
  const electronPath = require('electron');
  const electronMain = path.resolve('.github/live-upload-electron.cjs');
  const run = spawnSync('xvfb-run', ['-a', electronPath, '--no-sandbox', electronMain, configPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      ELECTRON_ENABLE_LOGGING: '1',
    },
    stdio: 'inherit',
    timeout: 240_000,
  });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`Electron live upload verification exited with ${run.status}`);
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  if (!result.ok) throw new Error(`Browser verification failed: ${JSON.stringify(result)}`);
  console.log('[live-upload] verified', JSON.stringify(result));
}

main()
  .catch((error) => {
    console.error('[live-upload] failure', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (canvasId) {
      try {
        await jsonRequest(`${base}/api/canvas/${encodeURIComponent(canvasId)}`, { method: 'DELETE' });
        console.log(`[live-upload] cleaned canvas ${canvasId}`);
      } catch (error) {
        console.error('[live-upload] cleanup failed', error);
        process.exitCode = 1;
      }
    }
  });
