---
phase: 75-measurement-attribution-accuracy-observation-linkage
plan: 06
subsystem: performance-dashboard
tags: [dashboard, attr-02, two-column-model, run-metadata, react, redux, bind-mount, wave-3, checkpoint-pending]

# Dependency graph
requires:
  - phase: 75-02
    provides: "writeRun persists canonical_model/canonical_agent/background_models[] on Run.metadata (ATTR-02/D-06); readRuns spreads ...meta so the fields auto-flow to the dashboard payload"
  - phase: 75-04
    provides: "stop-orchestrator wiring that populates the persisted canonical/background tags (upstream caller of writeRun)"
  - phase: 75-01
    provides: "RED e2e contract tests/e2e/performance/canonical-columns.spec.ts (data-testid run-canonical-model/run-background-models + col headers + unmeasured/em-dash sentinels) + the performance playwright project"
provides:
  - "Run interface extended with canonical_model/canonical_agent/background_models[] (read-only render inputs)"
  - "runs-table two model columns (Chat model | Background models) with data-testid hooks + D-05 unmeasured/em-dash sentinels"
  - "score-drawer header + timeline summary READ the same persisted canonical/background — no per-surface recompute (D-06)"
  - "nav performance-tab + runs-table container testids so the e2e spec can navigate"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Read-everywhere, recompute-nowhere: all three Performance surfaces READ the persisted Run.metadata canonical/background fields; the per-surface recompute that produced finding B's dominant-vs-first-row divergence is structurally absent (grep-gated: no byAgentModel/dominant in performance components)"
    - "null-as-meaningful display: empty canonical → italic 'unmeasured' sentinel (D-05), empty background → em-dash — never a dominant-by-count fallback, never coerced to a value"

key-files:
  created: []
  modified:
    - integrations/system-health-dashboard/src/store/slices/performanceSlice.ts
    - integrations/system-health-dashboard/src/components/performance/runs-table.tsx
    - integrations/system-health-dashboard/src/components/performance/timeline.tsx
    - integrations/system-health-dashboard/src/components/performance/score-drawer.tsx
    - integrations/system-health-dashboard/src/components/nav-bar.tsx

key-decisions:
  - "Added data-testid='performance-tab' to the nav-bar Performance Link and data-testid='runs-table' to the runs-table container — the Wave-0 e2e spec navigates via these and they were absent (Rule 3 blocking fix, part of the Plan 06 contract the spec queries)"
  - "Timeline surfaces the Run-level canonical/background via selectSelectedRun in a CardHeader summary band; the per-turn row.process/row.model rendering (finding-1) is kept unchanged — Run-level read is additive, not a replacement"
  - "Pre-existing TS errors in unrelated files (node-details-sidebar.tsx, token-usage.tsx) left untouched (SCOPE BOUNDARY); npm run build still exits 0 because the build script is 'tsc --noEmit 2>/dev/null; vite build' and vite compiles the edited files clean"

requirements-completed: []  # ATTR-02 display lands here but is DISCHARGED only after the Task 3 human-verify checkpoint (gsd-browser + canonical-columns.spec.ts green)

# Metrics
duration: 5min
completed: 2026-06-29
status: checkpoint-pending
---

# Phase 75 Plan 06: Dashboard Two-Column Model Display Summary

**The Performance runs table now renders two model columns — the canonical (foreground chat) model and the concurrent background-service models — and the score drawer + timeline READ the same persisted `Run.metadata` fields, so the operator sees the honest chat model (e.g. Opus) consistently everywhere instead of finding B's daemon-dominated `byAgentModel[0]` (haiku). Legacy Runs with no foreground capture show the D-05 "unmeasured" sentinel; an empty background column shows the em-dash. Built clean and served on localhost:3032; the visual/E2E acceptance is the pending Task 3 operator checkpoint.**

## Status: CHECKPOINT PENDING

Tasks 1-2 (the code + the bind-mount rebuild/restart) are complete and committed. **Task 3 is a `checkpoint:human-verify` gate** (the gsd-browser/dashboard visual check + `npx playwright test tests/e2e/performance/canonical-columns.spec.ts`). It was NOT self-verified — it requires the live dashboard and operator eyes. See the "Awaiting Checkpoint" section below for the exact how-to-verify steps and resume signal.

## Performance
- **Duration:** ~5 min (code through build/restart)
- **Started:** 2026-06-29T10:44:30Z
- **Tasks:** 2 of 3 complete (Task 3 = operator checkpoint)
- **Files modified:** 5 (0 created, 5 modified)

## Accomplishments
- **Run interface (performanceSlice.ts):** added `canonical_model?: string | null`, `canonical_agent?: string | null`, and `background_models?: { model: string; process: string; total_tokens: number }[]`, mirroring the existing optional-nullable field style. These are read-only render inputs — the slice does not compute them; Plan 02's `writeRun` persists them and `readRuns` spreads `...meta`.
- **runs-table.tsx:** replaced the single `run.model` cell with a **canonical (Chat model)** cell — `font-mono` value OR the italic "unmeasured" sentinel when null/empty — tagged `data-testid="run-canonical-model"`, plus a **Background models** cell rendering `background_models.map(b => b.model).join(', ')` OR the em-dash sentinel, tagged `data-testid="run-background-models"`. Added the two matching `<TableHead>`s (`runs-col-canonical-model` / `runs-col-background-models`) and a `data-testid="runs-table"` on the container — the full Wave-0 e2e contract.
- **score-drawer.tsx:** drawer header now shows the canonical model via the same best-effort `run?.canonical_model` idiom (italic "unmeasured" when empty), consistent with the table row.
- **timeline.tsx:** a CardHeader summary band reads the Run-level `canonical_model`/`background_models` (via `selectSelectedRun`); the per-turn `row.process`/`row.model` finding-1 rendering is kept unchanged.
- **nav-bar.tsx:** added `data-testid="performance-tab"` to the Performance nav Link so the e2e spec can navigate to the page.
- **Build/deploy:** `npm run build` (vite) exits 0; the new testids + "unmeasured" sentinel are present in the built `dist/assets/index-DaykcFc4.js`; the bind-mounted frontend was restarted via `supervisorctl restart web-services:health-dashboard-frontend` (NO docker-compose build); localhost:3032 serves HTTP 200 with the freshly-built bundle hash.

## Task Commits
1. **Task 1: two-column model display reading persisted Run.metadata (ATTR-02)** — `7d9ef2735` (feat)
2. **Task 2: build the bind-mounted dashboard + restart the frontend** — no commit (build artifact only; `dist/` is gitignored)

## Files Created/Modified
- `integrations/system-health-dashboard/src/store/slices/performanceSlice.ts` — Run interface +3 optional-nullable canonical/background fields (read-only render inputs).
- `integrations/system-health-dashboard/src/components/performance/runs-table.tsx` — two model columns + headers + testids + unmeasured/em-dash sentinels; `runs-table` container testid.
- `integrations/system-health-dashboard/src/components/performance/timeline.tsx` — Run-level canonical/background summary band (reads `selectSelectedRun`); per-turn rendering unchanged.
- `integrations/system-health-dashboard/src/components/performance/score-drawer.tsx` — canonical model in the drawer header.
- `integrations/system-health-dashboard/src/components/nav-bar.tsx` — `data-testid="performance-tab"` on the Performance Link.

## Decisions Made
- **nav + container testids added as a Rule 3 blocking fix.** The Wave-0 spec navigates via `[data-testid="performance-tab"]` then waits for `[data-testid="runs-table"]`; neither existed. Adding them is part of the Plan 06 e2e contract (the spec is the acceptance gate for Task 3), not scope creep — without them the spec cannot reach the table to assert the columns.
- **Timeline Run-level read is additive.** The per-turn `row.process`/`row.model` fg-vs-bg distinction (finding-1, already shipped) is the row-level signal; the new CardHeader band adds the Run-level canonical/background summary by reading the persisted fields. Both honor the D-05 sentinels.
- **Pre-existing TS errors are out of scope.** `node-details-sidebar.tsx` and `token-usage.tsx` carry pre-existing strict-mode errors unrelated to this plan. They were not touched (SCOPE BOUNDARY). `npm run build` exits 0 regardless because the build script swallows tsc output and vite compiles the five edited files clean; `npx tsc --noEmit` confirms zero errors in the edited files.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added performance-tab + runs-table navigation testids**
- **Found during:** Task 1 (wiring the e2e contract)
- **Issue:** `tests/e2e/performance/canonical-columns.spec.ts` navigates via `[data-testid="performance-tab"]` and waits for `[data-testid="runs-table"]` before asserting the columns. Neither testid existed (`nav-bar.tsx` had no testid on the Performance Link; the runs-table container had none). The spec would skip/fail at `gotoPerformance` regardless of the columns.
- **Fix:** Added `data-testid="performance-tab"` to the Performance nav Link (via an optional `testId` field on the tabs array) and `data-testid="runs-table"` to the runs-table container.
- **Files modified:** integrations/system-health-dashboard/src/components/nav-bar.tsx, integrations/system-health-dashboard/src/components/performance/runs-table.tsx
- **Committed in:** 7d9ef2735 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking). No architectural changes, no new packages (T-75-SC holds — `npm run build` used existing deps only).

## Threat Surface
No new trust boundaries. T-75-61 (per-surface recompute) is mitigated by construction: all three components only READ `run.canonical_model`/`run.background_models`; the grep gate confirms no `byAgentModel`/`dominant` computation in any performance component. T-75-62 (model names in UI) accepted (local dashboard, non-sensitive). T-75-SC (npm installs) mitigated — zero new packages.

## Known Stubs
None. The columns render the real persisted `Run.metadata` fields. A null canonical rendering "unmeasured" is the intended D-05 state for legacy (pre-Phase-75) Runs with no foreground capture, not a stub.

## Deferred Issues
Pre-existing TypeScript strict-mode errors in `src/components/workflow/node-details-sidebar.tsx` (lines 1393, 1412) and `src/pages/token-usage.tsx` (lines 589, 675) — unrelated to this plan, out of scope, left untouched. Logged here for awareness; do not block this plan (build exits 0).

## Issues Encountered
None blocking. One Rule 3 fix (navigation testids), resolved on the first pass.

## Awaiting Checkpoint (Task 3 — human-verify)

The final task is an operator visual/E2E gate that was NOT self-approved:

1. `gsd-browser navigate http://localhost:3032` and open the Performance tab.
2. Confirm the runs table has TWO model columns: a Chat-model column and a Background-models column.
3. Confirm a legacy Run (pre-Phase-75, no canonical capture) shows "unmeasured" in the chat-model column, not a haiku/sonnet dominant value (the finding-B regression).
4. Open a Run's score drawer — confirm the same canonical model shows in the header (consistent with the table row).
5. Open the timeline — confirm the Run-level canonical/background summary is consistent with the table.
6. Run the e2e spec: `npx playwright test tests/e2e/performance/canonical-columns.spec.ts` — confirm green.

**Resume signal:** Type "approved" if the two columns render consistently across all three surfaces and the unmeasured sentinel shows for legacy Runs; otherwise describe the inconsistency.

## Self-Check: PASSED

- Modified files exist on disk: performanceSlice.ts, runs-table.tsx, timeline.tsx, score-drawer.tsx, nav-bar.tsx — all present.
- Task 1 commit `7d9ef2735` present in git log.
- Grep gate: `canonical_model` in all three surfaces; `run-canonical-model`/`run-background-models` testids in runs-table; `unmeasured` sentinel present; no `byAgentModel`/`dominant` computation in performance components.
- Built bundle (`dist/assets/index-DaykcFc4.js`) contains the new testids + "unmeasured"; localhost:3032 serves HTTP 200 with that bundle hash.

---
*Phase: 75-measurement-attribution-accuracy-observation-linkage*
*Completed (code): 2026-06-29 — Task 3 operator checkpoint pending*
