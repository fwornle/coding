---
phase: 41-online-learning-adapter-post-hoc-resolution
plan: 05
subsystem: km-core/maintenance
tags: [pipe-02, atomic-merge, supersession, edge-rewire, segment-fold, wr-02]
requires:
  - Phase 37 D-17 atomic batch (store.batch)
  - Phase 39 D-33 supersession closure (SUPERSEDED_BY edges)
  - Phase 39 D-39 mergeDescriptionSegment helper
  - Phase 39 CR-01 per-op BatchOp.skipOntologyCheck widening
  - Phase 41 Plan 03 GraphKMStore.getDegree (already shipped; consumed by Plan 06, not this plan)
provides:
  - "@fwornle/km-core/maintenance#mergeEntities atomic merge primitive (D-50)"
  - "MergeOptions / MergeResult types (CF-D14 options-object signature)"
affects:
  - Plan 06 (resolveEntities) — direct consumer of mergeEntities per surfaced LLM match
  - Phase 42 (B migration) — will delete deduplication.ts mergeEntityGroup in favor of this primitive (D-50a)
  - Phase 43 (C migration) — will delete local mergeEntityGroup in favor of this primitive (D-50a)
tech-stack:
  added: []
  patterns:
    - D-33 supersession-closure atomic-two-write (closed-duplicate + SUPERSEDED_BY edge per duplicate)
    - OKM migrateEdges pattern (deduplicator.ts:910-933) translated to BatchOp shapes
    - CF-D39 mergeDescriptionSegment per-segment fold accumulated across duplicates
    - CF-D14 options-object signature; top-level free function (NO class) per CF-D36
    - Edge-enumeration dedupe via Set<string> identity key (from|to|type|createdAt)
    - WR-02 pre-flight check (error message text matches GraphKMStore.ts:440-450 verbatim)
    - CR-01 per-op skipOntologyCheck:true on every putEntity BatchOp
    - process.stderr.write diagnostics; no console.*
key-files:
  created:
    - /Users/Q284340/Agentic/km-core/src/maintenance/mergeEntities.ts
    - /Users/Q284340/Agentic/km-core/tests/unit/maintenance/mergeEntities.test.ts
  modified: []
decisions:
  - "ResolutionRecord shape compromise: preserved existing 4-field shape (mergedEntityId, mergedEntityName, ontologyClass, timestamp) from entity.ts:101-111 AND added plan-mandated audit enrichment (mergedAt, mergedBy ProvenanceStamp, optional mergedReason). Legacy C-fixture consumers continue to work; plan's CF-D30 audit-trail requirement also satisfied."
  - "edgesRewired counts rewired-with-replacement edges only. Self-loops after rewire are removed without replacement and do NOT bump the counter — counting them would mis-report what landed in the graph (Test B and Test K pin this)."
  - "Per-op skipOntologyCheck:true on the closed-duplicate write deliberately preserves the duplicate's original provenance (D-32 strict-path auto-assembly is bypassed on the trusted path). The duplicate is HISTORICAL after merge; its createdBy must stay accurate."
metrics:
  duration: "~5min wall-clock (planning agent had pre-loaded the full investigation)"
  completed: "2026-05-22T15:50:34Z"
---

# Phase 41 Plan 05: Atomic mergeEntities Primitive Summary

Atomic `mergeEntities(store, survivorId, duplicateIds, opts)` library function under `@fwornle/km-core/maintenance` — collapses N duplicate entities into a survivor in a single `store.batch([...])` call (CF-D17), enforcing WR-02 single-successor invariant, preserving edge type+metadata verbatim on rewire, and folding duplicate `descriptionSegments[]` into the survivor via Phase 39's `mergeDescriptionSegment` helper.

## What Shipped

- **`src/maintenance/mergeEntities.ts`** (~378 LoC) — single exported function plus `MergeOptions` and `MergeResult` types. Module-private helper `edgeIdentityKey()` for from-side+to-side query dedup.
- **`tests/unit/maintenance/mergeEntities.test.ts`** (~480 LoC) — 11 behavioral tests (A–K) against a real `GraphKMStore` + tmpdir LevelDB; no mocks.

## Atomic Merge Contract (D-50 four-step primitive in ONE batch)

For each duplicate `dup`:

1. **Close duplicate** — `BatchOp.putEntity({ ...dup, validUntil: oldValidUntil, updatedAt: oldValidUntil }, skipOntologyCheck:true)`.
2. **Forward SUPERSEDED_BY edge** — `BatchOp.addRelation({ type: 'SUPERSEDED_BY', from: dup.id, to: survivor.id, createdAt: oldValidUntil, validFrom: oldValidUntil })`.
3. **Edge rewires** — enumerate via `findRelations({ from: dup.id })` + `findRelations({ to: dup.id })`, dedupe by `(from|to|type|createdAt)` identity key, then for each unique edge: if rewire-target `newFrom === newTo` (self-loop) emit ONLY `removeRelation`; else emit BOTH `removeRelation` + `addRelation` with endpoint swap. Edge.type and edge.metadata preserved verbatim.
4. **Segment fold (default `mergeSegments:true`)** — per-segment `mergeDescriptionSegment(mergedSurvivor, segment)`; accumulate the running `mergedSurvivor` across all duplicates so each fold sees the prior fold's segments.

Then one final survivor write:

5. **`BatchOp.putEntity(finalSurvivor, skipOntologyCheck:true)`** — bumped `confirmationCount` (+ `duplicateIds.length`), updated `lastConfirmedBy`, appended `resolutionHistory` records (one per duplicate).

Single `store.batch(ops)` covers ALL steps atomically (CF-D17).

## Pre-flight Guards (throw fast before any mutation)

| Check | Error |
|-------|-------|
| `duplicateIds.length === 0` | `mergeEntities: duplicateIds must be non-empty` |
| `duplicateIds.includes(survivorId)` | `mergeEntities: survivor <id> cannot be in duplicateIds` |
| `getEntity(survivorId) === undefined` | `mergeEntities: survivor <id> not found` |
| `getEntity(dupId) === undefined` | `mergeEntities: duplicate <id> not found` |
| Any dup has SUPERSEDED_BY out-edge | `Entity <dupId> already has a successor — cannot supersede twice (WR-02 single-successor invariant)` |

The WR-02 error message text is intentionally identical to `GraphKMStore.ts:440-450` so callers can pattern-match on one error string regardless of which entry point raised it.

## Edge Enumeration Dedupe (catches a real bug)

`findRelations({ from: dup.id })` AND `findRelations({ to: dup.id })` BOTH return any edge where `from === to === dup.id` (self-loop). Without identity-key dedup, the same self-loop would emit two `removeRelation` BatchOps and double-count in `edgesRewired`.

The dedup uses a `Set<string>` of identity keys `${from}|${to}|${type}|${createdAt ?? ''}`. Test K seeds a `D1->D1` self-loop and asserts:

- `result.edgesRewired === 0` (self-loop has no replacement).
- No `S->S` edge created.
- Original `D1->D1` edge is gone from the graph.

## ResolutionRecord Shape (backwards-compatible enrichment)

The existing `ResolutionRecord` type at `src/types/entity.ts:101-111` declares four fields: `mergedEntityId`, `mergedEntityName`, `ontologyClass`, `timestamp`. The C-fixture snapshots (`tests/fixtures/c-*-snapshot.json`) already carry records in this shape.

The plan called for a richer record with `mergedAt`, `mergedBy: ProvenanceStamp`, and optional `mergedReason`. To satisfy BOTH the existing type contract AND the plan's audit-trail enrichment, each record carries:

```ts
{
  // Legacy 4-field shape (satisfies ResolutionRecord interface)
  mergedEntityId: String(dup.id),
  mergedEntityName: dup.name,
  ontologyClass: dup.ontologyClass ?? dup.entityType,
  timestamp: oldValidUntil,
  // Plan-mandated enrichment (CF-D30 audit trail)
  mergedAt: oldValidUntil,
  mergedBy: opts.provenance,
  ...(opts.reason ? { mergedReason: opts.reason } : {}),
}
```

This is a strict superset — legacy consumers reading the 4-field projection continue to work without modification.

## Test Results

- **22 test files / 192 tests** pass (baseline 20/180 + 1 new test file + 11 new tests + smoke test deleted post-GREEN).
- **Strict tsc clean** (`npx tsc --noEmit` exits 0).
- Zero `console.*` calls in either file.
- All relative imports use `.js` suffix (CF-D06).

| Test | Behavior pinned |
|------|-----------------|
| A | Happy path: closes duplicates, adds SUPERSEDED_BY, rewires 3 edges, appends 2 resolutionHistory records, bumps confirmationCount by 2 |
| B | Self-loop guard: pre-existing D1->S edge dropped without replacement on rewire |
| C | Edge type+metadata preserved verbatim (weight=0.85, label='test', type='custom-edge-type') |
| D | WR-02: pre-existing SUPERSEDED_BY on D1->Z causes throw; D1.validUntil stays undefined |
| E | Survivor not found throws |
| F | Survivor in duplicateIds throws |
| G | Empty duplicateIds throws |
| H | Segment fold: 3 distinct segments end up on survivor; segmentsMerged===2 |
| I | mergeSegments:false: survivor keeps only its own segments; segmentsMerged===0 |
| J | Idempotent re-call: WR-02 fires on second merge (D1 now has SUPERSEDED_BY to S) |
| K | Duplicate self-loop dedupe (D1->D1): no S->S created, edgesRewired===0, original gone |

## Acceptance Criteria Verification

Task 1 (`mergeEntities.ts`):

| Criterion | Result |
|-----------|--------|
| `grep -c "export async function mergeEntities"` | 1 |
| `grep -cE "store\\.batch\\("` | 4 (1 call site + 3 JSDoc references — intent satisfied: ONE atomic batch call) |
| `grep -c "skipOntologyCheck: true"` | 5 (every putEntity BatchOp + spec doc lines) |
| `grep -c "WR-02 single-successor invariant"` | 2 (error throw + JSDoc) |
| `grep -c "mergeDescriptionSegment"` | 4 (import + invocation + docs) |
| `grep -c "resolutionHistory"` | 6 |
| `grep -c "SUPERSEDED_BY"` | 10 (one per duplicate addRelation + docs) |
| Edge dedupe marker present (`Set<string>`/`seenEdges`) | 7 occurrences |
| `console.*` calls | 0 |
| Relative imports missing `.js` suffix | 0 |
| `npx tsc --noEmit` | exits 0 |

Task 2 (`mergeEntities.test.ts`):

| Criterion | Result |
|-----------|--------|
| `grep -c "test("` | 11 (≥ 11 ✓) |
| `grep -c "WR-02 single-successor"` | 5 (≥ 1 ✓) |
| `grep -c "resolutionHistory"` | 2 (≥ 1 ✓) |
| `grep -c "edgesRewired"` | 5 (≥ 1 ✓) |
| Self-loop coverage markers | 12 (≥ 1 ✓) |
| `console.*` calls | 0 |
| Full vitest suite | 22 files / 192 tests, all green |

## Must-Haves Verification

- [x] `mergeEntities(store, survivorId, duplicateIds, opts): Promise<MergeResult>` is a top-level library function in `src/maintenance/`. Sub-barrel + package.json export-map land in Plan 06 per plan-frontmatter.
- [x] All merge operations land atomically in a single `store.batch([...])` call (CF-D17). Test A asserts atomicity end-to-end by checking all post-conditions after one merge call.
- [x] WR-02 single-successor invariant enforced — pre-flight check throws before mutation. Test D pins the error-message text AND the no-mutation contract.
- [x] Self-loop guard — Test B (pre-existing D1->S edge) and Test K (D1->D1 self-loop) both assert no self-loop on survivor.
- [x] Edge type+metadata preserved verbatim — Test C asserts `type === 'custom-edge-type'`, `metadata.weight === 0.85`, `metadata.label === 'test'`.
- [x] Edges deduplicated by `(from, to, type, createdAt)` identity key — Test K pins this directly.
- [x] `mergeEntities` is reusable by Phase 42 (B migration) and Phase 43 (C migration). The function takes only `(store, survivorId, duplicateIds, opts)` — no system-specific assumptions, no A-specific code paths.

## Commits (in km-core repo)

| Hash | Type | Subject |
|------|------|---------|
| 74fb5fc | test(41-05) | add failing smoke test for mergeEntities primitive (RED gate) |
| 6e0ec37 | feat(41-05) | atomic mergeEntities primitive |
| bc9eec0 | test(41-05) | comprehensive behavioral suite for mergeEntities |

## Deviations from Plan

### Auto-handled (Rule 1/2 inline)

1. **[Rule 2 — backwards compatibility] ResolutionRecord shape harmonization**
   - **Found during:** Task 1 implementation, after reading existing `src/types/entity.ts:101-111`.
   - **Issue:** The plan describes a `ResolutionRecord` with fields `{ mergedEntityId, mergedAt, mergedBy, mergedReason? }`, but the existing `ResolutionRecord` interface declares `{ mergedEntityId, mergedEntityName, ontologyClass, timestamp }` and is already in use by C-system snapshot fixtures (e.g., `tests/fixtures/c-general-snapshot.json` lines 18934+).
   - **Fix:** Emit a strict superset — every record carries BOTH the legacy 4-field shape (so the existing interface is satisfied and legacy consumers continue to work) AND the plan-mandated audit enrichment (`mergedAt`, `mergedBy`, optional `mergedReason`). No type modification required; `entity.metadata.resolutionHistory` is typed as `Record<string, unknown>` at the metadata-key level.
   - **Files modified:** `src/maintenance/mergeEntities.ts` (the merge function's record construction).
   - **Commit:** 6e0ec37.

No Rule 3 blocking-issue fixes, no Rule 4 architectural escalations. Authentication gates: none — this is a pure library function.

## Threat Surface Scan

No new external surface introduced. `mergeEntities` operates entirely against the in-process `GraphKMStore` via existing public methods (`getEntity`, `findRelations`, `batch`); no new network endpoints, no file-system writes outside the store's own LevelDB + JSON export paths (which are unchanged). The threat register in PLAN.md (T-41-05-01 through T-41-05-09) is fully addressed:

| Threat ID | Status |
|-----------|--------|
| T-41-05-01 (non-atomic merge → dangling edges) | mitigated — single `store.batch([...])`; Test A asserts end-to-end post-conditions |
| T-41-05-02 (concurrent merges) | accepted per plan — single Node.js writer |
| T-41-05-03 (caller-controlled ProvenanceStamp) | mitigated — caller supplies; no minting inside mergeEntities |
| T-41-05-04 (segment-fold leak) | accepted per plan — IS the intended D-39 behavior |
| T-41-05-05 (repudiation) | mitigated — resolutionHistory records per duplicate (Test A asserts) |
| T-41-05-06 (DoS via large edge sets) | accepted per plan — defer chunking |
| T-41-05-07 (WR-02 violation slips through) | mitigated — pre-flight check; Test D pins |
| T-41-05-08 (self-loop double-removal corrupts batch) | mitigated — identity-key dedupe; Test K pins |
| T-41-05-09 (npm install) | mitigated — zero new dependencies |

## Self-Check: PASSED

- File `/Users/Q284340/Agentic/km-core/src/maintenance/mergeEntities.ts` exists.
- File `/Users/Q284340/Agentic/km-core/tests/unit/maintenance/mergeEntities.test.ts` exists.
- Commits 74fb5fc, 6e0ec37, bc9eec0 visible in `git log` on `main` of km-core repo.
- Full `npx vitest run` green: 22 files, 192 tests.
- `npx tsc --noEmit` exits 0.
