---
phase: 82-wire-measurement-foundation
plan: 01
subsystem: llm-proxy-token-persistence
tags: [schema-migration, token-usage, cache-tokens, sqlite, wire-measurement]
requires: []
provides:
  - token_usage.cache_read_tokens column (INTEGER NOT NULL DEFAULT 0)
  - token_usage.cache_write_tokens column (INTEGER NOT NULL DEFAULT 0)
  - TokenUsageRow.cache_read_tokens / cache_write_tokens optional fields
  - logCall cache-token persistence
  - getSummary total_cache_read / total_cache_write aggregates
  - export/hydrate cache-token round-trip
affects:
  - Plan 82-02 (/v1/messages tap writes cache usage into these columns)
  - Plan 82-04 (coding-side dedup-merge enriches cache-less rows)
tech-stack:
  added: []
  patterns:
    - standalone PRAGMA-guarded ALTER (mirrors model_raw / overhead_ms / attribution cols)
    - byte-identical dual-migration idempotency with coding-side ensureCacheColumns
key-files:
  created:
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/token-usage-cache-migration.test.mjs
  modified:
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts
decisions:
  - "Cache counters kept SEPARATE from total_tokens (never folded in) so cache-reads do not inflate fresh-input totals"
  - "Column names+types byte-identical to lib/lsl/token/token-db.mjs so the two independent migrations are mutually idempotent"
  - "Standalone PRAGMA-guarded ALTER (not CREATE TABLE / not rebuild INSERT...SELECT) — legacy source tables never trigger copy-column-mismatch"
  - "getSummary gains total_cache_read/total_cache_write plus cache sums on by_process/by_provider buckets"
metrics:
  duration_minutes: 14
  completed: 2026-07-05
  tasks: 2
  files_changed: 2
---

# Phase 82 Plan 01: Cache-Token Schema Foundation Summary

Wired `cache_read_tokens` / `cache_write_tokens` through every persistence surface of the proxy `token_usage` store (migration, `TokenUsageRow`, `logCall` bind, `getSummary` aggregates, Phase-36 export/hydrate round-trip), with an integration test proving migration idempotency and round-trip preservation.

## What Was Built

Two additive `INTEGER NOT NULL DEFAULT 0` columns and their full persistence wiring in `src/token-usage.ts` (proxy repo, compiled to `dist/` via `npm run build`):

- **Migration** — a new standalone PRAGMA-guarded ALTER block (placed after the attribution-column migration), byte-identical in name+type to the coding-side `lib/lsl/token/token-db.mjs` `ensureCacheColumns`, so whichever migration runs first wins and the other is a no-op. Wrapped in try/catch emitting a non-fatal stderr warning; never inside the CREATE TABLE or composite-PK rebuild INSERT...SELECT.
- **TokenUsageRow** — `cache_read_tokens?: number` / `cache_write_tokens?: number` added adjacent to `reasoning_tokens`.
- **logCall** — `insertStmt` column list + `.run()` positional args extended, coalesced `?? 0` exactly like `reasoning_tokens`. `total_tokens` semantics preserved (cache is a separate counter).
- **getSummary** — `COALESCE(SUM(cache_read_tokens),0)` / `COALESCE(SUM(cache_write_tokens),0)` in the totals query surfaced as `total_cache_read` / `total_cache_write` (return-type interface extended), plus cache sums on the `by_process` / `by_provider` buckets.
- **export/hydrate** — `exportToHourFile` and deprecated `exportToJson` SELECTs carry both columns; `hydrateFromExports` INSERT OR IGNORE binds them, coalescing legacy peer files that lack the columns to 0 (mixed-vintage export dirs hydrate cleanly).
- **getRecent** — no change needed (`SELECT *` surfaces the columns automatically).

## Tasks

| Task | Name | Commit (proxy repo) | Files |
| ---- | ---- | ------------------- | ----- |
| 1 | Cache-column migration + TokenUsageRow + logCall bind | `491b2ff` | src/token-usage.ts |
| 2 | getSummary aggregates + export/hydrate round-trip + integration test | `9edd7e0` | src/token-usage.ts, tests/integration/token-usage-cache-migration.test.mjs, dist/token-usage.d.ts.map |

Note: implementation lives in the separate `/Users/Q284340/Agentic/_work/rapid-llm-proxy` git repo (commits on its `main` branch), per the plan. This worktree carries only the SUMMARY.

## Verification

- `npm run build` in the proxy repo exits 0 (TypeScript compiles clean to `dist/`).
- `node --test tests/integration/token-usage-cache-migration.test.mjs` — 4/4 pass:
  - (a) migration idempotency: both columns INTEGER NOT NULL DEFAULT 0, second init is a schema-identical no-op with no `cache column migration failed` stderr.
  - (b) logCall persists nonzero cache values verbatim; omitted fields persist 0/0; `total_tokens` untouched; getSummary aggregates surface.
  - (c) export → fresh DB → hydrate round-trip preserves cache_read=7 / cache_write=9 via getRecent.
  - (d) legacy export row lacking the columns coalesces to 0/0 without crashing.
- Column DDL `cache_read_tokens INTEGER NOT NULL DEFAULT 0` / `cache_write_tokens INTEGER NOT NULL DEFAULT 0` is byte-identical to `lib/lsl/token/token-db.mjs:71-77`.
- No new npm dependency added (extends the existing better-sqlite3 seam).

## Deviations from Plan

None - plan executed exactly as written. The pre-existing modification to `proxy-bridge/server.mjs` in the proxy repo working tree was unrelated to this plan and left untouched (scope boundary).

## Self-Check: PASSED

- FOUND: src/token-usage.ts (14 cache_read_tokens sites)
- FOUND: tests/integration/token-usage-cache-migration.test.mjs
- FOUND commit 491b2ff (Task 1)
- FOUND commit 9edd7e0 (Task 2)
