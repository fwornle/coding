// tests/experiments/report-write.test.mjs
//
// KB-04 RED test (Phase 74, Wave 0): `writeReport` / `refreshReport` from the
// as-yet-unwritten `lib/experiments/report-write.mjs`. This test MUST currently
// fail at import — `report-write.mjs` does not exist. Plan 05 turns it GREEN.
//
// Contract proven here:
//   - writeReport is IDEMPOTENT on `report_id`: two calls with the same report_id
//     yield the SAME entity id and exactly ONE Report node (no duplicate).
//   - refreshReport REUSES the same id while updating `snapshot_frozen_at` (the
//     snapshot is re-materialized from the current query, same node).
//
// node:test + node:assert/strict. Output via process.stderr.write only.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { seedIsolatedStore } from './_fixtures/seed-experiment-store.mjs';

/** Count Report nodes carrying a given report_id and return [count, firstId]. */
async function reportNodes(store, reportId) {
  const ids = [];
  for await (const e of store.iterate({ entityType: 'Report' })) {
    if (e.metadata?.report_id === reportId) ids.push(e.id);
  }
  return ids;
}

test('KB-04: writeReport is idempotent on report_id (one node, same id)', async () => {
  const { repoRoot, cleanup } = await seedIsolatedStore('report-write-t1');
  try {
    const { openExperimentStore } = await import('../../lib/experiments/store.mjs');
    const { writeReport } = await import('../../lib/experiments/report-write.mjs');
    const store = await openExperimentStore({ repoRoot });
    try {
      const id1 = await writeReport(store, { report_id: 'rep-1', name: 'New features', query: { includePending: false } });
      const id2 = await writeReport(store, { report_id: 'rep-1', name: 'New features', query: { includePending: false } });
      assert.equal(id1, id2, 'two writes of the same report_id return the SAME entity id');
      const ids = await reportNodes(store, 'rep-1');
      assert.equal(ids.length, 1, 'exactly one Report node exists for report_id rep-1');
    } finally {
      await store.close();
    }
  } finally {
    cleanup();
  }
});

test('KB-04: refreshReport reuses the id and updates snapshot_frozen_at', async () => {
  const { repoRoot, cleanup } = await seedIsolatedStore('report-write-t2');
  try {
    const { openExperimentStore } = await import('../../lib/experiments/store.mjs');
    const { writeReport, refreshReport } = await import('../../lib/experiments/report-write.mjs');
    const store = await openExperimentStore({ repoRoot });
    try {
      const id = await writeReport(store, { report_id: 'rep-2', name: 'All runs', query: { includePending: true } });
      const before = (await reportNodes(store, 'rep-2'))[0];
      assert.equal(before, id, 'the written node id matches the returned id');

      const refreshedId = await refreshReport(store, { report_id: 'rep-2' });
      assert.equal(refreshedId, id, 'refreshReport reuses the SAME entity id');
      const ids = await reportNodes(store, 'rep-2');
      assert.equal(ids.length, 1, 'still exactly one Report node after refresh');

      // snapshot_frozen_at is (re)stamped on refresh.
      let frozenAt = null;
      for await (const e of store.iterate({ entityType: 'Report' })) {
        if (e.metadata?.report_id === 'rep-2') frozenAt = e.metadata?.snapshot_frozen_at;
      }
      assert.ok(frozenAt, 'snapshot_frozen_at is stamped after refresh');
    } finally {
      await store.close();
    }
  } finally {
    cleanup();
  }
});
