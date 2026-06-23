---
phase: 71-experiment-kb-task-taxonomy
plan: 03
subsystem: experiments-kb
tags: [token-attribution, read-only-aggregation, better-sqlite3, KB-02, D-14]
requires:
  - "scripts/backfill-task-id-by-timestamp.mjs (better-sqlite3 readonly open + parameterized-query pattern)"
  - "_work/rapid-llm-proxy token_usage attribution columns (task_id/agent/model/provider/granularity_tier/reasoning_tokens)"
provides:
  - "aggregateByTaskId(taskId, dbPathOverride?) → { totals, byAgentModel } — read-only, parameterized, pure recompute"
affects:
  - "71-04 Run-write path (sources Run token totals + dominant agent/model tags)"
  - "future `experiments refresh` self-heal recompute (D-14)"
tech-stack:
  added: []
  patterns:
    - "better-sqlite3 { readonly: true } cross-process read of the proxy-owned DB (sole-writer principle)"
    - "parameterized WHERE task_id = ? (never interpolate) — SQL-injection mitigation"
    - "fs.existsSync graceful-zero fallback before open (Environment-Availability)"
    - "EXPERIMENTS_LIVE env gate for the live assertion (never a --live argv)"
key-files:
  created:
    - "lib/experiments/token-aggregate.mjs"
    - "tests/experiments/token-aggregate.test.mjs"
  modified: []
decisions:
  - "Missing-DB graceful path uses fs.existsSync(dbPath) BEFORE open, returning zero totals + []; the RESEARCH skeleton's unconditional fileMustExist:true would have thrown, contradicting the plan's Environment-Availability requirement."
  - "Test fixture mirrors the backfill self-test temp-DB pattern; both queries proven via dbPathOverride against a seeded temp DB."
metrics:
  duration: "~7 min"
  completed: "2026-06-23"
  tasks: 1
  files: 2
---

# Phase 71 Plan 03: Read-Only Token Aggregator (KB-02) Summary

`aggregateByTaskId(taskId, dbPathOverride?)` recomputes per-task token totals + a per-(agent,model,provider,granularity_tier) breakdown via a parameterized `WHERE task_id = ?` read-only query over the proxy-owned `token-usage.db` — a pure recompute that self-heals against late-attributed orphan rows (D-14) while keeping the proxy the sole writer.

## What Was Built

- **`lib/experiments/token-aggregate.mjs`** — exports `aggregateByTaskId(taskId, dbPathOverride?)`. Resolves the DB path from `LLM_PROXY_DATA_DIR` (fallback `/Users/Q284340/Agentic/coding/.data`) + `/llm-proxy/token-usage.db`, with a `dbPathOverride` for tests. Opens `{ readonly: true, fileMustExist: true }`. Two prepared statements, both bound `?` params:
  - `totals` — `COALESCE(SUM(...),0)` over input/output/total/reasoning tokens + `COUNT(*) AS calls`.
  - `byAgentModel` — `GROUP BY agent, model, provider, granularity_tier ORDER BY total_tokens DESC` (the first row is the dominant agent/model that 71-04 uses to source the Run's `agent`/`model` tags).
  Returns `{ totals, byAgentModel }`; `db.close()` in a `finally`. A missing DB file short-circuits to zero totals + `[]` (never opened, never thrown).
- **`tests/experiments/token-aggregate.test.mjs`** — node:test, temp-DB fixture mirroring the backfill self-test. Covers totals correctness, DESC grouping/dominant row, zero-row graceful path, missing-DB graceful path, readonly-write rejection, and the self-healing recompute-after-backfill case. Live assertion gated on `EXPERIMENTS_LIVE`.

## Verification

- `node --test tests/experiments/token-aggregate.test.mjs` → exit 0, 6 pass / 0 fail / 1 skip (live, gated). The recompute-after-backfill case asserts the higher total (465 → 5965).
- `grep -c "readonly: true" lib/experiments/token-aggregate.mjs` = 3 (≥ 1 ✓).
- `grep -c "WHERE task_id = ?" lib/experiments/token-aggregate.mjs` = 3 (≥ 1 ✓); zero string-interpolation of taskId.
- Zero `console.*`; `db.close()` in `finally`.
- **Live spot-check** (`EXPERIMENTS_LIVE`, real proxy DB): `aggregateByTaskId('telem-live-68')` → `total_tokens=6469, calls=8, groups=2`, dominant `claude-haiku-4.5` via `copilot` — confirms the real schema carries the attribution columns and the readonly open works against the live 44 MB DB.

## Threat Model Compliance

| Threat ID | Disposition | Status |
|-----------|-------------|--------|
| T-71-03-01 (SQL injection via task_id) | mitigate | ✓ bound `?` params only; grep + test assert |
| T-71-03-02 (second writer corrupting DB) | mitigate | ✓ `{ readonly: true }`; readonly-write-rejection test passes |
| T-71-03-03 (npm installs) | mitigate | ✓ no new installs — better-sqlite3 already transitively present (resolved via createRequire from the worktree) |

## TDD Gate Compliance

- RED: `abb86487c test(71-03): add failing test ...` — confirmed ERR_MODULE_NOT_FOUND before implementation.
- GREEN: `45246c8d0 feat(71-03): implement read-only aggregateByTaskId ...` — 6/6 pass.
- REFACTOR: none needed (implementation was already minimal/clean).

## Deviations from Plan

**1. [Rule 2 — Missing critical functionality] Graceful missing-DB path via `fs.existsSync` pre-check**
- **Found during:** Task 1 implementation.
- **Issue:** The RESEARCH §"token_usage read-only aggregation" skeleton opens `{ readonly: true, fileMustExist: true }` unconditionally. With `fileMustExist: true`, an absent DB file throws — directly contradicting the plan `<action>`'s requirement that "If the DB file is absent, handle gracefully (return zero totals + empty array) rather than throwing".
- **Fix:** Added an `fs.existsSync(dbPath)` guard that returns `{ totals: zeroTotals(), byAgentModel: [] }` before any open attempt; `fileMustExist: true` is retained for the present-file path. The `finally` close is guarded (`if (db) db.close()`) so the never-opened path survives.
- **Files modified:** `lib/experiments/token-aggregate.mjs`.
- **Commit:** `45246c8d0`.

## Self-Check: PASSED

- FOUND: lib/experiments/token-aggregate.mjs
- FOUND: tests/experiments/token-aggregate.test.mjs
- FOUND: commit abb86487c (RED)
- FOUND: commit 45246c8d0 (GREEN)
