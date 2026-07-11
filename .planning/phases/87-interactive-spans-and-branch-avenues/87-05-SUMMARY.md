---
phase: 87-interactive-spans-and-branch-avenues
plan: 05
subsystem: dashboard / experiment-fork-launcher
tags: [react, redux, dashboard, avenues, fork, sweep-guardrail, AVN-02, AVN-03]
requires:
  - "performanceSlice launcherPrefill + launchExperiment bridge (Plan 85-05/06)"
  - "runs-table isCompletedExperimentRun guard + buildRerunPrefill idiom (Plan 85-06)"
  - "experiment-launcher matrix-preview (server cellCount) + ring-2 prefill highlight (Plan 85-06)"
  - "runner origin_span_id threading + synthesizeAvenueSpec (Plan 87-03)"
  - "spec axis vocabulary: mastracode + env kb-on/kb-off (Plan 87-02)"
provides:
  - "buildForkPrefill(run) — fork prefill builder carrying origin_span_id + 4-axis ForkAxes + sweep"
  - "Fork-into-avenues ghost button on completed span rows (AVN-02)"
  - "4-axis fork picker (Agent/Model/SDD-framework/Knowledge-injection) + sweep toggle (AVN-03)"
  - "mandatory server-resolved sweep guardrail (count + est tokens/cost + over-threshold caution)"
  - "origin_span_id threaded through the launchExperiment run body"
affects:
  - "Plan 87-06 (origin-grouped N-way panel consumes origin_span_id-linked avenue Runs)"
tech-stack:
  added: []
  patterns:
    - "fork = thin wrapper over launchExperiment (D-01, no new API path)"
    - "LauncherPrefill EXTENDED not forked (Phase 86 frozen-contract discipline)"
    - "guardrail count = SERVER previewCellCount (D-09), never a client axes recompute"
    - "launch DISABLED until server preview renders (D-02)"
key-files:
  created:
    - integrations/system-health-dashboard/tests/e2e/performance/performance.spec.ts
    - integrations/system-health-dashboard/playwright.config.ts
  modified:
    - integrations/system-health-dashboard/src/store/slices/performanceSlice.ts
    - integrations/system-health-dashboard/src/components/performance/runs-table.tsx
    - integrations/system-health-dashboard/src/components/performance/experiment-launcher.tsx
decisions:
  - "avenue count for the guardrail + 'Launch {N} avenues' CTA is the SERVER previewCellCount (T-87-05-03) — axis selections shape WHAT is forked; the server resolves HOW MANY cells"
  - "est tokens/cost is a labelled PLANNING hint (Est. …), never billed — the authoritative count stays server-side, real spend is measured post-run"
  - "Knowledge injection surfaced as a prominent kb-on/kb-off on/off toggle, encoded into the runner's existing env axis (Plan 87-02) — no 5th cell key"
  - "buildForkPrefill lives in the slice (importable + testable) and is re-used by runs-table — mirrors the buildRerunPrefill idiom"
metrics:
  duration: ~35m
  completed: 2026-07-11
---

# Phase 87 Plan 05: Fork Trigger + 4-Axis Variant Picker + Sweep Guardrail Summary

Delivered the dashboard "Fork into avenues" flow (AVN-02) and the curated-default four-axis variant picker with a mandatory server-resolved sweep guardrail (AVN-03), all as a thin wrapper over the existing `launchExperiment → vkb-server → coordinator` bridge (D-01, no new API path). A completed span forks into the launcher's four-axis picker, the guardrail previews a SERVER-resolved avenue count + est tokens/cost BEFORE launch (launch disabled until it renders), and the launch reuses `launchExperiment` carrying the `origin_span_id` link so avenue Runs group by origin (Plan 87-03).

## What was built

### Task 1 — Fork prefill wiring + Fork button (AVN-02) — `d78f6c876`
- **`performanceSlice.ts`**: `LauncherPrefill` EXTENDED (not forked — Phase 86 frozen-contract discipline) with `origin_span_id`, a new `ForkAxes` interface (`agents` / `models` / `frameworks` / `kbOn` / `kbOff`), and a `sweep` flag. Added exported `buildForkPrefill(run)` — the fork analogue of `buildRerunPrefill`, seeding the picker curated-by-default from the origin span (its own agent/model pre-selected, framework or `none`, knowledge-injection ON, sweep OFF) and carrying `origin_span_id = run.task_id`. `launchExperiment` thunk + run body extended with a top-level `origin_span_id` (null-preserved, mirroring the WR-01 `rerun_of` idiom).
- **`runs-table.tsx`**: "Fork into avenues" `Button variant="ghost" size="sm"` (lucide `GitBranch`), gated by the SAME `isCompletedExperimentRun(run)` guard as Re-run, dispatching `setLauncherPrefill(buildForkPrefill(run))` and scrolling the launcher into view. No new slice created; launch reuses `launchExperiment` (thin wrapper).

### Task 2 — 4-axis picker + sweep + mandatory guardrail (AVN-03) — `6df3ece1d`
- **`experiment-launcher.tsx`**: in fork mode (`origin_span_id` present) renders four labelled `Checkbox` groups — **Agent** (`claude`/`copilot`/`opencode`/`mastracode`), **Model** (`opus`/`sonnet`/`gpt-5`/`haiku`), **SDD framework** (`gsd`/`spec-workflow`/`none`) with the mandatory "…not a code framework" disambiguation caption, and **Knowledge injection** as a PROMINENT kb-on/kb-off on/off toggle (encodes the runner's env axis, Plan 87-02). A **Sweep** toggle ("Sweep (cross-product of chosen axes)") expands the chosen axes.
- **Guardrail** (fork focal point): a `bg-muted/40` box showing `{V} variants × {R} repeats = {N} avenues` (font-mono), an `Est. {tokens} tokens · ~{cost}` line, and an over-threshold `text-status-warning` caution. The count is the SERVER-resolved `previewCellCount` (`avenueCount`) — D-09, never a client axes recompute. Launch DISABLED until the preview renders; CTA relabelled `Launch {N} avenues`. The existing `matrix-cell-count` spec preview is unchanged (still SERVER cellCount). Tokens/typography per UI-SPEC (font-mono numerics, `text-status-warning` token, no raw hex; `--primary` reserved for the launch CTA + prefill ring).

### Task 3 — e2e spec + config (deferred live verify) — `cc4f74eff`
- **`tests/e2e/performance/performance.spec.ts`** (new): 6 tests — collection witness + (a) Fork button only on completed rows, (b) launcher ring highlight + four axes on fork, (c) "not a code framework" caption, (d) server-resolved guardrail count/cost + "Launch {N} avenues" CTA + disabled-until-preview, (e) dismissible launch-error. Data-presence skip guards (86-05 idiom) when no completed experiment span exists.
- **`playwright.config.ts`** (new, dashboard subtree): `testDir ./tests/e2e`, `baseURL http://localhost:3032`, single chromium project.

## Verification

- `cd integrations/system-health-dashboard && npm run build` — **clean** (tsc typecheck + vite bundle, 2845 modules transformed) after each task. `npx tsc --noEmit` shows NO type errors in the three modified files.
- `npx playwright test performance.spec.ts` — **green**: 1 passed (collection witness), 5 skipped cleanly via the data-presence guards. The live dashboard on :3032 is bind-mounted from the MAIN tree (worktree changes not yet present), so the fork-specific flows correctly skip on the current dataset — exactly the documented behavior.
- All Task-1/2/3 acceptance greps matched: `Fork into avenues`, `buildForkPrefill` (both files), `origin_span_id` (slice), `createSlice` unchanged (no new slice), `SDD framework`/`Knowledge injection`/`Sweep` labels, `not a code framework`, `Launch {N} avenues` CTA referencing `avenueCount`, `matrix-cell-count` still `previewCellCount`, no client cross-product multiply, no new raw hex.

## Deferrals

**Live visual verification (gsd-browser, both themes) + the mandatory dashboard rebuild+restart are DEFERRED to the orchestrator's post-merge verification.** Rationale (per the parent-agent execution note): the dashboard is bind-mounted into `coding-services` from the MAIN host tree, so a live Playwright/gsd-browser run inside this worktree reflects main-tree code, not these worktree changes — it cannot exercise the new fork surface. The worktree gate is therefore `npm run build` (typecheck + bundle) + `npx playwright test --list`/live-with-skips, both green here. The orchestrator rebuilds the real dashboard (`npm run build` + `supervisorctl restart web-services:health-dashboard-frontend`) and performs the gsd-browser light/dark visual verify of the fork picker + guardrail after merge.

## Build-environment fixes (Rule 3 — blocking, out-of-scope to rebuild)

The worktree lacked the dashboard's `node_modules` and the sibling `mcp-server-semantic-analysis/dist` (both live on the MAIN tree; worktrees don't inherit submodule build artefacts). To run the typecheck/build gate I symlinked both from the main tree (`node_modules` → main dashboard node_modules; `mcp-server-semantic-analysis/dist` → main sibling dist). Both targets are gitignored / inside a submodule, so neither is tracked or committed by this plan. No package-manager install was performed (no registry fetch — reused already-vetted main-tree deps).

## Deviations from Plan

None material. The plan executed as written. The est-tokens/cost figure is an explicit design choice (a labelled `Est.` planning hint derived from the SERVER count, never billed) — the authoritative avenue count stays server-side (D-09), satisfying the "count/cost preview before launch" guardrail (D-02) without introducing a client-side cost authority.

## Known Stubs

None. The fork picker wires real axis state, the guardrail reads the real server `previewCellCount`, and launch reuses the real `launchExperiment` bridge threading `origin_span_id`. The `Est.` tokens/cost line is honestly labelled as a planning estimate (not a fabricated authoritative value).
