// tests/experiments/comparison-endpoint.test.mjs
//
// Phase 80-01 (CMP-04) — store-backed drift coverage for the vkb-server
// `GET /api/experiments/comparison` endpoint (ApiRoutes.handleComparison):
//
//   1. The endpoint JSON (minus the volatile generated_at timestamp) deep-equals
//      the CLI's writeReportJson doc for the SAME seeded rows — proving the live
//      endpoint and the CLI-written .data/experiments/reports/<hash>.json never
//      diverge (both stamp gate_outcome via the SHARED withGateOutcomes helper).
//   2. A traversal task_hash ('../../etc/passwd') returns 400 and NEVER opens the
//      store.
//   3. ?rank_by=tokens reorders the ranked group vs the default composite.
//
// The fixture clones the synthetic Run+Score+Outcome seed from
// experiments-compare.test.mjs (2 gate-passed+scored variants + 1 gate-failed +
// 1 timeout sharing one task_hash) and writes to a THROWAWAY tmp repoRoot passed
// via `experimentRepoRoot` — the real store is never touched.
//
// The handler is exercised directly with a mock req/res (no express server) —
// ApiRoutes is constructible with a null databaseManager because handleComparison
// only touches the experiment store (openExperimentStore), never the shared KG.
//
// node:test + node:assert/strict. Output via process.stderr.write only (no console.*).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ApiRoutes } from '../../lib/vkb-server/api-routes.js';
import { buildComparison } from '../../lib/experiments/compare.mjs';
import { writeReportJson } from '../../scripts/experiments-compare.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC_ONTOLOGY_DIR = path.join(REPO_ROOT, '.data', 'ontologies-experiment');

// A minimal databaseManager stub — ApiRoutes' constructor builds a
// KnowledgeQueryService + per-team UKBDatabaseWriter that read `.graphDB`, but
// handleComparison touches ONLY the experiment store (openExperimentStore), never
// the shared KG. `{ graphDB: null }` satisfies the constructor without a real DB.
const DB_STUB = { graphDB: null };

/** A minimal express-like res double capturing status + json payload. */
function makeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

/**
 * Seed an isolated store with 4 runs sharing `task_hash` (clone of the fixture in
 * experiments-compare.test.mjs): cheap + pricey (complete+gate_passed, ranked),
 * broken (gate_passed=false, failed), stuck (timeout, failed).
 * Returns { repoRoot, cleanup }.
 */
async function seedComparisonStore(taskHash) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'compare-endpoint-'));
  const tmpOntologyDir = path.join(tmp, '.data', 'ontologies-experiment');
  fs.mkdirSync(tmpOntologyDir, { recursive: true });
  for (const f of fs.readdirSync(SRC_ONTOLOGY_DIR)) {
    fs.copyFileSync(path.join(SRC_ONTOLOGY_DIR, f), path.join(tmpOntologyDir, f));
  }

  const { openExperimentStore } = await import('../../lib/experiments/store.mjs');
  const { writeRun } = await import('../../lib/experiments/run-write.mjs');
  const { writeScore } = await import('../../lib/experiments/score-write.mjs');

  const store = await openExperimentStore({ repoRoot: tmp });
  try {
    const seedRun = async (taskId, tags, totals, judgment) => {
      await writeRun(store, {
        span: {
          task_id: taskId,
          started_at: '2026-07-13T10:00:00.000Z',
          ended_at: '2026-07-13T10:00:10.000Z',
          goal_sentence: 'synthetic comparison run',
        },
        taskClass: 'new-feature',
        pending: false,
        tags: { task_hash: taskHash, agent: 'claude-code', model: 'sonnet', framework: 'gsd', ...tags },
        totals,
      });
      if (judgment) await writeScore(store, { span: { task_id: taskId }, judgment });
    };

    await seedRun('cheap-1', { variant: 'cheap', terminal_state: 'complete' },
      { total_tokens: 200 },
      { goal_aligned_ratio: 0.9, gate_passed: true, rubric: {}, not_scored: null, pending: false });
    await seedRun('pricey-1', { variant: 'pricey', terminal_state: 'complete' },
      { total_tokens: 800 },
      { goal_aligned_ratio: 0.5, gate_passed: true, rubric: {}, not_scored: null, pending: false });
    await seedRun('broken-1', { variant: 'broken', terminal_state: 'complete' },
      { total_tokens: 100 },
      { goal_aligned_ratio: 0.9, gate_passed: false, rubric: {}, not_scored: null, pending: false });
    await seedRun('stuck-1', { variant: 'stuck', terminal_state: 'timeout' },
      { total_tokens: 50 },
      { goal_aligned_ratio: 0.9, gate_passed: true, rubric: {}, not_scored: null, pending: false });
  } finally {
    await store.close();
  }

  return { repoRoot: tmp, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

/** Read the pre-read rows for the seeded store (the same seam the endpoint uses). */
async function readRowsFor(repoRoot) {
  const { openExperimentStore } = await import('../../lib/experiments/store.mjs');
  const { readRuns } = await import('../../lib/experiments/query.mjs');
  const store = await openExperimentStore({ repoRoot });
  try {
    return await readRuns(store);
  } finally {
    await store.close();
  }
}

test('endpoint JSON deep-equals the CLI writeReportJson doc (no 79->80 schema drift)', async () => {
  const taskHash = 'endpoint01';
  const { repoRoot, cleanup } = await seedComparisonStore(taskHash);
  try {
    // Endpoint side: invoke the real handler with a mock req/res.
    const api = new ApiRoutes(DB_STUB, { experimentRepoRoot: repoRoot });
    const req = { query: { task_hash: taskHash } };
    const res = makeRes();
    await api.handleComparison(req, res);
    assert.equal(res.statusCode, 200, 'endpoint returns 200');
    const endpointDoc = res.body;
    assert.ok(Array.isArray(endpointDoc.ranked), 'has ranked key');

    // CLI side: build + write the report for the SAME rows, then read it back.
    const rows = await readRowsFor(repoRoot);
    const report = buildComparison(rows, { taskHash, rankBy: 'composite' });
    const outPath = writeReportJson(report, taskHash, { repoRoot });
    const cliDoc = JSON.parse(fs.readFileSync(outPath, 'utf8'));

    // Strip the volatile generated_at from both, then require deep equality.
    const strip = (d) => { const { generated_at, ...rest } = d; return rest; };
    assert.deepEqual(strip(endpointDoc), strip(cliDoc),
      'endpoint JSON deep-equals the CLI writeReportJson doc');

    // Sanity: gate_outcome stamping is present + correct (the shared helper).
    assert.equal(endpointDoc.task_hash, taskHash);
    assert.equal(endpointDoc.rank_by, 'composite');
    assert.ok(endpointDoc.ranked.every((v) => v.gate_outcome === 'passed'));
    assert.ok(endpointDoc.failed.every((v) => v.gate_outcome === 'failed'));
    const failedVariants = endpointDoc.failed.map((v) => v.variant);
    assert.ok(failedVariants.includes('broken'));
    assert.ok(failedVariants.includes('stuck'));
  } finally {
    cleanup();
  }
});

test('endpoint rejects a traversal task_hash with 400 before opening the store', async () => {
  const api = new ApiRoutes(DB_STUB, { experimentRepoRoot: '/nonexistent-should-never-be-opened' });
  const req = { query: { task_hash: '../../etc/passwd' } };
  const res = makeRes();
  await api.handleComparison(req, res);
  assert.equal(res.statusCode, 400, 'traversal task_hash returns 400');
  assert.match(res.body.message, /invalid|traversal|separator/i);
});

test('endpoint rejects a missing task_hash with 400', async () => {
  const api = new ApiRoutes(DB_STUB, {});
  const res = makeRes();
  await api.handleComparison({ query: {} }, res);
  assert.equal(res.statusCode, 400);
});

test('?rank_by=tokens reorders the ranked group', async () => {
  const taskHash = 'endpoint02';
  const { repoRoot, cleanup } = await seedComparisonStore(taskHash);
  try {
    const api = new ApiRoutes(DB_STUB, { experimentRepoRoot: repoRoot });
    const res = makeRes();
    await api.handleComparison({ query: { task_hash: taskHash, rank_by: 'tokens' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.rank_by, 'tokens');
    // cheap (200 tokens) ranks before pricey (800) under tokens ordering
    assert.equal(res.body.ranked[0].variant, 'cheap');
    assert.ok(
      res.body.ranked[0].metrics.totalTokens.mean <= res.body.ranked[1].metrics.totalTokens.mean,
      'ranked ascending by mean tokens',
    );
  } finally {
    cleanup();
  }
});
