// tests/experiments/route-heuristics.test.mjs
//
// Phase 72, Plan 72-01 (Wave 1) — golden-fixture suite for the pure, zero-LLM
// `computeHeuristics(RouteEvent[])` function (ROUTE-02). ONE describe/test block
// per heuristic, each with at least one TRUE-NEGATIVE case proving the strict
// calibration (D-06/D-08), plus a block for the `computeHeuristics(null)`
// all-null path (D-02).
//
// Convention: node:test + node:assert/strict (the established tests/experiments/
// pattern — NOT jest globals). Output via process.stderr.write only
// (no console.* — no-console-log).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  computeHeuristics,
  ALL_NULL_HEURISTICS,
} from '../../lib/experiments/route-heuristics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'route');

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), 'utf8'));
}

const trueNegatives = loadFixture('true-negatives');

describe('total_step_count', () => {
  test('counts ALL events regardless of outcome (success/error/denied/abandoned) — D-07', () => {
    // 5 events: 3 success, 1 error, 1 abandoned → 5
    const trace = [
      { seq: 0, tool_call_id: 't0', tool_name: 'Read', inputs_digest: 'd0', target_path: '/a', started_at: '2026-06-24T10:00:00.000Z', ended_at: '2026-06-24T10:00:01.000Z', outcome: 'success', agent: 'claude' },
      { seq: 1, tool_call_id: 't1', tool_name: 'Bash', inputs_digest: 'd1', target_path: null, started_at: '2026-06-24T10:00:02.000Z', ended_at: '2026-06-24T10:00:03.000Z', outcome: 'error', agent: 'claude' },
      { seq: 2, tool_call_id: 't2', tool_name: 'Bash', inputs_digest: 'd2', target_path: null, started_at: '2026-06-24T10:00:04.000Z', ended_at: '2026-06-24T10:00:05.000Z', outcome: 'denied', agent: 'claude' },
      { seq: 3, tool_call_id: 't3', tool_name: 'Edit', inputs_digest: 'd3', target_path: '/a', started_at: '2026-06-24T10:00:06.000Z', ended_at: '2026-06-24T10:00:07.000Z', outcome: 'success', agent: 'claude' },
      { seq: 4, tool_call_id: 't4', tool_name: 'Bash', inputs_digest: 'd4', target_path: null, started_at: '2026-06-24T10:00:08.000Z', ended_at: null, outcome: 'abandoned', agent: 'claude' },
    ];
    assert.equal(computeHeuristics(trace).total_step_count, 5);
  });

  test('parallel same-turn calls are NOT collapsed — contribute 2 (D-07)', () => {
    const trace = loadFixture('parallel-same-turn');
    assert.equal(trace.length, 2);
    assert.equal(computeHeuristics(trace).total_step_count, 2);
  });
});

describe('wallclock_per_step', () => {
  test('exact ms/step = (last terminal − first start) / max(1, count)', () => {
    // first start 10:00:00.000, last ended 10:00:06.000 → 6000ms / 3 = 2000
    const trace = [
      { seq: 0, tool_call_id: 'w0', tool_name: 'Read', inputs_digest: 'd0', target_path: '/a', started_at: '2026-06-24T10:00:00.000Z', ended_at: '2026-06-24T10:00:02.000Z', outcome: 'success', agent: 'claude' },
      { seq: 1, tool_call_id: 'w1', tool_name: 'Read', inputs_digest: 'd1', target_path: '/b', started_at: '2026-06-24T10:00:02.000Z', ended_at: '2026-06-24T10:00:04.000Z', outcome: 'success', agent: 'claude' },
      { seq: 2, tool_call_id: 'w2', tool_name: 'Read', inputs_digest: 'd2', target_path: '/c', started_at: '2026-06-24T10:00:04.000Z', ended_at: '2026-06-24T10:00:06.000Z', outcome: 'success', agent: 'claude' },
    ];
    assert.equal(computeHeuristics(trace).wallclock_per_step, 2000);
  });

  test('single-event run → gap defined as ended − started of that event', () => {
    const trace = [
      { seq: 0, tool_call_id: 's0', tool_name: 'Bash', inputs_digest: 'd0', target_path: null, started_at: '2026-06-24T10:00:00.000Z', ended_at: '2026-06-24T10:00:03.500Z', outcome: 'success', agent: 'claude' },
    ];
    assert.equal(computeHeuristics(trace).wallclock_per_step, 3500);
  });
});

describe('abandoned_tool_count', () => {
  test('1 abandoned event (started, no terminal) → 1', () => {
    const trace = loadFixture('abandoned');
    assert.equal(computeHeuristics(trace).abandoned_tool_count, 1);
  });

  test('TRUE-NEGATIVE: a matched (success) pair → 0', () => {
    const trace = trueNegatives.abandoned_matched_pair;
    assert.equal(computeHeuristics(trace).abandoned_tool_count, 0);
  });
});

describe('redundant_read_count', () => {
  test('Read(a), Read(b), Read(a) → 1 (re-read of a, no mutation between)', () => {
    const trace = loadFixture('redundant-read');
    assert.equal(computeHeuristics(trace).redundant_read_count, 1);
  });

  test('TRUE-NEGATIVE: Read(a), Edit(a), Read(a) → 0 (state changed between reads)', () => {
    const trace = trueNegatives.redundant_read_state_changed;
    assert.equal(computeHeuristics(trace).redundant_read_count, 0);
  });
});

describe('edit_revert_count', () => {
  test('Edit-input A→B→A on same target_path → 1 (v0 input-pattern definition, OQ2/A2)', () => {
    const trace = loadFixture('edit-revert');
    assert.equal(computeHeuristics(trace).edit_revert_count, 1);
  });

  test('TRUE-NEGATIVE: A→B→C (never returns to an earlier state) → 0', () => {
    const trace = trueNegatives.edit_revert_no_return;
    assert.equal(computeHeuristics(trace).edit_revert_count, 0);
  });
});

describe('loop_count', () => {
  test('Bash(x), Bash(x), Bash(x) → 1 (one maximal cluster, NOT 2)', () => {
    const trace = loadFixture('loop');
    assert.equal(computeHeuristics(trace).loop_count, 1);
  });

  test('TRUE-NEGATIVE: Bash(x), Bash(y), Bash(x) → 0 (repeats not adjacent)', () => {
    const trace = trueNegatives.loop_not_adjacent;
    assert.equal(computeHeuristics(trace).loop_count, 0);
  });
});

describe('null trace → ALL_NULL_HEURISTICS (D-02, never 0)', () => {
  test('computeHeuristics(null) returns every metric as null', () => {
    const h = computeHeuristics(null);
    assert.deepEqual(h, ALL_NULL_HEURISTICS);
    for (const k of ['loop_count', 'edit_revert_count', 'redundant_read_count', 'abandoned_tool_count', 'total_step_count', 'wallclock_per_step']) {
      assert.equal(h[k], null, `${k} must be null, not 0`);
    }
  });

  test('ALL_NULL_HEURISTICS has exactly the six keys, all null', () => {
    const keys = Object.keys(ALL_NULL_HEURISTICS).sort();
    assert.deepEqual(keys, ['abandoned_tool_count', 'edit_revert_count', 'loop_count', 'redundant_read_count', 'total_step_count', 'wallclock_per_step']);
    assert.ok(Object.values(ALL_NULL_HEURISTICS).every((v) => v === null));
  });

  test('empty trace ([]) also yields all-null (fewer than 1 event)', () => {
    assert.deepEqual(computeHeuristics([]), ALL_NULL_HEURISTICS);
  });
});
