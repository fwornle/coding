---
phase: 82-wire-measurement-foundation
plan: 04
subsystem: token-measurement
tags: [token-db, dedup, cache, merge-on-cache, sqlite]
requires:
  - Plan 82-02 (/v1/messages tap now writes cache data — creates the two-writer convergence this plan reconciles)
provides:
  - "insertTokenRowDeduped merge-on-cache: dedup HIT on a cache-less row enriches cache/reasoning in place instead of first-writer-wins drop"
affects:
  - /Users/Q284340/Agentic/coding/lib/lsl/token/token-db.mjs
tech-stack:
  added: []
  patterns:
    - "merge-on-cache: overwrite-once enrich of a cache-less row on dedup HIT, gated on existing sum===0 so never additive"
    - "reasoning_tokens = MAX(reasoning_tokens, ?) to preserve a transcript-first reasoning count against a later cache-bearing row"
key-files:
  created:
    - /Users/Q284340/Agentic/coding/tests/token-adapters/token-db-dedup-merge.test.js
  modified:
    - /Users/Q284340/Agentic/coding/lib/lsl/token/token-db.mjs
decisions:
  - "DEDUP_SQL now SELECTs cache_read_tokens/cache_write_tokens/reasoning_tokens (was SELECT 1) so a single probe both detects the HIT and supplies the merge decision — no second query."
  - "The UPDATE fires ONLY when the existing row is cache-less (cache_read+cache_write===0); an already-cached row takes the genuine-duplicate drop. Overwrite-once, never additive (T-82-04-01)."
  - "reasoning_tokens merged via MAX() not overwrite, so a thinking-model transcript row that arrived first keeps its reasoning count when a cache-bearing tap row (reasoning=0) arrives second."
  - "New test uses node:test + node:assert/strict and runs via `node --test` (plan's verify command), matching the sibling node:test convention (etm-artifact-aggregation.test.js, wal-concurrency.test.mjs) rather than the jest harness."
metrics:
  duration: ~15m
  completed: 2026-07-05
  tasks: 2
  files: 2
---

# Phase 82 Plan 04: Merge-on-Cache Token Dedup Summary

Upgraded `insertTokenRowDeduped` from first-writer-wins to merge-on-cache: a dedup HIT on a cache-less row now enriches its cache/reasoning columns in place (preserving reasoning via MAX), while a HIT on an already-cached row still drops the incoming row to avoid double-counting.

## What Was Built

### Task 1 — merge-on-cache branch in `insertTokenRowDeduped`
`lib/lsl/token/token-db.mjs`:
- Repurposed `DEDUP_SQL` to `SELECT cache_read_tokens, cache_write_tokens, reasoning_tokens ... LIMIT 1` (was `SELECT 1`) — the probe row's truthiness is still the HIT signal, and its columns feed the merge decision in a single query.
- Added `MERGE_ON_CACHE_SQL`: a parameterized `UPDATE token_usage SET cache_read_tokens = ?, cache_write_tokens = ?, reasoning_tokens = MAX(reasoning_tokens, ?) WHERE user_hash = ? AND tool_call_id = ?`.
- On a HIT: if the existing row is cache-less (`num(cache_read)+num(cache_write)===0`) AND the incoming row carries cache (`sum>0`) OR nonzero reasoning, run the UPDATE (num()-coalesced binds) and `return true`. Otherwise `return false` (genuine duplicate → drop).
- The IN-03 empty/non-string `tool_call_id` skip-dedup guard is **byte-identical** to before — only the `if (hit) return false;` body inside the guard was replaced.
- Merge branch stays inside the module's existing never-throw try/catch (`[token-adapter]` stderr on failure).

### Task 2 — dedup-merge unit test
`tests/token-adapters/token-db-dedup-merge.test.js` (node:test + node:assert/strict), 4 cases, all green:
1. Positive in-place merge — cache-less seed + cache-bearing incoming → `true`, exactly ONE row, cache_read=11/cache_write=22/reasoning=3.
2. Negative genuine drop — already-cached seed (cache_read=5) + same-key incoming → `false`, row unchanged, still one row.
3. Empty `tool_call_id` — two empty-key rows both insert (skip-dedup), no merge.
4. Reasoning preservation — reasoning=5/cache=0 seed + cache_read=10/reasoning=0 incoming → merges cache, MAX keeps reasoning=5.

## Verification

- `grep -n "UPDATE token_usage SET cache_read_tokens" lib/lsl/token/token-db.mjs` → 1 match (parameterized, `?` binds only, no value interpolation).
- IN-03 guard grep confirms `typeof toolCallId === 'string' && toolCallId.length > 0` intact.
- `node --test tests/token-adapters/token-db-dedup-merge.test.js` → 4 pass / 0 fail (plan's authoritative verify command).
- No regression: `npx jest tests/token-adapters/token-db.test.js` → 6/6 pass under jest (the existing suite's runner).
- `node --check lib/lsl/token/token-db.mjs` → syntax OK.

## Deviations from Plan

None — plan executed as written. One clarifying note (not a deviation):

The plan specifies the test filename `token-db-dedup-merge.test.js` (`.js`) and the verify command `node --test`. The project's default `npm test` runner is **jest** (`testMatch: **/tests/**/*.test.js`), which globs this file but cannot execute node:test's `test()` and reports "must contain at least one test". This is the **established repo convention**, not a regression: the sibling node:test file `tests/live-logging/etm-artifact-aggregation.test.js` (node:test + `.js`) exhibits identical jest behavior today, and `tests/token-adapters/wal-concurrency.test.mjs` (same directory) uses node:test. These files are run via `node --test`, which is exactly the plan's verify command. The file was kept as `.js` per the must_haves artifact path; renaming to `.mjs` would violate the plan's declared artifact path and verify command.

## Threat Surface

No new trust boundaries introduced. Threat register mitigations honored:
- T-82-04-01 (double-count): UPDATE gated on `existing sum===0` → overwrite-once, never additive; already-cached rows take the drop path.
- T-82-04-02 (SQL injection): parameterized `?` binds only, all numerics `num()`-coalesced.
- T-82-04-03 (DoS on write path): merge SELECT/UPDATE stays inside the module's never-throw try/catch.

## Self-Check: PASSED
- FOUND: lib/lsl/token/token-db.mjs (modified, commit 453e40d9f)
- FOUND: tests/token-adapters/token-db-dedup-merge.test.js (created, commit cf4559c2a)
- FOUND commit 453e40d9f (feat 82-04)
- FOUND commit cf4559c2a (test 82-04)
