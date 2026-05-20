# Phase 39: Entity Data Model - Context

**Gathered:** 2026-05-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 39 locks the **writer semantics** for the canonical KM-Core entity's temporal validity (`validFrom`, `validUntil`, `supersedes`) and structured provenance (`createdBy`, `lastConfirmedBy`, `confirmationCount`, per-segment `DescriptionSegment.confirmations[]`). All type declarations already exist in `~/Agentic/km-core/src/types/entity.ts` (landed by Phase 37 Plan 02 as documented declarations, intentionally empty pending Phase 39). Phase 39:

1. Makes `GraphKMStore.putEntity` auto-stamp the temporal + provenance fields (writer-side) when the caller doesn't supply them.
2. Defines side-effects of `supersedes` (auto-set old `validUntil`) and default query filtering (active-only).
3. Ships a `getSupersessionChain(id)` query API.
4. Ships a library-level `backfillEntityDataModel(store, options)` function for legacy A/B entities, plus a `mergeDescriptionSegment(entity, newSegment)` helper for per-segment writers.

Out of scope: B's persistence-agent migration (Phase 42 INT-02), A's SQLite adapter (Phase 41 INT-01), C's OKM migration (Phase 43 INT-03), the layered dedup pipeline (Phase 40 PIPE-01/DEDUP-01).

</domain>

<decisions>
## Implementation Decisions

### Writer-Side Stamping
- **D-30:** **Store auto-stamps; caller provides ProvenanceStamp source.** `GraphKMStore.putEntity(entity, { provenance: ProvenanceStamp })` auto-stamps `validFrom = new Date().toISOString()` if missing and sets `confirmationCount = 1` on first write. The caller MUST supply the `provenance` argument (provider/model/runId/timestamp) — the store never invents one. This keeps the store free of ambient state and mirrors Phase 37 D-10 "writer-side on first store" for UUID stamping.
- **D-31:** **Keep optional on the type; enforce at the writer.** `validFrom?`, `validUntil?`, `supersedes?` remain optional on the `Entity` type (no breaking change to Phase 37 callers and read-only literal consumers). The runtime contract is: any entity *returned from* the store has `validFrom` populated. Callers can pass `Entity` with missing fields; the store fills them.
- **D-32:** **Store decides create vs confirm by id existence.** A single `putEntity(entity, { provenance })` call handles both. If the id is new: store sets `createdBy = provenance`, `lastConfirmedBy = provenance`, `confirmationCount = 1`. If the id exists: store updates `lastConfirmedBy = provenance`, increments `confirmationCount`, preserves the original `createdBy`, bumps `updatedAt`. No separate `confirmEntity` method. EntityProvenance lives at `metadata.provenance` per the Phase 37 `EntityProvenance` declaration's JSDoc.

### Supersession Semantics
- **D-33:** **Atomic predecessor closure.** When `putEntity` sees `supersedes: oldId` on a new entity, the store loads the old entity, sets `old.validUntil = new.validFrom`, and writes both back within the same atomic batch operation (Phase 37 D-17). No gap, no overlap, no caller bookkeeping. If `old.validUntil` is already set, store emits a `process.stderr.write('overwriting validUntil for <oldId>')` warning before overwriting — preserves debuggability without blocking the write.
- **D-34:** **Active-only by default; opt-in to history.** `findByOntologyClass`, `iterate`, and other list-shaped queries filter out entities where `validUntil <= now` by default. Pass `{ includeSuperseded: true }` to see the full history. `getEntity(id)` still resolves any id regardless of active state — explicit lookup is unambiguous. Phase 37 callers that don't pass the new option get the active-only filter; this is a behavioral tightening, not a type break.
- **D-35:** **Single `getSupersessionChain(id)` walks both directions.** Returns `Entity[]` ordered chronologically by `validFrom`, from the origin (earliest entity with no `supersedes`) through the input id to the current tip (no successor). Walks backward via `supersedes` and forward via a reverse index built by the store. One method, predictable shape — satisfies SC#1 "reachable via supersedes chain from query API" without doubling the surface.

### Backfill Mechanics
- **D-36:** **Library function in km-core; per-system scripts invoke it.** km-core exports `backfillEntityDataModel(store, options): Promise<{ scanned, stamped, skipped }>`. Per-system migration scripts (A in `coding/scripts/`, B in `mcp-server-semantic-analysis/scripts/`, C in `rapid-automations/scripts/`) construct their own `GraphKMStore` and call the library function. Centralizes the algorithm without breaking D-06 "library-only" (no bin/ entry in km-core).
- **D-37:** **Missing validFrom = legacy; caller-supplied resolver provides legacyId.** Backfill iterates the store and treats any entity without `validFrom` as legacy. Caller passes `options.resolver: (entity) => { validFrom: string, legacyId?: { system, id } }`. A's resolver: `validFrom = entity.createdAt`, `legacyId` from A's SQLite native id. B's resolver: `validFrom = metadata.firstSeenAt ?? entity.createdAt`, `legacyId` from B's persistence-agent native id (`SharedMemoryEntity.id`). Idempotent: skips entities that already have `validFrom`.
- **D-38:** **Per-entity write + checkpoint file; resumable on crash.** Backfill writes one entity at a time via `store.putEntity` (each is atomic per Phase 37 D-17). A checkpoint file at `<options.checkpointPath ?? '.data/backfill-checkpoint.json'>` records the last successfully stamped id. On crash/restart, the function resumes from the checkpoint. Supports `{ dryRun: true }` — logs what would change without writing. No memory blow-up on 100K+ entity stores. For legacy entities, `createdBy` comes from a synthetic `ProvenanceStamp` the caller supplies via `options.legacyProvenance` (e.g., `{ provider: 'backfill', model: 'phase-39', runId: 'p39-backfill-A', timestamp: <ISO> }`).

### Per-Segment Provenance Writer
- **D-39:** **Helper function in km-core; caller invokes before store write.** km-core exports `mergeDescriptionSegment(entity, newSegment): Entity` — pure function, no side effects. Caller (ingest pipeline) loads the entity, runs the merge helper to fold new text in (appends to existing segment's `confirmations[]` if identical, or pushes a new segment otherwise), then writes via `putEntity`. Store stays simple; merge logic is library-level and unit-testable in isolation. Operates on `entity.metadata.descriptionSegments` per the Phase 37 `DescriptionSegment` JSDoc "Stored in Entity.metadata.descriptionSegments[]".
- **D-40:** **Whitespace-normalized + case-sensitive identical-text test.** `mergeDescriptionSegment` compares `normalize(text) = text.trim().replace(/\s+/g, ' ')` between `newSegment.text` and each existing `segment.text`. Case-sensitive (preserves Code vs code distinction). Matches OKM's prior segment-merging heuristic, deterministic, no LLM call. If a match is found: append `{ runId, provider, model, timestamp }` to that segment's `confirmations[]`. If no match: push the new segment.
- **D-41:** **No hard cap in Phase 39; monitoring only.** Segments and confirmations accumulate freely. Pruning policy is deferred. `mergeDescriptionSegment` emits a `process.stderr.write` warning when any single entity exceeds 100 descriptionSegments OR any single segment's confirmations exceeds 50. We'll revisit pruning once real ingestion data shows whether the warning fires.

### Carrying Forward from Phase 37 + 38 (already locked)
- **CF-D04:** Code lives in `~/Agentic/km-core/` (standalone repo, D-04). Phase 39 modifies `src/store/GraphKMStore.ts`, `src/types/entity.ts` (mark optional fields with stricter JSDoc; do not add fields), and adds `src/backfill/index.ts` + `src/segments/merge.ts`.
- **CF-D06:** ESM-only, `type: module`, NodeNext resolution. All new files use `.js` import extensions.
- **CF-D10:** Writer-side stamping convention (D-10) — Phase 39 extends this to validFrom + provenance, not just UUID.
- **CF-D13:** legacyId structure `{ system: 'A' | 'B' | 'C', id: string }` is the canonical shape.
- **CF-D14:** Options-object pattern for ctor + putEntity. `putEntity(entity, { provenance, ... })` follows the same shape as Phase 37/38.
- **CF-D17:** `batch(ops[])` is atomic, all-or-nothing — supersession's two-write contract uses one batch op.
- **CF-D19:** Strict-by-default ontology validation with `skipOntologyCheck: true` opt-out remains; Phase 39 doesn't widen this.
- **CF-D29:** Atomic-swap idiom (build new state, then assign) — backfill checkpoint write follows the same pattern.
- **no-console-log:** All diagnostic output uses `process.stderr.write(...)`, never `console.*`. Applies to backfill warnings + segment-cap warnings + validUntil-overwrite warning.

### Claude's Discretion
- Internal implementation details (helper file layout, test file structure, ID for the reverse-supersedes index in Graphology, exact JSDoc wording) — the planner picks.
- Whether the backfill checkpoint file is JSON Lines or a single JSON object — planner picks (recommend single JSON object for simplicity unless dataset > 1M entities).
- Exact JSDoc + comment wording, as long as no-console-log holds and CLAUDE.md TypeScript-strict applies.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 39 Inputs
- `.planning/REQUIREMENTS.md` §"Entity data model (DATA)" — DATA-01 (temporal fields), DATA-02 (structured provenance).
- `.planning/ROADMAP.md` §"Phase 39: Entity Data Model" — 4 success criteria (temporal fields + chain query, writer-populated provenance, B `KGEntity` replacement, backfill operation).
- `.planning/PROJECT.md` — core value, evolution rules, project context.

### Phase 37 + 38 (locked decisions to carry forward)
- `.planning/phases/37-km-core-foundation/37-CONTEXT.md` §Decisions D-01..D-23 — repo location, ESM/strict TS, UUIDv7, branded EntityId, GraphKMStore options-object pattern.
- `.planning/phases/37-km-core-foundation/37-VERIFICATION.md` — boundary case BC-2 (`skipOntologyCheck: true` also bypasses `parseEntityId`); preserve in Phase 39.
- `.planning/phases/37-km-core-foundation/37-02-SUMMARY.md` — provenance subtype declarations landed (verbatim from OKM); Phase 39 populates them.
- `.planning/phases/37-km-core-foundation/37-04-SUMMARY.md` — `GraphKMStore` final shape (constructor, putEntity, batch); Phase 39 extends `putEntity` signature with `{ provenance }` option.
- `.planning/phases/38-ontology-registry/38-CONTEXT.md` §Decisions D-26..D-29 + CF-D04..CF-D19 — ontology registry shape, hot-reload semantics; Phase 39's strict-validation calls into the registry but doesn't change its behavior.
- `.planning/phases/38-ontology-registry/38-VERIFICATION.md` — 4 NO-CHANGE constraints to preserve in `GraphKMStore.ts` edits.

### km-core Existing Source (Phase 39 modifies these)
- `~/Agentic/km-core/src/types/entity.ts` — `Entity`, `Relation`, `Layer`, `SerializedGraph`, `ProvenanceStamp`, `EntityProvenance`, `SegmentConfirmation`, `DescriptionSegment`, `ResolutionRecord` — all declared by Phase 37 Plan 02, JSDoc says "Phase 39 populates them against real ingestion runs."
- `~/Agentic/km-core/src/store/GraphKMStore.ts` — Phase 37 Plan 04 (composed in Phase 38 Plan 05 for ontology); Phase 39 extends constructor + putEntity signature + adds `getSupersessionChain`, modifies `findByOntologyClass`/`iterate` default to active-only.
- `~/Agentic/km-core/src/validation/ontology.ts` — Phase 38 Plan 04; Phase 39 doesn't change this.

### OKM (Strict Superset — Adopt Verbatim Where Applicable)
- `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/store/` — OKM's `IngestionPipeline.persistEntity` and observation-merging logic. Researcher should grep for `descriptionSegments` and `confirmationCount` to find OKM's prior implementation of the merge logic Phase 39 lifts into a pure helper.
- `/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/types/entity.ts` — OKM's analog (Phase 37 lifted this verbatim with 4 deltas). Confirm shapes are still aligned.

### Phase 42 Coupling (Phase 39 must enable, not implement)
- `integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts` §`SharedMemoryEntity` (line ~42) — B's dual-shape `id` + `entityType` (Phase 10 race condition source). Phase 39's `Entity` must be expressive enough that Phase 42 can replace `SharedMemoryEntity` without losing fields. Phase 39 does NOT modify this file; it just sanity-checks the canonical type covers everything B needs.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Phase 37 `Entity` type** with all temporal + provenance fields declared optional — Phase 39 populates them at the writer layer, no type-level breakage.
- **Phase 37 `batch(ops[])` atomic op** — supersession's two-write closure (new entity + close old entity's `validUntil`) uses one batch op.
- **Phase 37 `mintEntityId()` + `parseEntityId(s)`** — backfill keeps native ids as `legacyId.id: string` (no v7 validation), stamps new UUIDv7 via `mintEntityId()`.
- **Phase 37 EventEmitter (`entity:put`, `entity:delete`)** — supersession triggers `entity:put` for both old (updated validUntil) and new entities; subscribers see both events.

### Established Patterns
- **Options-object pattern (D-14)** — every new API surface uses `{ option: value }`, no positional args. `putEntity(entity, { provenance })`, `backfillEntityDataModel(store, { resolver, legacyProvenance, dryRun, checkpointPath })`.
- **Writer-side stamping (D-10)** — UUID precedent already applied; validFrom + createdBy follow the same idiom.
- **Atomic-swap idiom (D-29)** — registry reload's "build new map, then assign" pattern reused for backfill checkpoint writes (write to tmp, rename).
- **stderr-warn over console.warn (Phase 38 D-27 spec preservation)** — three new warning sites in Phase 39: validUntil overwrite, segment-cap warning, backfill skip log.

### Integration Points
- `GraphKMStore.putEntity` is the central integration point — almost every Phase 39 decision lands here.
- `GraphKMStore.findByOntologyClass` + `iterate` change default semantics (active-only filter) — Phase 38's tests must continue to pass; verify the filter doesn't fire for entities without validUntil (which is the Phase 37/38 default).
- Backfill function is a new src/ module: `src/backfill/index.ts`. Sub-barrel `src/backfill/index.ts` re-exports `backfillEntityDataModel`. Root barrel `src/index.ts` appends `backfillEntityDataModel` and the `BackfillOptions` / `BackfillResolver` types.
- Segment merge helper is a new src/ module: `src/segments/merge.ts`. Root barrel `src/index.ts` appends `mergeDescriptionSegment`.

</code_context>

<specifics>
## Specific Ideas

- The `ProvenanceStamp` shape is already locked in Phase 37: `{ provider: string, model: string, runId: string, timestamp: string }`. Every Phase 39 writer/test/backfill MUST use this shape unchanged.
- Backfill's `legacyProvenance` ProvenanceStamp uses `provider: 'backfill'` so any downstream observability can filter backfilled-vs-live writes by `createdBy.provider`.
- `getSupersessionChain` returns the chain ordered by `validFrom` ascending; reverse-supersedes index is built on store open (one-time scan) and maintained on every `putEntity` that has `supersedes` set.

</specifics>

<deferred>
## Deferred Ideas

- **Pruning policy for DescriptionSegments / confirmations.** Deferred until real ingestion data shows whether the segment-cap warning fires. Likely belongs in Phase 41 (A's INT) or Phase 42 (B's INT) once we see organic growth.
- **Relation-level temporal fields.** `Relation.validFrom?` / `Relation.validUntil?` already exist on the type (Phase 37). Phase 39 leaves relation supersession unimplemented — relations don't `supersedes` each other in v0.1. Revisit if Phase 42/43 migration shows the need.
- **`ResolutionRecord` populator.** `ResolutionRecord` is declared in Phase 37 entity.ts but only gets populated when entities are merged. That logic belongs in Phase 40 (PIPE-02 post-hoc resolution) or a follow-on dedup phase — out of scope here.
- **B's `SharedMemoryEntity` replacement.** SC#3 reads "no consumer compiles against the old dual shape" — the *replacement* happens in Phase 42 (INT-02 B migration). Phase 39's contribution is verifying that the canonical `Entity` is expressive enough; the actual swap is Phase 42's responsibility.
- **Backfill CLI binary.** D-06 ruled out CLI bins in km-core; per-system migration scripts call the library function. If operator UX needs a unified CLI later, reopen D-06 in a future milestone.

</deferred>

---

*Phase: 39-entity-data-model*
*Context gathered: 2026-05-20*
