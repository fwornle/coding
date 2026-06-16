---
phase: 59-digest-insight-writer-edge-repair
plan: 02
subsystem: live-logging
tags: [km-core, observation-consolidator, derivedFrom, digest, atomicity, orphan-repair]

# Dependency graph
requires:
  - phase: 58-online-pipeline-semantic-edges-on-insights
    provides: "D-04 atomicity envelope (km-core JSON exporter 5s debounce capturing putEntity + addRelation in one export tick); _emitMentionsEdges per-edge try/catch precedent (OW.js:478-522)"
  - phase: 44-rest-api-git-snapshots
    provides: "GraphKMStore.putEntity / addRelation / findByLegacyId surface used by the consolidator's plain-insert path"
provides:
  - "Digest plain-insert branch of consolidateDay now emits one `derivedFrom` edge per resolvable observation_id in the SAME try-block as putEntity"
  - "Captures the minted km-core id from putEntity into `digestMintedId` (was previously discarded)"
  - "Per-edge try/catch swallow for non-fatal addRelation / findByLegacyId failures"
  - "D-02.2 skip-and-log behaviour: unresolved observation_ids (findByLegacyId returns null) are skipped non-fatally with a stderr log; the Digest still lands with its remaining edges"
  - "Unit-test harness for ObservationConsolidator (new file) with mock kmStore + callLog ordering assertions, mirroring ObservationWriter.test.js convention"
affects:
  - "Plan 59-03 (insight-side mirror in _pushInsightToKG) — same atomicity envelope applies"
  - "Plan 59-04 Layer 1 (repair script) — picks up the merge-branch gap and any race-window misses from D-02.2"
  - "Plan 59-05 24h soak — validates orphan floor stays at or below SC#4 threshold"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Phase 58 D-04 atomicity envelope applied verbatim to Digests — same try-block as putEntity, no probe-before-write on the writer path"
    - "Mock km-core store with callLog for ordering assertions (mirrors ObservationWriter.test.js Test 1 pattern from Phase 58 Plan 02)"
    - "LLM and embedder stubs on the ObservationConsolidator instance to drive consolidateDay end-to-end without a live proxy / Qdrant"

key-files:
  created:
    - "src/live-logging/ObservationConsolidator.test.js"
  modified:
    - "src/live-logging/ObservationConsolidator.js (plain-insert branch of consolidateDay at lines ~1294-1340 — captured digestMintedId, added derivedFrom emission loop)"

key-decisions:
  - "Phase 59 D-02.1 (no probe-before-write on the writer path) — accepted as-locked-in-plan. _buildDigestMergePlan dedups upstream, so the plain-insert branch only runs for genuinely new Digests; a probe-before-write would add per-edge findRelations cost that buys nothing on the normal path. The repair script (Plan 59-04) is the idempotent re-run path that DOES probe."
  - "Phase 59 D-02.2 (skip-and-log on unresolved observation_ids) — accepted as-locked-in-plan. Race window where findByLegacyId returns null is real (the writer may not yet have persisted an Observation when the consolidator runs); skipping the edge + stderr log is the correct non-fatal posture, with the next repair-script run backstopping."
  - "Merge branch (OC.js:1219-1267) intentionally NOT modified per plan must_haves — its derivedFrom backfill is acknowledged-deferred to Plan 59-04 Layer 1."
  - "Tests stub _publishEmbeddingEvent on the consolidator instance to prevent ioredis lazyConnect socket from keeping the event loop alive past the test body (would otherwise yield exit 124 from node --test). Tiny one-line stub addition, not a fix to the production code."

patterns-established:
  - "ORPHAN-DIG-01 writer-path emission pattern: capture mintedId from putEntity, then iterate observation_ids in the same try-block — resolve via findByLegacyId, skip-and-log on null, per-edge try/catch on addRelation. This is the canonical shape Plan 59-03 reuses for Insight → Digest (synthesizedFrom)."

requirements-completed:
  - ORPHAN-DIG-01

# Metrics
duration: ~30min
completed: 2026-06-16
---

# Phase 59 Plan 02: Digest derivedFrom Edge Emission Summary

**Plain-insert branch of consolidateDay now emits one `derivedFrom` edge per observation_id in the same try-block as putEntity, closing the ORPHAN-DIG-01 writer-path gap that left newly-inserted Digests as zero-degree km-core nodes.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-06-16T16:15Z (approx — based on PLAN_START_TIME marker)
- **Completed:** 2026-06-16T16:46:44Z
- **Tasks:** 2 (both TDD: RED then GREEN)
- **Files modified:** 1 production file + 1 new test file

## Accomplishments

- **Writer-path derivedFrom emission loop landed** at `src/live-logging/ObservationConsolidator.js` inside the `for (let i = 0; i < digestEntries.length; i++)` loop body of `consolidateDay`. The `digestMintedId` returned by `kmStore.putEntity` is now captured (was previously discarded) and used as the `from` of N `derivedFrom` edges, one per resolvable `obsId` in `d.observationIds`.
- **Atomicity envelope inherited from Phase 58 D-04** — the entire `putEntity` + N × `addRelation` sequence runs in the same try-block and same microtask batch, so the km-core JSON exporter's 5s debounce captures the whole thing in one export tick (concurrent readers either see the prior state with no Digest, or the new state with Digest + N edges).
- **Per-edge guards mirror OW.js:478-522** (the `_emitMentionsEdges` precedent from Phase 58): self-loop guard, `findByLegacyId`-failure swallow, `addRelation`-failure swallow. All logging via `process.stderr.write` per CLAUDE.md `no-console-log`.
- **D-02.2 skip-and-log** for the race window where an Observation referenced by `d.observationIds` is not yet persisted at consolidation time — the edge is skipped, a stderr log is emitted, and the Digest still lands with its remaining edges. The next repair-script run (Plan 59-04 Layer 1) catches the missed edge.
- **Unit-test harness for ObservationConsolidator** authored as a new file (none existed before). Four tests cover the happy path (3 edges with locked metadata shape), the D-02.2 skip path, atomicity ordering via callLog indices, and per-edge addRelation failure non-fatality. The mock kmStore mirrors `ObservationWriter.test.js`'s callLog convention.

## Task Commits

Each task was committed atomically following TDD RED/GREEN gates:

1. **Task 2 (RED): Failing tests for derivedFrom loop** — `3846bef8b` (`test(59-02): add failing tests for derivedFrom emission loop (RED)`)
2. **Task 1 (GREEN): derivedFrom emission loop implementation** — `64b62db82` (`feat(59-02): emit derivedFrom edges from Digest plain-insert path (GREEN)`)

_Note: Tasks were sequenced RED-first (test fixture committed showing failure) then GREEN (implementation makes them pass). The GREEN commit also includes a tiny test-side Redis-stub addition (3 lines) needed for `node --test` to exit cleanly — ioredis `lazyConnect` socket keeps the event loop alive past the test body otherwise._

## Files Created/Modified

- **`src/live-logging/ObservationConsolidator.js`** (modified, ~50 lines added at the plain-insert branch) — captured `digestMintedId` from `kmStore.putEntity`; added the derivedFrom emission loop with per-edge guards before `createdCount++`. The merge branch at OC.js:1219-1267 is byte-identical post-edit; the `digestedObsIds.add` and `createdCount++` lines survive unchanged in the plain-insert branch.
- **`src/live-logging/ObservationConsolidator.test.js`** (created, 380 lines) — node:test framework + mock kmStore with callLog ordering + four tests covering D-02 / D-02.1 / D-02.2 contracts.

## Decisions Made

See `key-decisions` in the frontmatter. Key points:

- **Followed D-02.1 (no probe-before-write) verbatim** — the upstream `_buildDigestMergePlan` dedups, so probe is redundant; the repair script does probe.
- **Followed D-02.2 (skip-and-log on null findByLegacyId) verbatim** — race window is real; skipping + stderr log is correct posture.
- **Merge branch deliberately not modified** — its backfill is owned by Plan 59-04 Layer 1's repair script per plan must_haves.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Stubbed `_publishEmbeddingEvent` in test harness to prevent event-loop leak**
- **Found during:** Task 2 (GREEN — running tests for the first time end-to-end)
- **Issue:** `consolidateDay` ends with a fire-and-forget Redis publish per digest via `_publishEmbeddingEvent` → `_initRedis` → `new Redis(...).connect()`. The ioredis client's `lazyConnect` socket keeps the Node event loop alive past the test body, so `node --test` exited 124 (timeout) even though all 4 tests passed.
- **Fix:** Added one line to the test's `createConsolidator()` helper: `consolidator._publishEmbeddingEvent = () => {};` — a fire-and-forget stub that satisfies the orthogonal Redis-publish path without touching production code. Redis publication is unrelated to the D-02 contract under test.
- **Files modified:** `src/live-logging/ObservationConsolidator.test.js` (3 lines: 1 stub + 2 explanatory-comment lines)
- **Verification:** `node --test src/live-logging/ObservationConsolidator.test.js` now exits 0; all 4 tests pass.
- **Committed in:** `64b62db82` (GREEN commit; the stub is colocated with the tests it unblocks)

---

**Total deviations:** 1 auto-fixed (1 blocking — test-runtime issue, no production code change)
**Impact on plan:** Trivial test-side adjustment; production code is exactly as the plan specified.

## Issues Encountered

- **None during planned work.** TDD RED → GREEN cycle ran cleanly; the only minor friction was the Redis event-loop leak (documented in Deviations).

## User Setup Required

None — `src/live-logging/` is top-level (no submodule), so no `npm run build` + docker rebuild is needed. The change is consumed in-process by the `com.coding.obs-api` launchd daemon. A `launchctl kickstart -k gui/$(id -u)/com.coding.obs-api` will be required at deployment time for the new code to take effect at runtime, but that is a `/gsd:execute-phase` concern (and is documented in the plan's Task 1 `<action>` block).

## Next Phase Readiness

- **Plan 59-03 (Insight → Digest synthesizedFrom)** can proceed in the same wave (Wave 1) — touches `_pushInsightToKG` (different method in the same file) and `ObservationWriter.writeInsight` (different file). No merge conflict possible with this plan's edits.
- **Plan 59-04 Layer 1 (repair script)** is unblocked — it will backstop both the merge-branch gap (intentionally deferred here) and any race-window misses from D-02.2 skip-and-log.
- **Plan 59-05 24h soak** can include this writer's emission rate in its dashboard once deployed.

## Self-Check

Verified before reporting completion:

- File `src/live-logging/ObservationConsolidator.js` — FOUND (modified).
- File `src/live-logging/ObservationConsolidator.test.js` — FOUND (created).
- Commit `3846bef8b` (RED) — FOUND in git log.
- Commit `64b62db82` (GREEN) — FOUND in git log.
- `node --check src/live-logging/ObservationConsolidator.js` — exit 0.
- `node --test src/live-logging/ObservationConsolidator.test.js` — exit 0; 4 pass / 0 fail.
- All 13 production-file acceptance greps pass (digestMintedId capture, derivedFrom literal inside loop, findByLegacyId resolution, metadata payload keys, merge branch untouched, createdCount + digestedObsIds.add survive, no new `console.*`, both stderr log phrases present, `ObservationWriter.js` unchanged).
- All 6 test-file acceptance greps pass (4+ test cases, callLog usage, derivedFrom references, findByLegacyId references, 3+ D-02 narrative comments, no `console.*`).

## Self-Check: PASSED

---
*Phase: 59-digest-insight-writer-edge-repair*
*Plan: 02*
*Completed: 2026-06-16*
