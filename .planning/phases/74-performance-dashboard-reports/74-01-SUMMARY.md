---
phase: 74-performance-dashboard-reports
plan: 01
subsystem: experiments-test-scaffold
tags: [tdd, nyquist-wave-0, experiments, dashboard, playwright]
requires:
  - lib/experiments/store.mjs (openExperimentStore)
  - lib/experiments/run-write.mjs (writeRun)
  - lib/experiments/score-write.mjs (writeScore, applyOverride)
  - .data/ontologies-experiment/ (upper.json + experiment-ontology.json)
provides:
  - tests/experiments/_fixtures/seed-experiment-store.mjs (seedIsolatedStore, seedTokenDb)
  - tests/experiments/run-read.test.mjs (DASH-01 RED)
  - tests/experiments/runs-endpoint.test.mjs (DASH-01 RED)
  - tests/experiments/timeline-read.test.mjs (DASH-02 RED)
  - tests/experiments/report-write.test.mjs (KB-04 RED)
  - tests/experiments/report-snapshot.test.mjs (DASH-03 RED)
  - tests/e2e/dashboard/performance.spec.ts (DASH-01/02/03 skeleton)
affects:
  - Plan 74-02 (query.mjs + handleRunsQuery turn run-read/runs-endpoint GREEN)
  - Plan 74-03/04 (timeline-read.mjs turns timeline-read GREEN)
  - Plan 74-05 (report-write.mjs turns report-write/report-snapshot GREEN)
  - Plan 74-06 (Performance page flips the five fixme E2E flows live)
tech-stack:
  added: []
  patterns:
    - "node:test + node:assert/strict per-file (tests/experiments convention)"
    - "Object.create(ApiRoutes.prototype) + experimentRepoRoot handler isolation"
    - "isolated tmp store via openExperimentStore({ repoRoot }) + verbatim ontology copy"
    - "throwaway temp token-usage.db (never the proxy-owned DB)"
    - "test.fixme skeleton for not-yet-built UI flows (green-collectible)"
key-files:
  created:
    - tests/experiments/_fixtures/seed-experiment-store.mjs
    - tests/experiments/run-read.test.mjs
    - tests/experiments/runs-endpoint.test.mjs
    - tests/experiments/timeline-read.test.mjs
    - tests/experiments/report-write.test.mjs
    - tests/experiments/report-snapshot.test.mjs
    - tests/e2e/dashboard/performance.spec.ts
  modified: []
decisions:
  - "Fixture walks up THREE dirs (_fixtures -> experiments -> tests -> REPO_ROOT) vs the test's two"
  - "overrides arg on seedIsolatedStore merges per-section (span/tags/totals/judgment) so RED tests tweak one facet"
  - "report-write/-snapshot tests assert against a yet-undesigned report API surface (report_id, writeReport/refreshReport/readReport, snapshot array) — Plan 05 must honour these names or update the RED test as a documented deviation"
metrics:
  duration: 8m
  completed: 2026-06-28
  tasks: 3
  files: 7
---

# Phase 74 Plan 01: Nyquist Validation Scaffold (Wave 0 RED Tests) Summary

Laid the Phase 74 Wave-0 validation scaffold before any production code: factored the inline `seedIsolatedStore` into a shared `seedIsolatedStore` + `seedTokenDb` fixture, then authored five backend `node:test` files (all RED — each fails only because its target production module is unwritten) plus a green-collectible Playwright skeleton with five `test.fixme` UI flows for Plan 06 to activate.

## What Was Built

- **Shared fixture** (`tests/experiments/_fixtures/seed-experiment-store.mjs`): `seedIsolatedStore(taskId, overrides)` mkdtemps an isolated repo-root, copies the real `.data/ontologies-experiment` verbatim, opens via `openExperimentStore({ repoRoot: tmp })`, seeds a Run + Score, returns `{ repoRoot, cleanup }`. `seedTokenDb(rows)` writes a throwaway temp `token-usage.db` with the full attribution column set and returns `{ dir, dbPath, cleanup }`.
- **Four backend RED files** targeting `query.mjs#readRuns`, `api-routes.js#handleRunsQuery`, `timeline-read.mjs#readTimeline`, and `report-write.mjs#{writeReport,refreshReport,readReport}` — covering DASH-01 (join + D-06 pending-exclude, endpoint rows), DASH-02 (reasoning-step nesting + graceful-empty + bound `task_id`), KB-04 (idempotency), and DASH-03 (snapshot stability before/after refresh).
- **Playwright skeleton** (`performance.spec.ts`): one ACTIVE collection-witness test + five `test.fixme` flows (a–e per 74-UI-SPEC), each TODO naming Plan 74-06.

## Verification

- `node --test` over all five backend files → RED via `ERR_MODULE_NOT_FOUND` / `not a function` on the absent production modules (`ALL-RED-AS-EXPECTED`).
- `npx playwright test tests/e2e/dashboard/performance.spec.ts --list` → `SPEC-COLLECTED`.
- Fixture behavior probe (`seedIsolatedStore('t1').cleanup()` + `seedTokenDb(...).cleanup()`) exits 0.
- No `console.` token in the fixture or any of the five test files.

## Deviations from Plan

None — plan executed exactly as written. All three tasks' acceptance criteria passed on first verification.

## Known Stubs

None. All test files are intentionally RED (Nyquist Wave 0) and the Playwright UI flows are intentionally `test.fixme` — these are the planned scaffold state, not unfinished stubs. Each is wired to a specific downstream plan (74-02/03/04/05/06) that flips it live.

## Threat Flags

None. No new security surface: tests open only isolated tmp stores (T-74-01-01) and write only a throwaway temp token-usage.db (T-74-01-02); the proxy-owned DB and the real single-owner store are never touched. No package installs (T-74-01-SC).

## Commits

- eb04deb18 — test(74-01): factor shared seedIsolatedStore + seedTokenDb fixture
- 210777eeb — test(74-01): author four backend RED tests (Wave 0)
- 4e3d9c236 — test(74-01): author Performance Playwright spec skeleton (Wave 0)

## Self-Check: PASSED

All 7 created files present on disk; all 3 task commits present in git history.
