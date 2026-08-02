'use strict';

function runRetentionPressure(database, projectId) {
  const policy = database.getRunRetentionPolicy(projectId);
  const rows = database.runRetentionRows(projectId);
  const storage = database.databaseStorageSnapshot();
  const now = Date.now();
  const oldestCreatedAt = rows.reduce((oldest, row) => Math.min(oldest, Number(row.created_at) || now), now);
  const assetRefs = rows.reduce((sum, row) => sum + (Number(row.assetRefs) || 0), 0);
  return {
    pressured: rows.length > policy.maxRuns
      || assetRefs > policy.maxAssetRefs
      || Number(storage.retentionAllocatedBytes || 0) > policy.maxDbBytes
      || (rows.length > 0 && oldestCreatedAt < now - policy.maxDays * 24 * 60 * 60 * 1000),
    rows: rows.length,
    assetRefs,
    allocatedBytes: Number(storage.retentionAllocatedBytes || 0),
    policy,
  };
}

function maintainRunRetention(database, projectId, options = {}) {
  const pressure = runRetentionPressure(database, projectId);
  if (!options.force && !pressure.pressured) {
    return { skipped: true, reason: 'below-pressure-thresholds', pressure };
  }
  return { skipped: false, pressure, result: database.pruneRuns(projectId) };
}

module.exports = { maintainRunRetention, runRetentionPressure };
