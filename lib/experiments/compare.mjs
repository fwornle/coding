// lib/experiments/compare.mjs
//
// Phase 79 (CMP-01/CMP-02/CMP-03): the PURE variant aggregator. It turns the
// pre-read `readRuns` rows into an honest side-by-side comparison — applies the
// objective success gate per run, aggregates N repeats per variant into
// {mean,stddev,median,min,max,n} summaries, and ranks the successful-gated
// variants by a composite cost-per-quality metric.
//
// CONTRACT (mirrors query.mjs / score-write.mjs):
//   - CALLER-OWNS-STORE: this module NEVER opens/closes/constructs a km-core
//     store and never imports the store-open helper. It operates on the
//     already-read `rows` array (the readRuns join output) so it is trivially
//     unit-testable with synthetic fixtures (D-04b). The CLI
//     (scripts/experiments-compare.mjs) owns the store lifecycle.
//   - NULL-NOT-ZERO (D-09): a null metric value means "could not compute" and is
//     EXCLUDED from the {mean,stddev,median,min,max,n} block — never coerced to 0.
//     `n` is the count of NON-NULL contributors, so a 3-repeat variant with one
//     null loop_count reports n:2 for that metric. Averaging in a fabricated 0
//     would understate the metric (D-10 surfaces n so low-n winners are visibly
//     less trustworthy).
//   - The composite NEVER divides by null/0: a null/zero rubric routes the
//     variant to the `unscored` group before any division (D-07) — no NaN/Infinity.
//
// JOIN KEYS CONSUMED (from readRuns, query.mjs:100-116): each row is
//   { ...Run.metadata (flat: task_hash, variant, repeat, terminal_state,
//                       started_at, ended_at, 6 route heuristics),
//     score:   Score.metadata|null   (goal_aligned_ratio, gate_passed, 5 dims),
//     outcome: Outcome.metadata|null  (totalTokens, inputTokens, ...) }.
//   The gate lands on `row.score.gate_passed` (Plan 79-01 persists it).
//
// SUCCESS GATE (D-01/D-02/D-03):
//   gate = row.score?.gate_passed ?? null
//     null  → UNGATED (no test_command, D-02): shown, NOT ranked → report.ungated
//     false → FAILED objective test (D-03): report.failed, never cost-averaged
//     true  AND terminal_state==='complete' → SUCCESSFUL: eligible for ranking
//   terminal_state 'timeout'/'abort' → FAILED (D-03) regardless of gate.
//
// D-08 (rubric_score source — RESOLVED HERE): the composite's quality denominator
//   is `row.score.goal_aligned_ratio` ALONE (the single normalized 0-1 quality
//   signal), NOT an aggregate of the 5 locked rubric dims. The 5 dims are still
//   surfaced per-metric via the variance block (using effectiveDimension), but the
//   composite denominator is goal_aligned_ratio. This choice is documented in the
//   79-02-SUMMARY export schema (Phase 80 consumes the shape).
//
// RANKING (D-05/D-06): default `composite = aggregatedTotalTokens /
//   aggregatedRubricScore` ASCENDING (lowest cost-per-quality wins), over
//   successful-gated variants only. `rankBy` overrides: 'tokens'|'wallclock'
//   ascending, 'score' descending (higher quality first).
//
// Output via process.stderr.write only — the no-console-log rule (CLAUDE.md).
//
// Analog: lib/experiments/query.mjs (readRuns row shape + module-header contract),
//   lib/experiments/token-aggregate.mjs:78-121 (exported predicate + empty-shape
//   helper + early-return degradation on bad input).

import process from 'node:process';
import { effectiveDimension } from './query.mjs';

/** The 5 LOCKED rubric dimensions, surfaced in the per-variant variance block. */
const RUBRIC_DIMENSIONS = Object.freeze([
  'goal_achieved',
  'code_quality',
  'test_coverage',
  'regressions',
  'spec_drift',
]);

/** The all-null summary shape for an empty (or all-null) metric series. */
function emptySummary() {
  return { mean: null, stddev: null, median: null, min: null, max: null, n: 0 };
}

/**
 * Classic + robust summary statistics over a numeric series, NULLS EXCLUDED.
 *
 * Null/undefined/NaN values are filtered FIRST (null-not-zero, D-09) — a missing
 * value is "could not compute", never a fabricated 0. `n` counts only the
 * non-null contributors. Empty (or all-null) input → the all-null shape.
 *
 * @param {Array<number|null|undefined>} values
 * @returns {{mean:number|null,stddev:number|null,median:number|null,min:number|null,max:number|null,n:number}}
 */
export function summaryStats(values) {
  const nums = (Array.isArray(values) ? values : [])
    .filter((v) => typeof v === 'number' && Number.isFinite(v));
  const n = nums.length;
  if (n === 0) {
    return emptySummary();
  }
  const sum = nums.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  // Population standard deviation (÷ n, not n-1) — matches the fixture math.
  const variance = nums.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n;
  const stddev = Math.sqrt(variance);
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
  return {
    mean,
    stddev,
    median,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    n,
  };
}

/**
 * The composite's quality denominator (D-08): goal_aligned_ratio ALONE.
 *
 * Preserves null-not-zero: a run the judge marked not_scored:'trivial' (or with no
 * goal_aligned_ratio) resolves to null — never 0 — so the caller routes it to the
 * `unscored` group instead of dividing by 0/null (D-07).
 *
 * @param {object} row a readRuns row
 * @returns {number|null} the 0-1 quality signal, or null if unscored.
 */
export function rubricScore(row) {
  const r = row?.score?.goal_aligned_ratio;
  return (typeof r === 'number' && Number.isFinite(r)) ? r : null;
}

/**
 * The D-01 success gate: a run is rankable iff it completed, passed the objective
 * gate, AND carries a positive rubric score (so the composite denominator > 0).
 *
 * @param {object} row a readRuns row
 * @returns {boolean}
 */
export function isRankable(row) {
  if (!row || row.terminal_state !== 'complete') {
    return false;
  }
  const gate = row.score?.gate_passed ?? null;
  if (gate !== true) {
    return false;
  }
  const rs = rubricScore(row);
  return typeof rs === 'number' && rs > 0;
}

/** Total wallclock (ms) derived from the Run's ISO started/ended timestamps. */
function wallclockMs(row) {
  const s = row?.started_at;
  const e = row?.ended_at;
  if (typeof s !== 'string' || typeof e !== 'string') {
    return null;
  }
  const t0 = Date.parse(s);
  const t1 = Date.parse(e);
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) {
    return null;
  }
  return t1 - t0;
}

/**
 * Extract the raw (nullable) value of one aggregated metric from a single row.
 * Null-not-zero: a missing token total / heuristic / rubric stays null.
 */
function metricValue(row, metric) {
  switch (metric) {
    case 'totalTokens':
      return (typeof row?.outcome?.totalTokens === 'number') ? row.outcome.totalTokens : null;
    case 'wallclock':
      return wallclockMs(row);
    case 'rubric_score':
      return rubricScore(row);
    case 'goal_achieved':
    case 'code_quality':
    case 'test_coverage':
    case 'regressions':
    case 'spec_drift':
      return effectiveDimension(row?.score ?? null, metric);
    default:
      // one of the 6 flat route heuristics on the Run
      return (typeof row?.[metric] === 'number') ? row[metric] : null;
  }
}

/** The metrics carried in each variant's variance block (D-09). */
const AGG_METRICS = Object.freeze([
  'totalTokens',
  'wallclock',
  'loop_count',
  'edit_revert_count',
  'redundant_read_count',
  'abandoned_tool_count',
  'total_step_count',
  'wallclock_per_step',
  'rubric_score',
  ...RUBRIC_DIMENSIONS,
]);

/**
 * Compute the per-metric {mean,stddev,median,min,max,n} block over a set of rows.
 * Nulls are excluded per metric (n = non-null count for THAT metric).
 */
function metricsBlock(rows) {
  const block = {};
  for (const metric of AGG_METRICS) {
    block[metric] = summaryStats(rows.map((r) => metricValue(r, metric)));
  }
  return block;
}

/**
 * Group rows by `variant` and compute the per-metric variance block for each.
 * PURE — no store, no filtering by gate (the caller partitions by gate). Used by
 * buildComparison over each variant's SUCCESSFUL runs, and directly by tests.
 *
 * @param {Array<object>} rows readRuns rows (already filtered to one task_hash)
 * @returns {Map<string, { variant:string, n:number, rows:Array<object>, metrics:object }>}
 */
export function aggregateByVariant(rows) {
  const groups = new Map();
  for (const row of (Array.isArray(rows) ? rows : [])) {
    const variant = row?.variant ?? '(unknown)';
    if (!groups.has(variant)) {
      groups.set(variant, []);
    }
    groups.get(variant).push(row);
  }
  const out = new Map();
  for (const [variant, variantRows] of groups) {
    out.set(variant, {
      variant,
      n: variantRows.length,
      rows: variantRows,
      metrics: metricsBlock(variantRows),
    });
  }
  return out;
}

/** Classify a single row into one of the four gate buckets (D-01/02/03/07). */
function classifyRow(row) {
  const gate = row?.score?.gate_passed ?? null;
  const complete = row?.terminal_state === 'complete';
  if (!complete || gate === false) {
    return 'failed'; // D-03 (timeout/abort) or D-03 (gate false)
  }
  if (gate === null) {
    return 'ungated'; // D-02: no test_command
  }
  // gate === true AND complete
  return rubricScore(row) > 0 ? 'ranked' : 'unscored'; // D-07: null/zero rubric → unscored
}

/**
 * The composite cost-per-quality (D-05): aggregated total tokens ÷ aggregated
 * rubric score, both over the variant's successful runs. Guaranteed finite
 * because the caller only reaches here for `ranked` variants (rubric mean > 0).
 */
function compositeOf(metrics) {
  const tokens = metrics.totalTokens.mean;
  const rubric = metrics.rubric_score.mean;
  if (typeof tokens !== 'number' || typeof rubric !== 'number' || rubric <= 0) {
    return null; // defensive — should never happen for a ranked variant
  }
  return tokens / rubric;
}

/**
 * Build the honest comparison report for one task_hash.
 *
 * Partitions the task's runs into per-variant groups, classifies each variant by
 * its runs' gate outcomes, and ranks ONLY the successful-gated variants.
 *
 * A variant appears in exactly ONE group, decided by the STRONGEST classification
 * across its runs: if it has ≥1 successful-gated+scored run it is `ranked` (over
 * those runs only); else if all its complete+gated runs are null-rubric it is
 * `unscored`; else if its runs are ungated it is `ungated`; else `failed`. This
 * ensures a variant whose runs ALL fail is shown as "no successful runs", never a
 * cheap winner (CMP-01 criterion 4).
 *
 * @param {Array<object>} rows all readRuns rows (any task_hash)
 * @param {{ taskHash:string, rankBy?:('composite'|'tokens'|'wallclock'|'score') }} opts
 * @returns {{ taskHash:string, rankBy:string,
 *   ranked:Array<object>, failed:Array<object>, ungated:Array<object>, unscored:Array<object> }}
 */
export function buildComparison(rows, opts = {}) {
  const { taskHash, rankBy = 'composite' } = opts;
  const scoped = (Array.isArray(rows) ? rows : []).filter((r) => r?.task_hash === taskHash);

  // Group all scoped rows by variant, then classify each row and pick the
  // variant's strongest bucket. `ranked` variants aggregate over their SUCCESSFUL
  // runs only (failed/ungated/unscored runs of a ranked variant do not dilute cost).
  const byVariant = new Map();
  for (const row of scoped) {
    const variant = row?.variant ?? '(unknown)';
    if (!byVariant.has(variant)) {
      byVariant.set(variant, []);
    }
    byVariant.get(variant).push(row);
  }

  const ranked = [];
  const failed = [];
  const ungated = [];
  const unscored = [];

  for (const [variant, variantRows] of byVariant) {
    const buckets = variantRows.map(classifyRow);
    const successRows = variantRows.filter((r) => isRankable(r));

    if (successRows.length > 0) {
      // RANKED — aggregate over the successful-gated runs only.
      const metrics = metricsBlock(successRows);
      ranked.push({
        variant,
        n: successRows.length,
        composite: compositeOf(metrics),
        metrics,
      });
    } else if (buckets.some((b) => b === 'unscored')) {
      // Successful+gated but null/zero rubric (D-07) — shown, not ranked.
      const scoredRows = variantRows.filter(
        (r) => r.terminal_state === 'complete' && (r.score?.gate_passed ?? null) === true,
      );
      unscored.push({
        variant,
        n: scoredRows.length,
        reason: 'null-rubric (not composite-rankable)',
        metrics: metricsBlock(scoredRows.length > 0 ? scoredRows : variantRows),
      });
    } else if (buckets.every((b) => b === 'ungated')) {
      // No test_command (D-02) — shown, not ranked.
      ungated.push({
        variant,
        n: variantRows.length,
        reason: 'ungated (no test_command)',
        metrics: metricsBlock(variantRows),
      });
    } else {
      // FAILED (D-03): gate false and/or timeout/abort — "no successful runs".
      failed.push({
        variant,
        n: variantRows.length,
        reason: 'no successful runs (gate failed or timeout/abort)',
        metrics: metricsBlock(variantRows),
      });
    }
  }

  rankVariants(ranked, rankBy);

  process.stderr.write(
    `[experiments] compare task_hash=${taskHash} rankBy=${rankBy} ` +
    `ranked=${ranked.length} failed=${failed.length} ` +
    `ungated=${ungated.length} unscored=${unscored.length}\n`,
  );

  return { taskHash, rankBy, ranked, failed, ungated, unscored };
}

/**
 * Sort the `ranked` array in-place by the chosen metric and stamp a 1-based rank.
 *   composite  → ascending (lowest cost-per-quality wins) — the default
 *   tokens     → aggregated totalTokens.mean ascending
 *   wallclock  → aggregated wallclock.mean ascending
 *   score      → aggregated rubric_score.mean DESCENDING (higher quality first)
 */
function rankVariants(ranked, rankBy) {
  const cmp = {
    composite: (a, b) => (a.composite - b.composite),
    tokens: (a, b) => (a.metrics.totalTokens.mean - b.metrics.totalTokens.mean),
    wallclock: (a, b) => ((a.metrics.wallclock.mean ?? Infinity) - (b.metrics.wallclock.mean ?? Infinity)),
    score: (a, b) => (b.metrics.rubric_score.mean - a.metrics.rubric_score.mean),
  }[rankBy] ?? ((a, b) => (a.composite - b.composite));

  ranked.sort(cmp);
  ranked.forEach((v, i) => { v.rank = i + 1; });
}
