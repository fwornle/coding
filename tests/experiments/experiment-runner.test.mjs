// tests/experiments/experiment-runner.test.mjs
//
// RUN-02/03/04 proof for lib/experiments/experiment-runner.mjs — the sequential,
// idempotent, resumable cross-agent matrix loop.
//
// Task 1: launchCell — the terminal-state machine (spawn + 20-min SIGTERM→SIGKILL timer):
//         exit0→complete, exitN→abort, hang→timeout; cwd=worktree, env.LLM_PROXY_DATA_DIR;
//         async (a hung agent does not block the returned promise before the timer fires).
// Task 2: runCell — restore → measured span → launch → inline score in a finally (no cell
//         dropped on abort/timeout; fixed-argv child processes for start/stop).
// Task 3: runMatrix — strictly-sequential idempotent loop, resume done-set (skip only
//         complete; retry timeout/abort), copilot probe gate + recorded skip-Run, and
//         best-effort agent-failure recording.
//
// Pure unit suite: every side-effecting collaborator (restore, agent spawn, measurement
// start/stop, resume ledger, copilot probe, store) is an INJECTED seam. The one real
// child process is the stub-agent fixture, used only for the terminal-state mapping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

import { launchCell, runCell, runMatrix } from '../../lib/experiments/experiment-runner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STUB = path.resolve(__dirname, '_fixtures', 'stub-agent.mjs');

// A fake child_process handle: an EventEmitter with a spy .kill(). Tests drive terminal
// states by emitting 'exit'/'error' explicitly, so no real process or timer is needed.
function fakeChild() {
  const child = new EventEmitter();
  child.killed = [];
  child.kill = (sig) => { child.killed.push(sig); return true; };
  return child;
}

// ---------------------------------------------------------------------------
// Task 1: launchCell — terminal-state machine
// ---------------------------------------------------------------------------

test('launchCell: a stub agent exiting 0 resolves terminal_state complete', async () => {
  const state = await launchCell({
    bin: process.execPath,
    argv: [STUB, 'exit0'],
    worktree: process.cwd(),
    sandboxDataDir: path.join(process.cwd(), '.data'),
    stdio: 'ignore',
  });
  assert.equal(state, 'complete');
});

test('launchCell: a stub agent exiting non-zero resolves abort', async () => {
  const state = await launchCell({
    bin: process.execPath,
    argv: [STUB, 'exitN'],
    worktree: process.cwd(),
    sandboxDataDir: path.join(process.cwd(), '.data'),
    stdio: 'ignore',
  });
  assert.equal(state, 'abort');
});

test('launchCell: a hanging stub is SIGTERM-killed after the timeout and resolves timeout', async () => {
  const state = await launchCell({
    bin: process.execPath,
    argv: [STUB, 'hang'],
    worktree: process.cwd(),
    sandboxDataDir: path.join(process.cwd(), '.data'),
    timeoutMs: 150, // test-shortened wall-clock timer
    graceMs: 150,
    stdio: 'ignore',
  });
  assert.equal(state, 'timeout');
});

test('launchCell: child is spawned with cwd=worktree and env.LLM_PROXY_DATA_DIR=sandboxDataDir', async () => {
  let capturedOpts = null;
  const fakeSpawn = (_bin, _argv, opts) => {
    capturedOpts = opts;
    const child = fakeChild();
    setImmediate(() => child.emit('exit', 0, null));
    return child;
  };
  const state = await launchCell({
    bin: 'agent-bin',
    argv: ['-p', 'goal'],
    worktree: '/sandbox/worktree',
    sandboxDataDir: '/sandbox/worktree/.data',
    spawn: fakeSpawn,
  });
  assert.equal(state, 'complete');
  assert.equal(capturedOpts.cwd, '/sandbox/worktree');
  assert.equal(capturedOpts.env.LLM_PROXY_DATA_DIR, '/sandbox/worktree/.data');
});

test('launchCell: uses async spawn — a hanging agent does not block the returned promise', async () => {
  // A fake child that never emits exit: the returned promise must stay pending. Race it
  // against a short sentinel; the sentinel MUST win (the launch promise did not resolve).
  const fakeSpawn = () => fakeChild();
  const launch = launchCell({
    bin: 'agent-bin',
    argv: [],
    worktree: '/w',
    sandboxDataDir: '/w/.data',
    // Longer than the sentinel so the launch promise is provably still pending when the
    // sentinel wins; short + tiny grace so no timer dangles past the test (the fake child
    // never emits exit, so the promise settling is irrelevant — only non-blocking matters).
    timeoutMs: 300,
    graceMs: 5,
    spawn: fakeSpawn,
  });
  const sentinel = new Promise((r) => setTimeout(() => r('pending'), 50));
  const winner = await Promise.race([launch.then(() => 'resolved'), sentinel]);
  assert.equal(winner, 'pending');
});

// ---------------------------------------------------------------------------
// Task 2: runCell — restore → measured span → launch → inline score in a finally
// ---------------------------------------------------------------------------

const AGENTS_DIR = path.resolve(__dirname, '..', '..', 'config', 'agents');
const CELL = { agent: 'claude', model: 'sonnet', framework: 'none', env: 'default' };

// Build a runCell invocation with recording seams; `terminal` sets the fake agent result.
function runCellWith({ terminal = 'complete', cell = CELL, taskClass } = {}) {
  const calls = [];
  const restore = async () => ({ worktree: '/wt', sandboxDataDir: '/wt/.data' });
  const runMeasurement = async (phase, argv, o) => {
    calls.push({ phase, argv, env: o?.env });
    return 0;
  };
  const spawnAgent = async () => terminal;
  const promise = runCell({
    cell,
    rep: 0,
    expId: 'exp1',
    goal: 'do a thing',
    snapshotId: 'snap-1',
    taskClass,
    agentsDir: AGENTS_DIR,
    restore,
    runMeasurement,
    spawnAgent,
  });
  return { promise, calls };
}

test('runCell: restores then measurement-start with composite task_id + variant/repeat/agent + sandbox env', async () => {
  const { promise, calls } = runCellWith({ terminal: 'complete' });
  const res = await promise;
  const start = calls.find((c) => c.phase === 'start');
  assert.ok(start, 'measurement-start was invoked');
  const a = start.argv;
  assert.ok(Array.isArray(a), 'start argv is a fixed array (no shell string)');
  assert.equal(a[a.indexOf('--task-id') + 1], 'exp1--claude-sonnet-none-default--r0');
  assert.equal(a[a.indexOf('--variant') + 1], 'claude-sonnet-none-default');
  assert.equal(a[a.indexOf('--repeat') + 1], '0');
  assert.equal(a[a.indexOf('--agent') + 1], 'claude');
  assert.equal(a[a.indexOf('--model') + 1], 'sonnet');
  assert.equal(a[a.indexOf('--framework') + 1], 'none');
  assert.ok(a.includes('--goal'));
  assert.equal(start.env.LLM_PROXY_DATA_DIR, '/wt/.data');
  assert.equal(res.terminalState, 'complete');
});

test('runCell: on complete, measurement-stop runs once with --headless --terminal-state complete + sandbox env', async () => {
  const { promise, calls } = runCellWith({ terminal: 'complete' });
  await promise;
  const stops = calls.filter((c) => c.phase === 'stop');
  assert.equal(stops.length, 1);
  assert.ok(stops[0].argv.includes('--headless'));
  assert.equal(stops[0].argv[stops[0].argv.indexOf('--terminal-state') + 1], 'complete');
  assert.equal(stops[0].env.LLM_PROXY_DATA_DIR, '/wt/.data');
});

test('runCell: on abort, measurement-stop STILL runs (finally) with the mapped --terminal-state abort', async () => {
  const { promise, calls } = runCellWith({ terminal: 'abort' });
  const res = await promise;
  const stops = calls.filter((c) => c.phase === 'stop');
  assert.equal(stops.length, 1, 'no cell dropped — stop runs on abort too');
  assert.equal(stops[0].argv[stops[0].argv.indexOf('--terminal-state') + 1], 'abort');
  assert.equal(res.terminalState, 'abort');
});

test('runCell: on timeout, measurement-stop STILL runs with --terminal-state timeout', async () => {
  const { promise, calls } = runCellWith({ terminal: 'timeout' });
  await promise;
  const stops = calls.filter((c) => c.phase === 'stop');
  assert.equal(stops[0].argv[stops[0].argv.indexOf('--terminal-state') + 1], 'timeout');
});

test('runCell: start + stop are fixed-argv arrays of strings (no shell string) and carry --task-class when set', async () => {
  const { promise, calls } = runCellWith({ terminal: 'complete', taskClass: 'feature' });
  await promise;
  for (const c of calls) {
    assert.ok(Array.isArray(c.argv), `${c.phase} argv is an array`);
    for (const el of c.argv) assert.equal(typeof el, 'string', `${c.phase} argv element is a string`);
  }
  const stop = calls.find((c) => c.phase === 'stop');
  assert.equal(stop.argv[stop.argv.indexOf('--task-class') + 1], 'feature');
});
