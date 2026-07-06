---
phase: 83-token-reconciliation-layer
plan: 08
subsystem: token-reconciliation
tags: [reconciliation, token-usage, sqlite, cladpt, gap-fill, unmatched-wire, aggregate-deltas]

# Dependency graph
requires:
  - phase: 83-token-reconciliation-layer (plans 03/04/05/07)
    provides: reconcile matcher (reconcileRow/matchWireRow/computeDeltas), RECONCILE_GAP_FILL_SQL, reconcileBatches, reconciliation.json sink, golden-comparison acceptance
provides:
  - "aggregatePerRequestDeltas() pure roll-up helper — reconciliation.json summary.aggregateDeltas now carries real per-field sums (CR-01)"
  - "unmatched_wire computed from a pre-loop wire-row PK snapshot minus matched PKs — meaningful for production cladpt claude spans (CR-02)"
  - "RECONCILE_GAP_FILL_SQL task_id backfill — interactive-launch spans (task_id='' wire rows) recover foreground attribution at reconcile time (CR-03)"
affects: [phase-86-reconciliation-badge, token-attribution, interactive-launch-measurement]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pre-loop PK snapshot to classify rows by identity when user_hash/process are ambiguous (wire vs transcript share cladpt for claude)"
    - "CASE-guarded span-scoped task_id stamp (never overwrite an existing binding) — recovery without ambient inheritance (D-08 preserved)"

key-files:
  created: []
  modified:
    - lib/lsl/token/reconcile.mjs
    - lib/lsl/token/token-db.mjs
    - lib/lsl/token/stop-adapter-registry.mjs
    - scripts/measurement-stop.mjs
    - scripts/launch-agent-common.sh
    - tests/token-adapters/reconcile-matcher.test.js
    - tests/token-adapters/reconcile-mode.test.js

key-decisions:
  - "aggregateDeltas roll-up extracted to an exported pure helper (aggregatePerRequestDeltas) so the sink and its unit test share one source of truth; the helper unwraps .delta before summing (the inverse of the dead typeof-number guard)"
  - "unmatched_wire keys on ROW IDENTITY (pre-loop PK snapshot), not user_hash exclusion or process — because for claude the proxy tap stamps the SAME cladpt hash the adapter uses; only the PK separates wire from transcript rows"
  - "task_id backfill uses CASE WHEN task_id='' THEN ? ELSE task_id END — a span-scoped stamp on an already-matched transcript row; a pre-bound task_id is never overwritten, so no cross-span leakage (honors D-08 no-inherit)"
  - "reconcileRow now returns wireRowId + wireToolCallId directly, eliminating the fuzzy re-probe (PK feeds the unmatched diff; tool_call_id feeds the copilot cache-merge)"

patterns-established:
  - "Identity-based row classification: when two logical row classes are indistinguishable by column values, snapshot their PKs before the mutating loop and diff after"
  - "Recovery-at-reconcile: attribution lost at capture (blank x-task-id) is restored by a guarded, span-scoped backfill rather than by re-introducing ambient inheritance"

requirements-completed: [D-04, D-05, D-08, D-12]

# Metrics
duration: 40min
completed: 2026-07-06
---

# Phase 83 Plan 08: Reconciliation Gap-Closure (CR-01/CR-02/CR-03) Summary

**Closed the three verified BLOCKERs from 83-VERIFICATION.md: reconciliation.json now reports real per-field aggregate deltas, a meaningful cladpt orphan `unmatched_wire`, and recovered foreground attribution for interactive-launch spans — all via surgical host-side fixes with no proxy/docker rebuild.**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-07-06 (worktree agent-ae976aa773ce3ad46)
- **Completed:** 2026-07-06
- **Tasks:** 3 (all TDD: RED → GREEN)
- **Files modified:** 7 (5 source + 2 test)

## Accomplishments

### CR-01 — aggregateDeltas roll-up (D-05 / D-12)
- Added exported pure helper `aggregatePerRequestDeltas(perRequest)` to `reconcile.mjs`, placed adjacent to `computeDeltas`. It unwraps each field's `.delta` number from the `{wire,transcript,delta,flagged}` object before accumulating, and never throws on null/undefined/non-object entries.
- Replaced the dead inline roll-up in `measurement-stop.mjs` (the old `typeof val === 'number'` guard tested the whole delta object → always false → `aggregateDeltas` was always `{}`) with a single call to the helper.
- Result: `reconciliation.json` `summary.aggregateDeltas` carries the real per-field SUM of every `perRequest[].deltas[field].delta`.

### CR-03 — task_id backfill for interactive-launch spans (D-08)
- Extended `RECONCILE_GAP_FILL_SQL` with `task_id = CASE WHEN task_id = '' THEN ? ELSE task_id END` and added the matching `text(fields.task_id)` bind in `reconcileGapFill` (bind count aligned with `?` count; WHERE `tool_call_id` stays last).
- `reconcileRow` now passes `task_id: transcriptRow.task_id` (the span taskId) in the gap-fill fields object.
- Corrected the stale `launch-agent-common.sh` claude-case comment: an empty `TASK_ID` sends a blank `x-task-id` and per D-08 the tap stamps `task_id=''` (NO ambient `resolveLiveTaskId()` fallback); the span binding is recovered later by the gap-fill backfill.
- Result: a matched wire row with `task_id=''` is stamped the span task_id at reconcile time; `aggregateByTaskId(span.task_id)` recovers the foreground tokens. A pre-bound task_id is never overwritten.

### CR-02 — meaningful unmatched_wire for claude (D-04)
- Reworked `unmatched_wire` in `stop-adapter-registry.mjs` to a pre-loop wire-row PK snapshot (`snapshotWireRowIds`) minus the matched wire-row PKs (`matchedWireRowIds`). Deleted `countUnmatchedWireRows` (its user_hash-inequality exclusion dropped the exact cladpt rows it should count → structurally 0 for claude).
- Extended `reconcileRow` to return `wireRowId` (PK) and `wireToolCallId` directly, removing the fuzzy re-probe. The PK feeds the unmatched diff; the tool_call_id keeps the copilot cache-merge (`matchedRequestIds`) intact.
- Corrected the misleading `reconcile.mjs` header: for claude, wire and transcript rows share the `cladpt` hash (and `process`) — only the PK separates them.
- Result: a genuine cladpt orphan wire row is counted (>= 1); a fully-matched span reports 0; loop-inserted fallback/`:reason:` cladpt rows post-date the snapshot and are never miscounted.

## Deviations from Plan

None functionally — plan executed as written. Two mechanical adjustments to satisfy the plan's own acceptance greps (the greps assert the *literal strings* `typeof val === 'number'` and `user_hash != ` are absent from the source files): reworded two explanatory code comments that had reintroduced those literals while describing the OLD (removed) behavior. No behavior change.

Additional (beyond the plan's minimum, within scope):
- `[Rule 3 - Blocking]` Removed the now-unused `matchWireRow` import from `stop-adapter-registry.mjs` after dropping the fuzzy re-probe (would otherwise be an unused-import lint failure). Committed in the CR-02 GREEN commit.
- `[Rule 2 - Critical]` Added a CR-02b guard test (a loop-inserted cladpt fallback row is NOT counted as unmatched wire) to lock in the post-snapshot ordering invariant. The fallback fixture uses a distinct model so it genuinely does not fuzzy-match the sole wire candidate.
- Pinned the `:reason:` isolation fixture (Test 4) to a distinct `user_hash='wire01'` — the seedWireRow default change to `cladpt` would otherwise dedup-collide the always-inserted cladpt reason row with the seeded row, masking the intended 2-row observation.

## TDD Gate Compliance

Each of the three CRs followed RED → GREEN with the RED commit landing a failing test before the GREEN implementation:

| CR | RED (test) | GREEN (feat) |
|----|-----------|--------------|
| CR-01 | b48979db8 | 4a5d46d2b |
| CR-03 | 68140ba56 | 779fb73ed |
| CR-02 | 68832ede1 | 7c96efb08 |

## Verification

Full regression (all host-side, no proxy/docker rebuild):

| Suite | Result |
|-------|--------|
| tests/token-adapters/reconcile-matcher.test.js | 18 pass / 0 fail (13 existing + 5 CR-01 aggregate cases) |
| tests/token-adapters/reconcile-mode.test.js | 11 pass / 0 fail (8 existing + CR-02 orphan + CR-02b fallback-guard + CR-03 task_id) |
| tests/token-adapters/token-db-dedup-merge.test.js | 4 pass / 0 fail |
| tests/vkb-server/reconciliation-route.test.js | 5 pass / 0 fail |

Acceptance greps:
- CR-01: `measurement-stop.mjs` calls `aggregatePerRequestDeltas`; string `typeof val === 'number'` absent.
- CR-02: `stop-adapter-registry.mjs` has no `user_hash != ` exclusion; uses `matchedWireRowIds`.
- CR-03: `token-db.mjs` `RECONCILE_GAP_FILL_SQL` contains `task_id = CASE WHEN task_id`; launcher comment states the D-08 no-inherit rule.

End-to-end bind-alignment probe confirmed the extended `reconcileGapFill` binds `task_id` at the correct position (7 `?` / 7 binds).

## Expected Re-verification Outcome

The three FAILED truths in 83-VERIFICATION.md should flip to VERIFIED:
1. `aggregateDeltas` is the per-field SUM of perRequest deltas (not `{}` when deltas exist).
2. `unmatched_wire` counts a genuine cladpt orphan wire row (meaningful, not vacuous 0).
3. Interactive-launch spans (task_id='' wire rows) recover foreground attribution via reconcile-time task_id stamping.

No ambient inheritance reintroduced (D-08 preserved: the task_id stamp is span-scoped, applied only to already-matched transcript rows, and never overwrites an existing binding).

## Threat-Model Compliance

- T-83-08-01 (SQL injection): all new SQL (task_id backfill CASE + wire-row snapshot SELECT) uses `?` binds only; task_id/tool_call_id/user_hash never interpolated; values coalesced via existing `text()`/`num()`.
- T-83-08-02 (DoS): the roll-up helper, the snapshot query, and the count all preserve the best-effort/never-throw contract — a failure returns a safe default (empty aggregate / empty snapshot / 0 unmatched) and never blocks the measurement-stop close.
- T-83-08-03 (attribution tamper): the task_id CASE-guard stamps only when currently '' and only on tool_call_id-matched rows — span-scoped, no cross-span leakage.

## Self-Check: PASSED

All 7 modified files present on disk; all 7 commits (3 RED + 3 GREEN + docs) present in git history.
