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

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function sanitizeError(error) {
  return String(error?.message || error || 'unknown error').slice(0, 2000);
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
  if (summary.wan?.reason) lines.push(`- Wan status: ${summary.wan.reason}`);
  if (summary.wan?.taskId) lines.push(`- Wan task: \`${summary.wan.taskId}\``);
  if (summary.wan?.bytes) lines.push(`- Wan artifact: ${summary.wan.bytes.toLocaleString('en-US')} bytes`);
  if (summary.wan?.sha256) lines.push(`- Wan SHA-256: \`${summary.wan.sha256}\``);
  if (summary.errors?.length) lines.push('', '## Errors', ...summary.errors.map((error) => `- ${error}`));
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`, 'utf8');
}

async function postJsonOnce(route, body, idempotencyKey, timeoutMs) {
  const response = await fetch(`${BASE_URL}${route}`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      'X-T8-Submission-Id': idempotencyKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; }
  catch { throw new Error(`${route} returned non-JSON HTTP ${response.status}: ${text.slice(0, 500)}`); }
  if (!response.ok || payload.success !== true) {
    const code = String(payload.code || payload.error?.code || '').trim();
    const detail = payload.error?.message || payload.error || payload.message || text.slice(0, 500);
    throw new Error(`${route} failed HTTP ${response.status}${code ? ` [${code}]` : ''}: ${detail}`);
  }
  return payload.data || {};
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
    schema: 't8-atlas-paid-release-smoke-v4',
    sourceSha: process.env.GITHUB_SHA || '',
    renderBaseUrl: BASE_URL,
    startedAt: new Date().toISOString(),
    kimi: { ok: false, model: MODEL_KIMI },
    wan: { ok: false, model: MODEL_WAN },
    errors: [],
  };

  try {
    const result = await postJsonOnce('/api/proxy/external/llm', {
      providerId: 'atlas',
      model: MODEL_KIMI,
      messages: [{ role: 'user', content: 'Reply with exactly: KIMI_K3_OK' }],
      maxTokens: 1024,
      temperature: 0,
      timeoutMs: 120000,
    }, 'release-v1.0.0-kimi-final-v2', 180000);
    const text = String(result.text || '').trim();
    if (!text) throw new Error('Kimi K3 returned an empty response');
    summary.kimi = { ok: true, model: MODEL_KIMI, text: text.slice(0, 500), usage: result.usage || null };
  } catch (error) {
    const message = `Kimi K3: ${sanitizeError(error)}`;
    summary.kimi.error = message;
    summary.wan = {
      ok: false,
      skipped: true,
      model: MODEL_WAN,
      reason: 'Kimi failed, so Wan was not submitted to avoid unnecessary paid usage.',
    };
    summary.errors.push(message);
    summary.completedAt = new Date().toISOString();
    writeSummary(summary);
    throw new Error(`Paid release smoke stopped after Kimi: ${message}`);
  }

  try {
    const result = await postJsonOnce('/api/proxy/external/video', {
      providerId: 'atlas',
      model: MODEL_WAN,
      prompt: '@image1 remains centered while the camera performs a slow, stable push-in. One continuous shot, natural motion, no cuts.',
      images: [REFERENCE_IMAGE],
      duration: 5,
      resolution: '720P',
      aspectRatio: '1:1',
      timeoutMs: 2700000,
      providerParams: { pollIntervalMs: 3000 },
    }, 'release-v1.0.0-wan-final', 3000000);
    const url = Array.isArray(result.videoUrls) ? result.videoUrls[0] : '';
    if (!url) throw new Error('Wan 2.7 Spicy completed without a video URL');
    const artifact = await downloadWanArtifact(url);
    summary.wan = { ok: true, model: MODEL_WAN, taskId: result.taskId || '', ...artifact };
  } catch (error) {
    const message = `Wan 2.7 Spicy: ${sanitizeError(error)}`;
    summary.wan.error = message;
    summary.errors.push(message);
  }

  summary.completedAt = new Date().toISOString();
  writeSummary(summary);
  if (summary.errors.length) throw new Error(`Paid release smoke failed: ${summary.errors.join(' | ')}`);
  console.log(`[atlas-release-smoke] Kimi K3 passed: ${summary.kimi.text}`);
  console.log(`[atlas-release-smoke] Wan passed: task=${summary.wan.taskId} bytes=${summary.wan.bytes} sha256=${summary.wan.sha256}`);
}

main().catch((error) => {
  console.error(`[atlas-release-smoke] ${sanitizeError(error)}`);
  process.exitCode = 1;
});
