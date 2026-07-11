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
  validateCells,
  UNSUPPORTED_COMBINATIONS,
  KNOWN_AGENTS,
} from '../../lib/experiments/experiment-spec.mjs';
import { SHELL_META_RE } from '../../lib/experiments/evidence-harness.mjs';
import { KNOWN_AGENTS as ROUTE_TRACE_KNOWN_AGENTS } from '../../lib/experiments/route-trace-resolve.mjs';

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

// ---------------------------------------------------------------------------
// Phase 87 Plan 02 Task 1: mastracode agent enum (AVN-03 axis completeness) +
// kb-on/kb-off knowledge-injection env-axis vocabulary (AVN-04), encoded in the
// EXISTING `env` cell key (Pitfall 3 — no 5th cell key added).
// ---------------------------------------------------------------------------

test('validateCells: a mastracode avenue cell PASSES (no longer hard-blocked, AVN-03)', () => {
  const { threw } = captureStderr(() => validateCells([
    { agent: 'mastracode', model: 'sonnet', framework: 'straight', env: 'kb-on' },
  ]));
  assert.equal(threw, false, 'mastracode is a legal agent — validateCells does not hard-block it');
});

test('validateCells: an unknown agent STILL hard-blocks listing the legal set including mastracode', () => {
  const { threw, err } = captureStderr(() => validateCells([
    { agent: 'nope', model: 'sonnet', framework: 'straight', env: 'kb-on' },
  ]));
  assert.ok(threw, 'unknown agent still fail-fasts');
  assert.match(err.message, /nope/, 'names the bad value');
  assert.match(err.message, /mastracode/, 'mastracode now appears in the legal-agents list');
});

test('expandAxes: env:[kb-on,kb-off] yields 2 cells differing only in env, each with exactly 5 keys', () => {
  const cells = expandAxes(
    { agent: ['claude'], model: ['sonnet'], framework: ['gsd'], env: ['kb-on', 'kb-off'] },
    { test_command: 'node --test tests/experiments' },
  );
  assert.equal(cells.length, 2, 'kb-on × kb-off expands to exactly 2 cells');
  for (const cell of cells) {
    assert.deepEqual(Object.keys(cell).sort(), CELL_KEYS, 'each cell carries exactly the 5 canonical keys (Pitfall 3)');
    assert.equal(cell.agent, 'claude');
    assert.equal(cell.model, 'sonnet');
    assert.equal(cell.framework, 'gsd');
  }
  const envs = cells.map((c) => c.env).sort();
  assert.deepEqual(envs, ['kb-off', 'kb-on'], 'the two cells differ only in the env axis');
});

test('makeCell (via expandAxes): a kb-off cell survives — env is a first-class key, never dropped (Pitfall 3)', () => {
  const [cell] = expandAxes({ agent: ['mastracode'], model: ['sonnet'], framework: ['gsd'], env: ['kb-off'] });
  assert.equal(cell.env, 'kb-off', 'kb-off env value is preserved through makeCell');
  assert.deepEqual(Object.keys(cell).sort(), CELL_KEYS, 'no 5th key added, none dropped');
});

// ---------------------------------------------------------------------------
// Task 2: cell validation (D-05 agent enum, D-07 combo gate, D-08 shell-safety,
// D-06 aggregated whole-run fail-fast) + D-05 loose model/framework warnings.
// ---------------------------------------------------------------------------

/** Run `fn` while capturing everything written to process.stderr; return { threw, err, stderr }. */
function captureStderr(fn) {
  const orig = process.stderr.write;
  let buf = '';
  process.stderr.write = (chunk) => { buf += String(chunk); return true; };
  let threw = false;
  let err;
  try {
    fn();
  } catch (e) {
    threw = true;
    err = e;
  } finally {
    process.stderr.write = orig;
  }
  return { threw, err, stderr: buf };
}

test('SHELL_META_RE is exported from evidence-harness (single canonical regex, D-08)', () => {
  assert.ok(SHELL_META_RE instanceof RegExp, 'exported as a RegExp');
  // Byte-identical character class to the pre-edit private constant.
  assert.equal(SHELL_META_RE.source, "[|&;<>()$`\\\\\"'\\n\\r]", 'char class unchanged');
  assert.ok(SHELL_META_RE.test('node --test | rm'), 'rejects a pipe');
  assert.ok(SHELL_META_RE.test('node $(whoami)'), 'rejects command substitution');
  assert.ok(!SHELL_META_RE.test('node --test tests/experiments'), 'accepts a fixed argv');
});

test('KNOWN_AGENTS is a SUPERSET of the route-trace-resolve SoT set (mastracode is spec-only, D-05/AVN-03)', () => {
  // WR-02 (Phase 77 review): compare against the ACTUAL exported route-trace set, not a
  // hardcoded literal — otherwise this test gives zero drift protection if route-trace changes.
  // Phase 87 (AVN-03): the spec enum now ADDS `mastracode` (a legal avenue agent) which has NO
  // route-trace family because mastra is self-routed — so the spec set is a superset, and every
  // route-trace agent must still be spec-legal (no silent drop of a trace-known agent).
  for (const a of ROUTE_TRACE_KNOWN_AGENTS) {
    assert.ok(KNOWN_AGENTS.includes(a), `route-trace agent '${a}' must remain spec-legal`);
  }
  const specOnly = [...KNOWN_AGENTS].filter((a) => !ROUTE_TRACE_KNOWN_AGENTS.includes(a));
  assert.deepEqual(specOnly.sort(), ['mastracode'], 'the ONLY spec-only agent is mastracode (Phase 87 AVN-03)');
});

test('WR-01: an explicit empty variants:[] aborts (never collapse to zero cells)', () => {
  assert.throws(
    () => resolveExperimentSpec({ goal_sentence: 'nothing to run', variants: [] }),
    /ZERO variant cells/,
  );
});

test('resolveExperimentSpec: a cell with an unknown agent aborts the whole matrix (D-06)', () => {
  const { threw, err } = captureStderr(() => resolveExperimentSpec({
    goal_sentence: 'bad agent',
    variants: [{ agent: 'foo', model: 'opus', framework: 'straight', env: 'default' }],
  }));
  assert.ok(threw, 'unknown agent throws');
  assert.match(err.message, /agent/, 'names the agent dimension');
  assert.match(err.message, /foo/, 'names the bad value');
  assert.match(err.message, /claude,\s*copilot,\s*opencode/, 'lists the legal set');
});

test('resolveExperimentSpec: TWO invalid cells appear in ONE aggregated thrown message (never skip)', () => {
  const { threw, err } = captureStderr(() => resolveExperimentSpec({
    goal_sentence: 'two bad cells',
    variants: [
      { agent: 'foo', model: 'opus', framework: 'straight', env: 'default' },
      { agent: 'copilot', model: 'sonnet', framework: 'straight', env: 'headless' },
    ],
  }));
  assert.ok(threw, 'aggregated throw');
  assert.match(err.message, /foo/, 'first offending value present');
  assert.match(err.message, /RUN-04/, 'second offending combo present in the SAME message');
});

test('resolveExperimentSpec: copilot + headless is an unsupported combination (D-07)', () => {
  const { threw, err } = captureStderr(() => resolveExperimentSpec({
    goal_sentence: 'unsupported combo',
    variants: [{ agent: 'copilot', model: 'sonnet', framework: 'straight', env: 'headless' }],
  }));
  assert.ok(threw, 'copilot+headless throws');
  assert.match(err.message, /RUN-04/, 'points at the Phase-78 RUN-04 spike');
});

for (const bad of ['node --test | rm', 'node $(whoami)', 'node --test; ls', 'a && b', 'node\ntest']) {
  test(`resolveExperimentSpec: test_command with a shell metacharacter is rejected (${JSON.stringify(bad)})`, () => {
    const { threw, err } = captureStderr(() => resolveExperimentSpec({
      goal_sentence: 'shell unsafe',
      variants: [{ agent: 'claude', model: 'opus', framework: 'straight', env: 'default', test_command: bad }],
    }));
    assert.ok(threw, 'shell-unsafe command throws');
    assert.match(err.message, /test_command/, 'names the test_command dimension');
    assert.match(err.message, /shell/, 'explains the shell-safety violation');
  });
}

test('resolveExperimentSpec: an unknown model does NOT throw — it WARNs to stderr (D-05 loose)', () => {
  const { threw, stderr } = captureStderr(() => resolveExperimentSpec({
    goal_sentence: 'loose model',
    variants: [{ agent: 'claude', model: 'some-unheard-of-model', framework: 'straight', env: 'default' }],
  }));
  assert.equal(threw, false, 'unknown model resolves (loose validation)');
  assert.match(stderr, /WARN/, 'emits a warning to stderr');
  assert.match(stderr, /some-unheard-of-model/, 'names the unrecognized model');
});

test('resolveExperimentSpec: a fully-valid 2x2 matrix resolves with zero throws and zero warnings', () => {
  const { threw, stderr } = captureStderr(() => {
    const { cells } = resolveExperimentSpec({
      goal_sentence: 'clean run',
      repeats: 2,
      axes: { agent: ['claude', 'copilot'], model: ['opus', 'sonnet'], framework: ['straight'], env: ['default'] },
      test_command: 'node --test tests/experiments',
    });
    assert.equal(cells.length, 4);
  });
  assert.equal(threw, false, 'valid matrix does not throw');
  assert.equal(stderr, '', 'no stderr warnings for a fully-recognized matrix');
});
