---
phase: 63-worker-lifecycle-lazy-spawn-idle-eviction-crash-recovery-can
plan: 05
subsystem: infra
tags: [llm-proxy, worker-pool, lifecycle, live-verification, claude-cli, nodejs, autonomous-false]

# Dependency graph
requires:
  - phase: 63-worker-lifecycle-lazy-spawn-idle-eviction-crash-recovery-can
    plan: 01
    provides: "ClaudeWorker deps.idleMs idle-eviction seam (SC-2 tiny window) + WorkerPool._disposeAndDrop (SC-4 abort path)"
  - phase: 63-worker-lifecycle-lazy-spawn-idle-eviction-crash-recovery-can
    plan: 02
    provides: "_writeGuarded EPIPE-as-crash + _onExit RETRYABLE reap (SC-3 WORKER_RETRYABLE shape)"
  - phase: 63-worker-lifecycle-lazy-spawn-idle-eviction-crash-recovery-can
    plan: 03
    provides: "crash-cooldown / no-auto-restart respawn-storm guard (SC-3 no-storm sampling)"
  - phase: 63-worker-lifecycle-lazy-spawn-idle-eviction-crash-recovery-can
    plan: 04
    provides: "complete() abort handler -> _disposeAndDrop SIGTERM+dispose (SC-4 new-pid respawn, the Phase-62 hang inverse)"
provides:
  - "tests/integration/worker-pool-live.test.mjs: four --live lifecycle cases (SC-1..SC-4) proving ROADMAP Phase-63 success criteria against a real `claude -p` subprocess"
  - "countClaudeWorkers() `ps`/`pgrep` worker-count helper + afterEach teardown asserting zero orphaned workers (T-63-11)"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "`ps`/`pgrep` liveness probe of the literal `claude -p` worker argv as the cold-start / idle-evict / crash / cancel assertion surface (no protocol introspection)"
    - "afterEach zero-orphan teardown reaps any pool/worker the case created via dispose() (SIGTERM) — non-terminating cancel() is never used for cleanup"
    - "Bounded Promise.race timeout guard around the aborted complete() so a regression to the Phase-62 hang FAILS the case instead of hanging the suite"

key-files:
  created: []
  modified:
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/worker-pool-live.test.mjs

key-decisions:
  - "Reused the existing Phase-62 `--live` gate (process.argv.includes('--live') || LLM_PROXY_LIVE==='1') verbatim — appended the four new cases INSIDE the existing live describe block; no second gate, no new file."
  - "Replaced (not duplicated) the Phase-62 cancel-seam SAME-pid case with SC-4 — the D-01 SIGTERM+respawn behaviour inverts the old same-pid-survives expectation to a NEW-pid expectation."
  - "Routed POOL-01 + warm-sanity cleanup through the module-level teardown handle (dispose()/SIGTERM) instead of the non-terminating cancel(), so the zero-orphan teardown assertion holds for the pre-existing cases too."

requirements-completed: []   # WLIFE-01..04 are live-pending: ROADMAP discharge gated on the operator live run below

# Metrics
duration: 12min
completed: 2026-06-21
---

# Phase 63 Plan 05: `--live` Lifecycle Verification Suite (SC-1..SC-4) Summary

**Authored the four `--live` lifecycle cases (cold-start / idle-evict / crash / cancel) that prove ROADMAP Phase-63 SC-1..SC-4 against a real `claude -p` worker subprocess via a `ps`-based `countClaudeWorkers()` helper and an `afterEach` zero-orphan teardown — including the dedicated SC-1 cold-start probe (the Phase-62 PARTIAL, D-09) and the SC-4 cancel case that is the live inverse of the Phase-62 cancel HANG (62-HUMAN-UAT test 6). All AUTO work is done and mock-green; the LIVE run itself is an OPERATOR checkpoint (`autonomous: false`) — see "Operator Live-Run — PENDING" below.**

## Autonomy boundary (why this plan is `autonomous: false`)

This SUMMARY records ONLY the AUTO portion (suite authored, mock gate green, acceptance greps passing, test file committed). The `--live` execution spawns real `claude -p` subprocesses and makes real billed Anthropic API calls; it requires the operator's Max OAuth keychain + network and CANNOT run unattended. **WLIFE-01..04 ROADMAP discharge is gated on the operator live run** documented at the end of this file. Until that run passes, WLIFE-01 stays "Not started → live-pending" and WLIFE-02/03/04 keep their existing UNIT-proven status (Complete at the unit level from Plans 63-01..04) but their live-suite confirmation remains pending.

## Performance

- **Duration:** ~12 min
- **Tasks:** 3 (all AUTO — author + mock-verify + commit; the live run is a separate operator checkpoint)
- **Files modified:** 1 (the live test file, in the external rapid-llm-proxy repo)

## Accomplishments

- **Task 1 — `countClaudeWorkers()` helper + teardown + SC-1 cold-start:** added a module-scope `countClaudeWorkers()` that shells `pgrep -f 'claude -p'` (with a `ps -ax` + JS-grep fallback, matcher line excluded) and returns the integer count of live `claude -p` worker subprocesses; an `afterEach` teardown that disposes any pool/worker the case registered and asserts `countClaudeWorkers() === 0` after a short settle (T-63-11 resource-exhaustion mitigation); and the SC-1 case asserting **0 workers before** the first sonnet fallback and **exactly 1 after** (plus `workersByKey` length 1) — the dedicated cold-start probe D-09 calls for, closing the Phase-62 PARTIAL. Verify-only: no spawn logic changed.
- **Task 2 — SC-2 idle-evict + SC-3 crash:** SC-2 constructs a worker with a tiny injected `{ idleMs: 1500 }` (Plan 01 seam), drives a request, asserts the worker disappears from `ps` after the idle window, then a fresh same-key request respawns a NEW pid. SC-3 starts a longer in-flight request, `process.kill(worker.pid, 'SIGKILL')`s it mid-stream, asserts the in-flight promise rejects RETRYABLE (`e.retryable===true && e.code==='WORKER_RETRYABLE'`), samples `ps` 6× over ~1.5s to prove no respawn-storm (max ≤ 1, settles to 0 — D-06 no-auto-restart), then a single lazy respawn (new pid).
- **Task 3 — SC-4 cancel (the Phase-62 HANG inverse):** **replaced** the Phase-62 cancel-seam SAME-pid case with a case that drives a REAL `controller.abort()` through `pool.complete(body, controller.signal, overflowFn)` (Plan 04 D-01 path — never `worker.cancel()`), asserts (a) the aborted promise settles within a bounded `Promise.race` timeout (a regression to the Phase-62 hang FAILS the case, not the suite), (b) the worker is SIGTERMed and gone from `ps` and dropped from the key, and (c) the next same-key request cold-respawns a NEW pid.
- **Mock gate green + zero regression:** `node --test tests/integration/worker-pool-live.test.mjs` exits 0 with the live block SKIPPED (CI without Max OAuth stays green). The existing `--live` gate (lines ~57-68) was reused verbatim; no second gate, no new file.

## MOCK-mode verification result (the only test run performed)

```
cd /Users/Q284340/Agentic/_work/rapid-llm-proxy && node --test tests/integration/worker-pool-live.test.mjs
```
- **Result: PASS** — `tests 1 / pass 1 / fail 0`, the live describe block SKIPPED (only the `is skipped in default mode` placeholder runs), **exit 0**.
- `node --check tests/integration/worker-pool-live.test.mjs` → SYNTAX_OK.

> The `LLM_PROXY_LIVE=1` live run was deliberately NOT performed here — it is the operator checkpoint below.

## Acceptance-grep results (all passing)

| Grep | Expected | Result |
|------|----------|--------|
| `grep -c 'claude -p' …` | ≥ 1 | **12** |
| `grep -n 'countClaudeWorkers' …` | defined + in SC-1 + in teardown | defined @92; teardown @136; SC-1 @147,168 |
| `grep -n 'afterEach' …` | teardown disposes pool/worker | import @50; teardown @128 |
| `grep -n 'SC-1' …` | cold-start case | @145 |
| `grep -n 'SC-2 WLIFE-02 idle-evict' …` | case name | @227 |
| `grep -n 'SC-3 WLIFE-03 crash' …` | case name | @256 |
| `grep -n 'process.kill' …` | SC-3 kills by pid | @267 (`SIGKILL`) |
| `grep -n 'WORKER_RETRYABLE' …` | SC-3 RETRYABLE shape | @272 |
| `grep -n 'idleMs' …` | SC-2 tiny window | @228,230,243 |
| `grep -n 'SC-4 WLIFE-04 cancel' …` | case name | @303 |
| `grep -n 'controller.abort\|AbortController' …` | abort-driven (not cancel()) | @309,324 |
| `grep -c 'must survive interrupt' …` | **0** (old SAME-pid assertion gone) | **0** |
| bounded wait (`setTimeout`/`Promise.race`) around abort | present | @332,340 |
| actual `worker.cancel()` invocations in live cases | 0 (comments only) | 0 |

## Task Commits

Committed to the EXTERNAL `rapid-llm-proxy` repo (branch `main`, not pushed):

1. **`b40bc23`** `test(63-05): add --live lifecycle verification suite (SC-1..SC-4 / WLIFE-01..04)`

_One commit (the suite is a single coherent author-step; the three AUTO tasks share the helper + teardown + live describe block). The pre-existing uncommitted changes in `bin/start-llm-proxy.sh`, `dist/`, and `src/token-usage.ts` were left untouched — only `tests/integration/worker-pool-live.test.mjs` was staged. Planning artifacts (this SUMMARY + STATE) are committed separately in the coding repo._

## Files Created/Modified

- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/worker-pool-live.test.mjs` — added `execFileSync` + `afterEach` imports, the `countClaudeWorkers()`/`settle()` helpers, the zero-orphan `afterEach` teardown, the SC-1/SC-2/SC-3/SC-4 cases; replaced the Phase-62 cancel-seam SAME-pid case; routed POOL-01 + warm-sanity cleanup through the teardown handle (dispose/SIGTERM) instead of the non-terminating cancel(); updated the header docblock coverage list.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Pre-existing cases used the non-terminating `cancel()` for cleanup, which would trip the new zero-orphan teardown**
- **Found during:** Task 1 (adding the `afterEach` teardown)
- **Issue:** The Phase-62 POOL-01 and warm-sanity cases each declared a local `const worker` and ended with `worker.cancel()`. `cancel()` writes a protocol interrupt but does NOT SIGTERM the subprocess (62-HUMAN-UAT test 6 proved it leaves the real stream alive), so under the new teardown those subprocesses would survive and the `countClaudeWorkers() === 0` assertion would FAIL on every live run.
- **Fix:** Both cases now assign to the module-level `worker` teardown handle (no local shadow) and rely on the teardown's `dispose()` (SIGTERM) for reaping; the trailing `cancel()` calls were removed.
- **Files modified:** `tests/integration/worker-pool-live.test.mjs`
- **Verification:** mock gate still exits 0; no actual `worker.cancel()` invocation remains in any live case (the 4 textual `cancel(` hits are all in comments).
- **Committed in:** `b40bc23`

**2. [Rule 3 - Blocking] Acceptance grep `must survive interrupt == 0` tripped by an explanatory docblock string**
- **Found during:** Task 3 acceptance grep
- **Issue:** My header docblock described the inversion using the verbatim phrase "worker must survive interrupt", which made `grep -c 'must survive interrupt'` return 1 instead of the required 0 (the grep is a proxy for "the old SAME-pid assertion is gone" — which it is; the assertion was removed).
- **Fix:** Rephrased the docblock to "the old same-pid-survives-the-interrupt expectation" — same meaning, no false grep hit.
- **Files modified:** `tests/integration/worker-pool-live.test.mjs`
- **Verification:** `grep -c 'must survive interrupt'` → 0; mock gate still exits 0.
- **Committed in:** `b40bc23`

**Total deviations:** 2 auto-fixed (1 cleanup bug, 1 grep-gate precision). No scope creep — both keep the suite faithful to the plan and the zero-orphan invariant.

## Known Stubs

None. The four cases drive the real `ClaudeWorker`/`WorkerPool` live surface; the only test-only affordance is the `ps`/`pgrep` count helper (a coarse liveness signal, T-63-13 accepted). No code path is stubbed.

## Threat Surface

No new network endpoints, auth paths, file access, or schema changes. The plan's `<threat_model>` dispositions are honored:
- **T-63-11** (orphaned `claude -p` workers / RAM exhaustion across runs) — `mitigate`: the `afterEach` teardown disposes the pool/worker AND asserts `countClaudeWorkers() === 0` after every case, so a leak fails LOUDLY. Residual LOW.
- **T-63-12** (kill/abort a wrong/reused pid) — `mitigate`: SC-3/SC-4 only signal a pid read DIRECTLY from the just-spawned `worker.pid` within the same case. Residual LOW.
- **T-63-13** (helper greps unrelated `claude -p` sessions) — `accept`: coarse liveness signal for a dedicated live-test run; the operator runbook below notes no competing `claude -p` session may run. Residual LOW.
- **T-63-SC** (npm/pip/cargo installs) — `accept`: Node builtins only (`node:child_process` `execFileSync`, `node:test`, `node:assert`); no new package.

## Self-Check: PASSED

- Test file exists and is committed: `b40bc23` in rapid-llm-proxy `main` (verified below).
- Mock gate exits 0 with the live block skipped (verified).
- All acceptance greps pass (table above).

---

## Operator Live-Run — PENDING

> **This is a `human-action` checkpoint.** The AUTO work (suite authored, mock-green, committed) is DONE. The four SC-1..SC-4 cases below have NOT been run against a real `claude -p` subprocess — that spawns real billed Anthropic API calls and requires the operator's Max OAuth keychain + network, so it cannot run unattended. **WLIFE-01..04 ROADMAP discharge is gated on this run passing.** Mirror the style of `62-HUMAN-UAT.md`.

### Prerequisites (operator host)

- Max OAuth via keychain (`buildClaudeEnv` strips API keys to force it), network access to the Anthropic API, installed `claude` CLI.
- **No competing `claude -p` session may be running** (T-63-13: `countClaudeWorkers()` greps the host process table and would over-count a parallel developer session). Run `pgrep -f 'claude -p'` first — it must print nothing.

### Exact command to run

```
cd /Users/Q284340/Agentic/_work/rapid-llm-proxy && LLM_PROXY_LIVE=1 node --test tests/integration/worker-pool-live.test.mjs
```

> NOTE: use the env var (or a direct `node tests/integration/worker-pool-live.test.mjs --live`). `node --test <file> --live` does NOT work — the test runner drops trailing argv in the per-file child process.

### What PASS looks like, per case

- **SC-1 (WLIFE-01) cold-start** — `countClaudeWorkers()` is **0** before the first sonnet fallback and **exactly 1** after it (and `workersByKey` for the sonnet key has length 1). Proves lazy spawn / closes the Phase-62 cold-start PARTIAL.
- **SC-2 (WLIFE-02) idle-evict** — after the tiny injected `idleMs` (1500ms) window the worker is **gone from `ps`** (count 0); the next same-key request respawns a **NEW pid** (count back to 1).
- **SC-3 (WLIFE-03) crash** — `SIGKILL` mid-request makes the in-flight promise reject **RETRYABLE** (`code==='WORKER_RETRYABLE'`); `ps` sampling shows **no respawn-storm** (max ≤ 1, settles to 0 — no tight spawn→crash loop); the next request lazily respawns **one** fresh worker.
- **SC-4 (WLIFE-04) cancel** — `controller.abort()` SIGTERMs+disposes the worker (**gone from `ps`**, dropped from the key); the aborted `complete()` **settles within the bounded timeout (does NOT hang)** — this is the Phase-62 cancel HANG (62-HUMAN-UAT test 6) now PASSING; the next same-key request spawns a **NEW pid**.
- **Teardown** — after every case `countClaudeWorkers()` is **0** (no orphaned `claude -p` worker survives). The suite exits **0**.

### Operator results table (fill in)

| Case | Requirement | Result (PASS/FAIL) | Observed pid(s) / notes |
|------|-------------|--------------------|--------------------------|
| SC-1 | WLIFE-01 cold-start lazy spawn | _____ | |
| SC-2 | WLIFE-02 idle-evict + fresh respawn | _____ | |
| SC-3 | WLIFE-03 crash → RETRYABLE, no storm | _____ | |
| SC-4 | WLIFE-04 cancel → SIGTERM, new pid, no hang | _____ | |
| — | Teardown: zero orphaned workers after each case | _____ | |
| — | Suite exit code (expect 0) | _____ | |

### After the run

- If all four PASS and the suite exits 0: update `REQUIREMENTS.md` to mark **WLIFE-01** Complete (live-proven) and annotate WLIFE-02/03/04 as live-confirmed, then update the ROADMAP Phase-63 SC discharge. This is the WLIFE-01..04 ROADMAP discharge.
- If any case FAILs or hangs: capture the failing case + `ps`/log output and re-open the corresponding Plan (63-01 idle / 63-02/03 crash / 63-04 cancel) — the live suite is doing its job of catching a regression the unit suite cannot.

---
*Phase: 63-worker-lifecycle-lazy-spawn-idle-eviction-crash-recovery-can*
*Completed (AUTO portion): 2026-06-21 — live run PENDING (operator)*
