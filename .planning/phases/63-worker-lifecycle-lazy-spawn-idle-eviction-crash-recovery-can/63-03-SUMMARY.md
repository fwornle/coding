---
phase: 63-worker-lifecycle-lazy-spawn-idle-eviction-crash-recovery-can
plan: 03
subsystem: infra
tags: [llm-proxy, worker-pool, lifecycle, crash-recovery, cooldown, respawn-storm, claude-cli, nodejs]

# Dependency graph
requires:
  - phase: 63-worker-lifecycle-lazy-spawn-idle-eviction-crash-recovery-can
    plan: 01
    provides: "WorkerPool._disposeAndDrop synchronous dispose+drop; the _spawnWorker once('exit')->_dropWorker reap backstop the crash hook extends"
  - phase: 63-worker-lifecycle-lazy-spawn-idle-eviction-crash-recovery-can
    plan: 02
    provides: "_writeGuarded EPIPE-as-crash funnels a write-crash through _onExit -> 'exit' (the same 'exit' the cooldown crash hook observes, so an EPIPE counts as a crash for free)"
provides:
  - "WorkerPool per-key crash-frequency tracking: _crashesByKey Map<key, number[]> + _recordCrash(key) (push Date.now() + prune to window), wired into the _spawnWorker exit handler so EVERY exit on a freshly-spawned worker is a crash candidate (D-06 / WLIFE-03)"
  - "WorkerPool crash-cooldown gate at the TOP of complete(): a key with >= LLM_PROXY_WORKER_CRASH_THRESHOLD crashes within LLM_PROXY_WORKER_CRASH_WINDOW_MS routes straight to the execFile overflow (completeClaudeCodeViaCLI) for the window — no new spawn — then lazily spawns again after the window (_isInCooldown prune-to-window lifts the gate)"
affects: [63-04-cancellation, 63-05-live-lifecycle-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-key crash-frequency Map<key, number[]> pruned-to-window on every record; the window+threshold (not exit-site classification) distinguishes a persistently-broken key's BURST of boot crashes from healthy spaced churn"
    - "Cooldown gate reuses the EXACT all-busy overflow branch shape (overflowFn(body, abortSignal)) at the TOP of complete() — degrades a broken key to pre-milestone execFile behavior, not a new error route"

key-files:
  created: []
  modified:
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/worker-pool.mjs
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/unit/worker-pool.test.mjs
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/helpers/mock-claude-stdio.mjs

key-decisions:
  - "Early-exit HEURISTIC: record EVERY exit on a freshly-spawned worker as a crash candidate (no per-worker served-ok flag, no exit-site boot-vs-healthy classification); rely on the window+threshold to ignore healthy churn. A healthy worker exits at most once, spaced far apart, so it never accumulates to the threshold within the (short) crash window — only a key whose spawns die in a BURST trips cooldown."
  - "Env knob names LLM_PROXY_WORKER_CRASH_THRESHOLD (default 3) / LLM_PROXY_WORKER_CRASH_WINDOW_MS (default 60s) per the Phase-62 LLM_PROXY_WORKER_* house style; per-pool opts.crashThreshold/crashWindowMs seam mirrors size/promptCap so the unit suite uses a 80-200ms window + threshold 2."
  - "Crash-frequency data structure = Map<key, number[]> of recent crash timestamps (minimal representation, Claude's-Discretion). _recordCrash prunes on push; _isInCooldown prunes-to-window before the threshold check AND deletes a now-cold key from the map, so the gate naturally LIFTS after the window with no separate timer."
  - "Cooldown gate placed at the TOP of complete(), immediately AFTER the GUARD-01 LLM_PROXY_DISABLE_WORKER_POOL check and BEFORE the workersByKey lazy-spawn block, reusing the EXACT overflowFn(body, abortSignal) shape from the all-busy path (and the same no-overflowFn throw)."

patterns-established:
  - "_recordCrash/_isInCooldown are the crash-cooldown machinery; the exit handler records, complete()'s top gate reads. Plan 04 (cancel) and Plan 05 (--live crash case) compose with this — a SIGTERM'd/EPIPE'd worker's 'exit' counts as a crash for free."

requirements-completed: [WLIFE-03]

# Metrics
duration: 8min
completed: 2026-06-21
---

# Phase 63 Plan 03: Crash-Recovery Respawn-Storm Guard (D-06 crash cooldown) Summary

**Per-key crash-frequency tracking on the worker exit handler plus a cooldown gate at the top of `complete()`: once a (model×prompt) key crosses `LLM_PROXY_WORKER_CRASH_THRESHOLD` crashes within `LLM_PROXY_WORKER_CRASH_WINDOW_MS`, its requests route straight to the existing execFile overflow (`completeClaudeCodeViaCLI`) for the window — degrading a persistently-broken key to pre-milestone behavior instead of spawn→crash→RETRYABLE on every request — then it may lazily spawn again after the window.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-06-21T09:31:30+02:00 (first RED commit)
- **Completed:** 2026-06-21T09:32:58+02:00 (Task 2 GREEN commit)
- **Tasks:** 2 (both TDD)
- **Files modified:** 3 (1 source, 1 test, 1 test helper — all in the external rapid-llm-proxy repo)

## Accomplishments
- **Task 1 — crash-frequency tracking + boot-crash mock helper:** added `LLM_PROXY_WORKER_CRASH_THRESHOLD` (default 3) and `LLM_PROXY_WORKER_CRASH_WINDOW_MS` (default 60s) env knobs with per-pool `opts.crashThreshold`/`opts.crashWindowMs` seams; `this._crashesByKey = new Map()` (`Map<key, number[]>` of recent crash timestamps); `_recordCrash(key)` (push `Date.now()` + prune to window); and extended the `_spawnWorker` `once('exit')` handler so every worker exit records a crash for its key alongside the existing `_dropWorker` reap backstop. Added `makeMockEarlyExitStdio` to the test helper — a stdio whose stdout PassThrough ends on the next tick, simulating a `claude` boot crash.
- **Task 2 — D-06 cooldown gate:** added `_isInCooldown(key)` (prune-to-window, drop a cold key, threshold check) and a cooldown gate at the TOP of `complete()` — immediately after the GUARD-01 disable check and BEFORE the lazy-spawn acquire. A key in cooldown routes straight to `overflowFn(body, abortSignal)` (the EXACT shape the all-busy overflow path uses), with the same "no overflow function provided" throw when none is supplied. No worker is spawned while in cooldown; once the window elapses with no new crash the gate lifts and `complete()` falls through to normal lazy-spawn.
- **Zero regression:** all 33 prior cases (Phase-62 POOL/CR/D-04/D-08 + Plan 01/02 D-07/D-02) still pass; suite is now 39/39 green (33 baseline + 6 new) and exits 0.

## Early-exit heuristic (documented per the plan's `<action>`)

The plan offered a choice: track a per-worker "served-ok" signal to classify boot crashes, OR record every exit and rely on the window+threshold. **I chose to record EVERY exit on a freshly-spawned worker as a crash candidate** — no per-worker `_servedOk` flag, no exit-site boot-vs-healthy classification.

Rationale: a healthy worker that serves traffic for minutes and then exits (idle-evict, recycle, shutdown) produces at most ONE timestamp per worker, and those exits are spaced far apart in wall-clock time. With a short crash window (default 60s, and 80–200ms in the unit suite), healthy churn never accumulates `_crashThreshold` timestamps inside the window. Only a key whose spawns die in a BURST — a persistently-broken key (bad OAuth/flags, CLI missing) boot-crashing every spawn — crosses the threshold and trips cooldown. This keeps the exit handler simple and avoids threading a "served-ok" flag through the live CLI dispatch path (which Plan 02's `_writeGuarded`/`_onExit` would also have to maintain). The window+threshold IS the false-positive filter — proven by the "healthy key unaffected" unit case.

## Task Commits

Each task was committed atomically (TDD: test → feat) to the EXTERNAL `rapid-llm-proxy` repo (branch `main`, not pushed):

1. **RED (Task 1+2):** `b0e031a` test(63-03): add failing D-06 crash-cooldown cases + makeMockEarlyExitStdio (WLIFE-03)
2. **Task 1 GREEN:** `68a710b` feat(63-03): per-key crash-frequency tracking on the worker exit handler (D-06)
3. **Task 2 GREEN:** `194634e` feat(63-03): crash-cooldown gate routes a storming key to execFile overflow (D-06 / WLIFE-03)

_All three commits are on `rapid-llm-proxy` branch `main` (not pushed). The pre-existing uncommitted changes in `bin/start-llm-proxy.sh`, `dist/`, and `src/token-usage.ts` were left untouched. Planning artifacts (this SUMMARY + STATE/ROADMAP) committed separately in the coding repo._

## Control-flow ordering (cooldown gate placement)

The cooldown gate sits BEFORE the lazy-spawn acquire. The relevant `complete()` ordering is:

1. `LLM_PROXY_DISABLE_WORKER_POOL` GUARD-01 disable check → overflow.
2. **D-06 cooldown gate** → `if (this._isInCooldown(key)) { ... return overflowFn(body, abortSignal); }`.
3. `let workers = this.workersByKey.get(key)` … LRU touch + `_reapStale`.
4. lazy-spawn acquire: `let worker = workers.find((w) => !w.busy); if (!worker && workers.length < this.size) this._spawnWorker(...)`.
5. all-busy → `overflowFn(body, abortSignal)`.

The cooldown gate (step 2) returns before step 4 ever runs, so a cooling-down key never spawns.

## Files Created/Modified
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/worker-pool.mjs` — added `DEFAULT_CRASH_THRESHOLD`/`DEFAULT_CRASH_WINDOW_MS` knobs; `_crashThreshold`/`_crashWindowMs`/`_crashesByKey` constructor fields; `_recordCrash`/`_isInCooldown` methods; the `_spawnWorker` exit handler now records a crash; and the cooldown gate at the top of `complete()`.
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/unit/worker-pool.test.mjs` — added `makeBootCrashWorker` fake-worker seam (fires its `'exit'` cb + rejects RETRYABLE on write) and a `D-06 crash cooldown` describe block with 6 cases: helper smoke, crash recording, trips-to-overflow, stays-in-cooldown, lazy-spawn-after-window, healthy-key-unaffected.
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/helpers/mock-claude-stdio.mjs` — added `makeMockEarlyExitStdio` (boot-crash stdio: stdout ends on the next tick); existing factories unchanged.

## Decisions Made
- **Record every exit, filter by window+threshold** (the early-exit heuristic above) rather than a per-worker served-ok flag — simpler exit handler, no live-path bookkeeping.
- **`Map<key, number[]>` of timestamps** for crash frequency — minimal, prune-on-record, self-clearing (`_isInCooldown` deletes a cold key), no separate cooldown timer needed.
- **Reuse the existing `overflowFn` route verbatim** (`overflowFn(body, abortSignal)`) — the cooldown degrades to the SAME execFile path the milestone already uses for overflow (Context: "degrade to the SAME execFile path the milestone already uses"), not a new degraded route.
- **Env knob names** `LLM_PROXY_WORKER_CRASH_THRESHOLD` / `LLM_PROXY_WORKER_CRASH_WINDOW_MS` per the locked `LLM_PROXY_WORKER_*` house style.

## Deviations from Plan

### Auto-fixed Issues

None — both tasks executed as written.

### Plan-interpretation note (not a deviation)

- The plan's Task 1 `<behavior>` said the crash-recording assertion could be "via a small accessor or by observing the cooldown trip in Task 2's test". I asserted directly against `pool._crashesByKey.get(key).length === 1` (the structure gains exactly one entry) rather than adding a public accessor — the structure is the locked representation, so a direct read is the most faithful "the structure gains an entry" assertion and needs no new surface.
- The RED commit carries BOTH Task 1's and Task 2's failing cases together because they share the `makeBootCrashWorker` test seam and live in one describe block; the two GREEN commits then land Task 1 (crash recording) and Task 2 (cooldown gate) atomically and independently. After Task 1 GREEN the suite was 37/39 (crash recording green; only the 2 cooldown-gate cases red), confirming the per-task RED→GREEN progression.

**Total deviations:** 0 auto-fixed.
**Impact on plan:** None — the machinery lands exactly where the plan, PATTERNS map (§ D-06), and threat model placed it, with the full unit suite green and zero regression.

## Issues Encountered
The RED run failed exactly the 3 cooldown-dependent cases (crash recording, trips-to-overflow, stays-in-cooldown) while the helper-smoke, lazy-spawn-after-window, and healthy-key cases passed (the helper exists and the happy path is unchanged even without the gate) — the expected RED signature for "the cooldown machinery does not exist yet". The `node --test <file> --live` argv gotcha does not apply (all cases are unit-level, no `--live` gate).

## Threat Surface
No new network endpoints, auth paths, file access, or schema changes. Both threats the plan's `<threat_model>` flagged as `mitigate` are now closed by passing unit cases:
- **T-63-06** (a persistently-broken key spin-loops spawn→crash→RETRYABLE every request — self-inflicted DoS on the proxy host) — per-key crash-frequency tracking + the cooldown gate route the key to the execFile overflow for the window once the threshold is crossed; bounded, degrades to pre-milestone behavior. Proven by the "trips to overflow" and "stays in cooldown" cases.
- **T-63-07** (healthy worker churn falsely tripping cooldown — false positive starving a good key) — the window prunes old crash timestamps so only a BURST within the window trips cooldown; healthy spaced churn never accumulates to the threshold. Proven by the "healthy key unaffected" case. Residual LOW.
- **T-63-SC** (npm/pip/cargo installs) — accept; no new packages, Node builtins only.

## Known Stubs
None. The crash-frequency tracking and cooldown gate are fully wired into the live `complete()` dispatch path and the `_spawnWorker` exit handler (not placeholders). The only test-only affordance is the `makeBootCrashWorker` fake-worker seam, which is inert on the live CLI path.

## User Setup Required
None — no external service configuration. `LLM_PROXY_WORKER_CRASH_THRESHOLD` (default 3) and `LLM_PROXY_WORKER_CRASH_WINDOW_MS` (default 60s) are optional env overrides.

## Next Phase Readiness
- **Plan 04 (cancellation):** a SIGTERM'd worker's `'exit'` now counts as a crash for the key — Plan 04 should ensure intentional dispose-on-cancel does not falsely trip cooldown (cancel is rare and spaced, so the window+threshold absorbs it; flag if a stress case shows otherwise).
- **Plan 05 (`--live` crash case):** the cooldown is observable live — repeatedly killing a key's workers should, after the threshold, route to the execFile overflow (no fresh `claude -p` pid) for the window, then spawn again afterward.
- No blockers.

## Self-Check: PASSED

---
*Phase: 63-worker-lifecycle-lazy-spawn-idle-eviction-crash-recovery-can*
*Completed: 2026-06-21*
