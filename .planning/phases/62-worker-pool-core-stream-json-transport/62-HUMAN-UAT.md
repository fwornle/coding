---
status: partial
phase: 62-worker-pool-core-stream-json-transport
source: [62-VERIFICATION.md]
started: 2026-06-20T21:16:22Z
updated: 2026-06-21T00:00:00Z
---

## Current Test

[4/6 verified live on 2026-06-21; 2 partial; cancel-seam deferred to Phase 63]

## Tests

Run gate (live block, operator). NOTE: `node --test <file> --live` does NOT work —
the test runner runs each file in a child process whose argv drops `--live`. Use a
direct run OR the env var (fixed in rapid-llm-proxy commit dd7e84f):
- `cd /Users/Q284340/Agentic/_work/rapid-llm-proxy && node tests/integration/worker-pool-live.test.mjs --live`
- `cd /Users/Q284340/Agentic/_work/rapid-llm-proxy && LLM_PROXY_LIVE=1 node --test tests/integration/worker-pool-live.test.mjs`

### 1. SC-1 — Stable worker PID across sequential sonnet fallbacks
expected: Two sequential sonnet CLI-fallback requests are served by a long-lived `claude -p --input-format stream-json --output-format stream-json` worker that booted once; the worker `.pid` is identical across both calls (no respawn).
result: PASS (live 2026-06-21, 4.2s — same .pid across both requests; observed real `claude -p ... --model sonnet` worker with verbatim strip flags + prompt-over-stdin)

### 2. SC-2 — Pool stays cold until first fallback
expected: Zero `claude -p` worker subprocesses exist in `ps` before the first fallback request for a model; exactly one appears after it. No hardcoded model allow-list pre-spawns workers.
result: PARTIAL (confirmed indirectly — workers appeared in `ps` only after live requests began; POOL-04 confirms no-spawn-on-direct. No dedicated cold-start probe assertion in the suite.)

### 3. SC-3 / POOL-04 — Haiku direct path never spawns a worker
expected: A haiku request served on the direct OAuth bearer path (~0.9s) never engages the pool; `workersByKey` for the haiku key stays empty (pool engaged ONLY on the CLI-fallback branch).
result: PASS (live 2026-06-21 — `workersByKey` empty for the haiku key; zero workers spawned)

### 4. SC-4 / GUARD-01 — Escape hatch reverts to execFile with no behavioral change
expected: With `LLM_PROXY_DISABLE_WORKER_POOL=1`, no worker is spawned, the CLI-fallback uses the per-call `execFile` path, and the `{content,model,tokens}` response shape + latency match the pre-milestone baseline.
result: PASS (live 2026-06-21 — after fix dd7e84f the pool honors the flag as defense-in-depth: routes to execFile overflow, zero workers, baseline shape. FIRST run FAILED because the pool layer ignored the flag; the dispatcher viaCliPath gate was correct but a direct pool caller bypassed it — now closed.)

### 5. SC-5 — Concurrent same-model requests use sibling workers (no stdio interleave)
expected: Two concurrent sonnet fallback requests are served by two DISTINCT worker PIDs (sibling dispatch up to `LLM_PROXY_WORKER_POOL_SIZE`, default 2); a single worker never multiplexes two in-flight requests on its stdio.
result: PARTIAL (covered at unit level — POOL-03 concurrency-1 + D-05 sibling-dispatch unit tests PASS; no dedicated concurrent-live case. Multiple distinct worker PIDs observed live, consistent with sibling/sequential spawn.)

### 6. cancel seam — interrupt aborts in-flight, worker survives (Q3)
expected: `worker.cancel()` emits `control_request{interrupt}`; the in-flight request settles via the error_during_execution mapping and the SAME worker serves the next request.
result: DEFERRED — live cancel test HANGS: the protocol interrupt does not terminate the real claude stream in practice. Full cancellation propagation is explicitly Phase 63 scope (this phase only EXPOSES the seam). The seam shape is unit-tested (mock); live behavior is Phase 63 work.

## Summary

total: 6
passed: 3
partial: 2
deferred: 1
pending: 0
skipped: 0
blocked: 0

## Gaps

(Tracked separately in 62-REVIEW.md — resolved/deferred:)
- CR-01 (BLOCKER): RESOLVED in rapid-llm-proxy commit 3c68f54 — per-request timeout (default 120s, `LLM_PROXY_WORKER_REQUEST_TIMEOUT_MS`) added; hung worker now rejects RETRYABLE + recycles.
- CR-02 (BLOCKER): RESOLVED in 3c68f54 — empty pool arrays pruned; `_enforcePromptCap` skips empty/busy pools (also closed WR-06).
- WR-01..WR-05 (warnings): DEFERRED to Phase 63/64 — EPIPE-unguarded stdin.write, recycle ceiling uses raw `usage.input_tokens` vs cache-inclusive sum, abort-cancels-wrong-queued-request, dispose race window, post-interrupt stray-result settles next job. See 62-REVIEW.md.
- cancel-seam live behavior: DEFERRED to Phase 63 (cancellation propagation), as above.
