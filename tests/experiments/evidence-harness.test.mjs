// tests/experiments/evidence-harness.test.mjs
//
// Phase 73, Plan 73-03 (Wave 1) — fail-soft + parse suite for gatherEvidence
// (D-01). Builds a tmpdir mimicking a `<repoRoot>/.planning/phases/<NN>-x/` dir
// and proves: (A) present artifacts parse, (B) absent artifacts are null (NOT
// zero / NOT '' — strict D-01 calibration), (C) diffStat never throws.
//
// Convention: node:test + node:assert/strict (the established tests/experiments/
// pattern — NOT jest globals). Output via process.stderr.write only.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { gatherEvidence } from '../../lib/experiments/evidence-harness.mjs';

// Build a throwaway repoRoot with a .planning/phases/<NN>-slug/ dir.
function makeRepo(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const phaseDir = path.join(root, '.planning', 'phases', '88-evidence-fixture');
  fs.mkdirSync(phaseDir, { recursive: true });
  return { root, phaseDir };
}

describe('gatherEvidence — Case A: all artifacts present', () => {
  let root; let phaseDir;
  before(() => {
    ({ root, phaseDir } = makeRepo('ev-present-'));
    fs.writeFileSync(path.join(phaseDir, '88-VERIFICATION.md'),
      '---\nphase: 88\nstatus: passed\n---\n# Verification\n**Status:** passed\n');
    fs.writeFileSync(path.join(phaseDir, '88-REVIEW.md'),
      '---\nfindings:\n  critical: 0\n  warning: 2\n  info: 1\n  total: 3\n---\n# Review\n');
    fs.writeFileSync(path.join(phaseDir, '88-01-PLAN.md'),
      '---\nphase: 88\n---\n<tasks>\n'
      + '<task type="auto"><name>Task 1: build the thing</name></task>\n'
      + '<task type="auto"><name>Task 2: test the thing</name></task>\n'
      + '</tasks>\n');
  });
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  test('verification verdict parsed (PASSED)', () => {
    const ev = gatherEvidence({ phaseArg: '88', repoRoot: root });
    assert.equal(ev.verification, 'PASSED');
  });

  test('reviewFindings === total count line (3)', () => {
    const ev = gatherEvidence({ phaseArg: '88', repoRoot: root });
    assert.equal(ev.reviewFindings, 3);
  });

  test('planTasks is a non-empty array of task names', () => {
    const ev = gatherEvidence({ phaseArg: '88', repoRoot: root });
    assert.ok(Array.isArray(ev.planTasks));
    assert.equal(ev.planTasks.length, 2);
    assert.deepEqual(ev.planTasks, ['Task 1: build the thing', 'Task 2: test the thing']);
  });
});

describe('gatherEvidence — Case B: all artifacts absent (fail-soft → null)', () => {
  let root;
  before(() => { ({ root } = makeRepo('ev-empty-')); });
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  test('each on-disk slot is null — never 0, never empty string', () => {
    const ev = gatherEvidence({ phaseArg: '88', repoRoot: root });
    // strict null: a dimension with no evidence is null, NOT zero/guessed (D-01)
    assert.equal(ev.verification, null);
    assert.equal(ev.reviewFindings, null);
    assert.equal(ev.testSummary, null);
    assert.equal(ev.planTasks, null);
    // explicitly assert it is NOT the wrong fail-open values
    assert.notEqual(ev.reviewFindings, 0);
    assert.notEqual(ev.planTasks, '');
  });

  test('unknown phase → still returns the structured object, all on-disk slots null', () => {
    const ev = gatherEvidence({ phaseArg: '99999', repoRoot: root });
    assert.equal(ev.verification, null);
    assert.equal(ev.reviewFindings, null);
    assert.equal(ev.testSummary, null);
    assert.equal(ev.planTasks, null);
  });
});

describe('gatherEvidence — Case C: diffStat never throws', () => {
  let root;
  before(() => { ({ root } = makeRepo('ev-diff-')); });
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  test('diffStat is null or a string, and the call never throws', () => {
    let ev;
    assert.doesNotThrow(() => { ev = gatherEvidence({ phaseArg: '88', repoRoot: root }); });
    assert.ok(ev.diffStat === null || typeof ev.diffStat === 'string');
  });

  test('harness never throws on a totally missing .planning tree', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-bare-'));
    try {
      let ev;
      assert.doesNotThrow(() => { ev = gatherEvidence({ phaseArg: '88', repoRoot: bare }); });
      assert.equal(ev.verification, null);
      assert.equal(ev.planTasks, null);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });
});
