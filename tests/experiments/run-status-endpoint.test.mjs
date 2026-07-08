// tests/experiments/run-status-endpoint.test.mjs
//
// Phase 85-04 (Wave 3) — handleRunStatus on lib/vkb-server/api-routes.js.
// D-04: serve <runDir>/progress.json VERBATIM as a PURE file read (never opens
// the experiment LevelDB — Pitfall 6). Graceful-empty on ENOENT; a `../`-bearing
// runId is rejected 400 BEFORE the path build (T-85-04-01 traversal guard).
//
// Isolation idiom mirrors runs-endpoint.test.mjs: Object.create + injected
// experimentRepoRoot. node:test + node:assert/strict.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

function makeRepoRoot(label) {
  const root = fsSync.mkdtempSync(path.join(os.tmpdir(), `run-status-${label}-`));
  fsSync.mkdirSync(path.join(root, '.data', 'experiments', 'runs'), { recursive: true });
  return root;
}

async function makeCtx(repoRoot) {
  const { ApiRoutes } = await import('../../lib/vkb-server/api-routes.js');
  const ctx = Object.create(ApiRoutes.prototype);
  ctx.experimentRepoRoot = repoRoot;
  return ctx;
}

test('verbatim serve: an existing progress.json is returned byte-for-byte (no re-shaping)', async () => {
  const repoRoot = makeRepoRoot('t1');
  const runId = 'abc123';
  const runDir = path.join(repoRoot, '.data', 'experiments', 'runs', runId);
  await fs.mkdir(runDir, { recursive: true });
  const progress = {
    run_id: runId,
    spec: 'demo.yaml',
    overall: 'running',
    done: 1,
    total: 4,
    cells: [{ variant: 'claude-sonnet-none-none', rep: 0, state: 'complete' }],
  };
  await fs.writeFile(path.join(runDir, 'progress.json'), JSON.stringify(progress));
  const ctx = await makeCtx(repoRoot);
  const res = mockRes();
  await ctx.handleRunStatus({ params: { runId } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, progress, 'progress.json served verbatim');
});

test('graceful-empty: a missing run -> 200 { runId, overall:unknown, cells:[] }', async () => {
  const repoRoot = makeRepoRoot('t2');
  const ctx = await makeCtx(repoRoot);
  const res = mockRes();
  await ctx.handleRunStatus({ params: { runId: 'ghost1' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.overall, 'unknown');
  assert.deepEqual(res.body.cells, []);
  assert.equal(res.body.runId, 'ghost1');
});

test('traversal guard: a ../-bearing runId -> 400 (rejected before the path build)', async () => {
  const repoRoot = makeRepoRoot('t3');
  const ctx = await makeCtx(repoRoot);
  const res = mockRes();
  await ctx.handleRunStatus({ params: { runId: '../etc' } }, res);
  assert.equal(res.statusCode, 400);
});
