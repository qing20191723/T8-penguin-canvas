'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const router = express.Router();

const RESOURCE_DB_FILE = 'resource_library.json';
const DEFAULT_EAGLE_BASE = 'http://127.0.0.1:41595';

function safeText(value, fallback = '') {
  return String(value || fallback).trim().slice(0, 500);
}

function safeFilename(value, fallback = 'asset') {
  const cleaned = String(value || fallback)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120);
  return cleaned || fallback;
}

function readSettings() {
  try {
    if (!fs.existsSync(config.SETTINGS_FILE)) return {};
    return JSON.parse(fs.readFileSync(config.SETTINGS_FILE, 'utf-8'));
  } catch {
    return {};
  }
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

function readResourceDb() {
  const settings = readSettings();
  const root = String(settings.resourceLibraryPath || config.DEFAULT_RESOURCE_LIBRARY_DIR || '').trim();
  if (!root) return { root: '', db: { items: [] } };
  const file = path.join(root, RESOURCE_DB_FILE);
  try {
    if (!fs.existsSync(file)) return { root, db: { items: [] } };
    return { root, db: JSON.parse(fs.readFileSync(file, 'utf-8')) };
  } catch {
    return { root, db: { items: [] } };
  }
}

function resolveResourceFile(url) {
  const clean = normalizeLocalPathname(url);
  if (!clean) return null;
  const fileMatch = /^\/api\/resources\/file\/([^/?#]+)/.exec(clean);
  const setMatch = /^\/api\/resources\/set-file\/([^/?#]+)\/(\d+)/.exec(clean);
  if (!fileMatch && !setMatch) return null;
  const { root, db } = readResourceDb();
  if (!root) throw new Error('资源库路径未配置');
  const items = Array.isArray(db.items) ? db.items : [];
  if (fileMatch) {
    const item = items.find((x) => x.id === decodeURIComponent(fileMatch[1]));
    if (!item?.fileRel) throw new Error('资源库文件不存在');
    return assertInside(root, path.join(root, item.fileRel));
  }
  const setId = decodeURIComponent(setMatch[1]);
  const index = Number(setMatch[2]);
  const set = items.find((x) => x.id === setId && x.kind === 'set');
  const child = Array.isArray(set?.materialSetItems) ? set.materialSetItems[index] : null;
  if (!child?.fileRel) throw new Error('素材集文件不存在');
  return assertInside(root, path.join(root, child.fileRel));
}

function resolveEagleBase(rawValue) {
  const settings = readSettings();
  const raw = safeText(rawValue || settings.eagleApiBase || process.env.EAGLE_API_BASE || DEFAULT_EAGLE_BASE, DEFAULT_EAGLE_BASE);
  const u = new URL(raw);
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'http:') throw new Error('Eagle 接口只允许 http://127.0.0.1');
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    throw new Error('Eagle 接口只允许本机地址');
  }
  return `${u.protocol}//${u.host}`;
}

async function postEagle(base, endpoint, body) {
  const resp = await fetch(`${base}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!resp.ok) {
    throw new Error(json?.message || json?.error || `Eagle HTTP ${resp.status}`);
  }
  if (json && (json.status === 'error' || json.success === false)) {
    throw new Error(json.message || json.error || 'Eagle 导入失败');
  }
  return json || { status: 'success' };
}

async function addPathToEagle(base, filePath, payload) {
  try {
    return await postEagle(base, '/api/item/addFromPath', { ...payload, path: filePath });
  } catch (firstError) {
    return postEagle(base, '/api/item/addFromPaths', { ...payload, paths: [filePath] }).catch(() => {
      throw firstError;
    });
  }
}

async function addUrlToEagle(base, url, payload) {
  try {
    return await postEagle(base, '/api/item/addFromURL', { ...payload, url });
  } catch (firstError) {
    return postEagle(base, '/api/item/addFromURLs', { ...payload, urls: [url] }).catch(() => {
      throw firstError;
    });
  }
}

function makeTextAsset(material, index) {
  const dir = config.OUTPUT_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const name = safeFilename(material.name || `text-${index + 1}`, `text-${index + 1}`);
  const filePath = assertInside(dir, path.join(dir, `eagle_${Date.now()}_${index + 1}_${name}.txt`));
  fs.writeFileSync(filePath, String(material.text || ''), 'utf-8');
  return filePath;
}

function normalizeMaterials(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((item, index) => ({
      id: safeText(item?.id, `item_${index + 1}`),
      kind: safeText(item?.kind),
      url: safeText(item?.url),
      text: typeof item?.text === 'string' ? item.text : '',
      name: safeText(item?.name, ''),
      tags: Array.isArray(item?.tags) ? item.tags.map((x) => safeText(x)).filter(Boolean).slice(0, 20) : [],
    }))
    .filter((item) => item.kind === 'text' ? item.text.trim() : item.url);
}

router.get('/status', async (req, res) => {
  try {
    const base = resolveEagleBase(req.query.base);
    const resp = await fetch(`${base}/api/application/info`, { method: 'GET' });
    const data = await resp.json().catch(() => ({}));
    res.json({ success: resp.ok, data: { base, reachable: resp.ok, info: data } });
  } catch (e) {
    res.status(200).json({ success: false, error: e?.message || String(e) });
  }
});

router.post('/import', express.json({ limit: '4mb' }), async (req, res) => {
  try {
    const base = resolveEagleBase(req.body?.eagleApiBase);
    const materials = normalizeMaterials(req.body?.materials);
    if (materials.length === 0) return res.status(400).json({ success: false, error: '没有可发送到 Eagle 的素材' });

    const tags = Array.isArray(req.body?.tags)
      ? req.body.tags.map((x) => safeText(x)).filter(Boolean).slice(0, 30)
      : ['T8', '清尘画布'];
    const folderId = safeText(req.body?.folderId, '');
    const imported = [];
    const skipped = [];
    const failures = [];

    for (let i = 0; i < materials.length; i += 1) {
      const item = materials[i];
      const payload = {
        name: item.name || (item.kind === 'text' ? `文本 ${i + 1}` : path.basename(item.url || `素材 ${i + 1}`)),
        tags: [...new Set([...tags, ...item.tags])],
        ...(folderId ? { folderId } : {}),
      };
      try {
        if (item.kind === 'text') {
          const filePath = makeTextAsset(item, i);
          const result = await addPathToEagle(base, filePath, payload);
          imported.push({ kind: item.kind, name: payload.name, result });
          continue;
        }

        const localPath = resolveKnownLocalFile(item.url) || resolveResourceFile(item.url);
        if (localPath) {
          if (!fs.existsSync(localPath)) throw new Error('本地文件不存在');
          const result = await addPathToEagle(base, localPath, payload);
          imported.push({ kind: item.kind, name: payload.name, result });
          continue;
        }
        if (/^https?:\/\//i.test(item.url)) {
          const result = await addUrlToEagle(base, item.url, payload);
          imported.push({ kind: item.kind, name: payload.name, result });
          continue;
        }
        skipped.push({ kind: item.kind, name: payload.name, reason: '不支持的素材地址' });
      } catch (e) {
        failures.push({ kind: item.kind, name: payload.name, error: e?.message || String(e) });
      }
    }

    res.json({
      success: failures.length < materials.length,
      data: { base, imported, skipped, failures },
      error: failures.length >= materials.length ? (failures[0]?.error || 'Eagle 导入失败') : undefined,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

module.exports = router;
