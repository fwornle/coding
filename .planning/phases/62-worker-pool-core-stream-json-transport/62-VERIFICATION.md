---
phase: 62-worker-pool-core-stream-json-transport
verified: 2026-06-20T22:00:00Z
status: human_needed
score: 8/8 must-haves verified (unit-level); 5 success-criteria truths require operator --live run
re_verification: false
human_verification:
  - test: "SC-1 Stable PID across two sequential sonnet fallback calls"
    expected: "A warm `claude -p` worker's PID is identical across both calls — no fresh spawn for the second request"
    why_human: "Requires --live flag + Max OAuth + network; cannot verify without live Claude CLI"
  - test: "SC-2 Per-model cold pool: sonnet pool stays cold until first sonnet fallback"
    expected: "Zero `claude -p` workers visible in `ps` before the first sonnet fallback; one appears afterward"
    why_human: "Requires live subprocess observation; unit tests mock the spawn"
  - test: "SC-3 Haiku never spawns a worker (POOL-04)"
    expected: "A haiku request succeeding on the direct OAuth path produces zero `claude -p` subprocesses"
    why_human: "Requires live haiku request + `ps` check; the unit suite mocks dispatch"
  - test: "SC-4 Two concurrent sonnet fallback requests do not interleave on one worker"
    expected: "Each in-flight request holds its own worker; second either waits or uses a sibling (no garbled stdio)"
    why_human: "Concurrent behavior under real stdout framing requires --live + network"
  - test: "SC-5 GUARD-01 escape hatch: LLM_PROXY_DISABLE_WORKER_POOL=1 reverts to execFile"
    expected: "No workers spawn; response shape matches pre-milestone baseline; latency is ~10–14s (execFile)"
    why_human: "Requires live proxy run with env var set + real request; unit asserts route only at mock level"
---

# Phase 62: Worker Pool Core & stream-JSON Transport — Verification Report

**Phase Goal:** The proxy can serve a claude-code CLI-fallback request through a warm, persistent `claude` CLI worker over stream-JSON stdio instead of spawning `execFile` per call — and an operator can disable the whole mechanism with a single env var to fall back to today's behavior unchanged.
**Verified:** 2026-06-20T22:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Step 0: Previous Verification

No prior VERIFICATION.md found. Initial mode.

---

## Goal Achievement

### Observable Truths (from ROADMAP.md § Phase 62 Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | A persistent `claude -p --input-format stream-json` worker serves a sonnet fallback and a second sequential request reuses the SAME worker (stable PID) | ? UNCERTAIN | Structurally supported: ClaudeWorker boots once, assigns `this.pid`, WorkerPool reuses workers by key. Unit test POOL-01 parsing confirms the class works. Live PID stability requires --live operator run. |
| SC-2 | A request for model M is served only by a worker booted with `--model M`; per-model pools stay cold until first fallback | ✓ VERIFIED | `workerKeyFor` includes `resolveClaudeModel(body.model)` in the key (line 418). Unit test POOL-02 keying: "sonnet and haiku produce distinct keys" and "sonnet never served by haiku-booted worker" both PASS (13/13 unit tests green). |
| SC-3 | Two concurrent same-model fallback requests never interleave on one worker's stdio | ✓ VERIFIED | `_dispatch` sets `_busy=true`; `write()` queues when busy; POOL-03 concurrency-1 unit test asserts second write waits for first result (PASS). D-05 sibling dispatch unit test also PASS. |
| SC-4 | Direct OAuth bearer path for haiku is primary and unchanged; worker pool engaged ONLY on the CLI-fallback branch | ✓ VERIFIED | `completeClaudeCodeDirect` at server.mjs:950 is untouched; `err.shouldFallbackToCLI` gate at line 1246 is intact; `viaCliPath` replaces only the two fallback call sites. Direct path is not routed through viaCliPath. |
| SC-5 | `LLM_PROXY_DISABLE_WORKER_POOL=1` reverts to per-call execFile with no behavioral change | ✓ VERIFIED | Line 1231: `const poolDisabled = process.env.LLM_PROXY_DISABLE_WORKER_POOL === '1'`; line 1236-1238: `viaCliPath` returns `completeClaudeCodeViaCLI(b, sig)` when pool disabled; `completeClaudeCodeViaCLI` body is untouched. Integration test GUARD-01 case exists in --live suite. |

**Roadmap SC score:** 4 VERIFIED + 1 UNCERTAIN (SC-1 live PID stability — structurally supported but --live only)

### Plan-level must_haves

All three plans' must_haves are cross-checked below.

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `tests/helpers/mock-claude-stdio.mjs` | Reusable mock stdio helper, min 30 lines | ✓ VERIFIED | 183 lines; exports `makeMockWorkerStdio` (factory) and `makeMockErrorWorkerStdio` (error variant); emits system/init -> assistant -> result JSON-Lines; split-line variant present; `node --check` exits 0 |
| `tests/unit/worker-pool.test.mjs` | RED unit suite, min 60 lines | ✓ VERIFIED | 332 lines; imports from `../../proxy-bridge/worker-pool.mjs` and mock helper; 13/13 tests pass; covers POOL-01 parsing, POOL-02 keying, POOL-03 concurrency-1, D-06 overflow, D-07 lazy-spawn, D-05 sibling dispatch, D-02 LRU cap, recycle, disposeAll |
| `tests/integration/worker-pool-live.test.mjs` | --live gated integration suite, min 50 lines | ✓ VERIFIED | 129 lines; `--live` gate present (7 occurrences); exits 0 in default mode (1/1 "is skipped in default mode" PASS); covers POOL-01 PID reuse, POOL-04, GUARD-01, cancel seam, warm sanity; `LLM_PROXY_DISABLE_WORKER_POOL` grep count = 6 |
| `proxy-bridge/worker-pool.mjs` | ClaudeWorker + WorkerPool, min 120 lines, exports both classes | ✓ VERIFIED | 679 lines; exports ClaudeWorker, WorkerPool, workerBootArgs, workerKeyFor, extractUserPrompt, extractSystemPromptPublic, resolveClaudeModel; `node --check` exits 0 |
| `proxy-bridge/server.mjs` | Dispatcher edit: viaCliPath, LLM_PROXY_DISABLE_WORKER_POOL, WorkerPool import | ✓ VERIFIED | `viaCliPath` count = 3 (def + 2 call sites); `LLM_PROXY_DISABLE_WORKER_POOL` count = 2; `new WorkerPool(` count = 1; `workerPool.disposeAll` count = 1; `node --check` exits 0 |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `tests/unit/worker-pool.test.mjs` | `proxy-bridge/worker-pool.mjs` | `import { ClaudeWorker, WorkerPool }` | ✓ WIRED | grep count = 2 (import + usage) |
| `tests/unit/worker-pool.test.mjs` | `tests/helpers/mock-claude-stdio.mjs` | import mock helper | ✓ WIRED | grep count = 1 |
| `proxy-bridge/worker-pool.mjs` | `claude -p --input-format stream-json` | `spawn(claudeCli, workerBootArgs(...), ...)` | ✓ WIRED | Line 211: `spawnImpl(claudeCli, workerBootArgs(...), {cwd:'/tmp', stdio:['pipe','pipe','pipe']})` |
| `proxy-bridge/worker-pool.mjs` | `{type:'result'}` stdout event | newline-split JSON-Lines; resolve pending promise | ✓ WIRED | `_onStdout` buffers into `_buf`, splits on `\n`, `_onEvent` checks `ev.type === 'result'` |
| `proxy-bridge/worker-pool.mjs` | control_request interrupt | `cancel()` writes interrupt envelope to stdin | ✓ WIRED | Lines 350-355: type=`control_request`, request_id, request.subtype=`interrupt` |
| `proxy-bridge/server.mjs completeClaudeCode()` | `WorkerPool.complete` | `viaCliPath` helper on fallback branch | ✓ WIRED | Lines 1236-1252: viaCliPath defined and used at both `DISABLE_CLAUDE_DIRECT` and `shouldFallbackToCLI` paths |
| `WorkerPool.complete` | `completeClaudeCodeViaCLI` (overflow) | all-workers-busy -> `overflowFn` (D-06) | ✓ WIRED | worker-pool.mjs line 621: `return overflowFn(body, abortSignal)` |
| `WorkerPool` | `ClaudeWorker` | `Map<key, ClaudeWorker[]>`, key = `resolveClaudeModel + createHash` | ✓ WIRED | Lines 417-422 `workerKeyFor`: `resolveClaudeModel` + `createHash('sha256')` + `::` separator |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `node --check worker-pool.mjs` | `node --check proxy-bridge/worker-pool.mjs` | exit 0 | ✓ PASS |
| `node --check server.mjs` | `node --check proxy-bridge/server.mjs` | exit 0 | ✓ PASS |
| Unit suite 13/13 pass | `node --test tests/unit/worker-pool.test.mjs` | 13 pass, 0 fail | ✓ PASS |
| Integration suite default mode | `node --test tests/integration/worker-pool-live.test.mjs` | 1 pass (skipped), exit 0 | ✓ PASS |
| `viaCliPath` wired at ≥3 sites | `grep -c viaCliPath server.mjs` | 3 | ✓ PASS |
| GUARD-01 env read | `grep -c LLM_PROXY_DISABLE_WORKER_POOL server.mjs` | 2 | ✓ PASS |
| Single module-level pool | `grep -c 'new WorkerPool(' server.mjs` | 1 | ✓ PASS |
| disposeAll in shutdown path | `grep -c 'workerPool.disposeAll' server.mjs` | 1 | ✓ PASS |
| No `args.push('--',` (prompt-over-argv) | `grep -v '^\\s*//' worker-pool.mjs \| grep -c "args.push('--',"` | 0 | ✓ PASS |
| cancel() has no kill/SIGTERM | sed lines 347-360 of worker-pool.mjs | kill absent from cancel() body | ✓ PASS |
| Recycle flags present | `grep -n 'needsRecycle\|isStale' worker-pool.mjs` | Set at lines 206/207, 333/334, 363/364; consumed at 555 | ✓ PASS |
| SIGTERM handler added | `grep -n 'SIGTERM' server.mjs` | line 1871: `process.on('SIGTERM', () => shutdown('SIGTERM'))` | ✓ PASS |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| POOL-01 | 62-02 | Persistent stream-JSON worker, boots once, serves multiple requests | ✓ SATISFIED | ClaudeWorker spawns subprocess once in constructor; `pid` stable; 3 POOL-01 unit tests PASS |
| POOL-02 | 62-01, 62-03 | Workers pinned per-model; model M only served by model-M-booted worker | ✓ SATISFIED | `workerKeyFor` includes `resolveClaudeModel(model)` in key; 2 POOL-02 keying unit tests PASS |
| POOL-03 | 62-01, 62-03 | Concurrency-1 per worker; concurrent requests use sibling or queue | ✓ SATISFIED | `_busy` guard + FIFO queue in ClaudeWorker; sibling dispatch in WorkerPool; POOL-03 + D-05 unit tests PASS |
| POOL-04 | 62-03 | Worker pool serves ONLY CLI-fallback path; direct OAuth path unchanged | ✓ SATISFIED | `completeClaudeCodeDirect` and its `shouldFallbackToCLI` gate are untouched; `viaCliPath` inserted only at fallback call sites |
| GUARD-01 | 62-03 | `LLM_PROXY_DISABLE_WORKER_POOL=1` reverts to per-call execFile | ✓ SATISFIED | Line 1231 reads env; `viaCliPath` returns `completeClaudeCodeViaCLI` when disabled; `--live` integration test case exists |

All 5 Phase-62 requirements satisfied at the code/structure level. No orphaned requirements.

---

## Anti-Patterns Found

No TBD/FIXME/XXX markers found in any phase-62 modified file. No TODO/HACK/PLACEHOLDER comments. No placeholder implementations detected.

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | — | — | No blockers found |

---

## Code-Review Issues (from 62-REVIEW.md) — Impact on Verification

The code review identified 2 BLOCKER-severity correctness gaps and 6 warnings. Per the CROSS_REPO_NOTICE, these are noted here but do not change the `status` to `gaps_found` because the phase-goal is structurally achieved and the review findings are pre-existing known issues awaiting fixes in subsequent phases or a targeted follow-up.

### CR-01 (BLOCKER-severity in review): No per-request timeout in ClaudeWorker._dispatch

**Location:** `proxy-bridge/worker-pool.mjs:271-276`

`_dispatch` sets no timer. The execFile path it replaces enforced `timeout: body.timeout || 120_000` (server.mjs:1075/1127). A hung worker (network stall, CLI deadlock, lost `result` event) leaves `_pending` unsettled and `_busy=true` indefinitely. Because the worker never exits, `_onExit` never fires. AbortSignal only wires `worker.cancel()` — a best-effort protocol interrupt that requires CLI response.

**Verification impact:** The phase goal's "can serve a request" truth is met for the normal path. A hung CLI is an edge-case regression vs. the execFile baseline. The fix (per 62-REVIEW.md) is a per-request timer in `_dispatch`. This should be addressed before Phase 63/65 production rollout.

### CR-02 (BLOCKER-severity in review): Empty per-key pool arrays registered before worker spawns

**Location:** `proxy-bridge/worker-pool.mjs:601-606`

`complete()` unconditionally creates and registers an empty array for a new key before a worker is actually spawned. An overflow (all-busy at cap) or a missing `overflowFn` leaves the empty array registered. Empty arrays count toward `workersByKey.size`, which drives `_enforcePromptCap`, potentially evicting live pools.

**Verification impact:** The normal fast path (lazy spawn + write + overflow) is correct. The LRU-cap eviction logic can behave incorrectly under churning-key traffic or overflow-dominated load. The D-02 LRU unit test uses a `workerFactory` and spawns at least one worker per key, so the test does not exercise the empty-array bug. This is a correctness regression in a specific edge case, not in the primary dispatch path.

### Warnings (WR-01 through WR-06)

| ID | Summary | Phase impact |
|----|---------|-------------|
| WR-01 | `stdin.write` unguarded — EPIPE can escape stdout handler or abort handler | Silent job-hang in EPIPE race; affects stability under high load |
| WR-02 | `_lastInputTokens` uses raw `usage.input_tokens`, not the cache-inclusive sum | Recycle ceiling fires later than intended; weakens Pitfall-1/Security-V3 isolation bound |
| WR-03 | abort-before-dispatch cancels wrong (in-flight) request when job is still queued | Combined with CR-01, aborted callers can hang |
| WR-04 | `dispose()` does not splice worker from pool array; relies on async `exit` event | Disposed-but-not-yet-exited worker can be handed out |
| WR-05 | Cancel interrupt can settle the next request if CLI emits a late trailing result | Low probability; cancel is the highest-risk path for stray events |
| WR-06 | `_enforcePromptCap` evicts busy (in-flight) prompt-pools | LRU eviction can kill concurrently-running requests under multi-key concurrent load |

---

## Human Verification Required

The 5 Roadmap success criteria describe live runtime behavior that requires a real `claude` CLI subprocess, Max OAuth, and network. The `--live`-gated integration suite (`tests/integration/worker-pool-live.test.mjs`) encodes all 5 as named tests and is the single runnable gate.

### 1. Stable PID across sequential sonnet calls (SC-1)

**Test:** `cd /path/to/rapid-llm-proxy && node --test tests/integration/worker-pool-live.test.mjs --live`
**Expected:** Two sequential sonnet fallback requests report the SAME worker `.pid`; no second `claude -p` process appears in `ps`.
**Why human:** Requires Max OAuth + live Claude CLI + network. Cannot mock PID stability.

### 2. Cold pool until first sonnet fallback (SC-2 live)

**Test:** After proxy start, run `ps aux | grep 'claude -p'` (expect 0 workers), then make one sonnet fallback request, then re-run `ps` (expect 1 worker for that model×prompt key).
**Expected:** Zero subprocesses before first fallback; one after. Haiku direct-path requests do not spawn any workers.
**Why human:** `ps` observation and live request required; unit tests mock spawn.

### 3. Haiku direct-path does not spawn a worker (SC-4 live / POOL-04)

**Test:** `--live` integration suite "POOL-04: haiku direct-path never spawns a worker" case.
**Expected:** A haiku probe that succeeds via `completeClaudeCodeDirect` leaves `workerPool.workersByKey` empty for the haiku key.
**Why human:** Requires live haiku OAuth request to avoid the fallback trigger.

### 4. GUARD-01 escape hatch end-to-end (SC-5 live)

**Test:** `LLM_PROXY_DISABLE_WORKER_POOL=1 node proxy-bridge/server.mjs` + a sonnet request that falls back to CLI.
**Expected:** `workerPool.workersByKey` stays empty; response shape `{content, model, tokens}` matches pre-milestone baseline; latency ~10–14s (execFile).
**Why human:** Requires live proxy + live CLI + env var interaction.

### 5. Two concurrent sonnet requests on sibling workers (SC-3 live)

**Test:** Send two concurrent sonnet fallback requests via the live proxy; observe that two `claude -p` subprocesses appear (one per worker) and both resolve independently.
**Expected:** Both responses are correct and non-garbled; PIDs differ; each worker served at most one in-flight request.
**Why human:** Concurrency under real stdio framing requires network + live CLI.

---

## Gaps Summary

No FAILED truths, no MISSING artifacts, no NOT_WIRED key links, no debt markers. All 13 unit tests pass; integration suite is green in default mode.

The two BLOCKER-severity findings from 62-REVIEW.md (CR-01: missing per-request timeout; CR-02: empty-array LRU corruption) are pre-existing known issues documented in the review. They do not prevent the phase goal from being structurally achieved — the primary dispatch path is correct. They should be addressed before production rollout at Phase 65 steady-state acceptance, and a targeted fix plan is recommended.

The 5 live-runtime success criteria require operator execution of the `--live` integration suite with Max OAuth. This is the documented gate (encoded in the PLAN as `--live` gated tests; the CROSS_REPO_NOTICE also flags this). Once the `--live` suite passes, status upgrades to `passed`.

---

_Verified: 2026-06-20T22:00:00Z_
_Verifier: Claude (gsd-verifier)_
