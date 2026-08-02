const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('web request limits are route scoped and desktop defaults remain compatible', () => {
  const server = read('backend/src/server.js');
  const files = read('backend/src/routes/files.js');
  const photoshop = read('backend/src/routes/photoshopBridge.js');

  assert.match(server, /T8_WEB_JSON_MAX_BYTES', 2 \* 1024 \* 1024/);
  assert.match(server, /T8_WEB_DOCUMENT_JSON_MAX_BYTES', 32 \* 1024 \* 1024/);
  assert.equal(server.includes('/^\\/api\\/(?:canvas|project-runs|subflows)(?:\\/|$)/'), true);
  assert.equal(server.includes('/^\\/api\\/(?:files|photoshop-bridge)\\/upload-base64$/'), true);
  assert.match(server, /tooLarge \? 413 : 400/);
  assert.match(server, /: '120mb'/);

  assert.match(files, /DEFAULT_WEB_FILE_UPLOAD_MAX_BYTES = 256 \* 1024 \* 1024/);
  assert.match(files, /DEFAULT_FILE_UPLOAD_MAX_BYTES = 512 \* 1024 \* 1024/);
  assert.match(files, /router\.post\('\/upload-base64', express\.json\(\{ limit: '20mb' \}\)/);
  assert.match(photoshop, /router\.post\('\/upload-base64', express\.json\(\{ limit: '20mb' \}\)/);
  assert.match(files, /status\(507\)/);
  assert.match(files, /status\(409\)/);
});

test('external media persistence uses streaming or bounded chunk decode, validation, and atomic completion', () => {
  const external = read('backend/src/routes/externalProviders.js');
  assert.match(external, /safeRemoteMediaDownload\(url, staging/);
  assert.match(external, /base64ChunkChars = 1024 \* 1024/);
  assert.match(external, /validateSavedMedia\(handle, stat/);
  assert.match(external, /handle\.sync\(\)/);
  assert.match(external, /fs\.promises\.rename\(staging, target\)/);
  assert.match(external, /t8-media-download-complete-v1/);
  assert.doesNotMatch(external, /Buffer\.from\(await res\.arrayBuffer\(\)\)/);
  assert.doesNotMatch(external, /Buffer\.concat\(/);
});
