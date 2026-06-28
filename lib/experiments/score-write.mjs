// lib/experiments/score-write.mjs
//
// SCORE-01/SCORE-02 storage half (Phase 73, Plan 02): writeScore() materializes a
// judge's judgment object as an independent, queryable km-core `Score` entity
// back-linked to its Run via a `Run--scored-->Score` edge (D-05). The judgment
// contract is defined by 73-02 (this plan), produced by the judge (73-04) and
// passed through by the close orchestrator (73-05).
//
// IDEMPOTENCY (mirrors run-write.mjs D-14, RESEARCH Pitfall 1): the Score is keyed
// on `metadata.run_task_id`, NOT the km-core entity id. span.task_id (e.g.
// 'telem-live-68') is NOT a valid UUIDv7 — putEntity({ id: task_id }) would throw
// in parseEntityId. So we mint a UUIDv7 ONCE via mintEntityId() on the first write
// and, on a re-judge, find the existing Score via an iterate({ entityType:'Score' })
// metadata.run_task_id scan and UPDATE the SAME node (same id) — never a duplicate.
//
// D-06 OVERRIDE PRESERVATION (the one place this diverges from writeRun): judged
// fields (goal_aligned_ratio + the 5 rubric dims + rationales + pending/not_scored)
// are OVERWRITTEN by a re-judge; the human `corrected_*` overrides + overridden_by/
// overridden_at are NEVER clobbered — they are carried forward from the existing
// entity's metadata on every re-write. applyOverride() writes ONLY a corrected_*
// slot + stamps, PRESERVING all judged fields.
//
// TRI-STATE DEGRADATION MARKERS kept distinguishable in storage (D-01 + D-04):
//   - genuinely scored dimension  → numeric value
//   - no evidence for a dimension → null (NEVER 0)
//   - judge failed / proxy down   → judged fields null + pending: true (D-03)
//   - trivial run (judge skipped) → judged fields null + not_scored: 'trivial' (D-04)
//
// STRICT-PATH WRITE: putEntity is called on the STRICT path with a synthetic
// ProvenanceStamp (NOT skipOntologyCheck), so entityType:'Score' is validated
// against the experiment ontology registry — preserving KB-01 enforcement. The
// store never invents a provenance stamp (D-30), so this writer supplies one.
//
// Output via process.stderr.write only — the no-console-log rule (CLAUDE.md).
//
// Analog: lib/experiments/run-write.mjs (writeRun — the Outcome/Route idempotent
//   stub pattern applied to a new Score entity + scored edge). 73-PATTERNS.md
//   §score-write.mjs (D-06 override-preservation rule + tri-state table).
// Consumes: openExperimentStore() (71-01) — the store passed in is already open.
import { mintEntityId } from '@fwornle/km-core';

// The 5 LOCKED rubric dimensions (v73-perf-measurement-exploration.md §D5). These
// drive both writeScore's judged-field mapping AND applyOverride's dimension guard.
// Ordered/named in judgment.rubric snake_case (the judgment contract).
const RUBRIC_DIMENSIONS = Object.freeze([
  'goal_achieved',
  'code_quality',
  'test_coverage',
  'regressions',
  'spec_drift',
]);

/**
 * Materialize a judge's judgment as an idempotent, override-preserving Score +
 * a Run--scored-->Score edge.
 *
 * @param {import('@fwornle/km-core').GraphKMStore} store an OPEN experiment store
 *   (from openExperimentStore()). The caller owns open/close.
 * @param {object} args
 * @param {{ task_id: string }} args.span the archived span (idempotency key is span.task_id).
 * @param {{ goal_aligned_ratio?: number|null,
 *   event_labels?: Array<{ seq:number, label:'toward'|'neutral'|'away' }>,
 *   ratio_rationale?: string,
 *   rubric?: { goal_achieved?:number|null, code_quality?:number|null,
 *     test_coverage?:number|null, regressions?:0|1|null, spec_drift?:number|null },
 *   rubric_rationale?: string,
 *   pending?: boolean, not_scored?: 'trivial'|null }} args.judgment
 *   the judge output. On a trivial run the caller passes { not_scored:'trivial' };
 *   on a judge/proxy failure { pending:true }. Absent rubric dims default to null.
 * @returns {Promise<string>} the Score entity id (minted on first write, reused on re-judge).
 */
export async function writeScore(store, { span, judgment }) {
  if (!span || !span.task_id) {
    throw new Error('writeScore: span.task_id is required (the idempotency key)');
  }
  const j = judgment ?? {};
  const rubric = j.rubric ?? {};
  const isPending = j.pending === true;
  const notScored = j.not_scored ?? null;

  // (1) Idempotent lookup: find an existing Score carrying this run_task_id. Capture
  //     the existing entity `e` so its corrected_* overrides can be carried forward
  //     (D-06). NEVER use span.task_id as the entity id (parseEntityId requires a
  //     UUIDv7 — Pitfall 1).
  let existingId;
  let existingMeta;
  for await (const e of store.iterate({ entityType: 'Score' })) {
    if (e.metadata?.run_task_id === span.task_id) {
      existingId = e.id;
      existingMeta = e.metadata ?? {};
      break;
    }
  }
  const prev = existingMeta ?? {};

  // (2) Resolve the Run id by the same iterate({ entityType:'Run' }) task_id scan as
  //     run-write.mjs:64-72 — needed for the scored edge's from-node.
  let runId;
  for await (const e of store.iterate({ entityType: 'Run' })) {
    if (e.metadata?.task_id === span.task_id) {
      runId = e.id;
      break;
    }
  }

  // (3) Synthetic provenance — the store NEVER invents one (D-30). This is a write
  //     by the close orchestrator, not an LLM extraction.
  const provenance = {
    provider: 'coding-measure-stop',
    model: 'n/a',
    runId: span.task_id,
    timestamp: new Date().toISOString(),
  };

  // (4) Strict-path putEntity the Score. On first write mint a UUIDv7 id explicitly
  //     via mintEntityId() — NEVER span.task_id. On re-judge reuse the existing id so
  //     the SAME node updates. Judged fields use null (NOT 0) for any absent rubric
  //     dimension (null-not-zero, D-01). When the run is trivial or the judge failed,
  //     every judged field is null and the marker (not_scored / pending) distinguishes.
  const scoreId = await store.putEntity({
    id: existingId ?? mintEntityId(), // re-judge updates same node; first write mints (never task_id)
    name: `${span.task_id}-score`,
    entityType: 'Score', // validated against experiment-ontology.json (strict path)
    layer: 'evidence',
    description: 'goal_aligned_ratio + 5-dim judged rubric + corrected_* overrides (D-05/D-06)',
    metadata: {
      // km-core exporter buckets by metadata.domain (exporter.js:119) — tag
      // 'experiment' so the Score files under experiments/exports/experiment.json,
      // not the catch-all general.json.
      domain: 'experiment',
      run_task_id: span.task_id, // ── the idempotency key + back-link (D-14) ──
      // ── goal-alignment (judged; null preserved, D-01) ──
      goal_aligned_ratio: j.goal_aligned_ratio ?? null,
      event_labels: JSON.stringify(j.event_labels ?? []), // serialized per Score.metadata interface
      ratio_rationale: j.ratio_rationale ?? '',
      // ── 5-dim judged rubric (overwritten on re-judge; null where no evidence, D-01) ──
      goal_achieved: rubric.goal_achieved ?? null,
      code_quality: rubric.code_quality ?? null,
      test_coverage: rubric.test_coverage ?? null,
      regressions: rubric.regressions ?? null,
      spec_drift: rubric.spec_drift ?? null,
      rubric_rationale: j.rubric_rationale ?? '',
      // ── tri-state degradation markers (D-03 / D-04) ──
      pending: isPending,
      not_scored: notScored,
      // ── D-06 PRESERVATION: corrected_* overrides + stamps are NEVER clobbered by a
      //    re-judge. Carry forward from the existing entity's metadata; default null
      //    on first write. Judged fields above are refreshed; these are preserved. ──
      corrected_goal_achieved: prev.corrected_goal_achieved ?? null,
      corrected_code_quality: prev.corrected_code_quality ?? null,
      corrected_test_coverage: prev.corrected_test_coverage ?? null,
      corrected_regressions: prev.corrected_regressions ?? null,
      corrected_spec_drift: prev.corrected_spec_drift ?? null,
      overridden_by: prev.overridden_by ?? null,
      overridden_at: prev.overridden_at ?? null,
    },
  }, { provenance });

  // (5) Run --scored--> Score (D-05). Supply a STABLE, deterministic edge key so a
  //     re-judge dedupes silently: GraphKMStore.addRelation threads `key` to
  //     graphology's addDirectedEdgeWithKey and swallows the duplicate-key collision.
  //     WITHOUT a key it falls through to addEdge() which appends a NEW parallel edge
  //     every call — N re-closes ⇒ N scored edges (WR-01). Only add the edge when the
  //     Run exists (it always should mid-close, since writeRun ran first).
  if (runId !== undefined) {
    await store.addRelation({
      type: 'scored',
      from: runId,
      to: scoreId,
      key: `${runId}:scored:${scoreId}`,
    });
  }

  process.stderr.write(
    `[experiments] writeScore task_id=${span.task_id} scoreId=${String(scoreId).slice(0, 8)} ` +
    `ratio=${j.goal_aligned_ratio ?? 'null'} pending=${isPending} ` +
    `not_scored=${notScored ?? 'null'}\n`,
  );

  return scoreId;
}

/**
 * Apply a single human override to a Score WITHOUT mutating any judged value (D-06).
 * Sets metadata.corrected_<dimension> + overridden_by + overridden_at, preserving
 * every judged field (read existing metadata, spread, override one slot).
 *
 * @param {import('@fwornle/km-core').GraphKMStore} store an OPEN experiment store.
 * @param {object} args
 * @param {string} args.taskId the Run/Score idempotency key (metadata.run_task_id).
 * @param {string} args.dimension one of the 5 rubric dimensions (goal_achieved,
 *   code_quality, test_coverage, regressions, spec_drift). Unknown ⇒ throws.
 * @param {number} args.value the corrected value.
 * @param {string} args.by operator id stamped into overridden_by.
 * @returns {Promise<string>} the Score entity id.
 */
export async function applyOverride(store, { taskId, dimension, value, by }) {
  if (!taskId) {
    throw new Error('applyOverride: taskId is required');
  }
  if (!RUBRIC_DIMENSIONS.includes(dimension)) {
    throw new Error(
      `applyOverride: unknown dimension '${dimension}' (expected one of ${RUBRIC_DIMENSIONS.join(', ')})`,
    );
  }

  // Find the Score by run_task_id; capture its full metadata so judged fields survive.
  let existingId;
  let existingMeta;
  for await (const e of store.iterate({ entityType: 'Score' })) {
    if (e.metadata?.run_task_id === taskId) {
      existingId = e.id;
      existingMeta = e.metadata ?? {};
      break;
    }
  }
  if (existingId === undefined) {
    throw new Error(`applyOverride: no Score found for task_id '${taskId}'`);
  }

  const provenance = {
    provider: 'coding-measure-stop',
    model: 'n/a',
    runId: taskId,
    timestamp: new Date().toISOString(),
  };

  // Spread existing metadata (preserves ALL judged fields) and override ONE corrected
  // slot + the two stamps. Strict-path putEntity on the SAME id (no new node).
  const scoreId = await store.putEntity({
    id: existingId,
    name: `${taskId}-score`,
    entityType: 'Score',
    layer: 'evidence',
    description: 'goal_aligned_ratio + 5-dim judged rubric + corrected_* overrides (D-05/D-06)',
    metadata: {
      ...existingMeta,
      [`corrected_${dimension}`]: value,
      overridden_by: by ?? null,
      overridden_at: new Date().toISOString(),
    },
  }, { provenance });

  process.stderr.write(
    `[experiments] applyOverride task_id=${taskId} dim=${dimension} value=${value} by=${by ?? 'null'}\n`,
  );

  return scoreId;
}
