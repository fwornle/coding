/**
 * Phase 79 (CMP-01/02/03) proof — the pure variant aggregator lib/experiments/compare.mjs.
 *
 * Driven ENTIRELY by synthetic Run+Score+Outcome fixtures (D-04b — no store, no
 * on-disk fixtures, no dependency on gate-persisted live runs). Each fixture row
 * mirrors the readRuns row shape: flat Run.metadata + `score` (Score.metadata|null)
 * + `outcome` (Outcome.metadata|null).
 *
 * Proves the seven honesty invariants (CONTEXT §specifics — never let a
 * failed/ungated/unscored run masquerade as a cheap winner):
 *   1. Gate separation (D-01/D-03): complete+gate_passed=true → ranked;
 *      gate_passed=false → failed; timeout/abort → failed. Failed runs never
 *      contribute to any cost mean.
 *   2. Variance (D-09): token totals [100,200,300] → {mean:200,stddev≈81.6,
 *      median:200,min:100,max:300,n:3}.
 *   3. Null-exclusion (D-09/D-10): loop_count [1,null,3] → n:2 (null NOT averaged as 0).
 *   4. Ranking (D-05): composite = total_tokens/rubric_score ascending — lower first.
 *   5. --rank-by override (D-06): raw-token ascending reorders vs the composite default.
 *   6. Unscored (D-07): a successful+gated run with goal_aligned_ratio=null →
 *      report.unscored, absent from ranked, NO NaN/Infinity composite.
 *   7. Ungated (D-02): gate_passed===null → report.ungated, absent from ranked.
 *
 * Output via process.stderr.write only where needed (no console.* — CLAUDE.md).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildComparison,
  aggregateByVariant,
  isRankable,
  summaryStats,
  rubricScore,
} from '../../lib/experiments/compare.mjs';

const TASK = 'hash-abc';

/** Build a synthetic readRuns-shaped row (flat metadata + score + outcome). */
function row({
  taskHash = TASK,
  variant,
  repeat = 0,
  terminal_state = 'complete',
  totalTokens = 100,
  started_at = null,
  ended_at = null,
  gate_passed = true,
  goal_aligned_ratio = 1,
  loop_count = 0,
  edit_revert_count = 0,
  redundant_read_count = 0,
  abandoned_tool_count = 0,
  total_step_count = 1,
  wallclock_per_step = 10,
} = {}) {
  return {
    task_hash: taskHash,
    variant,
    repeat,
    terminal_state,
    started_at,
    ended_at,
    loop_count,
    edit_revert_count,
    redundant_read_count,
    abandoned_tool_count,
    total_step_count,
    wallclock_per_step,
    score: gate_passed === undefined && goal_aligned_ratio === undefined
      ? null
      : { gate_passed, goal_aligned_ratio },
    outcome: { totalTokens },
  };
}

// ── 1. Gate separation ───────────────────────────────────────────────────────
test('gate separation — success ranked, failed(gate) and timeout land in failed, never cost-averaged', () => {
  const rows = [
    // Variant A: 2 complete + gate_passed=true → ranked
    row({ variant: 'A', repeat: 0, totalTokens: 100, goal_aligned_ratio: 1 }),
    row({ variant: 'A', repeat: 1, totalTokens: 200, goal_aligned_ratio: 1 }),
    // Variant B: 2 complete + gate_passed=false → failed
    row({ variant: 'B', repeat: 0, totalTokens: 5, gate_passed: false, goal_aligned_ratio: 1 }),
    row({ variant: 'B', repeat: 1, totalTokens: 5, gate_passed: false, goal_aligned_ratio: 1 }),
    // Variant C: 1 timeout → failed (regardless of gate)
    row({ variant: 'C', repeat: 0, totalTokens: 1, terminal_state: 'timeout', gate_passed: true, goal_aligned_ratio: 1 }),
  ];
  const report = buildComparison(rows, { taskHash: TASK });

  const ranked = report.ranked.map((v) => v.variant);
  const failed = report.failed.map((v) => v.variant);
  assert.deepEqual(ranked, ['A'], 'only A is ranked');
  assert.ok(failed.includes('B'), 'B (gate_passed=false) is failed');
  assert.ok(failed.includes('C'), 'C (timeout) is failed');
  // B/C never masquerade as a cheap winner — absent from ranked entirely.
  assert.ok(!ranked.includes('B'));
  assert.ok(!ranked.includes('C'));

  // The failed variants carry no cost that could undercut A's mean: A's ranked
  // token mean is (100+200)/2 = 150, computed only over its own successful runs.
  const a = report.ranked.find((v) => v.variant === 'A');
  assert.equal(a.metrics.totalTokens.mean, 150);
  assert.equal(a.metrics.totalTokens.n, 2);
});

// ── 2. Variance math ─────────────────────────────────────────────────────────
test('summaryStats — [1,2,3] classic + robust stats', () => {
  const s = summaryStats([1, 2, 3]);
  assert.equal(s.mean, 2);
  assert.equal(s.median, 2);
  assert.equal(s.min, 1);
  assert.equal(s.max, 3);
  assert.equal(s.n, 3);
  assert.ok(Math.abs(s.stddev - 0.816496580927726) < 1e-9, `stddev ≈0.8165, got ${s.stddev}`);
});

test('aggregateByVariant — token totals [100,200,300] → {mean:200,stddev≈81.6,median:200,min:100,max:300,n:3}', () => {
  const rows = [
    row({ variant: 'A', repeat: 0, totalTokens: 100 }),
    row({ variant: 'A', repeat: 1, totalTokens: 200 }),
    row({ variant: 'A', repeat: 2, totalTokens: 300 }),
  ];
  const byVariant = aggregateByVariant(rows);
  const a = byVariant.get('A');
  const t = a.metrics.totalTokens;
  assert.equal(t.mean, 200);
  assert.equal(t.median, 200);
  assert.equal(t.min, 100);
  assert.equal(t.max, 300);
  assert.equal(t.n, 3);
  assert.ok(Math.abs(t.stddev - 81.64965809277261) < 1e-6, `stddev ≈81.65, got ${t.stddev}`);
});

// ── 3. Null-exclusion ────────────────────────────────────────────────────────
test('summaryStats — null EXCLUDED, not treated as 0 (n counts non-null)', () => {
  const s = summaryStats([1, null, 3]);
  assert.equal(s.n, 2, 'n counts only non-null contributors');
  assert.equal(s.mean, 2, 'mean over [1,3] = 2, NOT (1+0+3)/3');
  assert.equal(s.min, 1);
  assert.equal(s.max, 3);
});

test('summaryStats — empty → all-null shape', () => {
  const s = summaryStats([]);
  assert.deepEqual(s, { mean: null, stddev: null, median: null, min: null, max: null, n: 0 });
});

test('aggregateByVariant — loop_count [1,null,3] → n:2 for that metric (null not 0)', () => {
  const rows = [
    row({ variant: 'A', repeat: 0, loop_count: 1 }),
    row({ variant: 'A', repeat: 1, loop_count: null }),
    row({ variant: 'A', repeat: 2, loop_count: 3 }),
  ];
  const a = aggregateByVariant(rows).get('A');
  assert.equal(a.metrics.loop_count.n, 2, 'null loop_count excluded → n:2');
  assert.equal(a.metrics.loop_count.mean, 2, 'mean over [1,3] = 2');
});

// ── 4. Ranking (composite) ───────────────────────────────────────────────────
test('ranking — composite total_tokens/rubric_score ascending: lower composite first', () => {
  const rows = [
    // A: 200 tokens / ratio 1.0 = composite 200
    row({ variant: 'A', repeat: 0, totalTokens: 200, goal_aligned_ratio: 1.0 }),
    // B: 300 tokens / ratio 1.0 = composite 300  (higher → ranked after A)
    row({ variant: 'B', repeat: 0, totalTokens: 300, goal_aligned_ratio: 1.0 }),
    // C: 300 tokens / ratio 0.5 = composite 600  (worst)
    row({ variant: 'C', repeat: 0, totalTokens: 300, goal_aligned_ratio: 0.5 }),
  ];
  const report = buildComparison(rows, { taskHash: TASK });
  assert.deepEqual(report.ranked.map((v) => v.variant), ['A', 'B', 'C']);
  // rank is surfaced 1-based ascending
  assert.equal(report.ranked[0].rank, 1);
  assert.equal(report.ranked[0].composite, 200);
  assert.equal(report.ranked[2].composite, 600);
});

// ── 5. --rank-by override ────────────────────────────────────────────────────
test('--rank-by tokens overrides composite ordering', () => {
  const rows = [
    // Under composite: A=200/1.0=200 wins. Under raw tokens: A=200 still less than…
    // Make raw-token order DIFFER from composite: X cheaper tokens but worse ratio.
    // X: 100 tokens / ratio 0.25 = composite 400 ; raw tokens 100
    // Y: 300 tokens / ratio 1.0  = composite 300 ; raw tokens 300
    row({ variant: 'X', repeat: 0, totalTokens: 100, goal_aligned_ratio: 0.25 }),
    row({ variant: 'Y', repeat: 0, totalTokens: 300, goal_aligned_ratio: 1.0 }),
  ];
  const byComposite = buildComparison(rows, { taskHash: TASK, rankBy: 'composite' });
  const byTokens = buildComparison(rows, { taskHash: TASK, rankBy: 'tokens' });
  // Composite: Y (300) before X (400)
  assert.deepEqual(byComposite.ranked.map((v) => v.variant), ['Y', 'X']);
  // Raw tokens ascending: X (100) before Y (300) — ORDER FLIPS
  assert.deepEqual(byTokens.ranked.map((v) => v.variant), ['X', 'Y']);
});

test('--rank-by score orders by rubric descending (higher quality first)', () => {
  const rows = [
    row({ variant: 'Lo', repeat: 0, totalTokens: 100, goal_aligned_ratio: 0.5 }),
    row({ variant: 'Hi', repeat: 0, totalTokens: 999, goal_aligned_ratio: 0.9 }),
  ];
  const byScore = buildComparison(rows, { taskHash: TASK, rankBy: 'score' });
  assert.deepEqual(byScore.ranked.map((v) => v.variant), ['Hi', 'Lo']);
});

// ── 6. Unscored (null-rubric) ────────────────────────────────────────────────
test('unscored — successful+gated run with null rubric → report.unscored, no NaN/Infinity, not ranked', () => {
  const rows = [
    row({ variant: 'A', repeat: 0, totalTokens: 100, goal_aligned_ratio: 1 }),
    // U: complete + gate_passed=true but goal_aligned_ratio null → unscored
    row({ variant: 'U', repeat: 0, totalTokens: 50, gate_passed: true, goal_aligned_ratio: null }),
  ];
  const report = buildComparison(rows, { taskHash: TASK });
  assert.deepEqual(report.ranked.map((v) => v.variant), ['A'], 'only A ranked');
  assert.deepEqual(report.unscored.map((v) => v.variant), ['U'], 'U in unscored');
  // No composite computed for U — no NaN/Infinity leaks into the report.
  for (const v of report.ranked) {
    assert.ok(Number.isFinite(v.composite), `composite finite for ${v.variant}`);
  }
  // isRankable predicate rejects the null-rubric run directly.
  assert.equal(isRankable(rows[1]), false, 'null-rubric run is not rankable');
  // rubricScore surfaces null (never 0) for the null-rubric run.
  assert.equal(rubricScore(rows[1]), null);
});

// ── 7. Ungated ───────────────────────────────────────────────────────────────
test('ungated — gate_passed===null → report.ungated, absent from ranked', () => {
  const rows = [
    row({ variant: 'A', repeat: 0, totalTokens: 100, goal_aligned_ratio: 1 }),
    // G: complete, goal_aligned_ratio present, but gate_passed null (no test_command)
    row({ variant: 'G', repeat: 0, totalTokens: 1, gate_passed: null, goal_aligned_ratio: 1 }),
  ];
  const report = buildComparison(rows, { taskHash: TASK });
  assert.deepEqual(report.ranked.map((v) => v.variant), ['A']);
  assert.deepEqual(report.ungated.map((v) => v.variant), ['G']);
  assert.ok(!report.ranked.map((v) => v.variant).includes('G'), 'ungated never ranked');
  assert.equal(isRankable(rows[1]), false, 'ungated run is not rankable');
});

// ── n surfaced ───────────────────────────────────────────────────────────────
test('n surfaced — each ranked variant reports its repeat count n', () => {
  const rows = [
    row({ variant: 'A', repeat: 0, totalTokens: 100 }),
    row({ variant: 'A', repeat: 1, totalTokens: 100 }),
    row({ variant: 'A', repeat: 2, totalTokens: 100 }),
    row({ variant: 'B', repeat: 0, totalTokens: 90 }),
  ];
  const report = buildComparison(rows, { taskHash: TASK });
  const a = report.ranked.find((v) => v.variant === 'A');
  const b = report.ranked.find((v) => v.variant === 'B');
  assert.equal(a.n, 3, 'A has 3 successful repeats');
  assert.equal(b.n, 1, 'B has 1 successful repeat (less trustworthy)');
});

// ── task_hash filter ─────────────────────────────────────────────────────────
test('buildComparison filters rows to the requested task_hash', () => {
  const rows = [
    row({ variant: 'A', taskHash: TASK, totalTokens: 100, goal_aligned_ratio: 1 }),
    row({ variant: 'Other', taskHash: 'hash-zzz', totalTokens: 1, goal_aligned_ratio: 1 }),
  ];
  const report = buildComparison(rows, { taskHash: TASK });
  assert.equal(report.taskHash, TASK);
  const allVariants = [
    ...report.ranked, ...report.failed, ...report.ungated, ...report.unscored,
  ].map((v) => v.variant);
  assert.ok(!allVariants.includes('Other'), 'rows from another task_hash are excluded');
});

// ── empty input degrades gracefully ──────────────────────────────────────────
test('buildComparison — no rows for task_hash → empty groups, no throw', () => {
  const report = buildComparison([], { taskHash: TASK });
  assert.deepEqual(report.ranked, []);
  assert.deepEqual(report.failed, []);
  assert.deepEqual(report.ungated, []);
  assert.deepEqual(report.unscored, []);
});
