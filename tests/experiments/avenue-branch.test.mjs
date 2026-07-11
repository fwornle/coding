// tests/experiments/avenue-branch.test.mjs
//
// Phase 87, Plan 87-01, Task 1 — AVN-05/09 proof for lib/experiments/avenue-branch.mjs.
//
// Exercises the persistent avenue/<task_id> branch lifecycle against a REAL throwaway git
// fixture (git init + one commit). Every case tears down its worktree registration + tmp repo
// so no `.data/avenues/*` entry leaks (verified by the caller's `git worktree list` gate).
//
//   • createAvenueBranch → named branch worktree under .data/avenues/<sanitized> (NOT detached)
//   • pruneAvenueBranch   → removes worktree AND deletes branch; idempotent no-op when absent
//   • metachar/`..` task_id → sanitized before any git argv (branch ∈ avenue/[A-Za-z0-9._-]+)
//   • commitAvenueWorktree → stages+commits the working-tree diff (one new commit); clean → no-op
//
// Pure node:test (jest testMatch is *.test.js — these .mjs run via `node --test`). Diagnostics
// via process.stderr only would be module-side; the test asserts return shapes + git state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  avenueWorktreePath,
  createAvenueBranch,
  commitAvenueWorktree,
  pruneAvenueBranch,
} from '../../lib/experiments/avenue-branch.mjs';

/** Fixed-argv git in a cwd; returns {ok, stdout, stderr}. Mirrors the module's discipline. */
function git(args, cwd, input) {
  const opts = { cwd, encoding: 'utf8', timeout: 60_000 };
  if (typeof input === 'string') opts.input = input;
  const res = spawnSync('git', args, opts);
  return {
    ok: !!res && !res.error && res.status === 0,
    stdout: typeof res?.stdout === 'string' ? res.stdout : '',
    stderr: typeof res?.stderr === 'string' ? res.stderr : '',
  };
}

/** git init a throwaway repo with one commit; returns {repoRoot, sha, cleanup}. */
function makeFixtureRepo() {
  const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'avenue-fixture-')));
  git(['init', '--quiet'], repoRoot);
  git(['config', 'user.email', 'test@example.com'], repoRoot);
  git(['config', 'user.name', 'Avenue Test'], repoRoot);
  git(['config', 'commit.gpgsign', 'false'], repoRoot);
  fs.writeFileSync(path.join(repoRoot, 'README.md'), '# fixture\n');
  git(['add', 'README.md'], repoRoot);
  git(['commit', '--quiet', '-m', 'initial'], repoRoot);
  const sha = git(['rev-parse', 'HEAD'], repoRoot).stdout.trim();
  const cleanup = () => {
    try {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  };
  return { repoRoot, sha, cleanup };
}

test('createAvenueBranch: named branch worktree under .data/avenues (not detached)', () => {
  const { repoRoot, sha, cleanup } = makeFixtureRepo();
  try {
    const res = createAvenueBranch({ taskId: 'task-42', sha, repoRoot });
    const expectedPath = path.join(repoRoot, '.data', 'avenues', 'task-42');
    assert.equal(res.worktree, expectedPath);
    assert.equal(res.branch, 'avenue/task-42');
    assert.equal(res.created, true);
    assert.equal(avenueWorktreePath('task-42', repoRoot), expectedPath);
    assert.ok(fs.existsSync(expectedPath), 'worktree dir must exist');

    // The worktree lists on the NAMED branch, not detached.
    const list = git(['worktree', 'list', '--porcelain'], repoRoot).stdout;
    assert.ok(list.includes('branch refs/heads/avenue/task-42'), `expected named branch in:\n${list}`);
    assert.ok(!/detached/.test(list.split('\n\n').find((b) => b.includes('task-42')) || ''),
      'avenue worktree must NOT be detached');
  } finally {
    pruneAvenueBranch({ taskId: 'task-42', repoRoot });
    cleanup();
  }
});

test('pruneAvenueBranch: removes worktree AND deletes branch; returns {removed:true}', () => {
  const { repoRoot, sha, cleanup } = makeFixtureRepo();
  try {
    createAvenueBranch({ taskId: 'prune-me', sha, repoRoot });
    const wt = avenueWorktreePath('prune-me', repoRoot);
    assert.ok(fs.existsSync(wt));

    const res = pruneAvenueBranch({ taskId: 'prune-me', repoRoot });
    assert.equal(res.removed, true);
    assert.ok(!fs.existsSync(wt), 'worktree dir removed');
    const branches = git(['branch', '--list', 'avenue/prune-me'], repoRoot).stdout.trim();
    assert.equal(branches, '', 'branch avenue/prune-me deleted');
  } finally {
    cleanup();
  }
});

test('pruneAvenueBranch: idempotent — already-gone avenue returns {removed:false} without throwing', () => {
  const { repoRoot, cleanup } = makeFixtureRepo();
  try {
    const res = pruneAvenueBranch({ taskId: 'never-existed', repoRoot });
    assert.equal(res.removed, false);
  } finally {
    cleanup();
  }
});

test('task_id with shell metachar / `..` is sanitized before any git argv', () => {
  const { repoRoot, sha, cleanup } = makeFixtureRepo();
  try {
    // A traversal + metachar id must never escape .data/avenues nor build a raw branch ref.
    const nasty = '../../etc/pwn; rm -rf';
    const wt = avenueWorktreePath(nasty, repoRoot);
    const avenuesRoot = path.join(repoRoot, '.data', 'avenues');
    assert.ok(wt.startsWith(avenuesRoot + path.sep), `sanitized path must stay under .data/avenues: ${wt}`);

    const res = createAvenueBranch({ taskId: nasty, sha, repoRoot });
    // Branch name only ever matches avenue/[A-Za-z0-9._-]+
    assert.match(res.branch, /^avenue\/[A-Za-z0-9._-]+$/);
    assert.ok(!res.branch.includes('/etc/'), 'no traversal survives into the branch ref');

    // git actually created exactly that sanitized branch.
    const listed = git(['branch', '--list', res.branch], repoRoot).stdout.trim();
    assert.ok(listed.length > 0, `expected branch ${res.branch} to exist`);

    pruneAvenueBranch({ taskId: nasty, repoRoot });
  } finally {
    cleanup();
  }
});

test('commitAvenueWorktree: stages+commits working-tree diff (one new commit); clean tree → no-op', () => {
  const { repoRoot, sha, cleanup } = makeFixtureRepo();
  try {
    const { worktree, branch } = createAvenueBranch({ taskId: 'commit-me', sha, repoRoot });
    const before = git(['-C', worktree, 'rev-list', '--count', 'HEAD'], repoRoot).stdout.trim();

    // Clean tree → no-op.
    const noop = commitAvenueWorktree({ worktree, message: 'nothing to commit' });
    assert.equal(noop.committed, false);
    const afterNoop = git(['-C', worktree, 'rev-list', '--count', 'HEAD'], repoRoot).stdout.trim();
    assert.equal(afterNoop, before, 'clean-tree commit must not add a commit');

    // Dirty the worktree → commit stages+commits it.
    fs.writeFileSync(path.join(worktree, 'avenue-change.txt'), 'avenue code change\n');
    const res = commitAvenueWorktree({ worktree, message: 'avenue: real change' });
    assert.equal(res.committed, true);
    const after = git(['-C', worktree, 'rev-list', '--count', 'HEAD'], repoRoot).stdout.trim();
    assert.equal(Number(after), Number(before) + 1, 'exactly one new commit on the avenue branch');

    // The new commit is on the avenue branch and contains the staged file.
    const show = git(['-C', worktree, 'show', '--name-only', '--format=%s', 'HEAD'], repoRoot).stdout;
    assert.ok(show.includes('avenue: real change'));
    assert.ok(show.includes('avenue-change.txt'));
    const head = git(['-C', worktree, 'rev-parse', '--abbrev-ref', 'HEAD'], repoRoot).stdout.trim();
    assert.equal(head, branch);

    pruneAvenueBranch({ taskId: 'commit-me', repoRoot });
  } finally {
    cleanup();
  }
});
