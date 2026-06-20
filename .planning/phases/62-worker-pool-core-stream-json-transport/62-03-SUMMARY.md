---
phase: 62-worker-pool-core-stream-json-transport
plan: 03
subsystem: infra
tags: [llm-proxy, claude-cli, subprocess-pool, stream-json, worker-pool, dispatcher, lru, escape-hatch, nodejs]

# Dependency graph
requires:
  - phase: 62-01
    provides: "RED unit suite (tests/unit/worker-pool.test.mjs) + --live integration suite + mock-claude-stdio helper"
  - phase: 62-02
    provides: "ClaudeWorker class + WorkerPool skeleton (keyFor/complete/overflow) + workerBootArgs + extract helpers in worker-pool.mjs"
provides:
  - "WorkerPool router: lazy-spawn per (model x prompt-hash) key (D-07), concurrency-1 with sibling dispatch up to LLM_PROXY_WORKER_POOL_SIZE (D-05), all-busy-at-cap overflow to completeClaudeCodeViaCLI (D-06), strict per-model isolation (Q2/Pitfall 2), drain+replace of needsRecycle/isStale workers (Pitfall 1), LRU prompt-pool cap via LLM_PROXY_WORKER_PROMPT_CAP (D-02), disposeAll() shutdown reap, injectable deps + workerFactory test seam"
  - "completeClaudeCode() dispatcher wired through the pool: viaCliPath helper gated by LLM_PROXY_DISABLE_WORKER_POOL (GUARD-01), both CLI-fallback call sites routed via viaCliPath, module-level workerPool reusing proxy helpers, disposeAll wired into SIGINT/SIGTERM shutdown"
affects: [63, phase-63-lifecycle, phase-64-hygiene, phase-65-acceptance, phase-66-observability, server.mjs-completeClaudeCode]

# Tech tracking
tech-stack:
  added: []  # zero new packages — node builtins only (child_process spawn, crypto, events)
  patterns:
    - "Lazy per-key pool: Map<key, ClaudeWorker[]> created on first fallback for that (model x prompt) key — no allow-list, cold until first use (D-07)"
    - "Sibling dispatch: free-worker scan then spawn up to size before overflowing (D-05)"
    - "LRU prompt-pool eviction via Map insertion-order touch (delete+set re-inserts at tail; first key is LRU) (D-02)"
    - "Escape-hatch-via-env orthogonality: two independent === '1' flags compose the D-08 truth table (no coupling)"
    - "Post-request recycle: a worker that flips needsRecycle on its turn is drained in the complete() finally block before the next reuse (Pitfall 1)"

key-files:
  created: []
  modified:
    - "/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/worker-pool.mjs (rapid-llm-proxy repo) — WorkerPool class rewritten from Plan-02 skeleton to full router; extractSystemPromptPublic export added"
    - "/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs (rapid-llm-proxy repo) — WorkerPool import, module-level instance, viaCliPath dispatcher edit, SIGTERM+disposeAll shutdown"
    - "/Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/unit/worker-pool.test.mjs (rapid-llm-proxy repo) — 6 new Plan-03 lifecycle tests via workerFactory seam"

key-decisions:
  - "Pool reuses the worker's OWN extractUserPrompt/system-split helpers (worker-pool.mjs) rather than re-deriving in server.mjs, so the key and the stdin content are split the SAME way completeClaudeCodeViaCLI does (server.mjs:1076-1091) — single source of truth for the system-vs-user boundary."
  - "extractSystemPromptPublic exported (returns the default 'You are a helpful assistant.' fallback) so the pool passes the SAME boot system prompt to a lazily-spawned ClaudeWorker that the key was hashed from."
  - "LRU implemented over Map insertion order via a _touch(key) (delete+re-set) on every complete(); _enforcePromptCap evicts the first non-active key. No separate LRU list structure — the Map IS the LRU order."
  - "_enforcePromptCap NEVER evicts the key currently being served (skips activeKey) so a burst of distinct prompts can't drain the pool mid-dispatch."
  - "workerFactory dep added (beyond the planned spawn/env/cli deps) so the new lifecycle unit tests drive lazy-spawn/sibling/LRU/recycle deterministically without a real ClaudeWorker subprocess — keeps the unit run live-CLI-free (acceptance: 'no real claude subprocess spawned in the unit run')."
  - "abortSignal wired to worker.cancel() via addEventListener('abort', {once}) with cleanup in finally — the Phase-63 cancel seam; full client-disconnect propagation stays Phase 63 per D-disc."
  - "SIGTERM handler ADDED alongside the existing SIGINT-only handler (refactored into a shared shutdown(signal) fn) because launchd sends SIGTERM, not SIGINT — without it disposeAll would never fire on a managed restart (orphan-reap, threat T-62-03-05)."

patterns-established:
  - "complete() flow: keyFor -> lazy pool -> _touch (LRU) -> _reapStale -> acquire-free-or-spawn-sibling -> overflow-at-cap -> write -> finally{post-recycle + _enforcePromptCap}."
  - "disposeAll() iterates all keys, disposes every worker, clears the Map — idempotent shutdown reap."

requirements-completed: [POOL-01, POOL-02, POOL-03, POOL-04, GUARD-01]

# Metrics
duration: ~18min
completed: 2026-06-20
---

# Phase 62 Plan 03: WorkerPool Router & Dispatcher Wiring Summary

**The Plan-02 `WorkerPool` skeleton became a full router — lazy per-(model×prompt) spawn, concurrency-1 sibling dispatch up to `LLM_PROXY_WORKER_POOL_SIZE`, execFile overflow at cap (D-06), strict per-model isolation, recycle-before-reuse, and an LRU prompt-pool cap — and is now wired into `completeClaudeCode()` behind the orthogonal `LLM_PROXY_DISABLE_WORKER_POOL` escape hatch (GUARD-01, D-08), engaged ONLY on the CLI-fallback branch (POOL-04), with `disposeAll()` reaping workers on proxy shutdown. 13 unit tests + 1 integration placeholder GREEN; both code files `node --check` clean.**

## Performance

- **Duration:** ~18 min
- **Completed:** 2026-06-20
- **Tasks:** 2 (WorkerPool router; dispatcher wiring)
- **Files modified:** 2 source + 1 test (all in the rapid-llm-proxy repo)
- **Commits:** 2 code (rapid-llm-proxy) + 1 docs (coding)

## What Was Built

### Task 1 — WorkerPool router (`worker-pool.mjs`, commit `20b7bd4`)
Replaced the minimal Plan-02 `WorkerPool` (keyFor + complete + overflow-on-busy) with the full Plan-03 lifecycle:
- **Lazy-spawn (D-07):** `complete()` creates the key's `ClaudeWorker[]` on first use — no hardcoded model allow-list; a model's pool stays cold until that (model×prompt) key's first fallback request.
- **Sibling dispatch (D-05):** scans for a free worker, else spawns a sibling up to `size` (default 2, env `LLM_PROXY_WORKER_POOL_SIZE`).
- **Overflow at cap (D-06):** when all workers are busy at `size`, calls `overflowFn(body, signal)` (= `completeClaudeCodeViaCLI`) exactly once — not a queue, not an extra spawn.
- **Strict per-model isolation (Q2 / Pitfall 2):** the model is part of the key; a model-A worker is never handed to a model-B request.
- **Recycle-before-reuse (Pitfall 1):** `_reapStale` drains+drops any `needsRecycle`/`isStale` worker before acquire; a worker that flips `needsRecycle` on its turn is drained in the `finally`.
- **LRU prompt-pool cap (D-02):** `_touch` re-inserts a key at the Map tail on every `complete`, so the first key is the LRU; `_enforcePromptCap` (env `LLM_PROXY_WORKER_PROMPT_CAP`, default 8) drains the LRU non-active key's workers when the count exceeds the cap.
- **`disposeAll()`:** drains every worker across all keys and clears the Map (shutdown reap).
- **Injectable deps:** `resolveClaudeModel/buildClaudeEnv/claudeCli/spawn/log/logErr` + a `workerFactory` test seam.
- Added 6 lifecycle unit tests (lazy-spawn, sibling dispatch, cap-overflow, recycle, LRU eviction, disposeAll).

### Task 2 — Dispatcher wiring (`server.mjs`, commit `354ef31`)
Surgical edit to `completeClaudeCode()`:
- Imported `WorkerPool`; constructed ONE module-level `workerPool` with the proxy's helpers as deps.
- Added `const poolDisabled = process.env.LLM_PROXY_DISABLE_WORKER_POOL === '1'` (GUARD-01), orthogonal to `LLM_PROXY_DISABLE_CLAUDE_DIRECT` (D-08 — no coupling).
- Added `viaCliPath = (b,sig) => poolDisabled ? completeClaudeCodeViaCLI(b,sig) : workerPool.complete(b,sig,completeClaudeCodeViaCLI)` and replaced BOTH CLI-fallback call sites with it.
- Left `completeClaudeCodeDirect(...)` and the `err.shouldFallbackToCLI` gate UNTOUCHED (POOL-04); `completeClaudeCodeViaCLI` body verbatim.
- Updated the fallback `log(...)` to note `worker pool` vs `execFile` route.
- Refactored the SIGINT-only shutdown into `shutdown(signal)` calling `workerPool.disposeAll()`, and added a SIGTERM handler (launchd-managed restarts send SIGTERM).

## Decisions Made

- Single source of truth for the system-vs-user split: the pool reuses `worker-pool.mjs`'s own `extractUserPrompt`/system extractor (mirrors `server.mjs:1076-1091`) instead of re-deriving in the dispatcher.
- LRU is the `Map` insertion order itself (touch = delete+set); no separate list.
- `workerFactory` dep added (beyond the planned deps) to keep the unit lifecycle tests live-CLI-free.
- Added a SIGTERM handler (not in the original SIGINT-only path) — required for the launchd-managed `com.coding.llm-cli-proxy` reap to fire.

## Deviations from Plan

### Auto-added (Rule 2 — missing critical functionality)

**1. [Rule 2 — Correctness] SIGTERM shutdown handler added alongside SIGINT**
- **Found during:** Task 2 (wiring `disposeAll` into the shutdown path).
- **Issue:** The existing shutdown path only handled `SIGINT`. The proxy runs under the launchd job `com.coding.llm-cli-proxy`, which sends `SIGTERM` on restart/stop — so `workerPool.disposeAll()` would never fire in production, orphaning warm `claude -p` worker subprocesses (threat T-62-03-05).
- **Fix:** Refactored the SIGINT-only handler into a shared `shutdown(signal)` fn and registered it for BOTH `SIGINT` and `SIGTERM`.
- **Files modified:** `proxy-bridge/server.mjs`
- **Commit:** `354ef31`

**2. [Rule 2 — Test coverage] `extractSystemPromptPublic` export + `workerFactory` dep**
- **Found during:** Task 1.
- **Issue:** The pool must pass the SAME boot system prompt to a lazily-spawned worker that the key was hashed from (the prior `extractSystemPrompt` was module-private). The lifecycle unit tests also needed a way to drive lazy-spawn/LRU/recycle without a real subprocess.
- **Fix:** Exported `extractSystemPromptPublic` (with the default-prompt fallback) and added a `workerFactory` constructor dep used by the new tests.
- **Files modified:** `proxy-bridge/worker-pool.mjs`, `tests/unit/worker-pool.test.mjs`
- **Commit:** `20b7bd4`

No architectural (Rule 4) changes. No auth gates. No package installs.

## Verification

- `node --check proxy-bridge/worker-pool.mjs` → exit 0.
- `node --check proxy-bridge/server.mjs` → exit 0 (SERVER_CHECK_OK).
- `grep -c viaCliPath proxy-bridge/server.mjs` → **3** (1 def + 2 call sites, ≥3 ✓).
- `grep -c LLM_PROXY_DISABLE_WORKER_POOL proxy-bridge/server.mjs` → **2** (≥1 ✓).
- `grep -c 'new WorkerPool(' proxy-bridge/server.mjs` → **1** (single module-level instance ✓).
- `grep -c 'workerPool.disposeAll' proxy-bridge/server.mjs` → **1** (shutdown reap ✓).
- POOL-04: `completeClaudeCodeDirect` + `completeClaudeCodeViaCLI` bodies unchanged — `git diff e522e6c` hunks confined to import / dispatcher-instance / shutdown regions; ViaCLI boot-flags comment + Direct fn still present.
- Unit suite: **13/13 pass** (7 Plan-01/02 cases + 6 new Plan-03 lifecycle cases), event loop exits cleanly.
- Integration suite (default/non-live): **1/1 pass** (live block skipped without `--live` — no OAuth needed). The `--live` GUARD-01/POOL-04/POOL-01-PID/cancel cases require operator Max OAuth + network and are gated behind `--live`.

## Requirements Closed

- **POOL-01** — worker pool now wired into the dispatcher (steady-state fallback path).
- **POOL-02** — strict per-model keying; sonnet never lands on a haiku worker; pools cold until first fallback.
- **POOL-03** — concurrency-1 with sibling dispatch; overflow to execFile at cap (D-06).
- **POOL-04** — direct OAuth path primary + unchanged; pool engaged only on the fallback branch.
- **GUARD-01** — `LLM_PROXY_DISABLE_WORKER_POOL=1` reverts to per-call execFile, orthogonal to `DISABLE_CLAUDE_DIRECT` (D-08).

## Known Stubs

None. The cancel seam (`worker.cancel()` on abort) is intentionally a SEAM — full client-disconnect propagation is scoped to Phase 63 (WLIFE-04) per D-disc, and is documented as such, not a stub.

## Self-Check: PASSED

- FOUND SUMMARY: `.planning/phases/62-worker-pool-core-stream-json-transport/62-03-SUMMARY.md`
- FOUND commit `20b7bd4` (worker-pool.mjs router, rapid-llm-proxy repo)
- FOUND commit `354ef31` (server.mjs dispatcher wiring, rapid-llm-proxy repo)
- FOUND `proxy-bridge/worker-pool.mjs`, `proxy-bridge/server.mjs`, `tests/unit/worker-pool.test.mjs`
