---
phase: 39-entity-data-model
verified: 2026-05-20T18:30:00Z
status: passed
score: 4/4
overrides_applied: 1
overrides:
  - must_have: "The B KGEntity/SharedMemoryEntity replaced by canonical KM-Core entity — no consumer compiles against the old dual shape"
    reason: "CONTEXT.md <deferred> block and ROADMAP explicitly defer SC#3 to Phase 42 (INT-02 B migration). Phase 39's contribution is confirming the canonical Entity covers B's dual shape (createdBy/entityType coverage confirmed in 39-RESEARCH.md). The SharedMemoryEntity swap is Phase 42 scope."
    accepted_by: "project-context (39-CONTEXT.md explicit deferral)"
    accepted_at: "2026-05-20T00:00:00Z"
known_bugs:
  - id: CR-01
    severity: warning
    description: "batch() Phase-1 parseEntityId rejects non-v7 predecessor ids in the supersession closure — cross-epoch case (legacy-id entity superseded by v7 entity on strict path) will throw."
    affected_phases: "Phase 42 if it exercises strict-path supersession of legacy-id entities; not a Phase 40/41 blocker."
    fix: "Pass { skipOntologyCheck: true } per-op in the batch call inside the supersession closure, OR two sequential trusted-path putEntity calls."
  - id: CR-02
    severity: warning
    description: "BackfillResult.skipped double-counts on resume because prior.skipped carries forward AND resume-cursor skips increment skipped again. The stamped counter (resumability-critical) is correct."
    affected_phases: "Display/reporting only; Phase 41/42/43 migration correctness is unaffected."
    fix: "Initialize skipped = 0 (fresh per-run); keep stamped = prior?.stamped ?? 0 (cumulative)."
---

# Phase 39: Entity Data Model Verification Report

**Phase Goal:** Lock the canonical KM-Core entity shape with first-class temporal validity (`validFrom`, `validUntil`, `supersedes`) and structured provenance (`createdBy`, `lastConfirmedBy`, `confirmationCount`, per-segment provenance) before B and C migrate, so neither has to backfill twice.

**Verified:** 2026-05-20T18:30:00Z
**Status:** passed
**Re-verification:** No — initial verification
**Test suite:** 90/90 GREEN (9 test files, 4 Phase 39 plans, km-core repo)

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Every KM-Core entity surfaces `validFrom`, `validUntil`, `supersedes` AND superseded entity is reachable via chain query API (SC#1) | VERIFIED | `entity.ts` declares all three fields; `putEntity` D-31 auto-stamps `validFrom`; D-33 closure auto-stamps `validUntil` on predecessor; `getSupersessionChain(id)` public method in `GraphKMStore.ts:555-613`; 12 D-33/D-34/D-35 tests passing |
| 2 | Every KM-Core entity surfaces `createdBy`, `lastConfirmedBy`, `confirmationCount`, and per-segment provenance, populated by the writer (SC#2) | VERIFIED | D-32 EntityProvenance assembly in `GraphKMStore.putEntity` (lines 371-393); `mergeDescriptionSegment` in `src/segments/merge.ts`; 5 D-30/D-31/D-32 tests + 8 segments-merge tests passing |
| 3 | B `KGEntity`/`SharedMemoryEntity` replaced by canonical KM-Core entity (SC#3) | PASSED (override) | Override: CONTEXT.md `<deferred>` block and ROADMAP explicitly defer SC#3 to Phase 42 INT-02. Phase 39 contribution is the RESEARCH.md coverage audit confirming canonical Entity covers all 16 B fields. No code change to persistence-agent.ts in this phase — accepted by project-context on 2026-05-20 |
| 4 | Backfill can stamp `validFrom = createdAt` (A) or `validFrom = first-seen` (B) on legacy entities without losing observations or relations (SC#4) | VERIFIED | `backfillEntityDataModel(store, options)` in `src/backfill/index.ts` (248 lines); trusted-path pre-stamp preserves all existing fields; atomic checkpoint via `writeCheckpointAtomic`; 9 backfill tests passing; CR-02 affects `skipped` counter only — `stamped` (resumability) is correct |

**Score:** 4/4 truths verified (1 via accepted override, 1 with known CR-02 non-blocking bug)

---

### Deferred Items

SC#3 is not deferred in the Step 9b sense (it is explicitly overridden via the project-approved CONTEXT.md deferral to Phase 42). No other must-haves are deferred.

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/store/GraphKMStore.ts` | putEntity with opts.provenance; validFrom + EntityProvenance stamping; D-33 supersession closure; D-34 active-only filter; D-35 getSupersessionChain | VERIFIED | 776 lines; all 5 edit sites confirmed by grep and code read; `parseEntityId` on line 630 in batch() Phase-1 is CR-01 (legacy-id predecessor throws — non-blocking for SC#1 normal case) |
| `src/store/types.ts` | PutEntityOpts public type | VERIFIED | 57 lines; `PutEntityOpts { skipOntologyCheck?, provenance? }` exported; `ProvenanceStamp` imported via `.js` suffix |
| `src/types/entity.ts` | JSDoc tightening (no new fields) | VERIFIED | 184 lines; all temporal + provenance fields carry D-31/D-32/D-33 writer-contract JSDoc; no new fields added |
| `src/segments/merge.ts` | mergeDescriptionSegment pure helper | VERIFIED | 140 lines; `normalize()`, `MAX_SEGMENTS_WARN=100`, `MAX_CONFIRMATIONS_WARN=50`, D-39 deep-clone, D-40 case-sensitive whitespace-normalize, D-41 stderr-warn |
| `src/segments/index.ts` | Sub-barrel re-export | VERIFIED | 10 lines; `export { mergeDescriptionSegment } from './merge.js'` |
| `src/backfill/index.ts` | backfillEntityDataModel library function | VERIFIED | 248 lines; D-37 idempotency (validFrom-skip); D-38 resumability; D-38 dryRun; path-traversal guard; CR-02: `skipped = prior?.skipped ?? 0` carries forward (display-only bug) |
| `src/backfill/checkpoint.ts` | Atomic checkpoint helper | VERIFIED | 85 lines; `writeCheckpointAtomic` (temp+rename idiom); `readCheckpoint` returns null on ENOENT; `Checkpoint` interface with `version: 1` |
| `src/index.ts` | Root barrel exports mergeDescriptionSegment + backfillEntityDataModel + types | VERIFIED | 89 lines; `mergeDescriptionSegment` at line 76; `backfillEntityDataModel` at line 84; `BackfillOptions/BackfillResolver/BackfillResult` type exports at lines 85-89 |
| `tests/unit/graph-store.test.ts` | 5 D-30/D-31/D-32 tests + 12 D-33/D-34/D-35 tests | VERIFIED | 706 lines; 30 tests in this file (18 prior + 12 new); all 5 Plan-01 + 12 Plan-03 test names present verbatim |
| `tests/unit/segments-merge.test.ts` | 8 D-39/D-40/D-41 boundary tests | VERIFIED | 241 lines; 8 tests covering D-40 cases a/b/c/e/g, D-41 thresholds, D-39 purity |
| `tests/unit/backfill.test.ts` | 9 D-36/D-37/D-38 + path-traversal tests | VERIFIED | 367 lines; 9 tests covering stamps, idempotency, dryRun, provenance, legacyId, checkpoint, path-traversal, resume |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `GraphKMStore.putEntity` strict path | D-30 provenance throw | `if (!opts?.provenance)` inside `if (!trusted)` | WIRED | Line 319-323 of GraphKMStore.ts confirmed |
| `GraphKMStore.putEntity` strict path | EntityProvenance assembly | `graph.hasNode(id)` create-vs-confirm branch | WIRED | Lines 371-393 confirmed |
| `GraphKMStore.putEntity` strict path | D-33 supersession closure | `if (entity.supersedes !== undefined && !existing)` | WIRED | Lines 404-438 confirmed; CR-01 applies to cross-epoch case only |
| `GraphKMStore.findByOntologyClass` / `iterate` | D-34 active-only filter | `private isActive(entity, nowMs)` with `validUntil === undefined` short-circuit | WIRED | Lines 482-485, 499-543, 686-698 confirmed |
| `GraphKMStore.getSupersessionChain` | supersedes chain walk | backward via `entity.supersedes` + forward via `SUPERSEDED_BY` out-edges | WIRED | Lines 555-613 confirmed; cycle-guarded via `visited` Set |
| `mergeDescriptionSegment` | D-40 whitespace normalize | `text.trim().replace(/\s+/g, ' ')` in private `normalize()` | WIRED | Line 54 of merge.ts confirmed |
| `backfillEntityDataModel` | trusted-path pre-stamp | `store.putEntity(stampedEntity, { skipOntologyCheck: true })` | WIRED | Line 231 of backfill/index.ts confirmed |
| `backfillEntityDataModel` | atomic checkpoint | `writeCheckpointAtomic` after each entity write | WIRED | Lines 244 of backfill/index.ts; `checkpoint.ts` atomic rename confirmed |
| Root barrel `src/index.ts` | `mergeDescriptionSegment` | `export { mergeDescriptionSegment } from './segments/merge.js'` | WIRED | Line 76 confirmed |
| Root barrel `src/index.ts` | `backfillEntityDataModel` | `export { backfillEntityDataModel } from './backfill/index.js'` | WIRED | Line 84 confirmed |

---

### Data-Flow Trace (Level 4)

All Phase 39 artifacts are library primitives (no rendering, no dynamic data display). Level 4 data-flow trace is not applicable — there is no component→API→DB rendering chain. The vitest suite serves as the functional data-flow verification.

---

### Behavioral Spot-Checks

The km-core library has no runnable server entry point. Tests serve as the behavioral verification layer.

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 90/90 vitest tests GREEN | `cd /Users/Q284340/Agentic/km-core && npm test` | 9/9 test files PASSED, 90/90 tests PASSED, Duration 670ms | PASS |
| TypeScript strict-mode build clean | `cd /Users/Q284340/Agentic/km-core && npm run build` | exit 0 (tsc strict mode clean) | PASS |
| All Phase 39 commits on km-core main | `git -C km-core log --oneline -8` | 8 commits: efaddd3, 2320a89, abea43a, 8ed92bd, 11e9018, aa800ba, 374c27c, 0cd51ea | PASS |

---

### Probe Execution

No `scripts/*/tests/probe-*.sh` probes declared for Phase 39. SKIPPED — Phase 39 is a library-only phase; behavioral verification done via vitest.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| DATA-01 | 39-03-PLAN.md, 39-04-PLAN.md | All entities carry `validFrom`, `validUntil`, `supersedes` fields | SATISFIED | D-31 auto-stamps `validFrom`; D-33 closure auto-stamps `validUntil`; `supersedes` field declared and used; backfill stamps `validFrom` on legacy entities |
| DATA-02 | 39-01-PLAN.md, 39-02-PLAN.md | Structured provenance fields (`createdBy`, `lastConfirmedBy`, `confirmationCount`, per-segment provenance) on every entity | SATISFIED | D-32 EntityProvenance assembly in `putEntity`; `mergeDescriptionSegment` for per-segment confirmations; trusted-path pre-stamp in backfill |

Both DATA-01 and DATA-02 are mapped to Phase 39 in `REQUIREMENTS.md` traceability table. Both satisfied. No orphaned requirements.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/backfill/index.ts` | 161 | `let skipped = prior?.skipped ?? 0` (CR-02: double-counts skipped on resume) | Warning | `skipped` counter over-reports on resumed runs. `stamped` counter is correct. Display-only bug; does not affect backfill correctness or Phase 41/42/43 readiness. |
| `src/store/GraphKMStore.ts` | 628-630 | `batch()` Phase-1 calls `parseEntityId` unconditionally on every putEntity op's id (CR-01: rejects non-v7 ids in supersession closure for cross-epoch case) | Warning | D-33 supersession closure calls `this.batch([closedOld, entity])`; if `closedOld` has a non-v7 id (legacy nanoid, C's layer-prefix), batch Phase-1 throws. Normal v7→v7 supersession (all 39-03 tests) passes. Cross-epoch case only exercised by Phase 42 migration or explicit mixed-id supersession. Not a Phase 40/41 blocker. |

No `TBD`, `FIXME`, `XXX`, `console.*`, or unreferenced debt markers found in any Phase 39 source file.

---

### Human Verification Required

None. Phase 39 is a pure library phase (no UI, no REST server, no external service integration). All behaviors are unit-testable and verified by the 90/90 vitest suite.

---

### Gaps Summary

No blocking gaps. The phase delivers its stated goal: the canonical KM-Core entity shape is locked with temporal validity and structured provenance, and the backfill function enables legacy A/B migrations.

Two known bugs identified by the code review (CR-01 and CR-02) are documented as warnings. They do not block Phase 40 (PIPE-01), Phase 41 (INT-01), or Phase 42 (INT-02):

- **CR-01** (batch parseEntityId cross-epoch supersession): Only affects strict-path supersession where the predecessor has a non-v7 id. Phase 40 (ingest pipeline) and Phase 41 (A adapter) will use v7-id entities exclusively. Phase 42 (B migration) may encounter this if it supersedes legacy-keyed entities on the strict path — the fix should land before Phase 42 plans that exercise supersession of legacy entities.

- **CR-02** (skipped counter double-count on resume): Purely a display/reporting stat. The `stamped` counter (the resumability guarantee) is correct and cumulative. Phase 41/42/43 migration scripts can rely on `result.stamped`.

**Recommended follow-up before Phase 42 plan execution:** Create a Phase 42 plan task to fix CR-01 (two sequential trusted-path puts instead of `this.batch([])` in the supersession closure) before any plan that exercises mixed-epoch supersession.

---

_Verified: 2026-05-20T18:30:00Z_
_Verifier: Claude (gsd-verifier)_
