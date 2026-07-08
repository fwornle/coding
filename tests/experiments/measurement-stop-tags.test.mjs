// tests/experiments/measurement-stop-tags.test.mjs
//
// Phase 78-01 stop-side proof. Two concerns, both feeding writeRun's tags object:
//   Task 2 (R2): variant/repeat flow span.meta → tags (buildRunTags), so a cell's
//     provenance + repeat index land on the Run.
//   Task 3 (R3/R4): --terminal-state (enum-validated complete|timeout|abort) and
//     --skip-reason parse into the tags, recording every terminal outcome + probe-skip.
//
// buildRunTags / parseTerminalState / TERMINAL_STATES are imported DIRECTLY as pure
// helpers (measurement-stop.mjs gates main() behind isDirectRun, so importing it does
// NOT archive a span). The CLI is spawned only for the invalid-enum fail-fast exit-code
// assertion (process.exit cannot be observed in-process).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildRunTags,
  parseTerminalState,
  TERMINAL_STATES,
} from '../../scripts/measurement-stop.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, '..', '..', 'scripts', 'measurement-stop.mjs');

/** The canonical close-tag inputs (the shape measurement-stop assembles pre-writeRun). */
function sampleTagInputs(overrides = {}) {
  return {
    span: { task_id: 't1', meta: {}, ...(overrides.span ?? {}) },
    taskHash: 'deadbeef',
    canonicalAgent: 'claude',
    canonicalModel: 'claude-opus-4-8',
    snapshotId: null,
    backgroundModels: [],
    terminalState: null,
    skipReason: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Task 2 (R2): variant + repeat fold from span.meta into the writeRun tags
// ---------------------------------------------------------------------------

test('buildRunTags: variant + repeat fold from span.meta into the tags object', () => {
  const tags = buildRunTags(sampleTagInputs({
    span: { task_id: 't1', meta: { variant: 'claude-sonnet', repeat: 2 } },
  }));
  assert.equal(tags.variant, 'claude-sonnet', 'span.meta.variant → tags.variant');
  assert.equal(tags.repeat, 2, 'span.meta.repeat → tags.repeat');
});

test('buildRunTags: absent span.meta variant/repeat leave the tags null (never absent)', () => {
  const tags = buildRunTags(sampleTagInputs({ span: { task_id: 't1', meta: {} } }));
  assert.ok('variant' in tags, 'variant key always present');
  assert.ok('repeat' in tags, 'repeat key always present');
  assert.equal(tags.variant, null, 'no span.meta.variant → null');
  assert.equal(tags.repeat, null, 'no span.meta.repeat → null');
});

test('buildRunTags: preserves the existing canonical attribution tags (additive only)', () => {
  const tags = buildRunTags(sampleTagInputs());
  assert.equal(tags.task_hash, 'deadbeef');
  assert.equal(tags.agent, 'claude');
  assert.equal(tags.model, 'claude-opus-4-8');
  assert.equal(tags.canonical_agent, 'claude');
  assert.equal(tags.canonical_model, 'claude-opus-4-8');
  assert.equal(tags.trace_id, 't1');
  assert.deepEqual(tags.background_models, []);
});

// ---------------------------------------------------------------------------
// Task 3 (R3/R4): --terminal-state (enum-validated) + --skip-reason into the tags
// ---------------------------------------------------------------------------

test('parseTerminalState: accepts each closed-set value verbatim (complete|timeout|abort)', () => {
  assert.deepEqual([...TERMINAL_STATES], ['complete', 'timeout', 'abort'], 'D-04 enum verbatim');
  for (const s of TERMINAL_STATES) {
    assert.equal(parseTerminalState(['--terminal-state', s]), s, `'${s}' accepted`);
  }
});

test('parseTerminalState: absent flag → null (null-preserved)', () => {
  assert.equal(parseTerminalState([]), null, 'no --terminal-state → null');
});

test('parseTerminalState: an out-of-enum value throws (rejected before writeRun)', () => {
  assert.throws(
    () => parseTerminalState(['--terminal-state', 'foo']),
    /terminal-state|complete.*timeout.*abort/,
    'invalid enum value must throw',
  );
});

test('buildRunTags: --terminal-state / --skip-reason fold into the tags', () => {
  const tags = buildRunTags(sampleTagInputs({
    terminalState: 'timeout',
    skipReason: 'copilot-headless-unsupported',
  }));
  assert.equal(tags.terminal_state, 'timeout', 'terminal_state folded from the parsed flag');
  assert.equal(tags.skip_reason, 'copilot-headless-unsupported', 'skip_reason folded from the parsed flag');
});

test('buildRunTags: absent terminal_state / skip_reason leave the tags null (null-preserved)', () => {
  const tags = buildRunTags(sampleTagInputs());
  assert.ok('terminal_state' in tags, 'terminal_state key always present');
  assert.ok('skip_reason' in tags, 'skip_reason key always present');
  assert.equal(tags.terminal_state, null);
  assert.equal(tags.skip_reason, null);
});

// ---------------------------------------------------------------------------
// D-05/D-07 (Phase 85-01): rerun_of + base_variant fold from span.meta into the tags
// ---------------------------------------------------------------------------

test('buildRunTags: rerun_of + base_variant fold from span.meta into the tags object', () => {
  const tags = buildRunTags(sampleTagInputs({
    span: { task_id: 't1', meta: { rerun_of: 'exp-orig--r0', base_variant: 'A' } },
  }));
  assert.equal(tags.rerun_of, 'exp-orig--r0', 'span.meta.rerun_of → tags.rerun_of');
  assert.equal(tags.base_variant, 'A', 'span.meta.base_variant → tags.base_variant');
});

test('buildRunTags: absent span.meta rerun_of/base_variant leave the tags null (never absent)', () => {
  const tags = buildRunTags(sampleTagInputs({ span: { task_id: 't1', meta: {} } }));
  assert.ok('rerun_of' in tags, 'rerun_of key always present');
  assert.ok('base_variant' in tags, 'base_variant key always present');
  assert.equal(tags.rerun_of, null, 'no span.meta.rerun_of → null');
  assert.equal(tags.base_variant, null, 'no span.meta.base_variant → null');
});

test('CLI: an invalid --terminal-state fails fast non-zero with a stderr diagnostic', () => {
  const res = spawnSync(process.execPath, [CLI, '--terminal-state', 'foo'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.notEqual(res.status, 0, 'non-zero exit on an invalid --terminal-state');
  assert.match(res.stderr, /terminal-state/, 'stderr names the rejected flag');
});
