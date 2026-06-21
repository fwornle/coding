---
phase: 63-worker-lifecycle-lazy-spawn-idle-eviction-crash-recovery-can
plan: 02
subsystem: infra
tags: [llm-proxy, worker-pool, lifecycle, crash-recovery, cancellation, claude-cli, nodejs]

# Dependency graph
requires:
  - phase: 63-worker-lifecycle-lazy-spawn-idle-eviction-crash-recovery-can
    plan: 01
    provides: "ClaudeWorker._onExit RETRYABLE reap path (in-flight reject + queue drain + emit 'exit'); idle timer; WorkerPool._disposeAndDrop"
provides:
  - "ClaudeWorker._writeGuarded: every stdin.write error (synchronous EPIPE throw OR async write-callback err) funnels into _onExit(null, 'EPIPE') so the in-flight AND every queued job reject RETRYABLE, the worker is marked dead, and 'exit' fires (D-07 / WLIFE-03)"
  - "ClaudeWorker._generation monotonic request-generation counter stamped on _pending + echoed on the outgoing _gen envelope; _onEvent drops any result whose _gen does not match the live _pending.generation (D-02 / WLIFE-04 stray-result safety)"
affects: [63-03-crash-cooldown, 63-04-cancellation, 63-05-live-lifecycle-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Guarded subprocess write: route ANY write error (throw-now or callback-err) into the existing _onExit reap path rather than letting it escape the dispatch path and lose the queued-job rejection"
    - "Per-worker monotonic request-generation counter stamped on _pending and echoed on the outgoing envelope; drop a result whose echoed generation is stale (belt-and-suspenders behind dispose-on-cancel, primary defense stays _pending===null)"

key-files:
  created: []
  modified:
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/worker-pool.mjs
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/unit/worker-pool.test.mjs

key-decisions:
  - "_writeGuarded covers BOTH the synchronous throw (pipe already gone) and the async write-callback err (pipe closes mid-write); both route to _onExit(null, 'EPIPE') with a diagnostic signal label"
  - "cancel()'s raw control_request write is guarded too (symmetry) even though it is mostly moot once Plan 04 replaces the disconnect path with SIGTERM+dispose"
  - "Generation echo via a `_gen` field on the outgoing user envelope: the live CLI ignores+does-not-echo it (so the live path relies on the _pending===null primary defense), and the unit suite echoes it back to deterministically exercise the narrow in-flight window WITHOUT adding request-id correlation to the protocol (Pattern 1: concurrency-1 needs none)"
  - "A result with NO generation echo settles normally — the happy path (real CLI) is unchanged; the guard only drops a result that carries a MISMATCHING generation"

patterns-established:
  - "_writeGuarded is THE write path for the worker — _dispatch and cancel both route through it; any future write site must reuse it so no unguarded write can escape"
  - "workerWithEpipeMock test seam: a spawn stub whose stdin.write throws {code:'EPIPE'} makes the EPIPE-as-crash reap observable without a live CLI"
  - "rawResultLine(model, text, gen): optional internal _gen echo lets the in-flight-window generation guard be unit-tested deterministically"

requirements-completed: [WLIFE-03, WLIFE-04]

# Metrics
duration: 13min
completed: 2026-06-21
---

# Phase 63 Plan 02: Crash & Cancellation Correctness Guards (D-07 EPIPE-as-crash + D-02 generation guard) Summary

**A guarded `stdin.write` that routes any write error (synchronous EPIPE throw or async callback err) into the existing `_onExit` RETRYABLE reap — so the in-flight AND every queued job reject RETRYABLE instead of the raw throw escaping and losing the queued-job rejection — plus a per-worker monotonic request-generation counter that drops a stray late `result` instead of resolving the next caller's promise.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-06-21T07:13:34Z
- **Completed:** 2026-06-21T07:26:15Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 2 (1 source, 1 test — all in the external rapid-llm-proxy repo)

## Accomplishments
- **D-07 / WLIFE-03 EPIPE-as-crash:** added `ClaudeWorker._writeGuarded(payload)` wrapping `stdin.write` in a try/catch AND passing a write callback. A synchronous EPIPE throw (pipe already gone) or an async write-callback `err` (pipe closes mid-write) now both funnel into `this._onExit(null, 'EPIPE')` — the SAME reap path a real subprocess `'exit'` uses. Because `_onExit` already (a) rejects `_pending` RETRYABLE, (b) drains `_queue` RETRYABLE, and (c) emits `'exit'`, routing through it recovers the queued-job rejection the raw throw used to lose. Both `_dispatch` and `cancel()` route through `_writeGuarded`.
- **D-02 / WLIFE-04 stray-result generation guard:** added a per-worker monotonic `_generation` integer, bumped on every `_dispatch`, stamped onto `_pending.generation`, and echoed on the outgoing `_gen` envelope field. `_onEvent` now drops any `result` whose echoed `_gen` does not match the live `_pending.generation` (a stray/late result from an already-settled turn). The `_pending === null` check stays the primary defense; the generation guard closes the narrower in-flight window where a NEW request's `_pending` is live when a stale result lands. A result with no generation echo (the real CLI) settles normally — the happy path is unchanged.
- **Zero regression:** all 27 cases from 63-01 (POOL-01/02/03, CR-01, D-04, D-08, CR-02/WR-06) still pass; suite is now 33/33 green (27 baseline + 3 D-07 + 3 D-02) and exits 0.

## Task Commits

Each task was committed atomically (TDD: test -> feat) to the EXTERNAL `rapid-llm-proxy` repo (branch `main`, not pushed):

1. **Task 1 (D-07) RED:** `b318d13` test(63-02): add failing D-07 EPIPE-as-crash cases (WLIFE-03)
2. **Task 1 (D-07) GREEN:** `d71d791` feat(63-02): treat EPIPE on stdin.write as a crash (D-07 / WLIFE-03)
3. **Task 2 (D-02) RED:** `cb723a0` test(63-02): add failing D-02 stray-result generation-guard case (WLIFE-04)
4. **Task 2 (D-02) GREEN:** `987d094` feat(63-02): monotonic request-generation guard vs stray results (D-02 / WLIFE-04)

_All four commits are on `rapid-llm-proxy` branch `main` (not pushed). The pre-existing uncommitted changes in `bin/start-llm-proxy.sh`, `dist/`, and `src/token-usage.ts` were left untouched. Planning artifacts (this SUMMARY + STATE/ROADMAP) committed separately in the coding repo._

## Files Created/Modified
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/worker-pool.mjs` — added `_generation` field; `_writeGuarded` helper; `_dispatch` now bumps+stamps the generation, echoes `_gen` on the outgoing envelope, and writes via `_writeGuarded`; `cancel()` writes via `_writeGuarded`; `_onEvent` drops a result whose `_gen` mismatches the live `_pending.generation`.
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/unit/worker-pool.test.mjs` — added `workerWithEpipeMock` seam + 3 D-07 cases (in-flight EPIPE rejects RETRYABLE / EPIPE drains the queued job / EPIPE marks dead + emits 'exit'), and a `rawResultLine` helper + 3 D-02 cases (stray-after-settle no-op / stray does not resolve the next request / normal settle unaffected).

## Decisions Made
- **Guard both write sites via one `_writeGuarded`** — `_dispatch` (request envelope) and `cancel()` (control_request) both route through it, so there is a single write path and no unguarded write can escape. `cancel()`'s guard is mostly moot once Plan 04 swaps the disconnect path to SIGTERM+dispose, but an unguarded write there was the same latent hazard.
- **Generation echo via `_gen` on the outgoing envelope** — the live CLI ignores unknown fields and does NOT echo it, so the live path relies on the `_pending === null` primary defense; the unit suite echoes `_gen` back to deterministically exercise the narrow in-flight window. This keeps the protocol free of request-id correlation (Pattern 1: concurrency-1 needs none) while still making the belt-and-suspenders guard testable.
- **A result with no generation settles normally** — so the happy path / real-CLI path is unchanged; the guard only drops a result that carries a MISMATCHING generation.

## Deviations from Plan

### Auto-fixed Issues

None — both tasks executed as written.

### Plan-interpretation note (not a deviation)

- The plan's `<action>` for D-02 said "in `_onEvent`, BEFORE resolving/rejecting on a `result`, capture `const pendingGen = this._pending?.generation` ... never resolve `_pending` with an event whose generation does not match `_pending.generation`." The plan's own `<behavior>` ("then push a STRAY result line carrying A's (now-stale) generation context") requires the result event to carry a generation the guard can compare against. In the concurrency-1 protocol the result has no request-id, so the stray and a real result are otherwise byte-identical. The implementation therefore (a) echoes the dispatch generation on the outgoing `_gen` envelope field and reads it back off `ev._gen`, and (b) the unit `rawResultLine` helper stamps the stale generation on the stray line — exactly the "generation stamp mismatch in `_onEvent`" the plan's `key_links` specify (`pattern: "_generation|_requestSeq"`). The live path is unaffected because the real CLI never echoes `_gen`, so `_pending === null` remains the operative defense there. This is a faithful realization of the plan's stated guard, not a scope change.

**Total deviations:** 0 auto-fixed.
**Impact on plan:** None — both guards land exactly where the plan, PATTERNS map, and threat model placed them, with the full unit suite green and zero regression.

## Issues Encountered
The D-07 RED run terminated mid-suite at the first failing D-07 case (the unguarded synchronous EPIPE throw escapes `_dispatch`), which is the expected RED signature. After the GREEN guard, the full suite runs to completion 33/33. No `--live` gate applies (all cases are unit-level). The `node --test <file> --live` argv gotcha is not relevant here.

## Threat Surface
No new network endpoints, auth paths, file access, or schema changes. Both threats the plan's `<threat_model>` flagged as `mitigate` are now closed by passing unit cases:
- **T-63-04** (unguarded EPIPE throw loses the queued-job rejection → caller hangs forever) — `_dispatch` write is guarded; any write error routes to `_onExit`, which rejects in-flight + drains queue RETRYABLE and emits `'exit'`. Proven by the D-07 "drains queue" unit case.
- **T-63-05** (a disposed/late worker leaks a stray `result` onto the NEXT caller) — the monotonic generation guard drops any `result` whose `_gen` does not match the live `_pending.generation`; combined with dispose-on-cancel (Plan 04) the disposed worker is also dropped from the pool. Proven by the D-02 "stray does not resolve the next request" case. Residual severity LOW: concurrency-1 + `_pending=null`-on-settle already covers the common case; the generation guard closes the narrow in-flight window.
- **T-63-SC** (npm/pip/cargo installs) — accept; no new packages, Node builtins only.

## Known Stubs
None. Both guards are fully wired into the live dispatch/event paths (not placeholders); the only test-only affordance is the `_gen` echo readback, which is inert on the live CLI path by design.

## User Setup Required
None — no external service configuration, no new env knobs, no new dependencies.

## Next Phase Readiness
- **Plan 03 (crash-cooldown):** the EPIPE-as-crash path now funnels a write-crash through `_onExit` → `'exit'`, the same `'exit'` the cooldown crash-frequency hook (Pattern map D-06) observes — so an EPIPE counts as a crash for cooldown tracking for free.
- **Plan 04 (cancellation):** the generation guard is the documented belt-and-suspenders behind dispose-on-cancel; Plan 04's SIGTERM+dispose remains the primary stray-result defense and now composes with the in-flight-window guard.
- No blockers.

## Self-Check: PASSED

---
*Phase: 63-worker-lifecycle-lazy-spawn-idle-eviction-crash-recovery-can*
*Completed: 2026-06-21*
