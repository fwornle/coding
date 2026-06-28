// lib/experiments/query.mjs
//
// DASH-01 read half (Phase 74, Plan 02): `readRuns(store, { includePending })`
// joins each km-core Run entity to its Score + Outcome by `metadata.run_task_id`
// (Run side keys on metadata.task_id; Score/Outcome side on run_task_id). The
// Performance tab's runs table + the runs endpoint (Plans 04/05) consume this.
//
// CONTRACT (mirrors writeScore/applyOverride — score-write.mjs:85-104):
//   - the caller passes an ALREADY-OPEN store; readRuns NEVER opens/closes it and
//     NEVER directly constructs a km-core store (the explicit-ontologyDir km-core
//     rule, CLAUDE.md, is honoured by the caller's openExperimentStore()).
//   - join keys: Score.metadata.run_task_id == Run.metadata.task_id;
//     Outcome.metadata.run_task_id == Run.metadata.task_id.
//   - D-06 quarantine: `pending` Runs are EXCLUDED by default, included ONLY when
//     `includePending: true`.
//   - NULL-NOT-ZERO (RESEARCH Pitfall 4 / D-01): a judged/heuristic dimension that
//     is null means "no evidence / could not compute" — it is preserved AS-IS and
//     is NEVER coerced to zero. There is deliberately no null-to-zero default below.
//
// Output via process.stderr.write only — the no-console-log rule (CLAUDE.md).
//
// Analog: lib/experiments/score-write.mjs:85-104 (iterate-by-entityType + the
//   metadata.run_task_id join idiom). 74-RESEARCH §Code Examples (readRuns).

// The 5 LOCKED rubric dimensions (shared with score-write.mjs). Used by
// effectiveDimension() to look up the judged + corrected slots by name.
const RUBRIC_DIMENSIONS = Object.freeze([
  'goal_achieved',
  'code_quality',
  'test_coverage',
  'regressions',
  'spec_drift',
]);

/**
 * The corrected-wins rule (D-03), shared so endpoints/aggregates use one
 * definition: the human `corrected_<dim>` value wins when present (non-null),
 * else the judge's `<dim>`, else null. NEVER coerces null to 0 (null-not-zero).
 *
 * @param {object|null|undefined} score the joined Score.metadata object (or null).
 * @param {string} dim one of the 5 rubric dimensions.
 * @returns {number|null} the effective value, or null if neither slot is set.
 */
export function effectiveDimension(score, dim) {
  if (!score) {
    return null;
  }
  if (!RUBRIC_DIMENSIONS.includes(dim)) {
    throw new Error(
      `effectiveDimension: unknown dimension '${dim}' (expected one of ${RUBRIC_DIMENSIONS.join(', ')})`,
    );
  }
  const corrected = score[`corrected_${dim}`];
  if (corrected !== null && corrected !== undefined) {
    return corrected;
  }
  const judged = score[dim];
  if (judged !== null && judged !== undefined) {
    return judged;
  }
  return null;
}

/**
 * Read every Run joined to its Score + Outcome metadata.
 *
 * @param store an OPEN experiment store (a km-core store from
 *   openExperimentStore()). The caller owns open/close — readRuns never opens or
 *   constructs a store.
 * @param {object} [opts]
 * @param {boolean} [opts.includePending=false] include D-06-quarantined pending
 *   Runs (excluded by default).
 * @returns {Promise<Array<object>>} an array of `{ ...run.metadata,
 *   score: Score.metadata|null, outcome: Outcome.metadata|null }`. Null
 *   dimension/heuristic values are preserved exactly (never coerced to 0).
 */
export async function readRuns(store, { includePending = false } = {}) {
  // (1) One pass over Scores → Map(run_task_id → Score.metadata).
  const scoreMap = new Map();
  for await (const e of store.iterate({ entityType: 'Score' })) {
    const key = e.metadata?.run_task_id;
    if (key !== undefined && key !== null) {
      scoreMap.set(key, e.metadata);
    }
  }

  // (2) One pass over Outcomes → Map(run_task_id → Outcome.metadata).
  const outcomeMap = new Map();
  for await (const e of store.iterate({ entityType: 'Outcome' })) {
    const key = e.metadata?.run_task_id;
    if (key !== undefined && key !== null) {
      outcomeMap.set(key, e.metadata);
    }
  }

  // (3) One pass over Runs → join + D-06 pending filter. Preserve nulls AS-IS;
  //     `?? null` on the joined maps is a presence default (missing join → null),
  //     NOT a numeric coercion — no dimension/heuristic value is null-to-zero defaulted.
  const rows = [];
  for await (const e of store.iterate({ entityType: 'Run' })) {
    const meta = e.metadata ?? {};
    if (meta.pending && !includePending) {
      continue; // D-06 quarantine: pending excluded unless includePending:true
    }
    const taskId = meta.task_id;
    rows.push({
      ...meta,
      score: scoreMap.get(taskId) ?? null,
      outcome: outcomeMap.get(taskId) ?? null,
    });
  }

  process.stderr.write(
    `[experiments] readRuns rows=${rows.length} includePending=${includePending} ` +
    `scores=${scoreMap.size} outcomes=${outcomeMap.size}\n`,
  );

  return rows;
}
