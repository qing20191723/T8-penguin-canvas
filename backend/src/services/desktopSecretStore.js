const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SCHEMA = 't8-desktop-secret-store-v1';
const LEGACY_SECRET_FIELDS = [
  'zhenzhenApiKey',
  'zhenzhenSd2ApiKey',
  'rhApiKey',
  'rhIntlApiKey',
  'llmApiKey',
  'gptImageApiKey',
  'nanoBananaApiKey',
  'mjApiKey',
  'veoApiKey',
  'soraApiKey',
  'grokApiKey',
  'seedanceApiKey',
  'sunoApiKey',
];
const CLOUD_SECRET_FIELDS = {
  tencentCos: ['secretId', 'secretKey'],
  aliyunOss: ['accessKeyId', 'accessKeySecret'],
  baiduNetdisk: ['password'],
  quarkNetdisk: ['password'],
};

let safeStorageOverride;

function secretError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function cleanSecret(value) {
  const secret = typeof value === 'string' ? value.trim() : '';
  return secret && !/^\*{2,}/.test(secret) ? secret : '';
}

function resolveSafeStorage() {
  if (safeStorageOverride !== undefined) return safeStorageOverride;
  try {
    return require('electron')?.safeStorage || null;
  } catch (_) {
    return null;
  }
}

function requireSafeStorage() {
  const safeStorage = resolveSafeStorage();
  if (!safeStorage
    || typeof safeStorage.isEncryptionAvailable !== 'function'
    || safeStorage.isEncryptionAvailable() !== true
    || typeof safeStorage.encryptString !== 'function'
    || typeof safeStorage.decryptString !== 'function') {
    throw secretError(
      'desktop_secure_storage_unavailable',
      'Windows 安全存储当前不可用，API Key 未保存。请重新登录 Windows 后再试。',
    );
  }
  return safeStorage;
}

function emptyPayload() {
  return { legacy: {}, providers: {}, cloudUploads: {} };
}

function normalizePayload(value) {
  const payload = emptyPayload();
  if (!isPlainObject(value)) return payload;
  if (isPlainObject(value.legacy)) {
    for (const field of LEGACY_SECRET_FIELDS) {
      const secret = cleanSecret(value.legacy[field]);
      if (secret) payload.legacy[field] = secret;
    }
  }
  if (isPlainObject(value.providers)) {
    for (const [id, raw] of Object.entries(value.providers)) {
      if (!/^[a-z0-9][a-z0-9_-]{1,47}$/.test(id) || !isPlainObject(raw)) continue;
      const provider = {};
      const apiKey = cleanSecret(raw.apiKey);
      if (apiKey) provider.apiKey = apiKey;
      const accessKeyId = cleanSecret(raw.accessKeyId);
      const secretAccessKey = cleanSecret(raw.secretAccessKey);
      if (accessKeyId) provider.accessKeyId = accessKeyId;
      if (secretAccessKey) provider.secretAccessKey = secretAccessKey;
      if (Object.keys(provider).length) payload.providers[id] = provider;
    }
  }
  if (isPlainObject(value.cloudUploads)) {
    for (const [id, raw] of Object.entries(value.cloudUploads)) {
      if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(id) || !isPlainObject(raw)) continue;
      const target = {};
      for (const [section, fields] of Object.entries(CLOUD_SECRET_FIELDS)) {
        if (!isPlainObject(raw[section])) continue;
        const secretSection = {};
        for (const field of fields) {
          const secret = cleanSecret(raw[section][field]);
          if (secret) secretSection[field] = secret;
        }
        if (Object.keys(secretSection).length) target[section] = secretSection;
      }
      if (Object.keys(target).length) payload.cloudUploads[id] = target;
    }
  }
  return payload;
}

function hasSecrets(payload) {
  const normalized = normalizePayload(payload);
  return Object.keys(normalized.legacy).length > 0
    || Object.keys(normalized.providers).length > 0
    || Object.keys(normalized.cloudUploads).length > 0;
}

function mergePayload(base, incoming) {
  const left = normalizePayload(base);
  const right = normalizePayload(incoming);
  const providers = { ...left.providers };
  for (const [id, secrets] of Object.entries(right.providers)) {
    providers[id] = { ...(providers[id] || {}), ...secrets };
  }
  const cloudUploads = { ...left.cloudUploads };
  for (const [id, sections] of Object.entries(right.cloudUploads)) {
    const mergedSections = { ...(cloudUploads[id] || {}) };
    for (const [section, secrets] of Object.entries(sections)) {
      mergedSections[section] = { ...(mergedSections[section] || {}), ...secrets };
    }
    cloudUploads[id] = mergedSections;
  }
  return {
    legacy: { ...left.legacy, ...right.legacy },
    providers,
    cloudUploads,
  };
}

function atomicWriteJson(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`,
  );
  try {
    const fd = fs.openSync(tempPath, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, `${JSON.stringify(value)}\n`, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tempPath, filePath);
    try { fs.chmodSync(filePath, 0o600); } catch (_) {}
  } catch (error) {
    try { fs.rmSync(tempPath, { force: true }); } catch (_) {}
    throw error;
  }
}

function readSecrets(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return emptyPayload();
  let envelope;
  try {
    envelope = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    throw secretError('desktop_secret_store_invalid', '桌面密钥存储文件无法读取');
  }
  if (envelope?.schema !== SCHEMA || envelope?.version !== 1 || typeof envelope?.ciphertext !== 'string') {
    throw secretError('desktop_secret_store_invalid', '桌面密钥存储文件格式无效');
  }
  try {
    const plaintext = requireSafeStorage().decryptString(Buffer.from(envelope.ciphertext, 'base64'));
    return normalizePayload(JSON.parse(plaintext));
  } catch (error) {
    if (error?.code) throw error;
    throw secretError('desktop_secret_store_decrypt_failed', 'Windows 无法解密当前用户的 API Key');
  }
}

function writeSecrets(filePath, payload) {
  const normalized = normalizePayload(payload);
  if (!hasSecrets(normalized)) return normalized;
  const ciphertext = requireSafeStorage().encryptString(JSON.stringify(normalized));
  atomicWriteJson(filePath, {
    schema: SCHEMA,
    version: 1,
    ciphertext: Buffer.from(ciphertext).toString('base64'),
    updatedAt: new Date().toISOString(),
  });
  return normalized;
}

function extractSecrets(settings) {
  const payload = emptyPayload();
  const source = isPlainObject(settings) ? settings : {};
  for (const field of LEGACY_SECRET_FIELDS) {
    const secret = cleanSecret(source[field]);
    if (secret) payload.legacy[field] = secret;
  }
  for (const raw of Array.isArray(source.advancedProviders) ? source.advancedProviders : []) {
    if (!isPlainObject(raw)) continue;
    const id = String(raw.id || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{1,47}$/.test(id)) continue;
    const apiKey = cleanSecret(raw.apiKey);
    const accessKeyId = cleanSecret(raw.volcengineConfig?.accessKeyId);
    const secretAccessKey = cleanSecret(raw.volcengineConfig?.secretAccessKey);
    const provider = {};
    if (apiKey) provider.apiKey = apiKey;
    if (accessKeyId) provider.accessKeyId = accessKeyId;
    if (secretAccessKey) provider.secretAccessKey = secretAccessKey;
    if (Object.keys(provider).length) payload.providers[id] = provider;
  }
  for (const raw of Array.isArray(source.cloudUploadTargets) ? source.cloudUploadTargets : []) {
    if (!isPlainObject(raw)) continue;
    const id = String(raw.id || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(id)) continue;
    const target = {};
    for (const [section, fields] of Object.entries(CLOUD_SECRET_FIELDS)) {
      if (!isPlainObject(raw[section])) continue;
      const secretSection = {};
      for (const field of fields) {
        const secret = cleanSecret(raw[section][field]);
        if (secret) secretSection[field] = secret;
      }
      if (Object.keys(secretSection).length) target[section] = secretSection;
    }
    if (Object.keys(target).length) payload.cloudUploads[id] = target;
  }
  return payload;
}

function stripSecrets(settings) {
  const next = { ...(isPlainObject(settings) ? settings : {}) };
  for (const field of LEGACY_SECRET_FIELDS) next[field] = '';
  next.advancedProviders = (Array.isArray(next.advancedProviders) ? next.advancedProviders : []).map((raw) => {
    const provider = { ...raw, apiKey: '' };
    if (isPlainObject(provider.volcengineConfig)) {
      provider.volcengineConfig = {
        ...provider.volcengineConfig,
        accessKeyId: '',
        secretAccessKey: '',
      };
    }
    return provider;
  });
  next.cloudUploadTargets = (Array.isArray(next.cloudUploadTargets) ? next.cloudUploadTargets : []).map((raw) => {
    const target = { ...raw };
    for (const [section, fields] of Object.entries(CLOUD_SECRET_FIELDS)) {
      if (!isPlainObject(target[section])) continue;
      target[section] = { ...target[section] };
      for (const field of fields) target[section][field] = '';
    }
    return target;
  });
  return next;
}

function applySecrets(settings, payload) {
  const next = stripSecrets(settings);
  const normalized = normalizePayload(payload);
  for (const [field, secret] of Object.entries(normalized.legacy)) next[field] = secret;
  next.advancedProviders = next.advancedProviders.map((raw) => {
    const provider = { ...raw };
    const secrets = normalized.providers[String(provider.id || '').trim().toLowerCase()];
    if (!secrets) return provider;
    if (secrets.apiKey) provider.apiKey = secrets.apiKey;
    if (isPlainObject(provider.volcengineConfig)
      && (secrets.accessKeyId || secrets.secretAccessKey)) {
      provider.volcengineConfig = {
        ...provider.volcengineConfig,
        ...(secrets.accessKeyId ? { accessKeyId: secrets.accessKeyId } : {}),
        ...(secrets.secretAccessKey ? { secretAccessKey: secrets.secretAccessKey } : {}),
      };
    }
    return provider;
  });
  next.cloudUploadTargets = next.cloudUploadTargets.map((raw) => {
    const target = { ...raw };
    const secretTarget = normalized.cloudUploads[String(target.id || '').trim().toLowerCase()];
    if (!secretTarget) return target;
    for (const [section, secrets] of Object.entries(secretTarget)) {
      if (!isPlainObject(target[section])) continue;
      target[section] = { ...target[section], ...secrets };
    }
    return target;
  });
  return next;
}

function configureSafeStorageForTests(value) {
  safeStorageOverride = value;
}

module.exports = {
  SCHEMA,
  LEGACY_SECRET_FIELDS,
  applySecrets,
  configureSafeStorageForTests,
  extractSecrets,
  hasSecrets,
  mergePayload,
  readSecrets,
  stripSecrets,
  writeSecrets,
};
