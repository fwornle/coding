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
    timeoutMs: 60_000, // long — will not fire during the test
    spawn: fakeSpawn,
  });
  const sentinel = new Promise((r) => setTimeout(() => r('pending'), 50));
  const winner = await Promise.race([launch.then(() => 'resolved'), sentinel]);
  assert.equal(winner, 'pending');
});
