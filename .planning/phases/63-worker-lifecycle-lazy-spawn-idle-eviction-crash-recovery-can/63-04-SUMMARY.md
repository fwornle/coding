---
phase: 63-worker-lifecycle-lazy-spawn-idle-eviction-crash-recovery-can
plan: 04
subsystem: infra
tags: [llm-proxy, worker-pool, lifecycle, cancellation, client-disconnect, claude-cli, nodejs]

# Dependency graph
requires:
  - phase: 63-worker-lifecycle-lazy-spawn-idle-eviction-crash-recovery-can
    plan: 01
    provides: "WorkerPool._disposeAndDrop synchronous dispose()+splice+prune (D-08) — the in-flight abort path reuses it verbatim"
  - phase: 63-worker-lifecycle-lazy-spawn-idle-eviction-crash-recovery-can
    plan: 02
    provides: "ClaudeWorker._onExit RETRYABLE reap (rejects _pending + drains _queue + emits 'exit'); _generation stray-result guard as belt-and-suspenders behind dispose-on-cancel"
provides:
  - "ClaudeWorker.writeTracked(content, timeoutMs) -> { promise, job }: exposes THIS request's job reference so the pool can identify in-flight vs queued on abort; write() now delegates to it (public contract preserved)"
  - "ClaudeWorker.abortQueuedJob(job): splice ONLY that job from _queue + reject RETRYABLE, leaving the worker + its in-flight _pending untouched (D-03); returns true iff dequeued"
  - "WorkerPool.complete abort handler: in-flight abort -> _disposeAndDrop(key,worker) (SIGTERM+dispose+synchronous-drop, D-01); queued abort -> abortQueuedJob (D-03); NEVER worker.cancel() (the protocol interrupt that live-HANGS)"
affects: [63-05-live-lifecycle-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "writeTracked returns the job handle so the abort handler can discriminate in-flight vs queued by worker._queue.includes(job) without adding request-id correlation to the concurrency-1 protocol"
    - "Abort handler delegates to the canonical _disposeAndDrop (D-08) for the in-flight case, so cancel/idle/cooldown/recycle all share ONE synchronous lifecycle-disposal ordering"

key-files:
  created: []
  modified:
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/worker-pool.mjs
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/unit/worker-pool.test.mjs

key-decisions:
  - "Queued-job identification mechanism = writeTracked(content) -> { promise, job }; the abort handler tests worker.abortQueuedJob(job) (which returns true iff the job was in _queue) and only falls through to _disposeAndDrop when the job is NOT queued (in-flight). This is the plan's 'have write return a handle the pool can cancel' option, realized minimally."
  - "Both D-01 (in-flight) and D-03 (queued) discrimination land in ONE handleAbort closure — the discrimination is a single inseparable seam; the per-task RED commit covers both, and one GREEN commit lands the coherent mechanism."
  - "Pool falls back to worker.write() when writeTracked is absent so the existing makeFakeWorker / makeBootCrashWorker test seams (which only implement write) keep passing unchanged; those paths simply have no job handle and take the in-flight dispose branch on abort (Rule 3 blocking-issue fix)."
  - "The dead Phase-62 cancel() method is LEFT defined (executor discretion per the plan) but is NEVER invoked on the disconnect path; the only two textual occurrences of worker.cancel() in worker-pool.mjs are in explanatory comments."

requirements-completed: [WLIFE-04]

# Metrics
duration: 9min
completed: 2026-06-21
---

# Phase 63 Plan 04: Client-Disconnect Cancellation (D-01 SIGTERM+dispose+drop / D-03 queued dequeue) Summary

**Replaced the Phase-62 `worker.cancel()` abort seam (the protocol interrupt that live-HANGS — 62-HUMAN-UAT test 6) with SIGTERM+dispose+synchronous-drop, and added in-flight-vs-queued discrimination: an IN-FLIGHT abort disposes+drops the worker (reusing Plan 01's `_disposeAndDrop`, rejecting the in-flight request RETRYABLE, cold-respawning on the next same-key request), while a QUEUED abort dequeues+rejects only that one job RETRYABLE and leaves the worker + its different in-flight request alive — so a dead client can never pin a concurrency-1 worker (WLIFE-04).**

## Performance

- **Duration:** ~9 min
- **Tasks:** 2 (both TDD)
- **Files modified:** 2 (1 source, 1 test — both in the external rapid-llm-proxy repo)

## Accomplishments
- **D-01 / WLIFE-04 in-flight abort:** the `complete()` abort handler now calls `this._disposeAndDrop(key, worker)` (Plan 01's synchronous dispose()+splice+prune) instead of `worker.cancel()`. `dispose()` SIGTERMs the subprocess, whose `'exit'` fires `_onExit`, which rejects the in-flight `_pending` RETRYABLE; the synchronous splice closes the acquire-after-SIGTERM race so a concurrent `acquire` can never pick the SIGTERMed worker; the next same-key request hits the lazy-spawn branch and cold-respawns. Both the already-aborted-at-acquire case and the live-listener case are handled, with the `finally` `removeEventListener` cleanup preserved.
- **D-03 queued-vs-in-flight discrimination:** `ClaudeWorker.writeTracked(content, timeoutMs)` returns `{ promise, job }` so the pool holds THIS call's job reference. The abort handler (`handleAbort`) first calls `worker.abortQueuedJob(job)`: if the job is still in `_queue` it is spliced out and rejected RETRYABLE (worker + in-flight `_pending` untouched, FIFO preserved) and the handler returns; otherwise the job is (or became) the in-flight request and the handler falls through to the D-01 `_disposeAndDrop` path.
- **Never the hanging interrupt:** the disconnect path NEVER invokes `worker.cancel()`; the only two `worker.cancel()` textual hits in `worker-pool.mjs` are in explanatory comments (the method is left defined but dead for this path).
- **Zero regression:** all 39 prior cases (Phase-62 POOL/CR + Plan 01/02/03 D-04/D-08/D-07/D-02/D-06) still pass; suite is now 46/46 green (39 baseline + 7 new) and exits 0.

## Queued-job identification mechanism (documented per the plan's `<action>`)

The plan offered a choice: a `ClaudeWorker.abortJob(job)` method, or have `write` return a handle the pool can cancel. **I chose the handle option, minimally:**
- `write(content, timeoutMs)` now delegates to `writeTracked(content, timeoutMs).promise` (public contract unchanged).
- `writeTracked` builds the SAME `job` object that is either dispatched as `_pending` or pushed onto `_queue`, and returns `{ promise, job }`.
- The pool's `handleAbort` calls `worker.abortQueuedJob?.(job)`, which returns `true` iff `worker._queue.includes(job)` (then splices+rejects it). A `false`/absent return means the job is in-flight, so the handler falls through to `_disposeAndDrop`.

This keeps the concurrency-1 protocol free of request-id correlation (Pattern 1) — the job-object identity IS the correlation. A worker lacking `writeTracked` (the existing fakes) still works via the `write()` fallback; it just has no job handle and always takes the in-flight dispose branch on abort.

## server.mjs verify-only confirmation (no edit)

Confirmed by grep, NOT modified:
- `reqAbort = new AbortController()` at server.mjs:1534; `req.on('close')`/`res.on('close')` -> `reqAbort.abort(...)` at :1536-1538.
- `viaCliPath` threads the signal into `workerPool.complete(b, sig, completeClaudeCodeViaCLI)` at server.mjs:1237-1238.
- The handler calls `completeClaudeCode(callBody, reqAbort.signal)` at server.mjs:1639.
- Shutdown still calls `workerPool.disposeAll()` at server.mjs:1866.

So the abort signal already reaches `WorkerPool.complete`'s `abortSignal` param; Plan 04 only changed what the pool DOES with it (D-01/D-03). No server.mjs change was needed.

## Task Commits

Committed to the EXTERNAL `rapid-llm-proxy` repo (branch `main`, not pushed):

1. **RED (Task 1+2):** `959f6d3` test(63-04): add failing D-01/D-03 abort-propagation cases (WLIFE-04)
2. **GREEN (Task 1+2):** `a33629b` feat(63-04): abort = SIGTERM+dispose+drop (in-flight) / dequeue (queued) (D-01/D-03/WLIFE-04)

_The discrimination is one inseparable seam (`handleAbort` checks queued-then-in-flight), so the source landed in a single coherent GREEN commit; the RED commit carries all 7 cases (4 D-01 + 3 D-03). After GREEN the suite is 46/46. The pre-existing uncommitted changes in `bin/start-llm-proxy.sh`, `dist/`, and `src/token-usage.ts` were left untouched. Planning artifacts (this SUMMARY + STATE/ROADMAP) committed separately in the coding repo._

## Files Created/Modified
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/worker-pool.mjs` — `write()` now delegates to new `writeTracked()` (returns `{ promise, job }`); new `abortQueuedJob(job)` (splice+reject RETRYABLE); `complete()` abort handler rewritten to `handleAbort` (queued -> `abortQueuedJob`, else in-flight -> `_disposeAndDrop`), using `writeTracked` with a `write()` fallback; stale `complete()` doc comment updated (no longer "wires to worker.cancel()").
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/unit/worker-pool.test.mjs` — added `makeAbortableFakeWorker` seam (gated `_pending` + `_queue` + `writeTracked` + `abortQueuedJob` + `release`), and a `D-01/D-03 abort propagation` describe block with 7 cases.

## Decisions Made
- **Job handle over a key-based lookup** — `writeTracked` returns the job object directly; object identity is the in-flight-vs-queued discriminator (`_queue.includes(job)`), so no request-id is added to the protocol.
- **One GREEN commit for both decisions** — the abort discrimination is a single closure; splitting it would force Task 1 to deliberately mis-dispose a queued abort that Task 2 then "fixes", which is less faithful than landing the coherent seam once (the RED commit already enumerates both D-01 and D-03 cases).
- **Leave `cancel()` defined** — per the plan's executor discretion; it is dead for the disconnect path but kept for now (no caller invokes it on abort).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Pool must tolerate workers without `writeTracked`**
- **Found during:** Task 1 GREEN (first full-suite run)
- **Issue:** Switching the pool to call `worker.writeTracked(...)` unconditionally broke the existing `makeFakeWorker` / `makeBootCrashWorker` seams (9 + 5 prior cases), which only implement `write()` — `TypeError`/wrong-path failures across D-05/D-06/D-07-lazy-spawn/CR-02 cases.
- **Fix:** The pool prefers `writeTracked` when present and falls back to `worker.write(content, body?.timeout)` otherwise; the fallback path has no job handle and takes the in-flight dispose branch on abort (correct for those non-abort tests).
- **Files modified:** `proxy-bridge/worker-pool.mjs`
- **Verification:** all 39 prior cases pass again; suite 46/46 green.
- **Committed in:** `a33629b` (Task 1+2 GREEN commit)

### Plan-interpretation note (not a deviation)

- The plan's `<test_seams>` suggested driving two requests at `size=1` so the second sits in `_queue`. In the actual pool architecture a second CONCURRENT same-key request at `size=1` routes to **overflow**, not the worker's `_queue` — a job only lands in `_queue` when the SAME worker is written to while busy (concurrency-1 self-serialization). The D-03 "queued abort dequeues only" case therefore drives the queued state by occupying the worker in-flight and then routing B's `complete()` through a factory that returns the SAME busy worker (so the pool's `writeTracked` lands B in `_queue`); the "queued reject shape" case exercises `abortQueuedJob` at the worker level directly. Both assert the documented D-03 behavior (single-job dequeue, RETRYABLE shape, worker + in-flight survive) — a faithful realization of the plan's intent given the pool's overflow-not-queue concurrency model.

**Total deviations:** 1 auto-fixed (1 blocking interface-compat fix).
**Impact on plan:** The single auto-fix preserves backward compatibility of the worker interface for the existing test seams; no behavior change to production workers (the real `ClaudeWorker` always exposes `writeTracked`). The D-03 test-driving interpretation matches the pool's real concurrency model without weakening any assertion.

## Issues Encountered
The Task-1 RED run hung after the first failing D-01 case because the gated abort workers never settle on the un-implemented path — the expected RED signature for "the abort handler does not dispose yet". After GREEN the suite runs to completion 46/46. No `--live` gate applies (all cases are unit-level); the `node --test <file> --live` argv gotcha is not relevant here.

## Threat Surface
No new network endpoints, auth paths, file access, or schema changes. All three threats the plan's `<threat_model>` flagged as `mitigate` are now closed by passing unit cases:
- **T-63-08** (a dead client pins a concurrency-1 worker to a zombie in-flight request) — in-flight abort SIGTERMs+disposes+drops the worker (`_disposeAndDrop`), frees the slot, rejects the in-flight request RETRYABLE, and the next request cold-respawns; the live-HANGING protocol interrupt is explicitly NOT used. Proven by the D-01 in-flight-abort + cold-respawn + never-cancel cases.
- **T-63-09** (an abort over-reaches and kills a DIFFERENT live request on the worker — collateral cancel) — D-03 discrimination: a queued abort only dequeues that one job; only an in-flight abort disposes. Proven by the "queued abort leaves worker + in-flight untouched" case.
- **T-63-10** (a SIGTERMed-but-not-dropped worker is handed to the next caller — stray-result vector) — `_disposeAndDrop` removes the worker SYNCHRONOUSLY (D-08, Plan 01) so a concurrent `acquire` cannot pick it; the D-02 generation guard (Plan 02) is the belt-and-suspenders. Proven by the D-01 synchronous-drop assertion.
- **T-63-SC** (npm/pip/cargo installs) — accept; no new packages, Node builtins only.

## Known Stubs
None. The cancellation paths are fully wired into the live `complete()` dispatch path (not placeholders). The only test-only affordances are the `makeAbortableFakeWorker` seam and the `write()` fallback, both inert on the real `ClaudeWorker` path (which always exposes `writeTracked`).

## User Setup Required
None — no external service configuration, no new env knobs, no new dependencies.

## Next Phase Readiness
- **Plan 05 (`--live` lifecycle verification):** the cancel-live case can now assert the inverse of the Phase-62 "same .pid survives" cancel test — aborting an in-flight request SIGTERMs the worker subprocess (gone via `ps`) and the next same-key request spawns a NEW pid (D-01). The queued-abort behavior is unit-proven; the live suite need only cover the in-flight SIGTERM path.
- No blockers.

## Self-Check: PASSED

---
*Phase: 63-worker-lifecycle-lazy-spawn-idle-eviction-crash-recovery-can*
*Completed: 2026-06-21*
