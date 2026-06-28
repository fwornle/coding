---
phase: 74-performance-dashboard-reports
plan: 06
subsystem: dashboard-performance-tab
tags: [dashboard, performance, redux, redux-toolkit, score-override, reports, snapshot, e2e, dash-03, kb-04, score-02]
requires:
  - integrations/system-health-dashboard/src/store/slices/performanceSlice.ts (Plan 05 — selectedTaskId, fetchRuns, fetchTimeline, facet reducers, corrected-wins.ts)
  - integrations/system-health-dashboard/src/components/ui/sheet.tsx (Plan 05 — drawer primitive)
  - integrations/system-health-dashboard/src/pages/performance.tsx (Plan 05 — Tabs shell + row click → setSelectedTaskId)
  - lib/vkb-server/api-routes.js (Phase 73 PATCH /api/experiments/scores/:taskId; Plan 04 report endpoints)
  - lib/experiments/score-write.mjs (applyOverride allowlist + ranges — mirrored client-side)
  - lib/experiments/report-read.mjs (report view shape — { reportId, title, snapshotFrozenAt, facetState, snapshot })
provides:
  - integrations/system-health-dashboard/src/store/slices/performanceSlice.ts (EXTENDED — saveOverride + fetchReports/saveReport/refreshReport thunks; reports/activeReportId/pending state; reports + override selectors)
  - integrations/system-health-dashboard/src/components/performance/score-drawer.tsx (Sheet drawer; 5 rubric rows; saveOverride → existing PATCH)
  - integrations/system-health-dashboard/src/components/performance/reports-subview.tsx (Reports TabsContent; freeze/list/render-snapshot/refresh)
  - tests/e2e/dashboard/performance.spec.ts (5 live Playwright flows)
affects:
  - "Phase 74 complete: DASH-01/02/03 + KB-04 + SC#5 (Phase 73 D-07 deferral) all operator-usable"
tech-stack:
  added: []
  patterns:
    - "saveOverride createAsyncThunk issues ONE PATCH per edited dimension to the EXISTING Phase 73 endpoint, then re-dispatches fetchRuns; rejectWithValue carries HTTP status so the drawer branches 400 vs 404 — no client-side applyOverride re-implementation"
    - "in-progress corrected_* edits are LOCAL useState inside the drawer (idiomatic form state); only selectedTaskId + the post-save runs refresh are Redux"
    - "saved-report view renders Report.snapshot VERBATIM from slice state (selectActiveReport) and NEVER re-queries the runs endpoint on view (DASH-03 render-from-snapshot)"
    - "refreshReport tracks per-id pending (refreshReportPendingIds[]) so multiple report cards refresh independently"
key-files:
  created:
    - integrations/system-health-dashboard/src/components/performance/score-drawer.tsx
    - integrations/system-health-dashboard/src/components/performance/reports-subview.tsx
  modified:
    - integrations/system-health-dashboard/src/store/slices/performanceSlice.ts
    - integrations/system-health-dashboard/src/pages/performance.tsx
    - integrations/system-health-dashboard/src/components/performance/runs-table.tsx
    - integrations/system-health-dashboard/src/components/performance/timeline.tsx
    - integrations/system-health-dashboard/src/components/performance/faceted-sidebar.tsx
    - tests/e2e/dashboard/performance.spec.ts
decisions:
  - "Operator identity: stamped overridden_by with a documented DEFAULT_OVERRIDDEN_BY = 'dashboard-operator' constant exported from the slice — no richer identity source (auth/session) is wired into the dashboard today. Server caps at 256 chars / requires non-empty; the constant satisfies both. A future auth integration can replace the constant with the live operator id with no thunk change."
  - "saveReport sends { title, facetState, snapshotRows } per the documented Plan 04 contract; the server mints a stable reportId slug from title and materializes the frozen snapshot from the saved query — the snapshot comes back on the fetchReports re-pull (report-read toView)."
  - "Report title auto-derives from the current local time (`Report {timestamp}`) so repeated saves are distinguishable; no title-input affordance was in scope. The server slug is stable per title."
  - "Playwright navigateToPerformance waits on domcontentloaded + the h1 assertion, NOT networkidle — the dashboard holds persistent SSE/polling connections (health refresh middleware) so networkidle never settles (all 5 flows timed out at 60s on the first run before this fix)."
  - "Data-dependent E2E flows (b/c/d/e) gate on run-row presence and skip with a stated reason on an empty store rather than hard-failing on a fresh checkout. Flow (d) skipped this run — the single seeded run has no expandable per-turn timeline (per-session-aggregate or no children)."
metrics:
  duration: ~35m
  completed: 2026-06-28
  tasks: 3
  files: 8
status: awaiting-human-verify-checkpoint
---

# Phase 74 Plan 06: Performance Tab Interactive Surface (Redux-backed) Summary

Completed the operator-facing interactive layer of the **Performance** dashboard tab, all shared state Redux-managed in the EXTENDED `performance` slice. The **score-override drawer** (D-02 / SCORE-02 — closes ROADMAP SC#5, the Phase 73 D-07 deferral) opens from the slice's `selectedTaskId`, shows the 5 rubric rows (judged read-only + editable `corrected_*` inputs + rationale), and saves via a new `saveOverride` thunk that wraps the **existing** Phase 73 `PATCH /api/experiments/scores/:taskId` (one PATCH per edited dimension) then re-dispatches `fetchRuns` so the corrected-wins table refreshes. The **Saved Reports sub-view** (D-04/D-05/DASH-03/KB-04) is a second `Tabs` value INSIDE Performance driving `fetchReports`/`saveReport`/`refreshReport` thunks; saved reports render their **frozen snapshot verbatim from slice state** (never re-queried on view). The Plan 01 Playwright flows were activated from `fixme` to live (5 passed, 1 cleanly skipped on empty timeline data). **No new write logic** — the drawer reuses the existing PATCH; the reports sub-view drives the Plan 04 report endpoints.

The three AUTO tasks are complete and committed. The plan ends at a `checkpoint:human-verify` gate — execution stops there for operator visual sign-off; the plan is intentionally left **in-progress** (STATE/ROADMAP NOT advanced).

## What Was Built

- **Task 1 — slice `saveOverride` + score-drawer + page mount** (commit `e70bf2e25`)
  - `performanceSlice.ts`: `saveOverride` `createAsyncThunk` (args `{ taskId, edits[], overridden_by }`) issues one same-origin `PATCH /api/experiments/scores/:taskId` per edited dimension (`{ dimension, value, overridden_by }`); on all-success `dispatch(fetchRuns())`; on non-ok `rejectWithValue({ status, message })` so the drawer branches 400 vs 404. Added the reports state + `fetchReports`/`saveReport`/`refreshReport` thunks + `setActiveReportId`/`clearOverrideStatus` reducers + all reports/override selectors (consumed by Task 2). Exported `DEFAULT_OVERRIDDEN_BY`.
  - `score-drawer.tsx`: right-side `Sheet` (`sm:max-w-md`) opened when `selectSelectedTaskId` is non-null; 5 rubric rows (`goal_achieved`, `code_quality`, `test_coverage`, `regressions`, `spec_drift`) each with judged value (read-only, muted) + a `corrected_*` `Input` held in **local `useState`** (`drafts`, reset on run change) + per-dimension rationale. Client mirrors server ranges (`validateDim`: regressions 0|1, others [0,1]) and blocks Save on any invalid/empty-only edit set. Footer: primary `Save override` + `Discard changes` (`variant="ghost"`). On fulfilled → `setSelectedTaskId(null)` close; on 404 → reopen copy; on 400 → inline validation message; transient `Override saved`.
  - `runs-table.tsx`: `data-testid="run-row"` + `data-task-id`. `performance.tsx`: mounts `<ScoreDrawer />` (driven by slice state, no page-local open flag) + adds the `Reports` `TabsTrigger`/`TabsContent`.

- **Task 2 — Saved Reports sub-view** (commit `c16cfface`)
  - `reports-subview.tsx`: a `Reports` `TabsContent` INSIDE Performance (D-05 — NOT a `nav-bar.tsx` entry). On mount `dispatch(fetchReports())`. `Save report` reads the slice's current `facetState` + `selectFilteredRuns` and `dispatch(saveReport({ title, facetState, snapshotRows }))`. List of saved reports as `Card` rows (`data-testid="report-row"`) with frozen-at relative time + a per-card `Refresh snapshot` `Button variant="outline"` (`refreshReport`, per-id `Refreshing…`). Selecting a card `dispatch(setActiveReportId)` and renders its **frozen `snapshot`** (`selectActiveReport`) in a read-only table — **no re-query on view** (DASH-03). Empty state `No saved reports yet` + body copy. Staleness note verbatim. No delete/export (out of scope). **No direct `fetch(` in the component** — fetch lives in the thunks.

- **Task 3 — activated Playwright spec** (commit `ae5447567`)
  - `performance.spec.ts`: 5 live flows against `http://localhost:3032/performance` — (a) page loads + `h1` "Performance" + Performance nav link; (b) facet selection narrows the runs table; (c) row click opens the `run-detail-drawer` Sheet with rubric inputs + Save override/Discard buttons; (d) timeline parent expand reveals reasoning-step sub-bands + always-visible tier badge; (e) `Save report` → a new `report-row` appears in the Reports sub-view. Data-gated skips on empty store. Added `data-testid`s: `timeline-turn`/`timeline-reasoning-step`/`granularity-tier-badge` (timeline.tsx), `facet-row`/`facet-<group>-<value>` (faceted-sidebar.tsx).

## Verification

- **`npx tsc --noEmit -p tsconfig.json`** — ZERO errors in all plan files (slice, score-drawer, reports-subview, page, runs-table, timeline, faceted-sidebar). The 4 remaining errors are **pre-existing, out-of-scope** (`node-details-sidebar.tsx` ×2, `token-usage.tsx` ×2 — files this plan did not touch; same set noted in Plan 05).
- **`npm run build`** (FRONTEND) — succeeded twice (after Task 1+2, and after Task 3 testids): `dist/` written, ~590 kB index chunk, built in <8s.
- **Frontend restart** — `docker exec coding-services supervisorctl restart web-services:health-dashboard-frontend` → stopped/started OK (bind-mounted `dist/`; no Docker rebuild per CLAUDE.md).
- **`npx playwright test tests/e2e/dashboard/performance.spec.ts`** — **5 passed, 1 skipped** (collection witness + flows a/b/c/e green; flow d skipped — the single seeded run has no expandable per-turn timeline, the intended clean-skip path). 9.1s.
- **Live reachability** — `gsd-browser navigate http://localhost:3032/performance` → H1 "Performance", 21 buttons, 7 links; `curl :3032/api/experiments/reports` → `{ reports: [] }` (empty pre-save, populates after Save report).
- **Task grep gates (all PASS):**
  - Task 1: `method: 'PATCH'` in slice; `/api/experiments/scores/` same-origin in slice; `useAppSelector`/`useAppDispatch` in drawer (8 hits); zero real `useState` in page (comment only).
  - Task 2: `/api/experiments/reports` ×4 in slice; `useAppSelector`/`useAppDispatch` in subview (12 hits); zero `fetch(` in subview; verbatim copy present.
  - Task 3: zero real `test.fixme(` calls (1 grep hit is a docstring); `/performance` nav target present; assertions cover facet-narrow/drawer-open/timeline-expand/report-save.

## Deviations from Plan

### Auto-fixed / Adaptation

**1. [Rule 1 — Bug] Playwright `networkidle` wait never settles → switched to `domcontentloaded` + h1 assertion**
- **Found during:** Task 3 (first E2E run).
- **Issue:** All 5 flows hard-failed at 60s on `page.waitForLoadState('networkidle')`. The dashboard holds persistent SSE / polling connections (the Redux health refresh middleware), so the network never goes idle — `networkidle` is structurally the wrong wait for this app.
- **Fix:** `navigateToPerformance` now `goto(..., { waitUntil: 'domcontentloaded' })` + `expect(h1).toHaveText('Performance')` + a short settle for the `fetchRuns` thunk. All 5 flows then ran green/skip in 9.1s.
- **Files modified:** `tests/e2e/dashboard/performance.spec.ts`
- **Commit:** `ae5447567`

**2. [Plan-shape adaptation] Operator identity is a documented default constant**
- **Found during:** Task 1.
- **Issue:** The drawer must stamp `overridden_by`, but no auth/session/operator-identity source exists in the dashboard today.
- **Fix:** Exported `DEFAULT_OVERRIDDEN_BY = 'dashboard-operator'` from the slice (satisfies the server's non-empty / ≤256 rule). The plan explicitly permits "a sensible default constant documented in the SUMMARY." A future auth integration swaps the constant for the live operator id with no thunk change.
- **Files modified:** `src/store/slices/performanceSlice.ts`, `src/components/performance/score-drawer.tsx`
- **Commit:** `e70bf2e25`

## Known Stubs

None. The drawer wires to the live `saveOverride` thunk (existing PATCH); the reports sub-view wires to the live `fetchReports`/`saveReport`/`refreshReport` thunks; the saved-report view renders the live frozen snapshot from slice state. All endpoints verified reachable same-origin. No placeholder/empty-data paths flow to UI without an explicit empty-state copy.

## Threat Flags

None new. The plan's threat-model dispositions hold:
- T-74-06-01 (Tampering — override values): the drawer mirrors server ranges (`validateDim`) but the existing PATCH re-validates (api-routes.js:441-461) — server authoritative.
- T-74-06-02 (XSS — report title / rationale / snapshot strings): React escapes by default; zero `dangerouslySetInnerHTML` in the new components; titles/snapshots treated as text.
- T-74-06-03 (Info disclosure — wrong origin): every thunk fetch is same-origin `/api/experiments/...`; zero `localhost:`/`host:port` in the new thunks.
- T-74-06-04 (Tampering — bypass validation): `saveOverride` calls ONLY the existing PATCH; no `applyOverride`/write logic duplicated in the frontend (grep-confirmed).
- T-74-06-SC (npm installs): no new package — `sheet` vendored in Plan 05, `@reduxjs/toolkit`/`react-redux` already present.

## Self-Check: PASSED

Both created components + the SUMMARY exist on disk; all 3 task commits present in git history (`e70bf2e25`, `c16cfface`, `ae5447567`); `npx tsc --noEmit` clean on plan files; `npm run build` succeeded; frontend restarted; `/performance` HTTP 200; Playwright spec 5 passed / 1 skipped.

## Checkpoint

The next task is `checkpoint:human-verify` (gate=blocking). Execution stops here. The plan is left **in-progress** — STATE/ROADMAP are NOT advanced — pending operator visual sign-off via `gsd-browser` against `localhost:3032/performance`. See the CHECKPOINT REACHED message for verification steps.

---

## Post-checkpoint fixes (human-verify, 2026-06-28)

The 74-06 human-verify checkpoint surfaced three defects (all found via operator
`gsd-browser` review of the timeline); fixed and committed before phase sign-off:

1. **Container DB-path bug** (`lib/experiments/timeline-read.mjs`) — `resolveDataDir()`
   hardcoded the host `.data` path, which does not exist inside the coding-services
   container where vkb-server (:8080) runs → `readTimeline` returned `[]` for every run,
   so DASH-02 was empty in the deployed dashboard. Now resolves container-safely
   (`LLM_PROXY_DATA_DIR` → `CODING_ROOT/.data` → module-relative repo root).
2. **Timeline render legibility** (`components/performance/timeline.tsx`) — tier-less
   single-turn rows rendered as a blank badge + a far-right number. Now each turn shows
   `Turn N · model · tier-badge`, with an empty `granularity_tier` rendered as `untagged`.
3. **Timeline/drawer coupling** (`performanceSlice.ts` + `runs-table.tsx` +
   `score-drawer.tsx` + `performance.tsx` + E2E flow c) — the modal drawer's dimming
   overlay hid the timeline, and both keyed off `selectedTaskId`. Split into
   `selectedTaskId` (inline timeline, row click) and `overrideTaskId` (modal drawer,
   explicit per-row "Edit scores" button).

Verification after fixes: `npx tsc --noEmit` clean on all Phase 74 files; Playwright
`performance.spec.ts` 5 passed / 1 skipped; `gsd-browser` confirms row-click shows the
timeline with no overlay and "Edit scores" opens the drawer. Human-verify: APPROVED.

Residual (data, not code): the seed `verify-*` runs have only tier-less single-turn rows,
so expandable per-reasoning-step sub-bands and non-`untagged` tier badges need a run
produced with proper per-turn/per-reasoning-step tagging to demonstrate.
