---
phase: 85-experiment-control-center
plan: 05
subsystem: experiment-control-center
tags: [dashboard, performance-tab, redux, experiment-launcher, run-monitor, rerun, capture-raw-bodies, variant-overrides]
requires:
  - "performanceSlice.ts measurement thunks (fetchActiveMeasurement/startMeasurement pattern)"
  - "measurement-control.tsx (Card/Input/Button + 5s-poll useEffect analog)"
  - "runs-table.tsx row-action <Button> block (e.stopPropagation + dispatch idiom)"
  - "Plan 04 vkb-server routes: /api/experiments/{specs,run,run-status/:id,run-cancel}"
provides:
  - "fetchSpecList / launchExperiment / fetchRunStatus / cancelRun thunks + selectors + reducers (performanceSlice.ts)"
  - "experiment-launcher.tsx — spec picker + server-resolved matrix preview + overrides (incl. per-variant variantOverrides) + capture_raw_bodies checkbox + re-run pre-fill (D-09/D-11/D-12)"
  - "run-monitor.tsx — 5s-poll variant×repeat cell grid + immediate Cancel (D-10/D-08)"
  - "runs-table.tsx Re-run button on completed experiment runs → setLauncherPrefill (D-11)"
affects:
  - integrations/system-health-dashboard/src/store/slices/performanceSlice.ts
  - integrations/system-health-dashboard/src/components/performance/experiment-launcher.tsx
  - integrations/system-health-dashboard/src/components/performance/run-monitor.tsx
  - integrations/system-health-dashboard/src/components/performance/runs-table.tsx
  - "Plan 06 (deploy: npm run build + supervisor restart + live visual verification + e2e reads these data-testids)"
tech-stack:
  added: []
  patterns:
    - "createAsyncThunk + rejectWithValue(data?.message) to surface a 409 holder (never a silent launch failure)"
    - "5s setInterval poll in a useEffect keyed on activeRunId (guard: no run → no poll)"
    - "Server-computed cellCount read verbatim in the matrix preview — NO client-side axes recompute (D-09)"
    - "setLauncherPrefill reducer as the cross-component re-run channel (runs-table → launcher)"
    - "Named TS interfaces (SpecSummary/ExperimentOverrides/VariantOverride/RunProgress/LauncherPrefill) — zero new `any` (CLAUDE.md TS strict)"
    - "variantOverrides keyed by ORIGINAL variant name — forwarded whole under the cross-plan field name, not renamed"
key-files:
  created:
    - integrations/system-health-dashboard/src/components/performance/experiment-launcher.tsx
    - integrations/system-health-dashboard/src/components/performance/run-monitor.tsx
  modified:
    - integrations/system-health-dashboard/src/store/slices/performanceSlice.ts
    - integrations/system-health-dashboard/src/components/performance/runs-table.tsx
decisions:
  - "The monitor keeps polling after Cancel (does not clear activeRunId) so the operator watches the wind-down; a separate Dismiss button clears it"
  - "Re-run guard = experiment provenance (variant OR base_variant) AND terminal_state==='complete', read defensively off the Run index signature (readRuns rides these fields through the `[key:string]:unknown` map)"
  - "buildRerunPrefill seeds variantOverrides[originalVariant] from canonical_model/agent (fallback model/agent) so a re-run opens pre-filled with the same actor"
  - "previewCellCount reads the server variantCount as the base and only applies the operator's repeats/subset as a display multiplier — it never derives the variant axis client-side (D-09)"
requirements: [D-09, D-10, D-11, D-12]
metrics:
  duration: ~20 min
  completed: 2026-07-08
  tasks: 3
  commits: 3
  files_created: 2
  files_modified: 2
---

# Phase 85 Plan 05: Experiment Control Center UI Summary

The operator-facing control surface on the Performance tab: a spec launcher with a pre-launch server-resolved matrix preview + override fields (repeats/timeout/variant-subset/per-variant model+agent/capture_raw_bodies), a 5s-polling variant×repeat cell-grid monitor with an immediate-acting Cancel, and a Re-run button on completed experiment runs that opens the launcher pre-filled with `rerun_of`. Every piece mirrors `measurement-control.tsx` / `performanceSlice.ts`; it launches and monitors but never edits a spec (D-09). Verified via `npx tsc --noEmit` — zero errors in any of the four touched files, zero new `any`.

## What Was Built

**Task 1 — `performanceSlice.ts` thunks + selectors + prefill reducer (`e67741470`)**
- Four `createAsyncThunk`s copying the `startMeasurement`/`fetchActiveMeasurement` shape:
  - `fetchSpecList` (GET `/api/experiments/specs` → `SpecSummary[]`).
  - `launchExperiment` (POST `/api/experiments/run` with `{ spec, overrides, rerun_of }`; a non-ok response surfaces `data?.message || data?.error` via `rejectWithValue` — the 409 holder path).
  - `fetchRunStatus` (GET `/api/experiments/run-status/${encodeURIComponent(runId)}`; normalizes `cells` to `[]`).
  - `cancelRun` (POST `/api/experiments/run-cancel` with `{ run_id, run_dir }`).
- New named interfaces (no `any`): `SpecSummary`, `VariantOverride`, `ExperimentOverrides` (carries the `variantOverrides` map), `RunProgress` + `RunProgressCell` + `RunCellState`, `LauncherPrefill`.
- New state fields (`specList`, `specListLoading`, `activeRunId`, `runStatus`, `runStatusError`, `launchError`, `launchPending`, `launcherPrefill`) + initial values.
- New reducers: `setLauncherPrefill` (D-11), `clearLauncherPrefill`, `setActiveRunId`, `clearLaunchError`.
- All four thunks registered in `extraReducers` (pending/fulfilled/rejected; `launchExperiment.fulfilled` starts monitoring by setting `activeRunId` and consuming the prefill).
- Selectors: `selectSpecList`, `selectSpecListLoading`, `selectActiveRunId`, `selectRunStatus`, `selectRunStatusError`, `selectLaunchError`, `selectLaunchPending`, `selectLauncherPrefill`.

**Task 2 — `experiment-launcher.tsx` (`b11817dc0`)**
- `<select data-testid="spec-select">` populated from `selectSpecList`; malformed specs (`error`) are listed but disabled.
- D-09 matrix preview (`data-testid="matrix-preview"` + `matrix-cell-count`): reads the server `variantCount`/`cellCount`; the operator's repeats/subset only re-multiply the DISPLAY count — the variant axis is never derived client-side.
- Override fields: `override-repeats`, `override-timeout` (`<Input type=number>`), a `variant-subset` multi-pick (Checkbox toggles keyed by resolved variant name), per-variant `variant-override-<variant>-model` / `-agent` `<Input>`s collected into `variantOverrides` (cross-plan field name), and a `capture-raw-bodies` `<Checkbox>` (default OFF — D-12).
- Launch dispatches `launchExperiment({ spec, overrides, rerun_of })`; on `rejected` renders `launchError` via `role="alert"` (`data-testid="launch-error"`) — 409 surfaced, never silent.
- D-11: a `selectLauncherPrefill` `useEffect` pre-fills the spec + `rerun_of` + all override fields (incl. seeded `variantOverrides`) then `clearLauncherPrefill()`.
- No spec/YAML authoring surface (D-09 launches-never-edits).

**Task 3 — `run-monitor.tsx` + `runs-table.tsx` Re-run (`4b34a2a92`)**
- `run-monitor.tsx` (`data-testid="run-monitor"`): a `useEffect` 5s `setInterval` poll of `fetchRunStatus(activeRunId)` (guard `if (!activeRunId) return`). Run header (`Badge` for `overall`, `done`/`total`), a `cells.map` variant×repeat grid with per-cell `Badge` state chips + `reason` text rendered as auto-escaped React content (T-85-05-03), a `cancel-run` `<Button>` acting immediately (D-08), and a `dismiss-monitor` button that clears `activeRunId`. Completed cells (`cell-<variant>-<rep>`) link into the runs table via `setSelectedTaskId`.
- `runs-table.tsx`: a `RotateCcw` "Re-run" `<Button>` (`data-testid="rerun-experiment"`) in the existing row-action `<div>`, guarded by `isCompletedExperimentRun(run)` (experiment provenance `variant`/`base_variant` AND `terminal_state==='complete'`). `onClick` `e.stopPropagation()` then `dispatch(setLauncherPrefill(buildRerunPrefill(run)))`, seeding `variantOverrides` from the run's canonical model/agent.

## Verification

- `cd integrations/system-health-dashboard && npx tsc --noEmit -p tsconfig.json` → **zero errors in any of the four touched files** (`performanceSlice.ts`, `experiment-launcher.tsx`, `run-monitor.tsx`, `runs-table.tsx`); zero new `: any`.
- Acceptance greps (all pass): four thunks + `setLauncherPrefill`/`selectLauncherPrefill` + `variantOverrides` in the overrides type + all four thunks in `.addCase`; launcher `spec-select`/`matrix-preview`/`launch-experiment`/`capture-raw-bodies` testids + `variantOverrides` + `cellCount` read + `selectLauncherPrefill`/`rerun_of` + `role="alert"`/`launchError` + no `textarea`/`yaml`; monitor `setInterval(...5000)` + `cancel-run`/`run-monitor` testids + `cells.map`; runs-table `rerun-experiment`/`RotateCcw`/`setLauncherPrefill` + a `terminal_state`/`isCompletedExperimentRun` guard.
- Cross-plan field names confirmed present unrenamed: `variantOverrides` (slice + launcher + runs-table) and `capture_raw_bodies` (slice + launcher).

## Design Decisions

- **Monitor keeps polling after Cancel.** `cancelRun.fulfilled` deliberately does NOT clear `activeRunId`, so the operator watches the terminal cell states settle on the next 5s poll; a separate `dismiss-monitor` button clears the monitor when they're done.
- **Re-run provenance guard reads the Run index signature.** `terminal_state`, `variant`, `base_variant`, `spec`, `snapshot_id`, `canonical_model/agent` all ride through `readRuns` on the `Run` `[key: string]: unknown` map (not typed top-level fields), so a defensive `runStr(run, key)` string reader gates the button — an interactive/ad-hoc measurement (no variant provenance) shows no Re-run.
- **Preview count never derives the variant axis client-side (D-09).** The server's `variantCount` is authoritative; the launcher only applies the operator's repeats override and subset length as a display multiplier over that base, so the preview stays honest to the server-resolved matrix even when overrides are typed.

## Deviations from Plan

None — the three tasks executed as written. One environment fix (not a plan deviation, Rule 3 blocking-issue): the fresh worktree had no `node_modules`/lockfile for the bind-mounted dashboard, so `tsc` could not resolve `react`. Symlinked the main checkout's `integrations/system-health-dashboard/node_modules` into the worktree (gitignored, never staged) purely to run the type-check gate. The dashboard is bind-mounted (not a submodule); the real `npm run build` + supervisor restart + live visual verification is Plan 06's job per `<upstream_context>` — no docker/build/restart was run from the worktree.

## Known Stubs

None. The `placeholder="…"` strings in the launcher are HTML `<Input>` hint attributes (repeats/timeout/model/agent override fields), not placeholder DATA — every control is wired to real Redux state and the Plan-04 endpoints. `snapshot_id` in a spec preview is `null` when the spec omits one (honest absence carried through from Plan 04's spec resolver), consumed as-is.

## Threat Flags

None. No new trust boundary beyond the plan's `<threat_model>`: the UI submits only a server-listed spec choice + typed override values (server re-validates, T-85-05-01), the 409 holder message is rendered as React text (T-85-05-02 accept), and every per-cell `reason` / holder string is rendered as auto-escaped React text content — no `dangerouslySetInnerHTML` anywhere (T-85-05-03 mitigated). No package installs (T-85-05-SC — reuses vendored shadcn + @reduxjs/toolkit).

## Self-Check: PASSED

- FOUND: integrations/system-health-dashboard/src/components/performance/experiment-launcher.tsx
- FOUND: integrations/system-health-dashboard/src/components/performance/run-monitor.tsx
- FOUND (modified): integrations/system-health-dashboard/src/store/slices/performanceSlice.ts
- FOUND (modified): integrations/system-health-dashboard/src/components/performance/runs-table.tsx
- FOUND commit: e67741470 (feat 85-05 slice thunks)
- FOUND commit: b11817dc0 (feat 85-05 launcher)
- FOUND commit: 4b34a2a92 (feat 85-05 monitor + runs-table Re-run)
