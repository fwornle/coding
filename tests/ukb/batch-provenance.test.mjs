/**
 * Contract for selectBatchesForReport — which completed batches the UKB history
 * detail endpoint may attribute to a given workflow report.
 *
 * Background: .data/batch-checkpoints.json is ONE current, project-wide file,
 * not a per-run artifact. The endpoint used to decide whether to attach it by
 * testing `workflowName.includes('batch')`, then attached the WHOLE file. Two
 * problems, both of which these tests pin:
 *
 *   1. the gate was a substring match on a display name — true today only
 *      because batch-analysis.yaml happens to be the one workflow declaring the
 *      batch steps, and silently false the moment anything is renamed;
 *   2. whichever report matched was credited with every batch the project had
 *      ever completed, including batches from other runs.
 *
 * Attribution is now by provenance — a batch belongs to the report whose
 * [start, end] window contains its completedAt — so both go away and the gate
 * no longer depends on what the workflow is called.
 *
 * Runner: node --test tests/ukb/batch-provenance.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { selectBatchesForReport } from '../../integrations/system-health-dashboard/batch-provenance.mjs';

const b = (id, completedAt, commits = 1) => ({
  batchId: id,
  completedAt,
  stats: { commits },
});

// Mirrors the real file: one run's worth of batches on 2026-03-06.
const MARCH_RUN = [
  b('batch-001', '2026-03-06T05:57:07.866Z', 47),
  b('batch-002', '2026-03-06T06:01:11.000Z', 29),
  b('batch-003', '2026-03-06T06:07:22.026Z', 39),
];

describe('selectBatchesForReport — provenance, not workflow name', () => {
  test('the run that produced the batches gets all of them', () => {
    const picked = selectBatchesForReport(MARCH_RUN, {
      startTime: '2026-03-06T05:56:52.464Z',
      endTime: '2026-03-06T06:09:29.870Z',
    });
    assert.equal(picked.length, 3);
    assert.equal(
      picked.reduce((s, x) => s + x.stats.commits, 0),
      115,
    );
  });

  test('a LATER run is not credited with an earlier run\'s batches', () => {
    // The exact failure the name gate hid: every matching report got the whole
    // file. This wave-analysis-era window post-dates the batches entirely.
    const picked = selectBatchesForReport(MARCH_RUN, {
      startTime: '2026-06-10T20:02:24.549Z',
      endTime: '2026-06-10T20:22:48.126Z',
    });
    assert.deepEqual(picked, []);
  });

  test('an EARLIER run is not credited either', () => {
    const picked = selectBatchesForReport(MARCH_RUN, {
      startTime: '2025-11-01T00:00:00.000Z',
      endTime: '2025-11-01T01:00:00.000Z',
    });
    assert.deepEqual(picked, []);
  });

  test('only the batches inside the window are taken', () => {
    const picked = selectBatchesForReport(MARCH_RUN, {
      startTime: '2026-03-06T06:00:00.000Z',
      endTime: '2026-03-06T06:05:00.000Z',
    });
    assert.deepEqual(picked.map((x) => x.batchId), ['batch-002']);
  });

  test('the decision does not consult the workflow name at all', () => {
    // Same batches, same window, name varied across the three real workflows
    // plus a hypothetical rename. All must agree — that is the whole point.
    const window = {
      startTime: '2026-03-06T05:56:52.464Z',
      endTime: '2026-03-06T06:09:29.870Z',
    };
    for (const name of ['batch-analysis', 'wave-analysis', 'incremental-analysis', 'renamed']) {
      const picked = selectBatchesForReport(MARCH_RUN, { ...window, workflowName: name });
      assert.equal(picked.length, 3, `name "${name}" changed the result`);
    }
  });

  test('boundary timestamps are inside the window', () => {
    const picked = selectBatchesForReport(MARCH_RUN, {
      startTime: '2026-03-06T05:57:07.866Z',
      endTime: '2026-03-06T06:07:22.026Z',
    });
    assert.equal(picked.length, 3);
  });
});

describe('selectBatchesForReport — open and missing windows', () => {
  test('a run with no end time is still in flight: the window stays open', () => {
    const picked = selectBatchesForReport(MARCH_RUN, {
      startTime: '2026-03-06T05:56:52.464Z',
    });
    assert.equal(picked.length, 3);
  });

  test('a report with NO start time attributes nothing', () => {
    // No window means no evidence. Returning everything here is exactly the
    // behaviour being removed.
    assert.deepEqual(selectBatchesForReport(MARCH_RUN, { endTime: '2026-03-06T06:09:29.870Z' }), []);
    assert.deepEqual(selectBatchesForReport(MARCH_RUN, {}), []);
  });

  test('an unparseable start time is treated as absent, not as epoch 0', () => {
    assert.deepEqual(selectBatchesForReport(MARCH_RUN, { startTime: 'not a date' }), []);
  });

  test('an unparseable END time leaves the window open rather than closing it at 0', () => {
    const picked = selectBatchesForReport(MARCH_RUN, {
      startTime: '2026-03-06T05:56:52.464Z',
      endTime: 'not a date',
    });
    assert.equal(picked.length, 3);
  });
});

describe('selectBatchesForReport — unattributable and malformed input', () => {
  test('a batch with no completedAt is excluded, not guessed at', () => {
    const mixed = [...MARCH_RUN, { batchId: 'legacy', stats: { commits: 999 } }];
    const picked = selectBatchesForReport(mixed, {
      startTime: '2026-03-06T05:56:52.464Z',
      endTime: '2026-03-06T06:09:29.870Z',
    });
    assert.equal(picked.length, 3);
    assert.ok(!picked.some((x) => x.batchId === 'legacy'));
  });

  test('empty, missing and non-array inputs yield an empty selection', () => {
    const w = { startTime: '2026-03-06T05:56:52.464Z' };
    assert.deepEqual(selectBatchesForReport([], w), []);
    assert.deepEqual(selectBatchesForReport(null, w), []);
    assert.deepEqual(selectBatchesForReport(undefined, w), []);
    assert.deepEqual(selectBatchesForReport({ nope: true }, w), []);
  });

  test('a null entry does not throw', () => {
    const picked = selectBatchesForReport([null, ...MARCH_RUN], {
      startTime: '2026-03-06T05:56:52.464Z',
      endTime: '2026-03-06T06:09:29.870Z',
    });
    assert.equal(picked.length, 3);
  });

  test('file order is preserved', () => {
    const picked = selectBatchesForReport(MARCH_RUN, {
      startTime: '2026-03-06T05:56:52.464Z',
      endTime: '2026-03-06T06:09:29.870Z',
    });
    assert.deepEqual(picked.map((x) => x.batchId), ['batch-001', 'batch-002', 'batch-003']);
  });
});

describe('selectBatchesForReport — team', () => {
  test('a definite team mismatch rejects the file', () => {
    const picked = selectBatchesForReport(MARCH_RUN, {
      startTime: '2026-03-06T05:56:52.464Z',
      endTime: '2026-03-06T06:09:29.870Z',
      team: 'coding',
      checkpointTeam: 'other-team',
    });
    assert.deepEqual(picked, []);
  });

  test('a matching team is accepted', () => {
    const picked = selectBatchesForReport(MARCH_RUN, {
      startTime: '2026-03-06T05:56:52.464Z',
      endTime: '2026-03-06T06:09:29.870Z',
      team: 'coding',
      checkpointTeam: 'coding',
    });
    assert.equal(picked.length, 3);
  });

  test('an unknown team on either side is not treated as a mismatch', () => {
    // Rejecting on unknown would blank cards that work today.
    const w = { startTime: '2026-03-06T05:56:52.464Z', endTime: '2026-03-06T06:09:29.870Z' };
    assert.equal(selectBatchesForReport(MARCH_RUN, { ...w, team: 'coding' }).length, 3);
    assert.equal(selectBatchesForReport(MARCH_RUN, { ...w, checkpointTeam: 'coding' }).length, 3);
  });
});
