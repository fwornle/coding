// Phase 83-05 Task 2 (D-13): GET /api/experiments/runs/:taskId/reconciliation
// read-only route. Asserts: valid taskId returns the on-disk JSON verbatim;
// invalid / traversal taskId returns 400 (no path escape); ENOENT returns 200
// with a graceful-empty shape (never 500); and the handler never opens the
// experiment LevelDB (file read only).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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

describe('GET /api/experiments/runs/:taskId/reconciliation', () => {
  let tmpRoot;
  let routes;

  before(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'reconcile-route-'));
    // The handler resolves the file under <experimentRepoRoot>/.data/measurements/.
    routes = new ApiRoutes({}, { experimentRepoRoot: tmpRoot });
  });

  after(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  test('returns the on-disk reconciliation.json verbatim (200)', async () => {
    const taskId = 'good-task_1.2';
    const onDisk = {
      schemaVersion: 1,
      span: { task_id: taskId, agent: 'claude' },
      summary: {
        matched: 3,
        unmatched_wire: 0,
        unmatched_transcript: 1,
        fallback: 1,
        aggregateDeltas: { input_tokens: 5 },
        flaggedCount: 1,
      },
      perRequest: [{ tool_call_id: 'abc', method: 'request-id', deltas: {}, flagged: false }],
    };
    const dir = path.join(tmpRoot, '.data', 'measurements', taskId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'reconciliation.json'), JSON.stringify(onDisk));

    const res = makeRes();
    await routes.handleReconciliation({ params: { taskId } }, res);

    assert.equal(res.statusCode, 200);
    // Verbatim: parsed body equals the on-disk content exactly (no re-shaping).
    assert.deepEqual(res.body, onDisk);
  });

  test('rejects a path-traversal taskId with 400 (no path escape)', async () => {
    const res = makeRes();
    await routes.handleReconciliation({ params: { taskId: '../etc' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'Invalid taskId');
  });

  test('rejects a taskId containing a slash with 400', async () => {
    const res = makeRes();
    await routes.handleReconciliation({ params: { taskId: 'a/b' } }, res);
    assert.equal(res.statusCode, 400);
  });

  // WR-07 (re-review): dot-only ids match the [A-Za-z0-9._-] charset but are
  // path navigation — '..' resolved the read to .data/reconciliation.json,
  // one level ABOVE the measurements dir. Both must 400.
  test("rejects dot-only taskIds ('.', '..') with 400 (one-level escape)", async () => {
    for (const taskId of ['.', '..']) {
      const res = makeRes();
      await routes.handleReconciliation({ params: { taskId } }, res);
      assert.equal(res.statusCode, 400, `taskId '${taskId}' must be rejected`);
      assert.equal(res.body.error, 'Invalid taskId');
    }
  });

  test('rejects an empty taskId with 400', async () => {
    const res = makeRes();
    await routes.handleReconciliation({ params: { taskId: '' } }, res);
    assert.equal(res.statusCode, 400);
  });

  test('ENOENT (no reconciliation data) returns 200 empty, not 500', async () => {
    const res = makeRes();
    await routes.handleReconciliation({ params: { taskId: 'never-measured' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.reconciliation, null);
  });
});
