---
phase: 80-experiment-surface-dashboard-skill-packaging
plan: 01
subsystem: api
tags: [vkb-server, experiments, comparison, express, gate_outcome, schema-drift, path-sanitization]

requires:
  - phase: 79-comparison-aggregation-report
    provides: "buildComparison (lib/experiments/compare.mjs) + the frozen writeReportJson schema + sanitizeTaskHash allowlist"
provides:
  - "GET /api/experiments/comparison?task_hash=X&rank_by= on the vkb-server (CMP-04 backend) — returns the frozen Phase 79 report JSON live from the store"
  - "Shared GROUP_GATE_OUTCOME + withGateOutcomes exports in lib/experiments/compare.mjs (single source of truth for gate_outcome stamping, imported by BOTH the CLI and the endpoint)"
  - "sanitizeTaskHash relocated into lib/experiments/compare.mjs (mounted module) so the in-container handler can import it"
  - "tests/experiments/comparison-endpoint.test.mjs — store-backed drift test asserting endpoint JSON deep-equals the CLI writeReportJson doc"
affects: [80-02, 80-03, dashboard-comparison-tab, experiment-skill]

tech-stack:
  added: []
  patterns:
    - "Single-source gate_outcome stamping: withGateOutcomes/GROUP_GATE_OUTCOME live in compare.mjs, imported by both the CLI writer and the HTTP endpoint (kills 79->80 schema drift)"
    - "Shared validator in the mounted module: sanitizeTaskHash lives in lib/experiments (bind-mounted into coding-services) not scripts/ (not mounted), so both host CLI and in-container handler resolve it"
    - "Transient experiment-store handler: open (openExperimentStore) -> readRuns -> buildComparison -> close-in-finally, honoring this.experimentRepoRoot for test isolation; validate task_hash 400-early BEFORE opening the store"

key-files:
  created:
    - "tests/experiments/comparison-endpoint.test.mjs (~200 lines) — 4 store-backed tests: deep-equals-CLI-doc, traversal 400, missing 400, rank_by=tokens reorder"
  modified:
    - "lib/experiments/compare.mjs — added exports: GROUP_GATE_OUTCOME, withGateOutcomes, sanitizeTaskHash"
    - "scripts/experiments-compare.mjs — deleted local copies, imports+re-exports the three helpers"
    - "lib/vkb-server/api-routes.js — handleComparison method + GET /api/experiments/comparison route registration"

key-decisions:
  - "sanitizeTaskHash moved into lib/experiments/compare.mjs (not left in scripts/) because scripts/ is NOT bind-mounted into coding-services — the in-container import of scripts/experiments-compare.mjs threw 'Cannot find module' and 400'd every valid task_hash. CLI re-exports it for backward compat."
  - "Endpoint deep-equal to CLI is proven minus the volatile generated_at timestamp (both use new Date().toISOString() at emit time)."

patterns-established:
  - "Gate_outcome stamping is ONE exported helper (withGateOutcomes) — no duplication between the CLI report file and the live endpoint JSON"
  - "Shared cross-boundary validators live under the mounted lib/ tree, never under the un-mounted scripts/ tree"

requirements-completed: [CMP-04]

duration: ~40min
completed: 2026-07-13
---

# Phase 80 Plan 01: Comparison Endpoint + Shared Gate-Outcome Helper Summary

**Live `GET /api/experiments/comparison` on the vkb-server returning the frozen Phase 79 report JSON, with gate_outcome stamping extracted into a single shared `compare.mjs` helper imported by both the CLI and the endpoint (no 79->80 schema drift).**

## Performance

- **Duration:** ~40 min
- **Tasks:** 3
- **Files modified:** 3 (+1 test created)

## Accomplishments
- CMP-04 backend live: `GET /api/experiments/comparison?task_hash=X&rank_by=` returns 200 with the frozen `{task_hash, rank_by, generated_at, ranked, failed, ungated, unscored}` schema, each VariantEntry carrying `gate_outcome`.
- Schema-drift trap eliminated: `GROUP_GATE_OUTCOME` + `withGateOutcomes` extracted from the CLI into `lib/experiments/compare.mjs`; both the CLI (`writeReportJson`) and the endpoint import the same helper. A store-backed test asserts the endpoint JSON deep-equals the CLI's `writeReportJson` doc for the same rows.
- Traversal-safe: a `task_hash` containing `..`/`/`/`\`/null returns 400 BEFORE the store is opened (reused `sanitizeTaskHash` allowlist).
- Deployed + verified live: restarted the vkb-server, confirmed 200 + frozen keys on a real task_hash through both :8080 and the :3032 dashboard proxy; 400 on traversal through both.

## Task Commits

1. **Task 1: Extract gate_outcome stamping into shared compare.mjs export** - `f9dfc6b51` (refactor)
2. **Task 2: handleComparison + route + store-backed drift test** - `b472dc6ee` (feat)
3. **Task 3: Deploy + live smoke** (surfaced the scripts/-not-mounted bug) - `a77153774` (fix)

## Files Created/Modified
- `lib/experiments/compare.mjs` - Added `GROUP_GATE_OUTCOME`, `withGateOutcomes`, and `sanitizeTaskHash` as exports (the shared source of truth).
- `scripts/experiments-compare.mjs` - Deleted the local copies; imports + re-exports the three helpers from compare.mjs (writeReportJson/writeReportCsv unchanged; frozen schema preserved).
- `lib/vkb-server/api-routes.js` - `handleComparison` (mirrors `handleRunsQuery` transient-store idiom + buildComparison + shared stamping) and its route registration.
- `tests/experiments/comparison-endpoint.test.mjs` - 4 store-backed tests (deep-equals CLI doc, traversal 400, missing 400, rank_by=tokens reorder).

## Decisions Made
- **sanitizeTaskHash relocation (deviation, see below):** moved into the mounted `lib/experiments/compare.mjs` rather than importing it from `scripts/experiments-compare.mjs` as the plan text suggested — because `scripts/` is not bind-mounted into `coding-services`.
- Endpoint↔CLI equality is asserted minus `generated_at` (both stamp it at emit time via `new Date().toISOString()`).
- Rewrote the handler's JSDoc prohibition note to avoid the literal `new GraphKMStore` string so the "no store construction" acceptance grep reads 0 (only openExperimentStore is used).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] sanitizeTaskHash import path unreachable in-container**
- **Found during:** Task 3 (live deploy smoke).
- **Issue:** The plan directed the handler to `import { sanitizeTaskHash } from '../../scripts/experiments-compare.mjs'`. `scripts/` is NOT among the `coding-services` bind mounts (only `lib/vkb-server`, `lib/experiments`, `lib/repro`, `src/...` are), so the in-container dynamic import threw `Cannot find module '/coding/scripts/experiments-compare.mjs'` — caught by the validation try/catch and returned as a 400 for EVERY task_hash (valid or not). The unit tests passed on the host (where scripts/ resolves), masking it — only the live curl exposed it.
- **Fix:** Moved `sanitizeTaskHash` into `lib/experiments/compare.mjs` (mounted + already imported by the handler); the CLI re-exports it so tests/importers are unaffected. Handler now imports it from `../experiments/compare.mjs`.
- **Files modified:** lib/experiments/compare.mjs, scripts/experiments-compare.mjs, lib/vkb-server/api-routes.js.
- **Verification:** After a vkb-server restart, real task_hash → 200 with frozen keys; traversal → 400; both via :8080 and the :3032 proxy. All 15 tests still green.
- **Committed in:** `a77153774` (Task 3 commit).

---

**Total deviations:** 1 auto-fixed (1 blocking).
**Impact on plan:** The fix was essential — the endpoint was 100% non-functional in the container without it. It also strengthened the plan's "single shared helper" spine (the validator is now co-located with the gate_outcome helpers). No scope creep.

## Issues Encountered
- The plan's suggested `scripts/` import path was the one real trap; caught by the mandatory live-deploy step (host tests alone would have shipped a broken endpoint). Resolved by relocation (above).

## Live Verification (Task 3)
- `curl "http://localhost:8080/api/experiments/comparison?task_hash=d4164dca…"` → **200**, keys `task_hash, rank_by, generated_at, ranked, failed, ungated, unscored`; grouped 0 ranked / 3 failed / 1 ungated / 0 unscored (matches the 79-03 SUMMARY's note for this hash). `failed[0].gate_outcome=failed`, `ungated[0].gate_outcome=ungated`, metrics block present.
- `…?task_hash=smoke-spec` → **200** (empty groups, no error).
- `…?task_hash=../../etc/passwd` → **400** (:8080 and :3032 proxy).
- `http://localhost:3032/api/experiments/comparison?task_hash=smoke-spec` → **200** (dashboard proxy forwards unchanged, no server.js edit).

## Next Phase Readiness
- The Comparison tab (Plan 03) can now fetch the live frozen-schema JSON via `fetchComparison` against this route.
- The endpoint is the same-source twin of the CLI report file — the dashboard tab and the CLI-written `.data/experiments/reports/<hash>.json` cannot diverge (asserted by the drift test).

## User Setup Required
None - no external service configuration required.

---
*Phase: 80-experiment-surface-dashboard-skill-packaging*
*Completed: 2026-07-13*
