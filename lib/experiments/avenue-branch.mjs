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
