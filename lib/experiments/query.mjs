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
      // The human-readable goal sentence is persisted on the Run entity's
      // top-level `description` (run-write.mjs writes `description:
      // span.goal_sentence`), NOT in metadata — so the `...meta` spread alone
      // dropped it and every consumer saw only the goal_achieved *score*. Surface
      // it as `goal_sentence` (empty string for legacy runs that recorded none).
      goal_sentence: (typeof e.description === 'string' && e.description.trim()) ? e.description : null,
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

/**
 * Delete one or more runs by task_id, removing the Run entity AND every entity
 * joined to it (Score/Outcome/Route via metadata.run_task_id). Mirrors the
 * iterate-by-entityType + task_id/run_task_id join idiom used by readRuns /
 * score-write. The caller passes an ALREADY-OPEN store (same contract as
 * readRuns — never opens/closes/constructs a km-core store here).
 *
 * @param {object} store an open experiment store (GraphKMStore)
 * @param {string[]} taskIds task_ids to delete
 * @returns {Promise<{ deleted: string[], notFound: string[], entities: number }>}
 */
export async function deleteRuns(store, taskIds) {
  const wanted = new Set((taskIds ?? []).filter((t) => typeof t === 'string' && t));
  if (wanted.size === 0) return { deleted: [], notFound: [], entities: 0 };

  // (1) Collect the km-core entity ids to delete: the Run node keyed on
  //     metadata.task_id, plus Score/Outcome/Route nodes keyed on
  //     metadata.run_task_id. One pass per joined type keeps memory flat.
  const idsToDelete = [];
  const foundRunTaskIds = new Set();
  for await (const e of store.iterate({ entityType: 'Run' })) {
    if (wanted.has(e.metadata?.task_id)) { idsToDelete.push(e.id); foundRunTaskIds.add(e.metadata.task_id); }
  }
  for (const type of ['Score', 'Outcome', 'Route']) {
    for await (const e of store.iterate({ entityType: type })) {
      if (wanted.has(e.metadata?.run_task_id)) idsToDelete.push(e.id);
    }
  }

  // (2) Delete each resolved entity id. deleteEntity is idempotent on a missing
  //     id, so a partially-written run (e.g. Run but no Score) is handled.
  let entities = 0;
  for (const id of idsToDelete) {
    await store.deleteEntity(id);
    entities += 1;
  }

  const deleted = [...foundRunTaskIds];
  const notFound = [...wanted].filter((t) => !foundRunTaskIds.has(t));
  process.stderr.write(
    `[experiments] deleteRuns requested=${wanted.size} deleted=${deleted.length} ` +
    `entities=${entities} notFound=${notFound.length}\n`,
  );
  return { deleted, notFound, entities };
}
