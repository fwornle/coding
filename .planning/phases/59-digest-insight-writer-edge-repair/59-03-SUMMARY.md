---
phase: 59-digest-insight-writer-edge-repair
plan: 03
subsystem: live-logging / observation-consolidator
tags:
  - consumer-refactor
  - D-03
  - orphan-insight-root-cause
  - phase-59-wave-2
requirements:
  - ORPHAN-INS-01
dependency-graph:
  requires:
    - "Plan 59-01 — writeInsight returns {legacyId, mintedId} (D-03 writer-side)"
  provides:
    - "_pushInsightToKG consumes writeInsight's {legacyId, mintedId} directly — findByLegacyId race window closed at the OC.js:660 call site"
  affects:
    - src/live-logging/ObservationConsolidator.js (OC.js:654-665 — 12-line block surgically rewritten to 10 lines)
    - src/live-logging/ObservationWriter.test.js (Phase 58 Test 7 mock writer return shape updated to {legacyId, mintedId})
tech-stack:
  added: []
  patterns:
    - "consumer reads writer-returned mintedId directly (no post-write re-derive)"
    - "byte-level surgical refactor: comment block + try-body only; catch + downstream has_insight follower identical"
    - "mock writer with per-test return/throw override (parallel to Plan 59-01's writer-side mock pattern)"
key-files:
  created:
    - .planning/phases/59-digest-insight-writer-edge-repair/59-03-SUMMARY.md
  modified:
    - src/live-logging/ObservationConsolidator.js
    - src/live-logging/ObservationConsolidator.test.js
    - src/live-logging/ObservationWriter.test.js
decisions:
  - "D-03 locked at consumer: _pushInsightToKG reads result.mintedId from writer.writeInsight() return; the OC.js:660-661 findByLegacyId race lookup is removed."
  - "Pre-existing Phase 58 Test 7 in ObservationWriter.test.js (route-through end-to-end) needed its mock writer's return value changed from `row.id` (bare string) to `{legacyId: row.id, mintedId}` so the refactored consumer can derive mintedId. Documented as Rule 1 deviation below — the test had encoded the old race-lookup path."
  - "Tests use the same node:test + createMockKmStore convention established in Phase 58 Plan 02 Task 3 and reused by Plan 59-02 (this plan's predecessor in OC.test.js). New helpers added: createMockWriter (per-test writeInsight override), installFetchStub (stubs globalThis.fetch for _ensureProjectAnchor + classifyMentions), seedProjectAnchor (pre-seeds Project entity for has_insight resolution)."
  - "The 3 new tests (Test 5/6/7) call _pushInsightToKG directly rather than going through consolidateDay — the path under test is the writer-consumer boundary, not the whole consolidation loop."
metrics:
  duration_minutes: 22
  completed_date: 2026-06-17
  task_count: 2
  files_modified: 3
  tests_added: 3
  tests_passing_oc: 7
  tests_passing_ow: 12
  it_count_pre_edit: 4
  it_count_post_edit: 7
---

# Phase 59 Plan 03: _pushInsightToKG Consumer Refactor (D-03) Summary

ObservationConsolidator._pushInsightToKG now reads the freshly-minted km-core
entity id directly from `ObservationWriter.writeInsight`'s `{legacyId, mintedId}`
return shape (which Plan 59-01 shipped) instead of paying the post-write
`findByLegacyId({system:'A', id: entry.topic})` race lookup. That race window —
observed 2026-06-15 at a ~1-in-100 hit rate during the `Live Backfill
Pre-flight Procedure and Wave-Analysis Routing` orphan event — is now closed
at its root. The has_insight follower block at OC.js:679-705 is byte-identical
post-edit; its role shifts from race-safe lookup to idempotent re-write
protection (D-03.2).

## Tasks Executed

| Task | Name                                                                       | Commit      | Files                                                                                          |
| ---- | -------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| 1    | Refactor _pushInsightToKG to consume writeInsight's {legacyId, mintedId}   | `ba517fdbc` | `src/live-logging/ObservationConsolidator.js`, `src/live-logging/ObservationWriter.test.js`    |
| 2    | Three new unit tests covering the new direct-mintedId-read path            | `1955561d5` | `src/live-logging/ObservationConsolidator.test.js`                                             |

## Behavioural Contract Shipped

**Before (OC.js:654-665 — 12 lines):**

```js
let mintedId;
try {
  // writeInsight returns row.id (the legacyId.id), NOT the freshly
  // minted km-core id. For the has_insight edge we need the minted
  // km-core id — look it up via the legacyId after the write returns.
  await writer.writeInsight(row, { mentionsTargetIds });
  const persisted = await this._kmStore.findByLegacyId({ system: 'A', id: entry.topic });
  mintedId = persisted?.id || null;
} catch (err) {
  process.stderr.write(`[Consolidator→KG] writeInsight failed for ${entry.topic}: ${err.message}\n`);
  return;
}
```

**After (OC.js:654-663 — 10 lines):**

```js
let mintedId;
try {
  // D-03 — writeInsight now returns {legacyId, mintedId} directly; no post-write
  // findByLegacyId race lookup needed. The Phase 59 root-cause closure for ORPHAN-INS-01.
  const result = await writer.writeInsight(row, { mentionsTargetIds });
  mintedId = result.mintedId;
} catch (err) {
  process.stderr.write(`[Consolidator→KG] writeInsight failed for ${entry.topic}: ${err.message}\n`);
  return;
}
```

**Byte-identical preserved invariants** (verified by acceptance gates):

- The `let mintedId;` declaration at OC.js:654 — kept.
- The `try {` opening brace — kept.
- The catch block `} catch (err) { process.stderr.write(...); return; }` — kept byte-for-byte (same `[Consolidator→KG] writeInsight failed for ${entry.topic}: ${err.message}` text, same early `return;`).
- The `kgPushDebug` log block at OC.js:665-669 (now :663-667 post-edit) consuming `mintedId` — kept byte-for-byte.
- The has_insight follower block at OC.js:679-705 (now :677-703 post-edit) — kept byte-for-byte. The `if (projectName && mintedId)` guard, the `findByOntologyClass('Project')` lookup, the `findRelations` idempotency probe, and the `addRelation({from, to, type:'has_insight', metadata:...})` write are all unchanged.
- The Plan 59-02 derivedFrom loop in the Digest plain-insert branch (OC.js:~1271-1296) — untouched.
- The mentions-classifier block at OC.js:602-609 — untouched.
- `_relinkOrphanOnlineInsights` / `_classifyInsightByOntology` / `_ensureProjectAnchor` / the bridgeRemainingOrphans extension — all untouched.

## Tests

**ObservationConsolidator.test.js** — three new `node:test` cases added at the bottom of the file:

| Test | Name                                                                                                              | Coverage                                                                                                                                                                       |
| ---- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 5    | `reads mintedId from writeInsight return and emits has_insight with it (NOT via findByLegacyId)`                  | Mock writer returns `{legacyId: 'insight-topic-1', mintedId: 'mock-km-id-42'}`. Asserts callLog has 0 `findByLegacyId({system:'A', id:'insight-topic-1'})` during the call AND `has_insight` edge targets `mock-km-id-42`. |
| 6    | `skips has_insight emission cleanly when writer returns {legacyId, mintedId: null}`                               | Mock writer returns `{legacyId, mintedId: null}`. Asserts no exception, no `has_insight` edge — the `if (projectName && mintedId)` guard at OC.js:679 short-circuits cleanly.    |
| 7    | `catches writer.writeInsight throw, logs to stderr, returns without attempting has_insight`                       | Mock writer throws `Error('km-core down')`. Asserts stderr captures `[Consolidator→KG] writeInsight failed for insight-topic-3: km-core down`, and no `has_insight` addRelation is attempted. |

Three new helpers added to keep the test file self-contained:

- `createMockWriter({ writeInsightReturn, writeInsightThrows })` — per-test override of `writeInsight` return value AND throw behaviour.
- `installFetchStub({ mentionsResponse })` — stubs `globalThis.fetch` for both the `_ensureProjectAnchor` PUT/POST path AND the `classifyMentions` `/api/complete` proxy call. Returns the original fetch so the test can restore it in `finally{}`.
- `seedProjectAnchor(kmStore, projectId, name)` — pre-seeds the Project entity in the mock kmStore so `findByOntologyClass('Project')` returns it and the `has_insight` `from` lookup succeeds.

**Pre-edit baseline:** 4 passing tests (Plan 59-02 Tests 1-4 on derivedFrom).
**Post-edit total:** 7 passing tests; 0 failures; 0 regressions.
**Run command:** `node --test src/live-logging/ObservationConsolidator.test.js`

**ObservationWriter.test.js** — Phase 58 Test 7 (route-through end-to-end) mock writer return value updated from `row.id` (bare string) to `{legacyId: row.id, mintedId}`. See Rule 1 deviation below. 12/12 pass.

## Acceptance Criteria — Status

### Task 1 gates

| Gate                                                                                              | Status                                                                |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `node --check src/live-logging/ObservationConsolidator.js` exits 0                                | PASS                                                                  |
| `grep -cE "const\s+result\s*=\s*await\s+writer\.writeInsight"` returns ≥ 1                        | PASS (1)                                                              |
| `grep -cE "mintedId\s*=\s*result\.mintedId"` returns ≥ 1                                          | PASS (1)                                                              |
| `findByLegacyId({system:'A', id: entry.topic})` removed from _pushInsightToKG body                | PASS (awk-extracted method body returns 0)                            |
| `grep -cE "D-03 — writeInsight now returns"` returns ≥ 1                                          | PASS (1)                                                              |
| `grep -cE "type:\s*['\"]has_insight['\"]"` returns ≥ 1 (block preserved)                          | PASS (4 file-wide; 2 inside _pushInsightToKG: probe + write)          |
| `grep -cE "if\s*\(projectName && mintedId\)"` returns ≥ 1                                         | PASS (1)                                                              |
| `grep -cE "\[Consolidator→KG\] writeInsight failed for"` returns ≥ 1 (catch preserved)            | PASS (1)                                                              |
| `grep -cE "type:\s*['\"]derivedFrom['\"]"` returns ≥ 1 (Plan 59-02 preserved)                     | PASS (1)                                                              |
| No new console.* in OC.js                                                                         | PASS (0)                                                              |
| Exactly one production call site of writeInsight (excluding writer + tests)                       | PASS (1 — the OC.js:659 site this plan modifies)                      |

### Task 2 gates

| Gate                                                                                | Status                                                |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `node --test src/live-logging/ObservationConsolidator.test.js` exits 0              | PASS                                                  |
| Zero failures                                                                       | PASS (`fail 0`)                                       |
| At least 3 new test cases (`it(` count pre-edit + 3)                                | PASS (4 → 7)                                          |
| Mock writer return shape `{legacyId, mintedId}` present ≥ 2 times                   | PASS (4 — Test 5 + Test 6 each have 2 matches)        |
| `mintedId: null` short-circuit case present                                         | PASS (2 file-wide; Test 6 + helper default-clause docstring) |
| `D-03` narrative comments ≥ 3                                                       | PASS (13)                                             |
| All existing tests still pass (regression-free)                                     | PASS (4/4 Plan 59-02 + 3 new = 7/7)                   |
| No new console.* in the test file                                                   | PASS (0)                                              |

### Plan-level verification (success criteria)

- [x] _pushInsightToKG at OC.js:654-665 surgically rewritten per D-03 to consume `writeInsight`'s `{legacyId, mintedId}` return directly.
- [x] The findByLegacyId race lookup is REMOVED from the method body (awk-grep returns 0).
- [x] The has_insight follower at OC.js:679-705 is byte-identical post-edit.
- [x] The catch block at OC.js:662-664 is byte-identical post-edit (fail-fast contract preserved).
- [x] The Plan 59-02 derivedFrom loop in the digest-insert branch is preserved.
- [x] Three new consumer-side unit tests prove the new shape; the pre-existing Phase 58 Test 7 in OW.test.js updated to the new writer return shape.
- [x] ORPHAN-INS-01 closed at the writer-path level; the 24h soak in Plan 59-05 will confirm the orphan-floor effect in production.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Phase 58 Test 7 mock writer return value broke under the refactored consumer**

- **Found during:** Task 1 post-edit verification (ran `node --test src/live-logging/ObservationWriter.test.js` after the OC.js edit).
- **Issue:** The mock writer at OW.test.js:409-423 returned `row.id` (a bare string) from its stubbed `writeInsight`. Under the refactored consumer (`mintedId = result.mintedId`), `result` is the bare string `row.id`, so `result.mintedId` evaluates to `undefined` — the `if (projectName && mintedId)` guard short-circuited and the `has_insight` assertion at line 480 failed with `0 !== 1`. The test had encoded the OLD findByLegacyId race-lookup path and could not be left untouched once the consumer was refactored.
- **Fix:** Updated the mock writer's `writeInsight` to return `{legacyId: row.id, mintedId: 'minted-insight-1'}` — the new D-03 return shape that Plan 59-01 locked at the writer side. Added a comment explaining the update references Phase 59 Plan 03 (D-03). The mock's side effect of populating `kmStore._entities` with the minted Insight is preserved (back-compat for any other test that touches that store state).
- **Files modified:** `src/live-logging/ObservationWriter.test.js`.
- **Commit:** `ba517fdbc` (folded into Task 1's implementation commit because the test mock was inseparably tied to the consumer rewrite — a test that pre-supposes the old contract cannot coexist with the new one in a clean intermediate commit).
- **Plan text awareness:** Plan 03 Task 2's `<action>` block explicitly calls this case out — "Pre-existing _pushInsightToKG tests (if any) that asserted the findByLegacyId race-lookup path must be UPDATED to reflect the new direct-mintedId-read path." This deviation is the exact case that callout anticipated, so it is documented here rather than as a surprise.

**No other deviations.** No Rule 2 (missing critical functionality), Rule 3 (blocking issue), or Rule 4 (architectural change) deviations occurred. The refactor and tests landed exactly as the plan specified.

### Auth Gates

None.

## Risks & Follow-Ups

- **Live verification deferred to Plan 59-05.** The unit-level tests prove the writer-consumer contract is locked; the production-side proof that orphan Insights no longer mint comes from the 24h soak harness in Plan 59-05 (per the phase plan).
- **No integration test in this plan.** The two writer-side test suites (`ObservationWriter.test.js` + `ObservationConsolidator.test.js`) are independent; both must pass before `_pushInsightToKG` executes against the live writer. End-to-end (write → JSON export → reload → has_insight edge present) lives in Plan 59-04.
- **The has_insight findRelations probe at OC.js:684-690 is now belt-and-suspenders.** Pre-D-03 it served the race-safe lookup; post-D-03 its only role is idempotent re-write protection if the consolidator runs again on the same Insight in the same export window. The block is kept verbatim because (a) Phase 59 explicitly scopes D-03 to the OC.js:654-665 try-block and (b) deleting it would require a separate idempotency analysis that is out of scope.
- **No CLAUDE.md submodule rebuild needed.** `ObservationConsolidator.js` lives at the top of the coding repo, not inside a Docker-bind-mounted submodule. The next obs-api launchd kickstart will pick up the change at runtime; that is a /gsd:execute-phase concern, not a planning concern.

## Threat Flags

None. Plan 59-03's threat model identified no new trust boundaries, no new package installs, no new I/O surface, and no new disclosure surface. The refactor is purely a consumer-side data-flow change; the race window it closes is a correctness improvement (smaller race surface ≠ broader threat surface).

## Self-Check: PASSED

**Files asserted to exist:**

- `src/live-logging/ObservationConsolidator.js` — FOUND (modified; lines 654-663 carry the new direct-mintedId-read pattern; awk-grep for `findByLegacyId({system:'A', id: entry.topic})` inside `_pushInsightToKG` body returns 0).
- `src/live-logging/ObservationConsolidator.test.js` — FOUND (modified; 7 `it(` blocks post-edit, +260 lines).
- `src/live-logging/ObservationWriter.test.js` — FOUND (modified; Phase 58 Test 7 mock writer return updated to `{legacyId, mintedId}`).
- `.planning/phases/59-digest-insight-writer-edge-repair/59-03-SUMMARY.md` — FOUND (this file).

**Commits asserted to exist:**

- `ba517fdbc` — FOUND in `git log` (`refactor(59-03): _pushInsightToKG consumes writeInsight {legacyId, mintedId} (D-03)`).
- `1955561d5` — FOUND in `git log` (`test(59-03): lock _pushInsightToKG direct-mintedId-read path (D-03)`).
