---
phase: 66-dashboard-latency-observability
plan: 01
subsystem: rapid-llm-proxy (token-usage SQL layer)
tags: [perf, observability, sqlite, median, token-usage, PERF-03]
requires: []
provides:
  - "getSummary().by_model[].p50_latency_ms — per-model median latency over the rolling 24h window"
affects:
  - "Plan 66-02 (dashboard) consumes by_model[].p50_latency_ms with zero new endpoint/proxy wiring"
tech-stack:
  added: []
  patterns:
    - "SQLite has no native MEDIAN — ordered-offset subquery (ORDER BY col LIMIT 1 OFFSET (count-1)/2) per group, lower-mid convention"
    - "best-effort SQL post-pass wrapped in try/catch so an empty/malformed DB never 500s into the summary hot path"
key-files:
  created:
    - "/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.test.ts"
  modified:
    - "/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts"
    - "/Users/Q284340/Agentic/_work/rapid-llm-proxy/tsconfig.json"
    - "/Users/Q284340/Agentic/_work/rapid-llm-proxy/dist/token-usage.js (rebuilt; untracked per .gitignore *.js)"
    - "/Users/Q284340/Agentic/_work/rapid-llm-proxy/dist/token-usage.d.ts.map (rebuilt; tracked)"
decisions:
  - "Median convention is LOWER-MID for even counts (OFFSET (count-1)/2); odd counts yield the true middle. Documented in a code comment so the seeded test's expected value is unambiguous."
  - "Piggyback on getSummary's by_model rows (66-PATTERNS option 1) — no new exported function, no new proxy endpoint, no server.mjs edit. The summary endpoint surfaces the field automatically."
  - "Per-model median computed as a JS post-pass over the by_model array via a single prepared ordered-offset statement reused per row (the count is already in row.calls)."
  - "Test authored as a node:test (.ts) suite — the repo's package.json `test` script (jest) is stale/uninstalled; the live --test suites use node:test, and Node 25 native TS stripping runs the .ts file directly."
  - "tsconfig excludes src/**/*.test.ts so tsc neither type-errors on the .ts import-extension nor emits the test into dist/ (mirrors how tests/ is already excluded)."
metrics:
  duration_minutes: 9
  completed: "2026-06-21"
  tasks_completed: 2
  files_changed: 4
---

# Phase 66 Plan 01: Per-Model Median (p50) Latency in the Proxy Token-Usage SQL Layer Summary

Added a parameterized per-model `p50_latency_ms` median to `rapid-llm-proxy`'s `getSummary()` `by_model` rows, computed over the existing clamped rolling-24h `since` window, so the dashboard (Plan 66-02) reads an honest median (not the existing skewed AVG) with zero new endpoint or proxy wiring.

## What Was Built

**Task 1 — median query + tests (TDD)**
- `src/token-usage.test.ts` (RED, commit `e0d5f8a`): three `node:test` assertions — seeded `[1000,2000,3000,4000,5000]` → `p50_latency_ms === 3000`; empty DB returns no `by_model` rows without throwing; rows older than the 24h window are excluded from the median.
- `src/token-usage.ts` (GREEN, commit `2114c96`): a best-effort JS post-pass after the existing `by_model` SELECT. For each row it runs `SELECT latency_ms ... WHERE model=? AND timestamp>=? ORDER BY latency_ms LIMIT 1 OFFSET ?` with `offset = floor((count-1)/2)`, reusing the **same** clamped `since` variable (lines 774-779) — no recomputed window. All three values (`model`, `since`, `offset`) are bound `?` parameters. The whole block is wrapped in try/catch (mirrors `logCall` 701-724) so a malformed/empty DB leaves the field absent rather than throwing into the summary hot path. No warm/cold or provider filter (D-06 — cold spawns included; Plan 66-02 owns the per-provider regression threshold).

**Task 2 — build + live proof (commit `a7ba478`)**
- `npm run build` regenerated `dist/token-usage.js` (carries `p50_latency_ms`); `dist/token-usage.d.ts.map` tracked.
- `launchctl kickstart -k gui/$(id -u)/com.coding.llm-cli-proxy` restarted the live daemon.
- `GET http://localhost:12435/api/token-usage/summary?hours=24` returns `by_model[].p50_latency_ms` on every row. Live data shows the median diverging from the average as intended: `claude-haiku-4.5` p50=1264 / avg=1693; `claude-sonnet-4.6` p50=180921 / avg=178306.

## Verification

| Check | Result |
|-------|--------|
| `node --test src/token-usage.test.ts` | 3/3 pass (GREEN) |
| `node --test` worker-pool + token-usage suites | 61/61 pass (no regression) |
| `npm run check` (tsc --noEmit) | clean (exit 0) |
| `grep -c p50_latency_ms src/token-usage.ts` | 5 (≥1) |
| Median query parameterization (T-66-01-01 SQLi) | all values bound `?`; no `${}` interpolation of user-derived values into SQL |
| `npm run build` | exit 0 |
| `grep -c p50_latency_ms dist/token-usage.js` | 4 (≥1) |
| Live `:12435/api/token-usage/summary?hours=24` | `by_model[].p50_latency_ms` present on each row; JSON (not the :3033 Health-API HTML trap) |
| Test file NOT emitted to dist/ | confirmed (tsconfig exclude) |

## Threat Model Status

- **T-66-01-01 (SQLi)** — mitigated: `model`, `since`, `offset` all passed as bound parameters via `.get(...)`.
- **T-66-01-02 (DoS / unbounded window)** — mitigated: the median query inherits the existing clamped `since`; no new unbounded scan or `limit` param.
- **T-66-01-03 (DoS / malformed DB into hot path)** — mitigated: try/catch around the median post-pass; empty-DB behavior test proves no 500.
- **T-66-01-04 / -SC (info disclosure / npm install)** — accepted as planned; no new package added.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking build config] `npm test` script is stale; switched to `node:test`**
- **Found during:** Task 1 (test infrastructure check).
- **Issue:** package.json `test` runs `node ... node_modules/.bin/jest`, but jest is not installed (and the existing `.ts` tests import `vitest`, also not installed). `npm test` errors with `Cannot find module .../jest`. The plan's `<verify>` block assumed `npm test` works.
- **Fix:** Authored the test as a `node:test` suite (the runner the live `tests/*.mjs` suites already use; Node 25 strips TS so the `.ts` file runs directly via `node --test src/token-usage.test.ts`). No new dependency added.
- **Files modified:** `src/token-usage.test.ts`.
- **Commit:** `e0d5f8a`.

**2. [Rule 3 - Blocking build config] `tsc` rejected the test file's `.ts` import extension and would emit it into dist/**
- **Found during:** Task 1 (running `npm run check`).
- **Issue:** tsconfig `include: ["src/**/*.ts"]` pulls the new `src/token-usage.test.ts` into the build → `TS5097` on the `./token-usage.ts` import, and `npm run build` would emit `token-usage.test.js` into `dist/`.
- **Fix:** Added `src/**/*.test.ts` to tsconfig `exclude` (mirrors the existing `tests` exclusion). `npm run check` clean; no test artifact lands in `dist/`.
- **Files modified:** `tsconfig.json`.
- **Commit:** `2114c96`.

## Notes for Plan 66-02

- The field is `by_model[].p50_latency_ms` (number; absent on a model with no in-window rows). The dashboard fetches `summary` already — no fetch change, no new endpoint.
- `provider='claude-code'` is the worker-pool fallback path; haiku is a different provider (direct path). The median GROUPs by `model` only — apply the green ≤3s / red-toward-14s regression threshold per provider in the dashboard.
- Live sonnet p50 currently reads ~181s because the 24h window still contains pre-worker-pool historical calls; that is the honest median PERF-03 asks the dashboard to surface. It will trend toward ≤3s as warm-worker traffic ages into the window.

## Self-Check: PASSED

- `src/token-usage.test.ts` — FOUND
- `src/token-usage.ts` carries `p50_latency_ms` — FOUND (5 occurrences)
- `dist/token-usage.js` carries `p50_latency_ms` — FOUND (4 occurrences)
- Commits `e0d5f8a`, `2114c96`, `a7ba478` — FOUND in rapid-llm-proxy repo log
- Live endpoint serves `by_model[].p50_latency_ms` — VERIFIED on :12435

## TDD Gate Compliance

- RED commit `e0d5f8a` (`test(66-01): ...`) — failing assertions before implementation.
- GREEN commit `2114c96` (`feat(66-01): ...`) — implementation makes them pass.
- REFACTOR — none needed (implementation was already minimal/clean).
