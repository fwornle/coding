// Parallel matrix mode: worker-pool overlap, setup/store serialization, progress coherence.
//
// All seams injected (no real agents/git/store). The concurrency trackers count in-flight
// invocations per seam; the assertions pin the design contract:
//   • parallel: spawnAgent overlaps (pool works) but restore + measurement-stop NEVER overlap
//     (setup/store mutexes);
//   • serial: nothing overlaps (byte-identical legacy behavior);
//   • progress.json survives concurrent emits (single-writer queue) and carries execution_mode.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runMatrix, makeMutex } from '../../lib/experiments/experiment-runner.mjs';
import { writeProgress, readProgress } from '../../lib/experiments/run-progress.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeTracker() {
  const t = { inFlight: 0, maxInFlight: 0, calls: 0 };
  t.enter = () => {
    t.calls += 1;
    t.inFlight += 1;
    t.maxInFlight = Math.max(t.maxInFlight, t.inFlight);
  };
  t.exit = () => { t.inFlight -= 1; };
  return t;
}

/**
 * A rendezvous for `n` concurrent arrivals.
 *
 * WHY, rather than racing two sleeps. Overlap used to be established by wall clock: the agent
 * slept longer than the restore, so cell 2's agent started before cell 1's finished. That holds
 * on an idle machine and breaks under load — and NOT proportionally, because the serialized
 * restore path does synchronous `mkdtempSync` work whose cost depends on filesystem contention,
 * not on the timer. When `node --test` runs the whole directory, sibling files compete for I/O,
 * the restore outruns the 80 ms agent timer, and `maxInFlight` collapses to 1. The test then
 * fails while reporting nothing about the pool it is supposed to be testing.
 *
 * The barrier makes the SAME assertion deterministic: each agent blocks until `n` of them are
 * simultaneously in flight. If the pool overlaps, they meet and all proceed regardless of how
 * slow the machine is. If the pool has regressed to serial, nobody ever meets, the wait expires,
 * and the test fails for the real reason. Latency cannot turn a working pool red, and a broken
 * pool cannot be rescued by a fast machine.
 */
function makeBarrier(n, timeoutMs = 5000) {
  let arrived = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  return async function arrive() {
    arrived += 1;
    if (arrived >= n) { release(); return; }
    // Bounded: a genuine serialization regression must fail the assertion, not hang the suite.
    let timer;
    await Promise.race([gate, new Promise((r) => { timer = setTimeout(r, timeoutMs); })]);
    clearTimeout(timer);
  };
}

function makeSeams({ agentDelayMs = 60, restoreDelayMs = 15, overlapBarrier = 0 }) {
  const restore = makeTracker();
  const spawn = makeTracker();
  const stop = makeTracker();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-parallel-'));
  // Pre-create the per-cell dirs so the serialized restore path holds no synchronous filesystem
  // work. Keeps the restore window a function of `restoreDelayMs` alone, which is what the
  // serialization assertions below actually mean to pin.
  const dirs = Array.from({ length: 8 }, () => ({
    worktree: fs.mkdtempSync(path.join(tmp, 'wt-')),
    sandboxDataDir: fs.mkdtempSync(path.join(tmp, 'data-')),
  }));
  let dirIdx = 0;
  const arriveAtBarrier = overlapBarrier > 0 ? makeBarrier(overlapBarrier) : null;
  return {
    trackers: { restore, spawn, stop },
    opts: {
      repoRoot: path.join(tmp, 'no-such-repo'), // git status fails → escape guard skips (fail-soft)
      restore: async () => {
        restore.enter();
        await sleep(restoreDelayMs);
        restore.exit();
        return dirs[dirIdx++ % dirs.length];
      },
      spawnAgent: async () => {
        spawn.enter();
        // Rendezvous FIRST (while counted in flight), so the trackers observe real concurrency.
        if (arriveAtBarrier) await arriveAtBarrier();
        await sleep(agentDelayMs);
        spawn.exit();
        return { state: 'complete' };
      },
      runMeasurement: async (phase) => {
        if (phase === 'stop') {
          stop.enter();
          await sleep(10);
          stop.exit();
        }
        return 0;
      },
      configureRouting: async (_agent, env) => env,
      preflight: async () => ({ ok: true }),
      readDone: async () => [],
      openStore: async () => ({ close: async () => {} }),
    },
  };
}

const SPEC = {
  goal_sentence: 'parallel pool test',
  repeats: 1,
  cells: [
    { agent: 'claude', model: 'm1', framework: 'straight', env: 'default', test_command: null },
    { agent: 'opencode', model: 'm2', framework: 'straight', env: 'default', test_command: null },
    { agent: 'copilot', model: 'm3', framework: 'straight', env: 'default', test_command: null },
  ],
};

test('parallel: agents overlap; restores and stops never do; runs all cells', async () => {
  // agentDelayMs stays short: the barrier — not the sleep — is what proves overlap here.
  const { trackers, opts } = makeSeams({ agentDelayMs: 20, overlapBarrier: 2 });
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-parallel-dir-'));
  const summary = await runMatrix(SPEC, {
    ...opts,
    resolveSpec: () => SPEC,
    expId: 'ptest',
    parallel: true,
    maxParallel: 3,
    runDir,
  });
  assert.equal(summary.length, 3);
  assert.ok(summary.every((s) => s.terminal_state === 'complete'), JSON.stringify(summary));
  assert.ok(trackers.spawn.maxInFlight > 1, `agents should overlap (max=${trackers.spawn.maxInFlight})`);
  assert.equal(trackers.restore.maxInFlight, 1, 'restores must be serialized by the setup mutex');
  assert.equal(trackers.stop.maxInFlight, 1, 'measurement-stops must be serialized by the store mutex');
  const progress = await readProgress(runDir);
  assert.equal(progress.execution_mode, 'parallel');
  assert.equal(progress.overall, 'complete');
  assert.equal(progress.cells.filter((c) => c.state === 'complete').length, 3);
});

test('parallel: maxParallel bounds in-flight agents', async () => {
  const { trackers, opts } = makeSeams({ agentDelayMs: 60 });
  await runMatrix(SPEC, { ...opts, resolveSpec: () => SPEC, expId: 'ptest2', parallel: true, maxParallel: 2 });
  assert.ok(trackers.spawn.maxInFlight <= 2, `pool must cap at 2 (saw ${trackers.spawn.maxInFlight})`);
  assert.equal(trackers.spawn.calls, 3);
});

test('live switch: control.json {parallel:true} releases a serial run to the pool', async () => {
  // Long agents vs. near-instant restores so overlap is deterministic once the pool releases them
  // (restores serialize on the setup mutex; agents run outside it and clearly co-exist).
  const { trackers, opts } = makeSeams({ agentDelayMs: 250, restoreDelayMs: 3 });
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-switch-dir-'));
  // Signal present BEFORE the run: the serial loop's first wantsParallelNow() check flips it, so
  // all cells dispatch through the worker pool — deterministic proof of the switch mechanism.
  fs.writeFileSync(path.join(runDir, 'control.json'), JSON.stringify({ parallel: true }));
  const summary = await runMatrix(SPEC, {
    ...opts, resolveSpec: () => SPEC, expId: 'swtest', parallel: false, maxParallel: 3, runDir,
  });
  assert.equal(summary.length, 3);
  assert.ok(trackers.spawn.maxInFlight > 1, `switched run should overlap agents (max=${trackers.spawn.maxInFlight})`);
  assert.equal(trackers.restore.maxInFlight, 1, 'restores still serialized after switch');
  const progress = await readProgress(runDir);
  assert.equal(progress.execution_mode, 'parallel', 'execution_mode flips to parallel on switch');
});

test('serial (default): nothing overlaps — legacy behavior preserved', async () => {
  const { trackers, opts } = makeSeams({ agentDelayMs: 20 });
  const summary = await runMatrix(SPEC, { ...opts, resolveSpec: () => SPEC, expId: 'stest' });
  assert.equal(summary.length, 3);
  assert.equal(trackers.spawn.maxInFlight, 1);
  assert.equal(trackers.restore.maxInFlight, 1);
});

test('makeMutex: serializes and survives a rejecting job', async () => {
  const m = makeMutex();
  const order = [];
  const p1 = m.run(async () => { await sleep(20); order.push(1); });
  const p2 = m.run(async () => { order.push(2); throw new Error('boom'); });
  const p3 = m.run(async () => { order.push(3); });
  await p1;
  await assert.rejects(p2, /boom/);
  await p3;
  assert.deepEqual(order, [1, 2, 3]);
});

test('writeProgress: concurrent emits all land (single-writer queue)', async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-progress-conc-'));
  await Promise.all(
    Array.from({ length: 50 }, (_, i) =>
      writeProgress(runDir, { cells: [{ variant: `v${i}`, rep: 0, state: 'complete' }] })
    )
  );
  const progress = await readProgress(runDir);
  assert.equal(progress.cells.length, 50, 'every concurrent cell patch must survive');
});
