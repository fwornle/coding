# Phase 40: Ingest Pipeline & Layered Dedup - Context

**Gathered:** 2026-05-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 40 lifts OKM's working 4-stage ingest framework (`extract → dedup → store → synthesize`) and 3-layer dedup pipeline (exact-name → embedding cosine → LLM semantic) into KM-Core as a shared abstraction, so A's daily-digest consolidator and B's wave-agents can implement against it instead of duplicating dedup logic.

**What Phase 40 ships in `~/Agentic/km-core/`:**
1. `IngestPipeline` class — 4 named stages, options-object ctor, `ingest()` auto-chain + `runStage()` for cron paths.
2. `LayeredDeduplicator` — wraps 3 named layer interfaces (`ExactNameLayer`, `EmbeddingLayer`, `LLMSemanticLayer`) with short-circuit-on-first-match.
3. Three concrete layer impls ported from existing systems:
   - `JaccardNameMatcher` — from B's `integrations/mcp-server-semantic-analysis/src/agents/deduplication.ts`
   - `CosineEmbeddingMatcher` — from A's v6.0 retrieval service (Qdrant-backed)
   - `LLMSemanticMatcher` — from OKM's `~/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/ingestion/deduplicator.ts`
4. Extractor / synthesizer interfaces (callers ship the concrete impls per system).
5. Unit tests covering 4-stage ordering, skipStages behavior, dedup short-circuit semantics, and ontologyClass-scoped candidate pooling.

**Out of scope (deferred to later phases):**
- Rewriting A's `ObservationConsolidator` or B's `WaveController` to use the framework → **Phase 41 (INT-01)** + **Phase 42 (INT-02)** respectively.
- Post-hoc `resolveEntities()` graph-maintenance operation → **Phase 41 (PIPE-02)** per REQUIREMENTS.md.
- C's existing OKM migration onto KM-Core → **Phase 43 (INT-03)**.
- Qdrant integration glue (A's embedding store) — `CosineEmbeddingMatcher` takes a caller-supplied embedding client as a dependency; Phase 40 doesn't ship the Qdrant wiring.

**SC#4 nuance:** ROADMAP SC#4 ("no duplicated dedup code remains across A/B/C") is satisfied at the *library* layer by Phase 40 (one canonical implementation per layer in km-core), but the duplicate code in A/B is not deleted until Phases 41/42 migrate those systems. Phase 40 verification should note this; SC#4 is fully discharged at the end of Phase 42.

</domain>

<decisions>
## Implementation Decisions

### Pipeline Integration Shape
- **D-42:** **Options-object composition for pipeline ctor.** `new IngestPipeline(store, { extractor, deduplicator, synthesizer, onPhase? })` — store is positional (it's the central dependency), three stage impls are options-object fields (matches Phase 37/39 D-14). No abstract base class; no `extends IngestPipeline`. Systems compose, they don't inherit. OKM's existing class ports with one rename. `onPhase?: (e: { stage, status, count? }) => void` is the observability hook ported verbatim from OKM's `IngestionPipeline`.

### Stage Execution & Cadence Control
- **D-43:** **Hybrid auto-chain + per-stage skip flags.** `pipeline.ingest(text, { provenance, skipStages?: ('extract'|'dedup'|'store'|'synthesize')[] })` auto-runs the 4 stages sequentially, honoring `skipStages` to omit any (typically `synthesize` for A's daily-cron path). The framework also exposes `pipeline.runStage(name, input, opts)` as a public method for systems that want to run a single stage out-of-band (A's daily cron calls `runStage('synthesize', todaysEntities, { provenance })`). When called via `ingest()`, the framework enforces extract→dedup→store→synthesize order; when called via `runStage()`, caller controls the order (and any misuse — explicit choice). Stage order is part of the framework's contract per ROADMAP SC#3 ("framework enforcing the four-stage order"); skipStages is opt-out, not reorder.

### Dedup Layer Plug-in Shape
- **D-44:** **Three named layer interfaces + short-circuit on first match.** `LayeredDeduplicator` exposes a typed slot per layer:
  ```typescript
  new LayeredDeduplicator({
    exactName: ExactNameLayer,
    embedding: EmbeddingLayer,
    llmSemantic: LLMSemanticLayer,
    shortCircuit?: boolean,  // default true
  })
  ```
  Each layer is its own type-checked interface (separate names, separate methods, easy to mock per-layer in tests). Layers are optional — omit a slot and that layer is skipped (cheap path for systems that don't need it). Pipeline runs layers in declared order (`exactName → embedding → llmSemantic`); when `shortCircuit: true` (default), the first layer whose `match()` returns `{ matched: true, confidence >= threshold }` wins and downstream layers are skipped for that entity. Per-layer threshold lives on the layer impl itself (Jaccard 0.9 / cosine 0.85 / LLM 0.7 are starting points; tunable per ctor opt). One implication: layers cannot vote / aggregate — first-match wins.

### Candidate Pool Sourcing
- **D-46:** **ontologyClass-scoped via `store.findByOntologyClass(entity.ontologyClass)`.** The pipeline (not the layer) pre-loads candidates by querying same-class entities from the store before each `dedup()` call. This inherits Phase 39 D-34's active-only-by-default filter for free (superseded predecessors are excluded automatically). One implication: dedup is always same-class — there is no cross-class merge in v0.1, even if two entities of different classes have identical names. This matches OKM's current behavior. Embedding-layer impls can prefetch the class's vectors once per batch to amortize vector-store calls.

### Legacy A/B Coupling (SC#4 path)
- **D-45:** **Co-exist mode — framework only, A/B migrations deferred.** Phase 40 ports the layer algorithms into km-core (`JaccardNameMatcher`, `CosineEmbeddingMatcher`, `LLMSemanticMatcher`) but does NOT modify A's `ObservationConsolidator` or B's `WaveController`. Legacy paths in both systems are untouched. Phase 41 (INT-01) migrates A onto the framework; Phase 42 (INT-02) migrates B. SC#4 ("no duplicated dedup code remains") is partially true at the end of Phase 40 (one canonical impl exists in km-core) and fully true at the end of Phase 42 (legacy duplicates removed). This boundary is intentional per PROJECT.md "B and C migrate per-system, not coupled" — keeps Phase 40's blast radius to one repo (km-core).

### Carrying Forward from Phase 37 + 38 + 39
- **CF-D04:** Code lives in `~/Agentic/km-core/` (standalone repo). Phase 40 adds `src/pipeline/`, `src/dedup/`, modifies `src/index.ts`. No edits to A or B repos.
- **CF-D06:** ESM-only, `type: module`, NodeNext. All new relative imports use `.js` suffix.
- **CF-D14:** Options-object pattern. Every public API takes `{ ... }` for opts, no positional after the primary subject.
- **CF-D17:** `batch([...])` is atomic. Any multi-write inside dedup (e.g., supersession when a match is found and a new revision is created) uses a single batch op.
- **CF-D30/31/32 (Phase 39):** Writer-side stamping is the store's job. Pipeline threads `ProvenanceStamp` through all 4 stages; each stage forwards it to the next; `putEntity(entity, { provenance })` in the `store` stage is the only place that stamps. The pipeline never invents a `ProvenanceStamp`.
- **CF-D34 (Phase 39):** `findByOntologyClass` defaults to active-only. Candidate pool inherits this — superseded predecessors are excluded from dedup.
- **CF-D33 + CR-01 fix (Phase 39):** When a dedup decision triggers supersession (new revision supersedes existing), the writer's atomic predecessor closure path applies. If the predecessor has a legacy non-v7 id, the `BatchOp.skipOntologyCheck` per-op widening landed in 39-REVIEW-FIX.md `44c1e9b` is required.
- **no-console-log:** All diagnostic output uses `process.stderr.write(...)`, never `console.*`. Applies to all new pipeline + dedup code.

### Claude's Discretion
- Internal stage interface signature details (exact arg shape, return shape) — the planner picks, constrained by D-42..D-46 contracts. Recommended starting point: port OKM's `IngestResult`/`PhaseCallback` shapes byte-equivalent and add fields only when D-46's class-scoping forces a change.
- File layout under `src/pipeline/` and `src/dedup/` (one file per layer vs. one file with all three, etc.) — planner picks.
- Stage failure semantics (abort-on-throw vs. skip-and-continue with checkpoint) — planner picks. Recommended default: abort on throw, mirroring CF-D17 batch atomicity, with the caller responsible for retry orchestration.
- Whether `runStage('store', entities, opts)` is the same code path as `pipeline.ingest({ skipStages: ['extract','dedup','synthesize'] })` or a distinct entry point — planner picks; the public contracts must produce identical results either way.
- Exact threshold defaults for the 3 layers (Jaccard 0.9 / cosine 0.85 / LLM 0.7 are starting points only; planner can tune based on what OKM/B currently use in production).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 40 Inputs
- `.planning/REQUIREMENTS.md` §"Pipeline (PIPE)" + §"Deduplication (DEDUP)" — PIPE-01 (4-stage framework), DEDUP-01 (3-layer dedup). Note: PIPE-02 (post-hoc resolveEntities) is **Phase 41**, not Phase 40.
- `.planning/ROADMAP.md` §"Phase 40: Ingest Pipeline & Layered Dedup" — 4 success criteria. SC#4 nuance: full discharge at end of Phase 42 (see Phase Boundary above).
- `.planning/PROJECT.md` — milestone scope, "B and C migrate per-system, not coupled" rationale that anchors D-45.
- `.planning/research/v7.1-km-unification.md` — source-of-truth comparison across A/B/C; documents that the 4-stage framework comes from OKM (#4) and the layered dedup also from OKM (#5). Names B's name-Jaccard as the "exact-name" stage and A's cosine as the "embedding" stage.

### Phase 37 + 38 + 39 (locked decisions to carry forward)
- `.planning/phases/37-km-core-foundation/37-CONTEXT.md` §Decisions D-04..D-23 — repo location, ESM/strict TS, options-object pattern, GraphKMStore shape, batch atomicity.
- `.planning/phases/38-ontology-registry/38-CONTEXT.md` §Decisions D-26..D-29 — OntologyRegistry behavior (pipeline calls into it via store validation, doesn't change it).
- `.planning/phases/39-entity-data-model/39-CONTEXT.md` §Decisions D-30..D-41 — putEntity writer-side stamping (used in store stage), supersession semantics (when dedup triggers a new revision), backfill machinery (unrelated to pipeline but shares store), mergeDescriptionSegment helper (synthesize stage may call this).
- `.planning/phases/39-entity-data-model/39-REVIEW-FIX.md` — CR-01 fix (`BatchOp.skipOntologyCheck` per-op widening, commit `44c1e9b`) needed if dedup-induced supersession ever closes a legacy-id predecessor.

### Source-of-Truth Implementations to Port (Phase 40 lifts these)
- `~/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/ingestion/pipeline.ts` — **THE** reference for the 4-stage framework. Phase 40 ports class shape, `onPhase` callback, `IngestResult`, sequential stage execution, PII/governance hooks (governance is optional in km-core's port — verify with planner whether to include it).
- `~/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/ingestion/deduplicator.ts` — **THE** reference for the LLM-semantic dedup layer. Phase 40 ports the LLM-call structure into `LLMSemanticMatcher` (NOT the whole `EntityDeduplicator` class — only the LLM-semantic layer concerns).
- `~/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/ingestion/extractor.ts` — `EntityExtractor` interface shape; km-core's `Extractor` interface should be compatible (extractor stage is system-pluggable).
- `integrations/mcp-server-semantic-analysis/src/agents/deduplication.ts` — B's name-Jaccard + entity-merging logic. Phase 40 ports the Jaccard algorithm into `JaccardNameMatcher`. Phase 42 (B migration) later deletes this file.
- A's embedding-cosine logic (location TBD by researcher — likely in `integrations/mcp-server-semantic-analysis/src/qdrant-sync.ts` or the v6.0 retrieval service code). Phase 40 ports the cosine algorithm into `CosineEmbeddingMatcher`. Phase 41 (A integration) later removes A's duplicate.

### km-core Existing Source (Phase 40 modifies these)
- `~/Agentic/km-core/src/store/GraphKMStore.ts` — Phase 39 `putEntity(entity, { provenance })`, `findByOntologyClass({ includeSuperseded? })`, `getSupersessionChain(id)`. Pipeline calls these but does NOT modify GraphKMStore.
- `~/Agentic/km-core/src/types/entity.ts` — `Entity`, `ProvenanceStamp`, `EntityProvenance`, `DescriptionSegment`. Pipeline passes these through stages; no new fields needed.
- `~/Agentic/km-core/src/segments/merge.ts` — Phase 39 `mergeDescriptionSegment(entity, newSegment)`. The synthesize stage may call this when folding new text into existing entities; the synthesize stage impl, not the framework, owns that choice.
- `~/Agentic/km-core/src/index.ts` — root barrel; append `IngestPipeline`, `LayeredDeduplicator`, the 3 layer interfaces + concrete classes, `IngestResult`/`PhaseCallback`/`StageInput`/etc. AFTER Phase 39's `mergeDescriptionSegment` + `backfillEntityDataModel` exports.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **OKM's `IngestionPipeline` class (`pipeline.ts`)** — 4-stage sequential structure, `onPhase` callback, ctor-injected extractor/deduplicator. Phase 40 ports this shape essentially verbatim (D-42 keeps the composition, drops C++-style positional ctor args for the options-object).
- **OKM's `IngestResult` shape** — `{ extractedCount, addedCount, confirmedCount, mergedCount, droppedCount, durations: { extractMs, dedupMs, storeMs, synthesizeMs } }`. Phase 40's `IngestResult` should be a superset (add `skippedStages` when `skipStages` was used).
- **B's `deduplicateEntities` + `mergeEntityGroup` (`deduplication.ts:314, :342`)** — the Jaccard algorithm + observation-merging logic. Phase 40 ports the Jaccard scoring into `JaccardNameMatcher`; merging logic stays in caller code (Phase 42 owns it).
- **Phase 37 `EventEmitter` on `GraphKMStore`** — `entity:put`, `entity:delete` events. Useful for `onPhase` instrumentation but not required (D-42 keeps `onPhase` as a direct callback for parity with OKM).
- **Phase 39 `findByOntologyClass({ includeSuperseded?: false })`** — D-46's candidate-pool source. Active-only default is exactly what dedup wants (don't match against retired predecessors).
- **Phase 39 `putEntity(entity, { provenance })`** — store stage. Stamps `validFrom`, `createdAt`, `updatedAt`, EntityProvenance auto.
- **Phase 39 `mergeDescriptionSegment(entity, newSegment)`** — synthesize stage building block. Caller decides when to call it.

### Established Patterns
- **Options-object everywhere (D-14 → D-42)** — `new IngestPipeline(store, { ... })`, `new LayeredDeduplicator({ ... })`, `pipeline.ingest(text, { provenance, skipStages? })`, every layer ctor.
- **ESM `.js` import suffix on all relative imports (CF-D06)** — `from './layered.js'`, `from '../store/types.js'`. No exceptions.
- **`process.stderr.write` for diagnostics, never `console.*` (no-console-log)** — pipeline observability via `onPhase` callback (caller-owned); internal warnings (e.g., "embedding layer received empty candidate pool") use stderr.
- **Writer-side stamping (CF-D30)** — pipeline never invents a ProvenanceStamp; it threads the caller-supplied one through stages and forwards to `putEntity`.
- **Atomic batch for multi-write (CF-D17)** — if dedup decides to supersede an existing entity with a new revision, the closure + new-entity write goes through a single `store.batch([...])` op.

### Integration Points
- `IngestPipeline.ingest(text, opts)` → calls extractor.extract(), deduplicator.dedup(), store.batch()/store.putEntity() (per Phase 37/39 contracts), synthesizer.synthesize() — in that order, threading `provenance` through `opts`.
- `LayeredDeduplicator.dedup(entity, candidates)` → calls `exactName.match()` then `embedding.match()` then `llmSemantic.match()`, short-circuiting on first match with confidence ≥ threshold.
- Pipeline pre-loads candidates via `store.findByOntologyClass(entity.ontologyClass)` before calling deduplicator.dedup() — D-46.
- Root barrel `src/index.ts` appends Phase 40 exports after Phase 39's exports. Phase 41/42/43 will append their migrations after Phase 40's.

</code_context>

<specifics>
## Specific Ideas

- The `PhaseCallback` shape ports from OKM verbatim: `(arg: { stage: 'extract'|'dedup'|'store'|'synthesize'; status: 'start'|'end'; count?: number; durationMs?: number }) => void`.
- The `IngestResult` shape: `{ extractedCount, storedCount, mergedCount, skippedCount, droppedCount, durations: { extractMs, dedupMs, storeMs, synthesizeMs }, skippedStages: ('extract'|'dedup'|'store'|'synthesize')[] }`.
- Each layer ctor takes `{ threshold?: number, ...layerSpecificOpts }`. Threshold defaults are starting points: Jaccard 0.9, cosine 0.85, LLM 0.7. The planner can tune based on what OKM/B currently use in production code — these are not locked.
- `LayeredDeduplicator` short-circuit defaults to `true`. Setting `shortCircuit: false` causes all layers to run sequentially even after a match — useful for offline analysis/calibration runs but NOT for the per-batch dedup path.
- Pipeline calls `findByOntologyClass(entity.ontologyClass)` once per extracted entity (no batching) for simplicity. If profiling shows it's hot, planner can group candidates by class once per ingest. Don't pre-optimize.

</specifics>

<deferred>
## Deferred Ideas

- **A's `ObservationConsolidator` migration → Phase 41 (INT-01).** Phase 40 ports the algorithm into `CosineEmbeddingMatcher` but leaves A's code untouched. Phase 41 wires A through `IngestPipeline`.
- **B's `WaveController` migration → Phase 42 (INT-02).** Phase 40 ports Jaccard into `JaccardNameMatcher` but leaves B's deduplication.ts in place. Phase 42 deletes B's local copy.
- **C's existing OKM → KM-Core port → Phase 43 (INT-03).** OKM's `IngestionPipeline` lives in rapid-automations today. Phase 40 ports the *shape*; Phase 43 swaps C to import from km-core.
- **Post-hoc `resolveEntities()` graph-maintenance op → Phase 41 (PIPE-02).** Per REQUIREMENTS.md, this is Phase 41, not Phase 40. Phase 40 stays scoped to per-batch dedup.
- **Cross-batch state for embedding layer (Qdrant integration).** `CosineEmbeddingMatcher` takes a caller-supplied embedding client as a dependency. Phase 40 doesn't ship the Qdrant glue — A's adapter (Phase 41) and B's adapter (Phase 42) wire their own.
- **PII filter + governance hooks (OKM's `pii-filter.ts`, `governance.ts`).** OKM's pipeline runs these as extract-time concerns. Phase 40 may or may not port them — defer the decision to the planner / researcher; if they're needed by C, they need to come too, but the pipeline framework itself is agnostic to them (they're caller-side concerns wrapped around extract).
- **Voting / aggregation across layers.** D-44 locks short-circuit-on-first-match. If real-world tuning later shows the layers disagree often enough to warrant voting, reopen — but the data so far (OKM short-circuits) suggests it's not needed.
- **Cross-class entity merging.** D-46 hard-codes same-class scope. If a real use case for cross-class merging emerges (e.g., a Component that should merge with an Observation about it), that's a future phase, not a Phase 40 change.
- **Stage failure semantics formalization.** D-42..D-46 do not lock abort-vs-continue. Recommended default (abort) noted in Claude's Discretion; if real-world experience shows continue-with-checkpoint is needed, revisit in a follow-on phase.

</deferred>

---

*Phase: 40-ingest-pipeline-layered-dedup*
*Context gathered: 2026-05-21*
