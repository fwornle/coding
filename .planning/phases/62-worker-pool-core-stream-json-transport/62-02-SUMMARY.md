---
phase: 62-worker-pool-core-stream-json-transport
plan: 02
subsystem: infra
tags: [llm-proxy, claude-cli, subprocess-pool, stream-json, json-lines, worker-pool, nodejs]

# Dependency graph
requires:
  - phase: 62-01
    provides: "RED unit suite (tests/unit/worker-pool.test.mjs) + injected mock-claude-stdio helper that drive ClaudeWorker without a live CLI"
provides:
  - "ClaudeWorker class: persistent claude -p stream-JSON subprocess, JSON-Lines stdio framing, write()->Promise<{content,model,tokens}>, cancel() interrupt seam, threshold-driven recycle, reap-on-exit"
  - "WorkerPool skeleton: (model x prompt-hash) keying (keyFor) + concurrency-1 dispatch + D-06 overflow-on-busy (complete) — full lazy-spawn/LRU lifecycle deferred to Plan 03"
  - "workerBootArgs() helper: verbatim context-strip flags translated to stream-JSON session-start args (prompt over stdin, not argv)"
affects: [62-03, 63, phase-63-lifecycle, dispatcher-wiring, server.mjs-completeClaudeCode]

# Tech tracking
tech-stack:
  added: []  # zero new packages — node:child_process spawn + node:crypto + node:events builtins only
  patterns:
    - "One-promise-per-request over a persistent pipe (concurrency-1, Pattern 1)"
    - "JSON-Lines partial-line buffering (split on \\n, parse complete lines only — Pitfall 3)"
    - "Non-destructive cancel via control_request{interrupt} (worker survives — Q3)"
    - "Threshold-driven worker recycle to bound cross-call context leakage (Pitfall 1 / Security V3)"

key-files:
  created:
    - "/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/worker-pool.mjs (rapid-llm-proxy repo)"
  modified: []

key-decisions:
  - "ClaudeWorker self-serializes writes via a FIFO queue (concurrency-1 safety net) in addition to the pool routing to a sibling worker — the Plan-01 POOL-03 test calls worker.write() twice directly and expects no interleave."
  - "mapResultError checks quota/auth strings BEFORE the error_during_execution subtype, because the Plan-01 error-mapping mock carries subtype=error_during_execution AND a 'rate limit' result string; subtype-first would have mis-mapped a real quota failure to 'client disconnected'."
  - "WorkerPool skeleton (keyFor + complete + overflow) shipped in Plan 02 (not deferred wholesale to Plan 03) because tests/unit/worker-pool.test.mjs imports BOTH ClaudeWorker and WorkerPool — omitting WorkerPool would ERR_MODULE_NOT_FOUND the whole suite and leave every case RED."
  - "Recycle thresholds are injectable (deps.maxRequests / deps.maxInputTokens) with env-knob + documented defaults (50 requests / 150k input tokens) per RESEARCH Open-Q 1 conservative recommendation."

patterns-established:
  - "Pattern 1: write() returns a Promise stored as a single _pending slot; the {type:'result'} event resolves/rejects it and dequeues the next FIFO job. Only result is the end-of-response boundary (init/assistant are non-terminal)."
  - "Pattern 2: worker key = resolveClaudeModel(model)::sha256(systemPrompt).slice(0,16) — per-model isolation mandatory (Q2)."
  - "Reap-on-exit: subprocess exit/close settles _pending AND queued jobs as RETRYABLE (err.retryable=true, code='WORKER_RETRYABLE') and emits 'exit'."

requirements-completed: [POOL-01]

# Metrics
duration: 14min
completed: 2026-06-20
---

# Phase 62 Plan 02: ClaudeWorker Core & stream-JSON Transport Summary

**A persistent `claude -p` stream-JSON subprocess (`ClaudeWorker`) that boots once with the verbatim context-strip flags, frames JSON-Lines stdio with partial-line safety, returns the interchangeable `{content,model,tokens}` contract, and exposes a non-destructive interrupt cancel seam plus a mandatory context-leak recycle flag — turning the Plan-01 unit suite GREEN (7/7).**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-06-20T20:50Z (approx)
- **Completed:** 2026-06-20
- **Tasks:** 2 (implemented together in one new file)
- **Files modified:** 1 created (rapid-llm-proxy repo)

## Accomplishments
- `ClaudeWorker` boots a persistent stream-JSON `claude` subprocess once (stable PID) and serves multiple sequential requests without respawn — eliminating the ~2.3s per-call boot cost (RESEARCH Q4).
- JSON-Lines stdout framing buffers and splits on `\n`, parsing only complete lines, so a `result` line spanning chunk boundaries still parses (Pitfall 3); stderr is continuously drained so the pipe never stalls a long-lived worker.
- Token/content extraction ports server.mjs:1158-1178 verbatim (`input = inputTokens + cacheRead + cacheCreation`), producing the exact `{content,model,tokens:{input,output,total}}` contract that makes the worker drop-in interchangeable with the D-06 execFile overflow path.
- `cancel()` writes a `control_request{subtype:'interrupt'}` with a `crypto.randomUUID()` request_id and keeps the worker alive (no SIGTERM/respawn — Q3); the in-flight request settles via the `error_during_execution` -> client-disconnect mapping.
- Mandatory threshold-driven `needsRecycle`/`isStale` flag (request-count or input-token ceiling) bounds cross-call context leakage (Pitfall 1 / Security V3); non-statelessness documented in a module-level comment.
- Reap-on-exit settles in-flight AND queued requests as RETRYABLE and emits `'exit'`.

## Task Commits

Both tasks edit the same net-new file and were verified together against the Plan-01 suite, so they landed in one atomic `feat` commit (the file did not pre-exist to split into incremental task edits):

1. **Task 1 (boot, JSON-Lines framing, write()->Promise, token/content extraction) + Task 2 (cancel() interrupt seam, context-leak recycle, reap-on-exit)** — `e522e6c` (feat) — committed to the **rapid-llm-proxy** repo (`/Users/Q284340/Agentic/_work/rapid-llm-proxy`).

**Plan metadata:** committed to the **coding** repo (this SUMMARY + STATE + ROADMAP).

## Files Created/Modified
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/worker-pool.mjs` (496 lines) — `ClaudeWorker` (persistent spawn, framing, write/cancel/recycle/reap) + `WorkerPool` (keyFor/complete/overflow skeleton) + `workerBootArgs`/`workerKeyFor`/`extractUserPrompt`/`resolveClaudeModel` helpers.

## Verification
- `node --check proxy-bridge/worker-pool.mjs` exits 0.
- `node --test tests/unit/worker-pool.test.mjs` -> **7 tests, 7 pass, 0 fail** (POOL-01 parsing, split-line Pitfall-3, QUOTA/AUTH error mapping, POOL-02 keying x2, POOL-03 concurrency-1, POOL-03/D-06 overflow).
- Source assertions all pass: `export class ClaudeWorker` present; boot args carry `--input-format`/`stream-json`/`--verbose`/`--model` + full strip set; `grep -v '^\s*//' | grep -c "args.push('--',"` returns 0 (prompt-over-stdin); newline-split buffer present; `interrupt`/`control_request`/`request_id` present; `kill(` appears ONLY in `dispose()` (not `cancel()`); `needsRecycle`/`isStale` gated on request-count + `input_tokens` threshold; exit/close listener rejects `_pending`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Error-mapping precedence: quota/auth string checked before the abort subtype**
- **Found during:** Task 1 verification (the is_error parsing test failed RED).
- **Issue:** The Plan-01 error mock (`makeMockErrorWorkerStdio`) emits a `result` event with BOTH `subtype:'error_during_execution'` AND `result:'rate limit exceeded'`, expecting a `QUOTA_EXHAUSTED`/`rate limit` rejection. My initial `mapResultError` checked the `error_during_execution` subtype first and returned `'client disconnected'`, never reaching the quota check.
- **Fix:** Reordered `mapResultError` to test the quota/auth diagnostic strings first, then fall through to the `error_during_execution` -> client-disconnect mapping for the empty-result interrupt case. Both the interrupt seam (empty result) and the quota mapping (diagnostic string) now resolve correctly.
- **Files modified:** worker-pool.mjs
- **Commit:** e522e6c

**2. [Rule 1 - Bug] Concurrency-1 needed an explicit FIFO queue, not a single overwritten `_pending` slot**
- **Found during:** Task 1 (the POOL-03 concurrency-1 test hung).
- **Issue:** The Plan-01 POOL-03 test calls `worker.write('first')` then `worker.write('second')` directly on one worker and asserts the second does NOT consume the first's result. A single `_pending` slot overwrote the first promise, so the first `result` settled the second waiter and the first promise hung forever (test interrupted).
- **Fix:** Added a `_queue` FIFO: `write()` queues when `_busy`; `_dispatch()` sends the next job after each `result` settles. The pool still routes to a sibling worker normally; the queue is a per-worker safety net that prevents interleave.
- **Files modified:** worker-pool.mjs
- **Commit:** e522e6c

**3. [Rule 3 - Blocking] `??` mixed with `||` without parentheses (syntax error)**
- **Found during:** Task 2 verification (`node --check` failed).
- **Issue:** `opts.size ?? Number(...) || 2` is a SyntaxError (nullish coalescing cannot be combined with `||` unparenthesized).
- **Fix:** Parenthesized to `opts.size ?? (Number(...) || 2)`.
- **Files modified:** worker-pool.mjs
- **Commit:** e522e6c

### Scope note (not a deviation)
- `WorkerPool` (keyFor/complete/overflow) was implemented in Plan 02 rather than wholly deferred to Plan 03, because the Plan-01 test file `import { ClaudeWorker, WorkerPool }` — without the `WorkerPool` export the module fails to load and ALL cases stay RED. The shipped `WorkerPool` is intentionally a skeleton: it covers keying (D-01), concurrency-1 dispatch, and D-06 overflow-on-busy; lazy-spawn of new workers, the LRU prompt-cap (D-02), idle-evict, and the dispatcher wiring at server.mjs's two `completeClaudeCodeViaCLI` call sites remain Plan 03 scope.

## Known Stubs
None that block the plan goal. `WorkerPool.complete` routes to the overflow function when no worker is provisioned for a key (lazy-spawn is Plan 03); this is an intentional, documented seam, not a dead stub — the dispatcher always has a working path.

## Out-of-scope discoveries
- `tests/unit/` (directory invocation) fails under Node 25 because the `.ts` unit tests need a TS loader and the bare-directory form mis-resolves; this is pre-existing and unrelated to this plan. The plan's `<automated>` command targets the explicit `worker-pool.mjs` test file, which passes. The repo also has pre-existing uncommitted changes (`bin/start-llm-proxy.sh`, `src/token-usage.ts`, dist maps) left untouched and NOT staged.

## Self-Check: PASSED
- FOUND: `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/worker-pool.mjs`
- FOUND: commit `e522e6c` (rapid-llm-proxy repo)
- FOUND: `.planning/phases/62-worker-pool-core-stream-json-transport/62-02-SUMMARY.md`
