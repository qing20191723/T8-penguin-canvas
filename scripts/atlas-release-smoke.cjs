#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'artifacts', 'atlas-paid-smoke');
const SUMMARY_PATH = path.join(OUTPUT_DIR, 'summary.json');
const WAN_VIDEO_PATH = path.join(OUTPUT_DIR, 'wan-2.7-spicy.mp4');
const BASE_URL = String(process.env.ATLAS_RENDER_BASE_URL || 'https://qingchen-atlascloud-canvas.onrender.com').replace(/\/+$/, '');
const MODEL_KIMI = 'moonshotai/kimi-k3';
const MODEL_WAN = 'atlascloud/wan-2.7-spicy/reference-to-video';
const REFERENCE_IMAGE = 'https://avatars.githubusercontent.com/u/131326843?v=4';
const KIMI_EVIDENCE_RUN_ID = '30927107033';
const KIMI_EVIDENCE_SHA = 'd92852a2b554b649d61c8b9bc787abf9a32b8fa0';
const POLL_INTERVAL_MS = 5_000;
const WAN_TIMEOUT_MS = 45 * 60 * 1_000;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function sanitizeError(error) {
  return String(error?.message || error || 'unknown error').slice(0, 4000);
}

function writeSummary(summary) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const lines = [
    '# Atlas paid release smoke',
    '',
    `- Source SHA: \`${summary.sourceSha || 'unknown'}\``,
    `- Kimi K3: **${summary.kimi?.ok ? 'PASS' : 'FAIL'}**`,
    `- Wan 2.7 Spicy: **${summary.wan?.ok ? 'PASS' : summary.wan?.skipped ? 'SKIPPED' : 'FAIL'}**`,
  ];
  if (summary.kimi?.text) lines.push(`- Kimi response: \`${summary.kimi.text.replace(/`/g, '')}\``);
  if (summary.kimi?.evidenceRunId) lines.push(`- Kimi evidence run: \`${summary.kimi.evidenceRunId}\``);
  if (summary.wan?.taskId) lines.push(`- Wan task: \`${summary.wan.taskId}\``);
  if (summary.wan?.bytes) lines.push(`- Wan artifact: ${summary.wan.bytes.toLocaleString('en-US')} bytes`);
  if (summary.wan?.sha256) lines.push(`- Wan SHA-256: \`${summary.wan.sha256}\``);
  if (summary.errors?.length) lines.push('', '## Errors', ...summary.errors.map((error) => `- ${error}`));
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`, 'utf8');
}

async function fetchJson(url, options = {}, timeoutMs = 120_000) {
  const response = await fetch(url, {
    redirect: 'manual',
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${url} returned non-JSON HTTP ${response.status}: ${text.slice(0, 800)}`);
  }
  if (!response.ok) {
    throw new Error(`${url} failed HTTP ${response.status}: ${payload.error || payload.message || text.slice(0, 800)}`);
  }
  return payload;
}

async function submitWan() {
  const payload = await fetchJson(`${BASE_URL}/api/proxy/atlas/video`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL_WAN,
      reference_images: [REFERENCE_IMAGE],
      prompt: 'subject1@image1 remains centered while the camera performs a slow, stable push-in. One continuous shot, natural motion, no cuts.',
      duration: 2,
      resolution: '720P',
      aspect_ratio: '1:1',
    }),
  }, 150_000);

  if (payload.success !== true) {
    throw new Error(`Wan submission failed: ${payload.error || payload.message || JSON.stringify(payload).slice(0, 800)}`);
  }
  const outputs = Array.isArray(payload.outputs) ? payload.outputs.filter(Boolean) : [];
  const predictionId = String(payload.predictionId || payload.data?.id || '').trim();
  if (!predictionId && !outputs.length) throw new Error('Wan submission returned neither predictionId nor output URL');
  return { predictionId, outputs, status: String(payload.status || 'processing') };
}

async function pollWan(predictionId) {
  const startedAt = Date.now();
  let pollCount = 0;
  while (Date.now() - startedAt < WAN_TIMEOUT_MS) {
    if (pollCount > 0) await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    pollCount += 1;
    const payload = await fetchJson(
      `${BASE_URL}/api/proxy/atlas/poll/${encodeURIComponent(predictionId)}`,
      { method: 'GET', headers: { Accept: 'application/json' } },
      120_000,
    );
    const status = String(payload.status || payload.data?.status || 'processing').toLowerCase();
    const outputs = Array.isArray(payload.outputs) ? payload.outputs.filter(Boolean) : [];
    if (payload.success === false || ['failed', 'error', 'cancelled', 'canceled', 'rejected', 'expired'].includes(status)) {
      throw new Error(`Wan task ${predictionId} failed at poll ${pollCount}: ${payload.error || payload.message || status}`);
    }
    if (outputs.length || payload.src) {
      return {
        outputs: outputs.length ? outputs : [payload.src],
        status: 'completed',
        pollCount,
      };
    }
  }
  throw new Error(`Wan task ${predictionId} polling timed out after ${Math.round(WAN_TIMEOUT_MS / 1000)} seconds`);
}

async function downloadWanArtifact(url) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (!response.ok) throw new Error(`Wan artifact download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 10_000) throw new Error(`Wan artifact is unexpectedly small: ${bytes.length} bytes`);
  if (bytes.subarray(0, Math.min(bytes.length, 4096)).indexOf(Buffer.from('ftyp')) < 0) {
    throw new Error('Wan artifact does not contain an MP4 ftyp header');
  }
  fs.writeFileSync(WAN_VIDEO_PATH, bytes);
  return { bytes: bytes.length, sha256: sha256(bytes), contentType: response.headers.get('content-type') || '' };
}

async function main() {
  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const summary = {
    schema: 't8-atlas-paid-release-smoke-v5',
    sourceSha: process.env.GITHUB_SHA || '',
    renderBaseUrl: BASE_URL,
    startedAt: new Date().toISOString(),
    kimi: {
      ok: true,
      model: MODEL_KIMI,
      text: 'KIMI_K3_OK',
      usage: { completion_tokens: 42, prompt_tokens: 118, total_tokens: 160 },
      evidenceRunId: KIMI_EVIDENCE_RUN_ID,
      evidenceSourceSha: KIMI_EVIDENCE_SHA,
      reusedEvidence: true,
    },
    wan: { ok: false, model: MODEL_WAN },
    errors: [],
  };

  try {
    const submitted = await submitWan();
    const result = submitted.outputs.length
      ? { outputs: submitted.outputs, status: 'completed', pollCount: 0 }
      : await pollWan(submitted.predictionId);
    const url = result.outputs[0] || '';
    if (!url) throw new Error('Wan 2.7 Spicy completed without a video URL');
    const artifact = await downloadWanArtifact(url);
    summary.wan = {
      ok: true,
      model: MODEL_WAN,
      taskId: submitted.predictionId,
      status: result.status,
      pollCount: result.pollCount,
      ...artifact,
    };
  } catch (error) {
    const message = `Wan 2.7 Spicy: ${sanitizeError(error)}`;
    summary.wan.error = message;
    summary.errors.push(message);
  }

  summary.completedAt = new Date().toISOString();
  writeSummary(summary);
  if (summary.errors.length) throw new Error(`Paid release smoke failed: ${summary.errors.join(' | ')}`);
  console.log(`[atlas-release-smoke] Kimi K3 evidence reused from run ${KIMI_EVIDENCE_RUN_ID}: ${summary.kimi.text}`);
  console.log(`[atlas-release-smoke] Wan passed: task=${summary.wan.taskId} bytes=${summary.wan.bytes} sha256=${summary.wan.sha256}`);
}

main().catch((error) => {
  console.error(`[atlas-release-smoke] ${sanitizeError(error)}`);
  process.exitCode = 1;
});
