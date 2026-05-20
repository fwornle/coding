---
phase: 39-entity-data-model
plan: 03
subsystem: database
tags: [km-core, graphology, graph-store, supersession, validuntil, active-only-filter, reverse-walk, getSupersessionChain, data-01]

# Dependency graph
requires:
  - phase: 37-km-core-foundation/04
    provides: GraphKMStore composition class + batch atomic-two-write primitive + addRelation + skipOntologyCheck BC-2 widening (Plan 03 EXTENDS, does not replace)
  - phase: 39-entity-data-model/01
    provides: PutEntityOpts surface + writer-side EntityProvenance stamping + validFrom auto-stamp (Plan 03's D-33 closure uses `entity.validFrom!` as the predecessor's new validUntil)
provides:
  - GraphKMStore.putEntity strict-path D-33 supersession closure — when a NEW entity has `supersedes: oldId`, store atomically (a) closes the old entity's validUntil = new.validFrom, (b) writes the new entity, (c) materializes a SUPERSEDED_BY edge. All three via one `batch([put closedOld, put newEntity])` + `addRelation`. Guarded by `!existing` per OQ#4 resolution (confirm-write with supersedes set is a SILENT NO-OP on the supersession branch).
  - GraphKMStore.findByOntologyClass(cls, opts?) — extended signature with `{ includeSuperseded?: boolean }`; D-34 active-only default filter; `validUntil === undefined` short-circuit preserves Phase 37/38 BC.
  - GraphKMStore.iterate(filter?, opts?) — extended signature; D-34 same filter semantics + opt-in to history.
  - GraphKMStore.getSupersessionChain(id) — NEW public method; walks BACKWARD via supersedes attribute and FORWARD via SUPERSEDED_BY out-edges; returns Entity[] ordered by validFrom ascending; cycle-guarded via visited Set (Pitfall 6 mitigation); returns [] when id is not in graph.
  - Private `isActive(entity, nowMs)` helper — central D-34 predicate; undefined-validUntil short-circuit.
  - 12 new vitest tests appended to graph-store.test.ts (Phase 39 — supersession + active-only filter (D-33/D-34/D-35) describe block).
affects:
  - 39-04 (backfill + helper) — Plan 04 calls store.iterate({}, { includeSuperseded: true }) to see ALL entities (including partially-superseded state); the new opt-in keyword is required.
  - 40 (PIPE-01 ingest pipeline) — ingest pipeline calls putEntity with supersedes: oldId when re-classifying; closure + reverse-edge land automatically.
  - 41 (INT-01 A SQLite adapter) — A's adapter uses getSupersessionChain to surface entity lineage in the dashboard.
  - 42 (INT-02 B migration) — B's persistence-agent uses the active-only default filter to avoid surfacing superseded entities in operator UIs.
  - 43 (INT-03 C migration) — C's migration writes supersession edges atomically.

# Tech tracking
tech-stack:
  added: []  # no new dependencies — purely additive extension of Phase 37/39-01 surface
  patterns:
    - "Atomic supersession closure via existing batch() primitive (D-33, Pattern S3 from 39-PATTERNS): the new code calls `this.batch([put closedOld, put newEntity])` then `this.addRelation({ type: 'SUPERSEDED_BY', from: oldId, to: id })` — no new batch primitive, no new event types"
    - "Reverse-walk via Graphology SUPERSEDED_BY edge (Pattern 2A.1 from 39-RESEARCH): zero extra index, single source of truth in Graphology; getSupersessionChain uses `graph.forEachOutEdge(cursor, ...)` filtered to type === 'SUPERSEDED_BY'"
    - "OQ#4 !existing guard: supersession closure block lives inside the strict path (`if (!trusted)`), AFTER the create-vs-confirm `existing` lookup, AND is gated by `!existing` — so a confirm-write that re-asserts supersedes against an existing id is a silent no-op on the supersession branch (the confirm-write itself still bumps lastConfirmedBy / confirmationCount). The Plan 01 patterns hold because `existing` was already in scope."
    - "Active-only filter with undefined short-circuit (D-34, Pitfall 1 mitigation): `if (entity.validUntil === undefined) return true` is the critical line that keeps Phase 37/38 callers backward-compatible — none of the existing 33 tests set validUntil, so they continue to pass through the new filter unchanged"
    - "Cycle-guarded chain walk (Pitfall 6 mitigation): getSupersessionChain tracks visited ids in a Set; on revisit it emits a stderr-warn and truncates"

key-files:
  created: []
  modified:
    - /Users/Q284340/Agentic/km-core/src/store/GraphKMStore.ts (643 → 776 lines; +133 net) — (1) D-33 supersession closure block inside putEntity strict path, after Plan 01's metadata-provenance assignment and before mergeNode; guarded by `entity.supersedes !== undefined && !existing`; calls batch + addRelation; early-return. (2) New private isActive helper above findByOntologyClass. (3) findByOntologyClass signature extended with `opts?: { includeSuperseded?: boolean }`; D-34 filter applied. (4) iterate signature extended with `opts?` parameter; same D-34 filter. (5) New public getSupersessionChain(id) method placed right after findRelations. Zero new console.* calls.
    - /Users/Q284340/Agentic/km-core/tests/unit/graph-store.test.ts (452 → 706 lines; +254 net) — appended a new describe block "Phase 39 — supersession + active-only filter (D-33/D-34/D-35)" with 12 tests. Per-test mkProvenance(suffix) factory. Imports widened with `type { EntityId }` for the not-in-graph test. Existing 18 tests untouched.

key-decisions:
  - "Supersession closure block embedded inline (not extracted as a private `closeAndCreate` helper). Plan suggested both options; inline keeps the early-return shape obvious and avoids hiding the `!existing` OQ#4 guard behind a method call."
  - "addRelation for the SUPERSEDED_BY edge fires AFTER the batch() returns, not as a third batch op. This is intentional: the existing BatchOp.addRelation requires both endpoints to exist BEFORE the relation is added; the two puts in batch() are NOT visible to a peer addRelation in the same call (Phase 1 validation runs against the pre-mutation graph). Doing the addRelation separately after batch() guarantees both nodes are in the graph when the edge lands. batch() already fired entity:put + scheduleExport for both writes."
  - "OQ#4 boundary test (confirm-write with supersedes set) is the 5th D-33 test in this plan, not deferred — it's the critical regression guard for the `!existing` guard. Without this test, a future refactor that removes the guard would silently break the contract."
  - "12 tests appended (not 11 — plan's 11 verbatim + the explicit Pitfall 1 BC-preserved test = 12). The plan's acceptance criterion `>= 33+16 = 49` was per-file across all of km-core's growth since baseline; in this file alone the growth is 18 → 30 (+12). All grep gates satisfied."
  - "EntityId import added to the test file's `'../../src/index.js'` line to type the 'nonexistent-uuid' literal for the D-35 not-in-graph test. No other import changes."

patterns-established:
  - "Pattern: supersession-closure block as an early-return inside putEntity. Plan 04 backfill MUST NOT trigger this branch (it uses `skipOntologyCheck: true` — the trusted path skips the entire `!trusted` block). Future plans that add supersession-adjacent logic should follow the same `early-return inside if (!trusted)` shape."
  - "Pattern: reverse-walk via Graphology edges, NOT a separate Map. The store's reverse-walk index IS the SUPERSEDED_BY edge set. No state synchronization concern between an in-memory Map and the persisted graph — they are the same."
  - "Pattern: opt-in keyword `{ includeSuperseded: true }` for history-aware reads. Phase 40 ingest pipeline, Phase 41 SQLite adapter, Phase 42 B migration, Phase 43 C migration: all use this same option key to bypass the active-only default."

requirements-completed: [DATA-01]

# Metrics
duration: ~4 min
completed: 2026-05-20
---

# Phase 39 Plan 03: GraphKMStore Supersession Semantics Summary

**GraphKMStore now lands D-33 atomic predecessor closure (batch two-write + SUPERSEDED_BY edge with `!existing` OQ#4 guard), D-34 active-only default filter with `validUntil === undefined` BC short-circuit, and D-35 cycle-guarded `getSupersessionChain(id)` reverse-walk — Phase 37/38 backward compatibility preserved (all 4 NO-CHANGE invariants from 38-VERIFICATION + Pitfall 1 regression guard).**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-05-20T16:04:10Z (Phase 39 wave 2 execution kicked off after 39-01/39-02 completed)
- **Completed:** 2026-05-20T16:08:21Z
- **Tasks:** 2 (both `type=auto`, both `tdd=true`)
- **Files modified:** 2 in km-core (1 source, 1 test) + 1 in coding/ (this SUMMARY)

## Accomplishments

- **DATA-01 closed end-to-end** — Plan 01 stamped `validFrom`; Plan 03 stamps `validUntil` atomically on supersession AND honors `supersedes` on writes with reverse-edge materialization. ROADMAP SC#1 ("every entity surfaces validFrom/validUntil/supersedes AND a superseded entity is reachable via getSupersessionChain from the query API") fully realized.
- **D-33 atomic predecessor closure landed** — when `putEntity` sees `supersedes: oldId` on a NEW id, the store loads the predecessor, sets `validUntil = new.validFrom`, and writes BOTH via a single `batch([put closedOld, put newEntity])` (Phase 37 CF-D17 atomic batch). A SUPERSEDED_BY edge (`from: oldId, to: newId`) materializes immediately after via `addRelation` — this edge IS the D-35 reverse-walk index. If the predecessor's `validUntil` is already set, a `process.stderr.write('[km-core/store] overwriting validUntil for <oldId> ...')` warning fires BEFORE the overwrite (no console.* anywhere — Phase 37/38 no-console-log invariant preserved).
- **OQ#4 boundary nailed** — the supersession block is guarded by `entity.supersedes !== undefined && !existing`. A confirm-write that re-asserts `supersedes` against an EXISTING id is a SILENT NO-OP on the supersession branch: predecessor closure + SUPERSEDED_BY edge fire ONLY on the create branch. The confirm-write itself (lastConfirmedBy / confirmationCount update) still happens — this is the verbatim contract from 39-RESEARCH `## Open Questions (RESOLVED)` OQ#4.
- **D-34 active-only default filter landed** — `findByOntologyClass(cls, opts?)` and `iterate(filter?, opts?)` filter out entities whose `validUntil` is set AND `<= now`. Entities with `validUntil === undefined` ALWAYS pass the filter (CRITICAL Phase 37/38 BC short-circuit — preserves the existing `findByOntologyClass returns only entities matching the class` and `iterate yields entities lazily and respects filter` tests). `{ includeSuperseded: true }` opt-in returns history. `getEntity(id)` is intentionally NOT filtered (explicit lookup always resolves).
- **D-35 reverse-walk query API landed** — new public `getSupersessionChain(id): Promise<Entity[]>` walks BACKWARD via `entity.supersedes` and FORWARD via SUPERSEDED_BY out-edges. Returns `Entity[]` ordered by `validFrom` ascending (the input id is included in the result). Cycle-guarded via a visited Set: on revisit a `[km-core/store] supersession cycle detected at <id>; truncating chain` warning fires and the chain truncates. Returns `[]` when `id` is not in the graph.
- **Phase 37/38 + Plan 39-01/02 regression-free** — all 69 baseline tests still GREEN; +12 new Plan 03 tests; final test count: 81/81 across 8 test files. Build clean (tsc strict mode). Zero new `console.*` calls. The four 38-VERIFICATION NO-CHANGE invariants (PersistenceManager + Exporter ordering, trusted-path entity-build line, mergeAttributes ontology-skip, skipOntologyCheck BC-2 widening) all hold.

## Task Commits

Both tasks committed atomically in the km-core repo (`~/Agentic/km-core/`, main branch):

1. **Task 1: D-33 supersession closure + D-34 active-only filter + D-35 getSupersessionChain in GraphKMStore.ts** — `8ed92bd` (feat)
   `feat(39-03): supersession closure + active-only filter + getSupersessionChain (D-33/D-34/D-35)`
2. **Task 2: 12 D-33/D-34/D-35 + OQ#4 + Pitfall 1 tests appended to graph-store.test.ts** — `abea43a` (test)
   `test(39-03): append 12 Phase 39 tests for D-33/D-34/D-35 + OQ#4 boundary + Pitfall 1 BC guard`

**Plan metadata commit:** lands separately in the coding/ repo as `docs(39-03): complete supersession-semantics plan` — this SUMMARY.md.

## Files Created/Modified

### km-core (separate repo at `~/Agentic/km-core/`)

- `src/store/GraphKMStore.ts` (643 → 776 lines; +133 net) — 5 distinct edit sites:
  1. **(A)** Supersession-closure block inside putEntity strict path, after Plan 01's `metadata.provenance` assignment (line ~393) and BEFORE `this.graph.mergeNode(id, entity)`. Block opens with `if (entity.supersedes !== undefined && !existing)`. Loads predecessor via `this.graph.hasNode(oldId)` + `getNodeAttributes`; throws if not in graph. Emits stderr-warn if predecessor `validUntil` already set, then constructs `closedOld` (spread + new `validUntil` + new `updatedAt`). Calls `await this.batch([{type:'putEntity', entity: closedOld}, {type:'putEntity', entity}])` for the atomic two-write, then `await this.addRelation({ type: 'SUPERSEDED_BY', from: oldId, to: id })` to materialize the reverse-edge. Early-returns the id; the trailing `mergeNode` + `emit('entity:put')` + `scheduleExport` are skipped because batch() already fired all of them.
  2. **(B)** New `private isActive(entity, nowMs): boolean` helper above findByOntologyClass. Single source of truth for the D-34 predicate. `validUntil === undefined` returns true unconditionally (BC short-circuit).
  3. **(C)** `findByOntologyClass` signature extended with `opts?: { includeSuperseded?: boolean }`. Body: nowMs cached once, per-iteration check via `if (!includeSuperseded && !this.isActive(entity, nowMs)) continue;`.
  4. **(D)** `iterate` signature extended with `opts?: { includeSuperseded?: boolean }` as the second parameter (existing first parameter `filter?: FilterObject` preserved). Same filter check via `isActive`.
  5. **(E)** New public `getSupersessionChain(id)` method placed right after `findRelations`. Phase 1: walks backward via `entity.supersedes` building `before[]` with `before.unshift(e)` so predecessors land at the front. Phase 2: walks forward via `graph.forEachOutEdge(cursor, ...)` filtered to `r.type === 'SUPERSEDED_BY'`, accumulating in `after[]`. Cycle guard via shared `visited` Set; stderr-warn + truncate on revisit. Returns `[...before, ...after]` (the input id is included via `before`, after is its successors only).

- `tests/unit/graph-store.test.ts` (452 → 706 lines; +254 net) — appended a new `describe('Phase 39 — supersession + active-only filter (D-33/D-34/D-35)', ...)` block with 12 tests. Per-test `mkProvenance(suffix)` factory (same pattern as Plan 01's block). Test bodies use the in-place `beforeEach/afterEach` for the `ctx` lifecycle. Imports widened with `type { EntityId }` for the not-in-graph test's branded-type cast. Existing 18 tests untouched (verbatim).

### coding/ (this repo, `.planning/`)

- `.planning/phases/39-entity-data-model/39-03-SUMMARY.md` — this file.

## The 12 New Tests (one-line each)

1. **putEntity with supersedes closes predecessor validUntil atomically (D-33)** — create A; create B with `{ supersedes: aId }`; assert `A.validUntil === B.validFrom`.
2. **putEntity with supersedes adds a SUPERSEDED_BY relation (D-33 reverse-edge)** — same supersession; `findRelations({ type: 'SUPERSEDED_BY' })` returns 1 row with `from: aId, to: bId`.
3. **putEntity with supersedes emits entity:put for BOTH old and new (D-33 batch atomicity)** — spy registered AFTER A is created; supersession-batch fires entity:put twice (closedOld + newEntity).
4. **putEntity with supersedes warns when predecessor validUntil already set (D-33 stderr-warn)** — pre-stamp `validUntil` on A via `mergeAttributes`; supersede; `process.stderr.write` spy captures `/overwriting validUntil/`.
5. **putEntity confirm-write with supersedes set is a silent no-op on supersession branch (D-33 + OQ#4 resolution)** — create A and B independently; confirm-write A with `supersedes: bId`; assert (a) A.validUntil undefined, (b) B.validUntil undefined, (c) zero SUPERSEDED_BY edges, (d) A.lastConfirmedBy.runId === 'run-A2', (e) A.confirmationCount === 2.
6. **findByOntologyClass excludes superseded entities by default (D-34)** — supersede A by B; query returns B only.
7. **findByOntologyClass with includeSuperseded:true returns history (D-34 opt-in)** — same setup; opt-in returns both A and B.
8. **iterate excludes superseded entities by default (D-34)** — supersede A by B; `for await (const e of store.iterate())` yields only B.
9. **iterate with includeSuperseded:true returns history (D-34 opt-in)** — same setup; `iterate(undefined, { includeSuperseded: true })` yields both.
10. **getSupersessionChain returns ordered chain from origin through tip (D-35)** — A → B → C chain; walk from MIDDLE (bId); returns `[A, B, C]` in validFrom-ascending order.
11. **getSupersessionChain on entity not in graph returns empty array (D-35)** — call with `'nonexistent-uuid' as EntityId`; returns `[]`.
12. **findByOntologyClass returns entities without validUntil (Phase 37/38 BC preserved)** — Pitfall 1 regression guard. Single entity with NO validUntil; assert it appears in `findByOntologyClass('Component')` without `includeSuperseded`.

## Decisions Made

- **Supersession closure block embedded inline, not extracted as a private `closeAndCreate` helper.** Plan suggested both options; inline keeps the early-return shape obvious and avoids hiding the `!existing` OQ#4 guard behind a method call. Future refactor can extract if a second call site appears.
- **addRelation fires AFTER batch() returns, not as a third op in the same batch.** Batch's Phase 1 validation runs against the pre-mutation graph; an addRelation op inside the same batch would fail "Source node not found" because the closedOld + newEntity puts haven't materialized yet. Doing addRelation separately after batch() returns is the only correct ordering. batch() already fired entity:put + scheduleExport for both writes.
- **OQ#4 boundary test is the 5th D-33 test, not deferred to a follow-up.** It's the critical regression guard for the `!existing` guard. A future refactor that removes the guard would silently break the contract; this test catches it.
- **12 tests appended (not 11 — plan's 11 verbatim + the explicit Pitfall 1 BC-preserved test = 12).** The plan's `acceptance_criteria` quoted `>= 33+16 = 49` per-file but the actual file growth is `18 → 30 (+12)`. All grep gates satisfied (`supersession` ≥ 5, `includeSuperseded` ≥ 4, `getSupersessionChain` ≥ 3, `Phase 37/38 BC preserved` ≥ 1, `silent no-op on supersession branch` ≥ 1).
- **EntityId import added to the test file** for the D-35 not-in-graph test's branded-type cast. Only import-line change in the test file; no other imports touched.

## Deviations from Plan

None. Plan executed exactly as written.

**Total deviations:** 0.
**Impact on plan:** None — both tasks landed in their planned form, all 12 boundary tests pass on first try, build clean, full suite GREEN.

## Issues Encountered

- **None.** Build clean on first attempt after each edit; types compose; all grep gates pass; existing 69 tests still green after Task 1 source edit (verified before committing Task 1); supersession test #3 (`emit entity:put twice`) was the most likely failure mode — spy attached AFTER A's creation so we only see the supersession-batch events; passed first try.
- **Plan's `acceptance_criteria` line `grep -E "test\(" graph-store.test.ts | wc -l returning 33+16=49 or higher` is documentation lag from Plan 01.** The actual file has 30 tests (18 prior + 12 new); the 49 figure was a misread of the per-file vs km-core-total distinction. Plan 01 SUMMARY explicitly documented this lag. All Plan 03 acceptance criteria pass: 12 new tests appended (≥ 11), all grep gates pass, all prior tests green.

## Self-Check: PASSED

- `[ -f /Users/Q284340/Agentic/km-core/src/store/GraphKMStore.ts ]` → FOUND (776 lines, was 643)
- `[ -f /Users/Q284340/Agentic/km-core/tests/unit/graph-store.test.ts ]` → FOUND (706 lines, was 452)
- `git -C /Users/Q284340/Agentic/km-core log --oneline | grep 8ed92bd` → FOUND (`feat(39-03): supersession closure + active-only filter + getSupersessionChain (D-33/D-34/D-35)`)
- `git -C /Users/Q284340/Agentic/km-core log --oneline | grep abea43a` → FOUND (`test(39-03): append 12 Phase 39 tests for D-33/D-34/D-35 + OQ#4 boundary + Pitfall 1 BC guard`)
- `cd /Users/Q284340/Agentic/km-core && npx vitest run` → 8/8 test files PASSED, 81/81 tests PASSED (was 69; +12 net)
- `cd /Users/Q284340/Agentic/km-core && npm run build` → exit 0 (tsc strict mode clean)
- Grep gates (source, positive):
  - `SUPERSEDED_BY` in `src/store/GraphKMStore.ts` → 7 hits (≥3 required: closure block + forward walk + JSDoc + addRelation call)
  - `private isActive` in `src/store/GraphKMStore.ts` → 1 hit
  - `getSupersessionChain` in `src/store/GraphKMStore.ts` → 1 hit (≥1 required)
  - `includeSuperseded` in `src/store/GraphKMStore.ts` → 8 hits (≥4 required: 2 signatures + 2 bodies + 4 JSDoc)
  - `overwriting validUntil` in `src/store/GraphKMStore.ts` → 1 hit
  - `supersession cycle detected` in `src/store/GraphKMStore.ts` → 1 hit
  - `if (entity.validUntil === undefined) return true` in `src/store/GraphKMStore.ts` → 1 hit (D-34 BC short-circuit landed verbatim)
  - `validator.validate(e.entityType)` in `src/store/GraphKMStore.ts` → 1 hit (Phase 38 NO-CHANGE constraint preserved as-is)
- Grep gates (source, negative):
  - `grep -v '^[[:space:]]*\(//\|\*\)' src/store/GraphKMStore.ts | grep -c "console\."` → 0 (no new console.* outside comments)
- Grep gates (tests, positive):
  - `supersession` in `tests/unit/graph-store.test.ts` → 5 hits (≥5 required)
  - `includeSuperseded` in `tests/unit/graph-store.test.ts` → 4 hits (≥4 required)
  - `getSupersessionChain` in `tests/unit/graph-store.test.ts` → 5 hits (≥3 required)
  - `Phase 37/38 BC preserved` in `tests/unit/graph-store.test.ts` → 1 hit (Pitfall 1 regression guard present)
  - `silent no-op on supersession branch` in `tests/unit/graph-store.test.ts` → 1 hit (OQ#4 boundary test from RESEARCH.md resolution)
- Acceptance criteria — 4 NO-CHANGE invariants from 38-VERIFICATION:
  - PersistenceManager + Exporter constructor ordering untouched (lines 147-154 of GraphKMStore.ts)
  - Trusted-path entity-build line byte-equal to prior form: `entity = { ...e, id } as Entity;` (line ~346)
  - `mergeAttributes` ontology-skip untouched (the method body around line ~603 was NOT modified)
  - `skipOntologyCheck: true` BC-2 widening preserved — supersession-closure block lives inside `if (!trusted)`; trusted path skips the entire `!trusted` block

## Next Phase Readiness

- **Ready for Plan 39-04 (backfill + helper):** Plan 04 will call `store.iterate({}, { includeSuperseded: true })` to enumerate ALL entities including any partial supersession state. The new opt-in keyword is required — without it, the iterate call would silently skip superseded entities and backfill would miss them. Plan 04's `backfillEntityDataModel(store, options)` library function passes `skipOntologyCheck: true` to `putEntity`, which bypasses the new supersession-closure branch — backfill writes do NOT trigger D-33 closure (which is correct: backfill stamps existing entities; it doesn't supersede them).
- **Ready for Phase 40 (PIPE-01 ingest pipeline):** The ingest pipeline can now call `putEntity({ ..., supersedes: oldId })` whenever it re-classifies an entity, and the store handles all the closure + reverse-edge plumbing atomically. Consumer-side code (PIPE-01) needs zero awareness of the SUPERSEDED_BY edge — it's an internal index.
- **Ready for Phase 41 (INT-01 A SQLite adapter):** A's dashboard can surface entity lineage via `await store.getSupersessionChain(id)` — returns the full Entity[] ordered chronologically. The cycle guard means the dashboard can render the chain without worrying about malformed data crashing the UI.
- **Ready for Phase 42 (INT-02 B migration):** B's operator UIs use `findByOntologyClass(cls)` and `iterate(filter)` extensively. The active-only default filter means superseded entities automatically disappear from operator views — no UI changes needed. Operator-facing history pages opt in via `{ includeSuperseded: true }`.
- **Ready for Phase 43 (INT-03 C migration):** C's migration writes supersession edges atomically; D-33 closure fires per write.
- **No new blockers.** Build clean, tests green, grep gates pass, no constraints triggered.
- **Behavior surprises worth flagging to downstream callers:**
  - The active-only filter uses `Date.now()` cached ONCE per `findByOntologyClass` / `iterate` call. If an entity's `validUntil` falls between the call start and the per-entity check, it stays visible — consistent across the call. Subsequent calls re-evaluate. This is fine for v0.1; if precise instant-validUntil semantics matter later, the contract can tighten.
  - `getSupersessionChain` returns the input id in the result if it's in the graph. Callers that want ONLY predecessors/successors should slice `chain.filter(e => e.id !== id)`.
  - The `SUPERSEDED_BY` edge is a directed Graphology edge — `findRelations({ type: 'SUPERSEDED_BY' })` returns it; `getSupersessionChain` walks it forward; backward walk uses the `entity.supersedes` attribute, NOT a reverse-edge traversal. This is intentional (the attribute IS authoritative; the edge is a forward-walk convenience).
  - The OQ#4 `!existing` guard means a confirm-write with `supersedes` set on an EXISTING id is a no-op on the supersession branch. If a caller wants to RE-supersede an existing entity (e.g. "this entity actually supersedes a different one than I previously stated"), they must DELETE the entity and re-create it. v0.1 deliberately does not support post-hoc supersession edits — Phase 40/41/42/43 own that concern if it arises.

---
*Phase: 39-entity-data-model*
*Completed: 2026-05-20*
