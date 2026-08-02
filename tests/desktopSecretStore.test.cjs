const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const store = require('../backend/src/services/desktopSecretStore');

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`protected:${value}`, 'utf8'),
    decryptString: (value) => {
      const text = Buffer.from(value).toString('utf8');
      if (!text.startsWith('protected:')) throw new Error('invalid ciphertext');
      return text.slice('protected:'.length);
    },
  };
}

test('desktop secret store persists only encrypted provider credentials', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 't8-desktop-secrets-'));
  t.after(() => {
    store.configureSafeStorageForTests(undefined);
    fs.rmSync(temp, { recursive: true, force: true });
  });
  store.configureSafeStorageForTests(fakeSafeStorage());
  const file = path.join(temp, 'provider-secrets.enc.json');
  const atlasKey = 'atlas-desktop-secret-123456';
  const customKey = 'custom-desktop-secret-654321';
  store.writeSecrets(file, {
    providers: {
      atlas: { apiKey: atlasKey },
      'custom-api': { apiKey: customKey },
    },
    cloudUploads: {
      'tencent-cos': { tencentCos: { secretId: 'cos-id-secret', secretKey: 'cos-key-secret' } },
    },
  });
  const disk = fs.readFileSync(file, 'utf8');
  assert.equal(disk.includes(atlasKey), false);
  assert.equal(disk.includes(customKey), false);
  assert.equal(disk.includes('cos-key-secret'), false);
  const decrypted = store.readSecrets(file);
  assert.deepEqual(decrypted.providers, {
    atlas: { apiKey: atlasKey },
    'custom-api': { apiKey: customKey },
  });
  assert.equal(decrypted.cloudUploads['tencent-cos'].tencentCos.secretKey, 'cos-key-secret');
});

test('desktop secret store fails closed when Electron safeStorage is unavailable', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 't8-desktop-secrets-offline-'));
  t.after(() => {
    store.configureSafeStorageForTests(undefined);
    fs.rmSync(temp, { recursive: true, force: true });
  });
  store.configureSafeStorageForTests({ isEncryptionAvailable: () => false });
  const file = path.join(temp, 'provider-secrets.enc.json');
  assert.throws(
    () => store.writeSecrets(file, { providers: { atlas: { apiKey: 'must-not-persist' } } }),
    (error) => error?.code === 'desktop_secure_storage_unavailable',
  );
  assert.equal(fs.existsSync(file), false);
});
