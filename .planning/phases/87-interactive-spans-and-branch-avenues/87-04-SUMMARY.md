---
phase: 87-interactive-spans-and-branch-avenues
plan: 04
subsystem: infra
tags: [git, worktree, merge-tree, health-coordinator, vkb-server, experiments, avenue-branch]

# Dependency graph
requires:
  - phase: 87-01
    provides: "lib/experiments/avenue-branch.mjs fixed-argv git helper + createAvenueBranch/commitAvenueWorktree/pruneAvenueBranch/avenueWorktreePath + sanitizeTaskId gate"
  - phase: 85-03
    provides: "health-coordinator experiment-executor host seam (isExperimentOriginAllowed V4 gate + /experiments/run delegation idiom)"
  - phase: 85-04
    provides: "vkb-server _coordinatorPost proxy helper + handleExperimentRun idiom (container→coordinator :3034)"
provides:
  - "avenueMergeStatus(taskId, repoRoot) — read-only merged/unmerged/conflicts/unknown compute (never mutates main)"
  - "promoteAvenue(taskId, repoRoot) — conflict-blocked git merge --no-ff of avenue/<id> into main (host-only)"
  - "coordinator POST /experiments/avenue-merge-status | avenue-promote | avenue-prune host endpoints behind the origin gate"
  - "vkb-server /api/experiments/avenue-* proxy routes forwarding { task_id } to the coordinator seam (no git argv in-container)"
affects: [87-06, avenue-frontend, merge-state-badge, promote-action, prune-action]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Read-only conflict detection via `git merge-tree --write-tree main <branch>` (exit 1 + stage-1/2/3 blob lines → conflicting-path count) — never a live merge for status"
    - "ahead/behind via `git rev-list --left-right --count main...avenue/<id>` (left=behind, right=ahead)"
    - "coordinator lazy-import primitive module (getAvenueBranch) mirroring getExperimentExecutor"
    - "vkb-server shared _proxyAvenue body: validate task_id → _coordinatorPost verbatim → relay status+JSON; zero git in the container layer (Pitfall 6)"

key-files:
  created:
    - "tests/experiments/avenue-merge.test.mjs"
  modified:
    - "lib/experiments/avenue-branch.mjs"
    - "scripts/health-coordinator.js"
    - "lib/vkb-server/api-routes.js"

key-decisions:
  - "Conflicts computed with `git merge-tree --write-tree` (git 2.50 on host): exit 0 = clean, exit 1 = conflicts; distinct stage-1/2/3 paths counted, with a conservative fallback of 1 on unparseable non-zero output so the caller still blocks the promote (honesty)."
  - "left-right count semantics: for `main...avenue/<id>`, left = commits reachable from main not the branch = BEHIND; right = branch-only = AHEAD."
  - "promoteAvenue re-checks conflicts read-only BEFORE any live merge; on a clean branch runs `git merge --no-ff` and `--merge --abort`s if a merge unexpectedly fails (never leaves main half-applied)."
  - "task_id re-validated at BOTH boundaries (coordinator AVENUE_TASK_ID_RE + vkb _validAvenueTaskId) before any git argv, plus the primitive's own sanitizeTaskId — defence in depth (T-87-04-05)."
  - "New coordinator endpoints reuse the existing isExperimentOriginAllowed V4 gate verbatim (localhost + Docker-private RFC1918); the vkb-server only proxies, no git argv (T-87-04-04, Pitfall 6)."

patterns-established:
  - "Pattern 1: host-only state-changing git op = fixed-argv primitive in avenue-branch.mjs → coordinator endpoint behind the origin gate → vkb-server proxy route (never git in-container)."
  - "Pattern 2: merge-status honesty — absent branch → {state:'unknown'} so the frontend renders NO badge rather than a misleading zero-state."

requirements-completed: [AVN-08, AVN-09]

# Metrics
duration: 4min
completed: 2026-07-11
---

# Phase 87 Plan 04: Avenue Merge-Status + Promote + Prune Host Seam Summary

**Read-only git merge-status compute (`merge-tree --write-tree` / `rev-list --left-right` / `branch --merged`, never mutating main) plus a conflict-blocked `promoteAvenue` and on-demand prune, all exposed host-only through coordinator endpoints and vkb-server proxy routes (AVN-08/AVN-09).**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-07-11T16:55:13+06:00
- **Completed:** 2026-07-11T16:58:34+06:00
- **Tasks:** 2 (Task 1 TDD: RED + GREEN)
- **Files modified:** 3 (+1 created)

## Accomplishments
- `avenueMergeStatus` computes merged / unmerged / conflicts / unknown from git READ-ONLY — the unit test asserts main HEAD is byte-identical before/after the status call (T-87-04-03).
- `promoteAvenue` is conflict-blocked: it re-runs the read-only conflict probe first and returns `{promoted:false, reason:'conflicts'}` without touching main; on a clean branch it merges `--no-ff` and main HEAD advances.
- Three coordinator endpoints (`/experiments/avenue-merge-status | avenue-promote | avenue-prune`) delegate to the primitives behind the reused `isExperimentOriginAllowed` V4 origin gate; three vkb-server proxy routes forward `{ task_id }` to the coordinator with NO git argv in the container layer (Pitfall 6).

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): failing merge-status + conflict-blocked-promote test** - `c10d960e9` (test)
2. **Task 1 (GREEN): avenueMergeStatus + promoteAvenue primitives** - `1919ca33f` (feat)
3. **Task 2: coordinator avenue-* endpoints + vkb-server proxy routes** - `607004256` (feat)

_Task 1 is `tdd="true"` — RED (test) then GREEN (feat)._

## Files Created/Modified
- `tests/experiments/avenue-merge.test.mjs` - 7 tests against throwaway git fixtures: merged/unmerged/conflicts/unknown status, main-HEAD-unchanged-by-status, conflict-blocked promote, clean promote advances main, absent-branch promote rejects.
- `lib/experiments/avenue-branch.mjs` - Added `avenueMergeStatus` + `promoteAvenue` (plus internal `refExists`/`conflictCount` helpers) alongside the Plan-01 lifecycle primitives; all fixed-argv, all keyed on the sanitized `avenue/<id>` ref.
- `scripts/health-coordinator.js` - Added the three `POST /experiments/avenue-*` endpoints (lazy `getAvenueBranch` import, `AVENUE_TASK_ID_RE` validation, verbatim JSON relay) behind `isExperimentOriginAllowed`.
- `lib/vkb-server/api-routes.js` - Registered + implemented `handleAvenueMergeStatus/Promote/Prune` via a shared `_proxyAvenue` helper (validate `task_id` → `_coordinatorPost` → relay), plus `_validAvenueTaskId`.

## Decisions Made
See `key-decisions` frontmatter. Notably: `merge-tree --write-tree` (git 2.50 on host) for read-only conflict detection with a conservative unparseable-output fallback; left-right count = behind/ahead; defence-in-depth task_id validation at both HTTP boundaries plus the primitive's sanitizeTaskId.

## Deviations from Plan

None - plan executed exactly as written. The plan's Task 1 mentioned `git merge-tree` generically (or a scratch-worktree dry-run alternative); the implementation uses the modern `git merge-tree --write-tree` form (git ≥ 2.38; host is 2.50.1), which is strictly read-only (writes trees to the object store only, never HEAD/index/working-tree) and returns exit 1 + conflict lines on a conflict — verified live during execution.

## Issues Encountered
- The Task 1 acceptance grep `grep -nE "shell:\s*true"` matches ONE line — the Plan-01 header comment prose "never `shell:true`". This is a documentation reference, not code; a live-usage grep (`grep -vE "^\s*[0-9]+://"`) confirms zero actual `shell: true` argv. Intent of the criterion (no shell string interpolation) is satisfied — every git call is fixed-argv `spawnSync('git', [...])`.

## User Setup Required
None - no external service configuration required. (The coordinator + vkb-server are already running services; the new routes are live on next restart, exercised host-side by Plan 06's frontend.)

## Next Phase Readiness
- AVN-08 (merge-status + conflict-blocked promote) and AVN-09 (host-only prune) primitives + routes are ready for Plan 06's frontend to consume verbatim (`/api/experiments/avenue-merge-status | avenue-promote | avenue-prune`).
- The UI-SPEC badge vocabulary (`merged`/`unmerged`/`conflicts`/`unknown` + ahead/behind/conflicts + branch) is returned as-is; `unknown` → NO badge is honored at the source.
- No blockers. Wiring is behaviorally verified (33/33 experiment endpoint + avenue tests green); live route smoke against a running coordinator :3034 is deferred to the orchestrator's post-merge/Plan-06 integration.

## Self-Check: PASSED

All created/modified files exist on disk; all task + summary commits (`c10d960e9`, `1919ca33f`, `607004256`, `e9836b77f`) are in the git log. 33/33 experiment endpoint + avenue tests green.

---
*Phase: 87-interactive-spans-and-branch-avenues*
*Completed: 2026-07-11*
