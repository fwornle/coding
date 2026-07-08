// tests/vkb/context-turns-route.test.mjs
//
// Phase 84-07 Task 1 (D-10): GET /api/experiments/runs/:taskId/context-turns
// read-only route. Behavior (RESEARCH Test Map): the read API serves the
// context-turns line(s) verbatim (gunzip the span-close .gz, or plaintext
// .jsonl while the span is still open), returns graceful-empty (200, NOT 500)
// on ENOENT, and rejects path traversal via the `_validTaskId` guard (path
// stays under .data/measurements/). Cloned from the reconciliation-route test.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { ApiRoutes } from '../../lib/vkb-server/api-routes.js';

// Minimal Express-style res double: captures the status code + JSON body.
function makeRes() {
  const res = {
    statusCode: null,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
}

describe('GET /api/experiments/runs/:taskId/context-turns', () => {
  let tmpRoot;
  let routes;

  before(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'context-turns-route-'));
    // The handler resolves the file under <experimentRepoRoot>/.data/measurements/.
    routes = new ApiRoutes({}, { experimentRepoRoot: tmpRoot });
  });

  after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  test('gunzips the span-close .gz and returns the turns array verbatim (200)', async () => {
    const taskId = 'good-task_1.2';
    const turns = [
      { ts: '2026-07-08T00:00:00Z', wire: 'anthropic', usage: { input: 5, output: 10, cache_read: 61902, cache_write: 3 }, cache_breakpoints: [0, 2], observation_ref: null },
      { ts: '2026-07-08T00:00:01Z', wire: 'openai', usage: { input: 7, output: 12, cache_read: 0, cache_write: null }, cache_breakpoints: [], observation_ref: { id: 'obs-1', intent: 'do the thing' } },
    ];
    const dir = path.join(tmpRoot, '.data', 'measurements', taskId);
    await fs.mkdir(dir, { recursive: true });
    const jsonl = turns.map((t) => JSON.stringify(t)).join('\n') + '\n';
    await fs.writeFile(path.join(dir, 'context-turns.jsonl.gz'), zlib.gzipSync(Buffer.from(jsonl, 'utf8')));

    const res = makeRes();
    await routes.handleContextTurns({ params: { taskId } }, res);

    assert.equal(res.statusCode, 200);
    // Verbatim round-trip: each gunzipped line parses back to the exact object.
    assert.deepEqual(res.body, { contextTurns: turns });
  });

  test('falls back to plaintext .jsonl when the span is not yet closed (200)', async () => {
    const taskId = 'open-span_9';
    const turns = [
      { ts: '2026-07-08T01:00:00Z', wire: 'anthropic', usage: { input: 1, output: 2 }, observation_ref: null },
    ];
    const dir = path.join(tmpRoot, '.data', 'measurements', taskId);
    await fs.mkdir(dir, { recursive: true });
    // Only the plaintext exists (no .gz yet) — span still open.
    await fs.writeFile(path.join(dir, 'context-turns.jsonl'), turns.map((t) => JSON.stringify(t)).join('\n') + '\n');

    const res = makeRes();
    await routes.handleContextTurns({ params: { taskId } }, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { contextTurns: turns });
  });

  test('prefers the .gz over a stale plaintext when both exist (200)', async () => {
    const taskId = 'both-present_3';
    const gzTurns = [{ ts: '2026-07-08T02:00:00Z', wire: 'anthropic', from: 'gz' }];
    const plainTurns = [{ ts: '2026-07-08T02:00:00Z', wire: 'anthropic', from: 'plaintext' }];
    const dir = path.join(tmpRoot, '.data', 'measurements', taskId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'context-turns.jsonl.gz'), zlib.gzipSync(Buffer.from(JSON.stringify(gzTurns[0]) + '\n', 'utf8')));
    await fs.writeFile(path.join(dir, 'context-turns.jsonl'), JSON.stringify(plainTurns[0]) + '\n');

    const res = makeRes();
    await routes.handleContextTurns({ params: { taskId } }, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { contextTurns: gzTurns });
  });

  test('ENOENT (no context-turns data) returns 200 empty array, not 500', async () => {
    const res = makeRes();
    await routes.handleContextTurns({ params: { taskId: 'never-measured' } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { contextTurns: [] });
  });

  test('rejects a path-traversal taskId with 400 (no path escape)', async () => {
    const res = makeRes();
    await routes.handleContextTurns({ params: { taskId: '../../etc' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'Invalid taskId');
  });

  test('rejects a taskId containing a slash with 400', async () => {
    const res = makeRes();
    await routes.handleContextTurns({ params: { taskId: 'a/b' } }, res);
    assert.equal(res.statusCode, 400);
  });

  // WR-07 parity: dot-only ids match the [A-Za-z0-9._-] charset but are path
  // navigation — '..' would resolve one level ABOVE the measurements dir.
  test("rejects dot-only taskIds ('.', '..') with 400 (one-level escape)", async () => {
    for (const taskId of ['.', '..']) {
      const res = makeRes();
      await routes.handleContextTurns({ params: { taskId } }, res);
      assert.equal(res.statusCode, 400, `taskId '${taskId}' must be rejected`);
      assert.equal(res.body.error, 'Invalid taskId');
    }
  });

  test('rejects an empty taskId with 400', async () => {
    const res = makeRes();
    await routes.handleContextTurns({ params: { taskId: '' } }, res);
    assert.equal(res.statusCode, 400);
  });
});
