---
phase: 83-token-reconciliation-layer
plan: 04
subsystem: testing
tags: [token-reconciliation, stop-adapter, reconcile, better-sqlite3, no-double-count, fallback-provenance]

# Dependency graph
requires:
  - phase: 83-03
    provides: "reconcile.mjs reconcileRow/matchWireRow/computeDeltas + token-db.mjs probeWireRowByRequestId/reconcileGapFill"
  - phase: 75-03
    provides: "captureForegroundTokens + STOP_ADAPTERS registry (interactive transcript-capture path)"
provides:
  - "Reconcile branch in captureForegroundTokens (opts.reconcile) — match-then-enrich-or-fallback on MEASURED spans only"
  - "Structured reconciliation report { matched, unmatched_wire, unmatched_transcript, fallback, perRequest, flaggedCount } for the Plan-05 sink"
  - "Distinct fallback provenance marker (token-adapter-<agent>-fallback) via exported fallbackProcessFor"
  - "Post-loop unmatched_wire DB query over span-window orphan wire rows (never a silent 0)"
  - "Copilot D-04 session-state cache merge seam (gap-fill only, never overwrites wire cache)"
affects: [83-05, 83-06, 83-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "opts.reconcile dispatch gate: measured path returns a report OBJECT, interactive path returns an insert COUNT (both callers preserved)"
    - "Post-loop DB query for unmatched_wire (orphan detection) instead of per-row accumulation"
    - ":reason:N always-insert with NORMAL provenance vs genuine no-match fallback with DISTINCT provenance"

key-files:
  created:
    - "tests/token-adapters/reconcile-mode.test.js"
  modified:
    - "lib/lsl/token/stop-adapter-registry.mjs"

key-decisions:
  - "Reconcile gated on opts.reconcile only — interactive Stop/sweep path byte-identical (returns count); measured path returns the report object"
  - "unmatched_wire computed by a post-loop query over (task_id, user_hash != adapter) span-window rows minus matched request-ids — never defaulted to 0"
  - ":reason:N rows insert with normal provenance (expected always-insert), NOT the fallback marker (which flags proxy-down rows)"
  - "Copilot D-04 cache merge is an explicit per-wire-row override seam (opts.copilotCacheSplit); the normal aggregate cache already flows through reconcileRow's gap-fill during the loop, so blind re-application (over-count risk) is avoided"
  - "Fuzzy-matched wire ids re-probed via matchWireRow (read-only) so unmatched_wire excludes them"

patterns-established:
  - "Report-vs-count return polymorphism keyed on opts.reconcile keeps existing callers unbroken"
  - "Never-throw per-row reconcile: a reconcileRow failure degrades to a counted fallback, never blocks measurement-stop close"

requirements-completed: [D-01, D-02, D-04]

# Metrics
duration: 12min
completed: 2026-07-06
---

# Phase 83 Plan 04: Reconcile Branch in captureForegroundTokens Summary

**The no-double-count contract in action — `captureForegroundTokens(span, { reconcile: true })` replaces the blind insert loop with the Plan-03 match-then-enrich-or-fallback matcher on measured spans only, returning a structured reconciliation report while leaving the interactive Stop/sweep path byte-identical.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-06T13:29:09Z (worktree base)
- **Completed:** 2026-07-06T13:41:29Z
- **Tasks:** 1 (TDD)
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- Added the `opts.reconcile` branch to `captureForegroundTokens`: for claude/copilot it routes each transcript row through `reconcileRow` (match-then-enrich-or-fallback) instead of the blind `insertTokenRowDeduped` loop.
- Matched rows enrich the wire row IN PLACE via the Plan-03 gap-fill (zero net rows — the no-double-count invariant); no-match rows insert as counted fallbacks tagged with a distinct `token-adapter-<agent>-fallback` provenance marker.
- `:reason:N` rows bypass the window/match and always insert with normal provenance (wire never carries a reasoning-step split).
- `unmatched_wire` is computed by a POST-LOOP DB query over span-window orphan wire rows (never defaulted to 0), so Plan-07's `unmatched_wire === 0` golden property is a real assertion.
- Copilot D-04 cache merge seam wired via `reconcileGapFill` (fills cache-less matched wire rows only, never overwrites).
- `captureForegroundTokens` now returns `{ matched, unmatched_wire, unmatched_transcript, fallback, perRequest, flaggedCount }` on the measured path; the interactive path keeps returning the insert count.

## Task Commits

Each step committed atomically (TDD):

1. **Task 1 (RED): failing reconcile-mode suite** - `cba559d24` (test)
2. **Task 1 (GREEN): reconcile branch + helpers** - `6b617621b` (feat)

_No refactor commit needed — GREEN implementation was clean._

## Files Created/Modified
- `lib/lsl/token/stop-adapter-registry.mjs` - Added reconcile-mode imports (`reconcileRow`, `matchWireRow`, `reconcileGapFill`), the `fallbackProcessFor` export + `isReasonStep` helper, the `opts.reconcile` dispatch branch in `captureForegroundTokens`, and the `reconcileBatches` / `countUnmatchedWireRows` / `mergeCopilotSessionStateCache` helpers.
- `tests/token-adapters/reconcile-mode.test.js` - Seven-behavior reconcile suite (dispatch, match no-double-count, fallback provenance, :reason: always-insert, report shape, stamp-only guard, post-loop unmatched_wire) plus a copilot D-04 cache-merge check, on a temp DB pre-seeded with wire rows.

## Decisions Made
- **Report-vs-count return polymorphism:** keyed on `opts.reconcile` so existing (interactive) callers keep receiving a number and are never broken.
- **unmatched_wire via post-loop query:** orphan wire rows are span-window rows with the span's `task_id`, a `user_hash` different from the adapter, and a `tool_call_id` never matched during the loop — explicitly counted, never a silent default.
- **:reason:N provenance:** always-inserted with normal provenance (not the fallback marker), since it is an expected always-insert rather than a proxy-down fallback.
- **Copilot D-04 cache merge (Claude's Discretion per PLAN):** implemented as an explicit per-wire-row override seam (`opts.copilotCacheSplit`) applied post-loop via `reconcileGapFill`. In the normal path the copilot transcript rows already carry the session-state cache split, so a matched wire row is enriched during the loop; the explicit seam avoids blindly re-applying the per-session aggregate across multiple wire rows (over-count risk).
- **Fuzzy match id tracking:** a fuzzy-matched wire row's id differs from the transcript id, so it is re-probed (read-only `matchWireRow`) to keep `unmatched_wire` accurate.

## Deviations from Plan

None - plan executed exactly as written. The copilot session-state read mechanics were explicitly delegated to Claude's Discretion by the PLAN; the chosen approach (explicit override seam + reliance on the in-loop gap-fill for the normal path) is documented above.

## Issues Encountered
None.

## Verification

- `node --test tests/token-adapters/reconcile-mode.test.js` → 8/8 pass (seven behaviors + copilot D-04).
- `node --test tests/token-adapters/token-db-dedup-merge.test.js` → 4/4 pass (interactive dedup-merge path — zero regression).
- `node --test tests/lsl/token/stop-adapter-registry.test.mjs` → 9/9 pass (Phase-75 interactive capture — zero regression).
- `node --test tests/token-adapters/reconcile-matcher.test.js` → 13/13 pass (Plan-03 matcher — zero regression).

## TDD Gate Compliance
- RED gate: `cba559d24` (test) — 6 failing reconcile behaviors before implementation.
- GREEN gate: `6b617621b` (feat) — all 8 passing after implementation.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 05 (measurement-stop sink) can now call `captureForegroundTokens(span, { reconcile: true })` and consume the returned report to write the reconciliation sink.
- Plan 05 must pass `reconcile: true` on the measured path only; the interactive Stop/sweep path continues to call without the flag (unchanged).

---
*Phase: 83-token-reconciliation-layer*
*Completed: 2026-07-06*
