'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { ensureFigmaBridgeRunning } = require('../utils/figmaBridge');

const router = express.Router();

const DEFAULT_FIGMA_BRIDGE_BASE = 'http://localhost:3845';
const FIGMA_BRIDGE_TIMEOUT_MS = 8000;

function safeText(value, fallback = '', limit = 1000) {
  return String(value || fallback).trim().slice(0, limit);
}

function assertInside(root, target) {
  const r = path.resolve(root);
  const t = path.resolve(target);
  if (t === r || t.startsWith(r + path.sep)) return t;
  throw new Error('路径越界');
}

function normalizeLocalPathname(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const host = u.hostname.toLowerCase();
      if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') return '';
      return decodeURIComponent(u.pathname || '');
    } catch {
      return '';
    }
  }
  return raw.split(/[?#]/)[0];
}

function resolveKnownLocalFile(url) {
  const clean = normalizeLocalPathname(url);
  if (!clean) return null;
  const decodeTail = (prefix) => decodeURIComponent(clean.slice(prefix.length)).replace(/^[/\\]+/, '');
  if (clean.startsWith('/files/output/')) {
    const rel = decodeTail('/files/output/');
    return assertInside(config.OUTPUT_DIR, path.join(config.OUTPUT_DIR, rel));
  }
  if (clean.startsWith('/output/')) {
    const rel = decodeTail('/output/');
    return assertInside(config.OUTPUT_DIR, path.join(config.OUTPUT_DIR, rel));
  }
  if (clean.startsWith('/files/input/')) {
    const rel = decodeTail('/files/input/');
    return assertInside(config.INPUT_DIR, path.join(config.INPUT_DIR, rel));
  }
  if (clean.startsWith('/input/')) {
    const rel = decodeTail('/input/');
    return assertInside(config.INPUT_DIR, path.join(config.INPUT_DIR, rel));
  }
  return null;
}

function resolveFigmaBase(rawValue) {
  const raw = safeText(rawValue || process.env.FIGMA_BRIDGE_BASE || DEFAULT_FIGMA_BRIDGE_BASE, DEFAULT_FIGMA_BRIDGE_BASE);
  const u = new URL(raw);
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'http:') throw new Error('Figma 桥接接口只允许 http://localhost / 127.0.0.1');
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    throw new Error('Figma 桥接接口只允许本机地址');
  }
  return `${u.protocol}//${u.host}`;
}

function normalizeMaterials(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((item, index) => ({
      id: safeText(item?.id, `item_${index + 1}`, 120),
      kind: safeText(item?.kind, '', 30),
      url: safeText(item?.url, '', 4000),
      text: typeof item?.text === 'string' ? item.text.slice(0, 200000) : '',
      name: safeText(item?.name, '', 240),
    }))
    .filter((item) => (item.kind === 'text' ? item.text.trim() : item.url));
}

function absoluteLocalUrl(url) {
  const clean = String(url || '').trim();
  if (!clean) return '';
  if (/^https?:\/\//i.test(clean)) return clean;
  if (!clean.startsWith('/')) return clean;
  return `http://127.0.0.1:${config.PORT}${clean}`;
}

function materialToBridgeItem(item) {
  const localPath = item.url ? resolveKnownLocalFile(item.url) : null;
  return {
    id: item.id,
    kind: item.kind,
    name: item.name || (item.kind === 'text' ? `文本 ${item.id}` : path.basename(item.url || '素材')),
    url: item.kind === 'text' ? undefined : absoluteLocalUrl(item.url),
    path: localPath && fs.existsSync(localPath) ? localPath : undefined,
    text: item.kind === 'text' ? item.text : undefined,
  };
}

async function postFigma(base, endpoint, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FIGMA_BRIDGE_TIMEOUT_MS);
  try {
    const resp = await fetch(`${base}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await resp.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!resp.ok) throw new Error(json?.message || json?.error || `Figma bridge HTTP ${resp.status}`);
    if (json && (json.success === false || json.status === 'error')) {
      throw new Error(json.message || json.error || 'Figma 导入失败');
    }
    return json || { success: true };
  } catch (e) {
    if (e?.name === 'AbortError') {
      throw new Error(`Figma bridge ${endpoint} 超时，请确认插件已启动并监听 ${base}`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

router.post('/import', express.json({ limit: '8mb' }), async (req, res) => {
  try {
    const base = resolveFigmaBase(req.body?.figmaApiBase);
    const materials = normalizeMaterials(req.body?.materials);
    if (materials.length === 0) {
      return res.status(400).json({ success: false, error: '没有可发送到 Figma 的素材' });
    }
    const bridgeReady = await ensureFigmaBridgeRunning({ base, logger: console });
    if (!bridgeReady.ok) {
      throw new Error(bridgeReady.message || 'Figma bridge 自动启动失败');
    }
    const payload = {
      app: 't8-penguin-canvas',
      tags: Array.isArray(req.body?.tags) ? req.body.tags.map((x) => safeText(x, '', 60)).filter(Boolean).slice(0, 20) : ['T8', '清尘画布'],
      materials: materials.map(materialToBridgeItem),
    };
    let result;
    try {
      result = await postFigma(base, '/import', payload);
    } catch (firstError) {
      result = await postFigma(base, '/api/import', payload).catch(() => {
        throw firstError;
      });
    }
    res.json({
      success: true,
      data: {
        base,
        sent: payload.materials.length,
        result,
      },
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      error: `${e?.message || String(e)}。画布会自动启动本机 Figma bridge；请确认 Figma 插件窗口已打开。`,
    });
  }
});

module.exports = router;
