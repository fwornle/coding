// tests/experiments/score-override-endpoint.test.mjs
//
// SCORE-02 proof (Phase 73, Plan 05): the PATCH /api/experiments/scores/:taskId
// endpoint (lib/vkb-server/api-routes.js handleScoreOverride) applies a single
// per-dimension human override to a Run's Score via applyOverride against the
// DEDICATED experiment store — validating all input BEFORE any write and
// PRESERVING judged fields (D-06). Test groups:
//   1. validation 400s — unknown dimension, out-of-range value (continuous +
//      binary regressions), missing/empty overridden_by — each before any write.
//   2. happy path 200 — corrected_<dim> + overridden_by/at stamped, judged
//      fields UNTOUCHED (D-06).
//   3. missing Score for taskId -> 404 (applyOverride's no-Score throw mapped).
//   4. the Score path uses openExperimentStore/applyOverride, never the shared
//      KG (asserted structurally: an isolated experiment store receives the write).
//
// Isolation: the handler is invoked via Object.create(ApiRoutes.prototype) with
// `experimentRepoRoot` pointing at a throwaway tmp repo-root whose
// .data/ontologies-experiment is the REAL ontology copied verbatim and whose
// .data/experiments/leveldb is a fresh store. This exercises handleScoreOverride
// WITHOUT constructing the heavy DatabaseManager-backed ApiRoutes and WITHOUT
// touching the real single-owner store. Mirrors tests/experiments/score-write.test.mjs.
//
// Output via process.stderr.write only (no console.* — no-console-log).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC_ONTOLOGY_DIR = path.join(REPO_ROOT, '.data', 'ontologies-experiment');

/**
 * Build an isolated tmp repo-root with the REAL experiment ontology copied in,
 * seed it with a Run + Score for `taskId`, and return { repoRoot, cleanup }.
 * The handler under test opens this same repoRoot via experimentRepoRoot.
 */
async function seedIsolatedStore(taskId = 't1') {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'score-override-endpoint-test-'));
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
    await writeRun(store, {
      span: {
        task_id: taskId,
        started_at: '2026-06-28T05:55:15.270Z',
        ended_at: '2026-06-28T05:55:30.164Z',
        goal_sentence: 'ship the score override endpoint',
      },
      taskClass: 'new-feature',
      pending: false,
      tags: {
        task_hash: 'deadbeef', agent: 'claude-code', model: 'claude-haiku-4.5',
        framework: 'gsd', trace_id: taskId,
      },
      totals: {
        input_tokens: 100, output_tokens: 200, total_tokens: 300, reasoning_tokens: 50, calls: 4,
      },
    });
    await writeScore(store, {
      span: { task_id: taskId },
      judgment: {
        goal_aligned_ratio: 0.8,
        event_labels: [{ seq: 0, label: 'toward' }],
        ratio_rationale: 'progressed toward the goal',
        rubric: { goal_achieved: 0.7, code_quality: 0.6, test_coverage: 0.5, regressions: 0, spec_drift: 0.1 },
        rubric_rationale: 'solid',
        pending: false,
        not_scored: null,
      },
    });
  } finally {
    await store.close();
  }

  const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
  return { repoRoot: tmp, cleanup };
}

/** Read back the single Score's metadata from the isolated store. */
async function readScoreMeta(repoRoot, taskId) {
  const { openExperimentStore } = await import('../../lib/experiments/store.mjs');
  const store = await openExperimentStore({ repoRoot });
  try {
    for await (const e of store.iterate({ entityType: 'Score' })) {
      if (e.metadata?.run_task_id === taskId) return e.metadata;
    }
    return null;
  } finally {
    await store.close();
  }
}

/** A handler `this` with the isolated experiment repo-root, no heavy constructor. */
async function makeHandlerThis(repoRoot) {
  const { ApiRoutes } = await import('../../lib/vkb-server/api-routes.js');
  const ctx = Object.create(ApiRoutes.prototype);
  ctx.experimentRepoRoot = repoRoot;
  return ctx;
}

/** Minimal Express res double: captures statusCode + json body, chainable. */
function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

/** Invoke handleScoreOverride against the isolated store. */
async function callOverride(repoRoot, taskId, body) {
  const ctx = await makeHandlerThis(repoRoot);
  const req = { params: { taskId }, body };
  const res = mockRes();
  await ctx.handleScoreOverride(req, res);
  return res;
}

test('SCORE-02: unknown dimension is rejected with 400 before any write', async () => {
  const { repoRoot, cleanup } = await seedIsolatedStore('t1');
  try {
    const res = await callOverride(repoRoot, 't1', { dimension: 'not_a_dimension', value: 0.5, overridden_by: 'op' });
    assert.equal(res.statusCode, 400, 'unknown dimension -> 400');
    const meta = await readScoreMeta(repoRoot, 't1');
    assert.equal(meta.corrected_goal_achieved, null, 'no corrected_* written on a rejected request');
    assert.equal(meta.overridden_by, null, 'no overridden_by stamped on a rejected request');
  } finally {
    cleanup();
  }
});

test('SCORE-02: out-of-range continuous value is rejected with 400', async () => {
  const { repoRoot, cleanup } = await seedIsolatedStore('t1');
  try {
    const high = await callOverride(repoRoot, 't1', { dimension: 'goal_achieved', value: 1.5, overridden_by: 'op' });
    assert.equal(high.statusCode, 400, 'value > 1 -> 400');
    const low = await callOverride(repoRoot, 't1', { dimension: 'code_quality', value: -0.2, overridden_by: 'op' });
    assert.equal(low.statusCode, 400, 'value < 0 -> 400');
    const meta = await readScoreMeta(repoRoot, 't1');
    assert.equal(meta.corrected_goal_achieved, null, 'no write for an out-of-range value');
  } finally {
    cleanup();
  }
});

test('SCORE-02: regressions only accepts 0 or 1 (0.5 -> 400)', async () => {
  const { repoRoot, cleanup } = await seedIsolatedStore('t1');
  try {
    const bad = await callOverride(repoRoot, 't1', { dimension: 'regressions', value: 0.5, overridden_by: 'op' });
    assert.equal(bad.statusCode, 400, 'regressions=0.5 -> 400');
    const ok = await callOverride(repoRoot, 't1', { dimension: 'regressions', value: 1, overridden_by: 'op' });
    assert.equal(ok.statusCode, 200, 'regressions=1 is accepted');
  } finally {
    cleanup();
  }
});

test('SCORE-02: missing/empty overridden_by is rejected with 400', async () => {
  const { repoRoot, cleanup } = await seedIsolatedStore('t1');
  try {
    const missing = await callOverride(repoRoot, 't1', { dimension: 'goal_achieved', value: 0.9 });
    assert.equal(missing.statusCode, 400, 'missing overridden_by -> 400');
    const empty = await callOverride(repoRoot, 't1', { dimension: 'goal_achieved', value: 0.9, overridden_by: '   ' });
    assert.equal(empty.statusCode, 400, 'whitespace-only overridden_by -> 400');
  } finally {
    cleanup();
  }
});

test('SCORE-02 / D-06: valid override -> 200, corrected_<dim> + stamp set, judged UNTOUCHED', async () => {
  const { repoRoot, cleanup } = await seedIsolatedStore('t1');
  try {
    const before = new Date().toISOString();
    const res = await callOverride(repoRoot, 't1', { dimension: 'goal_achieved', value: 0.9, overridden_by: 'reviewer-1' });
    assert.equal(res.statusCode, 200, 'valid override -> 200');
    assert.equal(res.body.success, true, 'response reports success');
    assert.equal(res.body.dimension, 'goal_achieved', 'response echoes the dimension');

    const meta = await readScoreMeta(repoRoot, 't1');
    assert.equal(meta.corrected_goal_achieved, 0.9, 'corrected_goal_achieved set to the override value');
    assert.equal(meta.overridden_by, 'reviewer-1', 'overridden_by stamped');
    assert.ok(meta.overridden_at, 'overridden_at stamped');
    assert.ok(meta.overridden_at >= before, 'overridden_at is a fresh ISO timestamp');
    // Judged fields UNTOUCHED (D-06).
    assert.equal(meta.goal_achieved, 0.7, 'judged goal_achieved UNCHANGED by the override');
    assert.equal(meta.code_quality, 0.6, 'other judged dimensions untouched');
    assert.equal(meta.goal_aligned_ratio, 0.8, 'goal_aligned_ratio untouched');
    // Untouched corrected_* slots remain null.
    assert.equal(meta.corrected_code_quality, null, 'untouched corrected_* slots stay null');
  } finally {
    cleanup();
  }
});

test('SCORE-02: override for a taskId with no Score -> 404', async () => {
  const { repoRoot, cleanup } = await seedIsolatedStore('t1');
  try {
    const res = await callOverride(repoRoot, 'does-not-exist', { dimension: 'goal_achieved', value: 0.9, overridden_by: 'op' });
    assert.equal(res.statusCode, 404, 'no Score for the taskId -> 404');
  } finally {
    cleanup();
  }
});
