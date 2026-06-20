---
phase: 62-worker-pool-core-stream-json-transport
plan: 01
subsystem: testing
tags: [node-test, stream-json, claude-cli, worker-pool, mock-stdio, red-tests]

# Dependency graph
requires: []
provides:
  - "Shared mock-claude-stdio helper (system/init -> assistant -> result JSON-Lines, plus error + split-line variants)"
  - "RED unit suite encoding POOL-01 parsing, POOL-02 keying, POOL-03 concurrency-1, D-06 overflow"
  - "RED live integration suite (--live gated) for POOL-01 PID-reuse, POOL-04 no-spawn-on-direct, GUARD-01 escape hatch, cancel seam, warm-perf sanity"
affects: [62-02, 62-03, worker-pool.mjs, ClaudeWorker, WorkerPool]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dependency-injected stdio (spawn dep) so unit tests drive a worker with no real CLI subprocess"
    - "argv --live gate mirroring integration-bridge.test.mjs MODE switch; lazy import of the not-yet-existing module inside the live block so default mode is green"
    - "Mock helper produces raw \\n-terminated bytes; worker owns framing (transport-agnostic)"

key-files:
  created:
    - "/Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/helpers/mock-claude-stdio.mjs"
    - "/Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/unit/worker-pool.test.mjs"
    - "/Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/worker-pool-live.test.mjs"
  modified: []

key-decisions:
  - "Helper exposes node:stream PassThrough stdout/stdin + emitResponse/emitResponseSplit/emitErrorResult; worker does its own \\n-split buffering (documented in top comment for Plan 02)"
  - "Live integration block lazy-imports worker-pool.mjs so default (mock) mode never touches the missing module and exits 0; --live block is RED until Plans 02/03"
  - "Unit suite pins the constructor DI seam loosely (any injection that makes the worker consume mock stdio); Plan 02 defines the exact shape"

patterns-established:
  - "RED-first Nyquist coverage: every Phase-62 requirement (POOL-01..04, GUARD-01, cancel seam) has a named automated test before implementation"
  - "No real claude subprocess in unit tests — deterministic mock stdio injection"

requirements-completed: [POOL-01, POOL-02, POOL-03, POOL-04, GUARD-01]

# Metrics
duration: 9min
completed: 2026-06-20
---

# Phase 62 Plan 01: Worker Pool Test Scaffolding Summary

**RED test scaffolding for the Claude stream-JSON worker pool: a reusable mock-stdio helper plus a deterministic unit suite (POOL-01/02/03 + D-06) and an --live-gated integration suite (POOL-01/04/GUARD-01/cancel/warm), all importing the not-yet-existing `proxy-bridge/worker-pool.mjs`.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-06-20T20:37Z
- **Completed:** 2026-06-20
- **Tasks:** 3
- **Files modified:** 3 created (all in the rapid-llm-proxy repo)

## Accomplishments
- Shared `mock-claude-stdio.mjs` helper emitting the authoritative `system/init -> assistant -> result` JSON-Lines sequence, with an error-result variant (`error_during_execution`) for the cancel/QUOTA/AUTH paths and a split-line variant for Plan 02's partial-line buffering (Pitfall 3).
- RED unit suite (`tests/unit/worker-pool.test.mjs`) encoding the four deterministic contracts: POOL-01 result parsing (incl. the `input + cacheRead + cacheCreation` summation and `total = input + output`), POOL-02 per-model keying (`model::promptHash` shape; sonnet never served by a haiku worker), POOL-03 concurrency-1 (second write waits for the first `result`, no interleave), and POOL-03/D-06 overflow to a `completeClaudeCodeViaCLI` spy — all via dependency-injected stdio, zero real CLI spawns.
- RED live integration suite (`tests/integration/worker-pool-live.test.mjs`), argv-gated to `--live` (no-op/green in default mode), covering POOL-01 stable-PID reuse, POOL-04 no-spawn-on-direct, GUARD-01 `LLM_PROXY_DISABLE_WORKER_POOL=1` escape hatch, the cancel seam (interrupt aborts in-flight, same-pid worker survives + serves next — Q3), and a warm-<3s sanity check (Pitfall 4; formal gate is PERF-01/Phase 65).

## Task Commits

Committed atomically in the **rapid-llm-proxy** repo (`/Users/Q284340/Agentic/_work/rapid-llm-proxy`, branch `main`):

1. **Task 1: Shared mock-claude-stdio helper** - `1f5587a` (test)
2. **Task 2: RED unit suite (POOL-01/02/03 + D-06)** - `9600925` (test)
3. **Task 3: RED live integration suite (POOL-01/04/GUARD-01/cancel/warm)** - `262b629` (test)

**Plan metadata** (SUMMARY/STATE/ROADMAP): committed separately to the **coding** repo.

## Files Created/Modified
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/helpers/mock-claude-stdio.mjs` - Reusable mock claude worker stdout source (PassThrough; emitResponse / emitResponseSplit / emitErrorResult).
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/unit/worker-pool.test.mjs` - Deterministic RED unit suite for ClaudeWorker/WorkerPool contracts.
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/worker-pool-live.test.mjs` - --live-gated RED integration suite; no-op (exit 0) in default mode.

## Decisions Made
- **Mock transport shape:** node:stream PassThrough for stdout/stdin; the helper emits raw `\n`-terminated bytes and lets the worker own framing (documented at the top of the helper so Plan 02 wires its stdout reader against it). Rationale: keeps the helper transport-agnostic and lets the split-line variant genuinely exercise partial-line buffering.
- **Live-block lazy import:** the integration suite imports `worker-pool.mjs` only inside the `--live` branch, so default-mode CI (no Max OAuth) is green while the `--live` path stays RED until Plans 02/03 land the module.
- **Loose DI seam in unit tests:** the unit suite injects a `spawn` dependency returning the mock streams without over-specifying the constructor signature, leaving Plan 02 free to define the exact DI shape while still pinning "no real subprocess."

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. The pre-existing uncommitted changes in the rapid-llm-proxy repo (`bin/start-llm-proxy.sh`, `src/token-usage.ts`, `dist/*`) are unrelated to this plan and were left untouched — only the three new test files were staged and committed.

## Verification
- `node --check tests/helpers/mock-claude-stdio.mjs` → exit 0 (valid ESM).
- `node --test tests/unit/worker-pool.test.mjs` → exit 1 (RED as expected; 4 module-not-found references to `worker-pool.mjs`). Implementation lands in Plans 02/03.
- `node --test tests/integration/worker-pool-live.test.mjs` → exit 0 in default mode (live block skipped; CI-safe).
- Acceptance greps all pass: both import paths present in the unit suite; all four POOL/D-06 behaviors named; `--live` gate + `LLM_PROXY_DISABLE_WORKER_POOL` + all five integration behaviors present; zero live-binary spawns in the unit file.

## User Setup Required
None - no external service configuration required. (`--live` integration runs later require Max OAuth + network, but that is operator-facing test execution, not a setup step.)

## Next Phase Readiness
- Plan 02 (ClaudeWorker) and Plan 03 (WorkerPool + dispatcher wiring) now have a complete RED contract surface to implement against. The mock helper, the DI seam, and the return contract `{content, model, tokens:{input,output,total}}` are all pinned.
- These suites turn GREEN incrementally as Plans 02/03 land `proxy-bridge/worker-pool.mjs`; the `--live` block additionally requires Max OAuth + network at run time.

## Self-Check: PASSED

- All 3 created files exist on disk (mock helper, unit suite, integration suite).
- All 3 task commits exist in the rapid-llm-proxy repo (`1f5587a`, `9600925`, `262b629`).
- SUMMARY.md exists in the phase directory.

---
*Phase: 62-worker-pool-core-stream-json-transport*
*Completed: 2026-06-20*
