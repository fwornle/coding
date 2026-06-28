// tests/experiments/score-write.test.mjs
//
// SCORE-01/SCORE-02 proof (Phase 73, Plan 02): writeScore() materializes a judge's
// judgment as an idempotent, override-preserving km-core Score entity back-linked
// to its Run via a Run--scored-->Score edge (D-05). Five test groups:
//   1. writeRun then writeScore → exactly ONE Score node + ONE scored edge.
//   2. re-judge with different judged values → still ONE Score, judged reflects the
//      SECOND write (re-judge overwrites judged), ONE scored edge (no duplicate).
//   3. applyOverride sets corrected_<dim> + stamps WITHOUT mutating judged; a later
//      re-judge PRESERVES corrected_* (D-06) while refreshing judged.
//   4. tri-state markers distinguishable in storage: pending (judge failed) vs
//      not_scored:'trivial' vs a normal numeric judgment.
//   5. applyOverride with an unknown dimension throws.
//
// Isolation: openExperimentStore({ repoRoot }) opened against a tmpdir whose
// .data/experiments/leveldb is a throwaway store and whose .data/ontologies-experiment/
// is the REAL ontology copied verbatim (strict-path putEntity validates
// entityType:'Score' against the live registry — KB-01 preserved). NEVER the real
// store (single-owner LevelDB). Mirrors tests/experiments/run-write.test.mjs.
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
 * Build an isolated tmp repo-root with the REAL experiment ontology copied in, open
 * the store via the explicit `repoRoot` override (NOT a process.env mutation — env
 * is process-global and races under concurrent test runs), and return
 * { store, cleanup }. Mirrors tests/experiments/run-write.test.mjs.
 */
async function openIsolatedStore() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'experiments-score-write-test-'));
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

/** Collect every Score currently in the store (drains the async iterator). */
async function collectScores(store) {
  const out = [];
  for await (const e of store.iterate({ entityType: 'Score' })) out.push(e);
  return out;
}

/** Resolve the Run id for a task_id (the scored edge's from-node). */
async function findRunId(store, taskId) {
  for await (const e of store.iterate({ entityType: 'Run' })) {
    if (e.metadata?.task_id === taskId) return e.id;
  }
  return undefined;
}

/** The five LOCKED rubric dimensions (v73 §D5), in canonical judgment order. */
const RUBRIC_DIMENSIONS = [
  'goal_achieved', 'code_quality', 'test_coverage', 'regressions', 'spec_drift',
];

/** A representative writeRun arg shape (so the Run exists for the scored edge). */
function runArgs(overrides = {}) {
  return {
    span: {
      task_id: 't1',
      started_at: '2026-06-28T05:55:15.270Z',
      ended_at: '2026-06-28T05:55:30.164Z',
      goal_sentence: 'add the score storage half',
      ...(overrides.span ?? {}),
    },
    taskClass: overrides.taskClass ?? 'new-feature',
    pending: overrides.pending ?? false,
    tags: overrides.tags ?? {
      task_hash: 'deadbeef', agent: 'claude-code', model: 'claude-haiku-4.5',
      framework: 'gsd', trace_id: 't1',
    },
    totals: overrides.totals ?? {
      input_tokens: 100, output_tokens: 200, total_tokens: 300, reasoning_tokens: 50, calls: 4,
    },
  };
}

/** A representative full judgment object (the judge's output contract). */
function sampleJudgment(overrides = {}) {
  return {
    goal_aligned_ratio: 0.8,
    event_labels: [
      { seq: 0, label: 'toward' },
      { seq: 1, label: 'neutral' },
      { seq: 2, label: 'away' },
    ],
    ratio_rationale: 'mostly progressed toward the goal',
    rubric: {
      goal_achieved: 0.7,
      code_quality: 0.6,
      test_coverage: 0.5,
      regressions: 0,
      spec_drift: 0.1,
    },
    rubric_rationale: 'solid implementation, minor drift',
    pending: false,
    not_scored: null,
    ...overrides,
  };
}

test('SCORE-01: writeRun then writeScore → exactly ONE Score node + ONE scored edge', async () => {
  const { store, cleanup } = await openIsolatedStore();
  try {
    const { writeRun } = await import('../../lib/experiments/run-write.mjs');
    const { writeScore } = await import('../../lib/experiments/score-write.mjs');

    const runId = await writeRun(store, runArgs());
    const scoreId = await writeScore(store, { span: { task_id: 't1' }, judgment: sampleJudgment() });
    assert.ok(scoreId, 'writeScore must return the Score id');
    assert.notEqual(scoreId, 't1', 'Score id must be minted, never the raw task_id');
    assert.match(
      String(scoreId),
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      'Score id must be a UUIDv7 (mintEntityId), not the task_id string',
    );

    const scores = await collectScores(store);
    assert.equal(scores.length, 1, 'exactly one Score after the first write');
    const m = scores[0].metadata;
    assert.equal(m.run_task_id, 't1', 'Score back-links the Run via run_task_id');
    assert.equal(m.goal_aligned_ratio, 0.8, 'goal_aligned_ratio stored');
    assert.equal(m.goal_achieved, 0.7, 'judged rubric dimension stored');
    assert.equal(m.regressions, 0, '0 is a genuine judged value (NOT null)');
    assert.equal(typeof m.event_labels, 'string', 'event_labels JSON-serialized to a string');
    assert.deepEqual(JSON.parse(m.event_labels).length, 3, 'event_labels round-trips to 3 entries');

    // Exactly ONE scored edge Run --> Score.
    const rels = await store.findRelations({ type: 'scored', from: runId });
    assert.equal(rels.length, 1, 'exactly one scored relation from the Run');
    assert.equal(rels[0].to, scoreId, 'scored relation targets the Score node');
  } finally {
    await cleanup();
  }
});

test('SCORE-01: re-judge UPDATES one Score node + judged reflects the SECOND write — ONE scored edge', async () => {
  const { store, cleanup } = await openIsolatedStore();
  try {
    const { writeRun } = await import('../../lib/experiments/run-write.mjs');
    const { writeScore } = await import('../../lib/experiments/score-write.mjs');

    const runId = await writeRun(store, runArgs());
    const firstId = await writeScore(store, { span: { task_id: 't1' }, judgment: sampleJudgment() });
    // Re-judge: same task_id, different judged values.
    const secondId = await writeScore(store, {
      span: { task_id: 't1' },
      judgment: sampleJudgment({
        goal_aligned_ratio: 0.4,
        rubric: { goal_achieved: 0.2, code_quality: 0.3, test_coverage: 0.9, regressions: 1, spec_drift: 0.5 },
      }),
    });

    assert.equal(secondId, firstId, 're-judge must reuse the same Score id (no new mint)');
    const scores = await collectScores(store);
    assert.equal(scores.length, 1, 'exactly ONE Score after two writes for the same task_id (no duplicate)');
    const m = scores[0].metadata;
    assert.equal(m.goal_aligned_ratio, 0.4, 'goal_aligned_ratio reflects the SECOND write');
    assert.equal(m.goal_achieved, 0.2, 'judged goal_achieved reflects the SECOND write');
    assert.equal(m.regressions, 1, 'judged regressions reflects the SECOND write');

    // Stable-keyed scored edge dedupes — exactly ONE survives N re-judges (WR-01).
    const rels = await store.findRelations({ type: 'scored', from: runId });
    assert.equal(rels.length, 1, 're-judge must NOT add a duplicate scored edge (WR-01)');
  } finally {
    await cleanup();
  }
});

test('SCORE-02 / D-06: applyOverride sets corrected_* + stamps WITHOUT mutating judged; re-judge preserves it', async () => {
  const { store, cleanup } = await openIsolatedStore();
  try {
    const { writeRun } = await import('../../lib/experiments/run-write.mjs');
    const { writeScore, applyOverride } = await import('../../lib/experiments/score-write.mjs');

    await writeRun(store, runArgs());
    await writeScore(store, { span: { task_id: 't1' }, judgment: sampleJudgment() });

    // Override the goal_achieved dimension.
    const before = new Date().toISOString();
    const overrideId = await applyOverride(store, {
      taskId: 't1', dimension: 'goal_achieved', value: 0.9, by: 'op',
    });
    assert.ok(overrideId, 'applyOverride returns the Score id');

    let scores = await collectScores(store);
    assert.equal(scores.length, 1, 'override does not create a new Score node');
    let m = scores[0].metadata;
    assert.equal(m.corrected_goal_achieved, 0.9, 'corrected_goal_achieved set to the override value');
    assert.equal(m.overridden_by, 'op', 'overridden_by stamped');
    assert.ok(m.overridden_at, 'overridden_at stamped');
    assert.ok(m.overridden_at >= before, 'overridden_at is a fresh ISO timestamp');
    assert.equal(m.goal_achieved, 0.7, 'judged goal_achieved UNCHANGED by the override (D-06)');
    // Other corrected_* slots remain null.
    assert.equal(m.corrected_code_quality, null, 'untouched corrected_* slots stay null');

    // Re-judge with fresh judged values — corrected_* must SURVIVE (D-06).
    await writeScore(store, {
      span: { task_id: 't1' },
      judgment: sampleJudgment({
        rubric: { goal_achieved: 0.2, code_quality: 0.3, test_coverage: 0.4, regressions: 0, spec_drift: 0.2 },
      }),
    });
    scores = await collectScores(store);
    assert.equal(scores.length, 1, 'still ONE Score after override + re-judge');
    m = scores[0].metadata;
    assert.equal(m.corrected_goal_achieved, 0.9, 'corrected_goal_achieved SURVIVES the re-judge (D-06)');
    assert.equal(m.overridden_by, 'op', 'overridden_by survives the re-judge');
    assert.equal(m.goal_achieved, 0.2, 'judged goal_achieved refreshed by the re-judge');
  } finally {
    await cleanup();
  }
});

test('D-04: tri-state markers — pending vs not_scored:trivial vs numeric are distinguishable', async () => {
  const { store, cleanup } = await openIsolatedStore();
  try {
    const { writeRun } = await import('../../lib/experiments/run-write.mjs');
    const { writeScore } = await import('../../lib/experiments/score-write.mjs');

    // (a) pending — judge failed / proxy down: judged null + pending true.
    await writeRun(store, runArgs({ span: { task_id: 'tp' } }));
    await writeScore(store, { span: { task_id: 'tp' }, judgment: { pending: true } });

    // (b) trivial — judge skipped: judged null + not_scored 'trivial'.
    await writeRun(store, runArgs({ span: { task_id: 'tt' } }));
    await writeScore(store, { span: { task_id: 'tt' }, judgment: { not_scored: 'trivial' } });

    // (c) normal — numeric values, pending false, not_scored null.
    await writeRun(store, runArgs({ span: { task_id: 'tn' } }));
    await writeScore(store, { span: { task_id: 'tn' }, judgment: sampleJudgment() });

    const scores = await collectScores(store);
    assert.equal(scores.length, 3, 'three distinct Scores written');
    const byTask = Object.fromEntries(scores.map((s) => [s.metadata.run_task_id, s.metadata]));

    // (a) pending: every judged dimension null, pending true, not_scored null.
    assert.equal(byTask.tp.pending, true, 'pending marker true');
    assert.equal(byTask.tp.not_scored, null, 'pending run has not_scored null');
    assert.equal(byTask.tp.goal_aligned_ratio, null, 'pending run goal_aligned_ratio null');
    for (const d of RUBRIC_DIMENSIONS) {
      assert.equal(byTask.tp[d], null, `pending run judged '${d}' must be null (not 0)`);
    }

    // (b) trivial: judged null, not_scored 'trivial', pending false.
    assert.equal(byTask.tt.not_scored, 'trivial', 'trivial marker preserved');
    assert.equal(byTask.tt.pending, false, 'trivial run pending false');
    assert.equal(byTask.tt.goal_aligned_ratio, null, 'trivial run goal_aligned_ratio null');
    for (const d of RUBRIC_DIMENSIONS) {
      assert.equal(byTask.tt[d], null, `trivial run judged '${d}' must be null (not 0)`);
    }

    // (c) normal: numeric values, pending false, not_scored null.
    assert.equal(byTask.tn.pending, false, 'normal run pending false');
    assert.equal(byTask.tn.not_scored, null, 'normal run not_scored null');
    assert.equal(byTask.tn.goal_achieved, 0.7, 'normal run carries numeric judged values');

    // The three states are mutually distinguishable.
    assert.notDeepEqual(
      [byTask.tp.pending, byTask.tp.not_scored],
      [byTask.tt.pending, byTask.tt.not_scored],
      'pending and trivial are distinguishable',
    );
    assert.notDeepEqual(
      [byTask.tt.pending, byTask.tt.not_scored, byTask.tt.goal_achieved],
      [byTask.tn.pending, byTask.tn.not_scored, byTask.tn.goal_achieved],
      'trivial and numeric are distinguishable',
    );
  } finally {
    await cleanup();
  }
});

test('SCORE-02: applyOverride with an unknown dimension throws', async () => {
  const { store, cleanup } = await openIsolatedStore();
  try {
    const { writeRun } = await import('../../lib/experiments/run-write.mjs');
    const { writeScore, applyOverride } = await import('../../lib/experiments/score-write.mjs');

    await writeRun(store, runArgs());
    await writeScore(store, { span: { task_id: 't1' }, judgment: sampleJudgment() });

    await assert.rejects(
      () => applyOverride(store, { taskId: 't1', dimension: 'not_a_dimension', value: 1, by: 'op' }),
      /unknown dimension/i,
      'an unknown dimension must be rejected',
    );
  } finally {
    await cleanup();
  }
});
