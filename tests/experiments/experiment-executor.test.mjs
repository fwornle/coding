// tests/experiments/experiment-executor.test.mjs
//
// Phase 85, Plan 85-03 (Task 2) — contract test for the host experiment-executor
// seam (lib/experiments/experiment-executor.mjs). Proves the seam:
//   (a) run: delegates to launchRun with the exact {spec, run_id, run_dir, overrides}
//       it received and returns the pid (no real process spawned — injected fake).
//   (b) cancel: delegates to cancelRun with the pid, writes progress overall='cancelled'
//       (through the REAL run-progress.writeProgress, verified on disk), and clears the
//       run-owned active-measurement.json when its task_id belongs to the run.
//   (c) cancel: LEAVES a FOREIGN active-measurement.json (different task_id) untouched
//       (OQ3 scoping — never free an unrelated run's D-02 slot).
//
// No real process is spawned or killed: launchRun/cancelRun are injected fakes. All
// filesystem work happens under a throwaway tmp dir, never the real .data/.
//
// node:test + node:assert/strict. Output via process.stderr.write only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { runExperiment, cancelExperiment } from '../../lib/experiments/experiment-executor.mjs';
import { readProgress } from '../../lib/experiments/run-progress.mjs';

/** Make an isolated tmp run-dir + data-dir pair under the OS temp root. */
async function makeTmp(label) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `exec-${label}-`));
  const runDir = path.join(root, 'run');
  const dataDir = path.join(root, 'data');
  await fs.mkdir(runDir, { recursive: true });
  await fs.mkdir(dataDir, { recursive: true });
  return { root, runDir, dataDir, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

test('run: delegates to launchRun with the exact spec/run_id/run_dir/overrides and returns the pid', async () => {
  const { runDir, cleanup } = await makeTmp('run');
  try {
    const calls = [];
    const fakeLaunch = async (args) => {
      calls.push(args);
      return { pid: 4242, runDir: args.runDir };
    };

    const overrides = { repeats: 3, capture_raw_bodies: true };
    const result = await runExperiment({
      spec: '/abs/spec.yaml',
      run_id: 'run-abc',
      run_dir: runDir,
      overrides,
      env: { CODING_REPO: '/repo' },
      launchFn: fakeLaunch,
    });

    assert.equal(result.success, true, 'run succeeds');
    assert.equal(result.pid, 4242, 'returns the pid from launchRun');
    assert.equal(calls.length, 1, 'launchRun called exactly once');
    assert.equal(calls[0].specPath, '/abs/spec.yaml', 'spec forwarded');
    assert.equal(calls[0].runId, 'run-abc', 'run_id forwarded');
    assert.equal(calls[0].runDir, runDir, 'run_dir forwarded');
    assert.deepEqual(calls[0].overrides, overrides, 'overrides forwarded verbatim');
    assert.equal(calls[0].env.CODING_REPO, '/repo', 'host env forwarded to launchRun');
  } finally {
    await cleanup();
  }
});

test('run: HOST-side D-02 slot guard — refuses (slot_busy + holder) when a sibling run is live', async () => {
  const { root, runDir, cleanup } = await makeTmp('run-busy');
  try {
    // A sibling run dir (same runs root) whose progress.json says running + a pid
    // the injected isAliveFn reports alive.
    const siblingDir = path.join(root, 'live-sibling');
    await fs.mkdir(siblingDir, { recursive: true });
    await fs.writeFile(
      path.join(siblingDir, 'progress.json'),
      JSON.stringify({ run_id: 'live-run', pid: 7777, overall: 'running', cells: [] })
    );

    let launched = false;
    const result = await runExperiment({
      spec: '/abs/spec.yaml',
      run_id: 'run-new',
      run_dir: runDir,
      launchFn: async () => { launched = true; return { pid: 1, runDir }; },
      isAliveFn: (pid) => pid === 7777,
    });

    assert.equal(result.success, false, 'launch refused');
    assert.equal(result.slot_busy, true, 'reports slot_busy so the vkb maps a 409');
    assert.deepEqual(result.holder, { kind: 'experiment', run_id: 'live-run', pid: 7777 });
    assert.equal(launched, false, 'launchRun NEVER called while the slot is held');
  } finally {
    await cleanup();
  }
});

test('run: a stale sibling (running but DEAD pid) does not block the launch', async () => {
  const { root, runDir, cleanup } = await makeTmp('run-stale');
  try {
    const siblingDir = path.join(root, 'stale-sibling');
    await fs.mkdir(siblingDir, { recursive: true });
    await fs.writeFile(
      path.join(siblingDir, 'progress.json'),
      JSON.stringify({ run_id: 'stale-run', pid: 8888, overall: 'running', cells: [] })
    );

    const result = await runExperiment({
      spec: '/abs/spec.yaml',
      run_id: 'run-new',
      run_dir: runDir,
      launchFn: async (args) => ({ pid: 4243, runDir: args.runDir }),
      isAliveFn: () => false, // every pid is dead → stale, never a holder
    });

    assert.equal(result.success, true, 'stale run never blocks');
    assert.equal(result.pid, 4243);
  } finally {
    await cleanup();
  }
});

test('run: repo-relative seam paths resolve against the HOST repo root (never a container /coding)', async () => {
  const { runDir, cleanup } = await makeTmp('run-relpath');
  try {
    const calls = [];
    const result = await runExperiment({
      spec: 'demo.yaml', // basename → <repo>/config/experiments/demo.yaml
      run_id: 'run-rel',
      run_dir: '.data/experiments/runs/run-rel', // repo-relative seam value
      launchFn: async (args) => { calls.push(args); return { pid: 1, runDir: args.runDir }; },
      isAliveFn: () => false,
    });

    assert.equal(result.success, true);
    assert.ok(path.isAbsolute(calls[0].specPath), 'spec resolved to an absolute host path');
    assert.match(calls[0].specPath, /config[\\/]experiments[\\/]demo\.yaml$/, 'basename composed under config/experiments');
    assert.ok(path.isAbsolute(calls[0].runDir), 'run_dir resolved to an absolute host path');
    assert.ok(!calls[0].runDir.startsWith('/coding'), 'never the container root');
    assert.match(calls[0].runDir, /\.data[\\/]experiments[\\/]runs[\\/]run-rel$/);
    void runDir;
  } finally {
    await cleanup();
  }
});

test('cancel: delegates to cancelRun, writes progress overall=cancelled, clears the run-owned span', async () => {
  const { runDir, dataDir, cleanup } = await makeTmp('cancel-own');
  try {
    // Seed progress.json with an in-flight cell whose task_id OWNS the span.
    const ownTaskId = 'exp-1-run-abc--claude-default--r0';
    await fs.writeFile(
      path.join(runDir, 'progress.json'),
      JSON.stringify({
        run_id: 'run-abc',
        overall: 'running',
        cells: [{ variant: 'claude/default', rep: 0, task_id: ownTaskId, state: 'running' }],
      }, null, 2),
    );
    // Seed a matching active-measurement.json span (task_id belongs to the run).
    const spanPath = path.join(dataDir, 'active-measurement.json');
    await fs.writeFile(spanPath, JSON.stringify({ task_id: ownTaskId, started_at: 'x' }));

    const cancelCalls = [];
    const fakeCancel = (args) => {
      cancelCalls.push(args);
      return { killed: true };
    };

    const result = await cancelExperiment({
      run_id: 'run-abc',
      run_dir: runDir,
      pid: 9999,
      dataDir,
      cancelFn: fakeCancel,
      // writeProgressFn / readProgressFn default to the REAL run-progress module — the
      // test asserts the on-disk result of the real atomic write.
    });

    assert.equal(result.success, true, 'cancel succeeds');
    assert.equal(result.killed, true, 'reports the kill result from cancelRun');
    assert.equal(cancelCalls.length, 1, 'cancelRun called once');
    assert.equal(cancelCalls[0].pid, 9999, 'cancelRun called with the pid');

    // progress.json overall flipped to 'cancelled' via the REAL writeProgress.
    const progress = await readProgress(runDir);
    assert.equal(progress.overall, 'cancelled', "overall='cancelled' written via writeProgress");
    const cell = progress.cells.find((c) => c.task_id === ownTaskId);
    assert.equal(cell.state, 'abort', 'in-flight cell flipped to abort');

    // Run-owned span cleared (OQ3) so the D-02 slot frees.
    assert.equal(result.span_cleared, true, 'run-owned span reported cleared');
    await assert.rejects(fs.access(spanPath), 'active-measurement.json removed');
  } finally {
    await cleanup();
  }
});

test('cancel: LEAVES a foreign active-measurement.json (different task_id) untouched (OQ3 scoping)', async () => {
  const { runDir, dataDir, cleanup } = await makeTmp('cancel-foreign');
  try {
    const ownTaskId = 'exp-1-run-abc--claude-default--r0';
    await fs.writeFile(
      path.join(runDir, 'progress.json'),
      JSON.stringify({
        run_id: 'run-abc',
        overall: 'running',
        cells: [{ variant: 'claude/default', rep: 0, task_id: ownTaskId, state: 'running' }],
      }, null, 2),
    );
    // A FOREIGN span — belongs to a different run; MUST survive the cancel.
    const spanPath = path.join(dataDir, 'active-measurement.json');
    const foreign = { task_id: 'some-other-run--foo--r0', started_at: 'y' };
    await fs.writeFile(spanPath, JSON.stringify(foreign));

    const result = await cancelExperiment({
      run_id: 'run-abc',
      run_dir: runDir,
      pid: 1234,
      dataDir,
      cancelFn: () => ({ killed: true }),
    });

    assert.equal(result.success, true, 'cancel succeeds');
    assert.equal(result.span_cleared, false, 'foreign span NOT reported cleared');

    // The foreign span file survives untouched.
    const stillThere = JSON.parse(await fs.readFile(spanPath, 'utf8'));
    assert.deepEqual(stillThere, foreign, 'foreign active-measurement.json preserved');

    // progress overall still flips to cancelled for THIS run.
    const progress = await readProgress(runDir);
    assert.equal(progress.overall, 'cancelled', "overall='cancelled' still written");
  } finally {
    await cleanup();
  }
});

test('cancel: no real process is spawned or killed (injected fakes only)', async () => {
  const { runDir, dataDir, cleanup } = await makeTmp('cancel-nofork');
  try {
    let realKillAttempted = false;
    const result = await cancelExperiment({
      run_id: 'run-x',
      run_dir: runDir,
      pid: 7,
      dataDir,
      // Injected fake — if the seam ever called the real cancelRun/process.kill,
      // this fake would not run and the flag would stay false.
      cancelFn: () => { realKillAttempted = true; return { killed: false, reason: 'already-gone' }; },
    });
    assert.equal(realKillAttempted, true, 'cancel routed through the injected fake, not a real kill');
    assert.equal(result.success, true, 'cancel still succeeds with no cells / no span');
    assert.equal(result.span_cleared, false, 'no span to clear');
  } finally {
    await cleanup();
  }
});
