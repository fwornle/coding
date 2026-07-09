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
import { fileURLToPath } from 'node:url';

import { runExperiment, cancelExperiment } from '../../lib/experiments/experiment-executor.mjs';
import { readProgress } from '../../lib/experiments/run-progress.mjs';

// CR-01 (Phase 85 REVIEW): the executor now asserts run_dir CONTAINMENT under
// <REPO_ROOT>/.data/experiments/runs/ before any fs sink. So the contract test must drive
// its run dirs THERE (unique per test), not under os.tmpdir(). The data-dir stays a throwaway
// tmp dir (span clear is injected/pinned separately).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RUNS_ROOT = path.resolve(REPO_ROOT, '.data', 'experiments', 'runs');

/**
 * Make an isolated run-dir UNDER the real runs root (CR-01 containment) + a throwaway
 * tmp data-dir. The run_id is a short minted-shape token (≤12 [A-Za-z0-9._-]) so it also
 * passes the CR-01 run_id validation.
 */
async function makeTmp(label) {
  // Nest each test under its OWN scan root inside the runs root:
  //   <RUNS_ROOT>/<testScope>/<runId>
  // so findLiveRunHolder's sibling scan (path.dirname(runDir) = <RUNS_ROOT>/<testScope>) is
  // ISOLATED from any concurrent real run under <RUNS_ROOT> directly, while still passing the
  // CR-01 containment assertion (everything is under <RUNS_ROOT>).
  const testScope = `test-${label}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;
  const scopeRoot = path.join(RUNS_ROOT, testScope);
  const runId = 'run-abc';
  const runDir = path.join(scopeRoot, runId);
  await fs.mkdir(runDir, { recursive: true });
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), `exec-data-${testScope}-`));
  return {
    runId,
    scopeRoot,
    runDir,
    dataDir,
    // Cleanup removes ONLY this test's scope + its data dir, never the shared runs root.
    cleanup: async () => {
      await fs.rm(scopeRoot, { recursive: true, force: true });
      await fs.rm(dataDir, { recursive: true, force: true });
    },
  };
}

/** Seed a run.json with a pid so the CR-02 ownership check passes for cancel tests. */
async function seedRunJson(runDir, runId, pid) {
  await fs.writeFile(
    path.join(runDir, 'run.json'),
    JSON.stringify({ run_id: runId, pid, spec: '/abs/spec.yaml', started_at: new Date().toISOString() }, null, 2),
  );
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
  const { scopeRoot, runDir, cleanup } = await makeTmp('run-busy');
  try {
    // A sibling run dir (same scan root) whose progress.json says running + a pid
    // the injected isAliveFn reports alive.
    const siblingDir = path.join(scopeRoot, 'live-sibling');
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
  const { scopeRoot, runDir, cleanup } = await makeTmp('run-stale');
  try {
    const siblingDir = path.join(scopeRoot, 'stale-sibling');
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
  const { runId, runDir, dataDir, cleanup } = await makeTmp('cancel-own');
  try {
    // CR-02: seed run.json with the pid the cancel will present (ownership check).
    await seedRunJson(runDir, runId, 9999);
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
  const { runId, runDir, dataDir, cleanup } = await makeTmp('cancel-foreign');
  try {
    await seedRunJson(runDir, runId, 1234);
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
  const { runId, runDir, dataDir, cleanup } = await makeTmp('cancel-nofork');
  try {
    await seedRunJson(runDir, runId, 7);
    let realKillAttempted = false;
    const result = await cancelExperiment({
      run_id: runId,
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

// ---------------------------------------------------------------------------
// CR-01 (Phase 85 REVIEW): run_id/run_dir validation + containment BEFORE any fs sink.
// ---------------------------------------------------------------------------

test('CR-01 run: a traversal run_dir is REJECTED and launchRun is NEVER called', async () => {
  let launched = false;
  const result = await runExperiment({
    spec: '/abs/spec.yaml',
    run_id: 'run-abc',
    run_dir: '../../../../tmp/pwn', // escapes .data/experiments/runs/
    launchFn: async () => { launched = true; return { pid: 1, runDir: '/tmp/pwn' }; },
    isAliveFn: () => false,
  });
  assert.equal(result.success, false, 'launch refused');
  assert.match(result.message, /escapes/, 'reports the containment violation');
  assert.equal(launched, false, 'launchRun NEVER called — no mkdir/write on an out-of-tree path');
});

test('CR-01 run: an absolute out-of-tree run_dir is REJECTED', async () => {
  let launched = false;
  const result = await runExperiment({
    spec: '/abs/spec.yaml',
    run_id: 'run-abc',
    run_dir: '/tmp/evil-run',
    launchFn: async () => { launched = true; return { pid: 1, runDir: '/tmp/evil-run' }; },
    isAliveFn: () => false,
  });
  assert.equal(result.success, false, 'absolute out-of-tree run_dir refused');
  assert.equal(launched, false, 'launchRun never called');
});

test('CR-01 run: a bad-charset run_id is REJECTED before any fs work', async () => {
  let launched = false;
  const result = await runExperiment({
    spec: '/abs/spec.yaml',
    run_id: '../../etc',
    run_dir: '.data/experiments/runs/ok',
    launchFn: async () => { launched = true; return { pid: 1, runDir: 'x' }; },
    isAliveFn: () => false,
  });
  assert.equal(result.success, false, 'invalid run_id refused');
  assert.match(result.message, /invalid run_id/, 'reports the run_id rejection');
  assert.equal(launched, false, 'launchRun never called');
});

test('CR-01 cancel: a traversal run_dir is REJECTED and cancelRun is NEVER called', async () => {
  let killed = false;
  const result = await cancelExperiment({
    run_id: 'run-abc',
    run_dir: '../../../../tmp/pwn',
    pid: 4242,
    cancelFn: () => { killed = true; return { killed: true }; },
  });
  assert.equal(result.success, false, 'cancel refused');
  assert.match(result.message, /escapes/, 'reports the containment violation');
  assert.equal(killed, false, 'cancelRun NEVER called — no arbitrary group-kill on a crafted path');
});

// ---------------------------------------------------------------------------
// CR-02 (Phase 85 REVIEW): pid must match the run's OWN run.json.pid before any group-kill.
// ---------------------------------------------------------------------------

test('CR-02 cancel: a pid that does NOT match run.json.pid is REFUSED (no group-kill)', async () => {
  const { runId, runDir, dataDir, cleanup } = await makeTmp('cancel-pid-mismatch');
  try {
    await seedRunJson(runDir, runId, 5000); // the run OWNS pid 5000
    let killed = false;
    const result = await cancelExperiment({
      run_id: runId,
      run_dir: runDir,
      pid: 9999, // attacker-supplied pid — NOT this run's pid
      dataDir,
      cancelFn: () => { killed = true; return { killed: true }; },
    });
    assert.equal(result.success, false, 'cancel refused on pid mismatch');
    assert.equal(result.pid_mismatch, true, 'flags pid_mismatch so the coordinator maps a 409');
    assert.match(result.message, /does not match run\.json\.pid/, 'reports the mismatch');
    assert.equal(killed, false, 'cancelRun NEVER called — never group-kill an unowned pid');
  } finally {
    await cleanup();
  }
});

test('CR-02 cancel: a missing run.json REFUSES the cancel (never signal an unrecorded pid)', async () => {
  const { runId, runDir, dataDir, cleanup } = await makeTmp('cancel-no-runjson');
  try {
    // No run.json seeded.
    let killed = false;
    const result = await cancelExperiment({
      run_id: runId,
      run_dir: runDir,
      pid: 9999,
      dataDir,
      cancelFn: () => { killed = true; return { killed: true }; },
    });
    assert.equal(result.success, false, 'cancel refused without a recorded run.json');
    assert.match(result.message, /no run\.json/, 'reports the missing run.json');
    assert.equal(killed, false, 'cancelRun never called');
  } finally {
    await cleanup();
  }
});

test('CR-02 cancel: a matching pid + valid run.json PROCEEDS and wires the reuse guard', async () => {
  const { runId, runDir, dataDir, cleanup } = await makeTmp('cancel-pid-match');
  try {
    await seedRunJson(runDir, runId, 4242);
    const calls = [];
    const result = await cancelExperiment({
      run_id: runId,
      run_dir: runDir,
      pid: 4242, // matches run.json.pid
      dataDir,
      cancelFn: (args) => { calls.push(args); return { killed: true }; },
    });
    assert.equal(result.success, true, 'cancel proceeds on a matching pid');
    assert.equal(result.killed, true);
    assert.equal(calls.length, 1, 'cancelRun called once');
    assert.equal(calls[0].pid, 4242, 'the matched pid is forwarded');
    assert.ok(calls[0].runJson && calls[0].runJson.pid === 4242, 'run.json threaded to the reuse guard');
    assert.equal(typeof calls[0].pidLooksLikeRunner, 'function', 'reuse guard hook wired');
    assert.equal(calls[0].pidLooksLikeRunner(calls[0].runJson), true, 'guard accepts a run.json with started_at');
  } finally {
    await cleanup();
  }
});
