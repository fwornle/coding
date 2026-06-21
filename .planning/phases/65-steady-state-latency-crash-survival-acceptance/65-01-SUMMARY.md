---
phase: 65-steady-state-latency-crash-survival-acceptance
plan: 01
subsystem: infra
tags: [llm-proxy, worker-pool, acceptance, live-verification, claude-cli, nodejs, autonomous-false, perf]

# Dependency graph
requires:
  - phase: 62-worker-pool-core-stream-json-transport
    plan: "all"
    provides: "WorkerPool/ClaudeWorker core, stream-JSON transport, GUARD-01 LLM_PROXY_DISABLE_WORKER_POOL escape hatch, completion {content,model,tokens:{input,output,total}} shape (summed cache-inclusive tokens.input)"
  - phase: 63-worker-lifecycle-lazy-spawn-idle-eviction-crash-recovery-can
    plan: "all"
    provides: "ClaudeWorker deps.idleMs idle-evict seam, EPIPE-as-crash + RETRYABLE reap, crash-cooldown no-respawn-storm guard, T-63-12 read-pid-off-handle, the --live test envelope + countClaudeWorkers()/settle() helpers + afterEach zero-orphan teardown"
  - phase: 64-long-lived-worker-hygiene
    plan: "all"
    provides: "GUARD-02 version-drift recycle + GUARD-03 stderr drain/throttle + WR-02 cache-inclusive recycle ceiling (the warm worker the PERF-01 probe measures is hygiene-bounded)"
provides:
  - "tests/integration/worker-pool-live.test.mjs: four FORMAL --live acceptance cases (PERF-01 SC-1 steady-state warm-latency median≤3000ms hard gate + cache-presence floor; PERF-02 SC-2 crash-survival valid-completion-from-new-pid; SC-3 bounded idle respawn; SC-4 escape-hatch zero-ps + recorded baseline execFile latency), replacing the informal warm-sanity case"
  - "65-HUMAN-UAT.md: operator live-run results table discharging PERF-01 + PERF-02 (both Complete)"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Warm-then-measure-median latency probe: a warm-up write excludes the cold spawn, then N≥5 sequential identical `say OK` on the SAME warm pid record wall-times; the MEDIAN is the steady-state metric (max also recorded), asserted as a HARD assert.ok gate (D-03 — never softened to a warning)"
    - "Cache-presence-by-summed-input: since the completion folds cacheRead/cacheCreation into a single `tokens.input` and emits no 'result' event, a summed-`tokens.input` context floor (not a dedicated cacheRead assertion) is the in-scope cache-hit signal — surfacing the split would be an out-of-scope production change"
    - "Acceptance delta over a prior resilience case: PERF-02 asserts the NEXT request is SERVED with valid non-empty content from a NEW pid (vs Phase-63 SC-3 which only asserted the in-flight rejects RETRYABLE + no storm)"

key-files:
  created:
    - .planning/phases/65-steady-state-latency-crash-survival-acceptance/65-HUMAN-UAT.md
  modified:
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/worker-pool-live.test.mjs

key-decisions:
  - "VERIFY-ONLY phase: NO production proxy-bridge/worker-pool.mjs change; the four cases add formal acceptance assertions on top of the live mechanisms shipped in Phases 62/63/64. Confirmed `git status --short proxy-bridge/worker-pool.mjs` empty."
  - "Reused the existing Phase-62/63 --live gate + describe envelope + countClaudeWorkers()/settle() helpers + module-level pool/worker teardown handles verbatim; new case names are distinct from the pre-existing Phase-63 SC-2/SC-4 cases (no collision)."
  - "The ≤3s PERF-01 bar was NOT relaxed (operator decision 2026-06-21). A >3s miss would have left PERF-01 blocked pending a separate optimization phase (D-03) — but the live run PASSED, so the contingency did not fire."
  - "Test file committed local-only to the rapid-llm-proxy repo (618c47f, 58361b8); planning artifacts (this SUMMARY + 65-HUMAN-UAT.md) in the coding repo; nothing pushed."

# Operator live-run (autonomous: false)
operator-live-run:
  command: "cd /Users/Q284340/Agentic/_work/rapid-llm-proxy && LLM_PROXY_LIVE=1 node --test tests/integration/worker-pool-live.test.mjs"
  date: 2026-06-21
  result: "PASS — tests 12 / pass 12 / fail 0 / skipped 0, duration ≈56.5s, exit 0; zero orphaned `claude -p` workers after the run"
  cases:
    - "PERF-01 SC-1 steady-state warm latency: PASS (median ≤3000ms hard gate held; cache-presence floor cleared; the ~3.9s informal observation from 63-05 did NOT reproduce)"
    - "PERF-02 SC-2 crash-survival: PASS (post-SIGKILL request returns valid non-empty content from a NEW pid; no respawn-storm)"
    - "SC-3 idle-evict bound: PASS (gone-from-ps after idle window; bounded fresh-pid respawn)"
    - "SC-4 escape hatch: PASS (LLM_PROXY_DISABLE_WORKER_POOL=1 → zero workers in ps, execFile overflow, baseline shape, env restored)"
    - "Zero-orphan teardown: PASS (pgrep -f 'claude -p' → none after the run)"
  note: "Numbers (median/max/tokens.input/baseline latency) surface ONLY in assert messages, which node:test prints on FAILURE — on this all-green run they were not echoed; the PASS is the discharge evidence. Prereq: 3 background claude -p workers were quiesced (pkill) before the run. The terminal `EXIT=127` was a shell artifact (a wrapped `tee` path), not the node exit code (node reported fail 0)."
---

# Phase 65 Plan 01 — Steady-State Latency & Crash-Survival Acceptance

## What was built

Extended the single existing live test file `tests/integration/worker-pool-live.test.mjs`
(rapid-llm-proxy repo) with the FOUR formal acceptance cases the milestone headline requires,
building the gate the Phase-63 suite explicitly deferred (`:366` — "informal; PERF-01 is the
formal gate"):

- **PERF-01 / SC-1** — formal steady-state warm-latency probe that REPLACES the informal
  single-sample warm-sanity case. Warms (excludes the cold spawn), then measures N≥5 sequential
  identical `say OK` requests on the SAME warm pid, asserts the MEDIAN wall-time ≤3000ms as a
  HARD gate (records median+max in the message), and asserts a summed-`tokens.input` cache-presence
  floor (recording the value) — the in-scope cache-hit signal given the completion does not surface
  a dedicated `cacheReadInputTokens` split.
- **PERF-02 / SC-2** — crash-survival: SIGKILLs a worker pid read DIRECTLY off the live handle
  (T-63-12) and asserts the NEXT same-key request returns a VALID non-empty completion from a NEW
  pid — the acceptance delta over Phase-63 SC-3.
- **SC-3** — bounded idle respawn: reuses the tiny injected `idleMs` seam; asserts gone-from-ps
  after the idle window + a fresh-pid respawn within a single bounded settle.
- **SC-4** — escape hatch: extends GUARD-01 with `countClaudeWorkers()===0` + empty `workersByKey`
  AND a recorded restored-baseline `execFile` latency, saving/restoring `LLM_PROXY_DISABLE_WORKER_POOL`.

Every case is live-gated (env/argv, never `node --test` argv-forwarding), lives inside the
existing live describe block, registers its handle on the module-level teardown, and the
`afterEach` asserts zero orphaned `claude -p` workers. DEFAULT (mock) mode skips cleanly (exit 0).

## Verification

- **Mock gate:** `node --test tests/integration/worker-pool-live.test.mjs` → exit 0, live block skipped.
- **Live gate (operator, autonomous: false):** `LLM_PROXY_LIVE=1 node --test ...` → 12/12 pass, 0 fail,
  zero orphans on 2026-06-21. All four new acceptance cases PASS. See `65-HUMAN-UAT.md`.
- No production change: `git -C /Users/Q284340/Agentic/_work/rapid-llm-proxy status --short proxy-bridge/worker-pool.mjs` empty.

## Discharge

- **PERF-01 → Complete** (median ≤3s hard gate held live; bar NOT relaxed; the >3s optimization
  contingency did not fire).
- **PERF-02 → Complete** (crash-survival valid-completion-from-new-pid PASS, with SC-3 + SC-4 green).

## Self-Check: PASSED
