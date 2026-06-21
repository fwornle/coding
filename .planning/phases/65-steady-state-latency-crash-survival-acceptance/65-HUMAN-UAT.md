---
status: passed
phase: 65-steady-state-latency-crash-survival-acceptance
source: [65-01-PLAN.md]
started: 2026-06-21T00:00:00Z
updated: 2026-06-21T00:00:00Z
---

## Current Test

[All 4 formal acceptance cases verified live on 2026-06-21 — 12/12 suite green, zero orphans. PERF-01 PASS (median ≤3s — the earlier ~3.9s informal miss did NOT reproduce), PERF-02 PASS. Both requirements discharged Complete.]

## Run command

Prereq: a quiesced host process table (`pgrep -f 'claude -p'` MUST print nothing — the
`countClaudeWorkers()` helper greps the full host process table, T-63-13). On this run the
operator first cleared 3 background `claude -p` workers (2× digest-consolidator + 1× stray
`"You are a helpful assistant."` worker) via `pkill -f 'claude -p'` → confirmed CLEAN.

`node --test <file> --live` does NOT forward `--live` (the runner drops trailing argv in the
per-file child process — see `reference_node_test_argv_live_gate`). Use the env-var form:

```
cd /Users/Q284340/Agentic/_work/rapid-llm-proxy && LLM_PROXY_LIVE=1 node --test tests/integration/worker-pool-live.test.mjs
```

Numbers note: the per-case median/max/`tokens.input`/baseline-latency figures are carried ONLY
in the `assert.ok(...)` failure messages (D-03 honest hard gate). `node:test` prints those
messages only on FAILURE, so on this all-green run the internal figures were not echoed — the
PASS itself is the discharge evidence (the `median <= 3000` assertion, the summed-`tokens.input`
cache-presence floor, the valid-completion / new-pid checks, and the zero-orphan `afterEach` all
held). Per-case total wall-times from the runner are recorded below as the observable proxy.

## Tests

### 1. PERF-01 / SC-1 — steady-state warm latency (median of N≥5 warm `say OK` ≤3000ms, cache-hit confirmed)
requirement: PERF-01
expected: After a warm-up that excludes the cold spawn, N≥5 sequential identical `say OK` requests on the SAME warm worker pid each record a wall-time; the MEDIAN is asserted ≤3000ms (hard gate, not a warning) AND every measured turn's summed `tokens.input` clears a context floor (cache-presence; a degenerate ~1 would mean the warm path is not re-reading the cached context).
result: **PASS** (live 2026-06-21 — median ≤3000ms hard gate held; summed-`tokens.input` cache-presence floor cleared on every measured turn; same warm pid across the measured samples. Case wall-time 8.94s including warm-up + N≥5 samples + cold spawn.) The earlier informal ~3.9s observation (63-05) did NOT reproduce under the rigorous warm-then-measure-median probe.

### 2. PERF-02 / SC-2 — crash-survival (SIGKILL a worker pid, next same-key request returns a VALID completion from a NEW pid)
requirement: PERF-02
expected: A worker pid read DIRECTLY off the live handle (T-63-12) is SIGKILLed; the NEXT same-(model × prompt) request returns a VALID non-empty `{content,...}` completion served by a NEW pid, `countClaudeWorkers()===1` after settle, no respawn-storm (max ≤1 during the reap window).
result: **PASS** (live 2026-06-21 — post-crash request returned valid non-empty content from a NEW pid; no respawn-storm; one worker after settle. Case wall-time 6.48s.) This is the acceptance delta over Phase-63 SC-3 (which only asserted the in-flight rejects RETRYABLE + no storm).

### 3. SC-3 — idle-evict bound (worker gone from ps after idle window, fresh request respawns a NEW pid within bound)
requirement: PERF-02 (resilience support / SC-3)
expected: With a tiny injected `idleMs` window, the worker is gone from `ps` (`countClaudeWorkers()===0`) after the idle window, and a fresh same-key request respawns a NEW pid (`!== pidBefore`) with `countClaudeWorkers()===1` within a single bounded settle (no open-ended poll).
result: **PASS** (live 2026-06-21 — gone-from-ps after the idle window; bounded fresh-pid respawn. Case wall-time 7.93s.) No new idle mechanism — Phase 63 shipped the timer; this is the bounded acceptance frame.

### 4. SC-4 — escape hatch (`LLM_PROXY_DISABLE_WORKER_POOL=1` → zero workers in ps AND restored baseline execFile latency)
requirement: PERF-02 (escape hatch / SC-4)
expected: With the disable flag set (saved/restored exactly as GUARD-01), the request routes through the `execFile` overflow (`overflowFn` reached), `countClaudeWorkers()===0` AND the per-key `workersByKey` is empty, a baseline `{content,model,tokens}` shape is returned, and the per-call `execFile` baseline latency is observed/recorded (no upper-bound assertion — baseline is "the slow path is back").
result: **PASS** (live 2026-06-21 — disabled pool routed to execFile overflow, zero workers in ps, baseline shape returned, env var saved/restored. Case wall-time 1.15s — consistent with the restored direct `execFile` path being fast for the disabled-pool case.)

### 5. Zero-orphan teardown — no leaked `claude -p` workers after the suite
requirement: T-63-11 (DoS mitigation)
expected: The `afterEach` disposes the pool/worker and asserts `countClaudeWorkers()===0` after EVERY case; after the full run `pgrep -f 'claude -p'` prints nothing.
result: **PASS** (live 2026-06-21 — `pgrep -f 'claude -p'` → ZERO ORPHANS after the run; every case's `afterEach` zero-orphan assertion held.)

### Pre-existing Phase-62/63 cases (regression context, ran in the same suite)
All green in the same run: SC-1 WLIFE-01 cold-start, POOL-01 stable-PID, POOL-04 no-spawn-on-direct, GUARD-01 escape hatch, SC-2 WLIFE-02 idle-evict, SC-3 WLIFE-03 crash RETRYABLE, SC-4 WLIFE-04 cancel. No regressions from the new cases.

## Summary

total: 5
passed: 5
partial: 0
deferred: 0
pending: 0
skipped: 0
blocked: 0

Full suite: `tests 12 / pass 12 / fail 0 / skipped 0`, duration ≈56.5s, exit 0.
(The terminal showed `EXIT=127` — a shell artifact: the `tee /tmp/65-live-run.log` argument wrapped onto its own line so zsh tried to execute the path as a command. `node --test` itself reported `fail 0`, i.e. exit 0.)

## Discharge decision (D-09 + D-03)

- **PERF-01 → Complete.** The median-of-N≥5 warm-latency probe PASSED the ≤3000ms hard gate with cache-presence confirmed. The >3s contingency (which would have left PERF-01 blocked pending a separate optimization phase) did NOT materialize — the bar was met, not relaxed.
- **PERF-02 → Complete.** Crash-survival PASSED: the post-SIGKILL request returns a valid completion from a new pid (the acceptance delta over Phase-63 SC-3), with SC-3 bounded idle respawn and SC-4 escape-hatch both green.
- No production `proxy-bridge/worker-pool.mjs` change (verify-only phase). Test file committed local-only to the rapid-llm-proxy repo (`618c47f`, `58361b8`), not pushed.
