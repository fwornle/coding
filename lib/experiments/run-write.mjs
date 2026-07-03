// lib/experiments/run-write.mjs
//
// KB-02 materialization half (SC-2): writeRun() materializes a measurement span
// as an independent, queryable km-core Run entity carrying ALL 8 tags (D-13),
// plus a basic Outcome stub (token totals + closedState — D-12) and a
// Run--produces-->Outcome relation. Route/Step/Decision/Report stay schema-only.
//
// IDEMPOTENCY (D-14, RESEARCH Pitfall 1): the Run is keyed on `metadata.task_id`,
// NOT the km-core entity id. task_id (e.g. 'telem-live-68') is NOT a valid UUIDv7
// — putEntity({ id: task_id }) would throw in parseEntityId. So we mint a UUIDv7
// ONCE via mintEntityId() on the first write and, on a re-close, find the existing
// Run via an iterate({ entityType:'Run' }) metadata.task_id scan and UPDATE the
// SAME node (same id) — never a duplicate. A re-close also recomputes the Outcome
// stub from the (possibly self-healed) totals (Pitfall 4 — late-attributed rows).
//
// STRICT-PATH WRITE (T-71-04-01): putEntity is called on the STRICT path with a
// synthetic ProvenanceStamp (NOT skipOntologyCheck), so entityType:'Run'/'Outcome'
// is validated against the experiment ontology registry — preserving KB-01
// enforcement. The store never invents a provenance stamp (D-30), so the close
// orchestrator supplies one.
//
// Output via process.stderr.write only — the no-console-log rule (CLAUDE.md)
// forbids the stdout/err logging family here.
//
// Analog: scripts/backfill-project-tag.mjs (putEntity/iterate usage) +
//         71-RESEARCH.md §"Pattern 2: Idempotent Run write" / §"Run + Outcome stub".
// Consumes: openExperimentStore() (71-01) — the store passed in is already open.
import { mintEntityId } from '@fwornle/km-core';
import { ALL_NULL_HEURISTICS } from './route-heuristics.mjs';

/**
 * Materialize a measurement span as an idempotent Run + Outcome stub.
 *
 * @param {import('@fwornle/km-core').GraphKMStore} store an OPEN experiment store
 *   (from openExperimentStore()). The caller owns open/close.
 * @param {object} args
 * @param {{ task_id: string, started_at?: string, ended_at?: string, goal_sentence?: string }} args.span
 *   the archived span (the idempotency key is span.task_id).
 * @param {string} args.taskClass closed-6 taxonomy class OR 'unclassified' (quarantine sentinel).
 * @param {boolean} args.pending D-06 quarantine flag — true ⇒ excluded from queries until classified.
 * @param {object} args.tags the non-derived tag sources: { task_hash, agent, model, framework, trace_id }.
 * @param {{ input_tokens?:number, output_tokens?:number, total_tokens?:number, reasoning_tokens?:number }} args.totals
 *   token aggregation from aggregateByTaskId() (71-03) feeding the Outcome stub.
 * @param {{ loop_count:number|null, edit_revert_count:number|null, redundant_read_count:number|null,
 *   abandoned_tool_count:number|null, total_step_count:number|null, wallclock_per_step:number|null }} [args.heuristics]
 *   the six syntactic route-quality heuristics (72-01 computeHeuristics output). Written FLAT on the
 *   Run.metadata AND onto a single idempotent Route node (D-09). Each value is preserved AS-IS —
 *   `null` means "could not compute" and MUST stay null (D-02 — NEVER coerced to 0). Absent ⇒ all six null.
 * @returns {Promise<string>} the Run entity id (minted on first write, reused on re-close).
 */
export async function writeRun(store, { span, taskClass, pending, tags, totals, heuristics }) {
  if (!span || !span.task_id) {
    throw new Error('writeRun: span.task_id is required (the idempotency key)');
  }
  const t = tags ?? {};
  const tot = totals ?? {};
  const isPending = pending === true;
  // D-02: null is meaningful ("could not compute") — never `?? 0`. A missing
  // heuristics arg defaults to ALL_NULL_HEURISTICS (six explicit nulls), so the
  // six keys are ALWAYS present on the Run + Route, null where unsupported.
  const h = heuristics ?? ALL_NULL_HEURISTICS;
  const goalSentence = span.goal_sentence ?? '';

  // (1) Idempotent lookup: find an existing Run carrying this task_id. NEVER use
  //     span.task_id as the entity id (parseEntityId requires a UUIDv7 — Pitfall 1).
  let existingId;
  for await (const e of store.iterate({ entityType: 'Run' })) {
    if (e.metadata?.task_id === span.task_id) {
      existingId = e.id;
      break;
    }
  }

  // (2) Synthetic provenance — the store NEVER invents one (D-30). This is a write
  //     by the close orchestrator, not an LLM extraction.
  const provenance = {
    provider: 'coding-measure-stop',
    model: 'n/a',
    runId: span.task_id,
    timestamp: new Date().toISOString(),
  };

  // (3) Strict-path putEntity the Run with ALL 8 tags ALWAYS present (D-13).
  //     On first write mint a UUIDv7 id explicitly via mintEntityId() — NEVER
  //     span.task_id (parseEntityId requires a UUIDv7; 'telem-live-68' throws —
  //     Pitfall 1). On re-close reuse the existing id so the SAME node updates.
  //     putEntity returns the persisted id, which we use for the produces relation.
  const runId = await store.putEntity({
    id: existingId ?? mintEntityId(), // re-close updates same node; first write mints (never task_id)
    name: span.task_id,
    entityType: 'Run', // validated against experiment-ontology.json (strict path)
    layer: 'evidence',
    description: span.goal_sentence ?? '',
    metadata: {
      // km-core exporter buckets by metadata.domain (exporter.js:119); without
      // this tag the Run lands in the catch-all general.json (which collides in
      // name with the main KG export). Tag 'experiment' so it files under the
      // store's own domain export, experiments/exports/experiment.json.
      domain: 'experiment',
      task_id: span.task_id, // ── the idempotency key (D-14) ──
      // ── 8 tags ALWAYS present (D-13); null/empty where no source ──
      task_hash:   t.task_hash ?? null,
      task_class:  taskClass,            // closed-6 OR 'unclassified'
      agent:       t.agent ?? null,
      model:       t.model ?? null,
      framework:   t.framework ?? null,
      spec_level:  null,                 // deferred (D-13)
      snapshot_id: t.snapshot_id ?? null, // Phase 67-07: linked to the RunSnapshot (was hardcoded null)
      trace_id:    t.trace_id ?? span.task_id,
      // ── operational flags ──
      pending:     isPending,            // D-06 quarantine flag
      started_at:  span.started_at ?? null,
      ended_at:    span.ended_at ?? null,
      // ── ATTR-02 / D-05 / D-06: canonical attribution computed ONCE upstream ──
      //    (the first FOREGROUND group, never byAgentModel[0]) + the segregated
      //    background daemons. Empty canonical persists as null (legacy/unmeasured
      //    Runs read "unmeasured" later) — NEVER coerced to a dominant fallback.
      //    background_models defaults to [] (nothing dropped — D-02).
      canonical_model:   t.canonical_model ?? null,
      canonical_agent:   t.canonical_agent ?? null,
      background_models: t.background_models ?? [],
      // ── R2/R3/R4 (Phase 78-01 — D-03/D-04/D-08/D-10): make a single experiment's
      //    cells distinguishable (variant/repeat) and record every terminal outcome
      //    (complete|timeout|abort enum, D-04) + probe-skip reason. null-preserved
      //    (D-02 idiom — never `?? 0`, never conditional-omit; `?? null` keeps repeat 0).
      variant:        t.variant ?? null,
      repeat:         t.repeat ?? null,
      terminal_state: t.terminal_state ?? null,   // D-04 enum: complete | timeout | abort
      skip_reason:    t.skip_reason ?? null,
      // ── six route-quality heuristics FLAT on the Run (D-09); null preserved (D-02) ──
      loop_count:           h.loop_count ?? null,
      edit_revert_count:    h.edit_revert_count ?? null,
      redundant_read_count: h.redundant_read_count ?? null,
      abandoned_tool_count: h.abandoned_tool_count ?? null,
      total_step_count:     h.total_step_count ?? null,
      wallclock_per_step:   h.wallclock_per_step ?? null,
    },
  }, { provenance });

  // (4) Outcome stub (D-12): token totals + closedState. Idempotent on re-close —
  //     reuse the existing Outcome for this Run so a re-write self-heals its totals.
  let existingOutcomeId;
  if (existingId) {
    for await (const e of store.iterate({ entityType: 'Outcome' })) {
      if (e.metadata?.run_task_id === span.task_id) {
        existingOutcomeId = e.id;
        break;
      }
    }
  }

  const outcomeId = await store.putEntity({
    id: existingOutcomeId ?? mintEntityId(), // minted on first write, reused on re-close (self-heal)
    name: `${span.task_id}-outcome`,
    entityType: 'Outcome', // validated against experiment-ontology.json (strict path)
    layer: 'evidence',
    description: 'v0 token-totals + closed-state stub',
    metadata: {
      domain: 'experiment', // bucket into experiment.json, not catch-all general.json
      run_task_id:     span.task_id, // back-link for idempotent Outcome lookup
      totalTokens:     tot.total_tokens ?? 0,
      inputTokens:     tot.input_tokens ?? 0,
      outputTokens:    tot.output_tokens ?? 0,
      reasoningTokens: tot.reasoning_tokens ?? 0,
      closedState:     isPending ? 'quarantined' : 'closed',
    },
  }, { provenance });

  // (5) Run --produces--> Outcome (D-12). Supply a STABLE, deterministic edge key
  //     so a re-close dedupes silently: GraphKMStore.addRelation threads `key` to
  //     graphology's addDirectedEdgeWithKey and swallows the duplicate-key collision
  //     (GraphKMStore.js:748-754). WITHOUT a key it falls through to addEdge() which
  //     appends a NEW parallel edge every call — N re-closes ⇒ N produces edges (WR-01).
  await store.addRelation({
    type: 'produces',
    from: runId,
    to: outcomeId,
    key: `${runId}:produces:${outcomeId}`,
  });

  // (6) Route node (D-09): exactly ONE per Run carrying the six heuristics +
  //     goal_sentence. Idempotent on re-close — replicate the Outcome stub pattern:
  //     look up the existing Route by metadata.run_task_id (ONLY when this is a
  //     re-close, i.e. existingId is set) and UPDATE the SAME node. The id is
  //     mintEntityId() on first write — NEVER span.task_id (parseEntityId requires
  //     a UUIDv7 — Pitfall 1). Heuristics ride in metadata (A5 — no ontology edit).
  let existingRouteId;
  if (existingId) {
    for await (const e of store.iterate({ entityType: 'Route' })) {
      if (e.metadata?.run_task_id === span.task_id) {
        existingRouteId = e.id;
        break;
      }
    }
  }

  const routeId = await store.putEntity({
    id: existingRouteId ?? mintEntityId(), // minted on first write, reused on re-close
    name: `${span.task_id}-route`,
    entityType: 'Route', // validated against experiment-ontology.json (strict path)
    layer: 'evidence',
    description: goalSentence,
    metadata: {
      domain: 'experiment', // bucket into experiment.json, not catch-all general.json
      run_task_id: span.task_id, // back-link for the idempotent Route lookup
      // ── the same six heuristics, null preserved (D-02) ──
      loop_count:           h.loop_count ?? null,
      edit_revert_count:    h.edit_revert_count ?? null,
      redundant_read_count: h.redundant_read_count ?? null,
      abandoned_tool_count: h.abandoned_tool_count ?? null,
      total_step_count:     h.total_step_count ?? null,
      wallclock_per_step:   h.wallclock_per_step ?? null,
      goal_sentence:        goalSentence,
    },
  }, { provenance });

  // (7) Run --tookRoute--> Route (D-09). Stable, deterministic edge key so N
  //     re-closes dedupe to ONE edge (Pitfall 2 — same mechanism as produces).
  await store.addRelation({
    type: 'tookRoute',
    from: runId,
    to: routeId,
    key: `${runId}:tookRoute:${routeId}`,
  });

  process.stderr.write(
    `[experiments] writeRun task_id=${span.task_id} runId=${String(runId).slice(0, 8)} ` +
    `routeId=${String(routeId).slice(0, 8)} class=${taskClass} pending=${isPending} ` +
    `totalTokens=${tot.total_tokens ?? 0} steps=${h.total_step_count ?? 'null'}\n`,
  );

  return runId;
}
