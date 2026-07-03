// tests/experiments/measurement-start-variant.test.mjs
// SPEC-01 / SPEC-02 proof for scripts/measurement-start.mjs's variant surface.
//
// Task 1 (this half): per-field variant flags -> span.meta (buildVariantMeta) with
//   snake_case test_command, conditional-spread (no null keys), and a fail-fast
//   shell-safety guard on --test-command (D-08 / T-77-05).
// Task 2 (second half): --spec/--variant resolution mode with flag-over-spec override
//   (D-03), spec goal_sentence, unknown-variant + invalid-spec fail-fast (D-06 / T-77-06).
//
// buildVariantMeta is imported DIRECTLY (pure helper); the CLI is spawned only for the
// exit-code shell-safety / fail-fast assertions (process.exit cannot run in-process).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildVariantMeta } from '../../scripts/measurement-start.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, '..', '..', 'scripts', 'measurement-start.mjs');
const EXAMPLE_SPEC_PATH = path.resolve(
  __dirname, '..', '..', 'config', 'experiments', 'example-experiment.yaml',
);

/** Write `contents` to a throwaway tmp YAML file and return its path. */
function writeTmpSpec(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'measurement-start-spec-'));
  const p = path.join(dir, 'experiment.yaml');
  fs.writeFileSync(p, contents, 'utf8');
  return { dir, p };
}

// ---------------------------------------------------------------------------
// Task 1: per-field variant flags -> span.meta
// ---------------------------------------------------------------------------

test('buildVariantMeta: all four value flags thread into meta with snake_case test_command', () => {
  const meta = buildVariantMeta([
    '--agent', 'claude',
    '--model', 'opus',
    '--framework', 'straight',
    '--test-command', 'node --test tests/x',
  ]);
  assert.equal(meta.agent, 'claude');
  assert.equal(meta.model, 'opus');
  assert.equal(meta.framework, 'straight');
  assert.equal(meta.test_command, 'node --test tests/x', 'snake_case test_command key');
  assert.equal(meta.testCommand, undefined, 'never the camelCase divergent key');
  const keys = Object.keys(meta).sort();
  for (const k of ['agent', 'framework', 'model', 'test_command']) {
    assert.ok(keys.includes(k), `meta keys include ${k}`);
  }
});

test('buildVariantMeta: --variant stamps meta.variant for provenance', () => {
  const meta = buildVariantMeta(['--variant', 'claude-opus-straight-default']);
  assert.equal(meta.variant, 'claude-opus-straight-default');
});

test('buildVariantMeta: omitting a flag leaves that meta key ABSENT (no null/undefined pollution)', () => {
  const meta = buildVariantMeta([]);
  const keys = Object.keys(meta);
  for (const k of ['agent', 'model', 'framework', 'test_command']) {
    assert.ok(!keys.includes(k), `no ${k} key when its flag is omitted`);
  }
});

test('CLI: a --test-command with a shell metacharacter aborts non-zero BEFORE the span opens', () => {
  const res = spawnSync(process.execPath, [CLI, '--task-id', 't-shell', '--test-command', 'a|b'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.notEqual(res.status, 0, 'non-zero exit on unsafe --test-command');
  assert.match(res.stderr, /shell/, 'stderr explains the shell-metacharacter rejection');
});

// ---------------------------------------------------------------------------
// Task 2: --spec/--variant resolution mode with flag-over-spec override
// ---------------------------------------------------------------------------

test('buildVariantMeta: --spec/--variant resolves a validated cell into meta', () => {
  const meta = buildVariantMeta(['--spec', EXAMPLE_SPEC_PATH, '--variant', 'claude-opus-straight-default']);
  assert.equal(meta.agent, 'claude', 'cell agent threads into meta');
  assert.equal(meta.model, 'opus', 'cell model threads into meta');
  assert.equal(meta.framework, 'straight', 'cell framework threads into meta');
  assert.equal(meta.env, 'default', 'cell env threads into meta');
  assert.equal(meta.test_command, 'node --test tests/experiments', 'cell test_command (snake_case) threads into meta');
  assert.equal(meta.variant, 'claude-opus-straight-default', 'selected variant name recorded');
});

test('buildVariantMeta: an explicit --model flag OVERRIDES the spec cell (D-03)', () => {
  const meta = buildVariantMeta([
    '--spec', EXAMPLE_SPEC_PATH,
    '--variant', 'claude-opus-straight-default',
    '--model', 'sonnet',
  ]);
  assert.equal(meta.model, 'sonnet', 'CLI --model wins over the cell model');
  assert.equal(meta.agent, 'claude', 'other cell fields still apply');
  assert.equal(meta.framework, 'straight', 'other cell fields still apply');
});

test('CLI: an unknown --variant aborts non-zero and lists the available variant names', () => {
  const res = spawnSync(process.execPath, [
    CLI, '--task-id', 't-bad-variant',
    '--spec', EXAMPLE_SPEC_PATH, '--variant', 'does-not-exist',
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.notEqual(res.status, 0, 'non-zero exit on unknown variant');
  assert.match(res.stderr, /does-not-exist/, 'names the missing variant');
  assert.match(res.stderr, /claude-opus-straight-default/, 'lists an available variant name');
});

test('CLI: an invalid spec (bad agent) fails fast non-zero BEFORE active-measurement.json is written', () => {
  const { dir } = writeTmpSpec([
    'version: 1',
    'goal_sentence: "invalid spec smoke"',
    'test_command: "node --test tests/experiments"',
    'axes:',
    '  agent: [foo]',
    '  model: [opus]',
  ].join('\n'));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'measurement-start-data-'));
  const res = spawnSync(process.execPath, [
    CLI, '--task-id', 't-invalid-spec',
    '--spec', path.join(dir, 'experiment.yaml'), '--variant', 'foo-opus-straight-default',
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, LLM_PROXY_DATA_DIR: dataDir },
  });
  assert.notEqual(res.status, 0, 'non-zero exit on invalid spec');
  assert.match(res.stderr, /agent/, 'stderr surfaces the agent-enum validation failure');
  assert.equal(
    fs.existsSync(path.join(dataDir, 'active-measurement.json')), false,
    'no span opened — validation ran before startMeasurement',
  );
});
