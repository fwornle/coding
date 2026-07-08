/**
 * Unit tests for lib/experiments/run-launch.mjs (Phase 85, Plan 85-02).
 *
 * Proves the host-side detached-spawn + process-group-cancel + pid-liveness seams WITHOUT
 * spawning a real process or signalling a real pid — every syscall boundary (spawn / kill)
 * is injected. Covers D-01 (detached fixed-argv survival) + D-08 (negated-pid group kill,
 * pid-reuse / already-gone guard).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildRunArgv,
  launchRun,
  cancelRun,
  isRunAlive,
} from '../../lib/experiments/run-launch.mjs';

// ---------------------------------------------------------------------------
// buildRunArgv — fixed-argv shape (T-85-02-01: no shell string, conditional flags)
// ---------------------------------------------------------------------------

test('buildRunArgv returns a flat Array (fixed-argv, never a shell string)', () => {
  const argv = buildRunArgv('/spec.yaml', 'run-1', '/runs/run-1');
  assert.ok(Array.isArray(argv), 'argv must be an Array (fixed-argv, not a shell string)');
  // First element is the experiment-run.mjs script path.
  assert.match(argv[0], /experiment-run\.mjs$/);
  // Required flags always present, in order.
  assert.deepEqual(argv.slice(1, 7), [
    '--spec', '/spec.yaml',
    '--run-id', 'run-1',
    '--run-dir', '/runs/run-1',
  ]);
});

test('buildRunArgv omits override flags when not provided', () => {
  const argv = buildRunArgv('/spec.yaml', 'run-1', '/runs/run-1', {});
  for (const flag of ['--rerun-of', '--repeats', '--timeout', '--variant', '--model', '--agent', '--capture-raw-bodies']) {
    assert.ok(!argv.includes(flag), `should not include ${flag} when override absent`);
  }
});

test('buildRunArgv appends override flags only when defined', () => {
  const argv = buildRunArgv('/spec.yaml', 'run-1', '/runs/run-1', {
    rerun_of: 'prev-run',
    repeats: 3,
    timeout: 1200,
    variant: 'claude-opus-gsd-open',
    model: 'opus-4.8',
    agent: 'claude',
    capture_raw_bodies: true,
  });
  const flatFind = (flag) => argv[argv.indexOf(flag) + 1];
  assert.equal(flatFind('--rerun-of'), 'prev-run');
  assert.equal(flatFind('--repeats'), '3');
  assert.equal(flatFind('--timeout'), '1200');
  assert.equal(flatFind('--variant'), 'claude-opus-gsd-open');
  assert.equal(flatFind('--model'), 'opus-4.8');
  assert.equal(flatFind('--agent'), 'claude');
  // capture_raw_bodies is a boolean flag (no value).
  assert.ok(argv.includes('--capture-raw-bodies'));
});

test('buildRunArgv treats capture_raw_bodies===false as absent', () => {
  const argv = buildRunArgv('/spec.yaml', 'run-1', '/runs/run-1', { capture_raw_bodies: false });
  assert.ok(!argv.includes('--capture-raw-bodies'));
});

test('buildRunArgv stringifies numeric override values (argv must be strings)', () => {
  const argv = buildRunArgv('/spec.yaml', 'run-1', '/runs/run-1', { repeats: 5 });
  for (const el of argv) assert.equal(typeof el, 'string', 'every argv element must be a string');
});

test('buildRunArgv maps a variants SUBSET to repeated --variant flags (Phase 85-06 / D-09)', () => {
  const argv = buildRunArgv('/spec.yaml', 'run-1', '/runs/run-1', {
    variants: ['claude-sonnet-straight-default', 'copilot-auto-straight-default'],
  });
  const positions = argv.reduce((acc, el, i) => (el === '--variant' ? [...acc, i] : acc), []);
  assert.equal(positions.length, 2, 'one --variant flag PER subset entry');
  assert.equal(argv[positions[0] + 1], 'claude-sonnet-straight-default');
  assert.equal(argv[positions[1] + 1], 'copilot-auto-straight-default');
});

test('buildRunArgv skips empty/nullish variants entries and omits the flag for an empty array', () => {
  const argv = buildRunArgv('/spec.yaml', 'run-1', '/runs/run-1', { variants: [] });
  assert.ok(!argv.includes('--variant'), 'empty subset → no --variant flag (full matrix)');
  const argv2 = buildRunArgv('/spec.yaml', 'run-1', '/runs/run-1', { variants: ['', null, 'real-variant'] });
  const positions = argv2.reduce((acc, el, i) => (el === '--variant' ? [...acc, i] : acc), []);
  assert.equal(positions.length, 1, 'blank/nullish entries are skipped');
  assert.equal(argv2[positions[0] + 1], 'real-variant');
});

// ---------------------------------------------------------------------------
// launchRun — detached + unref'd fixed-argv spawn + run.json (D-01)
// ---------------------------------------------------------------------------

function mkRunDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'run-launch-test-'));
}

test('launchRun spawns detached + unref\'d with a fixed-argv and writes run.json', async () => {
  const base = mkRunDir();
  const runDir = path.join(base, 'run-42');
  let capturedArgs;
  let unrefCalled = false;
  const fakeSpawn = (cmd, argv, opts) => {
    capturedArgs = { cmd, argv, opts };
    return { pid: 4242, unref: () => { unrefCalled = true; } };
  };

  const result = await launchRun({
    specPath: '/spec.yaml',
    runId: 'run-42',
    runDir,
    overrides: { repeats: 2 },
    env: { CODING_REPO: '/repo' },
    spawnFn: fakeSpawn,
  });

  // Spawned process.execPath (node), not a shell.
  assert.equal(capturedArgs.cmd, process.execPath);
  assert.ok(Array.isArray(capturedArgs.argv), 'argv must be a fixed Array');
  assert.equal(capturedArgs.opts.detached, true, 'detached:true required (D-01 survival)');
  assert.notEqual(capturedArgs.opts.shell, true, 'must NEVER pass shell:true');
  assert.equal(unrefCalled, true, 'unref() must be called so a launcher restart does not kill the run');
  assert.deepEqual(result, { pid: 4242, runDir });

  // run.json persisted with pid + identity.
  const runJson = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'));
  assert.equal(runJson.pid, 4242);
  assert.equal(runJson.run_id, 'run-42');
  assert.equal(runJson.spec, '/spec.yaml');
  assert.ok(typeof runJson.started_at === 'string' && runJson.started_at.length > 0);
});

test('launchRun merges the four contract env vars into the child env', async () => {
  const base = mkRunDir();
  const runDir = path.join(base, 'run-env');
  let capturedEnv;
  const fakeSpawn = (_cmd, _argv, opts) => {
    capturedEnv = opts.env;
    return { pid: 7, unref: () => {} };
  };
  await launchRun({
    specPath: '/spec.yaml',
    runId: 'run-env',
    runDir,
    env: {
      CODING_REPO: '/repo',
      LLM_PROXY_DATA_DIR: '/repo/.data',
      LLM_PROXY_PORT: '12435',
      CODING_PROXY_ROUTE: '1',
    },
    spawnFn: fakeSpawn,
  });
  assert.equal(capturedEnv.CODING_REPO, '/repo');
  assert.equal(capturedEnv.LLM_PROXY_DATA_DIR, '/repo/.data');
  assert.equal(capturedEnv.LLM_PROXY_PORT, '12435');
  assert.equal(capturedEnv.CODING_PROXY_ROUTE, '1');
});

// ---------------------------------------------------------------------------
// isRunAlive — never-throw signal-0 liveness probe
// ---------------------------------------------------------------------------

test('isRunAlive returns true for the current process', () => {
  assert.equal(isRunAlive(process.pid), true);
});

test('isRunAlive returns false for an impossible pid (never throws)', () => {
  // pid 2^31-1 is effectively guaranteed not to exist.
  assert.equal(isRunAlive(2147483646), false);
});

// ---------------------------------------------------------------------------
// cancelRun — negated-pid SIGTERM→SIGKILL escalation + guards (D-08)
// ---------------------------------------------------------------------------

test('cancelRun issues SIGTERM then SIGKILL to the NEGATED pid (process group)', async () => {
  const calls = [];
  const fakeKill = (pidArg, sig) => {
    // signal-0 liveness probe: report alive.
    if (sig === 0) return true;
    calls.push({ pidArg, sig });
  };
  const result = cancelRun({
    pid: 999,
    graceMs: 5,
    killFn: fakeKill,
    isAliveFn: () => true,
  });
  assert.deepEqual(result, { killed: true });
  // First signal is SIGTERM to the negated pid.
  assert.deepEqual(calls[0], { pidArg: -999, sig: 'SIGTERM' });
  // Wait past grace for the escalated SIGKILL.
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(calls[1], { pidArg: -999, sig: 'SIGKILL' });
});

test('cancelRun on an already-dead pid is a safe no-op', () => {
  const result = cancelRun({
    pid: 12345,
    killFn: () => { throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' }); },
    isAliveFn: () => false,
  });
  assert.deepEqual(result, { killed: false, reason: 'already-gone' });
});

test('cancelRun declines to kill when the pid-reuse guard rejects', () => {
  const calls = [];
  const result = cancelRun({
    pid: 999,
    killFn: (pidArg, sig) => calls.push({ pidArg, sig }),
    isAliveFn: () => true,
    pidLooksLikeRunner: () => false,
    runJson: { pid: 999, started_at: '2026-07-08T00:00:00Z' },
  });
  assert.deepEqual(result, { killed: false, reason: 'pid-reuse-guard' });
  assert.equal(calls.length, 0, 'must not signal when reuse guard rejects');
});
