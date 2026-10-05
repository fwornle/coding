/**
 * lib/viewer/mount.mjs — obs-api serves the built viewer under /viewer/.
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
  });
  test('an asset is served and cached for good', async () => {
    const r = await fetch(`${s.url}/viewer/assets/index-abc.js`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('cache-control'), /immutable/);
  });
  test('a missing asset is a 404, not the shell', async () => {
    assert.equal((await fetch(`${s.url}/viewer/assets/gone-123.js`)).status, 404);
  });
  test('the API is untouched and / goes to the viewer', async () => {
    assert.deepEqual(await (await fetch(`${s.url}/api/x`)).json(), { ok: true });
    const r = await fetch(`${s.url}/`, { redirect: 'manual' });
    assert.equal(r.headers.get('location'), '/viewer/coding');
  });
});

test('no build yet: a page that says how to make one', async () => {
  const s = await serve(join(base, 'never-built'));
  try {
    const r = await fetch(`${s.url}/viewer/coding`);
    assert.equal(r.status, 503);
    assert.match(await r.text(), /vkb/);
  } finally { await s.close(); }
});
