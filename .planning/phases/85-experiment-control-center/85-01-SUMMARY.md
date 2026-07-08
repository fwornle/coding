---
phase: 85-experiment-control-center
plan: 01
subsystem: experiments
tags: [experiment-runner, progress-emitter, run-metadata, variant-override, cli]
requires:
  - lib/experiments/experiment-runner.mjs (runMatrix/runCell/cellName/composeTaskId — Phase 78-03)
  - lib/experiments/run-write.mjs (writeRun null-preserved metadata block — Phase 71/78-01)
  - scripts/measurement-start.mjs (buildVariantMeta span.meta plumbing — Phase 77-02)
  - scripts/measurement-stop.mjs (buildRunTags span.meta fold — Phase 78-01)
provides:
  - lib/experiments/run-progress.mjs (writeProgress/readProgress — atomic never-throw progress.json)
  - experiment-runner variantOverrides/applyVariantOverride/deriveVariantName + progress emitter hooks
  - run-write rerun_of/base_variant null-preserved Run.metadata tags
  - experiment-run.mjs --run-id/--run-dir/--rerun-of + per-variant --model/--agent override map + progress init
  - measurement-start.mjs --capture-raw-bodies (D-12) + --base-variant (D-07) + --rerun-of (D-05) span.meta
affects:
  - Plan 04 (API handleRunStatus reads progress.json; launcher submits variantOverrides)
  - Plan 05 (UI run-monitor polls progress.json; re-run button submits rerun_of + overrides)
tech-stack:
  added: []
  patterns:
    - "atomic tmp+rename file write (Pitfall 3 — 5s poller never reads a torn file)"
    - "never-throw best-effort emitter (Phase-84 D-02 never-block lineage)"
    - "null-preserved metadata (?? null, never ?? 0 / '')"
    - "no-op guard on optional runDir (zero behavior change for existing callers)"
    - "fixed-argv no-shell exec (T-78-03-01)"
key-files:
  created:
    - lib/experiments/run-progress.mjs
    - tests/experiments/run-progress.test.mjs
    - tests/experiments/variant-override.test.mjs
  modified:
    - lib/experiments/experiment-runner.mjs
    - lib/experiments/run-write.mjs
    - scripts/experiment-run.mjs
    - scripts/measurement-start.mjs
    - scripts/measurement-stop.mjs
    - tests/experiments/run-write.test.mjs
    - tests/experiments/measurement-start-variant.test.mjs
    - tests/experiments/measurement-stop-tags.test.mjs
decisions:
  - "run_id salts the composeTaskId PREFIX (expId), never the cellName slug — task_hash stays constant for comparability (D-05)"
  - "runCell composes task_id off an explicit origCell param so the override mutates the launch cell + recorded name but NEVER task_hash"
  - "deriveVariantName uses STABLE agent-then-model @-join ordering for deterministic recorded names"
  - "measurement-start gained --rerun-of (folds to span.meta.rerun_of) so buildRunTags surfaces it symmetric with base_variant"
metrics:
  duration: ~35m
  completed: 2026-07-08
  tasks: 4
  commits: 7
  files_created: 3
  files_modified: 8
---

# Phase 85 Plan 01: Experiment Control Center Backend Foundation Summary

Atomic never-throw `progress.json` emitter (D-03/D-04), `rerun_of`/`base_variant` null-preserved Run metadata (D-05/D-07), per-variant model/agent override APPLICATION with derived `@`-suffixed variant naming (D-06/D-07), and new CLI flags carrying run identity, the `variantOverrides` map, and the D-12 `capture_raw_bodies` passthrough — the source-of-truth backend the API (Plan 04) and UI (Plan 05) only read/trigger.

## What Was Built

**Task 1 — atomic progress emitter (`run-progress.mjs` NEW + runMatrix hooks).**
`writeProgress(runDir, patch)` merges into `progress.json` via write-to-`.tmp` + `fs.rename` (atomic on same FS — a 5s poller never reads a torn file); header keys shallow-merge, `cells` patches UPSERT by `{variant, rep}` composite key (per-cell shallow-merge, never clobbers the array). `readProgress` returns `null` on ENOENT/corrupt. Both never-throw (stderr-only diagnostics). `experiment-runner.mjs` gained a module-local `emitProgress(runDir, patch)` with a `if (!runDir) return;` no-op guard, threaded `runDir` through `runMatrix`→`runCell`, and emits `restoring`/`running`/`scoring`/terminal cell states + the run-level `done`/`total`/`overall` header. When `runDir` is absent (every existing caller + the integration test), zero progress writes — byte-identical behavior.

**Task 2 — `rerun_of`/`base_variant` Run metadata (D-05/D-07).**
Added the two keys to `writeRun`'s metadata block (`t.rerun_of ?? null`, `t.base_variant ?? null`) following the null-not-zero house rule exactly (no `?? ''`). `measurement-stop.mjs` `buildRunTags` folds both from `span.meta` symmetric with `variant`/`repeat`. `readRuns` surfaces them via its existing `...meta` spread (no query.mjs change). `task_hash` untouched.

**Task 3 — CLI flags (`experiment-run.mjs` + `measurement-start.mjs`).**
`experiment-run.mjs`: `--run-id` (charset `[A-Za-z0-9._-]`, length ≤12 guard — T-85-01-01 / Pitfall 1), `--run-dir`, `--rerun-of`, and repeatable per-variant `--model <variant>=<model>` / `--agent <variant>=<agent>` parsed into a `variantOverrides` map keyed by the ORIGINAL variant name. Initializes `progress.json` as a `pending` grid (header + one cell per variant×repeat) before the loop when `--run-dir` is set, and threads `runDir`/`runId`/`rerunOf`/`variantOverrides` into `runMatrix` opts. `measurement-start.mjs`: `--capture-raw-bodies` (presence flag → `span.meta.capture_raw_bodies = true`, D-12 default OFF) and `--base-variant` (string → `span.meta.base_variant`, D-07, shell-metacharacter-guarded).

**Task 4 — override application + derived naming (`experiment-runner.mjs`).**
`deriveVariantName(cell, override)` (`@`-joined, stable agent-then-model ordering) and `applyVariantOverride(cell, variantOverrides)` (returns `{ effectiveCell, derivedVariant, baseVariant }`, keyed by original `cellName`). `runMatrix` resolves the override per cell and passes the effective (mutated model/agent) cell + derived name + original base-variant + `rerunOf` into `runCell`; `runCell` composes `task_id` off an explicit `origCell` so `task_hash` stays constant (D-05), builds `startArgv` with `--variant <derived>` + conditional `--base-variant`/`--rerun-of`, and launches the mutated `--model`/`--agent`. Empty override map ⇒ `effectiveCell===cell`, `baseVariant=null`, no `--base-variant` (byte-identical). `run_id` salts the `expId` prefix so re-runs get distinct `task_id`s with an invariant `task_hash`. `measurement-start.mjs` gained `--rerun-of` → `span.meta.rerun_of`.

## Verification

- `node --test tests/experiments/**/*.test.mjs` → **291 pass, 0 fail, 2 skipped** (the 2 skips are `EXPERIMENTS_LIVE`-gated, untouched).
- `experiment-runner.integration.test.mjs` untouched-green (no-runDir + empty-override no-op proven).
- No `console.*` in any of the 6 modified source files; no `shell:true` in the touched scripts.
- Fake-seam CLI smoke (`EXPERIMENT_RUN_FAKE=1 … --run-dir --run-id --rerun-of --model V=M`) initializes and completes `progress.json` (run_id threaded, 8 cells, overall → complete).

## Deviations from Plan

**1. [Rule 2 — missing critical functionality] Added `--rerun-of` to `measurement-start.mjs`.**
- **Found during:** Task 4.
- **Issue:** The plan's Task 3 added `--base-variant` to `measurement-start.mjs` but not `--rerun-of`, yet `buildRunTags` (Task 2) folds `rerun_of` from `span.meta`, and Task 4's end-to-end contract requires the re-run's `rerun_of` to reach the measured span. Without a `--rerun-of` flag on `measurement-start`, `runCell` had no channel to write `span.meta.rerun_of`.
- **Fix:** Added `--rerun-of` (string → `span.meta.rerun_of`) to `measurement-start.mjs` conditional-spread, and `runCell` now emits `--rerun-of <rerunOf>` into `startArgv` when set. Symmetric with `--base-variant`.
- **Files modified:** scripts/measurement-start.mjs (Task 3 + Task 4 commits), lib/experiments/experiment-runner.mjs.
- **Commit:** fbda64369.

**2. [Rule 3 — blocking design detail] Added an explicit `origCell` param to `runCell`.**
- **Found during:** Task 4.
- **Issue:** `runCell` composed `task_id` off `cellName(cell)`. Once the loop passes the MUTATED `effectiveCell` as `cell`, `composeTaskId` would key off the mutated agent/model and change `task_hash` — violating D-05 comparability.
- **Fix:** `runCell` accepts `origCell`; `composeTaskId(expId, origCell ?? cell, rep)` keys off the ORIGINAL cell. Non-override callers omit `origCell` and fall back to `cell` (unchanged). The task `composeTaskId: overridden task_id === no-override task_id` proves invariance.
- **Files modified:** lib/experiments/experiment-runner.mjs.
- **Commit:** fbda64369.

## Known Stubs

None. Every symbol this plan provides is wired and tested. The `variantOverrides` map is fully APPLIED (not a passthrough stub) — Task 4 mutates the effective cell and records the derived name.

## Threat Flags

None. All new surface is covered by the plan's `<threat_model>`: `--run-id` charset+length guard (T-85-01-01), `--base-variant` shell-metacharacter guard (T-85-01-02), override values feed fixed-argv only (T-85-01-04), `capture_raw_bodies` default-OFF opt-in (T-85-01-03). No installs (T-85-01-SC N/A).

## Self-Check: PASSED

- Created files exist: `lib/experiments/run-progress.mjs`, `tests/experiments/run-progress.test.mjs`, `tests/experiments/variant-override.test.mjs` — all FOUND.
- Commits exist: 5315cc251, ff71cf826, b81dd74ae, 88222b87b, f3b9e75b7, 87988aa3b, fbda64369 — all in `git log`.
