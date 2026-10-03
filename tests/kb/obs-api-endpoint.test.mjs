/**
 * lib/kb/obs-api-endpoint.mjs + sync's reload: a pull reloads the obs-api of
 * ITS data home, not whichever one listens on the default port (T8).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { recordEndpoint, obsApiPort, endpointFile } from '../../lib/kb/obs-api-endpoint.mjs';
import { notifyReload } from '../../lib/history/sync.mjs';

const root = mkdtempSync(join(tmpdir(), 'obs-endpoint-'));
test.after(() => rmSync(root, { recursive: true, force: true }));
const homeOpts = (name) => ({ env: { CODING_DATA_HOME: join(root, name) } });

test('no record: OBSERVATIONS_API_PORT, else 12436', () => {
  assert.equal(obsApiPort(homeOpts('none')), '12436');
  assert.equal(obsApiPort({ env: { ...homeOpts('none').env, OBSERVATIONS_API_PORT: '12999' } }), '12999');
});

test('a live record wins; a dead process\'s record is ignored', () => {
  const opts = homeOpts('a');
  recordEndpoint({ port: 12446 }, opts);
  assert.equal(obsApiPort({ env: { ...opts.env, OBSERVATIONS_API_PORT: '12999' } }), '12446');
  mkdirSync(join(root, 'dead', 'var'), { recursive: true });
  writeFileSync(endpointFile(homeOpts('dead')), JSON.stringify({ port: 12447, pid: 2 ** 22 + 12345 }));
  assert.equal(obsApiPort(homeOpts('dead')), '12436');
});

test('notifyReload reaches the obs-api recorded in its data home', async () => {
  let hits = 0;
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/kb/reload') hits++;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ added: 1 }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const opts = homeOpts('b');
    recordEndpoint({ port: server.address().port }, opts);
    const r = await notifyReload({ ...opts, timeoutMs: 5000 });
    assert.deepEqual(r, { added: 1 });
    assert.equal(hits, 1);
  } finally {
    server.close();
  }
});
