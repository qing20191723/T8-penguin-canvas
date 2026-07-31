/**
 * Render production entry point.
 *
 * The normal backend is reused, while this file adds Vite output serving for
 * the Web deployment target. Electron packaging keeps using server.js.
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const { app } = require('./server');

const frontendDist = path.resolve(
  process.env.T8PC_FRONTEND_DIST || path.join(__dirname, '..', '..', 'dist'),
);

if (!fs.existsSync(path.join(frontendDist, 'index.html'))) {
  throw new Error(`[render] frontend build not found: ${frontendDist}`);
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
