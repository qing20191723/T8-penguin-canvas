'use strict';

const DESKTOP_ATLAS_EXCLUDED_BACKEND_FILES = Object.freeze([
  'routes/collaboration.js',
  'collaboration/abuseLimits.js',
  'collaboration/auth.js',
  'collaboration/gateway.js',
  'collaboration/hostManagement.js',
  'collaboration/publicExposure.js',
  'collaboration/publicExposureStore.js',
  'collaboration/textCrdt.js',
]);

function normalizeBackendRelativePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function shouldExcludeDesktopAtlasBackendFile(relativePath) {
  return DESKTOP_ATLAS_EXCLUDED_BACKEND_FILES.includes(normalizeBackendRelativePath(relativePath));
}

function packagedBackendPath(relativePath) {
  return `resources/backend-enc/${normalizeBackendRelativePath(relativePath).replace(/\.(?:js|cjs)$/, '.t8c')}`;
}

module.exports = {
  DESKTOP_ATLAS_EXCLUDED_BACKEND_FILES,
  normalizeBackendRelativePath,
  packagedBackendPath,
  shouldExcludeDesktopAtlasBackendFile,
};
