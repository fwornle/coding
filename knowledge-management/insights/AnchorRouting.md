# AnchorRouting

**Type:** Detail

## What It Is

AnchorRouting is a small, targeted mechanism implemented directly inside `src/live-logging/ObservationWriter.js`, within its parent component ObservationWriter. It is expressed as two constants — `ANCHOR_ROOT` and `ANCHOR_FOR_KIND` — that determine which graph node a `capturedBy` edge should point to for any newly written entity. Rather than a class or standalone module, it is a data-encoded lookup table: entities of kind `observation` route to `'ObservationWriter'`, `digest` and `insight` route to `'ObservationConsolidator'`, and everything else falls back to the single root anchor `'LiveLoggingSystem'`. It is not a child file or subsystem in its own right but a routing policy embedded in its parent's source.

## Architecture and Design

The core pattern is a two-tier fallback resolution: a kind-specific target if one exists, otherwise a shared root anchor. This is deliberately implemented as a plain object lookup rather than conditional branching, so extending it to a new entity kind is a one-line table edit. The design was empirically validated, not guessed — the header comment above `ANCHOR_FOR_KIND` documents that all 1,244 existing `capturedBy` edges were measured before the table was finalized, confirming that Observations always carried an obs-writer `runId` and Insights always a consolidation one, with no overlap. This is why the table has exactly two kind-buckets rather than a more granular per-writer-class taxonomy: the evidence supported only two buckets, and the design stopped there by policy.

A second, related decision is the explicit rejection of per-run anchor nodes. With 500 runs already producing 2,398 entities (401 of which touch three rows or fewer), minting one anchor per run was judged too costly in node count. Instead, precise run identity is pushed to `metadata.provenance` and exposed via `/api/v1/graph/runs` and `/api/v1/entities?runId=`, keeping the anchor-routing graph topology stable and bounded even as run volume grows unboundedly.

## Implementation Details

Mechanically, every entity write produces a `capturedBy` edge whose target is resolved by checking `ANCHOR_FOR_KIND` for the entity's kind and falling back to `ANCHOR_ROOT` if no match exists. The header comment for this code states its guiding principle plainly: a missing subsystem node "costs precision, never the tether" — meaning the fallback guarantees an edge always exists, even if it's not maximally specific. This directly addresses a documented failure mode: a prior drift that silently orphaned 22 Insights from the graph. AnchorRouting is therefore defensive infrastructure against orphaning, not merely a classification nicety.

Notably, `ObservationWriter.js` also imports `routeFromArtifacts` from `lib/attribution/repo-router.mjs` in the same module. This is a distinct routing concern — team/repo attribution rather than graph-edge targeting — but because the codebase's own vocabulary calls both "routing," they are easily conflated under a single "AnchorRouting" label. Architecturally they must be kept separate: `ANCHOR_ROOT`/`ANCHOR_FOR_KIND` solve orphan-prevention for graph edges, while `routeFromArtifacts` solves content ownership attribution — they simply happen to be co-located in the same file.

## Integration Points

AnchorRouting's most direct dependency is on the entity-kind classification already present at write time in ObservationWriter — it consumes that kind to select a table entry. It also depends indirectly on upstream data integrity: the sibling AttributionRouterModule's `routeFromArtifacts` function relies on the Artifacts field being intact, and the "Cold-Store Backfill — Artifacts Field Recovery" work reconstructed that field for historical rows via exact-timestamp matching (a looser match was judged too risky). While that backfill served attribution rather than anchor routing directly, it illustrates the same module's dependency on upstream data quality guarantees.

Within ObservationWriter, AnchorRouting sits alongside but is functionally unrelated to ObservationWriteEventBus (the module-level `_observationEmitter` powering the SSE stream) and LegacyIngestAdapters (the `legacyObservationToEntity`/`legacyDigestToEntity`/`legacyInsightToEntity` imports from `@fwornle/km-core/adapters/legacy-ingest`). These are all siblings co-located in the same file but address separate concerns: eventing, legacy format adaptation, and attribution, respectively.

## Usage Guidelines

Developers extending entity kinds should add a new entry to `ANCHOR_FOR_KIND` rather than writing branching logic — this preserves the intended one-line-edit maintainability. Any such addition should ideally be backed by the same measured-evidence discipline used originally (examining actual `capturedBy` edge distributions) rather than speculative categorization, to avoid drifting back into an unjustified fine-grained taxonomy. Developers should not attempt to encode per-run identity as graph structure; that information belongs in `metadata.provenance` and should be queried via the existing `/api/v1/graph/runs` and `/api/v1/entities?runId=` endpoints. Finally, care must be taken not to conflate AnchorRouting with the attribution routing performed by `routeFromArtifacts` — despite shared terminology and file co-location, they are separate mechanisms with separate failure modes (orphaned graph edges vs. misattributed ownership) and should be reasoned about independently.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Relationships:**
- ObservationWriter.js imports `routeFromArtifacts` from `lib/attribution/repo-router.mjs` (confirmed by the code graph's import list) alongside the anchor-target constants. These are two distinct routing concerns living in the same module: `ANCHOR_ROOT`/`ANCHOR_FOR_KIND` decide which graph node a `capturedBy` edge points to for orphan-prevention, while `routeFromArtifacts` decides which team/repo an observation's content is attributed to. Both are described in this codebase's vocabulary as 'routing', which is a likely source of the two being conflated under one AnchorRouting label.

**Other:**
- The anchor-routing logic lives directly in src/live-logging/ObservationWriter.js as the `ANCHOR_ROOT` / `ANCHOR_FOR_KIND` constants: every `capturedBy` edge falls back to a single root target (`'LiveLoggingSystem'`) unless the entity's kind has a more specific target — `observation` routes to `'ObservationWriter'`, while both `digest` and `insight` route to `'ObservationConsolidator'`. This is a two-tier resolution function encoded as data (a plain object lookup) rather than a branching function, so adding a new entity kind is a one-line table edit rather than a code change.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The 'Cold-Store Backfill — Artifacts Field Recovery' record documents a repair for cold-storage rows that had lost their Artifacts field, reconstructed via exact-timestamp matching against editing-turn data specifically because a looser (fuzzy or time-window) match was judged too risky. Since the Artifacts field is the input `routeFromArtifacts` consumes to make its attribution decision, this backfill was a prerequisite for that router — and by extension for anchor-edge integrity — to function correctly on affected historical rows.

## Hierarchy Context

### Parent
- [ObservationWriter](./ObservationWriter.md) -- [SESSION] Attribution Router Module: ObservationWriter now uses deterministic path-based routing (repo-router.mjs) instead of a prior unreliable embedding-similarity voting approach, fixing misattribution of KB observations to owning teams/repos

### Siblings
- [AttributionRouterModule](./AttributionRouterModule.md) -- [SESSION] Attribution Router Module: ObservationWriter now uses deterministic path-based routing (repo-router.mjs) instead of a prior unreliable embedding-similarity voting approach, fixing misattribution of KB observations to owning teams/repos.
- [LegacyIngestAdapters](./LegacyIngestAdapters.md) -- [LLM] The only trace of "legacy-ingest" adapters in the supplied code is a set of import statements in src/live-logging/ObservationWriter.js: `legacyObservationToEntity`, `legacyDigestToEntity`, and `legacyInsightToEntity`, pulled from the package path `@fwornle/km-core/adapters/legacy-ingest`. The module that actually defines these three functions — described in ObservationWriter.js's own header comment as living at `lib/km-core/src/adapters/legacy-ingest.ts` — is not among the files provided, so no observation here can speak to its field-mapping logic, error handling, or adapter-specific behavior.
- [ObservationWriteEventBus](./ObservationWriteEventBus.md) -- [LLM] The event bus lives entirely inside src/live-logging/ObservationWriter.js as a single module-level `_observationEmitter = new EventEmitter()`, not as a separate class or file — there is no `ObservationWriteEventBus.js`. The in-code comment block above the declaration explicitly labels this construct 'Phase 55 Plan 06 Task 3 — process-wide observation-write event bus' and states its purpose: giving the obs-api SSE endpoint `/api/coding/observations/stream` a hook to broadcast each successful observation write to long-poll HTTP listeners, without forcing callers to traverse the writer-init pipeline before subscribing.


---

*Generated from 10 observations*
