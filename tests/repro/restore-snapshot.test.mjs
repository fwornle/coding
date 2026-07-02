// tests/repro/restore-snapshot.test.mjs
//
// Phase 67, Plan 67-05 (Wave 3) — REPRO-01 / SC-2. Golden suite for
// lib/repro/restore-snapshot.mjs: the safe-by-default sandbox restore (D-04) plus the
// backup+confirm-gated `--in-place` path (D-05).
//
// TWO PORTIONS:
//   • Non-live (ALWAYS runs): the `--in-place` abort-before-write guard (an auto-backup
//     snapshot dir is created FIRST, then a falsy `confirm` aborts before any live write),
//     the missing-snapshot error, and a source-structure scan that mirrors the plan's
//     acceptance greps (submodule/apply/hydrateSandbox/worktree present; no shell-string
//     git). None of these touch git or km-core.
//   • Live (REPRO_RESTORE_LIVE=1 ONLY): a real `git worktree` restore of a throwaway repo
//     asserting restored HEAD == captured SHA and the source checkout HEAD unchanged. Gated
//     on the ENV VAR, never a `--live` argv (MEMORY.md node --test argv-drop gotcha).
//
// Convention: node:test + node:assert/strict (established tests/repro/ pattern — NOT jest;
// RESEARCH Pitfall 6). Output via process.stderr.write only (no console.* — no-console-log).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { restoreSnapshot } from '../../lib/repro/restore-snapshot.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESTORE_SRC = path.resolve(__dirname, '../../lib/repro/restore-snapshot.mjs');

/**
 * Seed a minimal snapshot dir under `<repoRoot>/.data/run-snapshots/<id>/` with the exact
 * artifact shape capture-snapshot.mjs produces (manifest, git-sha.txt, dirty.patch,
 * submodules.json, untracked/, kb/exports/general.json, env-allowlist.json).
 */
function seedSnapshot(repoRoot, id, { sha = '0'.repeat(40), dirtyPatch = '', untracked = {} } = {}) {
  const dir = path.join(repoRoot, '.data', 'run-snapshots', id);
  fs.mkdirSync(path.join(dir, 'kb', 'exports'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'untracked'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'git-sha.txt'), sha + '\n');
  fs.writeFileSync(path.join(dir, 'dirty.patch'), dirtyPatch);
  fs.writeFileSync(path.join(dir, 'submodules.json'), JSON.stringify([]));
  fs.writeFileSync(path.join(dir, 'untracked', 'list.txt'), Object.keys(untracked).join('\n') + '\n');
  for (const [rel, content] of Object.entries(untracked)) {
    const dst = path.join(dir, 'untracked', rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, content);
  }
  fs.writeFileSync(
    path.join(dir, 'kb', 'exports', 'general.json'),
    JSON.stringify({ nodes: [{ id: 'n1' }], edges: [] }),
  );
  fs.writeFileSync(path.join(dir, 'env-allowlist.json'), JSON.stringify({ NODE_ENV: 'test' }));
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ snapshot_id: id, git_sha: sha, clock_base: Date.now() }),
  );
  return dir;
}

/** True iff any `_backup-*` snapshot dir exists under `<repoRoot>/.data/run-snapshots/`. */
function backupDirs(repoRoot) {
  const base = path.join(repoRoot, '.data', 'run-snapshots');
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base).filter((n) => n.startsWith('_backup-'));
}

describe('restoreSnapshot — --in-place backup+confirm gate (D-05)', () => {
  let repoRoot;

  before(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'repro-restore-ip-'));
    seedSnapshot(repoRoot, 'task-alpha', { dirtyPatch: 'diff --git a/x b/x\n' });
  });

  after(() => {
    try {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  test('inPlace without confirm aborts AND creates the auto-backup first (T-67-05-01)', async () => {
    // Snapshot the live checkout marker BEFORE the call so we can prove no live write.
    const liveMarker = path.join(repoRoot, 'LIVE_MARKER.txt');
    fs.writeFileSync(liveMarker, 'original');

    await assert.rejects(
      () => restoreSnapshot('task-alpha', { inPlace: true, confirm: false, repoRoot, dataDir: path.join(repoRoot, '.data') }),
      /confirm|abort|in-place/i,
      'unconfirmed --in-place must reject before writing any live path',
    );

    // The auto-backup MUST have been taken BEFORE the abort check.
    assert.ok(backupDirs(repoRoot).length >= 1, 'an auto-backup snapshot dir must exist after the aborted in-place restore');

    // NO live write: the marker is untouched.
    assert.equal(fs.readFileSync(liveMarker, 'utf8'), 'original', 'live checkout marker must be unchanged');
  });

  test('confirm must be strictly true (a truthy string does not satisfy the gate)', async () => {
    await assert.rejects(
      () => restoreSnapshot('task-alpha', { inPlace: true, confirm: 'yes', repoRoot, dataDir: path.join(repoRoot, '.data') }),
      /confirm|abort|in-place/i,
      'only confirm===true may proceed; a truthy non-boolean must still abort',
    );
  });
});

describe('restoreSnapshot — error handling', () => {
  let repoRoot;

  before(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'repro-restore-err-'));
  });

  after(() => {
    try {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  test('missing snapshot dir rejects with a clear error', async () => {
    await assert.rejects(
      () => restoreSnapshot('does-not-exist', { repoRoot, dataDir: path.join(repoRoot, '.data') }),
      /not found|missing|no such|snapshot/i,
      'a missing snapshot must produce a clear error, not an obscure ENOENT stack',
    );
  });
});

describe('restoreSnapshot — source-structure invariants (mirrors acceptance greps)', () => {
  let src;

  before(() => {
    src = fs.readFileSync(RESTORE_SRC, 'utf8');
  });

  test('performs the ordered git reconstruction (worktree + submodule + apply)', () => {
    assert.match(src, /worktree/, 'worktree add step present (D-04 sandbox)');
    assert.match(src, /submodule/, 'submodule init/update step present (A2 caveat)');
    assert.match(src, /apply/, 'dirty-patch apply step present');
  });

  test('hydrates the sandbox KB via hydrateSandbox (never onto the live KB)', () => {
    assert.match(src, /hydrateSandbox/, 'restore hydrates via hydrateSandbox');
  });

  test('all git calls are fixed-argv spawnSync (no shell-string git)', () => {
    assert.match(src, /spawnSync\(\s*['"]git['"]/, 'fixed-argv spawnSync git present');
    // No child_process.exec/execSync with an interpolated git command string.
    assert.doesNotMatch(src, /\bexecSync\s*\(\s*[`'"][^`'"]*git/i, 'must not run git via a shell string');
    assert.doesNotMatch(src, /\bexec\s*\(\s*[`'"][^`'"]*git/i, 'must not run git via exec() shell string');
  });
});

// ── Live portion — REAL git worktree restore (REPRO_RESTORE_LIVE=1 ONLY) ──
describe('restoreSnapshot — live worktree restore (REPRO_RESTORE_LIVE=1)', () => {
  const LIVE = process.env.REPRO_RESTORE_LIVE === '1';
  let repoRoot;
  let capturedSha;
  let liveHeadBefore;

  before(() => {
    if (!LIVE) return;
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'repro-restore-live-'));
    const g = (...args) => spawnSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' });
    spawnSync('git', ['init', '-q', repoRoot], { encoding: 'utf8' });
    g('config', 'user.email', 'repro@test.local');
    g('config', 'user.name', 'repro');
    fs.writeFileSync(path.join(repoRoot, 'file.txt'), 'v1\n');
    g('add', '-A');
    g('commit', '-q', '-m', 'initial');
    capturedSha = g('rev-parse', 'HEAD').stdout.trim();
    liveHeadBefore = capturedSha;
    seedSnapshot(repoRoot, 'task-live', { sha: capturedSha });
  });

  after(() => {
    if (!LIVE || !repoRoot) return;
    try {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  test('restores a sandbox worktree at the captured SHA, live HEAD unchanged', { skip: !LIVE }, async () => {
    const res = await restoreSnapshot('task-live', {
      inPlace: false,
      repoRoot,
      dataDir: path.join(repoRoot, '.data'),
      // KB hydrate is best-effort; km-core may be absent — restore must still land the worktree.
    });
    assert.ok(res.worktree && fs.existsSync(res.worktree), 'sandbox worktree created');
    const wtHead = spawnSync('git', ['-C', res.worktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    assert.equal(wtHead, capturedSha, 'restored worktree HEAD == captured SHA');
    const liveHeadAfter = spawnSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    assert.equal(liveHeadAfter, liveHeadBefore, 'live checkout HEAD unchanged by default restore');
    assert.ok(typeof res.sandboxDataDir === 'string' && res.sandboxDataDir.length > 0, 'sandboxDataDir returned');
  });
});
