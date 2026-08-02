#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MAX_INSTALLER_BYTES = 500 * 1024 * 1024;
const RELEASE_REPOSITORY = 'qing20191723/T8-penguin-canvas';
const ALLOWED_RESOURCE_TARGETS = new Set([
  'backend-enc',
  'frontend',
  'shared',
  'tools/ffmpeg',
  'tools/ffmpeg-compat/ffmpeg.exe',
]);
const FORBIDDEN_PACKAGE_MARKERS = [
  'agent/skills',
  'zcanvas-cli',
  'runtime-archives',
  'remove-ai-watermarks',
  'parsehub',
  'figma-bridge',
  'photoshop-bridge',
  'collaboration',
  'runninghub',
  'vibex',
  'feishu',
  'comfyui',
];
const FORBIDDEN_DESKTOP_CHUNK_MARKERS = [
  'CollaborationWorkspace',
  'AgentControl',
  'CodexCliAgentNode',
  'CodexImageConjureNode',
  'GrokOAuthAgentNode',
  'RunningHubNode',
  'FalToolboxNode',
  'ComfyUIStoreNode',
  'ComfyUIAppMakerNode',
  'VibeXNode',
  'FeishuBitableInputNode',
  'FeishuBitableOutputNode',
  'TopazImageUpscaleNode',
  'TopazVideoUpscaleNode',
  'RemoveAiWatermarkNode',
];

function fail(message) {
  throw new Error(`[desktop-atlas-package] ${message}`);
}

function normalize(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

function walkBytes(target) {
  if (!fs.existsSync(target)) return 0;
  const stat = fs.statSync(target);
  if (stat.isFile()) return stat.size;
  let bytes = 0;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    bytes += walkBytes(path.join(target, entry.name));
  }
  return bytes;
}

function validatePackagePolicy(pkg, releaseSources = []) {
  const errors = [];
  if (pkg.version !== '1.0.0') errors.push(`first desktop version must remain 1.0.0, received ${pkg.version}`);
  if (pkg.build?.appId !== 'com.qingchen.atlascanvas') errors.push('unexpected Electron appId');
  if (pkg.build?.productName !== 'Qingchen-AtlasCanvas') errors.push('unexpected Electron productName');
  if (pkg.build?.nsis?.perMachine !== false) errors.push('NSIS must install per user');
  if (pkg.build?.nsis?.deleteAppDataOnUninstall !== false) errors.push('uninstall must preserve Electron userData');
  const target = pkg.build?.win?.target?.[0];
  if (target?.target !== 'nsis' || !Array.isArray(target.arch) || target.arch.join(',') !== 'x64') {
    errors.push('Windows packaging must be NSIS x64 only');
  }
  const publisher = pkg.build?.publish?.[0];
  if (publisher?.provider !== 'github' || `${publisher.owner}/${publisher.repo}` !== RELEASE_REPOSITORY) {
    errors.push(`automatic updates must use ${RELEASE_REPOSITORY}`);
  }
  const resources = Array.isArray(pkg.build?.extraResources) ? pkg.build.extraResources : [];
  const targets = resources.map((entry) => normalize(entry.to));
  for (const targetName of targets) {
    if (!ALLOWED_RESOURCE_TARGETS.has(targetName)) errors.push(`unexpected packaged resource: ${targetName}`);
  }
  for (const required of ALLOWED_RESOURCE_TARGETS) {
    if (!targets.includes(required)) errors.push(`required packaged resource is missing: ${required}`);
  }
  const packageSurface = JSON.stringify({ files: pkg.build?.files, extraResources: resources }).toLowerCase();
  for (const marker of FORBIDDEN_PACKAGE_MARKERS) {
    if (packageSurface.includes(marker)) errors.push(`disabled desktop resource is still packaged: ${marker}`);
  }
  const releaseText = releaseSources.join('\n');
  if (releaseText.includes('T8mars/T8-penguin-canvas')) errors.push('release scripts still reference the upstream repository');
  if (releaseText.includes('assertCollaborationReleaseEvidenceForPublish')) errors.push('release scripts still require collaboration evidence');
  if (/rh-toolbox:check|prepare-runtime-archives/.test(pkg.scripts?.['prepack:enc'] || '')) {
    errors.push('desktop prepack still invokes legacy runtime/toolbox preparation');
  }
  return errors;
}

function resourceComposition(root, pkg) {
  return (pkg.build?.extraResources || []).map((entry) => ({
    from: normalize(entry.from),
    to: normalize(entry.to),
    bytes: walkBytes(path.resolve(root, entry.from)),
  }));
}

function hashFile(filename) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(filename, 'r');
  const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
  try {
    for (;;) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!count) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function writeChecksumFile(installer) {
  const checksum = `${hashFile(installer)}  ${path.basename(installer)}\n`;
  const output = `${installer}.sha256`;
  const temporary = `${output}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, checksum, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, output);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return output;
}

function verifyArtifact(root, pkg) {
  const installer = path.join(root, 'dist_electron', `${pkg.build.productName}-Setup-${pkg.version}.exe`);
  for (const filename of [installer, `${installer}.blockmap`, path.join(root, 'dist_electron', 'latest.yml')]) {
    if (!fs.existsSync(filename) || !fs.statSync(filename).isFile() || fs.statSync(filename).size <= 0) {
      fail(`release artifact missing or empty: ${path.relative(root, filename)}`);
    }
  }
  const size = fs.statSync(installer).size;
  if (size > MAX_INSTALLER_BYTES) {
    fail(`installer is ${(size / 1024 / 1024).toFixed(1)} MiB; limit is 500 MiB`);
  }
  const checksum = writeChecksumFile(installer);
  const secret = String(process.env.T8_SECRET_SCAN_VALUE || '');
  if (secret && fs.readFileSync(installer).includes(Buffer.from(secret))) fail('secret scan value found in installer');
  return { installer, checksum, size, sha256: hashFile(installer) };
}

function verifyDesktopFrontend(root) {
  const dist = path.join(root, 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) fail('desktop frontend build is missing');
  const files = [];
  const collect = (target) => {
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
      const filename = path.join(target, entry.name);
      if (entry.isDirectory()) collect(filename);
      else if (entry.isFile()) files.push(filename);
    }
  };
  collect(dist);
  for (const marker of FORBIDDEN_DESKTOP_CHUNK_MARKERS) {
    const hit = files.find((filename) => path.basename(filename).includes(marker));
    if (hit) fail(`disabled desktop chunk was emitted: ${path.relative(dist, hit)}`);
  }
  if (!files.some((filename) => path.basename(filename).includes('LegacyDesktopDisabledNode'))) {
    fail('legacy compatibility placeholder chunk was not emitted');
  }
  return { files: files.length, bytes: files.reduce((total, filename) => total + fs.statSync(filename).size, 0) };
}

function main() {
  const pkg = require(path.join(ROOT, 'package.json'));
  const releaseFiles = ['dist-release.cjs', 'release-github.cjs', 'verify-github-release.cjs'];
  const releaseSources = releaseFiles.map((name) => fs.readFileSync(path.join(ROOT, 'scripts', name), 'utf8'));
  const errors = validatePackagePolicy(pkg, releaseSources);
  if (errors.length) fail(errors.join('; '));
  const composition = resourceComposition(ROOT, pkg);
  const result = process.argv.includes('--artifact') ? verifyArtifact(ROOT, pkg) : null;
  const frontend = process.argv.includes('--frontend') ? verifyDesktopFrontend(ROOT) : null;
  console.log(JSON.stringify({
    schema: 't8-desktop-atlas-package-report-v1',
    repository: RELEASE_REPOSITORY,
    version: pkg.version,
    maxInstallerBytes: MAX_INSTALLER_BYTES,
    resources: composition,
    artifact: result ? { size: result.size, sha256: result.sha256, checksum: path.basename(result.checksum) } : null,
    frontend,
  }));
}

if (require.main === module) main();

module.exports = {
  ALLOWED_RESOURCE_TARGETS,
  FORBIDDEN_DESKTOP_CHUNK_MARKERS,
  FORBIDDEN_PACKAGE_MARKERS,
  MAX_INSTALLER_BYTES,
  RELEASE_REPOSITORY,
  resourceComposition,
  validatePackagePolicy,
  verifyArtifact,
  verifyDesktopFrontend,
  writeChecksumFile,
};
