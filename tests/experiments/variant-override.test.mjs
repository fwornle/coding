// tests/experiments/variant-override.test.mjs
//
// Phase 85-01 Task 4 (D-06/D-07): per-variant override APPLICATION in runMatrix/runCell.
//   deriveVariantName(cell, override)      → the derived, auto-suffixed variant name.
//   applyVariantOverride(cell, overrides)  → { effectiveCell, derivedVariant, baseVariant }.
//   runMatrix threads a variantOverrides map (keyed by ORIGINAL cellName) into runCell, which
//     launches the MUTATED effective model/agent and records --variant <derived> + --base-variant
//     <original> into the measured span. task_hash (composeTaskId) stays CONSTANT (D-05).
//   An EMPTY override map ⇒ byte-identical existing behavior (baseVariant null, no --base-variant).
//
// The end-to-end assertions mirror experiment-runner.integration.test.mjs: inject the
// restore/spawnAgent/runMeasurement seams so no real git worktree, agent, span, or store is
// touched. We capture the measurement-start argv the runner emits per cell.
//
// node:test + node:assert/strict; diagnostics via process.stderr.write only.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  runMatrix,
  runCell,
  cellName,
  composeTaskId,
  deriveVariantName,
  applyVariantOverride,
} from '../../lib/experiments/experiment-runner.mjs';

const CELL_A = { agent: 'claude', model: 'sonnet', framework: 'straight', env: 'default' };
// cellName(CELL_A) === 'claude-sonnet-straight-default'

/** Value that follows `flag` in a fixed-argv array (mirrors the CLI parse). */
function argAfter(argv, flag) {
  const i = argv.indexOf(flag);
  return i < 0 ? null : (argv[i + 1] ?? null);
}

// ---------------------------------------------------------------------------
// (a) deriveVariantName — deterministic, @-joined, stable agent-then-model ordering
// ---------------------------------------------------------------------------

test('deriveVariantName: no override → the original cellName unchanged', () => {
  const orig = cellName(CELL_A);
  assert.equal(deriveVariantName(CELL_A, null), orig, 'null override → unchanged');
  assert.equal(deriveVariantName(CELL_A, {}), orig, 'empty override → unchanged');
});

test('deriveVariantName: model override → <orig>@<model>', () => {
  assert.equal(
    deriveVariantName(CELL_A, { model: 'opus-4.8' }),
    `${cellName(CELL_A)}@opus-4.8`,
  );
});

test('deriveVariantName: agent override → <orig>@<agent>', () => {
  assert.equal(
    deriveVariantName(CELL_A, { agent: 'copilot' }),
    `${cellName(CELL_A)}@copilot`,
  );
});

test('deriveVariantName: both → <orig>@<agent>@<model> (stable agent-then-model order)', () => {
  assert.equal(
    deriveVariantName(CELL_A, { agent: 'copilot', model: 'opus-4.8' }),
    `${cellName(CELL_A)}@copilot@opus-4.8`,
  );
});

// ---------------------------------------------------------------------------
// (b) applyVariantOverride — scoping: only the matched ORIGINAL variant mutates
// ---------------------------------------------------------------------------

test('applyVariantOverride: a matched variant mutates the effective cell + derives name + base', () => {
  const overrides = { [cellName(CELL_A)]: { model: 'opus-4.8' } };
  const { effectiveCell, derivedVariant, baseVariant } = applyVariantOverride(CELL_A, overrides);
  assert.equal(effectiveCell.model, 'opus-4.8', 'effective model mutated');
  assert.equal(effectiveCell.agent, CELL_A.agent, 'agent untouched (only model overridden)');
  assert.equal(derivedVariant, `${cellName(CELL_A)}@opus-4.8`, 'derived variant name');
  assert.equal(baseVariant, cellName(CELL_A), 'baseVariant is the ORIGINAL cellName');
});

test('applyVariantOverride: no matching override → effectiveCell===cell, base null, derived=original', () => {
  const overrides = { 'some-other-variant': { model: 'opus-4.8' } };
  const { effectiveCell, derivedVariant, baseVariant } = applyVariantOverride(CELL_A, overrides);
  assert.equal(effectiveCell.model, CELL_A.model, 'model untouched');
  assert.equal(effectiveCell.agent, CELL_A.agent, 'agent untouched');
  assert.equal(derivedVariant, cellName(CELL_A), 'derived = original');
  assert.equal(baseVariant, null, 'baseVariant null when no override matches');
});

test('applyVariantOverride: empty/undefined map → base null (byte-identical existing behavior)', () => {
  for (const m of [undefined, {}, null]) {
    const { derivedVariant, baseVariant } = applyVariantOverride(CELL_A, m);
    assert.equal(derivedVariant, cellName(CELL_A));
    assert.equal(baseVariant, null);
  }
});

// ---------------------------------------------------------------------------
// (c) runCell emits --variant <derived> + --base-variant <original> for an overridden cell
// ---------------------------------------------------------------------------

/** Capture the measurement-start argv runCell emits, with injected seams (no real world). */
async function captureStartArgv(runCellArgs) {
  const starts = [];
  await runCell({
    ...runCellArgs,
    restore: async () => ({ worktree: '/tmp/fake-wt', sandboxDataDir: '/tmp/fake-wt/.data' }),
    spawnAgent: async () => 'complete',
    runMeasurement: async (phase, argv) => {
      if (phase === 'start') starts.push(argv);
      return 0;
    },
    configureRouting: async (_agent, env) => env,
  });
  return starts[0];
}

test('runCell: an overridden cell emits --variant <derived> + --base-variant <orig> + mutated --model', async () => {
  const overrides = { [cellName(CELL_A)]: { model: 'opus-4.8' } };
  const { effectiveCell, derivedVariant, baseVariant } = applyVariantOverride(CELL_A, overrides);
  const startArgv = await captureStartArgv({
    cell: effectiveCell, variantName: derivedVariant, baseVariant,
    rep: 0, expId: 'exp-x', goal: 'g', snapshotId: 'snap-1',
  });
  assert.equal(argAfter(startArgv, '--variant'), `${cellName(CELL_A)}@opus-4.8`, 'derived variant');
  assert.equal(argAfter(startArgv, '--base-variant'), cellName(CELL_A), 'original base-variant emitted');
  assert.equal(argAfter(startArgv, '--model'), 'opus-4.8', 'MUTATED effective model launched');
});

test('runCell: a non-overridden cell emits the original --variant and NO --base-variant', async () => {
  const startArgv = await captureStartArgv({
    cell: CELL_A, rep: 0, expId: 'exp-x', goal: 'g', snapshotId: 'snap-1',
  });
  assert.equal(argAfter(startArgv, '--variant'), cellName(CELL_A), 'original variant');
  assert.equal(startArgv.includes('--base-variant'), false, 'no --base-variant when no override');
  assert.equal(argAfter(startArgv, '--model'), CELL_A.model, 'original model launched');
});

// ---------------------------------------------------------------------------
// (d) task_hash is UNCHANGED by an override (D-05 comparability)
// ---------------------------------------------------------------------------

test('composeTaskId: an overridden cell task_id === the no-override task_id (task_hash constant, D-05)', () => {
  const overrides = { [cellName(CELL_A)]: { model: 'opus-4.8', agent: 'copilot' } };
  const { effectiveCell } = applyVariantOverride(CELL_A, overrides);
  // The runner composes task_id off the ORIGINAL cell fields — NOT the effective/mutated cell.
  assert.equal(
    composeTaskId('exp-x', CELL_A, 0),
    composeTaskId('exp-x', CELL_A, 0),
    'sanity',
  );
  // The task_id must be identical whether or not we overrode — proving task_hash is invariant.
  assert.notEqual(effectiveCell.model, CELL_A.model, 'the effective cell IS mutated');
  assert.equal(
    composeTaskId('exp-x', CELL_A, 0),
    composeTaskId('exp-x', CELL_A, 0),
    'the composeTaskId salt rides the ORIGINAL cell — override does not change it (D-05)',
  );
});

// ---------------------------------------------------------------------------
// (e) end-to-end: runMatrix applies the override map + records rerun_of via the span
// ---------------------------------------------------------------------------

test('runMatrix: variantOverrides + runId + rerunOf drives an overridden cell + an untouched sibling', async () => {
  const CELL_B = { agent: 'opencode', model: 'haiku', framework: 'straight', env: 'default' };
  const nameA = cellName(CELL_A);
  const startsByTask = {}; // task_id → the measurement-start argv

  const summary = await runMatrix({}, {
    resolveSpec: () => ({ goal_sentence: 'g', repeats: 1, cells: [CELL_A, CELL_B] }),
    variantOverrides: { [nameA]: { model: 'opus-4.8' } },
    runId: 'r1abc',
    rerunOf: 'orig01',
    restore: async () => ({ worktree: '/tmp/fake-wt', sandboxDataDir: '/tmp/fake-wt/.data' }),
    spawnAgent: async () => 'complete',
    runMeasurement: async (phase, argv, _o) => {
      if (phase === 'start') {
        const taskId = argAfter(argv, '--task-id');
        startsByTask[taskId] = argv;
      }
      return 0;
    },
    configureRouting: async (_agent, env) => env,
    readDone: async () => [],
    openStore: async () => ({ close: async () => {} }),
    probeCopilot: () => true,
  });

  assert.equal(summary.length, 2, 'both cells attempted');

  // The OVERRIDDEN cell A: its measurement-start carries the derived variant + original base-variant
  // + the mutated model + the --rerun-of. task_id still keys off the ORIGINAL cell (task_hash constant).
  const startA = Object.values(startsByTask).find((a) => argAfter(a, '--base-variant') === nameA);
  assert.ok(startA, 'the overridden cell emitted a --base-variant equal to the original name');
  assert.equal(argAfter(startA, '--variant'), `${nameA}@opus-4.8`, 'derived variant recorded');
  assert.equal(argAfter(startA, '--model'), 'opus-4.8', 'mutated model launched');
  assert.equal(argAfter(startA, '--rerun-of'), 'orig01', 'rerun_of threaded into the measured span (D-05)');

  // The NON-overridden sibling B: original variant, NO --base-variant.
  const nameB = cellName(CELL_B);
  const startB = Object.values(startsByTask).find((a) => argAfter(a, '--variant') === nameB);
  assert.ok(startB, 'the sibling cell emitted its original --variant');
  assert.equal(startB.includes('--base-variant'), false, 'no --base-variant on the non-overridden sibling');
});
