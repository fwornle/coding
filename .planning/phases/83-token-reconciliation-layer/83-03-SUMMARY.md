---
phase: 83-token-reconciliation-layer
plan: 03
subsystem: token-reconciliation
tags: [token-usage, reconciliation, sqlite, tdd, cross-user_hash-join]
requires:
  - lib/lsl/token/token-db.mjs (insertTokenRowDeduped authority model, num/text coalescers)
  - stop-adapter-registry.mjs withinSpanWindow semantics (replicated as outer clamp)
provides:
  - "probeWireRowByRequestId — cross-user_hash request-id probe (tool_call_id alone)"
  - "reconcileGapFill — wire-authoritative fill-gaps-only enrich"
  - "reconcile.mjs: matchWireRow / computeDeltas / reconcileRow (match+enrich+delta+flag)"
affects:
  - Plan 04 (wires reconcileRow into the adapter stop path)
tech-stack:
  added: []
  patterns:
    - "cross-key join: probe on tool_call_id ALONE (not the (user_hash,tool_call_id) dedup key)"
    - "wire-authoritative gap-fill: MAX() + COALESCE(NULLIF()) + cache CASE-guard"
    - "D-05 tolerance: max(2% of larger value, 50 tokens) per field"
    - "never-throw best-effort (D-06/D-08): catch -> safe unmatched result + [reconcile] stderr"
key-files:
  created:
    - lib/lsl/token/reconcile.mjs
    - tests/token-adapters/reconcile-matcher.test.js
  modified:
    - lib/lsl/token/token-db.mjs
decisions:
  - "Fuzzy candidate SELECT lives in reconcile.mjs (parameterized by model), keeping Task-1's token-db surface to exactly the two planned primitives while respecting the per-task file boundaries."
  - "reconcile probe uses ORDER BY id LIMIT 1 so the earliest (wire/tap) row is the deterministic winner when a tap row + adapter row transiently share a tool_call_id."
  - "gap-fill keys the UPDATE on the WIRE row's tool_call_id (not the transcript's) so fuzzy matches — which carry no transcript tool_call_id — still enrich the right row."
metrics:
  duration: ~14 min
  completed: 2026-07-06
---

# Phase 83 Plan 03: Reconcile Matcher Summary

Cross-`user_hash` request-id join + bounded fuzzy fallback + per-field delta/tolerance engine, built as a pure unit-tested matcher (`reconcile.mjs`) on top of two new wire-authoritative token-db primitives — the testable heart of Phase 83, isolated from I/O so Plan 04 stays thin.

## What Was Built

### Task 1 — token-db primitives (D-04)
Extended `lib/lsl/token/token-db.mjs` with two parameterized, never-throwing primitives following the existing `?`-bind / `num()`/`text()`-coalesce / best-effort discipline verbatim:

- **`probeWireRowByRequestId(db, toolCallId)`** — a `SELECT ... WHERE tool_call_id = ? ORDER BY id LIMIT 1` keyed on `tool_call_id` **ALONE** (NOT the `(user_hash, tool_call_id)` dedup key). Wire rows and transcript rows carry different `user_hash` by design, so this crosses that boundary on the upstream request-id. Returns the full reconciled column set (id, tool_call_id, model, timestamp, input/output/reasoning/cache_read/cache_write, parent_call_id, granularity_tier) so the caller can both compute deltas and locate the wire row.
- **`reconcileGapFill(db, toolCallId, fields)`** — a widened `UPDATE` that fills only wire-empty gaps: `reasoning_tokens = MAX(reasoning_tokens, ?)`, `granularity_tier`/`parent_call_id = COALESCE(NULLIF(col,''), ?)`, and the cache split via `CASE WHEN (cache_read+cache_write)=0 THEN ? ELSE col END`. Wire counts **never** decrease or overwrite (SQLite evaluates every RHS against the OLD row, so both cache assignments read the pre-update sum).

`insertTokenRowDeduped`, `DEDUP_SQL`, and `MERGE_ON_CACHE_SQL` are byte-unchanged — the interactive dedup path is untouched.

### Task 2 — reconcile.mjs matcher (D-04 / D-05)
Created `lib/lsl/token/reconcile.mjs` exporting:

- **`matchWireRow(db, transcriptRow, span, opts)`** — request-id probe first; on miss a bounded fuzzy match by model + timestamp (candidates within both the span window outer clamp — `withinSpanWindow` semantics replicated from `stop-adapter-registry.mjs` — and a ±2 min fuzzy window; nearest timestamp wins, ties broken by lowest id). A `:reason:N` tool_call_id bypasses matching entirely.
- **`computeDeltas(wireRow, transcriptRow)`** — records every nonzero per-field delta (input/output/cache_read/cache_write/reasoning); each flagged when `delta > max(2% of larger value, 50)`. Calibrated so the 82-06 v2 large-cache matched-pair spread (~47946–72264) is not blanket-flagged.
- **`reconcileRow(db, transcriptRow, span, opts)`** — orchestrates match → fill-gaps-only enrich (wire wins) → deltas → tolerance flag; a `:reason:N` row returns `{ alwaysInsert: true, fallback: true }`; a no-match returns `{ fallback: true }`. Never throws (D-06/T-83-03-03).

## Verification

- `node --test tests/token-adapters/reconcile-matcher.test.js` → **EXIT 0, 13/13** (5 Task-1 + 8 Task-2 cases covering all 9 plan behaviors: request-id match, fuzzy fallback, tie-break, no-match, deltas, tolerance calibration, `:reason:N` bypass, never-throw, plus the three gap-fill invariants and the cross-user_hash probe).
- `node --test tests/token-adapters/token-db-dedup-merge.test.js` → **EXIT 0, 4/4** (zero regression on the existing dedup/merge invariants).
- Acceptance greps: probe keyed on `tool_call_id` alone (no user_hash constraint) ✓; `insertTokenRowDeduped`/`DEDUP_SQL`/`MERGE_ON_CACHE_SQL` intact ✓; `reconcile.mjs` exports `reconcileRow`/`matchWireRow`/`computeDeltas` ✓; no SQL string-interpolation of tool_call_id/task_id/model (only `?` binds) ✓.

## TDD Gate Compliance

Both tasks followed RED → GREEN:
- Task 1: `test(83-03)` `89c57455d` (RED) → `feat(83-03)` `fbf033467` (GREEN).
- Task 2: `test(83-03)` `9325f2a3a` (RED) → `feat(83-03)` `2eca387f5` (GREEN).

## Deviations from Plan

None to the implementation. One out-of-scope discovery logged, not fixed:

### Deferred (out of scope — SCOPE BOUNDARY)
**Pre-existing: `tests/token-adapters/token-db.test.js` throws `ReferenceError: test is not defined`.** The file never imports `test`/`assert` from `node:test`. Verified byte-identical to the plan base commit `b58b309` — NOT caused by 83-03, and not in this plan's verification list. Logged to `.planning/phases/83-token-reconciliation-layer/deferred-items.md` (commit `e8febfee1`). Fix when the file is next touched: add the two `node:test` imports.

## Known Stubs

None. Both modules are fully wired and unit-tested; `reconcileRow` is consumed by Plan 04 (adapter wiring), which is the intended next integration point per the plan objective.

## Commits

- `89c57455d` test(83-03): add failing tests for token-db reconcile primitives
- `fbf033467` feat(83-03): add cross-user_hash request-id probe + wire-authoritative gap-fill
- `9325f2a3a` test(83-03): add failing tests for reconcile matcher
- `2eca387f5` feat(83-03): reconcile matcher — request-id+fuzzy match, deltas, tolerance flag
- `e8febfee1` docs(83-03): log pre-existing token-db.test.js node:test import gap (out of scope)
