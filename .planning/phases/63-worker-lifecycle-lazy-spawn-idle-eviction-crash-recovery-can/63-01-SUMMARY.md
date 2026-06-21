---
phase: 63-worker-lifecycle-lazy-spawn-idle-eviction-crash-recovery-can
plan: 01
subsystem: infra
tags: [llm-proxy, worker-pool, lifecycle, idle-eviction, claude-cli, nodejs]

# Dependency graph
requires:
  - phase: 62-worker-pool-core-stream-json-transport
    provides: ClaudeWorker + WorkerPool (dispose/_dropWorker/_spawnWorker exit reaper/per-request unref'd timeout timer/complete recycle-finally)
provides:
  - "WorkerPool._disposeAndDrop(key, worker): canonical synchronous dispose()+splice+prune lifecycle-disposal helper (D-08) closing the acquire-after-SIGTERM race"
  - "ClaudeWorker unref'd idle timer (D-04 / WLIFE-02): arm-in-constructor / clear-on-dispatch / re-arm-on-settle / clear-on-dispose+exit, default 30 min via LLM_PROXY_WORKER_IDLE_MS"
affects: [63-03-crash-cooldown, 63-04-cancellation, 63-05-live-lifecycle-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Synchronous dispose+drop pairing as the single canonical lifecycle-disposal path (cancel/idle/cooldown all reuse it); async 'exit'->_dropWorker stays as the idempotent backstop"
    - "Per-worker unref'd background timer (mirrors the CR-01 per-request timeout idiom) armed/cleared/re-armed across the request lifecycle"

key-files:
  created: []
  modified:
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/worker-pool.mjs
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/unit/worker-pool.test.mjs

key-decisions:
  - "Idle timer owner = ClaudeWorker (not the pool), consistent with the per-request timer also living on the worker (Claude's-Discretion locked)"
  - "Env knob name LLM_PROXY_WORKER_IDLE_MS (Phase-62 LLM_PROXY_WORKER_* house style)"
  - "_clearIdleTimer also called from _onExit so a self-crashed worker leaves no dangling idle timer (beyond the plan's dispatch/dispose clears)"
  - "Re-arm idle timer on settle BEFORE the queue-drive; _dispatch re-clears it if a queued job runs, so the window restarts from the last settle"

patterns-established:
  - "_disposeAndDrop is THE lifecycle-disposal entry point — complete()'s recycle finally delegates to it; Plans 03/04 will call it for cooldown/cancel"
  - "workerWithKillableMock test seam: mock subprocess fires its registered proc 'exit' handler on kill('SIGTERM') so the dispose->SIGTERM->'exit'->_onExit reap path is observable without a live CLI"

requirements-completed: [WLIFE-02]

# Metrics
duration: 14min
completed: 2026-06-21
---

# Phase 63 Plan 01: Worker Lifecycle Foundations (D-08 synchronous dispose-drop + D-04 idle timer) Summary

**WorkerPool._disposeAndDrop synchronous dispose+splice+prune helper (closes the acquire-after-SIGTERM race) plus a per-worker unref'd idle timer (default 30 min via LLM_PROXY_WORKER_IDLE_MS) that self-evicts a quiet ClaudeWorker through the existing reap path with no central sweep loop.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-06-21T07:04:04Z
- **Completed:** 2026-06-21T07:18:00Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 2 (1 source, 1 test — all in the external rapid-llm-proxy repo)

## Accomplishments
- **D-08 synchronous dispose-drop:** added `WorkerPool._disposeAndDrop(key, worker)` performing `dispose()` + synchronous `_dropWorker` (splice + CR-02 key-prune) on the same tick, so a concurrent `acquire` (`workers.find((w) => !w.busy)`) can never be handed a SIGTERMed worker. `complete()`'s post-request recycle finally now delegates to it, giving the pool one canonical lifecycle-disposal ordering for Plans 03 (cooldown) and 04 (cancel) to reuse.
- **D-04 / WLIFE-02 idle timer:** `ClaudeWorker` arms an `unref()`'d `setTimeout` (default 30 min, `LLM_PROXY_WORKER_IDLE_MS`, per-worker `deps.idleMs` seam) in the constructor, clears it on dispatch, re-arms on settle, and clears it in `dispose()` and `_onExit`. On fire it disposes -> SIGTERM -> `'exit'` -> the existing `_dropWorker` backstop reaps it; the next request lazily respawns. No central sweep loop.
- **Zero regression:** all 21 Phase-62 unit cases (CR-01 timeout, CR-02 leak, POOL-01..03, D-05/D-06/D-07 lifecycle) still pass; suite is 27/27 green and exits 0.

## Task Commits

Each task was committed atomically (TDD: test -> feat) to the EXTERNAL `rapid-llm-proxy` repo:

1. **Task 1 (D-08) RED:** `13c583a` test(63-01): add failing D-08 synchronous dispose+drop cases
2. **Task 1 (D-08) GREEN:** `0eeb8bc` feat(63-01): add WorkerPool._disposeAndDrop synchronous dispose+drop (D-08)
3. **Task 2 (D-04) RED:** `b74cb57` test(63-01): add failing D-04 idle-timer cases + killable mock seam
4. **Task 2 (D-04) GREEN:** `b04441a` feat(63-01): add ClaudeWorker unref'd idle timer (D-04 / WLIFE-02)

_All four commits are on `rapid-llm-proxy` branch `main` (not pushed). Planning artifacts (this SUMMARY + STATE/ROADMAP) committed separately in the coding repo._

## Files Created/Modified
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/worker-pool.mjs` — added `DEFAULT_IDLE_MS` knob, `ClaudeWorker._armIdleTimer`/`_clearIdleTimer` + constructor/dispatch/settle/dispose/exit wiring, `WorkerPool._disposeAndDrop`, and refactored `complete()`'s recycle finally to delegate.
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/unit/worker-pool.test.mjs` — 3 D-08 cases (synchronous drop / key-prune / idempotent backstop), 3 D-04 cases (idle fire / reset-on-settle / cleared-on-dispose), and a `workerWithKillableMock` helper.

## Decisions Made
- **Idle timer lives on `ClaudeWorker`** (not armed by the pool) — Claude's-Discretion choice locked per the plan, consistent with the per-request timer also being worker-owned.
- **Env knob `LLM_PROXY_WORKER_IDLE_MS`** per the Phase-62 `LLM_PROXY_WORKER_*` house style.
- **Cleared idle timer in `_onExit` too** (beyond the plan's explicit dispatch+dispose clears) so a self-crashed worker leaves no dangling timer — a correctness tidy-up consistent with the D-04 "no dangling timer" intent (Rule 2: missing-critical cleanup). Harmless either way because `_armIdleTimer` guards `_exited`, but it keeps shutdown/crash paths symmetric.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Clear the idle timer on self-exit (`_onExit`)**
- **Found during:** Task 2 (D-04 idle timer)
- **Issue:** The plan's `<action>` specified clearing the idle timer on dispatch and in `dispose()`, but a worker whose subprocess crashes on its own reaches `_onExit` WITHOUT going through `dispose()`, leaving the armed idle timer dangling (it would later fire `dispose()` on an already-exited worker).
- **Fix:** Added `this._clearIdleTimer()` at the top of `_onExit` (after `_exited=true`), matching the D-04 "no dangling timer for shutdown/disposeAll consistency" requirement for the crash path too.
- **Files modified:** `proxy-bridge/worker-pool.mjs`
- **Verification:** D-04 cleared-on-dispose case asserts exactly one `'exit'` (no second idle-timer fire); full suite 27/27 green.
- **Committed in:** `b04441a` (Task 2 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 missing-critical cleanup)
**Impact on plan:** The single auto-fix is a defensive timer-cleanup on the crash path, fully aligned with D-04's stated "no dangling timer" invariant. No scope creep — no new behavior, no new surface.

## Issues Encountered
None. The `node --test <file> --live` argv gotcha did not apply (this plan's cases are all unit-level, no `--live` gate). The mock subprocess `kill` being a no-op was handled by adding `workerWithKillableMock`, which fires the registered proc `'exit'` handler on SIGTERM so the dispose->reap path is observable deterministically.

## Threat Surface
No new network endpoints, auth paths, file access, or schema changes. Both threats the plan's `<threat_model>` flagged as `mitigate` are now closed by passing unit cases:
- **T-63-01** (acquire-after-SIGTERM race) — `_disposeAndDrop` splices synchronously; proven by the D-08 synchronous-drop case.
- **T-63-02** (dangling idle timer pins the proxy) — idle timer is `unref()`'d and cleared on dispose/exit; proven by the D-04 cleared-on-dispose case.

## User Setup Required
None - no external service configuration required. `LLM_PROXY_WORKER_IDLE_MS` is an optional env override (defaults to 30 min).

## Next Phase Readiness
- `_disposeAndDrop` is the synchronous-drop invariant Plan 03 (crash-cooldown) and Plan 04 (cancellation) will call — both can now build on a single canonical disposal path.
- Idle eviction rides the existing `dispose()` -> `'exit'` -> `_dropWorker` reap path, so Plan 05's `--live` idle-evict case can assert the subprocess disappears with a short `LLM_PROXY_WORKER_IDLE_MS`.
- No blockers.

## Self-Check: PASSED

---
*Phase: 63-worker-lifecycle-lazy-spawn-idle-eviction-crash-recovery-can*
*Completed: 2026-06-21*
