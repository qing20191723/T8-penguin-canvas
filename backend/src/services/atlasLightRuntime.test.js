const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createLazyAssetRuntime, peekAssetRuntime, resetLazyAssetRuntimeForTests } = require('./lazyAssetRuntime');
const { createLazyProjectDatabase } = require('./lazyProjectDatabase');
const { maintainRunRetention, runRetentionPressure } = require('./runRetentionMaintenance');
const { normalizeRunRecoveryDescriptor, recoveryRequest, RunRecoveryManager } = require('./runRecovery');

test('asset preview and semantic workers stay uninitialized until a proxy is first used', () => {
  resetLazyAssetRuntimeForTests();
  const runtime = createLazyAssetRuntime({}, {});
  assert.ok(runtime.previewPipeline);
  assert.ok(runtime.indexer);
  assert.ok(runtime.semanticPipeline);
  assert.deepEqual(peekAssetRuntime(), { previewPipeline: null, indexer: null, semanticPipeline: null });
});

test('project database opens only after the HTTP-mounted proxy is first used', () => {
  let opens = 0;
  const database = createLazyProjectDatabase({}, () => {
    opens += 1;
    return { ping: () => 'ready' };
  });
  assert.equal(opens, 0);
  assert.equal(database.__peek(), null);
  assert.equal(database.ping(), 'ready');
  assert.equal(opens, 1);
  assert.equal(database.ping(), 'ready');
  assert.equal(opens, 1);
});

test('retention maintenance runs only under pressure except for the startup pass', () => {
  let prunes = 0;
  const database = {
    getRunRetentionPolicy: () => ({ maxDays: 30, maxRuns: 1000, maxAssetRefs: 20000, maxDbBytes: 512 * 1024 * 1024 }),
    runRetentionRows: () => [{ created_at: Date.now(), assetRefs: 2 }],
    databaseStorageSnapshot: () => ({ retentionAllocatedBytes: 1024 }),
    pruneRuns: () => { prunes += 1; return { deletedRuns: 0 }; },
  };
  assert.equal(runRetentionPressure(database, 'default').pressured, false);
  assert.equal(maintainRunRetention(database, 'default').skipped, true);
  assert.equal(prunes, 0);
  assert.equal(maintainRunRetention(database, 'default', { force: true }).skipped, false);
  assert.equal(prunes, 1);
});

test('Atlas-only recovery polls Atlas descriptors and interrupts old provider evidence without querying it', async () => {
  const atlas = normalizeRunRecoveryDescriptor({ kind: 'atlas', taskId: 'prediction-1' });
  assert.equal(atlas.kind, 'atlas');
  assert.match(recoveryRequest('http://127.0.0.1:18766', atlas).url, /\/api\/proxy\/atlas\/poll\/prediction-1$/);

  let queryCount = 0;
  let terminalInput = null;
  const database = {
    completeRecoveredRunAttempt(input) {
      terminalInput = input;
      return { duplicate: true };
    },
  };
  const manager = new RunRecoveryManager({
    database,
    allowedRecoveryKinds: ['atlas', 'custom'],
    concurrency: 1,
    queryRecovery: async () => { queryCount += 1; throw new Error('must not query old providers'); },
  });
  const ticket = {
    run: { id: 'run-1', entityUid: 'run-uid', revision: 1 },
    nodeRun: { id: 'node-run-1', entityUid: 'node-run-uid', revision: 1 },
    attempt: {
      id: 'attempt-1', entityUid: 'attempt-uid', revision: 1, pollCount: 0,
      metadata: { recovery: { kind: 'runninghub', taskId: 'legacy-task' } },
    },
  };
  assert.equal(await manager.recoverTicket(ticket), 'interrupted');
  assert.equal(queryCount, 0);
  assert.equal(terminalInput.status, 'interrupted');
  assert.equal(terminalInput.error.code, 'RUN_RECOVERY_UNAVAILABLE');
  assert.match(terminalInput.error.message, /历史证据已保留/);
});

test('Render wiring enables Atlas-only runtime, keeps unified external gateway, and never schedules VACUUM', () => {
  const root = path.resolve(__dirname, '../../..');
  const server = fs.readFileSync(path.join(root, 'backend/src/server.js'), 'utf8');
  const render = fs.readFileSync(path.join(root, 'render.yaml'), 'utf8');
  const maintenance = fs.readFileSync(path.join(root, 'backend/src/services/runRetentionMaintenance.js'), 'utf8');
  const projectDatabase = fs.readFileSync(path.join(root, 'backend/src/services/projectDatabase.js'), 'utf8');
  const settingsUi = fs.readFileSync(path.join(root, 'src/components/ApiSettings.tsx'), 'utf8');
  assert.match(render, /key: T8_ATLAS_ONLY_RUNTIME[\s\S]*?value: 1/);
  assert.match(render, /key: T8PC_ASSET_PREVIEW_CONCURRENCY[\s\S]*?value: 1/);
  assert.match(server, /app\.use\('\/api\/proxy\/external', externalProvidersRouter\)/);
  assert.match(server, /atlas_only_runtime_disabled/);
  assert.match(server, /persistence: process\.env\.T8_PERSISTENT_DISK_CONFIGURED === '1' \? 'configured' : 'unknown'/);
  assert.match(projectDatabase, /T8_ATLAS_ONLY_RUNTIME === '1' \? 1000 : 5000/);
  assert.match(projectDatabase, /T8_ATLAS_ONLY_RUNTIME === '1' \? 20000 : 100000/);
  assert.match(projectDatabase, /T8_ATLAS_ONLY_RUNTIME === '1' \? 512 \* 1024 \* 1024/);
  assert.match(settingsUi, /持久化存储状态：未知/);
  assert.doesNotMatch(maintenance, /VACUUM/i);
});
