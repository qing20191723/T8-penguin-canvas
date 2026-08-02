import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('settings route persists advancedProviders with masking and secret preservation', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 't8-advanced-settings-'));
  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const config = require('../backend/src/config.js');
  const oldConfig = {
    SETTINGS_FILE: config.SETTINGS_FILE,
    DEFAULT_LOCAL_SAVE_DIR: config.DEFAULT_LOCAL_SAVE_DIR,
    DEFAULT_CANVAS_AUTO_SAVE_DIR: config.DEFAULT_CANVAS_AUTO_SAVE_DIR,
    DEFAULT_RESOURCE_LIBRARY_DIR: config.DEFAULT_RESOURCE_LIBRARY_DIR,
    DEFAULT_THEME_TEMPLATE_DIR: config.DEFAULT_THEME_TEMPLATE_DIR,
    WEB_DEPLOYMENT: config.WEB_DEPLOYMENT,
  };
  t.after(() => {
    Object.assign(config, oldConfig);
  });
  config.SETTINGS_FILE = path.join(tmpDir, 'settings.json');
  config.DEFAULT_LOCAL_SAVE_DIR = path.join(tmpDir, 'save');
  config.DEFAULT_CANVAS_AUTO_SAVE_DIR = path.join(tmpDir, 'canvas');
  config.DEFAULT_RESOURCE_LIBRARY_DIR = path.join(tmpDir, 'resources');
  config.DEFAULT_THEME_TEMPLATE_DIR = path.join(tmpDir, 'themes');
  config.WEB_DEPLOYMENT = false;

  const express = require('express');
  const settingsRouter = require('../backend/src/routes/settings.js');
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/settings', settingsRouter);
  const server = await new Promise<any>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  t.after(() => {
    server.close();
  });

  const base = `http://127.0.0.1:${server.address().port}/api/settings`;

  const initial = await fetch(base).then((res) => res.json());
  assert.equal(initial.success, true);
  assert.ok(Array.isArray(initial.data.advancedProviders));
  assert.equal(initial.data.advancedProviderSummary.enabledCount, 1);
  assert.equal(initial.data.advancedProviders.find((p: any) => p.id === 'atlas')?.apiKey, '');
  assert.equal(initial.data.advancedProviders.find((p: any) => p.id === 'custom-api')?.enabled, false);

  const save = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      advancedProviders: [
        {
          id: 'atlas',
          protocol: 'atlas',
          enabled: true,
          apiKey: 'atlas-secret-123456',
        },
        {
          id: 'custom-api',
          protocol: 'openai-compatible',
          enabled: true,
          baseUrl: 'https://custom.example/v1',
          apiKey: 'custom-secret-654321',
          imageModels: ['custom/image'],
        },
      ],
    }),
  }).then((res) => res.json());
  assert.equal(save.success, true);

  const masked = await fetch(base).then((res) => res.json());
  const atlas = masked.data.advancedProviders.find((p: any) => p.id === 'atlas');
  const custom = masked.data.advancedProviders.find((p: any) => p.id === 'custom-api');
  assert.equal(atlas.apiKey, '****3456');
  assert.equal(atlas.hasApiKey, true);
  assert.equal(custom.apiKey, '****4321');
  assert.equal(custom.hasApiKey, true);
  assert.equal(masked.data.advancedProviderSummary.enabledCount, 2);
  assert.equal(masked.data.advancedProviderSummary.configuredKeyCount, 2);
  assert.equal(masked.data.advancedProviders.length, 2);
  assert.equal(JSON.stringify(masked.data).includes('atlas-secret-123456'), false);
  assert.equal(JSON.stringify(masked.data).includes('custom-secret-654321'), false);

  const raw = await fetch(`${base}/raw`).then((res) => res.json());
  assert.equal(raw.data.advancedProviders.find((p: any) => p.id === 'atlas').apiKey, 'atlas-secret-123456');
  assert.equal(raw.data.advancedProviders.find((p: any) => p.id === 'custom-api').apiKey, 'custom-secret-654321');

  const preserve = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      advancedProviders: [
        { id: 'atlas', protocol: 'atlas', enabled: true, apiKey: '****3456' },
        { id: 'custom-api', protocol: 'openai-compatible', enabled: true, baseUrl: 'https://custom.example/v1', apiKey: '****4321' },
      ],
    }),
  }).then((res) => res.json());
  assert.equal(preserve.success, true);

  const preservedRaw = await fetch(`${base}/raw`).then((res) => res.json());
  assert.equal(preservedRaw.data.advancedProviders.find((p: any) => p.id === 'atlas').apiKey, 'atlas-secret-123456');
  assert.equal(preservedRaw.data.advancedProviders.find((p: any) => p.id === 'custom-api').apiKey, 'custom-secret-654321');
});

test('web settings expose only configured or masked credential state and hide raw settings', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 't8-web-settings-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const config = require('../backend/src/config.js');
  const previous = {
    SETTINGS_FILE: config.SETTINGS_FILE,
    DEFAULT_LOCAL_SAVE_DIR: config.DEFAULT_LOCAL_SAVE_DIR,
    DEFAULT_CANVAS_AUTO_SAVE_DIR: config.DEFAULT_CANVAS_AUTO_SAVE_DIR,
    DEFAULT_RESOURCE_LIBRARY_DIR: config.DEFAULT_RESOURCE_LIBRARY_DIR,
    DEFAULT_THEME_TEMPLATE_DIR: config.DEFAULT_THEME_TEMPLATE_DIR,
    WEB_DEPLOYMENT: config.WEB_DEPLOYMENT,
  };
  t.after(() => Object.assign(config, previous));
  config.SETTINGS_FILE = path.join(tmpDir, 'settings.json');
  config.DEFAULT_LOCAL_SAVE_DIR = path.join(tmpDir, 'save');
  config.DEFAULT_CANVAS_AUTO_SAVE_DIR = path.join(tmpDir, 'canvas');
  config.DEFAULT_RESOURCE_LIBRARY_DIR = path.join(tmpDir, 'resources');
  config.DEFAULT_THEME_TEMPLATE_DIR = path.join(tmpDir, 'themes');
  config.WEB_DEPLOYMENT = true;

  const atlasSecret = 'atlas-saved-secret-boundary-123456';
  const customSecret = 'custom-saved-secret-boundary-654321';
  const envSecret = 'atlas-env-secret-boundary-abcdef';
  const oldEnvSecret = process.env.ATLASCLOUD_API_KEY;
  process.env.ATLASCLOUD_API_KEY = envSecret;
  t.after(() => {
    if (oldEnvSecret == null) delete process.env.ATLASCLOUD_API_KEY;
    else process.env.ATLASCLOUD_API_KEY = oldEnvSecret;
  });

  const express = require('express');
  const settingsRouter = require('../backend/src/routes/settings.js');
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/settings', settingsRouter);
  const server = await new Promise<any>((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/settings`;

  const saved = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      advancedProviders: [
        { id: 'atlas', protocol: 'atlas', enabled: true, apiKey: atlasSecret },
        { id: 'custom-api', protocol: 'openai-compatible', enabled: true, baseUrl: 'https://example.test/v1', apiKey: customSecret },
      ],
    }),
  });
  assert.equal(saved.status, 200);

  const publicResponse = await fetch(base);
  const publicText = await publicResponse.text();
  assert.equal(publicResponse.status, 200);
  for (const secret of [atlasSecret, customSecret, envSecret]) assert.equal(publicText.includes(secret), false);
  const publicSettings = JSON.parse(publicText).data;
  const atlas = publicSettings.advancedProviders.find((provider: any) => provider.id === 'atlas');
  const custom = publicSettings.advancedProviders.find((provider: any) => provider.id === 'custom-api');
  assert.equal(atlas.hasApiKey, true);
  assert.match(atlas.apiKey, /^\*{4}/);
  assert.equal(custom.hasApiKey, true);
  assert.match(custom.apiKey, /^\*{4}/);

  const rawResponse = await fetch(`${base}/raw`);
  const rawText = await rawResponse.text();
  assert.equal(rawResponse.status, 404);
  for (const secret of [atlasSecret, customSecret, envSecret]) assert.equal(rawText.includes(secret), false);

  const frontendApi = fs.readFileSync(path.join(process.cwd(), 'src', 'services', 'api.ts'), 'utf8');
  assert.equal(frontendApi.includes('/settings/raw'), false);
  assert.equal(frontendApi.includes('getRawSettings'), false);
});
