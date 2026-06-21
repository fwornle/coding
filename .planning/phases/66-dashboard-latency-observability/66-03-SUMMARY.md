---
phase: 66-dashboard-latency-observability
plan: 03
subsystem: rapid-llm-proxy (worker-pool overhead instrumentation + token-usage SQL layer)
tags: [perf, observability, worker-pool, overhead, token-usage, median, sqlite, PERF-03]

# Dependency graph
requires:
  - phase: 66-dashboard-latency-observability (Plan 01)
    provides: "getSummary().by_model[].p50_latency_ms ordered-offset median pattern + best-effort try/catch convention this plan mirrors"
provides:
  - "worker-pool completion contract gains overheadMs (dispatch-start -> first-stdout, EXCLUDES generation)"
  - "token_usage.overhead_ms nullable column (idempotent PRAGMA-guarded ALTER)"
  - "getSummary().by_model[].p50_overhead_ms — per-model median worker-pool overhead, NULL-safe (offset uses non-null count, WR-02 closed)"
  - "GET /api/token-usage/recent rows carry overhead_ms (null for direct/haiku, numeric for pool calls)"
  - "server.mjs logs result.overheadMs as overhead_ms alongside latency_ms + surfaces overheadMs on the /api/complete JSON response"
affects: [66-04 (dashboard re-point: consumes recent.overhead_ms + summary by_model[].p50_overhead_ms)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Spawn/queue overhead window = dispatch-start (_dispatch, this._now) to first-stdout (_onStdout, stamped once per dispatch); EXCLUDES generation time (first-output -> terminal result)"
    - "NULL-safe SQLite median: ordered-offset over WHERE col IS NOT NULL with the OFFSET derived from the NON-NULL COUNT, not the all-rows count (WR-02)"
    - "Additive completion-contract field (overheadMs) present only on the path that owns the metric; non-pool paths log NULL"

key-files:
  created: []
  modified:
    - "/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/worker-pool.mjs (overhead window capture + toCompletion threading)"
    - "/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs (overhead_ms into logTokenCall + overheadMs on response)"
    - "/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts (column migration + insert binding + p50_overhead_ms median + getRecent passthrough)"
    - "/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.test.ts (4 new p50_overhead_ms node:test assertions)"
    - "/Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/unit/worker-pool.test.mjs (3 new overhead-window node:test assertions)"
    - "/Users/Q284340/Agentic/_work/rapid-llm-proxy/dist/token-usage.js (rebuilt; untracked per .gitignore *.js)"
    - "/Users/Q284340/Agentic/_work/rapid-llm-proxy/dist/token-usage.d.ts.map (rebuilt; tracked)"

key-decisions:
  - "Overhead window boundary LOCKED to dispatch-start -> first-stdout (the warm/cold-sensitive boundary BEFORE generation). Stamped in _onStdout on the first parsed line (system/init), NOT _onEvent's terminal result, so generation time is excluded."
  - "No-intermediate-output fallback: a turn whose first parsed line IS the terminal result reads (this._now() at settle - dispatchedAt), the conservative full-elapsed cold reading, never zero (would hide a cold spawn)."
  - "p50_overhead_ms offset uses the non-null overhead COUNT (separate COUNT(*) WHERE overhead_ms IS NOT NULL query per model), NOT row.calls — WR-02 fix. Counting NULLs would skew the selected element (SQLite sorts NULLs first)."
  - "overhead_ms added via standalone idempotent ALTER AFTER the composite-PK rebuild (mirrors model_raw), NOT inside the rebuild INSERT...SELECT — avoids copy-column-mismatch on legacy source tables."
  - "overheadMs is additive on toCompletion (present only when a number is passed); execFile-overflow, direct-OAuth (haiku), cooldown, and GUARD-01-disabled paths never call toCompletion, so they log NULL — correct, no pool overhead."

patterns-established:
  - "Pattern: PERF metric measured ONLY on the path that owns it (worker-pool), NULL elsewhere, median ignores NULLs"
  - "Pattern: deterministic overhead-window unit tests drive the injectable this._now clock between writing the first stdout line and the terminal result line"

requirements-completed: [PERF-03]

# Metrics
duration: 6 min
completed: 2026-06-21
---

# Phase 66 Plan 03: Worker-Pool Spawn/Queue Overhead (overhead_ms) + p50_overhead_ms Median Summary

**Instrumented the rapid-llm-proxy worker pool to record per claude-code call the spawn/queue overhead (dispatch-start to first-stdout, EXCLUDING generation), persisted it as a nullable `overhead_ms` token-usage column with a NULL-safe per-model `p50_overhead_ms` median, and surfaced `overhead_ms` on the `/recent` feed — so Plan 66-04 can re-point the dashboard at the pool-health component PERF-03 actually affects (warm overhead near zero / green; cold-spawn regression climbing toward ~14s / red), instead of the generation-dominated total latency the bar can never meet.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-06-21T17:14:00Z (approx, first RED commit 19:15 CEST)
- **Completed:** 2026-06-21T17:22:02Z (build commit 19:22 CEST)
- **Tasks:** 3
- **Files modified:** 5 source/test + 2 dist artifacts

## Accomplishments
- worker-pool.mjs: `_dispatch` stamps `dispatchedAt`/`firstOutputAt`; `_onStdout` stamps `firstOutputAt` once per dispatch on the first parsed line; `_onEvent` computes `overheadMs = (firstOutputAt ?? now) - dispatchedAt` at the terminal result and threads it through `toCompletion`.
- token-usage.ts: nullable `overhead_ms` column (CREATE TABLE + idempotent ALTER), `insertStmt`/`logCall` binding (`?? null`), and a NULL-safe `p50_overhead_ms` median whose OFFSET uses the non-null overhead count (WR-02 closed).
- server.mjs: logs `result.overheadMs` as `overhead_ms` alongside `latency_ms`; surfaces `overheadMs` on the `/api/complete` JSON response (forensic, additive).
- Live proof on :12435: cold sonnet first-spawn `overheadMs=2254`, warm reuse `overheadMs=7` (both distinct from total `latencyMs` 3702 / 1255 — generation excluded); `/recent` carries `overhead_ms` (null for copilot/haiku); `/summary` by_model `p50_overhead_ms` = 7 for sonnet, absent for haiku (all-NULL, NULL-safe).

## Task Commits

All commits in the `rapid-llm-proxy` repo (`/Users/Q284340/Agentic/_work/rapid-llm-proxy`):

1. **Task 1 (TDD RED): overhead-window assertions** - `6e777f4` (test)
2. **Task 1 (TDD GREEN): capture overhead window on completion contract** - `d800e45` (feat)
3. **Task 2 (TDD RED): p50_overhead_ms median assertions** - `26fbb1f` (test)
4. **Task 2 (TDD GREEN): persist overhead_ms + NULL-safe median + server wiring** - `e408023` (feat)
5. **Task 3: rebuild dist + live daemon restart + endpoint proof** - `1dc5067` (build)

**Plan metadata (coding repo):** committed separately (docs: complete plan).

## Files Created/Modified
- `proxy-bridge/worker-pool.mjs` — overhead window capture (`dispatchedAt`/`firstOutputAt`/`overheadMs`) + `toCompletion` threading.
- `proxy-bridge/server.mjs` — `overhead_ms` into `logTokenCall`; `overheadMs` on the `/api/complete` response.
- `src/token-usage.ts` — `overhead_ms` column (CREATE + idempotent ALTER), insert binding, `p50_overhead_ms` median, getRecent passthrough.
- `src/token-usage.test.ts` — 4 new node:test assertions (median, NULL-safety/WR-02, all-NULL-absent, migration idempotency).
- `tests/unit/worker-pool.test.mjs` — 3 new node:test assertions (warm, cold, first-output-not-terminal).
- `dist/token-usage.js` (rebuilt, gitignored) + `dist/token-usage.d.ts.map` (rebuilt, tracked).

## Decisions Made
- **Overhead window:** dispatch-start (`_dispatch`, `this._now()`) to first-stdout (`_onStdout`, first parsed line). EXCLUDES generation (first-output -> terminal result). The `system/init` event is typically the first parsed line; stamping there (not at the terminal `result` in `_onEvent`) keeps generation OUT of the metric.
- **No-intermediate-output fallback:** `firstOutputAt ?? this._now()` at settle gives the conservative full-elapsed cold reading for a turn that produced no output before the result — never zero (which would hide a cold spawn).
- **WR-02 non-null-count offset:** the median offset is `floor((n-1)/2)` where `n = COUNT(*) WHERE overhead_ms IS NOT NULL` for the model — computed with a separate bound-param query — NOT `row.calls`. Counting the NULL (legacy + direct/haiku) rows would skew the selected element since SQLite sorts NULLs first.
- **Migration placement:** standalone idempotent PRAGMA-guarded ALTER after the composite-PK rebuild (mirrors `model_raw`), not inside the rebuild INSERT...SELECT — avoids copy-column-mismatch on legacy source tables.
- **Additive contract:** `overheadMs` present on `toCompletion` only when a number is passed; non-pool paths (execFile-overflow, direct-OAuth/haiku, cooldown, GUARD-01-disabled) never call `toCompletion`, so they log NULL.

## Deviations from Plan

None - plan executed exactly as written.

The plan's `<verify>` block for Task 3 used `model: "standard"` for the live probe; the direct OAuth path returned `404 model: standard`, so the probe was driven with `model: "sonnet"` instead (the canonical worker-pool tier alias). This is a probe-input choice within the planned step, not a code deviation — the live proof (cold + warm overhead, `/recent` + `/summary` fields) succeeded as specified.

**Total deviations:** 0 auto-fixed.
**Impact on plan:** None. `p50_latency_ms` is untouched; the change is purely additive (new column + new median field + new response field).

## Issues Encountered
- Live probe with `model: "standard"` 404'd on the direct OAuth path; re-ran with `model: "sonnet"` which routed through the claude-code worker pool and populated a non-null `overhead_ms` row. No code impact.

## Threat Model Status
- **T-66-03-01 (SQLi, p50_overhead_ms median)** — mitigated: `model`, `since`, `offset`, and the non-null COUNT query all bound `?` parameters; grep confirms no `${}` interpolation of those values into SQL (the only `${}` matches are `err.message` in stderr strings).
- **T-66-03-02 (DoS, empty/malformed DB)** — mitigated: the whole p50_overhead_ms block is wrapped in its own best-effort try/catch (mirrors p50_latency_ms); absent median leaves the field off rather than throwing. Test 6 (all-NULL) proves no throw.
- **T-66-03-03 (legacy DB migration)** — mitigated: PRAGMA-guarded idempotent ALTER (mirrors model_raw); nullable column so old rows read NULL and the median ignores them via WHERE overhead_ms IS NOT NULL. Test 7 proves re-open does not duplicate the column.
- **T-66-03-04 (info disclosure, worker stdout timing)** — accept: overhead_ms is a duration integer; no prompt/content captured.
- **T-66-03-SC (npm/pip/cargo installs)** — mitigated: NO new package added (Node builtins + better-sqlite3 already present); slopcheck N/A.

## Verification

| Check | Result |
|-------|--------|
| `node --test tests/unit/worker-pool.test.mjs` (incl. 3 new overhead tests) | 61/61 pass |
| `node --test src/token-usage.test.ts` (incl. 4 new overhead-median tests) | 7/7 pass |
| Combined sweep | 68/68 pass, 0 fail |
| `npm run check` (tsc --noEmit) | clean (exit 0) |
| `grep -c overheadMs proxy-bridge/worker-pool.mjs` | 5 (≥3) |
| `grep -c overhead_ms proxy-bridge/server.mjs` | 1 (≥1) |
| `grep -c overhead_ms src/token-usage.ts` | 24 (≥1) |
| `grep -c p50_overhead_ms src/token-usage.ts` | 9 |
| `npm run build` | exit 0 |
| `grep -c overhead_ms dist/token-usage.js` | 21 (≥1) |
| Live `/api/complete` model=sonnet (cold) | `overheadMs=2254` `latencyMs=3702` (provider=claude-code) |
| Live `/api/complete` model=sonnet (warm reuse) | `overheadMs=7` `latencyMs=1255` |
| Live `/api/token-usage/recent` | claude-code rows carry numeric `overhead_ms` (7, 2254); copilot/haiku rows `overhead_ms=null` |
| Live `/api/token-usage/summary` by_model | `p50_overhead_ms`: sonnet=7; haiku absent (all-NULL, NULL-safe); `p50_latency_ms` unaffected |
| SQLi invariant (T-66-03-01) | no `${}` interpolation of model/since/offset/count into overhead SQL |
| Endpoint returns JSON | confirmed (not the :3033 HTML trap) |

## Notes for Plan 66-04 (dashboard re-point)
- **Recent feed field:** `overhead_ms` (number, or `null` for direct/haiku and legacy rows) on each `GET /api/token-usage/recent` row.
- **Summary field:** `by_model[].p50_overhead_ms` (number; ABSENT on a model with no non-null overhead rows) on `GET /api/token-usage/summary`.
- **Warm vs cold in live data:** warm worker reuse reads `overhead_ms` near 0 (live: 7ms); a cold first-spawn reads large (live: 2254ms for a freshly-restarted daemon; the LOCKED definition allows ~10-14s for a true cold CLI boot). This is the SC-1 (green near-zero) / SC-2 (regression climbs toward ~14s, red) signal PERF-03 wants — re-point the POOL-HEALTH surface at `p50_overhead_ms`, not total `p50_latency_ms`.
- **Leave p50_latency_ms in place:** the Token Usage table's Median Latency column (total latency, generation-dominated) stays as forensic context; only the pool-health tile re-points.

## Next Phase Readiness
- Proxy-side half of PERF-03 complete and proven live. Plan 66-04 can re-point the dashboard at `recent.overhead_ms` / `summary.by_model[].p50_overhead_ms` with no further proxy wiring.
- No blockers.

## Self-Check: PASSED

- `proxy-bridge/worker-pool.mjs` carries `overheadMs` — FOUND (5 occurrences)
- `proxy-bridge/server.mjs` carries `overhead_ms` — FOUND (1 occurrence)
- `src/token-usage.ts` carries `overhead_ms` + `p50_overhead_ms` — FOUND (24 / 9 occurrences)
- `dist/token-usage.js` carries `overhead_ms` — FOUND (21 occurrences)
- Commits `6e777f4`, `d800e45`, `26fbb1f`, `e408023`, `1dc5067` — FOUND in rapid-llm-proxy repo log
- Live :12435 endpoints serve `overhead_ms` (recent) + `p50_overhead_ms` (summary by_model) — VERIFIED

## TDD Gate Compliance

- **Task 1:** RED `6e777f4` (`test(66-03)`) -> GREEN `d800e45` (`feat(66-03)`). REFACTOR — none needed.
- **Task 2:** RED `26fbb1f` (`test(66-03)`) -> GREEN `e408023` (`feat(66-03)`). REFACTOR — none needed.

---
*Phase: 66-dashboard-latency-observability*
*Completed: 2026-06-21*
