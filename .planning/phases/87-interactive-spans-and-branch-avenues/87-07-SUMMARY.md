---
phase: 87-interactive-spans-and-branch-avenues
plan: 07
subsystem: experiments / branch-avenues
tags: [avenue, fork, origin_span_id, threading, CR-01, CR-02, CR-03, AVN-01, AVN-02, AVN-03, AVN-07]
requires:
  - "87-03 avenue primitives (runCell avenue mode, synthesizeAvenueSpec, run-write origin_span_id, measurement-start --origin-span-id)"
  - "87-05 launcher axis picker + guardrail"
  - "87-06 selectAvenuesByOrigin / rankAvenues grouping"
provides:
  - "runMatrix→runCell avenue/originSpanId/commitAvenue passthrough (the only production caller now reaches runCell's avenue seam)"
  - "experiment-run.mjs --avenue / --origin-span-id CLI flags"
  - "run-launch buildRunArgv --origin-span-id / --avenue emission"
  - "handleExperimentRun server fork synthesis (origin_span_id + forkAxes → avenue spec → coordinator)"
  - "POST /api/experiments/fork-preview (axes-aware server-resolved count)"
  - "client launchExperiment forkAxes/sweep payload + previewForkCount thunk + honest launcher preview"
affects:
  - "AVN-01 (Run carries origin_span_id via the real launch path)"
  - "AVN-02 (dashboard Fork actually forks, not a plain rerun)"
  - "AVN-03 (axis picker + preview honest, not decorative)"
  - "AVN-07 (origin-grouped ranked panel gets real data)"
tech-stack:
  added: []
  patterns:
    - "shared _mapForkAxesToVariants used by BOTH launch + preview so counts never diverge"
    - "server-authoritative count (D-09): preview endpoint synthesizes-and-counts; client never cross-products the launch gate"
    - "transient experiment-store read for origin resolution (runs-table idiom; never the live LevelDB — Pitfall 6)"
key-files:
  created:
    - "tests/experiments/avenue-fork-thread.test.mjs"
  modified:
    - "lib/experiments/experiment-runner.mjs"
    - "scripts/experiment-run.mjs"
    - "lib/experiments/run-launch.mjs"
    - "lib/vkb-server/api-routes.js"
    - "scripts/health-coordinator.js"
    - "integrations/system-health-dashboard/src/store/slices/performanceSlice.ts"
    - "integrations/system-health-dashboard/src/components/performance/experiment-launcher.tsx"
    - "tests/experiments/experiment-runner.test.mjs"
    - "tests/experiments/run-launch.test.mjs"
    - "tests/experiments/run-endpoint.test.mjs"
decisions:
  - "commitAvenue forwarded as undefined when not injected so runCell keeps its own commitAvenueWorktree default (byte-identical non-avenue path)"
  - "origin_span_id validated as a bounded printable string (≤256, no path-navigation) rather than the run_id charset — a span id is a composeTaskId slug that may embed a sanitized slash"
  - "fork-preview is NEW required work (no pre-existing preview/dry-run endpoint existed) — synthesize-and-count without persist/coordinator/launch"
  - "dashboard typecheck gate run against the main-repo build artifacts (worktree lacks node_modules + sibling submodule dist) — symlinked, not committed"
metrics:
  duration: "~1 session (resumed once after a mid-execution session limit)"
  tasks_completed: 4
  files_changed: 11
  tests_added: "run-launch (+5), experiment-runner (+2), run-endpoint (+6), avenue-fork-thread (+4)"
  completed: 2026-07-11
---

# Phase 87 Plan 07: Fork-Launch Thread Closure (CR-01/CR-02/CR-03) Summary

Threaded `origin_span_id` + fork axes end-to-end (runner → CLI → run-launch argv → vkb-server → coordinator → client payload + axes-aware preview) so a real dashboard "Fork into avenues" launch reaches the runner as an AVENUE matrix carrying a non-null `origin_span_id` — re-lighting AVN-01/02/03/07 whose primitives were already built but never reached by the real launch path.

## What shipped

- **CR-01 (Task 1):** `runMatrix` now destructures `avenue`/`originSpanId`/`commitAvenue` from its opts and forwards all three into the `runCell({...})` call (the only production caller — so runCell's already-correct avenue seam is finally reachable). `experiment-run.mjs` parses `--avenue` (presence) + `--origin-span-id <id>` into the runMatrix opts and documents both in usage. `run-launch` `buildRunArgv` emits `--origin-span-id <id>` (valueFlags) and `--avenue` (boolean-flag push) from the forwarded overrides. Non-avenue path is byte-identical.
- **CR-02 (Task 2):** `handleExperimentRun` reads `origin_span_id` + `forkAxes` from the body; validates the id shape (400) and resolves the origin Run via the runs-table transient store read (404 if unresolved, never the live LevelDB — Pitfall 6); maps forkAxes→variants via the shared `_mapForkAxesToVariants` (seeds omitted axes from the origin Run); calls `synthesizeAvenueSpec` + `synthesizeToYamlFile` to persist `avenue-<origin>.yaml` (which then passes the unchanged V5 listing gate); folds `origin_span_id` + `avenue:true` into the forwarded overrides and forwards the synthesized basename to the coordinator. The coordinator forwards overrides WHOLE (confirmed — no key filter; doc comment only).
- **CR-02/CR-03 (Task 3):** New `POST /api/experiments/fork-preview` synthesizes-and-counts the avenue matrix (variants × repeats) WITHOUT persisting/launching/touching the coordinator, reusing the SAME `_resolveOriginRun` + `_mapForkAxesToVariants` so preview and launch counts can never diverge. `performanceSlice` gains a `previewForkCount` thunk and `launchExperiment` now carries `forkAxes`/`sweep` in the POST body. `experiment-launcher` dispatches the server preview when forkAxes/sweep/repeats change; in fork mode `previewCellCount` is sourced from the server round-trip (never the origin spec's static YAML metadata); the launch button stays disabled until the preview resolves; `forkAxes`/`sweep` now actually reach the launch dispatch (the picker is no longer decorative).
- **AVN-01/07 flip (Task 4):** `tests/experiments/avenue-fork-thread.test.mjs` drives the REAL `runMatrix`/`runCell` to the measurement-start `--origin-span-id` boundary, then threads that captured argv through the REAL `buildVariantMeta` → `buildRunTags` → `writeRun` → `readRuns` round-trip, proving a fork Run carries a non-null `origin_span_id` (and a non-avenue Run reads null) — the exact predicate `selectAvenuesByOrigin` groups on.

## Verification

| Gate | Result |
|------|--------|
| `node --test tests/experiments/experiment-runner.test.mjs tests/experiments/run-launch.test.mjs` | PASS (44) |
| `node --test tests/experiments/run-endpoint.test.mjs` (handleExperimentRun + fork + preview) | PASS (22) |
| `node --test $(grep -rl handleExperimentRun\|experiments/run tests)` | PASS (129) |
| `cd integrations/system-health-dashboard && npm run build` (tsc + vite) | PASS (clean) |
| `node --test tests/experiments/avenue-fork-thread.test.mjs` | PASS (4) |
| `node --test tests/experiments/*.test.mjs` (full experiments suite) | PASS (398 pass, 2 pre-existing skips, 0 fail) |
| `git diff …HEAD --stat package.json …/package.json` (no installs, T-87-07-SC) | EMPTY |

Self-check across touched test files (run-launch, experiment-runner, run-endpoint, avenue-fork-thread): 70/70 pass.

## Deviations from Plan

### Auto-fixed / environment

**1. [Rule 3 - Blocking] Dashboard typecheck gate could not resolve deps in the worktree**
- **Found during:** Task 3 (`npm run build`).
- **Issue:** The worktree is a partial checkout — `integrations/system-health-dashboard/node_modules` was absent (`vite: command not found`, `Cannot find module '@reduxjs/toolkit'`) and the sibling `integrations/mcp-server-semantic-analysis/dist/agents/process-tags.js` (a cross-submodule build artifact imported by an unrelated page) was missing. Both are worktree-isolation artifacts, NOT defects in the changed files.
- **Fix:** Symlinked the main repo's already-built `node_modules` and the sibling submodule's `dist/` into the worktree so the real `tsc + vite build` gate could run. Both symlinks are gitignored and were NOT committed.
- **Outcome:** Build passed cleanly (2847 modules transformed) with the two changed TS files typechecking green. No source change was needed.

### Note on the full-suite acceptance command

The plan's `node --test tests/experiments/` (bare directory arg) errors on node v25 as "Cannot find module …/tests/experiments" — a directory-arg quirk, not a test failure. Ran the equivalent `node --test tests/experiments/*.test.mjs` glob instead: 398 pass / 2 skip / 0 fail.

## Known Stubs

None. The fork path is wired end-to-end; the preview endpoint returns a real server-computed count; the client sends the chosen axes. No hardcoded empty/placeholder data introduced.

## Threat Flags

None beyond the plan's threat register. All `mitigate` dispositions were implemented:
- T-87-07-01 (spec-injection): avenue basename derived via `sanitizeTaskId` (avenue-spec) and still gated by the unchanged V5 listing gate.
- T-87-07-02 (spoofing): `_validOriginSpanId` shape check (400) + origin-Run resolution (404) before any forward — proven by the run-endpoint fork tests.
- T-87-07-03 (count spoof): launch-gating count stays server-resolved; `grep -cE '\.length \* .*\.length'` on the launcher = 0 new client cross-product.
- T-87-07-05 (Pitfall 6): origin resolution uses the transient runs-table store read, never the live experiment LevelDB.
- T-87-07-SC: zero installs (dependency diff empty).

## Self-Check: PASSED

- Created file present: `tests/experiments/avenue-fork-thread.test.mjs`
- Commits present: `19d792114` (CR-01), `0751514cd` (CR-02), `1d5b51e9c` (CR-02/CR-03 client), `19fd97e62` (Task 4 test)
- Touched-test self-check: 70/70 pass.
