// lib/experiments/avenue-branch.mjs
//
// Phase 87, Plan 87-01 (Wave 1) — AVN-05 / AVN-09: the persistent `avenue/<task_id>` git-branch
// lifecycle. NET-NEW backbone every downstream avenue plan builds on:
//
//   avenueWorktreePath(taskId, repoRoot)          → .data/avenues/<sanitized> path (pure)
//   createAvenueBranch({taskId, sha, repoRoot})   → `git worktree add -b avenue/<id> <path> <sha>`
//   commitAvenueWorktree({worktree, message})     → stage+commit the worktree diff onto its branch
//                                                    (D-04: the branch HOLDS the avenue's real code)
//   pruneAvenueBranch({taskId, repoRoot})         → `git worktree remove` + `git branch -D` (D-05,
//                                                    on-demand only; measurement data in main .data
//                                                    survives — this touches ONLY the avenue worktree)
//
// Unlike the Phase-67 detached restore worktrees (`.data/run-restores/*`, --detach), an avenue is a
// NAMED branch worktree under `.data/avenues/<id>/` so the avenue's edits persist as commits on a
// real `avenue/<task_id>` ref that Plan 05 (merge-status/promote/prune) can act on.
//
// SECURITY (threat_model 87-01):
//   • T-87-01-01 (tampering): the branch/worktree name is derived ONCE from `sanitizeTaskId`
//     (`[A-Za-z0-9._-]` + path.basename) — the branch ref provably matches `avenue/[A-Za-z0-9._-]+`,
//     so a metachar/`..` task_id can never build a raw ref or escape `.data/avenues`.
//   • T-87-01-02 (cmd injection): every git call is a FIXED-ARGV `spawnSync('git',[...])` — never
//     `shell:true`, never a string concatenated into a single arg. Mirrors restore-snapshot.mjs:62.
//   • T-87-01-03 (wrong-target prune): prune is keyed on the sanitized `avenue/<id>` ref + the
//     `.data/avenues/<id>` path only; `git branch -D` is scoped to that exact ref; idempotent no-op.
//   • T-87-01-04 (host-only): these are HOST-side primitives — the container never imports them
//     (Plan 05 routes all state-changing git through the host coordinator). No container code path
//     reaches here (Pitfall-6 boundary).
//
// Diagnostics via process.stderr.write only (no console.* — no-console-log, CLAUDE.md).
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

import { sanitizeTaskId } from '../repro/capture-snapshot.mjs';

const GIT_TIMEOUT_MS = 60_000;
const GIT_MAX_BUFFER = 16 * 1024 * 1024;

/**
 * Run a fixed-argv git command. Returns `{ ok, stdout, stderr }`; `ok` is true only on a clean
 * (status 0, no spawn error) exit. NEVER a shell string — every arg is a literal array element
 * (T-87-01-02). Mirrors lib/repro/restore-snapshot.mjs:62-66.
 * @param {string[]} args
 * @param {string} cwd
 */
function git(args, cwd) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER });
  const ok = !!res && !res.error && res.status === 0;
  return {
    ok,
    stdout: typeof res?.stdout === 'string' ? res.stdout : '',
    stderr: typeof res?.stderr === 'string' ? res.stderr : '',
  };
}

/**
 * Sanitized avenue branch ref for a task_id. Derived ONCE from `sanitizeTaskId` so the ref
 * provably matches `avenue/[A-Za-z0-9._-]+` (T-87-01-01). Not exported — the path + create/prune
 * primitives are the public surface; callers should not hand-build the ref string.
 * @param {unknown} taskId
 * @returns {string}
 */
function avenueBranchName(taskId) {
  return `avenue/${sanitizeTaskId(taskId)}`;
}

/**
 * Absolute path of the avenue worktree for `taskId` under `<repoRoot>/.data/avenues/<sanitized>`.
 * Pure (no filesystem/git side effect) so callers can compute the expected location. The sanitize
 * step guarantees the result stays under `.data/avenues` (path-traversal-safe, T-87-01-01).
 * @param {unknown} taskId
 * @param {string} [repoRoot]
 * @returns {string}
 */
export function avenueWorktreePath(taskId, repoRoot = process.cwd()) {
  return path.join(repoRoot, '.data', 'avenues', sanitizeTaskId(taskId));
}

/**
 * Create a NAMED `avenue/<task_id>` branch worktree at `sha` under `.data/avenues/<sanitized>/`
 * (AVN-05). Unlike the detached restore worktrees, this is `git worktree add -b <branch> <path>
 * <sha>` so the avenue's edits accumulate as commits on a real branch ref.
 *
 * @param {object} args
 * @param {string} args.taskId  avenue/run identifier (sanitized before any argv).
 * @param {string} args.sha     commit-ish the worktree starts from (the origin snapshot SHA).
 * @param {string} [args.repoRoot] host repo root (default: cwd).
 * @returns {{ worktree: string, branch: string, created: boolean }}
 * @throws {Error} when `sha` is missing or `git worktree add -b` fails.
 */
export function createAvenueBranch({ taskId, sha, repoRoot = process.cwd() } = {}) {
  if (!sha || typeof sha !== 'string') {
    throw new Error(`createAvenueBranch aborted: a starting sha is required (got ${JSON.stringify(sha)})`);
  }
  const branch = avenueBranchName(taskId);
  const worktree = avenueWorktreePath(taskId, repoRoot);

  const res = git(['worktree', 'add', '-b', branch, worktree, sha], repoRoot);
  if (!res.ok) {
    throw new Error(`createAvenueBranch aborted: 'git worktree add -b ${branch} ${worktree} ${sha}' failed: ${res.stderr.trim()}`);
  }
  return { worktree, branch, created: true };
}

/**
 * Stage + commit the avenue worktree's working-tree diff onto its branch (D-04: the branch HOLDS
 * the avenue's real code changes). No-op (returns `{committed:false}`) when the tree is clean, so
 * a close with nothing to record never produces an empty commit.
 *
 * @param {object} args
 * @param {string} args.worktree the avenue worktree path (from createAvenueBranch).
 * @param {string} args.message  the commit message.
 * @returns {{ committed: boolean }}
 * @throws {Error} when `worktree`/`message` is missing, or the stage/commit git op fails.
 */
export function commitAvenueWorktree({ worktree, message } = {}) {
  if (!worktree || typeof worktree !== 'string') {
    throw new Error(`commitAvenueWorktree aborted: a worktree path is required (got ${JSON.stringify(worktree)})`);
  }
  if (!message || typeof message !== 'string') {
    throw new Error(`commitAvenueWorktree aborted: a commit message is required (got ${JSON.stringify(message)})`);
  }

  // Clean tree → nothing to commit (porcelain is empty). Skip to avoid an empty commit.
  const status = git(['-C', worktree, 'status', '--porcelain'], worktree);
  if (!status.ok) {
    throw new Error(`commitAvenueWorktree aborted: 'git status' in ${worktree} failed: ${status.stderr.trim()}`);
  }
  if (status.stdout.trim().length === 0) {
    return { committed: false };
  }

  const add = git(['-C', worktree, 'add', '-A'], worktree);
  if (!add.ok) {
    throw new Error(`commitAvenueWorktree aborted: 'git add -A' in ${worktree} failed: ${add.stderr.trim()}`);
  }
  const commit = git(['-C', worktree, 'commit', '-m', message], worktree);
  if (!commit.ok) {
    throw new Error(`commitAvenueWorktree aborted: 'git commit' in ${worktree} failed: ${commit.stderr.trim()}`);
  }
  return { committed: true };
}

/**
 * Remove the avenue worktree AND delete its branch, ON DEMAND ONLY (AVN-09 / D-05). Fail-soft
 * idempotent: pruning an already-gone avenue returns `{removed:false}` without throwing. Scoped
 * to the sanitized `avenue/<id>` ref + `.data/avenues/<id>` path only, so measurement data in the
 * main `.data` (run-snapshots, knowledge-graph, exports) is untouched (T-87-01-03).
 *
 * @param {object} args
 * @param {string} args.taskId avenue/run identifier (sanitized before any argv).
 * @param {string} [args.repoRoot] host repo root (default: cwd).
 * @returns {{ removed: boolean }}  true when a worktree and/or branch was actually removed.
 */
export function pruneAvenueBranch({ taskId, repoRoot = process.cwd() } = {}) {
  const branch = avenueBranchName(taskId);
  const worktree = avenueWorktreePath(taskId, repoRoot);

  // 1) Remove the worktree registration (--force: the working tree may hold uncommitted changes
  //    the operator is intentionally discarding). Fail-soft: a missing worktree is not an error.
  const rm = git(['worktree', 'remove', '--force', worktree], repoRoot);
  let removedWorktree = rm.ok;
  if (!rm.ok) {
    // Best-effort: if the worktree entry is stale/gone, prune the registry so `branch -D` can
    // proceed cleanly. Never throws — this is the idempotent path.
    git(['worktree', 'prune'], repoRoot);
    process.stderr.write(`[avenue-branch] worktree remove ${worktree} soft-failed (already gone?): ${rm.stderr.trim()}\n`);
  }

  // 2) Delete the branch ref, scoped to the EXACT sanitized avenue ref (T-87-01-03).
  const del = git(['branch', '-D', branch], repoRoot);
  const removedBranch = del.ok;
  if (!del.ok) {
    process.stderr.write(`[avenue-branch] branch -D ${branch} soft-failed (already gone?): ${del.stderr.trim()}\n`);
  }

  return { removed: removedWorktree || removedBranch };
}

// =====================================================================
// Phase 87, Plan 87-04 (Wave 2) — AVN-08: merge-status compute + conflict-blocked promote.
// =====================================================================
// These sit alongside the Plan-01 lifecycle primitives and are the HOST-side git ops the
// coordinator seam (scripts/health-coordinator.js) delegates to. All fixed-argv (T-87-04-05),
// all keyed on the sanitized `avenue/<id>` ref (T-87-04-01).
//
//   • avenueMergeStatus — READ-ONLY status. NEVER mutates main: merged via `git branch --merged
//     main`; ahead/behind via `git rev-list --left-right --count main...avenue/<id>`; conflicts
//     via read-only `git merge-tree --write-tree` (exit 1 + conflict lines → conflicts), never a
//     live `git merge` (T-87-04-03, RESEARCH Q5). Absent branch → `unknown` → NO badge (honesty).
//   • promoteAvenue — the ONLY state-changing op. Re-checks conflicts first (same read-only
//     merge-tree); conflicts>0 → `{promoted:false, reason:'conflicts'}` WITHOUT touching main
//     (T-87-04-01 elevation guard). Otherwise `git merge --no-ff avenue/<id>` into main.

const MAIN_REF = 'main';

/**
 * True when `ref` resolves to a commit in `repoRoot` (branch exists). Fixed-argv, read-only.
 * @param {string} ref
 * @param {string} repoRoot
 * @returns {boolean}
 */
function refExists(ref, repoRoot) {
  // --verify + ^{commit} peels a symbolic/annotated ref to a commit; quiet: no stderr on miss.
  return git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], repoRoot).ok;
}

/**
 * Read-only conflict probe between `main` and the avenue branch via `git merge-tree --write-tree`
 * (git ≥ 2.38). Exit status 1 signals a conflict; the conflict blob lines (`<mode> <oid> <stage>\t
 * <path>`) with stage 1/2/3 enumerate the conflicting paths. NEVER mutates main — merge-tree only
 * writes trees into the object store, never touches HEAD/index/working-tree.
 * @param {string} branch  the fully-qualified avenue branch ref.
 * @param {string} repoRoot
 * @returns {number} count of distinct conflicting paths (0 = clean).
 */
function conflictCount(branch, repoRoot) {
  const res = git(['merge-tree', '--write-tree', MAIN_REF, branch], repoRoot);
  if (res.ok) return 0; // exit 0 → clean merge, no conflicts
  // Non-zero exit: parse the conflicting-file stage lines. A stage-1/2/3 blob line looks like
  // `100644 <oid> 2\tpath/to/file`; collect the distinct paths across stages.
  const paths = new Set();
  for (const line of res.stdout.split('\n')) {
    const m = /^\d{6} [0-9a-f]+ [123]\t(.+)$/.exec(line);
    if (m) paths.add(m[1]);
  }
  // If the tool reported a non-zero exit but we could not parse a stage line (older/edge output),
  // fall back to a conservative "1 conflict" so the caller still blocks the promote (honesty).
  return paths.size > 0 ? paths.size : 1;
}

/**
 * Compute the read-only merge status of `avenue/<task_id>` vs `main` (AVN-08). NEVER mutates main
 * (T-87-04-03). Returns a shape matching the UI-SPEC badge vocabulary:
 *   { state: 'merged'|'unmerged'|'conflicts'|'unknown', ahead, behind, conflicts, branch }
 * An absent branch → `{ state:'unknown', ahead:0, behind:0, conflicts:0 }` (frontend renders NO
 * badge — honesty). `merged` when the avenue is already an ancestor of main; `conflicts` when the
 * read-only merge-tree reports conflicting paths; otherwise `unmerged`.
 *
 * @param {object} args
 * @param {unknown} args.taskId  avenue/run identifier (sanitized before any argv).
 * @param {string} [args.repoRoot] host repo root (default: cwd).
 * @returns {{ state: 'merged'|'unmerged'|'conflicts'|'unknown', ahead: number, behind: number, conflicts: number, branch: string }}
 */
export function avenueMergeStatus({ taskId, repoRoot = process.cwd() } = {}) {
  const branch = avenueBranchName(taskId);

  // Absent branch (or no `main`) → unknown; the frontend suppresses the badge.
  if (!refExists(branch, repoRoot) || !refExists(MAIN_REF, repoRoot)) {
    return { state: 'unknown', ahead: 0, behind: 0, conflicts: 0, branch };
  }

  // ahead/behind — `main...branch` gives `<left>\t<right>`: left = commits reachable from main but
  // NOT the branch (main is ahead → the branch is BEHIND by that many); right = commits on the
  // branch but not main (the branch is AHEAD). Read-only.
  let ahead = 0;
  let behind = 0;
  const rl = git(['rev-list', '--left-right', '--count', `${MAIN_REF}...${branch}`], repoRoot);
  if (rl.ok) {
    const parts = rl.stdout.trim().split(/\s+/);
    behind = Number(parts[0]) || 0;
    ahead = Number(parts[1]) || 0;
  }

  // merged — the avenue branch is already an ancestor of main (its tip shows in `branch --merged`).
  const merged = git(['branch', '--merged', MAIN_REF], repoRoot);
  const isMerged = merged.ok && merged.stdout
    .split('\n')
    .map((l) => l.replace(/^[*+ ]+/, '').trim())
    .includes(branch);
  if (isMerged) {
    return { state: 'merged', ahead, behind, conflicts: 0, branch };
  }

  // conflicts — read-only merge-tree probe (no main mutation, T-87-04-03).
  const conflicts = conflictCount(branch, repoRoot);
  if (conflicts > 0) {
    return { state: 'conflicts', ahead, behind, conflicts, branch };
  }

  return { state: 'unmerged', ahead, behind, conflicts: 0, branch };
}

/**
 * Promote (merge) `avenue/<task_id>` into `main` — the ONLY state-changing avenue op (AVN-08,
 * D-04). Conflict-blocked: it FIRST re-runs the read-only conflict probe and, when conflicts>0,
 * returns `{promoted:false, reason:'conflicts'}` WITHOUT touching main (T-87-04-01). An absent
 * branch → `{promoted:false, reason:'unknown'}`. On a clean branch it runs `git merge --no-ff
 * avenue/<id>` into main (fast path: git advances HEAD only when the merge is clean).
 *
 * NOTE: this merges into WHATEVER main is checked out in `repoRoot` — the coordinator invokes it
 * on the HOST repo (never a container), per Pitfall 6 / the host-only trust boundary.
 *
 * @param {object} args
 * @param {unknown} args.taskId  avenue/run identifier (sanitized before any argv).
 * @param {string} [args.repoRoot] host repo root (default: cwd).
 * @returns {{ promoted: boolean, reason?: 'conflicts'|'unknown'|'merge-failed', conflicts?: number }}
 */
export function promoteAvenue({ taskId, repoRoot = process.cwd() } = {}) {
  const branch = avenueBranchName(taskId);

  if (!refExists(branch, repoRoot) || !refExists(MAIN_REF, repoRoot)) {
    return { promoted: false, reason: 'unknown' };
  }

  // Guard: re-check conflicts read-only BEFORE any live merge (T-87-04-01). Never force a merge.
  const conflicts = conflictCount(branch, repoRoot);
  if (conflicts > 0) {
    return { promoted: false, reason: 'conflicts', conflicts };
  }

  // Clean → merge the avenue branch into the currently-checked-out main (host repo).
  const res = git(['merge', '--no-ff', '-m', `promote ${branch} into ${MAIN_REF}`, branch], repoRoot);
  if (!res.ok) {
    // Defensive: a merge that fails despite a clean probe (e.g. dirty working tree) is reported,
    // never left half-applied — abort any in-progress merge so main stays consistent.
    git(['merge', '--abort'], repoRoot);
    process.stderr.write(`[avenue-branch] promote merge of ${branch} failed: ${res.stderr.trim()}\n`);
    return { promoted: false, reason: 'merge-failed' };
  }
  return { promoted: true };
}
