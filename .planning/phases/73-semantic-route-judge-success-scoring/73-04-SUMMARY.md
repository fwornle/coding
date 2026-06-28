---
phase: 73-semantic-route-judge-success-scoring
plan: 04
subsystem: experiments
tags: [llm-judge, route-scoring, rubric, proxy, quarantine]
requires:
  - "73-01: consequential-events primitives (filterConsequential / isTrivialRun / computeGoalAlignedRatio)"
  - "73-03: gatherEvidence on-disk evidence object"
  - "73-02: judgment-object contract (writeScore consumer)"
provides:
  - "runJudge({span,trace,evidence,callProxy}) → judgment object"
  - "single structured Haiku /api/complete call (taskType:'route_judge')"
  - "defensive content parser + D-03/D-04 quarantine"
affects:
  - "73-05: measurement-stop close orchestrator (consumes runJudge → writeScore)"
tech-stack:
  added: []
  patterns:
    - "host-side /api/complete proxy client (callProxy + message envelope) from backfill-raw-observations.mjs"
    - "injectable dependency (callProxy) for network-free unit testing"
    - "tri-state degradation: null (no evidence) ≠ pending (judge failed) ≠ not_scored:'trivial'"
key-files:
  created:
    - lib/experiments/judge.mjs
    - tests/experiments/judge.test.mjs
  modified: []
decisions:
  - "goal_aligned_ratio is computed in code (computeGoalAlignedRatio) from the LLM's labels, never trusted to LLM arithmetic (ROUTE-03 reproducibility)"
  - "defensive parser extracts the outermost {...} block, tolerating ```json fences / surrounding prose; any parse/shape failure quarantines to pending"
  - "rubric dimensions clamp to range (unit [0,1]; regressions {0,1}); non-numbers coerce to null (no-evidence), never 0"
metrics:
  tasks_completed: 2
  files_created: 2
  duration: "~25m"
  completed: 2026-06-28
---

# Phase 73 Plan 04: Semantic Route Judge Summary

**One-liner:** `runJudge` issues ONE structured Haiku `/api/complete` call returning per-event toward/neutral/away labels plus the LOCKED 5-dimension rubric, computes `goal_aligned_ratio` in code, skips trivial runs, and quarantines every proxy/parse failure to `pending` without ever throwing.

## What Was Built

### Task 1 — `lib/experiments/judge.mjs` (commit `1295805b1`)
`runJudge({ span, trace, evidence, callProxy })` returning the 73-02 judgment object:
- **Trivial guard (D-04):** `isTrivialRun(trace)` short-circuits BEFORE any proxy call → `not_scored:'trivial'`, all judged fields null.
- **Single structured call:** body `{ process:'route-judge', taskType:'route_judge', messages:[system,user] }`. `taskType:'route_judge'` routes to the fast (Haiku) tier; the module documents the `ROUTE_JUDGE_TIER=fast` env override if `config.taskTiers` lacks the key.
- **Proxy client:** copied verbatim from `scripts/backfill-raw-observations.mjs` (callProxy + envelope), with URL resolution following the CLAUDE.md precedence (`RAPID_LLM_PROXY_URL → LLM_CLI_PROXY_URL → LLM_PROXY_URL → http://localhost:${LLM_CLI_PROXY_PORT ?? '12435'}`) and `/api/complete` appended exactly once. `callProxy` is injectable (defaults to the real client) for tests.
- **Defensive parser (T-73-04-PARSE):** strips ` ```json ` fences, extracts the outermost `{...}` block, `JSON.parse`s, normalizes `event_labels` to `{seq,label}`, clamps each rubric dimension (unit → [0,1]; regressions → {0,1}; non-numbers → null).
- **Quarantine (D-03 / T-73-04-BLOCK):** the call AND the parse are wrapped in one try/catch → on any throw/non-OK/parse/shape failure returns all-null + `pending:true`. `runJudge` NEVER throws, so the run-close cannot hard-block on a slow/unreachable proxy. `AbortSignal.timeout(60_000)` bounds a hung proxy.
- **Ratio in code:** `goal_aligned_ratio = computeGoalAlignedRatio(event_labels)` (73-01) — not the LLM's own arithmetic.
- **T-73-04-LEAK:** only `seq/tool_name/target_path/outcome` packed per event; no raw tool inputs / file contents.
- stderr-only logging (no-console-log).

### Task 2 — `tests/experiments/judge.test.mjs` (commit `a8a534674`)
node:test + node:assert/strict, network-free via an injected spy `callProxy`:
1. Trivial run (Read/Glob only) → `not_scored:'trivial'`, **fake callProxy invocation count === 0**.
2. Proxy throws → `pending:true`, all-null, `assert.doesNotReject` (no exception).
3. Unparseable content `'not json'` AND non-object response → both `pending:true`.
4. Happy path (2 toward / 1 away / 1 neutral + full rubric) → `pending:false`, `not_scored:null`, **`goal_aligned_ratio === 2/3`** (code-computed, neutral excluded), rubric populated, `taskType==='route_judge'` asserted on the request body.
5. Bonus: out-of-range rubric clamp + non-number → null.

**Result:** `node --test tests/experiments/judge.test.mjs` → 6 pass / 0 fail.

## Verification

- `node --check lib/experiments/judge.mjs` → clean.
- `node --test tests/experiments/judge.test.mjs` → 6 pass / 0 fail.
- Source greps: `/api/complete` ✓, `taskType` ✓, `12435` ✓, `computeGoalAlignedRatio` ✓, `process.stderr.write` ✓, no `console.{log,error,warn}` ✓, **no `3033`** ✓ (the wrong-port acceptance).

### Live Haiku-routing probe — NOT RUN (sandbox restriction)
The `POST http://localhost:12435/api/complete` live probe (confirming `provider`/`model` resolve to a Haiku model) could not be executed: outbound `curl` is blocked by the executor sandbox. The routing **contract** is proven by Task 2 (the request body carries `taskType:'route_judge'` + `process:'route-judge'`, the keys the proxy routes on). Recommend the 73-05 integrator or a human run the probe once with the proxy up:
`curl -s -X POST http://localhost:12435/api/complete -H 'Content-Type: application/json' -d '{"process":"route-judge","taskType":"route_judge","messages":[{"role":"user","content":"ok"}]}' | grep -iq haiku` and record the resolved provider/model. If it does not land on Haiku, set `ROUTE_JUDGE_TIER=fast`.

## Deviations from Plan

**1. [Rule 3 — Blocking issue] Removed `3033` literal from comments.**
- **Found during:** Task 1 acceptance-grep self-check.
- **Issue:** My explanatory comments referenced the Health API by its literal port `3033` ("NOT 3033 …"). The acceptance criterion is `! grep -q "3033"` — the literal would fail the gate even though it appeared only in prose warning AGAINST that port.
- **Fix:** Reworded both comments to "the Health API port" without the digits.
- **Files modified:** `lib/experiments/judge.mjs`.
- **Commit:** folded into `1295805b1` (pre-commit fix).

## Known Stubs

None — `runJudge` is fully wired to the real proxy by default and to the 73-01 primitives; only the optional live-routing probe is deferred (sandbox network restriction, documented above).

## Self-Check: PASSED
- `lib/experiments/judge.mjs` — FOUND
- `tests/experiments/judge.test.mjs` — FOUND
- commit `1295805b1` (feat) — present
- commit `a8a534674` (test) — present
