---
phase: 83-token-reconciliation-layer
plan: 01
subsystem: rapid-llm-proxy / token-tap
tags: [proxy, task-id, sanitization, ambient-span, security, dos]
requires:
  - "Phase 82 wire-measurement foundation (/v1/messages tap + OpenAI-shim task-id binding)"
provides:
  - "Crash-safe (guarded) task-id binding on the /v1/messages tap (D-07)"
  - "One sanitized task_id form keying DB + _ctxMaxByTask + breakdown filename (D-10)"
  - "Header-less tap rows stamped neutral, no ambient-cell inheritance (D-08)"
affects:
  - "Plan 07 concurrent golden comparison (interactive rows now carry no cell task_id)"
  - "Any DB↔breakdown-file join in the reconcile matcher (stable join key)"
tech-stack:
  added: []
  patterns:
    - "safeSanitizeTaskId() guarded wrapper around the canonical sanitizeTaskId validator (never replaces it)"
    - "shim try/catch-to-safe-default shape copied onto the tap header site"
key-files:
  created: []
  modified:
    - "/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs"
decisions:
  - "Malformed x-task-id header falls back to the ambient span (D-07 catch); only a fully ABSENT header is neutralized (D-08) — matches the plan's task split, review CR-01/WR-01 dispositions."
  - "Chose the plan's stronger neutralize-at-resolution approach for WR-01 over the review's suggested captureBelongsToRun gate at the DB-stamp site."
metrics:
  duration: ~20m
  tasks: 2
  files: 1
  completed: 2026-07-06
---

# Phase 83 Plan 01: Harden Proxy Task-ID Binding Summary

Guarded and unified the `/v1/messages` tap and OpenAI-shim task-id binding in the rapid-llm-proxy so a malformed `x-task-id` header can no longer crash the daemon (D-07), the same logical id keys the DB row, the in-memory context-max map, and the breakdown filename identically (D-10), and header-less interactive rows no longer inherit a concurrent measured cell's span (D-08).

## What Was Built

All three fold-ins are surgical in-place patches to `proxy-bridge/server.mjs`; no build/deploy (Plan 02 owns the single build + kickstart that activates these edits).

### Task 1 — D-07 tap guard + D-10 seam unification (commit `5512068`)
- Added `safeSanitizeTaskId(rawId)` — a guarded, idempotent wrapper around the canonical `sanitizeTaskId` (imported at `:49`). Returns `''` on empty input or on a throw (illegal chars / >200 chars / `.`|`..`), so the same sanitized form can key every seam without re-throwing into the async handler. It wraps — never replaces — the single validator.
- **D-07 (CR-01):** Converted the unguarded tap one-liner (`const taskId = hdrTaskId ? sanitizeTaskId(hdrTaskId) : resolveLiveTaskId();`) into an `if/try-catch/else` block. A malformed header now logs and falls back to the (sanitized) ambient span instead of throwing out of the request handler and crashing the daemon.
- **D-10 (WR-06):** On the OpenAI-shim path, `resolveShimTaskId(...)` returned the header/body id RAW (only the path segment was pre-sanitized), so the DB `task_id` and `_ctxMaxByTask` key diverged from the sanitized `perRunBreakdownPath` filename. Wrapped the resolved id once in `safeSanitizeTaskId(...)` and sanitized the shim ambient fallback (`effTaskId`) too, so all three seams key on ONE form — restoring the DB↔breakdown-file join.

### Task 2 — D-08 empty-header no-inherit (commit `3b73e59`)
- **D-08 (WR-01):** The tap's empty-header branch previously fell back to `resolveLiveTaskId()`, so a header-less interactive request adopted whatever measured cell span was live — inflating that cell's totals. The branch now stamps the row NEUTRAL (`task_id = ''`), carrying the greppable behavioral anchor `WR-01-no-inherit`. Only an explicit `x-task-id` header binds a measured cell.
- Extended the WIRE-03 comment block (`~:1988`) to document the empty-header no-inherit rule (removed the now-false "Empty header → fall back to the ambient resolveLiveTaskId()" line).

## Verification

- `node --check proxy-bridge/server.mjs` exits 0 after both tasks.
- `sanitizeTaskId` remains imported exactly once (`:49`) and is never redefined; `safeSanitizeTaskId` is a distinct wrapper.
- Task 2 gate passes: `WR-01-no-inherit` sentinel present AND no `resolveLiveTaskId(` within the 4 lines following it.
- Tap seams read from `taskId`/`effTaskId` (sanitized); no path binds raw `hdrTaskId` into `_ctxMaxByTask` or the DB row.

## Deviations from Plan

None — plan executed as written. The plan intentionally supersedes the 82-REVIEW's suggested WR-01 fix (captureBelongsToRun gate at the DB stamp) with the stronger neutralize-at-resolution approach; this SUMMARY records that as a design decision, not a deviation.

## Threat Flags

None. All changes fall inside the plan's existing `<threat_model>` (T-83-01-01 DoS, T-83-01-02 tampering, T-83-01-03 spoofing — all `mitigate`, all addressed). No new network surface, auth path, or schema change introduced. No package installs (T-83-01-SC).

## Known Stubs

None.

## Self-Check: PASSED
- FOUND: /Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs (modified, node --check OK)
- FOUND: commit 5512068 (Task 1) in rapid-llm-proxy repo
- FOUND: commit 3b73e59 (Task 2) in rapid-llm-proxy repo
