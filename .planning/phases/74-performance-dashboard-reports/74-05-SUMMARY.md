---
phase: 74-performance-dashboard-reports
plan: 05
subsystem: dashboard-performance-tab
tags: [dashboard, performance, redux, redux-toolkit, faceted-search, corrected-wins, timeline, dash-01, dash-02]
requires:
  - integrations/system-health-dashboard/src/store/index.ts (combineReducers + typed hooks — pre-existing)
  - integrations/system-health-dashboard/src/store/slices/workflowConfigSlice.ts (createSlice + createAsyncThunk + rejectWithValue convention — pre-existing)
  - integrations/system-health-dashboard/src/pages/token-usage.tsx (layout analog — pre-existing)
  - integrations/system-health-dashboard/server.js (/api/experiments/* same-origin proxy — Plan 74-04)
  - lib/vkb-server/api-routes.js (GET /api/experiments/runs returns { rows }; GET /runs/:taskId/timeline returns { timeline } — Plan 74-04)
provides:
  - integrations/system-health-dashboard/src/store/slices/performanceSlice.ts (performance Redux slice + fetchRuns/fetchTimeline thunks + facet reducers + memoized selectors)
  - integrations/system-health-dashboard/src/store/index.ts (performance reducer registered in combineReducers)
  - integrations/system-health-dashboard/src/components/ui/sheet.tsx (shadcn sheet primitive for Plan 06 drawer)
  - integrations/system-health-dashboard/src/pages/performance.tsx (Performance page consuming the slice)
  - integrations/system-health-dashboard/src/components/performance/faceted-sidebar.tsx (260px faceted rail, selectors-driven)
  - integrations/system-health-dashboard/src/components/performance/runs-table.tsx (corrected-wins table; row click → setSelectedTaskId)
  - integrations/system-health-dashboard/src/components/performance/timeline.tsx (collapsible per-turn timeline + tier badges)
  - integrations/system-health-dashboard/src/components/performance/corrected-wins.ts (shared effective()/isEdited()/judged() helper)
  - integrations/system-health-dashboard/src/App.tsx (/performance route)
  - integrations/system-health-dashboard/src/components/nav-bar.tsx (Performance nav tab)
affects:
  - Plan 74-06 (score drawer consumes sheet.tsx + the same performance slice's selectedTaskId; reports sub-view adds a second Tabs value; reuses corrected-wins.ts)
tech-stack:
  added: []
  patterns:
    - "shared dashboard state in a Redux Toolkit slice (createSlice + createAsyncThunk) consumed via the exported typed useAppSelector/useAppDispatch hooks — NOT page-local useState"
    - "createAsyncThunk fetches same-origin /api/experiments/... INSIDE the thunk with rejectWithValue (mirrors initializeWorkflowConfig); pending/fulfilled/rejected handled in extraReducers"
    - "memoized derived selectors (createSelector) for the filtered run set + live facet counts — no page-local filtered arrays"
    - "corrected-wins display helper defined once (corrected-wins.ts) and shared across runs-table + (future) score drawer"
    - "granularity_tier badge rendered OUTSIDE CollapsibleContent so it stays visible collapsed-or-expanded (honesty signal)"
key-files:
  created:
    - integrations/system-health-dashboard/src/store/slices/performanceSlice.ts
    - integrations/system-health-dashboard/src/components/ui/sheet.tsx
    - integrations/system-health-dashboard/src/pages/performance.tsx
    - integrations/system-health-dashboard/src/components/performance/faceted-sidebar.tsx
    - integrations/system-health-dashboard/src/components/performance/runs-table.tsx
    - integrations/system-health-dashboard/src/components/performance/timeline.tsx
    - integrations/system-health-dashboard/src/components/performance/corrected-wins.ts
  modified:
    - integrations/system-health-dashboard/src/store/index.ts
    - integrations/system-health-dashboard/src/App.tsx
    - integrations/system-health-dashboard/src/components/nav-bar.tsx
decisions:
  - "Endpoint contract is { rows } (Plan 74-04 RED-test-over-prose decision), NOT { runs }. fetchRuns reads data.rows with a defensive data.runs fallback so a future rename can't silently blank the table."
  - "Vendored sheet.tsx by hand against the installed @radix-ui/react-dialog instead of running `npx shadcn add sheet` — the shadcn 4.x CLI tries `pnpm add radix-ui` (the unified umbrella pkg), which fails (pnpm absent; repo pins granular @radix-ui/react-dialog). Sheet IS a dialog with side-slide variants, so the canonical shadcn new-york sheet re-pointed at the existing dependency needs NO new package install. Avoids a package-legitimacy checkpoint."
  - "task_id and the date window are NOT rendered as checkbox facet groups in the 260px rail (high-cardinality identity + range input would wrap); the slice supports them (facetState.task_id / startedAfter / startedBefore + setDateWindow reducer + filter predicate) for Plan 06 / future header controls. The checkbox rail covers task_class, score state, agent, model, framework (the UI-SPEC locked set + permitted score-state addition)."
  - "Timeline panel lives under the runs table inside the Runs tab, driven by the slice's selectedTaskId (no separate selection state)."
metrics:
  duration: ~20m
  completed: 2026-06-28
  tasks: 4
  files: 10
status: awaiting-human-verify-checkpoint
---

# Phase 74 Plan 05: Performance Dashboard Tab (Redux-backed) Summary

Built the operator-facing **Performance** dashboard tab as a Redux-Toolkit-backed read surface. Added a new `performance` slice (`createSlice` + `fetchRuns`/`fetchTimeline` `createAsyncThunk` + facet reducers + memoized `selectFilteredRuns`/`selectFacetCounts` selectors), registered it in the store, vendored the `sheet` primitive (for Plan 06's drawer), wired the `/performance` route + nav tab, and built the page shell with a 260px faceted sidebar (live counts via selectors), a corrected-wins runs table (null → `—`, never 0; amber Pencil "edited" marker; judged value on hover), and a collapsible per-turn timeline with always-visible `granularity_tier` badges. **All shared state lives in the slice — no page-local `useState` for runs/facets/selectedRun/timeline, and no `fetch()` in any component (fetch lives inside the thunks, same-origin `/api/experiments/...`).**

The four AUTO tasks are complete and committed. The plan ends at a `checkpoint:human-verify` gate — execution stops there for operator visual sign-off; the plan is intentionally left **in-progress** (not marked complete in STATE/ROADMAP).

## What Was Built

- **Task 1 — `performanceSlice.ts` + reducer registration** (commit `c7a9cea57`)
  - `fetchRuns` thunk: `fetch('/api/experiments/runs')` same-origin; reads `{ rows }` (defensive `{ runs }` fallback); `rejectWithValue` on non-ok. `pending`→`runsLoading=true`; `fulfilled`→`runs[]` + clear; `rejected`→`runsError`.
  - `fetchTimeline(taskId)` thunk: `fetch('/api/experiments/runs/:taskId/timeline')`; stores under `timelineByTaskId[taskId]`.
  - Plain reducers: `setFacet` (toggle a value in an array facet), `setDateWindow`, `clearFilters`, `setSelectedTaskId`.
  - In-file selectors: `selectRuns/selectRunsLoading/selectRunsError/selectFacetState/selectSelectedTaskId/selectTimelineFor/selectTimelineLoading`, plus memoized `selectFilteredRuns` (applies facetState) and `selectFacetCounts` (live counts over the filtered set) and `selectFacetOptions` (distinct values for rendering rows). `scoreStateOf()` exported for the score-state facet.
  - Registered `performance: performanceReducer` in `store/index.ts` `combineReducers` (RootState now includes `performance`).

- **Task 2 — sheet primitive + route + nav tab** (commit `d32796078`)
  - `src/components/ui/sheet.tsx` vendored (shadcn new-york sheet on `@radix-ui/react-dialog` — see Deviation 1).
  - `App.tsx`: `<Route path="/performance" .../>` immediately after `/token-usage`.
  - `nav-bar.tsx`: `{ label: 'Performance', path: '/performance' }` immediately after Token Usage (active style is the existing `border-b-2 border-primary`).

- **Task 3 — page shell + faceted sidebar + runs table** (commit `ab6848c55`)
  - `pages/performance.tsx`: header (`h1` "Performance" + muted subtitle), summary `Card` grid focal point (total runs / scored runs / total tokens / median wallclock-per-step), `grid grid-cols-[260px_1fr] gap-6` body inside `Tabs` (first value "Runs"; Reports value reserved for Plan 06). Dispatches `fetchRuns()` on mount; reads everything via `useAppSelector`. No shared-state `useState`, no in-component `fetch`.
  - `faceted-sidebar.tsx`: 260px `Card` rail with `Collapsible` facet groups (expanded by default) for task_class, score state, agent, model, framework; each value = `Checkbox` + label + live count `Badge variant="secondary"`; "Clear filters" `Button variant="outline"`. Reads counts/options/state via selectors; dispatches `setFacet`/`clearFilters`.
  - `runs-table.tsx`: `Table` of `selectFilteredRuns`; 5 score dims via the shared `effective()/isEdited()/judged()` helper — amber `Pencil` "edited" marker, judged value in a `Tooltip`, `—` for null (never 0). Row click dispatches `setSelectedTaskId`. UI-SPEC empty-state copy (distinguishes "no runs at all" from "filters exclude everything").
  - `corrected-wins.ts`: shared `SCORE_DIMENSIONS` + `effective`/`isEdited`/`judged` (Plan 06's drawer imports the same helper).

- **Task 4 — collapsible timeline** (commit `8c028eeb5`)
  - `timeline.tsx`: dispatches `fetchTimeline(taskId)` on `selectedTaskId` change; reads via `selectTimelineFor`. Per-turn parents are `Collapsible` collapsed by default (`useState(false)`); `granularity_tier` `Badge variant="secondary"` rendered OUTSIDE `CollapsibleContent` (always visible). Expanding reveals per-reasoning-step sub-bands; `estimated` hint on `tokens_estimated===1`. A `per-session-aggregate` (copilot) row renders a single band with no expand affordance. `font-mono` tokens; null → `—`. Wired into the page Runs tab under the runs table.

## Verification

- **`npx tsc --noEmit`** — ZERO errors in all 10 new/modified files (slice, sheet, page, 3 sub-components, helper, store, App, nav-bar). The 4 tsc errors that remain (`node-details-sidebar.tsx` ×2, `token-usage.tsx` ×2) are **pre-existing in files this plan did not touch** (out of scope; the build script runs `tsc --noEmit 2>/dev/null` non-blocking).
- **`npm run build`** (FRONTEND) — succeeded: 2825 modules transformed, `dist/` written (`index-CJobfLli.js`, css, vendor chunks) in 7.62s.
- **Frontend restart** — `docker exec coding-services supervisorctl restart web-services:health-dashboard-frontend` → stopped/started OK (bind-mounted `dist/` path; no Docker rebuild needed per CLAUDE.md).
- **Live reachability** — `curl :3032/performance` → HTTP 200; `curl :3032/api/experiments/runs` (same-origin proxy) → HTTP 200 with real `{ rows: [...] }` (e.g. `task_id: verify-headless-...`, `task_class: debug`), confirming the slice's `{ rows }` contract matches the Plan 04 endpoint.
- **Task grep gates (all PASS):**
  - Task 1: `performance: performanceReducer` present; `createAsyncThunk` present; `fetch('/api/experiments...` present in slice; tsc clean on slice/store.
  - Task 2: `sheet.tsx` exists; `/performance` in App.tsx after `/token-usage`; `Performance` tab in nav-bar after Token Usage.
  - Task 3: `useAppSelector`/`useAppDispatch` in page; zero real `fetch(` in page (only a comment); zero shared-state `useState` (only a comment); `grid-cols-[260px_1fr]` present; zero `localhost:8080`/`PROXY_BASE` in page/slice/components; zero `?? 0` in runs-table; `setSelectedTaskId` dispatched on row click.
  - Task 4: `useAppSelector`/`useAppDispatch`/`fetchTimeline` present; zero direct `fetch(`; collapsed-by-default (`useState(false)`); tier `Badge variant="secondary"` outside CollapsibleContent; per-session-aggregate path present; zero `?? 0`.

## Deviations from Plan

### Auto-fixed / Adaptation

**1. [Rule 3 — Blocking tooling] Vendored sheet.tsx instead of `npx shadcn add sheet`**
- **Found during:** Task 2.
- **Issue:** `npx shadcn@latest add sheet --yes` failed: shadcn 4.x resolves `sheet`'s dependency to the unified `radix-ui` umbrella package and runs `pnpm add radix-ui`, which errors `spawn pnpm ENOENT` (pnpm is not installed; this repo uses npm and pins the granular `@radix-ui/react-dialog@^1.1.15`, already installed and used by `dialog.tsx`). No `sheet.tsx` was written.
- **Fix:** Vendored the canonical shadcn new-york `sheet.tsx` (the `cva` side-slide variant component) re-pointed at the already-installed `@radix-ui/react-dialog` — Sheet IS a Dialog with side variants, so this is a one-import change from the generated output and needs **no new package install**. This is NOT a package-install auto-substitution (no new dependency entered `package.json`); it reuses an existing, already-vetted dependency, so it does not require a package-legitimacy checkpoint. Matches the UI-SPEC "shadcn official sheet" intent.
- **Files modified:** `src/components/ui/sheet.tsx`
- **Commit:** `d32796078`

**2. [Plan-shape adaptation] task_id + date-window facets supported in the slice but not rendered as rail checkbox groups**
- **Found during:** Task 3 (building the 260px rail).
- **Issue:** UI-SPEC lists `task_id` and a date window among facet groups, but a per-value checkbox list over every distinct task_id (high-cardinality identity) and a date-range input do not fit the 260px rail without wrapping — the exact wrapping the 260px width was chosen to avoid (UI-SPEC Spacing note).
- **Fix:** The slice fully supports both (`facetState.task_id`, `facetState.startedAfter/startedBefore`, `setFacet` for task_id, a dedicated `setDateWindow` reducer, and the `runPassesFacets` predicate filters on all of them). The rail renders the locked checkbox set (task_class, score state, agent, model, framework). Plan 06 / a future header control can surface task_id search + a date picker against the existing slice state with no slice change. Documented as the Claude's-discretion clause in a code comment.
- **Files modified:** `src/components/performance/faceted-sidebar.tsx`, `src/store/slices/performanceSlice.ts`
- **Commit:** `ab6848c55` / `c7a9cea57`

## Known Stubs

None. Every component is wired to the live slice and the slice fetches the live same-origin endpoints (verified returning real `{ rows }` data). The "Reports" Tabs value is intentionally deferred to Plan 06 (the plan scopes Reports there) — `Tabs` currently has only the "Runs" value; this is a planned future-plan boundary, not a stub.

## Threat Flags

None new. The plan's threat-model dispositions hold: T-74-05-01 (React escapes all run/score strings; no `dangerouslySetInnerHTML` anywhere in the new components); T-74-05-02 (both thunks fetch same-origin `/api/experiments/...` only — grep-confirmed zero `localhost:8080`/`PROXY_BASE` in slice/page/components); T-74-05-03 (corrected-wins helper renders null as `—`; zero `?? 0` on any score/token field — grep-confirmed in runs-table + timeline); T-74-05-SC (no new package install — sheet vendored against the existing `@radix-ui/react-dialog`; `@reduxjs/toolkit`/`react-redux` already present).

## Self-Check: PASSED

All 7 created files + 3 modified files present on disk; all 4 task commits present in git history (`c7a9cea57`, `d32796078`, `ab6848c55`, `8c028eeb5`); `npm run build` succeeded; frontend restarted; `/performance` route HTTP 200 and the same-origin runs proxy returns real `{ rows }`.

## Checkpoint

The next task is `checkpoint:human-verify` (gate=blocking). Execution stops here. The plan is left **in-progress** — STATE/ROADMAP are NOT advanced — pending operator visual sign-off via `gsd-browser` against `localhost:3032/performance`. See the CHECKPOINT REACHED message for verification steps.
