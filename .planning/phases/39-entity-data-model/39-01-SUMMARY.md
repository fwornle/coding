---
phase: 39-entity-data-model
plan: 01
subsystem: database
tags: [km-core, graphology, graph-store, provenance, validfrom, entity-data-model, writer-side-stamping, data-02]

# Dependency graph
requires:
  - phase: 37-km-core-foundation/02
    provides: Entity / Relation / ProvenanceStamp / EntityProvenance type declarations (intentionally empty — populated by Phase 39)
  - phase: 37-km-core-foundation/04
    provides: GraphKMStore composition class + putEntity signature + skipOntologyCheck BC-2 widening (Plan 39 EXTENDS, does not replace)
  - phase: 38-ontology-registry/05
    provides: registry-backed validator auto-wired into GraphKMStore (Phase 39 leaves untouched; D-30 runs AFTER ontology validation on the strict path)
provides:
  - GraphKMStore.putEntity extended with PutEntityOpts {skipOntologyCheck?, provenance?} — D-30 throw on missing provenance (strict path); D-31 writer-side validFrom auto-stamp; D-32 EntityProvenance assembly via graph.hasNode(id) create-vs-confirm semantics
  - PutEntityOpts public type exported from src/store/types.ts (combined opts bag — replaces the inline {skipOntologyCheck?: boolean} anonymous shape)
  - JSDoc tightening on ProvenanceStamp, EntityProvenance, validFrom, validUntil, supersedes — spelling out the Phase 39 writer-side contract (NO new fields)
  - 5 new vitest tests appended to graph-store.test.ts under "Phase 39 — writer-side stamping (D-30/D-31/D-32)" describe block
  - Existing 13 GraphKMStore tests threaded with a canonical PROV ProvenanceStamp so they keep passing after the D-30 strict requirement landed (Rule 3 follow-on edit; test NAMES preserved verbatim)
affects:
  - 39-02 (per-segment provenance writer) — landing the mergeDescriptionSegment helper on top of the EntityProvenance + DescriptionSegment shapes locked by Plan 01
  - 39-03 (supersession semantics + getSupersessionChain) — uses the validFrom auto-stamp from Plan 01 as the basis for D-33 atomic predecessor closure (old.validUntil = new.validFrom)
  - 39-04 (backfill + helper) — backfill writes pre-stamp EntityProvenance themselves before calling putEntity({skipOntologyCheck: true}); the trusted-path bypass preserves the BC-2 widening
  - 42 (INT-02 B migration) — Phase 42 swaps SharedMemoryEntity for the canonical Entity, and B's pipeline now has a writer-side stamping point to feed structured provenance through
  - 41 (INT-01 A adapter) — A's adapter calls putEntity with provenance from its observation pipeline
  - 43 (INT-03 C migration) — C's persistence calls putEntity with provenance from its ingestion runs

# Tech tracking
tech-stack:
  added: []  # no new dependencies — purely additive extension of Phase 37 surface
  patterns:
    - "Writer-side stamping (D-30/D-31/D-32 — extends Phase 37 CF-D10): caller supplies the ProvenanceStamp source; store assembles the EntityProvenance struct + auto-stamps validFrom on the strict path"
    - "Options-object signature with strict-path-only enforcement (Pattern S2 from 39-PATTERNS): D-30 throw lives INSIDE `if (!trusted)` so the skipOntologyCheck BC-2 widening is preserved"
    - "Create-vs-confirm decided by graph.hasNode(id) (D-32 single-call idiom — no separate confirmEntity method): preserves createdBy on subsequent writes; increments confirmationCount; overwrites lastConfirmedBy"
    - "Batch atomicity preserved by passing {skipOntologyCheck: true} to the internal putEntity call (validate-all-first runs in Phase 1 above; the per-op call in Phase 2 bypasses re-validation AND the D-30 requirement)"

key-files:
  created: []
  modified:
    - /Users/Q284340/Agentic/km-core/src/store/GraphKMStore.ts (574 → 643 lines; +69 net) — putEntity signature uses PutEntityOpts; D-30 throw inside the strict path; D-31 validFrom auto-stamp + D-32 EntityProvenance assembly after the existing `metadata: e.metadata ?? {}` default. batch() Phase-2 internal call passes {skipOntologyCheck: true}. ProvenanceStamp + EntityProvenance + PutEntityOpts imports added (type-only).
    - /Users/Q284340/Agentic/km-core/src/store/types.ts (30 → 56 lines; +26 net) — appended PutEntityOpts {skipOntologyCheck?, provenance?} interface; ProvenanceStamp imported from ../types/entity.js (ESM .js suffix per CF-D06). BatchOp shape UNCHANGED — Phase 39 surfaces PutEntityOpts first; Phase 42 may widen batch.
    - /Users/Q284340/Agentic/km-core/src/types/entity.ts (151 → 174 lines; +23 net) — JSDoc tightening on ProvenanceStamp (D-30 caller contract), EntityProvenance (D-32 create-vs-confirm rules), validFrom (D-31 writer-side auto-stamp), validUntil (Plan 39-03 ownership), supersedes (Plan 39-03 ownership). NO new fields, NO renames — comment-only changes.
    - /Users/Q284340/Agentic/km-core/tests/unit/graph-store.test.ts (335 → 452 lines; +117 net) — file-top PROV ProvenanceStamp constant; existing 13 tests threaded with `{ provenance: PROV }` where they hit the strict putEntity path (Rule 3 fix so existing tests keep passing); NEW describe block "Phase 39 — writer-side stamping (D-30/D-31/D-32)" with 5 verbatim-named tests + a per-test mkProvenance(suffix) factory. Test NAMES preserved verbatim; BC-2 widening tests untouched (they pass `skipOntologyCheck: true` so the D-30 check doesn't fire).

key-decisions:
  - "Existing 13 GraphKMStore tests threaded with a single canonical PROV ProvenanceStamp constant (not per-test factories) — the existing tests assert CRUD / event / iterate semantics, NOT provenance, so a single stamp suffices. The Phase 39 NEW tests use per-test mkProvenance(suffix) factories so D-32 confirmation assertions can distinguish first-write from subsequent runs."
  - "BatchOp shape left UNCHANGED — Phase 39 surfaces PutEntityOpts first; the batch() internal putEntity call passes {skipOntologyCheck: true} because validation runs once in Phase 1. Phase 42 may widen BatchOp to carry per-op provenance once callers demonstrate the need."
  - "D-30 throw lives INSIDE `if (!trusted)` so it runs AFTER the ontology validation (validator.validate runs first), preserving the existing throw-order contract from Phase 37/38. The plan's pattern S2 specifies this — the existing ontology test 'Unknown ontology class' regex still matches because that throw fires before the D-30 throw can."
  - "Trusted path (skipOntologyCheck: true) does NOT auto-assemble EntityProvenance — backfill / fixture-replay callers stamp metadata.provenance themselves before invoking. This sidesteps the BC-2 bypass cleanly and matches 39-PATTERNS §S2 (writer-side stamping on the strict path only)."

patterns-established:
  - "Pattern S1 (options-object): PutEntityOpts is the first Phase 39 named options-object type; future plans (39-02 mergeDescriptionSegment, 39-04 BackfillOptions) follow the same shape"
  - "Pattern S2 (writer-side stamping on strict path only): D-30 throw + D-31 validFrom stamp + D-32 EntityProvenance assembly ALL live inside `if (!trusted)` — Phase 37 BC-2 widening preserved as the trusted bypass"
  - "Verbatim test name preservation: existing 13 GraphKMStore test NAMES untouched; new tests live in a separate describe block. This is grep-verifiable and the must_haves contract relies on it."
  - "Test fixture pattern (PROV constant + per-test mkProvenance factory): canonical baseline stamp at file-top scope for existing tests; per-test factories for tests that assert on confirmation semantics"

requirements-completed: [DATA-02]

# Metrics
duration: ~7 min
completed: 2026-05-20
---

# Phase 39 Plan 01: putEntity Writer-Side Provenance Stamping Summary

**GraphKMStore.putEntity extended with PutEntityOpts {provenance, skipOntologyCheck} for writer-side validFrom auto-stamp (D-31) + EntityProvenance assembly via graph.hasNode(id) create-vs-confirm semantics (D-32) + D-30 strict-path provenance requirement, preserving Phase 37 BC-2 widening on the trusted path.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-05-20T15:45:13Z (Phase 39 execution kicked off per STATE.md)
- **Completed:** 2026-05-20T15:52:49Z
- **Tasks:** 2 (both `type=auto`, both `tdd=true`)
- **Files modified:** 4 in km-core (1 test, 3 source) + 1 in coding/ (this SUMMARY)

## Accomplishments

- **putEntity now stamps writer-side provenance and validity windows** — every strict-path call assembles a fully-populated EntityProvenance struct with createdBy / lastConfirmedBy / confirmationCount and auto-stamps validFrom from `new Date().toISOString()` when the caller omits it. The D-30 throw forces every caller to supply the ProvenanceStamp source (provider/model/runId/timestamp) — the store never invents one. This is the integration point most other Phase 39 decisions (39-02 segments, 39-03 supersession, 39-04 backfill) branch off.
- **DATA-02 closed at the writer layer** — createdBy / lastConfirmedBy / confirmationCount are populated on every strict putEntity (per-segment provenance is the Plan 02 contribution; Plan 01 covers the entity-level half).
- **BC-2 widening preserved** — the trusted path (`skipOntologyCheck: true`) bypasses BOTH ontology validation AND the new D-30 provenance requirement, so Phase 37 backfill / fixture-replay / Phase 39 backfill (Plan 04) keep working with non-v7 ids AND without supplying provenance opts (callers pre-stamp `metadata.provenance` themselves on the trusted path).
- **All Phase 37/38 vitest tests still GREEN** — the must_haves contract called for "33 baseline" but the actual baseline was 56 (33 Phase 37 + 23 Phase 38 = 56); all 56 pre-existing tests preserved AFTER threading `{ provenance: PROV }` through the bodies of tests that call the strict path (Rule 3 follow-on; test NAMES untouched).
- **5 new Phase 39 tests landed** — covering D-31 validFrom auto-stamp, D-32 first-write vs subsequent-write semantics (3 assertions on createdBy / lastConfirmedBy / confirmationCount), D-30 throw on missing provenance (both `{}` and missing-opts variants), and BC-2 bypass behavior (trusted path resolves successfully without provenance AND does NOT auto-stamp metadata.provenance).
- **Final test count: 61/61 GREEN** (56 baseline + 5 new = 61; graph-store.test.ts: 13 → 18; km-core total: 56 → 61 across 7 test files).

## Task Commits

Both tasks committed atomically in the km-core repo (`~/Agentic/km-core/`):

1. **Task 1: Extend putEntity with writer-side stamping (D-30/D-31/D-32) + PutEntityOpts type + thread existing tests with PROV** — `0cd51ea` (feat)
   `feat(39-01): extend putEntity with writer-side provenance stamping (D-30/D-31/D-32)`
2. **Task 2: Append 5 D-30/D-31/D-32 tests to graph-store.test.ts** — `374c27c` (test)
   `test(39-01): append 5 Phase 39 writer-side stamping tests for D-30/D-31/D-32`

**Plan metadata commit:** lands separately in the coding/ repo as `docs(39-01): summary` — this SUMMARY.md.

## Files Created/Modified

### km-core (separate repo at ~/Agentic/km-core/)

- `src/store/GraphKMStore.ts` (574 → 643 lines; +69 net) — putEntity signature uses PutEntityOpts; D-30 throw inside the strict (`!trusted`) path; D-31 validFrom auto-stamp + D-32 EntityProvenance assembly via `graph.hasNode(id)`. `batch()` Phase-2 internal call passes `{ skipOntologyCheck: true }` so batch atomicity stays intact without batch callers having to supply provenance. Imports tightened: `EntityProvenance` (type-only) added to the entity.js import; `PutEntityOpts` added to the store/types.js import. Trusted-path entity-build line UNCHANGED (byte-equal to its prior form): `entity = { ...e, id } as Entity;`.
- `src/store/types.ts` (30 → 56 lines; +26 net) — appended `PutEntityOpts { skipOntologyCheck?: boolean; provenance?: ProvenanceStamp }` interface; ProvenanceStamp imported from `../types/entity.js` (ESM .js suffix per CF-D06). BatchOp shape UNCHANGED.
- `src/types/entity.ts` (151 → 174 lines; +23 net) — JSDoc tightened on `ProvenanceStamp` (D-30 caller contract), `EntityProvenance` (D-32 create-vs-confirm rules), `validFrom` (D-31 writer-side auto-stamp), `validUntil` (Plan 39-03 ownership), `supersedes` (Plan 39-03 ownership). NO new fields, NO renames — comment-only diff.
- `tests/unit/graph-store.test.ts` (335 → 452 lines; +117 net) — file-top `PROV: ProvenanceStamp` constant; 13 existing tests threaded with `{ provenance: PROV }` where they hit the strict putEntity path; NEW `describe('Phase 39 — writer-side stamping (D-30/D-31/D-32)', ...)` block with 5 verbatim-named tests and a per-test `mkProvenance(suffix)` factory. Total tests in this file: 13 → 18.

### coding/ (this repo, `.planning/`)

- `.planning/phases/39-entity-data-model/39-01-SUMMARY.md` — this file.

## Decisions Made

- **Single canonical PROV constant for the 13 pre-existing tests, per-test factories for the 5 NEW tests** — pre-existing tests assert CRUD / event / iterate semantics, so a single stamp threads through cleanly without obscuring intent; new tests need distinguishable runIds (run-1 vs run-2) for the D-32 confirmation-count assertion.
- **BatchOp shape UNCHANGED in Plan 01** — Phase 39 surfaces `PutEntityOpts` first; `batch()` Phase-2 internal `putEntity` call passes `{ skipOntologyCheck: true }` because Phase-1 already validated. Phase 42 may widen BatchOp to carry per-op provenance once a real consumer demands it; that change has zero impact on Plan 01's surface today.
- **D-30 throw lives INSIDE `if (!trusted)` and AFTER `validator.validate(e.entityType)`** — preserves the existing throw-order contract from Phase 37/38. The "Unknown ontology class" regex test still matches because the ontology throw fires before the D-30 throw can.
- **Trusted path does NOT auto-assemble EntityProvenance** — backfill / fixture-replay callers stamp `metadata.provenance` themselves before invoking the trusted path. This sidesteps the BC-2 bypass cleanly and matches 39-PATTERNS §S2 ("writer-side stamping on the strict path only").

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Existing 13 GraphKMStore tests threw on the new D-30 strict-path requirement; threaded `{ provenance: PROV }` through their bodies to keep them passing**

- **Found during:** Task 1 verify (after landing the D-30 throw in `GraphKMStore.putEntity`, running `npx vitest run` produced 9 failing tests in graph-store.test.ts — all of them were existing Phase 37/38 tests calling the strict path without supplying `opts.provenance`).
- **Issue:** The plan's must_haves contain BOTH "putEntity throws on the strict path when opts.provenance is missing (D-30)" AND "All 33 existing Phase 37/38 vitest tests continue to pass (no breaking type changes to Phase 37/38 callers)". These are only mutually consistent if the existing tests are updated to supply provenance — because the runtime behavior IS a behavior change (the TYPE remains backwards-compatible since `provenance` is optional in PutEntityOpts, but the runtime contract is now strict).
- **Fix:** Added a file-top canonical `PROV: ProvenanceStamp` constant and threaded `{ provenance: PROV }` through each of the 9 failing existing tests (round-trip preserves all fields, valid UUIDv7 keeps id verbatim, invalid id throws SyntaxError, emits entity:put, deleteEntity emits entity:delete, addRelation persists edge, findByOntologyClass, iterate, strict ontology validation rejects unknown class, Phase 38 ontologyDir option) — TEST NAMES preserved verbatim per the must_haves; only the bodies needed updates. Also tightened the round-trip assertion: instead of `expect(got!.metadata).toEqual({ domain: 'general' })` it now asserts `got!.metadata.domain === 'general'` AND `got!.metadata.provenance` is defined (since putEntity now folds EntityProvenance into metadata under the `provenance` key on the strict path).
- **Files modified:** `tests/unit/graph-store.test.ts` (existing-test bodies threaded; NEW PROV constant added at file-top scope; type imports extended with `ProvenanceStamp` + `EntityProvenance`).
- **Verification:** `npx vitest run` exits 0 with 56/56 baseline tests passing after this fix (before the Task 2 append; final count after Task 2 = 61/61).
- **Committed in:** `0cd51ea` (Task 1 commit — same commit as the source-side D-30/D-31/D-32 changes, since they are coupled).

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking issue).
**Impact on plan:** Necessary to satisfy both must_haves simultaneously. No scope creep — the test-body changes are mechanical (add `{ provenance: PROV }` as a second argument) and the test NAMES are byte-equal to their pre-Phase-39 form. The round-trip test's metadata assertion was tightened because the strict path now folds EntityProvenance into metadata; this is documented behavior change, not scope creep.

## Issues Encountered

- **The plan's must_haves quoted "33 existing Phase 37/38 vitest tests" but the actual baseline is 56 (33 Phase 37 + 23 Phase 38).** This was a documentation lag in the plan — the actual must_haves contract is "all pre-existing tests still pass", which is honored: 56/56 baseline preserved AFTER threading provenance through 9 tests' bodies. Test names untouched.
- **No other issues.** Build clean on first attempt after each edit; types compose; all grep gates pass.

## Self-Check: PASSED

- `[ -f /Users/Q284340/Agentic/km-core/src/store/GraphKMStore.ts ]` → FOUND (643 lines)
- `[ -f /Users/Q284340/Agentic/km-core/src/store/types.ts ]` → FOUND (56 lines; `PutEntityOpts` exported)
- `[ -f /Users/Q284340/Agentic/km-core/src/types/entity.ts ]` → FOUND (174 lines; JSDoc tightened)
- `[ -f /Users/Q284340/Agentic/km-core/tests/unit/graph-store.test.ts ]` → FOUND (452 lines; 18 tests)
- `git -C /Users/Q284340/Agentic/km-core log --oneline | grep 0cd51ea` → FOUND (`feat(39-01): extend putEntity with writer-side provenance stamping (D-30/D-31/D-32)`)
- `git -C /Users/Q284340/Agentic/km-core log --oneline | grep 374c27c` → FOUND (`test(39-01): append 5 Phase 39 writer-side stamping tests for D-30/D-31/D-32`)
- `cd /Users/Q284340/Agentic/km-core && npx vitest run` → 7/7 test files PASSED, 61/61 tests PASSED (was 56; +5 net)
- `cd /Users/Q284340/Agentic/km-core && npm run build` → exit 0 (tsc strict mode clean)
- Grep gates (positive): `PutEntityOpts` in `src/store/types.ts` (2 hits — comment + interface) and `src/store/GraphKMStore.ts` (2 hits — import + signature); `requires opts.provenance` in `src/store/GraphKMStore.ts` (1 hit); `confirmationCount` in `src/store/GraphKMStore.ts` (5 hits across JSDoc + 2 active uses); `Phase 39 — writer-side stamping` in `tests/unit/graph-store.test.ts` (1 hit); `auto-stamps validFrom`, `preserves createdBy`, `bypasses provenance requirement` each 1 hit in `tests/unit/graph-store.test.ts`.
- Grep gates (negative): `grep -v '^[[:space:]]*\(//\|\*\)' src/store/GraphKMStore.ts | grep -c "console\."` → 0 (no new console.* outside comments).
- Acceptance criteria — trusted path byte-equal to prior form: `sed -n '345,347p' src/store/GraphKMStore.ts` → `if (trusted) { entity = { ...e, id } as Entity; }` — unchanged.
- BC-2 test at `tests/unit/graph-store.test.ts:314-334` (skipOntologyCheck bypasses registry validator) PASSES WITHOUT modification.

## Next Phase Readiness

- **Ready for Plan 39-02 (per-segment provenance writer / mergeDescriptionSegment):** The EntityProvenance struct now flows through `putEntity` automatically on the strict path; Plan 02's mergeDescriptionSegment helper builds on the same `metadata` writer pattern. Per-segment confirmations (DescriptionSegment.confirmations[]) are independent of entity-level EntityProvenance — they live in `metadata.descriptionSegments[].confirmations[]`, declared in entity.ts but populated by Plan 02's helper.
- **Ready for Plan 39-03 (supersession semantics + getSupersessionChain):** The D-31 validFrom stamp is the basis for D-33's atomic predecessor closure (`old.validUntil = new.validFrom`). Plan 03 adds the supersession trigger logic + reverse-supersedes edge + getSupersessionChain query API.
- **Ready for Plan 39-04 (backfill + helper):** The trusted-path BC-2 bypass means backfill callers pre-stamp `metadata.provenance` themselves and pass through `{ skipOntologyCheck: true }`. Plan 04 lands the `backfillEntityDataModel(store, options)` library function + atomic checkpoint helper.
- **Ready for Phase 42 (INT-02 B migration):** B's pipeline now has a writer-side stamping integration point — Phase 42 wires B's ingestion run metadata (provider/model/runId/timestamp) into the `putEntity({ ... }, { provenance })` call.
- **No new blockers.** Build clean, tests green, grep gates pass.
- **Behavior surprises worth flagging to Plan 02-04 reviewers:**
  - The strict path now folds EntityProvenance into `metadata.provenance`. Tests that asserted `expect(got.metadata).toEqual({ ... })` (deep-equality) need to be tightened to per-key assertions (the round-trip test in graph-store.test.ts:58-79 was updated for this; future plans should not write deep-equality assertions on metadata).
  - The batch() internal putEntity call passes `{ skipOntologyCheck: true }` — this bypasses BOTH the ontology validator (Phase 1 already validated) AND the D-30 provenance requirement. Phase 42 may widen BatchOp to carry per-op provenance.
  - On a subsequent strict-path write for an existing id, the prior entity's `createdBy` is preserved verbatim — if a Phase 37 entity loaded from a pre-Phase-39 snapshot is updated, `createdBy` falls back to `opts.provenance` (since the prior entity had no structured provenance). This is the documented backfill-resilience behavior.

---
*Phase: 39-entity-data-model*
*Completed: 2026-05-20*
