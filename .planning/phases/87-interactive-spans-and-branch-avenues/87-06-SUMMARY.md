---
phase: 87
plan: 06
subsystem: system-health-dashboard / Performance tab (branch avenues)
tags: [avenues, ranking, merge-status, promote, prune, redux, playwright]
requires:
  - "87-03: origin_span_id stamped on each avenue Run (group key)"
  - "87-04: coordinator /experiments/avenue-merge-status|promote|prune + vkb-server /api/experiments/avenue-* proxy routes"
  - "87-05: performanceSlice fork prefill (buildForkPrefill) + origin_span_id-bearing LauncherPrefill"
  - "86-04/86-05: DifferenceViewer + Compare-tab compare wiring (reused unchanged)"
provides:
  - "selectAvenuesByOrigin — Runs grouped by origin_span_id into ranked origin groups"
  - "rankAvenues + avenueOutcomeScore ranking (Phase 73 corrected-wins; nulls sink)"
  - "fetchMergeStatus / promoteAvenue / pruneAvenue thunks (verbatim /api/experiments/avenue-*)"
  - "MergeStatusBadge (git-computed, unknown → no badge)"
  - "AvenuePanel (origin-grouped N-way ranked table + 2-of-N compare + Promote/Prune)"
affects:
  - "performance.tsx (new Avenues tab mounting AvenuePanel; Compare-tab wiring reused)"
tech-stack:
  added: []
  patterns:
    - "Extend performanceSlice (no new slice) — D-05 / 86-02 frozen-contract discipline"
    - "Verbatim server status rendered straight; null/unknown → no badge, em-dash never 0 (honesty)"
    - "Host-only git ops via Plan-04 coordinator seam; browser never runs git"
    - "Reuse existing DifferenceViewer (setCompareA/B) — do NOT re-implement alignment (D-06)"
key-files:
  created:
    - integrations/system-health-dashboard/src/components/performance/merge-status-badge.tsx
    - integrations/system-health-dashboard/src/components/performance/avenue-panel.tsx
    - integrations/system-health-dashboard/tests/e2e/performance/performance-compare.spec.ts
  modified:
    - integrations/system-health-dashboard/src/store/slices/performanceSlice.ts
    - integrations/system-health-dashboard/src/pages/performance.tsx
decisions:
  - "Mounted the ranked panel in a NEW 'Avenues' sub-tab (not inline in Runs) so the origin-grouped table is its own focal surface; its Compare CTA reuses the 86-05 Compare-tab wiring."
  - "Ranking nulls (unmeasured) ALWAYS sort last regardless of direction — an unscored avenue never out-ranks a real low score (honesty)."
  - "The spec at the plan-declared path did not exist; authored it fresh (the fork-launcher flow lives in performance.spec.ts). Documented as a Rule-3 deviation."
metrics:
  duration: ~35m
  completed: 2026-07-11
  tasks: 3
  files_changed: 5
  insertions: 985
---

# Phase 87 Plan 06: Origin-Grouped N-Way Ranked Avenue Panel Summary

Delivered the primary Phase-87 screen — an origin-grouped, outcome-score-ranked N-way comparison panel with git-computed merge-status badges and per-row conflict-blocked Promote / destructive-confirm Prune — by extending `performanceSlice.ts` (grouping + ranking selectors + three verbatim-status thunks) and reusing the existing 86-04 DifferenceViewer + 86-05 compare wiring unchanged.

## What Was Built

**Task 1 — slice extension (`performanceSlice.ts`, commit `267fcde25`):**
- `selectAvenuesByOrigin` — groups fetched `Run`s by the `origin_span_id` the runner stamps (Plan 87-03) into ordered `{ originSpanId, avenues[] }` groups; non-avenue (non-forked) Runs are excluded.
- `rankAvenues(avenues, column, dir)` + `avenueOutcomeScore` — default sort = outcome score (Phase 73 corrected-wins: `corrected_goal_achieved ?? goal_achieved`), best-first; secondary sortable columns `tokens` (`outcome.totalTokens`), `route` (`loop_count`), `wallclock` (`wallclock_per_step`). Null/unmeasured values sort LAST regardless of direction (honesty).
- Three thunks mirroring the `launchExperiment` bridge idiom, all POSTing `{ task_id }` to the Plan-04 `/api/experiments/avenue-*` routes: `fetchMergeStatus` → `avenue-merge-status`, `promoteAvenue` → `avenue-promote`, `pruneAvenue` → `avenue-prune`. Merge status stored per task_id VERBATIM (`state`/`ahead`/`behind`/`conflicts`/`branch`); a missing `state` → null → no badge. Promote returns the verbatim `{ promoted, reason?, conflicts? }` (conflict-refused is not a rejection). Prune drops the cached status on success (branch gone).
- New state (`mergeStatusByTaskId`, `promotePendingIds`, `prunePendingIds`, `promoteResultByTaskId`, `avenueErrorByTaskId`) + `clearAvenueError` reducer + selectors. `createSlice` count unchanged (no new slice).

**Task 2 — badge + panel (commit `344e40e04`):**
- `merge-status-badge.tsx` clones the `reconciliation-badge.tsx` idiom: `Badge variant="outline"` + lucide icon + `status-*` token + verbatim git tooltip (`branch: … · ahead n · behind m · c conflicting files`). Mapping merged(`Check`,`status-success`) / unmerged(`GitBranch`, muted) / conflicts(`AlertTriangle`,`status-warning`); `unknown`/null → renders NOTHING (honesty).
- `avenue-panel.tsx` — a `Card` per origin span containing a sortable shadcn `Table` (the primary focal point). Columns: avenue label (task_id + `agent · model · framework`, font-mono), outcome score (default sort), tokens/cost, route, wall-clock (all font-mono, right-aligned, sortable), merge badge, actions. 2-of-N row selection → "Compare selected (2)" dispatches `setCompareA/setCompareB` and switches to the Compare tab (existing `DifferenceViewer`; no diff rebuilt). Per-row **Promote** (confirm-gated `variant=default`; when status is `conflicts`, the button is replaced by the `text-status-warning` "resolve them before promoting" copy). Per-row **Prune** (`variant="destructive"` → inline `bg-destructive/10` `role="alertdialog"` bar carrying the mandatory D-05 "Measurement data stays in .data" reassurance). Empty states: "No avenues yet" (no forks) / "Avenues are running… no results to rank yet." (forked, 0 completed). Honesty: null/unmeasured → em-dash, never 0. Best row gets a subtle `border-status-success-line` left accent only (never whole-row colour).
- Mounted `AvenuePanel` in a new **Avenues** tab in `performance.tsx`; its `onCompare` switches to the Compare tab (86-05 wiring reused).

**Task 3 — e2e spec (`performance-compare.spec.ts`, commit `ddcbbd566`):**
- Six tests covering: ranked panel renders origin-grouped rows outcome-sorted best-first; merge badge present per row (and absent when git status is unknown — honesty); 2-of-N select → "Compare selected (2)" → Compare tab; Prune confirm carries the D-05 copy; Promote conflict-blocked copy. Data-presence skip guards (86-05 idiom) skip cleanly when no forked avenue exists. Collection + typecheck gate passes (6 tests listed).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Worktree missing node_modules + sibling submodule dist**
- **Found during:** Task 1 build verification.
- **Issue:** `npm run build` failed — the worktree had no `node_modules` (`Cannot find module '@reduxjs/toolkit'`, `vite: command not found`) and the cross-submodule import `../../../mcp-server-semantic-analysis/dist/agents/process-tags.js` was unresolved (git worktrees don't populate submodule contents).
- **Fix:** Symlinked the MAIN tree's already-installed `node_modules` and the sibling `mcp-server-semantic-analysis/dist` into the worktree (reuse of existing built artifacts — NOT a package install; no new packages). These symlinks are gitignored/untracked and were NOT committed.
- **Files modified:** none tracked (build-environment symlinks only).
- **Commit:** n/a.

**2. [Rule 3 - Blocking] Plan-declared spec path did not exist ("extend" → create)**
- **Found during:** Task 3.
- **Issue:** The plan says "extend `performance-compare.spec.ts`", but that file did not exist (the fork-launcher flow lives in `performance.spec.ts`).
- **Fix:** Authored `performance-compare.spec.ts` fresh at the plan-declared path with the avenue-panel flow.
- **Commit:** `ddcbbd566`.

### Note: `import normalizeModel`
`normalizeModel` is exported from `./models`, not the slice — corrected the import in `avenue-panel.tsx` before the Task-2 build passed (caught by `tsc`, fixed inline).

## Verification

- `cd integrations/system-health-dashboard && npm run build` — CLEAN (tsc typecheck + vite bundle) after each component task and at final. This is the primary integration gate.
- Task 1 acceptance greps: `selectAvenuesByOrigin|origin_span_id` (17), `fetchMergeStatus|promoteAvenue|pruneAvenue` (19), `corrected_goal_achieved|goal_achieved` (7), `/api/experiments/avenue-` (5), `createSlice` (2 — unchanged, no new slice). PASS.
- Task 2 acceptance greps: badge `conflicts|merged|unmerged` (8) + `return null` (3); panel `Compare selected|setCompareA|setCompareB` (6), `Measurement data stays` (1), conflict copy (2), `alignRuns|run-align` (0 — reuses DifferenceViewer), raw hex (0). PASS.
- Task 3: `avenue|merge|Compare selected|Prune|Promote` (50); `npx playwright test performance-compare.spec.ts --list` → 6 tests collected + typecheck clean. PASS.

### Live visual verification — DEFERRED to orchestrator (recorded per `<parallel_execution>`)

The dashboard is bind-mounted into `coding-services` from the HOST/MAIN tree, so a live Playwright / gsd-browser run at `localhost:3032` from inside this worktree reflects MAIN-tree code, NOT these changes. A live `npx playwright test performance-compare.spec.ts` run confirmed this: test (a) timed out because the running (main-tree) dashboard has no `avenues-tab`. Per the plan's execution note, **live visual verification in both light and `.dark` themes is deferred to the orchestrator's post-merge step** (rebuild the real dashboard: `npm run build` → `docker exec coding-services supervisorctl restart web-services:health-dashboard-frontend`, then gsd-browser screenshots of the ranked panel + merge badge + promote/prune confirm bars in both themes). The worktree gate satisfied here is the `npm run build` typecheck/bundle + the spec collection gate.

## Threat Surface

No new security surface beyond the plan's `<threat_model>`. The frontend consumes the Plan-04 host-only avenue routes verbatim; the UI adds defense-in-depth for T-87-06-01 (Promote disabled + warning copy when `state==='conflicts'`, mirroring the server-side conflict block) and renders merge/ranking state verbatim (T-87-06-03 — never client-recomputed; unknown → no badge; null → em-dash never 0). The diff is the reused DifferenceViewer (T-87-06-04 — no `alignRuns` re-implementation, grep-verified 0).

## Known Stubs

None. All data flows from live slice thunks (`fetchMergeStatus`, `selectAvenuesByOrigin` over `fetchRuns`) — no hardcoded empty values wired to render. Empty states are intentional honesty affordances, not stubs.
