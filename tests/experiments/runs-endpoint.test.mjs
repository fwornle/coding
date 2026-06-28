// tests/experiments/runs-endpoint.test.mjs
//
// DASH-01 RED test (Phase 74, Wave 0): the `GET /api/experiments/runs` endpoint
// handler `handleRunsQuery` on `lib/vkb-server/api-routes.js` (ApiRoutes). This
// test MUST currently fail — `handleRunsQuery` is not yet defined (it depends on
// the unwritten `lib/experiments/query.mjs`). Plan 02 turns it GREEN.
//
// Isolation idiom mirrors score-override-endpoint.test.mjs: invoke the handler via
// `Object.create(ApiRoutes.prototype)` with `experimentRepoRoot` pointing at the
// seeded throwaway repo-root — exercising the route WITHOUT the heavy
// DatabaseManager-backed constructor and WITHOUT touching the real store.
//
// node:test + node:assert/strict. Output via process.stderr.write only.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { seedIsolatedStore } from './_fixtures/seed-experiment-store.mjs';

/** Minimal Express res double: captures statusCode + json body, chainable. */
function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

/** A handler `this` with the isolated experiment repo-root, no heavy constructor. */
async function makeHandlerThis(repoRoot) {
  const { ApiRoutes } = await import('../../lib/vkb-server/api-routes.js');
  const ctx = Object.create(ApiRoutes.prototype);
  ctx.experimentRepoRoot = repoRoot;
  return ctx;
}

test('DASH-01: GET /api/experiments/runs -> 200 + rows array from the isolated store', async () => {
  const { repoRoot, cleanup } = await seedIsolatedStore('runs-endpoint-t1');
  try {
    const ctx = await makeHandlerThis(repoRoot);
    const req = { query: {} };
    const res = mockRes();
    await ctx.handleRunsQuery(req, res);

    assert.equal(res.statusCode, 200, 'runs query -> 200');
    assert.ok(Array.isArray(res.body?.rows), 'response carries a rows array');
    assert.equal(res.body.rows.length, 1, 'one non-pending Run row from the seeded store');
    assert.equal(res.body.rows[0].task_id, 'runs-endpoint-t1', 'the seeded Run is returned');
  } finally {
    cleanup();
  }
});
