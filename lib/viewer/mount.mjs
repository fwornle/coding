/**
 * Serve the built knowledge viewer (integrations/unified-viewer/dist) from
 * obs-api under /viewer/ — so `vkb` opens it without a dev server.
 *
 * The viewer already talks to obs-api (SYSTEM_ENDPOINTS.coding = :12436), so
 * this is the one host process that is up whenever the viewer has anything to
 * show. Its build uses base /viewer/ (vite.config.ts) and absolute routes
 * (/viewer/:system), so: files under /viewer/assets/…, and every other
 * /viewer/* path is the SPA shell.
 *
 * No build yet → a plain page saying how to make one (bin/vkb builds it on
 * demand), never a bare 404 that reads like obs-api is broken.
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
      return res.status(503).type('html').send(
        '<!doctype html><meta charset="utf-8"><title>Viewer not built</title>' +
        '<p style="font:15px system-ui;margin:3em">The knowledge viewer has not been built yet. ' +
        'Run <code>vkb</code> (it builds it once), or ' +
        '<code>npm --prefix integrations/unified-viewer run build</code>.</p>');
    }
    res.set('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
  app.get('/', (_req, res) => res.redirect('/viewer/coding'));
}
