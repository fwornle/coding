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
import { execFileSync } from 'node:child_process';

import {
  gatherEvidence,
  deriveNonGsdRubric,
  resolveTestCommand,
} from '../../lib/experiments/evidence-harness.mjs';

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

// ─────────────────────────────────────────────────────────────────────────────
// diffStat includes UNTRACKED (new) files (2026-07-23). A "create a new file" task's
// deliverable is untracked, and a plain `git diff` excludes untracked files — so the diffstat
// used to be empty and code_quality was starved. readDiffStat now intent-to-adds via a scratch
// index so new files appear, WITHOUT mutating the real index.
// ─────────────────────────────────────────────────────────────────────────────
describe('gatherEvidence — diffStat captures untracked new files (scratch-index, no side effects)', () => {
  function makeGitRepo() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-git-'));
    const g = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });
    g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
    fs.writeFileSync(path.join(root, 'README.md'), 'hi\n');
    g('add', '.'); g('commit', '-qm', 'init');
    return { root, g };
  }

  test('a new untracked file shows in diffStat → non-null, high code_quality; real index untouched', () => {
    const { root, g } = makeGitRepo();
    try {
      // Simulate the agent creating the deliverable — UNTRACKED.
      fs.writeFileSync(path.join(root, 'fizzbuzz.mjs'), 'export function fizzbuzz(n){\n  return String(n);\n}\n');
      const ev = gatherEvidence({ span: { meta: {} }, repoRoot: root });
      assert.ok(typeof ev.diffStat === 'string' && /fizzbuzz\.mjs/.test(ev.diffStat), `diffStat should list the new file, got: ${ev.diffStat}`);
      assert.match(ev.diffStat, /1 file changed/);
      const rubric = deriveNonGsdRubric(ev);
      assert.equal(typeof rubric.code_quality, 'number');
      assert.ok(rubric.code_quality > 0.5, `a small clean new file should score high, got ${rubric.code_quality}`);
      // Side-effect-free: the file is still UNTRACKED (?? ), never staged into the real index.
      assert.match(g('status', '--porcelain').trim(), /^\?\? fizzbuzz\.mjs$/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('a clean repo (no changes) yields a null diffStat (no fabricated churn)', () => {
    const { root } = makeGitRepo();
    try {
      const ev = gatherEvidence({ span: { meta: {} }, repoRoot: root });
      assert.equal(ev.diffStat, null);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 76, Plan 76-03 (VALID-03 / D-08..D-11) — deterministic non-GSD rubric
// derivation: the working-tree diff → code_quality; a fail-soft fixed-argv test
// run → test_coverage + regressions. A dim is null ONLY when genuinely no signal
// exists (no diff AND no runnable test), never merely because GSD files are absent
// (D-11), and NEVER a guessed 0 on a failed/missing run (D-10). The derivation is
// deterministic — NOT an LLM judge (D-08 / security note).
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveNonGsdRubric — null only when no signal (D-11), never a guessed 0 (D-10)', () => {
  test('no diff AND no runnable test → all three dims null', () => {
    const r = deriveNonGsdRubric({ diffStat: null, testRun: null });
    assert.equal(r.code_quality, null);
    assert.equal(r.test_coverage, null);
    assert.equal(r.regressions, null);
  });

  test('diff present → non-null code_quality bounded to [0,1]; other dims null without a test', () => {
    const r = deriveNonGsdRubric({
      diffStat: ' 3 files changed, 42 insertions(+), 10 deletions(-)',
      testRun: null,
    });
    assert.equal(typeof r.code_quality, 'number');
    assert.ok(r.code_quality >= 0 && r.code_quality <= 1);
    assert.equal(r.test_coverage, null);
    assert.equal(r.regressions, null);
  });

  test('passing test run (counts, 0 failures) → coverage non-null + regressions clean (0)', () => {
    const r = deriveNonGsdRubric({
      diffStat: null,
      testRun: { status: 0, counts: { passed: 5, failed: 0 } },
    });
    assert.equal(typeof r.test_coverage, 'number');
    assert.ok(r.test_coverage > 0);
    assert.equal(r.regressions, 0); // 0 is a REAL clean signal here, not null
  });

  test('failed run with NO parseable counts → coverage null (never 0) + regressions flagged (1)', () => {
    const r = deriveNonGsdRubric({
      diffStat: null,
      testRun: { status: 3, counts: null },
    });
    assert.equal(r.test_coverage, null); // null, NOT a guessed 0 (D-10)
    assert.notEqual(r.test_coverage, 0);
    assert.equal(r.regressions, 1);
  });

  test('parsed counts WITH failures → coverage is the pass rate (non-null) + regressions flagged', () => {
    const r = deriveNonGsdRubric({
      diffStat: null,
      testRun: { status: 1, counts: { passed: 3, failed: 1 } },
    });
    assert.equal(typeof r.test_coverage, 'number');
    assert.equal(r.regressions, 1);
  });
});

describe('resolveTestCommand — run-metadata first, else package.json test (D-09), argv-only (D-10)', () => {
  let root;
  before(() => { ({ root } = makeRepo('ev-cmd-')); });
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  test('run-metadata span.meta.test_command wins, tokenized to a fixed argv array', () => {
    const argv = resolveTestCommand({ meta: { test_command: 'node --test tests/x.mjs' } }, root);
    assert.deepEqual(argv, ['node', '--test', 'tests/x.mjs']);
  });

  test('top-level span.test_command is honored when meta is absent', () => {
    const argv = resolveTestCommand({ test_command: 'node --test y.mjs' }, root);
    assert.deepEqual(argv, ['node', '--test', 'y.mjs']);
  });

  test('a command needing shell interpretation is rejected → null (D-10 injection guard)', () => {
    assert.equal(resolveTestCommand({ meta: { test_command: 'node --test && rm -rf /' } }, root), null);
    assert.equal(resolveTestCommand({ meta: { test_command: 'node -e "process.exit(1)"' } }, root), null);
    assert.equal(resolveTestCommand({ meta: { test_command: 'echo $HOME | cat' } }, root), null);
  });

  test('falls back to package.json "test" script as a fixed argv (npm run test)', () => {
    fs.writeFileSync(path.join(root, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { test: 'node --test' } }));
    const argv = resolveTestCommand({}, root);
    assert.deepEqual(argv, ['npm', 'run', 'test']);
  });

  test('no metadata and no package.json test script → null (genuinely no command)', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-nocmd-'));
    try {
      assert.equal(resolveTestCommand({}, bare), null);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });
});

describe('gatherEvidence — runs the resolved test command fail-soft via fixed-argv spawnSync (D-08 exec seam)', () => {
  test('passing node:test fixture → testRun carries parsed counts; derive gives non-null coverage', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-run-pass-'));
    try {
      fs.writeFileSync(path.join(root, 'pass.test.mjs'),
        "import { test } from 'node:test';\ntest('ok', () => {});\n");
      const ev = gatherEvidence({
        span: { meta: { test_command: 'node --test pass.test.mjs' } },
        phaseArg: '88',
        repoRoot: root,
      });
      assert.ok(ev.testRun && ev.testRun.counts, 'testRun.counts should be parsed');
      assert.equal(ev.testRun.counts.failed, 0);
      const r = deriveNonGsdRubric(ev);
      assert.ok(r.test_coverage > 0);
      assert.equal(r.regressions, 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('non-zero-exit command with no TAP counts → testRun present, coverage null, regressions flagged', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-run-fail-'));
    try {
      fs.writeFileSync(path.join(root, 'run-fail.mjs'), 'process.exit(3);\n');
      const ev = gatherEvidence({
        span: { meta: { test_command: 'node run-fail.mjs' } },
        phaseArg: '88',
        repoRoot: root,
      });
      assert.ok(ev.testRun, 'testRun object present (command ran)');
      const r = deriveNonGsdRubric(ev);
      assert.equal(r.test_coverage, null);
      assert.equal(r.regressions, 1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('no resolvable test command → testRun null (no diff+no test ⇒ all three dims null)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-run-none-'));
    try {
      const ev = gatherEvidence({ phaseArg: '88', repoRoot: root });
      assert.equal(ev.testRun, null);
      const r = deriveNonGsdRubric(ev);
      // no diff (tmpdir is not a git repo) AND no test → all null
      assert.equal(r.test_coverage, null);
      assert.equal(r.regressions, null);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('the test-command exec is a fixed argv array — the source contains no shell:true', () => {
    const src = fs.readFileSync(
      new URL('../../lib/experiments/evidence-harness.mjs', import.meta.url), 'utf8');
    assert.equal(/shell\s*:\s*true/.test(src), false);
    assert.ok(src.includes('spawnSync'));
  });
});
