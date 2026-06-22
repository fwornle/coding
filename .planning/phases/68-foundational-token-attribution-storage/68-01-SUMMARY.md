---
phase: 68-foundational-token-attribution-storage
plan: 01
subsystem: rapid-llm-proxy / token-usage persistence
tags: [telemetry, sqlite, schema-migration, token-attribution, TELEM-01]
requires: []
provides:
  - "token_usage table carries agent, task_id, tool_call_id, parent_call_id, granularity_tier (TEXT '' default) + reasoning_tokens (INTEGER 0 default)"
  - "TokenUsageRow type extended with the 6 optional attribution fields"
  - "insertStmt + logCall write the 6 columns with safe defaults"
  - "Idempotent PRAGMA-guarded startup migration (zero-ALTER no-op on second boot)"
affects:
  - "Phase 68-03 (proxy write-path task_id stamping reads/writes these columns)"
  - "Phases 69–70 (per-agent adapters stamp agent/task_id/tool_call_id/parent_call_id/granularity_tier/reasoning_tokens)"
  - "Phase 71 (km-core Run-write path sources from these rows)"
tech-stack:
  added: []
  patterns:
    - "Standalone PRAGMA-guarded additive ALTER after the composite-PK rebuild (mirrors model_raw / overhead_ms)"
    - "Loop a {name,ddl} list inside one try/catch; per-column PRAGMA guard preserves idempotency"
key-files:
  created:
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/token-usage-schema-migration.test.mjs
  modified:
    - /Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts
decisions:
  - "TEXT NOT NULL DEFAULT '' + INTEGER NOT NULL DEFAULT 0 chosen (not nullable) — SQLite 3.53.1 permits ADD COLUMN NOT NULL with a constant default; verified live, no fallback needed."
  - "Attribution fields are OPTIONAL on TokenUsageRow + coalesced to defaults in logCall so every existing caller compiles + inserts unchanged."
  - "dist/ .js/.d.ts/.js.map are gitignored in the proxy repo but dist/token-usage.d.ts.map is tracked (pre-existing inconsistency) — committed the regenerated map separately to keep the tree clean."
metrics:
  duration: "~6 min"
  completed: 2026-06-22
  tasks: 2
  files: 2
---

# Phase 68 Plan 01: Token Attribution Storage (token_usage additive schema) Summary

Extended the rapid-llm-proxy `token_usage` SQLite store with the six additive cross-agent attribution columns required by the TELEM contract — `agent`, `task_id`, `tool_call_id`, `parent_call_id`, `granularity_tier` (TEXT NOT NULL DEFAULT '') and `reasoning_tokens` (INTEGER NOT NULL DEFAULT 0) — via idempotent PRAGMA-guarded startup migrations that mirror the existing `model_raw` / `overhead_ms` standalone ALTER blocks, and wired them through `TokenUsageRow`, the prepared `insertStmt`, and `logCall` with safe defaults so no existing writer breaks. (Satisfies TELEM-01 + Success Criteria 1 & 2.)

## What Was Built

**Task 1 — migration + type (commit `56a8c15`, rapid-llm-proxy):**
- Six standalone idempotent migration ALTERs added in `initTokenDb()` immediately after the `overhead_ms` block and before the `insertStmt` prepare. Implemented as a single try/catch that reads `PRAGMA table_info(token_usage)` once, then conditionally runs each `ALTER TABLE token_usage ADD COLUMN …` from a `{name, ddl}` list (per-column PRAGMA guard preserved). Non-fatal stderr warning on failure; never aborts startup (T-68-01-02).
- NOT added to the composite-PK rebuild `INSERT...SELECT` — kept as standalone post-rebuild ALTERs exactly like `overhead_ms`, so a legacy source table never triggers a copy-column-mismatch.
- `TokenUsageRow` extended with six optional fields (`agent?`, `task_id?`, `tool_call_id?`, `parent_call_id?`, `granularity_tier?`, `reasoning_tokens?`) with a TELEM-01 doc comment.

**Task 2 — bindings + integration test (commit `273a252`, rapid-llm-proxy):**
- `insertStmt` INSERT column list + placeholders extended with the 6 columns (order matches `logCall` bind order).
- `logCall` appends 6 binds after the `overhead_ms` bind, coalesced to `'' ` / `0` to match the column DEFAULTs; preserved the best-effort `logCall` try/catch hot-path guard (T-68-01-03).
- `tests/integration/token-usage-schema-migration.test.mjs` (node:test + node:assert/strict, temp-DB via `LLM_PROXY_TOKEN_DB_PATH`, imports the compiled `dist/token-usage.js`) asserts: (a) all 6 columns present with `PRAGMA table_info` `dflt_value` of `''` ×5 and `0` ×1; (b) legacy insert reads back `''`/`0`; (c) populated insert reads back the supplied values; (d) two `initTokenDb()` runs on the same DB (driven in a child process) yield an identical column set with no `migration failed` stderr (idempotent).

**Build artifact (commit `c4d2de7`, rapid-llm-proxy):** regenerated `dist/token-usage.d.ts.map` (the one tracked dist map) to keep the proxy tree clean.

## Verification Results

- `npm run build` (rapid-llm-proxy) — exit 0 (tsc --declaration clean; TokenUsageRow change is additive/optional).
- `node --test tests/integration/token-usage-schema-migration.test.mjs` — exit 0, 4/4 subtests pass.
- Acceptance greps:
  - `ADD COLUMN (agent|task_id|tool_call_id|parent_call_id|granularity_tier|reasoning_tokens)` → 6 matches.
  - `PRAGMA table_info(token_usage)` count rose 3 → 4 (new migration read present).
  - Ordering: `RENAME TO token_usage` (line 478) < `ADD COLUMN granularity_tier` (line 555).
  - insertStmt column list contains `agent…reasoning_tokens`; `logCall` binds `row.task_id`.

## Operator: live-DB smoke (live restart owned by Plan 68-03)

The autonomous proof here is the dist + temp-DB integration test. The live DB at `/Users/Q284340/Agentic/coding/.data/llm-proxy/token-usage.db` was NOT migrated by this plan (the proxy was not restarted — its live schema still ends at `model_raw` / `overhead_ms`). To migrate + verify the live DB after the proxy picks up the new code:

```bash
launchctl kickstart -k gui/$(id -u)/com.coding.llm-cli-proxy
sqlite3 /Users/Q284340/Agentic/coding/.data/llm-proxy/token-usage.db "PRAGMA table_info(token_usage);"
# expect: agent, task_id, tool_call_id, parent_call_id, granularity_tier (TEXT, dflt ''),
#         reasoning_tokens (INTEGER, dflt 0) appended after overhead_ms
```

The live restarted-daemon row gate is a hard gate in Plan 68-03.

## Threat Model Disposition

- **T-68-01-01 (Tampering / SQL injection):** mitigated — values bound via better-sqlite3 prepared-statement `?` placeholders; no string interpolation introduced. Parameterized `insertStmt` preserved.
- **T-68-01-02 (DoS / migration):** mitigated — each ALTER is PRAGMA-guarded and the block is wrapped in try/catch with a non-fatal stderr warning; a failed/locked ALTER never aborts startup.
- **T-68-01-03 (DoS / hot path):** mitigated — `logCall` retains its top-level try/catch swallowing any insert/bind error, so a malformed new-field value cannot fail the LLM request.
- **T-68-01-SC (npm installs):** accepted — no new packages introduced (only existing better-sqlite3); no package-legitimacy checkpoint required.

## Deviations from Plan

None — plan executed as written. The plan's NOT-NULL-ALTER fallback (nullable columns) was not needed: SQLite 3.53.1 (bundled with better-sqlite3) accepts `ADD COLUMN … NOT NULL DEFAULT <const>`.

Note (not a deviation): the proxy's `dist/` is gitignored for `.js`/`.d.ts`/`.js.map` but `dist/token-usage.d.ts.map` is tracked — a pre-existing repo inconsistency. The regenerated map was committed separately (`c4d2de7`) so the proxy tree is clean. Source + test are the load-bearing commits (`56a8c15`, `273a252`).

## Cross-Repo Commits (rapid-llm-proxy, branch main)

- `56a8c15` feat(68-01): add six additive token attribution columns + extend TokenUsageRow
- `273a252` test(68-01): bind attribution columns in insertStmt/logCall + idempotency test
- `c4d2de7` chore(68-01): refresh tracked token-usage.d.ts.map build artifact

## Self-Check: PASSED

- FOUND: `/Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/token-usage-schema-migration.test.mjs`
- FOUND: `.planning/phases/68-foundational-token-attribution-storage/68-01-SUMMARY.md`
- FOUND commits (rapid-llm-proxy): `56a8c15`, `273a252`, `c4d2de7`
