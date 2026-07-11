// tests/experiments/avenue-merge.test.mjs
//
// Phase 87, Plan 87-04, Task 1 — AVN-08 proof for the merge-status compute + conflict-blocked
// promote primitives in lib/experiments/avenue-branch.mjs (avenueMergeStatus / promoteAvenue).
//
// Exercises the read-only merge-status compute + the guarded promote against REAL throwaway git
// fixtures (git init + branch scenarios). Every case tears down its tmp repo so nothing leaks.
//
//   • merged branch        → { state:'merged',   ahead, behind, conflicts:0 }
//   • diverged, no conflict → { state:'unmerged', ahead>0,       conflicts:0 }
//   • conflicting branch    → { state:'conflicts', conflicts>0 } computed WITHOUT mutating main
//                             (main HEAD byte-identical before/after the status call — T-87-04-03)
//   • absent branch         → { state:'unknown' } (frontend renders NO badge — honesty)
//   • promoteAvenue on a conflicting branch → { promoted:false, reason:'conflicts' }, main unmoved
//   • promoteAvenue on a clean branch       → { promoted:true }, main HEAD advances
//
// Pure node:test (jest testMatch is *.test.js — these .mjs run via `node --test`). Asserts return
// shapes + git state; the module emits diagnostics via process.stderr only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  avenueMergeStatus,
  promoteAvenue,
} from '../../lib/experiments/avenue-branch.mjs';

/** Fixed-argv git in a cwd; returns {ok, stdout, stderr}. Mirrors the module's discipline. */
function git(args, cwd) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 60_000 });
  return {
    ok: !!res && !res.error && res.status === 0,
    stdout: typeof res?.stdout === 'string' ? res.stdout : '',
    stderr: typeof res?.stderr === 'string' ? res.stderr : '',
  };
}

/**
 * git init a throwaway repo whose default branch is renamed `main` (so `main...avenue/<id>` and
 * `branch --merged main` are stable across host git defaults). One commit on main. Returns
 * {repoRoot, cleanup}.
 */
function makeFixtureRepo() {
  const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'avenue-merge-')));
  git(['init', '--quiet'], repoRoot);
  git(['symbolic-ref', 'HEAD', 'refs/heads/main'], repoRoot);
  git(['config', 'user.email', 'test@example.com'], repoRoot);
  git(['config', 'user.name', 'Avenue Merge Test'], repoRoot);
  git(['config', 'commit.gpgsign', 'false'], repoRoot);
  fs.writeFileSync(path.join(repoRoot, 'shared.txt'), 'line-1\n');
  git(['add', 'shared.txt'], repoRoot);
  git(['commit', '--quiet', '-m', 'initial'], repoRoot);
  const cleanup = () => {
    try {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  };
  return { repoRoot, cleanup };
}

/** Create branch `avenue/<taskId>` off main and commit the given file contents on it. */
function makeAvenueBranch(repoRoot, taskId, file, contents, message) {
  git(['checkout', '--quiet', '-b', `avenue/${taskId}`, 'main'], repoRoot);
  fs.writeFileSync(path.join(repoRoot, file), contents);
  git(['add', file], repoRoot);
  git(['commit', '--quiet', '-m', message], repoRoot);
  git(['checkout', '--quiet', 'main'], repoRoot);
}

/** Commit a change directly on main (used to force divergence / a conflict). */
function commitOnMain(repoRoot, file, contents, message) {
  fs.writeFileSync(path.join(repoRoot, file), contents);
  git(['add', file], repoRoot);
  git(['commit', '--quiet', '-m', message], repoRoot);
}

function mainHead(repoRoot) {
  return git(['rev-parse', 'HEAD'], repoRoot).stdout.trim();
}

test('avenueMergeStatus: fully-merged branch → {state:"merged", conflicts:0}', () => {
  const { repoRoot, cleanup } = makeFixtureRepo();
  try {
    makeAvenueBranch(repoRoot, 'merged-1', 'feature.txt', 'feature\n', 'add feature');
    // Merge it into main so it is an ancestor of main → merged.
    git(['merge', '--quiet', '--no-ff', 'avenue/merged-1', '-m', 'merge feature'], repoRoot);

    const st = avenueMergeStatus({ taskId: 'merged-1', repoRoot });
    assert.equal(st.state, 'merged');
    assert.equal(st.conflicts, 0);
    assert.equal(typeof st.ahead, 'number');
    assert.equal(typeof st.behind, 'number');
  } finally {
    cleanup();
  }
});

test('avenueMergeStatus: diverged, no conflict → {state:"unmerged", ahead>0, conflicts:0}', () => {
  const { repoRoot, cleanup } = makeFixtureRepo();
  try {
    // Avenue touches a NEW file; main advances on a DIFFERENT file → divergent, no conflict.
    makeAvenueBranch(repoRoot, 'diverge-1', 'branch-only.txt', 'branch\n', 'branch work');
    commitOnMain(repoRoot, 'main-only.txt', 'main\n', 'main work');

    const st = avenueMergeStatus({ taskId: 'diverge-1', repoRoot });
    assert.equal(st.state, 'unmerged');
    assert.ok(st.ahead > 0, `expected ahead>0, got ${st.ahead}`);
    assert.equal(st.conflicts, 0);
  } finally {
    cleanup();
  }
});

test('avenueMergeStatus: conflicting branch → {state:"conflicts", conflicts>0} WITHOUT mutating main', () => {
  const { repoRoot, cleanup } = makeFixtureRepo();
  try {
    // Both edit shared.txt at the same line → a real merge conflict.
    makeAvenueBranch(repoRoot, 'conflict-1', 'shared.txt', 'line-1-branch\n', 'branch edits shared');
    commitOnMain(repoRoot, 'shared.txt', 'line-1-main\n', 'main edits shared');

    const before = mainHead(repoRoot);
    const st = avenueMergeStatus({ taskId: 'conflict-1', repoRoot });
    const after = mainHead(repoRoot);

    assert.equal(st.state, 'conflicts');
    assert.ok(st.conflicts > 0, `expected conflicts>0, got ${st.conflicts}`);
    // T-87-04-03: the status compute is read-only — main HEAD is byte-identical.
    assert.equal(after, before, 'avenueMergeStatus must NOT move main HEAD');
    // And main's working tree still holds main's version (never a merge marker).
    assert.equal(fs.readFileSync(path.join(repoRoot, 'shared.txt'), 'utf8'), 'line-1-main\n');
  } finally {
    cleanup();
  }
});

test('avenueMergeStatus: absent branch → {state:"unknown"} (no badge — honesty)', () => {
  const { repoRoot, cleanup } = makeFixtureRepo();
  try {
    const st = avenueMergeStatus({ taskId: 'never-existed', repoRoot });
    assert.equal(st.state, 'unknown');
  } finally {
    cleanup();
  }
});

test('promoteAvenue: conflicting branch REJECTS ({promoted:false, reason:"conflicts"}) and does NOT merge', () => {
  const { repoRoot, cleanup } = makeFixtureRepo();
  try {
    makeAvenueBranch(repoRoot, 'promote-conflict', 'shared.txt', 'line-1-branch\n', 'branch edits shared');
    commitOnMain(repoRoot, 'shared.txt', 'line-1-main\n', 'main edits shared');

    const before = mainHead(repoRoot);
    const res = promoteAvenue({ taskId: 'promote-conflict', repoRoot });
    const after = mainHead(repoRoot);

    assert.equal(res.promoted, false);
    assert.equal(res.reason, 'conflicts');
    assert.equal(after, before, 'a conflict-blocked promote must NOT advance main');
    assert.equal(fs.readFileSync(path.join(repoRoot, 'shared.txt'), 'utf8'), 'line-1-main\n');
  } finally {
    cleanup();
  }
});

test('promoteAvenue: clean branch merges — main HEAD advances', () => {
  const { repoRoot, cleanup } = makeFixtureRepo();
  try {
    makeAvenueBranch(repoRoot, 'promote-clean', 'feature.txt', 'feature\n', 'add feature');

    const before = mainHead(repoRoot);
    const res = promoteAvenue({ taskId: 'promote-clean', repoRoot });
    const after = mainHead(repoRoot);

    assert.equal(res.promoted, true);
    assert.notEqual(after, before, 'a clean promote must advance main HEAD');
    // main now contains the avenue's file.
    assert.ok(fs.existsSync(path.join(repoRoot, 'feature.txt')), 'promoted file present on main');
    // The avenue branch is now merged into main.
    const merged = git(['branch', '--merged', 'main'], repoRoot).stdout;
    assert.ok(merged.includes('avenue/promote-clean'), 'avenue branch is an ancestor of main after promote');
  } finally {
    cleanup();
  }
});

test('promoteAvenue: absent branch → {promoted:false, reason:"unknown"} (nothing to merge)', () => {
  const { repoRoot, cleanup } = makeFixtureRepo();
  try {
    const before = mainHead(repoRoot);
    const res = promoteAvenue({ taskId: 'ghost', repoRoot });
    const after = mainHead(repoRoot);
    assert.equal(res.promoted, false);
    assert.equal(res.reason, 'unknown');
    assert.equal(after, before, 'promoting an absent branch must not move main');
  } finally {
    cleanup();
  }
});
