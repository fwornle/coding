---
phase: 87-interactive-spans-and-branch-avenues
reviewed: 2026-07-11T00:00:00Z
depth: standard
files_reviewed: 29
files_reviewed_list:
  - integrations/system-health-dashboard/playwright.config.ts
  - integrations/system-health-dashboard/src/components/performance/avenue-panel.tsx
  - integrations/system-health-dashboard/src/components/performance/experiment-launcher.tsx
  - integrations/system-health-dashboard/src/components/performance/merge-status-badge.tsx
  - integrations/system-health-dashboard/src/components/performance/runs-table.tsx
  - integrations/system-health-dashboard/src/pages/performance.tsx
  - integrations/system-health-dashboard/src/store/slices/performanceSlice.ts
  - integrations/system-health-dashboard/tests/e2e/performance/performance-compare.spec.ts
  - integrations/system-health-dashboard/tests/e2e/performance/performance.spec.ts
  - lib/experiments/avenue-branch.mjs
  - lib/experiments/avenue-spec.mjs
  - lib/experiments/experiment-restore.mjs
  - lib/experiments/experiment-runner.mjs
  - lib/experiments/experiment-spec.mjs
  - lib/experiments/run-write.mjs
  - lib/repro/restore-snapshot.mjs
  - lib/vkb-server/api-routes.js
  - scripts/health-coordinator.js
  - scripts/launch-agent-common.sh
  - scripts/measurement-start.mjs
  - scripts/measurement-stop.mjs
  - src/hooks/knowledge-injection-hook.js
  - tests/experiments/avenue-branch.test.mjs
  - tests/experiments/avenue-crossbranch.test.mjs
  - tests/experiments/avenue-merge.test.mjs
  - tests/experiments/avenue-spec.test.mjs
  - tests/experiments/experiment-restore.test.mjs
  - tests/experiments/experiment-spec.test.mjs
  - tests/experiments/injection-env.test.mjs
findings:
  critical: 3
  warning: 6
  info: 4
  total: 13
status: issues_found
---

# Phase 87: Code Review Report

**Reviewed:** 2026-07-11
**Depth:** standard
**Files Reviewed:** 29
**Status:** issues_found

## Summary

The security-sensitive git layer of this phase is genuinely solid. `avenue-branch.mjs`
uses fixed-argv `spawnSync` throughout, derives every branch ref once via `sanitizeTaskId`,
computes merge status read-only via `git merge-tree --write-tree` (proven not to mutate main
by `avenue-merge.test.mjs`), and gates `promoteAvenue` behind a re-checked conflict probe.
The coordinator endpoints are origin-gated and re-validate `task_id`; the vkb-server container
proxy runs no git and forwards verbatim (Pitfall 6 respected). The `CODING_KNOWLEDGE_INJECTION`
guard is correctly process-scoped in both the Claude hook and the bash injector, and is proven
by `injection-env.test.mjs`.

However, the **end-to-end wiring of the phase's headline feature — forking a span into avenues —
is broken**. Three independent breaks in the launch path mean that clicking "Fork into avenues",
picking agents/models, and launching does NOT produce differentiated avenue Runs, does NOT stamp
`origin_span_id` (so the avenue panel that groups by `origin_span_id` will never populate from a
real fork), and the runner's avenue branch-commit / avenue-mode restore is dead code that no
production caller ever activates. The unit tests exercise the primitives in isolation and pass,
but nothing tests the integration seam where the wiring is severed, and the e2e specs are
data-gated to skip. These are BLOCKER-class because the feature does not function.

## Critical Issues

### CR-01: `runMatrix` never threads `avenue` / `originSpanId` / `commitAvenue` into `runCell` — avenue mode is dead code

**File:** `lib/experiments/experiment-runner.mjs:675-786`
**Issue:** `runCell` accepts `avenue`, `originSpanId`, and `commitAvenue` params (lines 461-491)
and gates ALL avenue behavior on them: avenue-mode restore onto the named `avenue/<task_id>`
branch (lines 505-510), the `--origin-span-id` measurement arg (line 533), and the
commit-on-close onto the avenue branch (lines 592-598). But `runMatrix` — the only production
entry point that calls `runCell` — neither destructures these from `opts` (lines 676-685) nor
passes them in the `runCell({...})` call (lines 769-774). Consequently:

- No avenue Run is ever restored onto a named branch (always detached), so
  `commitAvenueWorktree` has no branch to commit to.
- `origin_span_id` is never stamped on any Run via the runner path, so
  `selectAvenuesByOrigin` (which filters to Runs carrying `origin_span_id`) always yields
  an empty avenue panel from a real fork.
- The entire Plan-01/03 avenue lifecycle is unreachable in production.

No caller in `scripts/experiment-run.mjs`, `lib/experiments/run-launch.mjs`, or
`lib/experiments/experiment-executor.mjs` sets `avenue`/`originSpanId` either (verified by grep),
so even fixing the pass-through inside `runMatrix` requires the executor chain to plumb these
options. The unit tests (`experiment-restore.test.mjs` AVN-05) verify `restoreForCell` threads
`avenueMode` when *asked*, but nothing asks.

**Fix:**
```js
// runMatrix opts destructure — add:
const {
  // ...existing...
  avenue = false, originSpanId, commitAvenue,
} = opts;

// in the runCell({...}) call at ~line 769:
const res = await runCell({
  cell: effectiveCell, origCell: cell, variantName: derivedVariant, baseVariant, rerunOf,
  rep, expId, goal, snapshotId, taskClass, timeoutMs, agentsDir,
  repoRoot, dataDir, ontologyDir, port, runDir, captureRawBodies,
  avenue, originSpanId, commitAvenue,           // <-- thread avenue wiring
  restore, spawnAgent, runMeasurement, configureRouting,
});
```
Then plumb `avenue`/`originSpanId` from the executor → `runMatrix` opts (see CR-02), and add
an integration test that drives `runMatrix` with `avenue:true` and asserts `runCell` received it.

### CR-02: `handleExperimentRun` drops `origin_span_id` and never forwards fork axes — the fork launches the origin spec unchanged

**File:** `lib/vkb-server/api-routes.js:952-1097` (esp. 957, 1073-1075)
**Issue:** The frontend `launchExperiment` thunk POSTs a body containing `origin_span_id`
(performanceSlice.ts:980-985), and the launcher captures `forkAxes` (agents/models/frameworks/
kbOn/kbOff) and `sweep` in component state. But:

1. `handleExperimentRun` destructures only `{ spec, overrides, rerun_of }` (line 957) —
   `origin_span_id` is silently ignored and never forwarded to the coordinator seam
   (lines 1073-1075 forward only `spec, run_id, run_dir, overrides`). The runner therefore
   never receives `--origin-span-id`, so `run-write.mjs` persists `origin_span_id: null`
   (run-write.mjs:139) for every avenue.
2. `forkAxes` and `sweep` are NOT part of the POST body at all (performanceSlice.ts:980-985
   sends only `spec/overrides/rerun_of/origin_span_id`), and `buildOverrides()` in the
   launcher (experiment-launcher.tsx:206-218) never references `forkAxes`/`sweep`. There is
   also no server-side call to `synthesizeAvenueSpec` (grep: zero references outside the
   module + its own test). The chosen agent/model/framework/kb axes are therefore discarded;
   a "fork" just re-runs the selected spec's own matrix.

Net effect: the four-axis picker is decorative. Selecting `opencode`/`gpt-5` produces the
same cells as the origin spec, with no origin link.

**Fix:** Read `origin_span_id` in `handleExperimentRun`, validate it (`_validTaskId`), forward
it to the coordinator, and have the coordinator/runner thread it to `runCell` (CR-01). Wire the
fork axes into the launch: either POST `axes`/`sweep` and synthesize the avenue spec server-side
via `synthesizeAvenueSpec` (its documented purpose), or translate the axes into an `overrides`
payload (variant subset + variantOverrides + env kb-on/kb-off) before POSTing. Add an
integration test asserting the coordinator receives `origin_span_id` and the axis-derived cells.

### CR-03: `launchExperiment` sends `origin_span_id` but the server never persists it — avenue grouping is unreachable

**File:** `integrations/system-health-dashboard/src/store/slices/performanceSlice.ts:964-994`
combined with `lib/vkb-server/api-routes.js:957`
**Issue:** This is the client half of the same broken contract as CR-02, called out separately
because it is a distinct fix site and a distinct correctness claim. The slice comment
(lines 975-979) asserts "The server threads it to the runner's `--origin-span-id` (Plan 87-03)
so avenue Runs group by origin" — but the server does not. `selectAvenuesByOrigin`
(performanceSlice.ts:1881-1896) and the entire `avenue-panel.tsx` render pipeline depend on
Runs carrying `origin_span_id`; because none ever will (via the real launch path), the avenue
panel's populated state is unreachable and every e2e assertion of it is data-gated to skip
(`performance-compare.spec.ts:68-69`). The feature's primary screen cannot be reached from its
primary entry point.

**Fix:** Close the server contract in CR-02. No client change is needed once the server forwards
and persists `origin_span_id`, but a test that launches a fork and then asserts a Run appears in
`selectAvenuesByOrigin` should be added so this contract can never silently break again.

## Warnings

### WR-01: Promote button is enabled for `merged` / `unknown` / null-status avenues

**File:** `integrations/system-health-dashboard/src/components/performance/avenue-panel.tsx:127-148`
**Issue:** `AvenueRowActions` only suppresses the Promote button when `status?.state === 'conflicts'`
(`hasConflicts`). For a branch that is already `merged`, that is `unknown` (absent/pruned →
`status === null`, no badge), or whose status has not yet loaded, the "Promote to main" button is
fully enabled. Promoting an already-merged branch is a no-op-ish `--no-ff` (harmless but confusing),
but promoting an `unknown`/absent branch calls the server which returns `{promoted:false,
reason:'unknown'}` — surfaced NOWHERE in the UI (the panel only renders `conflictRefused`, not
`reason:'unknown'`/`'merge-failed'`), so the operator clicks "Promote", nothing visibly happens,
and no error appears. This is a silent-failure UX gap contradicting the phase's stated honesty
principle.

**Fix:** Disable Promote unless `status?.state === 'unmerged'` (the only promotable state), and
render a notice for `promoteResult.reason === 'unknown' | 'merge-failed'` the same way
`conflictRefused` is rendered.

### WR-02: `avenueMergeStatus` / `promoteAvenue` hard-code `main` — silently returns `unknown` on any repo whose default branch differs

**File:** `lib/experiments/avenue-branch.mjs:196, 246-283, 300-322`
**Issue:** `MAIN_REF = 'main'` is a hard-coded literal. `avenueMergeStatus` returns
`{state:'unknown'}` when `refExists('main')` is false (line 250), and `promoteAvenue` returns
`{promoted:false, reason:'unknown'}` (line 304). On a repo checked out on `master` (or any
non-`main` default) every avenue silently shows no badge and refuses to promote, with no
diagnostic distinguishing "branch absent" from "no main ref." The coding repo's default is `main`
so production is unaffected today, but this is a latent correctness trap and makes the primitive
non-portable / hard to test against arbitrary fixtures.

**Fix:** Resolve the default branch dynamically (`git symbolic-ref --short refs/remotes/origin/HEAD`
or accept a `mainRef` option defaulting to `'main'`), and when the main ref is genuinely absent
return a distinct sentinel/log rather than collapsing into the same `unknown` used for an absent
avenue.

### WR-03: `conflictCount` returns 1 on any non-zero `merge-tree` exit it cannot parse — a transient git error blocks promote as "conflicts"

**File:** `lib/experiments/avenue-branch.mjs:218-231`
**Issue:** `conflictCount` treats ANY non-zero exit from `git merge-tree --write-tree` as a
conflict, and when it cannot parse a stage line it falls back to returning `1` (lines 229-230).
`git merge-tree --write-tree` requires git ≥ 2.38; on an older git the subcommand fails with a
usage error (non-zero exit, no stage lines) and this code reports "1 conflict," which then
blocks `promoteAvenue` with `reason:'conflicts'` and paints a false conflicts badge. A genuinely
clean avenue is thus un-promotable on an old git, with a misleading reason. The comment
acknowledges the fallback is "conservative," but conflating "tool failed" with "has conflicts"
is a diagnosability defect, not just conservatism.

**Fix:** Distinguish a *merge conflict* (exit 1 with stage lines) from a *tool/usage failure*
(other non-zero exit or unparseable output). On the latter, surface a distinct
`reason:'merge-tree-unavailable'` (or throw with the git stderr) so the operator sees the real
cause instead of a phantom conflict; optionally probe the git version once.

### WR-04: `pruneAvenueBranch` reports `removed:true` when only the branch delete succeeds even though the worktree remove failed

**File:** `lib/experiments/avenue-branch.mjs:156-179`
**Issue:** `removed` is `removedWorktree || removedBranch` (line 178). If `git worktree remove`
fails (e.g. the worktree is locked or has processes holding it) but `git branch -D` succeeds
after the `worktree prune`, the function returns `{removed:true}` while the worktree directory
under `.data/avenues/<id>` may still be on disk. The Redux reducer then drops the cached merge
status (performanceSlice.ts:1380) and the badge disappears, telling the operator the avenue is
fully gone when a stale worktree dir remains. The OR should be an honest per-part report.

**Fix:** Return `{ removed, removedWorktree, removedBranch }` (or require BOTH for `removed:true`
and surface partial-failure), so a stale-worktree leak is visible rather than reported as a clean
prune.

### WR-05: `startMeasurement` in `writeSkipRun` runs unrouted with no span env, but `runCell` uses `spanEnv` — skip-Runs may land in the wrong data dir

**File:** `lib/experiments/experiment-runner.mjs:626-646`
**Issue:** `writeSkipRun` calls `runMeasurement('start', startArgv, {})` and
`runMeasurement('stop', stopArgv, {})` with an EMPTY options object — no `env`. `runMeasurementCli`
then falls back to `env || process.env` (line 402). For a real avenue/experiment run the parent
`runCell` deliberately builds `spanEnv` with `LLM_PROXY_DATA_DIR = mainDataDir` (lines 518-519)
so the span lands in MAIN; the skip-Run path bypasses that and inherits whatever
`LLM_PROXY_DATA_DIR` happens to be in `process.env`. If the runner is invoked with a sandbox-y
`LLM_PROXY_DATA_DIR` in its environment, the copilot skip-Run span is written to a different dir
than the cells it sits beside, making the recorded skip invisible to the dashboard reading MAIN
(the exact Pitfall-1 class the crossbranch test documents). Low likelihood in the current
executor, but it is an inconsistent contract.

**Fix:** Thread the same MAIN `spanEnv` into `writeSkipRun` (accept `dataDir`/`spanEnv` and pass
`{ env: spanEnv }` to both `runMeasurement` calls), matching `runCell`.

### WR-06: Optimistic override reducer writes `corrected_<dimension>` with no validation that the dimension is a known score key

**File:** `integrations/system-health-dashboard/src/store/slices/performanceSlice.ts:1422-1430`
**Issue:** The `saveOverride.fulfilled` reducer does `run.score[\`corrected_${dimension}\`] = value`
for every edit. `dimension` originates from `OverrideEdit` in the drawer; if a future caller
passes an unexpected dimension string, the reducer silently creates an arbitrary
`corrected_<junk>` key on the score object (the `[key: string]` index signature permits it). The
server is authoritative and re-validates, but the optimistic local write has no allow-list, so a
typo'd dimension shows an override in the table that the server never accepted, until the next
`fetchRuns` reconciles. Minor, but it is an unvalidated write into shared state.

**Fix:** Constrain `dimension` to the known rubric dimensions before the optimistic assignment
(a small `const OVERRIDABLE_DIMS = [...]` guard), skipping unknowns.

## Info

### IN-01: `MergeStatusBadge` refetches on every mount with no cache guard — many-avenue panels issue N status POSTs per render

**File:** `integrations/system-health-dashboard/src/components/performance/merge-status-badge.tsx:60-63`
**Issue:** The badge dispatches `fetchMergeStatus(taskId)` in a `useEffect` keyed only on
`taskId`, unconditionally, even when `mergeStatusByTaskId[taskId]` is already populated. Every
remount (tab switch, re-sort re-key) re-hits the coordinator for each avenue row. Functionally
correct (verbatim status), but avoidable load on a git-invoking host endpoint. Consider guarding
on `status === undefined` (not-yet-fetched) vs `null` (fetched-absent). Out of v1 perf scope but
worth noting as a correctness-adjacent redundancy.

### IN-02: `avenue-panel.tsx` empty-`avenues` branch is unreachable dead code

**File:** `integrations/system-health-dashboard/src/components/performance/avenue-panel.tsx:271-285`
**Issue:** `OriginGroupCard` renders an "Avenues are running…" empty state when
`avenues.length === 0`. But `selectAvenuesByOrigin` only creates a group when at least one Run
carries that `origin_span_id` (a group is seeded by pushing a run), so a group with zero avenues
can never be produced. The branch is dead. Harmless, but it signals the intended "forked but no
results yet" state has no data source (relatedly, CR-01/CR-03 mean groups never form at all).

### IN-03: `commitAvenueWorktree` passes both `-C <worktree>` and `cwd=worktree` — redundant

**File:** `lib/experiments/avenue-branch.mjs:126, 134, 138`
**Issue:** Calls like `git(['-C', worktree, 'status', '--porcelain'], worktree)` set the git
`-C` directory AND the spawn `cwd` to the same path. Harmless (git honors `-C`), but the
double-specification is noise and slightly obscures intent. Pick one (the fixed-argv `-C` is the
more explicit choice; `cwd` could be `repoRoot`).

### IN-04: Est.-cost constants are magic numbers with no single source of truth

**File:** `integrations/system-health-dashboard/src/components/performance/experiment-launcher.tsx:43-44`
**Issue:** `EST_TOKENS_PER_AVENUE = 120_000` and `EST_USD_PER_1K_TOKENS = 0.003` are inline
planning-estimate magic numbers. They are labelled "Est." in the UI so not a correctness issue,
but they will silently drift from reality and are duplicated conceptually with any other cost
estimator in the dashboard. Consider centralizing in a shared config with a comment on
provenance.

---

_Reviewed: 2026-07-11_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
