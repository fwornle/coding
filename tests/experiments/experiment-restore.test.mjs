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
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  digestRestoredState,
  restoreForCell,
  assertRepeatsIdentical,
  runVariantRepeats,
  neutralizeSandboxRules,
} from '../../lib/experiments/experiment-restore.mjs';
import { buildWorktreeAddArgs } from '../../lib/repro/restore-snapshot.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, '..', '..', 'scripts', 'experiment-restore.mjs');
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
// neutralizeSandboxRules — strip restored project-rules files (sandbox-escape fix, 2026-07-23)
// ---------------------------------------------------------------------------

test('neutralizeSandboxRules: removes CLAUDE.md / AGENTS.md / copilot-instructions and returns them', () => {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-rules-test-'));
  fs.writeFileSync(path.join(wt, 'CLAUDE.md'), 'Primary working directory: /Users/x/coding');
  fs.writeFileSync(path.join(wt, 'AGENTS.md'), 'rules');
  fs.mkdirSync(path.join(wt, '.github'), { recursive: true });
  fs.writeFileSync(path.join(wt, '.github', 'copilot-instructions.md'), 'copilot rules');
  // A non-rules file must be left untouched.
  fs.writeFileSync(path.join(wt, 'README.md'), 'keep me');

  const removed = neutralizeSandboxRules(wt);

  assert.ok(removed.includes('CLAUDE.md'));
  assert.ok(removed.includes('AGENTS.md'));
  assert.ok(removed.includes(path.join('.github', 'copilot-instructions.md')));
  assert.equal(fs.existsSync(path.join(wt, 'CLAUDE.md')), false);
  assert.equal(fs.existsSync(path.join(wt, 'AGENTS.md')), false);
  assert.equal(fs.existsSync(path.join(wt, '.github', 'copilot-instructions.md')), false);
  assert.equal(fs.existsSync(path.join(wt, 'README.md')), true, 'non-rules files are untouched');
});

test('neutralizeSandboxRules: fail-soft — no rules files present is a no-op returning []', () => {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-rules-empty-'));
  assert.deepEqual(neutralizeSandboxRules(wt), []);
});

test('neutralizeSandboxRules: an empty/undefined worktree returns [] (never throws)', () => {
  assert.deepEqual(neutralizeSandboxRules(''), []);
  assert.deepEqual(neutralizeSandboxRules(undefined), []);
});

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

test('CR-01: digestRestoredState IGNORES the non-deterministic leveldb/ subtree', () => {
  // Reproduces the real-rig failure mode: hydrateSandbox regenerates knowledge-graph/leveldb/
  // (GraphKMStore.close()) with wall-clock-stamped, sequence-numbered bytes that differ across
  // two identical restores. The proof MUST digest only the canonical exports/, so leveldb churn
  // (different bytes, added/removed files) must NOT flip the digest — else a correct restore aborts.
  const s = makeSandbox({ kbFiles: { 'exports/general.json': '{"nodes":1}' } });
  fs.mkdirSync(path.join(s.kbDir, 'leveldb'), { recursive: true });
  fs.writeFileSync(path.join(s.kbDir, 'leveldb', 'LOG'), 'ts=1000 seq=1\n');
  fs.writeFileSync(path.join(s.kbDir, 'leveldb', '000005.ldb'), 'AAAA');
  const d0 = digestRestoredState({ gitSha: 'abc', kbDir: s.kbDir, settingsPath: s.settingsPath });

  // Simulate a second restore's leveldb regeneration: different bytes + different file set.
  fs.writeFileSync(path.join(s.kbDir, 'leveldb', 'LOG'), 'ts=2000 seq=42\n');
  fs.writeFileSync(path.join(s.kbDir, 'leveldb', '000007.ldb'), 'BBBBBB');
  fs.rmSync(path.join(s.kbDir, 'leveldb', '000005.ldb'));
  const d1 = digestRestoredState({ gitSha: 'abc', kbDir: s.kbDir, settingsPath: s.settingsPath });
  assert.equal(d1, d0, 'leveldb churn must not change the digest (CR-01)');

  // But the canonical export IS still part of the proof — a one-byte change there flips it.
  fs.writeFileSync(path.join(s.kbDir, 'exports', 'general.json'), '{"nodes":2}');
  const d2 = digestRestoredState({ gitSha: 'abc', kbDir: s.kbDir, settingsPath: s.settingsPath });
  assert.notEqual(d2, d0, 'canonical exports/general.json must still be digested');
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

// ---------------------------------------------------------------------------
// Task 2: assertRepeatsIdentical (byte-identical or abort — D-11/D-12)
// ---------------------------------------------------------------------------

test('assertRepeatsIdentical returns the shared digest when all repeats match', () => {
  const shared = 'a'.repeat(64);
  const out = assertRepeatsIdentical([{ digest: shared }, { digest: shared }], { variantName: 'A' });
  assert.equal(out, shared);
});

test('assertRepeatsIdentical throws with BOTH divergent digests on mismatch', () => {
  const d1 = 'a'.repeat(64);
  const d2 = 'b'.repeat(64);
  assert.throws(
    () => assertRepeatsIdentical([{ digest: d1 }, { digest: d2 }], { variantName: 'A' }),
    (err) => err.message.includes(d1) && err.message.includes(d2),
  );
});

test('runVariantRepeats pipes matching restores through the assert and returns the digest', async () => {
  const s = makeSandbox({ kbFiles: { 'a.json': '{"n":1}' } });
  const stubRestore = async () => ({
    worktree: s.root,
    sandboxDataDir: s.dataDir,
    replayArmed: false,
    inPlace: false,
    steps: {},
  });
  const { digest, sandboxes } = await runVariantRepeats('snap-1', 2, {
    repoRoot: '/repo',
    dataDir: '/repo/.data',
    variantName: 'A',
    restore: stubRestore,
  });
  assert.match(digest, HEX64);
  assert.equal(sandboxes.length, 2);
});

test('WR-03: runVariantRepeats rejects repeats < 2 (a determinism proof needs two restores)', async () => {
  const stubRestore = async () => ({
    worktree: '/x', sandboxDataDir: '/x/.data', replayArmed: false, inPlace: false, steps: {},
  });
  await assert.rejects(
    () => runVariantRepeats('snap-1', 1, { restore: stubRestore }),
    /repeats must be an integer >= 2/,
  );
});

// ---------------------------------------------------------------------------
// Task 2: operator CLI exit-code + digest contract (EXPERIMENT_RESTORE_FAKE seam)
// ---------------------------------------------------------------------------

test('CLI exits 0 and prints the shared digest + byte-identical notice for a matching double-restore', () => {
  const res = spawnSync(process.execPath, [CLI, '--snapshot', 'fake-snap', '--repeats', '2'], {
    encoding: 'utf8',
    env: { ...process.env, EXPERIMENT_RESTORE_FAKE: 'match' },
  });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stderr, /[0-9a-f]{64}/);
  assert.match(res.stderr, /byte-identical/);
});

test('CLI exits non-zero and prints both digests for a forced divergence', () => {
  const res = spawnSync(process.execPath, [CLI, '--snapshot', 'fake-snap', '--repeats', '2'], {
    encoding: 'utf8',
    env: { ...process.env, EXPERIMENT_RESTORE_FAKE: 'diverge' },
  });
  assert.notEqual(res.status, 0);
  const digests = res.stderr.match(/[0-9a-f]{64}/g) || [];
  assert.ok(new Set(digests).size >= 2, `expected >=2 distinct digests in stderr, got: ${res.stderr}`);
});

test('CLI exits 2 when --snapshot is missing', () => {
  const res = spawnSync(process.execPath, [CLI, '--repeats', '2'], {
    encoding: 'utf8',
    env: { ...process.env },
  });
  assert.equal(res.status, 2);
});

test('WR-03: CLI exits 2 on --repeats 1 (vacuous determinism proof rejected)', () => {
  const res = spawnSync(process.execPath, [CLI, '--snapshot', 'fake-snap', '--repeats', '1'], {
    encoding: 'utf8',
    env: { ...process.env, EXPERIMENT_RESTORE_FAKE: 'match' },
  });
  assert.equal(res.status, 2, res.stderr);
  assert.match(res.stderr, /at least two restores/);
});

// ── Phase 87 (AVN-05): avenueMode branch option threaded through the rig (hermetic — argv only) ──

test('AVN-05: buildWorktreeAddArgs emits --detach by default (regression anchor)', () => {
  const args = buildWorktreeAddArgs({ worktree: '/wt', sha: 'abc123' });
  assert.deepEqual(args, ['worktree', 'add', '--detach', '/wt', 'abc123']);
});

test('AVN-05: buildWorktreeAddArgs emits -b <branch> when avenueMode requested', () => {
  const args = buildWorktreeAddArgs({ worktree: '/wt', sha: 'abc123', avenueMode: true, branchName: 'avenue/task-9' });
  assert.deepEqual(args, ['worktree', 'add', '-b', 'avenue/task-9', '/wt', 'abc123']);
});

test('AVN-05: avenueMode without a branchName falls back to the detached default', () => {
  const args = buildWorktreeAddArgs({ worktree: '/wt', sha: 'abc123', avenueMode: true, branchName: '' });
  assert.deepEqual(args, ['worktree', 'add', '--detach', '/wt', 'abc123']);
});

test('AVN-05: restoreForCell threads avenueMode+branchName into the rig call', async () => {
  let seen = null;
  const restoreStub = async (id, o) => {
    seen = o;
    // Minimal shape restoreForCell needs: a non-git worktree so gitHead → '' (no .git → no throw).
    return { worktree: fs.mkdtempSync(path.join(os.tmpdir(), 'avn-cell-')), sandboxDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'avn-sb-')) };
  };
  await restoreForCell('snap-1', { avenueMode: true, branchName: 'avenue/task-7', restore: restoreStub });
  assert.equal(seen.avenueMode, true);
  assert.equal(seen.branchName, 'avenue/task-7');
  assert.equal(seen.inPlace, false, 'restoreForCell must never select the destructive in-place path');
});

test('AVN-05: restoreForCell omits avenue opts when not requested (detached default preserved)', async () => {
  let seen = null;
  const restoreStub = async (id, o) => {
    seen = o;
    return { worktree: fs.mkdtempSync(path.join(os.tmpdir(), 'avn-cell-')), sandboxDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'avn-sb-')) };
  };
  await restoreForCell('snap-1', { restore: restoreStub });
  assert.equal(seen.avenueMode, undefined, 'no avenueMode leaks onto the default restore call');
  assert.equal(seen.branchName, undefined, 'no branchName leaks onto the default restore call');
});
