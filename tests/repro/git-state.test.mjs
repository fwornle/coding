// tests/repro/git-state.test.mjs
//
// Phase 67, Plan 67-03 (Wave 1) — REPRO-01 internal-state capture. Golden suite for
// lib/repro/git-state.mjs (D-03 workspace capture): SHA + re-applyable binary dirty
// patch + untracked-file list + per-submodule dirty state, all via injection-safe
// fixed-argv spawnSync git (evidence-harness.mjs:153-166 idiom).
//
// Convention: node:test + node:assert/strict (established tests/experiments/ pattern —
// NOT jest globals). Builds a throwaway git repo under mkdtempSync and cleans up.
// Output via process.stderr.write only (no console.* — no-console-log, CLAUDE.md).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { captureGitState } from '../../lib/repro/git-state.mjs';

/** Run a fixed-argv git command in `cwd`, throwing on non-zero (test setup only). */
function git(cwd, args) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 15_000 });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${res.stderr || res.stdout}`);
  }
  return res.stdout;
}

describe('captureGitState', () => {
  let repoRoot;

  before(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'repro-git-state-'));
    git(repoRoot, ['init', '-q']);
    git(repoRoot, ['config', 'user.email', 'test@example.com']);
    git(repoRoot, ['config', 'user.name', 'Repro Test']);
    fs.writeFileSync(path.join(repoRoot, 'tracked.txt'), 'original line\n');
    git(repoRoot, ['add', 'tracked.txt']);
    git(repoRoot, ['commit', '-q', '-m', 'initial commit']);
    // Introduce a dirty (unstaged) edit to the tracked file.
    fs.writeFileSync(path.join(repoRoot, 'tracked.txt'), 'original line\nEDITED_MARKER_XYZ\n');
    // Introduce an untracked file.
    fs.writeFileSync(path.join(repoRoot, 'untracked-file.txt'), 'brand new\n');
  });

  after(() => {
    try {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  test('returns the expected shape', () => {
    const state = captureGitState(repoRoot);
    assert.equal(typeof state, 'object');
    assert.ok(state !== null);
    assert.ok('sha' in state);
    assert.ok('dirtyPatch' in state);
    assert.ok(Array.isArray(state.untracked), 'untracked is an array');
    assert.ok(Array.isArray(state.submodules), 'submodules is an array');
  });

  test('sha is a 40-hex commit id', () => {
    const { sha } = captureGitState(repoRoot);
    assert.match(sha, /^[0-9a-f]{40}$/);
  });

  test('dirtyPatch is non-empty and contains the edit', () => {
    const { dirtyPatch } = captureGitState(repoRoot);
    assert.equal(typeof dirtyPatch, 'string');
    assert.ok(dirtyPatch.length > 0, 'dirtyPatch should be non-empty');
    assert.ok(dirtyPatch.includes('EDITED_MARKER_XYZ'), 'dirtyPatch should contain the edit');
  });

  test('untracked contains the untracked file', () => {
    const { untracked } = captureGitState(repoRoot);
    assert.ok(untracked.includes('untracked-file.txt'), 'untracked should list the new file');
  });

  test('a repo with no submodules yields an empty submodules array (no throw)', () => {
    const { submodules } = captureGitState(repoRoot);
    assert.deepEqual(submodules, []);
  });

  test('TRUE-NEGATIVE: a non-existent repo path degrades to nulls/empties, never throws', () => {
    const bogus = path.join(os.tmpdir(), 'repro-does-not-exist-' + Date.now());
    let state;
    assert.doesNotThrow(() => {
      state = captureGitState(bogus);
    });
    assert.equal(state.sha, null);
    assert.deepEqual(state.untracked, []);
    assert.deepEqual(state.submodules, []);
  });
});
