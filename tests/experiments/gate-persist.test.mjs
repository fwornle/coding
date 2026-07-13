// tests/experiments/gate-persist.test.mjs
//
// CMP-01 / Phase 79 (D-04a) proof: the OBJECTIVE per-cell test-gate outcome the
// evidence harness already computes at close time is persisted as a discrete,
// queryable field (`gate_passed: true|false|null`) on the Score entity — DISTINCT
// from the subjective rubric (D-04). Two layers:
//   A. gateFromEvidence(evidence) — pure derivation of the three gate states from
//      the already-computed evidence.testRun (NO second test execution, D-04).
//   B. writeScore threads judgment.gate_passed onto Score.metadata as null-not-zero:
//      an ungated run (no test_command) persists gate_passed=null, NEVER false (D-02).
//
// Isolation (store-backed cases): openExperimentStore({ repoRoot }) against a tmpdir
// whose .data/ontologies-experiment/ is the REAL ontology copied verbatim (strict-path
// putEntity validates entityType:'Score'). NEVER the real single-owner store. Mirrors
// tests/experiments/score-write.test.mjs.
//
// Output via process.stderr.write only (no console.* — no-console-log / CLAUDE.md).
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
 * Build an isolated tmp repo-root with the REAL experiment ontology copied in, open
 * the store via the explicit `repoRoot` override (NOT a process.env mutation — env is
 * process-global and races under concurrent runs), and return { store, cleanup }.
 * Mirrors tests/experiments/score-write.test.mjs.
 */
async function openIsolatedStore() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'experiments-gate-persist-test-'));
  const tmpOntologyDir = path.join(tmp, '.data', 'ontologies-experiment');
  fs.mkdirSync(tmpOntologyDir, { recursive: true });
  for (const f of fs.readdirSync(SRC_ONTOLOGY_DIR)) {
    fs.copyFileSync(path.join(SRC_ONTOLOGY_DIR, f), path.join(tmpOntologyDir, f));
  }
  const { openExperimentStore } = await import('../../lib/experiments/store.mjs');
  const store = await openExperimentStore({ repoRoot: tmp });
  const cleanup = async () => {
    try { await store?.close(); } catch { /* best-effort */ }
    fs.rmSync(tmp, { recursive: true, force: true });
  };
  return { store, cleanup };
}

/** Resolve the single Score metadata for a run_task_id (read-back). */
async function readScoreMeta(store, taskId) {
  for await (const e of store.iterate({ entityType: 'Score' })) {
    if (e.metadata?.run_task_id === taskId) return e.metadata;
  }
  return undefined;
}

/** A representative writeRun arg shape (so the Run exists for the scored edge). */
function runArgs(taskId) {
  return {
    span: {
      task_id: taskId,
      started_at: '2026-07-13T05:55:15.270Z',
      ended_at: '2026-07-13T05:55:30.164Z',
      goal_sentence: 'gate persistence fixture',
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
  };
}

/** A representative full judgment object (the judge's output contract). */
function sampleJudgment(overrides = {}) {
  return {
    goal_aligned_ratio: 0.8,
    event_labels: [{ seq: 0, label: 'toward' }],
    ratio_rationale: 'mostly progressed toward the goal',
    rubric: {
      goal_achieved: 0.7, code_quality: 0.6, test_coverage: 0.5, regressions: 0, spec_drift: 0.1,
    },
    rubric_rationale: 'solid implementation',
    pending: false,
    not_scored: null,
    ...overrides,
  };
}

// ── Test A: gateFromEvidence — the three gate states + null-safety (unit, no store) ──

test('Test A: gateFromEvidence derives true|false|null from evidence.testRun (D-04a)', async () => {
  const { gateFromEvidence } = await import('../../lib/experiments/evidence-harness.mjs');
  assert.equal(typeof gateFromEvidence, 'function', 'gateFromEvidence must be exported');

  // null / undefined evidence → null (never throws, D-02 ungated).
  assert.equal(gateFromEvidence(null), null, 'null evidence → null (never throws)');
  assert.equal(gateFromEvidence(undefined), null, 'undefined evidence → null (never throws)');
  assert.equal(gateFromEvidence({}), null, 'evidence with no testRun → null');

  // testRun == null → ungated (no test_command) → null, NEVER false (null-not-zero).
  assert.equal(gateFromEvidence({ testRun: null }), null, 'no test_command → null (ungated, D-02)');

  // status === 0 → passed the objective gate.
  assert.equal(gateFromEvidence({ testRun: { status: 0 } }), true, 'exit 0 → gate_passed true');
  assert.equal(
    gateFromEvidence({ testRun: { status: 0, counts: { passed: 3, failed: 0 } } }), true,
    'exit 0 with passing counts → true',
  );

  // non-zero status → failed the objective gate.
  assert.equal(gateFromEvidence({ testRun: { status: 1 } }), false, 'exit 1 → gate_passed false');
  assert.equal(gateFromEvidence({ testRun: { status: 2 } }), false, 'exit 2 → gate_passed false');
  assert.equal(
    gateFromEvidence({ testRun: { status: 1, counts: { passed: 1, failed: 2 } } }), false,
    'non-zero exit with failing counts → false',
  );

  // A missing test must NEVER be coerced to false (null-not-zero invariant).
  assert.notEqual(gateFromEvidence({ testRun: null }), false, 'ungated must not coerce to false');
});

// ── Test B: writeScore persists gate_passed=true (read-back) ──

test('Test B: writeScore with judgment.gate_passed=true → Score.metadata.gate_passed === true', async () => {
  const { store, cleanup } = await openIsolatedStore();
  try {
    const { writeRun } = await import('../../lib/experiments/run-write.mjs');
    const { writeScore } = await import('../../lib/experiments/score-write.mjs');

    await writeRun(store, runArgs('gate-true'));
    await writeScore(store, { span: { task_id: 'gate-true' }, judgment: sampleJudgment({ gate_passed: true }) });

    const m = await readScoreMeta(store, 'gate-true');
    assert.ok(m, 'a Score was written for gate-true');
    assert.equal(m.gate_passed, true, 'gate_passed persisted as true');
  } finally {
    await cleanup();
  }
});

// ── Test C: omitted gate → null (null-not-zero, NEVER false/undefined) ──

test('Test C: writeScore with gate_passed omitted → Score.metadata.gate_passed === null (null-not-zero)', async () => {
  const { store, cleanup } = await openIsolatedStore();
  try {
    const { writeRun } = await import('../../lib/experiments/run-write.mjs');
    const { writeScore } = await import('../../lib/experiments/score-write.mjs');

    await writeRun(store, runArgs('gate-omitted'));
    // judgment WITHOUT gate_passed — an ungated run must persist null, never false.
    await writeScore(store, { span: { task_id: 'gate-omitted' }, judgment: sampleJudgment() });

    const m = await readScoreMeta(store, 'gate-omitted');
    assert.ok(m, 'a Score was written for gate-omitted');
    assert.equal(m.gate_passed, null, 'omitted gate persists as null (ungated, D-02)');
    assert.notEqual(m.gate_passed, false, 'omitted gate must NOT be coerced to false (null-not-zero)');
    assert.notEqual(m.gate_passed, undefined, 'omitted gate is an explicit null field, not absent');
  } finally {
    await cleanup();
  }
});

// ── Test D: writeScore persists gate_passed=false (read-back) ──

test('Test D: writeScore with judgment.gate_passed=false → Score.metadata.gate_passed === false', async () => {
  const { store, cleanup } = await openIsolatedStore();
  try {
    const { writeRun } = await import('../../lib/experiments/run-write.mjs');
    const { writeScore } = await import('../../lib/experiments/score-write.mjs');

    await writeRun(store, runArgs('gate-false'));
    await writeScore(store, { span: { task_id: 'gate-false' }, judgment: sampleJudgment({ gate_passed: false }) });

    const m = await readScoreMeta(store, 'gate-false');
    assert.ok(m, 'a Score was written for gate-false');
    assert.equal(m.gate_passed, false, 'gate_passed persisted as false (objective test failed)');
  } finally {
    await cleanup();
  }
});
