const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  MAX_INSTALLER_BYTES,
  validatePackagePolicy,
  verifyArtifact,
} = require('../scripts/verify-desktop-atlas-package.cjs');
const { validateInstallTree } = require('../scripts/verify-desktop-atlas-install.cjs');

const packageJson = require('../package.json');

test('desktop Atlas package targets the fork and excludes disabled product resources', () => {
  assert.deepEqual(validatePackagePolicy(packageJson, [
    fs.readFileSync(path.join(__dirname, '..', 'scripts', 'dist-release.cjs'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '..', 'scripts', 'release-github.cjs'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '..', 'scripts', 'verify-github-release.cjs'), 'utf8'),
  ]), []);
});

test('artifact verifier enforces 500 MiB and writes an exact SHA-256 sidecar', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't8-atlas-artifact-'));
  try {
    const dist = path.join(root, 'dist_electron');
    fs.mkdirSync(dist);
    const name = `${packageJson.build.productName}-Setup-${packageJson.version}.exe`;
    const installer = path.join(dist, name);
    fs.writeFileSync(installer, Buffer.from('test installer'));
    fs.writeFileSync(`${installer}.blockmap`, 'blockmap');
    fs.writeFileSync(path.join(dist, 'latest.yml'), 'version: 1.0.0');
    const result = verifyArtifact(root, packageJson);
    const expected = crypto.createHash('sha256').update('test installer').digest('hex');
    assert.equal(result.size < MAX_INSTALLER_BYTES, true);
    assert.equal(result.sha256, expected);
    assert.equal(fs.readFileSync(`${installer}.sha256`, 'utf8'), `${expected}  ${name}\n`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('clean installed tree passes and disabled bridges or secrets fail', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't8-atlas-install-'));
  const write = (relative, value = 'ok') => {
    const target = path.join(root, ...relative.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, value);
  };
  try {
    write('Qingchen-AtlasCanvas.exe');
    write('resources/app.asar');
    write('resources/app-update.yml', 'owner: qing20191723\nrepo: T8-penguin-canvas\n');
    write('resources/backend-enc/server.t8c');
    write('resources/frontend/index.html');
    write('resources/tools/ffmpeg/ffmpeg.exe');
    write('resources/tools/ffmpeg/ffprobe.exe');
    assert.deepEqual(validateInstallTree(root).errors, []);
    write('resources/tools/parsehub-bridge/server.js');
    write('resources/frontend/leak.txt', 'ci-secret-value');
    const errors = validateInstallTree(root, { secret: 'ci-secret-value' }).errors;
    assert.equal(errors.some((entry) => entry.includes('disabled resource')), true);
    assert.equal(errors.some((entry) => entry.includes('secret scan value')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
