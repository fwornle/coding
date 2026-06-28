// tests/integration/lsl-lock-sweeper.test.mjs
//
// Phase 54 LSL hardening — the stale git-lock sweeper that clears orphaned
// `.specstory/history/.git/index.lock` files left when a committer (project LSL
// writer OR the SpecStory IDE extension) is killed mid-commit.
//
// Exercises scripts/lsl-lock-sweeper-job.sh via its env seams (LSL_LOCK_PATHS,
// LSL_LOCK_STALE_SECS) against throwaway temp lock files — no real history repo
// or launchd touched. Convention: node:test + node:assert/strict, stderr-only.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const JOB = path.resolve('scripts/lsl-lock-sweeper-job.sh');

// The job logs to stderr (sweep-job convention); the plist merges both streams
// into one file, so the test captures stdout + stderr combined.
function runSweeper(lockPaths, { staleSecs = 90 } = {}) {
  const res = spawnSync('/bin/bash', [JOB], {
    env: {
      ...process.env,
      LSL_LOCK_PATHS: Array.isArray(lockPaths) ? lockPaths.join(' ') : lockPaths,
      LSL_LOCK_STALE_SECS: String(staleSecs),
    },
    encoding: 'utf8',
  });
  return (res.stdout || '') + (res.stderr || '');
}

function tmpLock(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsl-lock-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, ''); // 0-byte, like a real index.lock
  return p;
}

function ageFile(p, secondsAgo) {
  const t = Date.now() / 1000 - secondsAgo;
  fs.utimesSync(p, t, t);
}

describe('lsl-lock-sweeper', () => {
  test('removes a stale lock with no holder', () => {
    const lock = tmpLock('index.lock');
    ageFile(lock, 1000); // well past the 90s threshold
    runSweeper(lock);
    assert.equal(fs.existsSync(lock), false, 'stale lock should be removed');
  });

  test('keeps a fresh lock (may be an in-flight commit)', () => {
    const lock = tmpLock('index.lock');
    // mtime = now → age ~0s < 90s
    runSweeper(lock);
    assert.equal(fs.existsSync(lock), true, 'fresh lock must NOT be removed');
  });

  test('non-existent lock path is a no-op (exit 0)', () => {
    const out = runSweeper('/no/such/dir/.git/index.lock');
    assert.match(out, /checked 1, removed 0/);
  });

  test('a NON-git holder (e.g. Spotlight) does not block removal of a stale lock', async () => {
    const lock = tmpLock('index.lock');
    // Hold the file open with `tail -f` (comm=tail, not git).
    const holder = spawn('tail', ['-f', lock], { stdio: 'ignore' });
    try {
      // Give tail a moment to open the fd, then age the file past threshold.
      await new Promise((r) => setTimeout(r, 200));
      ageFile(lock, 1000);
      runSweeper(lock);
      assert.equal(
        fs.existsSync(lock),
        false,
        'a non-git holder must not protect a stale lock',
      );
    } finally {
      holder.kill('SIGKILL');
    }
  });

  test('sweeps multiple paths in one run', () => {
    const a = tmpLock('a.lock');
    const b = tmpLock('b.lock');
    ageFile(a, 1000);
    ageFile(b, 1000);
    const out = runSweeper([a, b]);
    assert.equal(fs.existsSync(a), false);
    assert.equal(fs.existsSync(b), false);
    assert.match(out, /checked 2, removed 2/);
  });
});
