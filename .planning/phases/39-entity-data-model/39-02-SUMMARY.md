---
phase: 39-entity-data-model
plan: 02
subsystem: database
tags: [km-core, segments, provenance, description-segments, segment-merge, whitespace-normalize, pure-function, data-02]

# Dependency graph
requires:
  - phase: 37-km-core-foundation/02
    provides: DescriptionSegment + SegmentConfirmation type declarations (intentionally empty — populated by Phase 39)
  - phase: 39-entity-data-model/01
    provides: PutEntityOpts surface + writer-side EntityProvenance stamping (Plan 02 is independent of putEntity, but lives in the same DATA-02 requirement)
provides:
  - mergeDescriptionSegment(entity, newSegment): Entity — pure helper that folds new description text into entity.metadata.descriptionSegments[]
  - D-40 whitespace-normalized + case-sensitive identical-text test (text.trim().replace(/\s+/g, ' '))
  - D-41 monitoring (stderr-warn at >100 segments OR >50 confirmations — no hard cap; pruning policy deferred)
  - Sub-barrel src/segments/index.ts (mirrors Phase 38 src/ontology/ convention)
  - Root barrel src/index.ts append (Plan 04 backfill exports will append AFTER per Plan 02's design)
  - 8 new vitest tests covering D-40 boundary cases a/b/c/e/g, D-41 monitoring thresholds, D-39 purity
affects:
  - 39-04 (backfill + helper) — root barrel append order locked: Plan 02's export comes first, Plan 04 appends after (Plan 04 will add backfillEntityDataModel + BackfillOptions/BackfillResolver/BackfillResult)
  - 40 (PIPE-01 ingest pipeline) — first real caller; pipeline loads entity, calls mergeDescriptionSegment(entity, newSegment), then writes via store.putEntity(entityWithMergedSegment, { provenance })
  - 42 (INT-02 B migration) — B's persistence-agent will call this helper as it replaces the SharedMemoryEntity shape with the canonical Entity

# Tech tracking
tech-stack:
  added: []  # no new dependencies — pure TS helper, zero runtime deps
  patterns:
    - "Pure-function helper with deep-cloned return (D-39): callers cannot accidentally rely on identity; map+spread idiom clones segments and confirmations[] arrays so all mutations land on the returned entity"
    - "Whitespace-normalize + case-sensitive identical-text test (D-40): one normalize() function inside the module; text.trim().replace(/\\s+/g, ' ') matches NBSP + ideographic space via JavaScript \\s class while preserving Code vs code"
    - "stderr-warn over console.warn (no-console-log): D-41 monitoring writes to process.stderr.write with the [km-core/segments] prefix, mirroring src/store/exporter.ts:112"
    - "Sub-barrel + root barrel re-export (CF-D06 ESM .js suffix): src/segments/index.ts mirrors Phase 38's src/ontology/index.ts; root barrel append leaves Plan 04 backfill exports room AFTER (success criterion)"
    - "Test fixture helpers (mkEntity + mkSegment): test-local builders with override partials — same shape as Plan 01's per-test mkProvenance(suffix) factory, scaled to entity + segment construction"

key-files:
  created:
    - /Users/Q284340/Agentic/km-core/src/segments/merge.ts (140 lines) — exports mergeDescriptionSegment(entity, newSegment): Entity; private normalize() helper; D-40 + D-41 + D-39 baked in.
    - /Users/Q284340/Agentic/km-core/src/segments/index.ts (10 lines) — sub-barrel re-exports mergeDescriptionSegment via './merge.js' (CF-D06 ESM suffix).
    - /Users/Q284340/Agentic/km-core/tests/unit/segments-merge.test.ts (241 lines) — 8 boundary tests in one describe block.
  modified:
    - /Users/Q284340/Agentic/km-core/src/index.ts (69 → 77 lines; +8 net) — APPENDED `export { mergeDescriptionSegment } from './segments/merge.js';` after the Phase 38 ontology exports, with a JSDoc-style comment block per Phase 37/38 convention. Plan 04 will append backfill exports AFTER this line (root barrel order preserved).

key-decisions:
  - "Single normalize() function inside src/segments/merge.ts (no public export, no shared util module) — D-40 says 'one source of truth' but only one consumer exists today. Promoting normalize() to src/utils/* would be premature; if a second normalizer-consumer ever appears, the planner picks the right home then."
  - "Test-local mkEntity + mkSegment builders (NOT exported, NOT in tests/helpers/) — Phase 37/38 follow the same convention (per-test factories at file-top scope). Keeps test-file self-contained; reviewers can scan the whole behavior in one screen."
  - "stderr-warn message format mirrors src/store/exporter.ts:112 — `[km-core/segments] entity <id> ...` with the monitoring suffix '(>N, monitoring per D-41)' baked into BOTH branches (segments and confirmations). This lets ops dashboards grep for '/monitoring per D-41/' to surface both."
  - "Plan 04 backfill exports will append AFTER Plan 02's mergeDescriptionSegment export — root barrel order is success criterion. Plan 02's export sits at line 76; Plan 04 will add backfillEntityDataModel + type exports starting at line 78."
  - "Did NOT add `process.stderr.write` ALSO when a fresh segment-push lands the count at exactly 100 — D-41 says '>100', not '>=100'. The threshold is the strict-greater interpretation, matching the verify-block /has 101 descriptionSegments \\(>100/ regex."

patterns-established:
  - "Pure helper pattern: takes whole Entity (not segments array) so caller doesn't need to know the metadata key; returns new Entity (deep-cloned segments + confirmations) so callers cannot rely on identity. Future segment-related helpers (Phase 40 ingest pipeline post-merge) follow the same shape."
  - "Whitespace normalization formula (text.trim().replace(/\\s+/g, ' ')) is the canonical D-40 identical-text test for this codebase — Phase 40 ingest pipeline and Phase 42 B migration MUST use the same normalize() (not their own ad-hoc variants)."
  - "D-41 monitoring threshold style: stderr-warn at >100 segments AND >50 confirmations. No hard cap. Mirrors the 'monitoring before enforcement' pattern (revisit once real ingestion data shows whether the warning fires)."

requirements-completed: []
requirements-progress:
  - id: DATA-02
    plan-share: "per-segment provenance writer half (DescriptionSegment.confirmations[] population)"
    note: "Plan 01 covered createdBy / lastConfirmedBy / confirmationCount (entity-level provenance via putEntity); Plan 02 covers descriptionSegments[i].confirmations[] (per-segment provenance via the helper). DATA-02 will be marked complete when Plan 04 lands backfill + the end-to-end requirement check in 39-VERIFICATION runs green."

# Metrics
duration: ~4 min
completed: 2026-05-20
---

# Phase 39 Plan 02: mergeDescriptionSegment Pure Helper Summary

**`mergeDescriptionSegment(entity, newSegment): Entity` ships as a pure library helper in `src/segments/merge.ts` per D-39/D-40/D-41 — whitespace-normalized + case-sensitive identical-text test, deep-cloned return for purity, stderr-warn (no console.*) at the 100-segments / 50-confirmations monitoring thresholds.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-05-20T17:55:33Z (immediately after Plan 39-01 landed)
- **Completed:** 2026-05-20T18:00:18Z
- **Tasks:** 2 (both `type=auto`, both `tdd=true`)
- **Files modified:** 4 in km-core (3 new + 1 modified root barrel) + 1 in coding/ (this SUMMARY)

## Accomplishments

- **Per-segment provenance writer half of DATA-02 closed at the library layer** — `mergeDescriptionSegment` is the single, unit-testable merge-or-confirm primitive. Phase 40 (ingest pipeline) and Phase 42 (B migration) will both call it BEFORE `store.putEntity` to fold new text into `entity.metadata.descriptionSegments[]`, with append-confirmation on whitespace-normalized identical text or push-new-segment on miss.
- **D-40 whitespace normalization landed verbatim** — `text.trim().replace(/\s+/g, ' ')` is the canonical formula (one source of truth inside the module). Case-sensitive: `'Code'` and `'code'` stay distinct. Cross-script: NBSP (U+00A0) and ideographic space (U+3000) collapse to ASCII space via JavaScript's `\s` class.
- **D-39 pure function contract enforced** — input entity reference is NEVER mutated; returned entity has a new metadata object AND a new descriptionSegments array AND deep-cloned confirmations[] arrays. Verified by the purity test: `JSON.stringify(entity) === JSON.stringify(before)` AND `Object.is(result, entity) === false` AND `Object.is(result.metadata, entity.metadata) === false` AND `Object.is(newSegments, origSegments) === false`.
- **D-41 monitoring at the 100 / 50 thresholds** — `process.stderr.write` (no `console.*`) fires when the segments array exceeds 100 OR when a matched segment's confirmations exceed 50. No hard cap; pruning policy deferred per CONTEXT.md. Message format mirrors `src/store/exporter.ts:112` — `[km-core/segments] entity <id> has N descriptionSegments (>100, monitoring per D-41)\n`.
- **Sub-barrel + root barrel re-exports landed** — `src/segments/index.ts` mirrors Phase 38's `src/ontology/index.ts` convention; root barrel appends the helper AFTER the Phase 38 ontology block. Plan 04 backfill exports will append AFTER Plan 02's line (success criterion: root barrel order preserved for Plan 04's later append).
- **Phase 37/38 + Plan 39-01 regression-free** — all 61 baseline tests still GREEN; +8 new Plan 02 tests; final test count: 69/69 across 8 test files.

## Task Commits

Both tasks committed atomically in the km-core repo (`~/Agentic/km-core/`):

1. **Task 1: Implement `mergeDescriptionSegment` pure helper + sub-barrel + root barrel** — `aa800ba` (feat)
   `feat(39-02): add mergeDescriptionSegment pure helper (D-39/D-40/D-41)`
2. **Task 2: 8 unit tests covering D-40 boundary cases + D-41 monitoring + D-39 purity** — `11e9018` (test)
   `test(39-02): add 8 unit tests for mergeDescriptionSegment (D-39/D-40/D-41)`

**Plan metadata commit:** lands separately in the coding/ repo as `docs(39-02): summary` — this SUMMARY.md.

## Files Created/Modified

### km-core (separate repo at ~/Agentic/km-core/)

- `src/segments/merge.ts` (NEW — 140 lines) — exports `mergeDescriptionSegment(entity: Entity, newSegment: DescriptionSegment): Entity`. Private `normalize(text): string` helper applies the D-40 formula `text.trim().replace(/\s+/g, ' ')`. Module-scope `MAX_SEGMENTS_WARN = 100` and `MAX_CONFIRMATIONS_WARN = 50` constants for D-41 monitoring. JSDoc spells out the D-39 / D-40 / D-41 contracts. Imports are type-only (`import type { Entity, DescriptionSegment, SegmentConfirmation }`) from `../types/entity.js`.
- `src/segments/index.ts` (NEW — 10 lines) — sub-barrel re-exports `mergeDescriptionSegment` from `./merge.js` (CF-D06 ESM `.js` suffix). Mirrors Phase 38's `src/ontology/index.ts` convention; consumers can import either via the root barrel `@fwornle/km-core` or the sub-path `@fwornle/km-core/segments`.
- `src/index.ts` (69 → 77 lines; +8 net) — APPENDED `export { mergeDescriptionSegment } from './segments/merge.js';` AFTER the Phase 38 ontology exports, with a JSDoc-style comment block per Phase 37/38 convention. Plan 04 will append backfill exports AFTER this line (root barrel order preserved).
- `tests/unit/segments-merge.test.ts` (NEW — 241 lines) — 8 tests in one `describe('mergeDescriptionSegment (D-39, D-40, D-41)', ...)` block. Test-local `mkEntity(overrides?)` and `mkSegment(text, overrides?)` builders. Imports `mergeDescriptionSegment` from `'../../src/segments/merge.js'` and types from `'../../src/index.js'`. D-41 threshold tests use `vi.spyOn(process.stderr, 'write').mockImplementation(() => true)` so warnings don't pollute test output.

### coding/ (this repo, `.planning/`)

- `.planning/phases/39-entity-data-model/39-02-SUMMARY.md` — this file.

## The 8 Tests (one-line each)

1. **appends confirmation on identical text post-normalize (D-40 case a)** — pre-populate one segment, merge identical text, expect 1 segment with 1 confirmation containing `{ runId: 'r2', provider, model, timestamp: 'T2' }`.
2. **treats "hello world" and "hello  world" (double space) as identical (D-40 case b)** — whitespace normalization collapses runs of `\s` to a single ASCII space; segments count stays at 1, confirmation appended.
3. **distinguishes "Code" from "code" (case-sensitive — D-40 case c)** — normalize doesn't touch case; merge pushes a second segment.
4. **matches NBSP and ideographic space against ASCII space (D-40 case e)** — sequential merges with `'hello world'` (NBSP) and `'hello　world'` (ideographic space) both confirm the pre-existing ASCII-space segment; segments count stays at 1, confirmations count reaches 2.
5. **initializes descriptionSegments[] when entity.metadata has no such key (case g)** — Phase 37/38 default (`metadata: {}`); helper initializes the array on the returned entity.
6. **emits stderr-warn at >100 segments (D-41 threshold)** — pre-populate 100 distinct-text segments, merge a 101st; `vi.spyOn(process.stderr, 'write')` captures a write matching `/has 101 descriptionSegments \(>100/`.
7. **emits stderr-warn at >50 confirmations on a segment (D-41 threshold)** — pre-populate one segment with 50 confirmations, merge identical text to push the 51st; stderr-spy captures a write matching `/has 51 confirmations \(>50/`.
8. **is a pure function — input entity reference is NOT mutated (D-39)** — pre-call JSON snapshot equality + four `Object.is(...) === false` assertions (returned entity, metadata object, descriptionSegments array, returned-confirmation array all reference-distinct from input).

## Decisions Made

- **Single `normalize()` function inside `src/segments/merge.ts`** (not lifted to a shared util module) — D-40 says "one source of truth" but only one consumer exists today. If Phase 40 (ingest pipeline) or Phase 42 (B migration) need the same formula and import it from `src/segments/merge.js`, that's the right move; promoting `normalize()` to its own module is premature until a second concrete consumer appears.
- **Test-local `mkEntity` + `mkSegment` builders** (not exported, not in `tests/helpers/`) — Phase 37/38 follow the same convention (per-test factories at file-top scope). Keeps the test file self-contained — reviewers see the whole behavior contract in one screen.
- **stderr-warn message format mirrors `src/store/exporter.ts:112`** — `[km-core/segments] entity <id> ...` with the monitoring suffix `(>N, monitoring per D-41)` baked into BOTH branches (segments-count and confirmations-count). Ops can grep for `/monitoring per D-41/` to surface both signals.
- **Plan 04 backfill exports will append AFTER Plan 02's `mergeDescriptionSegment` export** — root barrel order is a success criterion. Plan 02's export sits at line 76; Plan 04 will add `backfillEntityDataModel` + `BackfillOptions` / `BackfillResolver` / `BackfillResult` type exports starting at line 78.
- **D-41 threshold is strict-greater (`>100`, `>50`)** — when the array transitions from 100 → 101 segments, the warning fires; the verify-block regex `/has 101 descriptionSegments \(>100/` confirms the threshold interpretation.

## Deviations from Plan

None. Plan executed exactly as written.

**Total deviations:** 0.
**Impact on plan:** None — both tasks landed in their planned form, all 8 boundary tests pass on first try, build clean, full suite GREEN.

## Issues Encountered

- **Initial Prettier wrap on `vi.spyOn(process.stderr, 'write')` broke the literal grep gate.** The plan's verify-block regex `vi.spyOn(process.stderr` requires the call on one line; my initial test file wrapped it across two lines (`const stderrSpy = vi\n  .spyOn(process.stderr, ...)`). Fixed by collapsing to one line. Build + tests stayed GREEN through the edit (no behavior change). NOT logged as a deviation because it's purely a syntactic gate satisfaction — the spirit of the rule (≥2 stderr-spy tests) was honored either way.
- **No other issues.** Build clean on first attempt after each task; types compose; tests green.

## Self-Check: PASSED

- `[ -f /Users/Q284340/Agentic/km-core/src/segments/merge.ts ]` → FOUND (140 lines)
- `[ -f /Users/Q284340/Agentic/km-core/src/segments/index.ts ]` → FOUND (10 lines)
- `[ -f /Users/Q284340/Agentic/km-core/tests/unit/segments-merge.test.ts ]` → FOUND (241 lines, 8 tests)
- `git -C /Users/Q284340/Agentic/km-core log --oneline | grep aa800ba` → FOUND (`feat(39-02): add mergeDescriptionSegment pure helper (D-39/D-40/D-41)`)
- `git -C /Users/Q284340/Agentic/km-core log --oneline | grep 11e9018` → FOUND (`test(39-02): add 8 unit tests for mergeDescriptionSegment (D-39/D-40/D-41)`)
- `cd /Users/Q284340/Agentic/km-core && npx vitest run` → 8/8 test files PASSED, 69/69 tests PASSED (was 61; +8 net)
- `cd /Users/Q284340/Agentic/km-core && npm run build` → exit 0 (tsc strict mode clean)
- Grep gates (positive):
  - `export function mergeDescriptionSegment` in `src/segments/merge.ts` → 1 hit
  - `MAX_SEGMENTS_WARN = 100` in `src/segments/merge.ts` → 1 hit
  - `MAX_CONFIRMATIONS_WARN = 50` in `src/segments/merge.ts` → 1 hit
  - `text.trim().replace` in `src/segments/merge.ts` → 3 hits (1 active code, 2 in JSDoc/comments)
  - `mergeDescriptionSegment` in `src/index.ts` → 1 hit (root barrel export)
  - `vi.spyOn(process.stderr` in `tests/unit/segments-merge.test.ts` → 2 hits (D-41 threshold tests)
  - `'hello  world'` in `tests/unit/segments-merge.test.ts` → 2 hits (double-space case verbatim)
  - `Object.is` in `tests/unit/segments-merge.test.ts` → 3 hits (purity test reference-distinct assertions)
- Grep gates (negative):
  - `grep -v '^[[:space:]]*\(//\|\*\)' src/segments/merge.ts | grep -c 'console\.'` → 0 (no console.* outside comments)
- Root barrel order verified: `mergeDescriptionSegment` export at line 76 of `src/index.ts`; no `backfillEntityDataModel` export yet (Plan 04 will append AFTER).

## Next Phase Readiness

- **Ready for Plan 39-03 (supersession semantics + getSupersessionChain):** Plan 02 is independent of Plan 03 — different surface, different file. Plan 03 builds on Plan 01's validFrom auto-stamp (`old.validUntil = new.validFrom`); Plan 02 doesn't intersect that path.
- **Ready for Plan 39-04 (backfill + helper):** Root barrel append order is locked — Plan 02's `mergeDescriptionSegment` export sits at line 76; Plan 04 will append `backfillEntityDataModel` + type exports AFTER that line. Plan 04's `src/backfill/index.ts` and `tests/unit/backfill.test.ts` are independent files; no merge conflict expected with Plan 02.
- **Ready for Phase 40 (PIPE-01 ingest pipeline):** `mergeDescriptionSegment` is the per-segment provenance integration point. Phase 40 callers will:
  ```typescript
  // Load entity, fold new segment in, write back.
  const entity = await store.getEntity(id);
  const newSegment: DescriptionSegment = { text, runId, provider, model, quality, timestamp, confirmations: [] };
  const merged = mergeDescriptionSegment(entity, newSegment);
  await store.putEntity(merged, { provenance });
  ```
  No additional plumbing required — the helper is pure and library-level.
- **Ready for Phase 42 (INT-02 B migration):** B's persistence-agent will call `mergeDescriptionSegment` AFTER replacing the `SharedMemoryEntity` shape with the canonical `Entity`. The helper takes care of the merge-or-confirm logic; B's pipeline supplies the segment construction (runId / provider / model / quality / timestamp).
- **No new blockers.** Build clean, tests green, grep gates pass, no constraints triggered.
- **Behavior surprises worth flagging to downstream callers:**
  - The helper takes the WHOLE entity (not the segments array). Callers MUST NOT call `helper(entity.metadata.descriptionSegments, newSegment)` — that won't type-check, and even if cast away, would lose the `metadata: {}` initialization branch.
  - Returned entity has a NEW reference. Callers that hold a cache by reference (e.g. `Map<EntityId, Entity>`) must `.set(id, returnedEntity)` after merging — the input reference still points at the un-merged shape.
  - `confirmations[]` on the pushed (no-match) segment preserves caller-supplied confirmations. If the caller passes `newSegment.confirmations = [{...some prior context}]`, those entries land in the segment as-is. Callers that always want a fresh segment must pass `confirmations: []`.
  - The D-41 stderr-warn fires per merge call when the threshold is crossed — not idempotent. Repeated merges past the threshold each emit a warning. Ops dashboards should rate-limit if the warning rate becomes noisy.

---
*Phase: 39-entity-data-model*
*Completed: 2026-05-20*
