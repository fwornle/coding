// tests/experiments/consequential-events.test.mjs
//
// Phase 73, Plan 73-01 (Wave 1) — golden-fixture suite for the pure, zero-LLM
// route-logic primitives in lib/experiments/consequential-events.mjs (ROUTE-03):
// the consequential-event classifier (D-02), filterConsequential / isTrivialRun
// (D-04), and the toward/(toward+away) neutral-excluded ratio with null-not-zero
// degradation (D-02, threat T-73-01-COERCE). ONE describe block per exported
// function, each with at least one TRUE-NEGATIVE case (D-06/D-08).
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
  isConsequentialTool,
  CONSEQUENTIAL_TOOLS,
  filterConsequential,
  isTrivialRun,
  TRIVIAL_THRESHOLD,
  computeGoalAlignedRatio,
} from '../../lib/experiments/consequential-events.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'route');

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), 'utf8'));
}

describe('isConsequentialTool', () => {
  test('acting tools are consequential', () => {
    for (const name of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash', 'Task']) {
      assert.equal(isConsequentialTool(name), true, `${name} should be consequential`);
    }
  });

  test('navigation/read tools are NOT consequential — true-negative', () => {
    for (const name of ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoWrite']) {
      assert.equal(isConsequentialTool(name), false, `${name} should NOT be consequential`);
    }
  });

  test('unknown / non-string names are non-consequential (default navigation)', () => {
    assert.equal(isConsequentialTool('Unknowntool'), false);
    assert.equal(isConsequentialTool(''), false);
    assert.equal(isConsequentialTool(undefined), false);
    assert.equal(isConsequentialTool(null), false);
  });

  test('CONSEQUENTIAL_TOOLS is a frozen set (immutable contract)', () => {
    assert.equal(Object.isFrozen(CONSEQUENTIAL_TOOLS), true);
    assert.deepEqual(
      [...CONSEQUENTIAL_TOOLS].sort(),
      ['Bash', 'Edit', 'MultiEdit', 'NotebookEdit', 'Task', 'Write'],
    );
  });
});

describe('filterConsequential', () => {
  test('empty trace returns []', () => {
    assert.deepEqual(filterConsequential([]), []);
  });

  test('non-array trace returns [] (null/undefined guard)', () => {
    assert.deepEqual(filterConsequential(null), []);
    assert.deepEqual(filterConsequential(undefined), []);
    assert.deepEqual(filterConsequential('not-an-array'), []);
  });

  test('cross-agent mixed trace returns only acting events, preserving seq order', () => {
    const trace = loadFixture('consequential-mixed');
    const kept = filterConsequential(trace);
    // Edit(seq2, claude), Bash(seq4, copilot), Task(seq6, opencode) survive;
    // Read/Glob/Grep/Read are dropped.
    assert.equal(kept.length, 3);
    assert.deepEqual(kept.map((e) => e.seq), [2, 4, 6]);
    assert.deepEqual(kept.map((e) => e.tool_name), ['Edit', 'Bash', 'Task']);
    // exercised across all three agents
    assert.deepEqual(kept.map((e) => e.agent), ['claude', 'copilot', 'opencode']);
  });

  test('all-navigation trace returns [] — true-negative', () => {
    const trace = [
      { seq: 0, tool_call_id: 'n0', tool_name: 'Read', inputs_digest: 'd0', target_path: '/a', started_at: '2026-06-24T11:00:00.000Z', ended_at: '2026-06-24T11:00:01.000Z', outcome: 'success', agent: 'claude' },
      { seq: 1, tool_call_id: 'n1', tool_name: 'Grep', inputs_digest: 'd1', target_path: null, started_at: '2026-06-24T11:00:02.000Z', ended_at: '2026-06-24T11:00:03.000Z', outcome: 'success', agent: 'claude' },
    ];
    assert.deepEqual(filterConsequential(trace), []);
  });
});

describe('isTrivialRun', () => {
  test('TRIVIAL_THRESHOLD is 1 (D-04)', () => {
    assert.equal(TRIVIAL_THRESHOLD, 1);
  });

  test('a run with zero consequential events is trivial (no LLM needed)', () => {
    const trace = [
      { seq: 0, tool_call_id: 'n0', tool_name: 'Read', inputs_digest: 'd0', target_path: '/a', started_at: '2026-06-24T11:00:00.000Z', ended_at: '2026-06-24T11:00:01.000Z', outcome: 'success', agent: 'claude' },
      { seq: 1, tool_call_id: 'n1', tool_name: 'Glob', inputs_digest: 'd1', target_path: null, started_at: '2026-06-24T11:00:02.000Z', ended_at: '2026-06-24T11:00:03.000Z', outcome: 'success', agent: 'copilot' },
    ];
    assert.equal(isTrivialRun(trace), true);
  });

  test('empty / null trace is trivial', () => {
    assert.equal(isTrivialRun([]), true);
    assert.equal(isTrivialRun(null), true);
  });

  test('a run with >=1 consequential event is NOT trivial — true-negative', () => {
    const trace = loadFixture('consequential-mixed');
    assert.equal(isTrivialRun(trace), false);
  });
});

describe('computeGoalAlignedRatio', () => {
  const L = (label) => ({ seq: 0, label });

  test('empty labels returns null (could-not-compute, NOT 0)', () => {
    assert.equal(computeGoalAlignedRatio([]), null);
  });

  test('non-array labels returns null (null/undefined guard)', () => {
    assert.equal(computeGoalAlignedRatio(null), null);
    assert.equal(computeGoalAlignedRatio(undefined), null);
  });

  test('all-neutral labels returns null (denominator zero → null, NOT 0) — true-negative', () => {
    assert.equal(computeGoalAlignedRatio([L('neutral'), L('neutral'), L('neutral')]), null);
  });

  test('neutral is excluded from the denominator: [toward,toward,away,neutral] → 2/3', () => {
    assert.equal(
      computeGoalAlignedRatio([L('toward'), L('toward'), L('away'), L('neutral')]),
      2 / 3,
    );
  });

  test('all-toward returns 1', () => {
    assert.equal(computeGoalAlignedRatio([L('toward'), L('toward')]), 1);
  });

  test('all-away returns 0 (labels present, genuinely all-away — distinct from null)', () => {
    assert.equal(computeGoalAlignedRatio([L('away'), L('away')]), 0);
  });

  test('unknown labels are excluded from both counts (like neutral)', () => {
    // one toward, one away, one junk → denom = 2, ratio 1/2
    assert.equal(computeGoalAlignedRatio([L('toward'), L('away'), L('sideways')]), 0.5);
  });
});
