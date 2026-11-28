/**
 * lib/viewer/mount.mjs — the dashboard frontend (:3032) serves the built
 * viewer under /viewer/, ahead of its own SPA catch-all.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';

import { mountViewer } from '../../lib/viewer/mount.mjs';

const base = mkdtempSync(join(tmpdir(), 'viewer-mount-'));
after(() => rmSync(base, { recursive: true, force: true }));

async function serve(dist) {
  const app = express();
  mountViewer(app, express, { dist });
  app.get('/api/x', (_q, r) => r.json({ ok: true }));
  // The dashboard's own catch-all, mounted after the viewer as in static-server.js.
  app.get('*', (_q, r) => r.type('html').send('<html>dashboard</html>'));
  const server = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, close: () => new Promise((ok) => server.close(ok)) };
}

describe('a built viewer', () => {
  let s;
  before(async () => {
    const dist = join(base, 'dist');
    mkdirSync(join(dist, 'assets'), { recursive: true });
    writeFileSync(join(dist, 'index.html'), '<html>shell</html>');
    writeFileSync(join(dist, 'assets', 'index-abc.js'), 'console.log(1)');
    s = await serve(dist);
  });
  after(() => s.close());

  test('a route is the SPA shell, not cached', async () => {
    const r = await fetch(`${s.url}/viewer/coding`);
    assert.equal(r.status, 200);
    assert.equal(await r.text(), '<html>shell</html>');
    assert.equal(r.headers.get('cache-control'), 'no-cache');
    assert.equal(r.headers.get('x-coding-viewer'), 'built');
  });
  test('an asset is served and cached for good', async () => {
    const r = await fetch(`${s.url}/viewer/assets/index-abc.js`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('cache-control'), /immutable/);
  });
  test('a missing asset is a 404, not the shell', async () => {
    assert.equal((await fetch(`${s.url}/viewer/assets/gone-123.js`)).status, 404);
  });
  test('the API and the dashboard keep their own paths', async () => {
    assert.deepEqual(await (await fetch(`${s.url}/api/x`)).json(), { ok: true });
    const r = await fetch(`${s.url}/`, { redirect: 'manual' });
    assert.equal(r.status, 200);
    assert.equal(await r.text(), '<html>dashboard</html>');
    assert.equal(await (await fetch(`${s.url}/features`)).text(), '<html>dashboard</html>');
  });
});

test('no build yet: a page that says how to make one', async () => {
  const s = await serve(join(base, 'never-built'));
  try {
    const r = await fetch(`${s.url}/viewer/coding`);
    assert.equal(r.status, 503);
    assert.equal(r.headers.get('x-coding-viewer'), 'not-built');
    assert.match(await r.text(), /not built/);
  } finally { await s.close(); }
});
