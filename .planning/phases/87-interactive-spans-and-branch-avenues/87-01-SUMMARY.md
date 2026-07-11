---
phase: 87-interactive-spans-and-branch-avenues
plan: 01
subsystem: experiments/avenue-branch-lifecycle
tags: [avenue, git-worktree, branch-lifecycle, AVN-05, AVN-09, repro-rig]
requires:
  - lib/repro/capture-snapshot.mjs (sanitizeTaskId)
  - lib/repro/restore-snapshot.mjs (git() fixed-argv helper, worktree-add site)
  - lib/experiments/experiment-restore.mjs (restoreForCell shape)
provides:
  - "avenue/<task_id> named-branch worktree lifecycle (create/commit/prune)"
  - "avenueMode+branchName option threaded through restoreSnapshot -> restoreForCell"
  - "buildWorktreeAddArgs (pure, exported argv builder — detached default vs -b avenue branch)"
affects:
  - Plan 03 (avenue runner launches onto avenue/<task_id> via restoreForCell avenueMode)
  - Plan 05 (merge-status/promote/prune acts on the avenue branch + prune primitive)
tech-stack:
  added: []
  patterns:
    - "fixed-argv spawnSync('git',[...]) — never shell:true (T-87-01-02)"
    - "sanitizeTaskId-derived branch ref (avenue/[A-Za-z0-9._-]+) before any argv (T-87-01-01)"
    - "pure argv builder extracted for hermetic unit assertion (no live git run)"
key-files:
  created:
    - lib/experiments/avenue-branch.mjs
    - tests/experiments/avenue-branch.test.mjs
  modified:
    - lib/repro/restore-snapshot.mjs
    - lib/experiments/experiment-restore.mjs
    - tests/experiments/experiment-restore.test.mjs
    - .gitignore
decisions:
  - "Extracted buildWorktreeAddArgs as a pure exported helper so the detached-default vs -b-avenue argv contract is unit-testable without spawning git (plan asked to assert on argv, not a live run)."
  - "Added .data/avenues/ to .gitignore (Rule 2): avenue worktrees are reconstructed working trees holding live-state copies, same security class as .data/run-restores/ — MUST NOT be committed."
  - "pruneAvenueBranch returns {removed: removedWorktree || removedBranch} so a dangling branch-only or worktree-only remnant still reports removed:true, while a fully-absent avenue reports removed:false (idempotent)."
metrics:
  duration: ~15m
  tasks: 2
  files: 5
  tests: 26 passing (5 avenue-branch + 21 experiment-restore incl 5 new AVN-05)
  completed: 2026-07-11
---

# Phase 87 Plan 01: Avenue Branch Lifecycle Summary

Built the NET-NEW persistent `avenue/<task_id>` git-branch lifecycle — a named-branch worktree variant of the Phase-67 restore rig with commit-on-close and on-demand prune primitives, plus an `avenueMode`/`branchName` option threaded through `restoreSnapshot` → `restoreForCell` (AVN-05/09).

## What Was Built

**Task 1 — `lib/experiments/avenue-branch.mjs` (TDD):**
- `avenueWorktreePath(taskId, repoRoot)` — pure path under `.data/avenues/<sanitized>`.
- `createAvenueBranch({taskId, sha, repoRoot})` — `git worktree add -b avenue/<id> <path> <sha>` (named branch, NOT detached).
- `commitAvenueWorktree({worktree, message})` — `git add -A` + `git commit` of the worktree diff onto its branch (D-04); clean-tree no-op returns `{committed:false}`.
- `pruneAvenueBranch({taskId, repoRoot})` — `git worktree remove --force` + `git branch -D avenue/<id>` (D-05); idempotent no-op when absent. Scoped to the exact sanitized ref + `.data/avenues/<id>` path, so measurement data in the main `.data` survives (T-87-01-03).
- All git calls are fixed-argv `spawnSync` (never `shell:true`); branch ref derived once from the vetted `sanitizeTaskId` (T-87-01-01/02).
- `tests/experiments/avenue-branch.test.mjs` exercises create/commit/prune against a real throwaway `git init` fixture with full teardown — zero orphan worktrees post-run.

**Task 2 — thread `avenueMode`+`branchName` through the rig:**
- `lib/repro/restore-snapshot.mjs`: added `buildWorktreeAddArgs` (pure, exported) — `-b <branch>` when `avenueMode && branchName`, else the `--detach` default preserved byte-for-byte. Branch recorded in the returned `steps` for observability. JSDoc updated.
- `lib/experiments/experiment-restore.mjs`: `restoreForCell` destructures + forwards `avenueMode`/`branchName` to the rig (still `inPlace:false` only — zero blast radius, T-77-08).
- Hermetic argv assertions (detached default + `-b` avenue + avenueMode-without-branchName fallback) and stub-based threading assertions added to the existing restore suite.

## Verification

- `node --test tests/experiments/avenue-branch.test.mjs` → 5/5 pass (create shows named branch, prune removes worktree+branch, prune idempotent, metachar/`..` sanitized, commit-on-close + clean-tree no-op).
- `node --test tests/experiments/experiment-restore.test.mjs` → 21/21 pass (16 pre-existing detached-default regression anchors HOLD + 5 new AVN-05).
- `git worktree list | grep -c '/\.data/avenues/'` → 0 after the suite (no leaked worktrees).
- Acceptance greps all pass: `worktree.*add.*-b` present; no real `shell: true`; `sanitizeTaskId` used; `--detach` still present; `avenueMode|branchName` threaded through both files.

## Deviations from Plan

### Auto-added functionality (Rule 2)

**1. [Rule 2 - Missing critical] Added `.data/avenues/` to `.gitignore`**
- **Found during:** Task 1
- **Issue:** The plan states the avenue worktree path is gitignored (interfaces §), but only `.data/run-restores/` was ignored — `.data/avenues/` was not, so a created avenue worktree could be accidentally committed (same live-state-copy security class as run-restores).
- **Fix:** Added `.data/avenues/` to `.gitignore` beside `.data/run-restores/` with an explanatory comment.
- **Files modified:** `.gitignore`
- **Commit:** 5fdde9db2

### Implementation choice (documented, within plan latitude)

**2. Extracted `buildWorktreeAddArgs` as a pure exported helper**
- The plan required a hermetic unit assertion on the worktree-add argv ("assert on the argv, not a live git run"). Extracting the argv construction into a pure exported function lets the test import and assert the exact argv for both avenueMode and detached paths without spawning git. The `restoreSnapshot` call site delegates to it, so the byte-for-byte detached default is single-sourced and cannot drift from the tested contract.

## Threat Model Discharge

- T-87-01-01 (tampering, name from task_id): branch ref derived once from `sanitizeTaskId`; unit test rejects metachar/`..` and asserts `avenue/[A-Za-z0-9._-]+`.
- T-87-01-02 (cmd injection): every git call fixed-argv; grep gate confirms no real `shell: true`.
- T-87-01-03 (wrong-target prune): prune scoped to the exact `avenue/<id>` ref + `.data/avenues/<id>` path; idempotent.
- T-87-01-04 (host-only): host-side lib primitives; no container import path (Pitfall-6 boundary respected — noted in module header).

## Known Stubs

None — all primitives are fully wired against a real git fixture.

## Self-Check: PASSED

- FOUND: lib/experiments/avenue-branch.mjs
- FOUND: tests/experiments/avenue-branch.test.mjs
- FOUND: lib/repro/restore-snapshot.mjs (modified — buildWorktreeAddArgs, avenueMode)
- FOUND: lib/experiments/experiment-restore.mjs (modified — avenueMode threading)
- FOUND commit 8bed39528 (test — RED)
- FOUND commit 5fdde9db2 (feat — avenue-branch primitives + gitignore)
- FOUND commit d676052f7 (feat — avenueMode threading)
