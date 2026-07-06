---
phase: 83-token-reconciliation-layer
plan: 05
subsystem: measurement / vkb-server
tags: [reconciliation, measurement-stop, api-route, token-attribution]
requires:
  - "83-04: captureForegroundTokens({ reconcile: true }) flat report + fallbackProcessFor"
  - "83-03: lib/lsl/token/reconcile.mjs matcher primitives"
provides:
  - "measurement-stop reconcile invocation + per-span reconciliation.json sink (D-01/D-12/D-06)"
  - "GET /api/experiments/runs/:taskId/reconciliation read-only route (D-13)"
affects:
  - "Phase 86 timeline badge (consumes the read route with zero backend work)"
tech-stack:
  added: []
  patterns:
    - "Best-effort try/catch sink at span close (mirrors fixture-archive contract)"
    - "handleTimeline/handleMeasurementActive file-read template (ENOENT -> 200 graceful-empty)"
key-files:
  created:
    - tests/vkb-server/reconciliation-route.test.js
  modified:
    - scripts/measurement-stop.mjs
    - lib/vkb-server/api-routes.js
decisions:
  - "83-05 owns the D-12 span-summary WRAPPER; Plan 04's flat return is not written verbatim"
  - "summary.aggregateDeltas is a per-field SUM rolled up from perRequest[].deltas (Plan 04 emits per-request only)"
  - "Graceful-empty ENOENT shape is { reconciliation: null }"
  - "flaggedCount recorded in summary but sets NO run-taint marker (D-06 advisory-only)"
metrics:
  duration_min: 12
  completed: "2026-07-06"
requirements: [D-01, D-06, D-12, D-13]
---

# Phase 83 Plan 05: Close the Reconcile Loop + Read-Only Route Summary

Wired the inert Plan-03/04 reconcile machinery into `measurement-stop`'s span-close path and exposed the result read-only, so a measured span now persists a self-contained `reconciliation.json` that Phase 86's badge can serve without any further backend work.

## What Was Built

**Task 1 — reconcile invocation + sink (`scripts/measurement-stop.mjs`, D-01/D-12/D-06).**
At the foreground-capture seam (section 3.0) the call now passes `{ agent, reconcile: true }` and captures the flat report Plan 04 returns (`{ matched, unmatched_wire, unmatched_transcript, fallback, perRequest, flaggedCount }`). This is the ONLY `reconcile: true` caller — the interactive Stop/sweep path is untouched. A new best-effort section (3.0b) assembles the D-12 shape around that flat return:
- a top-level `span` header (`task_id`, `agent`, `started_at`, `ended_at`);
- `summary.aggregateDeltas` computed as the per-field SUM of `perRequest[].deltas` across all requests (Plan 04 emits per-request deltas only — the roll-up is 83-05's);
- `matched / unmatched_wire / unmatched_transcript / fallback / flaggedCount` carried into `summary`;
- `perRequest` passed through unchanged;
- `schemaVersion: 1`.

Written to `.data/measurements/<sanitizeTaskId(task_id)>/reconciliation.json` inside a try/catch that emits a `[measurement-stop] reconciliation sink failed (non-fatal)` stderr line and never hard-blocks the close. The block guards for a non-report return (the adapter returns the numeric `0` insert-count on a stamp-only/unknown agent or a no-session-file span). Per D-06 the `flaggedCount` is recorded but no run-taint/invalidation marker is written — a discrepancy is advisory only.

**Task 2 — read-only route (`lib/vkb-server/api-routes.js` + test, D-13).**
Added `handleReconciliation(req, res)` modeled on `handleTimeline` and registered `GET /api/experiments/runs/:taskId/reconciliation` next to the timeline route. The handler validates `taskId` via `_validTaskId` (`[A-Za-z0-9._-]`, ≤80) — a `../` or `/` traversal returns 400 before any path build — then reads `<_dataDir()>/measurements/<taskId>/reconciliation.json` and returns it VERBATIM (`res.json(JSON.parse(raw))`). ENOENT returns 200 with `{ reconciliation: null }` (graceful-empty, matching `handleMeasurementActive`); an unexpected read error is 500. It reads a FILE only and never opens the experiment LevelDB (two-store boundary). `tests/vkb-server/reconciliation-route.test.js` covers verbatim pass-through, `../etc` traversal → 400, slash → 400, empty → 400, and ENOENT → 200 (5/5 passing).

## Verification

- `node --check scripts/measurement-stop.mjs` → exit 0.
- `node --test tests/vkb-server/reconciliation-route.test.js` → 5/5 pass.
- `grep "reconcile: true"` across `lib/` + `scripts/` → the only invocation is in measurement-stop's measured-span path (interactive Stop/sweep untouched).
- No store-open call in `handleReconciliation` (grep confirms file read only).

## Deviations from Plan

None — plan executed exactly as written. `taskId` validation reuses the existing `_validTaskId` (which the plan specified), so the traversal-rejection threat (T-83-05-01) is mitigated as designed; the sink dir-name uses `sanitizeTaskId` (T-83-05-02).

## Self-Check: PASSED

- FOUND: scripts/measurement-stop.mjs (reconcile invocation + sink)
- FOUND: lib/vkb-server/api-routes.js (handleReconciliation + route)
- FOUND: tests/vkb-server/reconciliation-route.test.js
- FOUND commit e87690032 (Task 1)
- FOUND commit cdb222a71 (Task 2)
