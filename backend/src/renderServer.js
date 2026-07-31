/**
 * Render production entry point.
 *
 * The normal backend is reused, while this file adds Vite output serving for
 * the Web deployment target. Electron packaging keeps using server.js.
 */

// This entry point is only used for public Web deployment. Render routes the
// public onrender.com hostname to the container's listening socket, so the
// process must bind every interface rather than the loopback-only desktop
// default. Set these values before loading server.js/config.js.
process.env.T8_WEB_DEPLOY = '1';
process.env.HOST = '0.0.0.0';
if (!String(process.env.PORT || '').trim()) process.env.PORT = '10000';
process.env.T8_FIGMA_BRIDGE_AUTOSTART = '0';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { app } = require('./server');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const configuredDist = String(process.env.T8PC_FRONTEND_DIST || '').trim();
const distCandidates = [];

if (configuredDist) {
  if (path.isAbsolute(configuredDist)) {
    distCandidates.push(configuredDist);
  } else {
    // Render might launch from the repository root (`yarn start`) or from
    // `backend/` when the Blueprint startCommand is honored. Support both.
    distCandidates.push(path.resolve(process.cwd(), configuredDist));
    distCandidates.push(path.resolve(__dirname, '..', configuredDist));
    distCandidates.push(path.resolve(repositoryRoot, configuredDist));
  }
}

distCandidates.push(path.join(repositoryRoot, 'dist'));

const uniqueCandidates = [...new Set(distCandidates.map((candidate) => path.normalize(candidate)))];
const frontendDist = uniqueCandidates.find((candidate) =>
  fs.existsSync(path.join(candidate, 'index.html')),
);

if (!frontendDist) {
  throw new Error(
    `[render] frontend build not found; checked: ${uniqueCandidates.join(', ')}`,
  );
}

app.use(express.static(frontendDist, {
  index: 'index.html',
  setHeaders(res, filePath) {
    if (path.basename(filePath) === 'index.html') {
      res.setHeader('Cache-Control', 'no-cache');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
  },
}));

app.get(/^\/(?!api\/|files\/|input\/|output\/).*/, (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(frontendDist, 'index.html'));
});

console.log(`[render] serving frontend from ${frontendDist}`);
