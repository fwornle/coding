// tests/experiments/experiment-spec.test.mjs
// SPEC-01 / SPEC-02 proof for lib/experiments/experiment-spec.mjs.
//
// Task 1 (this half): cartesian-axis expansion + spec load/null-guard/goal_sentence.
// Task 2 (second half): cell validation — agent enum (D-05), unsupported-combination
// gate (D-07), test_command shell-safety (D-08), whole-run all-or-nothing fail-fast (D-06).
//
// Pure unit suite — no LLM, no network. resolveExperimentSpec accepts a pre-parsed
// object (not just a file path) so the expansion/validation logic is testable without
// touching the filesystem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveExperimentSpec,
  expandAxes,
  UNSUPPORTED_COMBINATIONS,
} from '../../lib/experiments/experiment-spec.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE_SPEC_PATH = path.resolve(
  __dirname, '..', '..', 'config', 'experiments', 'example-experiment.yaml',
);
const CELL_KEYS = ['agent', 'env', 'framework', 'model', 'test_command'];

/** Write `contents` to a throwaway tmp YAML file and return its path. */
function writeTmpYaml(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'experiment-spec-test-'));
  const p = path.join(dir, 'experiment.yaml');
  fs.writeFileSync(p, contents, 'utf8');
  return p;
}

// ---------------------------------------------------------------------------
// Task 1: expansion + load/guard
// ---------------------------------------------------------------------------

test('expandAxes: 2x2 agent×model with single framework/env yields 4 distinct cells', () => {
  const cells = expandAxes(
    { agent: ['claude', 'copilot'], model: ['opus', 'sonnet'], framework: ['straight'], env: ['default'] },
    { test_command: 'node --test tests/experiments' },
  );
  assert.equal(cells.length, 4, 'cartesian product of 2×2×1×1 = 4 cells');
  for (const cell of cells) {
    assert.deepEqual(Object.keys(cell).sort(), CELL_KEYS, 'cell has exactly the 5 downstream keys');
    assert.equal(cell.test_command, 'node --test tests/experiments', 'top-level test_command threads into each cell');
  }
  // Every agent×model combination is present exactly once.
  const combos = cells.map((c) => `${c.agent}:${c.model}`).sort();
  assert.deepEqual(combos, ['claude:opus', 'claude:sonnet', 'copilot:opus', 'copilot:sonnet']);
});

test('expandAxes: a missing axis defaults to a single sentinel (product never collapses to zero)', () => {
  const cells = expandAxes({ agent: ['claude'], model: ['opus'] });
  assert.equal(cells.length, 1, 'missing framework/env each default to one value → 1 cell, not 0');
  assert.deepEqual(Object.keys(cells[0]).sort(), CELL_KEYS);
  assert.ok(cells[0].framework, 'framework has a documented default');
  assert.ok(cells[0].env, 'env has a documented default');
});

test('resolveExperimentSpec: repeats is carried on the envelope, NOT multiplied into cells', () => {
  const spec = {
    goal_sentence: 'do the thing',
    repeats: 2,
    axes: { agent: ['claude', 'copilot'], model: ['opus', 'sonnet'], framework: ['straight'], env: ['default'] },
    test_command: 'node --test tests/experiments',
  };
  const { goal_sentence, repeats, cells } = resolveExperimentSpec(spec);
  assert.equal(goal_sentence, 'do the thing');
  assert.equal(repeats, 2, 'repeats on the envelope');
  assert.equal(cells.length, 4, 'cells NOT multiplied by repeats (still 4, not 8)');
});

test('resolveExperimentSpec: an explicit variants: list resolves to the same cell shape', () => {
  const spec = {
    goal_sentence: 'named variants',
    variants: [
      { agent: 'claude', model: 'opus', framework: 'straight', env: 'default' },
      { agent: 'copilot', model: 'sonnet', framework: 'straight', env: 'default', test_command: 'node --test x' },
    ],
    test_command: 'node --test tests/experiments',
  };
  const { cells } = resolveExperimentSpec(spec);
  assert.equal(cells.length, 2);
  for (const cell of cells) {
    assert.deepEqual(Object.keys(cell).sort(), CELL_KEYS);
  }
  assert.equal(cells[0].test_command, 'node --test tests/experiments', 'variant inherits top-level default');
  assert.equal(cells[1].test_command, 'node --test x', 'per-variant test_command overrides the default');
});

test('resolveExperimentSpec: an empty YAML file throws "empty or malformed" naming the path', () => {
  const p = writeTmpYaml('');
  assert.throws(
    () => resolveExperimentSpec(p),
    (err) => err instanceof Error && /empty or malformed/.test(err.message) && err.message.includes(p),
    'empty spec throws with path in the message',
  );
});

test('resolveExperimentSpec: a spec missing goal_sentence throws an actionable error', () => {
  assert.throws(
    () => resolveExperimentSpec({ axes: { agent: ['claude'], model: ['opus'] } }),
    (err) => err instanceof Error && /goal_sentence/.test(err.message),
    'missing goal_sentence names the field',
  );
});

test('resolveExperimentSpec: the shipped example YAML resolves to cells covering every axis combination', () => {
  const { goal_sentence, repeats, cells } = resolveExperimentSpec(EXAMPLE_SPEC_PATH);
  assert.ok(typeof goal_sentence === 'string' && goal_sentence.trim().length, 'example has a goal_sentence');
  assert.ok(repeats >= 1, 'example has a positive repeats');
  assert.ok(cells.length >= 4, 'example 2×2 matrix expands to at least 4 cells');
  for (const cell of cells) {
    assert.deepEqual(Object.keys(cell).sort(), CELL_KEYS);
    assert.ok(cell.test_command, 'each example cell carries a test_command');
  }
  // Distinct agent×model combinations equal the number of cells (full cartesian, no dupes).
  const combos = new Set(cells.map((c) => `${c.agent}:${c.model}:${c.framework}:${c.env}`));
  assert.equal(combos.size, cells.length, 'every cell is a distinct combination');
});

test('UNSUPPORTED_COMBINATIONS is a frozen list (extensible by later phases)', () => {
  assert.ok(Array.isArray(UNSUPPORTED_COMBINATIONS), 'exported as an array');
  assert.ok(Object.isFrozen(UNSUPPORTED_COMBINATIONS), 'frozen');
});
