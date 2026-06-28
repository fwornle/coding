// tests/experiments/run-read.test.mjs
//
// DASH-01 RED test (Phase 74, Wave 0): `readRuns(store, { includePending })` from
// the as-yet-unwritten `lib/experiments/query.mjs`. This test MUST currently fail
// at import — `query.mjs` does not exist. Plan 02 turns it GREEN.
//
// Contract proven here:
//   - readRuns joins each Run to its Score + Outcome by `metadata.run_task_id`
//     (Run side keys on metadata.task_id; Score/Outcome side on run_task_id —
//     RESEARCH §Code Examples readRuns).
//   - `pending` Runs are EXCLUDED unless `includePending: true` (D-06 quarantine).
//
// node:test + node:assert/strict (the tests/experiments convention). Output via
// process.stderr.write only (no console.* — no-console-log, CLAUDE.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { seedIsolatedStore } from './_fixtures/seed-experiment-store.mjs';

test('DASH-01: readRuns joins Run -> Score + Outcome by run_task_id', async () => {
  const { repoRoot, cleanup } = await seedIsolatedStore('run-read-t1');
  try {
    const { openExperimentStore } = await import('../../lib/experiments/store.mjs');
    const { readRuns } = await import('../../lib/experiments/query.mjs');
    const store = await openExperimentStore({ repoRoot });
    try {
      const runs = await readRuns(store, {});
      assert.equal(runs.length, 1, 'one non-pending Run is returned');
      const r = runs[0];
      assert.equal(r.task_id, 'run-read-t1', 'Run task_id present on the row');
      assert.ok(r.score, 'Score joined onto the Run');
      assert.equal(r.score.goal_aligned_ratio, 0.8, 'joined Score carries the judged ratio');
      assert.ok(r.outcome, 'Outcome joined onto the Run');
    } finally {
      await store.close();
    }
  } finally {
    cleanup();
  }
});

test('DASH-01 / D-06: pending Runs are excluded unless includePending:true', async () => {
  const { repoRoot, cleanup } = await seedIsolatedStore('run-read-pending', { pending: true });
  try {
    const { openExperimentStore } = await import('../../lib/experiments/store.mjs');
    const { readRuns } = await import('../../lib/experiments/query.mjs');
    const store = await openExperimentStore({ repoRoot });
    try {
      const defaultRuns = await readRuns(store, {});
      assert.equal(defaultRuns.length, 0, 'pending Run excluded by default (D-06)');
      const withPending = await readRuns(store, { includePending: true });
      assert.equal(withPending.length, 1, 'pending Run included when includePending:true');
      assert.equal(withPending[0].pending, true, 'the included Run is the pending one');
    } finally {
      await store.close();
    }
  } finally {
    cleanup();
  }
});
