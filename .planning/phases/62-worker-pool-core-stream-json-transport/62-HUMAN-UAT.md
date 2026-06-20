---
status: partial
phase: 62-worker-pool-core-stream-json-transport
source: [62-VERIFICATION.md]
started: 2026-06-20T21:16:22Z
updated: 2026-06-20T21:16:22Z
---

## Current Test

[awaiting human testing — requires operator run with Max OAuth + network]

## Tests

Run gate (live block, operator only):
`cd /Users/Q284340/Agentic/_work/rapid-llm-proxy && node --test tests/integration/worker-pool-live.test.mjs --live`

### 1. SC-1 — Stable worker PID across sequential sonnet fallbacks
expected: Two sequential sonnet CLI-fallback requests are served by a long-lived `claude -p --input-format stream-json --output-format stream-json` worker that booted once; the worker `.pid` is identical across both calls (no respawn).
result: [pending]

### 2. SC-2 — Pool stays cold until first fallback
expected: Zero `claude -p` worker subprocesses exist in `ps` before the first fallback request for a model; exactly one appears after it. No hardcoded model allow-list pre-spawns workers.
result: [pending]

### 3. SC-3 / POOL-04 — Haiku direct path never spawns a worker
expected: A haiku request served on the direct OAuth bearer path (~0.9s) never engages the pool; `workersByKey` for the haiku key stays empty (pool engaged ONLY on the CLI-fallback branch).
result: [pending]

### 4. SC-4 / GUARD-01 — Escape hatch reverts to execFile with no behavioral change
expected: With `LLM_PROXY_DISABLE_WORKER_POOL=1`, no worker is spawned, the CLI-fallback uses the per-call `execFile` path, and the `{content,model,tokens}` response shape + latency match the pre-milestone baseline.
result: [pending]

### 5. SC-5 — Concurrent same-model requests use sibling workers (no stdio interleave)
expected: Two concurrent sonnet fallback requests are served by two DISTINCT worker PIDs (sibling dispatch up to `LLM_PROXY_WORKER_POOL_SIZE`, default 2); a single worker never multiplexes two in-flight requests on its stdio.
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps

(Tracked separately in 62-REVIEW.md — not UAT gaps:)
- CR-01 (BLOCKER): `ClaudeWorker` has no per-request timeout; a hung worker hangs the caller forever (execFile path enforced `body.timeout || 120_000`). Recommend fix before Phase 65 acceptance.
- CR-02 (BLOCKER): `complete()` registers an empty pool array before spawning, which can corrupt the D-02 LRU cap under overflow-dominated / key-churning traffic. Recommend fix before production rollout.
- WR-01..WR-06 (warnings): EPIPE-unguarded stdin.write, recycle ceiling uses raw `usage.input_tokens` vs cache-inclusive sum, abort-cancels-wrong-queued-request, dispose race window, post-interrupt stray-result settles next job, LRU can dispose busy workers. See 62-REVIEW.md.
