// tests/experiments/run-progress.test.mjs
//
// Phase 85-01 Task 1 (D-03/D-04): the atomic, never-throw progress emitter.
//   writeProgress(runDir, patch) merges a patch into <runDir>/progress.json via a
//     write-to-`progress.json.tmp` + fs.rename so a 5s poller NEVER reads a torn file
//     (Pitfall 3). Header keys shallow-merge; a `cells` patch UPSERTS by {variant, rep}
//     composite key (never clobbers the whole array).
//   readProgress(runDir) parses progress.json; ENOENT → null; both NEVER throw.
//
// The no-op path (emitProgress with a falsy runDir) is proven at the runMatrix level in
// experiment-runner.integration.test.mjs (which passes NO runDir); here we prove the
// standalone emitter primitives + the atomic-write/never-throw/upsert contract.
//
// node:test + node:assert/strict; diagnostics via process.stderr.write only (no console.*).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { writeProgress, readProgress } from '../../lib/experiments/run-progress.mjs';

/** Fresh throwaway run dir. */
function mkRunDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'run-progress-test-'));
}

test('writeProgress: writes a valid JSON progress.json (no .tmp left behind — atomic)', async () => {
  const runDir = mkRunDir();
  try {
    await writeProgress(runDir, { run_id: 'r1', total: 4, done: 0, overall: 'running' });

    const p = path.join(runDir, 'progress.json');
    assert.ok(fs.existsSync(p), 'progress.json exists after writeProgress');
    // The .tmp file must NOT survive the rename (atomic — never a torn read).
    assert.equal(fs.existsSync(path.join(runDir, 'progress.json.tmp')), false, 'no .tmp left behind');

    const obj = JSON.parse(fs.readFileSync(p, 'utf8')); // valid JSON, not torn
    assert.equal(obj.run_id, 'r1');
    assert.equal(obj.total, 4);
    assert.equal(obj.overall, 'running');
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test('writeProgress: header keys shallow-merge across successive patches', async () => {
  const runDir = mkRunDir();
  try {
    await writeProgress(runDir, { run_id: 'r1', total: 4, done: 0, overall: 'running' });
    await writeProgress(runDir, { done: 2, overall: 'scoring' }); // partial header patch

    const obj = await readProgress(runDir);
    assert.equal(obj.run_id, 'r1', 'unpatched header key survives the merge');
    assert.equal(obj.total, 4, 'unpatched total survives');
    assert.equal(obj.done, 2, 'done updated by the patch');
    assert.equal(obj.overall, 'scoring', 'overall updated by the patch');
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test('writeProgress: a cells patch UPSERTS by {variant, rep} — never clobbers the whole array', async () => {
  const runDir = mkRunDir();
  try {
    // Seed two cells.
    await writeProgress(runDir, {
      cells: [
        { variant: 'A', rep: 0, state: 'pending' },
        { variant: 'B', rep: 0, state: 'pending' },
      ],
    });
    // Patch ONLY cell A rep 0 → running. B must be untouched; A must not duplicate.
    await writeProgress(runDir, { cells: [{ variant: 'A', rep: 0, state: 'running' }] });

    const obj = await readProgress(runDir);
    assert.equal(obj.cells.length, 2, 'still exactly two cells (upsert, not append)');
    const a = obj.cells.find((c) => c.variant === 'A' && c.rep === 0);
    const b = obj.cells.find((c) => c.variant === 'B' && c.rep === 0);
    assert.equal(a.state, 'running', 'cell A rep 0 updated in place');
    assert.equal(b.state, 'pending', 'cell B rep 0 untouched by the A patch');

    // A brand-new cell key APPENDS.
    await writeProgress(runDir, { cells: [{ variant: 'A', rep: 1, state: 'pending' }] });
    const obj2 = await readProgress(runDir);
    assert.equal(obj2.cells.length, 3, 'a new {variant, rep} key appends a third cell');
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test('writeProgress: preserves a cell field not present in the patch (per-cell shallow-merge)', async () => {
  const runDir = mkRunDir();
  try {
    await writeProgress(runDir, { cells: [{ variant: 'A', rep: 0, state: 'running', started_at: 'T0' }] });
    await writeProgress(runDir, { cells: [{ variant: 'A', rep: 0, state: 'complete', ended_at: 'T1' }] });

    const obj = await readProgress(runDir);
    const a = obj.cells.find((c) => c.variant === 'A' && c.rep === 0);
    assert.equal(a.state, 'complete', 'state updated');
    assert.equal(a.started_at, 'T0', 'started_at preserved across the patch (shallow-merge)');
    assert.equal(a.ended_at, 'T1', 'ended_at added by the patch');
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test('writeProgress: never throws when the runDir does not exist', async () => {
  const missing = path.join(os.tmpdir(), 'run-progress-does-not-exist-' + Date.now(), 'nested');
  // Must resolve (return), never throw — a write failure is non-fatal (D-03).
  await assert.doesNotReject(() => writeProgress(missing, { overall: 'running' }));
  assert.equal(fs.existsSync(path.join(missing, 'progress.json')), false, 'nothing written to a missing dir');
});

test('readProgress: ENOENT → null (never throws)', async () => {
  const runDir = mkRunDir();
  try {
    const obj = await readProgress(runDir); // no progress.json yet
    assert.equal(obj, null, 'a missing progress.json reads as null');
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test('readProgress: a corrupt progress.json → null (never throws)', async () => {
  const runDir = mkRunDir();
  try {
    fs.writeFileSync(path.join(runDir, 'progress.json'), '{ not valid json', 'utf8');
    const obj = await readProgress(runDir);
    assert.equal(obj, null, 'unparseable JSON reads as null (never-throw)');
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});
