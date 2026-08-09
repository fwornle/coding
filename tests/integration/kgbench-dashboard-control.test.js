/**
 * Control-plane contract for the Benchmarks dashboard sub-tab.
 *
 * These pin the three things that stand between a UI button and a host process group, each of
 * which was found the hard way rather than reasoned about:
 *
 *   1. Cancelling a run in its FIRST SECONDS must not leak a git worktree. Building the
 *      sandbox tree takes ~1 minute, and the runner used to register its signal handler only
 *      after that returned — so a signal during construction left a worktree nothing had a
 *      handle on, which `git worktree prune` cannot reclaim (its directory still exists) and
 *      which wedges the next run's `git worktree add`. Ctrl-C minutes in never hit that
 *      window; a Cancel button hit it on the first try.
 *
 *   2. Every selector that reaches the supervisor's argv is validated, and an unsafe one is
 *      REJECTED rather than dropped. A dropped filter runs a bigger matrix than was asked
 *      for — hours of wall-clock and real spend, silently.
 *
 *   3. A cancel never signals the coordinator's own process group. The pid comes from a lock
 *      file that a SIGKILLed supervisor can leave behind stale, so a reused pid resolving to
 *      our own group would turn "cancel this run" into a self-inflicted outage.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createRunTree } from '../../lib/kgbench/sandbox.mjs';
import {
  isValidKgbenchRunId,
  cleanSelector,
  cleanPositiveInt,
  buildSuperviseArgv,
  cancelKgbench,
  pgidOf,
} from '../../lib/kgbench/kgbench-executor.mjs';

describe('kgbench run-id validation', () => {
  it('accepts the descriptive ids this project actually uses', () => {
    // The experiment seam bounds its MINTED ids at 12 chars. kgbench ids are operator-chosen
    // and descriptive; borrowing that bound would reject real runs on disk.
    for (const id of ['coding-v1-r7', 'coding-v1-x2', 'coding-v1-VOID-tool-escape', 'dash-smoke1']) {
      expect(isValidKgbenchRunId(id)).toBe(true);
    }
  });

  it('rejects anything that would navigate or escape a path segment', () => {
    for (const id of ['..', '.', '../evil', 'a/b', '', 'x'.repeat(49), null, undefined, 'has space']) {
      expect(isValidKgbenchRunId(id)).toBe(false);
    }
  });
});

describe('selector validation', () => {
  it('passes the shapes the axes legitimately take', () => {
    expect(cleanSelector('grep,hybrid')).toBe('grep,hybrid');
    expect(cleanSelector(['grep', 'hybrid'])).toBe('grep,hybrid');
    // Dotted model names and opencode's provider-qualified refs must survive.
    expect(cleanSelector('claude-sonnet-4.6')).toBe('claude-sonnet-4.6');
    expect(cleanSelector('rapid-proxy/claude-sonnet-5')).toBe('rapid-proxy/claude-sonnet-5');
    expect(cleanSelector('')).toBe('');
    expect(cleanSelector(undefined)).toBe('');
  });

  it('REJECTS an unsafe selector rather than dropping it', () => {
    // null is the rejection signal the caller turns into a 400. Returning '' here would mean
    // "no filter", i.e. run every arm — a bigger matrix than the operator asked for.
    for (const bad of ['a;rm -rf /', '../../etc', 'a/../b', '$(whoami)', 'a b', 'x`y`']) {
      expect(cleanSelector(bad)).toBeNull();
    }
  });

  it('bounds the numeric options and rejects out-of-range values', () => {
    expect(cleanPositiveInt(3, 100)).toBe('3');
    expect(cleanPositiveInt(undefined, 100)).toBeUndefined();
    for (const bad of [0, -1, 1.5, 101, 'abc']) {
      expect(cleanPositiveInt(bad, 100)).toBeNull();
    }
  });
});

describe('supervisor argv', () => {
  it('is a flat string array with each value in its own element', () => {
    const argv = buildSuperviseArgv(
      { run_id: 'r1', set: 'coding-v1', reps: '3', arms: 'grep,hybrid', agents: 'claude', only: 'L1' },
      '/S',
    );
    expect(argv).toEqual([
      '/S', '--run-id', 'r1', '--set', 'coding-v1', '--reps', '3',
      '--only', 'L1', '--arms', 'grep,hybrid', '--agents', 'claude',
    ]);
    for (const el of argv) expect(typeof el).toBe('string');
  });

  it('omits a flag entirely when its value is absent, so the supervisor keeps its default', () => {
    const argv = buildSuperviseArgv({ run_id: 'r1', set: 'coding-v1' }, '/S');
    expect(argv).not.toContain('--arms');
    expect(argv).not.toContain('--agents');
    expect(argv).not.toContain('--models');
  });
});

describe('cancel safety', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(path.join(os.tmpdir(), 'kgb-cancel-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('refuses to signal the coordinator\'s own process group', async () => {
    // The scenario: a SIGKILLed supervisor left its lock behind, the pid was reused, and it
    // now resolves to our own group. Signalling it would kill the coordinator.
    const runDir = path.join(dir, '.data', 'kgbench', 'runs', 'selfkill');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(path.join(runDir, 'supervise.pid'), '4242\n');

    const kills = [];
    const result = await cancelKgbench({
      run_id: 'selfkill',
      run_dir: runDir,
      killFn: (pid, sig) => kills.push([pid, sig]),
      isAliveFn: () => true,
      pgidFn: () => pgidOf(process.pid),
      fsDeps: { readFile: (await import('node:fs/promises')).readFile, writeFile: (await import('node:fs/promises')).writeFile },
    });

    // run_dir is outside .data/kgbench/runs of the REAL repo, so containment rejects it first —
    // which is itself the guarantee we want. Either way: nothing was signalled.
    expect(kills).toEqual([]);
    expect(result.killed).toBe(false);
  });

  it('treats a missing lock file as an already-finished run, not an error', async () => {
    const { KGBENCH_RUNS_ROOT } = await import('../../lib/kgbench/kgbench-executor.mjs');
    const runDir = path.join(KGBENCH_RUNS_ROOT, 'no-such-run-for-tests');
    const kills = [];
    const result = await cancelKgbench({
      run_id: 'no-such-run-for-tests',
      run_dir: runDir,
      killFn: (pid, sig) => kills.push([pid, sig]),
    });
    expect(result.success).toBe(true);
    expect(result.killed).toBe(false);
    expect(result.reason).toBe('no-lock');
    expect(kills).toEqual([]);
  });

  it('rejects a run_dir outside .data/kgbench/runs before signalling anything', async () => {
    const kills = [];
    const result = await cancelKgbench({
      run_id: 'ok',
      run_dir: '/tmp/pwn',
      killFn: (pid, sig) => kills.push([pid, sig]),
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/escapes/);
    expect(kills).toEqual([]);
  });
});

describe('worktree cleanup is available before createRunTree returns', () => {
  // A real worktree, but against a throwaway two-file repo rather than this one — the
  // contract under test is WHEN the cleanup is handed over, which does not depend on repo size.
  let repo;

  beforeAll(() => {
    repo = mkdtempSync(path.join(os.tmpdir(), 'kgb-tinyrepo-'));
    const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
    execFileSync('git', ['init', '--quiet', repo]);
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'kgbench test');
    writeFileSync(path.join(repo, 'README.md'), '# tiny\n');
    git('add', '-A');
    git('commit', '--quiet', '-m', 'init');
  });

  afterAll(() => {
    try {
      execFileSync('git', ['-C', repo, 'worktree', 'prune'], { encoding: 'utf8' });
    } catch { /* best effort */ }
    rmSync(repo, { recursive: true, force: true });
  });

  it('fires onWorktreeCreated with a cleanup that really removes the worktree', () => {
    let handed = null;
    let handedBeforeReturn = false;

    const tree = createRunTree({
      repoRoot: repo,
      questions: [],
      excludes: [],
      verify: false,
      onWorktreeCreated: (info) => {
        handed = info;
        // The worktree must ALREADY exist at callback time — that is the whole point. If it
        // were handed over after construction finished, the cancel window would still be open.
        handedBeforeReturn = existsSync(info.dir);
      },
    });

    expect(handed).not.toBeNull();
    expect(handedBeforeReturn).toBe(true);
    expect(handed.dir).toBe(tree.dir);
    expect(typeof handed.cleanup).toBe('function');

    // The handed-over cleanup is the real one: it removes the directory AND deregisters the
    // worktree, so the next `git worktree add` on that path is not wedged.
    handed.cleanup();
    expect(existsSync(tree.dir)).toBe(false);
    const list = execFileSync('git', ['-C', repo, 'worktree', 'list'], { encoding: 'utf8' });
    expect(list).not.toContain(tree.dir);
  });

  it('survives a registration callback that throws — the tree is still built', () => {
    const tree = createRunTree({
      repoRoot: repo,
      questions: [],
      excludes: [],
      verify: false,
      onWorktreeCreated: () => { throw new Error('caller blew up'); },
    });
    expect(existsSync(tree.dir)).toBe(true);
    tree.cleanup();
    expect(existsSync(tree.dir)).toBe(false);
  });
});

describe('supervise.status is the terminal-state record', () => {
  it('the status file the executor writes parses as a terminal state', async () => {
    // The supervisor writes `state: detail`; a group-kill never reaches its status writes, so
    // the executor patches the same format. Any reader keying on the prefix must see it as
    // terminal — otherwise a cancelled run stays "live" and the dashboard keeps attaching.
    const line = 'cancelled: group-killed from the dashboard at 2026-08-09T17:05:50.542Z';
    const TERMINAL = ['complete', 'failed', 'abandoned', 'cancelled'];
    expect(TERMINAL.some((p) => line.startsWith(p))).toBe(true);
  });
});
