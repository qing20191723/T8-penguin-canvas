#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const atlas = require('../backend/src/providers/atlas');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'artifacts', 'atlas-paid-smoke');
const SUMMARY_PATH = path.join(OUTPUT_DIR, 'summary.json');
const WAN_VIDEO_PATH = path.join(OUTPUT_DIR, 'wan-2.7-spicy.mp4');
const MODEL_KIMI = 'moonshotai/kimi-k3';
const MODEL_WAN = 'atlascloud/wan-2.7-spicy/reference-to-video';
const REFERENCE_IMAGE = 'https://avatars.githubusercontent.com/u/131326843?v=4';

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function sanitizeError(error) {
  return String(error?.message || error || 'unknown error')
    .replace(String(process.env.ATLASCLOUD_API_KEY || ''), '[REDACTED]')
    .slice(0, 2000);
}

function writeSummary(summary) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  const stepSummary = process.env.GITHUB_STEP_SUMMARY;
  if (!stepSummary) return;
  const lines = [
    '# Atlas paid release smoke',
    '',
    `- Source SHA: \`${summary.sourceSha || 'unknown'}\``,
    `- Kimi K3: **${summary.kimi?.ok ? 'PASS' : 'FAIL'}**`,
    `- Wan 2.7 Spicy: **${summary.wan?.ok ? 'PASS' : 'FAIL'}**`,
  ];
  if (summary.kimi?.text) lines.push(`- Kimi response: \`${summary.kimi.text.replace(/`/g, '')}\``);
  if (summary.wan?.taskId) lines.push(`- Wan task: \`${summary.wan.taskId}\``);
  if (summary.wan?.bytes) lines.push(`- Wan artifact: ${summary.wan.bytes.toLocaleString('en-US')} bytes`);
  if (summary.wan?.sha256) lines.push(`- Wan SHA-256: \`${summary.wan.sha256}\``);
  if (summary.errors?.length) {
    lines.push('', '## Errors');
    for (const error of summary.errors) lines.push(`- ${error}`);
  }
  fs.appendFileSync(stepSummary, `${lines.join('\n')}\n`, 'utf8');
}

async function downloadWanArtifact(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!response.ok) throw new Error(`Wan artifact download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 10_000) throw new Error(`Wan artifact is unexpectedly small: ${bytes.length} bytes`);
  const header = bytes.subarray(0, Math.min(bytes.length, 4096));
  if (header.indexOf(Buffer.from('ftyp')) < 0) throw new Error('Wan artifact does not contain an MP4 ftyp header');
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(WAN_VIDEO_PATH, bytes);
  return {
    bytes: bytes.length,
    sha256: sha256(bytes),
    contentType: response.headers.get('content-type') || '',
  };
}

async function main() {
  const key = String(process.env.ATLASCLOUD_API_KEY || '').trim();
  if (!key) throw new Error('ATLASCLOUD_API_KEY is not configured; no paid request was submitted');

  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const provider = {
    id: 'atlas',
    label: 'Atlas Cloud',
    protocol: 'atlas',
    baseUrl: 'https://api.atlascloud.ai/api/v1',
    apiKey: key,
    defaults: { pollIntervalMs: 3000 },
  };
  const summary = {
    schema: 't8-atlas-paid-release-smoke-v1',
    sourceSha: process.env.GITHUB_SHA || '',
    startedAt: new Date().toISOString(),
    kimi: { ok: false, model: MODEL_KIMI },
    wan: { ok: false, model: MODEL_WAN },
    errors: [],
  };

  try {
    const result = await atlas.generateChat(provider, {
      model: MODEL_KIMI,
      messages: [{ role: 'user', content: 'Reply with exactly: KIMI_K3_OK' }],
      maxTokens: 512,
      temperature: 0,
    }, { timeoutMs: 2 * 60 * 1000 });
    if (!result?.ok) throw new Error(result?.error || 'Kimi K3 request failed');
    const text = String(result.text || '').trim();
    if (!text) throw new Error('Kimi K3 returned an empty response');
    summary.kimi = {
      ok: true,
      model: MODEL_KIMI,
      text: text.slice(0, 500),
      requestId: result.requestId || '',
      upstreamHttpStatus: result.upstreamHttpStatus || 0,
    };
  } catch (error) {
    const message = `Kimi K3: ${sanitizeError(error)}`;
    summary.kimi.error = message;
    summary.errors.push(message);
  }

  try {
    const result = await atlas.generateVideo(provider, {
      model: MODEL_WAN,
      prompt: '@image1 remains centered while the camera performs a slow, stable push-in. One continuous shot, natural motion, no cuts.',
      images: [REFERENCE_IMAGE],
      duration: 5,
      resolution: '720P',
      aspectRatio: '1:1',
      providerParams: { pollIntervalMs: 3000 },
    }, { timeoutMs: 45 * 60 * 1000 });
    if (!result?.ok) throw new Error(result?.error || 'Wan 2.7 Spicy request failed');
    const url = Array.isArray(result.videoUrls) ? result.videoUrls[0] : '';
    if (!url) throw new Error('Wan 2.7 Spicy completed without a video URL');
    const artifact = await downloadWanArtifact(url);
    summary.wan = {
      ok: true,
      model: MODEL_WAN,
      taskId: result.taskId || '',
      requestId: result.requestId || '',
      upstreamHttpStatus: result.upstreamHttpStatus || 0,
      pollCount: result.pollCount || 0,
      ...artifact,
    };
  } catch (error) {
    const message = `Wan 2.7 Spicy: ${sanitizeError(error)}`;
    summary.wan.error = message;
    summary.errors.push(message);
  }

  summary.completedAt = new Date().toISOString();
  writeSummary(summary);
  if (summary.errors.length) {
    throw new Error(`Paid release smoke failed: ${summary.errors.join(' | ')}`);
  }
  console.log(`[atlas-release-smoke] Kimi K3 passed: ${summary.kimi.text}`);
  console.log(`[atlas-release-smoke] Wan passed: task=${summary.wan.taskId} bytes=${summary.wan.bytes} sha256=${summary.wan.sha256}`);
}

main().catch((error) => {
  console.error(`[atlas-release-smoke] ${sanitizeError(error)}`);
  process.exitCode = 1;
});
