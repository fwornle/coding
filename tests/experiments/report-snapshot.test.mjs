// tests/experiments/report-snapshot.test.mjs
//
// DASH-03 RED test (Phase 74, Wave 0) — the LOAD-BEARING snapshot-stability
// property. `writeReport` / `refreshReport` + the Report read path live in the
// as-yet-unwritten `lib/experiments/report-write.mjs`, so this test MUST currently
// fail at import. Plan 05 turns it GREEN.
//
// Contract proven here (D-04 "stable until Refresh"):
//   1. writeReport freezes a snapshot from the current query.
//   2. Mutating an underlying Run/Score then RE-READING the Report leaves the
//      snapshot UNCHANGED (frozen).
//   3. refreshReport re-runs the query — the snapshot NOW reflects the mutation.
//
// node:test + node:assert/strict. Output via process.stderr.write only.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { seedIsolatedStore } from './_fixtures/seed-experiment-store.mjs';

/** Read back the frozen snapshot for a report_id (the materialized row array). */
async function readSnapshot(store, reportId) {
  const { readReport } = await import('../../lib/experiments/report-write.mjs');
  const report = await readReport(store, { report_id: reportId });
  return report?.snapshot ?? null;
}

test('DASH-03: snapshot stays FROZEN until refreshReport re-runs the query', async () => {
  const { repoRoot, cleanup } = await seedIsolatedStore('report-snap-t1');
  try {
    const { openExperimentStore } = await import('../../lib/experiments/store.mjs');
    const { writeReport, refreshReport } = await import('../../lib/experiments/report-write.mjs');
    const { applyOverride } = await import('../../lib/experiments/score-write.mjs');

    // 1. Freeze a snapshot.
    let frozen;
    {
      const store = await openExperimentStore({ repoRoot });
      try {
        await writeReport(store, { report_id: 'snap-1', name: 'frozen', query: { includePending: false } });
        frozen = await readSnapshot(store, 'snap-1');
        assert.ok(Array.isArray(frozen) && frozen.length === 1, 'snapshot froze the single seeded run');
      } finally {
        await store.close();
      }
    }

    // 2. Mutate the underlying Score, then re-read the Report — snapshot UNCHANGED.
    {
      const store = await openExperimentStore({ repoRoot });
      try {
        await applyOverride(store, { taskId: 'report-snap-t1', dimension: 'goal_achieved', value: 0.1, by: 'tester' });
        const stillFrozen = await readSnapshot(store, 'snap-1');
        assert.deepEqual(stillFrozen, frozen, 'snapshot is STABLE across the underlying mutation (DASH-03)');
      } finally {
        await store.close();
      }
    }

    // 3. refreshReport — snapshot NOW reflects the mutation.
    {
      const store = await openExperimentStore({ repoRoot });
      try {
        await refreshReport(store, { report_id: 'snap-1' });
        const refreshed = await readSnapshot(store, 'snap-1');
        assert.notDeepEqual(refreshed, frozen, 'after refresh the snapshot reflects the mutated Score');
      } finally {
        await store.close();
      }
    }
  } finally {
    cleanup();
  }
});
