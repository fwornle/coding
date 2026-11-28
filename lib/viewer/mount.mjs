/**
 * Serve the built knowledge viewer (integrations/unified-viewer/dist) under
 * /viewer/ — from the dashboard frontend (:3032, static-server.js) in the
 * coding-services container, so `vkb` opens it without a dev server or a host
 * build. The image builds dist/ (docker/Dockerfile.coding-services).
 *
 * The page's origin does not matter for its data: every backend URL is
 * absolute (SYSTEM_ENDPOINTS — obs-api :12436, OKM :8090) and obs-api answers
 * CORS for any loopback origin (lib/network/local-only.mjs). Its build uses
 * base /viewer/ (vite.config.ts) and absolute routes (/viewer/:system), so:
 * files under /viewer/assets/…, and every other /viewer/* path is the SPA
 * shell. Mount it BEFORE the dashboard's own SPA catch-all.
 *
 * No build → a plain page saying how to get one, never the dashboard's shell
 * or a bare 404 that reads like the server is broken.
 */

import fs from 'node:fs';
import path from 'node:path';

export function viewerDist(repoRoot) {
  return path.join(repoRoot, 'integrations', 'unified-viewer', 'dist');
}

/** @param {import('express').Express} app  @param {typeof import('express')} express */
export function mountViewer(app, express, { repoRoot, dist = viewerDist(repoRoot) } = {}) {
  const index = path.join(dist, 'index.html');
  // Hashed asset names → cache forever; the shell is never cached, so a
  // rebuild is picked up on the next load.
  app.use('/viewer', express.static(dist, { index: false, immutable: true, maxAge: '365d', fallthrough: true }));
  app.get(['/viewer', '/viewer/*'], (req, res) => {
    if (/\.[a-z0-9]+$/i.test(req.path)) return res.status(404).type('text').send('Not found');
    if (!fs.existsSync(index)) {
      res.set('X-Coding-Viewer', 'not-built');
      return res.status(503).type('html').send(
        '<!doctype html><meta charset="utf-8"><title>Viewer not built</title>' +
        '<p style="font:15px system-ui;margin:3em">The knowledge viewer is not built here. ' +
        'The coding-services image builds it: rebuild the container ' +
        '(<code>docker compose -f docker/docker-compose.yml build coding-services</code>, then ' +
        '<code>up -d</code>). Outside the container, ' +
        '<code>npm --prefix integrations/unified-viewer run build</code> makes one.</p>');
    }
    res.set('Cache-Control', 'no-cache');
    // bin/vkb checks for this: without the mount, the dashboard's catch-all
    // answers /viewer/coding with ITS shell, also a 200.
    res.set('X-Coding-Viewer', 'built');
    res.sendFile(index);
  });
}
