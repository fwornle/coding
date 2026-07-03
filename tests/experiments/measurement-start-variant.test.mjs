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
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildVariantMeta } from '../../scripts/measurement-start.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, '..', '..', 'scripts', 'measurement-start.mjs');

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
