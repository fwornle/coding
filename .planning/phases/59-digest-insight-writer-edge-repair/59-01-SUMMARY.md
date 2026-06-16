---
phase: 59-digest-insight-writer-edge-repair
plan: 01
subsystem: live-logging / observation-writer
tags:
  - writer-signature-refactor
  - D-03
  - orphan-insight-root-cause
  - phase-59-wave-1
requirements:
  - ORPHAN-INS-01
dependency-graph:
  requires: []
  provides:
    - "ObservationWriter.writeInsight new return shape `{legacyId, mintedId}` — consumed by Plan 59-03"
  affects:
    - src/live-logging/ObservationWriter.js (writeInsight signature widened; same-microtask ordering + ontologyClass guard byte-identical)
tech-stack:
  added: []
  patterns:
    - "writer surfaces minted id to caller (closes findByLegacyId race at consumer site)"
    - "byte-level surgical refactor: JSDoc + return statement only; method body identical otherwise"
key-files:
  created:
    - .planning/phases/59-digest-insight-writer-edge-repair/59-01-SUMMARY.md
  modified:
    - src/live-logging/ObservationWriter.js
    - src/live-logging/ObservationWriter.test.js
decisions:
  - "D-03 locked at writer: writeInsight returns {legacyId, mintedId}; writeDigest deliberately untouched (narrow D-03 boundary)."
  - "Tests use the same node:test + createMockKmStore convention established in Phase 58 Plan 02 Task 3; per-test putEntity override (parallel to the existing addRelationFn override pattern) was chosen over modifying the shared createMockKmStore signature — keeps the diff surgical and avoids touching pre-existing Tests 1-8."
  - "Acceptance-criterion grep for same-microtask ordering was too strict (matched comments containing `putEntity`); the actual call-site ordering (lines 26→30→31 inside the writeInsight body when viewed via awk extraction) was verified with a comment-filtered variant. Documented as a minor deviation (Rule 3) below."
metrics:
  duration_minutes: 12
  completed_date: 2026-06-16
  task_count: 2
  files_modified: 2
  tests_added: 3
  tests_passing: 12
  tests_pre_existing: 9
  it_count_pre_edit: 10  # per the plan's `(it|test)\(` grep pattern (1 false positive from string content)
  it_count_post_edit: 13
---

# Phase 59 Plan 01: writeInsight Signature Refactor Summary

ObservationWriter.writeInsight now returns `{legacyId, mintedId}` instead of just `row.id`, surfacing the freshly-minted km-core entity id to callers so they no longer need to re-derive it via the post-write `findByLegacyId` race lookup that pre-D-03 caused ~1-in-100 orphan Insights (observed 2026-06-15).

## Tasks Executed

| Task | Name                                                              | Commit      | Files                                                                                                 |
| ---- | ----------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------- |
| 1    | Refactor writeInsight to return `{legacyId, mintedId}`            | `fa9500e86` | `src/live-logging/ObservationWriter.js`                                                               |
| 2    | Three new unit tests covering the new return shape                | `62136ead1` | `src/live-logging/ObservationWriter.test.js`                                                          |

## Behavioural Contract Shipped

**Before (writeInsight):**
```js
return row.id;                           // single string
```
JSDoc: `@returns {Promise<string>} The persisted entity's legacyId.id (= row.id).`

**After (writeInsight):**
```js
return { legacyId: row.id, mintedId };   // object — mintedId is in-scope from putEntity at line 1309
```
JSDoc:
```
@returns {Promise<{legacyId: string, mintedId: string}>} legacyId is the
  stable system='A' surrogate (= row.id); mintedId is the freshly-minted
  km-core entity id (= return of internal kmStore.putEntity). The mintedId
  eliminates the post-write findByLegacyId race that pre-D-03 callers paid
  (Phase 59 D-03).
```

**Byte-identical preserved invariants** (verified by acceptance gates):

- `if (!entity.ontologyClass) entity.ontologyClass = 'Detail'` guard at OW.js:1304 — kept.
- `metadata.source ?? 'auto'` guard at OW.js:1305-1308 — kept.
- Same-microtask ordering: `putEntity` → `_emitMentionsEdges` → `_anchorEntity` at the real call sites (OW.js method body lines 1309 / 1313 / 1314) — kept.
- `try/catch` wrapper at OW.js:1296-1321 — kept; on error the function still throws (does not swallow).
- `process.stderr.write` log line at OW.js:1318 — kept verbatim.
- `writeDigest` at OW.js:1217-1240 — byte-identical (its return stays as `row.id` per the narrow D-03 boundary).

## Tests

Three new `node:test` cases were added to `src/live-logging/ObservationWriter.test.js`:

| Test | Name                                                                                       | Coverage                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 9    | `resolves to {legacyId, mintedId} with both fields as non-empty strings`                   | Mock putEntity returns `'minted-km-001'`; assert resolved object has exactly two own string-typed keys and field-level equality.      |
| 10   | `propagates putEntity return verbatim across multiple calls (no re-derive)`                | Mock putEntity returns computed-at-call-time ids (`mock-1`, `mock-2`, `mock-3`); each call's `mintedId` matches the captured value.   |
| 11   | `legacyId === row.id by construction, even when row.id is uuid-shaped`                     | row.id = `'d2c1f6c8-1234-4abc-9def-abcdef012345'`; assert `result.legacyId === row.id` byte-for-byte; `mintedId` differs from it.     |

**Pre-edit baseline:** 9 passing tests (the plan's `(it|test)\(` grep pattern reports 10 — one false positive from the words "test insight" inside a string).
**Post-edit total:** 12 passing tests (9 pre-existing + 3 new); 0 failures; 0 regressions.
**Run command:** `node --test src/live-logging/ObservationWriter.test.js`

## Acceptance Criteria — Status

### Task 1 gates

| Gate                                                              | Status                                                          |
| ----------------------------------------------------------------- | --------------------------------------------------------------- |
| `node --check src/live-logging/ObservationWriter.js` exits 0      | PASS                                                            |
| `grep -cE "return\\s*\\{\\s*legacyId:\\s*row\\.id, ..."` returns ≥ 1 | PASS (1)                                                        |
| Old return statement gone from writeInsight                       | PASS (0)                                                        |
| writeDigest still returns `row.id`                                | PASS (1)                                                        |
| JSDoc updated with new `@returns` shape                           | PASS (1)                                                        |
| Same-microtask ordering inside writeInsight                       | PASS (verified via comment-filtered variant — see deviation R3) |
| `ontologyClass` guard preserved                                   | PASS (1)                                                        |
| No new console.* introduced                                       | PASS (0)                                                        |
| `mintedId` referenced in writeInsight body                        | PASS (13 file-wide; 2 inside writeInsight body proper)          |

### Task 2 gates

| Gate                                                                                | Status                                                |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `node --test src/live-logging/ObservationWriter.test.js` exits 0                    | PASS                                                  |
| zero failures (`fail 0`)                                                            | PASS                                                  |
| Contract mentioned ≥ 3 times (`legacyId/mintedId/D-03`)                             | PASS (13)                                             |
| `(it|test)\(` count ≥ pre-edit + 3                                                  | PASS (13 ≥ 10 + 3 = 13)                               |
| Pre-existing tests still pass                                                       | PASS (9/9 + 3 new = 12/12)                            |
| No new console.* in test file                                                       | PASS (0)                                              |

### Plan-level verification (success criteria)

- [x] writeInsight returns `{legacyId, mintedId}` per D-03.
- [x] JSDoc documents the new return shape and references the D-03 rationale.
- [x] writeDigest at OW.js:1217-1240 is byte-identical post-edit.
- [x] Three new unit tests lock the contract; pre-existing tests remain green.
- [x] ORPHAN-INS-01 root-cause prerequisite shipped — the consumer refactor in Plan 59-03 can now read the mintedId directly instead of paying the findByLegacyId race cost.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Acceptance-criterion grep for same-microtask ordering was too strict**

- **Found during:** Task 1 verification.
- **Issue:** The plan-supplied awk one-liner that asserts ordering by piping the writeInsight body through `grep -nE "putEntity|_emitMentionsEdges|_anchorEntity"` includes lines 28-29 of the awk-extracted block, which are JSDoc-internal comments containing the literal token `putEntity` (e.g. `// same try-block as putEntity.`). Because the grep does not filter comment-only lines, the 2nd-line check ("expected `_emitMentionsEdges` second") fails on the comment match — the gate flags a false positive while the actual code ordering is correct.
- **Plan text claim:** "Comment-only matches are filtered upstream because the surviving lines are the real call sites within the method body."
- **Reality:** They are not filtered; only the body's call-site ordering is asserted via a more robust variant that prepends `grep -vE "^[0-9]+:\\s*(\\*|//)"` to drop comment lines before the awk ordering check.
- **Fix applied:** Used the comment-filtered variant locally to confirm the underlying invariant holds (real call-site lines: putEntity at body-line 26 → `_emitMentionsEdges` at body-line 30 → `_anchorEntity` at body-line 31). The code itself was not touched to "pass" the buggy gate (that would be constraint dodging); the gate was instead understood as a known plan-acceptance bug and the invariant verified with a corrected probe.
- **Files modified:** None (this is a verification-tooling deviation, not a code deviation).
- **Commit:** N/A.

**No other deviations.** No Rule 1 (bug), Rule 2 (missing critical functionality), or Rule 4 (architectural change) deviations occurred. The refactor and tests landed exactly as the plan specified.

### Auth Gates

None.

## Risks & Follow-Ups

- **Consumer side still has the race.** `ObservationConsolidator._pushInsightToKG` at OC.js:660-661 still calls `findByLegacyId({system:'A', id: entry.topic})` after `writeInsight` to re-derive the mintedId. That race remains live until Plan 59-03 ships. **This plan deliberately did not modify the consumer** — the writer-side contract change is the prerequisite, the consumer rewrite is Plan 59-03's scope.
- **No integration test in this plan.** The new contract is locked at the unit-test layer only. The integration test that proves end-to-end orphan-Insight closure (write → JSON export → reload → `has_insight` edge present) is the responsibility of Plan 59-04 (per the phase plan).
- **Phase 58 mock conventions preserved.** The new Tests 9-11 reuse the existing `createMockKmStore` helper and overlay a per-test `putEntity` override on the returned store object. This pattern is parallel to the existing `addRelationFn` override pattern at OW.test.js:64-65 — it does not change the shared helper signature and keeps Tests 1-8 untouched.

## Threat Flags

None. Plan 59-01's threat model identified no new trust boundaries, no new package installs, and no new I/O surface. The refactor is purely type-level; no new disclosure surface (mintedId is already exposed via km-core's REST `/api/v1/entities/:id`).

## Self-Check: PASSED

**Files asserted to exist:**

- `src/live-logging/ObservationWriter.js` — FOUND (modified, return statement at OW.js:1315 = `return { legacyId: row.id, mintedId };`, JSDoc at OW.js:1282-1286 documents the new contract).
- `src/live-logging/ObservationWriter.test.js` — FOUND (modified, 13 `(it|test)\(` matches post-edit, +117 lines).
- `.planning/phases/59-digest-insight-writer-edge-repair/59-01-SUMMARY.md` — FOUND (this file).

**Commits asserted to exist:**

- `fa9500e86` — FOUND in git log (`refactor(59-01): writeInsight returns {legacyId, mintedId} (D-03)`).
- `62136ead1` — FOUND in git log (`test(59-01): lock writeInsight {legacyId, mintedId} return shape (D-03)`).
