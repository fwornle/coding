# Phase 41: Online Learning Adapter & Post-Hoc Resolution - Context

**Gathered:** 2026-05-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 41 ships two cooperating deliverables in `~/Agentic/km-core/`:

1. **INT-01 — Online Learning Adapter:** A thin, read-side adapter that exposes A's existing observations/digests/insights (already living in SQLite at `.observations/observations.db` + JSON exports at `.data/observation-export/`) as KM-Core entities, **without modifying A's ETM hot write path**. SC#2 is a hard constraint: ETM write latency must remain unchanged. The adapter is pull-on-read for hot queries; a separate explicit reprojection step builds a typed GraphKMStore projection for graph-shaped queries and PIPE-02 scans.

2. **PIPE-02 — Post-hoc cross-class entity resolution:** A KM-Core maintenance operation that scans the graph by `ontologyClass`, runs LLM-semantic matching across the whole class (not just the per-batch candidate pool), and merges duplicates that escaped per-batch dedup. Pattern lifted from OKM `deduplicator.ts:620` (`graphStore.getAllEntities() → batchLLMResolution(BATCH_SIZE=30, CONCURRENCY=3) → merge by-degree`). Used by all three systems via the shared km-core API.

**In scope:**
- New ontology files in `~/Agentic/km-core/ontology/`: `LearningArtifact` upper + `Observation`/`Digest`/`Insight` lowers via `extends`.
- New TS sub-path `@fwornle/km-core/maintenance` exporting `resolveEntities(store, opts)` and `mergeEntities(store, survivorId, duplicateIds[], opts)`.
- New TS sub-path / module for the adapter that maps A's SQLite row shapes to KM-Core `Entity` instances on read. Adapter exposes both a streaming/lazy iterator and an explicit `reprojectFromOnlineStore(store, opts)` reprojection function.
- Test coverage: unit tests for the adapter mapping shape + the maintenance ops; integration test that runs `reproject → resolveEntities(dryRun:true) → mergeEntities` end-to-end against a fixture SQLite + ontology.

**Out of scope (deferred):**
- Touching A's `ObservationWriter.js` or `ObservationConsolidator.js` — Phase 40 D-45 co-exist mode applies (no edits to A's write path).
- B's migration to KM-Core — Phase 42 (INT-02).
- C's cross-repo migration — Phase 43 (INT-03).
- Pushing observations into a live graph at write time (dual-write) — explicitly rejected (G1: pull-on-read won; SC#2 favors zero hot-path impact).
- Daemon / cron reprojection — explicitly rejected (G1 cadence: on-demand only).
- libc++ shutdown-crash todo `2026-05-10-obs-api-libcxx-mutex-shutdown-crash.md` — reviewed during cross-reference, deferred (operational bug, distinct concern from INT-01/PIPE-02).

</domain>

<decisions>
## Implementation Decisions

### Adapter Direction (G1)
- **D-47: Hybrid pull + explicit reprojection.** Hot path: adapter maps SQLite rows → KM-Core `Entity` on read (no writes touch A's writer; SC#2 satisfied). Graph queries / PIPE-02 scans: caller runs `reprojectFromOnlineStore(store, opts)` to materialize a GraphKMStore projection from the SQLite source. Reprojection is **idempotent** — it uses the Phase 39 D-37 `legacyId` resolver pattern with `legacyId: { system: 'online', id: <sqlite-id> }` so re-runs collapse to the same entity rows, and the Phase 39 D-38 checkpoint mechanism gives crash-resume. Eventually-consistent contract is **explicit**: the graph reflects A's state as-of the last reprojection, no daemon, no skew detection.
- **D-47a: Cadence — on-demand only.** No background reprojection daemon. Reprojection fires when the operator (or a higher-level cron, outside km-core's scope) invokes the library function or a per-system CLI script. Decision rationale: minimises moving parts, avoids long-running-process failure surface, mirrors A's existing daemon-for-consolidator-only pattern.

### Ontology Mapping (G2)
- **D-48: Abstract `LearningArtifact` upper + 3 lowers via `extends`.** New ontology files in `~/Agentic/km-core/ontology/`:
  - `learning-artifacts-upper.json` — declares abstract upper `LearningArtifact` with shared properties (`id`, `project`, `createdAt`, `validFrom`, `validUntil`, `provenance`, `quality`).
  - `learning-artifacts-lower.json` (or per-class files) — `Observation`, `Digest`, `Insight` each declare `extends: LearningArtifact` plus their tier-specific fields.
  - Aggregation relationships (`Digest --aggregates--> Observation`, `Insight --aggregates--> Digest`) are **graph edges**, not class hierarchy. Edge predicate names are Claude's discretion during planning.
  - Rationale: matches ONTO-02's `extends` mechanism as designed; lets PIPE-02 scan one tier (`resolveEntities(store, {classes:['Insight']})`) or all tiers (`resolveEntities(store, {classes:['LearningArtifact']})` — including subclasses); supports future tiers (WeeklyReport, etc.) without breaking changes.
- **D-48 corollary:** Observations/Digests/Insights are **orthogonal** to the existing architectural ontology (System, Component, Pipeline, etc.). The adapter never converts an Observation into a Component — they're metadata-about-coding-sessions, not domain entities. PIPE-02 scans within `LearningArtifact` subclasses; architectural-ontology PIPE-02 scans are a separate invocation.

### PIPE-02 Surface (G3)
- **D-49: Top-level function in new `@fwornle/km-core/maintenance` sub-path.** Signature: `resolveEntities(store, opts): Promise<ResolveResult>` where `opts: { llmMatcher: LLMSemanticLayer, classes?: string[], dryRun?: boolean, concurrency?: number, batchSize?: number, log?: (e) => void }`. Matches Phase 39 D-36 precedent (`backfillEntityDataModel` is a top-level fn in km-core, not a method on the store). Future post-hoc ops (prune, compact, exportSnapshot, integrityCheck) land as sibling exports under the same namespace.
- **D-49a: Package.json exports map gains `./maintenance` entry.** Final exports map: `.`, `./ontology`, `./pipeline`, `./dedup`, `./maintenance`. Plan 40-07 set the precedent (Phase 38's `./ontology` was the first sub-path).

### PIPE-02 Writeback (G4)
- **D-50: Dedicated `mergeEntities()` primitive + `dryRun` flag on resolveEntities.** Signature: `mergeEntities(store, survivorId, duplicateIds: string[], opts): Promise<MergeResult>` where the primitive atomically (Phase 37 D-17 batch):
  1. Closes each duplicate's `validUntil = now` via Phase 39 D-33 supersession path (`putEntity` with `supersedes`).
  2. Redirects each duplicate's incoming/outgoing graph edges to `survivorId` — this is the new contract the primitive adds; without it, merging produces dangling edges.
  3. Folds each duplicate's `descriptionSegments` into the survivor's via Phase 39 D-39 `mergeDescriptionSegment` building block.
  4. Increments `survivor.confirmationCount` once per merged duplicate; updates `survivor.lastConfirmedBy` to the maintenance op's caller-supplied `ProvenanceStamp`.

  `resolveEntities` calls `mergeEntities` internally for each surfaced match. When `dryRun: true`, `resolveEntities` returns the planned merges (`{ survivorId, duplicateId, ontologyClass, confidence }[]`) without invoking `mergeEntities`. Same shape regardless of dryRun.
- **D-50a: Phase 42 + 43 reuse the primitive.** `mergeEntities` is not Phase 41-specific — it's the canonical "atomically merge two entities + their graph context" op for all three systems. B's wave-merge logic (current `deduplication.ts:342 mergeEntityGroup`) and C's `mergeEntityGroup` will both be deleted in favor of this primitive during their migration phases.

### Carrying Forward from Phase 37 + 38 + 39 + 40
- **CF-D04:** Code lives in `~/Agentic/km-core/` (separate repo). Phase 41 adds `src/adapters/online/` (or equivalent path the planner picks), `src/maintenance/`, plus new ontology files in `ontology/`. No edits in A's coding/ source live-logging files.
- **CF-D06:** ESM-only, `type: module`, NodeNext. All new relative imports use `.js` suffix.
- **CF-D14:** Options-object pattern. `resolveEntities(store, { ... })`, `mergeEntities(store, survivorId, duplicateIds, { ... })`, `reprojectFromOnlineStore(store, { ... })`.
- **CF-D17:** Atomic batch for multi-write. `mergeEntities` issues a single `store.batch([...])` covering supersession close + edge rewire + segment merge + survivor confirmation bump.
- **CF-D30 / D-31 / D-32:** Writer-side provenance stamping. Caller supplies `ProvenanceStamp`; store auto-stamps `validFrom`, `createdAt`, `updatedAt`. The adapter passes the original observation's agent/llm/createdAt forward; the maintenance op gets the caller-supplied `ProvenanceStamp` (e.g., `{ provider: 'maintenance', model: 'phase-41-resolve', runId: <iso>, timestamp: <iso> }`).
- **CF-D33:** Atomic predecessor closure on supersession. `mergeEntities` is built on top of D-33 — when it calls `putEntity(survivor, { supersedes: [duplicateId] })`, the store auto-closes `validUntil`. No bookkeeping in maintenance code.
- **CF-D34:** Active-only default. `resolveEntities` scans only active entities (already-superseded entities are excluded automatically). PIPE-02 does not re-merge already-merged history.
- **CF-D36:** Library function in km-core; per-system scripts invoke it. A migration script in `coding/scripts/reproject-online.mjs` constructs its own `GraphKMStore` + `LLMSemanticMatcher` and calls `reprojectFromOnlineStore` + `resolveEntities`.
- **CF-D37:** Legacy-id resolver pattern. Adapter's `Entity.metadata.legacyId = { system: 'online', id: <sqlite-id> }` for every reprojected entity. Idempotency follows for free.
- **CF-D38:** Per-entity write + checkpoint file. `reprojectFromOnlineStore` follows the same one-at-a-time + `.data/reproject-online-checkpoint.json` pattern Phase 39 backfill established.
- **CF-D39:** `mergeDescriptionSegment` is the building block for segment folding inside `mergeEntities`.
- **CF-D42 / D-43 / D-44 / D-46 (Phase 40):** Pipeline framework is **not** wired in Phase 41 (D-45 co-exist mode applies). Phase 41 builds infra (adapter + maintenance ops) that Phase 42 / 43 / future-Phase-A-rewrite will use.
- **no-console-log:** Diagnostic output uses `process.stderr.write(...)`. Applies to all new adapter + maintenance code.

### Claude's Discretion
The planner / researcher resolves the following without re-asking the user:
- **Reprojection checkpoint format + chunk size** — reuses Phase 39 D-38 patterns; exact JSON shape and chunk-size constant are planner choices.
- **Legacy-id mapping for A's SQLite ids → km-core UUIDs** — reuse Phase 39 D-37 `legacyId` resolver shape with `system: 'online'` discriminator; UUID derivation strategy (deterministic UUIDv5 from `system+id`, or fresh UUIDv4 with `legacyId` for lookups) is planner choice.
- **LLM concurrency + batch size defaults for resolveEntities** — start from OKM's `RESOLUTION_CONCURRENCY=3`, `BATCH_SIZE=30` per `deduplicator.ts:651-654`; planner may tune via tests.
- **Aggregation edge predicate names** — `aggregates` / `derivedFrom` / `summarizes` candidates; planner picks based on existing edge-predicate conventions in `coding.json` exports.
- **Adapter file layout under `src/adapters/online/`** — module split between mapper / iterator / reprojection is planner choice; constrained by D-47 (read-only adapter; reprojection separate).
- **Survivor-selection heuristic in resolveEntities** — OKM uses "prefer node with more graph edges" (`getDegree`); planner may stick with that or tune (e.g., prefer most recent `lastConfirmedBy`).
- **Return-shape verbosity of ResolveResult / MergeResult** — must be a superset of OKM's `{ merges, synthesizedCount, errors }`; planner adds tracing fields as needed.

### Reviewed Todos (not folded)
- `2026-05-10-obs-api-libcxx-mutex-shutdown-crash.md` (score 0.6) — observability area, libc++ mutex crash on `observations-api-server.mjs` SIGTERM. Touches the same file (observations-api-server) that consumes A's data, but is a distinct operational bug (process shutdown crash, not adapter / maintenance). Defer to backlog. Phase 41 does **not** modify `observations-api-server.mjs`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 41 Inputs
- `.planning/REQUIREMENTS.md` §"Per-system integration (INT)" + §"Consolidation framework (PIPE)" — INT-01 (thin adapter; SQLite untouched) + PIPE-02 (post-hoc resolveEntities scanning by `ontologyClass`). SC#2 ("ETM writes still complete at the same latency") is the binding constraint on INT-01.
- `.planning/ROADMAP.md` §"Phase 41: Online Learning Adapter & Post-Hoc Resolution" — 4 success criteria.
- `.planning/PROJECT.md` — milestone scope; "B and C migrate per-system, not coupled" rationale that anchors D-45 (carried forward from Phase 40).

### Phase 37 + 38 + 39 + 40 (locked decisions to carry forward)
- `.planning/phases/37-km-core-foundation/37-CONTEXT.md` §Decisions D-04..D-23 — repo location, ESM/strict TS, options-object pattern, GraphKMStore shape, batch atomicity (CF-D17).
- `.planning/phases/38-ontology-registry/38-CONTEXT.md` §Decisions D-26..D-29 — OntologyRegistry behavior, `extends` semantics (ONTO-02), last-loaded-wins on class redefinition (D-27).
- `.planning/phases/39-entity-data-model/39-CONTEXT.md` §Decisions D-30..D-39 — putEntity writer-side stamping, supersession (D-33), active-only filter (D-34), backfill machinery (D-36/D-37/D-38) which Phase 41 reuses, `mergeDescriptionSegment` helper (D-39) used by mergeEntities.
- `.planning/phases/39-entity-data-model/39-REVIEW-FIX.md` — `BatchOp.skipOntologyCheck` per-op widening (commit `44c1e9b`) needed if mergeEntities ever closes a legacy-id predecessor.
- `.planning/phases/40-ingest-pipeline-layered-dedup/40-CONTEXT.md` §Decisions D-42..D-46 — pipeline ctor shape, layer interfaces, short-circuit dedup, same-class scope (D-46), co-exist mode D-45 (the constraint that keeps Phase 41 from modifying A's writer).
- `.planning/phases/40-ingest-pipeline-layered-dedup/40-VERIFICATION.md` — Phase 40 SC#4 deferred half (deletion of B's local copy) lands in Phase 42, **not** Phase 41. Phase 41 leaves A's `ObservationConsolidator.js` and `ObservationWriter.js` byte-untouched.

### Source-of-Truth Implementations to Port / Inspect
- `~/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/ingestion/deduplicator.ts:620-720` (`resolveEntities` body) + `deduplicator.ts:651-654` (concurrency + batch constants) — **THE** reference shape for PIPE-02. Phase 41 ports the algorithm into `@fwornle/km-core/maintenance`'s `resolveEntities` function.
- `~/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/ingestion/pipeline.ts:361-366` — OKM's `pipeline.resolveEntities()` wrapper; informative for how OKM threads dryRun + classes filter through.
- `~/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/api/routes.ts:227, 624-635, 2486` — OKM's REST route `POST /api/cleanup/resolve-entities` and its internals (how it invokes the pipeline op). Phase 41 does **not** ship a REST route — that's Phase 44 (API-01). But the pattern is the canonical reference for how higher layers call the maintenance op.
- `~/Agentic/Agentic/coding/integrations/mcp-server-semantic-analysis/src/agents/deduplication.ts` — B's existing `deduplicateEntities` + `mergeEntityGroup` logic. Phase 41 does NOT modify this; Phase 42 deletes it in favor of `mergeEntities` from km-core. Useful context for survivor-selection / edge-rewire patterns.

### A's Existing Code (Phase 41 reads from, never writes to)
- `src/live-logging/ObservationConsolidator.js` (~3,456 LOC) — produces digests + insights from observations. Adapter reads from the SQLite tables this class writes; never modifies the class.
- `src/live-logging/ObservationWriter.js` (~846 LOC) — single-writer SQLite gateway. Adapter is **read-only**; never opens the same SQLite file concurrently (single-owner pattern preserved). Reprojection runs against `ColdStoreReader` or a read-only DB handle, not the writer.
- `src/live-logging/ColdStoreReader.js` — read-only SQLite reader. Likely the adapter's primary backing store for the hot pull path.
- `scripts/observations-api-server.mjs` — HTTP gateway on port 12436. Phase 41 does NOT modify this file (the libc++ shutdown-crash todo is out of scope). The adapter MAY be invokable through this server in a later phase (Phase 44 API-01), but Phase 41 ships the adapter as a library function only.
- `.data/observation-export/{observations,digests,insights}.json` — JSON exports A maintains. Phase 41 may use these as a faster fallback path during reprojection, or may go direct to SQLite — planner picks.
- `.data/exports/coding.json` — current architectural-entity export (727 entities, classes: System / Project / Component / SubComponent / Pipeline / Service / etc.). **Distinct** from the LearningArtifact axis. PIPE-02 invocations against these classes are orthogonal to PIPE-02 against LearningArtifact subclasses.

### km-core Existing Source (Phase 41 modifies these)
- `~/Agentic/km-core/src/index.ts` — root barrel; appends Phase 41 exports (adapter API, `reprojectFromOnlineStore`) after Phase 40's exports. New `@fwornle/km-core/maintenance` re-exports happen in a sub-barrel.
- `~/Agentic/km-core/src/store/GraphKMStore.ts` — Phase 39 `putEntity({ provenance, supersedes })`, `findByOntologyClass({ includeSuperseded? })`, `batch([...])`. `mergeEntities` uses these primitives but does NOT modify `GraphKMStore` itself.
- `~/Agentic/km-core/src/types/entity.ts` — `Entity`, `EntityProvenance`, `ProvenanceStamp`, `DescriptionSegment`. Adapter produces entities of this shape; maintenance ops consume them.
- `~/Agentic/km-core/src/segments/merge.ts` — Phase 39 `mergeDescriptionSegment(entity, newSegment)`. `mergeEntities` calls this per duplicate.
- `~/Agentic/km-core/src/ontology/registry.ts` (Phase 38) — auto-discovers `ontology/*.json`. New `learning-artifacts-{upper,lower}.json` files are picked up automatically.
- `~/Agentic/km-core/package.json` — `exports` map gains a `./maintenance` entry.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Phase 39 `backfillEntityDataModel(store, options)` shape (D-36)** — the reprojection function follows the same library-function pattern, with the same checkpoint + resumable + dryRun + per-entity-write properties.
- **Phase 39 `legacyId` resolver pattern (D-37)** — every reprojected entity gets `metadata.legacyId = { system: 'online', id: <sqlite-id> }`. UUID derivation is deterministic across re-runs.
- **Phase 39 `mergeDescriptionSegment(entity, newSegment)` (D-39)** — the building block `mergeEntities` calls per duplicate to fold descriptions into the survivor's segment list.
- **Phase 40 `LLMSemanticMatcher` (`@fwornle/km-core/dedup`)** — `resolveEntities` instantiates this with the caller's `LLMClient` and threshold (default 0.70); reuses Phase 40's 5-stage JSON unwrap + `LLMDedupParseError` + `onError: 'skip'` defaults.
- **Phase 38 OntologyRegistry + `extends` resolution (ONTO-02)** — `LearningArtifact` upper + 3 lowers extending it. `resolveEntities(store, { classes: ['LearningArtifact'] })` should resolve to "all subclasses" via the registry's class-walk; Phase 38's `ResolvedClass` already covers this.
- **OKM `getDegree`-based survivor selection** — when LLMSemanticMatcher returns a name-pair match, the higher-degree entity wins. Phase 41 ports this heuristic into `resolveEntities` (encapsulated; not exposed as caller option).
- **A's existing JSON exports + ColdStoreReader** — likely the read-side primary source for the adapter and reprojection (vs. opening a second SQLite handle). Planner picks the exact source after measuring.

### Established Patterns
- **Library function over class method** — both `resolveEntities` and `mergeEntities` are top-level functions in `@fwornle/km-core/maintenance`, matching Phase 39 D-36's `backfillEntityDataModel`. No `MaintenanceOps` class.
- **Options-object everywhere** — every public API takes `{ ... }` for opts. No positional args after the primary subject (store).
- **ESM `.js` import suffix on all relative imports (CF-D06)**.
- **`process.stderr.write` for diagnostics, never `console.*`**.
- **Single SQLite writer** — A's `ObservationWriter` is the sole opener of `observations.db`. The adapter goes through `ColdStoreReader` or a read-only handle; never competes for the writer's lock.
- **Writer-side stamping** — `mergeEntities` calls `store.putEntity(survivor, { provenance })` for the supersession step; the store stamps `validFrom` + bumps `confirmationCount`. Maintenance code never invents a `ProvenanceStamp`.

### Integration Points
- **Adapter ↔ A's SQLite/JSON:** adapter reads, never writes; uses `ColdStoreReader` or a read-only handle. SC#2 met by construction.
- **Adapter ↔ km-core `Entity`:** adapter outputs `Entity` instances with `ontologyClass` ∈ {`Observation`, `Digest`, `Insight`}, `metadata.legacyId.system = 'online'`, and aggregation edges between Digests and their observations (and Insights and their digests).
- **`reprojectFromOnlineStore(store, opts)` ↔ km-core `GraphKMStore`:** writes entities + edges via `putEntity` + `putRelation` (or `batch`). Idempotent; uses checkpoint to resume.
- **`resolveEntities(store, opts)` ↔ km-core `LLMSemanticMatcher`:** caller supplies the matcher; the function iterates `store.findByOntologyClass(class, { includeSuperseded: false })` for each class in `opts.classes` (or all `LearningArtifact` subclasses by default) and feeds candidates into the matcher.
- **`resolveEntities` ↔ `mergeEntities`:** for each surfaced match, `resolveEntities` calls `mergeEntities(store, survivorId, [duplicateId], { provenance, ... })`. `dryRun: true` skips this call and returns the plan.
- **`mergeEntities` ↔ Phase 37/39 `store.batch`:** single batch op covering supersession close (D-33) + edge rewire + segment merge (D-39) + confirmation bump.
- **Phase 42 + Phase 43:** B + C migrations call `mergeEntities` from km-core instead of their local `mergeEntityGroup` implementations. Phase 41 lands the primitive; later phases delete the duplicates.
- **Phase 44 (API-01):** future REST route `POST /api/maintenance/resolve-entities` wraps `resolveEntities`. Phase 41 doesn't ship a route.

</code_context>

<specifics>
## Specific Ideas

- **Reprojection script entry point:** `coding/scripts/reproject-online.mjs` — wraps `reprojectFromOnlineStore` (km-core) + constructs the `GraphKMStore` against `.data/knowledge-graph/`. Mirrors how Phase 39 backfill scripts work.
- **`ResolveResult` minimum shape:** `{ merges: Array<{ survivorId, survivorName, duplicateId, duplicateName, ontologyClass, confidence }>; synthesizedCount: number; errors: string[]; dryRun: boolean }`. Superset of OKM's shape; adds `confidence` (LLM matcher provides it) and `dryRun` echo.
- **`MergeResult` minimum shape:** `{ survivorId: string; duplicateIds: string[]; edgesRewired: number; segmentsMerged: number; oldValidUntil: string }`.
- **`reprojectFromOnlineStore` opts:** `{ sources?: { sqlite?: string; jsonExports?: string }; dryRun?: boolean; checkpointPath?: string; chunkSize?: number; legacyProvenance: ProvenanceStamp; onProgress?: (e) => void }`. `legacyProvenance` is required because reprojected entities have no native provenance — operator supplies one.
- **Default class set for `resolveEntities` when `classes` omitted:** all subclasses of `LearningArtifact`. PIPE-02 against the architectural ontology (Component, Pipeline, etc.) is a separate explicit invocation.

</specifics>

<deferred>
## Deferred Ideas

- **A's `ObservationConsolidator` migration onto IngestPipeline** — defer indefinitely. Phase 40 D-45 co-exist mode applies; A's consolidator runs unchanged. If A is ever migrated to use `IngestPipeline` directly, that's a follow-on phase well after v7.1 ships.
- **PII filter / governance hooks on the adapter read path** — OKM has these for ingest; the adapter on reprojection could apply them but A's data is already considered project-internal and filtered upstream by `ObservationSanitizer`. Defer until a real PII concern surfaces.
- **Push / dual-write adapter** — explicitly rejected (G1). If real-time graph freshness ever becomes a hard requirement (and the latency budget shifts), reopen via a new phase. Today's contract is explicit eventual-consistency.
- **Reprojection daemon / cron** — explicitly rejected (G1 cadence). Operator triggers reprojection on-demand. If higher-level cron is desired, it lives in coding/ ops scripts, not in km-core.
- **Aggregation-edge predicates as ontology classes themselves** — out of scope; predicates stay as plain edge-type strings. If predicate-as-class becomes useful for typed traversal, reopen.
- **Cross-class merging via PIPE-02** — Phase 40 D-46 locks same-class scope; same rule applies to PIPE-02. If real-world data shows cross-class duplicates (e.g., a Digest whose theme exactly matches an Insight topic), that's a future phase.
- **Survivor-selection beyond `getDegree`** — OKM's heuristic ported as-is. If domain experts surface a need for content-quality-weighted or recency-weighted selection, reopen.
- **`pruneEntities` / `compactGraph` / `exportSnapshot` maintenance ops** — Phase 41 lands `/maintenance` as a namespace; later phases (or Phase 44+) add siblings. Not Phase 41 scope.
- **REST surface for resolveEntities + mergeEntities** — Phase 44 (API-01) ships the unified REST contract. Phase 41 is library-only.
- **B's name-Jaccard deletion** — Phase 42 (INT-02) deletes `integrations/mcp-server-semantic-analysis/src/agents/deduplication.ts`. Phase 41 leaves it untouched.

### Reviewed Todos (not folded)
- `2026-05-10-obs-api-libcxx-mutex-shutdown-crash.md` — libc++ mutex crash on `observations-api-server.mjs` SIGTERM. Touches the same file that exposes A's data but is a process-shutdown bug, not an adapter / maintenance concern. Keep on backlog.

</deferred>

---

*Phase: 41-online-learning-adapter-post-hoc-resolution*
*Context gathered: 2026-05-22*
