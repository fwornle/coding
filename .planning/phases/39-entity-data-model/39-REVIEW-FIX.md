---
phase: 39-entity-data-model
fixed_at: 2026-05-21T00:00:00Z
review_path: .planning/phases/39-entity-data-model/39-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
test_baseline_pre: 90
test_baseline_post: 92
---

# Phase 39: Code Review Fix Report

**Fixed at:** 2026-05-21
**Source review:** `.planning/phases/39-entity-data-model/39-REVIEW.md`
**Iteration:** 1
**Scope:** Critical + Warning (default) — IN-01 and IN-02 deferred per default policy. IN-02 ("`BackfillResult.skipped` JSDoc ambiguous") was closed transitively as part of the CR-02 fix.

**Summary:**
- Findings in scope: 6
- Fixed: 6
- Skipped: 0
- Test baseline preserved: 90/90 → 92/92 (2 new regression tests, all GREEN)
- TypeScript strict build: clean
- Phase 37/38 NO-CHANGE invariants preserved (BC-2 widening, trusted-path entity-build line, mergeAttributes ontology-skip)
- CF-D06 ESM `.js` suffix preserved (no new imports added; existing ones untouched)
- no-console-log honored — zero new `console.*` calls; all new diagnostics use `process.stderr.write`

## Fixed Issues

### CR-01: batch() Phase-1 validation rejects non-v7 entity IDs during supersession closure

**Files modified:** `~/Agentic/km-core/src/store/types.ts`, `~/Agentic/km-core/src/store/GraphKMStore.ts`, `~/Agentic/km-core/tests/unit/graph-store.test.ts`
**Commit:** `44c1e9b` — `fix(39-CR01): widen BatchOp with per-op skipOntologyCheck to fix cross-epoch supersession`
**Applied fix:** Widened `BatchOp.putEntity` with an optional `skipOntologyCheck?: boolean` flag mirroring the existing `PutEntityOpts.skipOntologyCheck` BC-2 escape hatch. `batch()` Phase-1 now bypasses BOTH the ontology validator AND `parseEntityId` when the per-op flag is `true`. The D-33 supersession closure sets the flag on both batch ops (`closedOld` + `entity`) so cross-epoch supersession (v7 successor → legacy-id predecessor) atomic-closes without throwing in Phase 1.

**Regression test added:** `'putEntity supersession closes a legacy-id predecessor atomically (CR-01 regression)'` — seeds a nanoid-keyed predecessor via the trusted path, supersedes it via the strict path with a fresh v7 id, asserts both the `validUntil` closure AND the SUPERSEDED_BY edge materialize atomically. Test name preserved verbatim per Phase 37/38/39 convention.

**Atomicity contract preserved:** I deliberately did NOT take the review's "sequential two trusted puts" alternative — that would lose the all-or-nothing guarantee for the closure pair. The per-op `skipOntologyCheck` widening keeps atomicity intact while widening Phase 1 validation per-op.

---

### CR-02: Checkpoint `skipped` carries forward on resume, double-counting

**Files modified:** `~/Agentic/km-core/src/backfill/index.ts`, `~/Agentic/km-core/tests/unit/backfill.test.ts`
**Commit:** `26b86d5` — `fix(39-CR02): stop carrying forward checkpoint.skipped — was double-counted on resume`
**Applied fix:** `skipped` initialized to `0` (fresh per-run counter); only `stamped` carries forward from the prior checkpoint (cumulative across resumed runs per the existing `BackfillResult.stamped` contract). `BackfillResult` JSDoc tightened to explicitly document per-run semantics for `skipped` + `scanned` vs cumulative semantics for `stamped` — also closes **IN-02** transitively since it was tightly coupled to CR-02.

**Resume test (test 9) tightened:** added `expect(result.skipped).toBe(1)` and `expect(result.scanned).toBe(3)` assertions to lock down per-run semantics. Before the fix, test 9 only asserted `result.stamped` — the bug was invisible because the test's `prior.skipped` was `0` (no double-count surfaced). With a non-zero `prior.skipped` the over-report would have been visible. The new assertions catch the regression class.

---

### WR-01: `supersedes` field stays on stored entity post-closure (undocumented footgun)

**Files modified:** `~/Agentic/km-core/src/store/GraphKMStore.ts`
**Commit:** `2564fac` — `fix(39-WR01): document supersedes-field footgun on putEntity + getEntity JSDoc`
**Applied fix:** Documentation-only fix. The review's primary suggestion (strip `supersedes` via `mergeNodeAttributes` after closure) cannot be applied because `getSupersessionChain` D-35 reverse-walk DEPENDS on `entity.supersedes` to traverse predecessors (line 586 of GraphKMStore.ts: `cursor = e.supersedes;`). Stripping the field would break D-35's predecessor walk.

The review's alternative suggestion was adopted: added JSDoc footgun sections to both `putEntity` AND `getEntity` explaining (a) `supersedes` is the author's declaration not a store invariant, (b) confirm-writes with `supersedes` set are silent no-ops on the supersession branch (OQ#4 `!existing` guard saves them — closure + reverse-edge fire ONLY on the create branch), (c) to explicitly re-attempt supersession on an existing id, delete and recreate the entity, (d) cross-reference to REVIEW.md WR-01.

**Rationale for doc-only:** preserves D-35 contract while making the latent footgun explicit. Phase 40/42/43 downstream callers reading the JSDoc on `getEntity` (which is the read entry point for read-modify-write patterns) will see the warning before they accidentally pass `supersedes` back through `putEntity`.

---

### WR-02: Forward walk in `getSupersessionChain` non-deterministic on multiple SUPERSEDED_BY edges

**Files modified:** `~/Agentic/km-core/src/store/GraphKMStore.ts`
**Commit:** `cd9b2bf` — `fix(39-WR02): enforce single SUPERSEDED_BY successor + deterministic forward walk`
**Applied fix:** Two-layer defense-in-depth:

1. **Write-time enforcement** in the D-33 supersession closure: before creating the SUPERSEDED_BY edge, count existing SUPERSEDED_BY out-edges on `oldId`. If any exist, throw `'Entity X already has a successor — cannot supersede twice (WR-02 single-successor invariant)'`. Prevents the violation from entering the store via new writes.

2. **Forward-walk determinism** in `getSupersessionChain`: take the FIRST unvisited SUPERSEDED_BY successor (was: LAST — assignments inside `forEachOutEdge` overwrote earlier candidates) and emit a stderr-warn on any additional matches. Handles pre-existing forked data that the write-time check cannot retroactively fix; surfaces the anomaly rather than silently picking inconsistent edges across runs.

**Test impact:** all 12 existing Plan 03 supersession tests stay green (none of them exercise the multi-successor case; the OQ#4 `!existing` guard already covers the re-supersede-existing-id no-op path).

---

### WR-03: `readCheckpoint` does not validate `version` field

**Files modified:** `~/Agentic/km-core/src/backfill/checkpoint.ts`
**Commit:** `f901e93` — `fix(39-WR03): validate Checkpoint.version after JSON.parse in readCheckpoint`
**Applied fix:** After `JSON.parse`, the function now checks `cp.version !== 1` and throws a clear actionable error including the checkpoint path so the operator can delete it to start fresh. Restructured the `try`/`catch` so `JSON.parse` is OUTSIDE the I/O catch — a `SyntaxError` (malformed checkpoint) now surfaces directly instead of being mis-coded as a generic I/O error. JSDoc updated to document both throw cases.

ENOENT → `null` semantics preserved (the first-run path depends on it). Other I/O errors continue to propagate.

---

### WR-04: `mergeDescriptionSegment` propagates caller-supplied confirmations unvalidated (provenance injection vector)

**Files modified:** `~/Agentic/km-core/src/segments/merge.ts`, `~/Agentic/km-core/tests/unit/segments-merge.test.ts`
**Commit:** `9ab72c8` — `fix(39-WR04): drop caller-supplied confirmations[] on D-40 miss (provenance injection)`
**Applied fix:** D-40 miss branch now ALWAYS pushes `{ ...newSegment, confirmations: [] }` regardless of caller input. Previously it preserved `newSegment.confirmations` verbatim (`?? []` only fell back when undefined), creating a provenance injection vector where a caller constructing `newSegment` from external/untrusted JSON could pre-populate fabricated `SegmentConfirmation` entries (attacker-controlled `runId`/`provider`/`model`/`timestamp`) that landed in the entity's confirmation history without going through the normal confirmation-append path.

The implicit confirmation for the ingest-time call itself is captured by the next merge against matching text via the D-40 hit branch (which extracts a single well-formed `SegmentConfirmation` from `newSegment`'s outer fields).

JSDoc updated with explicit WR-04 callout and pointer to the legitimate migration/restore use case (use a separate restore API, not this ingest-time helper).

**Regression test added:** `'drops caller-supplied confirmations[] on D-40 miss (WR-04 provenance injection mitigation)'` — passes an attacker-controlled `confirmations` entry to a no-match segment, asserts the pushed segment has a fresh empty `confirmations[]`. Test name follows Plan 02 convention.

## Skipped Issues

None — all 6 in-scope findings fixed.

(IN-01 and IN-02 are out of scope per the default Critical+Warning policy. IN-02 was closed transitively as part of the CR-02 fix since the two findings were tightly coupled — the JSDoc ambiguity was on the same field that CR-02 corrected.)

## Test Suite Health

| Stage | Tests passing |
|-------|--------------|
| Baseline (pre-fixes) | 90 / 90 |
| After CR-01 fix | 91 / 91 (+1 regression test for cross-epoch supersession) |
| After CR-02 fix | 91 / 91 (assertions tightened on test 9, no count change) |
| After WR-01 fix | 91 / 91 (doc-only) |
| After WR-02 fix | 91 / 91 (no existing test exercises multi-successor case) |
| After WR-03 fix | 91 / 91 (no existing test exercises version mismatch) |
| After WR-04 fix | 92 / 92 (+1 regression test for provenance injection mitigation) |

All test names preserved verbatim where existing tests were modified (only bodies tightened). TypeScript `tsc --strict` build clean after every fix.

## Phase 37/38 NO-CHANGE invariants

Confirmed preserved across all 6 fixes:

- **BC-2 widening** (`skipOntologyCheck: true` also bypasses `parseEntityId`): preserved on the single-call `putEntity` path. CR-01 EXTENDS this same widening to per-op batch ops (per-op `skipOntologyCheck` is explicit opt-in, default false — strict-by-default unchanged).
- **Trusted-path entity-build line** (`entity = { ...e, id } as Entity;`): unchanged byte-equal.
- **mergeAttributes ontology-skip**: untouched.
- **PersistenceManager + Exporter constructor ordering**: untouched.

## Commits in km-core (~/Agentic/km-core/)

In chronological order:
1. `44c1e9b` — `fix(39-CR01): widen BatchOp with per-op skipOntologyCheck to fix cross-epoch supersession`
2. `26b86d5` — `fix(39-CR02): stop carrying forward checkpoint.skipped — was double-counted on resume`
3. `2564fac` — `fix(39-WR01): document supersedes-field footgun on putEntity + getEntity JSDoc`
4. `cd9b2bf` — `fix(39-WR02): enforce single SUPERSEDED_BY successor + deterministic forward walk`
5. `f901e93` — `fix(39-WR03): validate Checkpoint.version after JSON.parse in readCheckpoint`
6. `9ab72c8` — `fix(39-WR04): drop caller-supplied confirmations[] on D-40 miss (provenance injection)`

All commits are atomic (one finding per commit) and follow Phase 39's `fix(39-NN):` style adapted to `fix(39-CR##):` / `fix(39-WR##):` per the cross-repo context guidance.

---

_Fixed: 2026-05-21_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
