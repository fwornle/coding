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
// Output via process.stderr.write only (no console.* — no-console-log / CLAUDE.md).
//
// Analog: scripts/backfill-project-tag.mjs (putEntity/iterate usage) +
//         71-RESEARCH.md §"Pattern 2: Idempotent Run write" / §"Run + Outcome stub".
// Consumes: openExperimentStore() (71-01) — the store passed in is already open.
import { mintEntityId } from '@fwornle/km-core';

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
 * @returns {Promise<string>} the Run entity id (minted on first write, reused on re-close).
 */
export async function writeRun(store, { span, taskClass, pending, tags, totals }) {
  if (!span || !span.task_id) {
    throw new Error('writeRun: span.task_id is required (the idempotency key)');
  }
  const t = tags ?? {};
  const tot = totals ?? {};
  const isPending = pending === true;

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
      task_id: span.task_id, // ── the idempotency key (D-14) ──
      // ── 8 tags ALWAYS present (D-13); null/empty where no source ──
      task_hash:   t.task_hash ?? null,
      task_class:  taskClass,            // closed-6 OR 'unclassified'
      agent:       t.agent ?? null,
      model:       t.model ?? null,
      framework:   t.framework ?? null,
      spec_level:  null,                 // deferred (D-13)
      snapshot_id: null,                 // deferred → Phase 67 (D-13)
      trace_id:    t.trace_id ?? span.task_id,
      // ── operational flags ──
      pending:     isPending,            // D-06 quarantine flag
      started_at:  span.started_at ?? null,
      ended_at:    span.ended_at ?? null,
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

  process.stderr.write(
    `[experiments] writeRun task_id=${span.task_id} runId=${String(runId).slice(0, 8)} ` +
    `class=${taskClass} pending=${isPending} totalTokens=${tot.total_tokens ?? 0}\n`,
  );

  return runId;
}
