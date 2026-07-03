// tests/experiments/experiment-restore.test.mjs
// RUN-01 / SC#4 proof for lib/experiments/experiment-restore.mjs.
//
// Task 1: digestRestoredState determinism + order-invariance + one-byte sensitivity,
//         and restoreForCell wiring the shipped rig with inPlace:false (D-10 sandbox).
// Task 2: assertRepeatsIdentical byte-identical-or-abort (D-11/D-12) + the operator CLI
//         (scripts/experiment-restore.mjs) match/divergence exit-code contract.
//
// Pure unit suite for the digest/assert logic — no real snapshot, no real git worktree:
// the restore seam is an injected stub. The CLI behaviours are driven end-to-end via
// spawnSync of the script under an EXPERIMENT_RESTORE_FAKE seam so no live restore runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  digestRestoredState,
  restoreForCell,
} from '../../lib/experiments/experiment-restore.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HEX64 = /^[0-9a-f]{64}$/;

/** Make a throwaway sandbox `.data` tree with a KB dir + llm-settings.json. */
function makeSandbox({ kbFiles = {}, settings = '{}' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-restore-test-'));
  const dataDir = path.join(root, '.data');
  const kbDir = path.join(dataDir, 'knowledge-graph');
  fs.mkdirSync(kbDir, { recursive: true });
  for (const [rel, content] of Object.entries(kbFiles)) {
    const dst = path.join(kbDir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, content);
  }
  if (settings !== null) fs.writeFileSync(path.join(dataDir, 'llm-settings.json'), settings);
  return { root, dataDir, kbDir, settingsPath: path.join(dataDir, 'llm-settings.json') };
}

// ---------------------------------------------------------------------------
// Task 1: digestRestoredState
// ---------------------------------------------------------------------------

test('digestRestoredState returns a stable 64-char hex sha256 over identical bytes', () => {
  const s = makeSandbox({ kbFiles: { 'a.json': '{"n":1}', 'b.json': '{"n":2}' } });
  const d1 = digestRestoredState({ gitSha: 'abc', kbDir: s.kbDir, settingsPath: s.settingsPath });
  const d2 = digestRestoredState({ gitSha: 'abc', kbDir: s.kbDir, settingsPath: s.settingsPath });
  assert.match(d1, HEX64);
  assert.equal(d1, d2);
});

test('digestRestoredState is invariant to file creation/read order (sorted manifest)', () => {
  // Two sandboxes with the SAME file contents written in a DIFFERENT sequence.
  const a = makeSandbox({ kbFiles: {} });
  fs.writeFileSync(path.join(a.kbDir, 'a.json'), '{"n":1}');
  fs.writeFileSync(path.join(a.kbDir, 'z.json'), '{"n":26}');
  const b = makeSandbox({ kbFiles: {} });
  fs.writeFileSync(path.join(b.kbDir, 'z.json'), '{"n":26}');
  fs.writeFileSync(path.join(b.kbDir, 'a.json'), '{"n":1}');

  const da = digestRestoredState({ gitSha: 'abc', kbDir: a.kbDir, settingsPath: a.settingsPath });
  const db = digestRestoredState({ gitSha: 'abc', kbDir: b.kbDir, settingsPath: b.settingsPath });
  assert.equal(da, db);
});

test('digestRestoredState changes when a single KB byte changes', () => {
  const base = makeSandbox({ kbFiles: { 'a.json': '{"n":1}' } });
  const d0 = digestRestoredState({ gitSha: 'abc', kbDir: base.kbDir, settingsPath: base.settingsPath });
  fs.writeFileSync(path.join(base.kbDir, 'a.json'), '{"n":2}'); // one byte differs
  const d1 = digestRestoredState({ gitSha: 'abc', kbDir: base.kbDir, settingsPath: base.settingsPath });
  assert.notEqual(d0, d1);
});

test('digestRestoredState changes when the git_sha changes', () => {
  const s = makeSandbox({ kbFiles: { 'a.json': '{"n":1}' } });
  const d0 = digestRestoredState({ gitSha: 'abc', kbDir: s.kbDir, settingsPath: s.settingsPath });
  const d1 = digestRestoredState({ gitSha: 'def', kbDir: s.kbDir, settingsPath: s.settingsPath });
  assert.notEqual(d0, d1);
});

test('digestRestoredState changes when the routing config changes', () => {
  const s = makeSandbox({ kbFiles: { 'a.json': '{"n":1}' }, settings: '{"a":1}' });
  const d0 = digestRestoredState({ gitSha: 'abc', kbDir: s.kbDir, settingsPath: s.settingsPath });
  fs.writeFileSync(s.settingsPath, '{"a":2}');
  const d1 = digestRestoredState({ gitSha: 'abc', kbDir: s.kbDir, settingsPath: s.settingsPath });
  assert.notEqual(d0, d1);
});

test('digestRestoredState does not throw on an absent kbDir or settingsPath', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-restore-absent-'));
  const d = digestRestoredState({
    gitSha: 'abc',
    kbDir: path.join(root, 'no-such-kb'),
    settingsPath: path.join(root, 'no-such-settings.json'),
  });
  assert.match(d, HEX64);
});

// ---------------------------------------------------------------------------
// Task 1: restoreForCell wires the rig with inPlace:false (D-10)
// ---------------------------------------------------------------------------

test('restoreForCell invokes the injected restore with inPlace:false and returns a digest', async () => {
  const s = makeSandbox({ kbFiles: { 'a.json': '{"n":1}' } });
  let capturedOpts = null;
  const stubRestore = async (snapshotId, opts) => {
    capturedOpts = opts;
    return {
      worktree: s.root, // not a git repo → git_sha resolves to '' fail-soft
      sandboxDataDir: s.dataDir,
      replayArmed: false,
      inPlace: false,
      steps: {},
    };
  };

  const r = await restoreForCell('snap-1', {
    repoRoot: '/repo',
    dataDir: '/repo/.data',
    restore: stubRestore,
  });

  assert.equal(capturedOpts.inPlace, false);
  assert.notEqual(capturedOpts.inPlace, true);
  assert.equal(r.sandboxDataDir, s.dataDir);
  assert.equal(r.worktree, s.root);
  assert.match(r.digest, HEX64);
});
